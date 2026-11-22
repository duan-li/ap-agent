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
- **Status:** Agreed; implement in M1
- **Design reference:** TECH.md, Contracts, Result (FIN-001 sample, `SF-1` and `SF-2`)
- **What:** The design's sample shows each invoice line as one value, `10 x 1200.00 = 12000.00`. The implementation extracts `quantity`, `unitPrice` and `lineAmount` as three fields. Each is checked against the invoice text on its own, and all three may cite the same invoice line. Code computes `quantity × unitPrice` and compares it with the stated `lineAmount`; a difference is a finding. Display strings such as `10 x 1200.00 = 12000.00` are formatted by code from these fields.
- **Why:** The invoice reads `Qty 10  Unit $1,200.00  Amount $12,000.00`. The combined string does not appear in it, so the value-in-quote check would reject it. Separate fields prove extraction accuracy and also catch an invoice whose own arithmetic is wrong.
- **Impact:** FIN-001 is compared with the design's sample on business fields, sources and outcome, not on display strings, IDs or hashes.
- **Proof:** _to be filled in M1 (test name)_

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
- **Impact:** A missing stated amount is missing evidence. Multiplying quantity by unit price cannot supply evidence of the amount printed on the invoice.
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
