-- Kassa Burcht ter Cleeff: all tables.
-- Booleans are INTEGER 0/1. All *_at columns are UTC ISO 8601 strings. Money is integer cents.

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  sort INTEGER NOT NULL
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  category_id TEXT NOT NULL REFERENCES categories(id),
  sort INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  quantity_pad INTEGER NOT NULL DEFAULT 0,
  track_stock INTEGER NOT NULL DEFAULT 0,
  units_per_box INTEGER,
  reorder_at INTEGER,
  updated_at TEXT NOT NULL
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT
);

CREATE TABLE handovers (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('opening','handover')),
  counted_at TEXT NOT NULL,
  expected_cents INTEGER NOT NULL,
  received_cents INTEGER NOT NULL,
  left_cents INTEGER NOT NULL,
  difference_cents INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

-- A reversal is a sale row of its own with negative amounts and reverses_sale_id set.
CREATE TABLE sales (
  id TEXT PRIMARY KEY,
  device_id TEXT REFERENCES devices(id),
  method TEXT NOT NULL CHECK (method IN ('cash','pin')),
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','pending','failed')),
  total_cents INTEGER NOT NULL,
  cash_given_cents INTEGER,
  sold_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  business_date TEXT NOT NULL,
  reverses_sale_id TEXT REFERENCES sales(id),
  reversal_reason TEXT,
  reversed_by TEXT CHECK (reversed_by IN ('device','admin')),
  late INTEGER NOT NULL DEFAULT 0,
  handover_id TEXT REFERENCES handovers(id)
);

CREATE UNIQUE INDEX sales_one_reversal ON sales(reverses_sale_id) WHERE reverses_sale_id IS NOT NULL;

CREATE INDEX sales_by_date ON sales(business_date);

-- Name, category and price are copied at the moment of sale, so later changes leave old figures alone.
CREATE TABLE sale_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category_id TEXT NOT NULL,
  category_name TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  qty INTEGER NOT NULL
);

CREATE INDEX sale_lines_by_sale ON sale_lines(sale_id);

CREATE TABLE stock_orders (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('open','received','cancelled')),
  note TEXT,
  created_at TEXT NOT NULL,
  received_at TEXT,
  received_by TEXT CHECK (received_by IN ('device','admin'))
);

CREATE TABLE stock_order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES stock_orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  boxes INTEGER NOT NULL DEFAULT 0,
  loose_units INTEGER NOT NULL DEFAULT 0,
  units INTEGER NOT NULL CHECK (units > 0)
);

-- The stock of a product is the sum of its movements.
CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES products(id),
  delta INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('delivery','sale','reversal','count')),
  ref_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX stock_movements_by_product ON stock_movements(product_id);

CREATE TABLE admin (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE pairing_codes (
  code_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE auth_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
