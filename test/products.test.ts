import { beforeEach, expect, it } from "vitest";
import type { AdminProduct, Catalog, Category } from "../shared/types";
import { api, asAdmin, asDevice, resetData } from "./helpers";

beforeEach(resetData);

async function catalog(token: string): Promise<Catalog> {
  return (await api("/api/kassa/catalog", { token })).json<Catalog>();
}

it("serves the catalog to a paired device only", async () => {
  expect((await api("/api/kassa/catalog")).status).toBe(401);
  const { token } = await asDevice();
  const cat = await catalog(token);
  expect(cat.categories.map((c) => c.id)).toEqual(["ijs", "koud", "warm", "snacks", "entree", "statiegeld"]);
  expect(cat.categories[0]).toEqual({ id: "ijs", name: "IJs", color: "rose", sort: 1 });
  expect(cat.products).toHaveLength(22);
  expect(cat.products[0]).toEqual({
    id: "aardbeitje",
    name: "Aardbeitje",
    priceCents: 110,
    categoryId: "ijs",
    sort: 1,
    quantityPad: false,
    trackStock: true,
    stock: 0,
    reorderAt: null,
  });
  expect(cat.products[21]).toMatchObject({ id: "statiegeld", quantityPad: true, trackStock: false, stock: null });
  expect(cat.openOrders).toEqual([]);
  expect(Math.abs(Date.now() - Date.parse(cat.fetchedAt))).toBeLessThan(5000);
});

it("still answers the device ping", async () => {
  const { token } = await asDevice();
  expect(await (await api("/api/kassa/ping", { token })).json()).toEqual({ ok: true });
});

it("shows a price change in the catalog", async () => {
  const { cookie } = await asAdmin();
  const { token } = await asDevice();
  const res = await api("/api/admin/products/koffie", { method: "PATCH", cookie, json: { priceCents: 150 } });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ id: "koffie", name: "Koffie", priceCents: 150, active: true });
  expect((await catalog(token)).products.find((p) => p.id === "koffie")!.priceCents).toBe(150);
});

it("hides a product from the kassa but keeps it in beheer", async () => {
  const { cookie } = await asAdmin();
  const { token } = await asDevice();
  await api("/api/admin/products/chips", { method: "PATCH", cookie, json: { active: false } });
  expect((await catalog(token)).products.some((p) => p.id === "chips")).toBe(false);
  const all = await (await api("/api/admin/products", { cookie })).json<{ products: AdminProduct[] }>();
  expect(all.products).toHaveLength(22);
  expect(all.products.find((p) => p.id === "chips")!.active).toBe(false);
});

it("adds a product at the end of the list", async () => {
  const { cookie } = await asAdmin();
  const { token } = await asDevice();
  const res = await api("/api/admin/products", {
    method: "POST",
    cookie,
    json: { name: "  Tosti ", priceCents: 250, categoryId: "snacks" },
  });
  expect(res.status).toBe(201);
  const created = await res.json<AdminProduct>();
  expect(created).toMatchObject({
    name: "Tosti",
    priceCents: 250,
    categoryId: "snacks",
    sort: 23,
    active: true,
    quantityPad: false,
    trackStock: false,
    unitsPerBox: null,
    reorderAt: null,
  });
  expect((await catalog(token)).products.some((p) => p.id === created.id)).toBe(true);
});

it("stores the stock settings of a product", async () => {
  const { cookie } = await asAdmin();
  const res = await api("/api/admin/products/aardbeitje", { method: "PATCH", cookie, json: { unitsPerBox: 24, reorderAt: 12 } });
  expect(await res.json()).toMatchObject({ id: "aardbeitje", trackStock: true, unitsPerBox: 24, reorderAt: 12 });
  const cleared = await api("/api/admin/products/aardbeitje", { method: "PATCH", cookie, json: { unitsPerBox: null } });
  expect(await cleared.json()).toMatchObject({ unitsPerBox: null, reorderAt: 12 });
});

it("reorders products", async () => {
  const { cookie } = await asAdmin();
  const { token } = await asDevice();
  const res = await api("/api/admin/products/order", { method: "PUT", cookie, json: { ids: ["thee", "koffie"] } });
  expect(res.status).toBe(200);
  const cat = await catalog(token);
  expect(cat.products.filter((p) => p.categoryId === "warm").map((p) => p.id)).toEqual(["thee", "koffie"]);
  // The rest of the list keeps its place.
  expect(cat.products.map((p) => p.id).slice(14, 18)).toEqual(["blikje-fris", "thee", "koffie", "liga"]);
});

it.each([
  [{ ids: ["thee", "bestaat-niet"] }],
  [{ ids: ["thee", "thee"] }],
  [{ ids: [] }],
  [{ ids: "thee" }],
])("rejects invalid order %j", async (body) => {
  const { cookie } = await asAdmin();
  expect((await api("/api/admin/products/order", { method: "PUT", cookie, json: body })).status).toBe(400);
});

it.each([
  [{ name: "", priceCents: 100, categoryId: "snacks" }],
  [{ name: "   ", priceCents: 100, categoryId: "snacks" }],
  [{ name: "x".repeat(41), priceCents: 100, categoryId: "snacks" }],
  [{ name: "Tosti", priceCents: -1, categoryId: "snacks" }],
  [{ name: "Tosti", priceCents: 1.5, categoryId: "snacks" }],
  [{ name: "Tosti", priceCents: 100001, categoryId: "snacks" }],
  [{ name: "Tosti", priceCents: 100, categoryId: "bestaat-niet" }],
  [{ name: "Tosti", priceCents: 100, categoryId: "snacks", unitsPerBox: 0 }],
  [{ name: "Tosti", priceCents: 100, categoryId: "snacks", reorderAt: -1 }],
  [{ name: "Tosti", categoryId: "snacks" }],
])("rejects invalid product %j", async (body) => {
  const { cookie } = await asAdmin();
  const res = await api("/api/admin/products", { method: "POST", cookie, json: body });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "invalid" });
});

it("rejects an invalid change and leaves the product alone", async () => {
  const { cookie } = await asAdmin();
  for (const body of [{ priceCents: -5 }, { categoryId: "bestaat-niet" }, { name: "" }, { active: "ja" }]) {
    expect((await api("/api/admin/products/koffie", { method: "PATCH", cookie, json: body })).status).toBe(400);
  }
  const all = await (await api("/api/admin/products", { cookie })).json<{ products: AdminProduct[] }>();
  expect(all.products.find((p) => p.id === "koffie")).toMatchObject({ name: "Koffie", priceCents: 140, categoryId: "warm" });
});

it("answers 404 for an unknown product", async () => {
  const { cookie } = await asAdmin();
  expect(
    (await api("/api/admin/products/bestaat-niet", { method: "PATCH", cookie, json: { priceCents: 1 } })).status,
  ).toBe(404);
});

it("adds and edits a category", async () => {
  const { cookie } = await asAdmin();
  const res = await api("/api/admin/categories", { method: "POST", cookie, json: { name: "Fruit", color: "green" } });
  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ name: "Fruit", color: "green", sort: 7 });
  expect((await api("/api/admin/categories", { method: "POST", cookie, json: { name: "X", color: "purple" } })).status).toBe(400);
  expect(
    (await api("/api/admin/categories/ijs", { method: "PATCH", cookie, json: { name: "IJsjes", color: "blue" } })).status,
  ).toBe(200);
  expect((await api("/api/admin/categories/bestaat-niet", { method: "PATCH", cookie, json: { name: "X" } })).status).toBe(404);
  const all = await (await api("/api/admin/products", { cookie })).json<{ categories: Category[] }>();
  expect(all.categories).toHaveLength(7);
  expect(all.categories.find((c) => c.id === "ijs")).toMatchObject({ name: "IJsjes", color: "blue", sort: 1 });
});

it("keeps product management behind the beheer login", async () => {
  expect((await api("/api/admin/products")).status).toBe(401);
  expect((await api("/api/admin/products/koffie", { method: "PATCH", json: { priceCents: 1 } })).status).toBe(401);
  const { token } = await asDevice();
  expect((await api("/api/admin/products", { token })).status).toBe(401);
});
