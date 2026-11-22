import { expect, it } from 'vitest';
import { loadCases } from '../eval/caseHarness.ts';
import { openTestRun } from '../eval/testRun.ts';
import type { RequestMeta, RunView } from '../src/application/apService.ts';
import { caseFile, type WorkflowCase } from '../src/domain/types.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openApp } from '../src/entrypoints/handle.ts';
import { FakeModel } from '../src/adapters/model/fake.ts';
import { FixedClock, seededIds } from '../src/adapters/clock.ts';

const start = Date.parse('2026-11-22T00:00:00Z');
function meta(deliveryId: string, deadline = start + 60_000, actor = 'operator'): RequestMeta {
  return {
    source: 'cli',
    correlationId: 'test',
    deliveryId,
    actor: { id: actor, via: 'cli-flag' },
    deadline,
    signal: new AbortController().signal,
  };
}
function find(id: string) {
  return loadCases().find((c) => c.id === id)!;
}
const calls = (view: RunView, name?: string) =>
  view.events.filter((e) => e.type === 'TOOL_CALL' && (!name || e.name === name));

async function withRun(
  setup: Pick<WorkflowCase, 'id' | 'faults' | 'modelScript'>,
  body: (run: Awaited<ReturnType<typeof openTestRun>>) => Promise<void>,
) {
  const run = await openTestRun(setup);
  try {
    await body(run);
  } finally {
    run.close();
  }
}
async function started(run: Awaited<ReturnType<typeof openTestRun>>, c: WorkflowCase) {
  const reply = await run.app.startRun(c.request, meta('start'));
  if (reply.kind !== 'ok') throw new Error('Start failed: ' + JSON.stringify(reply));
  return reply.value;
}

it('continues after one transient PO error, with the failed attempt audited', async () => {
  const c = find('FIN-001');
  await withRun({ ...c, faults: { get_purchase_order: { transientTimes: 1 } } }, async (run) => {
    const view = await started(run, c);
    expect(view.status).toBe('AWAITING_APPROVAL');
    expect(calls(view, 'get_purchase_order').map((e) => [e.attempt, e.outcome])).toEqual([
      [1, 'TRANSIENT'],
      [2, 'OK'],
    ]);
  });
});

it('holds FIN-004 with the receipt unverified and nothing written', async () => {
  const c = find('FIN-004');
  await withRun(c, async (run) => {
    const view = await started(run, c);
    const r = view.result!;
    expect(view.status).toBe('COMPLETED');
    expect(r.proposal).toEqual({
      outcome: 'HOLD_FOR_INFORMATION',
      nextAction: {
        owner: 'requester or receipter',
        action:
          'Provide the goods receipt for PO-55388; AP then re-submits the invoice as a new run',
      },
    });
    expect(r.unknowns).toEqual(['purchase_order:PO-55388', 'goods_receipt:PO-55388']);
    expect(r.calculations.find((x) => x.id === 'C-RECEIPT')?.result).toEqual({
      verification: 'UNVERIFIED',
    });
    const [exception] = r.exceptions;
    expect(exception).toMatchObject({ code: 'MISSING_RECEIPT', owner: 'requester or receipter' });
    expect(exception!.observed).toContain('Unable to verify goods receipt for PO-55388');
    expect(exception!.observed).toContain('3 attempts');
    expect(exception!.observed.toLowerCase()).not.toContain('no goods receipt exists');
    // The invoice says "Goods delivered"; that text is never receipt evidence.
    expect(JSON.stringify(r.sourcedFacts)).not.toContain('Goods delivered');
    expect(r.decisionSummary.missingEvidence).toEqual(r.unknowns);
    expect(view.events.some((e) => e.type === 'APPROVAL_REQUESTED')).toBe(false);
    expect(run.financeWrites()).toBe(0);
    const before = view.events.length;
    const resumed = await run.app.resume(view.runId, meta('resume'));
    expect(resumed).toMatchObject({ kind: 'ok', value: { status: 'COMPLETED', result: r } });
    if (resumed.kind === 'ok') expect(resumed.value.events).toHaveLength(before);
  });
});

it('reports a receipt confirmed absent differently from an unverified one', async () => {
  const c = find('FIN-004-po-recovered-no-receipt');
  await withRun(c, async (run) => {
    const r = (await started(run, c)).result!;
    expect(r.unknowns).toEqual([]);
    expect(r.exceptions.map((e) => [e.code, e.observed])).toEqual([
      ['MISSING_RECEIPT', 'No goods receipt exists for PO-55388'],
    ]);
  });
});

it('repairs malformed model output once and audits both events', async () => {
  const c = find('FIN-001-malformed');
  await withRun(c, async (run) => {
    const view = await started(run, c);
    const types = view.events.map((e) =>
      e.type === 'MODEL_CALL' ? 'MODEL_CALL:' + e.purpose : e.type,
    );
    const extract = types.filter((t) => /MODEL_(CALL:extract|OUTPUT)/.test(t));
    expect(extract).toEqual([
      'MODEL_CALL:extract',
      'MODEL_OUTPUT_INVALID',
      'MODEL_CALL:extract-repair',
      'MODEL_OUTPUT_REPAIRED',
    ]);
    expect(view.events.find((e) => e.type === 'MODEL_OUTPUT_INVALID')?.issue).toBe(
      'Response is not valid JSON',
    );
    expect(view.result?.sourcedFacts.find((f) => f.id === 'invoiceNumber')?.value).toBe(
      'INV-88412',
    );
    // The repaired reading states no line amounts; Rules derive them (D-10).
    expect(view.status).toBe('AWAITING_APPROVAL');
    expect(view.result?.proposal.outcome).toBe('APPROVE_FOR_POSTING');
    expect(view.result?.unknowns).toEqual([]);
    expect(
      view.result?.calculations
        .filter((c) => c.check === 'LINE_AMOUNT_DERIVED')
        .map((c) => [c.line, c.result.expected]),
    ).toEqual([
      [1, '12000.00'],
      [2, '4000.00'],
    ]);
    expect(view.result?.assumptions).toEqual(
      expect.arrayContaining([expect.stringContaining('Line 1 amount is computed')]),
    );
    expect(run.financeWrites()).toBe(0);
  });
});

it('fails cleanly when the repair is invalid too, and resume makes no calls', async () => {
  const c = find('FIN-001-malformed');
  const setup = { ...c, modelScript: 'fixtures/model_scripts/FIN-001-malformed-twice.json' };
  await withRun(setup, async (run) => {
    const view = await started(run, c);
    expect(view).toMatchObject({
      status: 'FAILED',
      failureReason: 'MODEL_OUTPUT_INVALID_AFTER_REPAIR',
      result: null,
    });
    expect(view.events.filter((e) => e.type === 'MODEL_OUTPUT_INVALID')).toHaveLength(2);
    expect(view.events.some((e) => e.type === 'MODEL_OUTPUT_REPAIRED')).toBe(false);
    expect(calls(view)).toHaveLength(0);
    expect(run.financeWrites()).toBe(0);
    const resumed = await run.app.resume(view.runId, meta('resume'));
    if (resumed.kind !== 'ok') throw new Error('Resume failed');
    expect(resumed.value.status).toBe('FAILED');
    expect(resumed.value.events).toHaveLength(view.events.length);
  });
});

it('stops budget-exceeded at its tool limit, and resume makes no further calls', async () => {
  const c = find('budget-exceeded');
  await withRun(c, async (run) => {
    const view = await started(run, c);
    expect(view).toMatchObject({ status: 'FAILED', failureReason: 'BUDGET_EXCEEDED' });
    expect(view.budget.toolCalls).toBe('4 of 4');
    expect(calls(view)).toHaveLength(4);
    expect(view.events.find((e) => e.type === 'BUDGET_EXCEEDED')).toMatchObject({
      limit: 'tool_calls',
      max: 4,
    });
    const resumed = await run.app.resume(view.runId, meta('resume'));
    if (resumed.kind !== 'ok') throw new Error('Resume failed');
    expect(resumed.value.status).toBe('FAILED');
    expect(calls(resumed.value)).toHaveLength(4);
  });
});

it('keeps spent budget across a deadline and resume', async () => {
  const c = find('budget-exceeded');
  await withRun({ ...c, faults: { ...c.faults, budget: { maxToolCalls: 6 } } }, async (run) => {
    // Vendor, then PO attempts at 0 and 100 ms. The next backoff would end
    // past the 150 ms deadline, so three tool calls are spent.
    const first = await run.app.startRun(c.request, meta('start', start + 150));
    expect(first).toMatchObject({ kind: 'error', error: { type: 'DeadlineExceeded' } });
    if (first.kind !== 'error' || first.error.type !== 'DeadlineExceeded') return;
    const runId = first.error.runId!;
    const paused = await run.app.getRun(runId, meta('read'));
    expect(paused).toMatchObject({ kind: 'ok', value: { status: 'RUNNING' } });
    if (paused.kind === 'ok') expect(paused.value.budget.toolCalls).toBe('3 of 6');
    const resumed = await run.app.resume(runId, meta('resume', start + 60_000));
    expect(resumed).toMatchObject({
      kind: 'ok',
      value: {
        status: 'FAILED',
        failureReason: 'BUDGET_EXCEEDED',
        budget: { toolCalls: '6 of 6' },
      },
    });
  });
});

it('refuses an approved submit when no tool call is left, and cancels the intent', async () => {
  const c = find('FIN-001');
  // The review spends 7 tool calls; the pre-submit checks spend 2 more.
  await withRun({ ...c, faults: { budget: { maxToolCalls: 9 } } }, async (run) => {
    const view = await started(run, c);
    const next = view.result!.proposal.nextAction;
    if (!('approvalId' in next)) throw new Error('No approval requested');
    const reply = await run.app.resolveApproval(
      { runId: view.runId, approvalId: next.approvalId, decision: 'APPROVE' },
      meta('approve', start + 60_000, 'u-204'),
    );
    expect(reply).toMatchObject({ kind: 'ok', value: { status: 'FAILED' } });
    const final = await run.app.getRun(view.runId, meta('read'));
    expect(final).toMatchObject({
      kind: 'ok',
      value: { failureReason: 'BUDGET_EXCEEDED', outbox: { status: 'CANCELLED' } },
    });
    expect(run.submitAttempts()).toBe(0);
    expect(run.financeWrites()).toBe(0);
  });
});

it('counts the repair against the model budget', async () => {
  const c = find('FIN-001-malformed');
  await withRun({ ...c, faults: { budget: { maxModelCalls: 1 } } }, async (run) => {
    const view = await started(run, c);
    expect(view).toMatchObject({ status: 'FAILED', failureReason: 'BUDGET_EXCEEDED' });
    expect(view.events.filter((e) => e.type === 'MODEL_CALL')).toHaveLength(1);
  });
});

it('counts executed steps against the step budget', async () => {
  const c = find('FIN-001');
  await withRun({ ...c, faults: { budget: { maxSteps: 2 } } }, async (run) => {
    const view = await started(run, c);
    expect(view).toMatchObject({
      status: 'FAILED',
      failureReason: 'BUDGET_EXCEEDED',
      budget: { steps: '2 of 2' },
    });
    expect(view.events.filter((e) => e.type === 'STEP_COMPLETED')).toHaveLength(2);
  });
});

async function approve(run: Awaited<ReturnType<typeof openTestRun>>, view: RunView) {
  const next = view.result!.proposal.nextAction;
  if (!('approvalId' in next)) throw new Error('No approval requested');
  return run.app.resolveApproval(
    { runId: view.runId, approvalId: next.approvalId, decision: 'APPROVE' },
    meta('approve', start + 60_000, 'u-204'),
  );
}

// FIN-001 takes seven steps: extract, gather, reconcile, report,
// request_approval, resolve_approval and submit.
it.each([
  { maxSteps: 4, requested: false, decided: false, outbox: null, posted: 0 },
  { maxSteps: 5, requested: true, decided: false, outbox: null, posted: 0 },
  { maxSteps: 6, requested: true, decided: true, outbox: 'CANCELLED', posted: 0 },
  { maxSteps: 7, requested: true, decided: true, outbox: 'SENT', posted: 1 },
])('charges every step, and writes only within maxSteps $maxSteps', async (row) => {
  const c = find('FIN-001');
  await withRun({ ...c, faults: { budget: { maxSteps: row.maxSteps } } }, async (run) => {
    const view = await started(run, c);
    if (row.requested) await approve(run, view);
    const final = await run.app.getRun(view.runId, meta('read'));
    if (final.kind !== 'ok') throw new Error('Read failed');
    const has = (type: string) => final.value.events.some((e) => e.type === type);
    expect(final.value.budget.steps).toBe(row.maxSteps + ' of ' + row.maxSteps);
    expect(final.value.events.filter((e) => e.type === 'STEP_COMPLETED')).toHaveLength(
      row.maxSteps,
    );
    expect(final.value.status).toBe(row.posted ? 'COMPLETED' : 'FAILED');
    if (!row.posted) expect(final.value.failureReason).toBe('BUDGET_EXCEEDED');
    expect([has('APPROVAL_REQUESTED'), has('APPROVAL_DECIDED')]).toEqual([
      row.requested,
      row.decided,
    ]);
    expect(final.value.outbox?.status ?? null).toBe(row.outbox);
    expect(run.submitAttempts()).toBe(row.posted);
    expect(run.financeWrites()).toBe(row.posted);
  });
});

it('rejects a case that raises a budget limit', () => {
  const c = find('budget-exceeded');
  for (const budget of [{ maxSteps: 21 }, { maxToolCalls: 16 }, { maxModelCalls: 7 }])
    expect(caseFile.safeParse({ ...c, faults: { budget } }).success).toBe(false);
});

it('never stores limits above the defaults, even without the case schema', async () => {
  const c = find('FIN-004');
  const raised = { budget: { maxSteps: 21, maxToolCalls: 16, maxModelCalls: 7 } };
  await withRun({ ...c, faults: raised as WorkflowCase['faults'] }, async (run) => {
    const view = await started(run, c);
    const limits = Object.values(view.budget).map((used) => used.split(' of ')[1]);
    expect(limits).toEqual(['20', '15', '6']);
  });
});

it('discards a model reply that arrives after the request deadline', async () => {
  const c = find('FIN-001');
  const dir = mkdtempSync(join(tmpdir(), 'ap-slow-'));
  const clock = new FixedClock('2026-11-22T00:00:00Z');
  const fake = new FakeModel();
  // A slow model: the reply arrives two seconds later on the injected clock.
  const model = {
    call: async (...args: Parameters<FakeModel['call']>) => {
      clock.advance(2000);
      return fake.call(...args);
    },
  };
  const runtime = openApp(dir, { model, clock, ids: seededIds('slow') }, () => {});
  try {
    const reply = await runtime.app.startRun(c.request, meta('start', start + 500));
    expect(reply).toMatchObject({ kind: 'error', error: { type: 'DeadlineExceeded' } });
    if (reply.kind !== 'error' || reply.error.type !== 'DeadlineExceeded') return;
    const view = await runtime.app.getRun(reply.error.runId!, meta('read', start + 60_000));
    expect(view).toMatchObject({ kind: 'ok', value: { status: 'RUNNING', result: null } });
    if (view.kind === 'ok')
      expect(view.value.events.some((e) => e.type === 'STEP_COMPLETED')).toBe(false);
  } finally {
    runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('sends once the intent is SENDING, even if the deadline passes at that moment', async () => {
  const c = find('FIN-001');
  const dir = mkdtempSync(join(tmpdir(), 'ap-sending-'));
  const clock = new FixedClock('2026-11-22T00:00:00Z');
  const deadline = start + 60_000;
  const lines: string[] = [];
  // The deadline expires exactly between SENDING and the first ERP call.
  const log = (line: string) => {
    lines.push(line);
    if (JSON.parse(line).type === 'OUTBOX_SENDING') clock.advance(deadline - clock.now().getTime());
  };
  const runtime = openApp(dir, { model: new FakeModel(), clock, ids: seededIds('send') }, log);
  try {
    const view = await runtime.app.startRun(c.request, meta('start', deadline));
    if (view.kind !== 'ok') throw new Error('Start failed');
    const next = view.value.result!.proposal.nextAction;
    if (!('approvalId' in next)) throw new Error('No approval requested');
    const reply = await runtime.app.resolveApproval(
      { runId: view.value.runId, approvalId: next.approvalId, decision: 'APPROVE' },
      meta('approve', deadline, 'u-204'),
    );
    expect(reply).toMatchObject({ kind: 'ok', value: { status: 'COMPLETED' } });
    const final = await runtime.app.getRun(view.value.runId, meta('read', deadline + 60_000));
    expect(final).toMatchObject({ kind: 'ok', value: { outbox: { status: 'SENT' } } });
    const submits = lines.filter((l) => JSON.parse(l).name === 'submit_finance_decision');
    expect(submits).toHaveLength(1);
    expect(runtime.erp.prepare('SELECT count(*) n FROM erp_postings').get()?.n).toBe(1);
  } finally {
    runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
