import type { CamtLine, CamtStatement } from "../../shared/camt";
import { type BankLine, type ImportResult, LEDGER_START, type MoneyAccount, type MoneySource } from "../../shared/ledger-types";
import { businessDate, shiftDate } from "../../shared/time";
import { sha256Hex } from "../lib/crypto";
import { type Entry, type EntryLine } from "../../shared/ledger-types";
import { createEntry, editEntry, LedgerError, upsertSourcedStatements } from "./ledger";

export type LineOrigin = "file" | "enable_banking" | "typed" | "mollie";

/** The sources a bank account can switch between. 1000 stays with the kassa and 1030 with Mollie. */
const BANK_SOURCES: readonly MoneySource[] = ["file", "enable_banking"];

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

/** Stores the new lines in one batch, after one lookup. Gives the result and each kept line's content key. */
async function storeLines(
  db: D1Database,
  accountCode: string,
  lines: CamtLine[],
  origin: LineOrigin,
  now: Date,
): Promise<{ result: ImportResult; keys: string[] }> {
  const kept = lines.filter((line) => line.bookingDate >= LEDGER_START);
  const beforeStart = lines.length - kept.length;
  if (kept.length === 0) return { result: { added: 0, known: 0, beforeStart, autoBooked: 0 }, keys: [] };
  const occurrences = await occurrencesOf(db, accountCode, kept, origin);
  const keys = await Promise.all(kept.map((line, i) => sha256Hex(`${partsOf(accountCode, line)}|${occurrences[i]}`)));
  const nowIso = now.toISOString();
  const written = await db.batch(kept.map((line, i) => insertLine(db, accountCode, line, keys[i]!, origin, nowIso)));
  const added = written.reduce((sum, outcome) => sum + (outcome.meta.changes ?? 0), 0);
  return { result: { added, known: kept.length - added, beforeStart, autoBooked: 0 }, keys };
}

/**
 * Reads lines into a money account, each once. A line is known when its reference is already stored for the
 * account, or when an equal line (account, booking date, amount, the other party's IBAN) with the same count
 * is: the description does not count, as Enable Banking and a file may word it differently. Lines before
 * LEDGER_START are counted and left out. It does not check where the lines come from; `importStatement` does.
 */
export async function importLines(db: D1Database, accountCode: string, lines: CamtLine[], origin: LineOrigin, now: Date): Promise<ImportResult> {
  return (await storeLines(db, accountCode, lines, origin, now)).result;
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
  if (input.date < LEDGER_START) throw new LedgerError("before_start", 400);
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

/**
 * The money accounts (or one), each with the ledger on the date of the bank's newest balance, or on `today`
 * without one. One query for all of them. A balance of 31 December 2026 is laid next to what the opening entry
 * books on the account: the ledger keeps the end of that day as its opening, dated 1 January 2027.
 */
function accountsQuery(db: D1Database, today: string, code: string | null): D1PreparedStatement {
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
         AND b.date = (SELECT MAX(x.date) FROM bank_balances x WHERE x.account_code = m.account_code)
       WHERE ?2 IS NULL OR m.account_code = ?2
       ORDER BY a.sort`,
    )
    .bind(today, code, LEDGER_START, FIRST_OPENING_REF);
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

export async function moneyAccounts(db: D1Database, now: Date): Promise<MoneyAccount[]> {
  const { results } = await accountsQuery(db, today(now), null).all<AccountRow>();
  return results.map(toMoneyAccount);
}

/**
 * Sets what the app knows an account by (trimmed; empty is none) and, for a bank account, whether its lines come
 * from files or from Enable Banking. 1000 stays with the kassa and 1030 with Mollie.
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
  return toMoneyAccount(read!.results[0] as AccountRow);
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

/** The lines that still need booking (open or waiting), oldest first, each with the account chosen last time for the same party. One query. */
export async function openLines(db: D1Database, filter: { accountCode?: string }): Promise<BankLine[]> {
  const { results } = await db
    .prepare(
      `${LINE_SELECT.replace("b.entry_id,", `b.entry_id, ${SUGGESTION} AS suggestion,`)}
       WHERE b.status IN ('open', 'waiting') AND (?1 IS NULL OR b.account_code = ?1)
       ORDER BY b.booking_date, b.imported_at, b.rowid`,
    )
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
 * line's id as reference and its booking date. A line that is booked already has its entry edited, history kept.
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
  const content = { date: line.date, description: input.description ?? entryDescription(line), lines: entryLines(line, input.split) };
  // Looked up by reference, not only by `entry_id`: an entry made a moment before its line was marked still counts.
  const existing = await db.prepare("SELECT id FROM ledger_entries WHERE source = 'bank' AND source_ref = ?").bind(lineId).first<{ id: string }>();
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
/** At most this many lines per run: each takes about seven statements, and a run stays within its database calls. */
const AUTO_LINES_PER_RUN = 4000;
const AUTO_BATCH = 100;

type OpenRow = { id: string; account_code: string; booking_date: string; amount_cents: number; counterparty_name: string | null; counterparty_iban: string | null; description: string };

/**
 * Own transfers and kasstortings book themselves, against 1080. Only `open` lines in years that are not closed;
 * a second run finds nothing more. In batches, not one call per line. Gives how many lines were booked.
 */
export async function autoBook(db: D1Database, now: Date): Promise<number> {
  const [lines, accounts] = await db.batch([
    db
      .prepare(
        `SELECT b.id, b.account_code, b.booking_date, b.amount_cents, b.counterparty_name, b.counterparty_iban, b.description FROM bank_lines b
         WHERE b.status = 'open' AND b.booking_date >= ?1
           AND NOT EXISTS (SELECT 1 FROM ledger_years y WHERE y.year = CAST(substr(b.booking_date, 1, 4) AS INTEGER) AND y.status = 'closed')
         ORDER BY b.booking_date, b.imported_at, b.rowid LIMIT ?2`,
      )
      .bind(LEDGER_START, AUTO_LINES_PER_RUN),
    db.prepare("SELECT account_code, identifier FROM money_accounts WHERE identifier IS NOT NULL AND trim(identifier) <> ''"),
  ]);
  const others = (accounts!.results as { account_code: string; identifier: string }[]).map((row) => ({
    code: row.account_code,
    id: normal(row.identifier),
    word: new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(row.identifier.trim())}($|[^A-Za-z0-9])`, "i"),
  }));

  const auto = (row: OpenRow): Auto | null => {
    const iban = row.counterparty_iban === null ? "" : normal(row.counterparty_iban);
    if (others.some((other) => other.code !== row.account_code && ((iban !== "" && iban === other.id) || other.word.test(row.description)))) {
      return { description: null };
    }
    if (row.account_code === "1010" && row.amount_cents > 0 && /kasstorting/i.test(row.description)) return { description: "Kasstorting" };
    return null;
  };

  const found = (lines!.results as OpenRow[]).flatMap((row) => {
    const kind = auto(row);
    return kind ? [{ row, description: kind.description ?? entryDescription({ counterpartyName: row.counterparty_name, description: row.description }) }] : [];
  });

  let booked = 0;
  for (let i = 0; i < found.length; i += AUTO_BATCH) {
    const groups = found.slice(i, i + AUTO_BATCH).map(({ row, description }) => [
      ...upsertSourcedStatements(
        db,
        {
          date: row.booking_date,
          description,
          source: "bank",
          sourceRef: row.id,
          lines: [
            { accountCode: row.account_code, amountCents: row.amount_cents, note: null, assetId: null },
            { accountCode: KRUISPOST, amountCents: -row.amount_cents, note: null, assetId: null },
          ],
        },
        null,
        now,
      ),
      db
        .prepare(
          `UPDATE bank_lines SET status = 'booked', entry_id = (SELECT id FROM ledger_entries WHERE source = 'bank' AND source_ref = ?1)
           WHERE id = ?1 AND status = 'open' AND EXISTS (SELECT 1 FROM ledger_entries WHERE source = 'bank' AND source_ref = ?1)`,
        )
        .bind(row.id),
    ]);
    const outcomes = await db.batch(groups.flat());
    // The last statement of each group marks its line; it changes a row only when the entry was written.
    let at = 0;
    for (const group of groups) {
      at += group.length;
      booked += outcomes[at - 1]!.meta.changes ?? 0;
    }
  }
  return booked;
}
