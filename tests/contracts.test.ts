import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
import { caseFile, fixtureSchemas, modelScript, retrievalGolden, money, toolSchemas } from '../src/domain/types.ts';

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

for (const [name, schema] of Object.entries(fixtureSchemas)) {
  it(`validates the ${name} fixture`, () => {
    expect(schema.safeParse(json(`fixtures/${name}.json`)).success).toBe(true);
  });
}
it('validates all workflow and retrieval cases', () => {
  const files = readdirSync('cases').filter(f => f.endsWith('.json') && f !== 'retrieval_golden.json');
  expect(files).toHaveLength(27);
  for (const file of files) expect(caseFile.parse(json('cases/' + file)).id + '.json').toBe(file);
  expect(retrievalGolden.parse(json('cases/retrieval_golden.json')).queries).toHaveLength(7);
});
it('validates the script envelopes, including deliberately invalid model replies', () => {
  for (const file of readdirSync('fixtures/model_scripts')) modelScript.parse(json('fixtures/model_scripts/' + file));
});
it('handles money as decimals and rejects JSON numbers', () => {
  expect(money.parse('0.10').plus(money.parse('0.20')).toFixed(2)).toBe('0.30');
  expect(money.safeParse(0.1).success).toBe(false);
});
it('requires approval IDs and an idempotency key in the submit contract', () => {
  const submit = { runId: 'run1', financeAction: 'POST', approvalIds: ['a1'], snapshotHash: 'hash', idempotencyKey: 'key', payload: { vendorId: 'v', invoiceRef: 'i', amount: '1.00', currency: 'AUD' } };
  const schema = toolSchemas.submit_finance_decision.input;
  expect(schema.safeParse(submit).success).toBe(true);
  expect(schema.safeParse({ ...submit, approvalIds: [] }).success).toBe(false);
  expect(schema.safeParse({ ...submit, idempotencyKey: '' }).success).toBe(false);
});
