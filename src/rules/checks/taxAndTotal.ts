import { Decimal } from 'decimal.js';
import type { Extraction } from '../../evidence/extract.ts';
import type { Review } from '../../domain/types.ts';
import { totals } from '../calc.ts';
import { invoiceLineAmount } from './threeWayMatch.ts';
export function taxAndTotal(invoice: Extraction, rate: string) {
  const amounts = Array.from(
    { length: invoice.lineCount },
    (_, i) => invoiceLineAmount(invoice, i + 1)?.amount,
  );
  const calculations: Review['calculations'] = [];
  if (amounts.some((a) => a === undefined)) return { passed: false, calculations };
  const computed = totals(amounts as string[], rate);
  for (const kind of ['tax', 'total'] as const) {
    const stated = invoice.fields[kind + 'Amount']?.value;
    if (stated)
      calculations.push({
        id: 'C-' + kind,
        check: kind.toUpperCase(),
        inputs: {
          subtotal: computed.subtotal,
          ...(kind === 'tax' ? { rate } : { tax: computed.tax }),
        },
        result: {
          expected: computed[kind],
          stated,
          matches: new Decimal(stated).eq(computed[kind]),
        },
      });
  }
  return {
    calculations,
    passed: calculations.length === 2 && calculations.every((c) => c.result.matches),
  };
}
