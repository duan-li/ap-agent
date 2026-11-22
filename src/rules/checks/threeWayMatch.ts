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
// The stated line amount, or quantity x unit price when the invoice reading
// has no stated amount. A stated amount that failed grounding is unknown and
// is never replaced by the product.
export function invoiceLineAmount(invoice: Extraction, n: number) {
  const key = (k: string) => 'line' + n + '.' + k;
  const stated = invoice.fields[key('lineAmount')]?.value;
  if (stated) return { amount: stated, stated: true };
  const qty = invoice.fields[key('quantity')]?.value,
    price = invoice.fields[key('unitPrice')]?.value;
  if (!qty || !price || invoice.unknowns.includes(key('lineAmount'))) return null;
  return { amount: new Decimal(qty).times(price).toFixed(2), stated: false };
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
      resolved = invoiceLineAmount(invoice, n);
    if (!qty || !price || !resolved) {
      passed = false;
      continue;
    }
    const amount = resolved.amount;
    const received = po!.receipts
      .flatMap((r) => r.lines)
      .filter((l) => l.line === n)
      .reduce((s, l) => s + l.quantityReceived, 0);
    const priceResult = tolerance(line.lineValue, amount);
    // A derived amount equals the product by construction, so it is recorded
    // as a derivation rather than checked against itself.
    const lineResult = resolved.stated
      ? arithmetic(qty, price, amount)
      : { expected: amount, stated: 'not stated', matches: true };
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
        check: resolved.stated ? 'LINE_ARITHMETIC' : 'LINE_AMOUNT_DERIVED',
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
