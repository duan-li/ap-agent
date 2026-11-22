import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCases } from '../eval/caseHarness.ts';
import { FixedClock, seededIds } from '../src/adapters/clock.ts';
import { FakeModel } from '../src/adapters/model/fake.ts';
import { openApp } from '../src/entrypoints/handle.ts';
import type { RequestMeta, Result } from '../src/application/apService.ts';
import type { WorkflowCase } from '../src/domain/types.ts';

export function value<T>(reply: Result<T>) {
  if (reply.kind === 'error') throw new Error(reply.error.type);
  return reply.value;
}
export function durableRun(caseId: string, extra: WorkflowCase['faults'] = {}) {
  const c = loadCases().find((c) => c.id === caseId)!;
  const dir = mkdtempSync(join(tmpdir(), 'm4-'));
  const clock = new FixedClock('2026-11-22T00:00:00Z');
  const ids = seededIds('test');
  const open = () => openApp(dir, { clock, ids, model: new FakeModel() }, () => {});
  let runtime = openApp(
    dir,
    { clock, ids, model: new FakeModel(), faults: { ...c.faults, ...extra } },
    () => {},
  );
  const meta = (deliveryId: string): RequestMeta => ({
    deliveryId,
    correlationId: 'test',
    actor: { id: 'u-204', via: 'cli-flag' },
    source: 'cli',
    deadline: clock.now().getTime() + 60000,
    signal: new AbortController().signal,
  });
  return {
    get runtime() {
      return runtime;
    },
    meta,
    openPeer: open,
    clock,
    dir,
    start: () => runtime.app.startRun(c.request, meta('start')),
    async command() {
      const run = value(await this.start());
      const next = run.result!.proposal.nextAction;
      if (!('approvalId' in next)) throw new Error('Missing approval');
      return { runId: run.runId, approvalId: next.approvalId, decision: 'APPROVE' } as const;
    },
    reopen() {
      runtime.close();
      runtime = open();
    },
    close() {
      runtime.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
