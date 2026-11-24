import { type Budget, type BudgetActuals, type BudgetLine, type BudgetRule, type BudgetSource, budgetYears, readRule, spread, withinLimit } from "../../shared/budget";
import { type AccountKind, LEDGER_START } from "../../shared/ledger-types";
import { businessDate } from "../../shared/time";
import { LedgerError } from "./ledger";

// The begroting (budget): per year and per income or expense account a rule, and the twelve months it gives. Only
// beheer reads it; it never changes a booking. Every refusal is a LedgerError with status 400, thrown before anything
// is written.

export type { Budget, BudgetActuals, BudgetLine, BudgetSource };

/** A line as it comes in: the rule as sent (it is read here), and the base of the source or null. */
export type NewBudgetLine = { accountCode: string; rule: unknown; base: number[] | null };

const FIRST_YEAR = Number(LEDGER_START.slice(0, 4));

const refuse = (code: string): never => {
  throw new LedgerError(code, 400);
};

/** A year a budget may be made for on `now`, or refused. */
function budgetYear(year: number, now: Date): void {
  if (!budgetYears(businessDate(now.toISOString())).includes(year)) refuse("not_budget_year");
}

/**
 * A source that fits the year, or refused ("invalid_source"): an empty start has no year and no dates; a proposal
 * has both dates in its own year, the first not after the last, and that year is before the budget's.
 */
function checkSource({ kind, baseYear, from, to }: BudgetSource, year: number): void {
  if (kind === "empty") {
    if (baseYear !== null || from !== null || to !== null) refuse("invalid_source");
    return;
  }
  if (baseYear === null || from === null || to === null) return refuse("invalid_source");
  const own = String(baseYear);
  if (from > to || from.slice(0, 4) !== own || to.slice(0, 4) !== own || baseYear >= year) refuse("invalid_source");
}

type LineRow = { account_code: string; rule: string; base: string | null; months: string };
type SourceRow = { kind: BudgetSource["kind"]; base_year: number | null; base_from: string | null; base_to: string | null };

const lineOf = (row: LineRow): BudgetLine => ({
  accountCode: row.account_code,
  rule: JSON.parse(row.rule) as BudgetRule,
  base: row.base === null ? null : (JSON.parse(row.base) as number[]),
  months: JSON.parse(row.months) as number[],
});
const sourceOf = (row: SourceRow | undefined): BudgetSource | null =>
  row ? { kind: row.kind, baseYear: row.base_year, from: row.base_from, to: row.base_to } : null;

/** The rule read for an account of the chart, with the months it gives (none beyond the limit); refused as the routes say. */
function checkedLine(kinds: Map<string, AccountKind>, accountCode: string, raw: unknown, base: number[] | null): BudgetLine {
  const kind = kinds.get(accountCode) ?? refuse("unknown_account");
  if (kind !== "income" && kind !== "expense") refuse("not_result_account");
  const read = readRule(raw, base);
  if (!read.ok) return refuse(read.error);
  const months = spread(read.rule, base);
  if (!withinLimit(months)) refuse("invalid_rule");
  return { accountCode, rule: read.rule, base, months };
}

const accountKinds = (db: D1Database) => db.prepare("SELECT code, kind FROM ledger_accounts ORDER BY sort");

/** A year's budget: its source and its lines, in the order of the chart. One call to the database. */
export async function getBudget(db: D1Database, year: number, now: Date): Promise<Budget> {
  budgetYear(year, now);
  const [source, lines] = await db.batch([
    db.prepare("SELECT kind, base_year, base_from, base_to FROM budget_sources WHERE year = ?").bind(year),
    db
      .prepare(
        `SELECT b.account_code, b.rule, b.base, b.months FROM budget_lines b JOIN ledger_accounts a ON a.code = b.account_code
         WHERE b.year = ? ORDER BY a.sort`,
      )
      .bind(year),
  ]);
  return { year, source: sourceOf(source!.results[0] as SourceRow | undefined), lines: (lines!.results as LineRow[]).map(lineOf) };
}

/** Replaces the whole year: its source and every line, the months worked out here. Two calls to the database. */
export async function putBudget(db: D1Database, year: number, body: { source: BudgetSource; lines: NewBudgetLine[] }, now: Date): Promise<Budget> {
  budgetYear(year, now);
  checkSource(body.source, year);
  const { results } = await accountKinds(db).all<{ code: string; kind: AccountKind }>();
  const kinds = new Map(results.map((row) => [row.code, row.kind]));
  const order = new Map(results.map((row, i) => [row.code, i]));
  const seen = new Set<string>();
  const lines = body.lines.map((line) => {
    if (seen.has(line.accountCode)) refuse("duplicate_account");
    seen.add(line.accountCode);
    return checkedLine(kinds, line.accountCode, line.rule, line.base);
  });
  lines.sort((a, b) => order.get(a.accountCode)! - order.get(b.accountCode)!);
  const at = now.toISOString();
  await db.batch([
    db.prepare("DELETE FROM budget_lines WHERE year = ?").bind(year),
    db
      .prepare("INSERT OR REPLACE INTO budget_sources (year, kind, base_year, base_from, base_to, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(year, body.source.kind, body.source.baseYear, body.source.from, body.source.to, at),
    ...lines.map((line) =>
      db
        .prepare("INSERT INTO budget_lines (year, account_code, rule, base, months, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(year, line.accountCode, JSON.stringify(line.rule), line.base === null ? null : JSON.stringify(line.base), JSON.stringify(line.months), at),
    ),
  ]);
  return { year, source: body.source, lines };
}

/** Adds a line, or changes the rule of one; a line keeps its base, a new one has none. Two calls to the database. */
export async function putBudgetLine(db: D1Database, year: number, accountCode: string, rule: unknown, now: Date): Promise<BudgetLine> {
  budgetYear(year, now);
  const [account, existing] = await db.batch([
    db.prepare("SELECT code, kind FROM ledger_accounts WHERE code = ?").bind(accountCode),
    db.prepare("SELECT base FROM budget_lines WHERE year = ? AND account_code = ?").bind(year, accountCode),
  ]);
  const kinds = new Map((account!.results as { code: string; kind: AccountKind }[]).map((row) => [row.code, row.kind]));
  const stored = (existing!.results[0] as { base: string | null } | undefined)?.base ?? null;
  const line = checkedLine(kinds, accountCode, rule, stored === null ? null : (JSON.parse(stored) as number[]));
  await db
    .prepare(
      `INSERT INTO budget_lines (year, account_code, rule, base, months, updated_at) VALUES (?1, ?2, ?3, NULL, ?4, ?5)
       ON CONFLICT (year, account_code) DO UPDATE SET rule = excluded.rule, months = excluded.months, updated_at = excluded.updated_at`,
    )
    .bind(year, accountCode, JSON.stringify(line.rule), JSON.stringify(line.months), now.toISOString())
    .run();
  return line;
}

/** Takes one line out of a year's budget (nothing when it is not there). */
export async function deleteBudgetLine(db: D1Database, year: number, accountCode: string, now: Date): Promise<void> {
  budgetYear(year, now);
  await db.prepare("DELETE FROM budget_lines WHERE year = ? AND account_code = ?").bind(year, accountCode).run();
}

/** Takes a year's budget away: every line and its source. */
export async function deleteBudget(db: D1Database, year: number, now: Date): Promise<void> {
  budgetYear(year, now);
  await db.batch([db.prepare("DELETE FROM budget_lines WHERE year = ?").bind(year), db.prepare("DELETE FROM budget_sources WHERE year = ?").bind(year)]);
}

/**
 * A year of the books per income and expense account and month, as the report shows it (income credit positive,
 * costs debit positive), the closing entries left out; only accounts with something. `lastDate`: the latest date
 * with a line on such an account. One call to the database.
 */
export async function budgetActuals(db: D1Database, year: number): Promise<BudgetActuals> {
  if (year < FIRST_YEAR) refuse("not_ledger_year");
  const { results } = await db
    .prepare(
      `SELECT l.account_code, a.kind, CAST(substr(e.date, 6, 2) AS INTEGER) AS month, SUM(l.amount_cents) AS cents, MAX(e.date) AS last
       FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id JOIN ledger_accounts a ON a.code = l.account_code
       WHERE e.year = ?1 AND e.source <> 'closing' AND a.kind IN ('income', 'expense')
       GROUP BY l.account_code, month
       ORDER BY a.sort, l.account_code, month`,
    )
    .bind(year)
    .all<{ account_code: string; kind: AccountKind; month: number; cents: number; last: string }>();
  const accounts: BudgetActuals["accounts"] = [];
  let lastDate: string | null = null;
  for (const row of results) {
    if (lastDate === null || row.last > lastDate) lastDate = row.last;
    let account = accounts.at(-1);
    if (account?.accountCode !== row.account_code) accounts.push((account = { accountCode: row.account_code, cents: Array<number>(12).fill(0) }));
    account.cents[row.month - 1] = row.kind === "income" ? 0 - row.cents || 0 : row.cents;
  }
  return { year, lastDate, accounts: accounts.filter((account) => account.cents.some((cents) => cents !== 0)) };
}
