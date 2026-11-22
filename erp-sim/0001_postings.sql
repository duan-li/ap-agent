CREATE TABLE erp_postings (
 idempotency_key TEXT PRIMARY KEY, vendor_id TEXT NOT NULL, invoice_no_normalised TEXT NOT NULL,
 finance_action TEXT NOT NULL, amount TEXT NOT NULL, currency TEXT NOT NULL,
 posting_ref TEXT NOT NULL, received_at TEXT NOT NULL, UNIQUE(vendor_id,invoice_no_normalised)
);
