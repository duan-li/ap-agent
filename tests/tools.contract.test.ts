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
