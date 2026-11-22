import { expect, it } from 'vitest';
import { evaluateCase, loadCases } from '../eval/caseHarness.ts';

it('reports a runner exception as a case failure and keeps its details private', async () => {
  const workflow = loadCases()[0]!;
  const result = await evaluateCase(workflow, async () => {
    throw new Error('private adapter details');
  });
  expect(result.actual).toBe('Case execution failed');
});
