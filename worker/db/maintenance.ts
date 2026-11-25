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
  /** Every table of the boekhouding, by name. The attachment files themselves live in their own bucket. */
  ledger: Record<string, unknown[]>;
};

/** The boekhouding's tables and the order each is written in the copy. */
/** `columns` leaves a secret out of the copy: the bank consent's session id. */
const LEDGER_TABLES: [table: string, order: string, columns?: string][] = [
  ["ledger_accounts", "sort, code"],
  ["ledger_years", "year"],
  ["ledger_entries", "date, id"],
  ["ledger_lines", "entry_id, id"],
  ["ledger_history", "id"],
  ["ledger_year_events", "id"],
  ["ledger_attachments", "id"],
  ["ledger_settings", "key"],
  ["money_accounts", "account_code"],
  ["bank_lines", "id"],
  ["bank_balances", "account_code, date"],
  ["bank_consents", "created_at, id", "id, state, status, account_uid, valid_until, created_at, used_at"],
  ["category_accounts", "category_id"],
  ["comparison_figures", "year, account_code"],
  ["mollie_payments", "paid_date, id"],
  ["mollie_settlements", "id"],
  ["mollie_rules", "sort, id"],
  ["assets", "created_at, id"],
  ["budget_sources", "year"],
  ["budget_lines", "year, account_code"],
];

export const IN_USE_KEY = "in_use_since";
const NOT_IN_USE = `NOT EXISTS (SELECT 1 FROM settings WHERE key = '${IN_USE_KEY}')`;

/** The moment the kassa went into real use, or null while it is still on trial. */
export async function inUseSince(db: D1Database): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?1").bind(IN_USE_KEY).first<{ value: string }>();
  return row?.value ?? null;
}

/**
 * Removes what was entered while trying the kassa out: sales, handovers, orders and stock movements.
 * Products, categories, the paired iPad and the beheer login stay.
 * A `final` wipe is the ingebruikname: it marks the kassa as in use, and from then on nothing is wiped.
 * Returns since when the kassa is in use if it refused.
 */
export async function wipeTrialData(db: D1Database, final: boolean, now: Date): Promise<{ wiped: true } | { wiped: false; inUseSince: string }> {
  const since = await inUseSince(db);
  if (since !== null) return { wiped: false, inUseSince: since };
  // Children before parents; all or nothing. Each statement looks at the mark itself, so that a wipe that
  // crosses the ingebruikname in another request removes nothing.
  await db.batch([
    ...["sale_lines", "sales", "handovers", "stock_order_lines", "stock_orders", "stock_movements"].map((table) =>
      db.prepare(`DELETE FROM ${table} WHERE ${NOT_IN_USE}`),
    ),
    ...(final ? [db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)").bind(IN_USE_KEY, now.toISOString())] : []),
  ]);
  return { wiped: true };
}

export async function exportAll(db: D1Database, now: Date): Promise<ExportFile> {
  const [categories, products, sales, saleLines, handovers, stockOrders, stockOrderLines, stockMovements, ...ledger] = await db.batch([
    db.prepare("SELECT * FROM categories ORDER BY sort, id"),
    db.prepare("SELECT * FROM products ORDER BY sort, id"),
    db.prepare("SELECT * FROM sales ORDER BY sold_at, id"),
    db.prepare("SELECT * FROM sale_lines ORDER BY id"),
    db.prepare("SELECT * FROM handovers ORDER BY counted_at, id"),
    db.prepare("SELECT * FROM stock_orders ORDER BY created_at, id"),
    db.prepare("SELECT * FROM stock_order_lines ORDER BY id"),
    db.prepare("SELECT * FROM stock_movements ORDER BY id"),
    ...LEDGER_TABLES.map(([table, order, columns]) => db.prepare(`SELECT ${columns ?? "*"} FROM ${table} ORDER BY ${order}`)),
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
    ledger: Object.fromEntries(LEDGER_TABLES.map(([table], i) => [table, ledger[i]!.results])),
  };
}
