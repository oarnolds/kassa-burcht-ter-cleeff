import { env } from "cloudflare:workers";
import { beforeEach, expect, it, vi } from "vitest";
import type { Env } from "../worker/env";
import { runNightly } from "../worker/nightly";
import { meteredDb, resetData, TEST_EB_APP_ID, testRsaKey, useFakeBoth } from "./helpers";

// A whole night on the free plan: the kassa, ING through Enable Banking and Mollie, each with real work to do,
// within the 50 database calls and 50 external calls a cron run may make. Both fakes answer every fetch.

const fakes = useFakeBoth();
const NIGHT = new Date("2027-03-09T02:00:00.000Z");

beforeEach(async () => {
  await resetData();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM settings WHERE key = 'in_use_since'"),
    env.DB.prepare("INSERT INTO settings (key, value) VALUES ('in_use_since', '2026-11-21T09:00:00.000Z')"),
    env.DB.prepare("UPDATE money_accounts SET identifier = 'NL02INGB0000000001', source = 'enable_banking' WHERE account_code = '1010'"),
    env.DB.prepare(
      `INSERT INTO bank_consents (id, state, status, session_id, account_uid, valid_until, created_at, used_at)
       VALUES ('consent-1', 'state-1', 'active', 'session-1', 'acc-1', '2027-06-01T12:00:00.000Z', '2027-03-01T12:00:00.000Z', '2027-03-01T12:00:00.000Z')`,
    ),
  ]);
});

/** A paid sale of the kassa with one line; a pin sale carries its Mollie payment. */
function kassaSale(date: string, cents: number, paymentId: string | null): D1PreparedStatement[] {
  const id = crypto.randomUUID();
  return [
    env.DB.prepare(
      `INSERT INTO sales (id, method, status, total_cents, sold_at, received_at, business_date, mollie_payment_id, mollie_mode)
       VALUES (?1, ?2, 'paid', ?3, ?4, ?4, ?5, ?6, ?7)`,
    ).bind(id, paymentId ? "pin" : "cash", cents, `${date}T10:00:00.000Z`, date, paymentId, paymentId ? "live" : null),
    env.DB.prepare(
      "INSERT INTO sale_lines (sale_id, product_id, name, category_id, category_name, unit_price_cents, qty) VALUES (?1, 'kaartje', 'Kaartje', 'entree', 'Entree', ?2, 1)",
    ).bind(id, cents),
  ];
}

it("does a whole night within the free plan's calls, and a second night books nothing new", async () => {
  const { pem } = await testRsaKey();
  // The kassa: a week of days with cash and pin.
  const sales: D1PreparedStatement[] = [];
  for (let day = 1; day <= 7; day++) {
    const date = `2027-03-0${day}`;
    sales.push(...kassaSale(date, 500 + day, null), ...kassaSale(date, 1000 + day, `tr_pin${day}`));
    fakes.mollie.current.addPayment({ id: `tr_pin${day}`, method: "pointofsale", amount: `10.0${day}`, description: "Kassa bon", status: "paid", createdAt: `${date}T09:59:00+00:00`, paidAt: `${date}T10:00:00+00:00` });
  }
  await env.DB.batch(sales);
  // The website and the QR code: by rule, one in Te boeken, and a refund of a membership.
  const mollie = fakes.mollie.current;
  mollie.addPayment({ id: "tr_lid", method: "ideal", amount: "32.00", description: "Lidm. Speeltuin ter Cleefte", status: "paid", createdAt: "2027-03-02T10:00:00+00:00", paidAt: "2027-03-02T10:01:00+00:00" });
  mollie.addPayment({ id: "tr_dag", method: "ideal", amount: "1.20", description: "2x dagkaartje", status: "paid", createdAt: "2027-03-05T10:00:00+00:00", paidAt: "2027-03-05T10:01:00+00:00" });
  mollie.addPayment({ id: "tr_gift", method: "ideal", amount: "10.00", description: "Gift", status: "paid", createdAt: "2027-03-06T10:00:00+00:00", paidAt: "2027-03-06T10:01:00+00:00" });
  mollie.addRefund({ id: "re_lid", paymentId: "tr_lid", amount: "32.00", createdAt: "2027-03-07T10:00:00+00:00" });
  // The kassa's first three days paid out, less the costs; it arrives on ING on 8 March.
  const payout = mollie.addSettlement({ reference: "05665564.2703.01", amount: "28.12", settledAt: "2027-03-07T06:00:00+00:00", costs: { "2027": { "03": ["2.00"] } } });
  mollie.balance = { available: "0.00", pending: "23.68" };
  fakes.eb.current.transactions.push({
    entry_reference: "ref-payout",
    transaction_id: null,
    status: "BOOK",
    booking_date: "2027-03-08",
    value_date: "2027-03-08",
    currency: "EUR",
    transaction_amount: { currency: "EUR", amount: "28.12" },
    credit_debit_indicator: "CRDT",
    debtor: { name: "Stichting Mollie Payments" },
    debtor_account: { iban: "NL31DEUT0265262461" },
    remittance_information: ["05665564.2703.01", "Uitbetaling Mollie"],
  });

  let fetches = 0;
  const inner = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    fetches++;
    return inner(input, init);
  });
  const nightEnv = (db: D1Database): Env => ({ ...env, DB: db, MOLLIE_ORG_TOKEN: "org_fake", ENABLE_BANKING_APP_ID: TEST_EB_APP_ID, ENABLE_BANKING_PRIVATE_KEY: pem });

  const first = meteredDb(env.DB);
  const report = await runNightly(nightEnv(first.db), NIGHT);
  expect(report.steps).toEqual({ kassa: "ok", ing: "ok", mollie: "ok" });
  expect(first.calls()).toBeLessThanOrEqual(50);
  expect(fetches).toBeLessThanOrEqual(50);

  const count = async (from: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${from}`).first<{ n: number }>())!.n;
  expect(await count("ledger_entries WHERE source = 'kassa_day'")).toBe(7);
  expect(await count("ledger_entries WHERE source = 'mollie_other'")).toBe(2);
  expect(await count(`ledger_entries WHERE source = 'mollie_settlement' AND source_ref = '${payout.id}'`)).toBe(1);
  expect(await count("bank_lines WHERE account_code = '1010' AND status = 'booked'")).toBe(1);
  expect(await count("bank_lines WHERE account_code = '1030'")).toBe(2); // the gift and the refund

  // The second night: nothing new to book, nothing rewritten, and again within the calls.
  const snapshot = async () => ({
    entries: (await env.DB.prepare("SELECT id, updated_at FROM ledger_entries ORDER BY id").all()).results,
    lines: (await env.DB.prepare("SELECT * FROM ledger_lines ORDER BY id").all()).results,
    bank: (await env.DB.prepare("SELECT id, status, entry_id, waiting_for, note FROM bank_lines ORDER BY id").all()).results,
  });
  const before = await snapshot();
  fetches = 0;
  const again = meteredDb(env.DB);
  expect((await runNightly(nightEnv(again.db), new Date("2027-03-09T03:00:00.000Z"))).steps).toEqual({ kassa: "ok", ing: "ok", mollie: "ok" });
  expect(again.calls()).toBeLessThanOrEqual(50);
  expect(fetches).toBeLessThanOrEqual(50);
  expect(await snapshot()).toEqual(before);
});
