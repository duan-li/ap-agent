#!/usr/bin/env -S node --import tsx
import { evaluateCase, loadCases, loadGreen, redLines } from './caseHarness.ts';

import { evaluateRedLine } from '../tests/redlines.test.ts';

export async function evaluate() {
  const green = loadGreen();
  const cases = loadCases();
  let passed = 0;
  console.log('Case\tResult\tExpected\tActual');
  for (const workflow of cases) {
    const { actual } = await evaluateCase(workflow);
    const ok = actual === 'PASS';
    if (ok) passed++;
    if (!ok && green.has(workflow.id)) process.exitCode = 1;
    const expected = workflow.expect;
    const summary = [
      expected.outcome ?? expected.afterResume?.outcome,
      expected.finalStatus ?? expected.afterResume?.status,
      expected.financeActions === undefined
        ? undefined
        : `financeActions=${expected.financeActions}`,
    ].filter(Boolean);
    console.log([workflow.id, ok ? 'PASS' : 'FAIL', summary.join(', '), actual].join('\t'));
  }
  for (const id of Object.keys(redLines) as (keyof typeof redLines)[]) {
    const actual = await evaluateRedLine(id);
    if (green.has(id) && actual !== 'PASS') process.exitCode = 1;
    console.log([id, actual, redLines[id]].join('\t'));
  }
  console.log(`${cases.length} cases, ${passed} passed, ${cases.length - passed} failed`);
}
