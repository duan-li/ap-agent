# Accounts payable review agent

Review an invoice, inspect the evidence behind the proposal and record a human decision before the local ERP simulator can post. FIN-001 walks through all three steps. FIN-003 shows what AP sees when a supplier requests a bank change.

## First completed case

From the repository root, use a POSIX shell, Node 22.23.5 or a compatible Node 22 with built-in SQLite, and npm. The install needs the npm registry. Everything after installation in this example runs locally. Use a fresh data directory to keep each walkthrough independent. The fixture delegation takes effect in November 2026. The walkthrough pins the CLI clock to the evaluation date using Node's test clock.

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
| Check generated fixtures and cases (Python 3) | `python3 -I tools/verify_testdata.py .` |

On a paused run, inspect the role and amount in the snapshot before sending the decision. Use a stable `--delivery-id` on retries of the same callback. A changed decision needs a new review. An authorised rejection returns the case to AP. After a timeout or process death, use the run ID from the response or audit and resume against the same data directory. If a receipt arrives after a completed hold, submit a new case ID with the original invoice reference. Preserve the held record.

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

For a manual provider run, set `MODEL_PROVIDER=anthropic` and supply `ANTHROPIC_API_KEY` in the process environment, then use the ordinary CLI on a fresh directory. Compose optionally loads those variables from a local .env. Only the Anthropic Messages API requires external access after installation. The live adapter was not exercised in this delivery because a key was unavailable. The fake incurs no model fees. Audit events count attempts and record tool durations. Token accounting and provider costs were not measured.

This local demo assumes AUD invoices, the supplied policy versions and an honest operator selecting a simulated user. The amount thresholds use gross including tax. Review dates count weekdays in UTC, without a holiday calendar. Confidence reflects evidence completeness. Retrieval is lexical and section-based. The model reads text attachments in a fixed corpus. SSO, a real ERP, encrypted production storage and permission-aware retrieval need deployment work. The seven failing optional cases are itemised in the report. [Agreed deviations and clarifications](docs/deviations.md)

## Evaluation and evidence

Read the [design note](DESIGN.md) for the approval and recovery contracts and the [threat model](docs/threat-model.md) for their limits.

15/15 required workflows, 4/4 red lines and 5/12 optional workflows pass. Six of six targeted retrieval queries returned the expected section in the first three. Dinner allowance returned no authority. The evaluator found zero unapproved actions and zero adversarial policy citations in observed runs. [Full report](eval/report.md) · [Acceptance and fault drills](ACCEPTANCE.md)

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

The build log credits Claude for design review, the synthetic data pack and plan drafting. Codex implemented the M0 skeleton and M1/M2 layers. The owner wrote the original red-line assertions and explicitly approved Claude's subsequent strengthening (D-4). Claude Code implemented M3 and its review fixes. Codex performed acceptance checks and the M4 durability work. Codex assembled the M5 report, container, documentation, diagrams and CLI captures and ran verification. The supplied policy corpus is unchanged. Zod validates boundaries, decimal.js performs financial arithmetic, Vitest runs tests and Node supplies SQLite. [Build log](docs/build-log.md)

The design budget was about 6 h 10 min against an 8 h cap. The local implementation history and M5 evidence span roughly 3 h 25 min from the initial project commit to delivery work on 22 November. Design and owner review time were not separately logged, so this elapsed interval is only a proxy for hands-on time.
