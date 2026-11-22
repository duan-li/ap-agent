import type { Review } from '../domain/types.ts';
import type { Evidence } from '../rules/registry.ts';

export function confidence(
  { invoice, po, history }: Evidence,
  unknowns: string[],
): Review['confidence'] {
  const receivedLines = new Set(
    po?.receipts.flatMap((receipt) => receipt.lines.map((item) => item.line)),
  );
  const complete =
    unknowns.length === 0 &&
    po?.lines.length === invoice.lineCount &&
    po.lines.every((item) => receivedLines.has(item.line));
  if (!complete) return { level: 'LOW', reasons: ['Evidence requires review'] };
  // TECH.md, Contracts: fuzzy matches lower confidence even with complete evidence.
  if (history.fuzzy.length && !history.exact.length)
    return {
      level: 'MEDIUM',
      reasons: ['All required evidence present', 'Probable fuzzy duplicate'],
    };
  return { level: 'HIGH', reasons: ['All required evidence present'] };
}
