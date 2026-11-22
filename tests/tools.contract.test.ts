import { it, expect } from 'vitest';
import { toolSchemas } from '../src/domain/types.ts';
import { readTools } from '../src/evidence/tools.ts';
import { backends } from '../src/adapters/toolBackends.ts';
import { ingest } from '../src/evidence/ingest.ts';
import { openDatabase } from '../src/adapters/sqlite.ts';
import { post } from '../src/adapters/erpSim.ts';
import { FixedClock, seededIds } from '../src/adapters/clock.ts';
const tools = readTools(backends(), ingest());
it('validates retrieval arguments and ranked chunks', () => {
  expect(() => tools.retrieve({} as never, '2026-11-22')).toThrow();
  expect(
    tools.retrieve(
      { query: 'vendor status', filters: { trust: 'authority' }, topK: 3 },
      '2026-11-22',
    )[0],
  ).toMatchObject({
    rank: 1,
    trust: 'authority',
    version: expect.any(String),
    score: expect.any(Number),
    citation: expect.any(String),
  });
});
it('validates vendor arguments and projects bank last four', () => {
  expect(() => tools.vendor('')).toThrow();
  expect(tools.vendor('V-1007')).toMatchObject({
    bankLast4: '4471',
    status: 'ACTIVE',
    bankAccountVersion: expect.any(String),
  });
});
it('validates PO arguments and returns matching receipts', () => {
  expect(() => tools.po('')).toThrow();
  expect(tools.po('PO-55210')).toMatchObject({
    approvalStatus: 'APPROVED',
    lines: expect.arrayContaining([
      expect.objectContaining({ quantity: 10, unitPrice: '1200.00' }),
    ]),
    receipts: [expect.objectContaining({ receiptId: 'GRN-7781' })],
  });
});
it('validates history input and returns stable IDs', () => {
  expect(() => tools.history({} as never)).toThrow();
  expect(
    tools.history({
      vendorId: 'V-1012',
      invoiceNumber: 'INV-77120',
      grossAmount: '4950',
      currency: 'AUD',
      invoiceDate: '2026-11-10',
    }).exact[0]?.recordId,
  ).toBe('HIST-3301');
});
it('reports a probable fuzzy duplicate only when all FIN-POL-005 §1 signals agree', () => {
  // FIN-002-fuzzy: HIST-3301 is INV-77120, PO-58020, 2026-09-18, AUD 4,950.00.
  const query = {
    vendorId: 'V-1012',
    invoiceNumber: 'INV-77131',
    grossAmount: '4964.85',
    currency: 'AUD',
    invoiceDate: '2026-09-23',
    poNumber: 'PO-58020',
  };
  expect(tools.history(query)).toEqual({
    exact: [],
    fuzzy: [
      {
        recordId: 'HIST-3301',
        status: 'PAID',
        matchBasis: 'same purchase order; invoice date 5 days apart; gross amount 0.30% higher',
      },
    ],
  });
  // 0.5% is not below 0.5%, 15 days is outside 14, and nothing links the records.
  for (const change of [
    { grossAmount: '4974.75' },
    { invoiceDate: '2026-10-03' },
    { poNumber: 'PO-99999' },
    { currency: 'NZD' },
  ])
    expect(tools.history({ ...query, ...change }).fuzzy).toEqual([]);
  // The same invoice number after removing punctuation links the records without a PO.
  const renumbered = { ...query, invoiceNumber: 'inv 77120', grossAmount: '4960.00' };
  delete (renumbered as { poNumber?: string }).poNumber;
  expect(tools.history(renumbered).fuzzy).toEqual([
    {
      recordId: 'HIST-3301',
      status: 'PAID',
      matchBasis:
        'same invoice number after removing punctuation; invoice date 5 days apart; gross amount 0.20% higher',
    },
  ]);
  // An exact match is reported once, as exact.
  const exact = tools.history({ ...query, invoiceNumber: 'INV-77120', grossAmount: '4950.00' });
  expect([exact.exact.length, exact.fuzzy.length]).toEqual([1, 0]);
});
it('rejects submit without approval IDs or key before writing', () => {
  const db = openDatabase(':memory:', 'erp-sim');
  const input = {
    runId: 'r',
    financeAction: 'POST',
    approvalIds: ['a'],
    snapshotHash: 'h',
    idempotencyKey: 'k',
    payload: { vendorId: 'v', invoiceRef: 'i', amount: '1', currency: 'AUD' },
  };
  for (const change of [{ approvalIds: [] }, { idempotencyKey: '' }]) {
    expect(
      toolSchemas.submit_finance_decision.input.safeParse({ ...input, ...change }).success,
    ).toBe(false);
    expect(() =>
      post(db, { ...input, ...change }, new FixedClock('2026-11-22'), seededIds('erp')),
    ).toThrow();
  }
  expect(db.prepare('SELECT COUNT(*) AS n FROM erp_postings').get()?.n).toBe(0);
  db.close();
});
