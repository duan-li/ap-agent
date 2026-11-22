import { runResult, type Review, type WorkflowCase } from '../domain/types.ts';
import type { Evidence, reconcile } from '../rules/registry.ts';
import { summary } from './summary.ts';
import { confidence } from './confidence.ts';
export function recommend(
  runId: string,
  r: WorkflowCase['request'],
  e: Evidence,
  decision: ReturnType<typeof reconcile>,
  approvalId: string,
  snapshot: Review['approvalSnapshot'],
  explanation: Review['explanation'],
): Review {
  const { po, vendor, history, invoice } = e;
  const sourcedFacts: Review['sourcedFacts'] = Object.entries(invoice.fields).map(([id, f]) => ({
    id,
    field: id,
    value: f.value,
    ...(id === 'totalAmount' && invoice.fields.currency
      ? { currency: invoice.fields.currency.value }
      : {}),
    source: { type: 'ATTACHMENT', ref: f.chunkId, quote: f.quote },
  }));
  for (let i = 1; i <= invoice.lineCount; i++) {
    const prefix = 'line' + i + '.';
    const [q, u, a] = ['quantity', 'unitPrice', 'lineAmount'].map(
      (k) => invoice.fields[prefix + k],
    );
    if (q && u && a && q.quote === u.quote && u.quote === a.quote)
      sourcedFacts.push({
        id: 'invoice-' + i,
        field: 'invoiceLine' + i,
        value: q.value + ' x ' + u.value + ' = ' + a.value,
        source: { type: 'ATTACHMENT', ref: q.chunkId, quote: q.quote },
      });
  }
  function record(id: string, field: string, value: string, ref: string) {
    sourcedFacts.push({ id, field, value, source: { type: 'SYSTEM_OF_RECORD', ref } });
  }
  for (const l of po?.lines ?? [])
    record(
      'po-' + l.line,
      'poLine' + l.line,
      l.quantity + ' x ' + l.unitPrice,
      'get_purchase_order:' + po!.poNumber + '#line' + l.line,
    );
  for (const g of po?.receipts ?? [])
    for (const l of g.lines)
      record(
        g.receiptId + '-' + l.line,
        'receiptLine' + l.line,
        l.quantityReceived + ' received',
        g.receiptId + '#line' + l.line,
      );
  record(
    'vendor',
    'vendorStatus',
    vendor.status,
    'get_vendor_record:' + vendor.vendorId + '@' + vendor.lastUpdated,
  );
  record(
    'history',
    'duplicateCheck',
    history.exact.length + ' exact, ' + history.fuzzy.length + ' fuzzy matches',
    'check_invoice_history:' +
      e.historyEvent +
      ' ' +
      r.vendor +
      '/' +
      r.invoiceRef +
      '/' +
      r.currency +
      '/' +
      r.amount,
  );
  const post = !!snapshot,
    status = post ? 'AWAITING_APPROVAL' : 'COMPLETED';
  const roles = [decision.authority.role];
  return runResult.parse({
    runId,
    caseId: r.caseId,
    status,
    decisionSummary: summary(status, post, roles, decision.unknowns, 'None'),
    proposal: {
      outcome: decision.outcome,
      nextAction: post
        ? { type: 'REQUEST_APPROVAL', roles, approvalId }
        : { owner: 'Accounts Payable', action: 'Review invoice evidence' },
    },
    sourcedFacts,
    calculations: decision.calculations,
    policyFindings: decision.findings,
    inferences: [],
    unknowns: decision.unknowns,
    assumptions: ['Approval amount includes GST (FIN-POL-003 §1)'],
    exceptions: [],
    explanation,
    confidence: confidence(e, decision.unknowns),
    approvalSnapshot: snapshot,
    actionsTaken: [],
  });
}
