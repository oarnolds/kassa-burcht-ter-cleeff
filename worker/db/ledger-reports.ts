import {
  type AccountKind,
  type AccountLines,
  type BalanceReport,
  LEDGER_START,
  type LedgerOverview,
  type NightlyReport,
  type ResultReport,
} from "../../shared/ledger-types";
import { businessDate, shiftDate } from "../../shared/time";
import { LedgerError } from "./ledger";
import { getLedgerSetting } from "./ledger-settings";
import { moneyAccountsWithTransit } from "./bank";
import { consentState } from "./bank-consent";
import { inUseSince } from "./maintenance";
import { endOfDay, expectedCashAt } from "./opening";

export type { AccountLines, BalanceReport, LedgerOverview, ResultReport };

const firstYear = Number(LEDGER_START.slice(0, 4));
const isResult = (kind: AccountKind) => kind === "income" || kind === "expense";

/**
 * Which closing entries a sum counts: none (a result stays as it was before its year was closed), or those dated
 * before `to` (a balance on 31 December shows that year's result apart, R8).
 */
type Closing = "none" | "before_to";

/** Per account the sum of the lines dated from `from` to `to`, with the closing entries `closing` names. */
async function sums(db: D1Database, from: string, to: string, closing: Closing): Promise<Map<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT l.account_code, SUM(l.amount_cents) AS cents FROM ledger_lines l
       WHERE l.entry_id IN (SELECT e.id FROM ledger_entries e WHERE e.date >= ?1 AND e.date <= ?2
         AND (e.source <> 'closing' OR (?3 = 1 AND e.date < ?2)))
       GROUP BY l.account_code`,
    )
    .bind(from, to, closing === "before_to" ? 1 : 0)
    .all<{ account_code: string; cents: number }>();
  return new Map(results.map((row) => [row.account_code, row.cents]));
}

type AccountRow = { code: string; name: string; kind: AccountKind };
const allAccounts = async (db: D1Database): Promise<AccountRow[]> =>
  (await db.prepare("SELECT code, name, kind FROM ledger_accounts ORDER BY sort").all<AccountRow>()).results;

/** Income and costs are shown positive: a credit on income and a debit on costs. */
const shown = (kind: AccountKind, cents: number) => (kind === "income" ? 0 - cents : cents);

/**
 * The balance on `date`: what every balance account holds, and the result of the lines up to then, still unbooked.
 * A closing entry dated on `date` itself is left out (R8): on 31 December the year's result stands apart, on
 * 1 January it is in 1400.
 */
export async function balanceReport(db: D1Database, date: string): Promise<BalanceReport> {
  const [accounts, sum] = await Promise.all([allAccounts(db), sums(db, "0000-01-01", date, "before_to")]);
  return balanceOf(date, accounts, sum);
}

/**
 * The balance at the start of `year` for the jaaroverzicht (R35): every entry dated before 1 January, the closing
 * entries of the years before included, and the year's own opening entry; not what else is dated on 1 January.
 */
export async function openingReport(db: D1Database, year: number): Promise<BalanceReport> {
  const date = `${year}-01-01`;
  const [accounts, { results }] = await Promise.all([
    allAccounts(db),
    db
      .prepare(
        `SELECT l.account_code, SUM(l.amount_cents) AS cents FROM ledger_lines l
         WHERE l.entry_id IN (SELECT e.id FROM ledger_entries e WHERE e.date < ?1 OR (e.source = 'opening' AND e.source_ref = ?2))
         GROUP BY l.account_code`,
      )
      .bind(date, String(year))
      .all<{ account_code: string; cents: number }>(),
  ]);
  return balanceOf(date, accounts, new Map(results.map((row) => [row.account_code, row.cents])));
}

/** A balance from the sum per account of the lines it counts. */
function balanceOf(date: string, accounts: AccountRow[], sum: Map<string, number>): BalanceReport {
  const rows: BalanceReport["rows"] = [];
  let assetsCents = 0;
  let liabilitiesAndEquityCents = 0;
  let linesOfResult = 0;
  for (const account of accounts) {
    const cents = sum.get(account.code) ?? 0;
    if (isResult(account.kind)) {
      linesOfResult += cents;
      continue;
    }
    if (cents === 0) continue;
    // Assets show their debit balance (so 0135 comes out negative); liabilities and equity their credit balance.
    const value = account.kind === "asset" ? cents : 0 - cents;
    rows.push({ code: account.code, name: account.name, kind: account.kind, cents: value });
    if (account.kind === "asset") assetsCents += value;
    else liabilitiesAndEquityCents += value;
  }
  return { date, rows, assetsCents, liabilitiesAndEquityCents, resultCents: 0 - linesOfResult };
}

/** A date a year earlier; 29 February becomes 28 February. */
function yearBefore(date: string): string {
  const [year, month, day] = date.split("-");
  const previous = `${Number(year) - 1}-${month}-${day}`;
  return month === "02" && day === "29" ? `${Number(year) - 1}-02-28` : previous;
}

export async function getComparison(db: D1Database, year: number): Promise<{ accountCode: string; amountCents: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT c.account_code, c.amount_cents FROM comparison_figures c JOIN ledger_accounts a ON a.code = c.account_code
       WHERE c.year = ? ORDER BY a.sort`,
    )
    .bind(year)
    .all<{ account_code: string; amount_cents: number }>();
  return results.map((row) => ({ accountCode: row.account_code, amountCents: row.amount_cents }));
}

/**
 * The result from `from` to `to`, closing entries left out, next to the same period a year earlier: from the
 * ledger, or (before the ledger starts, for a whole calendar year) from the typed comparison figures.
 */
export async function resultReport(db: D1Database, from: string, to: string): Promise<ResultReport> {
  const previousFrom = yearBefore(from);
  const previousTo = yearBefore(to);
  const fromLedger = previousFrom >= LEDGER_START;
  const previousYear = Number(previousFrom.slice(0, 4));
  const wholeYear = previousFrom === `${previousYear}-01-01` && previousTo === `${previousYear}-12-31`;
  const [accounts, current, earlier, figures] = await Promise.all([
    allAccounts(db),
    sums(db, from, to, "none"),
    fromLedger ? sums(db, previousFrom, previousTo, "none") : Promise.resolve(null),
    !fromLedger && wholeYear ? getComparison(db, previousYear) : Promise.resolve([]),
  ]);
  const hasPrevious = fromLedger || figures.length > 0;
  const typed = new Map(figures.map((figure) => [figure.accountCode, figure.amountCents]));
  const rows: ResultReport["rows"] = [];
  let resultCents = 0;
  let previousResultCents = 0;
  for (const account of accounts) {
    if (account.kind !== "income" && account.kind !== "expense") continue;
    const cents = shown(account.kind, current.get(account.code) ?? 0);
    const previous = earlier ? shown(account.kind, earlier.get(account.code) ?? 0) : (typed.get(account.code) ?? 0);
    const sign = account.kind === "income" ? 1 : -1;
    resultCents += sign * cents;
    previousResultCents += sign * previous;
    if (cents === 0 && previous === 0) continue;
    rows.push({ code: account.code, name: account.name, kind: account.kind, cents, previousCents: hasPrevious ? previous : null });
  }
  return { from, to, rows, resultCents, previousResultCents: hasPrevious ? previousResultCents : null };
}

/** The result from `from` to `to` as one figure, closing entries left out. */
async function resultOf(db: D1Database, from: string, to: string): Promise<number> {
  const kinds = new Map((await allAccounts(db)).map((account) => [account.code, account.kind]));
  let result = 0;
  for (const [code, cents] of await sums(db, from, to, "none")) {
    const kind = kinds.get(code);
    if (kind && isResult(kind)) result -= cents;
  }
  return result;
}

/** Every line on an account from `from` to `to` with a running balance, starting from what it held before `from`. */
export async function accountLines(db: D1Database, code: string, from: string, to: string): Promise<AccountLines> {
  const [opening, lines] = await db.batch([
    db
      .prepare(
        `SELECT COALESCE(SUM(l.amount_cents), 0) AS cents, (SELECT COUNT(*) FROM ledger_accounts WHERE code = ?1) AS known
         FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id WHERE l.account_code = ?1 AND e.date < ?2`,
      )
      .bind(code, from),
    db
      .prepare(
        `SELECT e.id, e.number, e.date, e.description, l.amount_cents FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
         WHERE l.account_code = ?1 AND e.date >= ?2 AND e.date <= ?3 ORDER BY e.date, e.year, e.number, l.id`,
      )
      .bind(code, from, to),
  ]);
  const head = opening!.results[0] as { cents: number; known: number };
  if (head.known === 0) throw new LedgerError("not_found", 404);
  let running = head.cents;
  return {
    code,
    openingCents: head.cents,
    lines: (lines!.results as { id: string; number: number; date: string; description: string; amount_cents: number }[]).map((row) => {
      running += row.amount_cents;
      return { entryId: row.id, number: row.number, date: row.date, description: row.description, amountCents: row.amount_cents, runningCents: running };
    }),
  };
}

/** Replaces the typed figures of a year before the ledger starts. Typed as the result report shows them. */
export async function setComparison(db: D1Database, year: number, figures: { accountCode: string; amountCents: number }[]): Promise<void> {
  if (year >= firstYear) throw new LedgerError("not_comparison_year", 400);
  const kinds = new Map(
    (await db.prepare("SELECT code, kind FROM ledger_accounts").all<{ code: string; kind: AccountKind }>()).results.map((row) => [row.code, row.kind]),
  );
  const typed = new Map<string, number>();
  for (const figure of figures) {
    const kind = kinds.get(figure.accountCode);
    if (!kind) throw new LedgerError("account_unknown", 400);
    if (!isResult(kind)) throw new LedgerError("not_result_account", 400);
    if (!Number.isSafeInteger(figure.amountCents)) throw new LedgerError("amount_invalid", 400);
    typed.set(figure.accountCode, figure.amountCents);
  }
  await db.batch([
    db.prepare("DELETE FROM comparison_figures WHERE year = ?").bind(year),
    ...[...typed].map(([code, cents]) =>
      db.prepare("INSERT INTO comparison_figures (year, account_code, amount_cents) VALUES (?, ?, ?)").bind(year, code, cents),
    ),
  ]);
}

/** The nightly run is every night: more than this since the last one (or since the kassa went into use) means it stopped. */
const STALE_MS = 36 * 3_600_000;

/** The stored report of the last nightly run; null when it never ran or the value cannot be read. */
function parseNightly(value: string | null): NightlyReport | null {
  if (value === null) return null;
  try {
    return JSON.parse(value) as NightlyReport;
  } catch {
    return null;
  }
}

/**
 * What beheer's first page shows. `mollieDifferenceCents` is 1030 against Mollie's balance (null without one), the
 * payouts on their way to ING (`mollieInTransitCents`) left out.
 */
export async function overview(db: D1Database, now: Date): Promise<LedgerOverview> {
  const today = businessDate(now.toISOString());
  const yesterday = shiftDate(today, -1);
  const year = Number(today.slice(0, 4));
  const [counts, accounts, resultYearCents, cashDifferenceCents, lastNightly, consent, inUse] = await Promise.all([
    // Per account and status; `in_difference`: dated up to the bank's newest balance of that account.
    db
      .prepare(
        `SELECT b.account_code, b.status, COUNT(*) AS n,
           SUM(b.booking_date <= COALESCE((SELECT MAX(x.date) FROM bank_balances x WHERE x.account_code = b.account_code), '')) AS in_difference
         FROM bank_lines b WHERE b.status IN ('open','waiting') GROUP BY b.account_code, b.status`,
      )
      .all<{ account_code: string; status: string; n: number; in_difference: number }>(),
    moneyAccountsWithTransit(db, now),
    year < firstYear ? Promise.resolve(0) : resultOf(db, `${year}-01-01`, today),
    cashDifference(db, yesterday),
    getLedgerSetting(db, "ledger_nightly_last"),
    consentState(db, now),
    inUseSince(db),
  ]);
  const count = (status: string) => counts.results.reduce((sum, row) => sum + (row.status === status ? row.n : 0), 0);
  const toBookByAccount: Record<string, number> = {};
  for (const row of counts.results) {
    if (row.in_difference > 0) toBookByAccount[row.account_code] = (toBookByAccount[row.account_code] ?? 0) + row.in_difference;
  }
  const report = parseNightly(lastNightly);
  const since = report?.at ?? inUse;
  return {
    openLines: count("open"),
    waitingLines: count("waiting"),
    moneyAccounts: accounts.accounts,
    resultYearCents,
    cashDifferenceCents,
    consent: consent.status === "active" || consent.status === "expired" ? { validUntil: consent.validUntil!, daysLeft: consent.daysLeft! } : null,
    mollieDifferenceCents: accounts.accounts.find((account) => account.accountCode === "1030")?.differenceCents ?? null,
    mollieInTransitCents: accounts.inTransitCents,
    lastNightly: report,
    notUpdatedSince: since !== null && now.getTime() - Date.parse(since) > STALE_MS ? since : null,
    toBookByAccount,
  };
}

/** The kluisje in the ledger up to the end of `day` minus what the kassa says belonged in it; 0 before the ledger starts. */
async function cashDifference(db: D1Database, day: string): Promise<number> {
  if (day < LEDGER_START) return 0;
  const [row, expected] = await Promise.all([
    db
      .prepare(
        `SELECT COALESCE(SUM(l.amount_cents), 0) AS cents FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
         WHERE l.account_code = '1000' AND e.date <= ?`,
      )
      .bind(day)
      .first<{ cents: number }>(),
    expectedCashAt(db, endOfDay(day)),
  ]);
  return row!.cents - expected;
}
