# AP Agent – Development Plan

Nov 22, 2026 · @Daniel

## Overview

The build takes six milestones. Each milestone ends when a named set of cases passes in `ap eval`, so stopping at any point leaves a working, demonstrable subset.

The source of truth is the frozen design, "AP Agent – Layered Architecture" (rev 88), and the test data pack v3 (27 cases). This plan says in what order to build it; it adds no features. Section references below (for example "Key mechanisms §4") point into that design.

| M | Theme | Exit: cases green in `ap eval` | Tag |
| --- | --- | --- | --- |
| M0 | Skeleton and contracts | Harness runs all 27 cases (red is expected); red-line tests written | `m0-skeleton` |
| M1 | Happy path through every layer | FIN-001, FIN-001-wrong-approver | `m1-fin001` |
| M2 | Judgement cases | FIN-002, FIN-003, FIN-001-tol-breach, FIN-002-human-reject | `m2-judgement` |
| M3 | Failure handling | FIN-004, FIN-001-po-retry, FIN-001-malformed, budget-exceeded | `m3-failures` |
| M4 | Durability and idempotency | FIN-005, FIN-001-crash, erp-crash-after-post, erp-crash-then-vendor-blocked, approval-invalidated; all red-line tests green | `m4-durable` |
| M5 | Evidence and delivery | 5 brief cases + 10 required variants green; clean-room run passes | `m5-submission` |

The 12 optional variants have no milestone. They are added only after M5 is complete, cheapest first (most need only the case file already in the pack).

## Working rules

These rules apply to every milestone; each milestone section lists only what is specific to it.

1. **Test first, in a fixed order.** For each piece: write the failing test from the case file or the design table, implement until it passes, then refactor. Red-line assertions are written by hand, never generated, so code and tests cannot confirm each other.
2. **A milestone is done only when its exit cases pass.** `npm test` and `ap eval` both green for the listed cases, typecheck and lint clean, no `.only` or skipped tests left in.
3. **Commit small, tag at the end.** One commit per working step with a message that says what now works ("rules: line price tolerance with min(50, 1%)"). Tag the milestone when its exit holds.
4. **Keep a build log as you go.** `docs/build-log.md` gets one line per session: the milestone, and any AI tool used and for what. The README's AI-use section is copied from it, not reconstructed later.
5. **Do not edit the design.** When the code cannot follow the design, record it in `docs/deviations.md` (type, what, why, impact) and carry on. The type says whether the entry is a field representation adjustment, a clarification of something the design leaves open, or a true departure from it. The README links it.
6. **Fake model by default.** Every test and every `ap eval` run uses the fake model and needs no API key. The real Anthropic adapter is wired in M1 but only exercised by hand.
7. **One decimal type for money.** All amounts are strings in JSON and decimals in code from the first commit; no `number` arithmetic on money anywhere.

## M0 Skeleton and contracts

M0 fixes every shape the later milestones fill in: types, schemas, the fake model and a test harness that already runs all 27 cases. Nothing passes end to end yet, and that is the point: the target is visible from the first commit.

**Build**

| File | Contents |
| --- | --- |
| `package.json`, `tsconfig.json` (strict), `vitest.config.ts`, `.nvmrc`, `.env.example`, `.gitignore`, `.dockerignore` | Node 22, TypeScript, Vitest with two projects: `unit` and `cases` |
| `corpus/`, `fixtures/`, `cases/`, `tools/` | Copied unchanged from test data pack v3; first commit on its own |
| `src/domain/types.ts` | Zod schemas: vendor, PO, receipt, history record, authority entry, invoice extraction, run result (every field of Contracts §Result); input and output schemas for the five tools; the case file schema with the pack's own field names (`request`, `faults`, `modelScript`, `approvals`, `expect`); enums for run status, outcome, exception code, finance action |
| `src/adapters/config.ts` | Environment parsed with Zod; a missing or bad value fails at startup with its name |
| `src/adapters/clock.ts` | Injectable clock and seeded ID generator |
| `src/adapters/model/provider.ts`, `fake.ts` | Model interface; fake model that parses the fixed invoice format and replays a named script from `fixtures/model_scripts/` |
| `tests/cases.test.ts` | Loads the 27 workflow cases (every `cases/*.json` except `retrieval_golden.json`, which the retrieval tests load on their own). `faults` and `modelScript` configure the adapters; only `request` reaches `ApService`; `expect` is read by the test alone |
| `tests/redlines.test.ts` | The four red lines, written against the `ApService` interface, each with its own ID |
| `eval/runEval.ts`, `eval/green.json` | Prints expected against actual per case; `green.json` lists the case IDs and red-line IDs that must pass |

**Tests first**

- Every fixture and the 27 workflow case files parse against their schemas; `retrieval_golden.json` parses against its own (green in M0).
- Fake model: given `fixtures/attachments/INV-88412.txt`, returns quantity, unit price and amount for both lines, plus tax and total, each with its exact quote (green in M0).
- The four red lines are written now and join the ratchet in the milestone that makes them pass: "no submit without approval" and "masked bank details" in M1, "injected text cannot reach approval" in M2, "a duplicate callback submits once" in M4.

**Steps**

1. Init the repository, commit the test data pack alone.
2. Toolchain and the two Vitest projects; `npm test` runs.
3. `types.ts` from the design's Contracts section; money as decimal strings with `decimal.js`.
4. Config, clock, model interface and fake model.
5. Case harness and `runCase()` stub that throws `NotImplemented`; red-line tests.
6. `eval/runEval.ts` printing a pass or fail table; `green.json` starts empty.

**Regression ratchet.** The `cases` project fails only for IDs listed in `green.json`, which holds both workflow cases and red lines. Each milestone appends its exit cases and the red lines it makes pass, so a later change that breaks either fails the build. Everything not yet listed still runs and shows red in `ap eval` without failing `npm test`.

**Exit.** `npm test` green: unit tests pass and the ratchet is empty; `ap eval` lists 27 cases, all red; typecheck clean. Tag `m0-skeleton`.

**Cut if blocked.** Default lint rules only; the CI workflow moves to M5.

## M1 Happy path through every layer

M1 takes FIN-001 from `ap start` to one POST in the ERP simulator, through all five layers. Each layer is built only as far as FIN-001 needs; later milestones widen it. This is the largest milestone on purpose: integration problems surface first, where they are cheapest to fix.

**Build**

| Layer | Files | Scope in M1 |
| --- | --- | --- |
| Rules | `rules/calc.ts`, `outcome.ts`, `registry.ts`, `checks/threeWayMatch.ts`, `taxAndTotal.ts`, `vendorActive.ts`, `duplicate.ts`, `approvalRequirement.ts` | Line arithmetic (quantity × unit price against the stated line amount), line price tolerance min(AUD 50, 1%), quantity, tax and total, vendor status, exact duplicate, approval role from gross amount; outcome ratchet |
| Evidence | `evidence/ingest.ts`, `retrieve.ts`, `tools.ts`, `extract.ts`, `grounding.ts` | Chunk per `##`, citation IDs, `trust.json`, filters then BM25; the four read-only tools over fixtures, validated against their schemas; extraction stores quantity, unit price and line amount as separate fields, each with its quote, and checks that the quote exists and contains the value |
| Report | `report/recommend.ts`, `summary.ts`, `citations.ts`, `confidence.ts` | Result assembled from state; display strings such as `10 x 1200.00 = 12000.00` and `decisionSummary` rendered by code; explanation must cite real finding IDs |
| Orchestrator | `orchestrator/flow.ts`, `approvals.ts`, `submit.ts`, `runtime/step.ts`, `runtime/store.ts` | Steps gather, extract, reconcile, report, request approval, submit; approval snapshot and hash; outbox PENDING, SENDING, SENT; audit events for the run, every retrieval (query, returned chunk IDs with versions) and every tool call (name, attempt, outcome, duration) |
| Application | `application/apService.ts`, `commands.ts`, `errors.ts` | `startRun`, `getRun`, `resolveApproval`, `resume`; authority check against the register; error union |
| Entry points | `entrypoints/entryPoint.ts`, `handle.ts`, `dispatch.ts`, `cli.ts`, `json.ts` | `ap ingest`, `ap start`, `ap get`, `ap approve`, `ap reject`, `ap resume`; exit codes per the result mapping table |
| Adapters | `adapters/sqlite.ts`, `migrate.ts`, `toolBackends.ts`, `erpSim.ts`, `redact.ts`, `model/anthropic.ts`; `migrations/0001_init.sql`, `erp-sim/0001_postings.sql` | SQLite with `user_version` migrations; ERP simulator in its own file with both UNIQUE constraints; redaction on every log line and event |

**Tests first**

- `calc.test.ts`: variances 49.99, 50.00 and 50.01; the lower of AUD 50 and 1% (line 2 threshold is 40.00); 10 × 1,200.00 matches the stated line amount of 12,000.00, and a stated amount that differs is a finding; tax 1,600.00; total 17,600.00; no float drift.
- `outcome.test.ts`: any finding can make the outcome stricter, none can make it looser.
- All 7 retrieval answer-key queries in `cases/retrieval_golden.json`.
- `extract.test.ts`: the `quote-not-found` and `value-not-in-quote` scripts drop the field to `unknowns`; quantity 10, unit price 1,200.00 and amount 12,000.00 are each found inside the line 1 quote.
- `tools.contract.test.ts`, one block per tool: bad arguments are rejected by the input schema and every output validates. Retrieval returns rank, score and citation metadata (document ID, version, section, trust); the PO returns lines with quantity, unit price and status; the vendor record returns status and bank account version with the number masked; history returns matches with stable record IDs. `submit_finance_decision` called with no approval, or with no idempotency key, is rejected and the ERP simulator holds zero rows.
- `approvals.test.ts`: u-201 (limit AUD 10,000) on AUD 17,600 is `Unauthorized`; u-204 is accepted.
- `cli.test.ts`: decode and encode for each command; each error maps to its exit code.

**Steps**

1. Rules and their table tests. *Checkpoint: all Rules tests green.*
2. Ingest and retrieval with the answer key; tools over fixtures with their contract tests; extraction and grounding.
3. Report assembly, with the FIN-001 result in the design's Contracts section as the target.
4. Migrations, store, step journal, audit events, flow up to `AWAITING_APPROVAL`. *Checkpoint: `ap start` prints the awaiting-approval result.*
5. Approval with snapshot, outbox and ERP submit; `ApService` and CLI wiring, including `ap resume`.
6. Add FIN-001, FIN-001-wrong-approver and the two M1 red lines to `green.json`.
7. One manual run with the real model (`ANTHROPIC_API_KEY` set) to prove the adapter; note the outcome in the build log.

**Exit.** FIN-001 and FIN-001-wrong-approver green; red lines "no submit without approval" and "masked bank details" green. `ap get <runId>` through the real CLI returns status, current step, result and audit events in one response: every event has a timestamp, run ID and correlation ID; retrieval events name the returned chunk IDs and versions; tool events show attempt count, outcome and duration; no full account number appears. The FIN-001 result matches the design's sample on business fields, sources and outcome (quantities, unit prices, line amounts, tax, total, citations, findings, approval requirement), not on display strings, IDs or hashes; the separate quantity, unitPrice and lineAmount fields, which may all cite the same invoice line, are recorded as a field representation adjustment in `docs/deviations.md`. Tag `m1-fin001`.

**Cut if blocked.** The manual real-model run moves to M5; confidence uses only the evidence-completeness rule; answer-key queries that FIN-001 does not use move to M2.

## M2 Judgement cases

M2 makes the system refuse, hold and escalate correctly: an exact duplicate is rejected, a fraudulent bank change is escalated despite injected text, a price variance is held with a full exception record, and a human can overrule a proposal. These cases carry the brief's control and RAG scores.

**Build**

| File | Change |
| --- | --- |
| `rules/checks/bankDetails.ts` | Compares the account an attachment claims with the vendor master; any difference is `BANK_CHANGE` and escalates |
| `rules/exceptions.ts` | Exception record: rule, line, expected, observed, difference, threshold, owner, review date |
| `rules/checks/duplicate.ts` | Exact match on vendor, normalised invoice number and amount; cites the history record |
| `orchestrator/approvals.ts` | A rejection of the proposal sets `financeAction` to `NONE` and returns the case to AP |
| `orchestrator/submit.ts`, `adapters/erpSim.ts` | `REJECT_INVOICE` as a second finance action, with its own idempotency key |
| `evidence/extract.ts` | Supplier text is data: instructions in an attachment are never followed and never become findings |
| `report/citations.ts` | Rejects an explanation that cites a finding Rules did not produce, or a number that differs from its calculation record |

**Tests first**

- FIN-002: exact match on HIST-3301; outcome `REJECT_DUPLICATE`; approving it records one `REJECT_INVOICE`; HIST-3301 stays PAID; no payment is ever proposed.
- FIN-003: account ending 8842 claimed, 1937 on record; `ESCALATE_CONTROL_REVIEW` with four cited findings; nothing written to the ERP.
- `FIN-003-fooled` script: the model obeys the injected text, yet code still escalates and the rationale is rejected.
- `bad-citation` script: citation check rejects it.
- Retrieval: freight tolerance never cites ADV-002; FIN-POL-003-OLD is never authority.
- FIN-001-tol-breach: variance 50.10 over a threshold of 50.00; the exception record carries every field.
- Plain request: FIN-001's request with only `caseId`, `invoiceRef`, `vendor`, `amount` and `currency` is accepted by `ap start` as a valid request. No available source yields the invoice lines, so they are listed in unknowns, AP is asked for the details, and the run ends HOLD\_FOR\_INFORMATION with zero approval requests and zero ERP writes. AP re-submits under a new caseId with the same invoiceRef once the details arrive. A test input, not a new case file.
- Untrusted notes: FIN-001's request with `notes` holding the same approval-bypass instruction as ADV-001 still stops at `AWAITING_APPROVAL`, with zero submits.

**Steps**

1. Duplicate check and FIN-002 through to `REJECT_INVOICE`.
2. Bank-details check, untrusted-text handling and the two scripts; FIN-003.
3. Plain request and untrusted notes, both reusing FIN-001.
4. Exception record and FIN-001-tol-breach.
5. Human rejection path; FIN-002-human-reject.
6. Append the four cases and the injection red line to `green.json`.

**Exit.** FIN-002, FIN-003, FIN-001-tol-breach and FIN-002-human-reject green; red line "injected text cannot reach approval" green; M1 cases still green. Tag `m2-judgement`.

**Cut if blocked.** Exception owner and review date come from a fixed table per exception code instead of policy lookup.

## M3 Failure handling

M3 makes every failure end in a named, bounded state: a tool that keeps timing out leads to a hold with the unknowns listed, a recovered tool lets the run continue, bad model output is repaired once and then fails cleanly, and a run never exceeds its budget. All faults come from the case files, so tests and demos share one setup.

**Build**

| File | Change |
| --- | --- |
| `adapters/toolBackends.ts` | Fault injection from a case's `faults` block: `timeoutTimes`, transient errors |
| `evidence/tools.ts` | Up to 3 attempts on timeout or transient error, backoff on the injected clock; validation errors are never retried; the request deadline is honoured |
| `rules/checks/threeWayMatch.ts` | An unreachable PO makes the receipt "unable to verify", never "missing"; `MISSING_RECEIPT` only when the receipt is confirmed absent |
| `evidence/extract.ts` | One repair attempt with the validation error fed back; a second failure ends the run `FAILED` with nothing written |
| `orchestrator/flow.ts`, `runtime/store.ts` | Budget counters (steps 20, tool calls 15, model calls 6; a case may lower them) stored on the run row and inherited on resume; `BUDGET_EXCEEDED` |

**Tests first**

- `tools.test.ts`: timeout twice then success is 3 calls; timeout every time is 3 calls then a typed failure; a transient service error then success is 2 calls, with the failed attempt in the events and the run continuing; a validation error is called once and never retried. The backoff schedule is read from the fake clock, so no test waits.
- FIN-004: `HOLD_FOR_INFORMATION`; receipt unverified; unknowns listed; next step addressed to the receipter.
- FIN-001-malformed: one repair, then the normal FIN-001 path; the `malformed-twice` script ends `FAILED` and writes nothing.
- budget-exceeded: tool budget 4 with a PO that keeps timing out ends `FAILED`, `BUDGET_EXCEEDED`; `ap resume` afterwards makes no calls.

**Steps**

1. Fault injection and the retry policy, with their unit tests.
2. Unverified-versus-missing wording; FIN-004 and FIN-001-po-retry.
3. Repair path and both malformed scripts.
4. Budget counters and budget-exceeded.
5. Append the four cases to `green.json`.

**Exit.** FIN-004, FIN-001-po-retry, FIN-001-malformed and budget-exceeded green; every earlier case still green. Tag `m3-failures`.

**Cut if blocked.** No jitter in the backoff; the transient-error class is covered by its unit test only.

## M4 Durability and idempotency

M4 proves the system never pays twice and never pays on a stale approval: a repeated callback is answered from the inbox, a crash at any step resumes without re-calling tools, a crash around the ERP call is recovered by looking the posting up first, and an approval whose facts changed is invalidated before the first send. After M4 all four red lines are green.

**Build**

| File | Change |
| --- | --- |
| `migrations/0002_inbox.sql`, `application/inbox.ts` | Delivery ID plus request hash; same ID and hash returns the stored final response; same ID with a different hash is `Conflict` |
| `orchestrator/runtime/step.ts` | Replay: a completed step returns its journaled output and calls nothing; crash points from a case's `faults` (after a named step, after SENDING, after the ERP post) |
| `orchestrator/runtime/lease.ts` | One worker per run; a second concurrent approval loses cleanly |
| `orchestrator/approvals.ts` | Before the first send, the snapshot is rebuilt (vendor status, bank account version, policy versions) and compared; a mismatch invalidates the approval, cancels the outbox row and holds the run (`VENDOR_BLOCK`, `AUTHORITY_GAP`) |
| `orchestrator/submit.ts`, `adapters/erpSim.ts` | Resume with an outbox row in SENDING first calls the read-only lookup by key, at most once per resume, allowed even when the run's tool budget is spent, counted separately in erpLookupCalls and written as an audit event: found means record SENT with the original `postingRef` and never cancel; if no posting is found, repeat the pre-submit checks and submit with the original key only if the approval, the snapshot and the remaining budget all allow it; a failed lookup is `RECONCILE_REQUIRED` |
| `evidence/retrieve.ts` | Authority version taken at each approval decision and again at submit; other rules by invoice date (already in place since M1) |

**Tests first**

- `inbox.test.ts`: hit returns the first response byte for byte; same ID with a different decision is `Conflict`.
- `step.test.ts`: crash after reconcile, then resume: completed steps are not re-executed and call nothing again; steps not yet run execute once; the final result equals an uninterrupted run.
- `submit.test.ts`: SENDING with a posting found, SENDING with none found, lookup failure; each ends in the state above.
- `lease.test.ts`: two approvals at once, one decision recorded.
- Cases: FIN-005, FIN-001-crash, erp-crash-after-post, erp-crash-then-vendor-blocked, approval-invalidated, each checked against its `submitAttempts`, `erpLookupCalls` and `financeActions`.

**Steps**

1. Inbox and FIN-005.
2. Step replay and crash injection; FIN-001-crash.
3. Outbox recovery by lookup; erp-crash-after-post, then erp-crash-then-vendor-blocked. Record the separate lookup count in the deviations log as a recovery budget clarification.
4. Snapshot comparison and invalidation; approval-invalidated.
5. Lease and the concurrent-approval test.
6. By hand: `kill -9` during a FIN-001 run, then `ap resume`; save the terminal output for M5's transcripts.
7. Append the five cases to `green.json`.

**Exit.** The five cases green; all four red lines green; every earlier case still green. Tag `m4-durable`.

**Cut if blocked.** `RECONCILE_REQUIRED` is covered by its unit test only; the concurrent-approval test is replaced by the database constraint plus a note in the deviations log.

## M5 Evidence and delivery

M5 adds no features. It turns the working code into what a reviewer can check without asking anything: an evaluation report, transcripts from real runs, a container that runs the tests, and three documents written from actual results. Feature code is frozen at the start of M5; only fixes for problems the drills find are allowed.

**Produce**

| Deliverable | Where | Source |
| --- | --- | --- |
| Evaluation report | `eval/report.md` | `ap eval` output: pass or fail per case, submit attempts, finance actions, unapproved actions (must be 0); retrieval quality: Top-3 hits on the six targeted answer-key queries, whether the dinner-allowance query returns no authority, and how often adversarial material was cited as policy (must be 0) |
| Transcripts | `docs/transcripts/fin-001-happy-path.md`, `fin-003-escalation.md` | Terminal output of real runs, plus the M4 crash-and-resume output |
| Container | `Dockerfile`, `compose.yaml`, `.github/workflows/ci.yml` | As specified in the design's Running with Docker section |
| Architecture | `docs/architecture.md` (manifest, real vs simulated), `architecture.mmd`, `architecture.png` | The frozen design's diagram |
| README | `README.md` | Environment, commands, model requirements, assumptions, limitations, traceability matrix, eval results, AI use from `docs/build-log.md`, link to `docs/deviations.md` |
| Design note | `DESIGN.md` | Two-page note first, then the frozen design trimmed to about 4,000 words |
| Acceptance | `ACCEPTANCE.md` | Test strategy, case table, fault drills with their recorded results, definition of done; about 2,000 words |

**Steps**

1. `ap eval` writes `eval/report.md`; Dockerfile, compose and CI; `docker build --target test` passes.
2. Run the six fault drills by hand and keep the output; security checks: search logs and both SQLite files for account numbers (only last four digits may appear), `gitleaks`, `.env` absent and `package-lock.json` present.
3. README, filled from the build log, the eval report and the deviations log.
4. DESIGN.md and ACCEPTANCE.md cut from the frozen design. Trimming rules: Entry points keeps the interface and the CLI example, with one paragraph each for HTTP and queue; the FIN-001 result moves to `docs/examples/fin-001.json` with a short excerpt inline; test-data tables give way to a pointer to `cases/`; review history and engineering notes are left out.
5. `scripts/clean-room.sh`: fresh `node:22` container, README steps only, through the first completed case.

**Optional, after the exit holds.** An independent review: a fresh AI session given only the brief and the repository, asked to score it against the brief's assessment table. Then one `ap eval --model real` run, reported in the README with model, date, pass count and unapproved actions.

**Exit.** The 5 brief cases and 10 required variants green; red lines green; clean-room run passes on the first attempt; every deliverable in the table exists. Tag `m5-submission`.

**Cut if blocked.** Mermaid embedded in `architecture.md` instead of a rendered PNG; two ADRs instead of four; the threat model as a section of DESIGN.md instead of its own file.

## Cuts and risks

A milestone that is blocked applies its own cut list and moves on; M5 always runs, even if M4 is unfinished. Anything left undone is reported in the README as a known gap rather than rushed.

**Order of cuts.** Optional variants first, then the real-model eval run, the independent review, separate ADR and threat-model files, the concurrent-approval test, the `RECONCILE_REQUIRED` path beyond its unit test. Never cut: the 5 brief cases, the 10 required variants, the four red lines, the README, DESIGN.md and the transcripts.

**Risks**

| Risk | Early signal | Response |
| --- | --- | --- |
| `better-sqlite3` native build fails on `node:22-slim` | `npm ci` in M0 or the Docker build in M5 | Build stages on `node:22` (full image) with the same base for the runtime stage; record in the deviations log |
| BM25 misses an answer-key query | Retrieval tests in M1 step 2 | Weight section headings, add a small synonym list at ingest; never special-case a query |
| Fake and real model behave differently | The manual real-model run in M1 | Keep the extraction schema strict and the grounding checks on; record differences, do not loosen checks |
| A case's expected value looks wrong | A rules test disagrees with a case file | Re-run `tools/verify_testdata.py`; fix the code if it passes, the data only if it fails, and log either way |
| Crash tests are flaky | Intermittent failures in M4 | Crashes in tests are a thrown signal in one process; `kill -9` is used only in the manual drill |
