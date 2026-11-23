-- The consent the penningmeester gives ING, through Enable Banking, to read ING betaal (1010).
-- `state` is the one-time token that goes to the bank and comes back with the browser: it is used once, within
-- 30 minutes (`used_at`). `session_id` is a secret of the bank connection and is never copied into an export.
CREATE TABLE bank_consents (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','expired','replaced')),
  session_id TEXT,
  account_uid TEXT,
  valid_until TEXT,
  created_at TEXT NOT NULL,
  used_at TEXT
);
