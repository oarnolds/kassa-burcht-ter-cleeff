-- The speeltoestellen and inventaris (spec §12), the list behind 0130 and 0135.
-- A toestel pasted from e-Boekhouden's "Vaste activa 2026" keeps its purchase date, its cost and what was written
-- off up to 31 December 2026 here; those make 0130 and 0135 of the opening balance. A toestel bought later leaves
-- `purchase_date` and `cost_cents` empty: its cost is what is booked on 0130 for it (ledger_lines.asset_id), its
-- purchase date the date of the first of those lines. What is written off after the start is on 0135, per toestel.
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purchase_date TEXT,
  cost_cents INTEGER,
  residual_cents INTEGER NOT NULL DEFAULT 0 CHECK (residual_cents >= 0),
  life_years INTEGER NOT NULL CHECK (life_years >= 1),
  opening_written_off_cents INTEGER NOT NULL DEFAULT 0,
  disposed_on TEXT,
  created_at TEXT NOT NULL,
  CHECK ((purchase_date IS NULL) = (cost_cents IS NULL))
);

-- The lines of one toestel: its cost, its depreciation and its disposal.
CREATE INDEX ledger_lines_by_asset ON ledger_lines(asset_id) WHERE asset_id IS NOT NULL;
