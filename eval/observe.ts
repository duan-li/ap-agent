import { financeAction } from '../src/domain/types.ts';
import { isDeepStrictEqual } from 'node:util';
import { normaliseInvoice } from '../src/adapters/toolBackends.ts';
import type { RequestMeta, RunView } from '../src/application/apService.ts';
import type { WorkflowCase } from '../src/domain/types.ts';
import type { openTestRun } from './testRun.ts';
function meta(deliveryId: string, actor = 'local-operator'): RequestMeta {
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
) {
  const vendorsBefore = structuredClone(run.vendorMaster());
  const historyBefore = structuredClone(run.historyRecords());
  const first = await run.app.startRun(request, meta('start'));
  if (first.kind === 'error' || !first.value.result) throw new Error('Start failed');
  const view = first.value,
    r = view.result!,
    next = r.proposal.nextAction;
  const replies = [];
  for (const approval of approvals) {
    if (!('approvalId' in next)) throw new Error('Missing approval');
    const base = { runId: view.runId, approvalId: next.approvalId };
    const command =
      approval.decision === 'APPROVE'
        ? { ...base, decision: approval.decision }
        : { ...base, decision: approval.decision, reason: approval.reason ?? '' };
    const reply = await run.app.resolveApproval(
      command,
      meta(approval.deliveryId, approval.approver),
    );
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
  return {
    logs: run.logs(),
    nextActionType: 'type' in next ? next.type : next.action,
    replies,
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
      outcome: r.proposal.outcome,
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
    } satisfies WorkflowCase['expect'],
  };
}
