// The books of 2026 come from e-Boekhouden's auditfile. Until it has been read in, the app books nothing by itself:
// it stores what arrives (bank lines, Mollie payments, balances) and waits. The gate is global, not per year.
//
// The browser reads the file (shared/xaf.ts, shared/xaf-map.ts) and sends it in small requests: `startImport` writes
// the opening, `importEntries` the bookings MAX_ENTRIES at a time, `finishImport` empties what the file no longer
// has and opens the gate. Reading in again, while 2026 is open, updates in place: nothing is doubled or deleted.

import { type EbStatus, type EbSummary, type EntryLine, LEDGER_START, MAX_ENTRIES, OVERSTAP } from "../../shared/ledger-types";
import { businessDate, shiftDate } from "../../shared/time";
import type { ImportedEntry } from "../../shared/xaf-map";
import { balancesOn, entriesFrom, entryReads, historyStatement, LedgerError, sameContent, upsertSourcedStatements } from "./ledger";
import { getLedgerSetting, setLedgerSettingStatement } from "./ledger-settings";
import { inUseSince } from "./maintenance";
import { asShownOnBalance, endOfDay, expectedCashStatement, openingEquityKey, setOpening } from "./opening";

export { MAX_ENTRIES, type EbStatus, type EbSummary };

/** In `ledger_settings`: the date the auditfile read in was made, written by `finishImport` (again on each new read). */
export const IMPORTED_KEY = "eboekhouden_imported_at";
/** In `ledger_settings`: the references of the payouts of Mollie that e-Boekhouden booked, as a JSON list. */
export const PAYOUTS_KEY = "eboekhouden_payouts";

/** One row `{ done: 0 | 1 }`, for a caller's batch: the gate costs no database call of its own. */
export function eboekhoudenDoneStatement(db: D1Database): D1PreparedStatement {
  return db.prepare("SELECT EXISTS (SELECT 1 FROM ledger_settings WHERE key = ?1) AS done").bind(IMPORTED_KEY);
}

/** The auditfile has been read in (finishImport ran once). Until then the app books nothing by itself. */
export async function eboekhoudenDone(db: D1Database): Promise<boolean> {
  return (await eboekhoudenDoneStatement(db).first<{ done: number }>())?.done === 1;
}

/** The gate as read from a batch result of `eboekhoudenDoneStatement`. */
export const gateOpen = (result: D1Result): boolean => (result.results[0] as { done: number } | undefined)?.done === 1;

const YEAR = Number(LEDGER_START.slice(0, 4));
/** The last day of the auditfile: from OVERSTAP on, the bank lines are the app's. */
const LAST_DAY = shiftDate(OVERSTAP, -1);
/** The toestellen and their depreciation run through the list in the app (spec §7.2, §8): no imported line on them. */
const ASSET_ACCOUNTS = ["0130", "0135", "4601"];
const OPEN_ITEMS = ["1300", "1700"] as const;

const REREAD = "opnieuw ingelezen uit e-Boekhouden";
const GONE = "niet meer in het auditbestand";
const OPENING_REPLACED = `vervangen: de beginbalans van ${YEAR + 1} volgt uit het afsluiten van ${YEAR}`;

const yearStatement = (db: D1Database) => db.prepare("SELECT status FROM ledger_years WHERE year = ?1").bind(YEAR);
const isClosed = (result: D1Result) => (result.results[0] as { status: string } | undefined)?.status === "closed";
/** The bookings from e-Boekhouden in the books, emptied ones not counted: `{ n }`. */
const importedStatement = (db: D1Database) =>
  db.prepare("SELECT COUNT(*) AS n FROM ledger_entries e WHERE e.source = 'eboekhouden' AND EXISTS (SELECT 1 FROM ledger_lines l WHERE l.entry_id = e.id)");
const countOf = (result: D1Result) => (result.results[0] as { n: number }).n;

export async function eboekhoudenStatus(db: D1Database): Promise<EbStatus> {
  const [[created, imported, year], since] = await Promise.all([
    db.batch([db.prepare("SELECT value FROM ledger_settings WHERE key = ?1").bind(IMPORTED_KEY), importedStatement(db), yearStatement(db)]),
    inUseSince(db),
  ]);
  const createdOn = (created!.results[0] as { value: string } | undefined)?.value ?? null;
  return {
    done: createdOn !== null,
    createdOn,
    imported: countOf(imported!),
    inUseSince: since === null ? null : businessDate(since),
    yearClosed: isClosed(year!),
  };
}

/** The references of the payouts of Mollie that e-Boekhouden booked, as `startImport` kept them; none before. */
export async function eboekhoudenPayouts(db: D1Database): Promise<string[]> {
  const value = await getLedgerSetting(db, PAYOUTS_KEY);
  return value === null ? [] : (JSON.parse(value) as string[]);
}

/**
 * Writes the opening of 2026 from the auditfile (signed: debit +, credit −) and keeps the payouts e-Boekhouden
 * booked. 1400 is worked out, and 0130 and 0135 come from the toestellen list once it is pasted (`setOpening`); an
 * income or expense account is refused. A closed 2026 is refused by `setOpening` before anything is written.
 */
export async function startImport(
  db: D1Database,
  input: { createdOn: string; opening: { accountCode: string; amountCents: number }[]; ebEquityCents: number; payouts: string[] },
  now: Date,
): Promise<void> {
  const lines = input.opening.map((line) => ({ accountCode: line.accountCode, amountCents: asShownOnBalance(line.accountCode, line.amountCents) }));
  await setOpening(db, YEAR, { lines, eBoekhoudenEquityCents: input.ebEquityCents }, now);
  await setLedgerSettingStatement(db, PAYOUTS_KEY, JSON.stringify(input.payouts), now).run();
}

/**
 * Writes a chunk of bookings (at most MAX_ENTRIES) as entries with source `eboekhouden` and their ref. A booking
 * read in before is updated in place, with one history row when it changed; an unchanged one writes nothing. The
 * whole chunk or nothing: every check before the write, then one batch. Two database calls whatever the chunk holds.
 */
export async function importEntries(db: D1Database, entries: ImportedEntry[], now: Date): Promise<{ written: number }> {
  if (entries.length > MAX_ENTRIES) throw new LedgerError("too_many", 400);
  for (const entry of entries) {
    if (entry.date < LEDGER_START || entry.date > LAST_DAY) throw new LedgerError("outside_period", 400);
    if (entry.lines.some((line) => ASSET_ACCOUNTS.includes(line.accountCode))) throw new LedgerError("asset_account", 400);
  }
  const codes = [...new Set(entries.flatMap((entry) => entry.lines.map((line) => line.accountCode)))];
  const [year, accounts, ...reads] = await db.batch([
    yearStatement(db),
    db.prepare("SELECT code FROM ledger_accounts WHERE code IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(codes)),
    ...entryReads(db, "e.source = 'eboekhouden' AND e.source_ref IN (SELECT value FROM json_each(?))", [JSON.stringify(entries.map((entry) => entry.ref))]),
  ]);
  if (isClosed(year!)) throw new LedgerError("year_closed", 409);
  const known = new Set((accounts!.results as { code: string }[]).map((row) => row.code));
  if (!codes.every((code) => known.has(code))) throw new LedgerError("account_unknown", 400);

  const existing = new Map(entriesFrom(reads).map((entry) => [entry.sourceRef, entry]));
  const statements: D1PreparedStatement[] = [];
  let written = 0;
  for (const entry of entries) {
    const lines: EntryLine[] = entry.lines.map((line) => ({ accountCode: line.accountCode, amountCents: line.amountCents, note: line.note, assetId: null }));
    const next = { date: entry.date, description: entry.description, source: "eboekhouden" as const, sourceRef: entry.ref, lines };
    const before = existing.get(entry.ref);
    if (before && sameContent(before, next)) continue;
    // The ledger refuses a booking that does not balance here, before anything is written.
    const upsert = upsertSourcedStatements(db, next, before ?? null, now);
    statements.push(...(before ? [historyStatement(db, before.id, before, next, REREAD, now)] : []), ...upsert);
    written++;
  }
  if (statements.length > 0) await db.batch(statements);
  return { written };
}

/**
 * Ends a read: empties each booking from e-Boekhouden the file no longer has (`refs` are all of the file's) and a
 * typed opening of 2027, which now follows from closing 2026, each with a history row; then opens the gate. What
 * the books hold at the end of 24-11 comes back, for the penningmeester to check against the kassa and the banks.
 */
export async function finishImport(db: D1Database, input: { createdOn: string; refs: string[] }, now: Date): Promise<EbSummary> {
  const nextYear = YEAR + 1;
  const [year, ...reads] = await db.batch([
    yearStatement(db),
    ...entryReads(
      db,
      `EXISTS (SELECT 1 FROM ledger_lines x WHERE x.entry_id = e.id)
       AND ((e.source = 'eboekhouden' AND e.source_ref NOT IN (SELECT value FROM json_each(?))) OR (e.source = 'opening' AND e.source_ref = ?))`,
      [JSON.stringify(input.refs), String(nextYear)],
    ),
  ]);
  if (isClosed(year!)) throw new LedgerError("year_closed", 409);

  const toEmpty = entriesFrom(reads);
  await db.batch([
    ...toEmpty.flatMap((entry) => {
      const empty = { date: entry.date, description: entry.description, lines: [] };
      return [
        historyStatement(db, entry.id, entry, empty, entry.source === "opening" ? OPENING_REPLACED : GONE, now),
        ...upsertSourcedStatements(db, { ...empty, source: entry.source, sourceRef: entry.sourceRef! }, { id: entry.id }, now),
      ];
    }),
    // e-Boekhouden's equity belonged to that opening; it stays with it while 2027 is closed.
    db
      .prepare("DELETE FROM ledger_settings WHERE key = ?1 AND NOT EXISTS (SELECT 1 FROM ledger_years WHERE year = ?2 AND status = 'closed')")
      .bind(openingEquityKey(nextYear), nextYear),
    setLedgerSettingStatement(db, IMPORTED_KEY, input.createdOn, now),
  ]);

  const [balances, [kluisje, money, imported]] = await Promise.all([
    balancesOn(db, LAST_DAY),
    db.batch([
      expectedCashStatement(db, endOfDay(LAST_DAY)),
      db
        .prepare(
          `SELECT m.account_code, b.date AS bank_date, b.balance_cents AS bank_cents FROM money_accounts m
           JOIN ledger_accounts a ON a.code = m.account_code
           LEFT JOIN bank_balances b ON b.account_code = m.account_code
             AND b.date = (SELECT MAX(x.date) FROM bank_balances x WHERE x.account_code = m.account_code AND x.date <= ?1)
           WHERE a.hidden = 0 ORDER BY a.sort`,
        )
        .bind(LAST_DAY),
      importedStatement(db),
    ]),
  ]);
  const ledger = (code: string) => balances.get(code) ?? 0;
  return {
    imported: countOf(imported!),
    emptied: toEmpty.filter((entry) => entry.source === "eboekhouden").length,
    cash: { ledgerCents: ledger("1000"), kluisjeCents: (kluisje!.results[0] as { cents: number }).cents },
    open: OPEN_ITEMS.map((accountCode) => ({ accountCode, cents: ledger(accountCode) })).filter((item) => item.cents !== 0),
    money: (money!.results as { account_code: string; bank_date: string | null; bank_cents: number | null }[]).map((row) => ({
      accountCode: row.account_code,
      ledgerCents: ledger(row.account_code),
      bankCents: row.bank_cents,
      bankDate: row.bank_date,
    })),
  };
}
