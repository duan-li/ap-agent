import { checkOwner } from './lease.ts';
import type { DatabaseSync } from 'node:sqlite';
import {
  durabilityFaults,
  runResult,
  type Review,
  type OutboxStatus,
  type RequestMeta,
  type RunView,
} from '../../domain/types.ts';
import type { Clock } from '../../adapters/clock.ts';
import { transaction } from '../../adapters/migrate.ts';
import { WorkflowError, BudgetExceeded, type BudgetKind, type RunFailure } from '../errors.ts';

export interface BudgetLimits {
  maxSteps: number;
  maxToolCalls: number;
  maxModelCalls: number;
}
export const defaultBudget: BudgetLimits = { maxSteps: 20, maxToolCalls: 15, maxModelCalls: 6 };

export class Store {
  constructor(
    readonly db: DatabaseSync,
    readonly clock: Clock,
    readonly redact: (s: string) => string,
    readonly log: (s: string) => void,
  ) {}
  write<T>(work: () => T): T {
    if (this.db.isTransaction) {
      checkOwner(this);
      return work();
    }
    return transaction(this.db, () => {
      checkOwner(this);
      return work();
    });
  }
  simulation(id: string) {
    const row = this.db.prepare('SELECT simulation_json FROM runs WHERE id=?').get(id)!;
    return durabilityFaults.parse(JSON.parse(String(row.simulation_json)));
  }
  crash(
    id: string,
    point: 'crashAfterStep' | 'crashAfterOutboxSending' | 'crashAfterErpPost',
    step?: string,
  ) {
    const settings = this.simulation(id);
    if (!settings[point] || (point === 'crashAfterStep' && settings[point] !== step)) return;
    delete settings[point];
    this.write(() =>
      this.db.prepare('UPDATE runs SET simulation_json=? WHERE id=?').run(this.json(settings), id),
    );
    throw new WorkflowError({ type: 'Transient', runId: id });
  }
  json(value: unknown) {
    return JSON.stringify(value, (_key, field: unknown) =>
      typeof field === 'string' ? this.redact(field) : field,
    );
  }
  event(runId: string, meta: RequestMeta, type: string, fields: Record<string, unknown> = {}) {
    const ts = this.clock.now().toISOString();
    const json = this.json({ ...fields, ts, type, runId, correlationId: meta.correlationId });
    const event = this.write(() =>
      this.db
        .prepare('INSERT INTO events(run_id,ts,event_json) VALUES(?,?,?)')
        .run(runId, ts, json),
    );
    this.log(json);
    return 'evt_' + event.lastInsertRowid;
  }
  save(result: Review, step: string) {
    this.db
      .prepare('UPDATE runs SET state=?,current_step=?,result_json=? WHERE id=?')
      .run(result.status, step, this.json(runResult.parse(result)), result.runId);
  }
  // Spends one unit of the persisted budget, or refuses when it is used up.
  // The counters live on the run row, so a resumed run inherits them.
  spend(runId: string, kind: BudgetKind) {
    const changed = this.write(
      () =>
        this.db
          .prepare(
            `UPDATE runs SET ${kind}_used=${kind}_used+1 WHERE id=? AND ${kind}_used<max_${kind}`,
          )
          .run(runId).changes,
    );
    if (!changed) throw new BudgetExceeded(kind, this.limit(runId, kind));
  }
  // Checks that one unit is left without spending it.
  ensure(runId: string, kind: BudgetKind) {
    const row = this.db
      .prepare(`SELECT ${kind}_used AS used, max_${kind} AS max FROM runs WHERE id=?`)
      .get(runId);
    if (!row || Number(row.used) >= Number(row.max))
      throw new BudgetExceeded(kind, this.limit(runId, kind));
  }
  private limit(runId: string, kind: BudgetKind) {
    return Number(
      this.db.prepare(`SELECT max_${kind} AS max FROM runs WHERE id=?`).get(runId)?.max,
    );
  }
  // Ends the run FAILED. A pending submit intent is cancelled, so nothing is
  // relayed later. An intent already SENDING is left for recovery.
  fail(runId: string, meta: RequestMeta, failure: RunFailure) {
    this.write(() => {
      if (failure.reason === 'BUDGET_EXCEEDED')
        this.event(runId, meta, 'BUDGET_EXCEEDED', failure.detail);
      this.db
        .prepare("UPDATE outbox SET status='CANCELLED' WHERE run_id=? AND status='PENDING'")
        .run(runId);
      const row = this.db.prepare('SELECT result_json FROM runs WHERE id=?').get(runId);
      if (row?.result_json) {
        const result = runResult.parse(JSON.parse(String(row.result_json)));
        result.status = 'FAILED';
        result.decisionSummary = {
          ...result.decisionSummary,
          paymentEligibility: 'Ineligible for posting',
          approvalStatus: 'No approval pending',
        };
        result.proposal.nextAction = {
          owner: 'Accounts Payable',
          action: 'Run failed (' + failure.reason + '); re-submit the invoice as a new run',
        };
        this.db
          .prepare('UPDATE runs SET result_json=? WHERE id=?')
          .run(this.json(runResult.parse(result)), runId);
      }
      this.db
        .prepare("UPDATE runs SET state='FAILED', failure_reason=? WHERE id=?")
        .run(failure.reason, runId);
      this.event(runId, meta, 'RUN_FAILED', { reason: failure.reason, ...failure.detail });
    });
  }
  view(id: string): RunView | null {
    const row = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id);
    if (!row) return null;
    const events = this.db
      .prepare('SELECT id,event_json FROM events WHERE run_id=? ORDER BY id')
      .all(id)
      .map((r) => ({
        ...JSON.parse(String(r.event_json)),
        eventId: 'evt_' + r.id,
      })) as RunView['events'];
    const out = this.db.prepare('SELECT status,posting_ref FROM outbox WHERE run_id=?').get(id);
    return {
      runId: id,
      caseId: String(row.case_id),
      status: row.state as RunView['status'],
      currentStep: String(row.current_step),
      result: row.result_json ? runResult.parse(JSON.parse(String(row.result_json))) : null,
      events,
      budget: {
        steps: row.steps_used + ' of ' + row.max_steps,
        toolCalls: row.tool_calls_used + ' of ' + row.max_tool_calls,
        modelCalls: row.model_calls_used + ' of ' + row.max_model_calls,
      },
      erpLookupCalls: events.filter((e) => e.type === 'ERP_LOOKUP').length,
      failureReason: row.failure_reason === null ? null : String(row.failure_reason),
      outbox: out
        ? { status: out.status as OutboxStatus, postingRef: out.posting_ref as string | null }
        : null,
    };
  }
}
