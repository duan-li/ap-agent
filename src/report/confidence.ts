import type { Review } from '../domain/types.ts';
import type { Evidence } from '../rules/registry.ts';

export function confidence({ invoice, po }: Evidence, unknowns: string[]): Review['confidence'] {
  const receivedLines = new Set(
    po?.receipts.flatMap((receipt) => receipt.lines.map((item) => item.line)),
  );
  const complete =
    unknowns.length === 0 &&
    po?.lines.length === invoice.lineCount &&
    po.lines.every((item) => receivedLines.has(item.line));
  return complete
    ? { level: 'HIGH', reasons: ['All required evidence present'] }
    : { level: 'LOW', reasons: ['Evidence requires review'] };
}
