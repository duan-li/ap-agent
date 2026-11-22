# Build log

One line per working session, added as you go. The README's AI-use section is copied from this file.

| Date | Milestone | What changed | AI tool used, and for what |
|---|---|---|---|
| 2026-11-22 | Design | TECH.md frozen; PLAN.md agreed; test data pack v3 generated and verified | Claude: design review, test data generation, plan drafting |
| 2026-11-22 | M0 | Added contracts, deterministic adapters, fixture tests and the offline case ratchet. All 27 workflows report NotImplemented. Four red-line IDs await human-authored tests before tagging. | Codex implemented and verified the skeleton. |
| 2026-11-22 | M0 acceptance review | Kept the default lint rules and deferred CI to M5 under the M0 cut rule. Isolated case execution failures in the evaluator. Node 22.23.5 checks passed with all 27 workflows red and the ratchet empty. | Codex checked the report, fixed the evaluator and verified the ratchet. |
| 2026-11-22 | M0 | With owner approval, brought the ApService type signatures forward from M1 for the human-authored red-line tests. | Codex defined the interface and checked all four calls with the TypeScript compiler. |
| 2026-11-22 | M0 | Added all four red-line test bodies against ApService. The service and store wiring starts in M1. | None: the owner wrote the assertions by hand. |
| 2026-11-22 | M0 | Strengthened the four red-line assertions after an acceptance review found gaps in RL-001, RL-002, RL-003 and RL-004. Reviewed and approved by the owner. See D-4. | Claude, at the owner's request: reviewed the assertions, rewrote them and checked them against correct and deliberately broken stub services. |
| 2026-11-22 | M1 | FIN-001 review, persisted approval and ERP posting through the CLI. Verified the refusal for u-201, both M1 red lines and seven retrieval queries on Node 22. Live Anthropic smoke test deferred to M5 because the environment lacked an API key. | Codex implemented the layers, tests and eval wiring. |
| 2026-11-22 | M1 review | Applied the M1 confidence cut. Confidence uses evidence completeness alone. A fully documented price variance can produce a high-confidence hold. Tool failure history and fuzzy matches are deferred as separate confidence inputs. Added the CLI entry point contract and removed the orchestrator's dependency on Application. | Codex corrected the implementation, documented the SQLite driver choice and verified the CLI and offline evaluation. |
