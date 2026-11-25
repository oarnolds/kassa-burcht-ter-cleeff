import { env } from "cloudflare:workers";
import { beforeEach, expect, it, vi } from "vitest";
import type { Entry } from "../shared/ledger-types";
import { formatEuro } from "../shared/money";
import { addTypedLine, autoBook, bookLine, importLines, moneyAccounts, openLines, payoutsInTransit } from "../worker/db/bank";
import { balancesOn, getEntry } from "../worker/db/ledger";
import { overview } from "../worker/db/ledger-reports";
import { type MollieMonth, mollieMonth, syncMolliePayments, syncSettlements } from "../worker/db/mollie-ledger";
import type { Env } from "../worker/env";
import { runNightly } from "../worker/nightly";
import { api, asAdmin, openGate, resetData, useFakeMollie } from "./helpers";

// Mollie's payouts arriving on ING betaal (1010), booked with Mollie's costs, and the monthly comparison of the
// kassa's pin with Mollie. Mollie is the fake one; the ING lines are read in as from a bank file.

const mollie = useFakeMollie();
beforeEach(async () => {
  await resetData();
  await openGate();
});

const NOW = new Date("2027-03-16T02:00:00.000Z");
const orgEnv = (over: Partial<Env> = {}): Env => ({ ...env, MOLLIE_ORG_TOKEN: "org_fake", ...over });
const settle = (now: Date = NOW) => syncSettlements(orgEnv(), now);

/** A line on ING betaal as the bank file gives it. */
const ingLine = (date: string, cents: number, description: string, accountCode = "1010") =>
  importLines(env.DB, accountCode, [{ bookingDate: date, amountCents: cents, description, counterpartyName: "Stichting Mollie Payments", counterpartyIban: "NL31DEUT0265262461", bankRef: null }], "file", NOW);

async function entry(source: string, ref: string): Promise<Entry | null> {
  const row = await env.DB.prepare("SELECT id FROM ledger_entries WHERE source = ? AND source_ref = ?").bind(source, ref).first<{ id: string }>();
  return row ? getEntry(env.DB, row.id) : null;
}
const amounts = (e: Entry | null) => e?.lines.map((line) => [line.accountCode, line.amountCents]);
const count = async (from: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${from}`).first<{ n: number }>())!.n;
const lineOf = (description: string) =>
  env.DB.prepare("SELECT id, status, waiting_for, note, entry_id FROM bank_lines WHERE description = ?").bind(description).first<{
    id: string;
    status: string;
    waiting_for: string | null;
    note: string | null;
    entry_id: string | null;
  }>();

/** A paid payment at Mollie, made a minute before it was paid. */
function paid(id: string, amount: string, description: string, paidAt: string, method = "ideal") {
  const createdAt = new Date(Date.parse(paidAt) - 60_000).toISOString();
  return mollie.current.addPayment({ id, method, amount, description, status: "paid", createdAt, paidAt });
}

/** A paid sale of the kassa with one line, as the kassa writes it; a pin sale carries its Mollie payment. */
function kassaSale(input: { date: string; cents: number; method?: "cash" | "pin"; paymentId?: string | null; reverses?: string | null; id?: string }): D1PreparedStatement[] {
  const id = input.id ?? crypto.randomUUID();
  return [
    env.DB.prepare(
      `INSERT INTO sales (id, method, status, total_cents, sold_at, received_at, business_date, mollie_payment_id, mollie_mode, reverses_sale_id)
       VALUES (?1, ?2, 'paid', ?3, ?4, ?4, ?5, ?6, ?7, ?8)`,
    ).bind(id, input.method ?? "pin", input.cents, `${input.date}T10:00:00.000Z`, input.date, input.paymentId ?? null, input.paymentId ? "live" : null, input.reverses ?? null),
    env.DB.prepare(
      "INSERT INTO sale_lines (sale_id, product_id, name, category_id, category_name, unit_price_cents, qty) VALUES (?1, 'kaartje', 'Kaartje', 'entree', 'Entree', ?2, 1)",
    ).bind(id, input.cents),
  ];
}

it("books a payout on ING with Mollie's costs", async () => {
  const first = mollie.current.addSettlement({ reference: "05665564.2703.01", amount: "98.12", settledAt: "2027-03-08T06:00:00+00:00", costs: { "2027": { "03": ["1.50", "0.38"] } } });
  // Mollie does not say how it signs its costs (R24): booked as costs either way.
  const second = mollie.current.addSettlement({ reference: "05665564.2703.02", amount: "48.50", settledAt: "2027-03-15T06:00:00+00:00", costs: { "2027": { "03": ["-1.50"] } } });
  // The payout still being made up has no reference yet.
  mollie.current.addSettlement({ id: "stl_next", reference: null, status: "open", settledAt: null, amount: "12.00", costs: {} });
  expect(await settle()).toBe("ok");
  expect((await env.DB.prepare("SELECT id, reference, status, amount_cents, costs_cents FROM mollie_settlements ORDER BY id").all()).results).toEqual([
    { id: "stl_next", reference: null, status: "open", amount_cents: 1200, costs_cents: 0 },
    { id: first.id, reference: "05665564.2703.01", status: "paidout", amount_cents: 9812, costs_cents: 188 },
    { id: second.id, reference: "05665564.2703.02", status: "paidout", amount_cents: 4850, costs_cents: -150 },
  ]);

  await ingLine("2027-03-09", 9812, "Uitbetaling 05665564.2703.01 Mollie");
  await ingLine("2027-03-16", 4850, "05665564.2703.02");
  expect(await autoBook(env.DB, NOW)).toBe(2);

  const payout = await entry("mollie_settlement", first.id);
  expect(payout).toMatchObject({ year: 2027, date: "2027-03-09", description: "Uitbetaling Mollie 05665564.2703.01", source: "mollie_settlement", editable: false });
  expect(amounts(payout)).toEqual([
    ["1010", 9812],
    ["4511", 188],
    ["1030", -10000],
  ]);
  expect(amounts(await entry("mollie_settlement", second.id))).toEqual([
    ["1010", 4850],
    ["4511", 150],
    ["1030", -5000],
  ]);
  expect(await lineOf("Uitbetaling 05665564.2703.01 Mollie")).toMatchObject({ status: "booked", waiting_for: null, note: null, entry_id: payout!.id });
  expect(await openLines(env.DB, {})).toEqual([]);
});

it("finds the payout's reference also with a letter glued to it, but not inside a longer number", async () => {
  const payout = mollie.current.addSettlement({ reference: "05665564.2703.01", amount: "98.12", settledAt: "2027-03-08T06:00:00+00:00", costs: { "2027": { "03": ["1.88"] } } });
  expect(await settle()).toBe("ok");
  // As ING writes it: a letter right before the reference.
  await ingLine("2027-03-09", 9812, "Stichting Mollie Payments T05665564.2703.01  RF1");
  await ingLine("2027-03-10", 9812, "Factuur 105665564.2703.01 en 05665564.2703.011");
  expect(await autoBook(env.DB, NOW)).toBe(1);

  const booked = await entry("mollie_settlement", payout.id);
  expect(amounts(booked)).toEqual([
    ["1010", 9812],
    ["4511", 188],
    ["1030", -10000],
  ]);
  expect(await lineOf("Stichting Mollie Payments T05665564.2703.01  RF1")).toMatchObject({ status: "booked", entry_id: booked!.id });
  // Digits that go on make no reference: left as it was, not "al geboekt".
  expect(await lineOf("Factuur 105665564.2703.01 en 05665564.2703.011")).toMatchObject({ status: "open", waiting_for: null, note: null, entry_id: null });
});

it("waits for Mollie when the payout is not known yet, then books it", async () => {
  await ingLine("2027-03-09", 9812, "05665564.2703.01 Stichting Mollie Payments");
  // A debit that carries a payout's reference, and a credit on another account: no payouts, left as they are.
  await ingLine("2027-03-09", -500, "Terugboeking 05665564.2703.01");
  await ingLine("2027-03-09", 9812, "05665564.2703.01", "1011");
  expect(await autoBook(env.DB, NOW)).toBe(0);
  const waiting = (await openLines(env.DB, {})).map((line) => [line.accountCode, line.amountCents, line.status, line.waitingFor, line.note]);
  expect(waiting).toEqual([
    ["1010", 9812, "waiting", "mollie", null],
    ["1010", -500, "open", null, null],
    ["1011", 9812, "open", null, null],
  ]);
  expect((await overview(env.DB, NOW)).waitingLines).toBe(1);

  // Every later run looks again; until Mollie knows the payout, the line keeps waiting.
  expect(await settle()).toBe("ok");
  expect(await autoBook(env.DB, NOW)).toBe(0);
  expect(await lineOf("05665564.2703.01 Stichting Mollie Payments")).toMatchObject({ status: "waiting", waiting_for: "mollie" });

  const payout = mollie.current.addSettlement({ reference: "05665564.2703.01", amount: "98.12", settledAt: "2027-03-08T06:00:00+00:00", costs: { "2027": { "03": ["1.88"] } } });
  expect(await settle(new Date("2027-03-17T02:00:00.000Z"))).toBe("ok");
  const booked = await entry("mollie_settlement", payout.id);
  expect(amounts(booked)).toEqual([
    ["1010", 9812],
    ["4511", 188],
    ["1030", -10000],
  ]);
  expect(await lineOf("05665564.2703.01 Stichting Mollie Payments")).toMatchObject({ status: "booked", waiting_for: null, entry_id: booked!.id });
  expect((await overview(env.DB, NOW)).waitingLines).toBe(0);
  expect(await count("ledger_entries")).toBe(1);
});

it("never books a payout whose amount differs", async () => {
  const differs = `Bedrag wijkt af van de uitbetaling bij Mollie (${formatEuro(9812)})`;
  expect(differs).toBe("Bedrag wijkt af van de uitbetaling bij Mollie (€ 98,12)");
  mollie.current.addSettlement({ reference: "05665564.2703.01", amount: "98.12", settledAt: "2027-03-08T06:00:00+00:00", costs: { "2027": { "03": ["1.88"] } } });
  expect(await settle()).toBe("ok");
  await ingLine("2027-03-09", 9800, "05665564.2703.01");
  expect(await autoBook(env.DB, NOW)).toBe(0);
  expect(await lineOf("05665564.2703.01")).toMatchObject({ status: "open", waiting_for: null, note: differs, entry_id: null });
  expect((await openLines(env.DB, {}))[0]).toMatchObject({ status: "open", note: differs });

  // Again and again: nothing is guessed and nothing is written.
  const lines = () => env.DB.prepare("SELECT * FROM bank_lines ORDER BY id").all().then((r) => r.results);
  const before = await lines();
  expect(await autoBook(env.DB, NOW)).toBe(0);
  expect(await settle()).toBe("ok");
  expect(await lines()).toEqual(before);
  expect(await count("ledger_entries")).toBe(0);

  // A line that waited, whose payout then turns out to differ, goes back to the penningmeester with the reason.
  await ingLine("2027-03-20", 5000, "05665564.2703.02");
  expect(await autoBook(env.DB, NOW)).toBe(0);
  expect(await lineOf("05665564.2703.02")).toMatchObject({ status: "waiting", waiting_for: "mollie", note: null });
  mollie.current.addSettlement({ reference: "05665564.2703.02", amount: "49.99", settledAt: "2027-03-19T06:00:00+00:00", costs: {} });
  expect(await settle(new Date("2027-03-21T02:00:00.000Z"))).toBe("ok");
  expect(await lineOf("05665564.2703.02")).toMatchObject({
    status: "open",
    waiting_for: null,
    note: `Bedrag wijkt af van de uitbetaling bij Mollie (${formatEuro(4999)})`,
  });
  expect(await count("ledger_entries")).toBe(0);

  // He books it himself; the app leaves it at that.
  const line = (await lineOf("05665564.2703.01"))!;
  await bookLine(env.DB, line.id, { split: [{ accountCode: "1030", amountCents: -9800 }] }, NOW);
  expect(await autoBook(env.DB, NOW)).toBe(0);
  expect(await lineOf("05665564.2703.01")).toMatchObject({ status: "booked" });
  expect(await count("ledger_entries WHERE source = 'mollie_settlement'")).toBe(0);
});

it("books one payout once, also when the night runs twice", async () => {
  const payout = mollie.current.addSettlement({ reference: "05665564.2703.01", amount: "98.12", settledAt: "2027-03-08T06:00:00+00:00", costs: { "2027": { "03": ["1.88"] } } });
  await ingLine("2027-03-09", 9812, "05665564.2703.01");
  // The night and "Nu bijwerken" at the same moment, and a second read of the settlements alongside.
  const [a, b, night] = await Promise.all([settle(), settle(), runNightly(orgEnv(), NOW)]);
  expect([a, b, night.steps.mollie]).toEqual(["ok", "ok", "ok"]);
  expect(await count("ledger_entries WHERE source = 'mollie_settlement'")).toBe(1);
  const booked = (await entry("mollie_settlement", payout.id))!;
  expect(amounts(booked)).toEqual([
    ["1010", 9812],
    ["4511", 188],
    ["1030", -10000],
  ]);
  expect(await lineOf("05665564.2703.01")).toMatchObject({ status: "booked", entry_id: booked.id });

  // A second night changes nothing.
  const snapshot = async () => ({
    entries: (await env.DB.prepare("SELECT id, updated_at FROM ledger_entries ORDER BY id").all()).results,
    lines: (await env.DB.prepare("SELECT * FROM ledger_lines ORDER BY id").all()).results,
    bank: (await env.DB.prepare("SELECT * FROM bank_lines ORDER BY id").all()).results,
  });
  const first = await snapshot();
  expect((await runNightly(orgEnv(), new Date("2027-03-17T02:00:00.000Z"))).steps.mollie).toBe("ok");
  expect(await autoBook(env.DB, NOW)).toBe(0);
  expect(await snapshot()).toEqual(first);
  // Booking the payout's line again by hand would book the money twice: refused, the payout's entry stays.
  const line = (await lineOf("05665564.2703.01"))!;
  await expect(bookLine(env.DB, line.id, { split: [{ accountCode: "8040", amountCents: -9812 }] }, NOW)).rejects.toMatchObject({ code: "not_editable", status: 409 });
  expect(await snapshot()).toEqual(first);

  // The same payout typed in once more: it is not booked a second time, and says why.
  await addTypedLine(env.DB, { accountCode: "1010", date: "2027-03-09", amountCents: 9812, description: "05665564.2703.01 overgetypt", counterpartyName: null }, NOW);
  expect(await autoBook(env.DB, NOW)).toBe(0);
  expect(await lineOf("05665564.2703.01 overgetypt")).toMatchObject({ status: "open", note: "Uitbetaling 05665564.2703.01 is al geboekt" });
  expect(await count("ledger_entries WHERE source = 'mollie_settlement'")).toBe(1);
  expect((await balancesOn(env.DB, "2027-12-31")).get("1030")).toBe(-10000);
});

it("lets him book a waiting payout line by hand, and the payout that follows books nothing twice", async () => {
  await ingLine("2027-03-09", 9812, "05665564.2703.01 Mollie");
  expect(await autoBook(env.DB, NOW)).toBe(0);
  const line = (await lineOf("05665564.2703.01 Mollie"))!;
  expect(line).toMatchObject({ status: "waiting", waiting_for: "mollie" });

  // He does not wait for Mollie: he books it himself, costs and all.
  const own = await bookLine(env.DB, line.id, { split: [{ accountCode: "4511", amountCents: 188 }, { accountCode: "1030", amountCents: -10000 }] }, NOW);
  expect(own).toMatchObject({ source: "bank", sourceRef: line.id });
  expect(await lineOf("05665564.2703.01 Mollie")).toMatchObject({ status: "booked", waiting_for: null, entry_id: own.id });

  // Mollie's payout comes in later: the line and his entry stay as they are, and nothing books it again.
  const snapshot = async () => ({
    entries: (await env.DB.prepare("SELECT id, source, updated_at FROM ledger_entries ORDER BY id").all()).results,
    lines: (await env.DB.prepare("SELECT * FROM ledger_lines ORDER BY id").all()).results,
    bank: (await env.DB.prepare("SELECT * FROM bank_lines ORDER BY id").all()).results,
  });
  const before = await snapshot();
  mollie.current.addSettlement({ reference: "05665564.2703.01", amount: "98.12", settledAt: "2027-03-08T06:00:00+00:00", costs: { "2027": { "03": ["1.88"] } } });
  expect(await settle(new Date("2027-03-17T02:00:00.000Z"))).toBe("ok");
  expect(await count("mollie_settlements")).toBe(1);
  expect(await autoBook(env.DB, NOW)).toBe(0);
  expect(await snapshot()).toEqual(before);
  expect(await count("ledger_entries WHERE source = 'mollie_settlement'")).toBe(0);
  // On its way to ING from Mollie's payout (8 March) until his booked line (9 March): then it has arrived.
  expect(await payoutsInTransit(env.DB, "2027-03-08")).toBe(10000);
  expect(await payoutsInTransit(env.DB, "2027-03-09")).toBe(0);
});

/** The references e-Boekhouden booked, as the import keeps them. */
const eboekhoudenPaid = (...references: string[]) =>
  env.DB.prepare("INSERT INTO ledger_settings (key, value, updated_at) VALUES ('eboekhouden_payouts', ?1, '2026-11-25T12:00:00.000Z') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify(references))
    .run();

it("leaves a payout line e-Boekhouden has open with a note", async () => {
  await eboekhoudenPaid("05665564.2611.01");
  // As ING writes it (a letter glued to the reference), typed or read in again after the overstap.
  await ingLine("2026-11-26", 9812, "P05665564.2611.01  RF1");
  // Mollie does not even know it: it is not waiting, it stays open with the reason.
  expect(await autoBook(env.DB, NOW)).toBe(0);
  const note = "Uitbetaling 05665564.2611.01 staat al in e-Boekhouden.";
  expect(await lineOf("P05665564.2611.01  RF1")).toMatchObject({ status: "open", waiting_for: null, note, entry_id: null });

  // Also when Mollie does know it, and a second run changes nothing.
  mollie.current.addSettlement({ reference: "05665564.2611.01", amount: "98.12", settledAt: "2026-11-02T06:00:00+00:00", costs: { "2026": { "11": ["1.88"] } } });
  expect(await syncSettlements(orgEnv(), new Date("2026-11-27T02:00:00.000Z"))).toBe("ok");
  expect(await autoBook(env.DB, NOW)).toBe(0);
  expect(await autoBook(env.DB, NOW)).toBe(0);
  expect(await lineOf("P05665564.2611.01  RF1")).toMatchObject({ status: "open", note, entry_id: null });
  expect(await count("ledger_entries WHERE source = 'mollie_settlement'")).toBe(0);
});

it("does not count e-Boekhouden's payout as in transit", async () => {
  mollie.current.addSettlement({ reference: "05665564.2611.01", amount: "98.12", settledAt: "2026-11-01T06:00:00+00:00", costs: { "2026": { "11": ["1.88"] } } });
  expect(await syncSettlements(orgEnv(), new Date("2026-11-27T02:00:00.000Z"))).toBe("ok");
  // Without the list it is on its way (settled on the first day of Mollie in the app) ...
  expect(await payoutsInTransit(env.DB, "2026-11-10")).toBe(10000);
  // ... with the reference in it, e-Boekhouden has it: 0.
  await eboekhoudenPaid("05665564.2611.01");
  expect(await payoutsInTransit(env.DB, "2026-11-10")).toBe(0);
  // A payout of before Mollie's start is never in transit either.
  await env.DB.prepare(
    "INSERT INTO mollie_settlements (id, reference, status, settled_at, amount_cents, costs_cents) VALUES ('stl_oct', '05665564.2610.01', 'paidout', '2026-10-30T06:00:00.000Z', 5000, 100)",
  ).run();
  expect(await payoutsInTransit(env.DB, "2026-11-10")).toBe(0);
});

it("books the first payout of the app with its costs", async () => {
  await eboekhoudenPaid("05665564.2611.01");
  paid("tr_rule", "32.00", "Lidm. Speeltuin ter Cleefte", "2026-11-03T10:00:00+00:00");
  paid("tr_pin", "20.00", "Kassa bon", "2026-11-21T10:00:00+00:00", "pointofsale");
  const first = mollie.current.addSettlement({ reference: "05665564.2612.01", amount: "51.00", settledAt: "2026-12-01T06:00:00+00:00", costs: { "2026": { "12": ["1.00"] } } });
  const now = new Date("2026-12-03T02:00:00.000Z");
  expect(await syncMolliePayments(orgEnv(), now)).toBe("ok");
  expect(await syncSettlements(orgEnv(), now)).toBe("ok");
  // On its way until the line arrives on ING.
  expect(await payoutsInTransit(env.DB, "2026-12-01")).toBe(5200);

  await ingLine("2026-12-02", 5100, "P05665564.2612.01  RF1");
  expect(await autoBook(env.DB, now)).toBe(1);
  expect(amounts(await entry("mollie_settlement", first.id))).toEqual([
    ["1010", 5100],
    ["4511", 100],
    ["1030", -5200],
  ]);
  expect(await payoutsInTransit(env.DB, "2026-12-02")).toBe(0);
});

it("reads Mollie's payouts from 1 October 2026 on, so the payout of 2 November is known", async () => {
  mollie.current.addSettlement({ reference: "05665564.2609.04", amount: "50.00", settledAt: "2026-09-30T06:00:00+00:00", costs: { "2026": { "9": ["1.00"] } } });
  const november = mollie.current.addSettlement({ reference: "05665564.2611.01", amount: "98.12", settledAt: "2026-11-02T06:00:00+00:00", costs: { "2026": { "11": ["1.88"] } } });
  expect(await settle(new Date("2026-11-26T02:00:00.000Z"))).toBe("ok");
  expect((await env.DB.prepare("SELECT id FROM mollie_settlements").all()).results).toEqual([{ id: november.id }]);
});

it("leaves the costs of e-Boekhouden's payout out of November's", async () => {
  // The payout of 2 November is in e-Boekhouden, its costs too; the one of 16 November is the app's.
  mollie.current.addSettlement({ reference: "05665564.2611.01", amount: "98.12", settledAt: "2026-11-02T06:00:00+00:00", costs: { "2026": { "11": ["1.88"] } } });
  mollie.current.addSettlement({ reference: "05665564.2611.02", amount: "40.00", settledAt: "2026-11-16T06:00:00+00:00", costs: { "2026": { "11": ["0.75"] } } });
  const now = new Date("2026-11-27T02:00:00.000Z");
  expect(await settle(now)).toBe("ok");
  expect((await mollieMonth(env.DB, "2026-11", now)).costsCents).toBe(188 + 75);
  await eboekhoudenPaid("05665564.2610.01", "05665564.2611.01");
  expect((await mollieMonth(env.DB, "2026-11", now)).costsCents).toBe(75);
});

it("starts the Mollie months in November 2026", async () => {
  const { cookie } = await asAdmin();
  const before = await api("/api/admin/boekhouding/mollie/month?month=2026-10", { cookie });
  expect(before.status).toBe(400);
  expect(await before.json()).toEqual({ error: "before_mollie_start" });
  expect((await api("/api/admin/boekhouding/mollie/month?month=2026-11", { cookie })).status).toBe(200);
});

it("compares the kassa's pin with Mollie's, payment by payment", async () => {
  const kept = "sale_kept";
  await env.DB.batch([
    ...kassaSale({ id: kept, date: "2027-03-06", cents: 250, paymentId: "tr_a" }),
    ...kassaSale({ id: "sale_b", date: "2027-03-20", cents: 120, paymentId: "tr_b" }),
    // Paid at the terminal, but Mollie has no such payment.
    ...kassaSale({ id: "sale_lost", date: "2027-03-21", cents: 300, paymentId: "tr_lost" }),
    // The first one turned back in the kassa on 22 March: it counts in the kassa's pin, as its reports do.
    ...kassaSale({ id: "sale_back", date: "2027-03-22", cents: -250, reverses: kept }),
    // Cash and another month do not count.
    ...kassaSale({ id: "sale_cash", date: "2027-03-06", cents: 1000, method: "cash" }),
    ...kassaSale({ id: "sale_feb", date: "2027-02-27", cents: 400, paymentId: "tr_feb" }),
  ]);
  paid("tr_feb", "4.00", "Kassa bon", "2027-02-27T10:00:00+00:00", "pointofsale");
  paid("tr_a", "2.50", "Kassa bon", "2027-03-06T10:00:00+00:00", "pointofsale");
  paid("tr_b", "1.20", "Kassa bon", "2027-03-20T10:00:00+00:00", "pointofsale");
  // At the terminal, without a sale in the kassa.
  paid("tr_extra", "5.00", "Kassa bon", "2027-03-23T10:00:00+00:00", "pointofsale");
  paid("tr_lid", "32.00", "Lidm. Speeltuin ter Cleefte", "2027-03-07T10:00:00+00:00");
  paid("tr_dag", "2.00", "Dagticket", "2027-03-08T10:00:00+00:00");
  paid("tr_dag2", "1.20", "2x dagkaartje", "2027-03-31T21:30:00+00:00"); // 23:30 in Amsterdam: still March
  paid("tr_apr", "2.00", "Dagticket", "2027-03-31T22:30:00+00:00"); // 00:30 in Amsterdam: April
  paid("tr_gift", "10.00", "Gift", "2027-03-09T10:00:00+00:00"); // in Te boeken: no account yet
  mollie.current.addSettlement({ reference: "05665564.2703.01", amount: "98.12", settledAt: "2027-03-08T06:00:00+00:00", costs: { "2027": { "03": ["1.88"] } } });
  mollie.current.addSettlement({ reference: "05665564.2703.02", amount: "40.00", settledAt: "2027-03-31T21:30:00+00:00", costs: { "2027": { "03": ["-0.50"] } } });
  mollie.current.addSettlement({ reference: "05665564.2704.01", amount: "20.00", settledAt: "2027-03-31T22:30:00+00:00", costs: { "2027": { "04": ["0.75"] } } });
  const now = new Date("2027-04-02T02:00:00.000Z");
  expect(await syncMolliePayments(orgEnv(), now)).toBe("ok");
  expect(await syncSettlements(orgEnv(), now)).toBe("ok");

  const march: MollieMonth = await mollieMonth(env.DB, "2027-03", now);
  expect(march).toEqual({
    month: "2027-03",
    kassaPinCents: 420,
    molliePosCents: 870,
    onlyInKassa: [{ saleId: "sale_lost", date: "2027-03-21", amountCents: 300 }],
    onlyAtMollie: [{ paymentId: "tr_extra", date: "2027-03-23", amountCents: 500 }],
    otherByAccount: [
      { accountCode: "8000", cents: 3200 },
      { accountCode: "8012", cents: 320 },
    ],
    costsCents: 238,
    balance: { ledgerCents: 3520, mollieCents: null, inTransitCents: 0, differenceCents: null },
  });

  // Through the route, behind the login; without a month it is the current one.
  const path = "/api/admin/boekhouding/mollie/month";
  expect((await api(`${path}?month=2027-03`)).status).toBe(401);
  const { cookie } = await asAdmin();
  const answer = await api(`${path}?month=2027-03`, { cookie });
  expect(answer.status).toBe(200);
  expect((await answer.json<MollieMonth>()).onlyInKassa).toEqual(march.onlyInKassa);
  const current = await (await api(path, { cookie })).json<MollieMonth>();
  expect(current.month).toMatch(/^\d{4}-\d{2}$/);
  expect(current.onlyAtMollie).toEqual([]);
  for (const wrong of ["2027-13", "maart", "2027-3"]) expect((await api(`${path}?month=${wrong}`, { cookie })).status).toBe(400);
});

it("keeps 1030 equal to Mollie's balance", async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM settings WHERE key = 'in_use_since'"),
    env.DB.prepare("INSERT INTO settings (key, value) VALUES ('in_use_since', '2026-11-21T09:00:00.000Z')"),
    ...kassaSale({ date: "2027-03-06", cents: 10000, paymentId: "tr_k" }),
  ]);
  // The kassa's pin of the day, a membership and day tickets: all on 1030.
  paid("tr_k", "100.00", "Kassa bon", "2027-03-06T10:00:00+00:00", "pointofsale");
  paid("tr_lid", "32.00", "Lidm. Speeltuin ter Cleefte", "2027-03-06T11:00:00+00:00");
  paid("tr_dag", "1.20", "2x dagkaartje", "2027-03-06T12:00:00+00:00");
  // Mollie pays out the kassa's € 100 less € 1,88 costs; the € 33,20 of the website is still pending.
  mollie.current.addSettlement({ reference: "05665564.2703.01", amount: "98.12", settledAt: "2027-03-08T06:00:00+00:00", costs: { "2027": { "03": ["1.88"] } } });
  mollie.current.balance = { available: "0.00", pending: "33.20" };
  await ingLine("2027-03-09", 9812, "05665564.2703.01 Mollie");

  const night = await runNightly(orgEnv(), new Date("2027-03-10T02:00:00.000Z"));
  expect(night.steps).toEqual({ kassa: "ok", ing: "skipped", mollie: "ok" });
  expect(await count("ledger_entries")).toBe(3); // the kassa day, Mollie overig and the payout
  expect((await balancesOn(env.DB, "2027-03-09")).get("1030")).toBe(3320);
  const mollieAccount = (await moneyAccounts(env.DB, new Date("2027-03-10T08:00:00.000Z"))).find((account) => account.accountCode === "1030");
  expect(mollieAccount).toMatchObject({ ledgerCents: 3320, bank: { date: "2027-03-09", balanceCents: 3320 }, differenceCents: 0 });
  expect((await mollieMonth(env.DB, "2027-03", new Date("2027-03-10T08:00:00.000Z"))).balance).toEqual({ ledgerCents: 3320, mollieCents: 3320, inTransitCents: 0, differenceCents: 0 });
  expect((await overview(env.DB, new Date("2027-03-10T08:00:00.000Z"))).mollieDifferenceCents).toBe(0);

  // Mollie keeps € 25 for something the app does not know of (a terminal, say): the difference shows.
  mollie.current.balance = { available: "0.00", pending: "8.20" };
  expect((await runNightly(orgEnv(), new Date("2027-03-11T02:00:00.000Z"))).steps.mollie).toBe("ok");
  const later = new Date("2027-03-11T08:00:00.000Z");
  expect((await mollieMonth(env.DB, "2027-03", later)).balance).toEqual({ ledgerCents: 3320, mollieCents: 820, inTransitCents: 0, differenceCents: 2500 });
  expect((await overview(env.DB, later)).mollieDifferenceCents).toBe(2500);
  // A month that is over is laid next to Mollie's balance at its end.
  expect((await mollieMonth(env.DB, "2027-02", later)).balance).toEqual({ ledgerCents: 0, mollieCents: null, inTransitCents: 0, differenceCents: null });
});

it("shows a payout on its way to ING as onderweg, not as a difference", async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM settings WHERE key = 'in_use_since'"),
    env.DB.prepare("INSERT INTO settings (key, value) VALUES ('in_use_since', '2026-11-21T09:00:00.000Z')"),
    ...kassaSale({ date: "2027-03-06", cents: 10000, paymentId: "tr_k" }),
  ]);
  paid("tr_k", "100.00", "Kassa bon", "2027-03-06T10:00:00+00:00", "pointofsale");
  paid("tr_lid", "32.00", "Lidm. Speeltuin ter Cleefte", "2027-03-06T11:00:00+00:00");
  paid("tr_dag", "1.20", "2x dagkaartje", "2027-03-06T12:00:00+00:00");
  // Mollie pays out the kassa's € 100 (€ 98,12 plus € 1,88 costs) on the morning of 8 March; it reaches ING on 9 March.
  mollie.current.addSettlement({ reference: "05665564.2703.01", amount: "98.12", settledAt: "2027-03-08T06:00:00+00:00", costs: { "2027": { "03": ["1.88"] } } });
  mollie.current.balance = { available: "0.00", pending: "33.20" };
  const seen = async (now: Date) => ({
    account: (await moneyAccounts(env.DB, now)).find((account) => account.accountCode === "1030"),
    overview: await overview(env.DB, now),
    month: (await mollieMonth(env.DB, "2027-03", now)).balance,
  });

  // The night of 9 March records Mollie's balance of 8 March: the payout has left Mollie, but is not on ING yet.
  expect((await runNightly(orgEnv(), new Date("2027-03-09T02:00:00.000Z"))).steps.mollie).toBe("ok");
  const morning = new Date("2027-03-09T08:00:00.000Z");
  let now = await seen(morning);
  expect(now.account).toMatchObject({ ledgerCents: 13320, bank: { date: "2027-03-08", balanceCents: 3320 }, differenceCents: 0 });
  expect(now.overview).toMatchObject({ mollieDifferenceCents: 0, mollieInTransitCents: 10000 });
  expect(now.month).toEqual({ ledgerCents: 13320, mollieCents: 3320, inTransitCents: 10000, differenceCents: 0 });
  expect(await payoutsInTransit(env.DB, "2027-03-07")).toBe(0);
  expect(await payoutsInTransit(env.DB, "2027-03-08")).toBe(10000);

  // The ING line of 9 March comes in and is booked; Mollie's newest balance is still that of 8 March.
  await ingLine("2027-03-09", 9812, "05665564.2703.01 Mollie");
  expect(await autoBook(env.DB, morning)).toBe(1);
  now = await seen(morning);
  expect(now.account).toMatchObject({ ledgerCents: 13320, differenceCents: 0 });
  expect(now.overview).toMatchObject({ mollieDifferenceCents: 0, mollieInTransitCents: 10000 });

  // The next night records 9 March: nothing on its way any more, and still no difference.
  expect((await runNightly(orgEnv(), new Date("2027-03-10T02:00:00.000Z"))).steps.mollie).toBe("ok");
  now = await seen(new Date("2027-03-10T08:00:00.000Z"));
  expect(now.account).toMatchObject({ ledgerCents: 3320, bank: { date: "2027-03-09", balanceCents: 3320 }, differenceCents: 0 });
  expect(now.overview).toMatchObject({ mollieDifferenceCents: 0, mollieInTransitCents: 0 });
  expect(now.month).toEqual({ ledgerCents: 3320, mollieCents: 3320, inTransitCents: 0, differenceCents: 0 });
});

it("records Mollie's balance under yesterday at night and under today by day", async () => {
  const balances = () => env.DB.prepare("SELECT date, balance_cents FROM bank_balances WHERE account_code = '1030' ORDER BY date").all().then((r) => r.results);
  mollie.current.balance = { available: "10.00", pending: "0.00" };
  expect(await syncMolliePayments(orgEnv(), new Date("2027-03-07T04:59:00.000Z"))).toBe("ok"); // 05:59 in Amsterdam: the night
  expect(await balances()).toEqual([{ date: "2027-03-06", balance_cents: 1000 }]);
  // "Nu bijwerken" from six in the morning: today, as it stands now.
  mollie.current.balance = { available: "12.00", pending: "0.50" };
  expect(await syncMolliePayments(orgEnv(), new Date("2027-03-07T05:00:00.000Z"))).toBe("ok"); // 06:00 in Amsterdam
  expect(await balances()).toEqual([
    { date: "2027-03-06", balance_cents: 1000 },
    { date: "2027-03-07", balance_cents: 1250 },
  ]);
  // The night after puts the whole day in its place.
  mollie.current.balance = { available: "15.00", pending: "0.00" };
  expect(await syncMolliePayments(orgEnv(), new Date("2027-03-08T01:00:00.000Z"))).toBe("ok");
  expect(await balances()).toEqual([
    { date: "2027-03-06", balance_cents: 1000 },
    { date: "2027-03-07", balance_cents: 1500 },
  ]);
  // By day in summer time as well (14:00 in Amsterdam), and late in the evening (23:30).
  expect(await syncMolliePayments(orgEnv(), new Date("2027-07-07T12:00:00.000Z"))).toBe("ok");
  expect(await syncMolliePayments(orgEnv(), new Date("2027-07-08T21:30:00.000Z"))).toBe("ok");
  expect((await balances()).map((row) => (row as { date: string }).date)).toEqual(["2027-03-06", "2027-03-07", "2027-07-07", "2027-07-08"]);
});

it("names a failure of Mollie's payouts without saying more", async () => {
  expect(await syncSettlements(orgEnv({ MOLLIE_ORG_TOKEN: undefined }), NOW)).toBe("skipped");
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    mollie.current.failNext(500);
    expect(await settle()).toBe("unreachable");
    expect(await syncSettlements(orgEnv({ MOLLIE_ORG_TOKEN: "org_wrong" }), NOW)).toBe("unauthorized");
    expect(logged.mock.calls).toEqual([
      ["mollie settlements failed", "unreachable"],
      ["mollie settlements failed", "unauthorized"],
    ]);
  } finally {
    logged.mockRestore();
  }
  expect(await count("mollie_settlements")).toBe(0);
});
