import { env } from "cloudflare:workers";
import { beforeEach, expect, it, vi } from "vitest";
import { businessDate } from "../shared/time";
import { GIVE_UP_MS, RESEND_MS, pinStatus, type PinContext } from "../worker/db/pin";
import { dayReport } from "../worker/db/reports";
import type { SaleRow } from "../worker/db/sales";
import { mollieFor } from "../worker/lib/mollie";
import { api, asAdmin, asDevice, cashSale, chooseTestTerminal, meteredDb, pinSale, pinStatusOf, postSales, resetData, startPinSale, useFakeMollie } from "./helpers";

const mollie = useFakeMollie();
let token: string;
let deviceId: string;

beforeEach(async () => {
  await resetData();
  ({ token, deviceId } = await asDevice());
  await chooseTestTerminal();
  // Choosing the terminal asked Mollie for its list; every test starts with a clean record of requests.
  mollie.current.requests.length = 0;
});

const row = (id: string) => env.DB.prepare("SELECT * FROM sales WHERE id = ?").bind(id).first<SaleRow>();
const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())!.n;
const movements = async () => (await env.DB.prepare("SELECT product_id, delta, kind, ref_id FROM stock_movements ORDER BY id").all()).results;
const day = () => dayReport(env.DB, businessDate(new Date().toISOString()));
const creates = () => mollie.current.requests.filter((request) => request.method === "POST" && request.path === "/v2/payments");
const ctx = (now = new Date()): PinContext => ({ db: env.DB, mollie: mollieFor(env), origin: "https://kassa.example", now });
const cancel = (id: string) => api(`/api/kassa/pin/${id}/cancel`, { method: "POST", token });
const start = (body: unknown, over?: Parameters<typeof api>[1]) => api("/api/kassa/pin", { method: "POST", token, json: body, ...over });

it("stores the receipt as pending and asks the terminal", async () => {
  const sale = pinSale({ soldAt: new Date().toISOString() });
  expect(await startPinSale(token, sale)).toEqual({ id: sale.id, outcome: null, reason: null, sent: true, testUrl: "https://fake.mollie.test/test/tr_fake1" });
  expect(await row(sale.id)).toMatchObject({
    method: "pin",
    status: "pending",
    total_cents: 110,
    device_id: deviceId,
    mollie_payment_id: "tr_fake1",
    mollie_mode: "test",
    pin_outcome: null,
    settled_at: null,
    late: 0,
    handover_id: null,
  });
  expect(await count("SELECT COUNT(*) n FROM sale_lines")).toBe(1);
  expect(await movements()).toEqual([]);
  expect(creates()).toHaveLength(1);
  expect(creates()[0]).toMatchObject({
    idempotencyKey: sale.id,
    body: { amount: { currency: "EUR", value: "1.10" }, method: "pointofsale", terminalId: "term_test", metadata: { saleId: sale.id } },
  });
  expect((await day()).totals).toEqual({ cashCents: 0, pinCents: 0, totalCents: 0, saleCount: 0 });
});

it("books a paid payment once, lowers the stock then, and stops asking Mollie", async () => {
  const sale = pinSale();
  await startPinSale(token, sale);
  mollie.current.finish("tr_fake1", "paid");
  expect(await pinStatusOf(token, sale.id)).toEqual({ id: sale.id, outcome: "paid", reason: null, sent: true, testUrl: null });
  expect(await row(sale.id)).toMatchObject({ status: "paid", pin_outcome: "paid", pin_reason: null });
  expect((await row(sale.id))!.settled_at).toEqual(expect.any(String));
  expect(await movements()).toEqual([{ product_id: "aardbeitje", delta: -1, kind: "sale", ref_id: sale.id }]);
  const asked = mollie.current.requests.length;
  expect((await pinStatusOf(token, sale.id)).outcome).toBe("paid");
  expect(mollie.current.requests.length).toBe(asked);
  expect(await movements()).toHaveLength(1);
  expect((await day()).totals).toEqual({ cashCents: 0, pinCents: 110, totalCents: 110, saleCount: 1 });
});

it.each([
  ["failed", "insufficient_funds", "declined"],
  ["canceled", undefined, "canceled"],
  ["expired", undefined, "expired"],
] as const)("ends a payment Mollie reports as %s as not paid", async (status, reason, outcome) => {
  const sale = pinSale();
  await startPinSale(token, sale);
  mollie.current.finish("tr_fake1", status, reason);
  expect(await pinStatusOf(token, sale.id)).toEqual({ id: sale.id, outcome, reason: reason ?? null, sent: true, testUrl: null });
  expect(await row(sale.id)).toMatchObject({ status: "failed", pin_outcome: outcome, pin_reason: reason ?? null });
  expect((await row(sale.id))!.settled_at).toEqual(expect.any(String));
  expect(await movements()).toEqual([]);
  expect((await day()).totals.totalCents).toBe(0);
  // Final is final: Mollie is not asked again, and a later "paid" for the same payment changes nothing.
  const asked = mollie.current.requests.length;
  mollie.current.finish("tr_fake1", "paid");
  expect((await pinStatusOf(token, sale.id)).outcome).toBe(outcome);
  expect(mollie.current.requests.length).toBe(asked);
});

it("settles once when two requests learn the outcome at the same moment (Review Focus 1)", async () => {
  const sale = pinSale();
  await startPinSale(token, sale);
  mollie.current.finish("tr_fake1", "paid");
  const [a, b] = await Promise.all([pinStatusOf(token, sale.id), pinStatusOf(token, sale.id)]);
  expect([a.outcome, b.outcome]).toEqual(["paid", "paid"]);
  expect(await movements()).toHaveLength(1);
  expect((await day()).totals.saleCount).toBe(1);
  expect((await env.DB.prepare("SELECT stock FROM products WHERE id = 'aardbeitje'").first<{ stock: number }>())!.stock).toBe(-1);
});

it("makes one sale and one payment when the same start is sent again, also at the same moment", async () => {
  const sale = pinSale();
  const [a, b] = await Promise.all([startPinSale(token, sale), startPinSale(token, sale)]);
  expect([a.id, b.id]).toEqual([sale.id, sale.id]);
  expect((await startPinSale(token, sale)).sent).toBe(true);
  expect(mollie.current.payments).toHaveLength(1);
  expect(await count("SELECT COUNT(*) n FROM sales")).toBe(1);
  expect(await count("SELECT COUNT(*) n FROM sale_lines")).toBe(1);
});

it("picks up the same payment when Mollie's answer to the start was lost (Review Focus 2)", async () => {
  const sale = pinSale();
  mollie.current.failNext("lost");
  expect(await startPinSale(token, sale)).toMatchObject({ outcome: null, sent: false });
  expect(mollie.current.payments).toHaveLength(1); // Mollie did make it: it is on the terminal
  expect((await row(sale.id))!.mollie_payment_id).toBeNull();
  expect(await pinStatusOf(token, sale.id)).toMatchObject({ outcome: null, sent: true });
  expect(mollie.current.payments).toHaveLength(1); // and no second one was sent
  expect(creates().map((request) => request.idempotencyKey)).toEqual([sale.id, sale.id]);
  expect(creates()[1]!.body).toEqual(creates()[0]!.body);
  expect((await row(sale.id))!.mollie_payment_id).toBe("tr_fake1");
});

it("tries the start again while the beheerder waits, when Mollie could not be reached", async () => {
  const sale = pinSale();
  mollie.current.failNext("timeout");
  expect(await startPinSale(token, sale)).toEqual({ id: sale.id, outcome: null, reason: null, sent: false, testUrl: null });
  expect(mollie.current.payments).toHaveLength(0);
  expect((await row(sale.id))!.status).toBe("pending");
  expect(await pinStatusOf(token, sale.id)).toMatchObject({ outcome: null, sent: true });
  expect(mollie.current.payments).toHaveLength(1);
});

it("stops sending after a minute and gives up after fifteen", async () => {
  const sale = pinSale();
  mollie.current.failNext("timeout");
  await startPinSale(token, sale);
  const received = Date.parse((await row(sale.id))!.received_at);
  expect(await pinStatus(ctx(new Date(received + RESEND_MS + 1)), sale.id)).toMatchObject({ outcome: null, sent: false });
  expect(creates()).toHaveLength(1);
  expect(await pinStatus(ctx(new Date(received + GIVE_UP_MS)), sale.id)).toMatchObject({ outcome: null, sent: false });
  expect(await pinStatus(ctx(new Date(received + GIVE_UP_MS + 1)), sale.id)).toMatchObject({ outcome: "start_failed", reason: "no_answer", sent: false });
  expect(await row(sale.id)).toMatchObject({ status: "failed", pin_outcome: "start_failed", pin_reason: "no_answer", mollie_payment_id: null });
  expect(creates()).toHaveLength(1);
  expect(mollie.current.payments).toHaveLength(0);
});

it.each([
  [401, "unauthorized"],
  [422, "refused"],
] as const)("ends at once when Mollie refuses to start (%i)", async (status, reason) => {
  const sale = pinSale();
  mollie.current.failNext(status);
  expect(await startPinSale(token, sale)).toEqual({ id: sale.id, outcome: "start_failed", reason, sent: false, testUrl: null });
  expect(await row(sale.id)).toMatchObject({ status: "failed", pin_outcome: "start_failed", pin_reason: reason, mollie_payment_id: null });
  const asked = mollie.current.requests.length;
  expect((await pinStatusOf(token, sale.id)).outcome).toBe("start_failed");
  expect(mollie.current.requests.length).toBe(asked);
});

it("cancels at Mollie when that is still possible", async () => {
  const sale = pinSale();
  await startPinSale(token, sale);
  const answer = await cancel(sale.id);
  expect(answer.status).toBe(200);
  expect(await answer.json()).toEqual({ id: sale.id, outcome: "canceled", reason: null, sent: true, testUrl: null });
  expect(mollie.current.payments[0]!.status).toBe("canceled");
  expect(await row(sale.id)).toMatchObject({ status: "failed", pin_outcome: "canceled" });
  expect(await movements()).toEqual([]);
});

it("never calls a payment cancelled that Mollie will not cancel", async () => {
  const sale = pinSale();
  await startPinSale(token, sale);
  mollie.current.cancelable = false;
  expect(await (await cancel(sale.id)).json()).toMatchObject({ outcome: null, sent: true });
  expect((await row(sale.id))!.status).toBe("pending");
  mollie.current.finish("tr_fake1", "paid"); // the customer paid after all
  expect((await pinStatusOf(token, sale.id)).outcome).toBe("paid");
  // Cancelling a payment that has gone through tells the truth and takes nothing back.
  expect(await (await cancel(sale.id)).json()).toMatchObject({ outcome: "paid" });
  expect((await row(sale.id))!.status).toBe("paid");
});

it("a cancel before the terminal was asked sends nothing, then or later", async () => {
  const sale = pinSale();
  mollie.current.failNext("timeout");
  await startPinSale(token, sale);
  expect(await (await cancel(sale.id)).json()).toEqual({ id: sale.id, outcome: "canceled", reason: "before_start", sent: false, testUrl: null });
  expect((await pinStatusOf(token, sale.id)).outcome).toBe("canceled");
  expect(creates()).toHaveLength(1);
  expect(mollie.current.requests).toHaveLength(1);
});

it("takes a request off the terminal that got there after the beheerder had cancelled", async () => {
  const sale = pinSale();
  mollie.current.failNext("timeout");
  await startPinSale(token, sale);
  // The next question sends the start again. While Mollie is busy with it, the beheerder cancels.
  const fake = mollie.current;
  let cancelled = false;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.method === "POST" && !cancelled) {
      cancelled = true;
      expect(await (await cancel(sale.id)).json()).toMatchObject({ outcome: "canceled", reason: "before_start" });
    }
    return fake.handle(request);
  });
  expect(await pinStatusOf(token, sale.id)).toMatchObject({ outcome: "canceled", reason: "before_start", sent: false, testUrl: null });
  expect(fake.payments.map((payment) => payment.status)).toEqual(["canceled"]);
  expect(await row(sale.id)).toMatchObject({ status: "failed", pin_outcome: "canceled", mollie_payment_id: null });
});

it("leaves a payment alone that was made with a key of the other kind (Review Focus 5)", async () => {
  const live = { MOLLIE_API_KEY: "live_fake" };
  const running = pinSale();
  await startPinSale(token, running);
  const asked = mollie.current.requests.length;
  expect(await (await api(`/api/kassa/pin/${running.id}`, { token, env: live })).json()).toMatchObject({ outcome: null, sent: true, testUrl: null });
  expect(await (await api(`/api/kassa/pin/${running.id}/cancel`, { method: "POST", token, env: live })).json()).toMatchObject({ outcome: null, sent: true });
  expect(mollie.current.requests.length).toBe(asked);
  expect((await row(running.id))!.status).toBe("pending");

  // A start that got no answer is not sent again with the other key, not even when that key has a terminal.
  mollie.current.finish("tr_fake1", "canceled");
  const unanswered = pinSale();
  mollie.current.failNext("timeout");
  await startPinSale(token, unanswered);
  const { cookie } = await asAdmin();
  expect((await api("/api/admin/pin/terminal", { method: "POST", cookie, json: { terminalId: "term_test" }, env: live })).status).toBe(200);
  expect(await (await api(`/api/kassa/pin/${unanswered.id}`, { token, env: live })).json()).toMatchObject({ outcome: null, sent: false });
  expect(creates().map((request) => request.idempotencyKey)).toEqual([running.id, unanswered.id]);
});

it("refuses a receipt that does not add up or names an unknown product, and writes nothing", async () => {
  const wrongTotal = await start(pinSale({ totalCents: 999 }));
  expect(wrongTotal.status).toBe(422);
  expect(await wrongTotal.json()).toEqual({ error: "total_mismatch" });
  const unknown = await start(pinSale({ lines: [{ productId: "bestaat-niet", name: "Spook", unitPriceCents: 110, qty: 1 }] }));
  expect(unknown.status).toBe(422);
  expect(await unknown.json()).toEqual({ error: "unknown_product" });
  for (const body of [{ nope: true }, { ...pinSale(), totalCents: 0 }, { ...pinSale(), totalCents: 1_000_001 }, { ...pinSale(), id: "geen-uuid" }, null]) {
    const invalid = await start(body);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid" });
  }
  expect(await count("SELECT COUNT(*) n FROM sales")).toBe(0);
  expect(await count("SELECT COUNT(*) n FROM sale_lines")).toBe(0);
  expect(mollie.current.requests).toHaveLength(0);
});

it("says so when pin is not set up", async () => {
  const noKey = await start(pinSale(), { env: { MOLLIE_API_KEY: undefined } });
  expect(noKey.status).toBe(409);
  expect(await noKey.json()).toEqual({ error: "pin_not_configured" });
  // The terminal was chosen with the test key: for real payments there is none.
  const liveKey = await start(pinSale(), { env: { MOLLIE_API_KEY: "live_fake" } });
  expect(liveKey.status).toBe(409);
  expect(await liveKey.json()).toEqual({ error: "no_terminal" });
  const { cookie } = await asAdmin();
  await api("/api/admin/pin/terminal", { method: "POST", cookie, json: { terminalId: null } });
  const noTerminal = await start(pinSale());
  expect(noTerminal.status).toBe(409);
  expect(await noTerminal.json()).toEqual({ error: "no_terminal" });
  expect(await count("SELECT COUNT(*) n FROM sales")).toBe(0);
  expect(creates()).toHaveLength(0);
});

it("refuses an id that already is a cash sale", async () => {
  const cash = cashSale();
  await postSales(token, [cash]);
  const answer = await start(pinSale({ id: cash.id }));
  expect(answer.status).toBe(409);
  expect(await answer.json()).toEqual({ error: "id_in_use" });
  expect(await row(cash.id)).toMatchObject({ method: "cash", status: "paid", mollie_payment_id: null });
  expect((await api(`/api/kassa/pin/${cash.id}`, { token })).status).toBe(404);
  expect((await cancel(cash.id)).status).toBe(404);
  expect(creates()).toHaveLength(0);
});

it("answers any paired kassa, and nobody else", async () => {
  const sale = pinSale();
  const started = await startPinSale(token, sale);
  const other = await asDevice("Tweede iPad");
  expect(await pinStatusOf(other.token, sale.id)).toEqual(started);
  expect((await api(`/api/kassa/pin/${sale.id}`)).status).toBe(401);
  expect((await api("/api/kassa/pin", { method: "POST", json: pinSale() })).status).toBe(401);
  expect((await api(`/api/kassa/pin/${sale.id}/cancel`, { method: "POST" })).status).toBe(401);
  const unknown = await api(`/api/kassa/pin/${crypto.randomUUID()}`, { token });
  expect(unknown.status).toBe(404);
  // Its own answer: a server without pin (an older version) says "not_found", which proves nothing about a payment.
  expect(await unknown.json()).toEqual({ error: "no_pin_sale" });
  const cancelled = await cancel(crypto.randomUUID());
  expect(cancelled.status).toBe(404);
  expect(await cancelled.json()).toEqual({ error: "no_pin_sale" });
  expect((await row(sale.id))!.status).toBe("pending");
});

it("reports a busy terminal as declined with Mollie's reason", async () => {
  await startPinSale(token, pinSale());
  const second = pinSale();
  expect(await startPinSale(token, second)).toEqual({ id: second.id, outcome: "declined", reason: "terminal_busy", sent: true, testUrl: null });
  expect(await row(second.id)).toMatchObject({ status: "failed", mollie_payment_id: "tr_fake2" });
});

it("dates the sale on the Amsterdam day it was rung up", async () => {
  const night = pinSale({ soldAt: "2026-07-31T22:30:00.000Z" });
  await startPinSale(token, night);
  expect(await row(night.id)).toMatchObject({ sold_at: "2026-07-31T22:30:00.000Z", business_date: "2026-08-01" });

  mollie.current.finish("tr_fake1", "canceled");
  const before = Date.now();
  const ahead = pinSale({ soldAt: new Date(before + 3 * 3_600_000).toISOString() });
  await startPinSale(token, ahead);
  const stored = Date.parse((await row(ahead.id))!.sold_at);
  expect(stored).toBeGreaterThanOrEqual(before);
  expect(stored).toBeLessThanOrEqual(Date.now());
});

it("stays within the free plan: a poll that settles uses three database calls and one call to Mollie", async () => {
  const sale = pinSale();
  const starting = meteredDb(env.DB);
  // The start itself, for the record: reading what it needs, writing the sale, writing Mollie's answer.
  const { startPin } = await import("../worker/db/pin");
  await startPin({ ...ctx(), db: starting.db }, deviceId, sale);
  expect(starting.calls()).toBeLessThanOrEqual(4);

  mollie.current.finish("tr_fake1", "paid");
  const before = mollie.current.requests.length;
  const settling = meteredDb(env.DB);
  expect(await pinStatus({ ...ctx(), db: settling.db }, sale.id)).toMatchObject({ outcome: "paid" });
  expect(settling.calls()).toBeLessThanOrEqual(3);
  expect(mollie.current.requests.length - before).toBe(1);

  const settled = meteredDb(env.DB);
  await pinStatus({ ...ctx(), db: settled.db }, sale.id);
  expect(settled.calls()).toBe(1);
  expect(mollie.current.requests.length - before).toBe(1);
});
