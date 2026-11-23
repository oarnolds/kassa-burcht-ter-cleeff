-- The boekhouding: a double-entry ledger next to the kassa. It reads the kassa's tables and never writes them.
-- Every entry's lines sum to 0 (debit positive, credit negative, integer cents). Dates are Amsterdam `YYYY-MM-DD`.
-- Nothing is deleted: an entry is emptied, and its history stays.

-- `formerly` is a JSON array of the e-Boekhouden numbers the account takes over.
CREATE TABLE ledger_accounts (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('asset','liability','equity','expense','income')),
  money INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL,
  formerly TEXT NOT NULL DEFAULT '[]'
);

-- A year gets its row when the first entry for it is written; nothing in a closed year changes.
CREATE TABLE ledger_years (
  year INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('open','closed')),
  closed_at TEXT,
  close_note TEXT
);

-- An entry made by the app carries its source and a reference within it (a day, a handover, a bank line),
-- so that a sync finds and replaces its own entry instead of writing a second one.
CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL REFERENCES ledger_years(year),
  number INTEGER NOT NULL,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual','opening','bank','kassa_day','kassa_late','handover','mollie_other','mollie_settlement','depreciation','disposal','closing')),
  source_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (year, number),
  UNIQUE (source, source_ref)
);

CREATE TABLE ledger_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id TEXT NOT NULL REFERENCES ledger_entries(id),
  account_code TEXT NOT NULL REFERENCES ledger_accounts(code),
  amount_cents INTEGER NOT NULL,
  note TEXT,
  asset_id TEXT
);

CREATE INDEX ledger_lines_by_account ON ledger_lines(account_code);
CREATE INDEX ledger_lines_by_entry ON ledger_lines(entry_id);

-- Every change the penningmeester makes to an entry: when, what it was and what it became.
CREATE TABLE ledger_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id TEXT NOT NULL REFERENCES ledger_entries(id),
  at TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT NOT NULL
);

CREATE INDEX ledger_history_by_entry ON ledger_history(entry_id);

CREATE TABLE ledger_year_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL REFERENCES ledger_years(year),
  at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('closed','reopened')),
  note TEXT
);
