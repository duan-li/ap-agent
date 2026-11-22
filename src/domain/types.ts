import { Decimal } from 'decimal.js';
import { z } from 'zod';

const text = z.string().min(1);
const strings = z.array(text);
const count = z.int().nonnegative();
const line = z.int().positive();
const date = z.iso.date();
const time = z.iso.datetime({ offset: true });
const currency = z.string().regex(/^[A-Z]{3}$/);
const object = z.strictObject;
export const decimalString = z.string().regex(/^-?\d+(?:\.\d+)?$/);
export const money = decimalString.transform(value => new Decimal(value));
export const runStatus = z.enum(['RUNNING', 'AWAITING_APPROVAL', 'SUBMITTING', 'COMPLETED', 'FAILED', 'RETURNED_TO_AP']);
export const outcome = z.enum(['APPROVE_FOR_POSTING', 'HOLD_FOR_INFORMATION', 'REJECT_DUPLICATE', 'REJECT_INVALID', 'ESCALATE_CONTROL_REVIEW']);
export const exceptionCode = z.enum(['MISSING_PO', 'MISSING_RECEIPT', 'PRICE_VARIANCE', 'QUANTITY_VARIANCE',
  'DUPLICATE_RISK', 'VENDOR_BLOCK', 'BANK_CHANGE', 'AUTHORITY_GAP', 'TAX_QUERY', 'OTHER_CONTROL_RISK', 'RULE_VERSION_MISMATCH']);
const writeAction = z.enum(['POST', 'REJECT_INVOICE']);
export const financeAction = z.enum([...writeAction.options, 'NONE']);
const vendorStatus = z.enum(['ACTIVE', 'BLOCKED']);
export const vendor = object({
  vendorId: text, legalName: text, status: vendorStatus, createdAt: date, createdBy: text, country: text,
  bank: object({ bsb: text, accountNumber: z.string().regex(/^\d+$/), country: text, lastChangedAt: date, verified: z.boolean() }),
  knownContact: object({ phone: text, email: z.email() }), riskFlags: strings, lastUpdated: time,
});
export const purchaseOrder = object({
  poNumber: text, vendorId: text, description: text, currency, approvalStatus: text, approvedBy: text,
  approvedAt: date, freightPermitted: z.boolean(), subtotal: decimalString, taxRate: decimalString, toleranceRef: text,
  lines: z.array(object({ line, description: text, type: z.enum(['GOODS', 'SERVICES', 'FREIGHT']),
    quantity: count, unitPrice: decimalString, lineValue: decimalString })).min(1),
});
export const receipt = object({
  receiptId: text, poNumber: text, receivedAt: date, receivedBy: text, serviceConfirmedBy: text.optional(),
  lines: z.array(object({ line, quantityReceived: count })).min(1),
});
export const historyRecord = object({
  historyId: text, vendorId: text, invoiceNumber: text, normalisedNumber: text, invoiceDate: date,
  currency, grossAmount: decimalString, poNumber: text, status: text, paidAt: date.optional(), attachmentHash: text,
});
export const authorityEntry = object({
  userId: text, name: text, role: text, limitAud: decimalString, financialControl: z.boolean(), note: text.optional(),
});
const records = <T extends z.ZodType>(schema: T) => object({ _note: text, records: z.array(schema) });
export const fixtureSchemas = {
  vendors: records(vendor), purchase_orders: records(purchaseOrder), receipts: records(receipt), invoice_history: records(historyRecord),
  authority_register: object({
    _note: text, registerVersion: text, effectiveFrom: date, policyRef: text, approvers: z.array(authorityEntry),
    delegations: z.array(object({ delegate: text, delegator: text, scope: text, start: date, end: date, note: text.optional() })),
  }),
};

const field = object({ value: text, quote: text, chunkId: text });
export const invoiceExtraction = object({
  invoiceNumber: field, invoiceDate: field, poNumber: field.optional(), currency: field,
  totalAmountRaw: field, taxAmountRaw: field,
  lines: z.array(object({ description: field, quantityRaw: field, unitPriceRaw: field, lineAmountRaw: field })).min(1),
  suspiciousContent: strings,
});
export const modelPurpose = z.enum(['extract', 'extract-repair', 'explain']);
export const modelScript = object({
  _note: text,
  calls: z.array(z.union([
    object({ purpose: modelPurpose, rawResponse: z.string() }),
    object({ purpose: modelPurpose, response: z.json() }),
  ])).min(1),
  expect: z.record(text, z.json()).optional(),
});

export const request = object({
  caseId: text, invoiceRef: text, vendor: text, amount: decimalString, currency,
  notes: z.string().nullish(), attachments: strings.min(1),
});
const vendorChange = object({ vendorId: text, set: object({ status: vendorStatus }) });
const faults = object({
  get_purchase_order: object({ timeoutTimes: count }).optional(),
  crashAfterStep: text.optional(), crashAfterErpPost: z.boolean().optional(), crashAfterOutboxSending: z.boolean().optional(),
  vendorChangeBeforeResume: vendorChange.optional(), vendorChangeBeforeSubmit: vendorChange.optional(),
  policyVersionChangeBeforeSubmit: object({ documentId: text, version: text, effectiveDate: date }).optional(),
  clock: object({ approvalAt: time }).optional(),
  budget: object({ maxSteps: line.optional(), maxToolCalls: line.optional(), maxModelCalls: line.optional() }).optional(),
});
const outboxStatus = z.enum(['PENDING', 'SENDING', 'SENT', 'CANCELLED', 'RECONCILE_REQUIRED']);
const checkpoint = object({
  status: runStatus, outboxStatus: outboxStatus.optional(), outcome: outcome.optional(), approvalStatus: text.optional(),
  erpPostings: count.optional(), additionalToolCalls: count.optional(), postingRefEqualsFirst: z.boolean().optional(),
});
const calculationExpectation = z.union([
  object({ check: z.literal('LINE_PRICE_TOLERANCE'), line, variance: decimalString, threshold: decimalString, withinTolerance: z.boolean() }),
  object({ check: z.literal('LINE_QUANTITY'), line, invoiced: count, received: count, withinTolerance: z.boolean() }),
]);
const toolCounts = z.record(text, count);
const expectations = object({
  outcome, finalOutcome: outcome, finalStatus: runStatus, statusBeforeApproval: runStatus, statusAfterCrash: runStatus,
  financeActions: count, submitAttempts: count, erpLookupCalls: count, approvalsRequested: count, financeActionType: financeAction,
  exceptions: z.array(exceptionCode), finalExceptions: z.array(exceptionCode), calculations: z.array(calculationExpectation),
  requiredApprovers: strings, unknowns: strings, approvalSnapshotFields: strings, actionsTakenBeforeApproval: z.array(writeAction),
  mustCite: z.array(object({ doc: text, section: text, finding: text })), mustNotCite: strings, mustCiteRecords: strings,
  auditEvents: strings, mustNot: strings, evidenceOnlyNeverAuthority: strings, logsMustNotContain: strings,
  logsMayContainOnlyLast4: z.array(z.string().regex(/^\d{4}$/)), vendorMasterUnchanged: z.boolean(),
  vendorRecheckedBeforeSubmit: z.boolean(), escalationOwner: text, fraudIndicatorsAtLeast: strings, injectionFlagged: z.boolean(),
  approvalStatusAfter: text, outboxStatus, newApprovalRequested: z.boolean(), matchingPolicyAsOf: text, authorityPolicyAsOf: text,
  toolCalls: toolCounts, toolCallsDuringResume: toolCounts, toolCallsTotalMax: count, afterResume: checkpoint, afterCrash: checkpoint,
  resultEqualsUncrashedRun: z.boolean(), repairs: count, failureReason: text, approvalDecision: z.enum(['APPROVE', 'REJECT']),
  runA: object({ finalStatus: runStatus, financeActionType: financeAction }),
  runB: object({ outcome, erpResponse: text, finalOutcome: outcome, finalExceptions: z.array(exceptionCode) }),
  receiptVerification: z.enum(['UNVERIFIED', 'NOT_FOUND']), exceptionMessageContains: text, exceptionMessageMustNotContain: text,
  exceptionRecordHas: strings, mustNotInferReceiptFrom: text, nextAction: object({ owner: text, action: text }),
  nextActionMustNotBe: text, resumeOnCompletedRun: text, concurrentVariant: text, rejectedTarget: text,
  historyRecordUnchanged: z.record(text, text), paymentsAdded: count,
}).partial().refine(value => Object.keys(value).length > 0);
export const caseFile = object({
  id: text, description: text, priority: z.enum(['required', 'optional']), basedOn: text.optional(),
  request, faults, modelScript: z.union([z.literal('default'), z.string().regex(/^fixtures\/model_scripts\/[\w-]+\.json$/)]),
  approvals: z.array(object({
    approver: text, decision: z.enum(['APPROVE', 'REJECT']), deliveryId: text, reason: text.optional(),
    expectResult: z.enum(['ok', 'duplicate', 'Conflict', 'Unauthorized']), expectStatusAfter: runStatus.optional(), sameResponseAs: count.optional(),
  })), expect: expectations, secondRequest: request.optional(), order: strings.optional(),
});
export type WorkflowCase = z.infer<typeof caseFile>;
export const retrievalGolden = object({
  _note: text, queries: z.array(object({ id: text, query: text, top: strings, mustNotAuthorise: strings,
    expectNoAuthority: z.boolean().optional(), note: text.optional() })),
});

const invoice = object({ vendorId: text, invoiceRef: text, amount: decimalString, currency });
const chunk = object({
  chunkId: text, documentId: text, type: text, version: text, section: text, effectiveDate: date.nullable(),
  status: text, trust: z.enum(['authority', 'untrusted', 'historical']), rank: line, score: z.number(), text, citation: text,
});
const match = object({ recordId: text, status: text, matchBasis: text });
export const toolSchemas = {
  retrieve_finance_documents: {
    input: object({ query: text, filters: chunk.pick({ type: true, status: true, trust: true }).partial(), topK: line }),
    output: z.array(chunk),
  },
  get_vendor_record: {
    input: object({ vendorId: text }),
    output: object({ vendorId: text, status: vendorStatus, riskFlags: strings, bankLast4: z.string().regex(/^\d{4}$/),
      bankAccountVersion: text, lastChangedAt: date, verified: z.boolean(), lastUpdated: time }),
  },
  get_purchase_order: {
    input: object({ poNumber: text }), output: purchaseOrder.extend({ receipts: z.array(receipt) }),
  },
  check_invoice_history: {
    input: object({ vendorId: text, invoiceNumber: text, grossAmount: decimalString, invoiceDate: date, currency, poNumber: text.optional() }),
    output: object({ exact: z.array(match), fuzzy: z.array(match) }),
  },
  submit_finance_decision: {
    input: object({ runId: text, financeAction: writeAction, approvalIds: strings.min(1), snapshotHash: text, idempotencyKey: text, payload: invoice }),
    output: z.discriminatedUnion('status', [
      object({ status: z.enum(['ACCEPTED', 'REPLAYED']), postingRef: text, receivedAt: time }),
      object({ status: z.enum(['DUPLICATE_INVOICE', 'REFUSED']), postingRef: text.nullish(), receivedAt: time }),
    ]),
  },
};

const source = z.discriminatedUnion('type', [
  object({ type: z.literal('ATTACHMENT'), ref: text, quote: text }),
  object({ type: z.literal('SYSTEM_OF_RECORD'), ref: text }),
]);
const explanation = object({ text, findingIds: strings.min(1) });
export const runResult = object({
  runId: text, caseId: text, status: runStatus,
  decisionSummary: object({ paymentEligibility: text, approvalStatus: text, missingEvidence: strings, financeActionTaken: text }),
  proposal: object({ outcome, nextAction: z.union([
    object({ type: z.literal('REQUEST_APPROVAL'), roles: strings.min(1), approvalId: text }),
    object({ owner: text, action: text }),
  ]) }),
  sourcedFacts: z.array(object({ id: text, field: text, value: text, currency: currency.optional(), source })),
  calculations: z.array(object({
    id: text, check: text, line: line.optional(), inputs: z.record(text, text), formula: text.optional(),
    result: z.record(text, z.union([text, z.boolean()])), policyRef: text.optional(),
  })),
  policyFindings: z.array(object({ id: text, passed: z.boolean(), evidence: strings, citation: text })),
  inferences: z.array(object({ text, evidence: strings })), unknowns: strings, assumptions: strings,
  exceptions: z.array(object({ code: exceptionCode, failedRule: text, failedLine: line.optional(),
    expected: text, observed: text, difference: decimalString.optional(), threshold: decimalString.optional(),
    sources: strings, owner: text, nextReviewDate: date })),
  explanation: z.array(explanation), confidence: object({ level: z.enum(['HIGH', 'MEDIUM', 'LOW']), reasons: strings }),
  approvalSnapshot: invoice.extend({ hash: text, action: writeAction, bankAccountVersion: text, policyVersions: z.record(text, text) }).nullable(),
  actionsTaken: z.array(object({ action: writeAction, postingRef: text })),
});
