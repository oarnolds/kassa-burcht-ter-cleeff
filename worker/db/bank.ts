import type { CamtLine, CamtStatement } from "../../shared/camt";
import { type BankLine, type ImportResult, LEDGER_START, type MoneyAccount, type MoneySource, OVERSTAP, PAYOUT_REFERENCE } from "../../shared/ledger-types";
import { formatEuro } from "../../shared/money";
import { businessDate, shiftDate } from "../../shared/time";
import { sha256Hex } from "../lib/crypto";
import { type Entry, type EntryLine } from "../../shared/ledger-types";
import { checkAssetLinks } from "./assets";
import { eboekhoudenDoneStatement, gateOpen } from "./eboekhouden";
import { dayMonthYear } from "./kassa-ledger";
import { createEntry, editEntry, entrySnapshot, LedgerError, upsertSourcedStatements } from "./ledger";
import { endOfDay } from "./opening";

export type LineOrigin = "file" | "enable_banking" | "typed" | "mollie";

/** The sources a bank account can switch between. 1000 stays with the kassa and 1030 with Mollie. */
const BANK_SOURCES: readonly MoneySource[] = ["file", "enable_banking"];
/** The one account Enable Banking reads: ING betaal. */
const ENABLE_BANKING_ACCOUNT = "1010";

/**
 * The bank's balance at the start of a day is its balance at the end of the day before. The first end of a day
 * the ledger can be laid next to is 31 December 2026; earlier balances are not kept.
 */
const FIRST_BALANCE_DATE = shiftDate(LEDGER_START, -1);

/** The opening entry of the first year: what the ledger held at the end of 31 December 2026. */
const FIRST_OPENING_REF = LEDGER_START.slice(0, 4);

/** An IBAN or a savings number, with spaces and case left out. */
const normal = (value: string) => value.replace(/\s+/g, "").toUpperCase();
const ibanOf = (line: CamtLine) => (line.counterpartyIban === null ? null : normal(line.counterpartyIban) || null);
const refOf = (line: CamtLine) => line.bankRef?.trim() || null;

/** The four parts that make two lines look the same: account, booking date, amount and the other party's IBAN. */
const partsOf = (accountCode: string, line: CamtLine) => `${accountCode}|${line.bookingDate}|${line.amountCents}|${ibanOf(line) ?? ""}`;

// ---- Reading ----

type LineRow = {
  id: string;
  account_code: string;
  booking_date: string;
  amount_cents: number;
  counterparty_name: string | null;
  counterparty_iban: string | null;
  description: string;
  status: BankLine["status"];
  waiting_for: BankLine["waitingFor"];
  note: string | null;
  entry_id: string | null;
  in_closed_year: number;
};

const LINE_SELECT = `SELECT b.id, b.account_code, b.booking_date, b.amount_cents, b.counterparty_name, b.counterparty_iban,
    b.description, b.status, b.waiting_for, b.note, b.entry_id,
    EXISTS (SELECT 1 FROM ledger_years y WHERE y.year = CAST(substr(b.booking_date, 1, 4) AS INTEGER) AND y.status = 'closed') AS in_closed_year
  FROM bank_lines b`;

const toBankLine = (row: LineRow): BankLine => ({
  id: row.id,
  accountCode: row.account_code,
  date: row.booking_date,
  amountCents: row.amount_cents,
  counterpartyName: row.counterparty_name,
  counterpartyIban: row.counterparty_iban,
  description: row.description,
  status: row.status,
  waitingFor: row.waiting_for,
  note: row.note,
  entryId: row.entry_id,
  suggestion: null,
  inClosedYear: row.in_closed_year === 1,
});

export async function getBankLine(db: D1Database, id: string): Promise<BankLine | null> {
  const row = await db.prepare(`${LINE_SELECT} WHERE b.id = ?`).bind(id).first<LineRow>();
  return row ? toBankLine(row) : null;
}

// ---- Reading lines in, once ----

/**
 * How many equal lines (the same four parts) come before each line. For a file or a fetch that is counted within
 * this import, with the lines whose reference is already stored counted first: the bank may list a new line of a
 * day before one it sent earlier, and that new line must not take the old one's place. A typed line comes after
 * the equal lines already stored, so that typing the same line twice gives two (ruling R6).
 */
async function occurrencesOf(db: D1Database, accountCode: string, lines: CamtLine[], origin: LineOrigin): Promise<number[]> {
  const parts = lines.map((line) => partsOf(accountCode, line));
  const before = new Map<string, number>();
  const next = (i: number) => {
    const n = before.get(parts[i]!) ?? 0;
    before.set(parts[i]!, n + 1);
    return n;
  };

  if (origin === "typed") {
    const dates = [...new Set(lines.map((line) => line.bookingDate))];
    const { results } = await db
      .prepare(
        `SELECT booking_date, amount_cents, COALESCE(counterparty_iban, '') AS iban, COUNT(*) AS n FROM bank_lines
         WHERE account_code = ?1 AND booking_date IN (SELECT value FROM json_each(?2))
         GROUP BY booking_date, amount_cents, COALESCE(counterparty_iban, '')`,
      )
      .bind(accountCode, JSON.stringify(dates))
      .all<{ booking_date: string; amount_cents: number; iban: string; n: number }>();
    for (const row of results) before.set(`${accountCode}|${row.booking_date}|${row.amount_cents}|${row.iban}`, row.n);
    return lines.map((_, i) => next(i));
  }

  const refs = [...new Set(lines.flatMap((line) => refOf(line) ?? []))];
  const { results } =
    refs.length === 0
      ? { results: [] }
      : await db
          .prepare("SELECT bank_ref FROM bank_lines WHERE account_code = ?1 AND bank_ref IN (SELECT value FROM json_each(?2))")
          .bind(accountCode, JSON.stringify(refs))
          .all<{ bank_ref: string }>();
  const stored = new Set(results.map((row) => row.bank_ref));
  const knownByRef = lines.map((line) => stored.has(refOf(line) ?? ""));
  const occurrence = new Array<number>(lines.length);
  for (const first of [true, false]) {
    lines.forEach((_, i) => {
      if (knownByRef[i] === first) occurrence[i] = next(i);
    });
  }
  return occurrence;
}

function insertLine(db: D1Database, accountCode: string, line: CamtLine, key: string, origin: LineOrigin, nowIso: string): D1PreparedStatement {
  // OR IGNORE: a line whose reference or content key is already there is known, also when another import
  // stored it a moment ago.
  return db
    .prepare(
      `INSERT OR IGNORE INTO bank_lines
         (id, account_code, booking_date, amount_cents, counterparty_name, counterparty_iban, description, bank_ref, content_key, origin, status, imported_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'open', ?11)`,
    )
    .bind(
      crypto.randomUUID(),
      accountCode,
      line.bookingDate,
      line.amountCents,
      line.counterpartyName,
      ibanOf(line),
      line.description,
      refOf(line),
      key,
      origin,
      nowIso,
    );
}

/**
 * Stores the new lines in one batch, after one lookup, with `alongside` after them in that batch. Gives the result
 * and each kept line's content key.
 */
async function storeLines(
  db: D1Database,
  accountCode: string,
  lines: CamtLine[],
  origin: LineOrigin,
  now: Date,
  alongside: D1PreparedStatement[] = [],
): Promise<{ result: ImportResult; keys: string[] }> {
  const kept = lines.filter((line) => line.bookingDate >= OVERSTAP);
  const beforeStart = lines.length - kept.length;
  if (kept.length === 0) {
    if (alongside.length > 0) await db.batch(alongside);
    return { result: { added: 0, known: 0, beforeStart, autoBooked: 0 }, keys: [] };
  }
  const occurrences = await occurrencesOf(db, accountCode, kept, origin);
  const keys = await Promise.all(kept.map((line, i) => sha256Hex(`${partsOf(accountCode, line)}|${occurrences[i]}`)));
  const nowIso = now.toISOString();
  const written = await db.batch([...kept.map((line, i) => insertLine(db, accountCode, line, keys[i]!, origin, nowIso)), ...alongside]);
  const added = written.slice(0, kept.length).reduce((sum, outcome) => sum + (outcome.meta.changes ?? 0), 0);
  return { result: { added, known: kept.length - added, beforeStart, autoBooked: 0 }, keys };
}

/**
 * Reads lines into a money account, each once. A line is known when its reference is already stored for the
 * account, or when an equal line (account, booking date, amount, the other party's IBAN) with the same count
 * is: the description does not count, as Enable Banking and a file may word it differently. Lines before
 * OVERSTAP are counted and left out. It does not check where the lines come from; `importStatement` does.
 * `alongside` is written in the same batch, after the lines (e.g. what notes that they are in).
 */
export async function importLines(
  db: D1Database,
  accountCode: string,
  lines: CamtLine[],
  origin: LineOrigin,
  now: Date,
  alongside: D1PreparedStatement[] = [],
): Promise<ImportResult> {
  return (await storeLines(db, accountCode, lines, origin, now, alongside)).result;
}

/**
 * What the bank said the account held at the end of `date`. A second balance for the same day replaces the first.
 * None (null) for a day before 31 December 2026: the ledger has nothing to lay next to it.
 */
function balanceStatement(
  db: D1Database,
  accountCode: string,
  balance: { date: string; cents: number },
  origin: string,
): D1PreparedStatement | null {
  if (balance.date < FIRST_BALANCE_DATE) return null;
  return db
    .prepare(
      `INSERT INTO bank_balances (account_code, date, balance_cents, origin) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (account_code, date) DO UPDATE SET balance_cents = excluded.balance_cents, origin = excluded.origin`,
    )
    .bind(accountCode, balance.date, balance.cents, origin);
}

export async function recordBalance(db: D1Database, accountCode: string, balance: { date: string; cents: number }, origin: string): Promise<void> {
  await balanceStatement(db, accountCode, balance, origin)?.run();
}

/** A bank account (source file or Enable Banking) and what the app knows it by; anything else is refused. */
async function bankAccount(db: D1Database, accountCode: string): Promise<{ identifier: string | null }> {
  const row = await db
    .prepare("SELECT identifier, source FROM money_accounts WHERE account_code = ?")
    .bind(accountCode)
    .first<{ identifier: string | null; source: MoneySource }>();
  if (!row || !BANK_SOURCES.includes(row.source)) throw new LedgerError("not_a_bank_account", 400);
  return row;
}

/**
 * A bank file's statement into its account: refused when the account has no identifier yet or the file is of
 * another account (spaces and case do not count). Records the closing balance under its date and the opening
 * balance as that of the day before, each when that day is 31 December 2026 or later.
 */
export async function importStatement(db: D1Database, accountCode: string, statement: CamtStatement, now: Date): Promise<ImportResult> {
  const { identifier } = await bankAccount(db, accountCode);
  if (identifier === null) throw new LedgerError("identifier_missing", 409);
  if (normal(statement.account) !== normal(identifier)) throw new LedgerError("wrong_account", 409);
  const result = await importLines(db, accountCode, statement.lines, "file", now);
  const { opening, closing } = statement;
  const balances = [
    opening && balanceStatement(db, accountCode, { date: shiftDate(opening.date, -1), cents: opening.cents }, "file"),
    closing && balanceStatement(db, accountCode, closing, "file"),
  ].filter((write): write is D1PreparedStatement => !!write);
  if (balances.length > 0) await db.batch(balances);
  return result;
}

export type TypedLine = { accountCode: string; date: string; amountCents: number; description: string; counterpartyName: string | null };

/** A line the penningmeester types himself, e.g. from a bank's paper statement. A double tap keeps it once. */
export async function addTypedLine(db: D1Database, input: TypedLine, now: Date): Promise<BankLine> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents === 0) throw new LedgerError("amount_invalid", 400);
  if (input.date < OVERSTAP) throw new LedgerError("before_start", 400);
  // The bank cannot have booked it yet; a line after today would also move where the next fetch of ING begins.
  if (input.date > today(now)) throw new LedgerError("date_in_future", 400);
  await bankAccount(db, input.accountCode);
  const line: CamtLine = {
    bookingDate: input.date,
    amountCents: input.amountCents,
    description: input.description,
    counterpartyName: input.counterpartyName,
    counterpartyIban: null,
    bankRef: null,
  };
  const { keys } = await storeLines(db, input.accountCode, [line], "typed", now);
  const row = await db.prepare(`${LINE_SELECT} WHERE b.content_key = ?`).bind(keys[0]).first<LineRow>();
  return toBankLine(row!);
}

// ---- Money accounts and the balance check ----

type AccountRow = {
  account_code: string;
  name: string;
  identifier: string | null;
  source: MoneySource;
  bank_date: string | null;
  bank_cents: number | null;
  ledger_cents: number;
};

/** No balance is dated after this: "the newest balance" with no date to stop at. */
const LAST_DATE = "9999-12-31";

/**
 * The money accounts (or one), each with the ledger on the date of the bank's newest balance on or before `upTo`,
 * or on `today` without one. One query for all of them. A balance of 31 December 2026 is laid next to what the
 * opening entry books on the account: the ledger keeps the end of that day as its opening, dated 1 January 2027.
 */
function accountsQuery(db: D1Database, today: string, code: string | null, upTo = LAST_DATE): D1PreparedStatement {
  return db
    .prepare(
      `SELECT m.account_code, a.name, m.identifier, m.source, b.date AS bank_date, b.balance_cents AS bank_cents,
         CASE WHEN b.date < ?3
           THEN COALESCE((SELECT SUM(l.amount_cents) FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
                          WHERE l.account_code = m.account_code AND e.source = 'opening' AND e.source_ref = ?4), 0)
           ELSE COALESCE((SELECT SUM(l.amount_cents) FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
                          WHERE l.account_code = m.account_code AND e.date <= COALESCE(b.date, ?1)), 0)
         END AS ledger_cents
       FROM money_accounts m
       JOIN ledger_accounts a ON a.code = m.account_code
       LEFT JOIN bank_balances b ON b.account_code = m.account_code
         AND b.date = (SELECT MAX(x.date) FROM bank_balances x WHERE x.account_code = m.account_code AND x.date <= ?5)
       WHERE (?2 IS NULL AND a.hidden = 0) OR m.account_code = ?2
       ORDER BY a.sort`,
    )
    .bind(today, code, LEDGER_START, FIRST_OPENING_REF, upTo);
}

const toMoneyAccount = (row: AccountRow): MoneyAccount => ({
  accountCode: row.account_code,
  name: row.name,
  identifier: row.identifier,
  source: row.source,
  ledgerCents: row.ledger_cents,
  bank: row.bank_date === null ? null : { date: row.bank_date, balanceCents: row.bank_cents! },
  differenceCents: row.bank_date === null ? null : row.ledger_cents - row.bank_cents!,
});

const today = (now: Date) => businessDate(now.toISOString());

/** The first moment of the ledger, 1 January 2027 00:00 in Amsterdam, as a UTC ISO string. */
const LEDGER_START_MOMENT = new Date(Date.parse(endOfDay(FIRST_BALANCE_DATE)) + 1).toISOString();

/**
 * Mollie's payouts on their way to ING at the end of Amsterdam day `date`: settled from LEDGER_START up to the end
 * of that day (not failed), and not arrived by then: no payout entry (`mollie_settlement`) dated on or before
 * `date`, and no booked credit on ING betaal dated on or before `date` that carries the payout's reference (a payout
 * line booked by hand). Their amount plus costs, as `cents`: Mollie's balance has let go of them, 1030 still holds
 * them. A payout settled before LEDGER_START is the opening's (on its way as 1080), never this. A statement, for a
 * caller's batch; `payoutsInTransit` runs it.
 */
export function payoutsInTransitStatement(db: D1Database, date: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT COALESCE(SUM(s.amount_cents + abs(s.costs_cents)), 0) AS cents FROM mollie_settlements s
       WHERE s.status <> 'failed' AND s.amount_cents > 0 AND s.settled_at >= ?1 AND s.settled_at <= ?2
         AND NOT EXISTS (SELECT 1 FROM ledger_entries e WHERE e.source = 'mollie_settlement' AND e.source_ref = s.id AND e.date <= ?3)
         AND NOT EXISTS (
           SELECT 1 FROM bank_lines b
           WHERE b.account_code = '${PAYOUT_ACCOUNT}' AND b.status = 'booked' AND b.amount_cents > 0
             AND b.booking_date >= date(substr(s.settled_at, 1, 10), '-1 day') AND b.booking_date <= ?3
             AND s.reference IS NOT NULL AND instr(b.description, s.reference) > 0)`,
    )
    .bind(LEDGER_START_MOMENT, endOfDay(date), date);
}

export async function payoutsInTransit(db: D1Database, date: string): Promise<number> {
  return (await payoutsInTransitStatement(db, date).first<{ cents: number }>())!.cents;
}

/**
 * 1030 next to Mollie's balance leaves out the payouts on their way to ING on that balance's date (one more query,
 * only when Mollie gave a balance); only what is left is a difference. Gives the accounts and that sum.
 */
async function withPayoutsInTransit(db: D1Database, accounts: MoneyAccount[]): Promise<{ accounts: MoneyAccount[]; inTransitCents: number }> {
  const mollie = accounts.find((account) => account.accountCode === MOLLIE && account.bank !== null);
  if (!mollie) return { accounts, inTransitCents: 0 };
  const inTransitCents = await payoutsInTransit(db, mollie.bank!.date);
  if (inTransitCents === 0) return { accounts, inTransitCents };
  return {
    accounts: accounts.map((account) => (account === mollie ? { ...account, differenceCents: account.ledgerCents - inTransitCents - account.bank!.balanceCents } : account)),
    inTransitCents,
  };
}

export async function moneyAccounts(db: D1Database, now: Date): Promise<MoneyAccount[]> {
  return (await moneyAccountsWithTransit(db, now)).accounts;
}

/** The money accounts, and the payouts of Mollie on their way to ING that 1030's difference leaves out. */
export async function moneyAccountsWithTransit(db: D1Database, now: Date): Promise<{ accounts: MoneyAccount[]; inTransitCents: number }> {
  const { results } = await accountsQuery(db, today(now), null).all<AccountRow>();
  return withPayoutsInTransit(db, results.map(toMoneyAccount));
}

/**
 * One money account as it stood on `date`: the bank's newest balance on or before that date, next to the ledger on
 * that balance's own date (on `date` without one), as `moneyAccounts` lays them. A statement for the caller's
 * batch; `moneyAccountOf` reads its result.
 */
export function moneyAccountOnStatement(db: D1Database, code: string, date: string): D1PreparedStatement {
  return accountsQuery(db, date, code, date);
}

/** Every money account as it stood on `date`, as `moneyAccountOnStatement` lays one; `moneyAccountsFrom` reads them. */
export function moneyAccountsOnStatement(db: D1Database, date: string): D1PreparedStatement {
  return accountsQuery(db, date, null, date);
}

/** The accounts `moneyAccountsOnStatement` read, as they are: 1030's difference without the payouts on their way. */
export function moneyAccountsFrom(result: D1Result): MoneyAccount[] {
  return (result.results as AccountRow[]).map(toMoneyAccount);
}

/** The account `moneyAccountOnStatement` read, with 1030's payouts on their way to ING left out of its difference. */
export async function moneyAccountOf(db: D1Database, result: D1Result): Promise<{ account: MoneyAccount | null; inTransitCents: number }> {
  const row = result.results[0] as AccountRow | undefined;
  if (!row) return { account: null, inTransitCents: 0 };
  const { accounts, inTransitCents } = await withPayoutsInTransit(db, [toMoneyAccount(row)]);
  return { account: accounts[0]!, inTransitCents };
}

/**
 * Sets what the app knows an account by (trimmed; empty is none) and, for ING betaal, whether its lines come from
 * files or from Enable Banking; the other banks stay with files. 1000 stays with the kassa and 1030 with Mollie.
 */
export async function setMoneyAccount(
  db: D1Database,
  code: string,
  input: { identifier?: string | null; source?: MoneySource },
  now: Date,
): Promise<MoneyAccount> {
  const current = await db.prepare("SELECT source FROM money_accounts WHERE account_code = ?").bind(code).first<{ source: MoneySource }>();
  if (!current) throw new LedgerError("not_found", 404);
  if (input.source !== undefined && !(BANK_SOURCES.includes(input.source) && BANK_SOURCES.includes(current.source))) {
    throw new LedgerError("source_fixed", 400);
  }
  // Only ING betaal is fetched through Enable Banking (spec §10); another bank would wait for lines that never come.
  if (input.source === "enable_banking" && code !== ENABLE_BANKING_ACCOUNT) throw new LedgerError("source_fixed", 400);
  const identifier = input.identifier === undefined ? undefined : input.identifier?.trim() || null;
  const [, read] = await db.batch([
    db
      .prepare(
        `UPDATE money_accounts SET identifier = CASE WHEN ?2 THEN ?3 ELSE identifier END, source = COALESCE(?4, source)
         WHERE account_code = ?1`,
      )
      .bind(code, identifier === undefined ? 0 : 1, identifier ?? null, input.source ?? null),
    accountsQuery(db, today(now), code),
  ]);
  return (await withPayoutsInTransit(db, [toMoneyAccount(read!.results[0] as AccountRow)])).accounts[0]!;
}

// ---- Te boeken ----

/**
 * The account on the other side of the newest booked line that matches `match` (a condition on `p`, a booked
 * line, and `b`, the line looked at), when that entry has exactly two lines. Newest by booking date, then import.
 */
const otherSide = (match: string) => `(SELECT CASE WHEN (SELECT COUNT(*) FROM ledger_lines x WHERE x.entry_id = p.entry_id) = 2
      THEN (SELECT l2.account_code FROM ledger_lines l2 WHERE l2.entry_id = p.entry_id AND l2.account_code <> p.account_code LIMIT 1) END
    FROM bank_lines p WHERE p.status = 'booked' AND p.entry_id IS NOT NULL AND p.id <> b.id AND ${match}
    ORDER BY p.booking_date DESC, p.imported_at DESC, p.rowid DESC LIMIT 1)`;
const BY_IBAN = "b.counterparty_iban IS NOT NULL AND b.counterparty_iban <> '' AND p.counterparty_iban = b.counterparty_iban";
const BY_NAME = "trim(coalesce(b.counterparty_name, '')) <> '' AND lower(trim(p.counterparty_name)) = lower(trim(b.counterparty_name))";
const SUGGESTION = `CASE WHEN b.counterparty_iban IS NOT NULL AND b.counterparty_iban <> ''
      AND EXISTS (SELECT 1 FROM bank_lines p WHERE p.status = 'booked' AND p.entry_id IS NOT NULL AND p.id <> b.id AND ${BY_IBAN})
    THEN ${otherSide(BY_IBAN)} ELSE ${otherSide(BY_NAME)} END`;

/**
 * Te boeken as one query: the open and waiting lines through `bank_lines_to_book`, each suggestion found through
 * `bank_lines_booked_by_iban` or `bank_lines_booked_by_name` (migrations/0005_ledger.sql), so that what a page reads
 * grows with the lines to book and not with every bank line there is. `?1`: one account, or null for all.
 */
export const OPEN_LINES_SQL = `${LINE_SELECT.replace("b.entry_id,", `b.entry_id, ${SUGGESTION} AS suggestion,`)}
       WHERE b.status IN ('open', 'waiting') AND (?1 IS NULL OR b.account_code = ?1)
       ORDER BY b.booking_date, b.imported_at, b.rowid`;

/** The lines that still need booking (open or waiting), oldest first, each with the account chosen last time for the same party. One query. */
export async function openLines(db: D1Database, filter: { accountCode?: string }): Promise<BankLine[]> {
  const { results } = await db
    .prepare(OPEN_LINES_SQL)
    .bind(filter.accountCode ?? null)
    .all<LineRow & { suggestion: string | null }>();
  return results.map((row) => ({ ...toBankLine(row), suggestion: row.suggestion }));
}

const entryDescription = (line: Pick<BankLine, "counterpartyName" | "description">) => {
  const name = line.counterpartyName?.trim();
  return name ? `${name} – ${line.description}` : line.description;
};

const entryLines = (line: BankLine, split: { accountCode: string; amountCents: number; assetId?: string | null }[]): EntryLine[] => [
  { accountCode: line.accountCode, amountCents: line.amountCents, note: null, assetId: null },
  ...split.map((part) => ({ accountCode: part.accountCode, amountCents: part.amountCents, note: null, assetId: part.assetId ?? null })),
];

/**
 * Books a line: the money account gets the line's amount, `split` the other side. The entry is `bank`, with the
 * line's id as reference and its booking date. A line that is booked already has its entry edited, history kept;
 * one that a sync booked (a payout of Mollie) is refused. A part on 0130 with an `assetId` is the cost of that toestel.
 */
export async function bookLine(
  db: D1Database,
  lineId: string,
  input: { split: { accountCode: string; amountCents: number; assetId?: string | null }[]; description?: string },
  now: Date,
): Promise<Entry> {
  const line = await getBankLine(db, lineId);
  if (!line) throw new LedgerError("not_found", 404);
  if (input.split.some((part) => part.accountCode === line.accountCode)) throw new LedgerError("same_account", 400);
  // A line on 0130 may buy a toestel of the list: one that is there and still in use.
  await checkAssetLinks(db, input.split.map((part) => ({ accountCode: part.accountCode, assetId: part.assetId ?? null })));
  const content = { date: line.date, description: input.description ?? entryDescription(line), lines: entryLines(line, input.split) };
  // Looked up by reference, not only by `entry_id`: an entry made a moment before its line was marked still counts.
  const existing = await db.prepare("SELECT id FROM ledger_entries WHERE source = 'bank' AND source_ref = ?").bind(lineId).first<{ id: string }>();
  // Booked by another entry (a payout of Mollie, also after his own entry was emptied): that entry follows its
  // source, and a second one would book the money twice.
  if (line.status === "booked" && line.entryId !== (existing?.id ?? null)) throw new LedgerError("not_editable", 409);
  const entry = existing
    ? await editEntry(db, existing.id, content, now)
    : await createEntry(db, { ...content, source: "bank", sourceRef: lineId }, now);
  await db.prepare("UPDATE bank_lines SET status = 'booked', entry_id = ?, waiting_for = NULL WHERE id = ?").bind(entry.id, lineId).run();
  return entry;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What a line is, when the app can tell without asking: an own transfer or a kasstorting. Both book against 1080. */
type Auto = { description: string | null };

const KRUISPOST = "1080";
/** At most this many lines per run: each takes about eight statements, and a run stays within its database calls. */
const AUTO_LINES_PER_RUN = 4000;
const AUTO_BATCH = 100;

/** Mollie pays out to ING betaal; the bank statement carries the payout's reference, e.g. 05665564.2611.01. */
const PAYOUT_ACCOUNT = "1010";
const MOLLIE = "1030";
const MOLLIE_COSTS = "4511";

type OpenRow = {
  id: string;
  account_code: string;
  booking_date: string;
  amount_cents: number;
  counterparty_name: string | null;
  counterparty_iban: string | null;
  description: string;
  status: "open" | "waiting";
  waiting_for: BankLine["waitingFor"];
  note: string | null;
};
/** A payout of Mollie as read by worker/db/mollie-ledger.ts; `booked` once its entry is there. */
type PayoutRow = { id: string; reference: string; settled_at: string | null; amount_cents: number; costs_cents: number; booked: number };
/** The statements for one line; `books` when the last of them marks the line booked. */
type Work = { statements: D1PreparedStatement[]; books: boolean };

/** The reference of a payout of Mollie on a credit of ING betaal, or null. */
const payoutReference = (row: OpenRow): string | null =>
  row.account_code === PAYOUT_ACCOUNT && row.amount_cents > 0 ? (PAYOUT_REFERENCE.exec(row.description)?.[1] ?? null) : null;

/**
 * Lines that book themselves. A payout of Mollie on ING betaal, by the reference in its description: known with the
 * same amount, it is booked with Mollie's costs (debit 1010 the payout, debit 4511 the costs, credit 1030 both);
 * not known yet, it waits for Mollie; settled before LEDGER_START, known with another amount, or booked already from
 * another line, it stays open with the reason, and the app never guesses. A line booked by hand (also one that
 * waited) is left alone. Own transfers and kasstortings, of `open` lines only, against 1080.
 * Lines in years that are not closed; a second run finds nothing more. In batches, not one call per line. Gives how
 * many lines were booked.
 */
export async function autoBook(db: D1Database, now: Date): Promise<number> {
  const [lines, accounts, settlements, gate] = await db.batch([
    db
      .prepare(
        `SELECT b.id, b.account_code, b.booking_date, b.amount_cents, b.counterparty_name, b.counterparty_iban, b.description,
           b.status, b.waiting_for, b.note
         FROM bank_lines b
         WHERE b.status IN ('open', 'waiting') AND b.booking_date >= ?1
           AND NOT EXISTS (SELECT 1 FROM ledger_years y WHERE y.year = CAST(substr(b.booking_date, 1, 4) AS INTEGER) AND y.status = 'closed')
         ORDER BY b.booking_date, b.imported_at, b.rowid LIMIT ?2`,
      )
      .bind(OVERSTAP, AUTO_LINES_PER_RUN),
    db.prepare("SELECT account_code, identifier FROM money_accounts WHERE identifier IS NOT NULL AND trim(identifier) <> ''"),
    db.prepare(
      `SELECT s.id, s.reference, s.settled_at, s.amount_cents, s.costs_cents,
         EXISTS (SELECT 1 FROM ledger_entries e WHERE e.source = 'mollie_settlement' AND e.source_ref = s.id) AS booked
       FROM mollie_settlements s WHERE s.reference IS NOT NULL`,
    ),
    eboekhoudenDoneStatement(db),
  ]);
  // 2026 waits for e-Boekhouden's auditfile: the lines stay as they are (not even marked) until it is read in.
  if (!gateOpen(gate!)) return 0;
  const others = (accounts!.results as { account_code: string; identifier: string }[]).map((row) => ({
    code: row.account_code,
    id: normal(row.identifier),
    word: new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(row.identifier.trim())}($|[^A-Za-z0-9])`, "i"),
  }));
  const payouts = new Map((settlements!.results as PayoutRow[]).map((row) => [row.reference, row]));
  // A payout is booked from one line only: the oldest that carries it, or the one that already did.
  const taken = new Set([...payouts.values()].filter((payout) => payout.booked === 1).map((payout) => payout.id));

  const auto = (row: OpenRow): Auto | null => {
    const iban = row.counterparty_iban === null ? "" : normal(row.counterparty_iban);
    if (others.some((other) => other.code !== row.account_code && ((iban !== "" && iban === other.id) || other.word.test(row.description)))) {
      return { description: null };
    }
    if (row.account_code === "1010" && row.amount_cents > 0 && /kasstorting/i.test(row.description)) return { description: "Kasstorting" };
    return null;
  };

  /** Puts a line in a state of its own (no entry); nothing when it is in that state already. */
  const mark = (row: OpenRow, status: OpenRow["status"], waitingFor: BankLine["waitingFor"], note: string | null): Work[] =>
    row.status === status && row.waiting_for === waitingFor && row.note === note
      ? []
      : [
          {
            statements: [
              db
                .prepare("UPDATE bank_lines SET status = ?2, waiting_for = ?3, note = ?4 WHERE id = ?1 AND status IN ('open', 'waiting')")
                .bind(row.id, status, waitingFor, note),
            ],
            books: false,
          },
        ];

  const work = (lines!.results as OpenRow[]).flatMap((row): Work[] => {
    const reference = payoutReference(row);
    if (reference !== null) {
      const payout = payouts.get(reference);
      if (!payout) return mark(row, "waiting", "mollie", null);
      // Settled before the books begin: its costs are in e-Boekhouden, and the money may stand in the opening as underway.
      const settled = payout.settled_at === null ? null : businessDate(payout.settled_at);
      if (settled !== null && settled < LEDGER_START) {
        return mark(
          row,
          "open",
          null,
          `Uitbetaling ${reference} is van ${dayMonthYear(settled)} (${settled.slice(0, 4)}): boek hem tegen 1080 Kruisposten als hij in de beginbalans onderweg stond.`,
        );
      }
      if (payout.amount_cents !== row.amount_cents) return mark(row, "open", null, `Bedrag wijkt af van de uitbetaling bij Mollie (${formatEuro(payout.amount_cents)})`);
      if (taken.has(payout.id)) return mark(row, "open", null, `Uitbetaling ${reference} is al geboekt`);
      taken.add(payout.id);
      return [{ statements: payoutStatements(db, row, payout, reference, now), books: true }];
    }
    if (row.status !== "open") return [];
    const kind = auto(row);
    if (!kind) return [];
    const description = kind.description ?? entryDescription({ counterpartyName: row.counterparty_name, description: row.description });
    return [{ statements: kruispostStatements(db, row, description, now), books: true }];
  });

  let booked = 0;
  for (let i = 0; i < work.length; i += AUTO_BATCH) {
    const groups = work.slice(i, i + AUTO_BATCH);
    const outcomes = await db.batch(groups.flatMap((group) => group.statements));
    // The last statement of a booking group marks its line; it changes a row only when the entry was written.
    let at = 0;
    for (const group of groups) {
      at += group.statements.length;
      if (group.books) booked += outcomes[at - 1]!.meta.changes ?? 0;
    }
  }
  return booked;
}

/** An own transfer or a kasstorting: the line's amount against 1080, and the line marked booked. */
function kruispostStatements(db: D1Database, row: OpenRow, description: string, now: Date): D1PreparedStatement[] {
  const content = {
    date: row.booking_date,
    description,
    lines: [
      { accountCode: row.account_code, amountCents: row.amount_cents, note: null, assetId: null },
      { accountCode: KRUISPOST, amountCents: -row.amount_cents, note: null, assetId: null },
    ],
  };
  return [
    // An entry the penningmeester emptied (its line came back, R37) is filled again: that change is in its history too.
    db
      .prepare(
        `INSERT INTO ledger_history (entry_id, at, before_json, after_json)
         SELECT e.id, ?2, json_object('date', e.date, 'description', e.description, 'lines', json('[]')), ?3 FROM ledger_entries e
         WHERE e.source = 'bank' AND e.source_ref = ?1 AND NOT EXISTS (SELECT 1 FROM ledger_lines l WHERE l.entry_id = e.id)
           AND EXISTS (SELECT 1 FROM ledger_years y WHERE y.year = e.year AND y.status = 'open')`,
      )
      .bind(row.id, now.toISOString(), JSON.stringify(entrySnapshot(content))),
    ...upsertSourcedStatements(db, { ...content, source: "bank", sourceRef: row.id }, null, now),
    db
      .prepare(
        `UPDATE bank_lines SET status = 'booked', entry_id = (SELECT id FROM ledger_entries WHERE source = 'bank' AND source_ref = ?1)
         WHERE id = ?1 AND status = 'open' AND EXISTS (SELECT 1 FROM ledger_entries WHERE source = 'bank' AND source_ref = ?1)`,
      )
      .bind(row.id),
  ];
}

/**
 * A payout of Mollie, on the line's booking date: debit 1010 what came in, debit 4511 Mollie's costs (as a cost,
 * whatever sign Mollie gives them), credit 1030 the two together. One entry per payout (its reference is the
 * settlement's id); the line is marked booked in the same batch, only when that entry is there.
 */
function payoutStatements(db: D1Database, row: OpenRow, payout: PayoutRow, reference: string, now: Date): D1PreparedStatement[] {
  const costs = Math.abs(payout.costs_cents);
  const lines: EntryLine[] = [
    { accountCode: row.account_code, amountCents: row.amount_cents, note: null, assetId: null },
    ...(costs === 0 ? [] : [{ accountCode: MOLLIE_COSTS, amountCents: costs, note: null, assetId: null }]),
    { accountCode: MOLLIE, amountCents: -(row.amount_cents + costs), note: null, assetId: null },
  ];
  const entry = "SELECT id FROM ledger_entries WHERE source = 'mollie_settlement' AND source_ref = ?2";
  return [
    ...upsertSourcedStatements(db, { date: row.booking_date, description: `Uitbetaling Mollie ${reference}`, source: "mollie_settlement", sourceRef: payout.id, lines }, null, now),
    db
      .prepare(
        `UPDATE bank_lines SET status = 'booked', waiting_for = NULL, note = NULL, entry_id = (${entry})
         WHERE id = ?1 AND status IN ('open', 'waiting') AND EXISTS (${entry})`,
      )
      .bind(row.id, payout.id),
  ];
}
