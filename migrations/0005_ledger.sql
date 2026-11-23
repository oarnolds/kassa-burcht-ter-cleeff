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
  after_json TEXT NOT NULL,
  note TEXT
);

CREATE INDEX ledger_history_by_entry ON ledger_history(entry_id);

CREATE TABLE ledger_year_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL REFERENCES ledger_years(year),
  at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('closed','reopened')),
  note TEXT
);

-- The boekhouding's own settings (never the kassa's `settings`): e.g. the equity e-Boekhouden shows, to display the difference.
CREATE TABLE ledger_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A receipt or photo with an entry. The file lives in its own R2 bucket and is never deleted; hiding only sets `hidden_at`.
CREATE TABLE ledger_attachments (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES ledger_entries(id),
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL,
  hidden_at TEXT
);

CREATE INDEX ledger_attachments_by_entry ON ledger_attachments(entry_id);

-- Where each money account's lines come from, and what the app knows the account by in a bank file or at
-- Enable Banking: an IBAN, or for a savings account its number (the ING kwartaalrekening's starts with V).
-- 1000 follows the kassa and 1030 Mollie; the banks are read from a file (or typed) or fetched by Enable Banking.
CREATE TABLE money_accounts (
  account_code TEXT PRIMARY KEY REFERENCES ledger_accounts(code),
  identifier TEXT,
  source TEXT NOT NULL CHECK (source IN ('file','enable_banking','kassa','mollie'))
);

-- A line on a bank account, read once: from a file, from Enable Banking, typed by hand, or a Mollie payment.
-- `content_key` is the hash of account, booking date, amount, the other party's IBAN and how many equal lines
-- came before it, so that the same line from another road is known even without the bank's reference.
-- A line stays: booked, it points to its entry.
CREATE TABLE bank_lines (
  id TEXT PRIMARY KEY,
  account_code TEXT NOT NULL REFERENCES money_accounts(account_code),
  booking_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  counterparty_name TEXT,
  counterparty_iban TEXT,
  description TEXT NOT NULL,
  bank_ref TEXT,
  content_key TEXT NOT NULL UNIQUE,
  origin TEXT NOT NULL CHECK (origin IN ('file','enable_banking','typed','mollie')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','booked','waiting')),
  waiting_for TEXT CHECK (waiting_for IN ('mollie')),
  note TEXT,
  entry_id TEXT REFERENCES ledger_entries(id),
  imported_at TEXT NOT NULL
);

CREATE UNIQUE INDEX bank_lines_by_ref ON bank_lines(account_code, bank_ref) WHERE bank_ref IS NOT NULL;
CREATE INDEX bank_lines_by_date ON bank_lines(account_code, booking_date);

-- What the bank said a money account held at the end of a day, to lay next to the ledger on that day.
CREATE TABLE bank_balances (
  account_code TEXT NOT NULL REFERENCES money_accounts(account_code),
  date TEXT NOT NULL,
  balance_cents INTEGER NOT NULL,
  origin TEXT NOT NULL,
  PRIMARY KEY (account_code, date)
);
