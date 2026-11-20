import { Hono } from "hono";
import { z } from "zod";
import type { Category } from "../../shared/types";
import { getProduct, listAdminProducts, toAdminProduct } from "../db/products";
import type { AppEnv } from "../env";

const name = z.string().trim().min(1).max(40);
const color = z.enum(["rose", "blue", "brown", "yellow", "green", "grey"]);

const productFields = {
  name,
  priceCents: z.number().int().min(0).max(100_000),
  categoryId: z.string().min(1).max(60),
  quantityPad: z.boolean(),
  trackStock: z.boolean(),
  unitsPerBox: z.number().int().min(1).max(500).nullable(),
  reorderAt: z.number().int().min(0).max(10_000).nullable(),
};

const newProduct = z.object({
  name: productFields.name,
  priceCents: productFields.priceCents,
  categoryId: productFields.categoryId,
  quantityPad: productFields.quantityPad.optional(),
  trackStock: productFields.trackStock.optional(),
  unitsPerBox: productFields.unitsPerBox.optional(),
  reorderAt: productFields.reorderAt.optional(),
});
const productChange = z.object({ ...productFields, active: z.boolean() }).partial();
const productOrder = z.object({ ids: z.array(z.string()).min(1).max(1000) });
const newCategory = z.object({ name, color });
const categoryChange = z.object({ name, color, sort: z.number().int().min(0).max(10_000) }).partial();

// Request field → column, for the fields a change may touch.
const PRODUCT_COLUMNS = {
  name: "name",
  priceCents: "price_cents",
  categoryId: "category_id",
  quantityPad: "quantity_pad",
  trackStock: "track_stock",
  unitsPerBox: "units_per_box",
  reorderAt: "reorder_at",
  active: "active",
} as const;

const CATEGORY_COLUMNS = { name: "name", color: "color", sort: "sort" } as const;

function toColumnValue(value: string | number | boolean | null): string | number | null {
  return typeof value === "boolean" ? Number(value) : value;
}

async function categoryExists(db: D1Database, id: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM categories WHERE id = ?").bind(id).first()) !== null;
}

async function getCategory(db: D1Database, id: string): Promise<Category | null> {
  return db.prepare("SELECT id, name, color, sort FROM categories WHERE id = ?").bind(id).first<Category>();
}

/** Beheer: products and categories. Mounted behind `requireAdmin`. Nothing is ever deleted, only hidden. */
export const adminProducts = new Hono<AppEnv>();

adminProducts.get("/products", async (c) => c.json(await listAdminProducts(c.env.DB)));

adminProducts.post("/products", async (c) => {
  const db = c.env.DB;
  const body = newProduct.safeParse(await c.req.json().catch(() => null));
  if (!body.success || !(await categoryExists(db, body.data.categoryId))) return c.json({ error: "invalid" }, 400);
  const id = crypto.randomUUID();
  const input = body.data;
  await db
    .prepare(
      `INSERT INTO products (id, name, price_cents, category_id, sort, quantity_pad, track_stock, units_per_box, reorder_at, updated_at)
       VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM products), ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.priceCents,
      input.categoryId,
      Number(input.quantityPad ?? false),
      Number(input.trackStock ?? false),
      input.unitsPerBox ?? null,
      input.reorderAt ?? null,
      new Date().toISOString(),
    )
    .run();
  return c.json(toAdminProduct((await getProduct(db, id))!), 201);
});

adminProducts.put("/products/order", async (c) => {
  const db = c.env.DB;
  const body = productOrder.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  const ids = body.data.ids;
  const { results } = await db.prepare("SELECT id, sort FROM products").all<{ id: string; sort: number }>();
  const sortById = new Map(results.map((row) => [row.id, row.sort]));
  if (new Set(ids).size !== ids.length || ids.some((id) => !sortById.has(id))) return c.json({ error: "invalid" }, 400);
  // The given products trade places among themselves; every other product keeps its place.
  const slots = ids.map((id) => sortById.get(id)!).sort((a, b) => a - b);
  const now = new Date().toISOString();
  await db.batch(
    ids.map((id, index) => db.prepare("UPDATE products SET sort = ?, updated_at = ? WHERE id = ?").bind(slots[index]!, now, id)),
  );
  return c.json({ ok: true });
});

adminProducts.patch("/products/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  if (!(await getProduct(db, id))) return c.json({ error: "not_found" }, 404);
  const body = productChange.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  const change = body.data;
  if (change.categoryId !== undefined && !(await categoryExists(db, change.categoryId))) {
    return c.json({ error: "invalid" }, 400);
  }
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [field, column] of Object.entries(PRODUCT_COLUMNS) as [keyof typeof PRODUCT_COLUMNS, string][]) {
    const value = change[field];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(toColumnValue(value));
  }
  if (sets.length > 0) {
    await db
      .prepare(`UPDATE products SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`)
      .bind(...values, new Date().toISOString(), id)
      .run();
  }
  return c.json(toAdminProduct((await getProduct(db, id))!));
});

adminProducts.post("/categories", async (c) => {
  const db = c.env.DB;
  const body = newCategory.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO categories (id, name, color, sort) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM categories))")
    .bind(id, body.data.name, body.data.color)
    .run();
  return c.json((await getCategory(db, id))!, 201);
});

adminProducts.patch("/categories/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  if (!(await getCategory(db, id))) return c.json({ error: "not_found" }, 404);
  const body = categoryChange.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  const sets: string[] = [];
  const values: (string | number)[] = [];
  for (const [field, column] of Object.entries(CATEGORY_COLUMNS) as [keyof typeof CATEGORY_COLUMNS, string][]) {
    const value = body.data[field];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(value);
  }
  if (sets.length > 0) {
    await db
      .prepare(`UPDATE categories SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...values, id)
      .run();
  }
  return c.json((await getCategory(db, id))!);
});
