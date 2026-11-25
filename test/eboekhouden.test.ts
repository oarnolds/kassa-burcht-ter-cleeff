import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { EbStatus, EbSummary } from "../shared/ledger-types";
import type { ImportedEntry } from "../shared/xaf-map";
import { app } from "../worker/app";
import { addPastedAssets } from "../worker/db/assets";
import { addAttachment } from "../worker/db/attachments";
import { eboekhoudenDone, eboekhoudenPayouts, finishImport, IMPORTED_KEY, importEntries, MAX_ENTRIES, PAYOUTS_KEY, startImport } from "../worker/db/eboekhouden";
import { editEntry, entryHistory, getEntry, listEntries } from "../worker/db/ledger";
import { getOpening } from "../worker/db/opening";
import { api, asAdmin, meteredDb, resetData } from "./helpers";

// 2026 up to the overstap comes from e-Boekhouden's auditfile (spec §7, §9). The browser reads the file and sends
// the opening, the bookings in chunks and the finish; the Worker writes them. Every booking here is made up.

let cookie: string;
beforeEach(async () => {
  await resetData();
  cookie = (await asAdmin()).cookie;
});

const NOW = new Date("2026-11-25T12:00:00.000Z");
const LATER = new Date("2026-11-26T12:00:00.000Z");
const base = "/api/admin/boekhouding/eboekhouden";

const line = (accountCode: string, amountCents: number, note: string | null = null) => ({ accountCode, amountCents, note });
const booking = (ref: string, date: string, description: string, ...lines: ImportedEntry["lines"]): ImportedEntry => ({ ref, date, description, lines });

const contributie = booking("1010:101", "2026-02-03", "Contributie fam. Jansen", line("1010", 2500), line("8000", -2500));
const huur = booking("1010:102", "2026-03-01", "Huur maart", line("4301", 60000, "Gemeente, huur terrein"), line("1010", -60000));
const verhuur = booking("1010:103", "2026-04-12", "Verhuur kinderfeest", line("1010", 7500), line("8010", -7500));

const count = async (from: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${from}`).first<{ n: number }>())!.n;
const setting = async (key: string) =>
  (await env.DB.prepare("SELECT value FROM ledger_settings WHERE key = ?").bind(key).first<{ value: string }>())?.value ?? null;
const byRef = async (ref: string) => (await listEntries(env.DB, { year: 2026 })).find((entry) => entry.sourceRef === ref)!;
const post = (path: string, json: unknown) => api(`${base}${path}`, { method: "POST", cookie, json });
const start = { createdOn: "2026-11-25", opening: [], ebEquityCents: 0, payouts: [] };

it("writes the opening of 2026 with equity worked out", async () => {
  const answer = await post("/start", {
    createdOn: "2026-11-25",
    // Signed as the auditfile has them: debit +, credit −.
    opening: [
      { accountCode: "1010", amountCents: 2_000_000 },
      { accountCode: "1020", amountCents: 9_000_000 },
      { accountCode: "1700", amountCents: -50_000 },
    ],
    ebEquityCents: 24_662_912,
    payouts: ["05665564.2611.01", "05665564.0211.01"],
  });
  expect([answer.status, await answer.json()]).toEqual([200, { ok: true }]);

  const opening = await getOpening(env.DB, 2026, NOW);
  // As the balance shows them: the liability 1700 positive.
  expect(opening.lines).toEqual([
    { accountCode: "1010", amountCents: 2_000_000 },
    { accountCode: "1020", amountCents: 9_000_000 },
    { accountCode: "1700", amountCents: 50_000 },
  ]);
  expect(opening.equityCents).toBe(2_000_000 + 9_000_000 - 50_000);
  expect(opening.eBoekhoudenEquityCents).toBe(24_662_912);
  const sum = await env.DB.prepare("SELECT SUM(l.amount_cents) AS n FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id WHERE e.source = 'opening'").first<{ n: number }>();
  expect(sum!.n).toBe(0);
  expect(await eboekhoudenPayouts(env.DB)).toEqual(["05665564.2611.01", "05665564.0211.01"]);
  // The gate opens only with finish.
  expect(await setting(IMPORTED_KEY)).toBeNull();
  expect(await eboekhoudenDone(env.DB)).toBe(false);

  // Read in again: the opening is replaced, not doubled.
  await startImport(env.DB, { ...start, opening: [{ accountCode: "1010", amountCents: 1_000 }], payouts: ["05665564.2611.01"] }, LATER);
  expect((await getOpening(env.DB, 2026, LATER)).lines).toEqual([{ accountCode: "1010", amountCents: 1_000 }]);
  expect(await count("ledger_entries WHERE source = 'opening'")).toBe(1);
  expect(await setting(PAYOUTS_KEY)).toBe(JSON.stringify(["05665564.2611.01"]));

  // Income and expense accounts have no place in an opening.
  await expect(startImport(env.DB, { ...start, opening: [{ accountCode: "8011", amountCents: -100 }] }, LATER)).rejects.toMatchObject({
    code: "not_balance_account",
    status: 400,
  });
  const refused = await post("/start", { ...start, opening: [{ accountCode: "4301", amountCents: 100 }] });
  expect([refused.status, await refused.json()]).toEqual([400, { error: "not_balance_account" }]);
  expect((await post("/start", { ...start, createdOn: "gisteren" })).status).toBe(400);
});

it("takes 0130 and 0135 from the toestellen list when it is there", async () => {
  await addPastedAssets(
    env.DB,
    [
      { name: "Schommel", purchaseDate: "2015-04-01", costCents: 1_000_000, writtenOffCents: 400_000, lifeYears: 15 },
      { name: "Glijbaan", purchaseDate: "2019-06-01", costCents: 500_000, writtenOffCents: 100_000, lifeYears: 15 },
    ],
    NOW,
  );
  await startImport(env.DB, { ...start, opening: [{ accountCode: "1010", amountCents: 300_000 }] }, NOW);
  const opening = await getOpening(env.DB, 2026, NOW);
  expect(opening.fromAssetList).toBe(true);
  expect(opening.lines).toEqual([
    { accountCode: "0130", amountCents: 1_500_000 },
    { accountCode: "0135", amountCents: 500_000 },
    { accountCode: "1010", amountCents: 300_000 },
  ]);
  expect(opening.equityCents).toBe(1_500_000 - 500_000 + 300_000);
});

it("writes a chunk of bookings as entries from e-Boekhouden", async () => {
  const answer = await post("/entries", { entries: [contributie, huur] });
  expect([answer.status, await answer.json()]).toEqual([200, { written: 2 }]);

  const entries = await listEntries(env.DB, { year: 2026 });
  expect(entries.map((entry) => [entry.number, entry.date, entry.description, entry.source, entry.sourceRef, entry.editable, entry.changed])).toEqual([
    [1, "2026-02-03", "Contributie fam. Jansen", "eboekhouden", "1010:101", false, false],
    [2, "2026-03-01", "Huur maart", "eboekhouden", "1010:102", false, false],
  ]);
  expect(entries[1]!.lines).toEqual([
    { accountCode: "4301", amountCents: 60000, note: "Gemeente, huur terrein", assetId: null },
    { accountCode: "1010", amountCents: -60000, note: null, assetId: null },
  ]);
  // Not the penningmeester's: corrected in e-Boekhouden, or with an entry of his own.
  await expect(editEntry(env.DB, entries[0]!.id, { date: "2026-02-03", description: "Anders", lines: [] }, NOW)).rejects.toMatchObject({
    code: "not_editable",
    status: 409,
  });
  expect(await count("ledger_history")).toBe(0);
});

it("does not double a booking read in twice", async () => {
  await importEntries(env.DB, [contributie, huur], NOW);
  const first = await listEntries(env.DB, { year: 2026 });
  const updated = await env.DB.prepare("SELECT id, updated_at FROM ledger_entries ORDER BY id").all();

  const metered = meteredDb(env.DB);
  expect(await importEntries(metered.db, [contributie, huur], LATER)).toEqual({ written: 0 });
  expect(metered.calls()).toBe(1); // the one read; nothing written

  expect(await listEntries(env.DB, { year: 2026 })).toEqual(first);
  expect((await env.DB.prepare("SELECT id, updated_at FROM ledger_entries ORDER BY id").all()).results).toEqual(updated.results);
  expect(await count("ledger_entries")).toBe(2);
  expect(await count("ledger_lines")).toBe(4);
  expect(await count("ledger_history")).toBe(0);
});

it("keeps a history row when a booking changed in e-Boekhouden", async () => {
  await importEntries(env.DB, [contributie, huur], NOW);
  const before = await byRef("1010:102");
  const changed = { ...huur, lines: [line("4301", 65000, "Gemeente, huur terrein"), line("1010", -65000)] };

  // The changed one is written again, the unchanged one not, a new one is added after them.
  expect(await importEntries(env.DB, [contributie, changed, verhuur], LATER)).toEqual({ written: 2 });
  const after = await getEntry(env.DB, before.id);
  expect(after).toMatchObject({ id: before.id, number: before.number, sourceRef: "1010:102", changed: true });
  expect(after!.lines.map((one) => one.amountCents)).toEqual([65000, -65000]);
  expect(await entryHistory(env.DB, before.id)).toEqual([
    {
      at: LATER.toISOString(),
      note: "opnieuw ingelezen uit e-Boekhouden",
      before: { date: "2026-03-01", description: "Huur maart", lines: before.lines },
      after: { date: "2026-03-01", description: "Huur maart", lines: after!.lines },
    },
  ]);
  expect(await entryHistory(env.DB, (await byRef("1010:101")).id)).toEqual([]);
  expect((await byRef("1010:103")).number).toBe(3);
  expect(await count("ledger_history")).toBe(1);
});

it("empties a booking that is no longer in the file", async () => {
  await importEntries(env.DB, [contributie, huur], NOW);
  await finishImport(env.DB, { createdOn: "2026-11-25", refs: ["1010:101", "1010:102"] }, NOW);
  const before = await byRef("1010:102");

  const summary = await finishImport(env.DB, { createdOn: "2026-11-26", refs: ["1010:101"] }, LATER);
  expect(summary).toMatchObject({ imported: 1, emptied: 1 });
  const emptied = await getEntry(env.DB, before.id);
  // It stays, with its number and its history; only its lines are gone.
  expect(emptied).toMatchObject({ id: before.id, number: before.number, date: before.date, description: before.description, lines: [], changed: true });
  expect(await entryHistory(env.DB, before.id)).toEqual([
    {
      at: LATER.toISOString(),
      note: "niet meer in het auditbestand",
      before: { date: "2026-03-01", description: "Huur maart", lines: before.lines },
      after: { date: "2026-03-01", description: "Huur maart", lines: [] },
    },
  ]);
  expect((await byRef("1010:101")).lines).toHaveLength(2);

  // Finishing again finds nothing more to empty.
  expect(await finishImport(env.DB, { createdOn: "2026-11-26", refs: ["1010:101"] }, LATER)).toMatchObject({ imported: 1, emptied: 0 });
  expect(await entryHistory(env.DB, before.id)).toHaveLength(1);

  // Back in the file, it is filled again in the same entry.
  expect(await importEntries(env.DB, [huur], LATER)).toEqual({ written: 1 });
  expect((await getEntry(env.DB, before.id))!.lines).toEqual(before.lines);
  expect((await entryHistory(env.DB, before.id)).map((change) => change.note)).toEqual(["niet meer in het auditbestand", "opnieuw ingelezen uit e-Boekhouden"]);
  expect(await count("ledger_entries")).toBe(2);
});

it("finishes only when every booking of the file is there", async () => {
  // The chunk with verhuur never arrived: the finish may neither empty nor open the gate.
  await importEntries(env.DB, [contributie, huur], NOW);
  const all = [contributie, huur, verhuur].map((entry) => entry.ref);
  await expect(finishImport(env.DB, { createdOn: "2026-11-25", refs: all }, NOW)).rejects.toMatchObject({ code: "entries_missing", status: 409 });
  const missing = await post("/finish", { createdOn: "2026-11-25", refs: all });
  expect([missing.status, await missing.json()]).toEqual([409, { error: "entries_missing" }]);
  // Without any ref it would empty every booking.
  expect((await post("/finish", { createdOn: "2026-11-25", refs: [] })).status).toBe(400);
  expect(await count("ledger_history")).toBe(0);
  expect((await byRef("1010:102")).lines).toHaveLength(2);
  expect(await eboekhoudenDone(env.DB)).toBe(false);
  expect(await setting(IMPORTED_KEY)).toBeNull();

  // Once it arrived, the finish goes through.
  await importEntries(env.DB, [verhuur], NOW);
  expect(await finishImport(env.DB, { createdOn: "2026-11-25", refs: all }, NOW)).toMatchObject({ imported: 3, emptied: 0 });
  expect(await eboekhoudenDone(env.DB)).toBe(true);

  // A booking emptied earlier and back in the file counts once it is filled again, not before.
  await finishImport(env.DB, { createdOn: "2026-11-26", refs: all.slice(0, 2) }, LATER);
  await expect(finishImport(env.DB, { createdOn: "2026-11-27", refs: all }, LATER)).rejects.toMatchObject({ code: "entries_missing" });
  await importEntries(env.DB, [verhuur], LATER);
  expect(await finishImport(env.DB, { createdOn: "2026-11-27", refs: all }, LATER)).toMatchObject({ imported: 3, emptied: 0 });
  expect(await setting(IMPORTED_KEY)).toBe("2026-11-27");
});

it("refuses a booking from the overstap on or on a toestel account", async () => {
  const fromOverstap = booking("1010:900", "2026-11-25", "Na de overstap", line("1010", 100), line("8040", -100));
  await expect(importEntries(env.DB, [contributie, fromOverstap], NOW)).rejects.toMatchObject({ code: "outside_period", status: 400 });
  const before2026 = booking("1010:1", "2025-12-31", "Vorig jaar", line("1010", 100), line("8040", -100));
  await expect(importEntries(env.DB, [before2026], NOW)).rejects.toMatchObject({ code: "outside_period", status: 400 });
  const answer = await post("/entries", { entries: [fromOverstap] });
  expect([answer.status, await answer.json()]).toEqual([400, { error: "outside_period" }]);

  for (const code of ["0130", "0135", "4601"]) {
    const toestel = booking("memoriaal:7", "2026-05-20", "Toestel", line(code, 7370), line("1010", -7370));
    await expect(importEntries(env.DB, [contributie, toestel], NOW)).rejects.toMatchObject({ code: "asset_account", status: 400 });
  }
  const unbalanced = booking("1010:104", "2026-05-01", "Scheef", line("1010", 100), line("8040", -90));
  await expect(importEntries(env.DB, [contributie, unbalanced], NOW)).rejects.toMatchObject({ code: "unbalanced", status: 400 });
  const unknown = booking("1010:105", "2026-05-01", "Onbekend", line("1010", 100), line("4999", -100));
  await expect(importEntries(env.DB, [contributie, unknown], NOW)).rejects.toMatchObject({ code: "account_unknown", status: 400 });

  // The last day before the overstap is still e-Boekhouden's. Nothing of a refused chunk was written.
  expect(await count("ledger_entries")).toBe(0);
  await importEntries(env.DB, [booking("1010:899", "2026-11-24", "Laatste dag", line("1010", 100), line("8040", -100))], NOW);
  expect(await count("ledger_entries")).toBe(1);
});

it("refuses everything once 2026 is closed", async () => {
  await importEntries(env.DB, [contributie, huur], NOW);
  await env.DB.prepare("UPDATE ledger_years SET status = 'closed', closed_at = '2027-02-01T10:00:00.000Z' WHERE year = 2026").run();
  const lines = await count("ledger_lines");

  for (const [path, body] of [
    ["/start", { ...start, opening: [{ accountCode: "1010", amountCents: 100 }], payouts: ["05665564.2611.01"] }],
    ["/entries", { entries: [{ ...huur, lines: [line("4301", 1), line("1010", -1)] }] }],
    ["/finish", { createdOn: "2026-11-25", refs: [contributie.ref] }],
  ] as const) {
    const answer = await post(path, body);
    expect([answer.status, await answer.json()], path).toEqual([409, { error: "year_closed" }]);
  }
  expect(await count("ledger_lines")).toBe(lines);
  expect(await count("ledger_entries WHERE source = 'opening'")).toBe(0);
  expect(await count("ledger_history")).toBe(0);
  expect(await setting(PAYOUTS_KEY)).toBeNull();
  expect(await setting(IMPORTED_KEY)).toBeNull();
  const status = await api(`${base}/status`, { cookie });
  expect(await status.json<EbStatus>()).toMatchObject({ done: false, yearClosed: true });
});

it("empties a typed opening of 2027", async () => {
  const at = "2026-11-24T10:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO ledger_entries (id, year, number, date, description, source, source_ref, created_at, updated_at) VALUES ('o27', 2027, 1, '2027-01-01', 'Beginbalans 2027', 'opening', '2027', ?1, ?1)",
    ).bind(at),
    env.DB.prepare("INSERT INTO ledger_lines (entry_id, account_code, amount_cents, note, asset_id) VALUES ('o27', '1010', 100000, NULL, NULL), ('o27', '1400', -100000, NULL, NULL)"),
    env.DB.prepare("INSERT INTO ledger_settings (key, value, updated_at) VALUES ('ledger_opening_eb_equity_2027', '123', ?1)").bind(at),
  ]);
  await importEntries(env.DB, [contributie], NOW);

  await finishImport(env.DB, { createdOn: "2026-11-25", refs: [contributie.ref] }, NOW);
  expect(await getEntry(env.DB, "o27")).toMatchObject({ number: 1, date: "2027-01-01", description: "Beginbalans 2027", lines: [], changed: true });
  const lines = [
    { accountCode: "1010", amountCents: 100000, note: null, assetId: null },
    { accountCode: "1400", amountCents: -100000, note: null, assetId: null },
  ];
  expect(await entryHistory(env.DB, "o27")).toEqual([
    {
      at: NOW.toISOString(),
      note: "vervangen: de beginbalans van 2027 volgt uit het afsluiten van 2026",
      before: { date: "2027-01-01", description: "Beginbalans 2027", lines },
      after: { date: "2027-01-01", description: "Beginbalans 2027", lines: [] },
    },
  ]);
  expect(await setting("ledger_opening_eb_equity_2027")).toBeNull();
  expect(await getOpening(env.DB, 2027, NOW)).toMatchObject({ lines: [], equityCents: 0, eBoekhoudenEquityCents: null });

  await finishImport(env.DB, { createdOn: "2026-11-25", refs: [contributie.ref] }, LATER);
  expect(await entryHistory(env.DB, "o27")).toHaveLength(1);
});

it("opens the gate and sums up kas, open items and money accounts", async () => {
  // The kassa went into use on 21-11 with € 50 in the kluisje, and sold € 11 in cash on 22-11 (booked by the app later).
  await env.DB.batch([
    env.DB.prepare("INSERT INTO settings (key, value) VALUES ('in_use_since', '2026-11-21T09:00:00.000Z')"),
    env.DB.prepare(
      "INSERT INTO handovers (id, kind, counted_at, expected_cents, received_cents, left_cents, difference_cents, note, created_at) VALUES ('h0', 'opening', '2026-11-21T08:00:00.000Z', 0, 0, 5000, 0, NULL, '2026-11-21T08:00:00.000Z')",
    ),
    env.DB.prepare(
      "INSERT INTO sales (id, method, status, total_cents, sold_at, received_at, business_date) VALUES ('s1', 'cash', 'paid', 1100, '2026-11-22T10:00:00.000Z', '2026-11-22T10:00:00.000Z', '2026-11-22')",
    ),
    // ING gave a balance on 20-11, and one after the overstap that is not looked at.
    env.DB.prepare("INSERT INTO bank_balances (account_code, date, balance_cents, origin) VALUES ('1010', '2026-11-20', 2174000, 'file'), ('1010', '2026-11-26', 1, 'file')"),
  ]);
  const before = await api(`${base}/status`, { cookie });
  expect(await before.json<EbStatus>()).toEqual({ done: false, createdOn: null, imported: 0, inUseSince: "2026-11-21", yearClosed: false });

  await post("/start", { ...start, opening: [{ accountCode: "1000", amountCents: 15_000 }, { accountCode: "1010", amountCents: 2_000_000 }] });
  const entries = [
    booking("1000:1", "2026-11-20", "Kas naar de bank", line("1010", 10_000), line("1000", -10_000)),
    booking("memoriaal:8", "2026-11-10", "Factuur zakelijk lid", line("1300", 12_100), line("8004", -12_100)),
    booking("1010:200", "2026-11-24", "Verhuur", line("1010", 164_000), line("8010", -164_000)),
  ];
  expect((await post("/entries", { entries })).status).toBe(200);
  const answer = await post("/finish", { createdOn: "2026-11-25", refs: entries.map((entry) => entry.ref) });
  expect(answer.status).toBe(200);
  expect(await answer.json<EbSummary>()).toEqual({
    imported: 3,
    emptied: 0,
    cash: { ledgerCents: 5_000, kluisjeCents: 6_100 },
    open: [{ accountCode: "1300", cents: 12_100 }],
    money: [
      { accountCode: "1000", ledgerCents: 5_000, bankCents: null, bankDate: null },
      { accountCode: "1010", ledgerCents: 2_174_000, bankCents: 2_174_000, bankDate: "2026-11-20" },
      { accountCode: "1011", ledgerCents: 0, bankCents: null, bankDate: null },
      { accountCode: "1020", ledgerCents: 0, bankCents: null, bankDate: null },
      { accountCode: "1021", ledgerCents: 0, bankCents: null, bankDate: null },
      { accountCode: "1030", ledgerCents: 0, bankCents: null, bankDate: null },
    ],
  });

  expect(await eboekhoudenDone(env.DB)).toBe(true);
  expect(await setting(IMPORTED_KEY)).toBe("2026-11-25");
  const after = await api(`${base}/status`, { cookie });
  expect(await after.json<EbStatus>()).toEqual({ done: true, createdOn: "2026-11-25", imported: 3, inUseSince: "2026-11-21", yearClosed: false });
});

it("refuses typing the opening by hand", async () => {
  const answer = await api("/api/admin/boekhouding/opening?year=2026", {
    method: "PUT",
    cookie,
    json: { lines: [{ accountCode: "1010", amountCents: 100000 }], eBoekhoudenEquityCents: null },
  });
  expect([answer.status, await answer.json()]).toEqual([409, { error: "opening_from_file" }]);
  expect(await count("ledger_entries")).toBe(0);
});

it("refuses more than 40 bookings in one request", async () => {
  expect(MAX_ENTRIES).toBe(40);
  const many = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => booking(`1010:${i + 1}`, "2026-06-01", `Boeking ${i + 1}`, line("1010", 100), line("8040", -100)));
  const answer = await post("/entries", { entries: many });
  expect([answer.status, await answer.json()]).toEqual([400, { error: "too_many" }]);
  expect(await count("ledger_entries")).toBe(0);
  expect((await post("/entries", { entries: many.slice(0, MAX_ENTRIES) })).status).toBe(200);
  expect(await count("ledger_entries")).toBe(MAX_ENTRIES);
});

it("stays within 50 database calls for a full chunk", async () => {
  const chunk = (cents: number) =>
    Array.from({ length: MAX_ENTRIES }, (_, i) =>
      booking(`1010:${i + 1}`, "2026-06-01", `Boeking ${i + 1}`, line("1010", cents * 2), line("8000", -cents), line("8010", -cents / 2), line("8040", -cents / 2)),
    );
  // The whole request, the login check included.
  for (const cents of [1000, 2000]) {
    const metered = meteredDb(env.DB);
    const answer = await api(`${base}/entries`, { method: "POST", cookie, json: { entries: chunk(cents) }, env: { DB: metered.db } });
    expect(await answer.json()).toEqual({ written: MAX_ENTRIES });
    expect(metered.calls(), `${cents}`).toBeLessThanOrEqual(50);
  }
  expect(await count("ledger_entries WHERE source = 'eboekhouden'")).toBe(MAX_ENTRIES);
  expect(await count("ledger_lines")).toBe(MAX_ENTRIES * 4);
  expect(await count("ledger_history WHERE note = 'opnieuw ingelezen uit e-Boekhouden'")).toBe(MAX_ENTRIES);
  // One read for the whole chunk, not one per booking, and one write.
  const metered = meteredDb(env.DB);
  expect(await importEntries(metered.db, chunk(3000), LATER)).toEqual({ written: MAX_ENTRIES });
  expect(metered.calls()).toBe(2);
});

it("takes an attachment on a booking from e-Boekhouden", async () => {
  await importEntries(env.DB, [huur], NOW);
  const entry = await byRef("1010:102");
  const body = new TextEncoder().encode("%PDF-1.4 factuur").buffer as ArrayBuffer;
  const attachment = await addAttachment(env, entry.id, { filename: "factuur.pdf", contentType: "application/pdf", body, sizeBytes: body.byteLength }, NOW);
  expect((await getEntry(env.DB, entry.id))!.attachments).toEqual([attachment]);
});

it("answers only after logging in", async () => {
  for (const [method, path] of [["GET", "/status"], ["POST", "/start"], ["POST", "/entries"], ["POST", "/finish"]]) {
    const bare = await app.request(`${base}${path}`, { method }, env);
    expect(bare.status, `${method} ${path}`).toBe(401);
  }
  expect((await post("/entries", { entries: [{ ...huur, date: "1-3-2026" }] })).status).toBe(400);
  expect((await post("/finish", { createdOn: "2026-11-25" })).status).toBe(400);
  // A payout is sent as its bare reference.
  expect((await post("/start", { ...start, payouts: ["T05665564.2611.01"] })).status).toBe(400);
  expect(await setting(PAYOUTS_KEY)).toBeNull();
});
