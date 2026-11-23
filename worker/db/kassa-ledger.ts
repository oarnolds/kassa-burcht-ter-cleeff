// The kassa in the ledger: each kassa day becomes one entry, each handover of the kluisje another. The kassa's
// tables are only read. A day follows the kassa while its year is open; what arrives for a closed year is booked
// on 1 January of the first open year.

import { LEDGER_START, type EntryLine, type EntrySource } from "../../shared/ledger-types";
import { businessDate, shiftDate } from "../../shared/time";
import { firstOpenYear, LedgerError, type NewEntry, upsertSourcedStatements } from "./ledger";
import { setLedgerSettingStatement } from "./ledger-settings";
import { inUseSince } from "./maintenance";
import { endOfDay } from "./opening";

export type KassaSyncResult = { days: number; late: number; handovers: number; left: number };

/** In `ledger_settings`: the newest change of the kassa (received or settled) the ledger has caught up with. */
const MARKER = "ledger_kassa_synced_at";
/**
 * The marker stays at least this far behind the run. A sale is stamped a moment before it is stored (a pin
 * sale after Mollie answered), and a run that read before it was stored may finish after one that read after;
 * a change stamped within this margin is looked at once more by the next run instead of being skipped.
 */
const MARGIN_MS = 10 * 60_000;
/** Entries written per database call. */
const PER_BATCH = 20;

const KAS = "1000";
const MOLLIE = "1030";
const KRUISPOSTEN = "1080";
const KASVERSCHILLEN = "4515";
/** Where a category without a row in `category_accounts` books. */
const KIOSK = "8011";

export type Amounts = Map<string, number>;
type Booked = { id: string; year: number; amounts: Amounts };
type HandoverRow = { id: string; counted_at: string; expected_cents: number; received_cents: number; left_cents: number; difference_cents: number; note: string | null };
type Kind = "days" | "late" | "handovers";
/** An entry to write: what it is, the date it is about (for the order), and its content once the first open year is known. */
type Work = { kind: Kind; date: string; existing: { id: string } | null; entry: (openYear: number) => NewEntry & { sourceRef: string } };

const yearOf = (date: string) => Number(date.slice(0, 4));
// Dates and ISO moments compare as strings.
const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);

/** `d-m-jjjj`, as in "Kassa 6-3-2027". */
export const dayMonthYear = (date: string) => {
  const [year, month, day] = date.split("-");
  return `${Number(day)}-${Number(month)}-${year}`;
};

export function add(amounts: Amounts, code: string, cents: number): void {
  amounts.set(code, (amounts.get(code) ?? 0) + cents);
}

/** `a − b`, account by account, without the accounts that come to zero. */
export function minus(a: Amounts, b: Amounts | undefined): Amounts {
  const out = new Map(a);
  for (const [code, cents] of b ?? []) add(out, code, -cents);
  for (const [code, cents] of out) if (cents === 0) out.delete(code);
  return out;
}

export function sameAmounts(a: Amounts, b: Amounts): boolean {
  const left = minus(a, undefined);
  const right = minus(b, undefined);
  return left.size === right.size && [...left].every(([code, cents]) => right.get(code) === cents);
}

export const toLines = (amounts: Amounts): EntryLine[] =>
  [...amounts]
    .filter(([, cents]) => cents !== 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([accountCode, amountCents]) => ({ accountCode, amountCents, note: null, assetId: null }));

/**
 * Brings the kassa's paid sales and handovers into the ledger; at most `maxItems` per run, oldest first.
 *
 * The days looked at are those (from the ingebruikname and from LEDGER_START) with a sale received or settled
 * after the marker (in a closed year: after that year was closed, so a mapping change never touches it), and those with a paid sale but no entry yet. Of those, only a day whose entry differs from
 * the kassa is written. The marker moves to the newest change read at the start (at most up to MARGIN_MS before
 * `now`), and only when nothing was left for the next run: a run never skips a later day, and the next one
 * carries on where this one stopped.
 */
export async function syncKassa(db: D1Database, now: Date, maxItems = 40): Promise<KassaSyncResult> {
  const result: KassaSyncResult = { days: 0, late: 0, handovers: 0, left: 0 };
  const [since, [markerRows, closedRows]] = await Promise.all([
    inUseSince(db),
    db.batch([
      db.prepare("SELECT value FROM ledger_settings WHERE key = ?1").bind(MARKER),
      db.prepare("SELECT year FROM ledger_years WHERE status = 'closed'"),
    ]),
  ]);
  // Not in use yet: what the kassa holds is trial data.
  if (since === null) return result;
  const synced = (markerRows!.results[0] as { value: string } | undefined)?.value ?? "";
  const closed = new Set((closedRows!.results as { year: number }[]).map((row) => row.year));
  const from = later(businessDate(since), LEDGER_START);

  // One snapshot: the days to look at, the newest change among them, and the handovers without an entry.
  const [dayRows, newestRows, handoverRows] = await db.batch([
    db
      .prepare(
        `SELECT business_date AS date FROM sales WHERE business_date >= ?1 AND (received_at > ?2 OR settled_at > ?2)
           AND NOT EXISTS (
             SELECT 1 FROM ledger_years y
             WHERE y.status = 'closed' AND y.year = CAST(substr(sales.business_date, 1, 4) AS INTEGER)
               AND sales.received_at <= y.closed_at AND COALESCE(sales.settled_at, '') <= y.closed_at)
         UNION
         SELECT d.date FROM (SELECT DISTINCT business_date AS date FROM sales WHERE business_date >= ?1 AND status = 'paid') d
         WHERE NOT EXISTS (SELECT 1 FROM ledger_entries e WHERE e.source IN ('kassa_day', 'kassa_late') AND e.source_ref = d.date)
         ORDER BY date`,
      )
      .bind(from, synced),
    db.prepare("SELECT MAX(received_at) AS received, MAX(settled_at) AS settled FROM sales WHERE business_date >= ?1").bind(from),
    db
      .prepare(
        `SELECT h.id, h.counted_at, h.expected_cents, h.received_cents, h.left_cents, h.difference_cents, h.note FROM handovers h
         WHERE h.kind = 'handover' AND h.counted_at >= ?1 AND h.counted_at > ?2
           AND NOT EXISTS (SELECT 1 FROM ledger_entries e WHERE e.source = 'handover' AND e.source_ref = h.id)
         ORDER BY h.counted_at, h.id`,
      )
      .bind(since, endOfDay(shiftDate(LEDGER_START, -1))),
  ]);
  const dates = (dayRows!.results as { date: string }[]).map((row) => row.date);
  const work = [...(await dayWork(db, dates, closed)), ...(handoverRows!.results as HandoverRow[]).map((row) => handoverWork(row, closed))];

  // Oldest first; on one date the day before its handover (the sort keeps that order).
  work.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const chosen = work.slice(0, maxItems);
  result.left = work.length - chosen.length;
  const openYear = chosen.some((item) => closed.has(yearOf(item.date))) ? await firstOpenYear(db) : 0;

  // An entry that does not balance is refused by the ledger, not mended here; the others are still written.
  let refused: unknown = null;
  const groups: { kind: Kind; statements: D1PreparedStatement[] }[] = [];
  for (const item of chosen) {
    try {
      groups.push({ kind: item.kind, statements: upsertSourcedStatements(db, item.entry(openYear), item.existing, now) });
    } catch (error) {
      if (!(error instanceof LedgerError)) throw error;
      refused ??= error;
      result.left++;
    }
  }
  for (let i = 0; i < groups.length; i += PER_BATCH) {
    const part = groups.slice(i, i + PER_BATCH);
    const outcomes = await db.batch(part.flatMap((group) => group.statements));
    let at = 0;
    for (const group of part) {
      const own = outcomes.slice(at, at + group.statements.length);
      at += group.statements.length;
      // The statements leave a year that was closed after the reads alone: nothing changed, so it is left over.
      if (own.some((outcome) => (outcome.meta.changes ?? 0) > 0)) result[group.kind]++;
      else result.left++;
    }
  }

  if (result.left === 0) {
    const newest = newestRows!.results[0] as { received: string | null; settled: string | null };
    const upTo = earlier(later(newest.received ?? "", newest.settled ?? ""), new Date(now.getTime() - MARGIN_MS).toISOString());
    if (upTo > synced) await setLedgerSettingStatement(db, MARKER, upTo, now).run();
  }
  if (refused) throw refused;
  return result;
}

/**
 * The days among `dates` whose entries differ from the kassa. In three queries for all of them: the paid sales
 * per method, their lines per income account, and the `kassa_day` and `kassa_late` entries already there.
 */
async function dayWork(db: D1Database, dates: string[], closed: Set<number>): Promise<Work[]> {
  if (dates.length === 0) return [];
  const list = JSON.stringify(dates);
  const [methodRows, lineRows, entryRows] = await db.batch([
    db
      .prepare(
        `SELECT business_date AS date, method, SUM(total_cents) AS cents FROM sales
         WHERE status = 'paid' AND business_date IN (SELECT value FROM json_each(?1)) GROUP BY business_date, method`,
      )
      .bind(list),
    db
      .prepare(
        `SELECT s.business_date AS date, COALESCE(a.account_code, '${KIOSK}') AS code, SUM(l.unit_price_cents * l.qty) AS cents
         FROM sale_lines l JOIN sales s ON s.id = l.sale_id LEFT JOIN category_accounts a ON a.category_id = l.category_id
         WHERE s.status = 'paid' AND s.business_date IN (SELECT value FROM json_each(?1))
         GROUP BY s.business_date, COALESCE(a.account_code, '${KIOSK}')`,
      )
      .bind(list),
    db
      .prepare(
        `SELECT e.id, e.source, e.source_ref AS date, e.year, l.account_code AS code, l.amount_cents AS cents
         FROM ledger_entries e LEFT JOIN ledger_lines l ON l.entry_id = e.id
         WHERE e.source IN ('kassa_day', 'kassa_late') AND e.source_ref IN (SELECT value FROM json_each(?1))`,
      )
      .bind(list),
  ]);

  // What the kassa says per date: debit 1000 cash and 1030 pin, credit each income account its lines.
  const kassa = new Map<string, Amounts>();
  const paid = new Set<string>();
  const of = (date: string) => kassa.get(date) ?? kassa.set(date, new Map()).get(date)!;
  for (const row of methodRows!.results as { date: string; method: "cash" | "pin"; cents: number }[]) {
    paid.add(row.date);
    add(of(row.date), row.method === "cash" ? KAS : MOLLIE, row.cents);
  }
  for (const row of lineRows!.results as { date: string; code: string; cents: number }[]) add(of(row.date), row.code, -row.cents);

  const booked = new Map<string, Booked>();
  for (const row of entryRows!.results as { id: string; source: EntrySource; date: string; year: number; code: string | null; cents: number | null }[]) {
    const key = `${row.source}:${row.date}`;
    const entry = booked.get(key) ?? booked.set(key, { id: row.id, year: row.year, amounts: new Map() }).get(key)!;
    if (row.code !== null) add(entry.amounts, row.code, row.cents!);
  }

  const work: Work[] = [];
  for (const date of dates) {
    const totals = kassa.get(date) ?? new Map<string, number>();
    const day = booked.get(`kassa_day:${date}`);
    const late = booked.get(`kassa_late:${date}`);
    if (!closed.has(yearOf(date))) {
      // The day follows the kassa. (A late entry exists only when the year was closed before; it keeps its part.)
      const want = minus(totals, late?.amounts);
      const differs = day ? !sameAmounts(day.amounts, want) : paid.has(date) || want.size > 0;
      if (differs) {
        work.push({
          kind: "days",
          date,
          existing: day ? { id: day.id } : null,
          entry: () => ({ date, description: `Kassa ${dayMonthYear(date)}`, source: "kassa_day", sourceRef: date, lines: toLines(want) }),
        });
      }
      continue;
    }
    // A closed year keeps its day as it is; what the kassa has more goes to the late entry of that date.
    const want = minus(totals, day?.amounts);
    const differs = late ? !sameAmounts(late.amounts, want) : want.size > 0;
    // A late entry that is itself in a closed year cannot change any more, and a date has only one.
    if (!differs || (late && closed.has(late.year))) continue;
    work.push({
      kind: "late",
      date,
      existing: late ? { id: late.id } : null,
      entry: (openYear) => ({
        date: `${openYear}-01-01`,
        description: `Nagekomen kassaverkoop ${dayMonthYear(date)}`,
        source: "kassa_late",
        sourceRef: date,
        lines: toLines(want),
      }),
    });
  }
  return work;
}

/** Credit 1000 what left the kluisje, debit 1080 what was received, and 4515 the difference (a shortage is a debit). */
function handoverWork(row: HandoverRow, closed: Set<number>): Work {
  const date = businessDate(row.counted_at);
  const note = row.note?.trim();
  const amounts: Amounts = new Map([
    [KAS, -(row.expected_cents - row.left_cents)],
    [KRUISPOSTEN, row.received_cents],
    [KASVERSCHILLEN, row.difference_cents],
  ]);
  return {
    kind: "handovers",
    date,
    existing: null,
    entry: (openYear) => ({
      date: closed.has(yearOf(date)) ? `${openYear}-01-01` : date,
      description: note ? `Afdracht kluisje – ${note}` : "Afdracht kluisje",
      source: "handover",
      sourceRef: row.id,
      lines: toLines(amounts),
    }),
  };
}
