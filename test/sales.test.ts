import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { ingestItems } from "../worker/db/sales";
import { api, asAdmin, asDevice, cashSale, meteredDb, postSales, resetData } from "./helpers";

let token: string;
let deviceId: string;

beforeEach(async () => {
  await resetData();
  ({ token, deviceId } = await asDevice());
});

const row = (id: string) => env.DB.prepare("SELECT * FROM sales WHERE id = ?").bind(id).first();
const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())!.n;
const reversalOf = (reversesSaleId: string, soldAt: string) => ({
  id: crypto.randomUUID(),
  kind: "reversal" as const,
  soldAt,
  reversesSaleId,
});

it("accepts a cash sale", async () => {
  const sale = cashSale({ soldAt: "2026-07-30T10:00:00.000Z", cashGivenCents: 200 });
  expect(await postSales(token, [sale])).toEqual([{ id: sale.id, status: "accepted" }]);
  expect(await row(sale.id)).toMatchObject({
    method: "cash",
    status: "paid",
    total_cents: 110,
    cash_given_cents: 200,
    device_id: deviceId,
    sold_at: "2026-07-30T10:00:00.000Z",
    business_date: "2026-07-30",
    late: 0,
    reverses_sale_id: null,
    handover_id: null,
  });
  const line = await env.DB.prepare("SELECT * FROM sale_lines WHERE sale_id = ?").bind(sale.id).first();
  expect(line).toMatchObject({
    product_id: "aardbeitje",
    name: "Aardbeitje",
    category_id: "ijs",
    category_name: "IJs",
    unit_price_cents: 110,
    qty: 1,
  });
});

it("counts a resent sale once", async () => {
  const sale = cashSale();
  await postSales(token, [sale]);
  expect(await postSales(token, [sale])).toEqual([{ id: sale.id, status: "duplicate" }]);
  expect(await postSales(token, [sale, sale])).toEqual([
    { id: sale.id, status: "duplicate" },
    { id: sale.id, status: "duplicate" },
  ]);
  expect(await count("SELECT COUNT(*) n FROM sales")).toBe(1);
  expect(await count("SELECT COUNT(*) n FROM sale_lines")).toBe(1);
  expect(await count("SELECT COUNT(*) n FROM stock_movements")).toBe(1);
});

it("counts a sale once when it appears twice in one request", async () => {
  const sale = cashSale();
  expect(await postSales(token, [sale, sale])).toEqual([
    { id: sale.id, status: "accepted" },
    { id: sale.id, status: "duplicate" },
  ]);
  expect(await count("SELECT COUNT(*) n FROM sales")).toBe(1);
});

it("counts a sale once when two requests carry it at the same moment", async () => {
  const sale = cashSale();
  const other = cashSale();
  const [a, b] = await Promise.all([postSales(token, [sale]), postSales(token, [other, sale])]);
  expect([a[0]!.status, b[1]!.status].sort()).toEqual(["accepted", "duplicate"]);
  expect(b[0]).toEqual({ id: other.id, status: "accepted" });
  expect(await count("SELECT COUNT(*) n FROM sales")).toBe(2);
  expect(await count("SELECT COUNT(*) n FROM sale_lines")).toBe(2);
  expect(await count("SELECT COUNT(*) n FROM stock_movements")).toBe(2);
});

it("sets a bad item aside without blocking the rest (Review Focus 2)", async () => {
  const bad = cashSale({ totalCents: 999 });
  const good = cashSale();
  const broken = { ...cashSale(), lines: [{ productId: "aardbeitje", name: "Aardbeitje", unitPriceCents: 110, qty: 0 }] };
  const ghost = cashSale({ lines: [{ productId: "bestaat-niet", name: "Spook", unitPriceCents: 110, qty: 1 }] });
  expect(await postSales(token, [bad, broken, ghost, "rommel", { id: 5 }, good])).toEqual([
    { id: bad.id, status: "rejected", reason: "total_mismatch" },
    { id: broken.id, status: "rejected", reason: "invalid" },
    { id: ghost.id, status: "rejected", reason: "unknown_product" },
    { id: "", status: "rejected", reason: "invalid" },
    { id: "", status: "rejected", reason: "invalid" },
    { id: good.id, status: "accepted" },
  ]);
  expect(await count("SELECT COUNT(*) n FROM sales")).toBe(1);
});

it("keeps the price the customer saw and accepts a hidden product (Review Focus 3)", async () => {
  const { cookie } = await asAdmin();
  await api("/api/admin/products/aardbeitje", { method: "PATCH", cookie, json: { priceCents: 130, active: false } });
  const sale = cashSale(); // still 110
  expect((await postSales(token, [sale]))[0]!.status).toBe("accepted");
  expect(await env.DB.prepare("SELECT unit_price_cents FROM sale_lines WHERE sale_id = ?").bind(sale.id).first()).toEqual({
    unit_price_cents: 110,
  });
});

it("dates a sale on the Amsterdam day, not the UTC day (Review Focus 1)", async () => {
  const evening = cashSale({ soldAt: "2026-07-31T21:30:00.000Z" }); // 23:30 local
  const afterMidnight = cashSale({ soldAt: "2026-07-31T22:30:00.000Z" }); // 00:30 local on 1 August
  const winter = cashSale({ soldAt: "2025-12-31T23:30:00.000Z" }); // 00:30 local on 1 January
  await postSales(token, [evening, afterMidnight, winter]);
  expect((await row(evening.id))!.business_date).toBe("2026-07-31");
  expect((await row(afterMidnight.id))!.business_date).toBe("2026-08-01");
  expect((await row(winter.id))!.business_date).toBe("2026-01-01");
});

it("ignores a device clock that runs ahead", async () => {
  const sale = cashSale({ soldAt: new Date(Date.now() + 3 * 3600_000).toISOString() });
  const undo = reversalOf(sale.id, new Date(Date.now() + 3 * 3600_000 + 60_000).toISOString());
  expect(await postSales(token, [sale, undo])).toEqual([
    { id: sale.id, status: "accepted" },
    { id: undo.id, status: "accepted" },
  ]);
  const stored = new Date((await row(sale.id))!.sold_at as string).getTime();
  expect(Math.abs(stored - Date.now())).toBeLessThan(60_000);
});

it("stores the time in one format, whatever precision the device sends", async () => {
  const sale = cashSale({ soldAt: "2026-07-30T10:00:00Z" });
  await postSales(token, [sale]);
  expect((await row(sale.id))!.sold_at).toBe("2026-07-30T10:00:00.000Z");
});

it("lowers stock for tracked products only", async () => {
  const sale = cashSale({
    totalCents: 360,
    lines: [
      { productId: "aardbeitje", name: "Aardbeitje", unitPriceCents: 110, qty: 2 },
      { productId: "koffie", name: "Koffie", unitPriceCents: 140, qty: 1 },
    ],
  });
  await postSales(token, [sale]);
  const { results } = await env.DB.prepare("SELECT product_id, delta, kind, ref_id FROM stock_movements").all();
  expect(results).toEqual([{ product_id: "aardbeitje", delta: -2, kind: "sale", ref_id: sale.id }]);
});

it("reverses the device's own recent cash sale", async () => {
  const sale = cashSale({ soldAt: "2026-07-30T10:00:00.000Z" });
  const rev = reversalOf(sale.id, "2026-07-30T10:03:00.000Z");
  expect(await postSales(token, [sale, rev])).toEqual([
    { id: sale.id, status: "accepted" },
    { id: rev.id, status: "accepted" },
  ]);
  expect(await row(rev.id)).toMatchObject({
    method: "cash",
    status: "paid",
    total_cents: -110,
    device_id: deviceId,
    reverses_sale_id: sale.id,
    reversed_by: "device",
    reversal_reason: null,
    business_date: "2026-07-30",
  });
  expect(await env.DB.prepare("SELECT name, unit_price_cents, qty FROM sale_lines WHERE sale_id = ?").bind(rev.id).first()).toEqual(
    { name: "Aardbeitje", unit_price_cents: 110, qty: -1 },
  );
  expect(await count("SELECT COALESCE(SUM(delta),0) n FROM stock_movements WHERE product_id = 'aardbeitje'")).toBe(0);
  expect(await count("SELECT COUNT(*) n FROM stock_movements WHERE kind = 'reversal'")).toBe(1);
  expect(await postSales(token, [rev])).toEqual([{ id: rev.id, status: "duplicate" }]);
});

it("puts back the stock the sale took, even when tracking changed in between", async () => {
  const { cookie } = await asAdmin();
  const tracked = cashSale({ soldAt: "2026-07-30T10:00:00.000Z" });
  const untracked = cashSale({
    soldAt: "2026-07-30T10:00:00.000Z",
    totalCents: 140,
    lines: [{ productId: "koffie", name: "Koffie", unitPriceCents: 140, qty: 1 }],
  });
  await postSales(token, [tracked, untracked]);
  await api("/api/admin/products/aardbeitje", { method: "PATCH", cookie, json: { trackStock: false } });
  await api("/api/admin/products/koffie", { method: "PATCH", cookie, json: { trackStock: true } });
  await postSales(token, [reversalOf(tracked.id, "2026-07-30T10:01:00.000Z"), reversalOf(untracked.id, "2026-07-30T10:01:00.000Z")]);
  expect(await count("SELECT COALESCE(SUM(delta),0) n FROM stock_movements WHERE product_id = 'aardbeitje'")).toBe(0);
  expect(await count("SELECT COALESCE(SUM(delta),0) n FROM stock_movements WHERE product_id = 'koffie'")).toBe(0);
});

it("refuses reversals that break the rules", async () => {
  const sale = cashSale({ soldAt: "2026-07-30T10:00:00.000Z" });
  await postSales(token, [sale]);
  const rev = (soldAt: string, of = sale.id) => reversalOf(of, soldAt);
  expect((await postSales(token, [rev("2026-07-30T10:05:01.000Z")]))[0]).toMatchObject({ status: "rejected", reason: "too_late" });
  expect((await postSales(token, [rev("2026-07-30T10:01:00.000Z", crypto.randomUUID())]))[0]).toMatchObject({
    reason: "original_not_found",
  });
  const other = await asDevice("tweede");
  expect((await postSales(other.token, [rev("2026-07-30T10:01:00.000Z")]))[0]).toMatchObject({ reason: "other_device" });
  const first = rev("2026-07-30T10:01:00.000Z");
  expect((await postSales(token, [first]))[0]!.status).toBe("accepted");
  expect((await postSales(token, [rev("2026-07-30T10:02:00.000Z")]))[0]).toMatchObject({ reason: "already_reversed" });
  expect((await postSales(token, [rev("2026-07-30T10:02:00.000Z", first.id)]))[0]).toMatchObject({ reason: "already_reversed" });
  expect(await count("SELECT COUNT(*) n FROM sales")).toBe(2);
});

it("refuses to reverse a pin sale from the kassa", async () => {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO sales (id, device_id, method, total_cents, sold_at, received_at, business_date) VALUES (?, ?, 'pin', 110, ?, ?, '2026-07-30')",
  )
    .bind(id, deviceId, "2026-07-30T10:00:00.000Z", "2026-07-30T10:00:00.000Z")
    .run();
  expect((await postSales(token, [reversalOf(id, "2026-07-30T10:01:00.000Z")]))[0]).toMatchObject({ reason: "not_cash" });
});

it("reverses a sale once when two reversals arrive at the same moment", async () => {
  const sale = cashSale({ soldAt: "2026-07-30T10:00:00.000Z" });
  await postSales(token, [sale]);
  const [a, b] = await Promise.all([
    postSales(token, [reversalOf(sale.id, "2026-07-30T10:01:00.000Z")]),
    postSales(token, [reversalOf(sale.id, "2026-07-30T10:01:00.000Z")]),
  ]);
  expect([a[0]!.status, b[0]!.status].sort()).toEqual(["accepted", "rejected"]);
  expect([a[0]!.reason, b[0]!.reason]).toContain("already_reversed");
  expect(await count("SELECT COUNT(*) n FROM sales WHERE reverses_sale_id IS NOT NULL")).toBe(1);
  expect(await count("SELECT COALESCE(SUM(delta),0) n FROM stock_movements")).toBe(0);
});

it("writes a full request of fifty sales within the free plan's database budget", async () => {
  const sales = Array.from({ length: 49 }, () => cashSale({ soldAt: "2026-07-30T10:00:00.000Z" }));
  const undo = reversalOf(sales[0]!.id, "2026-07-30T10:01:00.000Z");
  const counted = meteredDb(env.DB);
  const results = await ingestItems(counted.db, deviceId, [...sales, undo], new Date());
  expect(results.every((result) => result.status === "accepted")).toBe(true);
  expect(await count("SELECT COUNT(*) n FROM sales")).toBe(50);
  // The free plan allows 50 database calls per request; the device check uses two of them.
  expect(counted.calls()).toBeLessThanOrEqual(10);
});

it("rejects a malformed request body", async () => {
  expect((await api("/api/kassa/sales", { method: "POST", token, json: { nope: true } })).status).toBe(400);
  expect((await api("/api/kassa/sales", { method: "POST", token, json: { items: [] } })).status).toBe(400);
  const tooMany = await api("/api/kassa/sales", { method: "POST", token, json: { items: Array(51).fill(cashSale()) } });
  expect(tooMany.status).toBe(400);
  expect(await tooMany.json()).toEqual({ error: "invalid" });
  expect((await api("/api/kassa/sales", { method: "POST", json: { items: [cashSale()] } })).status).toBe(401);
});
