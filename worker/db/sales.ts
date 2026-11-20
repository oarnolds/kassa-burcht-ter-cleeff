import { outboxItem, type CashSaleInput, type OutboxItem, type ReversalInput } from "../../shared/schemas";
import { businessDate } from "../../shared/time";
import type { ItemResult, RejectReason } from "../../shared/types";

/** A row of `sales` as stored. */
export type SaleRow = {
  id: string;
  device_id: string | null;
  method: "cash" | "pin";
  status: "paid" | "pending" | "failed";
  total_cents: number;
  cash_given_cents: number | null;
  sold_at: string;
  received_at: string;
  business_date: string;
  reverses_sale_id: string | null;
  reversal_reason: string | null;
  reversed_by: "device" | "admin" | null;
  late: number;
  handover_id: string | null;
};

export type ReversalOptions = {
  id: string;
  soldAt: string;
  by: "device" | "admin";
  reason: string | null;
  deviceId: string | null;
  now: Date;
};

// A device clock may run this far ahead before the server's own time is used instead.
const CLOCK_AHEAD_MS = 5 * 60_000;
// The kassa may undo its own sale this long after making it.
const REVERSAL_WINDOW_MS = 5 * 60_000;

// A sale is "late" when it was made before a count of the cash box but arrives after it.
const LATE = "EXISTS (SELECT 1 FROM handovers WHERE counted_at >= ?5)";

type ProductInfo = { id: string; category_id: string; category_name: string; track_stock: number };

/** What the database holds about the items of one request, kept up to date while the items are judged. */
type Known = {
  products: Map<string, ProductInfo>;
  sales: Map<string, SaleRow>;
  reversed: Set<string>;
};

type Verdict = { reject: RejectReason } | { duplicate: true } | { statements: D1PreparedStatement[]; row: SaleRow };

export async function getSale(db: D1Database, id: string): Promise<SaleRow | null> {
  return db.prepare("SELECT * FROM sales WHERE id = ?").bind(id).first<SaleRow>();
}

/** The moment of sale as stored: the device's own time, unless its clock runs ahead. Always in one format. */
function storedSoldAt(soldAt: string, now: Date): string {
  const moment = Date.parse(soldAt);
  return moment > now.getTime() + CLOCK_AHEAD_MS ? now.toISOString() : new Date(moment).toISOString();
}

function reversalStatements(db: D1Database, original: SaleRow, opts: ReversalOptions): D1PreparedStatement[] {
  const received = opts.now.toISOString();
  return [
    db
      .prepare(
        `INSERT INTO sales (id, device_id, method, status, total_cents, sold_at, received_at, business_date,
                            reverses_sale_id, reversal_reason, reversed_by, late)
         VALUES (?1, ?2, ?3, 'paid', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ${LATE})`,
      )
      .bind(
        opts.id,
        opts.deviceId,
        original.method,
        -original.total_cents,
        opts.soldAt,
        received,
        businessDate(opts.soldAt),
        original.id,
        opts.reason,
        opts.by,
      ),
    db
      .prepare(
        `INSERT INTO sale_lines (sale_id, product_id, name, category_id, category_name, unit_price_cents, qty)
         SELECT ?1, product_id, name, category_id, category_name, unit_price_cents, -qty
         FROM sale_lines WHERE sale_id = ?2 ORDER BY id`,
      )
      .bind(opts.id, original.id),
    // Puts back exactly what the sale took, whatever the product's stock setting is today.
    db
      .prepare(
        `INSERT INTO stock_movements (product_id, delta, kind, ref_id, created_at)
         SELECT product_id, -delta, 'reversal', ?1, ?2
         FROM stock_movements WHERE ref_id = ?3 AND kind = 'sale' ORDER BY id`,
      )
      .bind(opts.id, received, original.id),
  ];
}

/** Books the counter-entry of a sale: the same lines with the amounts negated, and the stock put back. */
export async function createReversal(db: D1Database, original: SaleRow, opts: ReversalOptions): Promise<void> {
  await db.batch(reversalStatements(db, original, opts));
}

function saleStatements(
  db: D1Database,
  deviceId: string,
  item: CashSaleInput,
  soldAt: string,
  now: Date,
  products: Map<string, ProductInfo>,
): D1PreparedStatement[] {
  const received = now.toISOString();
  const statements = [
    db
      .prepare(
        `INSERT INTO sales (id, device_id, method, status, total_cents, cash_given_cents, sold_at, received_at, business_date, late)
         VALUES (?1, ?2, 'cash', 'paid', ?3, ?4, ?5, ?6, ?7, ${LATE})`,
      )
      .bind(item.id, deviceId, item.totalCents, item.cashGivenCents, soldAt, received, businessDate(soldAt)),
  ];
  for (const line of item.lines) {
    const product = products.get(line.productId)!;
    // Name and price are the ones the customer saw; the category is the product's.
    statements.push(
      db
        .prepare(
          `INSERT INTO sale_lines (sale_id, product_id, name, category_id, category_name, unit_price_cents, qty)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(item.id, line.productId, line.name, product.category_id, product.category_name, line.unitPriceCents, line.qty),
    );
    if (product.track_stock === 1) {
      statements.push(
        db
          .prepare("INSERT INTO stock_movements (product_id, delta, kind, ref_id, created_at) VALUES (?, ?, 'sale', ?, ?)")
          .bind(line.productId, -line.qty, item.id, received),
      );
    }
  }
  return statements;
}

/** The row an accepted item is about to become, so that later items in the same request can refer to it. */
function pendingRow(id: string, deviceId: string, totalCents: number, soldAt: string, now: Date, reverses: string | null): SaleRow {
  return {
    id,
    device_id: deviceId,
    method: "cash",
    status: "paid",
    total_cents: totalCents,
    cash_given_cents: null,
    sold_at: soldAt,
    received_at: now.toISOString(),
    business_date: businessDate(soldAt),
    reverses_sale_id: reverses,
    reversal_reason: null,
    reversed_by: reverses ? "device" : null,
    late: 0,
    handover_id: null,
  };
}

function judgeSale(db: D1Database, deviceId: string, item: CashSaleInput, now: Date, known: Known): Verdict {
  if (known.sales.has(item.id)) return { duplicate: true };
  const sum = item.lines.reduce((total, line) => total + line.unitPriceCents * line.qty, 0);
  if (sum !== item.totalCents) return { reject: "total_mismatch" };
  // A product hidden in beheer still counts: the customer has already paid for it.
  if (item.lines.some((line) => !known.products.has(line.productId))) return { reject: "unknown_product" };
  const soldAt = storedSoldAt(item.soldAt, now);
  return {
    statements: saleStatements(db, deviceId, item, soldAt, now, known.products),
    row: pendingRow(item.id, deviceId, item.totalCents, soldAt, now, null),
  };
}

function judgeReversal(db: D1Database, deviceId: string, item: ReversalInput, now: Date, known: Known): Verdict {
  if (known.sales.has(item.id)) return { duplicate: true };
  const original = known.sales.get(item.reversesSaleId);
  if (!original) return { reject: "original_not_found" };
  if (original.device_id !== deviceId) return { reject: "other_device" };
  if (original.method !== "cash") return { reject: "not_cash" };
  if (original.reverses_sale_id !== null || known.reversed.has(original.id)) return { reject: "already_reversed" };
  const soldAt = storedSoldAt(item.soldAt, now);
  if (Date.parse(soldAt) - Date.parse(original.sold_at) > REVERSAL_WINDOW_MS) return { reject: "too_late" };
  return {
    statements: reversalStatements(db, original, { id: item.id, soldAt, by: "device", reason: null, deviceId, now }),
    row: pendingRow(item.id, deviceId, -original.total_cents, soldAt, now, original.id),
  };
}

async function loadSales(db: D1Database, ids: string[]): Promise<SaleRow[]> {
  if (ids.length === 0) return [];
  const marks = ids.map(() => "?").join(", ");
  const { results } = await db
    .prepare(`SELECT * FROM sales WHERE id IN (${marks})`)
    .bind(...ids)
    .all<SaleRow>();
  return results;
}

/** Reads everything the items of one request refer to in a fixed, small number of queries. */
async function loadKnown(db: D1Database, items: OutboxItem[]): Promise<Known> {
  const ids = [...new Set(items.map((item) => item.id))];
  const targets = [...new Set(items.flatMap((item) => (item.kind === "reversal" ? [item.reversesSaleId] : [])))];
  const hasSales = items.some((item) => item.kind === "sale");
  const [products, existing, originals, reversals] = await Promise.all([
    hasSales
      ? db
          .prepare(
            `SELECT p.id, p.category_id, c.name AS category_name, p.track_stock
             FROM products p JOIN categories c ON c.id = p.category_id`,
          )
          .all<ProductInfo>()
          .then((result) => result.results)
      : [],
    loadSales(db, ids),
    loadSales(db, targets),
    targets.length > 0
      ? db
          .prepare(`SELECT reverses_sale_id FROM sales WHERE reverses_sale_id IN (${targets.map(() => "?").join(", ")})`)
          .bind(...targets)
          .all<{ reverses_sale_id: string }>()
          .then((result) => result.results)
      : [],
  ]);
  return {
    products: new Map(products.map((product) => [product.id, product])),
    sales: new Map([...existing, ...originals].map((sale) => [sale.id, sale])),
    reversed: new Set(reversals.map((reversal) => reversal.reverses_sale_id)),
  };
}

/** What a failed write means when another request got there first; null for any other failure. */
function lostRace(id: string, error: unknown): ItemResult | null {
  const message = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint failed: sales\.id\b/.test(message)) return { id, status: "duplicate" };
  if (message.includes("UNIQUE constraint failed: sales.reverses_sale_id")) {
    return { id, status: "rejected", reason: "already_reversed" };
  }
  return null;
}

/**
 * Takes in the sales and reversals of one request from the kassa. One result per item, in order.
 * An item is stored exactly once, however often it is sent, and a bad item never holds up the others.
 *
 * The free Cloudflare plan allows 50 database calls per request, so this reads what it needs in a few
 * queries and writes all accepted items in one batch.
 */
export async function ingestItems(db: D1Database, deviceId: string, items: unknown[], now: Date): Promise<ItemResult[]> {
  const parsed = items.map((raw) => outboxItem.safeParse(raw));
  const known = await loadKnown(
    db,
    parsed.flatMap((result) => (result.success ? [result.data] : [])),
  );

  const results: ItemResult[] = [];
  const accepted: { index: number; id: string; statements: D1PreparedStatement[] }[] = [];
  parsed.forEach((result, index) => {
    if (!result.success) {
      const rawId = (items[index] as { id?: unknown } | null)?.id;
      results.push({ id: typeof rawId === "string" ? rawId : "", status: "rejected", reason: "invalid" });
      return;
    }
    const item = result.data;
    const verdict =
      item.kind === "sale" ? judgeSale(db, deviceId, item, now, known) : judgeReversal(db, deviceId, item, now, known);
    if ("duplicate" in verdict) {
      results.push({ id: item.id, status: "duplicate" });
    } else if ("reject" in verdict) {
      results.push({ id: item.id, status: "rejected", reason: verdict.reject });
    } else {
      results.push({ id: item.id, status: "accepted" });
      accepted.push({ index, id: item.id, statements: verdict.statements });
      known.sales.set(item.id, verdict.row);
      if (verdict.row.reverses_sale_id) known.reversed.add(verdict.row.reverses_sale_id);
    }
  });
  if (accepted.length === 0) return results;

  try {
    await db.batch(accepted.flatMap((entry) => entry.statements));
  } catch {
    // Nothing was written. Most likely another request stored one of these items a moment ago:
    // write them one at a time, so that only that item is turned away.
    for (const entry of accepted) {
      try {
        await db.batch(entry.statements);
      } catch (error) {
        const outcome = lostRace(entry.id, error);
        if (!outcome) throw error;
        results[entry.index] = outcome;
      }
    }
  }
  return results;
}
