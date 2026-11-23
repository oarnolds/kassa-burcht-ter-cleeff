// Mollie's payments on 1030. A payment of a kassa pin sale is in its kassa day already and is only ticked off here.
// The payments of the website and the QR code are booked per day by the penningmeester's rules, in one entry
// "Mollie overig {datum}"; one that fits no rule, and every refund or chargeback of such a payment, waits on 1030 in
// Te boeken. A day in a closed year stays as it is: what arrives for it later is booked on 1 January of the first
// open year. Mollie is read only through worker/lib/mollie-read.ts; nothing it says goes into a log line.

import type { CamtLine } from "../../shared/camt";
import { type AccountKind, LEDGER_START, type MollieRule } from "../../shared/ledger-types";
import { businessDate, shiftDate } from "../../shared/time";
import type { Env } from "../env";
import { type MollieChargebackRow, type MolliePaymentRow, mollieReadFor, type MollieRefundRow, type PaymentGap } from "../lib/mollie-read";
import { autoBook, importLines, recordBalance } from "./bank";
import { add, type Amounts, dayMonthYear, minus, sameAmounts, toLines } from "./kassa-ledger";
import { firstOpenYear, LedgerError, type NewEntry, upsertSourcedStatements } from "./ledger";
import { deleteLedgerSettingStatement, setLedgerSettingStatement } from "./ledger-settings";
import { endOfDay } from "./opening";

export type { MollieRule };

const MOLLIE = "1030";
const SOURCE = "mollie_other";
/** A run reads from this many days before the newest payment it has, to catch one Mollie lists late. */
const LOOK_BACK_DAYS = 3;
/** Days written per database call. */
const PER_BATCH = 20;
/** Days taken up per run (ten calls of PER_BATCH); a run stays within its database calls, the rest comes next. */
const MAX_DAYS = 200;
/** Payments per insert statement, so that its one JSON parameter stays well below D1's limit on the size of a value. */
const PER_INSERT = 500;
/** In `ledger_settings`: the stretch of payments a run cut short by the page cap left unread (JSON `PaymentGap`). */
const RESUME_KEY = "mollie_payments_resume";

type Kind = "kassa" | "rule" | "line";
type Paid = MolliePaymentRow & { paidAt: string; paidDate: string };
type Booked = { id: string; year: number; amounts: Amounts };
/** A day entry to write: its date, the entry already there, and its content once the first open year is known. */
type Work = { date: string; existing: { id: string } | null; entry: (openYear: number) => NewEntry & { sourceRef: string } };

const yearOf = (date: string) => Number(date.slice(0, 4));
/** The first moment of an Amsterdam day, as a UTC ISO string. */
const startOfDay = (date: string) => new Date(Date.parse(endOfDay(shiftDate(date, -1))) + 1).toISOString();
const byMoment = (a: { at: string; id: string }, b: { at: string; id: string }) =>
  Date.parse(a.at) - Date.parse(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** The note of a stretch left unread, or null without one. A note that cannot be read is refused, never dropped. */
function gapOf(value: string | undefined): PaymentGap | null {
  if (value === undefined) return null;
  let gap: Partial<PaymentGap> | null = null;
  try {
    gap = JSON.parse(value) as Partial<PaymentGap> | null;
  } catch {
    // falls through to the refusal
  }
  if (typeof gap?.from !== "string" || typeof gap.untilIso !== "string") throw new LedgerError("mollie_resume_unreadable", 409);
  return { from: gap.from, untilIso: gap.untilIso };
}
const kassaPayments = (db: D1Database, ids: string) =>
  db.prepare("SELECT mollie_payment_id AS id FROM sales WHERE mollie_payment_id IN (SELECT value FROM json_each(?1))").bind(ids);

/**
 * Nightly: Mollie's paid payments, refunds and chargebacks since a few days before the newest payment kept (or since
 * LEDGER_START), then Mollie's balance as that of 1030 at the end of yesterday. All three lists are read before
 * anything is stored, so a failure keeps nothing and the next run reads the same window. A failure of Mollie gives its
 * name ("unauthorized", "refused", "not_found", "unreachable"), a list of reversals cut short by the page cap
 * "mollie_list_cut_short", a refusal of the ledger its code.
 */
export async function syncMolliePayments(env: Env, now: Date): Promise<"ok" | "skipped" | string> {
  const client = mollieReadFor(env);
  if (!client) return "skipped";
  const failed = (code: string) => {
    console.error("mollie step failed", code);
    return code;
  };
  const db = env.DB;
  try {
    const [newestRows, noteRows, openRows] = await db.batch([
      db.prepare("SELECT MAX(paid_date) AS date FROM mollie_payments"),
      db.prepare("SELECT value FROM ledger_settings WHERE key = ?1").bind(RESUME_KEY),
      // The days of payments not yet booked (a run stopped half way), oldest first.
      db.prepare("SELECT DISTINCT paid_date AS date FROM mollie_payments WHERE booked = 0 ORDER BY paid_date LIMIT ?1").bind(MAX_DAYS),
    ]);
    const newest = (newestRows!.results[0] as { date: string | null } | undefined)?.date ?? null;
    const back = newest ? shiftDate(newest, -LOOK_BACK_DAYS) : LEDGER_START;
    const from = startOfDay(back < LEDGER_START ? LEDGER_START : back);
    // A stretch an earlier run left unread is read first; the newest follow once it is done.
    const kept = gapOf((noteRows!.results[0] as { value: string } | undefined)?.value);
    const open = (openRows!.results as { date: string }[]).map((row) => row.date);

    const payments = await client.paymentsSince(from, kept);
    if (!payments.ok) return failed(payments.failure);
    // A paid payment without a moment that can be read is not guessed at: the run fails as the reader does.
    if (payments.data.rows.some((row) => row.status === "paid" && row.paidAt !== null && Number.isNaN(Date.parse(row.paidAt)))) return failed("unreachable");
    const refunds = await client.refundsSince(from);
    if (!refunds.ok) return failed(refunds.failure);
    const chargebacks = await client.chargebacksSince(from);
    if (!chargebacks.ok) return failed(chargebacks.failure);
    // Reversals that do not reach back to `from` must not look complete: then nothing is kept.
    if (refunds.data.cutShort || chargebacks.data.cutShort) return failed("mollie_list_cut_short");

    // The reversals first: storing them leaves the window where it is, storing the payments moves it.
    await storeReversals(db, refunds.data.rows, chargebacks.data.rows, payments.data.rows, now);
    // The note goes with the payments it follows, in one batch: what is stored and what is still to read never part.
    const { gap } = payments.data;
    const note = gap ? setLedgerSettingStatement(db, RESUME_KEY, JSON.stringify(gap), now) : kept ? deleteLedgerSettingStatement(db, RESUME_KEY) : null;
    await storePayments(db, payments.data.rows, open, now, note);

    const balance = await client.primaryBalance();
    if (!balance.ok) return failed(balance.failure);
    const yesterday = shiftDate(businessDate(now.toISOString()), -1);
    await recordBalance(db, MOLLIE, { date: yesterday, cents: balance.data.availableCents + balance.data.pendingCents }, "mollie");
    await autoBook(db, now);
    return "ok";
  } catch (error) {
    if (error instanceof LedgerError) return failed(error.code);
    throw error;
  }
}

/**
 * Keeps each paid payment once, classified when it is first stored: `kassa` when it was paid at the terminal (only
 * the kassa uses it) or a sale of the kassa has it, else `rule` by the first rule whose keyword is in its
 * description, else `line`. Then, for every day the payments read fall on and every day in `open` (payments not yet
 * booked), at most MAX_DAYS oldest first: the day entry is made equal to the rule payments of that day, and the
 * `line` payments of those days are read onto 1030. A payment is marked booked in the same batch that books it; a
 * kassa payment at once. `note` is written with the payments.
 */
async function storePayments(db: D1Database, rows: MolliePaymentRow[], open: string[], now: Date, note: D1PreparedStatement | null): Promise<void> {
  const paid: Paid[] = rows
    .flatMap((row) => (row.status === "paid" && row.paidAt !== null ? [{ ...row, paidAt: row.paidAt, paidDate: businessDate(row.paidAt) }] : []))
    .filter((row) => row.paidDate >= LEDGER_START)
    .sort((a, b) => byMoment({ at: a.paidAt, id: a.id }, { at: b.paidAt, id: b.id }));
  if (paid.length === 0 && open.length === 0) {
    await note?.run();
    return;
  }
  // The rest of the days, past MAX_DAYS, keep their payments unbooked: the next run takes them up.
  const dateList = [...new Set([...paid.map((row) => row.paidDate), ...open])].sort().slice(0, MAX_DAYS);
  const dates = JSON.stringify(dateList);

  // A statement per 500 payments. A payment already kept keeps what it was classified as; only its payout is noted.
  const writes: D1PreparedStatement[] = [];
  if (paid.length > 0) {
    const ids = JSON.stringify(paid.map((row) => row.id));
    const [ruleRows, kassaRows] = await db.batch([db.prepare("SELECT keyword, account_code FROM mollie_rules ORDER BY sort, id"), kassaPayments(db, ids)]);
    const rules = (ruleRows!.results as { keyword: string; account_code: string }[]).map((rule) => ({ word: rule.keyword.toLowerCase(), code: rule.account_code }));
    const kassa = new Set((kassaRows!.results as { id: string }[]).map((row) => row.id));
    const classified = paid.map((row) => {
      let kind: Kind = "line";
      let account: string | null = null;
      if (row.method === "pointofsale" || kassa.has(row.id)) kind = "kassa";
      else {
        const text = row.description.toLowerCase();
        account = rules.find((rule) => text.includes(rule.word))?.code ?? null;
        if (account !== null) kind = "rule";
      }
      return { id: row.id, method: row.method, amount: row.amountCents, description: row.description, date: row.paidDate, settlement: row.settlementId, kind, account, booked: kind === "kassa" ? 1 : 0 };
    });
    for (let i = 0; i < classified.length; i += PER_INSERT) {
      writes.push(
        db
          .prepare(
            `INSERT INTO mollie_payments (id, method, amount_cents, description, paid_date, settlement_id, kind, account_code, booked)
             SELECT json_extract(value, '$.id'), json_extract(value, '$.method'), json_extract(value, '$.amount'), json_extract(value, '$.description'),
               json_extract(value, '$.date'), json_extract(value, '$.settlement'), json_extract(value, '$.kind'), json_extract(value, '$.account'),
               json_extract(value, '$.booked')
             FROM json_each(?1) WHERE true
             ON CONFLICT (id) DO UPDATE SET settlement_id = COALESCE(excluded.settlement_id, mollie_payments.settlement_id)`,
          )
          .bind(JSON.stringify(classified.slice(i, i + PER_INSERT))),
      );
    }
  }
  if (note) writes.push(note);
  const read = await db.batch([
    ...writes,
    db
      .prepare(`SELECT id, paid_date AS date, account_code AS code, amount_cents AS cents, booked FROM mollie_payments WHERE kind = 'rule' AND paid_date IN (SELECT value FROM json_each(?1))`)
      .bind(dates),
    db
      .prepare(
        `SELECT e.id, e.source_ref AS ref, e.year, l.account_code AS code, l.amount_cents AS cents
         FROM ledger_entries e LEFT JOIN ledger_lines l ON l.entry_id = e.id
         WHERE e.source = '${SOURCE}' AND e.source_ref IN (SELECT value FROM json_each(?1) UNION ALL SELECT 'late:' || value FROM json_each(?1))`,
      )
      .bind(dates),
    // Every `line` payment of those days, the ones read before first: a new line of a day is told from an equal
    // one already there by how many came before it (worker/db/bank.ts), so they go in together.
    db
      .prepare(
        `SELECT id, amount_cents, description, paid_date FROM mollie_payments
         WHERE kind = 'line' AND paid_date IN (SELECT value FROM json_each(?1)) ORDER BY paid_date, rowid`,
      )
      .bind(dates),
    db.prepare("SELECT year FROM ledger_years WHERE status = 'closed'"),
  ]);
  const [ruleRows, entryRows, lineRows, closedRows] = read.slice(writes.length);

  // What the rules say per day: debit 1030 the total, credit each account its part; and which of them wait.
  const totals = new Map<string, Amounts>();
  const waiting = new Map<string, string[]>();
  for (const row of ruleRows!.results as { id: string; date: string; code: string; cents: number; booked: number }[]) {
    const day = totals.get(row.date) ?? totals.set(row.date, new Map()).get(row.date)!;
    add(day, MOLLIE, row.cents);
    add(day, row.code, -row.cents);
    if (row.booked === 0) (waiting.get(row.date) ?? waiting.set(row.date, []).get(row.date)!).push(row.id);
  }
  const entries = new Map<string, Booked>();
  for (const row of entryRows!.results as { id: string; ref: string; year: number; code: string | null; cents: number | null }[]) {
    const entry = entries.get(row.ref) ?? entries.set(row.ref, { id: row.id, year: row.year, amounts: new Map() }).get(row.ref)!;
    if (row.code !== null) add(entry.amounts, row.code, row.cents!);
  }
  const closed = new Set((closedRows!.results as { year: number }[]).map((row) => row.year));
  const work = new Map(dayWork(dateList, totals, entries, closed).map((item) => [item.date, item]));

  // The lines, and in the same batch the note that their payments are booked (only where the line is really there).
  const lines: CamtLine[] = (lineRows!.results as { id: string; amount_cents: number; description: string; paid_date: string }[]).map((row) => ({
    bookingDate: row.paid_date,
    amountCents: row.amount_cents,
    description: row.description,
    counterpartyName: null,
    counterpartyIban: null,
    bankRef: row.id,
  }));
  if (lines.length > 0) {
    const linked = db
      .prepare(
        `UPDATE mollie_payments SET booked = 1, bank_line_id = (SELECT b.id FROM bank_lines b WHERE b.account_code = '${MOLLIE}' AND b.bank_ref = mollie_payments.id)
         WHERE kind = 'line' AND booked = 0 AND paid_date IN (SELECT value FROM json_each(?1))
           AND EXISTS (SELECT 1 FROM bank_lines b WHERE b.account_code = '${MOLLIE}' AND b.bank_ref = mollie_payments.id)`,
      )
      .bind(dates);
    await importLines(db, MOLLIE, lines, "mollie", now, [linked]);
  }

  // Per day its entry, if it differs, and the note that its rule payments are booked, in the same batch. When the
  // entry's year was closed in the meantime, the ledger writes nothing and the payments stay unbooked.
  const openYear = [...work.values()].some((item) => closed.has(yearOf(item.date))) ? await firstOpenYear(db) : 0;
  const perDay = dateList.map((date) => {
    const item = work.get(date);
    const entry = item?.entry(openYear);
    const statements = entry ? upsertSourcedStatements(db, entry, item!.existing, now) : [];
    const ids = waiting.get(date) ?? [];
    if (ids.length > 0) {
      statements.push(
        db
          .prepare(
            `UPDATE mollie_payments SET booked = 1 WHERE id IN (SELECT value FROM json_each(?1))
               AND (?2 IS NULL OR EXISTS (SELECT 1 FROM ledger_years WHERE year = ?2 AND status = 'open'))`,
          )
          .bind(JSON.stringify(ids), entry ? yearOf(entry.date) : null),
      );
    }
    return statements;
  });
  for (let i = 0; i < perDay.length; i += PER_BATCH) {
    const statements = perDay.slice(i, i + PER_BATCH).flat();
    if (statements.length > 0) await db.batch(statements);
  }
}

/**
 * The day entries among `dates` that differ from the rules' totals. A day in an open year follows its payments
 * (less a late entry made while its year was closed); a day in a closed year keeps its entry, and what the payments
 * have more goes to its late entry, dated 1 January of the first open year.
 */
function dayWork(dates: string[], totals: Map<string, Amounts>, booked: Map<string, Booked>, closed: Set<number>): Work[] {
  const work: Work[] = [];
  for (const date of dates) {
    const want = totals.get(date) ?? new Map<string, number>();
    const day = booked.get(date);
    const late = booked.get(`late:${date}`);
    if (!closed.has(yearOf(date))) {
      const lines = minus(want, late?.amounts);
      if (day ? sameAmounts(day.amounts, lines) : lines.size === 0) continue;
      work.push({
        date,
        existing: day ? { id: day.id } : null,
        entry: () => ({ date, description: `Mollie overig ${dayMonthYear(date)}`, source: SOURCE, sourceRef: date, lines: toLines(lines) }),
      });
      continue;
    }
    const more = minus(want, day?.amounts);
    // A late entry that is itself in a closed year cannot change any more, and a date has only one.
    if ((late ? sameAmounts(late.amounts, more) : more.size === 0) || (late && closed.has(late.year))) continue;
    work.push({
      date,
      existing: late ? { id: late.id } : null,
      entry: (openYear) => ({
        date: `${openYear}-01-01`,
        description: `Nagekomen Mollie overig ${dayMonthYear(date)}`,
        source: SOURCE,
        sourceRef: `late:${date}`,
        lines: toLines(more),
      }),
    });
  }
  return work;
}

/**
 * Refunds (not failed or called off) and chargebacks of a payment that is not the kassa's, each a line on 1030 with
 * the amount that left Mollie, on its Amsterdam day. One of a kassa payment (a sale has it, or it was paid at the
 * terminal) is left to the kassa's own reversal. `payments` are those read in the same run, not stored yet.
 */
async function storeReversals(
  db: D1Database,
  refunds: MollieRefundRow[],
  chargebacks: MollieChargebackRow[],
  payments: MolliePaymentRow[],
  now: Date,
): Promise<void> {
  const items = [
    ...refunds.filter((refund) => refund.status !== "failed" && refund.status !== "canceled").map((refund) => ({ ...refund, word: "Terugbetaling" })),
    ...chargebacks.map((chargeback) => ({ ...chargeback, word: "Terugboeking" })),
  ]
    .map((item) => ({ ...item, date: businessDate(item.createdAt) }))
    .filter((item) => item.date >= LEDGER_START)
    .sort((a, b) => byMoment({ at: a.createdAt, id: a.id }, { at: b.createdAt, id: b.id }));
  if (items.length === 0) return;
  const ids = JSON.stringify([...new Set(items.map((item) => item.paymentId))]);
  const [kassaRows, knownRows] = await db.batch([
    kassaPayments(db, ids),
    db.prepare("SELECT id, description, kind FROM mollie_payments WHERE id IN (SELECT value FROM json_each(?1))").bind(ids),
  ]);
  const known = knownRows!.results as { id: string; description: string; kind: Kind }[];
  // The kassa's own: a sale has the payment, or it was paid at the terminal (kept as such, or read in this run).
  const kassa = new Set([
    ...(kassaRows!.results as { id: string }[]).map((row) => row.id),
    ...known.filter((row) => row.kind === "kassa").map((row) => row.id),
    ...payments.filter((row) => row.method === "pointofsale").map((row) => row.id),
  ]);
  // What the payment was for: as kept, or as read in this run (the payments are stored after the reversals).
  const about = new Map([...known.map((row) => [row.id, row.description] as const), ...payments.map((row) => [row.id, row.description] as const)].map(([id, text]) => [id, text.trim()]));
  const lines: CamtLine[] = items
    .filter((item) => !kassa.has(item.paymentId))
    .map((item) => {
      const what = about.get(item.paymentId);
      return {
        bookingDate: item.date,
        amountCents: -Math.abs(item.amountCents),
        description: what ? `${item.word} Mollie: ${what}` : `${item.word} Mollie`,
        counterpartyName: null,
        counterpartyIban: null,
        bankRef: item.id,
      };
    });
  await importLines(db, MOLLIE, lines, "mollie", now);
}

// ---- The rules ----

export async function listRules(db: D1Database): Promise<MollieRule[]> {
  const { results } = await db.prepare("SELECT id, keyword, account_code FROM mollie_rules ORDER BY sort, id").all<{ id: string; keyword: string; account_code: string }>();
  return results.map((row) => ({ id: row.id, keyword: row.keyword, accountCode: row.account_code }));
}

/**
 * Adds a rule at the end, or changes one in place (it keeps its turn). Only an income account; the keyword is
 * trimmed and 2 to 40 characters. Payments already classified stay as they are.
 */
export async function saveRule(db: D1Database, rule: Omit<MollieRule, "id"> & { id?: string }): Promise<MollieRule> {
  const keyword = rule.keyword.trim();
  if (keyword.length < 2 || keyword.length > 40) throw new LedgerError("invalid", 400);
  const account = await db.prepare("SELECT kind FROM ledger_accounts WHERE code = ?").bind(rule.accountCode).first<{ kind: AccountKind }>();
  if (!account) throw new LedgerError("account_unknown", 400);
  if (account.kind !== "income") throw new LedgerError("not_income_account", 400);
  const saved = { keyword, accountCode: rule.accountCode };
  if (rule.id !== undefined) {
    const changed = await db.prepare("UPDATE mollie_rules SET keyword = ?2, account_code = ?3 WHERE id = ?1").bind(rule.id, keyword, rule.accountCode).run();
    if (!changed.meta.changes) throw new LedgerError("not_found", 404);
    return { id: rule.id, ...saved };
  }
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO mollie_rules (id, keyword, account_code, sort) SELECT ?1, ?2, ?3, COALESCE(MAX(sort), 0) + 1 FROM mollie_rules")
    .bind(id, keyword, rule.accountCode)
    .run();
  return { id, ...saved };
}

/** A rule is settings, not bookkeeping: it may go, and what it booked stays booked. Gone already is fine. */
export async function deleteRule(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM mollie_rules WHERE id = ?").bind(id).run();
}
