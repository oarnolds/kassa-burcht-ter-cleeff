-- Mollie in the boekhouding: every paid payment read with the organisation's token, once, and what became of it.
-- `kind`: `kassa` (a pin sale of the kassa; already in its kassa day, only ticked off here), `rule` (booked by a rule
-- on `account_code`, in the day's entry "Mollie overig"), or `line` (no rule fitted: a line on 1030 in Te boeken,
-- `bank_line_id`). A payment is classified once, when it is first stored; changing a rule later does not move it.
-- `booked`: 1 once the payment is in its day entry (rule) or its line is on 1030 (line), written in the same batch;
-- a kassa payment is booked at once. Every run takes up the days of the payments still at 0, so a night that stops
-- half way leaves nothing behind, whatever their date.
CREATE TABLE mollie_payments (
  id TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  description TEXT NOT NULL,
  paid_date TEXT NOT NULL,
  settlement_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('kassa','rule','line')),
  account_code TEXT REFERENCES ledger_accounts(code),
  bank_line_id TEXT REFERENCES bank_lines(id),
  booked INTEGER NOT NULL DEFAULT 0 CHECK (booked IN (0, 1)),
  CHECK ((kind = 'rule') = (account_code IS NOT NULL))
);

CREATE INDEX mollie_payments_by_date ON mollie_payments(paid_date, kind);
CREATE INDEX mollie_payments_open ON mollie_payments(paid_date) WHERE booked = 0;

-- Mollie's payouts to ING, with the reference that is also on the bank statement and the costs Mollie kept.
CREATE TABLE mollie_settlements (
  id TEXT PRIMARY KEY,
  reference TEXT UNIQUE,
  status TEXT NOT NULL,
  settled_at TEXT,
  amount_cents INTEGER NOT NULL,
  costs_cents INTEGER NOT NULL
);

-- The penningmeester's rules for the payments of the website and the QR code: the first rule (by `sort`) whose
-- keyword is in the description (case ignored) gives the income account. A rule is settings, not bookkeeping.
CREATE TABLE mollie_rules (
  id TEXT PRIMARY KEY,
  keyword TEXT NOT NULL,
  account_code TEXT NOT NULL REFERENCES ledger_accounts(code),
  sort INTEGER NOT NULL
);
