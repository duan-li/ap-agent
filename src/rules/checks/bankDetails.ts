import type { SupplierSignal } from '../../evidence/extract.ts';

export function bankDetails(signals: SupplierSignal[], masterLast4: string) {
  // The vendor tool exposes only the suffix. A full replacement account
  // requires verification even when its last four digits happen to match.
  const claims = signals.filter(
    (s) => s.kind === 'account' && (s.fullAccount || s.value !== masterLast4),
  );
  const indicators = [
    { text: 'NEW_BANK_DETAILS', evidence: claims.map((c) => c.id) },
    {
      text: 'URGENT_OR_SECRET_LANGUAGE',
      evidence: signals.filter((s) => s.kind === 'urgency').map((s) => s.id),
    },
    {
      text: 'REQUEST_TO_BYPASS_APPROVAL',
      evidence: signals.filter((s) => s.kind === 'bypass').map((s) => s.id),
    },
  ].filter((i) => i.evidence.length > 0);
  return { claims, indicators };
}
