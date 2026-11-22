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
    return m ? [{ doc: m[1]!, section: m[2]!, finding: f.id.slice(2) }] : [];
  });
  const decisionEvent = final.events.findIndex((e) => e.type === 'APPROVAL_DECIDED');
  const submit = final.events.findIndex(
    (e) => e.type === 'TOOL_CALL' && e.name === 'submit_finance_decision',
  );
  return {
    replies,
    observed: {
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
      financeActionType: final.result?.actionsTaken[0]?.action ?? ('NONE' as const),
      financeActions: run.financeWrites(),
      submitAttempts: run.submitAttempts(),
    },
  };
}
