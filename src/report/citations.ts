import { Decimal } from 'decimal.js';
import { rationale, type Review } from '../domain/types.ts';
export function citations(
  raw: string,
  findings: Review['policyFindings'],
  calculations: Review['calculations'],
) {
  const { rationale: sentences } = rationale.parse(JSON.parse(raw));
  return sentences.filter((s) => {
    const cited = s.findingIds.map((id) => findings.find((f) => f.id === id));
    if (cited.some((f) => !f)) return false;
    const ids = cited.flatMap((f) => f!.evidence);
    const numbers = calculations
      .filter((c) => ids.includes(c.id))
      .flatMap((c) => Object.values({ ...c.inputs, ...c.result }))
      .filter((x): x is string => typeof x === 'string' && /^\d+(?:\.\d+)?$/.test(x));
    return (s.text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).every((n) =>
      numbers.some((x) => new Decimal(x).eq(n.replaceAll(',', ''))),
    );
  });
}
