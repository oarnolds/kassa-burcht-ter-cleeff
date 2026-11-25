-- Entries read in from e-Boekhouden's auditfile carry the source 'eboekhouden'. SQLite cannot change a CHECK, so the table is
-- rebuilt: same columns in the same order, the list extended, every row put back with its id, so lines, history, attachments
-- and bank lines keep pointing at the same entries. The foreign keys are checked when the transaction ends, not at the drop.
-- The rows wait in a copy while the table is made again (create-new and rename leaves the drop's violations standing at the
-- commit); the copy is dropped at the end.
PRAGMA defer_foreign_keys = true;

CREATE TABLE ledger_entries_old AS SELECT * FROM ledger_entries;

DROP TABLE ledger_entries;

CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL REFERENCES ledger_years(year),
  number INTEGER NOT NULL,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual','opening','bank','kassa_day','kassa_late','handover','mollie_other','mollie_settlement','depreciation','disposal','closing','eboekhouden')),
  source_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (year, number),
  UNIQUE (source, source_ref)
);

INSERT INTO ledger_entries SELECT * FROM ledger_entries_old;

DROP TABLE ledger_entries_old;

CREATE INDEX ledger_entries_by_year_date ON ledger_entries(year, date);
CREATE INDEX ledger_entries_by_date ON ledger_entries(date);
