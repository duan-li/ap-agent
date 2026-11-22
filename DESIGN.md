# Design note

A supplier invoice is a request to investigate. Even a fully matched invoice can become payable only through a separate human decision. This agent produces the evidence for that decision, freezes what the approver saw, and retains the ERP receipt that establishes what happened. The command line is sufficient to demonstrate that lifecycle across independent processes.

## The short design

**Follow one invoice.** AP submits FIN-001 with an invoice reference, vendor, amount, currency and text attachment. The state machine first extracts fields from the attachment. Evidence obtains the vendor record, purchase order with its receipts, invoice history and the relevant policy sections. Rules match each line to the order and received quantities, calculate the allowed price difference and check the tax and total. A gross amount of AUD 17,600 requires a Department Director. The output at this point includes a precise action to review, an approval ID and an empty list of finance actions. A process can exit here for the whole duration of human review.

**Keep authority outside the documents.** A document can give evidence about a line amount, a vendor claim or an applicable policy. Each use requires a different check. Extraction must find both the quote and its claimed value in the original text. For policy, retrieval admits authority only from allowlisted documents in their effective window. For a finance write, the application checks the human actor against a delegation register. FIN-003 illustrates all three boundaries. A supplier's instruction to bypass approval becomes a cited risk indicator. A bank detail conflict goes to Financial Crime and Controls. There is no pending approval to accept.

**Give the model narrow jobs.** The model provider reads invoice text and writes a background explanation. Its output crosses a schema boundary. A malformed extraction gets one repair with validation feedback. Evidence drops ungrounded fields into unknowns. Rules calculate in decimal and accumulate findings. The strictest applicable outcome prevails. The report checks explanation references against actual findings and checks its numbers against their calculation records. Code renders the payment, approval and action summary. A plausible paragraph cannot change the amount or the approver.

**Keep the human decision attached to its facts.** Resolving the approval requires the right role, a sufficient limit and the pending approval ID. An approval binds the action, vendor, invoice, amount, currency, bank version and policy versions. A human can also reject the proposal and give a reason. In FIN-002, approving the proposed duplicate rejection records a rejection of the new submission. The earlier paid history record survives. The words “approve” and “post” refer to different decisions here.

**Recover uncertainty in the correct order.** Local approval and creation of a submit intent share a transaction. The ERP uses another database and independently recognises the idempotency key. A crash between these two systems cannot be resolved by looking at local approval alone. Resume looks up an in-flight key before considering a new send. A receipt found even after the vendor has become blocked must be recorded as a past posting. An absent receipt permits another send only after the budget, vendor and authority checks pass. A lookup error gives AP a reconciliation task.

**Bound the work.** A run stores limits and spent counts for steps, tools and model calls. Each tool attempt counts. A completed step returns its journaled output on replay. A deadline can interrupt progress without discarding that checkpoint. One read-only ERP lookup per recovery is allowed separately from the write budget. FIN-004 demonstrates the difference between an operational failure and missing business evidence. After three failed PO reads, AP can say the receipt could not be verified and request it. Nothing justifies declaring the goods unreceived.

**Use no agent framework.** The workflow has a fixed order and the model never chooses a tool, so a model-driven loop adds nothing here. LangGraph would supply the graph, checkpoints, human-review interrupts and retries. Google ADK and AWS Strands would supply agent loops and tool registration. None of them would enforce approval authority, the frozen snapshot, deny-by-default submit, callback replay, lookup-first ERP recovery, decimal rules or redaction. Those stay in project code under any option. A framework checkpoint would also be a second source of truth beside the AP and ERP databases. The record compares the options. [Framework decision](docs/adr/0001-framework-free-orchestrator.md)

**Deploy locally, with explicit production seams.** Real SQLite transactions, a separate simulated ERP and a fake model exercise approval, masking and recovery without credentials. Local CLI actor selection is a demonstration convenience. A deployment would authenticate the approver, scope document access, integrate with a real idempotent finance API and provision a durable multi-worker store. Financial Control would own threshold and authority changes. AP Operations would own exception routing and manual reconciliation. The five brief cases and the offline red lines set a release gate that a new adapter must still pass.

The rest of this document specifies the contracts behind that walkthrough. The component manifest and diagram show where each contract lives. [Architecture](docs/architecture.md)

## Entry points and application contract

The contract has two lifecycle methods, three per-request methods and one optional operations method.

| Method | Purpose | Pure? |
| --- | --- | --- |
| `start()` | Begin receiving requests | No |
| `stop()` | Stop receiving and finish in-flight work | No |
| `authenticate(raw)` | Establish who is calling from transport credentials | No |
| `decode(raw, actor)` | Turn raw input into a command envelope | Yes |
| `encode(result, raw)` | Turn a shared result into transport output | Yes |
| `health()` (optional) | Report whether a long-running entry point can take traffic | No |

`decode` and `encode` are pure functions, so they can be unit-tested without starting a server or connecting to a queue.

```ts
// entrypoints/entryPoint.ts
export interface EntryPoint<Raw, Out> {
  readonly name: 'cli' | 'http' | 'queue';

  start(): Promise<void>;
  stop(): Promise<void>;

  authenticate(raw: Raw): Promise<Actor>;
  decode(raw: Raw, actor: Actor): Envelope;
  encode(result: Result, raw: Raw): Out;

  health?(): Promise<HealthReport>;
}
```

`Raw` and `Out` are the only types that differ between transports. They represent argv and an exit code for the CLI, a request and a response for HTTP, a message and an acknowledgement for the queue.

For example, `ap approve run_01J --approval apr_01J --approver u-204 --delivery-id decision-01` selects the actor from the transport, decodes a resolveApproval command, dispatches it through ApService and encodes the response as JSON. A retry carrying the same delivery ID receives the first response. Using the ID for a changed body or actor produces Conflict. Without the flag, the CLI derives the ID from the callback content, so repeating the same command is a replay. The request metadata also carries a correlation ID, a source, an absolute deadline and an abort signal. Failure at any stage uses the shared error mapping. The CLI exposes Validation (2), Unauthorized (3), Conflict (4), NotFound (5), and Transient or DeadlineExceeded (75). A successful pause or replay exits zero.

An HTTP extension would authenticate a signed approval callback, establish its actor from credentials and use the provider delivery ID as the inbox key. It would translate the same outcomes into HTTP statuses. The approval action would still enter ApService and use the stored snapshot.

A queue extension would authenticate the consumer, preserve the invoice message identity and map terminal results to acknowledgement or dead-letter handling. On redelivery after an interruption it would continue from the existing run. Neither transport needs its own matching or submit logic.

The public use cases are startRun, getRun, resolveApproval and resume. Ingest and evaluation are local operations. A workflow case is a convenient carrier for an incoming request, simulated faults and model setup. The CLI passes only its request into the start use case. Assertions live in the evaluator. Consequently a change to a case's expected outcome cannot change what the agent proposes.

## Reading the evidence

### How the corpus is indexed

| Concern | Rule |
| --- | --- |
| Chunking | One chunk per `##` section of each markdown file, 58 chunks in the supplied corpus |
| Stable citation | Chunk ID `documentId@version#section`, for example `FIN-POL-002@2.4#2`, shown as "FIN-POL-002 v2.4 §2". Re-ingesting the same version gives the same IDs |
| Who grants authority | An allowlist in `corpus/trust.json`, set at ingestion, names the documents that may serve as policy authority. A document's own front matter cannot make it authoritative. Supplier content is always untrusted evidence |
| Which version applies | Each version has an effective window `[effective_date, superseded_date)`. Matching, tolerance, duplicate, vendor and currency rules use the version in force on the invoice date. Approval authority (FIN-POL-003) uses the version in force when each approval decision is made and is checked again at submit. A version outside its window is returned flagged as historical, never as authority |
| Ranking | Filter by trust, status and type first, then rank with BM25. Results below a score threshold are dropped |

The relative score answers which of the eligible sections most closely match this query. It does not estimate whether the invoice should be paid. The retriever tokenises the terms, weights section headings, scores with BM25 and sorts ties by chunk ID. A relevance threshold can leave the result empty. A query for dinner allowance does exactly that with the authority filter. The result set and the query are audit data. The decision retains the particular policy version and section behind each finding.

Rules bind a check to an expected citation. If the version and authority needed by a check cannot be found, the evidence is incomplete and a posting recommendation is held. A production policy change needs a reviewed change to the corresponding rule and a regression case. The supplied suite measures six narrowly targeted searches and one irrelevant query. Section boundaries can separate exceptions from their rules. BM25 also has limited vocabulary coverage. Production evaluation should measure recall on actual AP queries before changing chunk size or adding embeddings.

### Three grounding checks

1. **The quote exists.** Every extracted field carries a quote and a chunk ID. the quote must appear in that chunk.
2. **The quote supports the value.** The extracted value must appear in its own quote after normalising currency symbols, separators and whitespace. A real quote with a different value is rejected (script `value-not-in-quote`).
3. **The rationale supports the decision.** Each rationale sentence cites finding IDs produced by Rules, not raw chunks, and every number in the sentence must equal a number in those findings' calculations. A sentence citing a finding that does not exist is rejected (scripts `bad-citation`, `FIN-003-fooled`).

A field that fails a check is dropped to `unknowns` with a `GROUNDING_FAILED` event.

The normal fake extracts stated line amounts from the example attachments. Some recorded readings omit the line amount altogether. When both quantity and unit price are grounded, code may derive an unstated amount and record it as a calculation and assumption. A stated value that failed grounding stays unknown. The total still has to reconcile with the tax and line amounts. This distinction matters when reviewing a repaired extraction. It preserves the difference between a printed figure and a figure the reviewer can reproduce from two inputs.

## Matching, exceptions and explanation

In FIN-001, line one is 10 units at 1,200.00 and line two is 10 units at 400.00. Evidence keeps separate links for quantity, unit price and stated line amount. Accounting code compares the product with the stated amount, then compares the invoice and PO lines with a price tolerance equal to the lower of AUD 50 and one percent of line value. The threshold is 50.00 on the first line and 40.00 on the second. Exactly the threshold is within tolerance. The 50.10 variant carries the observed difference, threshold, owner and review date in a price exception. The subtotal is 16,000.00, tax is 1,600.00 and the total is 17,600.00. Money crosses a JSON boundary as decimal strings.

The invoice, receipt, history and policies have different evidentiary roles. The supplier invoice alone cannot show that the receipter accepted the goods. A paid or posted exact match has a stable history record ID, so an approver can inspect the previous transaction. Missing invoice lines put the plain request on hold. A conflict between the claimed and recorded bank account raises a control review independently of what the model concludes. Outcome severity is accumulated across checks. A later successful check cannot reverse an earlier escalation.

The report separates sourced facts, calculations, policy findings, inferences, assumptions, unknowns and actions taken. The latter is empty at the approval boundary. An exception has an expected and observed value, a failed rule, owner and due date. An AP reviewer can follow a finding's evidence IDs back to the calculation and its source references. Confidence measures whether the required evidence is present. A probable duplicate lowers it to MEDIUM, because the evidence is complete but its meaning needs a human. It is possible to have high confidence in a hold when a documented price difference exceeds tolerance.

This excerpt comes from the waiting FIN-001 run. The complete result includes the approval snapshot and each line calculation. [Full JSON](docs/examples/fin-001.json)

```json
{
  "status": "AWAITING_APPROVAL",
  "decisionSummary": {
    "paymentEligibility": "Eligible for posting once approved",
    "approvalStatus": "Awaiting DEPARTMENT_DIRECTOR (0 of 1 approvals)",
    "missingEvidence": [],
    "financeActionTaken": "None"
  },
  "actionsTaken": []
}
```

## Tool and model contracts

Every tool validates its input and output against the schemas in src/domain/types.ts. The workflow chooses which capability to call. The model provider accepts a purpose and data for that purpose. Its response is text for extraction or explanation. Tool arguments cannot come from an instruction embedded in the model's prose.

| Capability | Input and observable result | Limits |
| --- | --- | --- |
| Retrieve finance documents | A query, filters and top K return ranked sections, document IDs, trust, version, score and citation. | Local read, one attempt, two-second limit. |
| Get vendor record | A vendor ID returns status, risk and verification metadata, last four digits and bank account version. | Fixture read, two-second limit, up to three attempts. |
| Get purchase order | A PO number returns ordered lines, quantity, price, currency, tax and linked receipts. | Same read policy. A timeout leaves receipt verification unknown. |
| Check invoice history | Vendor and normalised invoice details return matching references and stable history IDs. | Same read policy. An exact match on vendor, normalised number, currency and gross amount leads to REJECT_DUPLICATE. A probable fuzzy match holds the invoice: same vendor and currency, gross amount within 0.5%, invoice dates at most 14 days apart, and the same PO or normalised number (D-16). Both use the fixture history. |
| Submit finance decision | Run ID, approval IDs, action, snapshot hash, idempotency key and payload return a simulator response and posting reference. | One attempt per send. Every new send goes through the outbox checks. |

The read adapter classifies timeout, transient failure, missing records and validation failures. Only the first two can be retried. Backoff uses the injected clock, with waits of 100 ms and 200 ms. A late read response is discarded. A returned ERP receipt represents a possible external effect and must be preserved. The Anthropic adapter uses the official SDK. It constrains the reply with a structured output schema, skips thinking blocks and returns the text for Evidence to validate. A refusal or a truncated reply therefore takes the same repair-then-fail path as malformed output. SDK retries are off, so every provider call is charged to the run budget, and a provider error maps to Transient for a later resume. The model name comes from `ANTHROPIC_MODEL`. Offline tests check the request and reply handling against a recorded transport. `npm run test:live` runs the five brief cases against the real provider when a key is present.

The default budget is 20 steps, 15 tool attempts and six model calls. A case may lower individual ceilings. Counters are on the run row so a fresh process sees prior spend. A refusal happens before the over-budget call. A terminal budget failure records its reason and events. Resume returns that view without making another call. An expired request deadline instead stops the current invocation. A later invocation gets its own deadline and continues with the remaining run budget. The two mechanisms govern how long the caller can wait, and how much work this invoice may consume.

## Authorising a decision

A proposal, a human decision on that proposal, and the finance action are separately typed. Code can propose posting or duplicate rejection. Both can change an external record, so both pause. A human rejection of either proposal returns the case to AP with the reason and no effective finance action. A hold or control escalation can complete locally with an owner and next step.

A permitted callback acts on one pending approval. Its comparison with the register uses the actor, role and limit at decision time. The frozen snapshot holds action, amount, invoice reference, currency, vendor, bank version and the versions of the supporting policies. Its hash covers those fields. Changing a case file after the request does not replace the snapshot. An approval records the actor and decision time and creates a pending intent in the same local transaction. The effective role and amount matter independently of whether the approver supplied the correct ID.

Before the first send, submit reads the vendor again, retrieves the relevant authority version and checks the frozen snapshot and action against the approved intent. A new vendor block invalidates the approval, cancels the intent and holds the run for AP. A bank version change escalates the control issue. An authority mismatch requires a new review. This implements the distinction between the invoice date, which governs ordinary matching, and the date of the approval, which governs the person's authority.

## Journaling, replay and reconciliation

The agent store contains runs, steps, events, approvals, inbox and outbox. The simulator has one postings table in its own database file. Both apply numbered SQL migrations at startup and record the schema version in SQLite. A reviewer can retain these files between processes and interrogate the simulator independently of the agent's own result. An integration that shares a transaction with the simulator could hide precisely the failure the outbox must handle.

A completed journal entry is keyed by run and step. Its saved output supplies inputs to the next step on replay. A process killed before a completed step has committed can repeat that work, so the workflow confines business writes to submit. Runs also have a unique case and invoice reference. Resubmission with new evidence uses a new case ID. This preserves the earlier decision, the policy versions used and the facts available at the time.

A renewable lease serialises workers on a run. Each acquisition advances an epoch. Durable mutations check that the worker still owns the recorded epoch in their write transaction. A replacement process may have the same operating-system PID, especially in separate containers. A process-specific random identity and a bounded lease distinguish those workers. A stale worker that wakes after another worker takes over cannot commit a new decision. This protects the local state transitions. The receiving ERP still needs its own protection against a repeated external effect.

The inbox hashes the delivery ID and binds it to a hash of the actor, intent and decision. A repeat can read the first final response. A changed body with the same ID conflicts. Applying the human decision and marking the inbox delivery applied are coordinated, so interruption can leave an applied callback awaiting recovery without accepting another human decision. A new delivery ID also faces the pending-state check on the approval row. The separate concurrent-callback test exercises this race.

| Outbox state or recovery result | What the worker knows | Action |
| --- | --- | --- |
| PENDING | The approved write has yet to start. | Check approval, authority, vendor, deadline and budget. |
| SENDING with a receipt at ERP | The remote effect exists under this key. | Store the original posting reference, mark SENT and audit later changes. |
| SENDING with no receipt at ERP | The lookup found no effective posting. | Return to the pre-send checks and reuse the key. |
| SENDING with a failed lookup | The effect is unknown. | Mark RECONCILE_REQUIRED and route to AP. |
| SENT or CANCELLED | The intent already has a terminal disposition. | Keep the recorded result. |

The recovery lookup counts separately as erpLookupCalls and is allowed once per resume, even with no remaining ordinary tool budget. It can settle an existing receipt. It cannot authorise a new write. The simulator's primary key returns the original receipt for a repeat. Its separate uniqueness constraint on vendor and normalised invoice prevents a second effective submission under a different key. The full two-case duplicate workflow is an open optional scenario. Database uniqueness alone does not give the AP user the intended second-case explanation.

## Operating and evolving the workflow

Run views return state, current step, budget, outbox, result and the ordered audit events. Events carry run and correlation IDs. Tool events include attempt, outcome and duration. Model call events include purpose, outcome and duration. Retrieval events identify the query, chunk IDs and versions. The operator can distinguish a refused actor, a case paused for a human and a held exception from these records. In particular, COMPLETED means the workflow has finished its handling. The finance action in the typed result determines whether the ERP was changed.

The test pack pairs each workflow input with an expected business outcome and optional adapter faults. Seeded IDs and a fixed clock make the same scenario comparable before and after a change. The measurements and manual drills are in ACCEPTANCE.md. The raw data and schema guide are the reference for variant definitions. [Workflow cases](cases/) · [Test data](docs/test-data.md)

A production rollout would start in shadow mode on historical and live cases. Financial Control would assess proposals to post on insufficient evidence. AP Operations would measure unnecessary holds and follow-up workload. Each group would need reviewed tolerances and examples of failure before enabling a class of write. An authenticated approval UI would show the derived and stated amounts separately, the exact policy sections and the snapshot that will be authorised.

A shared service would require tenant-scoped storage, evidence access filters, a secrets manager and explicit retention. The store boundary permits a PostgreSQL adapter and a workflow runtime with distributed leases and observability. Moving the database does not eliminate the need for receiver-side idempotency or the lookup-first recovery rule. A real ERP integration must define lookup consistency, durable keys and the manual response to an indeterminate write before the first live send. For policy changes, store the effective dates, publish a reviewed rule update, add boundary tests and retain old versions for explaining past decisions. The packaged implementation and its verified limits are recorded in the evaluation report.

The decision records give the context and consequences of the runtime, storage, retrieval and finance boundary choices. The workflow record also compares agent frameworks. [Workflow](docs/adr/0001-framework-free-orchestrator.md) · [Store](docs/adr/0002-sqlite-step-journal.md) · [Retrieval](docs/adr/0003-bm25-over-embeddings.md) · [Inbox and outbox](docs/adr/0004-outbox-and-inbox.md) · [Threat model](docs/threat-model.md)
