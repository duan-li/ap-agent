import { Decimal } from 'decimal.js';
export function tolerance(po: string, invoice: string) {
  const threshold = Decimal.min(50, new Decimal(po).times('0.01'));
  const variance = new Decimal(invoice).minus(po).abs();
  return {
    variance: variance.toFixed(2),
    threshold: threshold.toFixed(2),
    withinTolerance: variance.lte(threshold),
  };
}
export function arithmetic(quantity: string, unit: string, stated: string) {
  const expected = new Decimal(quantity).times(unit);
  return { expected: expected.toFixed(2), stated, matches: expected.eq(stated) };
}
export function totals(amounts: string[], rate: string) {
  const subtotal = amounts.reduce((sum, v) => sum.plus(v), new Decimal(0));
  const tax = subtotal.times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return {
    subtotal: subtotal.toFixed(2),
    tax: tax.toFixed(2),
    total: subtotal.plus(tax).toFixed(2),
  };
}
