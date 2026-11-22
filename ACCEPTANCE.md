# Acceptance record

On 22 November 2026, all five brief cases, all ten required variants and the four red lines passed using the offline model. Six independent CLI fault drills reproduced the expected control behaviour. The final clean-room script completed FIN-001. Its development run exposed a macOS archive problem, so the original first-attempt criterion has a recorded exception.

## What the test counts mean

The Node 22 suite passed 136 tests across 20 files. Vitest separates unit and contract tests from the workflow project. The workflow project executes every case, and fails for a regression in the green set. A green test suite therefore says that the regression set holds, while the evaluator additionally shows which optional workflows fell short. Reading these as different measurements matters here: 20 of the 27 workflow specifications passed in full. The remaining seven are visible in the report with the fields that differed or an execution failure. [Evaluation report](eval/report.md)

Each workflow gets temporary AP and ERP databases, a fixed clock, seeded identifiers and its own model adapter. The runner exercises the application service, including the case's approval callbacks. The harness reads expectations after observing the actual result. A fault tells the adapter how to fail. For example, a PO timeout changes the observed tool outcome and spent budget. It cannot insert a HOLD decision into the service. Closing and reopening the application over the same files tests restart independently of in-memory state.

The data pack is a second source of evidence. Python verifies the generated fixtures and cases without importing the TypeScript application. The verifier printed `ALL CHECKS PASSED`. The packs include the original policy data, effective versions, invoice line and receipt references, authority register, model scripts and expected business effects. Inspect a case's request, faults, approvals and expect fields to see the setup and observations separately. [Cases](cases/) · [Data guide](docs/test-data.md)

## Required workflow results

| Case | Result | Evidence observed |
| --- | --- | --- |
| FIN-001 | Pass | Matched invoice, PO and receipt. Director approval led to one POST. |
| FIN-002 | Pass | Exact duplicate cites HIST-3301. Approval recorded a REJECT_INVOICE against the new submission and preserved the paid record. |
| FIN-003 | Pass | Changed account and bypass instruction produced a control escalation. Zero writes. |
| FIN-004 | Pass | Three failed PO attempts left the receipt unverified. The receipter has a next action. |
| FIN-005 | Pass | Repeated callback returned the first response. A single ERP decision survived replay. |
| FIN-001-wrong-approver | Pass | u-201 has insufficient authority for 17,600. The pending decision remained open. |
| FIN-001-tol-breach | Pass | A 50.10 price variance exceeded the 50.00 limit and produced an owned exception. |
| FIN-002-human-reject | Pass | A human rejected the proposed duplicate rejection. The case returned to AP with no ERP write. |
| FIN-001-po-retry | Pass | Two timeouts consumed attempts. The successful third read allowed the review to proceed. |
| FIN-001-malformed | Pass | The recorded malformed extraction required one repair. Grounded inputs supported a posting proposal. |
| budget-exceeded | Pass | A refused tool attempt ended the run FAILED. Resume performed no additional work. |
| FIN-001-crash | Pass | A committed reconcile step survived restart. The resumed result matched an uninterrupted review. |
| erp-crash-after-post | Pass | A single lookup found the existing receipt and settled the outbox. |
| erp-crash-then-vendor-blocked | Pass | The original receipt was preserved and the later vendor change was audited. |
| approval-invalidated | Pass | A vendor block before the first submit cancelled the intent and invalidated the approval. |

Of the optional cases, within-tolerance, tolerance-edge, recovered PO without receipt, delivery-ID conflict and crash-before-post passed. The quantity, fuzzy-duplicate, currency, cross-case duplicate, new-vendor, changed-policy and blocked-vendor cases failed. A failure can mean a missing exception or citation even when a run held the invoice. A case whose adapter setup is unsupported has no observed counts. The gate covers the 15 required workflows. Additional controls for these optional classes would need a separate implementation and acceptance decision.

## Measuring authority and finance actions

An ERP row establishes an effective write. A tool-call event establishes an attempt. These are counted separately because replay or transport failure can make the numbers differ. The evaluator compares each primary run's ERP records with its AP outbox and approvals before removing the temporary databases. A matching approval must have a recorded decision maker, an approved state, a decision time no later than the receipt, a key scoped to the run, approval and action, and a matching payload. The count of observed unapproved actions was zero. Separate concurrent-callback and red-line probes exercise independent fresh databases outside these primary-run totals.

Retrieval tests run each golden query through the real index with top K of three, the evaluation date and the authority filter. Success requires the requested document and section together in the returned set. It also requires excluded sources to have no authority. All six targeted queries passed. The dinner-allowance query returned no sections. Counting ADV-prefixed citations in persisted workflow policy findings found zero uses as authority. Supplier material can still appear in sourced facts when its claimed bank change is the reason for escalation. The report shows the actual ranked sections so a reviewer can tell a first-place hit from a third-place hit.

Four red lines have dedicated assertions. RL-001 follows a refused callback with resume and checks the simulator. RL-002 repeats the callback and tries another delivery ID for the same approval. RL-003 inspects logs, run output, events and SQLite for account fragments. RL-004 exercises the bank-change case both with ordinary extraction and a model script that follows the embedded instruction. It also submits a forged approval ID and observes the vendor master. Each passed. The provenance of the assertions, including the owner's exception for subsequent strengthening, is recorded in D-4. [Deviations](docs/deviations.md)

## Fault drills on persisted runs

The drills used fresh directories and the ordinary CLI, with separate processes for start, approval, get and resume. The operator read the run and approval IDs from stdout. Structured events on stderr provided an independent trace of the attempted steps. Direct reads of the ERP database supplied the posting reference and action. The transcript contains selected response fields, actual IDs and the database query for each financial outcome. [Six CLI drill captures](docs/transcripts/fault-drills.md)

1. **Killed after reconcile.** The driver watched the start process's audit stream and sent SIGKILL after the reconcile completion event. A separate get found RUNNING with reconcile committed. Resume took over the abandoned lease, reached AWAITING_APPROVAL and kept tool usage at seven. The pending run had an empty action list. The original M4 drill is retained as a second observation at a slightly different point in the same review. [M4 capture](docs/transcripts/m4-crash-resume.md)
2. **ERP posted before the process stopped.** The fault was configured by erp-crash-after-post. Approval returned a transient interruption with the run ID. An immediate simulator query already found a posting. Resume looked up the key once, recorded the same reference in SENT and returned COMPLETED. The final query still found one row. Counting only the local crash response would have missed the external effect.
3. **Vendor changed after posting.** The same boundary was exercised with a vendor block before resume. The lookup found the posting first. OUTBOX_RECONCILED and VENDOR_CHANGED_AFTER_POSTING appeared in the audit. Recovery preserved the original approved receipt. A late block cannot cancel a posting the ERP has already recorded.
4. **Approval stale before send.** The vendor block in approval-invalidated occurred while the intent could still be cancelled. The event history showed APPROVAL_INVALIDATED and OUTBOX_CANCELLED. The final proposal held the invoice with VENDOR_BLOCK. The simulator had zero rows. Together with the previous drill this checks both sides of the irreversible boundary.
5. **Repeated callback.** FIN-005 was approved twice with the same delivery ID, actor, run and approval. The CLI returned the same response and recorded the duplicate in the audit. The final simulator query returned one POST. The separate inbox tests also exercise changed callback contents and the concurrent-approval suite exercises contention.
6. **Unavailable purchase order.** FIN-004 exhausted the three allowed PO attempts. The audit retained the failures and retry information. The final result included purchase order and goods receipt unknowns and routed follow-up to the requester or receipter. The invoice delivery text did not satisfy receipt verification. The simulator was empty.

Other regression tests exercise a lookup error requiring manual reconciliation, lease renewal/expiry, fencing of a superseded worker, failed grounding, untrusted notes, and the second malformed model response. Their aim is to distinguish a safe stop that needs evidence from an interrupted operation that can be continued. The application does not automatically resolve an unknown ERP effect by sending another command.

## Environment, security and completion

The Docker test target installed the locked dependencies and ran the suite. Compose built the compiled, non-root runtime and ran the complete evaluator. The clean-room check started from a fresh full Node 22 image, copied the reviewable repository files, installed dependencies and executed the first-case shell block directly from the README. The resulting FIN-001 view was COMPLETED with exactly one POST in actionsTaken. During the first rehearsal the macOS archive tool created AppleDouble metadata files in the corpus. The fix disables that archive metadata when transferring the checkout. A fresh-container rerun passed with the corrected script. The corpus files themselves were unchanged.

Local typecheck, lint and unit/case tests passed. A redacted Gitleaks scan of Git history and of the pending submission files returned no findings. The checkout had no .env and the lockfile is tracked. The drill outputs, event logs and both persisted database files were checked against the synthetic master account values with the red-line fragment detector. Only the allowed last-four representations were found for those values. The supplied fixtures intentionally retain full synthetic numbers to exercise the masking boundary.

For release, require all 15 workflow gates, four red lines, zero unapproved actions, reproducible setup and the recorded controls above. The live Anthropic smoke run remains unverified without credentials. The optional real-model evaluation and independent review were deferred. No production payment system, cloud account or model credential was used to produce the evidence. The first-rehearsal exception and the optional workflow failures remain part of the submission record.

The production-dependency npm audit reported zero advisories at verification time. The full install reported one moderate and two critical advisories in the development dependency tree. The test image includes the development dependencies. The runtime installs only production dependencies. Dependency versions and the lockfile were kept as supplied.
