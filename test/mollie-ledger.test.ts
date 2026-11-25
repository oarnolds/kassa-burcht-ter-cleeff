import { env } from "cloudflare:workers";
import { beforeEach, expect, it, vi } from "vitest";
import type { Entry } from "../shared/ledger-types";
import { shiftDate } from "../shared/time";
import { openLines } from "../worker/db/bank";
import { getEntry } from "../worker/db/ledger";
import { exportAll } from "../worker/db/maintenance";
import { type MollieRule, syncMolliePayments } from "../worker/db/mollie-ledger";
import type { Env } from "../worker/env";
import { runNightly } from "../worker/nightly";
import { api, asAdmin, meteredDb, openGate, resetData, useFakeMollie } from "./helpers";

// Mollie's payments of the website and the QR code, read with the organisation's token from the fake Mollie.
// The kassa's own sales are set up directly, as the kassa would have written them (with their Mollie payment).

const mollie = useFakeMollie();
beforeEach(async () => {
  await resetData();
  await openGate();
});

const orgEnv = (over: Partial<Env> = {}): Env => ({ ...env, MOLLIE_ORG_TOKEN: "org_fake", ...over });
const sync = (now: string, over: Partial<Env> = {}) => syncMolliePayments(orgEnv(over), new Date(now));

/** A payment Mollie lists as paid; made a minute before it was paid. */
function paid(id: string, amount: string, description: string, paidAt: string, method = "ideal") {
  const createdAt = new Date(Date.parse(paidAt) - 60_000).toISOString();
  return mollie.current.addPayment({ id, method, amount, description, status: "paid", createdAt, paidAt });
}

/** A pin sale of the kassa, paid through Mollie with `paymentId`. */
function kassaPinSaleStatement(paymentId: string, date: string, cents: number): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO sales (id, method, status, total_cents, sold_at, received_at, business_date, mollie_payment_id, mollie_mode)
     VALUES (?1, 'pin', 'paid', ?2, ?3, ?3, ?4, ?5, 'live')`,
  ).bind(crypto.randomUUID(), cents, `${date}T10:00:00.000Z`, date, paymentId);
}
const kassaPinSale = (paymentId: string, date: string, cents: number) => kassaPinSaleStatement(paymentId, date, cents).run();

async function entry(source: string, ref: string): Promise<Entry | null> {
  const row = await env.DB.prepare("SELECT id FROM ledger_entries WHERE source = ? AND source_ref = ?").bind(source, ref).first<{ id: string }>();
  return row ? getEntry(env.DB, row.id) : null;
}
const amounts = (e: Entry | null) => e?.lines.map((line) => [line.accountCode, line.amountCents]);
const count = async (from: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${from}`).first<{ n: number }>())!.n;
const payment = (id: string) =>
  env.DB.prepare("SELECT kind, account_code, bank_line_id, paid_date FROM mollie_payments WHERE id = ?").bind(id).first<Record<string, string | null>>();
const bankLine = (ref: string) =>
  env.DB.prepare("SELECT id, account_code, booking_date, amount_cents, description, origin, status FROM bank_lines WHERE bank_ref = ?").bind(ref).first();

it("ticks off the kassa's pin payments without booking them again", async () => {
  await kassaPinSale("tr_kassa", "2027-03-06", 120);
  // A kassa receipt for day tickets: it is in the kassa day already, whatever its description says.
  paid("tr_kassa", "1.20", "Kassa bon: 2x dagkaartje", "2027-03-06T10:00:30+00:00", "pointofsale");
  mollie.current.balance = { available: "10.00", pending: "1.20" };

  expect(await sync("2027-03-07T02:00:00.000Z")).toBe("ok");
  expect(await payment("tr_kassa")).toEqual({ kind: "kassa", account_code: null, bank_line_id: null, paid_date: "2027-03-06" });
  expect(await count("bank_lines")).toBe(0);
  expect(await count("ledger_entries WHERE source = 'mollie_other'")).toBe(0);
  // Mollie's balance (available and pending) is laid next to 1030 at the end of yesterday.
  expect(await env.DB.prepare("SELECT date, balance_cents, origin FROM bank_balances WHERE account_code = '1030'").all().then((r) => r.results)).toEqual([
    { date: "2027-03-06", balance_cents: 1120, origin: "mollie" },
  ]);
});

it("books day tickets, memberships and rentals per day by rule", async () => {
  paid("tr_1", "1.20", "Burcht ter Cleeff - 2x dagkaartje", "2027-03-06T09:00:00+00:00");
  paid("tr_2", "32.00", "Lidm. Speeltuin ter Cleefte", "2027-03-06T12:00:00+00:00");
  paid("tr_3", "40.00", "Verhuur reservering", "2027-03-06T22:30:00+00:00"); // 23:30 in Amsterdam: still 6 March
  paid("tr_4", "2.00", "Dagticket", "2027-03-06T23:30:00+00:00"); // 00:30 in Amsterdam: 7 March
  // Not paid (yet): nothing.
  mollie.current.addPayment({ id: "tr_open", method: "ideal", amount: "5.00", description: "Dagkaart", status: "open", createdAt: "2027-03-06T13:00:00+00:00" });
  mollie.current.addPayment({ id: "tr_gone", method: "ideal", amount: "5.00", description: "Dagkaart", status: "expired", createdAt: "2027-03-06T14:00:00+00:00" });

  expect(await sync("2027-03-07T02:00:00.000Z")).toBe("ok");
  const day = await entry("mollie_other", "2027-03-06");
  expect(day).toMatchObject({ year: 2027, date: "2027-03-06", description: "Mollie overig 6-3-2027", source: "mollie_other", editable: false });
  expect(amounts(day)).toEqual([
    ["1030", 7320],
    ["8000", -3200],
    ["8010", -4000],
    ["8012", -120],
  ]);
  expect(amounts(await entry("mollie_other", "2027-03-07"))).toEqual([
    ["1030", 200],
    ["8012", -200],
  ]);
  expect(await payment("tr_2")).toEqual({ kind: "rule", account_code: "8000", bank_line_id: null, paid_date: "2027-03-06" });
  expect(await count("mollie_payments")).toBe(4);
  expect(await count("bank_lines")).toBe(0);
  // The weekly copy takes Mollie's tables along.
  const file = await exportAll(env.DB, new Date("2027-03-08T03:00:00.000Z"));
  expect(file.ledger.mollie_payments).toHaveLength(4);
  expect(file.ledger.mollie_rules).toHaveLength(7);
  expect(file.ledger.mollie_settlements).toEqual([]);
});

it("puts a payment that fits no rule in Te boeken", async () => {
  paid("tr_gift", "10.00", "Gift voor de speeltuin", "2027-03-06T11:00:00+00:00");
  expect(await sync("2027-03-06T20:00:00.000Z")).toBe("ok");
  // Another one of the same amount on the same day, read by a later run: a line of its own.
  paid("tr_gift2", "10.00", "Gift voor de speeltuin", "2027-03-06T21:00:00+00:00");
  expect(await sync("2027-03-07T02:00:00.000Z")).toBe("ok");

  const lines = await openLines(env.DB, { accountCode: "1030" });
  expect(lines.map((line) => [line.date, line.amountCents, line.description, line.status])).toEqual([
    ["2027-03-06", 1000, "Gift voor de speeltuin", "open"],
    ["2027-03-06", 1000, "Gift voor de speeltuin", "open"],
  ]);
  expect(await bankLine("tr_gift")).toMatchObject({ account_code: "1030", origin: "mollie" });
  expect(await payment("tr_gift")).toEqual({ kind: "line", account_code: null, bank_line_id: (await bankLine("tr_gift"))!.id, paid_date: "2027-03-06" });
  expect(await payment("tr_gift2")).toMatchObject({ kind: "line", bank_line_id: (await bankLine("tr_gift2"))!.id });
  expect(await entry("mollie_other", "2027-03-06")).toBeNull();
});

it("puts a refund of a website payment in Te boeken", async () => {
  paid("tr_lid", "32.00", "Lidm. Speeltuin ter Cleefte", "2027-03-06T12:00:00+00:00");
  paid("tr_dag", "2.00", "Dagticket", "2027-03-06T13:00:00+00:00");
  const fake = mollie.current;
  fake.addRefund({ id: "re_1", paymentId: "tr_lid", amount: "32.00", createdAt: "2027-03-08T09:00:00+00:00" });
  // A refund that did not go through, and one that was called off: nothing left Mollie.
  fake.addRefund({ id: "re_failed", paymentId: "tr_lid", amount: "32.00", createdAt: "2027-03-08T09:10:00+00:00", status: "failed" });
  fake.addRefund({ id: "re_canceled", paymentId: "tr_lid", amount: "32.00", createdAt: "2027-03-08T09:20:00+00:00", status: "canceled" });
  // A refund of a payment from before the ledger: its description is not known here.
  fake.addRefund({ id: "re_old", paymentId: "tr_2026", amount: "15.00", createdAt: "2027-03-08T10:00:00+00:00" });
  fake.addChargeback({ id: "chb_1", paymentId: "tr_dag", amount: "2.00", createdAt: "2027-03-08T11:00:00+00:00" });

  expect(await sync("2027-03-09T02:00:00.000Z")).toBe("ok");
  const lines = await openLines(env.DB, { accountCode: "1030" });
  expect(lines.map((line) => [line.date, line.amountCents, line.description])).toEqual([
    ["2027-03-08", -3200, "Terugbetaling Mollie: Lidm. Speeltuin ter Cleefte"],
    ["2027-03-08", -1500, "Terugbetaling Mollie"],
    ["2027-03-08", -200, "Terugboeking Mollie: Dagticket"],
  ]);
  expect(await bankLine("re_1")).toMatchObject({ origin: "mollie", amount_cents: -3200 });
  expect(await bankLine("re_failed")).toBeNull();
  expect(await bankLine("re_canceled")).toBeNull();
  // The payment itself is in its day, by its rule.
  expect(amounts(await entry("mollie_other", "2027-03-06"))).toEqual([
    ["1030", 3400],
    ["8000", -3200],
    ["8012", -200],
  ]);
});

it("ticks off a pin payment as the kassa's, also before its sale is known", async () => {
  // Only the kassa uses the terminal: a pin payment is the kassa's, whether or not a sale has its id (yet),
  // and whatever its description says.
  paid("tr_pin", "2.50", "Kassa bon", "2027-03-06T10:00:00+00:00", "pointofsale");
  paid("tr_pin2", "1.20", "Kassa bon: 2x dagkaartje", "2027-03-06T10:05:00+00:00", "pointofsale");
  mollie.current.addRefund({ id: "re_pin", paymentId: "tr_pin", amount: "2.50", createdAt: "2027-03-06T11:00:00+00:00" });

  expect(await sync("2027-03-07T02:00:00.000Z")).toBe("ok");
  expect(await payment("tr_pin")).toEqual({ kind: "kassa", account_code: null, bank_line_id: null, paid_date: "2027-03-06" });
  expect(await payment("tr_pin2")).toEqual({ kind: "kassa", account_code: null, bank_line_id: null, paid_date: "2027-03-06" });
  expect(await count("bank_lines")).toBe(0);
  expect(await count("ledger_entries")).toBe(0);
});

it("reads a long backlog to the end over three nights, each payment once", async () => {
  // 1.600 payments waiting since 4 January, 40 a day: more than the six pages of 100 one night reads.
  for (let i = 0; i < 1600; i++) {
    const date = shiftDate("2027-01-04", Math.floor(i / 40));
    const at = `${date}T${String(8 + (i % 10)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00+00:00`;
    paid(`tr_${i}`, `${1 + (i % 5)}.00`, i % 4 === 3 ? "Gift" : "Dagticket", at);
  }
  const resume = () => env.DB.prepare("SELECT value FROM ledger_settings WHERE key = 'mollie_payments_resume'").first<{ value: string }>();

  // The first night reads the newest 600 and notes where it stopped, down to where it began.
  expect(await sync("2027-02-13T02:00:00.000Z")).toBe("ok");
  expect(await count("mollie_payments")).toBe(600);
  const first = JSON.parse((await resume())!.value);
  expect(first).toEqual({ from: expect.stringMatching(/^tr_\d+$/), untilIso: "2026-10-31T23:00:00.000Z" });

  // The second night goes on where the first stopped, and is cut short again.
  expect(await sync("2027-02-14T02:00:00.000Z")).toBe("ok");
  expect(await count("mollie_payments")).toBe(1200);
  const second = JSON.parse((await resume())!.value);
  expect(second).toEqual({ from: expect.stringMatching(/^tr_\d+$/), untilIso: "2026-10-31T23:00:00.000Z" });
  expect(second.from).not.toBe(first.from);

  // The third night reads the rest first, then the newest with the calls left over; the note goes.
  expect(await sync("2027-02-15T02:00:00.000Z")).toBe("ok");
  expect(await resume()).toBeNull();
  expect(await count("mollie_payments")).toBe(1600);
  expect(await count("mollie_payments WHERE kind = 'rule'")).toBe(1200);
  expect(await count("mollie_payments WHERE kind = 'line' AND bank_line_id IS NOT NULL")).toBe(400);
  expect(await count("bank_lines")).toBe(400);
  expect(await count("ledger_entries WHERE source = 'mollie_other'")).toBe(40);
  const booked = await env.DB.prepare(
    "SELECT SUM(l.amount_cents) AS cents FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id WHERE e.source = 'mollie_other' AND l.account_code = '1030'",
  ).first<{ cents: number }>();
  const ruled = await env.DB.prepare("SELECT SUM(amount_cents) AS cents FROM mollie_payments WHERE kind = 'rule'").first<{ cents: number }>();
  expect(booked!.cents).toBe(ruled!.cents);

  // A note that cannot be read stops the step, out loud, rather than being dropped with the payments it stands for.
  await env.DB.prepare("INSERT INTO ledger_settings (key, value, updated_at) VALUES ('mollie_payments_resume', 'kapot', '2027-02-14T02:00:00.000Z')").run();
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await sync("2027-02-16T01:00:00.000Z")).toBe("mollie_resume_unreadable");
  expect(logged.mock.calls).toEqual([["mollie step failed", "mollie_resume_unreadable"]]);
  logged.mockRestore();
  await env.DB.prepare("DELETE FROM ledger_settings WHERE key = 'mollie_payments_resume'").run();

  // A fourth night finds nothing more.
  const stamps = () => env.DB.prepare("SELECT id, updated_at FROM ledger_entries ORDER BY id").all().then((r) => r.results);
  const before = await stamps();
  expect(await sync("2027-02-16T02:00:00.000Z")).toBe("ok");
  expect(await stamps()).toEqual(before);
  expect(await count("mollie_payments")).toBe(1600);
  expect(await count("bank_lines")).toBe(400);
});

it("keeps nothing of a night on which a list failed, so no refund is left behind", async () => {
  const fake = mollie.current;
  paid("tr_lid", "32.00", "Lidm. Speeltuin ter Cleefte", "2027-03-01T10:00:00+00:00");
  expect(await sync("2027-03-02T02:00:00.000Z")).toBe("ok");
  // The membership is refunded on 2 March; then the list of refunds fails for five nights while payments keep coming.
  fake.addRefund({ id: "re_lid", paymentId: "tr_lid", amount: "32.00", createdAt: "2027-03-02T09:00:00+00:00" });
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    for (let day = 2; day <= 6; day++) {
      paid(`tr_${day}`, "2.00", "Dagticket", `2027-03-0${day}T10:00:00+00:00`);
      fake.failNext("pass"); // the payments
      fake.failNext(500); // the refunds
      expect(await sync(`2027-03-0${day + 1}T02:00:00.000Z`)).toBe("unreachable");
      // Nothing kept: the window stays where it was.
      expect(await count("mollie_payments")).toBe(1);
    }
    expect(await sync("2027-03-08T02:00:00.000Z")).toBe("ok");
    expect(await bankLine("re_lid")).toMatchObject({ amount_cents: -3200, booking_date: "2027-03-02", description: "Terugbetaling Mollie: Lidm. Speeltuin ter Cleefte" });
    expect(await count("mollie_payments")).toBe(6);

    // The same when the chargebacks fail: the refunds read with them are not lost, they come again the next night.
    fake.addRefund({ id: "re_2", paymentId: "tr_2", amount: "2.00", createdAt: "2027-03-08T09:00:00+00:00" });
    fake.failNext("pass", 2); // the payments and the refunds
    fake.failNext(500); // the chargebacks
    expect(await sync("2027-03-09T02:00:00.000Z")).toBe("unreachable");
    expect(await bankLine("re_2")).toBeNull();
    expect(await sync("2027-03-10T02:00:00.000Z")).toBe("ok");
    expect(await bankLine("re_2")).toMatchObject({ amount_cents: -200 });
  } finally {
    logged.mockRestore();
  }
});

it("keeps nothing when the refunds or chargebacks were cut short by the cap", async () => {
  const fake = mollie.current;
  fake.pageSize = 1;
  paid("tr_1", "2.00", "Dagticket", "2027-03-06T10:00:00+00:00");
  for (let i = 1; i <= 7; i++) fake.addRefund({ id: `re_${i}`, paymentId: "tr_old", amount: "1.00", createdAt: `2027-03-06T1${i}:00:00+00:00` });
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await sync("2027-03-07T02:00:00.000Z")).toBe("mollie_list_cut_short");
    expect(await count("mollie_payments")).toBe(0);
    expect(await count("bank_lines")).toBe(0);
    fake.refunds = [];
    for (let i = 1; i <= 7; i++) fake.addChargeback({ id: `chb_${i}`, paymentId: "tr_old", amount: "1.00", createdAt: `2027-03-06T1${i}:00:00+00:00` });
    expect(await sync("2027-03-07T03:00:00.000Z")).toBe("mollie_list_cut_short");
    expect(await count("mollie_payments")).toBe(0);
    expect(await count("bank_lines")).toBe(0);
    expect(logged.mock.calls).toEqual([
      ["mollie step failed", "mollie_list_cut_short"],
      ["mollie step failed", "mollie_list_cut_short"],
    ]);
  } finally {
    logged.mockRestore();
  }
});

it("books the days of a night that stopped half way, also when they are older than the next window", async () => {
  // A first night with 30 days waiting, six payments a day: five day tickets and a gift.
  for (let i = 0; i < 180; i++) {
    const date = shiftDate("2027-03-01", Math.floor(i / 6));
    paid(`tr_${i}`, "2.00", i % 6 === 5 ? "Gift" : "Dagticket", `${date}T${String(9 + (i % 6)).padStart(2, "0")}:00:00+00:00`);
  }
  // The night is cut off right after the payments were stored: nothing after that gets through.
  let insertsPrepared = false;
  let stored = false;
  const cutOff = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => {
          if (stored) throw new Error("the night was cut off");
          if (sql.includes("INSERT INTO mollie_payments")) insertsPrepared = true;
          return target.prepare(sql);
        };
      }
      if (prop === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          if (stored) throw new Error("the night was cut off");
          const outcome = await target.batch(statements);
          if (insertsPrepared) stored = true;
          return outcome;
        };
      }
      return Reflect.get(target, prop);
    },
  });
  await expect(sync("2027-03-31T02:00:00.000Z", { DB: cutOff })).rejects.toThrow("the night was cut off");
  expect(await count("mollie_payments")).toBe(180);
  expect(await count("ledger_entries")).toBe(0);
  expect(await count("bank_lines")).toBe(0);

  // The next night reads only its last few days, and still books every day that was left.
  expect(await sync("2027-04-01T02:00:00.000Z")).toBe("ok");
  expect(await count("ledger_entries WHERE source = 'mollie_other'")).toBe(30);
  expect(amounts(await entry("mollie_other", "2027-03-01"))).toEqual([
    ["1030", 1000],
    ["8012", -1000],
  ]);
  expect(await count("bank_lines")).toBe(30);
  expect(await count("mollie_payments WHERE kind = 'line' AND bank_line_id IS NOT NULL")).toBe(30);
  expect(await count("mollie_payments WHERE booked = 0")).toBe(0);
});

it("leaves the refund of a kassa payment to the kassa's reversal", async () => {
  await kassaPinSale("tr_k", "2027-03-06", 250);
  paid("tr_k", "2.50", "Kassa bon", "2027-03-06T10:00:00+00:00", "pointofsale");
  mollie.current.addRefund({ id: "re_k", paymentId: "tr_k", amount: "2.50", createdAt: "2027-03-07T09:00:00+00:00" });
  mollie.current.addChargeback({ id: "chb_k", paymentId: "tr_k", amount: "2.50", createdAt: "2027-03-07T10:00:00+00:00" });

  expect(await sync("2027-03-08T02:00:00.000Z")).toBe("ok");
  expect(await count("bank_lines")).toBe(0);
  expect(await count("ledger_entries")).toBe(0);
});

it("leaves a closed year alone and books late payments on 1 January", async () => {
  paid("tr_a", "2.00", "Dagticket", "2027-12-31T10:00:00+00:00");
  expect(await sync("2027-12-31T20:00:00.000Z")).toBe("ok");
  const frozen = await entry("mollie_other", "2027-12-31");
  expect(amounts(frozen)).toEqual([
    ["1030", 200],
    ["8012", -200],
  ]);
  await env.DB.prepare("UPDATE ledger_years SET status = 'closed', closed_at = '2028-01-02T10:00:00.000Z' WHERE year IN (2026, 2027)").run();

  // Paid on New Year's Eve, read only after 2027 was closed.
  paid("tr_b", "32.00", "Lidmaatschap 2028", "2027-12-31T22:30:00+00:00"); // 23:30 in Amsterdam
  paid("tr_c", "1.20", "2x dagkaartje", "2027-12-31T15:00:00+00:00");
  expect(await sync("2028-01-03T02:00:00.000Z")).toBe("ok");
  expect(await entry("mollie_other", "2027-12-31")).toEqual(frozen);
  const late = await entry("mollie_other", "late:2027-12-31");
  expect(late).toMatchObject({ year: 2028, date: "2028-01-01", description: "Nagekomen Mollie overig 31-12-2027", source: "mollie_other" });
  expect(amounts(late)).toEqual([
    ["1030", 3320],
    ["8000", -3200],
    ["8012", -120],
  ]);
  expect(await env.DB.prepare("SELECT status FROM ledger_years WHERE year = 2028").first()).toEqual({ status: "open" });

  // Nothing new: nothing written, in either year.
  const stamps = () => env.DB.prepare("SELECT source_ref, updated_at FROM ledger_entries ORDER BY source_ref").all().then((r) => r.results);
  const before = await stamps();
  expect(await sync("2028-01-04T02:00:00.000Z")).toBe("ok");
  expect(await stamps()).toEqual(before);
  expect(await count("ledger_entries")).toBe(2);
});

it("reads each payment once, also when the night runs twice", async () => {
  paid("tr_1", "2.00", "Dagticket", "2027-03-06T09:00:00+00:00");
  paid("tr_2", "10.00", "Gift", "2027-03-06T10:00:00+00:00");
  mollie.current.addRefund({ id: "re_1", paymentId: "tr_2", amount: "10.00", createdAt: "2027-03-06T15:00:00+00:00" });
  const now = "2027-03-07T02:00:00.000Z";
  const snapshot = async () => ({
    entries: (await env.DB.prepare("SELECT id, source_ref, updated_at FROM ledger_entries ORDER BY id").all()).results,
    lines: (await env.DB.prepare("SELECT * FROM ledger_lines ORDER BY id").all()).results,
    bank: (await env.DB.prepare("SELECT id, bank_ref, amount_cents FROM bank_lines ORDER BY id").all()).results,
    payments: (await env.DB.prepare("SELECT * FROM mollie_payments ORDER BY id").all()).results,
  });

  expect(await sync(now)).toBe("ok");
  const first = await snapshot();
  expect(first.bank).toHaveLength(2);
  expect(await sync(now)).toBe("ok");
  expect(await snapshot()).toEqual(first);

  // The night and "Nu bijwerken" at the same moment, with a new payment on the same day.
  paid("tr_3", "2.00", "Dagticket", "2027-03-06T16:00:00+00:00");
  const later = "2027-03-07T09:00:00.000Z";
  const [a, b, night] = await Promise.all([sync(later), sync(later), runNightly(orgEnv(), new Date(later))]);
  expect([a, b, night.steps.mollie]).toEqual(["ok", "ok", "ok"]);
  expect(await count("ledger_entries WHERE source = 'mollie_other'")).toBe(1);
  expect(amounts(await entry("mollie_other", "2027-03-06"))).toEqual([
    ["1030", 400],
    ["8012", -400],
  ]);
  expect(await count("bank_lines")).toBe(2);
  expect(await count("mollie_payments")).toBe(3);
});

it("lets the penningmeester change the rules", async () => {
  const path = "/api/admin/boekhouding/mollie/rules";
  expect((await api(path)).status).toBe(401);
  const { cookie } = await asAdmin();
  const seeded = await (await api(path, { cookie })).json<MollieRule[]>();
  expect(seeded.map((rule) => [rule.keyword, rule.accountCode])).toEqual([
    ["dagkaart", "8012"],
    ["dagticket", "8012"],
    ["lidm", "8000"],
    ["lidmaatschap", "8000"],
    ["verl", "8000"],
    ["reserver", "8010"],
    ["verhuur", "8010"],
  ]);

  // A rule of his own, for donations.
  const added = await api(path, { method: "POST", cookie, json: { keyword: "  Donatie ", accountCode: "8025" } });
  expect(added.status).toBe(201);
  const donation = await added.json<MollieRule>();
  expect(donation).toEqual({ id: expect.any(String), keyword: "Donatie", accountCode: "8025" });
  // Only an income account, and a keyword of 2 to 40 characters.
  const refused = await api(path, { method: "POST", cookie, json: { keyword: "kosten", accountCode: "4511" } });
  expect([refused.status, await refused.json()]).toEqual([400, { error: "not_income_account" }]);
  expect((await api(path, { method: "POST", cookie, json: { keyword: " x ", accountCode: "8025" } })).status).toBe(400);
  expect((await api(path, { method: "POST", cookie, json: { keyword: "x".repeat(41), accountCode: "8025" } })).status).toBe(400);
  expect((await api(path, { method: "POST", cookie, json: { id: "nope", keyword: "gift", accountCode: "8025" } })).status).toBe(404);

  // A zakelijk lidmaatschap of his own: the rule "verl" changed in place, keeping its turn.
  const verl = seeded.find((rule) => rule.keyword === "verl")!;
  const changed = await api(path, { method: "POST", cookie, json: { id: verl.id, keyword: "verlenging", accountCode: "8004" } });
  expect(changed.status).toBe(200);
  expect(await changed.json()).toEqual({ id: verl.id, keyword: "verlenging", accountCode: "8004" });

  paid("tr_gift", "15.00", "DONATIE zomerfeest", "2027-03-06T10:00:00+00:00");
  paid("tr_zak", "250.00", "Burcht ter Cleeff - Verlenging zakelijk", "2027-03-06T11:00:00+00:00");
  expect(await sync("2027-03-07T02:00:00.000Z")).toBe("ok");
  const day = await entry("mollie_other", "2027-03-06");
  expect(amounts(day)).toEqual([
    ["1030", 26500],
    ["8004", -25000],
    ["8025", -1500],
  ]);

  // Removing a rule is settings, not bookkeeping: what it booked stays; the next such payment waits in Te boeken.
  expect((await api(`${path}/${donation.id}`, { method: "DELETE", cookie })).status).toBe(200);
  const left = await (await api(path, { cookie })).json<MollieRule[]>();
  expect(left.map((rule) => rule.keyword)).toEqual(["dagkaart", "dagticket", "lidm", "lidmaatschap", "verlenging", "reserver", "verhuur"]);
  paid("tr_gift2", "5.00", "Donatie", "2027-03-07T10:00:00+00:00");
  expect(await sync("2027-03-08T02:00:00.000Z")).toBe("ok");
  expect(await entry("mollie_other", "2027-03-06")).toEqual(day);
  expect(await payment("tr_gift")).toMatchObject({ kind: "rule", account_code: "8025" });
  expect(await payment("tr_gift2")).toMatchObject({ kind: "line" });
});

it("brings in 250 payments within 20 database calls", async () => {
  const kassa: D1PreparedStatement[] = [];
  const kinds = ["Dagticket", "Lidm. Speeltuin ter Cleefte", "Verhuur reservering", "Gift"];
  for (let i = 0; i < 250; i++) {
    const day = `2027-06-0${1 + Math.floor(i / 50)}`;
    const at = `${day}T${String(8 + (i % 10)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00+00:00`;
    const id = `tr_${i}`;
    if (i % 5 === 0) {
      kassa.push(kassaPinSaleStatement(id, day, 300));
      paid(id, "3.00", "Kassa bon", at, "pointofsale");
    } else {
      paid(id, `${1 + (i % 7)}.00`, kinds[i % 4]!, at);
    }
  }
  await env.DB.batch(kassa);
  mollie.current.addRefund({ id: "re_1", paymentId: "tr_3", amount: "4.00", createdAt: "2027-06-05T18:00:00+00:00" });
  // The profile is known from an earlier night.
  await env.DB.prepare("INSERT INTO ledger_settings (key, value, updated_at) VALUES ('mollie_profile_id', 'pfl_fake', '2027-06-01T00:00:00.000Z')").run();

  const metered = meteredDb(env.DB);
  expect(await syncMolliePayments(orgEnv({ DB: metered.db }), new Date("2027-06-06T02:00:00.000Z"))).toBe("ok");
  expect(metered.calls()).toBeLessThanOrEqual(20);
  expect(await count("mollie_payments")).toBe(250);
  expect(await count("ledger_entries WHERE source = 'mollie_other'")).toBe(5);
  expect(await count("bank_lines")).toBe(51); // the gifts and the refund
  expect(await count("mollie_payments WHERE kind = 'line' AND bank_line_id IS NULL")).toBe(0);
});

it("says which part Mollie refused, with its status, and nothing more", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    // The first call of a run without a known profile asks for the profile.
    mollie.current.failNext(403);
    expect(await sync("2027-03-07T02:00:00.000Z")).toBe("refused (profiles, 403)");
    // With the profile known, a refused list of payments names that list.
    expect(await sync("2027-03-07T02:00:00.000Z")).toBe("ok");
    mollie.current.failNext(422);
    expect(await sync("2027-03-08T02:00:00.000Z")).toBe("refused (payments, 422)");
    expect(logged.mock.calls).toEqual([
      ["mollie step failed", "refused (profiles, 403)"],
      ["mollie step failed", "refused (payments, 422)"],
    ]);
  } finally {
    logged.mockRestore();
  }
});

it("skips without the token and names a failure of Mollie without saying more", async () => {
  expect(await sync("2027-03-07T02:00:00.000Z", { MOLLIE_ORG_TOKEN: undefined })).toBe("skipped");
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await sync("2027-03-07T02:00:00.000Z", { MOLLIE_ORG_TOKEN: "org_wrong" })).toBe("unauthorized");
    mollie.current.failNext(500);
    expect(await sync("2027-03-07T02:00:00.000Z")).toBe("unreachable");
    expect(logged.mock.calls).toEqual([
      ["mollie step failed", "unauthorized"],
      ["mollie step failed", "unreachable"],
    ]);
  } finally {
    logged.mockRestore();
  }
  // In the nightly run as the step "mollie".
  paid("tr_1", "2.00", "Dagticket", "2027-03-06T09:00:00+00:00");
  expect((await runNightly(orgEnv(), new Date("2027-03-07T02:00:00.000Z"))).steps.mollie).toBe("ok");
  expect(await entry("mollie_other", "2027-03-06")).not.toBeNull();
});

it("keeps Mollie payments from 1 November 2026 on", async () => {
  paid("tr_oct", "1.20", "Dagkaartje", "2026-10-31T10:00:00+00:00");
  paid("tr_nov", "1.20", "Dagkaartje", "2026-11-01T10:00:00+00:00");
  expect(await sync("2026-11-03T02:00:00.000Z")).toBe("ok");
  expect(await payment("tr_oct")).toBeNull();
  expect((await payment("tr_nov"))?.paid_date).toBe("2026-11-01");
  expect(await count("mollie_payments")).toBe(1);
});
