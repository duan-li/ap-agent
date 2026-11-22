# Deviations from the design

`TECH.md` is frozen. This log records every place where the implementation differs from it or settles something it leaves open. An entry here overrides the matching part of `TECH.md`. The README links this file.

Each entry has a type:

- **Field representation adjustment**: same behaviour, different data shape.
- **Clarification**: the design leaves a point open or ambiguous; this entry settles it.
- **Departure**: the implementation does something the design does not. Needs the owner's approval first.

Status is `Agreed` (decided before implementation), `Implemented` (in the code, with the test that proves it) or `Open`.

---

## D-1 Invoice lines store quantity, unit price and line amount separately

- **Type:** Field representation adjustment
- **Status:** Implemented in M1
- **Design reference:** TECH.md, Contracts, Result (FIN-001 sample, `SF-1` and `SF-2`)
- **What:** The design's sample shows each invoice line as one value, `10 x 1200.00 = 12000.00`. The implementation extracts `quantity`, `unitPrice` and `lineAmount` as three fields. Each is checked against the invoice text on its own, and all three may cite the same invoice line. Code computes `quantity × unitPrice` and compares it with the stated `lineAmount`; a difference is a finding. Display strings such as `10 x 1200.00 = 12000.00` are formatted by code from these fields.
- **Why:** The invoice reads `Qty 10  Unit $1,200.00  Amount $12,000.00`. The combined string does not appear in it, so the value-in-quote check would reject it. Separate fields prove extraction accuracy and also catch an invoice whose own arithmetic is wrong.
- **Impact:** FIN-001 is compared with the design's sample on business fields, sources and outcome, not on display strings, IDs or hashes.
- **Proof:** `tests/extract.test.ts` grounds each stated value. `tests/calc.test.ts` compares the product with the stated amount. `tests/cli.test.ts` reads the resulting facts from the persisted FIN-001 review.

## D-2 Recovery lookup of an in-flight ERP submit is counted separately

- **Type:** Clarification (recovery budget)
- **Status:** Agreed; implement in M4
- **Design reference:** TECH.md, Implementation decisions, Decision 1, and Key mechanisms (outbox states)
- **What:** When `resume` finds an outbox row in `SENDING`, it makes one read-only ERP lookup by the original idempotency key, at most once per resume. The lookup is allowed even when the run's tool budget is spent. It is counted in `erpLookupCalls`, not in the tool budget, and written as an audit event. If a posting is found, the row is recorded `SENT` with the original `postingRef` and is never cancelled. If no posting is found, the pre-submit checks run again and the submit is sent with the original key only if the approval, the snapshot and the remaining budget all allow it. If the lookup itself fails, the row becomes `RECONCILE_REQUIRED`.
- **Why:** Recovery must be able to find out what already happened in the ERP. A new write still obeys the budget.
- **Impact:** Cases `erp-crash-after-post`, `erp-crash-then-vendor-blocked` and `erp-crash-before-post` assert `erpLookupCalls` separately from `submitAttempts`.
- **Proof:** _to be filled in M4 (test name)_

---

<!-- Template for new entries

## D-n Title

- **Type:**
- **Status:**
- **Design reference:**
- **What:**
- **Why:**
- **Impact:**
- **Proof:**
-->

## D-3 Recorded extractions may omit a stated line amount

- **Type:** Clarification
- **Status:** Implemented in M0
- **What:** The model response schema allows a missing `lineAmountRaw`. The default fake extracts this field for every supplied invoice. Named scripts replay their recorded responses.
- **Why:** The verified v3 reference and repair responses contain quantity and unit price only.
- **Impact:** Revised by D-10. A stated amount that fails grounding is still missing evidence and is never replaced. An amount the reading does not state at all is derived from the grounded quantity and unit price, and the stated tax and total must still match.
- **Proof:** `tests/fake.test.ts` exercises both the invoice parser and the recorded repair response.

## D-4 AI-strengthened red-line assertions

- **Type:** Departure approved by the owner
- **Status:** Implemented in M0; reviewed and approved by the owner on 2026-11-22
- **Design reference:** AGENTS.md, Red lines ("never let an AI tool write its assertion"); TECH.md, Testing and acceptance; PLAN.md, Working rules 1
- **What:** The owner wrote the initial four assertions in `tests/redlines.test.ts` by hand. An acceptance review then found gaps, and at the owner's request Claude strengthened them:
  - RL-001 also resumes the run after the refused approval and checks that nothing is submitted.
  - RL-002 also sends the same approval under a new delivery ID and checks that it creates no second decision or submit.
  - RL-003 runs on FIN-001 and FIN-003 and uses `bankLeaks`. It flags a full account number (also when split by spaces or hyphens) and any 4+ digit fragment other than the last four. Digit runs are bounded by non-digits, so epoch-millisecond times in SQLite do not give false positives.
  - RL-004 runs FIN-003 with the default and the `FIN-003-fooled` scripts. It checks that no approval is requested or frozen, that a forged approval ID is refused, and that the vendor master is unchanged. `TestRun` gained `vendorMaster()` for this.
- **Why:** The owner chose to delegate the fixes. In the review, the first version passed a service that requested approval on FIN-003 and a service that submitted on resume. It also failed a correct service that stored epoch-millisecond times.
- **Impact:** The added assertions are AI-written, so the independence the rule protects now rests on the owner's review of them. The owner should read each added assertion against the red line before M1 adds any red line to `eval/green.json`.
- **Proof:** Each red line was run against a correct stub service and against stubs that break it (submit on resume, a second decision under a new delivery ID, spaced and prefix account leaks, approval requested, forged approval accepted, vendor master changed). Correct stubs passed, every broken stub failed, and epoch times did not trigger RL-003. The probe was a throwaway script and is not in the repository.

## D-5 M1 uses the SQLite driver bundled with Node.js

- **Type:** Departure (driver choice)
- **Status:** Implemented in M1
- **Design reference:** TECH.md, Persistence and migrations and Running with Docker
- **What:** Both the agent store and the ERP simulator use `DatabaseSync` from `node:sqlite`. The Docker design specifies the `better-sqlite3` package.
- **Why:** Node 22 provides the synchronous connection, prepared statements and transactions the adapters need. Using the bundled driver avoids installing a separate native addon.
- **Impact:** The runtime must provide `node:sqlite`. M1 was verified on Node 22.23.5. Both databases use the versioned SQL migrations, and the simulator keeps its postings in a separate file.
- **Proof:** `tests/cli.test.ts` starts a run, reads it from a new process, exercises the approval gate and checks the persisted posting reference.

## D-6 Standard exception review dates

- **Type:** Clarification
- **Status:** Implemented in M2
- **What:** Standard exceptions are due on the third weekday after the review starts, using the injected clock in UTC. The requester owns PO price variances.
- **Why:** FIN-POL-007 sections 3 and 4 assign PO issues to the requester or receipter and give standard exceptions three business days. The fixtures provide no holiday calendar.
- **Impact:** A price variance found on Sunday 2026-11-22 is routed to the requester for review by Wednesday 2026-11-25.
- **Proof:** The price-exception test in `tests/judgement.test.ts` checks the owner, date and line amounts together.

## D-7 Run budget columns arrive in migration 0002

- **Type:** Clarification
- **Status:** Implemented in M3
- **Design reference:** TECH.md, Contracts (Run budget) and Persistence and migrations; PLAN.md, M3 and M4
- **What:** `migrations/0002_run_budget.sql` adds the three counters, the three limits and `failure_reason` to `runs`. The limits are written when the run starts (default 20, 15 and 6, or lower values from a case's `faults.budget`), so a resume uses the stored limits and the spent counts. A case can only lower a limit: the case schema rejects higher values, and `openApp` clamps them for callers that skip the schema. Every orchestrator step is charged when it executes: extract, gather, reconcile, report, request_approval, resolve_approval and submit, so FIN-001 takes seven. A replayed step is free. A refused request_approval or resolve_approval rolls back, so no approval exists or the approval stays `PENDING`, and the run ends `FAILED`. Submit charges its step and checks the request deadline before `SENDING`. After `SENDING` (audited as `OUTBOX_SENDING`) nothing can refuse the ERP call, so a `SENDING` row always means the call was made. A `SENDING` row left by a crash or an ERP error is recovered in M4 (D-2). Every tool attempt is charged, retries included, and so is every model call, the repair included. A refused attempt is never made: the run ends `FAILED` with `BUDGET_EXCEEDED`, a `BUDGET_EXCEEDED` event and a `RUN_FAILED` event. Before an approved intent moves to `SENDING`, one tool call must still be left; otherwise the intent is `CANCELLED` and nothing is sent. M4's inbox migration becomes `0003_inbox.sql`, not the `0002_inbox.sql` PLAN.md names.
- **Why:** `0001_init.sql` was applied in M1, and applied migrations are never edited. The design's own `runs` excerpt already holds the counters.
- **Impact:** `ap get` reports `budget` from the stored counters and a `failureReason` for failed runs. M4 renames one migration file.
- **Proof:** `tests/failures.test.ts`: the budget-exceeded run, a deadline followed by resume that keeps the spent count, the refused submit, the model budget, the step budget at each of FIN-001's last three steps, and the rejected and clamped raised limits.

## D-8 Fault blocks may also inject transient errors

- **Type:** Clarification
- **Status:** Implemented in M3
- **Design reference:** PLAN.md, M3 (`adapters/toolBackends.ts`, transient errors); TECH.md, Contracts (Tools)
- **What:** The fault block accepts `transientTimes` next to `timeoutTimes`, for `get_purchase_order`, `get_vendor_record` and `check_invoice_history`. Timeouts are served first, then transient errors, then the normal answer. The v3 cases use only `timeoutTimes`; no case file changed.
- **Why:** PLAN.md asks for a transient-error test, and faults must come from a faults block, never from mocks in the code under test.
- **Impact:** The retry policy is the same for both kinds: up to 3 attempts, backoff of 100 ms then 200 ms on the injected clock, no jitter (the M3 cut rule). Validation errors and missing records are never retried. The simulated backends are synchronous, so each attempt is judged when it returns. A read that took longer than its tool timeout counts as `TIMEOUT` and may be retried. A read that returns after the request deadline is discarded and the run stops at its checkpoint (`DeadlineExceeded`). A submit reply is always kept, because once the ERP has answered the write has happened. A model call is aborted at the deadline, and a reply that arrives after it on the injected clock is discarded. Local retrieval makes one attempt, as the tool table says. Submit makes one attempt per send; its recovery belongs to M4. A read tool other than the PO that still fails after its retries ends the run `FAILED` with `TOOL_UNAVAILABLE`, because Rules cannot judge without the vendor record or the history.
- **Proof:** `tests/tools.test.ts`, including the late-read, late-submit and deadline tests; the transient PO and slow model tests in `tests/failures.test.ts`.

## D-9 An unverified receipt keeps the MISSING_RECEIPT code

- **Type:** Clarification
- **Status:** Implemented in M3; confirmed by the owner on 2026-11-22
- **Design reference:** PLAN.md, M3 (`rules/checks/threeWayMatch.ts`); TECH.md, Contracts (FIN-004 view); `cases/FIN-004.json`
- **What:** PLAN.md says `MISSING_RECEIPT` applies "only when the receipt is confirmed absent". TECH.md and `cases/FIN-004.json` use `MISSING_RECEIPT` for the unreachable PO too, and FIN-POL-007 §1 has no separate code. The implementation keeps the exception code and states the difference in a `GOODS_RECEIPT` record (`C-RECEIPT`, verification `UNVERIFIED` or `NOT_FOUND`) and in the exception wording. Unverified reads "Unable to verify goods receipt for PO-55388: the purchase order system failed on 3 attempts (TIMEOUT)" and lists the PO and the receipt as unknowns. Confirmed absent reads "No goods receipt exists for PO-55388", with no unknowns.
- **Why:** The design and the verified case agree. The plan's sentence is read as being about wording, which is what the case asserts.
- **Impact:** `FIN-004` and `FIN-004-po-recovered-no-receipt` both report `MISSING_RECEIPT`, distinguished by `receiptVerification`.
- **Proof:** The FIN-004 and no-receipt tests in `tests/failures.test.ts`; cases `FIN-004` and `FIN-004-po-recovered-no-receipt`.

## D-10 Derive a line amount the invoice reading does not state

- **Type:** Departure approved by the owner
- **Status:** Implemented in M3; option 1 chosen by the owner on 2026-11-22
- **Design reference:** D-3; `cases/FIN-001-malformed.json`; `fixtures/model_scripts/FIN-001-malformed.json`; `tests/judgement.test.ts` (bad-citation)
- **What:** When an extraction has a grounded quantity and unit price but states no line amount, Rules compute quantity x unit price. The result is recorded as a `LINE_AMOUNT_DERIVED` calculation (`C-ARITH-n`) and listed as an assumption. It feeds the price tolerance and the tax and total checks like a stated amount. A stated amount that fails grounding stays in unknowns and is never replaced by the product. A price exception on a derived line cites `C-ARITH-n` instead of the missing field.
- **Why:** The repaired extraction in `FIN-001-malformed.json`, like the FIN-001 reference and `bad-citation` scripts, states quantity and unit price only, and the verified case expects `APPROVE_FOR_POSTING`. The amount paid stays grounded: the stated total must equal the derived subtotal plus tax. A wrong printed line amount with a right total is the only thing no longer caught, and it cannot change the payment.
- **Impact:** `FIN-001-malformed` reaches `AWAITING_APPROVAL` after one repair and joins `eval/green.json`. FIN-001 with `bad-citation` now proposes `APPROVE_FOR_POSTING`, with the unsupported explanation still discarded and audited, so the M2 test expectation changed. The default fake states every line amount, so other cases are unchanged.
- **Proof:** `tests/lineAmount.test.ts` (stated, derived, grounding failure kept unknown, missing inputs, inflated total held); the repair test in `tests/failures.test.ts`; case `FIN-001-malformed`.
