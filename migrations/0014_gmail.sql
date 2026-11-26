-- The Gmail link for "Zoek bijlage". The state sent to Google is used once; the refresh token is a secret kept only
-- here: never sent to the browser, never logged, and never in a copy (the table is not in maintenance.ts LEDGER_TABLES).
-- 'expired': Google no longer accepts the token, so the penningmeester links again. Unlinking empties the token.
CREATE TABLE gmail_links (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'expired', 'replaced')),
  email TEXT,
  refresh_token TEXT,
  created_at TEXT NOT NULL,
  used_at TEXT
);
