import { type Attachment, type Entry, type EntryChange, type EntryLine, type EntrySource, LEDGER_START, type YearChange } from "../../shared/ledger-types";

/** A refusal with a reason the beheer pages can show. */
export class LedgerError extends Error {
  constructor(
    public code: string,
    public status: 400 | 404 | 409 | 502 | 503,
  ) {
    super(code);
  }
}

export type NewEntry = { date: string; description: string; source: EntrySource; sourceRef?: string | null; lines: EntryLine[] };
type Content = Pick<NewEntry, "date" | "description" | "lines">;

/** The penningmeester's own entries. All others are written by their sync and follow their source. */
const EDITABLE_SOURCES: readonly EntrySource[] = ["manual", "bank"];

type EntryRow = {
  id: string;
  year: number;
  number: number;
  date: string;
  description: string;
  source: EntrySource;
  source_ref: string | null;
  year_status: "open" | "closed" | null;
  changed: number;
};
type AttachmentRow = { id: string; entry_id: string; filename: string; content_type: string; size_bytes: number; uploaded_at: string };
type LineRow = { entry_id: string; account_code: string; amount_cents: number; note: string | null; asset_id: string | null };

const yearOf = (date: string) => Number(date.slice(0, 4));

/** The accounts a line may name a toestel on: its cost and what is written off on it (spec §12). */
const ASSET_ACCOUNTS = ["0130", "0135"];

/**
 * What every write keeps before it reads anything: whole cents that sum to zero, on a date the ledger knows, and a
 * toestel only on 0130 or 0135. Gives the year.
 */
function checkContent(content: Content): number {
  if (!content.lines.every((line) => Number.isSafeInteger(line.amountCents))) throw new LedgerError("amount_invalid", 400);
  if (content.lines.reduce((sum, line) => sum + line.amountCents, 0) !== 0) throw new LedgerError("unbalanced", 400);
  if (content.lines.some((line) => line.assetId && !ASSET_ACCOUNTS.includes(line.accountCode))) throw new LedgerError("asset_line_account", 400);
  if (content.date < LEDGER_START) throw new LedgerError("year_unknown", 400);
  return yearOf(content.date);
}

const codesOf = (lines: EntryLine[]) => [...new Set(lines.map((line) => line.accountCode))];
const assetIdsOf = (lines: EntryLine[]) => [...new Set(lines.flatMap((line) => (line.assetId ? [line.assetId] : [])))];

/**
 * Reads what the checks of a write need: the status of its year, the accounts it books on and the toestellen it
 * names (with those of the lines it replaces, `before`, to see whether one is disposed of).
 */
function checkReads(db: D1Database, year: number, lines: EntryLine[], before: EntryLine[] = []): D1PreparedStatement[] {
  return [
    db.prepare("SELECT status FROM ledger_years WHERE year = ?").bind(year),
    db.prepare("SELECT code, hidden FROM ledger_accounts WHERE code IN (SELECT value FROM json_each(?))").bind(JSON.stringify(codesOf(lines))),
    db.prepare("SELECT id, disposed_on FROM assets WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(assetIdsOf([...lines, ...before]))),
  ];
}

/** A year without a row is opened by the write (it is after LEDGER_START); a closed one refuses it. */
function checkResults([years, accounts, assets]: D1Result[], lines: EntryLine[], refuseHidden: boolean): void {
  if ((years!.results as { status: string }[]).some((row) => row.status === "closed")) throw new LedgerError("year_closed", 409);
  const hidden = new Map((accounts!.results as { code: string; hidden: number }[]).map((row) => [row.code, row.hidden === 1]));
  for (const code of codesOf(lines)) {
    if (!hidden.has(code)) throw new LedgerError("account_unknown", 400);
    if (refuseHidden && hidden.get(code)) throw new LedgerError("account_hidden", 400);
  }
  const known = new Set((assets!.results as { id: string }[]).map((row) => row.id));
  if (!assetIdsOf(lines).every((id) => known.has(id))) throw new LedgerError("asset_unknown", 404);
}

/** What the lines book on one toestel (account and amount), in any order. */
const bookedOn = (lines: EntryLine[], assetId: string) =>
  lines
    .filter((line) => line.assetId === assetId)
    .map((line) => `${line.accountCode}|${line.amountCents}`)
    .sort()
    .join(",");

/**
 * A disposed toestel's lines stay as they are: its disposal took exactly them off 0130 and 0135, and a disposal is
 * not done again. Refuses an edit that would change, move or drop them.
 */
function checkDisposed(assets: D1Result, before: EntryLine[], after: EntryLine[]): void {
  for (const row of assets.results as { id: string; disposed_on: string | null }[]) {
    if (row.disposed_on !== null && bookedOn(before, row.id) !== bookedOn(after, row.id)) throw new LedgerError("asset_disposed", 409);
  }
}

function sameContent(a: Content, b: Content): boolean {
  return (
    a.date === b.date &&
    a.description === b.description &&
    a.lines.length === b.lines.length &&
    a.lines.every((line, i) => {
      const other = b.lines[i]!;
      return (
        line.accountCode === other.accountCode &&
        line.amountCents === other.amountCents &&
        (line.note ?? null) === (other.note ?? null) &&
        (line.assetId ?? null) === (other.assetId ?? null)
      );
    })
  );
}

const snapshot = (content: Content) => ({
  date: content.date,
  description: content.description,
  lines: content.lines.map((line) => ({ accountCode: line.accountCode, amountCents: line.amountCents, note: line.note ?? null, assetId: line.assetId ?? null })),
});

// ---- Reading ----

/** The entries matching `where` (on `ledger_entries e`) with their lines, by date and number. */
function entryReads(db: D1Database, where: string, values: unknown[]): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `SELECT e.id, e.year, e.number, e.date, e.description, e.source, e.source_ref,
           (SELECT status FROM ledger_years y WHERE y.year = e.year) AS year_status,
           EXISTS (SELECT 1 FROM ledger_history h WHERE h.entry_id = e.id) AS changed
         FROM ledger_entries e WHERE ${where} ORDER BY e.date, e.number`,
      )
      .bind(...values),
    db
      .prepare(
        `SELECT l.entry_id, l.account_code, l.amount_cents, l.note, l.asset_id FROM ledger_lines l
         WHERE l.entry_id IN (SELECT e.id FROM ledger_entries e WHERE ${where}) ORDER BY l.id`,
      )
      .bind(...values),
    // The visible attachments of all those entries in one query, not one per entry.
    db
      .prepare(
        `SELECT a.id, a.entry_id, a.filename, a.content_type, a.size_bytes, a.uploaded_at FROM ledger_attachments a
         WHERE a.hidden_at IS NULL AND a.entry_id IN (SELECT e.id FROM ledger_entries e WHERE ${where}) ORDER BY a.uploaded_at, a.rowid`,
      )
      .bind(...values),
  ];
}

function toEntries(entries: D1Result, lines: D1Result, attachments: D1Result): Entry[] {
  const linesOf = new Map<string, EntryLine[]>();
  for (const row of lines.results as LineRow[]) {
    const list = linesOf.get(row.entry_id) ?? [];
    list.push({ accountCode: row.account_code, amountCents: row.amount_cents, note: row.note, assetId: row.asset_id });
    linesOf.set(row.entry_id, list);
  }
  const attachmentsOf = new Map<string, Attachment[]>();
  for (const row of attachments.results as AttachmentRow[]) {
    const list = attachmentsOf.get(row.entry_id) ?? [];
    list.push({ id: row.id, filename: row.filename, contentType: row.content_type, sizeBytes: row.size_bytes, uploadedAt: row.uploaded_at });
    attachmentsOf.set(row.entry_id, list);
  }
  return (entries.results as EntryRow[]).map((row) => ({ ...toEntry(row), lines: linesOf.get(row.id) ?? [], attachments: attachmentsOf.get(row.id) ?? [] }));
}

/** An entry's own fields; its lines and attachments are added by the caller. */
function toEntry(row: EntryRow): Omit<Entry, "lines" | "attachments"> {
  return {
    id: row.id,
    year: row.year,
    number: row.number,
    date: row.date,
    description: row.description,
    source: row.source,
    sourceRef: row.source_ref,
    editable: EDITABLE_SOURCES.includes(row.source) && row.year_status === "open",
    changed: row.changed === 1,
  };
}

async function readEntries(db: D1Database, where: string, values: unknown[]): Promise<Entry[]> {
  const [entries, lines, attachments] = await db.batch(entryReads(db, where, values));
  return toEntries(entries!, lines!, attachments!);
}

const BY_SOURCE = "e.source = ? AND e.source_ref = ?";

export async function getEntry(db: D1Database, id: string): Promise<Entry | null> {
  return (await readEntries(db, "e.id = ?", [id]))[0] ?? null;
}

/** The entries of a year, by date and number. `amountCents` finds a line of that size, debit or credit. */
export async function listEntries(
  db: D1Database,
  filter: { year: number; accountCode?: string; from?: string; to?: string; text?: string; amountCents?: number },
): Promise<Entry[]> {
  const where = ["e.year = ?"];
  const values: unknown[] = [filter.year];
  if (filter.from) {
    where.push("e.date >= ?");
    values.push(filter.from);
  }
  if (filter.to) {
    where.push("e.date <= ?");
    values.push(filter.to);
  }
  if (filter.text) {
    where.push("instr(lower(e.description), lower(?)) > 0");
    values.push(filter.text);
  }
  if (filter.accountCode) {
    where.push("EXISTS (SELECT 1 FROM ledger_lines x WHERE x.entry_id = e.id AND x.account_code = ?)");
    values.push(filter.accountCode);
  }
  if (filter.amountCents !== undefined) {
    where.push("EXISTS (SELECT 1 FROM ledger_lines x WHERE x.entry_id = e.id AND abs(x.amount_cents) = abs(?))");
    values.push(filter.amountCents);
  }
  return readEntries(db, where.join(" AND "), values);
}

export async function entryHistory(db: D1Database, id: string): Promise<EntryChange[]> {
  const { results } = await db
    .prepare("SELECT at, before_json, after_json, note FROM ledger_history WHERE entry_id = ? ORDER BY id")
    .bind(id)
    .all<{ at: string; before_json: string | null; after_json: string; note: string | null }>();
  return results.map((row) => ({
    at: row.at,
    note: row.note,
    before: row.before_json === null ? null : (JSON.parse(row.before_json) as EntryChange["before"]),
    after: JSON.parse(row.after_json) as EntryChange["after"],
  }));
}

/**
 * A page of the year's entries for the jaaroverzicht: those numbered after `after`, by number, at most `limit`, with
 * their lines and visible attachments. One statement through the index on (year, number), each entry's lines and
 * attachments gathered as JSON beside it: what a page reads stays at its entries, their lines and one step past
 * each entry's lines, however large the year is. (Sorting inside the aggregate would read every line once more, so
 * the rows carry their id and are put in order here.)
 */
export async function entriesPage(db: D1Database, year: number, after: number, limit: number): Promise<Entry[]> {
  const { results } = await db
    .prepare(
      `SELECT e.id, e.year, e.number, e.date, e.description, e.source, e.source_ref,
         (SELECT status FROM ledger_years WHERE year = ?1) AS year_status,
         EXISTS (SELECT 1 FROM ledger_history h WHERE h.entry_id = e.id) AS changed,
         (SELECT json_group_array(json_array(l.id, l.account_code, l.amount_cents, l.note, l.asset_id))
          FROM ledger_lines l WHERE l.entry_id = e.id) AS lines_json,
         (SELECT json_group_array(json_array(a.rowid, a.id, a.filename, a.content_type, a.size_bytes, a.uploaded_at))
          FROM ledger_attachments a WHERE a.entry_id = e.id AND a.hidden_at IS NULL) AS attachments_json
       FROM ledger_entries e WHERE e.year = ?1 AND e.number > ?2 ORDER BY e.number LIMIT ?3`,
    )
    .bind(year, after, limit)
    .all<EntryRow & { lines_json: string; attachments_json: string }>();
  type LineJson = [id: number, accountCode: string, amountCents: number, note: string | null, assetId: string | null];
  type AttachmentJson = [rowid: number, id: string, filename: string, contentType: string, sizeBytes: number, uploadedAt: string];
  return results.map((row) => ({
    ...toEntry(row),
    lines: (JSON.parse(row.lines_json) as LineJson[])
      .sort((a, b) => a[0] - b[0])
      .map(([, accountCode, amountCents, note, assetId]) => ({ accountCode, amountCents, note, assetId })),
    attachments: (JSON.parse(row.attachments_json) as AttachmentJson[])
      .sort((a, b) => a[5].localeCompare(b[5]) || a[0] - b[0])
      .map(([, id, filename, contentType, sizeBytes, uploadedAt]) => ({ id, filename, contentType, sizeBytes, uploadedAt })),
  }));
}

/**
 * A page of the history of the year's entries for the jaaroverzicht: the changes after `after`, by id, at most
 * `limit`. The history leads (CROSS JOIN keeps it the outer loop), so a page reads from `after` on and never the
 * whole year's entries.
 */
export async function changesPage(db: D1Database, year: number, after: number, limit: number): Promise<YearChange[]> {
  const { results } = await db
    .prepare(
      `SELECT h.id, h.entry_id, e.number, h.at, h.before_json, h.after_json, h.note FROM ledger_history h
       CROSS JOIN ledger_entries e ON e.id = h.entry_id WHERE h.id > ?2 AND e.year = ?1 ORDER BY h.id LIMIT ?3`,
    )
    .bind(year, after, limit)
    .all<{ id: number; entry_id: string; number: number; at: string; before_json: string | null; after_json: string; note: string | null }>();
  return results.map((row) => ({
    id: row.id,
    entryId: row.entry_id,
    number: row.number,
    at: row.at,
    note: row.note,
    before: row.before_json === null ? null : (JSON.parse(row.before_json) as EntryChange["before"]),
    after: JSON.parse(row.after_json) as EntryChange["after"],
  }));
}

/** The content of an entry as the history keeps it; attachments.ts writes the line for a hidden attachment with it. */
export const entrySnapshot = snapshot;

export async function yearStatus(db: D1Database, year: number): Promise<"open" | "closed" | null> {
  const row = await db.prepare("SELECT status FROM ledger_years WHERE year = ?").bind(year).first<{ status: "open" | "closed" }>();
  return row?.status ?? null;
}

/** The lowest open year: where something that arrives late for a closed year is booked. */
export async function firstOpenYear(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE((SELECT MIN(year) FROM ledger_years WHERE status = 'open'), (SELECT MAX(year) + 1 FROM ledger_years), ?) AS year`,
    )
    .bind(yearOf(LEDGER_START))
    .first<{ year: number }>();
  return row!.year;
}

/** Sum of all lines per account with date <= `upTo`. */
export async function balancesOn(db: D1Database, upTo: string): Promise<Map<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT l.account_code, SUM(l.amount_cents) AS cents FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
       WHERE e.date <= ? GROUP BY l.account_code`,
    )
    .bind(upTo)
    .all<{ account_code: string; cents: number }>();
  return new Map(results.map((row) => [row.account_code, row.cents]));
}

// ---- Writing ----
// Every statement that writes checks again that the years it touches are open, so that a year closed between
// the checks and the write, or a statement batched by a sync without checks, still leaves a closed year alone.

const open = (year: string) => `EXISTS (SELECT 1 FROM ledger_years WHERE year = ${year} AND status = 'open')`;

/** Which entry a write is about, as a condition on `ledger_entries`. */
type Key = { where: string; values: unknown[] };
const byId = (id: string): Key => ({ where: "id = ?", values: [id] });
const bySource = (source: EntrySource, ref: string): Key => ({ where: "source = ? AND source_ref = ?", values: [source, ref] });

/** A year from 2026 on gets its row, open, with its first entry. */
const openYear = (db: D1Database, year: number) => db.prepare("INSERT OR IGNORE INTO ledger_years (year, status) VALUES (?, 'open')").bind(year);

/** The number is taken inside the insert, so two writers never share one. */
function insertEntry(db: D1Database, id: string, year: number, input: NewEntry, nowIso: string, ifMissing: boolean): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO ledger_entries (id, year, number, date, description, source, source_ref, created_at, updated_at)
       SELECT ?1, ?2, next.number, ?3, ?4, ?5, ?6, ?7, ?7
       FROM (SELECT COALESCE(MAX(number), 0) + 1 AS number FROM ledger_entries WHERE year = ?2) AS next
       WHERE ${open("?2")}${ifMissing ? " ON CONFLICT (source, source_ref) DO NOTHING" : ""}`,
    )
    .bind(id, year, input.date, input.description, input.source, input.sourceRef ?? null, nowIso);
}

/** The condition on `ledger_entries` for writing the entry `key` names into `year` (bound after `key.values`). */
const writable = (key: Key) => `${key.where} AND ${open("ledger_entries.year")} AND ${open("?")}`;

function lineStatements(db: D1Database, key: Key, year: number, lines: EntryLine[]): D1PreparedStatement[] {
  return lines.map((line) =>
    db
      .prepare(
        `INSERT INTO ledger_lines (entry_id, account_code, amount_cents, note, asset_id)
         SELECT id, ?, ?, ?, ? FROM ledger_entries WHERE ${writable(key)}`,
      )
      .bind(line.accountCode, line.amountCents, line.note ?? null, line.assetId ?? null, ...key.values, year),
  );
}

/** Gives the entry `key` names a new date, description and lines. Moved to another year, it gets the next number there. */
function replaceStatements(db: D1Database, key: Key, year: number, content: Content, nowIso: string): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE ledger_entries SET
           number = CASE WHEN year = ? THEN number ELSE (SELECT COALESCE(MAX(other.number), 0) + 1 FROM ledger_entries other WHERE other.year = ?) END,
           year = ?, date = ?, description = ?, updated_at = ?
         WHERE ${writable(key)}`,
      )
      .bind(year, year, year, content.date, content.description, nowIso, ...key.values, year),
    db.prepare(`DELETE FROM ledger_lines WHERE entry_id IN (SELECT id FROM ledger_entries WHERE ${writable(key)})`).bind(...key.values, year),
    ...lineStatements(db, key, year, content.lines),
  ];
}

export async function createEntry(db: D1Database, input: NewEntry, now: Date): Promise<Entry> {
  const year = checkContent(input);
  checkResults(await db.batch(checkReads(db, year, input.lines)), input.lines, input.source === "manual");
  const id = crypto.randomUUID();
  try {
    await db.batch([openYear(db, year), insertEntry(db, id, year, input, now.toISOString(), false), ...lineStatements(db, byId(id), year, input.lines)]);
  } catch (error) {
    if (/UNIQUE constraint failed: ledger_entries\.source/.test(String(error))) throw new LedgerError("entry_exists", 409);
    throw error;
  }
  const entry = await getEntry(db, id);
  if (!entry) throw new LedgerError("year_closed", 409); // closed between the check and the write
  return entry;
}

/** The bank line a `bank` entry books, as far as an edit needs to know it. */
type BankLineFacts = { account_code: string; amount_cents: number; booking_date: string; status: string; entry_id: string | null };

/**
 * A `bank` entry books what the bank gave (R37): it keeps the line on the bank's money account, with the bank's
 * amount, and the bank's date; only the other side, the notes and the description may change. Emptied, it books
 * nothing and its line goes back to Te boeken. Filled again (Wijzigen on the emptied entry, or booking the line),
 * it may not book a line that another entry has booked meanwhile (a payout of Mollie): the money would count twice.
 */
function checkBankLine(line: BankLineFacts, id: string, next: Content): void {
  if (next.lines.length === 0) return;
  const own = next.lines.filter((one) => one.accountCode === line.account_code);
  if (next.date !== line.booking_date || own.length !== 1 || own[0]!.amountCents !== line.amount_cents) {
    throw new LedgerError("bank_line_fixed", 409);
  }
  if (line.status === "booked" && line.entry_id !== id) throw new LedgerError("not_editable", 409);
}

/**
 * The bank line follows its entry, in the same batch and only once the entry's lines are written: emptied, the
 * line is open again (and in Te boeken, where booking it fills this same entry); filled, it is booked by this entry.
 */
function bankLineFollows(db: D1Database, lineId: string, id: string, emptied: boolean): D1PreparedStatement {
  return emptied
    ? db
        .prepare(
          `UPDATE bank_lines SET status = 'open', entry_id = NULL, waiting_for = NULL
           WHERE id = ?1 AND status = 'booked' AND entry_id = ?2 AND NOT EXISTS (SELECT 1 FROM ledger_lines WHERE entry_id = ?2)`,
        )
        .bind(lineId, id)
    : db
        .prepare(
          `UPDATE bank_lines SET status = 'booked', entry_id = ?2, waiting_for = NULL
           WHERE id = ?1 AND (status IN ('open', 'waiting') OR entry_id = ?2) AND EXISTS (SELECT 1 FROM ledger_lines WHERE entry_id = ?2)`,
        )
        .bind(lineId, id);
}

/** Changes an entry of the penningmeester and keeps what it was in the history. Unchanged, it writes nothing. */
async function change(db: D1Database, id: string, content: (entry: Entry) => Content, now: Date): Promise<Entry> {
  const entry = await getEntry(db, id);
  if (!entry) throw new LedgerError("not_found", 404);
  if (!EDITABLE_SOURCES.includes(entry.source)) throw new LedgerError("not_editable", 409);
  if (!entry.editable) throw new LedgerError("year_closed", 409); // an editable source in a year that is not open
  const next = content(entry);
  const year = checkContent(next);
  if (sameContent(entry, next)) return entry;
  const lineId = entry.source === "bank" ? entry.sourceRef : null;
  const checks = await db.batch([
    ...checkReads(db, year, next.lines, entry.lines),
    ...(lineId === null
      ? []
      : [db.prepare("SELECT account_code, amount_cents, booking_date, status, entry_id FROM bank_lines WHERE id = ?").bind(lineId)]),
  ]);
  checkResults(checks, next.lines, entry.source === "manual");
  checkDisposed(checks[2]!, entry.lines, next.lines);
  const line = lineId === null ? undefined : (checks[3]!.results[0] as BankLineFacts | undefined);
  if (line) checkBankLine(line, id, next);
  const nowIso = now.toISOString();
  await db.batch([
    openYear(db, year),
    db
      .prepare(`INSERT INTO ledger_history (entry_id, at, before_json, after_json) SELECT id, ?, ?, ? FROM ledger_entries WHERE ${writable(byId(id))}`)
      .bind(nowIso, JSON.stringify(snapshot(entry)), JSON.stringify(snapshot(next)), id, year),
    ...replaceStatements(db, byId(id), year, next, nowIso),
    ...(line ? [bankLineFollows(db, lineId!, id, next.lines.length === 0)] : []),
  ]);
  return (await getEntry(db, id))!;
}

/** By the penningmeester: only `manual` and `bank` entries, history kept. */
export function editEntry(db: D1Database, id: string, input: Content, now: Date): Promise<Entry> {
  return change(db, id, () => input, now);
}

/** Deleting is emptying: the entry keeps its number and its history, without lines. A `bank` entry's line goes back to Te boeken. */
export function emptyEntry(db: D1Database, id: string, now: Date): Promise<Entry> {
  return change(db, id, (entry) => ({ date: entry.date, description: entry.description, lines: [] }), now);
}

/** By a sync: creates the entry for (source, sourceRef) or replaces its lines; no history; nothing when unchanged. */
export async function upsertSourced(db: D1Database, input: NewEntry & { sourceRef: string }, now: Date): Promise<Entry> {
  const year = checkContent(input);
  const [entries, lines, attachments, ...checks] = await db.batch([
    ...entryReads(db, BY_SOURCE, [input.source, input.sourceRef]),
    ...checkReads(db, year, input.lines),
  ]);
  const existingRow = entries!.results[0] as EntryRow | undefined;
  if (existingRow && existingRow.year_status !== "open") throw new LedgerError("year_closed", 409);
  checkResults(checks, input.lines, false);
  const existing = toEntries(entries!, lines!, attachments!)[0];
  if (existing && sameContent(existing, input)) return existing;
  await db.batch(upsertSourcedStatements(db, input, existing ? { id: existing.id } : null, now));
  const [entry] = await readEntries(db, BY_SOURCE, [input.source, input.sourceRef]);
  if (!entry) throw new LedgerError("year_closed", 409); // closed between the check and the write
  return entry;
}

/**
 * The same as statements, so a sync can write many entries in one batch. It checks the lines and the date (a
 * toestel only on 0130 or 0135), not the accounts (the database refuses an unknown one), not that a toestel it
 * names exists (the caller's own) and not whether it changes anything: a closed year it leaves alone without a
 * word, so the caller looks at `yearStatus` first.
 */
export function upsertSourcedStatements(
  db: D1Database,
  input: NewEntry & { sourceRef: string },
  existing: { id: string } | null,
  now: Date,
): D1PreparedStatement[] {
  const year = checkContent(input);
  const nowIso = now.toISOString();
  return [
    openYear(db, year),
    ...(existing ? [] : [insertEntry(db, crypto.randomUUID(), year, input, nowIso, true)]),
    ...replaceStatements(db, existing ? byId(existing.id) : bySource(input.source, input.sourceRef), year, input, nowIso),
  ];
}
