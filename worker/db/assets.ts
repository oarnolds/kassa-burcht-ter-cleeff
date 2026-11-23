import type { PastedAsset } from "../../shared/asset-paste";
import { MAX_LIFE_YEARS } from "../../shared/asset-paste";
import { depreciationFor } from "../../shared/depreciation";
import { type Asset, type DepreciationPlan, type Entry, type EntryLine, LEDGER_START } from "../../shared/ledger-types";
import { getEntry, LedgerError, upsertSourced, upsertSourcedStatements } from "./ledger";
import { getOpening, setOpening } from "./opening";

// The speeltoestellen and inventaris (spec §12): the list behind 0130 and 0135, the yearly depreciation (debit 4601,
// credit 0135 per toestel) and a disposal. A toestel pasted from e-Boekhouden is an "opening" toestel (its cost and
// what was written off up to 2026 are in its row); one bought later gets its cost from its 0130 lines.

export type { Asset, DepreciationPlan };

const COST = "0130";
const WRITTEN_OFF = "0135";
const DEPRECIATION = "4601";

/** Every line, whatever its date: the list as it stands with everything booked so far. */
export const ALL_DATES = "9999-12-31";

const FIRST_YEAR = Number(LEDGER_START.slice(0, 4));
const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

const yearOf = (date: string) => Number(date.slice(0, 4));
const lastDay = (year: number) => `${year}-12-31`;

type AssetRow = {
  id: string;
  name: string;
  purchase_date: string | null;
  cost_cents: number | null;
  residual_cents: number;
  life_years: number;
  opening_written_off_cents: number;
  disposed_on: string | null;
  bought_cents: number;
  first_bought: string | null;
  depreciated_cents: number;
};

/**
 * The toestellen (or one) with their 0130 and 0135 lines dated up to `upTo`. The lines of a toestel's own disposal
 * are left out: they take it off the books, which the list shows as "afgevoerd" instead.
 */
function assetsStatement(db: D1Database, upTo: string, id: string | null = null): D1PreparedStatement {
  return db
    .prepare(
      `WITH booked AS (
         SELECT l.asset_id, l.account_code, l.amount_cents, e.date FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
         WHERE l.asset_id IS NOT NULL AND l.account_code IN ('${COST}', '${WRITTEN_OFF}') AND e.date <= ?1 AND e.source <> 'disposal'
       )
       SELECT a.id, a.name, a.purchase_date, a.cost_cents, a.residual_cents, a.life_years, a.opening_written_off_cents, a.disposed_on,
         COALESCE(SUM(CASE WHEN b.account_code = '${COST}' THEN b.amount_cents END), 0) AS bought_cents,
         MIN(CASE WHEN b.account_code = '${COST}' THEN b.date END) AS first_bought,
         COALESCE(SUM(CASE WHEN b.account_code = '${WRITTEN_OFF}' THEN b.amount_cents END), 0) AS depreciated_cents
       FROM assets a LEFT JOIN booked b ON b.asset_id = a.id
       WHERE ?2 IS NULL OR a.id = ?2
       GROUP BY a.id`,
    )
    .bind(upTo, id);
}

function toAsset(row: AssetRow, upTo: string): Asset {
  const costCents = (row.cost_cents ?? 0) + row.bought_cents;
  const gone = row.disposed_on !== null && row.disposed_on <= upTo;
  const writtenOffCents = gone ? costCents : row.opening_written_off_cents - row.depreciated_cents;
  return {
    id: row.id,
    name: row.name,
    purchaseDate: row.purchase_date ?? row.first_bought,
    costCents,
    residualCents: row.residual_cents,
    lifeYears: row.life_years,
    writtenOffCents,
    bookValueCents: costCents - writtenOffCents,
    disposedOn: row.disposed_on,
  };
}

/** By purchase date (a toestel without one last), then by name. */
function toAssets(result: D1Result, upTo: string): Asset[] {
  return (result.results as AssetRow[])
    .map((row) => toAsset(row, upTo))
    .sort(
      (a, b) =>
        (a.purchaseDate ?? "9999").localeCompare(b.purchaseDate ?? "9999") || a.name.localeCompare(b.name, "nl") || a.id.localeCompare(b.id),
    );
}

/** The list as it stood at the end of `upTo` (`ALL_DATES` for everything booked so far). */
export async function listAssets(db: D1Database, upTo: string): Promise<Asset[]> {
  return toAssets(await assetsStatement(db, upTo).run(), upTo);
}

async function readAsset(db: D1Database, id: string): Promise<Asset> {
  const [asset] = toAssets(await assetsStatement(db, ALL_DATES, id).run(), ALL_DATES);
  if (!asset) throw new LedgerError("asset_unknown", 404);
  return asset;
}

const validName = (name: unknown, max: number): name is string => typeof name === "string" && name.trim().length >= 1 && name.trim().length <= max;
const validYears = (years: unknown): years is number => Number.isInteger(years) && (years as number) >= 1 && (years as number) <= MAX_LIFE_YEARS;
const validCents = (cents: unknown): cents is number => Number.isSafeInteger(cents) && (cents as number) >= 0;

/**
 * Takes the list pasted from e-Boekhouden as the opening toestellen (R31): it replaces the toestellen pasted before
 * (a residual value already typed is kept by name), not the ones bought later, and saves the opening entry of the
 * first year again so 0130, 0135 and equity follow the list. Refused once something is booked on a pasted toestel.
 */
export async function addPastedAssets(db: D1Database, assets: PastedAsset[], now: Date): Promise<Asset[]> {
  const fine = (asset: PastedAsset) =>
    validName(asset.name, 200) &&
    /^\d{4}-\d{2}-\d{2}$/.test(asset.purchaseDate) &&
    validCents(asset.costCents) &&
    validCents(asset.writtenOffCents) &&
    validYears(asset.lifeYears);
  if (assets.length === 0 || !assets.every(fine)) throw new LedgerError("invalid", 400);

  const [disposed, depreciation, linked, year, previous] = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM assets WHERE cost_cents IS NOT NULL AND disposed_on IS NOT NULL"),
    db.prepare("SELECT COUNT(*) AS n FROM ledger_entries e WHERE e.source = 'depreciation' AND EXISTS (SELECT 1 FROM ledger_lines l WHERE l.entry_id = e.id)"),
    db.prepare("SELECT COUNT(*) AS n FROM ledger_lines l JOIN assets a ON a.id = l.asset_id WHERE a.cost_cents IS NOT NULL"),
    db.prepare("SELECT status FROM ledger_years WHERE year = ?").bind(FIRST_YEAR),
    db.prepare("SELECT name, residual_cents FROM assets WHERE cost_cents IS NOT NULL"),
  ]);
  const n = (result: D1Result | undefined) => (result!.results[0] as { n: number }).n;
  if (n(disposed) > 0) throw new LedgerError("asset_disposed", 409);
  if (n(depreciation) > 0) throw new LedgerError("depreciation_booked", 409);
  if (n(linked) > 0) throw new LedgerError("asset_linked", 409);
  if ((year!.results[0] as { status: string } | undefined)?.status === "closed") throw new LedgerError("year_closed", 409);

  const residualOf = new Map((previous!.results as { name: string; residual_cents: number }[]).map((row) => [row.name, row.residual_cents]));
  const nowIso = now.toISOString();
  await db.batch([
    db.prepare("DELETE FROM assets WHERE cost_cents IS NOT NULL"),
    ...assets.map((asset) =>
      db
        .prepare(
          `INSERT INTO assets (id, name, purchase_date, cost_cents, residual_cents, life_years, opening_written_off_cents, disposed_on, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        )
        .bind(crypto.randomUUID(), asset.name.trim(), asset.purchaseDate, asset.costCents, residualOf.get(asset.name.trim()) ?? 0, asset.lifeYears, asset.writtenOffCents, nowIso),
    ),
  ]);

  // The opening follows the list: what was typed for the other accounts and e-Boekhouden's equity stay.
  const opening = await getOpening(db, FIRST_YEAR, now);
  await setOpening(db, FIRST_YEAR, { lines: opening.lines, eBoekhoudenEquityCents: opening.eBoekhoudenEquityCents }, now);
  return listAssets(db, ALL_DATES);
}

/**
 * Without `id`: a toestel bought later, from `name`, `lifeYears` and `residualCents`; its cost comes from the
 * 0130 lines booked for it. With `id`: its name, residual value or life changed (other fields are not taken).
 * A toestel that is disposed of stays as it went. Depreciation booked in a closed year stays as booked.
 */
export async function saveAsset(db: D1Database, input: Partial<Asset> & { id?: string }, now: Date): Promise<Asset> {
  const { name, lifeYears, residualCents } = input;
  if (input.id === undefined) {
    if (!validName(name, 60) || !validYears(lifeYears) || !validCents(residualCents ?? 0)) throw new LedgerError("invalid", 400);
    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO assets (id, name, purchase_date, cost_cents, residual_cents, life_years, opening_written_off_cents, disposed_on, created_at)
         VALUES (?, ?, NULL, NULL, ?, ?, 0, NULL, ?)`,
      )
      .bind(id, name.trim(), residualCents ?? 0, lifeYears, now.toISOString())
      .run();
    return readAsset(db, id);
  }
  if ((name !== undefined && !validName(name, 60)) || (lifeYears !== undefined && !validYears(lifeYears)) || (residualCents !== undefined && !validCents(residualCents))) {
    throw new LedgerError("invalid", 400);
  }
  const current = await readAsset(db, input.id);
  if (current.disposedOn !== null) throw new LedgerError("asset_disposed", 409);
  await db
    .prepare(
      `UPDATE assets SET name = COALESCE(?, name), residual_cents = COALESCE(?, residual_cents), life_years = COALESCE(?, life_years)
       WHERE id = ? AND disposed_on IS NULL`,
    )
    .bind(name?.trim() ?? null, residualCents ?? null, lifeYears ?? null, input.id)
    .run();
  const saved = await readAsset(db, input.id);
  if (saved.disposedOn !== null) throw new LedgerError("asset_disposed", 409); // disposed of in the meantime
  return saved;
}

/** The ids the lines link to must be toestellen still in use, and only a line on 0130 buys one. For bookLine. */
export async function checkAssetLinks(db: D1Database, lines: Pick<EntryLine, "accountCode" | "assetId">[]): Promise<void> {
  const linked = lines.filter((line) => line.assetId);
  if (linked.length === 0) return;
  if (linked.some((line) => line.accountCode !== COST)) throw new LedgerError("asset_wrong_account", 400);
  const ids = [...new Set(linked.map((line) => line.assetId!))];
  const { results } = await db
    .prepare("SELECT id, disposed_on FROM assets WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(ids))
    .all<{ id: string; disposed_on: string | null }>();
  if (results.length !== ids.length) throw new LedgerError("asset_unknown", 404);
  if (results.some((row) => row.disposed_on !== null)) throw new LedgerError("asset_disposed", 409);
}

const DEPRECIATION_LINES = (year: number) =>
  `SELECT l.account_code, l.amount_cents, l.note, l.asset_id FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
   WHERE e.source = 'depreciation' AND e.source_ref = '${year}' ORDER BY l.id`;

type LineRow = { account_code: string; amount_cents: number; note: string | null; asset_id: string | null };

/** The year's depreciation per toestel; one disposed of in or before the year has none (its disposal covers it). */
function planOf(year: number, atEnd: Asset[], atStart: Asset[], bookedLines: number): DepreciationPlan {
  const before = new Map(atStart.map((asset) => [asset.id, asset.writtenOffCents]));
  const rows: DepreciationPlan["rows"] = [];
  for (const asset of atEnd) {
    if (asset.purchaseDate === null || (asset.disposedOn !== null && asset.disposedOn <= lastDay(year))) continue;
    const cents = depreciationFor({ ...asset, purchaseDate: asset.purchaseDate }, year, before.get(asset.id) ?? 0);
    if (cents !== 0) rows.push({ assetId: asset.id, name: asset.name, cents });
  }
  return { year, rows, totalCents: rows.reduce((sum, row) => sum + row.cents, 0), booked: bookedLines > 0 };
}

export async function depreciationPlan(db: D1Database, year: number): Promise<DepreciationPlan> {
  const [atEnd, atStart, booked] = await db.batch([
    assetsStatement(db, lastDay(year)),
    assetsStatement(db, lastDay(year - 1)),
    db.prepare(`SELECT COUNT(*) AS n FROM (${DEPRECIATION_LINES(year)})`),
  ]);
  return planOf(year, toAssets(atEnd!, lastDay(year)), toAssets(atStart!, lastDay(year - 1)), (booked!.results[0] as { n: number }).n);
}

/** The lines of a year's depreciation: 4601 the total, 0135 per toestel. Nothing to write off: no lines. */
function depreciationLines(rows: { assetId: string; name: string; cents: number }[]): EntryLine[] {
  const total = rows.reduce((sum, row) => sum + row.cents, 0);
  if (total === 0) return [];
  return [
    { accountCode: DEPRECIATION, amountCents: total, note: null, assetId: null },
    ...rows.map((row) => ({ accountCode: WRITTEN_OFF, amountCents: -row.cents, note: row.name, assetId: row.assetId })),
  ];
}

/** "Afschrijving {jaar} boeken": one entry on 31 December, replaced when booked again. */
export async function bookDepreciation(db: D1Database, year: number, now: Date): Promise<Entry> {
  if (year < FIRST_YEAR) throw new LedgerError("year_unknown", 400);
  const plan = await depreciationPlan(db, year);
  return upsertSourced(
    db,
    { date: lastDay(year), description: `Afschrijving speeltoestellen ${year}`, source: "depreciation", sourceRef: String(year), lines: depreciationLines(plan.rows) },
    now,
  );
}

/**
 * "Afvoeren" on `date` (R31): one entry, source disposal, ref = the toestel. 4601 gets this year's depreciation up
 * to the month of `date` and then the book value left; 0135 gives back all written off before this year and 0130
 * the cost. If the year's depreciation already holds the toestel, it is booked again without it, in the same batch.
 * The depreciation of the year before must be booked first when it has something for the toestel and can still be
 * booked: booked afterwards, it would write off again what this disposal already took to 4601.
 */
export async function disposeAsset(db: D1Database, id: string, date: string, now: Date): Promise<Entry> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new LedgerError("invalid", 400);
  if (date < LEDGER_START) throw new LedgerError("year_unknown", 400);
  const year = yearOf(date);
  const [atDate, atStart, atStartBefore, status, previousStatus, previousHeld, yearEntry, yearLines, later] = await db.batch([
    assetsStatement(db, date, id),
    assetsStatement(db, lastDay(year - 1), id),
    assetsStatement(db, lastDay(year - 2), id),
    db.prepare("SELECT status FROM ledger_years WHERE year = ?").bind(year),
    db.prepare("SELECT status FROM ledger_years WHERE year = ?").bind(year - 1),
    db.prepare(`SELECT COUNT(*) AS n FROM (${DEPRECIATION_LINES(year - 1)}) WHERE asset_id = ?`).bind(id),
    db.prepare("SELECT id, description FROM ledger_entries WHERE source = 'depreciation' AND source_ref = ?").bind(String(year)),
    db.prepare(DEPRECIATION_LINES(year)),
    // Booked on it after the day it goes (a purchase, or the depreciation of a later year): that would be left behind.
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
         WHERE l.asset_id = ?1 AND e.date > ?2 AND NOT (e.source = 'depreciation' AND e.source_ref = ?3) AND e.source <> 'disposal'`,
      )
      .bind(id, date, String(year)),
  ]);
  const asset = toAssets(atDate!, date)[0];
  if (!asset) throw new LedgerError("asset_unknown", 404);
  if (asset.disposedOn !== null) throw new LedgerError("asset_disposed", 409);
  if ((status!.results[0] as { status: string } | undefined)?.status === "closed") throw new LedgerError("year_closed", 409);
  if ((later!.results[0] as { n: number }).n > 0) throw new LedgerError("asset_booked_later", 409);

  const start = toAssets(atStart!, lastDay(year - 1))[0]!;
  const previousOpen = year - 1 >= FIRST_YEAR && (previousStatus!.results[0] as { status: string } | undefined)?.status !== "closed";
  if (previousOpen && start.purchaseDate !== null && (previousHeld!.results[0] as { n: number }).n === 0) {
    const due = depreciationFor({ ...start, purchaseDate: start.purchaseDate, disposedOn: null }, year - 1, toAssets(atStartBefore!, lastDay(year - 2))[0]!.writtenOffCents);
    if (due > 0) throw new LedgerError("depreciation_first", 409);
  }

  const writtenOffBefore = start.writtenOffCents;
  const thisYear =
    asset.purchaseDate === null ? 0 : depreciationFor({ ...asset, purchaseDate: asset.purchaseDate, disposedOn: date }, year, writtenOffBefore);
  const left = asset.costCents - writtenOffBefore - thisYear;
  const month = MONTHS[Number(date.slice(5, 7)) - 1]!;
  const lines: EntryLine[] = [
    { accountCode: DEPRECIATION, amountCents: thisYear, note: `Afschrijving ${year} t/m ${month}`, assetId: null },
    { accountCode: DEPRECIATION, amountCents: left, note: "Restwaarde afgevoerd", assetId: null },
    { accountCode: WRITTEN_OFF, amountCents: writtenOffBefore, note: null, assetId: id },
    { accountCode: COST, amountCents: -asset.costCents, note: null, assetId: id },
  ].filter((line) => line.amountCents !== 0);

  const statements = upsertSourcedStatements(db, { date, description: `Afvoer ${asset.name}`, source: "disposal", sourceRef: id, lines }, null, now);
  const existing = yearEntry!.results[0] as { id: string; description: string } | undefined;
  const held = yearLines!.results as LineRow[];
  if (existing && held.some((line) => line.asset_id === id)) {
    const rest = held
      .filter((line) => line.account_code === WRITTEN_OFF && line.asset_id !== id)
      .map((line) => ({ assetId: line.asset_id!, name: line.note ?? "", cents: -line.amount_cents }));
    statements.push(
      ...upsertSourcedStatements(
        db,
        { date: lastDay(year), description: existing.description, source: "depreciation", sourceRef: String(year), lines: depreciationLines(rest) },
        { id: existing.id },
        now,
      ),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE assets SET disposed_on = ?1 WHERE id = ?2 AND disposed_on IS NULL
           AND EXISTS (SELECT 1 FROM ledger_years WHERE year = ?3 AND status = 'open')`,
      )
      .bind(date, id, year),
  );
  await db.batch(statements);

  const row = await db.prepare("SELECT id FROM ledger_entries WHERE source = 'disposal' AND source_ref = ?").bind(id).first<{ id: string }>();
  const entry = row ? await getEntry(db, row.id) : null;
  if (!entry || entry.year !== year || entry.date !== date) throw new LedgerError("year_closed", 409); // closed between the check and the write
  return entry;
}
