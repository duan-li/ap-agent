import type { DatabaseSync } from 'node:sqlite';
import {
  runResult,
  type Review,
  type OutboxStatus,
  type RequestMeta,
  type RunView,
} from '../../domain/types.ts';
import type { Clock } from '../../adapters/clock.ts';

export class Store {
  constructor(
    readonly db: DatabaseSync,
    readonly clock: Clock,
    readonly redact: (s: string) => string,
    readonly log: (s: string) => void,
  ) {}
  json(value: unknown) {
    return JSON.stringify(value, (_key, field: unknown) =>
      typeof field === 'string' ? this.redact(field) : field,
    );
  }
  event(runId: string, meta: RequestMeta, type: string, fields: Record<string, unknown> = {}) {
    const ts = this.clock.now().toISOString();
    const json = this.json({ ...fields, ts, type, runId, correlationId: meta.correlationId });
    const event = this.db
      .prepare('INSERT INTO events(run_id,ts,event_json) VALUES(?,?,?)')
      .run(runId, ts, json);
    this.log(json);
    return 'evt_' + event.lastInsertRowid;
  }
  save(result: Review, step: string) {
    this.db
      .prepare('UPDATE runs SET state=?,current_step=?,result_json=? WHERE id=?')
      .run(result.status, step, this.json(runResult.parse(result)), result.runId);
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
    const count = (name: string) => events.filter((e) => e.type === name).length;
    return {
      runId: id,
      caseId: String(row.case_id),
      status: row.state as RunView['status'],
      currentStep: String(row.current_step),
      result: row.result_json ? runResult.parse(JSON.parse(String(row.result_json))) : null,
      events,
      budget: {
        steps: count('STEP_COMPLETED') + ' of 20',
        toolCalls: count('TOOL_CALL') + ' of 15',
        modelCalls: count('MODEL_CALL') + ' of 6',
      },
      outbox: out
        ? { status: out.status as OutboxStatus, postingRef: out.posting_ref as string | null }
        : null,
    };
  }
}
