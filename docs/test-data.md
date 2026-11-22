# AP agent test data

This file documents `fixtures/`, `cases/` and `tools/`. Paths below are relative to the repository root.

Synthetic transaction data for the accounts-payable agent take-home. No real people, companies or bank accounts.
The policy corpus (15 markdown files) was supplied by the hiring team with the brief. It lives in `corpus/`, unchanged; `corpus/trust.json` is the ingestion allowlist that decides which documents may serve as policy authority.

## fixtures/
- `vendors.json` - vendor master (full synthetic account numbers, so log redaction can be tested)
- `purchase_orders.json`, `receipts.json` - PO lines and goods receipts (PO-55388 has no receipt on purpose)
- `invoice_history.json` - prior invoices for duplicate detection
- `authority_register.json` - approvers, limits and one expired delegation (register AR-2026.11)
- `attachments/*.txt` - invoice documents in a fixed text format, for LLM extraction
- `model_scripts/*.json` - fake-model responses, including deliberately bad outputs

## cases/
- `FIN-001` to `FIN-005` - the five cases from the brief
- Variants (`priority`: required / optional) - required variants back a hard requirement of the brief; optional ones are reported if done
- `retrieval_golden.json` - retrieval-only checks against the policy corpus

## Expectation vocabulary
- `outcome` - Rules' proposal before any human decision
- `finalOutcome` - outcome after a later event changes it (invalidation, ERP conflict)
- `finalStatus` - run lifecycle status at the end of the case
- `financeActions` - effective records in the simulated ERP (postings or invoice rejections)
- `submitAttempts` - calls to submit_finance_decision, including idempotent retries
- `erpLookupCalls` - read-only lookups of an in-flight idempotency key during recovery
- `mustCite` - each required citation with the finding it supports

The default fake model parses the fixed invoice format; a case names a script only to force a specific model behaviour.

## Isolation
Each case runs against a fresh temporary agent database, a fresh ERP simulator database and a fixed clock.
Only `duplicate-across-cases` shares state, between its own two runs. Running the evaluation twice must give identical results.

## tools/
- `gen_testdata.py` - regenerates fixtures/ and cases/ (`python3 tools/gen_testdata.py .`)
- `verify_testdata.py` - recomputes every case from the fixtures with the policy rules (`python3 tools/verify_testdata.py .`)
