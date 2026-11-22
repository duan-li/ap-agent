CREATE TABLE runs (
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL, invoice_ref TEXT NOT NULL,
 state TEXT NOT NULL, current_step TEXT NOT NULL, request_json TEXT NOT NULL, result_json TEXT,
 UNIQUE(case_id, invoice_ref)
);
CREATE TABLE steps (
 run_id TEXT NOT NULL REFERENCES runs(id), name TEXT NOT NULL, output_json TEXT NOT NULL,
 PRIMARY KEY(run_id,name)
);
CREATE TABLE events (
 id INTEGER PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), ts TEXT NOT NULL, event_json TEXT NOT NULL
);
CREATE INDEX events_run_time ON events(run_id,ts);
CREATE TABLE approvals (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), required_role TEXT NOT NULL,
 snapshot_json TEXT NOT NULL, snapshot_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED','INVALIDATED')),
 decided_by TEXT, decided_at TEXT, reason TEXT
);
CREATE TABLE outbox (
 idempotency_key TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES runs(id),
 approval_id TEXT NOT NULL REFERENCES approvals(id), finance_action TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('PENDING','SENDING','SENT','CANCELLED','RECONCILE_REQUIRED')),
 posting_ref TEXT
);
