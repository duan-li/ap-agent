import { backends } from '../src/adapters/toolBackends.ts';
import { ingest } from '../src/evidence/ingest.ts';
import { readTools } from '../src/evidence/tools.ts';
import { reconcile } from '../src/rules/registry.ts';
import { extract } from '../src/evidence/extract.ts';
import { FakeModel } from '../src/adapters/model/fake.ts';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { tolerance, arithmetic, totals } from '../src/rules/calc.ts';
it.each([
  ['12049.99', true],
  ['12050.00', true],
  ['12050.01', false],
] as const)('applies the inclusive cap at %s', (amount, pass) => {
  expect(tolerance('12000.00', amount)).toMatchObject({
    threshold: '50.00',
    withinTolerance: pass,
  });
});
it('uses the lower percentage and checks stated arithmetic', () => {
  expect(tolerance('4000', '4040').threshold).toBe('40.00');
  expect(arithmetic('10', '1200', '12000').matches).toBe(true);
  expect(arithmetic('10', '1200', '12001').matches).toBe(false);
  expect(arithmetic('3', '0.1', '0.30').matches).toBe(true);
  expect(totals(['12000', '4000'], '0.10')).toEqual({
    subtotal: '16000.00',
    tax: '1600.00',
    total: '17600.00',
  });
});

it('records inconsistent invoice arithmetic as a failed three-way finding', async () => {
  const tools = readTools(backends(), ingest());
  const text = readFileSync('fixtures/attachments/INV-88412.txt', 'utf8').replace(
    'Amount $12,000.00',
    'Amount $12,000.01',
  );
  const invoice = await extract(new FakeModel(), text, 'ATT-INV-88412');
  const chunks = tools.retrieve(
    { query: 'tolerance', filters: { trust: 'authority' }, topK: 5 },
    '2026-11-10',
  );
  const decision = reconcile(
    {
      caseId: 'arithmetic',
      invoiceRef: 'INV-88412',
      vendor: 'V-1007',
      currency: 'AUD',
      amount: '17600.00',
    },
    {
      invoice,
      po: tools.po('PO-55210'),
      vendor: tools.vendor('V-1007'),
      history: { exact: [], fuzzy: [] },
      historyEvent: 'evt_1',
      chunks,
    },
  );
  expect(decision.calculations).toContainEqual(
    expect.objectContaining({
      check: 'LINE_ARITHMETIC',
      line: 1,
      result: { matches: false, expected: '12000.00', stated: '12000.01' },
    }),
  );
  expect(decision.findings).toContainEqual(
    expect.objectContaining({
      id: 'F-THREE_WAY_MATCH',
      passed: false,
      citation: 'FIN-POL-002 v2.4 §2',
    }),
  );
  expect(decision.outcome).toBe('HOLD_FOR_INFORMATION');
});
