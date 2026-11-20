import type { AdminProduct, Catalog, CatalogProduct, Category, ColorKey } from "../../shared/types";

export type DbProduct = {
  id: string;
  name: string;
  price_cents: number;
  category_id: string;
  category_name: string;
  sort: number;
  active: number;
  quantity_pad: number;
  track_stock: number;
  units_per_box: number | null;
  reorder_at: number | null;
};

const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.price_cents, p.category_id, c.name AS category_name, p.sort, p.active,
         p.quantity_pad, p.track_stock, p.units_per_box, p.reorder_at
  FROM products p JOIN categories c ON c.id = p.category_id`;

// The order of the kassa tiles: category by category, then the product's own place.
const PRODUCT_ORDER = "ORDER BY c.sort, c.id, p.sort, p.id";

export async function listCategories(db: D1Database): Promise<Category[]> {
  const { results } = await db
    .prepare("SELECT id, name, color, sort FROM categories ORDER BY sort, id")
    .all<{ id: string; name: string; color: ColorKey; sort: number }>();
  return results;
}

export async function getProduct(db: D1Database, id: string): Promise<DbProduct | null> {
  return db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).bind(id).first<DbProduct>();
}

export function toAdminProduct(row: DbProduct): AdminProduct {
  return {
    id: row.id,
    name: row.name,
    priceCents: row.price_cents,
    categoryId: row.category_id,
    sort: row.sort,
    quantityPad: row.quantity_pad === 1,
    trackStock: row.track_stock === 1,
    reorderAt: row.reorder_at,
    active: row.active === 1,
    unitsPerBox: row.units_per_box,
  };
}

/** What the kassa shows: the active products. Stock and open orders are filled in by the stock module. */
export async function getCatalog(db: D1Database, now: Date): Promise<Catalog> {
  const [categories, rows] = await Promise.all([
    listCategories(db),
    db.prepare(`${PRODUCT_SELECT} WHERE p.active = 1 ${PRODUCT_ORDER}`).all<DbProduct>(),
  ]);
  const products: CatalogProduct[] = rows.results.map((row) => ({
    id: row.id,
    name: row.name,
    priceCents: row.price_cents,
    categoryId: row.category_id,
    sort: row.sort,
    quantityPad: row.quantity_pad === 1,
    trackStock: row.track_stock === 1,
    stock: null,
    reorderAt: row.reorder_at,
  }));
  return { fetchedAt: now.toISOString(), categories, products, openOrders: [] };
}

/** Everything beheer manages, hidden products included. */
export async function listAdminProducts(db: D1Database): Promise<{ categories: Category[]; products: AdminProduct[] }> {
  const [categories, rows] = await Promise.all([
    listCategories(db),
    db.prepare(`${PRODUCT_SELECT} ${PRODUCT_ORDER}`).all<DbProduct>(),
  ]);
  return { categories, products: rows.results.map(toAdminProduct) };
}
