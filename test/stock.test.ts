import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { Catalog, StockItem, StockOrder } from "../shared/types";
import { api, asAdmin, asDevice, cashSale, postSales, resetData } from "./helpers";

let cookie: string;
let token: string;

beforeEach(async () => {
  await resetData();
  ({ cookie } = await asAdmin());
  ({ token } = await asDevice());
  await api("/api/admin/products/aardbeitje", { method: "PATCH", cookie, json: { unitsPerBox: 24, reorderAt: 12 } });
});

const stock = async () => (await (await api("/api/admin/stock", { cookie })).json<{ items: StockItem[] }>()).items;
const stockOf = async (id: string) => (await stock()).find((i) => i.productId === id)!;
const order = (lines: object[], note: string | null = null) =>
  api("/api/admin/stock/orders", { method: "POST", cookie, json: { note, lines } });
const orders = async () => (await (await api("/api/admin/stock/orders", { cookie })).json<{ orders: StockOrder[] }>()).orders;
const catalog = async () => (await api("/api/kassa/catalog", { token })).json<Catalog>();
const sell = (qty: number) =>
  postSales(token, [
    cashSale({ totalCents: 110 * qty, lines: [{ productId: "aardbeitje", name: "Aardbeitje", unitPriceCents: 110, qty }] }),
  ]);
const count = (json: object) => api("/api/admin/stock/counts", { method: "POST", cookie, json });

it("lists the tracked products with their stock", async () => {
  const items = await stock();
  expect(items).toHaveLength(10);
  expect(items[0]).toEqual({
    productId: "aardbeitje",
    name: "Aardbeitje",
    categoryName: "IJs",
    stock: 0,
    unitsPerBox: 24,
    reorderAt: 12,
    belowReorder: true,
  });
  expect(items.some((i) => i.productId === "koffie")).toBe(false);
});

it("an order does not change stock until it is received", async () => {
  const res = await order([{ productId: "aardbeitje", boxes: 2, looseUnits: 0 }], "Goodoo week 31");
  expect(res.status).toBe(201);
  const created = await res.json<StockOrder>();
  expect(created).toMatchObject({
    status: "open",
    note: "Goodoo week 31",
    receivedAt: null,
    receivedBy: null,
    lines: [{ productId: "aardbeitje", name: "Aardbeitje", boxes: 2, looseUnits: 0, units: 48 }],
  });
  expect((await stockOf("aardbeitje")).stock).toBe(0);
  expect((await catalog()).openOrders).toEqual([
    {
      id: created.id,
      createdAt: created.createdAt,
      note: "Goodoo week 31",
      lines: [{ productId: "aardbeitje", name: "Aardbeitje", boxes: 2, looseUnits: 0, units: 48 }],
    },
  ]);
});

it("fixes the number of units at the moment of ordering", async () => {
  const { id } = await (await order([{ productId: "aardbeitje", boxes: 2, looseUnits: 0 }])).json<StockOrder>();
  await api("/api/admin/products/aardbeitje", { method: "PATCH", cookie, json: { unitsPerBox: 30 } });
  await api(`/api/admin/stock/orders/${id}/receive`, { method: "POST", cookie });
  expect((await stockOf("aardbeitje")).stock).toBe(48);
});

it("the device confirms receipt once (Review Focus 4)", async () => {
  const { id } = await (await order([{ productId: "aardbeitje", boxes: 2, looseUnits: 5 }])).json<StockOrder>();
  expect((await api(`/api/kassa/orders/${id}/receive`, { method: "POST", token })).status).toBe(200);
  const second = await api(`/api/kassa/orders/${id}/receive`, { method: "POST", token });
  expect(second.status).toBe(409);
  expect(await second.json()).toEqual({ error: "not_open" });
  expect((await api(`/api/admin/stock/orders/${id}/receive`, { method: "POST", cookie })).status).toBe(409);
  expect((await stockOf("aardbeitje")).stock).toBe(53);
  const cat = await catalog();
  expect(cat.openOrders).toEqual([]);
  expect(cat.products.find((p) => p.id === "aardbeitje")).toMatchObject({ stock: 53, reorderAt: 12 });
  expect(cat.products.find((p) => p.id === "koffie")!.stock).toBeNull();
  const all = await orders();
  expect(all[0]).toMatchObject({ status: "received", receivedBy: "device" });
  expect(all[0]!.receivedAt).not.toBeNull();
  const { results } = await env.DB.prepare("SELECT product_id, delta, kind, ref_id FROM stock_movements").all();
  expect(results).toEqual([{ product_id: "aardbeitje", delta: 53, kind: "delivery", ref_id: id }]);
});

it("adds the delivery once when Ontvangen is tapped twice at the same moment (Review Focus 4)", async () => {
  const { id } = await (await order([{ productId: "aardbeitje", boxes: 2, looseUnits: 0 }])).json<StockOrder>();
  const [a, b, c] = await Promise.all([
    api(`/api/kassa/orders/${id}/receive`, { method: "POST", token }),
    api(`/api/kassa/orders/${id}/receive`, { method: "POST", token }),
    api(`/api/admin/stock/orders/${id}/receive`, { method: "POST", cookie }),
  ]);
  expect([a.status, b.status, c.status].sort()).toEqual([200, 409, 409]);
  expect((await stockOf("aardbeitje")).stock).toBe(48);
});

it("beheer can receive or cancel an open order", async () => {
  const a = await (await order([{ productId: "aardbeitje", boxes: 1, looseUnits: 0 }])).json<StockOrder>();
  const b = await (await order([{ productId: "aardbeitje", boxes: 1, looseUnits: 0 }])).json<StockOrder>();
  expect((await api(`/api/admin/stock/orders/${a.id}/receive`, { method: "POST", cookie })).status).toBe(200);
  expect((await api(`/api/admin/stock/orders/${b.id}/cancel`, { method: "POST", cookie })).status).toBe(200);
  const again = await api(`/api/admin/stock/orders/${a.id}/cancel`, { method: "POST", cookie });
  expect(again.status).toBe(409);
  expect(await again.json()).toEqual({ error: "not_open" });
  expect((await api(`/api/kassa/orders/${b.id}/receive`, { method: "POST", token })).status).toBe(409);
  expect((await api("/api/admin/stock/orders/bestaat-niet/receive", { method: "POST", cookie })).status).toBe(409);
  expect((await stockOf("aardbeitje")).stock).toBe(24);
  const all = await orders();
  expect(all.find((o) => o.id === a.id)).toMatchObject({ status: "received", receivedBy: "admin" });
  expect(all.find((o) => o.id === b.id)).toMatchObject({ status: "cancelled", receivedAt: null });
  expect((await catalog()).openOrders).toEqual([]);
});

it("sales lower stock, a count corrects it, and it may go below zero", async () => {
  const { id } = await (await order([{ productId: "aardbeitje", boxes: 2, looseUnits: 0 }])).json<StockOrder>();
  await api(`/api/admin/stock/orders/${id}/receive`, { method: "POST", cookie });
  await sell(3);
  expect((await stockOf("aardbeitje")).stock).toBe(45);
  const res = await count({ productId: "aardbeitje", counted: 40, note: "gesmolten" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ stock: 40, delta: -5 });
  expect(
    await env.DB.prepare("SELECT delta, note FROM stock_movements WHERE kind = 'count'").first(),
  ).toEqual({ delta: -5, note: "gesmolten" });
  await sell(50);
  expect((await stockOf("aardbeitje")).stock).toBe(-10);
  expect((await catalog()).products.find((p) => p.id === "aardbeitje")!.stock).toBe(-10);
});

it("writes a count down even when nothing changed", async () => {
  expect(await (await count({ productId: "aardbeitje", counted: 0 })).json()).toEqual({ stock: 0, delta: 0 });
  expect(await env.DB.prepare("SELECT COUNT(*) n FROM stock_movements WHERE kind = 'count'").first()).toEqual({ n: 1 });
});

it("refuses a count that cannot be right", async () => {
  expect(await (await count({ productId: "koffie", counted: 5 })).json()).toEqual({ error: "not_tracked" });
  expect(await (await count({ productId: "bestaat-niet", counted: 5 })).json()).toEqual({ error: "not_tracked" });
  for (const bad of [{ productId: "aardbeitje", counted: -1 }, { productId: "aardbeitje", counted: 2.5 }, { productId: "aardbeitje" }]) {
    const res = await count(bad);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid" });
  }
});

it("flags a product at or below its reorder level", async () => {
  await count({ productId: "aardbeitje", counted: 13 });
  expect((await stockOf("aardbeitje")).belowReorder).toBe(false);
  await sell(1);
  expect(await stockOf("aardbeitje")).toMatchObject({ stock: 12, belowReorder: true });
  expect((await stockOf("bosfruit")).belowReorder).toBe(false); // no reorder level set
});

it("rejects orders that cannot be counted", async () => {
  const untracked = await order([{ productId: "koffie", boxes: 0, looseUnits: 5 }]);
  expect(untracked.status).toBe(400);
  expect(await untracked.json()).toEqual({ error: "not_tracked" });
  expect(await (await order([{ productId: "bestaat-niet", boxes: 0, looseUnits: 5 }])).json()).toEqual({ error: "not_tracked" });
  const noBoxSize = await order([{ productId: "bosfruit", boxes: 1, looseUnits: 0 }]);
  expect(noBoxSize.status).toBe(400);
  expect(await noBoxSize.json()).toEqual({ error: "units_per_box_missing" });
  for (const lines of [
    [],
    [{ productId: "aardbeitje", boxes: 0, looseUnits: 0 }],
    [{ productId: "aardbeitje", boxes: -1, looseUnits: 0 }],
    [{ productId: "aardbeitje", boxes: 1.5, looseUnits: 0 }],
    [{ productId: "aardbeitje", boxes: 1 }],
  ]) {
    const res = await order(lines);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid" });
  }
  expect(await orders()).toEqual([]);
  expect((await order([{ productId: "bosfruit", boxes: 0, looseUnits: 6 }])).status).toBe(201); // loose units need no box size
});

it("lists orders newest first", async () => {
  const first = await (await order([{ productId: "aardbeitje", boxes: 1, looseUnits: 0 }])).json<StockOrder>();
  await env.DB.prepare("UPDATE stock_orders SET created_at = '2026-07-01T08:00:00.000Z' WHERE id = ?").bind(first.id).run();
  const second = await (await order([{ productId: "aardbeitje", boxes: 0, looseUnits: 3 }])).json<StockOrder>();
  expect((await orders()).map((o) => o.id)).toEqual([second.id, first.id]);
});

it("keeps stock behind the right login", async () => {
  expect((await api("/api/admin/stock")).status).toBe(401);
  expect((await api("/api/admin/stock", { token })).status).toBe(401);
  expect((await api("/api/admin/stock/orders", { method: "POST", json: { note: null, lines: [] } })).status).toBe(401);
  expect((await api("/api/kassa/orders/x/receive", { method: "POST" })).status).toBe(401);
  expect((await api("/api/kassa/orders/x/receive", { method: "POST", cookie })).status).toBe(401);
});
