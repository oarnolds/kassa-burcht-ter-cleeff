import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { app } from "../worker/app";
import type { SaleRow } from "../worker/db/sales";
import type { Env } from "../worker/env";
import { api, asDevice, chooseTestTerminal, pinSale, pinStatusOf, resetData, startPinSale, useFakeMollie, webhook } from "./helpers";

const mollie = useFakeMollie();
let token: string;

beforeEach(async () => {
  await resetData();
  ({ token } = await asDevice());
  await chooseTestTerminal();
  mollie.current.requests.length = 0;
});

const row = (id: string) => env.DB.prepare("SELECT * FROM sales WHERE id = ?").bind(id).first<SaleRow>();
const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())!.n;
const movements = async () => (await env.DB.prepare("SELECT product_id, delta, kind, ref_id FROM stock_movements ORDER BY id").all()).results;
const cancel = (id: string) => api(`/api/kassa/pin/${id}/cancel`, { method: "POST", token });

it("books a payment Mollie reports while the iPad is gone", async () => {
  const sale = pinSale();
  await startPinSale(token, sale);
  mollie.current.finish("tr_fake1", "paid");
  const answer = await webhook("tr_fake1");
  expect(answer.status).toBe(200);
  expect(await answer.text()).toBe("ok");
  expect(await row(sale.id)).toMatchObject({ status: "paid", pin_outcome: "paid" });
  expect(await movements()).toEqual([{ product_id: "aardbeitje", delta: -1, kind: "sale", ref_id: sale.id }]);
});

it("believes Mollie, not the caller", async () => {
  const sale = pinSale();
  await startPinSale(token, sale);
  expect((await webhook("tr_fake1")).status).toBe(200); // the payment is still open at Mollie
  expect((await row(sale.id))!.status).toBe("pending");
  expect((await webhook("tr_bestaatniet")).status).toBe(200);
  const asked = mollie.current.requests.length;
  expect((await api("/api/mollie/webhook", { method: "POST", form: { id: "'; DROP TABLE sales; --" } })).status).toBe(200);
  expect((await api("/api/mollie/webhook", { method: "POST", json: { id: "tr_fake1", status: "paid" } })).status).toBe(200);
  expect((await api("/api/mollie/webhook", { method: "POST" })).status).toBe(200);
  // None of those three named a payment: Mollie was not asked about anything.
  expect(mollie.current.requests.length).toBe(asked);
  expect((await row(sale.id))!.status).toBe("pending");
  expect(await count("SELECT COUNT(*) n FROM sales")).toBe(1);
});

it("asks Mollie to call again when Mollie itself gives no answer", async () => {
  const sale = pinSale();
  await startPinSale(token, sale);
  mollie.current.finish("tr_fake1", "paid");
  mollie.current.failNext(500);
  expect((await webhook("tr_fake1")).status).toBe(503);
  expect((await row(sale.id))!.status).toBe("pending");
  mollie.current.failNext(401);
  expect((await webhook("tr_fake1")).status).toBe(503);
  mollie.current.failNext("timeout");
  expect((await webhook("tr_fake1")).status).toBe(503);
  expect((await row(sale.id))!.status).toBe("pending");
  expect((await webhook("tr_fake1")).status).toBe(200);
  expect((await row(sale.id))!.status).toBe("paid");
});

it("finds the sale by its own id when the answer to the start was lost (Review Focus 2)", async () => {
  const sale = pinSale();
  mollie.current.failNext("lost");
  await startPinSale(token, sale); // the kassa never learned "tr_fake1"
  mollie.current.finish("tr_fake1", "paid");
  expect((await webhook("tr_fake1")).status).toBe(200);
  expect(await row(sale.id)).toMatchObject({ status: "paid", mollie_payment_id: "tr_fake1" });
  expect(await movements()).toHaveLength(1);
});

it("still books a payment the kassa had given up on (Review Focus 2)", async () => {
  const sale = pinSale();
  mollie.current.failNext("lost");
  await startPinSale(token, sale);
  await cancel(sale.id); // cancelled before the kassa knew of a payment
  expect(await row(sale.id)).toMatchObject({ status: "failed", pin_outcome: "canceled", mollie_payment_id: null });
  // While the payment is only open, the cancelled sale stays cancelled.
  expect((await webhook("tr_fake1")).status).toBe(200);
  expect(await row(sale.id)).toMatchObject({ status: "failed", pin_outcome: "canceled", mollie_payment_id: null });
  mollie.current.finish("tr_fake1", "paid"); // but it was on the terminal, and the customer paid
  await webhook("tr_fake1");
  expect(await row(sale.id)).toMatchObject({ status: "paid", pin_outcome: "paid", pin_reason: null, mollie_payment_id: "tr_fake1" });
  expect(await movements()).toHaveLength(1);
});

it("leaves a declined payment declined when the same id is reported again, and a paid one paid", async () => {
  const declined = pinSale();
  await startPinSale(token, declined);
  mollie.current.finish("tr_fake1", "failed", "card_declined");
  await webhook("tr_fake1");
  expect(await row(declined.id)).toMatchObject({ status: "failed", pin_outcome: "declined", pin_reason: "card_declined" });
  let asked = mollie.current.requests.length;
  mollie.current.finish("tr_fake1", "paid");
  expect((await webhook("tr_fake1")).status).toBe(200);
  expect(await row(declined.id)).toMatchObject({ status: "failed", pin_outcome: "declined" });
  expect(mollie.current.requests.length).toBe(asked);

  const paid = pinSale();
  await startPinSale(token, paid);
  mollie.current.finish("tr_fake2", "paid");
  await webhook("tr_fake2");
  asked = mollie.current.requests.length;
  expect((await webhook("tr_fake2")).status).toBe(200);
  expect((await webhook("tr_fake2")).status).toBe(200);
  expect(await row(paid.id)).toMatchObject({ status: "paid", pin_outcome: "paid" });
  expect(await movements()).toHaveLength(1);
  expect(mollie.current.requests.length).toBe(asked);
});

it("settles once when the poll and the webhook come at the same moment (Review Focus 1)", async () => {
  const sale = pinSale();
  await startPinSale(token, sale);
  mollie.current.finish("tr_fake1", "paid");
  await Promise.all([pinStatusOf(token, sale.id), webhook("tr_fake1"), webhook("tr_fake1")]);
  expect(await movements()).toHaveLength(1);
  expect(await count("SELECT COUNT(*) n FROM sales WHERE status = 'paid'")).toBe(1);
  expect((await env.DB.prepare("SELECT stock FROM products WHERE id = 'aardbeitje'").first<{ stock: number }>())!.stock).toBe(-1);
});

it("needs no token, no login and no csrf header, and does nothing without a Mollie key", async () => {
  const sale = pinSale();
  await startPinSale(token, sale);
  mollie.current.finish("tr_fake1", "paid");
  const call = (over?: Partial<Env>) =>
    app.request(
      "/api/mollie/webhook",
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "id=tr_fake1" },
      over ? { ...env, ...over } : env,
    );
  const asked = mollie.current.requests.length;
  expect((await call({ MOLLIE_API_KEY: undefined })).status).toBe(200);
  expect(mollie.current.requests.length).toBe(asked);
  expect((await row(sale.id))!.status).toBe("pending");
  expect((await call()).status).toBe(200);
  expect((await row(sale.id))!.status).toBe("paid");
});

it("does not book a payment with a key of the other kind (Review Focus 5)", async () => {
  const sale = pinSale();
  await startPinSale(token, sale);
  mollie.current.finish("tr_fake1", "paid");
  const asked = mollie.current.requests.length;
  expect((await api("/api/mollie/webhook", { method: "POST", form: { id: "tr_fake1" }, env: { MOLLIE_API_KEY: "live_fake" } })).status).toBe(200);
  expect((await row(sale.id))!.status).toBe("pending");
  expect(mollie.current.requests.length).toBe(asked);

  // Also when the sale has to be found by its own id.
  mollie.current.finish("tr_fake1", "canceled");
  const lost = pinSale();
  mollie.current.failNext("lost");
  await startPinSale(token, lost);
  mollie.current.finish("tr_fake2", "paid");
  expect((await api("/api/mollie/webhook", { method: "POST", form: { id: "tr_fake2" }, env: { MOLLIE_API_KEY: "live_fake" } })).status).toBe(200);
  expect(await row(lost.id)).toMatchObject({ status: "pending", mollie_payment_id: null });
});
