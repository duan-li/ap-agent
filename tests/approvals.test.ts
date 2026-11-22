import { it, expect } from 'vitest';
import { authorised } from '../src/orchestrator/approvals.ts';
import { backends } from '../src/adapters/toolBackends.ts';
it.each([
  ['u-201', false],
  ['u-204', true],
] as const)('checks %s against role and limit', (id, ok) => {
  expect(
    !!authorised(backends().register, id, 'DEPARTMENT_DIRECTOR', '17600.00', '2026-11-22'),
  ).toBe(ok);
});
