# Accounts payable review agent

Review an invoice, inspect the evidence behind the proposal and record a human decision before the local ERP simulator can post. FIN-001 walks through all three steps. FIN-003 shows what AP sees when a supplier requests a bank change.

## Getting started

This walkthrough goes from a fresh machine to a posted invoice, then through the duplicate, injection, missing-evidence, rejection and restart paths. It needs no API key and takes about ten minutes. Run every command from the repository root, in one bash or zsh session.

### 1. Check the prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js and npm | Node 22 with built-in SQLite. Tested on 22.23.5. Node 24 also runs, with an npm engine warning | Everything |
| Git | Any | Getting the code |
| Python 3 | Any recent version | Optional: the test-data verifier |
| Docker with Compose v2.24 or later | Any recent version | Optional: the [container run](#container) |
| Anthropic API key | | Optional: [step 12](#12-optional-use-the-real-model) |

```sh
node -v    # v22.x
```

### 2. Install

```sh
git clone https://github.com/duan-li/ap-agent.git
cd ap-agent
npm ci
```

`npm ci` installs the locked dependencies. It is the only step that needs network access.

### 3. Run the tests

```sh
npm test
npm run typecheck
npm run lint
```

`npm test` ends with `Test Files 21 passed (21)` and `Tests 143 passed (143)`. It uses the fake model and needs no key.

### 4. Set up the session

```sh
export DATA_DIR="$(mktemp -d)"
export MODEL_PROVIDER=fake
ap() { npx --offline ap "$@" 2>>"$DATA_DIR/audit.log"; }
pick() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s),r=new Function("v","return "+process.argv[1])(v);console.log(typeof r=="string"?r:JSON.stringify(r,null,2))})' "$1"; }
```

`ap` runs the CLI. Its standard output is the JSON response. Its standard error is the audit event stream, which the function appends to `$DATA_DIR/audit.log`. `pick` prints one part of a JSON response, so each step can show the fields that matter. Every `ap` call is a separate process. All state lives in `DATA_DIR`.

The CLI reads its settings from the environment only. [.env.example](.env.example) lists the names.

| Variable | Values | Default |
| --- | --- | --- |
| `MODEL_PROVIDER` | `fake` (offline) or `anthropic` | `fake` |
| `ANTHROPIC_API_KEY` | Your key, needed only for `anthropic` | None |
| `ANTHROPIC_MODEL` | Any Messages API model ID | `claude-haiku-5-5` |
| `DATA_DIR` | Directory for the run store, ERP simulator and index | `data/` |

### 5. Build the policy index

```sh
ap ingest
```

It prints `{"chunks":58}`: the 15 policy documents in `corpus/` split into 58 sections and written to `$DATA_DIR/index.json`.

### 6. Review an invoice

FIN-001 is an AUD 17,600 invoice whose PO and goods receipt agree with it.

```sh
ap start --case cases/FIN-001.json > "$DATA_DIR/fin-001.json"
pick '({status: v.status, outcome: v.result.proposal.outcome, next: v.result.proposal.nextAction})' < "$DATA_DIR/fin-001.json"
```

```json
{
  "status": "AWAITING_APPROVAL",
  "outcome": "APPROVE_FOR_POSTING",
  "next": {
    "type": "REQUEST_APPROVAL",
    "roles": ["DEPARTMENT_DIRECTOR"],
    "approvalId": "apr_3a89dcf7-..."
  }
}
```

The agent recommends posting and stops. Nothing has been written to the ERP, and the process has exited. Keep the two IDs for the next steps:

```sh
run_id=$(pick v.runId < "$DATA_DIR/fin-001.json")
approval_id=$(pick v.result.proposal.nextAction.approvalId < "$DATA_DIR/fin-001.json")
```

### 7. Inspect the evidence

```sh
ap get "$run_id" | pick 'v.result.policyFindings.map(f => f.id + " " + f.citation)'
```

```json
[
  "F-THREE_WAY_MATCH FIN-POL-002 v2.4 §2",
  "F-TAX_AND_TOTAL FIN-POL-002 v2.4 §2",
  "F-VENDOR_ACTIVE FIN-POL-004 v5.1 §4",
  "F-DUPLICATE_CHECK FIN-POL-005 v2.8 §1",
  "F-APPROVAL_REQUIREMENT FIN-POL-003 v4.0 §2"
]
```

Each finding cites the policy version and section it relied on. The full result keeps sourced facts, calculations, policy findings, inferences, unknowns, assumptions, exceptions, confidence, the approval snapshot and actions taken in separate fields. Read it with `ap get "$run_id" | pick v.result`, or one part such as `pick v.result.calculations`.

`$DATA_DIR/audit.log` holds one JSON event per line. Each has a timestamp, run ID and correlation ID. Tool calls record attempt, outcome and duration. Model calls record purpose, outcome and duration. Retrievals record the query and the chunk IDs and versions they returned. Bank accounts appear only as their last four digits.

### 8. Approve and post

Try an approver whose limit is too low first. u-201 is a Cost Centre Manager with an AUD 10,000 limit. The register is in `fixtures/authority_register.json`.

```sh
ap approve "$run_id" --approval "$approval_id" --approver u-201
```

It prints `{"type":"Unauthorized"}` and exits with code 3. The run is still waiting.

Now approve as u-204, a Department Director, and send the same callback a second time:

```sh
ap approve "$run_id" --approval "$approval_id" --approver u-204
ap approve "$run_id" --approval "$approval_id" --approver u-204
```

Both print the same response, ending in `"status":"COMPLETED"`. The second call is recognised as a redelivery and replays the first response. Check what reached the ERP:

```sh
ap get "$run_id" | pick '({status: v.status, actions: v.result.actionsTaken})'
```

```json
{
  "status": "COMPLETED",
  "actions": [{ "action": "POST", "postingRef": "erp_8d230ea2-..." }]
}
```

One approval, one posting.

### 9. See the exception paths

Start each case and read its outcome:

```sh
for c in FIN-002 FIN-003 FIN-004; do
  ap start --case "cases/$c.json" | pick '({case: v.caseId, status: v.status, outcome: v.result.proposal.outcome, next: v.result.proposal.nextAction})'
done
```

| Case | What happens | Outcome |
| --- | --- | --- |
| FIN-002 | The invoice number and amount match a paid invoice | `REJECT_DUPLICATE`. Approving it records a rejection, never a payment |
| FIN-003 | The attachment asks to change the bank account and to skip approval | `ESCALATE_CONTROL_REVIEW` to Financial Crime and Controls. No approval is offered and nothing is written |
| FIN-004 | The PO system times out on all three attempts | `HOLD_FOR_INFORMATION`. The PO and the goods receipt are listed as unknowns and the receipter is asked for the receipt |

A human can also reject a proposal. FIN-002-human-reject is the duplicate case, rejected by its approver:

```sh
ap start --case cases/FIN-002-human-reject.json > "$DATA_DIR/fin-002.json"
ap reject "$(pick v.runId < "$DATA_DIR/fin-002.json")" \
  --approval "$(pick v.result.proposal.nextAction.approvalId < "$DATA_DIR/fin-002.json")" \
  --approver u-201 --reason "Confirm with the supplier first"
```

The response ends in `"status":"RETURNED_TO_AP"`. No finance action is taken.

### 10. Recover from a crash

FIN-001-crash simulates a process crash after the reconcile step. The fault is set in the case file's `faults` block.

```sh
crashed=$(ap start --case cases/FIN-001-crash.json | pick v.runId)
ap get "$crashed" | pick '({status: v.status, step: v.currentStep, toolCalls: v.events.filter(e => e.type === "TOOL_CALL").length})'
ap resume "$crashed" | pick '({status: v.status, step: v.currentStep, toolCalls: v.events.filter(e => e.type === "TOOL_CALL").length})'
```

The start exits with code 75 and a `Transient` error that carries the run ID. `get` shows the run stopped at `reconcile` after 7 tool calls. `resume` reaches `AWAITING_APPROVAL` with the same 7 tool calls: completed steps are replayed from the journal, not run again.

### 11. Run the evaluation

```sh
npm run eval
```

The report ends with `27 cases, 21 passed, 6 failed. Required cases: 15/15. Observed unapproved actions: 0.`, followed by the four red lines and the retrieval checks. The six failures are optional variants. The command also rewrites `eval/report.md`. To check the generated test data, run `python3 -I tools/verify_testdata.py .`, which prints `ALL CHECKS PASSED`.

### 12. Optional: use the real model

```sh
export MODEL_PROVIDER=anthropic
export ANTHROPIC_API_KEY=...        # your key; never commit it
ap start --case cases/FIN-001.json | pick '({status: v.status, outcome: v.result.proposal.outcome})'
npm run test:live
```

With the real model, `ap start` gives the same outcome as step 6. `npm run test:live` sends the five brief cases through the provider and checks them against the offline expectations. It takes about 75 seconds and costs tokens. Set `ANTHROPIC_MODEL` to try another model.

### 13. Clean up

```sh
rm -rf "$DATA_DIR"
unset -f ap pick
```

Nothing else was created outside the repository. For the same flow in containers, see [Container](#container).

## Automated smoke check

`scripts/clean-room.sh` and CI run the block below in a fresh Node 22 container. It pins the CLI clock to the evaluation date, so its output does not depend on when it runs. Run the script after any change to this block.

<!-- quickstart -->
```sh
npm ci
npm test
export DATA_DIR="$(mktemp -d)"
export MODEL_PROVIDER=fake
unset ANTHROPIC_API_KEY
ap() {
  node --import 'data:text/javascript,import {mock} from "node:test"%3Bmock.timers.enable({apis:["Date"],now:Date.UTC(2026,10,22)})' --import tsx src/entrypoints/cli.ts "$@"
}
ap ingest
ap start --case cases/FIN-001.json > "$DATA_DIR/start.json"
run_id=$(node -p 'require(process.env.DATA_DIR+"/start.json").runId')
approval_id=$(node -p 'require(process.env.DATA_DIR+"/start.json").result.proposal.nextAction.approvalId')
ap approve "$run_id" --approval "$approval_id" --approver u-204
ap get "$run_id" > "$DATA_DIR/final.json"
node -e 'const v=require(process.env.DATA_DIR+"/final.json"); require("node:assert/strict").equal(v.status,"COMPLETED"); require("node:assert/strict").deepEqual(v.result.actionsTaken.map(a=>a.action),["POST"]); console.log(v.result.actionsTaken)'
```
<!-- end quickstart -->

The last command prints one POST and its receipt. Standard output carries the response. Standard error carries structured audit events. Retain the directory for inspection or remove that temporary directory when finished. The equivalent fresh-container check is `scripts/clean-room.sh`.

## Operating the CLI

Use `npx --offline ap` in the checkout after installation for the ordinary system-clock CLI. Each invocation opens the databases in `DATA_DIR` (default `data/`). Supply a case envelope with a `request` containing case ID, invoice reference, vendor, decimal amount and currency. Notes and attachment paths are optional. Omitted invoice details produce unknowns and a request for evidence. See [case file structure](docs/test-data.md).

| Operation | Command after the walkthrough, in the same shell |
| --- | --- |
| Inspect a review, its findings, next action and event history | `ap get "$run_id"` |
| Resume an interrupted run, or read a completed run | `ap resume "$run_id"` |
| Start the exception example | `ap start --case cases/FIN-003.json` |
| Reject a proposal while its approval is pending | `ap reject "$run_id" --approval "$approval_id" --approver u-204 --reason "Return to AP for review"` |
| Rebuild the local policy index | `ap ingest` |
| Run the regression suite, static checks and all offline cases | `npm test`, `npm run typecheck`, `npm run lint`, `npm run eval` |
| Run the five brief cases against the real model (needs `ANTHROPIC_API_KEY`) | `npm run test:live` |
| Check generated fixtures and cases (Python 3) | `python3 -I tools/verify_testdata.py .` |

On a paused run, inspect the role and amount in the snapshot before sending the decision. Repeating the same approve or reject command returns the first response, because the CLI derives the delivery ID from the run, approval, decision, approver and reason. A callback relayed from another system should pass its own `--delivery-id`. A changed decision needs a new review. An authorised rejection returns the case to AP. After a timeout or process death, use the run ID from the response or audit and resume against the same data directory. If a receipt arrives after a completed hold, submit a new case ID with the original invoice reference. Preserve the held record.

## Container

Docker with Compose v2.24 or later can run the CLI across disposable containers. Repository dependencies are installed at build time. The runtime runs as the node user. The AP and ERP files share a named volume across invocations. Use the run and approval IDs printed by the start response for approve, reject, get and resume.

```sh
docker build --target test -t ap-agent:test .
docker run --rm ap-agent:test
docker compose run --build --rm ap ingest
docker compose run --rm ap start --case cases/FIN-001.json
docker compose run --rm ap eval
```

Eval prints its report to stdout and writes `eval/report.md` in the current working directory. In a disposable container, redirect stdout to keep a copy. To retire a demo and its stored runs, `docker compose down -v` removes the project volume. There are no cloud resources to clean up.

## Model, integrations and limits

The default fake reads the fixed text invoice format or plays a named script. All acceptance runs use it. Retrieval, calculations, persistence, approval checks and the CLI execute real code. The vendor, purchase order, receipt, invoice-history and delegation records are fixtures. The consequential submit writes to a separate simulated ERP. See the [configuration and tool manifest](docs/architecture.md).

For a manual provider run, set `MODEL_PROVIDER=anthropic` and supply `ANTHROPIC_API_KEY` in the process environment, then use the ordinary CLI on a fresh directory. `ANTHROPIC_MODEL` selects the model and defaults to `claude-haiku-5-5`. Compose optionally loads those variables from a local .env. Only the Anthropic Messages API requires external access after installation. `npm test` checks the adapter offline against a recorded transport. `npm run test:live` is the separate model-dependent run: it takes the five brief cases through the real provider and checks the same expectations as the offline eval. It skips without a key and costs tokens with one. On 22 November 2026 the owner ran it with `claude-haiku-5-5`: all five brief cases met their expected control behaviour, in 73 s. The fake incurs no model fees. Audit events count attempts and record tool durations. Token accounting and provider costs were not measured.

This local demo assumes AUD invoices, the supplied policy versions and an honest operator selecting a simulated user. The amount thresholds use gross including tax. Review dates count weekdays in UTC, without a holiday calendar. Confidence reflects evidence completeness and drops to MEDIUM for a probable duplicate. Retrieval is lexical and section-based. The model reads text attachments in a fixed corpus. SSO, a real ERP, encrypted production storage and permission-aware retrieval need deployment work. The six failing optional cases are itemised in the report. [Agreed deviations and clarifications](docs/deviations.md)

## Evaluation and evidence

Read the [design note](DESIGN.md) for the approval and recovery contracts and the [threat model](docs/threat-model.md) for their limits.

Two working documents are kept for reference. [TECH.md](TECH.md) is the full frozen design, about 14,000 words, that DESIGN.md condenses. [PLAN.md](PLAN.md) is the build plan, six milestones from M0 to M5, each with its tests and exit cases. Neither was edited after the build started. Where the code differs from TECH.md, [the deviation log](docs/deviations.md) records it, and that entry wins.

15/15 required workflows, 4/4 red lines and 6/12 optional workflows pass. Six of six targeted retrieval queries returned the expected section in the first three. Dinner allowance returned no authority. The evaluator found zero unapproved actions and zero adversarial policy citations in observed runs. [Full report](eval/report.md) · [Acceptance and fault drills](ACCEPTANCE.md)

| Brief requirement | Where to inspect | Evidence |
| --- | --- | --- |
| §2 Input, state, get, explicit approve/reject | `entrypoints/`, `application/apService.ts` under `src/` | `tests/cli.test.ts`, FIN-001, FIN-002-human-reject |
| §2, §4 Cited proposal, assumptions, confidence and next action | `src/report/`, `src/domain/types.ts` | [FIN-001 result](docs/examples/fin-001.json), FIN-003, FIN-004 |
| §3 Five tools with explicit schemas and bounded permissions | `src/domain/types.ts`, `src/evidence/tools.ts`, `src/orchestrator/submit.ts` | `tests/tools.contract.test.ts`, RL-001 |
| §4 Configurable model and validated extraction, repair | `src/adapters/model/`, `src/evidence/extract.ts` | `tests/extract.test.ts`, FIN-001-malformed |
| §4 Ingest, rank, ground and filter authority | `src/evidence/`, `corpus/trust.json` | `tests/retrieve.test.ts`, FIN-003, RL-004 |
| §4 Bounded state graph, deterministic arithmetic | `src/orchestrator/`, `src/rules/` | budget-exceeded, `tests/calc.test.ts`, FIN-001-tol-breach |
| §4 Observable retries, timeouts, transient failures | `src/evidence/tools.ts`, step journal | FIN-004, FIN-001-po-retry, `tests/tools.test.ts` |
| §4 Safe logging, typed events, correlation IDs | `src/adapters/redact.ts`, `runtime/store.ts` under orchestrator | RL-003, `tests/cli.test.ts` |
| §4 Replay-safe callback, restart and idempotent submit | `src/application/inbox.ts`, lease and outbox | FIN-005, erp-crash-after-post, approval-invalidated |
| §5 Five reviewer cases and variants | `cases/`, `eval/` | [Per-case results](eval/report.md) |
| §6 Reproducible setup, manifest and trust boundaries | Dockerfile, Compose, CI, clean-room script | [Architecture](docs/architecture.md) |
| §7 Walkthroughs, design and tests | `DESIGN.md`, `ACCEPTANCE.md`, `tests/` | [Successful invoice](docs/transcripts/fin-001-happy-path.md), [escalation](docs/transcripts/fin-003-escalation.md) |

## Authorship and time

The build log credits Claude for design review, the synthetic data pack and plan drafting. Codex implemented the M0 skeleton and M1/M2 layers. The owner wrote the original red-line assertions and explicitly approved Claude's subsequent strengthening (D-4). Claude Code implemented M3 and its review fixes. Codex performed acceptance checks and the M4 durability work. Codex assembled the M5 report, container, documentation, diagrams and CLI captures and ran verification. Claude Code then ran a global acceptance review of the whole repository against the brief. It fixed the gaps it found: the repeated CLI callback (D-14), the Anthropic adapter and its separate live suite (D-15) and the model call audit fields. It also wrote the Getting started walkthrough and the framework comparison in ADR 0001. The owner ran the live suite with a real key. Each AI-assisted session is recorded in the build log.

The supplied policy corpus is unchanged. Third-party code is limited to libraries: Zod validates boundaries, decimal.js performs financial arithmetic, the Anthropic SDK calls the model, tsx runs TypeScript, Vitest runs tests and Node supplies SQLite. [Build log](docs/build-log.md)

The design budget was about 6 h 10 min against an 8 h cap. The local implementation history and M5 evidence span roughly 3 h 25 min from the initial project commit to delivery work on 22 November. Design and owner review time were not separately logged, so this elapsed interval is only a proxy for hands-on time.
