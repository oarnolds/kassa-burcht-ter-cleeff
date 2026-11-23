import { type EntryLine, LEDGER_START, type LedgerYear, type YearCheck, type YearExport } from "../../shared/ledger-types";
import { formatEuro } from "../../shared/money";
import { businessDate } from "../../shared/time";
import type { Env } from "../env";
import { planOf, planStatements, toAssets } from "./assets";
import { moneyAccountsFrom, moneyAccountsOnStatement, payoutsInTransitStatement } from "./bank";
import { dayMonthYear } from "./kassa-ledger";
import { LedgerError, upsertSourcedStatements } from "./ledger";
import { balanceReport, openingReport, resultReport } from "./ledger-reports";
import { endOfDay, expectedCashStatement } from "./opening";

// Closing a year (spec §13): the checks, then one entry on 31 December that brings every income and expense account
// back to zero and books the result to 1400, and the year locked. The balance accounts carry on by themselves: their
// balances add up over the years, so the next year's opening needs no entry. Reopening, with a reason, empties that
// entry again; only the newest closed year can be reopened.

export type { LedgerYear, YearCheck, YearExport };

const FIRST_YEAR = Number(LEDGER_START.slice(0, 4));
const CASH = "1000";
const MOLLIE = "1030";
const KRUISPOST = "1080";
const ASSET_COST = "0130";
const ASSET_WRITTEN_OFF = "0135";
const EQUITY = "1400";

const firstDay = (year: number) => `${year}-01-01`;
const lastDay = (year: number) => `${year}-12-31`;
const closingEntry = (year: number, lines: EntryLine[]) => ({
  date: lastDay(year),
  description: `Afsluiting ${year}`,
  source: "closing" as const,
  sourceRef: String(year),
  lines,
});

/** Where the depreciation plan's statements start in `checkStatements`. */
const PLAN_AT = 6;

/** Bank lines dated in the year (`?4` to `?5`) that still need booking. */
const OPEN_LINES = "SELECT 1 FROM bank_lines WHERE status IN ('open', 'waiting') AND booking_date >= ?4 AND booking_date <= ?5";

/**
 * What the checks read, for one batch: the lines to book, the money accounts against their bank's newest balance up
 * to 31 December, the ledger on 31 December for the accounts checked, the kluisje by the kassa, Mollie's balance of
 * that day and its payouts on their way to ING, and the year's depreciation plan (whose first statement is the list
 * of toestellen at the end of the year).
 */
function checkStatements(db: D1Database, year: number): D1PreparedStatement[] {
  const end = lastDay(year);
  return [
    db
      .prepare("SELECT COUNT(*) AS n FROM bank_lines WHERE status IN ('open', 'waiting') AND booking_date >= ?1 AND booking_date <= ?2")
      .bind(firstDay(year), end),
    moneyAccountsOnStatement(db, end),
    db
      .prepare(
        `SELECT l.account_code, SUM(l.amount_cents) AS cents FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
         WHERE e.date <= ?1 AND l.account_code IN (SELECT value FROM json_each(?2)) GROUP BY l.account_code`,
      )
      .bind(end, JSON.stringify([CASH, MOLLIE, KRUISPOST, ASSET_COST, ASSET_WRITTEN_OFF])),
    expectedCashStatement(db, endOfDay(end)),
    db.prepare("SELECT balance_cents FROM bank_balances WHERE account_code = ?1 AND date = ?2").bind(MOLLIE, end),
    payoutsInTransitStatement(db, end),
    ...planStatements(db, year),
  ];
}

const check = (key: YearCheck["key"], ok: boolean, detail: string, required = false): YearCheck => ({ key, ok, detail, required });

/** The checks, from what `checkStatements` read. */
function checksFrom(year: number, read: D1Result[]): YearCheck[] {
  const [lines, accounts, sums, cash, mollie, transit] = read;
  const plan = read.slice(PLAN_AT);
  const end = lastDay(year);
  const on = dayMonthYear(end);
  const ledger = new Map((sums!.results as { account_code: string; cents: number }[]).map((row) => [row.account_code, row.cents]));
  const at = (code: string) => ledger.get(code) ?? 0;

  const open = (lines!.results[0] as { n: number }).n;
  const bankLines = check(
    "bank_lines",
    open === 0,
    open === 0 ? `Alle bankregels van ${year} zijn geboekt` : `${open} ${open === 1 ? "bankregel" : "bankregels"} van ${year} nog te boeken`,
    true,
  );

  // 1030 has a check of its own, with Mollie's balance of that very day.
  const compared = moneyAccountsFrom(accounts!).filter((account) => account.accountCode !== MOLLIE && account.bank !== null);
  const differing = compared.filter((account) => account.differenceCents !== 0);
  const bankBalances = check(
    "bank_balances",
    differing.length === 0,
    compared.length === 0
      ? "Geen saldo van de bank om mee te vergelijken"
      : differing.length === 0
        ? "Alle saldo's van de bank kloppen"
        : differing
            .map((account) => `${account.name}: boekhouding ${formatEuro(account.ledgerCents)}, bank ${formatEuro(account.bank!.balanceCents)} op ${dayMonthYear(account.bank!.date)}`)
            .join("; "),
  );

  const kassa = (cash!.results[0] as { cents: number }).cents;
  const kas = check("cash", at(CASH) === kassa, `Kas ${formatEuro(at(CASH))}, volgens de kassa ${formatEuro(kassa)}`);

  const balance = (mollie!.results[0] as { balance_cents: number } | undefined)?.balance_cents;
  const onTheWay = (transit!.results[0] as { cents: number }).cents;
  const mollieCheck =
    balance === undefined
      ? check("mollie", false, "Geen saldo van Mollie op 31 december")
      : check(
          "mollie",
          at(MOLLIE) - onTheWay === balance,
          `Mollie: boekhouding ${formatEuro(at(MOLLIE))}${onTheWay === 0 ? "" : `, onderweg naar ING ${formatEuro(onTheWay)}`}, bij Mollie ${formatEuro(balance)} op ${on}`,
        );

  // Nothing to write off (no toestellen, or all written off) and nothing booked holds too.
  const depreciation = planOf(year, plan);
  const depreciationCheck = check(
    "depreciation",
    depreciation.upToDate && (depreciation.booked || depreciation.rows.length === 0),
    !depreciation.booked
      ? depreciation.rows.length === 0
        ? `Er valt in ${year} niets af te schrijven`
        : `Afschrijving ${year} is nog niet geboekt`
      : depreciation.upToDate
        ? `Afschrijving ${year} is geboekt`
        : `Afschrijving ${year} is geboekt, maar de bedragen zijn sindsdien veranderd`,
  );

  const kruispost = at(KRUISPOST);
  const inTransit = check("in_transit", kruispost === 0, kruispost === 0 ? "1080 Kruisposten staat op nul" : `1080 Kruisposten staat op ${formatEuro(kruispost)} op ${on}`);

  // R33: a toestel that went on or before 31 December is off the books, so only those still in use count. 0135 as
  // the balance shows it: what is written off, negative.
  const inUse = toAssets(plan[0]!, end).filter((asset) => asset.disposedOn === null || asset.disposedOn > end);
  const costCents = inUse.reduce((sum, asset) => sum + asset.costCents, 0);
  const writtenOffCents = 0 - inUse.reduce((sum, asset) => sum + asset.writtenOffCents, 0);
  const assets = check(
    "assets",
    at(ASSET_COST) === costCents && at(ASSET_WRITTEN_OFF) === writtenOffCents,
    `0130 ${formatEuro(at(ASSET_COST))} en 0135 ${formatEuro(at(ASSET_WRITTEN_OFF))}, volgens de lijst toestellen ${formatEuro(costCents)} en ${formatEuro(writtenOffCents)}`,
  );

  return [bankLines, bankBalances, kas, mollieCheck, depreciationCheck, inTransit, assets];
}

/** The checks of a year (spec §13), in one call to the database. Also for a year that is open still, or closed. */
export async function yearChecks(env: Env, year: number, _now: Date): Promise<YearCheck[]> {
  if (year < FIRST_YEAR) throw new LedgerError("year_unknown", 400);
  return checksFrom(year, await env.DB.batch(checkStatements(env.DB, year)));
}

/** The status of a year, for a batch. */
const statusStatement = (db: D1Database, year: number) => db.prepare("SELECT status FROM ledger_years WHERE year = ?").bind(year);
const statusOf = (result: D1Result | undefined) => (result!.results[0] as { status: "open" | "closed" } | undefined)?.status ?? null;
const closingIdStatement = (db: D1Database, year: number) =>
  db.prepare("SELECT id FROM ledger_entries WHERE source = 'closing' AND source_ref = ?").bind(String(year));
const idOf = (result: D1Result | undefined) => (result!.results[0] as { id: string } | undefined)?.id ?? null;

/** Years from the first one (`?6`) up to the year before (`?1`) that are open: those are closed first (R34). */
const EARLIER_OPEN = "SELECT year FROM ledger_years WHERE status = 'open' AND year >= ?6 AND year < ?1";

/**
 * The year no longer closes when, between the reads and the write, a bank line of the year came in, something was
 * booked on an income or expense account in it (the closing entry would not bring that account to zero), or a year
 * before it was reopened. The event statement then gives its `kind` no value, which the database refuses, and so
 * the whole batch is undone.
 */
const CHANGED_SINCE_READ = `(EXISTS (${OPEN_LINES}) OR EXISTS (${EARLIER_OPEN}) OR EXISTS (
    SELECT 1 FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id JOIN ledger_accounts a ON a.code = l.account_code
    WHERE e.year = ?1 AND a.kind IN ('income', 'expense') GROUP BY l.account_code HAVING SUM(l.amount_cents) <> 0))`;

/**
 * "Jaar afsluiten": from 1 January of the next year (Amsterdam), once every year before it is closed (R34), when the
 * required check holds, and with a toelichting when another one fails. In one batch: the closing entry (written while the year is still open), the
 * year closed, the next year open when it has no row yet, and the event. Two calls to the database.
 */
export async function closeYear(env: Env, year: number, note: string | null, now: Date): Promise<void> {
  if (year < FIRST_YEAR) throw new LedgerError("year_unknown", 400);
  const db = env.DB;
  const [status, earlier, sums, existing, ...read] = await db.batch([
    statusStatement(db, year),
    db.prepare("SELECT MIN(year) AS year FROM ledger_years WHERE status = 'open' AND year >= ?1 AND year < ?2").bind(FIRST_YEAR, year),
    // Per income and expense account its sum for the year, the closing entry left out, in the order of the accounts.
    db
      .prepare(
        `SELECT l.account_code, SUM(l.amount_cents) AS cents FROM ledger_lines l
         JOIN ledger_entries e ON e.id = l.entry_id JOIN ledger_accounts a ON a.code = l.account_code
         WHERE e.year = ?1 AND e.source <> 'closing' AND a.kind IN ('income', 'expense')
         GROUP BY l.account_code, a.sort ORDER BY a.sort`,
      )
      .bind(year),
    closingIdStatement(db, year),
    ...checkStatements(db, year),
  ]);
  const current = statusOf(status);
  if (current === null) throw new LedgerError("year_unknown", 400);
  if (current === "closed") throw new LedgerError("year_closed", 409);
  if ((earlier!.results[0] as { year: number | null }).year !== null) throw new LedgerError("earlier_year_open", 409);
  if (businessDate(now.toISOString()) < firstDay(year + 1)) throw new LedgerError("year_not_ended", 409);
  const checks = checksFrom(year, read);
  if (checks.some((one) => one.required && !one.ok)) throw new LedgerError("checks_failed", 409);
  const toelichting = note?.trim() || null;
  if (toelichting === null && checks.some((one) => !one.ok)) throw new LedgerError("note_required", 400);

  // Each account minus its sum, so it ends the year at zero; 1400 takes the result (a profit is a credit).
  const lines: EntryLine[] = [];
  let toEquity = 0;
  for (const row of sums!.results as { account_code: string; cents: number }[]) {
    if (row.cents === 0) continue;
    lines.push({ accountCode: row.account_code, amountCents: 0 - row.cents, note: null, assetId: null });
    toEquity += row.cents;
  }
  if (toEquity !== 0) lines.push({ accountCode: EQUITY, amountCents: toEquity, note: null, assetId: null });

  const nowIso = now.toISOString();
  const closingId = idOf(existing);
  let written: D1Result[];
  try {
    written = await db.batch([
      ...upsertSourcedStatements(db, closingEntry(year, lines), closingId === null ? null : { id: closingId }, now),
      db.prepare("UPDATE ledger_years SET status = 'closed', closed_at = ?2, close_note = ?3 WHERE year = ?1 AND status = 'open'").bind(year, nowIso, toelichting),
      db.prepare("INSERT OR IGNORE INTO ledger_years (year, status) VALUES (?, 'open')").bind(year + 1),
      // Only when this batch closed the year; see CHANGED_SINCE_READ.
      db
        .prepare(
          `INSERT INTO ledger_year_events (year, at, kind, note)
           SELECT ?1, ?2, CASE WHEN ${CHANGED_SINCE_READ} THEN NULL ELSE 'closed' END, ?3
           WHERE EXISTS (SELECT 1 FROM ledger_years WHERE year = ?1 AND status = 'closed' AND closed_at = ?2)`,
        )
        .bind(year, nowIso, toelichting, firstDay(year), lastDay(year), FIRST_YEAR),
    ]);
  } catch (error) {
    if (/NOT NULL constraint failed: ledger_year_events\.kind/.test(String(error))) throw new LedgerError("year_changed", 409);
    throw error;
  }
  // Closed by another request between the reads and the write: that one's entry and event stand.
  if ((written.at(-1)!.meta.changes ?? 0) === 0) throw new LedgerError("year_closed", 409);
}

/**
 * "Heropenen", with a reason of at least 3 characters: only the newest closed year. In one batch: the event, the
 * year open again (its closing date and toelichting cleared), and the closing entry emptied through the sync path,
 * so it keeps its number and history. Two calls to the database.
 */
export async function reopenYear(db: D1Database, year: number, reason: string, now: Date): Promise<void> {
  const why = reason.trim();
  if (why.length < 3) throw new LedgerError("reason_required", 400);
  const [status, newest, existing] = await db.batch([
    statusStatement(db, year),
    db.prepare("SELECT MAX(year) AS year FROM ledger_years WHERE status = 'closed'"),
    closingIdStatement(db, year),
  ]);
  if (statusOf(status) !== "closed") throw new LedgerError("not_closed", 409);
  if ((newest!.results[0] as { year: number | null }).year !== year) throw new LedgerError("not_newest", 409);

  const reopenable = "NOT EXISTS (SELECT 1 FROM ledger_years later WHERE later.year > ?1 AND later.status = 'closed')";
  const closingId = idOf(existing);
  const written = await db.batch([
    db
      .prepare(
        `INSERT INTO ledger_year_events (year, at, kind, note) SELECT ?1, ?2, 'reopened', ?3
         WHERE EXISTS (SELECT 1 FROM ledger_years WHERE year = ?1 AND status = 'closed') AND ${reopenable}`,
      )
      .bind(year, now.toISOString(), why),
    db.prepare(`UPDATE ledger_years SET status = 'open', closed_at = NULL, close_note = NULL WHERE year = ?1 AND status = 'closed' AND ${reopenable}`).bind(year),
    // After the year is open again: the ledger writes only into an open year.
    ...(closingId === null ? [] : upsertSourcedStatements(db, closingEntry(year, []), { id: closingId }, now)),
  ]);
  // Reopened by another request in the meantime.
  if ((written[0]!.meta.changes ?? 0) === 0) throw new LedgerError("not_closed", 409);
}

type YearRow = { year: number; status: "open" | "closed"; closed_at: string | null; close_note: string | null };
type EventRow = { year: number; at: string; kind: "closed" | "reopened"; note: string | null };

/** Every year of the books, oldest first, with its closing and reopening. One call. */
export async function listYears(db: D1Database): Promise<LedgerYear[]> {
  const [years, events] = await db.batch([
    db.prepare("SELECT year, status, closed_at, close_note FROM ledger_years ORDER BY year"),
    db.prepare("SELECT year, at, kind, note FROM ledger_year_events ORDER BY id"),
  ]);
  const eventRows = events!.results as EventRow[];
  return (years!.results as YearRow[]).map((row) => ({
    year: row.year,
    status: row.status,
    closedAt: row.closed_at,
    closeNote: row.close_note,
    events: eventRows.filter((event) => event.year === row.year).map((event) => ({ at: event.at, kind: event.kind, note: event.note })),
  }));
}

/**
 * What the jaaroverzicht reads in one go (spec §13, R35), for an open year too: the balance at the start (`openingReport`)
 * and on 31 December, the result next to the year before, the checks, the closing and reopening, the toestellen on
 * 31 December with the year's depreciation, how many entries there are, and the accounts. The entries and their
 * changes come in pages (`entriesPage`, `changesPage`). Eight calls to the database, side by side.
 */
export async function yearExport(env: Env, year: number, _now: Date): Promise<YearExport> {
  if (year < FIRST_YEAR) throw new LedgerError("year_unknown", 400);
  const db = env.DB;
  const [[status, events, count, accounts, ...read], opening, closing, result] = await Promise.all([
    db.batch([
      statusStatement(db, year),
      db.prepare("SELECT at, kind, note FROM ledger_year_events WHERE year = ? ORDER BY id").bind(year),
      db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE year = ?").bind(year),
      db.prepare("SELECT code, name, kind FROM ledger_accounts ORDER BY sort"),
      ...checkStatements(db, year),
    ]),
    openingReport(db, year),
    balanceReport(db, lastDay(year)),
    resultReport(db, firstDay(year), lastDay(year)),
  ]);
  const current = statusOf(status);
  if (current === null) throw new LedgerError("year_unknown", 400);
  // The plan's first statement is the list of toestellen at the end of the year, as `listAssets` gives it.
  const plan = read.slice(PLAN_AT);
  return {
    year,
    status: current,
    opening,
    closing,
    result,
    checks: checksFrom(year, read),
    events: events!.results as YearExport["events"],
    assets: toAssets(plan[0]!, lastDay(year)),
    depreciation: planOf(year, plan),
    entryCount: (count!.results[0] as { n: number }).n,
    accounts: accounts!.results as YearExport["accounts"],
  };
}
