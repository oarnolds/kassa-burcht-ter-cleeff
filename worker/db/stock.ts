import type { OpenOrder, StockItem, StockOrder } from "../../shared/types";

/** A refusal with a reason the beheer pages and the kassa can show. */
export class StockError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

export type OrderInput = { note: string | null; lines: { productId: string; boxes: number; looseUnits: number }[] };
export type CountInput = { productId: string; counted: number; note: string | null };

export type OrderRow = {
  id: string;
  status: "open" | "received" | "cancelled";
  note: string | null;
  created_at: string;
  received_at: string | null;
  received_by: "device" | "admin" | null;
};

export type OrderLineRow = { order_id: string; product_id: string; name: string; boxes: number; loose_units: number; units: number };

const MAX_ORDERS = 50;

/** The stock of a product is the sum of its movements. Usable as a column in a query over `products p`. */
export const STOCK_OF_PRODUCT = "COALESCE((SELECT SUM(m.delta) FROM stock_movements m WHERE m.product_id = p.id), 0)";

export async function stockLevels(db: D1Database): Promise<Map<string, number>> {
  const { results } = await db
    .prepare("SELECT product_id, SUM(delta) AS stock FROM stock_movements GROUP BY product_id")
    .all<{ product_id: string; stock: number }>();
  return new Map(results.map((row) => [row.product_id, row.stock]));
}

/** Every product whose stock is tracked, in the order of the kassa. */
export async function listStock(db: D1Database): Promise<StockItem[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.name, c.name AS category_name, p.units_per_box, p.reorder_at, ${STOCK_OF_PRODUCT} AS stock
       FROM products p JOIN categories c ON c.id = p.category_id
       WHERE p.track_stock = 1
       ORDER BY c.sort, c.id, p.sort, p.id`,
    )
    .all<{ id: string; name: string; category_name: string; units_per_box: number | null; reorder_at: number | null; stock: number }>();
  return results.map((row) => ({
    productId: row.id,
    name: row.name,
    categoryName: row.category_name,
    stock: row.stock,
    unitsPerBox: row.units_per_box,
    reorderAt: row.reorder_at,
    belowReorder: row.reorder_at !== null && row.stock <= row.reorder_at,
  }));
}

/** The two queries that read orders with their lines, newest first; run them in one batch. */
export function orderQueries(db: D1Database, status?: "open"): [D1PreparedStatement, D1PreparedStatement] {
  const where = status ? "WHERE status = 'open'" : "";
  const newest = `SELECT id FROM stock_orders ${where} ORDER BY created_at DESC, id LIMIT ${MAX_ORDERS}`;
  return [
    db.prepare(`SELECT * FROM stock_orders ${where} ORDER BY created_at DESC, id LIMIT ${MAX_ORDERS}`),
    db.prepare(
      `SELECT l.order_id, l.product_id, p.name, l.boxes, l.loose_units, l.units
       FROM stock_order_lines l JOIN products p ON p.id = l.product_id
       WHERE l.order_id IN (${newest})
       ORDER BY l.id`,
    ),
  ];
}

export function toOrders(orders: OrderRow[], lines: OrderLineRow[]): StockOrder[] {
  return orders.map((order) => ({
    id: order.id,
    createdAt: order.created_at,
    note: order.note,
    lines: lines
      .filter((line) => line.order_id === order.id)
      .map((line) => ({
        productId: line.product_id,
        name: line.name,
        boxes: line.boxes,
        looseUnits: line.loose_units,
        units: line.units,
      })),
    status: order.status,
    receivedAt: order.received_at,
    receivedBy: order.received_by,
  }));
}

/** The part of an order the kassa shows while a delivery is on its way. */
export function toOpenOrder(order: StockOrder): OpenOrder {
  return { id: order.id, createdAt: order.createdAt, note: order.note, lines: order.lines };
}

export async function listOrders(db: D1Database, status?: "open"): Promise<StockOrder[]> {
  const [orders, lines] = await db.batch<OrderRow & OrderLineRow>(orderQueries(db, status));
  return toOrders(orders!.results, lines!.results);
}

/** Books an order placed with the supplier. Stock changes only when the delivery is confirmed. */
export async function createOrder(db: D1Database, input: OrderInput, now: Date): Promise<StockOrder> {
  if (input.lines.length === 0) throw new StockError("invalid", 400);
  const { results } = await db
    .prepare("SELECT id, name, track_stock, units_per_box FROM products")
    .all<{ id: string; name: string; track_stock: number; units_per_box: number | null }>();
  const products = new Map(results.map((product) => [product.id, product]));
  if (input.lines.some((line) => products.get(line.productId)?.track_stock !== 1)) throw new StockError("not_tracked", 400);
  if (input.lines.some((line) => line.boxes > 0 && !products.get(line.productId)!.units_per_box)) {
    throw new StockError("units_per_box_missing", 400);
  }
  // The number of units is fixed here; a later change of the box size leaves this order alone.
  const lines = input.lines.map((line) => ({
    ...line,
    name: products.get(line.productId)!.name,
    units: line.boxes * (products.get(line.productId)!.units_per_box ?? 0) + line.looseUnits,
  }));
  if (lines.some((line) => line.units <= 0)) throw new StockError("invalid", 400);

  const id = crypto.randomUUID();
  const createdAt = now.toISOString();
  await db.batch([
    db.prepare("INSERT INTO stock_orders (id, status, note, created_at) VALUES (?, 'open', ?, ?)").bind(id, input.note, createdAt),
    ...lines.map((line) =>
      db
        .prepare("INSERT INTO stock_order_lines (order_id, product_id, boxes, loose_units, units) VALUES (?, ?, ?, ?, ?)")
        .bind(id, line.productId, line.boxes, line.looseUnits, line.units),
    ),
  ]);
  return {
    id,
    createdAt,
    note: input.note,
    lines: lines.map(({ productId, name, boxes, looseUnits, units }) => ({ productId, name, boxes, looseUnits, units })),
    status: "open",
    receivedAt: null,
    receivedBy: null,
  };
}

/**
 * Confirms a delivery: the order closes and its units are added to the stock, in one step.
 * Only an open order can be received, and an order's units are never added twice.
 */
export async function receiveOrder(db: D1Database, id: string, by: "device" | "admin", now: Date): Promise<void> {
  const at = now.toISOString();
  const [closed] = await db.batch([
    db
      .prepare("UPDATE stock_orders SET status = 'received', received_at = ?2, received_by = ?3 WHERE id = ?1 AND status = 'open'")
      .bind(id, at, by),
    db
      .prepare(
        `INSERT INTO stock_movements (product_id, delta, kind, ref_id, created_at)
         SELECT product_id, units, 'delivery', ?1, ?2 FROM stock_order_lines
         WHERE order_id = ?1
           AND EXISTS (SELECT 1 FROM stock_orders WHERE id = ?1 AND status = 'received')
           AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref_id = ?1 AND kind = 'delivery')
         ORDER BY id`,
      )
      .bind(id, at),
  ]);
  if (closed!.meta.changes === 0) throw new StockError("not_open", 409);
}

export async function cancelOrder(db: D1Database, id: string): Promise<void> {
  const cancelled = await db.prepare("UPDATE stock_orders SET status = 'cancelled' WHERE id = ? AND status = 'open'").bind(id).run();
  if (cancelled.meta.changes === 0) throw new StockError("not_open", 409);
}

/** Sets the stock to what was counted, by booking the difference. The count is written down even when it matches. */
export async function recordCount(db: D1Database, input: CountInput, now: Date): Promise<{ stock: number; delta: number }> {
  const tracked = await db.prepare("SELECT 1 FROM products WHERE id = ? AND track_stock = 1").bind(input.productId).first();
  if (!tracked) throw new StockError("not_tracked", 400);
  const booked = await db
    .prepare(
      `INSERT INTO stock_movements (product_id, delta, kind, note, created_at)
       SELECT ?1, ?2 - COALESCE(SUM(delta), 0), 'count', ?3, ?4 FROM stock_movements WHERE product_id = ?1
       RETURNING delta`,
    )
    .bind(input.productId, input.counted, input.note, now.toISOString())
    .first<{ delta: number }>();
  return { stock: input.counted, delta: booked!.delta };
}
