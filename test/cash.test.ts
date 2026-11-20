import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { businessDate } from "../shared/time";
import type { CashState } from "../shared/types";
import { api, asAdmin, asDevice, cashSale, postSales, resetData } from "./helpers";

let cookie: string;
let token: string;

beforeEach(async () => {
  await resetData();
  ({ cookie } = await asAdmin());
  ({ token } = await asDevice());
});

const state = async () => (await api("/api/admin/cash", { cookie })).json<CashState>();
const handover = (json: object) => api("/api/admin/cash/handovers", { method: "POST", cookie, json });
const reverse = (id: string, reason: string) => api(`/api/admin/sales/${id}/reverse`, { method: "POST", cookie, json: { reason } });
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const sell = async (cents: number, soldAt: string) => {
  const s = cashSale({
    soldAt,
    totalCents: cents,
    lines: [{ productId: "entreegeld", name: "Entreegeld", unitPriceCents: cents, qty: 1 }],
  });
  await postSales(token, [s]);
  return s;
};

it("starts at zero", async () => {
  expect(await state()).toEqual({ expectedCents: 0, handovers: [] });
});

it("records an opening amount once", async () => {
  const res = await handover({ kind: "opening", countedAt: ago(60), receivedCents: 0, leftCents: 5000, note: null });
  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({
    kind: "opening",
    expectedCents: 0,
    receivedCents: 0,
    leftCents: 5000,
    differenceCents: 0,
    note: null,
  });
  expect((await state()).expectedCents).toBe(5000);
  const again = await handover({ kind: "opening", countedAt: ago(1), receivedCents: 0, leftCents: 100, note: null });
  expect(again.status).toBe(409);
  expect(await again.json()).toEqual({ error: "already_opened" });
});

it("computes the difference at a handover and starts a new period", async () => {
  await handover({ kind: "opening", countedAt: ago(120), receivedCents: 0, leftCents: 5000, note: null });
  const a = await sell(110, ago(90));
  await sell(360, ago(80));
  expect((await state()).expectedCents).toBe(5470);
  const counted = ago(10);
  const res = await handover({ kind: "handover", countedAt: counted, receivedCents: 400, leftCents: 5000, note: "blikje gesneuveld" });
  expect(res.status).toBe(201);
  const recorded = await res.json<{ id: string }>();
  expect(recorded).toMatchObject({
    kind: "handover",
    countedAt: counted,
    expectedCents: 5470,
    receivedCents: 400,
    leftCents: 5000,
    differenceCents: 70,
    note: "blikje gesneuveld",
  });
  const after = await state();
  expect(after.expectedCents).toBe(5000);
  expect(after.handovers.map((h) => h.kind)).toEqual(["handover", "opening"]);
  expect(after.handovers[0]).toMatchObject({ id: recorded.id, differenceCents: 70 });
  expect((await env.DB.prepare("SELECT handover_id FROM sales WHERE id = ?").bind(a.id).first())!.handover_id).toBe(recorded.id);
});

it("leaves sales made after the count in the open period", async () => {
  await sell(110, ago(180));
  await sell(360, ago(60));
  const res = await handover({ kind: "handover", countedAt: ago(120), receivedCents: 110, leftCents: 0, note: null });
  expect(await res.json()).toMatchObject({ expectedCents: 110, differenceCents: 0 });
  expect((await state()).expectedCents).toBe(360);
});

it("counts a sale that arrives late in the open period and flags it", async () => {
  await handover({ kind: "handover", countedAt: ago(30), receivedCents: 0, leftCents: 0, note: null });
  const late = await sell(110, ago(60)); // sold before the count, synced after
  expect(await env.DB.prepare("SELECT late, handover_id FROM sales WHERE id = ?").bind(late.id).first()).toEqual({
    late: 1,
    handover_id: null,
  });
  expect((await state()).expectedCents).toBe(110);
  expect((await state()).handovers[0]!.differenceCents).toBe(0); // the recorded handover did not change
});

it("rejects impossible handovers", async () => {
  const counted = ago(30);
  await handover({ kind: "handover", countedAt: counted, receivedCents: 0, leftCents: 0, note: null });
  const base = { kind: "handover", receivedCents: 0, leftCents: 0, note: null };
  const before = await handover({ ...base, countedAt: ago(60) });
  expect(before.status).toBe(400);
  expect(await before.json()).toEqual({ error: "counted_before_last" });
  expect(await (await handover({ ...base, countedAt: counted })).json()).toEqual({ error: "counted_before_last" });
  const future = await handover({ ...base, countedAt: new Date(Date.now() + 3600_000).toISOString() });
  expect(future.status).toBe(400);
  expect(await future.json()).toEqual({ error: "counted_in_future" });
  for (const bad of [
    { ...base, countedAt: ago(1), receivedCents: -1 },
    { ...base, countedAt: ago(1), leftCents: 1.5 },
    { ...base, countedAt: "gisteren" },
    { ...base, countedAt: ago(1), kind: "tussendoor" },
  ]) {
    const res = await handover(bad);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid" });
  }
  expect((await state()).handovers).toHaveLength(1);
});

it("records one handover when the same count is sent twice at once", async () => {
  await sell(110, ago(60));
  const body = { kind: "handover", countedAt: ago(10), receivedCents: 110, leftCents: 0, note: null };
  const [a, b] = await Promise.all([handover(body), handover(body)]);
  expect([a.status, b.status].sort()).toEqual([201, 400]);
  const after = await state();
  expect(after.handovers).toHaveLength(1);
  expect(after.handovers[0]).toMatchObject({ expectedCents: 110, differenceCents: 0 });
  expect(after.expectedCents).toBe(0);
});

it("lowers the expected amount when a sale is reversed in beheer", async () => {
  const s = await sell(360, ago(20));
  const empty = await reverse(s.id, "");
  expect(empty.status).toBe(400);
  expect(await empty.json()).toEqual({ error: "reason_required" });
  expect((await reverse(s.id, " x ")).status).toBe(400);
  const res = await reverse(s.id, "dubbel aangeslagen");
  expect(res.status).toBe(201);
  const { id } = await res.json<{ id: string }>();
  expect(
    await env.DB.prepare(
      "SELECT method, total_cents, reversed_by, reversal_reason, business_date, reverses_sale_id, device_id FROM sales WHERE id = ?",
    )
      .bind(id)
      .first(),
  ).toEqual({
    method: "cash",
    total_cents: -360,
    reversed_by: "admin",
    reversal_reason: "dubbel aangeslagen",
    business_date: businessDate(new Date().toISOString()),
    reverses_sale_id: s.id,
    device_id: null,
  });
  expect((await state()).expectedCents).toBe(0);
  const again = await reverse(s.id, "nog eens");
  expect(again.status).toBe(409);
  expect(await again.json()).toEqual({ error: "already_reversed" });
  const back = await reverse(id, "terug");
  expect(back.status).toBe(409);
  expect(await back.json()).toEqual({ error: "is_reversal" });
});

it("puts the stock back when beheer reverses a sale", async () => {
  const sale = cashSale({ soldAt: ago(20) });
  await postSales(token, [sale]);
  expect((await reverse(sale.id, "verkeerd ijsje")).status).toBe(201);
  const stock = await env.DB.prepare("SELECT COALESCE(SUM(delta), 0) n FROM stock_movements WHERE product_id = 'aardbeitje'").first();
  expect(stock).toEqual({ n: 0 });
});

it("answers 404 when the sale to reverse does not exist", async () => {
  const res = await reverse(crypto.randomUUID(), "bestaat niet");
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found" });
});

it("refuses to reverse a cash sale that a handover has closed", async () => {
  const s = await sell(110, ago(60));
  await handover({ kind: "handover", countedAt: ago(10), receivedCents: 110, leftCents: 0, note: null });
  const res = await reverse(s.id, "te laat");
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "closed_by_handover" });
});

it("lets beheer reverse a pin sale regardless of handovers", async () => {
  await env.DB.prepare(
    "INSERT INTO sales (id, method, status, total_cents, sold_at, received_at, business_date) VALUES ('pin1','pin','paid',60,?,?,?)",
  )
    .bind(ago(600), ago(600), "2026-07-30")
    .run();
  await env.DB.prepare(
    "INSERT INTO sale_lines (sale_id, product_id, name, category_id, category_name, unit_price_cents, qty) VALUES ('pin1','entreegeld','Entreegeld','entree','Entree',60,1)",
  ).run();
  await handover({ kind: "handover", countedAt: ago(10), receivedCents: 0, leftCents: 0, note: null });
  expect((await reverse("pin1", "terugbetaald via Mollie")).status).toBe(201);
  expect((await state()).expectedCents).toBe(0); // a pin reversal never touches the cash box
});

it("refuses to reverse a pin payment that never went through", async () => {
  await env.DB.prepare(
    "INSERT INTO sales (id, method, status, total_cents, sold_at, received_at, business_date) VALUES ('pin2','pin','failed',60,?,?,?)",
  )
    .bind(ago(600), ago(600), "2026-07-30")
    .run();
  const res = await reverse("pin2", "mislukte betaling");
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "not_paid" });
});

it("keeps the cash box behind the beheer login", async () => {
  expect((await api("/api/admin/cash")).status).toBe(401);
  expect((await api("/api/admin/cash", { token })).status).toBe(401);
  const body = { kind: "handover", countedAt: ago(1), receivedCents: 0, leftCents: 0, note: null };
  expect((await api("/api/admin/cash/handovers", { method: "POST", json: body })).status).toBe(401);
  expect((await api("/api/admin/sales/x/reverse", { method: "POST", json: { reason: "zonder login" } })).status).toBe(401);
});
