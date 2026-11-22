import type { Review } from '../domain/types.ts';

type Exception = Review['exceptions'][number];

// FIN-POL-007 section 4 gives standard exceptions three business days.
export function reviewDate(asOf: string) {
  const date = new Date(asOf + 'T00:00:00Z');
  for (let days = 0; days < 3;) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) days++;
  }
  return date.toISOString().slice(0, 10);
}

export function priceExceptions(
  calculations: Review['calculations'],
  nextReviewDate: string,
): Exception[] {
  return calculations
    .filter((c) => c.check === 'LINE_PRICE_TOLERANCE' && c.result.withinTolerance === false)
    .map((c) => ({
      code: 'PRICE_VARIANCE',
      failedRule: c.check,
      failedLine: c.line,
      expected: c.inputs.po!,
      observed: c.inputs.invoice!,
      difference: String(c.result.variance),
      threshold: String(c.result.threshold),
      owner: 'Requester',
      nextReviewDate,
      sources: [c.id, 'F-THREE_WAY_MATCH', 'po-' + c.line, 'line' + c.line + '.lineAmount'],
    }));
}
