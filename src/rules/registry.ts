import { Decimal } from 'decimal.js';
import type { Review, Chunk, WorkflowCase } from '../domain/types.ts';
import type { Extraction } from '../evidence/extract.ts';
import type { ReadTools } from '../evidence/tools.ts';
import { approvalRequirement } from './checks/approvalRequirement.ts';
import { threeWayMatch } from './checks/threeWayMatch.ts';
import { taxAndTotal } from './checks/taxAndTotal.ts';
import { vendorActive } from './checks/vendorActive.ts';
import { duplicate } from './checks/duplicate.ts';
import { tighten } from './outcome.ts';

export const policies = [
  { id: 'THREE_WAY_MATCH', query: 'freight variance tolerance', ref: 'FIN-POL-002 v2.4 §2' },
  { id: 'TAX_AND_TOTAL', query: 'freight variance tolerance', ref: 'FIN-POL-002 v2.4 §2' },
  { id: 'VENDOR_ACTIVE', query: 'vendor status blocked dormant', ref: 'FIN-POL-004 v5.1 §4' },
  { id: 'DUPLICATE_CHECK', query: 'duplicate invoice exact match', ref: 'FIN-POL-005 v2.8 §1' },
  {
    id: 'APPROVAL_REQUIREMENT',
    query: 'Department Director approval limit',
    ref: 'FIN-POL-003 v4.0 §2',
  },
] as const;
export interface Evidence {
  invoice: Extraction;
  po: ReturnType<ReadTools['po']> | null;
  vendor: ReturnType<ReadTools['vendor']>;
  history: ReturnType<ReadTools['history']>;
  chunks: Chunk[];
  historyEvent: string;
}
export function reconcile(r: WorkflowCase['request'], e: Evidence) {
  const { invoice, po, vendor, history } = e;
  const match = threeWayMatch(invoice, po);
  const tax = taxAndTotal(invoice, po?.taxRate ?? '0');
  const authority = approvalRequirement(r.amount);
  const calculations: Review['calculations'] = [
    ...match.calculations,
    ...tax.calculations,
    {
      id: 'C-AUTH',
      check: 'APPROVAL_AMOUNT',
      inputs: { grossIncludingTax: r.amount },
      result: authority,
      policyRef: policies[4].ref,
    },
  ];
  const goodIdentity =
    invoice.fields.invoiceNumber?.value === r.invoiceRef &&
    invoice.fields.currency?.value === r.currency &&
    r.currency === 'AUD' &&
    new Decimal(r.amount).gt(0) &&
    new Decimal(r.amount).eq(invoice.fields.totalAmount?.value ?? '-1');
  const checks = {
    THREE_WAY_MATCH:
      match.passed && po?.vendorId === r.vendor && po.currency === r.currency && goodIdentity,
    TAX_AND_TOTAL: tax.passed,
    VENDOR_ACTIVE: vendorActive(vendor),
    DUPLICATE_CHECK: !duplicate(history),
    APPROVAL_REQUIREMENT: goodIdentity,
  };
  const evidenceIds = {
    THREE_WAY_MATCH: [
      ...Object.keys(invoice.fields).filter((k) => k.startsWith('line')),
      ...(po?.lines ?? []).map((l) => 'po-' + l.line),
      ...(po?.receipts ?? []).flatMap((g) => g.lines.map((l) => g.receiptId + '-' + l.line)),
      ...match.calculations.map((c) => c.id),
    ],
    TAX_AND_TOTAL: ['taxAmount', 'totalAmount']
      .filter((k) => invoice.fields[k])
      .concat(tax.calculations.map((c) => c.id)),
    VENDOR_ACTIVE: ['vendor'],
    DUPLICATE_CHECK: ['history'],
    APPROVAL_REQUIREMENT: ['C-AUTH'],
  };
  const unknowns = [...invoice.unknowns];
  if ((r.attachments?.length ?? 0) > 1 || invoice.suspicious)
    unknowns.push('Supplementary content requires review');
  const findings = policies.map((p) => {
    const chunk = e.chunks.find((c) => c.citation === p.ref && c.trust === 'authority');
    if (!chunk) unknowns.push('Missing policy for ' + p.id);
    return {
      id: 'F-' + p.id,
      passed: !!chunk && checks[p.id],
      citation: chunk?.citation ?? 'UNSUPPORTED_BY_CORPUS',
      evidence: evidenceIds[p.id],
    };
  });
  let outcome: Review['proposal']['outcome'] = 'APPROVE_FOR_POSTING';
  if (unknowns.length || findings.some((f) => !f.passed))
    outcome = tighten(outcome, 'HOLD_FOR_INFORMATION');
  if (duplicate(history)) outcome = tighten(outcome, 'REJECT_DUPLICATE');
  return { outcome, calculations, findings, authority, unknowns };
}
