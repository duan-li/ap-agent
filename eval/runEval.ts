import { mkdirSync, writeFileSync } from 'node:fs';
import {
  evaluateCase,
  loadCases,
  loadGreen,
  redLines,
  runCase,
  type Metrics,
} from './caseHarness.ts';
import { evaluateRedLine } from '../tests/redlines.test.ts';
import golden from '../cases/retrieval_golden.json' with { type: 'json' };
import { ingest } from '../src/evidence/ingest.ts';
import { retrieve } from '../src/evidence/retrieve.ts';

export async function evaluate() {
  const green = loadGreen();
  const cases = loadCases();
  const report = [
    '# Offline evaluation',
    '',
    'Each workflow uses the fake model, a fixed clock and fresh databases. Counts cover its primary run, including recovery. A dash means the runner supplied no observations. Unapproved actions are ERP rows without a matching prior human approval for the key, action, vendor, invoice, amount and currency.',
    '',
    '| Case | Priority | Result | Expected outcome or status | Observed final outcome / status | Submit attempts | Finance actions | Unapproved |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: |',
  ];
  let passed = 0,
    requiredPassed = 0,
    adversarial = 0,
    unapproved = 0;
  for (const workflow of cases) {
    let metrics: Metrics | undefined;
    const result = await evaluateCase(workflow, (w) =>
      runCase(w, (m) => {
        metrics = m;
      }),
    );
    const ok = result.actual === 'PASS';
    if (ok) passed++;
    if (ok && workflow.priority === 'required') requiredPassed++;
    if (!metrics && workflow.priority === 'required') process.exitCode = 1;
    if (!ok && (green.has(workflow.id) || workflow.priority === 'required')) process.exitCode = 1;
    adversarial += metrics?.adversarial ?? 0;
    unapproved += metrics?.unapproved ?? 0;
    const expected = workflow.expect;
    const target =
      expected.outcome ??
      expected.afterResume?.outcome ??
      expected.finalStatus ??
      expected.afterResume?.status ??
      'finance actions ' + expected.financeActions;
    const observed = result.observed;
    const outcome = observed?.finalOutcome ?? observed?.afterResume?.outcome ?? observed?.outcome;
    const state = [outcome, observed?.finalStatus].filter(Boolean).join(' / ') || '-';
    report.push(
      `| ${workflow.id} | ${workflow.priority} | ${ok ? 'PASS' : 'FAIL: ' + result.actual} | ${target} | ${state} | ${metrics?.attempts ?? '-'} | ${metrics?.actions ?? '-'} | ${metrics?.unapproved ?? '-'} |`,
    );
  }
  report.push(
    '',
    `${cases.length} cases, ${passed} passed, ${cases.length - passed} failed. Required cases: ${requiredPassed}/${cases.filter((c) => c.priority === 'required').length}. Observed unapproved actions: ${unapproved}.`,
    '',
    '## Red lines',
    '',
  );
  for (const id of Object.keys(redLines) as (keyof typeof redLines)[]) {
    const actual = await evaluateRedLine(id);
    if (actual !== 'PASS') process.exitCode = 1;
    report.push(`- ${id} ${redLines[id]}: ${actual}`);
  }
  const index = ingest();
  let matched = 0;
  report.push(
    '',
    '## Retrieval on 2026-11-22',
    '',
    '| Query | First three authority sections | Result |',
    '| --- | --- | --- |',
  );
  for (const q of golden.queries) {
    const hits = retrieve(
      index,
      { query: q.query, filters: { trust: 'authority' }, topK: 3 },
      '2026-11-22',
    );
    const sections = hits.map((h) => h.documentId + ' ' + h.section);
    const ok =
      q.top.every((t) => sections.includes(t)) &&
      (!q.expectNoAuthority || hits.length === 0) &&
      hits.every((h) => !q.mustNotAuthorise.includes(h.documentId));
    if (!ok) process.exitCode = 1;
    if (ok && q.top.length) matched++;
    report.push(
      `| ${q.id} ${q.query} | ${sections.join(', ') || 'None'} | ${ok ? 'PASS' : 'FAIL'} |`,
    );
  }
  report.push(
    '',
    `Targeted queries with all expected sections in the top three: ${matched}/${golden.queries.filter((q) => q.top.length).length}. Adversarial policy citations in observed workflow findings: ${adversarial}.`,
    '',
  );
  if (adversarial || unapproved) process.exitCode = 1;
  mkdirSync('eval', { recursive: true });
  const markdown = report.join('\n');
  writeFileSync('eval/report.md', markdown);
  process.stdout.write(markdown);
}
