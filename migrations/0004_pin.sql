-- Pin payments via Mollie. A pin sale is a row of sales with method 'pin': 'pending' from the moment the
-- kassa asks for it until the server has read Mollie's final word, then 'paid' or 'failed'.
ALTER TABLE sales ADD COLUMN mollie_payment_id TEXT;
ALTER TABLE sales ADD COLUMN mollie_mode TEXT CHECK (mollie_mode IN ('test','live'));
ALTER TABLE sales ADD COLUMN pin_outcome TEXT CHECK (pin_outcome IN ('paid','declined','canceled','expired','start_failed'));
-- Mollie's statusReason code, or the kassa's own: unauthorized, refused, not_found, no_answer, before_start.
ALTER TABLE sales ADD COLUMN pin_reason TEXT;
ALTER TABLE sales ADD COLUMN settled_at TEXT;
-- On a cash sale: the pin sale of the same receipt that had not (or not yet) gone through when cash was taken.
ALTER TABLE sales ADD COLUMN instead_of_sale_id TEXT REFERENCES sales(id);

CREATE UNIQUE INDEX sales_by_mollie_payment ON sales(mollie_payment_id) WHERE mollie_payment_id IS NOT NULL;
CREATE INDEX sales_pending ON sales(sold_at) WHERE status = 'pending';
CREATE INDEX sales_instead_of ON sales(instead_of_sale_id) WHERE instead_of_sale_id IS NOT NULL;
