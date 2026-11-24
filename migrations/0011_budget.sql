-- The begroting: per year and per income or expense account a rule for its twelve months, in whole euros. It is a
-- plan next to the books: it never changes a booking, and nothing in the kassa or the ledger reads it.
-- `rule` is the JSON of a BudgetRule (shared/budget.ts). `base` is the JSON of the twelve months (cents) of the year
-- the line was proposed from, or NULL; `months` is the JSON of the twelve months (cents) the rule gives, worked out
-- by the Worker.
CREATE TABLE budget_lines (
  year INTEGER NOT NULL,
  account_code TEXT NOT NULL REFERENCES ledger_accounts(code),
  rule TEXT NOT NULL,
  base TEXT,
  months TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (year, account_code)
);

-- Where a year's proposal came from: e-Boekhouden's mutations of `base_year` (from `base_from` to `base_to`), the
-- books of `base_year`, or nothing.
CREATE TABLE budget_sources (
  year INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('mutations','ledger','empty')),
  base_year INTEGER,
  base_from TEXT,
  base_to TEXT,
  created_at TEXT NOT NULL
);
