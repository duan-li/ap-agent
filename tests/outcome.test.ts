import { expect, it } from 'vitest';
import { tighten } from '../src/rules/outcome.ts';
it('keeps a stricter finding regardless of order', () => {
  expect(tighten('HOLD_FOR_INFORMATION', 'APPROVE_FOR_POSTING')).toBe('HOLD_FOR_INFORMATION');
  expect(tighten('HOLD_FOR_INFORMATION', 'ESCALATE_CONTROL_REVIEW')).toBe(
    'ESCALATE_CONTROL_REVIEW',
  );
});
