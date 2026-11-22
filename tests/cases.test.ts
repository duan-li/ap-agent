import { it, expect } from 'vitest';
import { loadCases, loadGreen, evaluateCase, redLines } from '../eval/caseHarness.ts';

import { evaluateRedLine } from './redlines.test.ts';

const cases = loadCases();
const green = loadGreen();

it.each(cases)('$id', async (workflow) => {
  const result = await evaluateCase(workflow);
  if (green.has(workflow.id)) expect(result.actual, workflow.id).toBe('PASS');
});

for (const id of Object.keys(redLines) as (keyof typeof redLines)[]) {
  it('ratchet for ' + id + ' ' + redLines[id], async () => {
    const actual = await evaluateRedLine(id);
    if (green.has(id)) expect(actual, id).toBe('PASS');
  });
}
