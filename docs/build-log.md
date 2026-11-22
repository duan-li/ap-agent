# Build log

One line per working session, added as you go. The README's AI-use section is copied from this file.

| Date | Milestone | What changed | AI tool used, and for what |
|---|---|---|---|
| 2026-11-22 | Design | TECH.md frozen; PLAN.md agreed; test data pack v3 generated and verified | Claude: design review, test data generation, plan drafting |
| 2026-11-22 | M0 | Added contracts, deterministic adapters, fixture tests and the offline case ratchet. All 27 workflows report NotImplemented. Four red-line IDs await human-authored tests before tagging. | Codex implemented and verified the skeleton. |
| 2026-11-22 | M0 acceptance review | Kept the default lint rules and deferred CI to M5 under the M0 cut rule. Isolated case execution failures in the evaluator. Node 22.23.5 checks passed with all 27 workflows red and the ratchet empty. | Codex checked the report, fixed the evaluator and verified the ratchet. |
