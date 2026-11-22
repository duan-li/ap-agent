import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ingest } from '../src/evidence/ingest.ts';
import { loadCases } from '../eval/caseHarness.ts';
import { expect, it } from 'vitest';
import { durableRun, value } from './durableRun.ts';
it.each([
  ['erp-crash-after-post', 1, false, 'SENT'],
  ['erp-crash-before-post', 0, false, 'SENT'],
  ['erp-crash-after-post', 1, true, 'RECONCILE_REQUIRED'],
] as const)('recovers %s with %i postings and lookup failure %s', async (id, n, fail, status) => {
  const t = durableRun(id, { erpLookupFails: fail, budget: { maxToolCalls: n ? 11 : 15 } });
  try {
    const cmd = await t.command();
    await t.runtime.app.resolveApproval(cmd, t.meta('approve'));
    expect(t.runtime.db.prepare('SELECT status FROM outbox').get()?.status).toBe('SENDING');
    expect(t.runtime.erp.prepare('SELECT count(*) n FROM erp_postings').get()?.n).toBe(n);
    t.reopen();
    if (n)
      expect(value(await t.runtime.app.getRun(cmd.runId, t.meta('inspect'))).budget.toolCalls).toBe(
        '11 of 11',
      );
    const final = value(await t.runtime.app.resume(cmd.runId, t.meta('resume')));
    expect(final.outbox?.status).toBe(status);
    expect(final.events.filter((e) => e.type === 'ERP_LOOKUP')).toHaveLength(1);
    expect(final.events.filter((e) => e.name === 'submit_finance_decision')).toHaveLength(1);
  } finally {
    t.close();
  }
});

it('cancels a confirmed unsent intent when recovery has no tool budget', async () => {
  const t = durableRun('erp-crash-before-post', { budget: { maxToolCalls: 11 } });
  try {
    const cmd = await t.command();
    await t.runtime.app.resolveApproval(cmd, t.meta('approve'));
    t.reopen();
    const final = value(await t.runtime.app.resume(cmd.runId, t.meta('resume')));
    expect(final).toMatchObject({
      status: 'FAILED',
      failureReason: 'BUDGET_EXCEEDED',
      outbox: { status: 'CANCELLED' },
    });
    expect(final.events.filter((e) => e.type === 'ERP_LOOKUP')).toHaveLength(1);
    expect(final.events.filter((e) => e.name === 'submit_finance_decision')).toHaveLength(0);
  } finally {
    t.close();
  }
});

it('escalates a changed bank version before the first write', async () => {
  const t = durableRun('FIN-001');
  try {
    const cmd = await t.command();
    const record = t.runtime.vendorMaster().find((v) => v.vendorId === 'V-1007')!;
    record.bank.lastChangedAt = '2026-11-22';
    await t.runtime.app.resolveApproval(cmd, t.meta('approve'));
    const final = value(await t.runtime.app.getRun(cmd.runId, t.meta('get')));
    expect(final.result?.proposal.outcome).toBe('ESCALATE_CONTROL_REVIEW');
    expect(final.result?.exceptions.map((e) => e.code)).toContain('BANK_CHANGE');
    expect(final.outbox?.status).toBe('CANCELLED');
  } finally {
    t.close();
  }
});

it.each([false, true])(
  'invalidates changed authority on decision or unsent recovery (recovery=%s)',
  async (recovering) => {
    const t = durableRun(recovering ? 'erp-crash-before-post' : 'FIN-001');
    try {
      const cmd = await t.command();
      if (recovering) await t.runtime.app.resolveApproval(cmd, t.meta('first'));
      // Publish a new effective window in this worker's private index.
      const change = loadCases().find((c) => c.id === 'policy-version-changed')!.faults
        .policyVersionChangeBeforeSubmit!;
      const index = ingest();
      for (const chunk of [...index]) {
        if (chunk.documentId !== change.documentId) continue;
        index.push({ ...chunk, version: change.version, effectiveDate: change.effectiveDate });
        chunk.supersededDate = change.effectiveDate;
      }
      writeFileSync(join(t.dir, 'index.json'), JSON.stringify(index));
      t.reopen();
      if (recovering) await t.runtime.app.resume(cmd.runId, t.meta('resume'));
      else await t.runtime.app.resolveApproval(cmd, t.meta('first'));
      const final = value(await t.runtime.app.getRun(cmd.runId, t.meta('get')));
      expect(final.result?.exceptions.map((e) => e.code)).toContain('AUTHORITY_GAP');
      expect(final.result?.proposal.outcome).toBe('HOLD_FOR_INFORMATION');
      expect(t.runtime.erp.prepare('SELECT count(*) n FROM erp_postings').get()?.n).toBe(0);
      expect(final.outbox?.status ?? null).toBe(recovering ? 'CANCELLED' : null);
    } finally {
      t.close();
    }
  },
);
