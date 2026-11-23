import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { CashState, StockItem } from "../shared/types";
import { api, asAdmin, asDevice, cashSale, postSales, resetData } from "./helpers";

let cookie: string;
let token: string;

beforeEach(async () => {
  await resetData();
  ({ cookie } = await asAdmin());
  ({ token } = await asDevice());
  await postSales(token, [cashSale()]);
  await api("/api/admin/cash/handovers", {
    method: "POST",
    cookie,
    json: { kind: "handover", countedAt: new Date().toISOString(), receivedCents: 110, leftCents: 0, note: null },
  });
  await api("/api/admin/stock/counts", { method: "POST", cookie, json: { productId: "aardbeitje", counted: 10 } });
  await api("/api/admin/stock/orders", {
    method: "POST",
    cookie,
    json: { note: null, lines: [{ productId: "aardbeitje", boxes: 0, looseUnits: 6 }] },
  });
});

const n = async (t: string) => (await env.DB.prepare(`SELECT COUNT(*) n FROM ${t}`).first<{ n: number }>())!.n;
const wipe = (json: unknown) => api("/api/admin/wipe-trial", { method: "POST", cookie, json });

it("requires the confirmation word", async () => {
  for (const body of [{ confirm: "wissen" }, { confirm: "" }, {}, "WISSEN"]) {
    const res = await wipe(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "confirm_required" });
  }
  expect(await n("sales")).toBe(1);
  expect(await n("handovers")).toBe(1);
});

it("wipes trial data and keeps the setup", async () => {
  const res = await wipe({ confirm: "WISSEN" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  for (const t of ["sales", "sale_lines", "handovers", "stock_orders", "stock_order_lines", "stock_movements"]) {
    expect(await n(t)).toBe(0);
  }
  expect(await n("products")).toBe(22);
  expect(await n("categories")).toBe(6);
  expect(await n("devices")).toBe(1);
  expect((await api("/api/admin/me", { cookie })).status).toBe(200);
  expect((await api("/api/kassa/ping", { token })).status).toBe(200);
  expect((await (await api("/api/admin/cash", { cookie })).json<CashState>()).expectedCents).toBe(0);
  const { items } = await (await api("/api/admin/stock", { cookie })).json<{ items: StockItem[] }>();
  expect(items.find((i) => i.productId === "aardbeitje")!.stock).toBe(0);
});

const inUse = async () => (await api("/api/admin/wipe-trial", { cookie })).json<{ inUseSince: string | null }>();

it("can be wiped again as long as the trial lasts", async () => {
  expect(await inUse()).toEqual({ inUseSince: null });
  expect((await wipe({ confirm: "WISSEN" })).status).toBe(200);
  await postSales(token, [cashSale()]);
  expect((await wipe({ confirm: "WISSEN", final: false })).status).toBe(200);
  expect(await n("sales")).toBe(0);
  expect(await inUse()).toEqual({ inUseSince: null });
});

it("locks wiping for good at the ingebruikname", async () => {
  const res = await wipe({ confirm: "WISSEN", final: true });
  expect(res.status).toBe(200);
  expect(await n("sales")).toBe(0);
  const { inUseSince } = await inUse();
  expect(Math.abs(Date.parse(inUseSince!) - Date.now())).toBeLessThan(60_000);
  // From here on the kassa holds real money.
  await postSales(token, [cashSale()]);
  for (const body of [{ confirm: "WISSEN" }, { confirm: "WISSEN", final: true }]) {
    const again = await wipe(body);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "in_use", inUseSince });
  }
  expect(await n("sales")).toBe(1);
  expect(await n("sale_lines")).toBe(1);
  expect(await inUse()).toEqual({ inUseSince });
});

it("refuses a final flag that is not yes or no, and wipes nothing", async () => {
  const res = await wipe({ confirm: "WISSEN", final: "ja" });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "invalid" });
  expect(await n("sales")).toBe(1);
  expect(await inUse()).toEqual({ inUseSince: null });
});

it("downloads everything except secrets", async () => {
  const res = await api("/api/admin/export.json", { cookie });
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
  expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="kassa-export-\d{4}-\d{2}-\d{2}\.json"$/);
  const text = await res.text();
  const file = JSON.parse(text);
  expect(Object.keys(file).sort()).toEqual([
    "categories",
    "exportedAt",
    "handovers",
    "ledger",
    "products",
    "saleLines",
    "sales",
    "stockMovements",
    "stockOrderLines",
    "stockOrders",
  ]);
  expect(file.categories).toHaveLength(6);
  expect(file.products).toHaveLength(22);
  expect(file.sales).toHaveLength(1);
  expect(file.sales[0]).toMatchObject({ method: "cash", total_cents: 110 });
  expect(file.saleLines).toEqual([expect.objectContaining({ product_id: "aardbeitje", unit_price_cents: 110, qty: 1 })]);
  expect(file.handovers).toHaveLength(1);
  expect(file.stockOrders).toHaveLength(1);
  expect(file.stockOrderLines).toHaveLength(1);
  expect(file.stockMovements).toHaveLength(2); // the sale and the count
  expect(Math.abs(Date.now() - Date.parse(file.exportedAt))).toBeLessThan(5000);
  expect(text).not.toContain("token_hash");
  expect(text).not.toContain("password_hash");
});

it("keeps wiping and downloading behind the beheer login", async () => {
  expect((await api("/api/admin/wipe-trial", { method: "POST", json: { confirm: "WISSEN" } })).status).toBe(401);
  expect((await api("/api/admin/wipe-trial", { method: "POST", token, json: { confirm: "WISSEN" } })).status).toBe(401);
  expect((await api("/api/admin/wipe-trial")).status).toBe(401);
  expect((await api("/api/admin/export.json")).status).toBe(401);
  expect((await api("/api/admin/export.json", { token })).status).toBe(401);
  expect(await n("sales")).toBe(1);
});
