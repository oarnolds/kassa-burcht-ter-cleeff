import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { CamtLine, CamtStatement } from "../shared/camt";
import type { BankLine, EntryLine, ImportResult, MoneyAccount } from "../shared/ledger-types";
import { shiftDate } from "../shared/time";
import { getBankLine, importLines, importStatement, moneyAccounts } from "../worker/db/bank";
import { createEntry } from "../worker/db/ledger";
import { setOpening } from "../worker/db/opening";
import { api, asAdmin, meteredDb, resetData } from "./helpers";

let cookie: string;

beforeEach(async () => {
  await resetData();
  cookie = (await asAdmin()).cookie;
});

const NOW = new Date("2027-11-23T12:00:00.000Z");
const BETAAL = "NL00INGB0000000000";
const SPAAR = "V00000000";

/** A kasstorting of € 40 from the penningmeester's own account, unless overridden. */
function line(overrides: Partial<CamtLine> = {}): CamtLine {
  return {
    bookingDate: "2027-03-20",
    amountCents: 4000,
    description: "kasstorting",
    counterpartyName: "O. Penningmeester",
    counterpartyIban: "NL00BANK0000000001",
    bankRef: null,
    ...overrides,
  };
}

const statement = (lines: CamtLine[], overrides: Partial<CamtStatement> = {}): CamtStatement => ({
  account: BETAAL,
  opening: null,
  closing: null,
  lines,
  ...overrides,
});

const result = (added: number, known: number, beforeStart = 0): ImportResult => ({ added, known, beforeStart, autoBooked: 0 });

const count = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM bank_lines").first<{ n: number }>())!.n;

const move = (debit: string, credit: string, cents: number): EntryLine[] => [
  { accountCode: debit, amountCents: cents, note: null, assetId: null },
  { accountCode: credit, amountCents: -cents, note: null, assetId: null },
];

const patchAccount = (code: string, json: unknown) => api(`/api/admin/boekhouding/money-accounts/${code}`, { method: "PATCH", cookie, json });

async function setIdentifier(code: string, identifier: string | null) {
  const res = await patchAccount(code, { identifier });
  expect(res.status).toBe(200);
}

const importFile = (accountCode: string, body: CamtStatement) =>
  api("/api/admin/boekhouding/bank/import", { method: "POST", cookie, json: { accountCode, statement: body } });

async function imported(accountCode: string, body: CamtStatement): Promise<ImportResult> {
  const res = await importFile(accountCode, body);
  expect(res.status).toBe(200);
  return res.json<ImportResult>();
}

const typeLine = (json: unknown) => api("/api/admin/boekhouding/bank/lines", { method: "POST", cookie, json });

async function accountsByCode(): Promise<Map<string, MoneyAccount>> {
  const res = await api("/api/admin/boekhouding/money-accounts", { cookie });
  expect(res.status).toBe(200);
  return new Map((await res.json<MoneyAccount[]>()).map((account) => [account.accountCode, account]));
}

it("reads a line once, also from a second, overlapping file", async () => {
  await setIdentifier("1010", BETAAL);
  const march = line({ bookingDate: "2027-03-20" });
  const april = line({ bookingDate: "2027-04-02", amountCents: -6950, description: "Factuur 2027-014", counterpartyIban: "NL00BANK0987654321" });
  expect(await imported("1010", statement([march]))).toEqual(result(1, 0));
  expect(await imported("1010", statement([march]))).toEqual(result(0, 1));
  expect(await imported("1010", statement([march, april]))).toEqual(result(1, 1));
  expect(await count()).toBe(2);
});

it("keeps two equal lines on one day as two, and still once each", async () => {
  await setIdentifier("1010", BETAAL);
  const file = statement([line(), line()]);
  expect(await imported("1010", file)).toEqual(result(2, 0));
  expect(await imported("1010", file)).toEqual(result(0, 2));
  // A later file with a third equal line that day adds only that one.
  expect(await imported("1010", statement([line(), line(), line()]))).toEqual(result(1, 2));
  expect(await count()).toBe(3);
});

it("recognises a line from Enable Banking in a file without a reference", async () => {
  await setIdentifier("1010", BETAAL);
  const fromBank = line({ bankRef: "EB-0001", description: "KASSTORTING JULI / O. Penningmeester", counterpartyIban: "nl00 bank 0000 0000 01" });
  expect(await importLines(env.DB, "1010", [fromBank], "enable_banking", NOW)).toEqual(result(1, 0));
  expect(await imported("1010", statement([line({ description: "kasstorting" })]))).toEqual(result(0, 1));
  // And the other way round: the same reference again, worded differently and on another day, is known as well.
  expect(await importLines(env.DB, "1010", [line({ bankRef: "EB-0001", bookingDate: "2027-03-21" })], "enable_banking", NOW)).toEqual(result(0, 1));
  expect(await count()).toBe(1);
  const stored = await env.DB.prepare("SELECT origin, bank_ref, counterparty_iban, description FROM bank_lines").first();
  expect(stored).toEqual({
    origin: "enable_banking",
    bank_ref: "EB-0001",
    counterparty_iban: "NL00BANK0000000001",
    description: "KASSTORTING JULI / O. Penningmeester",
  });
});

it("keeps a new line with its own reference, also when the bank sends it before one it sent already", async () => {
  // "Nu bijwerken" at noon fetched the first kasstorting; at night the bank lists the second one first.
  const first = line({ bankRef: "EB-A" });
  const second = line({ bankRef: "EB-B" });
  expect(await importLines(env.DB, "1010", [first], "enable_banking", NOW)).toEqual(result(1, 0));
  expect(await importLines(env.DB, "1010", [second, first], "enable_banking", NOW)).toEqual(result(1, 1));
  expect(await importLines(env.DB, "1010", [first, second], "enable_banking", NOW)).toEqual(result(0, 2));
  // The file of that day, without references, holds the same two.
  expect(await importLines(env.DB, "1010", [line(), line()], "file", NOW)).toEqual(result(0, 2));
  expect(await count()).toBe(2);
});

it("stores each line once when the same file arrives twice at the same moment", async () => {
  const lines = [line(), line(), line({ bookingDate: "2027-03-21" }), line({ bankRef: "R-1", amountCents: -1250 })];
  const [a, b] = await Promise.all([
    importLines(env.DB, "1010", lines, "file", NOW),
    importLines(env.DB, "1010", lines, "file", NOW),
  ]);
  expect(a.added + b.added).toBe(4);
  expect(a.known + b.known).toBe(4);
  expect(await count()).toBe(4);
});

it("skips lines before the ledger starts", async () => {
  await setIdentifier("1010", BETAAL);
  expect(await imported("1010", statement([line({ bookingDate: "2026-12-30" }), line({ bookingDate: "2027-01-01" })]))).toEqual(result(1, 0, 1));
  expect(await env.DB.prepare("SELECT booking_date FROM bank_lines").all().then((r) => r.results)).toEqual([{ booking_date: "2027-01-01" }]);
  await env.DB.prepare("DELETE FROM bank_lines").run();
  expect(await imported("1010", statement([line({ bookingDate: "2026-12-30" })]))).toEqual(result(0, 0, 1));
  expect(await count()).toBe(0);
});

it("marks a line in a closed year", async () => {
  await env.DB.prepare("UPDATE ledger_years SET status = 'closed', closed_at = '2028-02-01T10:00:00.000Z' WHERE year = 2027").run();
  await env.DB.prepare("INSERT INTO ledger_years (year, status) VALUES (2028, 'open')").run();
  await setIdentifier("1010", BETAAL);
  expect(await imported("1010", statement([line({ bookingDate: "2027-12-31" }), line({ bookingDate: "2028-01-02" })]))).toEqual(result(2, 0));
  const { results } = await env.DB.prepare("SELECT id FROM bank_lines ORDER BY booking_date").all<{ id: string }>();
  const [late, current] = await Promise.all(results.map((row) => getBankLine(env.DB, row.id)));
  expect(late).toMatchObject({ date: "2027-12-31", status: "open", inClosedYear: true });
  expect(current).toMatchObject({ date: "2028-01-02", status: "open", inClosedYear: false });
});

it("refuses a file of another account", async () => {
  await setIdentifier("1011", SPAAR);
  const res = await importFile("1011", statement([line()], { account: BETAAL }));
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "wrong_account" });
  expect(await count()).toBe(0);
  // Spaces and case do not count.
  expect(await imported("1011", statement([line()], { account: " v0000 0000 " }))).toEqual(result(1, 0));
});

it("asks for the account's identifier before it reads a file", async () => {
  const res = await importFile("1020", statement([line()]));
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "identifier_missing" });
  expect(await count()).toBe(0);
});

it("reads files only into a bank account", async () => {
  for (const code of ["1000", "1030", "8030", "9999"]) {
    const res = await importFile(code, statement([line()]));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "not_a_bank_account" });
  }
  const bad = await api("/api/admin/boekhouding/bank/import", { method: "POST", cookie, json: { accountCode: "1010", statement: { account: BETAAL } } });
  expect(bad.status).toBe(400);
  expect(await bad.json()).toEqual({ error: "invalid" });
  const many = await importFile("1010", statement(Array.from({ length: 2001 }, () => line())));
  expect(many.status).toBe(400);
  expect(await many.json()).toEqual({ error: "too_many_lines" });
});

it("compares the ledger with the bank's balance on the same date", async () => {
  await setOpening(env.DB, 2027, { lines: [{ accountCode: "1011", amountCents: 1_088_345 }], eBoekhoudenEquityCents: null }, NOW);
  await setIdentifier("1011", SPAAR);
  const rente = line({ bookingDate: "2027-01-01", amountCents: 14_402, description: "Rente", counterpartyName: null, counterpartyIban: null });
  const file = statement([rente], { account: SPAAR, opening: { date: "2027-01-01", cents: 1_088_345 }, closing: { date: "2027-11-22", cents: 1_102_747 } });
  expect(await imported("1011", file)).toEqual(result(1, 0));
  // The bank's opening balance is its balance at the end of the day before.
  const { results: balances } = await env.DB.prepare("SELECT account_code, date, balance_cents, origin FROM bank_balances ORDER BY date").all();
  expect(balances).toEqual([
    { account_code: "1011", date: "2026-12-31", balance_cents: 1_088_345, origin: "file" },
    { account_code: "1011", date: "2027-11-22", balance_cents: 1_102_747, origin: "file" },
  ]);
  // Something booked after the bank's date does not count.
  await createEntry(env.DB, { date: "2027-11-23", description: "Later", source: "manual", lines: move("1011", "8030", 500) }, NOW);

  const unbooked = (await accountsByCode()).get("1011");
  expect(unbooked).toEqual({
    accountCode: "1011",
    name: "ING kwartaalrekening",
    identifier: SPAAR,
    source: "file",
    ledgerCents: 1_088_345,
    bank: { date: "2027-11-22", balanceCents: 1_102_747 },
    differenceCents: -14_402,
  });

  const { id } = (await env.DB.prepare("SELECT id FROM bank_lines").first<{ id: string }>())!;
  await createEntry(env.DB, { date: "2027-01-01", description: "Rente", source: "bank", sourceRef: id, lines: move("1011", "8030", 14_402) }, NOW);
  expect((await accountsByCode()).get("1011")).toMatchObject({ ledgerCents: 1_102_747, differenceCents: 0 });

  // A newer file moves the comparison to its own date.
  expect(await imported("1011", statement([], { account: SPAAR, closing: { date: "2027-11-23", cents: 1_103_247 } }))).toEqual(result(0, 0));
  expect((await accountsByCode()).get("1011")).toMatchObject({ ledgerCents: 1_103_247, bank: { date: "2027-11-23", balanceCents: 1_103_247 }, differenceCents: 0 });
});

it("keeps no opening balance from before 31 December 2026", async () => {
  await setIdentifier("1011", SPAAR);
  await imported("1011", statement([], { account: SPAAR, opening: { date: "2026-12-31", cents: 1 }, closing: { date: "2027-01-31", cents: 2 } }));
  await imported("1011", statement([], { account: SPAAR, opening: { date: "2027-01-01", cents: 3 }, closing: null }));
  const { results } = await env.DB.prepare("SELECT date, balance_cents FROM bank_balances ORDER BY date").all();
  expect(results).toEqual([
    { date: "2026-12-31", balance_cents: 3 },
    { date: "2027-01-31", balance_cents: 2 },
  ]);
});

it("counts the ledger up to today when the bank has given no balance", async () => {
  await createEntry(env.DB, { date: "2027-03-01", description: "Bonnetje", source: "manual", lines: move("4514", "1010", 1250) }, NOW);
  await createEntry(env.DB, { date: "2027-12-01", description: "Later", source: "manual", lines: move("4514", "1010", 500) }, NOW);
  const accounts = await moneyAccounts(env.DB, NOW);
  expect(accounts.map((account) => [account.accountCode, account.source])).toEqual([
    ["1000", "kassa"],
    ["1010", "file"],
    ["1011", "file"],
    ["1020", "file"],
    ["1021", "file"],
    ["1030", "mollie"],
  ]);
  expect(accounts.find((account) => account.accountCode === "1010")).toEqual({
    accountCode: "1010",
    name: "ING betaalrekening",
    identifier: null,
    source: "file",
    ledgerCents: -1250,
    bank: null,
    differenceCents: null,
  });
});

it("lets the penningmeester set each account's identifier and source", async () => {
  const set = await patchAccount("1010", { identifier: "  NL00 INGB 0000 0000 00 ", source: "enable_banking" });
  expect(set.status).toBe(200);
  expect(await set.json()).toMatchObject({ accountCode: "1010", identifier: "NL00 INGB 0000 0000 00", source: "enable_banking" });
  // Files can still be read with Enable Banking on.
  expect(await imported("1010", statement([line()]))).toEqual(result(1, 0));
  expect(await (await patchAccount("1010", { source: "file" })).json()).toMatchObject({ identifier: "NL00 INGB 0000 0000 00", source: "file" });
  expect(await (await patchAccount("1010", { identifier: "" })).json()).toMatchObject({ identifier: null, source: "file" });
  for (const [code, source] of [["1000", "file"], ["1030", "enable_banking"], ["1010", "kassa"], ["1011", "mollie"]] as const) {
    const res = await patchAccount(code, { source });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "source_fixed" });
  }
  expect((await patchAccount("8030", { identifier: "x" })).status).toBe(404);
  expect((await accountsByCode()).get("1000")!.source).toBe("kassa");
});

it("lets the penningmeester type a line by hand", async () => {
  const typed = { accountCode: "1011", date: "2027-03-31", amountCents: 500, description: "Rente", counterpartyName: "ING" };
  const res = await typeLine(typed);
  expect(res.status).toBe(201);
  const created = await res.json<BankLine>();
  expect(created).toEqual({
    id: expect.any(String),
    accountCode: "1011",
    date: "2027-03-31",
    amountCents: 500,
    counterpartyName: "ING",
    counterpartyIban: null,
    description: "Rente",
    status: "open",
    waitingFor: null,
    note: null,
    entryId: null,
    suggestion: null,
    inClosedYear: false,
  });
  expect(await getBankLine(env.DB, created.id)).toEqual(created);
  const stored = await env.DB.prepare("SELECT origin, bank_ref FROM bank_lines WHERE id = ?").bind(created.id).first();
  expect(stored).toEqual({ origin: "typed", bank_ref: null });

  // Typed twice, it is two lines; the bank file of that day then holds the same two.
  expect((await typeLine({ ...typed, counterpartyName: undefined })).status).toBe(201);
  expect(await count()).toBe(2);
  await setIdentifier("1011", SPAAR);
  const rente = line({ bookingDate: "2027-03-31", amountCents: 500, description: "Rente kwartaal", counterpartyName: null, counterpartyIban: null });
  expect(await imported("1011", statement([rente, rente], { account: SPAAR }))).toEqual(result(0, 2));
  expect(await count()).toBe(2);
});

it("refuses a typed line it cannot keep", async () => {
  const typed = { accountCode: "1011", date: "2027-03-31", amountCents: 500, description: "Rente" };
  const refused = async (json: unknown, status: number, error: string) => {
    const res = await typeLine(json);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
  };
  await refused({ ...typed, date: "2026-12-31" }, 400, "before_start");
  await refused({ ...typed, accountCode: "1000" }, 400, "not_a_bank_account");
  await refused({ ...typed, accountCode: "1030" }, 400, "not_a_bank_account");
  await refused({ ...typed, amountCents: 0 }, 400, "invalid");
  await refused({ ...typed, amountCents: 1.5 }, 400, "invalid");
  await refused({ ...typed, description: " " }, 400, "invalid");
  await refused({ ...typed, description: "x".repeat(201) }, 400, "invalid");
  await refused({ ...typed, date: "2027-02-30" }, 400, "invalid");
  expect(await count()).toBe(0);
});

it("reads a year of lines in a handful of database calls", async () => {
  await setIdentifier("1010", BETAAL);
  const lines = Array.from({ length: 1000 }, (_, i) =>
    line({ bookingDate: shiftDate("2027-01-01", i % 365), amountCents: -(100 + i), counterpartyIban: `NL00BANK${String(i % 50).padStart(10, "0")}` }),
  );
  const file = statement(lines, { opening: { date: "2027-01-01", cents: 0 }, closing: { date: "2027-12-31", cents: -1 } });
  const first = meteredDb(env.DB);
  expect(await importStatement(first.db, "1010", file, NOW)).toEqual(result(1000, 0));
  expect(first.calls()).toBeLessThanOrEqual(4);
  const again = meteredDb(env.DB);
  expect(await importStatement(again.db, "1010", file, NOW)).toEqual(result(0, 1000));
  expect(again.calls()).toBeLessThanOrEqual(4);
  expect(await count()).toBe(1000);
});
