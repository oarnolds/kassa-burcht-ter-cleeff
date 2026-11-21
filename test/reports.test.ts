import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { SaleLineInput } from "../shared/schemas";
import { businessDate, monthOf } from "../shared/time";
import type { AdminSale, DayReport, MonthReport, Summary } from "../shared/types";
import { reverseSaleAsAdmin } from "../worker/db/cash";
import { ingestItems } from "../worker/db/sales";
import { api, asAdmin, asDevice, cashSale, postSales, resetData } from "./helpers";

const BOM = String.fromCharCode(0xfeff);

let cookie: string;
let deviceId: string;
let token: string;
let saleA: string;

beforeEach(async () => {
  await resetData();
  ({ cookie } = await asAdmin());
  ({ deviceId, token } = await asDevice());
  const mk = (soldAt: string, lines: SaleLineInput[]) =>
    cashSale({ soldAt, lines, totalCents: lines.reduce((s, l) => s + l.unitPriceCents * l.qty, 0) });
  const a = mk("2026-07-30T10:00:00.000Z", [
    { productId: "aardbeitje", name: "Aardbeitje", unitPriceCents: 110, qty: 2 },
    { productId: "koffie", name: "Koffie", unitPriceCents: 140, qty: 1 },
  ]); // 360
  const b = mk("2026-07-30T11:00:00.000Z", [{ productId: "statiegeld", name: "Statiegeld", unitPriceCents: 15, qty: 40 }]); // 600
  const c = mk("2026-07-31T09:00:00.000Z", [{ productId: "entreegeld", name: "Entreegeld", unitPriceCents: 60, qty: 1 }]); // 60
  await ingestItems(env.DB, deviceId, [a, b, c], new Date("2026-07-31T09:05:00.000Z"));
  await reverseSaleAsAdmin(env.DB, a.id, "dubbel aangeslagen", new Date("2026-07-31T10:00:00.000Z"));
  saleA = a.id;
});

const get = <T>(path: string) => api(path, { cookie }).then((r) => r.json<T>());

/** The body as the file on disk will be: `text()` would drop the byte-order mark that Excel needs. */
const fileText = async (res: Response) => new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }).decode(await res.arrayBuffer());

it("reports a day", async () => {
  const r = await get<DayReport>("/api/admin/reports/day?date=2026-07-30");
  expect(r.date).toBe("2026-07-30");
  expect(r.totals).toEqual({ cashCents: 960, pinCents: 0, totalCents: 960, saleCount: 2 });
  expect(r.byCategory).toEqual([
    { categoryId: "ijs", categoryName: "IJs", qty: 2, cashCents: 220, pinCents: 0, totalCents: 220 },
    { categoryId: "warm", categoryName: "Warme dranken", qty: 1, cashCents: 140, pinCents: 0, totalCents: 140 },
    { categoryId: "statiegeld", categoryName: "Statiegeld", qty: 40, cashCents: 600, pinCents: 0, totalCents: 600 },
  ]);
  expect(r.byProduct).toEqual([
    { productId: "statiegeld", name: "Statiegeld", categoryName: "Statiegeld", qty: 40, cashCents: 600, pinCents: 0, totalCents: 600 },
    { productId: "aardbeitje", name: "Aardbeitje", categoryName: "IJs", qty: 2, cashCents: 220, pinCents: 0, totalCents: 220 },
    { productId: "koffie", name: "Koffie", categoryName: "Warme dranken", qty: 1, cashCents: 140, pinCents: 0, totalCents: 140 },
  ]);
});

it("reports a day without sales as zeros", async () => {
  const r = await get<DayReport>("/api/admin/reports/day?date=2026-07-29");
  expect(r).toEqual({
    date: "2026-07-29",
    totals: { cashCents: 0, pinCents: 0, totalCents: 0, saleCount: 0 },
    byCategory: [],
    byProduct: [],
  });
});

it("puts a reversal on the day it was made, leaving the original day intact", async () => {
  const r = await get<DayReport>("/api/admin/reports/day?date=2026-07-31");
  expect(r.totals).toEqual({ cashCents: -300, pinCents: 0, totalCents: -300, saleCount: 1 });
  expect(r.byCategory.find((c) => c.categoryId === "ijs")).toMatchObject({ qty: -2, totalCents: -220 });
});

it("reports a month", async () => {
  const r = await get<MonthReport>("/api/admin/reports/month?month=2026-07");
  expect(r.month).toBe("2026-07");
  expect(r.totals).toEqual({ cashCents: 660, pinCents: 0, totalCents: 660, saleCount: 3 });
  expect(r.days.map((d) => [d.date, d.totalCents, d.saleCount])).toEqual([
    ["2026-07-30", 960, 2],
    ["2026-07-31", -300, 1],
  ]);
  expect(r.byCategory.map((c) => [c.categoryId, c.totalCents])).toEqual([
    ["ijs", 0],
    ["warm", 0],
    ["entree", 60],
    ["statiegeld", 600],
  ]);
  expect(r.byProduct[0]).toMatchObject({ productId: "statiegeld", totalCents: 600 });
  expect((await get<MonthReport>("/api/admin/reports/month?month=2026-08")).days).toEqual([]);
});

it("splits cash and pin, and leaves out payments that did not go through", async () => {
  const insert = (id: string, status: string, cents: number) =>
    env.DB.batch([
      env.DB.prepare(
        "INSERT INTO sales (id, method, status, total_cents, sold_at, received_at, business_date) VALUES (?, 'pin', ?, ?, '2026-07-30T12:00:00.000Z', '2026-07-30T12:00:00.000Z', '2026-07-30')",
      ).bind(id, status, cents),
      env.DB.prepare(
        "INSERT INTO sale_lines (sale_id, product_id, name, category_id, category_name, unit_price_cents, qty) VALUES (?, 'koffie', 'Koffie', 'warm', 'Warme dranken', ?, 1)",
      ).bind(id, cents),
    ]);
  await insert("pin-ok", "paid", 140);
  await insert("pin-mislukt", "failed", 140);
  const r = await get<DayReport>("/api/admin/reports/day?date=2026-07-30");
  expect(r.totals).toEqual({ cashCents: 960, pinCents: 140, totalCents: 1100, saleCount: 3 });
  expect(r.byCategory.find((c) => c.categoryId === "warm")).toEqual({
    categoryId: "warm",
    categoryName: "Warme dranken",
    qty: 2,
    cashCents: 140,
    pinCents: 140,
    totalCents: 280,
  });
  const { sales } = await get<{ sales: AdminSale[] }>("/api/admin/sales?date=2026-07-30");
  expect(sales.map((s) => s.id)).not.toContain("pin-mislukt");
});

it("keeps old figures under the name the product had when it was sold", async () => {
  await api("/api/admin/products/koffie", { method: "PATCH", cookie, json: { name: "Koffie groot", priceCents: 200 } });
  await api("/api/admin/categories/warm", { method: "PATCH", cookie, json: { name: "Warm" } });
  const r = await get<DayReport>("/api/admin/reports/day?date=2026-07-30");
  expect(r.byProduct.find((p) => p.productId === "koffie")).toMatchObject({ name: "Koffie", categoryName: "Warme dranken", totalCents: 140 });
  expect(r.byCategory.find((c) => c.categoryId === "warm")).toMatchObject({ categoryName: "Warme dranken" });
});

it("exports day totals as CSV", async () => {
  const res = await api("/api/admin/reports/month.csv?month=2026-07&kind=days", { cookie });
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
  expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="kassa-2026-07-dagen.csv"');
  expect((await fileText(res)).split("\r\n")).toEqual([
    `${BOM}datum;contant;pin;totaal;aantal_verkopen;IJs;Koude dranken;Warme dranken;Snacks;Entree;Statiegeld`,
    "30-07-2026;9,60;0,00;9,60;2;2,20;0,00;1,40;0,00;0,00;6,00",
    "31-07-2026;-3,00;0,00;-3,00;1;-2,20;0,00;-1,40;0,00;0,60;0,00",
    "totaal;6,60;0,00;6,60;3;0,00;0,00;0,00;0,00;0,60;6,00",
    "",
  ]);
});

it("exports sale lines as CSV", async () => {
  const res = await api("/api/admin/reports/month.csv?month=2026-07&kind=sales", { cookie });
  expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="kassa-2026-07-verkopen.csv"');
  const lines = (await fileText(res)).split("\r\n");
  expect(lines[0]).toBe(`${BOM}datum;tijd;bon;betaalwijze;product;categorie;aantal;stukprijs;regeltotaal;teruggedraaid_van`);
  expect(lines[1]).toBe(`30-07-2026;12:00;${saleA.slice(0, 8)};contant;Aardbeitje;IJs;2;1,10;2,20;`);
  expect(lines[3]).toMatch(/^30-07-2026;13:00;[0-9a-f]{8};contant;Statiegeld;Statiegeld;40;0,15;6,00;$/);
  expect(lines).toHaveLength(8); // header + 4 lines + 2 reversal lines + trailing empty
  expect(lines[5]).toMatch(
    new RegExp(`^31-07-2026;12:00;[0-9a-f]{8};contant;Aardbeitje;IJs;-2;1,10;-2,20;${saleA.slice(0, 8)}$`),
  );
});

it("lists the sales of a day with their state", async () => {
  const { sales, pinAttempts } = await get<{ sales: AdminSale[]; pinAttempts: unknown[] }>("/api/admin/sales?date=2026-07-30");
  expect(pinAttempts).toEqual([]);
  expect(sales).toHaveLength(2);
  expect(sales[0]).toMatchObject({
    possiblyDouble: false,
    id: saleA,
    method: "cash",
    totalCents: 360,
    soldAt: "2026-07-30T10:00:00.000Z",
    soldAtLocal: "12:00",
    businessDate: "2026-07-30",
    reversed: true,
    late: false,
    reversesSaleId: null,
    reversalReason: null,
  });
  expect(sales[0]!.lines).toEqual([
    { name: "Aardbeitje", categoryName: "IJs", unitPriceCents: 110, qty: 2 },
    { name: "Koffie", categoryName: "Warme dranken", unitPriceCents: 140, qty: 1 },
  ]);
  expect(sales[1]!.reversed).toBe(false);
  const next = await get<{ sales: AdminSale[] }>("/api/admin/sales?date=2026-07-31");
  expect(next.sales[1]).toMatchObject({
    totalCents: -360,
    reversesSaleId: saleA,
    reversalReason: "dubbel aangeslagen",
    reversed: false,
  });
});

it("summarises today, this month, the cash box and stock", async () => {
  const before = await get<Summary>("/api/admin/summary");
  const today = businessDate(new Date().toISOString());
  expect(before.today).toEqual({ date: today, cashCents: 0, pinCents: 0, totalCents: 0, saleCount: 0 });
  expect(before.month.month).toBe(monthOf(today));
  expect(before.cashExpectedCents).toBe(660);
  expect(before).toMatchObject({ reorderCount: 0, openOrderCount: 0, pinAttention: [] });

  await postSales(token, [cashSale()]);
  await api("/api/admin/products/bosfruit", { method: "PATCH", cookie, json: { reorderAt: 5 } });
  await api("/api/admin/stock/orders", {
    method: "POST",
    cookie,
    json: { note: null, lines: [{ productId: "bosfruit", boxes: 0, looseUnits: 6 }] },
  });
  const after = await get<Summary>("/api/admin/summary");
  expect(after.today).toEqual({ date: today, cashCents: 110, pinCents: 0, totalCents: 110, saleCount: 1 });
  expect(after.month).toMatchObject({ month: monthOf(today), totalCents: 110, saleCount: 1 });
  expect(after).toMatchObject({ cashExpectedCents: 770, reorderCount: 1, openOrderCount: 1 });
});

it.each([
  "/api/admin/reports/day?date=30-07-2026",
  "/api/admin/reports/day?date=2026-02-31",
  "/api/admin/reports/day",
  "/api/admin/reports/month?month=2026-7",
  "/api/admin/reports/month?month=2026-13",
  "/api/admin/reports/month.csv?month=2026-07&kind=x",
  "/api/admin/reports/month.csv?month=2026-07",
  "/api/admin/reports/month.csv?month=juli&kind=days",
  "/api/admin/sales",
])("rejects %s", async (path) => {
  const res = await api(path, { cookie });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "invalid" });
});

it("keeps the figures behind the beheer login", async () => {
  for (const path of [
    "/api/admin/summary",
    "/api/admin/reports/day?date=2026-07-30",
    "/api/admin/reports/month?month=2026-07",
    "/api/admin/reports/month.csv?month=2026-07&kind=days",
    "/api/admin/sales?date=2026-07-30",
  ]) {
    expect((await api(path)).status).toBe(401);
    expect((await api(path, { token })).status).toBe(401);
  }
});
