# An explicit workflow controls the write

Use a small TypeScript state machine with typed steps, a step journal, injected clocks and explicit budgets. Give the model two narrow jobs: extraction and explanation. Use no agent framework.

## Context

The brief cares more about grounded evidence, explicit control and failure handling than about features. A reviewer must be able to trace each external effect back to one human approval. In a free-form tool loop the model chooses the next action, which would put the most important transition inside model behaviour. This workflow has a fixed order: extract, gather evidence, reconcile, report, request approval, then submit. The model never needs to choose a tool.

## Options considered

| Option | What it would provide | What this project would still have to enforce | Decision |
| --- | --- | --- | --- |
| LangGraph | A state graph, checkpointers for SQLite or Postgres, `interrupt` for human review, per-node retry policies and a recursion limit | Approval authority, the frozen snapshot, deny-by-default submit, the inbox, the outbox with lookup-first recovery, decimal rules, trust filtering and redaction | Not chosen. Its checkpoint is a second source of truth next to the AP and ERP databases. Its resume semantics would have to be reconciled with the outbox |
| Google ADK | Agent and workflow-agent abstractions, tool registration, session state and callbacks | The same controls. Its strengths are model-driven delegation and multi-agent composition, which this workflow does not use | Not chosen |
| AWS Strands Agents | A model-driven loop over decorated tools, with hooks and Bedrock integration | The same controls, plus a guard that keeps the model from calling the consequential tool. The approval gate would sit outside the loop anyway | Not chosen. A model-driven loop is the shape this design avoids |
| Framework-free state machine | Nothing beyond the code written here | Everything, including replay, budgets and leases | Chosen |

## What the code enforces

A framework could supply the first three rows below. The rest would remain project code under any option.

| Control | Where |
| --- | --- |
| Step order and the bounded run | `src/orchestrator/flow.ts` |
| Journal replay: a completed step returns its stored output and calls nothing | `src/orchestrator/runtime/step.ts` |
| Persisted budgets for steps, tool calls and model calls, inherited on resume | `src/orchestrator/runtime/store.ts` |
| One worker per run, with a renewable lease | `src/orchestrator/runtime/lease.ts` |
| Approval authority, role and limit, and the frozen snapshot | `src/orchestrator/approvals.ts`, `src/application/apService.ts` |
| Deny-by-default submit with an idempotency key and lookup-first recovery | `src/orchestrator/submit.ts` |
| Replay of a repeated callback | `src/application/inbox.ts` |
| Decimal arithmetic and the outcome ratchet | `src/rules/` |
| Grounding, trust allowlist and citation checks | `src/evidence/`, `src/report/citations.ts` |
| Redaction of bank details in logs, events and storage | `src/adapters/redact.ts` |

## Consequences

Each transition is inspectable and has its own test. The orchestrator is about 1,100 lines, and the team owns journal replay, deadlines and leases. A multi-host deployment could move those three mechanics to a durable workflow runtime such as Temporal or AWS Step Functions. The approval, outbox and inbox rules would move with the code unchanged. If the workflow later needs open-ended investigation, a framework-driven agent could gather read-only evidence inside one step, while this state machine keeps control of the write.
