import { Decimal } from 'decimal.js';
import type { Review, Chunk, WorkflowCase } from '../domain/types.ts';
import type { Extraction } from '../evidence/extract.ts';
import type { ReadTools } from '../evidence/tools.ts';
import { approvalRequirement } from './checks/approvalRequirement.ts';
import { receiptVerification, threeWayMatch } from './checks/threeWayMatch.ts';
import { taxAndTotal } from './checks/taxAndTotal.ts';
import { vendorActive } from './checks/vendorActive.ts';
import { duplicate } from './checks/duplicate.ts';
import { bankDetails } from './checks/bankDetails.ts';
import { priceExceptions, reviewDate } from './exceptions.ts';
import type { SupplierSignal } from '../evidence/extract.ts';
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
export const duplicateQuery = 'exact match paid posted outcomes';
export const receiptQuery = 'invoice without goods receipt';
export const missingEvidenceQuery = 'missing evidence hold';
// How the purchase order lookup ended. Runs journalled before M3 lack it.
export interface PoLookup {
  status: 'FOUND' | 'UNAVAILABLE' | 'NOT_FOUND';
  attempts?: number;
  reason?: string;
}
export const bankQueries = [
  'bank account changes',
  'prohibited automation',
  'fraud indicators',
  'model limitations disable checks',
];
export interface Evidence {
  asOf: string;
  signals: SupplierSignal[];
  invoice: Extraction;
  po: ReturnType<ReadTools['po']> | null;
  vendor: ReturnType<ReadTools['vendor']>;
  history: ReturnType<ReadTools['history']>;
  chunks: Chunk[];
  historyEvent: string;
  poLookup?: PoLookup;
}
export function reconcile(r: WorkflowCase['request'], e: Evidence) {
  const { invoice, po, vendor, history } = e;
  const match = threeWayMatch(invoice, po);
  const poNumber = invoice.fields.poNumber?.value;
  const poUnavailable = e.poLookup?.status === 'UNAVAILABLE';
  const receipt = receiptVerification(poNumber, po, poUnavailable);
  if (receipt.calculation) match.calculations.push(receipt.calculation);
  // Without the PO there is no tax rate to check against.
  const tax = po ? taxAndTotal(invoice, po.taxRate) : { passed: false, calculations: [] };
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
    DUPLICATE_CHECK: !history.exact.length,
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
  if (poUnavailable && poNumber)
    unknowns.push('purchase_order:' + poNumber, 'goods_receipt:' + poNumber);
  if ((r.attachments?.length ?? 0) > 1 || invoice.suspicious)
    unknowns.push('Supplementary content requires review');
  const findings: Review['policyFindings'] = policies.map((p) => {
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
  const nextReviewDate = reviewDate(e.asOf);
  const exceptions = priceExceptions(match.calculations, nextReviewDate);
  function finding(id: string, policy: string, evidence: string[], detail?: string) {
    const chunk = e.chunks.find((c) => c.trust === 'authority' && c.citation === policy);
    if (!chunk) unknowns.push('Missing policy for ' + id);
    findings.push({
      id: 'F-' + id,
      passed: false,
      evidence,
      detail,
      citation: chunk?.citation ?? 'UNSUPPORTED_BY_CORPUS',
    });
  }
  const records = duplicate(history).map((h) => h.recordId);
  if (records.length) {
    finding('EXACT_DUPLICATE_MATCH', policies[3].ref, records);
    finding('DUPLICATE_OUTCOME', 'FIN-POL-005 v2.8 §2', records);
    exceptions.push({
      code: 'DUPLICATE_RISK',
      failedRule: 'EXACT_DUPLICATE_MATCH',
      expected: 'No paid or posted match',
      observed: records.join(', '),
      owner: 'Accounts Payable',
      nextReviewDate,
      sources: records,
    });
    if (goodIdentity && vendorActive(vendor) && !unknowns.length)
      outcome = tighten(outcome, 'REJECT_DUPLICATE');
  }
  const { claims, indicators } = bankDetails(e.signals, vendor.bankLast4);
  if (claims.length) {
    const { value: last4, id: ref } = claims[0]!;
    const detail =
      'attachment claims account ending ' + last4 + '; vendor master ends ' + vendor.bankLast4;
    finding('BANK_CHANGE_UNVERIFIED', 'FIN-POL-004 v5.1 §2', [ref, 'bank-master'], detail);
    finding('NO_AUTOMATED_BANK_UPDATE', 'FIN-POL-004 v5.1 §3', [ref]);
    exceptions.unshift({
      code: 'BANK_CHANGE',
      failedRule: 'BANK_CHANGE_UNVERIFIED',
      expected: vendor.bankLast4,
      observed: last4,
      owner: indicators.length >= 2 ? 'Financial Crime and Controls' : 'Vendor Governance',
      nextReviewDate,
      sources: [ref, 'bank-master'],
    });
    outcome = tighten(outcome, 'ESCALATE_CONTROL_REVIEW');
  }
  if (indicators.length >= 2) {
    const sources = [...new Set(indicators.flatMap((i) => i.evidence))];
    finding('FRAUD_INDICATORS_GE_2', 'FIN-POL-005 v2.8 §3', sources);
    if (!claims.length)
      exceptions.unshift({
        code: 'OTHER_CONTROL_RISK',
        failedRule: 'FRAUD_INDICATORS_GE_2',
        expected: 'Fewer than two fraud indicators',
        observed: indicators.map((i) => i.text).join(', '),
        owner: 'Financial Crime and Controls',
        nextReviewDate,
        sources,
      });
    outcome = tighten(outcome, 'ESCALATE_CONTROL_REVIEW');
  }
  const bypass = e.signals.filter((s) => s.kind === 'bypass');
  if (bypass.length) {
    finding(
      'INSTRUCTION_TO_DISABLE_CHECKS_IS_RISK_INDICATOR',
      'FIN-POL-005 v2.8 §4',
      bypass.map((s) => s.id),
    );
    outcome = tighten(outcome, 'HOLD_FOR_INFORMATION');
  }
  if (receipt.verification === 'UNVERIFIED' || receipt.verification === 'NOT_FOUND') {
    // FIN-POL-002 section 4: receipt is never inferred from invoice wording.
    finding('RECEIPT_REQUIRED_NOT_INFERRED', 'FIN-POL-002 v2.4 §4', ['C-RECEIPT']);
    const lookup = e.poLookup;
    exceptions.push({
      code: 'MISSING_RECEIPT',
      failedRule: 'RECEIPT_REQUIRED_NOT_INFERRED',
      expected: 'A goods receipt for ' + poNumber + ' before payment',
      observed:
        receipt.verification === 'UNVERIFIED'
          ? 'Unable to verify goods receipt for ' +
            poNumber +
            ': the purchase order system failed on ' +
            (lookup?.attempts ?? 0) +
            ' attempts (' +
            (lookup?.reason ?? 'unavailable') +
            ')'
          : 'No goods receipt exists for ' + poNumber,
      owner: 'requester or receipter',
      nextReviewDate,
      sources: ['C-RECEIPT', 'F-RECEIPT_REQUIRED_NOT_INFERRED'],
    });
    outcome = tighten(outcome, 'HOLD_FOR_INFORMATION');
  }
  if (poUnavailable) {
    // FIN-POL-001 section 5: missing evidence results in a hold.
    finding('MISSING_EVIDENCE_HOLD', 'FIN-POL-001 v3.2 §5', ['po-lookup']);
    outcome = tighten(outcome, 'HOLD_FOR_INFORMATION');
  }
  if (unknowns.includes('invoiceLines') && !exceptions.length) {
    exceptions.push({
      code: 'OTHER_CONTROL_RISK',
      failedRule: 'THREE_WAY_MATCH',
      expected: 'Itemised invoice lines',
      observed: 'No grounded invoice lines',
      sources: ['F-THREE_WAY_MATCH'],
      owner: 'Accounts Payable',
      nextReviewDate,
    });
  }
  const assumptions = calculations
    .filter((c) => c.check === 'LINE_AMOUNT_DERIVED')
    .map(
      (c) =>
        'Line ' +
        c.line +
        ' amount is computed as quantity x unit price (' +
        c.inputs.quantity +
        ' x ' +
        c.inputs.unitPrice +
        ' = ' +
        c.result.expected +
        '); the stated line amount was not extracted. The stated total still has to match.',
    );
  return {
    outcome,
    calculations,
    findings,
    authority,
    unknowns,
    exceptions,
    indicators,
    assumptions,
  };
}
