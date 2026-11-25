-- The books start on 1 January 2026, so 2026 is the first year; 0006 only seeded 2027.
INSERT OR IGNORE INTO ledger_years (year, status) VALUES (2026, 'open');

-- A toestellen list pasted before this version holds each toestel as it stood on 31 December 2026 (cost and written
-- off up to then); the opening of 2026 needs its state of 1 January 2026, and nothing else would notice. While this key
-- is there, the Overzicht and Toestellen ask him to paste "Vaste activa 2026" again; the next paste deletes it. Only
-- when pasted toestellen exist (a toestel bought later has no cost of its own): on an empty list it sets nothing.
INSERT OR IGNORE INTO ledger_settings (key, value, updated_at)
  SELECT 'assets_repaste_needed', '1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE EXISTS (SELECT 1 FROM assets WHERE cost_cents IS NOT NULL);
