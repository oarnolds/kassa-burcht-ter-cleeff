/** Everything the kassa has recorded, as raw rows. Logins and device tokens are deliberately left out. */
export type ExportFile = {
  exportedAt: string;
  categories: unknown[];
  products: unknown[];
  sales: unknown[];
  saleLines: unknown[];
  handovers: unknown[];
  stockOrders: unknown[];
  stockOrderLines: unknown[];
  stockMovements: unknown[];
};

/**
 * Removes what was entered while trying the kassa out: sales, handovers, orders and stock movements.
 * Products, categories, the paired iPad and the beheer login stay.
 */
export async function wipeTrialData(db: D1Database): Promise<void> {
  // Children before parents; all or nothing.
  await db.batch(
    ["sale_lines", "sales", "handovers", "stock_order_lines", "stock_orders", "stock_movements"].map((table) =>
      db.prepare(`DELETE FROM ${table}`),
    ),
  );
}

export async function exportAll(db: D1Database, now: Date): Promise<ExportFile> {
  const [categories, products, sales, saleLines, handovers, stockOrders, stockOrderLines, stockMovements] = await db.batch([
    db.prepare("SELECT * FROM categories ORDER BY sort, id"),
    db.prepare("SELECT * FROM products ORDER BY sort, id"),
    db.prepare("SELECT * FROM sales ORDER BY sold_at, id"),
    db.prepare("SELECT * FROM sale_lines ORDER BY id"),
    db.prepare("SELECT * FROM handovers ORDER BY counted_at, id"),
    db.prepare("SELECT * FROM stock_orders ORDER BY created_at, id"),
    db.prepare("SELECT * FROM stock_order_lines ORDER BY id"),
    db.prepare("SELECT * FROM stock_movements ORDER BY id"),
  ]);
  return {
    exportedAt: now.toISOString(),
    categories: categories!.results,
    products: products!.results,
    sales: sales!.results,
    saleLines: saleLines!.results,
    handovers: handovers!.results,
    stockOrders: stockOrders!.results,
    stockOrderLines: stockOrderLines!.results,
    stockMovements: stockMovements!.results,
  };
}
