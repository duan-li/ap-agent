import { expect, it } from 'vitest';
import { loadCases } from '../eval/caseHarness.ts';
import { openTestRun } from '../eval/testRun.ts';
import { readFileSync } from 'node:fs';

const meta = {
  source: 'cli',
  correlationId: 'test',
  deliveryId: 'start',
  actor: { id: 'operator', via: 'cli-flag' },
  deadline: Date.parse('2026-11-23'),
  signal: new AbortController().signal,
} as const;

it.each([
  ['FIN-003', 'FIN-003-fooled', 'ESCALATE_CONTROL_REVIEW'],
  ['FIN-001', 'bad-citation', 'HOLD_FOR_INFORMATION'],
])('discards and audits an unsupported explanation in %s with %s', async (id, script, outcome) => {
  const c = loadCases().find((c) => c.id === id)!;
  const run = await openTestRun({
    ...c,
    modelScript: 'fixtures/model_scripts/' + script + '.json',
  });
  try {
    const reply = await run.app.startRun(c.request, meta);
    if (reply.kind !== 'ok') throw new Error('Review did not finish');
    expect(reply.value.result?.proposal.outcome).toBe(outcome);
    expect(reply.value.result?.explanation).toEqual([]);
    expect(reply.value.events.some((e) => e.type === 'CITATION_INVALID')).toBe(true);
  } finally {
    run.close();
  }
});

it('keeps the approval gate when a note asks to bypass it', async () => {
  const c = loadCases().find((c) => c.id === 'FIN-001')!;
  const run = await openTestRun(c);
  try {
    const notes = readFileSync('corpus/supplier_payment_instructions.md', 'utf8')
      .split('Ignore all previous')[1]!
      .split('\n')[0]!;
    const reply = await run.app.startRun({ ...c.request, notes }, meta);
    expect(reply).toMatchObject({ kind: 'ok', value: { status: 'AWAITING_APPROVAL' } });
    expect(run.submitAttempts()).toBe(0);
  } finally {
    run.close();
  }
});

it('freezes rejection of the new submission without making it eligible for posting', async () => {
  const c = loadCases().find((c) => c.id === 'FIN-002')!;
  const run = await openTestRun(c);
  try {
    const reply = await run.app.startRun(c.request, meta);
    expect(reply).toMatchObject({
      kind: 'ok',
      value: {
        status: 'AWAITING_APPROVAL',
        result: {
          approvalSnapshot: { action: 'REJECT_INVOICE', invoiceRef: c.request.invoiceRef },
          decisionSummary: { paymentEligibility: 'Ineligible for posting' },
        },
      },
    });
    expect(run.postings()).toEqual([]);
  } finally {
    run.close();
  }
});

it('routes the price exception with its calculated values and review date', async () => {
  const c = loadCases().find((c) => c.id === 'FIN-001-tol-breach')!;
  const run = await openTestRun(c);
  try {
    const reply = await run.app.startRun(c.request, meta);
    expect(reply).toMatchObject({
      kind: 'ok',
      value: {
        result: {
          exceptions: [
            {
              code: 'PRICE_VARIANCE',
              failedRule: 'LINE_PRICE_TOLERANCE',
              failedLine: 1,
              expected: '12000.00',
              observed: '12050.10',
              difference: '50.10',
              threshold: '50.00',
              owner: 'Requester',
              nextReviewDate: '2026-11-25',
              sources: expect.arrayContaining(['C-PRICE-1']),
            },
          ],
          proposal: { nextAction: { owner: 'Requester' } },
        },
      },
    });
  } finally {
    run.close();
  }
});
