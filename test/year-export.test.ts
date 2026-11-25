import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { PastedAsset } from "../shared/asset-paste";
import type { Entry, EntryLine, YearChange, YearExport } from "../shared/ledger-types";
import { addPastedAssets, bookDepreciation, depreciationPlan, listAssets } from "../worker/db/assets";
import { addAttachment, hideAttachment } from "../worker/db/attachments";
import { recordBalance } from "../worker/db/bank";
import { createEntry, editEntry } from "../worker/db/ledger";
import { balanceReport, resultReport } from "../worker/db/ledger-reports";
import { setOpening } from "../worker/db/opening";
import { closeYear, reopenYear, yearChecks, yearExport } from "../worker/db/year";
import { api, asAdmin, meteredDb, resetData } from "./helpers";

// The jaaroverzicht (spec §13): what the browser needs to write the Excel file, the PDF and the zip, read in one call,
// with the entries and the changes in pages so a large year stays within the Worker's limits.

beforeEach(resetData);

const BEFORE = new Date("2026-06-01T12:00:00.000Z");
const NOW = new Date("2027-01-15T12:00:00.000Z");
const LATER = new Date("2027-02-03T09:00:00.000Z");
const AGAIN = new Date("2027-02-04T09:00:00.000Z");
const path = "/api/admin/boekhouding";

const move = (debit: string, credit: string, cents: number): EntryLine[] => [
  { accountCode: debit, amountCents: cents, note: null, assetId: null },
  { accountCode: credit, amountCents: -cents, note: null, assetId: null },
];
const book = (date: string, lines: EntryLine[], description = "Boeking", now = BEFORE) => createEntry(env.DB, { date, description, source: "manual", lines }, now);
const STRAALJAGER: PastedAsset = { name: "Straaljager", purchaseDate: "2008-01-01", costCents: 949600, writtenOffCents: 902120, lifeYears: 20 };

it("gives the year's figures for the overview", async () => {
  await addPastedAssets(env.DB, [STRAALJAGER], BEFORE);
  await setOpening(env.DB, 2026, { lines: [{ accountCode: "1010", amountCents: 500000 }, { accountCode: "1700", amountCents: 30000 }], eBoekhoudenEquityCents: null }, BEFORE);
  // R35: the opening is what stood before 1 January plus the year's own opening entry, not what else is dated that day.
  const atStart = await balanceReport(env.DB, "2026-01-01");
  await book("2026-01-01", move("1010", "8012", 12000), "Entree op nieuwjaarsdag");
  await book("2026-03-01", move("4514", "1010", 2500), "Diversen");
  await book("2026-12-31", move("1010", "8030", 300), "Rente");
  await bookDepreciation(env.DB, 2026, BEFORE);
  await recordBalance(env.DB, "1030", { date: "2026-12-31", cents: 0 }, "mollie");
  await closeYear(env, 2026, "Kas volgt", NOW);
  await reopenYear(env.DB, 2026, "Kascommissie vond een fout", LATER);
  await closeYear(env, 2026, "Kas volgt", AGAIN);
  const atStart2027 = await balanceReport(env.DB, "2027-01-01");
  await book("2027-01-01", move("1010", "8012", 700), "Entree 2027", NOW);
  await book("2027-02-01", move("1010", "8012", 1500), "Entree februari", NOW);

  const closed = await yearExport(env, 2026, AGAIN);
  expect(closed).toEqual({
    year: 2026,
    status: "closed",
    opening: atStart,
    closing: await balanceReport(env.DB, "2026-12-31"),
    result: await resultReport(env.DB, "2026-01-01", "2026-12-31"),
    checks: await yearChecks(env, 2026, AGAIN),
    events: [
      { at: NOW.toISOString(), kind: "closed", note: "Kas volgt" },
      { at: LATER.toISOString(), kind: "reopened", note: "Kascommissie vond een fout" },
      { at: AGAIN.toISOString(), kind: "closed", note: "Kas volgt" },
    ],
    assets: await listAssets(env.DB, "2026-12-31"),
    depreciation: await depreciationPlan(env.DB, 2026),
    // The opening, three of his own, the depreciation and the closing entry.
    entryCount: 6,
    accounts: expect.any(Array),
  } satisfies YearExport);
  expect(closed.opening).toMatchObject({ date: "2026-01-01", resultCents: 0 });
  expect(Object.fromEntries(closed.opening.rows.map((row) => [row.code, row.cents]))).toEqual({ "0130": 949600, "0135": -902120, "1010": 500000, "1400": 517480, "1700": 30000 });
  // The closing balance keeps the year's result apart (R8); the result report stands as before closing.
  expect(closed.closing.resultCents).toBe(closed.result.resultCents);
  expect(closed.result.resultCents).toBe(12000 - 2500 + 300 - closed.depreciation.totalCents);
  expect(closed.depreciation).toMatchObject({ year: 2026, booked: true, upToDate: true });
  expect(closed.assets.map((asset) => asset.name)).toEqual(["Straaljager"]);
  expect(closed.accounts.find((account) => account.code === "1010")).toEqual({ code: "1010", name: "ING betaalrekening", kind: "asset" });

  // An open year: what stood on 1 January, the result of 2026 in 1400; the entry of that day left out.
  const open = await yearExport(env, 2027, AGAIN);
  expect(open).toMatchObject({ year: 2027, status: "open", events: [], entryCount: 2 });
  expect(open.opening).toEqual(atStart2027);
  expect(open.opening.resultCents).toBe(0);
  expect(open.closing).toEqual(await balanceReport(env.DB, "2027-12-31"));
  expect(open.result).toEqual(await resultReport(env.DB, "2027-01-01", "2027-12-31"));
  expect(open.result.previousResultCents).toBe(closed.result.resultCents);

  // Through beheer, behind the login, in a handful of calls.
  const { cookie } = await asAdmin();
  expect((await api(`${path}/year/2026/export`)).status).toBe(401);
  const metered = meteredDb(env.DB);
  const answer = await api(`${path}/year/2026/export`, { cookie, env: { DB: metered.db } });
  expect(answer.status).toBe(200);
  expect(await answer.json()).toEqual(JSON.parse(JSON.stringify(closed)));
  expect(metered.calls()).toBeLessThanOrEqual(12);
  expect((await api(`${path}/year/abcd/export`, { cookie })).status).toBe(400);
  expect(await (await api(`${path}/year/2025/export`, { cookie })).json()).toEqual({ error: "year_unknown" });
  expect(await (await api(`${path}/year/2030/export`, { cookie })).json()).toEqual({ error: "year_unknown" });
});

/** `count` entries of 2026 numbered 1, 2, …, each with two lines, written straight into the tables. */
async function manyEntries(count: number) {
  // The seed holds a row for 2027 only; a year of entries written straight into the tables needs its own row.
  const statements: D1PreparedStatement[] = [env.DB.prepare("INSERT OR IGNORE INTO ledger_years (year, status) VALUES (2026, 'open')")];
  for (let i = 1; i <= count; i++) {
    const id = `e${i}`;
    const date = `2026-${String((i % 12) + 1).padStart(2, "0")}-10`;
    statements.push(
      env.DB.prepare("INSERT INTO ledger_entries (id, year, number, date, description, source, source_ref, created_at, updated_at) VALUES (?, 2026, ?, ?, ?, 'manual', NULL, 'a', 'a')").bind(id, i, date, `Boeking ${i}`),
      env.DB.prepare("INSERT INTO ledger_lines (entry_id, account_code, amount_cents) VALUES (?, '1010', ?), (?, '8010', ?)").bind(id, i, id, -i),
    );
  }
  for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));
}

it("pages the entries so a large year still fits", async () => {
  await manyEntries(1200);
  const pdf = new TextEncoder().encode("%PDF-1.4 bon").buffer as ArrayBuffer;
  const file = (filename: string) => ({ filename, contentType: "application/pdf", body: pdf, sizeBytes: pdf.byteLength });
  const bon = await addAttachment(env, "e7", file("bon-goodoo.pdf"), BEFORE);
  const hidden = await addAttachment(env, "e8", file("verkeerd.pdf"), BEFORE);
  await hideAttachment(env, hidden.id, BEFORE);
  await editEntry(env.DB, "e9", { date: "2026-10-10", description: "Boeking 9, verbeterd", lines: move("1010", "8010", 9) }, BEFORE);
  // An entry of 2027 is not in 2026's pages.
  await book("2027-01-05", move("1010", "8010", 100), "Volgend jaar");

  const { cookie } = await asAdmin();
  const pages: Entry[][] = [];
  let after = 0;
  for (;;) {
    const metered = meteredDb(env.DB);
    const answer = await api(`${path}/year/2026/entries?after=${after}&limit=500`, { cookie, env: { DB: metered.db } });
    expect(answer.status).toBe(200);
    const page = await answer.json<Entry[]>();
    // What a page reads follows the page, not the year: per entry of two lines D1 counts four rows (the entry, its
    // lines and the step past them), so 2.000 for a full page; then the few attachments and changes found, the login.
    expect(metered.rowsRead()).toBeLessThanOrEqual(4 * page.length + 10);
    expect(metered.calls()).toBeLessThanOrEqual(2);
    pages.push(page);
    if (page.length < 500) break;
    after = page.at(-1)!.number;
  }
  expect(pages.map((page) => page.length)).toEqual([500, 500, 200]);
  const all = pages.flat();
  expect(all.map((entry) => entry.number)).toEqual(Array.from({ length: 1200 }, (_, i) => i + 1));
  const byNumber = (number: number) => all.find((entry) => entry.number === number)!;
  expect(byNumber(1)).toEqual({
    id: "e1",
    year: 2026,
    number: 1,
    date: "2026-02-10",
    description: "Boeking 1",
    source: "manual",
    sourceRef: null,
    lines: move("1010", "8010", 1),
    attachments: [],
    editable: true,
    changed: false,
  });
  expect(byNumber(7).attachments).toEqual([bon]);
  // A hidden attachment stays out; a changed entry says so.
  expect(byNumber(8).attachments).toEqual([]);
  expect(byNumber(9)).toMatchObject({ description: "Boeking 9, verbeterd", changed: true });
  expect(byNumber(1200).lines).toEqual(move("1010", "8010", 1200));

  // At most 500 a page; a page is asked for after a number.
  expect((await (await api(`${path}/year/2026/entries?after=1190`, { cookie })).json<Entry[]>()).map((entry) => entry.number)).toEqual([
    1191, 1192, 1193, 1194, 1195, 1196, 1197, 1198, 1199, 1200,
  ]);
  expect(await (await api(`${path}/year/2026/entries?after=0&limit=2`, { cookie })).json<Entry[]>()).toHaveLength(2);
  expect(await (await api(`${path}/year/2026/entries?after=1200`, { cookie })).json()).toEqual([]);
  expect((await api(`${path}/year/2027/entries?after=0`, { cookie })).status).toBe(200);
  for (const wrong of ["after=0&limit=501", "after=0&limit=0", "after=-1", "after=abc", "after=0&limit=1.5"]) {
    expect((await api(`${path}/year/2026/entries?${wrong}`, { cookie })).status).toBe(400);
  }
  expect((await api(`${path}/year/abcd/entries?after=0`, { cookie })).status).toBe(400);
  expect((await api(`${path}/year/2026/entries?after=0`)).status).toBe(401);
});

it("pages the changes of the year's entries", async () => {
  // A large year, mostly unchanged: a page of changes does not read its entries.
  await manyEntries(1200);
  const first = await book("2026-02-01", move("1010", "8012", 1000), "Entree");
  const other = await book("2027-02-01", move("1010", "8012", 50), "Entree 2027");
  const rows: D1PreparedStatement[] = [];
  const snapshot = (description: string) => JSON.stringify({ date: "2026-02-01", description, lines: move("1010", "8012", 1000) });
  for (let i = 1; i <= 600; i++) {
    rows.push(
      env.DB.prepare("INSERT INTO ledger_history (entry_id, at, before_json, after_json, note) VALUES (?, ?, ?, ?, NULL)").bind(first.id, `2026-03-01T10:00:00.000Z`, snapshot(`Entree ${i - 1}`), snapshot(`Entree ${i}`)),
    );
    if (i % 100 === 0) rows.push(env.DB.prepare("INSERT INTO ledger_history (entry_id, at, before_json, after_json, note) VALUES (?, 'x', NULL, '{}', 'anders jaar')").bind(other.id));
  }
  for (let i = 0; i < rows.length; i += 100) await env.DB.batch(rows.slice(i, i + 100));

  const { cookie } = await asAdmin();
  const pages: YearChange[][] = [];
  let after = 0;
  for (;;) {
    const metered = meteredDb(env.DB);
    const answer = await api(`${path}/year/2026/changes?after=${after}`, { cookie, env: { DB: metered.db } });
    expect(answer.status).toBe(200);
    const page = await answer.json<YearChange[]>();
    expect(metered.rowsRead()).toBeLessThanOrEqual(3 * page.length + 20);
    pages.push(page);
    if (page.length < 500) break;
    after = page.at(-1)!.id;
  }
  expect(pages.map((page) => page.length)).toEqual([500, 100]);
  const all = pages.flat();
  expect(all.every((change) => change.entryId === first.id && change.number === first.number)).toBe(true);
  expect(all.map((change) => change.id)).toEqual([...all.map((change) => change.id)].sort((a, b) => a - b));
  expect(all[0]).toEqual({
    id: all[0]!.id,
    entryId: first.id,
    number: first.number,
    at: "2026-03-01T10:00:00.000Z",
    note: null,
    before: { date: "2026-02-01", description: "Entree 0", lines: move("1010", "8012", 1000) },
    after: { date: "2026-02-01", description: "Entree 1", lines: move("1010", "8012", 1000) },
  });
  expect(all.at(-1)!.after.description).toBe("Entree 600");
  for (const wrong of ["after=-1", "after=abc"]) expect((await api(`${path}/year/2026/changes?${wrong}`, { cookie })).status).toBe(400);
  expect((await api(`${path}/year/2026/changes?after=0`)).status).toBe(401);
});
