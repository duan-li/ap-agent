import { financeAction } from '../src/domain/types.ts';
import { isDeepStrictEqual } from 'node:util';
import { normaliseInvoice } from '../src/adapters/toolBackends.ts';
import type { RequestMeta, RunView } from '../src/application/apService.ts';
import type { Review, WorkflowCase } from '../src/domain/types.ts';
import { openTestRun } from './testRun.ts';
export function meta(deliveryId: string, actor = 'local-operator'): RequestMeta {
  return {
    deliveryId,
    correlationId: 'eval',
    source: 'cli',
    actor: { id: actor, via: 'cli-flag' },
    deadline: Date.parse('2026-11-22T00:05:00Z'),
    signal: new AbortController().signal,
  };
}
export async function observe(
  run: Awaited<ReturnType<typeof openTestRun>>,
  request: WorkflowCase['request'],
  approvals: WorkflowCase['approvals'],
  setup: Pick<WorkflowCase, 'id' | 'modelScript'>,
) {
  const vendorsBefore = structuredClone(run.vendorMaster());
  const historyBefore = structuredClone(run.historyRecords());
  const first = await run.app.startRun(request, meta('start'));
  let checkpoint: RunView | undefined;
  let recovery: RunView | undefined;
  let recoveredApproval: string | undefined;
  let firstRef: string | undefined;
  let erpPostings: number | undefined;
  let equalsBaseline: boolean | undefined;
  async function recover(id: string) {
    run.reopen();
    const before = await run.app.getRun(id, meta('inspect'));
    if (before.kind === 'error') throw new Error('Missing checkpoint');
    checkpoint = before.value;
    firstRef = run.postings()[0]?.posting_ref as string | undefined;
    erpPostings = run.financeWrites();
    const resumed = await run.app.resume(id, meta('recover'));
    if (resumed.kind === 'error') throw new Error('Recovery failed');
    recovery = resumed.value;
    recoveredApproval = run.approvalStatus(id);
    return recovery;
  }
  let view: RunView;
  if (first.kind === 'error') {
    if (first.error.type !== 'Transient' || !('runId' in first.error))
      throw new Error('Start failed');
    view = await recover(first.error.runId);
    const baseline = await openTestRun({ ...setup, faults: {} });
    try {
      const control = await baseline.app.startRun(request, meta('start'));
      equalsBaseline =
        control.kind === 'ok' && isDeepStrictEqual(control.value.result, view.result);
    } finally {
      baseline.close();
    }
  } else view = first.value;
  // A run that failed before its report has no result; those cases assert
  // only the status, the reason, the events and the ERP.
  const r: Review = view.result ?? emptyResult(view.runId, request.caseId, view.status),
    next = r.proposal.nextAction;
  const replies = [];
  const bodies: string[] = [];
  for (const approval of approvals) {
    if (!('approvalId' in next)) throw new Error('Missing approval');
    const base = { runId: view.runId, approvalId: next.approvalId };
    const command =
      approval.decision === 'APPROVE'
        ? { ...base, decision: approval.decision }
        : { ...base, decision: approval.decision, reason: approval.reason ?? '' };
    let reply = await run.app.resolveApproval(
      command,
      meta(approval.deliveryId, approval.approver),
    );
    if (reply.kind === 'error' && reply.error.type === 'Transient' && 'runId' in reply.error) {
      await recover(reply.error.runId);
      reply = await run.app.resolveApproval(command, meta(approval.deliveryId, approval.approver));
    }
    bodies.push(JSON.stringify(reply.kind === 'error' ? reply.error : reply.value));
    replies.push(reply.kind === 'error' ? reply.error.type : reply.kind);
  }
  const last = await run.app.getRun(view.runId, meta('read'));
  if (last.kind === 'error') throw new Error('Read failed');
  const final: RunView = last.value;
  const findings = r.policyFindings.flatMap((f) => {
    const m = /^(\S+) v\S+ (§\d+)$/.exec(f.citation);
    return m
      ? [{ doc: m[1]!, section: m[2]!, finding: f.id.slice(2) + (f.detail ? ': ' + f.detail : '') }]
      : [];
  });
  const decisionEvent = final.events.findIndex((e) => e.type === 'APPROVAL_DECIDED');
  const submit = final.events.findIndex(
    (e) => e.type === 'TOOL_CALL' && e.name === 'submit_finance_decision',
  );
  const postings = run.postings();
  const rejected = postings.find(
    (p) =>
      p.finance_action === 'REJECT_INVOICE' &&
      p.invoice_no_normalised === normaliseInvoice(request.invoiceRef) &&
      'approvalId' in next &&
      p.idempotency_key === [view.runId, next.approvalId, 'REJECT_INVOICE'].join('/'),
  );
  const unchanged = run
    .historyRecords()
    .filter((h) => historyBefore.some((prior) => isDeepStrictEqual(h, prior)));
  const decision = final.events.find((e) => e.type === 'APPROVAL_DECIDED')?.decision;
  const toolCalls = final.events.filter((e) => e.type === 'TOOL_CALL');
  const counts: Record<string, number> = {};
  for (const e of toolCalls) counts[String(e.name)] = (counts[String(e.name)] ?? 0) + 1;
  // Resume after the case's own steps: it must not re-evaluate a finished run.
  const resumed = await run.app.resume(view.runId, meta('resume'));
  if (resumed.kind === 'error') throw new Error('Resume failed');
  const after = resumed.value;
  const resumeView = recovery ?? after;
  const resumeEvents = resumeView.events.slice((checkpoint ?? final).events.length);
  const addedEvents = after.events.slice(final.events.length);
  const receipt = r.calculations.find((c) => c.check === 'GOODS_RECEIPT')?.result.verification;
  return {
    logs: run.logs(),
    nextActionType: 'type' in next ? next.type : next.action,
    replies,
    details: {
      bodies,
      toolCalls: counts,
      eventTypes: final.events.map((e) => e.type),
      exceptionMessages: r.exceptions.map((e) => e.observed),
      receiptEvidence: r.sourcedFacts
        .filter((f) => /^receipt/i.test(f.field))
        .map((f) => (f.source.type === 'ATTACHMENT' ? f.source.quote : f.source.ref)),
    },
    observed: {
      mustCiteRecords: r.sourcedFacts
        .filter(
          (f) =>
            f.field === 'matchedHistoryRecord' &&
            r.policyFindings.some((p) => p.evidence.includes(f.id)),
        )
        .map((f) => f.source.ref),
      evidenceOnlyNeverAuthority: r.sourcedFacts
        .filter(
          (f) =>
            f.field === 'supplierEvidence' &&
            f.source.type === 'ATTACHMENT' &&
            !findings.some((c) => c.doc === f.source.ref),
        )
        .map((f) => f.source.ref),
      fraudIndicatorsAtLeast: r.inferences.map((i) => i.text),
      injectionFlagged: r.policyFindings.some(
        (f) => f.id === 'F-INSTRUCTION_TO_DISABLE_CHECKS_IS_RISK_INDICATOR',
      ),
      escalationOwner: 'owner' in next ? next.owner : undefined,
      vendorMasterUnchanged: isDeepStrictEqual(vendorsBefore, run.vendorMaster()),
      exceptionRecordHas: Object.keys(r.exceptions[0] ?? {}),
      historyRecordUnchanged: Object.fromEntries(unchanged.map((h) => [h.historyId, h.status])),
      approvalDecision: decision === 'APPROVE' || decision === 'REJECT' ? decision : undefined,
      paymentsAdded: postings.filter((p) => p.finance_action === 'POST').length,
      rejectedTarget: rejected
        ? request.invoiceRef + ' as newly submitted in this case'
        : undefined,
      statusBeforeApproval: view.status,
      outcome: view.result?.proposal.outcome,
      finalStatus: final.status,
      actionsTakenBeforeApproval: r.actionsTaken.map((a) => a.action),
      requiredApprovers: 'roles' in next ? next.roles : [],
      exceptions: r.exceptions.map((e) => e.code),
      calculations: r.calculations
        .filter((c) => c.check === 'LINE_PRICE_TOLERANCE')
        .map((c) => ({
          check: 'LINE_PRICE_TOLERANCE' as const,
          line: c.line!,
          variance: String(c.result.variance),
          threshold: String(c.result.threshold),
          withinTolerance: c.result.withinTolerance === true,
        })),
      mustCite: findings,
      approvalSnapshotFields: Object.keys(r.approvalSnapshot ?? {}),
      vendorRecheckedBeforeSubmit:
        decisionEvent >= 0 &&
        final.events
          .slice(decisionEvent + 1, submit)
          .some(
            (e) => e.type === 'TOOL_CALL' && e.name === 'get_vendor_record' && e.outcome === 'OK',
          ),
      financeActionType: financeAction.parse(postings[0]?.finance_action ?? 'NONE'),
      financeActions: run.financeWrites(),
      submitAttempts: run.submitAttempts(),
      toolCallsTotalMax: toolCalls.length,
      unknowns: r.unknowns,
      receiptVerification:
        receipt === 'UNVERIFIED' || receipt === 'NOT_FOUND' ? receipt : undefined,
      nextAction:
        view.result && 'owner' in next ? { owner: next.owner, action: next.action } : undefined,
      approvalsRequested: final.events.filter((e) => e.type === 'APPROVAL_REQUESTED').length,
      repairs: final.events.filter((e) => e.type === 'MODEL_CALL' && e.purpose === 'extract-repair')
        .length,
      failureReason: final.failureReason ?? undefined,
      approvalStatusAfter: run.approvalStatus(view.runId),
      outboxStatus: final.outbox?.status,
      finalExceptions: final.result?.exceptions.map((e) => e.code),
      finalOutcome: final.result?.proposal.outcome,
      statusAfterCrash: checkpoint?.status,
      afterCrash: checkpoint && {
        status: checkpoint.status,
        outboxStatus: checkpoint.outbox?.status,
        erpPostings,
      },
      resultEqualsUncrashedRun: equalsBaseline,
      erpLookupCalls: final.erpLookupCalls,
      toolCallsDuringResume:
        checkpoint &&
        Object.fromEntries(
          [
            'get_purchase_order',
            'get_vendor_record',
            'check_invoice_history',
            'retrieve_finance_documents',
          ].map((name) => [
            name,
            resumeEvents.filter((e) => e.type === 'TOOL_CALL' && e.name === name).length,
          ]),
        ),
      afterResume: {
        outcome: resumeView.result?.proposal.outcome,
        outboxStatus: resumeView.outbox?.status,
        approvalStatus: recoveredApproval ?? run.approvalStatus(view.runId),
        postingRefEqualsFirst: !!firstRef && resumeView.outbox?.postingRef === firstRef,
        status: resumeView.status,
        additionalToolCalls: resumeEvents.filter((e) => e.type === 'TOOL_CALL').length,
      },
      resumeOnCompletedRun:
        (final.status === 'COMPLETED' || final.status === 'FAILED') &&
        !addedEvents.length &&
        isDeepStrictEqual(after.result, final.result)
          ? 'returns the current view; no re-evaluation'
          : undefined,
    } satisfies WorkflowCase['expect'],
  };
}

function emptyResult(runId: string, caseId: string, status: Review['status']): Review {
  return {
    runId,
    caseId,
    status,
    decisionSummary: {
      paymentEligibility: 'Ineligible for posting',
      approvalStatus: 'No approval pending',
      missingEvidence: [],
      financeActionTaken: 'None',
    },
    proposal: { outcome: 'HOLD_FOR_INFORMATION', nextAction: { owner: 'none', action: 'none' } },
    sourcedFacts: [],
    calculations: [],
    policyFindings: [],
    inferences: [],
    unknowns: [],
    assumptions: [],
    exceptions: [],
    explanation: [],
    confidence: { level: 'LOW', reasons: ['No result'] },
    approvalSnapshot: null,
    actionsTaken: [],
  };
}
