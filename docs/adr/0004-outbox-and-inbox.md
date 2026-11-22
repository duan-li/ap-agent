# Bind callbacks and postings to separate keys

Bind a callback delivery ID to its request hash. Persist an approved outbox intent and send it with a receiver-recognised idempotency key. Reconcile an in-flight key before another send.

## Context

An approval can be redelivered. An ERP can commit a post before the worker receives its receipt. The local transaction cannot cover both stores.

## Consequences

Replay preserves the original effective action. An unavailable lookup can require AP reconciliation. The receiver must retain its keys and receipts.
