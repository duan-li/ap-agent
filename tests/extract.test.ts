import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extract } from '../src/evidence/extract.ts';
import { FakeModel } from '../src/adapters/model/fake.ts';
const invoice = readFileSync('fixtures/attachments/INV-88412.txt', 'utf8');
it.each(['quote-not-found', 'value-not-in-quote'])(
  'drops unsupported total in %s',
  async (script) => {
    const e = await extract(
      new FakeModel('fixtures/model_scripts/' + script + '.json'),
      invoice,
      'ATT-INV-88412',
    );
    expect(e.unknowns).toContain('totalAmount');
    expect(e.fields.totalAmount).toBeUndefined();
  },
);
it('grounds all three stated line values independently', async () => {
  const { fields } = await extract(new FakeModel(), invoice, 'ATT-INV-88412');
  expect(['quantity', 'unitPrice', 'lineAmount'].map((k) => fields['line1.' + k]?.value)).toEqual([
    '10',
    '1200.00',
    '12000.00',
  ]);
});

import { citations } from '../src/report/citations.ts';
it('retains only explanations with an existing finding and supported numbers', () => {
  const finding = {
    id: 'F-TAX',
    passed: true,
    evidence: ['C-TAX'],
    citation: 'FIN-POL-002 v2.4 §2',
  };
  const calculation = {
    id: 'C-TAX',
    check: 'TAX',
    inputs: { subtotal: '16000.00' },
    result: { expected: '1600.00' },
  };
  const valid = { text: 'Tax is AUD 1,600.00.', findingIds: ['F-TAX'] };
  const raw = JSON.stringify({
    rationale: [
      valid,
      { text: 'Tax is AUD -1,600.00.', findingIds: ['F-TAX'] },
      { text: 'Tax is AUD 100.', findingIds: ['F-TAX'] },
      { text: 'Authorised.', findingIds: ['F-FAKE'] },
    ],
  });
  expect(citations(raw, [finding], [calculation])).toEqual({ explanation: [valid], rejected: 3 });
});
