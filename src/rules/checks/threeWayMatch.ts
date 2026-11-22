import { Decimal } from 'decimal.js';
import type { Extraction } from '../../evidence/extract.ts';
import type { ReadTools } from '../../evidence/tools.ts';
import type { Review } from '../../domain/types.ts';
import { arithmetic, tolerance } from '../calc.ts';
// VERIFIED: the PO system returned receipts. NOT_FOUND: it answered and holds
// none. UNVERIFIED: it could not be reached, so absence is not known.
export type ReceiptVerification = 'VERIFIED' | 'UNVERIFIED' | 'NOT_FOUND';
export function receiptVerification(
  poNumber: string | undefined,
  po: ReturnType<ReadTools['po']> | null,
  poUnavailable: boolean,
): { verification: ReceiptVerification | null; calculation?: Review['calculations'][number] } {
  if (!poNumber) return { verification: null };
  const verification: ReceiptVerification | null = po
    ? po.receipts.length
      ? 'VERIFIED'
      : 'NOT_FOUND'
    : poUnavailable
      ? 'UNVERIFIED'
      : null;
  if (!verification) return { verification };
  return {
    verification,
    calculation: {
      id: 'C-RECEIPT',
      check: 'GOODS_RECEIPT',
      inputs: {
        poNumber,
        purchaseOrder: po ? 'returned' : 'unavailable',
        receipts: po ? po.receipts.map((r) => r.receiptId).join(', ') || 'none' : 'unknown',
      },
      result: { verification },
    },
  };
}
export function threeWayMatch(invoice: Extraction, po: ReturnType<ReadTools['po']> | null) {
  const calculations: Review['calculations'] = [];
  let passed = !!po && po.approvalStatus === 'APPROVED' && po.lines.length === invoice.lineCount;
  for (const line of po?.lines ?? []) {
    const n = line.line,
      prefix = 'line' + n + '.';
    const field = (key: string) => invoice.fields[prefix + key]?.value;
    const qty = field('quantity'),
      price = field('unitPrice'),
      amount = field('lineAmount');
    if (!qty || !price || !amount) {
      passed = false;
      continue;
    }
    const received = po!.receipts
      .flatMap((r) => r.lines)
      .filter((l) => l.line === n)
      .reduce((s, l) => s + l.quantityReceived, 0);
    const priceResult = tolerance(line.lineValue, amount);
    const lineResult = arithmetic(qty, price, amount);
    const quantityOK =
      new Decimal(qty).gt(0) &&
      new Decimal(qty).lte(received) &&
      new Decimal(qty).lte(line.quantity);
    calculations.push(
      {
        id: 'C-PRICE-' + n,
        check: 'LINE_PRICE_TOLERANCE',
        line: n,
        inputs: { po: line.lineValue, invoice: amount },
        formula: 'abs(invoice - po) <= min(50, po * 0.01)',
        result: priceResult,
      },
      {
        id: 'C-ARITH-' + n,
        check: 'LINE_ARITHMETIC',
        line: n,
        inputs: { quantity: qty, unitPrice: price },
        result: lineResult,
      },
      {
        id: 'C-QTY-' + n,
        check: 'LINE_QUANTITY',
        line: n,
        inputs: { invoiced: qty, received: String(received) },
        result: { withinTolerance: quantityOK },
      },
    );
    passed =
      passed &&
      line.type === 'GOODS' &&
      line.description === field('description') &&
      priceResult.withinTolerance &&
      lineResult.matches &&
      quantityOK;
  }
  return { passed, calculations };
}
