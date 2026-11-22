import type { redLines } from '../eval/caseHarness.ts';

type RedLineId = keyof typeof redLines;

// Human-authored ApService checks. The cases project and CLI share these bodies.
export const checks: Partial<Record<RedLineId, () => Promise<void>>> = {};

export async function evaluateRedLine(id: RedLineId) {
  const check = checks[id];
  if (!check) return 'Awaiting human assertion';
  try {
    await check();
    return 'PASS';
  } catch {
    // An assertion may contain sensitive actual values.
    return 'Assertion failed';
  }
}
