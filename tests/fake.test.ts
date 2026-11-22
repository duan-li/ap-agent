import { readFileSync, readdirSync } from 'node:fs';
import { it, expect } from 'vitest';
import { FakeModel } from '../src/adapters/model/fake.ts';
import { invoiceExtraction } from '../src/domain/types.ts';

const text = readFileSync('fixtures/attachments/INV-88412.txt', 'utf8');
const input = { purpose: 'extract', text, chunkId: 'ATT-INV-88412' } as const;

it('extracts both line amounts, unit prices, quantities, tax and total with verbatim quotes', async () => {
  const result = invoiceExtraction.parse(JSON.parse(await new FakeModel().call(input)));
  expect(
    result.lines.map((line) => [
      line.quantityRaw.value,
      line.unitPriceRaw.value,
      line.lineAmountRaw?.value,
    ]),
  ).toEqual([
    ['10', '$1,200.00', '$12,000.00'],
    ['10', '$400.00', '$4,000.00'],
  ]);
  expect(result.taxAmountRaw.value).toBe('$1,600.00');
  expect(result.totalAmountRaw.value).toBe('$17,600.00');
  for (const field of [
    result.taxAmountRaw,
    result.totalAmountRaw,
    ...result.lines.flatMap((line) => Object.values(line)),
  ]) {
    expect(text).toContain(field.quote);
    expect(field.quote).toContain(field.value);
    expect(field.chunkId).toBe(input.chunkId);
  }
});

it('parses every supplied invoice', async () => {
  for (const file of readdirSync('fixtures/attachments')) {
    const invoice = readFileSync('fixtures/attachments/' + file, 'utf8');
    invoiceExtraction.parse(JSON.parse(await new FakeModel().call({ ...input, text: invoice })));
  }
});

it('replays malformed output, repair and inherited explanation in order', async () => {
  const model = new FakeModel('fixtures/model_scripts/FIN-001-malformed.json');
  const raw = await model.call(input);
  expect(() => JSON.parse(raw)).toThrow();
  const repaired = JSON.parse(await model.call({ ...input, purpose: 'extract-repair' }));
  expect(invoiceExtraction.parse(repaired).invoiceNumber.value).toBe('INV-88412');
  const explanation = JSON.parse(await model.call({ purpose: 'explain', findings: [] }));
  expect(explanation.rationale[0].findingIds).toEqual(['F-THREE_WAY_MATCH']);
});
