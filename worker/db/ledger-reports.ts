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
import { moneyAccounts } from "./bank";
import { consentState } from "./bank-consent";
import { endOfDay, expectedCashAt } from "./opening";

export type { AccountLines, BalanceReport, LedgerOverview, ResultReport };

const firstYear = Number(LEDGER_START.slice(0, 4));
const isResult = (kind: AccountKind) => kind === "income" || kind === "expense";

/** Per account the sum of the lines dated from `from` to `to`; the closing entries are left out when `withoutClosing`. */
async function sums(db: D1Database, from: string, to: string, withoutClosing: boolean): Promise<Map<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT l.account_code, SUM(l.amount_cents) AS cents FROM ledger_lines l
       WHERE l.entry_id IN (SELECT e.id FROM ledger_entries e WHERE e.date >= ?1 AND e.date <= ?2 AND (?3 = 0 OR e.source <> 'closing'))
       GROUP BY l.account_code`,
    )
    .bind(from, to, withoutClosing ? 1 : 0)
    .all<{ account_code: string; cents: number }>();
  return new Map(results.map((row) => [row.account_code, row.cents]));
}

type AccountRow = { code: string; name: string; kind: AccountKind };
const allAccounts = async (db: D1Database): Promise<AccountRow[]> =>
  (await db.prepare("SELECT code, name, kind FROM ledger_accounts ORDER BY sort").all<AccountRow>()).results;

/** Income and costs are shown positive: a credit on income and a debit on costs. */
const shown = (kind: AccountKind, cents: number) => (kind === "income" ? 0 - cents : cents);

/** The balance on `date`: what every balance account holds, and the result of the lines up to then, still unbooked. */
export async function balanceReport(db: D1Database, date: string): Promise<BalanceReport> {
  const [accounts, sum] = await Promise.all([allAccounts(db), sums(db, "0000-01-01", date, false)]);
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
    sums(db, from, to, true),
    fromLedger ? sums(db, previousFrom, previousTo, true) : Promise.resolve(null),
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
  for (const [code, cents] of await sums(db, from, to, true)) {
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

/** The stored report of the last nightly run; null when it never ran or the value cannot be read. */
function parseNightly(value: string | null): NightlyReport | null {
  if (value === null) return null;
  try {
    return JSON.parse(value) as NightlyReport;
  } catch {
    return null;
  }
}

/** What beheer's first page shows. `mollieDifferenceCents` is 1030 against Mollie's balance (null without one). */
export async function overview(db: D1Database, now: Date): Promise<LedgerOverview> {
  const today = businessDate(now.toISOString());
  const yesterday = shiftDate(today, -1);
  const year = Number(today.slice(0, 4));
  const [counts, accounts, resultYearCents, cashDifferenceCents, lastNightly, consent] = await Promise.all([
    db
      .prepare(`SELECT status, COUNT(*) AS n FROM bank_lines WHERE status IN ('open','waiting') GROUP BY status`)
      .all<{ status: string; n: number }>(),
    moneyAccounts(db, now),
    year < firstYear ? Promise.resolve(0) : resultOf(db, `${year}-01-01`, today),
    cashDifference(db, yesterday),
    getLedgerSetting(db, "ledger_nightly_last"),
    consentState(db, now),
  ]);
  const count = (status: string) => counts.results.find((row) => row.status === status)?.n ?? 0;
  return {
    openLines: count("open"),
    waitingLines: count("waiting"),
    moneyAccounts: accounts,
    resultYearCents,
    cashDifferenceCents,
    consent: consent.status === "active" || consent.status === "expired" ? { validUntil: consent.validUntil!, daysLeft: consent.daysLeft! } : null,
    mollieDifferenceCents: accounts.find((account) => account.accountCode === "1030")?.differenceCents ?? null,
    lastNightly: parseNightly(lastNightly),
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
