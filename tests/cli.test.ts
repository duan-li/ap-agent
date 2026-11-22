import { it, expect } from 'vitest';
import { decode } from '../src/entrypoints/entryPoint.ts';
import { exitCode } from '../src/entrypoints/json.ts';
import { callbackDeliveryId } from '../src/entrypoints/cli.ts';
it.each([
  'get r',
  'resume r',
  'approve r --approval a --approver u',
  'reject r --approval a --approver u --reason incorrect',
  'start --case cases/FIN-001.json',
  'ingest',
  'eval',
])('decodes %s', (args) => {
  expect(decode(args.split(' ')).command).toBe(args.split(' ')[0]);
});
it('derives one delivery ID per callback content when none is given', () => {
  const id = (args: string) => callbackDeliveryId(decode(args.split(' ')));
  const approve = 'approve r --approval a --approver u-204';
  expect(id(approve)).toBe(id(approve));
  expect(id(approve)).not.toBe(id('approve r --approval a --approver u-201'));
  expect(id(approve)).not.toBe(id('reject r --approval a --approver u-204 --reason x'));
  expect(id('reject r --approval a --approver u-204 --reason x')).not.toBe(
    id('reject r --approval a --approver u-204 --reason y'),
  );
  expect(id('get r')).toBeUndefined();
});
it('maps typed errors', () => {
  expect(
    (
      [
        'Validation',
        'Unauthorized',
        'Conflict',
        'NotFound',
        'Transient',
        'DeadlineExceeded',
      ] as const
    ).map(exitCode),
  ).toEqual([2, 3, 4, 5, 75, 75]);
});

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunView } from '../src/application/apService.ts';

it('persists the FIN-001 review, audit trail and approval across CLI invocations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ap-cli-'));
  function cli(args: string[], code = 0) {
    const processResult = spawnSync(
      process.execPath,
      [
        '--import',
        'data:text/javascript,' +
          encodeURIComponent(
            "import {mock} from 'node:test';mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-22T00:00:00Z')})",
          ),
        '--import',
        'tsx',
        'src/entrypoints/cli.ts',
        ...args,
      ],
      { encoding: 'utf8', env: { ...process.env, MODEL_PROVIDER: 'fake', DATA_DIR: dir } },
    );
    expect(processResult.status).toBe(code);
    return JSON.parse(processResult.stdout);
  }
  try {
    expect(cli(['ingest']).chunks).toBeGreaterThan(0);
    expect(cli(['approve', 'r', '--unknown'], 2).type).toBe('Validation');
    expect(cli(['get', 'missing-run'], 5).type).toBe('NotFound');
    const plainPath = join(dir, 'plain.json');
    writeFileSync(
      plainPath,
      JSON.stringify({
        caseId: 'plain',
        invoiceRef: 'INV-88412',
        vendor: 'V-1007',
        amount: '17600.00',
        currency: 'AUD',
      }),
    );
    const plain: RunView = cli(['start', '--case', plainPath]);
    expect(plain.result?.proposal).toMatchObject({
      outcome: 'HOLD_FOR_INFORMATION',
      nextAction: { owner: 'Accounts Payable', action: expect.stringMatching(/line/i) },
    });
    expect(plain.result?.unknowns).toContain('invoiceLines');
    expect(
      plain.events.some(
        (e) => e.type === 'APPROVAL_REQUESTED' || e.name === 'submit_finance_decision',
      ),
    ).toBe(false);
    const held: RunView = cli(['start', '--case', 'cases/FIN-001-tol-breach.json']);
    expect(held.result?.proposal.outcome).toBe('HOLD_FOR_INFORMATION');
    expect(held.result?.confidence.level).toBe('HIGH');
    const started: RunView = cli(['start', '--case', 'cases/FIN-001.json']);
    const id = started.runId;
    const waiting: RunView = cli(['get', id]);
    expect(waiting.currentStep).toBe('request_approval');
    const result = waiting.result!;
    expect(result.sourcedFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'invoiceLine1', value: '10 x 1200.00 = 12000.00' }),
        expect.objectContaining({ field: 'invoiceLine2', value: '10 x 400.00 = 4000.00' }),
        expect.objectContaining({ field: 'taxAmount', value: '1600.00' }),
        expect.objectContaining({ field: 'totalAmount', value: '17600.00' }),
        expect.objectContaining({
          field: 'poLine2',
          source: { type: 'SYSTEM_OF_RECORD', ref: 'get_purchase_order:PO-55210#line2' },
        }),
        expect.objectContaining({
          field: 'receiptLine2',
          source: { type: 'SYSTEM_OF_RECORD', ref: 'GRN-7781#line2' },
        }),
      ]),
    );
    expect(result.policyFindings.map((f) => [f.id, f.passed, f.citation])).toEqual([
      ['F-THREE_WAY_MATCH', true, 'FIN-POL-002 v2.4 §2'],
      ['F-TAX_AND_TOTAL', true, 'FIN-POL-002 v2.4 §2'],
      ['F-VENDOR_ACTIVE', true, 'FIN-POL-004 v5.1 §4'],
      ['F-DUPLICATE_CHECK', true, 'FIN-POL-005 v2.8 §1'],
      ['F-APPROVAL_REQUIREMENT', true, 'FIN-POL-003 v4.0 §2'],
    ]);
    expect(result.approvalSnapshot).toMatchObject({
      amount: '17600.00',
      action: 'POST',
      bankAccountVersion: '2024-03-11',
      policyVersions: {
        'FIN-POL-002': '2.4',
        'FIN-POL-003': '4.0',
        'FIN-POL-004': '5.1',
        'FIN-POL-005': '2.8',
      },
    });
    expect(result.unknowns).toEqual([]);
    for (const event of waiting.events) {
      expect(event).toMatchObject({
        ts: expect.any(String),
        runId: id,
        correlationId: expect.any(String),
      });
      if (event.type === 'TOOL_CALL')
        expect(event).toMatchObject({
          name: expect.any(String),
          attempt: 1,
          outcome: 'OK',
          durationMs: expect.any(Number),
        });
      if (event.type === 'MODEL_CALL')
        expect(event).toMatchObject({
          purpose: expect.any(String),
          outcome: 'OK',
          durationMs: expect.any(Number),
        });
      if (event.type === 'RETRIEVAL')
        expect(event).toMatchObject({
          query: expect.any(String),
          chunks: expect.arrayContaining([
            expect.objectContaining({ chunkId: expect.any(String), version: expect.any(String) }),
          ]),
        });
    }
    const next = result.proposal.nextAction;
    if (!('approvalId' in next)) throw new Error('Missing approval');
    const approve = ['approve', id, '--approval', next.approvalId, '--approver'];
    expect(cli([...approve, 'u-201'], 3).type).toBe('Unauthorized');
    expect(cli(['resume', id]).status).toBe('AWAITING_APPROVAL');
    const first = cli([...approve, 'u-204']);
    expect(first.status).toBe('COMPLETED');
    // The same callback repeated without --delivery-id replays the first response.
    expect(cli([...approve, 'u-204'])).toEqual(first);
    expect(
      cli(
        ['reject', id, '--approval', next.approvalId, '--approver', 'u-204', '--reason', 'late'],
        4,
      ).type,
    ).toBe('Conflict');
    const final: RunView = cli(['get', id]);
    expect(final.outbox).toMatchObject({
      status: 'SENT',
      postingRef: final.result!.actionsTaken[0]!.postingRef,
    });
    expect(final.result!.actionsTaken).toHaveLength(1);
    expect(final.events.filter((e) => e.type === 'APPROVAL_DUPLICATE_IGNORED')).toHaveLength(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 15000);
