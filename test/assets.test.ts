import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { PastedAsset } from "../shared/asset-paste";
import type { Asset, DepreciationPlan, Entry } from "../shared/ledger-types";
import { importLines, openLines } from "../worker/db/bank";
import { addPastedAssets, bookDepreciation, depreciationPlan, disposeAsset, listAssets, saveAsset } from "../worker/db/assets";
import { balancesOn, createEntry, getEntry, upsertSourced } from "../worker/db/ledger";
import { exportAll } from "../worker/db/maintenance";
import { getOpening, setOpening } from "../worker/db/opening";
import { api, asAdmin, resetData } from "./helpers";

// Speeltoestellen (spec §12): the list pasted from e-Boekhouden, a toestel bought from a bank line, the yearly
// depreciation and a disposal. The figures are those of the penningmeester's list of 23 November 2026.

let cookie: string;

beforeEach(async () => {
  await resetData();
  cookie = (await asAdmin()).cookie;
});

const NOW = new Date("2027-01-05T12:00:00.000Z");
const LATER = new Date("2027-12-31T12:00:00.000Z");
const YEAR_AFTER = new Date("2028-12-31T12:00:00.000Z");

const STRAALJAGER: PastedAsset = { name: "Straaljager", purchaseDate: "2008-01-01", costCents: 949600, writtenOffCents: 902120, lifeYears: 20 };
const DOME: PastedAsset = { name: "Dome - Kopan", purchaseDate: "2012-07-10", costCents: 4445721, writtenOffCents: 3072928, lifeYears: 20 };
const BANKEN: PastedAsset = { name: "Banken", purchaseDate: "2024-05-01", costCents: 584430, writtenOffCents: 38962, lifeYears: 20 };

const path = "/api/admin/boekhouding";
const get = (to: string) => api(`${path}${to}`, { cookie });
const post = (to: string, json?: unknown) => api(`${path}${to}`, { method: "POST", cookie, json });
const patch = (to: string, json: unknown) => api(`${path}${to}`, { method: "PATCH", cookie, json });
const put = (to: string, json: unknown) => api(`${path}${to}`, { method: "PUT", cookie, json });

async function entryOf(source: string, ref: string): Promise<Entry | null> {
  const row = await env.DB.prepare("SELECT id FROM ledger_entries WHERE source = ? AND source_ref = ?").bind(source, ref).first<{ id: string }>();
  return row ? getEntry(env.DB, row.id) : null;
}
const count = async (where: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${where}`).first<{ n: number }>())!.n;
const byName = (assets: Asset[], name: string) => assets.find((asset) => asset.name === name)!;
const closeYear = (year: number) => env.DB.prepare("UPDATE ledger_years SET status = 'closed' WHERE year = ?").bind(year).run();

/** A bank line on ING betaal, as from a file, and its id. */
async function bankLine(date: string, cents: number, description: string): Promise<string> {
  await importLines(env.DB, "1010", [{ bookingDate: date, amountCents: cents, description, counterpartyName: "Speelgoed BV", counterpartyIban: null, bankRef: null }], "file", NOW);
  return (await openLines(env.DB, { accountCode: "1010" })).find((line) => line.description === description)!.id;
}

it("takes the pasted list into the opening balance", async () => {
  await setOpening(
    env.DB,
    2027,
    {
      lines: [
        { accountCode: "1010", amountCents: 1_000_000 },
        { accountCode: "0130", amountCents: 1 },
        { accountCode: "0135", amountCents: 2 },
      ],
      eBoekhoudenEquityCents: 24_662_912,
    },
    NOW,
  );
  const listed = await addPastedAssets(env.DB, [STRAALJAGER, DOME], NOW);
  expect(listed.map((asset) => [asset.name, asset.purchaseDate, asset.costCents, asset.residualCents, asset.lifeYears, asset.writtenOffCents, asset.bookValueCents, asset.disposedOn])).toEqual([
    ["Straaljager", "2008-01-01", 949600, 0, 20, 902120, 47480, null],
    ["Dome - Kopan", "2012-07-10", 4445721, 0, 20, 3072928, 1372793, null],
  ]);

  // 0130 = Σ cost, 0135 = −Σ written off; the typed 0130 and 0135 are left out and equity is worked out again.
  const opening = await getOpening(env.DB, 2027, NOW);
  expect(opening.fromAssetList).toBe(true);
  expect(opening.lines).toEqual([
    { accountCode: "0130", amountCents: 5395321 },
    { accountCode: "0135", amountCents: 3975048 },
    { accountCode: "1010", amountCents: 1_000_000 },
  ]);
  expect(opening.equityCents).toBe(1_000_000 + 5395321 - 3975048);
  expect(opening.eBoekhoudenEquityCents).toBe(24_662_912);
  const entry = (await entryOf("opening", "2027"))!;
  expect(entry.lines.map((line) => [line.accountCode, line.amountCents])).toEqual([
    ["0130", 5395321],
    ["0135", -3975048],
    ["1010", 1_000_000],
    ["1400", -(1_000_000 + 5395321 - 3975048)],
  ]);

  // Typed again: 0130 and 0135 still come from the list.
  const typed = await setOpening(env.DB, 2027, { lines: [{ accountCode: "1010", amountCents: 500 }, { accountCode: "0130", amountCents: 7 }], eBoekhoudenEquityCents: null }, NOW);
  expect(typed.lines).toEqual([
    { accountCode: "0130", amountCents: 5395321 },
    { accountCode: "0135", amountCents: 3975048 },
    { accountCode: "1010", amountCents: 500 },
  ]);
  expect(typed.equityCents).toBe(500 + 5395321 - 3975048);
});

it("gives an opening without a list as typed", async () => {
  const opening = await setOpening(env.DB, 2027, { lines: [{ accountCode: "0130", amountCents: 100 }, { accountCode: "0135", amountCents: 40 }], eBoekhoudenEquityCents: null }, NOW);
  expect(opening.fromAssetList).toBe(false);
  expect(opening.lines).toEqual([
    { accountCode: "0130", amountCents: 100 },
    { accountCode: "0135", amountCents: 40 },
  ]);
});

it("replaces the pasted list when pasted again, keeps a bought toestel and the residual already typed", async () => {
  await setOpening(env.DB, 2027, { lines: [{ accountCode: "1010", amountCents: 1_000_000 }], eBoekhoudenEquityCents: 5 }, NOW);
  const [, dome] = await addPastedAssets(env.DB, [STRAALJAGER, DOME], NOW);
  await saveAsset(env.DB, { id: dome!.id, residualCents: 200000 }, NOW);
  const bought = await saveAsset(env.DB, { name: "Schommel", lifeYears: 10, residualCents: 0 }, NOW);

  const again = await addPastedAssets(env.DB, [DOME, BANKEN], NOW);
  expect(again.map((asset) => [asset.name, asset.residualCents])).toEqual([
    ["Dome - Kopan", 200000],
    ["Banken", 0],
    ["Schommel", 0],
  ]);
  expect(byName(again, "Schommel").id).toBe(bought.id);
  expect(await count("assets")).toBe(3);
  const opening = await getOpening(env.DB, 2027, NOW);
  expect(opening.lines).toEqual([
    { accountCode: "0130", amountCents: 4445721 + 584430 },
    { accountCode: "0135", amountCents: 3072928 + 38962 },
    { accountCode: "1010", amountCents: 1_000_000 },
  ]);
  expect(opening.equityCents).toBe(1_000_000 + 4445721 + 584430 - 3072928 - 38962);
  expect(opening.eBoekhoudenEquityCents).toBe(5);
});

it("refuses to paste again once depreciation is booked or a pasted toestel is disposed of", async () => {
  const [straaljager] = await addPastedAssets(env.DB, [STRAALJAGER, DOME], NOW);
  await disposeAsset(env.DB, straaljager!.id, "2027-02-10", NOW);
  await expect(addPastedAssets(env.DB, [BANKEN], NOW)).rejects.toMatchObject({ code: "asset_disposed", status: 409 });

  await resetData();
  await addPastedAssets(env.DB, [STRAALJAGER, DOME], NOW);
  await bookDepreciation(env.DB, 2027, LATER);
  await expect(addPastedAssets(env.DB, [BANKEN], NOW)).rejects.toMatchObject({ code: "depreciation_booked", status: 409 });
  expect((await listAssets(env.DB, "9999-12-31")).map((asset) => asset.name)).toEqual(["Straaljager", "Dome - Kopan"]);
});

it("books the year's depreciation per asset", async () => {
  const [straaljager, dome] = await addPastedAssets(env.DB, [STRAALJAGER, DOME], NOW);
  await saveAsset(env.DB, { id: dome!.id, residualCents: 200000 }, NOW);

  const plan = await depreciationPlan(env.DB, 2027);
  expect(plan).toEqual<DepreciationPlan>({
    year: 2027,
    rows: [
      { assetId: straaljager!.id, name: "Straaljager", cents: 47480 },
      { assetId: dome!.id, name: "Dome - Kopan", cents: 212286 },
    ],
    totalCents: 259766,
    booked: false,
  });

  const entry = await bookDepreciation(env.DB, 2027, LATER);
  expect(entry).toMatchObject({ date: "2027-12-31", description: "Afschrijving speeltoestellen 2027", source: "depreciation", sourceRef: "2027", editable: false });
  expect(entry.lines).toEqual([
    { accountCode: "4601", amountCents: 259766, note: null, assetId: null },
    { accountCode: "0135", amountCents: -47480, note: "Straaljager", assetId: straaljager!.id },
    { accountCode: "0135", amountCents: -212286, note: "Dome - Kopan", assetId: dome!.id },
  ]);
  expect((await depreciationPlan(env.DB, 2027)).booked).toBe(true);

  const after = await listAssets(env.DB, "2027-12-31");
  expect(byName(after, "Straaljager")).toMatchObject({ writtenOffCents: 949600, bookValueCents: 0 });
  expect(byName(after, "Dome - Kopan")).toMatchObject({ writtenOffCents: 3072928 + 212286, bookValueCents: 4445721 - 3072928 - 212286 });
  // On the day before, the depreciation of the year is not there yet.
  expect(byName(await listAssets(env.DB, "2027-12-30"), "Straaljager").writtenOffCents).toBe(902120);
});

it("replaces the depreciation when booked again", async () => {
  const [, dome] = await addPastedAssets(env.DB, [STRAALJAGER, DOME], NOW);
  const first = await bookDepreciation(env.DB, 2027, LATER);
  expect(first.lines[0]).toEqual({ accountCode: "4601", amountCents: 47480 + 222286, note: null, assetId: null });

  await saveAsset(env.DB, { id: dome!.id, residualCents: 200000 }, NOW);
  const second = await bookDepreciation(env.DB, 2027, LATER);
  expect(second.id).toBe(first.id);
  expect(second.number).toBe(first.number);
  expect(second.lines.map((line) => [line.accountCode, line.amountCents])).toEqual([
    ["4601", 259766],
    ["0135", -47480],
    ["0135", -212286],
  ]);
  expect(await count("ledger_entries WHERE source = 'depreciation'")).toBe(1);

  // A year with nothing left to write off: the entry is emptied, not left behind.
  await env.DB.prepare("UPDATE assets SET residual_cents = cost_cents").run();
  const emptied = await bookDepreciation(env.DB, 2027, LATER);
  expect(emptied.id).toBe(first.id);
  expect(emptied.lines).toEqual([]);
  expect((await depreciationPlan(env.DB, 2027)).booked).toBe(false);
});

it("makes an asset from a bank line booked on 0130", async () => {
  const created = await post("/assets", { name: "Schommel", lifeYears: 10, residualCents: 0 });
  expect(created.status).toBe(201);
  const schommel = await created.json<Asset>();
  expect(schommel).toMatchObject({ name: "Schommel", purchaseDate: null, costCents: 0, residualCents: 0, lifeYears: 10, writtenOffCents: 0, bookValueCents: 0, disposedOn: null });

  const lineId = await bankLine("2027-07-15", -1_200_000, "Factuur schommel");
  const booked = await post(`/bank/lines/${lineId}/book`, { split: [{ accountCode: "0130", amountCents: 1_200_000, assetId: schommel.id }] });
  expect(booked.status).toBe(200);
  const entry = await booked.json<Entry>();
  expect(entry.lines).toEqual([
    { accountCode: "1010", amountCents: -1_200_000, note: null, assetId: null },
    { accountCode: "0130", amountCents: 1_200_000, note: null, assetId: schommel.id },
  ]);

  const listed = await (await get("/assets")).json<Asset[]>();
  expect(byName(listed, "Schommel")).toMatchObject({ purchaseDate: "2027-07-15", costCents: 1_200_000, writtenOffCents: 0, bookValueCents: 1_200_000 });
  // Bought in July: six months of 1.200.000 / 10 in the first year.
  const plan = await (await get("/depreciation?year=2027")).json<DepreciationPlan>();
  expect(plan).toEqual({ year: 2027, rows: [{ assetId: schommel.id, name: "Schommel", cents: 60000 }], totalCents: 60000, booked: false });

  const other = await bankLine("2027-07-16", -5000, "Bout");
  const unknown = await post(`/bank/lines/${other}/book`, { split: [{ accountCode: "0130", amountCents: 5000, assetId: "nope" }] });
  expect(unknown.status).toBe(404);
  expect(await unknown.json()).toEqual({ error: "asset_unknown" });
  const wrong = await post(`/bank/lines/${other}/book`, { split: [{ accountCode: "4514", amountCents: 5000, assetId: schommel.id }] });
  expect(wrong.status).toBe(400);
  expect(await wrong.json()).toEqual({ error: "asset_wrong_account" });
  expect(await count("ledger_entries WHERE source = 'bank'")).toBe(1);
});

it("disposes of an asset with what was left of its value", async () => {
  const [dome, banken] = await addPastedAssets(env.DB, [STRAALJAGER, DOME, BANKEN], NOW).then((list) => [byName(list, "Dome - Kopan"), byName(list, "Banken")]);
  await saveAsset(env.DB, { id: dome!.id, residualCents: 200000 }, NOW);
  await saveAsset(env.DB, { id: banken!.id, residualCents: 292215 }, NOW);
  await bookDepreciation(env.DB, 2027, LATER);
  const year2028 = await bookDepreciation(env.DB, 2028, YEAR_AFTER);
  expect(year2028.lines.map((line) => [line.accountCode, line.amountCents, line.note])).toEqual([
    ["4601", 212286 + 14611, null],
    ["0135", -212286, "Dome - Kopan"],
    ["0135", -14611, "Banken"],
  ]);

  // Dome - Kopan goes in March 2028: three months of 2028, then the book value left to 4601.
  const writtenOffBefore = 3072928 + 212286;
  const disposal = await disposeAsset(env.DB, dome!.id, "2028-03-20", YEAR_AFTER);
  expect(disposal).toMatchObject({ date: "2028-03-20", description: "Afvoer Dome - Kopan", source: "disposal", sourceRef: dome!.id, editable: false });
  expect(disposal.lines).toEqual([
    { accountCode: "4601", amountCents: 53072, note: "Afschrijving 2028 t/m maart", assetId: null },
    { accountCode: "4601", amountCents: 4445721 - writtenOffBefore - 53072, note: "Restwaarde afgevoerd", assetId: null },
    { accountCode: "0135", amountCents: writtenOffBefore, note: null, assetId: dome!.id },
    { accountCode: "0130", amountCents: -4445721, note: null, assetId: dome!.id },
  ]);

  // The depreciation of 2028 is booked again without it.
  expect((await entryOf("depreciation", "2028"))!.lines.map((line) => [line.accountCode, line.amountCents, line.assetId])).toEqual([
    ["4601", 14611, null],
    ["0135", -14611, banken!.id],
  ]);
  expect((await depreciationPlan(env.DB, 2028)).rows.map((row) => row.name)).toEqual(["Banken"]);

  const listed = await listAssets(env.DB, "9999-12-31");
  expect(byName(listed, "Dome - Kopan")).toMatchObject({ disposedOn: "2028-03-20", costCents: 4445721, bookValueCents: 0 });
  // 0130 and 0135 hold what is left: Straaljager and Banken.
  const balances = await balancesOn(env.DB, "2028-12-31");
  expect(balances.get("0130")).toBe(949600 + 584430);
  expect(balances.get("0135")).toBe(-(949600 + 38962 + 14611 + 14611));
  expect(byName(listed, "Straaljager")).toMatchObject({ disposedOn: null, writtenOffCents: 949600, bookValueCents: 0 });

  await expect(disposeAsset(env.DB, dome!.id, "2028-04-01", YEAR_AFTER)).rejects.toMatchObject({ code: "asset_disposed", status: 409 });
  const twice = await post(`/assets/${dome!.id}/dispose`, { date: "2028-04-01" });
  expect(twice.status).toBe(409);
  expect(await twice.json()).toEqual({ error: "asset_disposed" });
  expect((await patch(`/assets/${dome!.id}`, { residualCents: 0 })).status).toBe(409);
});

it("asks for the depreciation of the year before first, so nothing is written off twice", async () => {
  const [, dome] = await addPastedAssets(env.DB, [STRAALJAGER, DOME], NOW);
  await expect(disposeAsset(env.DB, dome!.id, "2028-02-01", YEAR_AFTER)).rejects.toMatchObject({ code: "depreciation_first", status: 409 });
  expect(await count("ledger_entries WHERE source = 'disposal'")).toBe(0);

  await bookDepreciation(env.DB, 2027, LATER);
  const disposal = await disposeAsset(env.DB, dome!.id, "2028-02-01", YEAR_AFTER);
  // 0135 gives back the list's 3.072.928 and the 222.286 of 2027: the toestel is off the books without a cent left.
  expect(disposal.lines.find((line) => line.accountCode === "0135")!.amountCents).toBe(3072928 + 222286);
  const balances = await balancesOn(env.DB, "2028-12-31");
  expect(balances.get("0130")).toBe(949600);
  expect(balances.get("0135")).toBe(-(902120 + 47480));
});

it("refuses to change the depreciation of a closed year", async () => {
  const [straaljager] = await addPastedAssets(env.DB, [STRAALJAGER, DOME], NOW);
  const booked = await bookDepreciation(env.DB, 2027, LATER);
  await closeYear(2027);

  await expect(bookDepreciation(env.DB, 2027, LATER)).rejects.toMatchObject({ code: "year_closed", status: 409 });
  await expect(disposeAsset(env.DB, straaljager!.id, "2027-06-01", LATER)).rejects.toMatchObject({ code: "year_closed", status: 409 });
  const res = await post("/depreciation", { year: 2027 });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "year_closed" });

  expect((await entryOf("depreciation", "2027"))!.lines).toEqual(booked.lines);
  expect(await count("ledger_entries WHERE source = 'disposal'")).toBe(0);
  expect((await listAssets(env.DB, "9999-12-31")).every((asset) => asset.disposedOn === null)).toBe(true);
});

it("pastes, lists, changes and books through the routes", async () => {
  const pasted = await post("/assets/paste", { assets: [STRAALJAGER, DOME] });
  expect(pasted.status).toBe(200);
  const [, dome] = await pasted.json<Asset[]>();
  const changed = await patch(`/assets/${dome!.id}`, { name: "Dome-Kopan", residualCents: 200000, lifeYears: 20 });
  expect(changed.status).toBe(200);
  expect(await changed.json()).toMatchObject({ id: dome!.id, name: "Dome-Kopan", residualCents: 200000 });

  const plan = await (await get("/depreciation?year=2027")).json<DepreciationPlan>();
  expect(plan.totalCents).toBe(259766);
  const booked = await post("/depreciation", { year: 2027 });
  expect(booked.status).toBe(200);
  expect((await booked.json<Entry>()).lines[0]).toMatchObject({ accountCode: "4601", amountCents: 259766 });

  const disposed = await post(`/assets/${dome!.id}/dispose`, { date: "2028-01-15" });
  expect(disposed.status).toBe(200);
  expect((await disposed.json<Entry>()).description).toBe("Afvoer Dome-Kopan");
  expect(byName(await (await get("/assets")).json<Asset[]>(), "Dome-Kopan").disposedOn).toBe("2028-01-15");

  for (const [to, body] of [
    ["/assets/paste", { assets: [] }],
    ["/assets/paste", { assets: [{ ...STRAALJAGER, lifeYears: 0 }] }],
    ["/assets", { name: "", lifeYears: 10, residualCents: 0 }],
    ["/assets", { name: "x".repeat(61), lifeYears: 10, residualCents: 0 }],
    ["/assets", { name: "Wip", lifeYears: 51, residualCents: 0 }],
    ["/assets", { name: "Wip", lifeYears: 10, residualCents: -1 }],
    [`/assets/${dome!.id}/dispose`, { date: "15-01-2028" }],
    ["/depreciation", { year: "2027" }],
  ] as const) {
    const res = await post(to, body);
    expect(res.status, `${to} ${JSON.stringify(body)}`).toBe(400);
  }
  expect((await get("/depreciation?year=twee")).status).toBe(400);
  expect((await get("/depreciation?year=2026")).status).toBe(400);
  expect((await post("/depreciation", { year: 2026 })).status).toBe(400);
  expect((await patch("/assets/nope", { residualCents: 0 })).status).toBe(404);
  expect((await post("/assets/nope/dispose", { date: "2028-01-15" })).status).toBe(404);
  expect((await api(`${path}/assets`)).status).toBe(401);
});

it("carries the toestellen in the copy", async () => {
  await addPastedAssets(env.DB, [STRAALJAGER], NOW);
  const file = await exportAll(env.DB, NOW);
  expect(file.ledger.assets).toEqual([expect.objectContaining({ name: "Straaljager", cost_cents: 949600, opening_written_off_cents: 902120, life_years: 20 })]);
});

// R32: a booking edited through Boekingen keeps its toestel.

it("keeps a bought toestel's cost when its booking is edited through Boekingen", async () => {
  const schommel = await (await post("/assets", { name: "Schommel", lifeYears: 10, residualCents: 0 })).json<Asset>();
  const lineId = await bankLine("2027-07-15", -1_200_000, "Factuur schommel");
  const booked = await (await post(`/bank/lines/${lineId}/book`, { split: [{ accountCode: "0130", amountCents: 1_200_000, assetId: schommel.id }] })).json<Entry>();

  // What the entry form sends back: every line as it was, the toestel with it, and a new description.
  const edited = await put(`/entries/${booked.id}`, {
    date: booked.date,
    description: "Schommel van Speelgoed BV",
    lines: booked.lines.map((line) => ({ accountCode: line.accountCode, amountCents: line.amountCents, note: line.note, assetId: line.assetId })),
  });
  expect(edited.status).toBe(200);
  const entry = await edited.json<Entry>();
  expect(entry.description).toBe("Schommel van Speelgoed BV");
  expect(entry.lines.find((line) => line.accountCode === "0130")!.assetId).toBe(schommel.id);
  expect(byName(await listAssets(env.DB, "9999-12-31"), "Schommel")).toMatchObject({ costCents: 1_200_000, purchaseDate: "2027-07-15" });
});

it("refuses a toestel on a line of another account than 0130 or 0135, and one that does not exist", async () => {
  const schommel = await saveAsset(env.DB, { name: "Schommel", lifeYears: 10, residualCents: 0 }, NOW);
  const lines = (accountCode: string, assetId: string) => [
    { accountCode, amountCents: 5000, note: null, assetId },
    { accountCode: "1010", amountCents: -5000, note: null },
  ];

  const onCosts = await post("/entries", { date: "2027-03-01", description: "Bout", lines: lines("4501", schommel.id) });
  expect(onCosts.status).toBe(400);
  expect(await onCosts.json()).toEqual({ error: "asset_line_account" });
  const unknown = await post("/entries", { date: "2027-03-01", description: "Bout", lines: lines("0130", "nope") });
  expect(unknown.status).toBe(404);
  expect(await unknown.json()).toEqual({ error: "asset_unknown" });

  const made = await (await post("/entries", { date: "2027-03-01", description: "Bout", lines: lines("0130", schommel.id) })).json<Entry>();
  expect(made.lines[0]).toMatchObject({ accountCode: "0130", assetId: schommel.id });
  const moved = await put(`/entries/${made.id}`, { date: "2027-03-01", description: "Bout", lines: lines("4501", schommel.id) });
  expect(moved.status).toBe(400);
  expect(await moved.json()).toEqual({ error: "asset_line_account" });

  // Every way into the ledger, not only the routes.
  const wrong = { accountCode: "4501", amountCents: 100, note: null, assetId: schommel.id };
  const other = { accountCode: "1010", amountCents: -100, note: null, assetId: null };
  await expect(createEntry(env.DB, { date: "2027-03-02", description: "x", source: "manual", lines: [wrong, other] }, NOW)).rejects.toMatchObject({
    code: "asset_line_account",
    status: 400,
  });
  await expect(upsertSourced(env.DB, { date: "2027-03-02", description: "x", source: "kassa_day", sourceRef: "2027-03-02", lines: [wrong, other] }, NOW)).rejects.toMatchObject({
    code: "asset_line_account",
    status: 400,
  });
  await expect(
    upsertSourced(env.DB, { date: "2027-03-02", description: "x", source: "kassa_day", sourceRef: "2027-03-02", lines: [{ ...wrong, accountCode: "0135", assetId: "nope" }, other] }, NOW),
  ).rejects.toMatchObject({ code: "asset_unknown", status: 404 });
  expect(await count("ledger_entries WHERE source IN ('manual', 'kassa_day')")).toBe(1);
});
