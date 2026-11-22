import { expect, it } from 'vitest';
import type { Extraction } from '../src/evidence/extract.ts';
import { invoiceLineAmount } from '../src/rules/checks/threeWayMatch.ts';
import { taxAndTotal } from '../src/rules/checks/taxAndTotal.ts';

const quote = '1. Laptop 14in  Qty 10  Unit $1,200.00  Amount $12,000.00';
const field = (value: string) => ({ value, quote, chunkId: 'ATT-INV-88412' });
function invoice(change: Partial<Extraction> = {}): Extraction {
  return {
    fields: {
      'line1.quantity': field('10'),
      'line1.unitPrice': field('1200.00'),
      taxAmount: field('1200.00'),
      totalAmount: field('13200.00'),
    },
    unknowns: [],
    lineCount: 1,
    suspicious: false,
    ...change,
  };
}

it('uses the stated line amount when the invoice reading has one', () => {
  const stated = invoice();
  stated.fields['line1.lineAmount'] = field('12000.00');
  expect(invoiceLineAmount(stated, 1)).toEqual({ amount: '12000.00', stated: true });
});

it('derives quantity x unit price when no line amount was stated', () => {
  expect(invoiceLineAmount(invoice(), 1)).toEqual({ amount: '12000.00', stated: false });
});

it('never replaces a stated amount that failed grounding', () => {
  expect(invoiceLineAmount(invoice({ unknowns: ['line1.lineAmount'] }), 1)).toBeNull();
});

it('derives nothing without a grounded quantity and unit price', () => {
  const partial = invoice();
  delete partial.fields['line1.unitPrice'];
  expect(invoiceLineAmount(partial, 1)).toBeNull();
});

it('still requires the stated tax and total to match the derived amounts', () => {
  expect(taxAndTotal(invoice(), '0.10').passed).toBe(true);
  const inflated = invoice();
  inflated.fields.totalAmount = field('13750.00');
  expect(taxAndTotal(inflated, '0.10').passed).toBe(false);
});
