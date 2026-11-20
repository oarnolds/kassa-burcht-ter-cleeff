import type { AdminProduct, Catalog, CatalogProduct, Category } from "../../shared/types";
import { STOCK_OF_PRODUCT, orderQueries, toOpenOrder, toOrders, type OrderLineRow, type OrderRow } from "./stock";

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

const PRODUCT_COLUMNS = `p.id, p.name, p.price_cents, p.category_id, c.name AS category_name, p.sort, p.active,
         p.quantity_pad, p.track_stock, p.units_per_box, p.reorder_at`;
const PRODUCT_FROM = "FROM products p JOIN categories c ON c.id = p.category_id";
const PRODUCT_SELECT = `SELECT ${PRODUCT_COLUMNS} ${PRODUCT_FROM}`;
const PRODUCT_SELECT_WITH_STOCK = `SELECT ${PRODUCT_COLUMNS}, ${STOCK_OF_PRODUCT} AS stock ${PRODUCT_FROM}`;
const CATEGORY_SELECT = "SELECT id, name, color, sort FROM categories ORDER BY sort, id";

// The order of the kassa tiles: category by category, then the product's own place.
const PRODUCT_ORDER = "ORDER BY c.sort, c.id, p.sort, p.id";

export async function listCategories(db: D1Database): Promise<Category[]> {
  const { results } = await db.prepare(CATEGORY_SELECT).all<Category>();
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

/** What the kassa shows: the active products with their stock, and the deliveries that are on their way. */
export async function getCatalog(db: D1Database, now: Date): Promise<Catalog> {
  // One round trip: the iPad asks for this every minute.
  const [categories, rows, orders, orderLines] = await db.batch([
    db.prepare(CATEGORY_SELECT),
    db.prepare(`${PRODUCT_SELECT_WITH_STOCK} WHERE p.active = 1 ${PRODUCT_ORDER}`),
    ...orderQueries(db, "open"),
  ]);
  const products: CatalogProduct[] = (rows!.results as (DbProduct & { stock: number })[]).map((row) => ({
    id: row.id,
    name: row.name,
    priceCents: row.price_cents,
    categoryId: row.category_id,
    sort: row.sort,
    quantityPad: row.quantity_pad === 1,
    trackStock: row.track_stock === 1,
    stock: row.track_stock === 1 ? row.stock : null,
    reorderAt: row.reorder_at,
  }));
  return {
    fetchedAt: now.toISOString(),
    categories: categories!.results as Category[],
    products,
    openOrders: toOrders(orders!.results as OrderRow[], orderLines!.results as OrderLineRow[]).map(toOpenOrder),
  };
}

/** Everything beheer manages, hidden products included. */
export async function listAdminProducts(db: D1Database): Promise<{ categories: Category[]; products: AdminProduct[] }> {
  const [categories, rows] = await Promise.all([
    listCategories(db),
    db.prepare(`${PRODUCT_SELECT} ${PRODUCT_ORDER}`).all<DbProduct>(),
  ]);
  return { categories, products: rows.results.map(toAdminProduct) };
}
