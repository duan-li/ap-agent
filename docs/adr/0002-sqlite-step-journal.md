# SQLite preserves the run between CLI calls

Use Node’s SQLite driver, forward migrations and a unique run/step journal. Keep the ERP in its own file.

## Context

The brief requires restart and resume on a local machine. An external database service would add setup before a reviewer can see the gate.

## Consequences

Crash tests can reopen actual databases and exercise ambiguous external effects. Shared multi-host deployment would require a different store and concurrency testing.
