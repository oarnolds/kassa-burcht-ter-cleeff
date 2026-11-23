import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { CamtLine } from "../shared/camt";
import type { BankLine, Entry, ImportResult } from "../shared/ledger-types";
import { autoBook, bookLine, importLines, OPEN_LINES_SQL, openLines } from "../worker/db/bank";
import { balancesOn, entryHistory, getEntry, upsertSourced } from "../worker/db/ledger";
import { yearChecks } from "../worker/db/year";
import { api, asAdmin, meteredDb, resetData } from "./helpers";

let cookie: string;

beforeEach(async () => {
  await resetData();
  cookie = (await asAdmin()).cookie;
});

const NOW = new Date("2027-11-23T12:00:00.000Z");
const GOODOO = "NL00BANK0000000011";

function line(overrides: Partial<CamtLine> = {}): CamtLine {
  return {
    bookingDate: "2027-03-20",
    amountCents: 609147,
    description: "Subsidie 2027",
    counterpartyName: "Gemeente Haarlem",
    counterpartyIban: "NL00BANK0000000002",
    bankRef: null,
    ...overrides,
  };
}

async function store(account: string, ...lines: CamtLine[]): Promise<BankLine[]> {
  await importLines(env.DB, account, lines, "file", NOW);
  const all = await openLines(env.DB, { accountCode: account });
  return all;
}

const book = (id: string, json: unknown) => api(`/api/admin/boekhouding/bank/lines/${id}/book`, { method: "POST", cookie, json });
const lineRow = (id: string) => env.DB.prepare("SELECT status, entry_id FROM bank_lines WHERE id = ?").bind(id).first<{ status: string; entry_id: string | null }>();
const setIdentifier = (code: string, identifier: string) => env.DB.prepare("UPDATE money_accounts SET identifier = ? WHERE account_code = ?").bind(identifier, code).run();

it("books a line on the account chosen, and closes it", async () => {
  const [l] = await store("1010", line());
  const res = await book(l!.id, { split: [{ accountCode: "8020", amountCents: -609147 }] });
  expect(res.status).toBe(200);
  const entry = await res.json<Entry>();
  expect(entry.source).toBe("bank");
  expect(entry.sourceRef).toBe(l!.id);
  expect(entry.date).toBe("2027-03-20");
  expect(entry.description).toBe("Gemeente Haarlem – Subsidie 2027");
  expect(entry.lines.map((x) => [x.accountCode, x.amountCents])).toEqual([
    ["1010", 609147],
    ["8020", -609147],
  ]);
  expect(await lineRow(l!.id)).toEqual({ status: "booked", entry_id: entry.id });
  expect(await openLines(env.DB, { accountCode: "1010" })).toEqual([]);
});

it("uses the given description", async () => {
  const [l] = await store("1010", line());
  const entry = await (await book(l!.id, { split: [{ accountCode: "8020", amountCents: -609147 }], description: "Subsidie" })).json<Entry>();
  expect(entry.description).toBe("Subsidie");
});

it("splits one line over two accounts", async () => {
  const [l] = await store("1010", line({ amountCents: -41280, counterpartyName: "Goodoo", description: "Factuur" }));
  const entry = await bookLine(
    env.DB,
    l!.id,
    {
      split: [
        { accountCode: "4501", amountCents: 30000 },
        { accountCode: "4514", amountCents: 11280 },
      ],
    },
    NOW,
  );
  expect(entry.lines.map((x) => [x.accountCode, x.amountCents])).toEqual([
    ["1010", -41280],
    ["4501", 30000],
    ["4514", 11280],
  ]);
});

it("refuses a split that does not add up", async () => {
  const [l] = await store("1010", line());
  const res = await book(l!.id, { split: [{ accountCode: "8020", amountCents: -100 }] });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "unbalanced" });
  expect((await lineRow(l!.id))!.status).toBe("open");
});

it("refuses a split on the line's own account, an unknown line and a bad body", async () => {
  const [l] = await store("1010", line());
  const same = await book(l!.id, { split: [{ accountCode: "1010", amountCents: -609147 }] });
  expect([same.status, await same.json()]).toEqual([400, { error: "same_account" }]);
  const missing = await book("nope", { split: [{ accountCode: "8020", amountCents: -1 }] });
  expect([missing.status, await missing.json()]).toEqual([404, { error: "not_found" }]);
  expect((await book(l!.id, { split: [] })).status).toBe(400);
  expect((await book(l!.id, { split: [{ accountCode: "8020", amountCents: 0 }] })).status).toBe(400);
});

it("suggests what was chosen last time for the same party", async () => {
  const first = line({ bookingDate: "2027-03-01", amountCents: -10000, counterpartyName: "Goodoo", counterpartyIban: GOODOO });
  const second = line({ bookingDate: "2027-04-01", amountCents: -20000, counterpartyName: "Goodoo", counterpartyIban: GOODOO });
  const [a] = await store("1010", first);
  await bookLine(env.DB, a!.id, { split: [{ accountCode: "4501", amountCents: 10000 }] }, NOW);
  const open = await store("1010", second);
  expect(open).toHaveLength(1);
  expect(open[0]!.suggestion).toBe("4501");
  // The route gives the same list.
  const res = await api("/api/admin/boekhouding/bank/lines?account=1010", { cookie });
  expect((await res.json<BankLine[]>())[0]!.suggestion).toBe("4501");
});

it("suggests by name, case ignored, and not from a split entry", async () => {
  const [a] = await store("1010", line({ bookingDate: "2027-03-01", amountCents: -10000, counterpartyName: " GOODOO ", counterpartyIban: null }));
  await bookLine(env.DB, a!.id, { split: [{ accountCode: "4501", amountCents: 10000 }] }, NOW);
  const [b] = await store("1010", line({ bookingDate: "2027-04-01", amountCents: -20000, counterpartyName: "goodoo", counterpartyIban: null }));
  expect(b!.suggestion).toBe("4501");
  await bookLine(
    env.DB,
    b!.id,
    {
      split: [
        { accountCode: "4501", amountCents: 10000 },
        { accountCode: "4514", amountCents: 10000 },
      ],
    },
    NOW,
  );
  const [c] = await store("1010", line({ bookingDate: "2027-05-01", amountCents: -5000, counterpartyName: "Goodoo", counterpartyIban: null }));
  expect(c!.suggestion).toBeNull();
});

it("books a transfer between own accounts against 1080, both sides", async () => {
  await setIdentifier("1010", "NL00INGB0000000000");
  await setIdentifier("1011", "V00000000");
  await importLines(env.DB, "1010", [line({ amountCents: -100000, counterpartyName: "Spaarrekening", counterpartyIban: "V00000000", description: "Overboeking" })], "file", NOW);
  await importLines(env.DB, "1011", [line({ amountCents: 100000, counterpartyName: null, counterpartyIban: null, description: "Van NL00INGB0000000000 spaaropdracht" })], "file", NOW);
  expect(await autoBook(env.DB, NOW)).toBe(2);
  expect(await openLines(env.DB, {})).toEqual([]);
  const balances = await balancesOn(env.DB, "2027-12-31");
  expect(balances.get("1010")).toBe(-100000);
  expect(balances.get("1011")).toBe(100000);
  expect(balances.get("1080") ?? 0).toBe(0);
  expect(await autoBook(env.DB, NOW)).toBe(0);
});

it("matches an identifier in a description only as a whole word, and never its own", async () => {
  await setIdentifier("1010", "NL00INGB0000000000");
  await setIdentifier("1011", "V00000000");
  await importLines(env.DB, "1010", [line({ counterpartyIban: null, counterpartyName: null, description: "ref XV000000001 betaald" })], "file", NOW);
  await importLines(env.DB, "1011", [line({ counterpartyIban: null, counterpartyName: null, description: "rente v00000000" })], "file", NOW);
  expect(await autoBook(env.DB, NOW)).toBe(0);
});

it("books a kasstorting against 1080 by itself", async () => {
  await importLines(env.DB, "1010", [line({ amountCents: 5470, description: "Kasstorting juli", counterpartyName: "O. Penningmeester", counterpartyIban: null })], "file", NOW);
  await importLines(env.DB, "1010", [line({ amountCents: -5470, description: "kasstorting terug", counterpartyIban: null })], "file", NOW);
  expect(await autoBook(env.DB, NOW)).toBe(1);
  const row = await env.DB
    .prepare("SELECT e.id, e.description FROM bank_lines b JOIN ledger_entries e ON e.id = b.entry_id WHERE b.status = 'booked'")
    .first<{ id: string; description: string }>();
  expect(row!.description).toBe("Kasstorting");
  const { results } = await env.DB.prepare("SELECT account_code, amount_cents FROM ledger_lines WHERE entry_id = ? ORDER BY id").bind(row!.id).all();
  expect(results).toEqual([
    { account_code: "1010", amount_cents: 5470 },
    { account_code: "1080", amount_cents: -5470 },
  ]);
  expect((await openLines(env.DB, {})).map((l) => l.amountCents)).toEqual([-5470]);
});

it("refuses to book a line in a closed year, and autoBook leaves it", async () => {
  const [l] = await store("1010", line({ description: "kasstorting" }));
  await env.DB.prepare("INSERT OR IGNORE INTO ledger_years (year, status) VALUES (2027, 'open')").run();
  await env.DB.prepare("UPDATE ledger_years SET status = 'closed', closed_at = '2028-02-01T10:00:00.000Z' WHERE year = 2027").run();
  const res = await book(l!.id, { split: [{ accountCode: "8020", amountCents: -609147 }] });
  expect([res.status, await res.json()]).toEqual([409, { error: "year_closed" }]);
  expect(await autoBook(env.DB, NOW)).toBe(0);
  expect((await lineRow(l!.id))!.status).toBe("open");
});

it("books a booked line again by editing its entry, history kept", async () => {
  const [l] = await store("1010", line());
  const first = await bookLine(env.DB, l!.id, { split: [{ accountCode: "8020", amountCents: -609147 }] }, NOW);
  const second = await bookLine(env.DB, l!.id, { split: [{ accountCode: "8010", amountCents: -609147 }] }, NOW);
  expect(second.id).toBe(first.id);
  expect(second.changed).toBe(true);
  expect(second.lines.map((x) => x.accountCode)).toEqual(["1010", "8010"]);
  expect((await lineRow(l!.id))!.status).toBe("booked");
});

it("lists open and waiting lines, oldest first, filtered by account", async () => {
  await importLines(env.DB, "1010", [line({ bookingDate: "2027-05-01" }), line({ bookingDate: "2027-02-01", amountCents: 5 })], "file", NOW);
  await importLines(env.DB, "1011", [line({ bookingDate: "2027-01-05", amountCents: 7 })], "file", NOW);
  await env.DB.prepare("UPDATE bank_lines SET status = 'waiting', waiting_for = 'mollie' WHERE amount_cents = 5").run();
  const all = await openLines(env.DB, {});
  expect(all.map((l) => l.date)).toEqual(["2027-01-05", "2027-02-01", "2027-05-01"]);
  expect((await openLines(env.DB, { accountCode: "1010" })).map((l) => l.date)).toEqual(["2027-02-01", "2027-05-01"]);
});

it("books a thousand kasstortings within the database-call budget, and a second run books nothing", async () => {
  const lines = Array.from({ length: 1000 }, (_, i) =>
    line({ bookingDate: "2027-03-20", amountCents: 1000 + i, description: "Kasstorting", counterpartyIban: null }),
  );
  await importLines(env.DB, "1010", lines, "file", NOW);
  const first = meteredDb(env.DB);
  expect(await autoBook(first.db, NOW)).toBe(1000);
  expect(first.calls()).toBeLessThanOrEqual(50);
  const again = meteredDb(env.DB);
  expect(await autoBook(again.db, NOW)).toBe(0);
  expect(again.calls()).toBeLessThanOrEqual(50);
});

it("fills autoBooked on the import route", async () => {
  await env.DB.prepare("UPDATE money_accounts SET identifier = 'NL00INGB0000000000' WHERE account_code = '1010'").run();
  const res = await api("/api/admin/boekhouding/bank/import", {
    method: "POST",
    cookie,
    json: { accountCode: "1010", statement: { account: "NL00INGB0000000000", opening: null, closing: null, lines: [line({ description: "Kasstorting", counterpartyIban: null }), line({ amountCents: 5 })] } },
  });
  expect((await res.json<ImportResult>()).autoBooked).toBe(1);
});

/**
 * A busy year: 3.000 booked lines of 60 parties (40 known by IBAN, 20 by name only), each booked on 4501 or 4514,
 * and 150 lines to book from the same parties. Written straight into the tables, as a sync would have left them.
 */
async function busyYear(): Promise<void> {
  const n = (count: number) => `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${count})`;
  const party = "(i % 60)";
  const iban = `CASE WHEN ${party} < 40 THEN 'NL00BANK00000' || printf('%05d', ${party}) END`;
  const other = `CASE WHEN ${party} < 30 THEN '4501' ELSE '4514' END`;
  await env.DB.batch([
    env.DB.prepare(
      `${n(3000)} INSERT INTO ledger_entries (id, year, number, date, description, source, source_ref, created_at, updated_at)
       SELECT 'e' || i, 2027, i, date('2027-01-01', '+' || (i % 300) || ' days'), 'Oud', 'bank', 'b' || i, '2027-01-01T00:00:00Z', '2027-01-01T00:00:00Z' FROM n`,
    ),
    env.DB.prepare(`${n(3000)} INSERT INTO ledger_lines (entry_id, account_code, amount_cents) SELECT 'e' || i, '1010', -100 - i FROM n`),
    env.DB.prepare(`${n(3000)} INSERT INTO ledger_lines (entry_id, account_code, amount_cents) SELECT 'e' || i, ${other}, 100 + i FROM n`),
    env.DB.prepare(
      `${n(3000)} INSERT INTO bank_lines (id, account_code, booking_date, amount_cents, counterparty_name, counterparty_iban, description, content_key, origin, status, entry_id, imported_at)
       SELECT 'b' || i, '1010', date('2027-01-01', '+' || (i % 300) || ' days'), -100 - i, 'Partij ' || ${party}, ${iban}, 'Oud', 'kb' || i, 'file', 'booked', 'e' || i, '2027-01-01T00:00:00Z' FROM n`,
    ),
    env.DB.prepare(
      `${n(150)} INSERT INTO bank_lines (id, account_code, booking_date, amount_cents, counterparty_name, counterparty_iban, description, content_key, origin, status, imported_at)
       SELECT 'o' || i, '1010', '2027-11-01', -500 - i, ' partij ' || ${party} || ' ', ${iban}, 'Nieuw', 'ko' || i, 'file', CASE WHEN i % 10 = 0 THEN 'waiting' ELSE 'open' END, '2027-11-01T00:00:00Z' FROM n`,
    ),
  ]);
}

it("reads Te boeken through its indexes: a few rows per line, not every bank line for each", async () => {
  await busyYear();
  const metered = meteredDb(env.DB);
  const res = await api("/api/admin/boekhouding/bank/lines", { cookie, env: { DB: metered.db } });
  expect(res.status).toBe(200);
  const list = await res.json<BankLine[]>();
  expect(list).toHaveLength(150);
  // Each line still gets what its party was booked on last time, by IBAN or else by name.
  for (const l of list) {
    const party = Number(l.id.slice(1)) % 60;
    expect([l.id, l.suggestion]).toEqual([l.id, party < 30 ? "4501" : "4514"]);
  }
  // 150 lines × 3.000 bank lines would be some 450.000 rows; through the indexes it stays small.
  expect(metered.rowsRead()).toBeLessThan(10_000);
});

it("plans Te boeken on its indexes: no booked line is read in full for an open one", async () => {
  const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${OPEN_LINES_SQL}`).bind(null).all<{ detail: string }>();
  const plan = results.map((row) => row.detail);
  expect(plan).toContain("SCAN b USING INDEX bank_lines_to_book");
  expect(plan.filter((step) => step.startsWith("SEARCH p USING INDEX bank_lines_booked_by_iban"))).toHaveLength(2);
  expect(plan.some((step) => step.startsWith("SEARCH p USING INDEX bank_lines_booked_by_name"))).toBe(true);
  // Nothing scanned from end to end, and no sorting beside the indexes.
  expect(plan.filter((step) => /^SCAN (p|b)$|TEMP B-TREE/.test(step))).toEqual([]);
});

// ---- A bank entry keeps the bank's line and date (R37) ----

const put = (id: string, json: unknown) => api(`/api/admin/boekhouding/entries/${id}`, { method: "PUT", cookie, json });
const empty = (id: string) => api(`/api/admin/boekhouding/entries/${id}/empty`, { method: "POST", cookie });
const pairs = (entry: Entry | null) => entry!.lines.map((x) => [x.accountCode, x.amountCents]);

it("keeps a bank entry's line of the bank and its date; the other side, a note and the description may change", async () => {
  const [l] = await store("1010", line({ amountCents: -41280, counterpartyName: "Goodoo", counterpartyIban: GOODOO, description: "Factuur" }));
  const entry = await bookLine(env.DB, l!.id, { split: [{ accountCode: "4501", amountCents: 41280 }] }, NOW);
  const body = (date: string, lines: [string, number][]) => ({
    date,
    description: "Factuur Goodoo",
    lines: lines.map(([accountCode, amountCents]) => ({ accountCode, amountCents })),
  });
  for (const changed of [
    body("2027-03-21", [["1010", -41280], ["4501", 41280]]),
    body("2027-03-20", [["1010", -40000], ["4501", 40000]]),
    body("2027-03-20", [["1011", -41280], ["4501", 41280]]),
    body("2027-03-20", [["4501", 41280], ["4514", -41280]]),
    body("2027-03-20", [["1010", -41280], ["1010", 100], ["4501", 41180]]),
  ]) {
    const res = await put(entry.id, changed);
    expect([res.status, await res.json()], JSON.stringify(changed)).toEqual([409, { error: "bank_line_fixed" }]);
  }
  expect(pairs(await getEntry(env.DB, entry.id))).toEqual([
    ["1010", -41280],
    ["4501", 41280],
  ]);

  const res = await put(entry.id, {
    date: "2027-03-20",
    description: "Factuur Goodoo, met bezorging",
    lines: [
      { accountCode: "4514", amountCents: 1280, note: "bezorging" },
      { accountCode: "1010", amountCents: -41280 },
      { accountCode: "4501", amountCents: 40000 },
    ],
  });
  expect(res.status).toBe(200);
  expect(pairs(await res.json<Entry>())).toEqual([
    ["4514", 1280],
    ["1010", -41280],
    ["4501", 40000],
  ]);
  expect(await lineRow(l!.id)).toEqual({ status: "booked", entry_id: entry.id });
});

it("puts the line of an emptied bank entry back in Te boeken, and booking it again fills the same entry with its history", async () => {
  const [l] = await store("1010", line());
  const entry = await bookLine(env.DB, l!.id, { split: [{ accountCode: "8020", amountCents: -609147 }] }, NOW);
  const emptied = await empty(entry.id);
  expect(emptied.status).toBe(200);
  expect((await emptied.json<Entry>()).lines).toEqual([]);
  expect(await lineRow(l!.id)).toEqual({ status: "open", entry_id: null });
  expect((await openLines(env.DB, {})).map((x) => x.id)).toEqual([l!.id]);
  expect((await balancesOn(env.DB, "2027-12-31")).get("1010") ?? 0).toBe(0);
  // The year cannot close over it: the line waits to be booked again.
  expect((await yearChecks(env, 2027, NOW)).find((check) => check.key === "bank_lines")).toMatchObject({ ok: false, required: true });

  const again = await book(l!.id, { split: [{ accountCode: "8010", amountCents: -609147 }] });
  expect(again.status).toBe(200);
  const refilled = await again.json<Entry>();
  expect(refilled.id).toBe(entry.id);
  expect(pairs(refilled)).toEqual([
    ["1010", 609147],
    ["8010", -609147],
  ]);
  expect(await lineRow(l!.id)).toEqual({ status: "booked", entry_id: entry.id });
  expect((await entryHistory(env.DB, entry.id)).map((change) => pairs({ lines: change.after.lines } as Entry))).toEqual([
    [],
    [
      ["1010", 609147],
      ["8010", -609147],
    ],
  ]);
});

it("refills an emptied bank entry through Wijzigen only with the bank's line and date, and books the line again", async () => {
  const [l] = await store("1010", line());
  const entry = await bookLine(env.DB, l!.id, { split: [{ accountCode: "8020", amountCents: -609147 }] }, NOW);
  await empty(entry.id);
  const other = await put(entry.id, { date: "2027-03-20", description: "Subsidie", lines: [{ accountCode: "4501", amountCents: 100 }, { accountCode: "8020", amountCents: -100 }] });
  expect([other.status, await other.json()]).toEqual([409, { error: "bank_line_fixed" }]);
  expect(await lineRow(l!.id)).toEqual({ status: "open", entry_id: null });

  const res = await put(entry.id, { date: "2027-03-20", description: "Subsidie", lines: [{ accountCode: "1010", amountCents: 609147 }, { accountCode: "8020", amountCents: -609147 }] });
  expect(res.status).toBe(200);
  expect(await lineRow(l!.id)).toEqual({ status: "booked", entry_id: entry.id });
  expect(await openLines(env.DB, {})).toEqual([]);
});

it("brings an emptied kasstorting or own transfer back to Te boeken, and autoBook books it again with its history", async () => {
  await setIdentifier("1011", "V00000000");
  await importLines(
    env.DB,
    "1010",
    [
      line({ amountCents: 5470, description: "Kasstorting juli", counterpartyName: "O. Penningmeester", counterpartyIban: null }),
      line({ amountCents: -100000, counterpartyName: "Spaarrekening", counterpartyIban: "V00000000", description: "Overboeking" }),
    ],
    "file",
    NOW,
  );
  expect(await autoBook(env.DB, NOW)).toBe(2);
  const { results } = await env.DB.prepare("SELECT id, entry_id FROM bank_lines ORDER BY amount_cents").all<{ id: string; entry_id: string }>();
  for (const booked of results) {
    const before = pairs(await getEntry(env.DB, booked.entry_id));
    expect((await empty(booked.entry_id)).status).toBe(200);
    expect(await lineRow(booked.id)).toEqual({ status: "open", entry_id: null });
    expect((await openLines(env.DB, {})).map((x) => x.id)).toEqual([booked.id]);

    expect(await autoBook(env.DB, NOW)).toBe(1);
    expect(await lineRow(booked.id)).toEqual({ status: "booked", entry_id: booked.entry_id });
    expect(pairs(await getEntry(env.DB, booked.entry_id))).toEqual(before);
    expect((await entryHistory(env.DB, booked.entry_id)).map((change) => change.after.lines.length)).toEqual([0, 2]);
  }
  expect(await autoBook(env.DB, NOW)).toBe(0);
});

it("does not book a line again by hand once another entry has booked it", async () => {
  const [l] = await store("1010", line({ amountCents: 9812, description: "05665564.2703.01 Mollie", counterpartyIban: null }));
  const own = await bookLine(env.DB, l!.id, { split: [{ accountCode: "1030", amountCents: -9812 }] }, NOW);
  await empty(own.id);
  // A sync books the line in an entry of its own, e.g. a payout of Mollie.
  const payout = await upsertSourced(env.DB, { date: "2027-03-20", description: "Uitbetaling", source: "mollie_settlement", sourceRef: "stl_1", lines: [{ accountCode: "1010", amountCents: 9812, note: null, assetId: null }, { accountCode: "1030", amountCents: -9812, note: null, assetId: null }] }, NOW);
  await env.DB.prepare("UPDATE bank_lines SET status = 'booked', entry_id = ? WHERE id = ?").bind(payout.id, l!.id).run();

  const again = await book(l!.id, { split: [{ accountCode: "1030", amountCents: -9812 }] });
  expect([again.status, await again.json()]).toEqual([409, { error: "not_editable" }]);
  const refill = await put(own.id, { date: "2027-03-20", description: "Mollie", lines: [{ accountCode: "1010", amountCents: 9812 }, { accountCode: "1030", amountCents: -9812 }] });
  expect([refill.status, await refill.json()]).toEqual([409, { error: "not_editable" }]);
  expect(await lineRow(l!.id)).toEqual({ status: "booked", entry_id: payout.id });
  expect((await getEntry(env.DB, own.id))!.lines).toEqual([]);
});
