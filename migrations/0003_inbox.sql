ALTER TABLE runs ADD COLUMN lease_owner INTEGER;
ALTER TABLE runs ADD COLUMN lease_until INTEGER;
ALTER TABLE runs ADD COLUMN lease_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN simulation_json TEXT NOT NULL DEFAULT '{}';

-- Reserve the delivery ID before processing. Only a final response is cached.
CREATE TABLE inbox (
  delivery_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0,
  response_json TEXT,
  received_at INTEGER NOT NULL
);
