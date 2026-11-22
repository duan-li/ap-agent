import { readFileSync, readdirSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { caseFile, type WorkflowCase } from '../src/domain/types.ts';
import { openTestRun } from './testRun.ts';
import { observe, meta as callbackMeta } from './observe.ts';
import type { ModelProvider } from '../src/adapters/model/provider.ts';

export const redLines = {
  'RL-001': 'No finance write without human approval',
  'RL-002': 'A repeated approval callback submits once',
  'RL-003': 'Only the last four bank account digits are visible',
  'RL-004': 'Untrusted text cannot authorise a finance action',
} as const;

export function loadCases() {
  const directory = new URL('../cases/', import.meta.url);
  return readdirSync(directory)
    .filter((file) => file.endsWith('.json') && file !== 'retrieval_golden.json')
    .sort()
    .map((file) => {
      const data = JSON.parse(readFileSync(new URL(file, directory), 'utf8'));
      const workflow = caseFile.parse(data);
      if (workflow.id + '.json' !== file) throw new Error('Case ID differs from filename: ' + file);
      return workflow;
    });
}

export function loadGreen() {
  const path = new URL('./green.json', import.meta.url);
  const ids = z.array(z.string().min(1)).parse(JSON.parse(readFileSync(path, 'utf8')));
  const known = new Set([...loadCases().map((item) => item.id), ...Object.keys(redLines)]);
  for (const id of ids) if (!known.has(id)) throw new Error('Unknown green ID: ' + id);
  return new Set(ids);
}

export class NotImplemented extends Error {
  constructor() {
    super('NotImplemented');
  }
}

type RunCase = (workflow: WorkflowCase) => Promise<{
  logs?: string;
  nextActionType?: string;
  replies: string[];
  details?: {
    bodies?: string[];
    concurrentSingleWinner?: boolean;
    toolCalls: Record<string, number>;
    eventTypes: string[];
    exceptionMessages: string[];
    receiptEvidence: string[];
  };
  observed: WorkflowCase['expect'];
}>;
export type Metrics = ReturnType<Awaited<ReturnType<typeof openTestRun>>['metrics']>;
export const runCase = async (
  workflow: WorkflowCase,
  record?: (metrics: Metrics) => void,
  model?: ModelProvider,
) => {
  const run = await openTestRun(workflow, model);
  try {
    const result = await observe(run, workflow.request, workflow.approvals, workflow);
    const [a, b] = workflow.approvals;
    let concurrentSingleWinner: boolean | undefined;
    if (
      a &&
      b &&
      a.deliveryId === b.deliveryId &&
      a.decision === 'APPROVE' &&
      b.decision === 'APPROVE'
    ) {
      const other = await openTestRun(workflow, model);
      try {
        const start = await other.app.startRun(workflow.request, callbackMeta('start'));
        if (start.kind !== 'ok') throw new Error('Start failed');
        const next = start.value.result!.proposal.nextAction;
        if (!('approvalId' in next)) throw new Error('Missing approval');
        const cmd = {
          runId: start.value.runId,
          approvalId: next.approvalId,
          decision: 'APPROVE',
        } as const;
        const replies = await Promise.all(
          [a, b].map((item) =>
            other.app.resolveApproval(cmd, callbackMeta(item.deliveryId, item.approver)),
          ),
        );
        concurrentSingleWinner =
          replies.filter((r) => r.kind === 'ok').length === 1 &&
          replies.some(
            (r) => r.kind === 'duplicate' || (r.kind === 'error' && r.error.type === 'Conflict'),
          ) &&
          other.approvedDecisions() === 1 &&
          other.financeWrites() === 1 &&
          other.submitAttempts() === 1;
      } finally {
        other.close();
      }
    }
    return { ...result, details: { ...result.details, concurrentSingleWinner } };
  } finally {
    try {
      record?.(run.metrics());
    } finally {
      run.close();
    }
  }
};

export async function evaluateCase(workflow: WorkflowCase, run: RunCase = runCase) {
  try {
    const { observed, replies, logs, nextActionType, details } = await run(workflow);
    const expect = workflow.expect;
    const mismatches: string[] = [];
    if (
      !isDeepStrictEqual(
        replies,
        workflow.approvals.map((a) => a.expectResult),
      )
    )
      mismatches.push('approval replies');
    workflow.approvals.forEach((approval, index) => {
      const prior = approval.sameResponseAs;
      if (
        prior !== undefined &&
        (!details?.bodies?.[index] || details.bodies[index] !== details.bodies[prior])
      )
        mismatches.push('sameResponseAs');
    });
    for (const [key, expected] of Object.entries(workflow.expect)) {
      const actual = observed[key as keyof typeof observed];
      if (key === 'concurrentVariant') {
        if (!details?.concurrentSingleWinner) mismatches.push(key);
      } else if (key === 'mustNot') {
        if (!details || expect.mustNot!.some((type) => details.eventTypes.includes(type)))
          mismatches.push(key);
      } else if (key === 'toolCalls') {
        // Only the listed tools are counted; others may be called freely.
        if (
          !details ||
          Object.entries(expect.toolCalls!).some(
            ([tool, n]) => (details.toolCalls[tool] ?? 0) !== n,
          )
        )
          mismatches.push(key);
      } else if (key === 'toolCallsTotalMax') {
        if (
          observed.toolCallsTotalMax === undefined ||
          observed.toolCallsTotalMax > expect.toolCallsTotalMax!
        )
          mismatches.push(key);
      } else if (key === 'auditEvents') {
        if (!details || expect.auditEvents!.some((type) => !details.eventTypes.includes(type)))
          mismatches.push(key);
      } else if (key === 'afterResume' || key === 'afterCrash') {
        // A checkpoint lists only the fields the case cares about.
        const got = (observed[key] ?? {}) as Record<string, unknown>;
        if (
          Object.entries(expect[key]!).some(
            ([field, value]) => !isDeepStrictEqual(got[field], value),
          )
        )
          mismatches.push(key);
      } else if (key === 'exceptionMessageContains') {
        if (!details?.exceptionMessages.some((m) => m.includes(expect.exceptionMessageContains!)))
          mismatches.push(key);
      } else if (key === 'exceptionMessageMustNotContain') {
        const banned = expect.exceptionMessageMustNotContain!.toLowerCase();
        if (!details || details.exceptionMessages.some((m) => m.toLowerCase().includes(banned)))
          mismatches.push(key);
      } else if (key === 'mustNotInferReceiptFrom') {
        // The delivery line may be read, but never used as receipt evidence.
        if (
          !details ||
          observed.receiptVerification === undefined ||
          details.receiptEvidence.some((quote) => quote.includes(expect.mustNotInferReceiptFrom!))
        )
          mismatches.push(key);
      } else if (key === 'nextActionMustNotBe') {
        if (!nextActionType || nextActionType === expected) mismatches.push(key);
      } else if (key === 'logsMustNotContain') {
        if (!logs || workflow.expect.logsMustNotContain!.some((value) => logs.includes(value)))
          mismatches.push(key);
      } else if (key === 'logsMayContainOnlyLast4') {
        const accounts = Array.from(
          logs?.matchAll(/account(?: number)?(?: ending)?[ ":#*]+(\d(?:[ -]?\d){3,})/gi) ?? [],
          (m) => m[1]!.replace(/\D/g, ''),
        );
        if (!logs || accounts.some((a) => !workflow.expect.logsMayContainOnlyLast4!.includes(a)))
          mismatches.push(key);
      } else if (key === 'historyRecordUnchanged') {
        if (
          Object.entries(workflow.expect.historyRecordUnchanged!).some(
            ([id, status]) => observed.historyRecordUnchanged?.[id] !== status,
          )
        )
          mismatches.push(key);
      } else if (key === 'mustNotCite') {
        if (
          workflow.expect.mustNotCite!.some((doc) => observed.mustCite?.some((c) => c.doc === doc))
        )
          mismatches.push(key);
      } else if (
        [
          'mustCite',
          'calculations',
          'approvalSnapshotFields',
          'mustCiteRecords',
          'exceptionRecordHas',
          'evidenceOnlyNeverAuthority',
          'fraudIndicatorsAtLeast',
        ].includes(key) &&
        Array.isArray(expected)
      ) {
        if (
          !Array.isArray(actual) ||
          !expected.every((item) => actual.some((value) => isDeepStrictEqual(value, item)))
        )
          mismatches.push(key);
      } else if (!isDeepStrictEqual(actual, expected)) mismatches.push(key);
    }
    return { observed, actual: mismatches.length ? 'Mismatch: ' + mismatches.join(', ') : 'PASS' };
  } catch {
    return { actual: 'Case execution failed' };
  }
}
