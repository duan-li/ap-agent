import { expect, it } from 'vitest';
import { FixedClock } from '../src/adapters/clock.ts';
import { backends } from '../src/adapters/toolBackends.ts';
import { ingest } from '../src/evidence/ingest.ts';
import {
  DeadlineReached,
  ToolFailure,
  callTool,
  readTools,
  type AttemptRecord,
} from '../src/evidence/tools.ts';
import type { WorkflowCase } from '../src/domain/types.ts';

const data = backends(),
  index = ingest();
const start = Date.parse('2026-11-22T00:00:00Z');

// Faults come from a case's faults block, as in the case files.
function setup(faults: WorkflowCase['faults'], deadline = start + 60_000) {
  const clock = new FixedClock('2026-11-22T00:00:00Z');
  const attempts: (AttemptRecord & { at: number })[] = [];
  const tools = readTools(data, index, faults);
  const ctx = {
    clock,
    deadline,
    signal: new AbortController().signal,
    beforeAttempt: () => {},
    afterAttempt: (r: AttemptRecord) => attempts.push({ ...r, at: clock.now().getTime() - start }),
  };
  return { tools, ctx, attempts };
}

it('retries two timeouts and returns the third answer, backing off on the fake clock', async () => {
  const { tools, ctx, attempts } = setup({ get_purchase_order: { timeoutTimes: 2 } });
  const po = await callTool('get_purchase_order', () => tools.po('PO-55210'), ctx);
  expect(po.poNumber).toBe('PO-55210');
  expect(attempts.map((a) => [a.attempt, a.outcome, a.retryInMs, a.at])).toEqual([
    [1, 'TIMEOUT', 100, 0],
    [2, 'TIMEOUT', 200, 100],
    [3, 'OK', undefined, 300],
  ]);
});

it('stops after three timeouts with a typed failure', async () => {
  const { tools, ctx, attempts } = setup({ get_purchase_order: { timeoutTimes: 99 } });
  const failure = await callTool('get_purchase_order', () => tools.po('PO-55388'), ctx).catch(
    (e: unknown) => e,
  );
  expect(failure).toBeInstanceOf(ToolFailure);
  expect(failure).toMatchObject({ tool: 'get_purchase_order', attempts: 3, reason: 'TIMEOUT' });
  expect(attempts).toHaveLength(3);
  expect(attempts[2]!.retryInMs).toBeUndefined();
});

it('retries one transient service error and then succeeds', async () => {
  const { tools, ctx, attempts } = setup({ get_vendor_record: { transientTimes: 1 } });
  const vendor = await callTool('get_vendor_record', () => tools.vendor('V-1007'), ctx);
  expect(vendor.bankLast4).toBe('4471');
  expect(attempts.map((a) => a.outcome)).toEqual(['TRANSIENT', 'OK']);
});

it('never retries a validation error', async () => {
  const { tools, ctx, attempts } = setup({ get_purchase_order: { timeoutTimes: 99 } });
  await expect(callTool('get_purchase_order', () => tools.po(''), ctx)).rejects.toMatchObject({
    reason: 'VALIDATION',
    attempts: 1,
  });
  expect(attempts.map((a) => a.outcome)).toEqual(['VALIDATION']);
});

it('never retries a record the backend does not hold', async () => {
  const { tools, ctx, attempts } = setup({});
  await expect(
    callTool('get_purchase_order', () => tools.po('PO-00000'), ctx),
  ).rejects.toMatchObject({ reason: 'NOT_FOUND', attempts: 1 });
  expect(attempts).toHaveLength(1);
});

it('does not start a backoff that would end past the request deadline', async () => {
  const { tools, ctx, attempts } = setup({ get_purchase_order: { timeoutTimes: 99 } }, start + 250);
  await expect(
    callTool('get_purchase_order', () => tools.po('PO-55388'), ctx),
  ).rejects.toBeInstanceOf(DeadlineReached);
  expect(attempts.map((a) => a.at)).toEqual([0, 100]);
  expect(ctx.clock.now().getTime() - start).toBe(100);
});

it('makes no attempt once the request is aborted', async () => {
  const { tools, ctx, attempts } = setup({});
  const controller = new AbortController();
  controller.abort();
  await expect(
    callTool('get_vendor_record', () => tools.vendor('V-1007'), {
      ...ctx,
      signal: controller.signal,
    }),
  ).rejects.toBeInstanceOf(DeadlineReached);
  expect(attempts).toHaveLength(0);
});

it('lets the budget refuse an attempt before it is made', async () => {
  const { tools, ctx, attempts } = setup({ get_purchase_order: { timeoutTimes: 99 } });
  let left = 2;
  const refused = new Error('budget');
  const budgeted = {
    ...ctx,
    beforeAttempt: () => {
      if (left-- <= 0) throw refused;
    },
  };
  await expect(callTool('get_purchase_order', () => tools.po('PO-55388'), budgeted)).rejects.toBe(
    refused,
  );
  expect(attempts).toHaveLength(2);
});

it('does not retry local retrieval', async () => {
  const { ctx, attempts } = setup({});
  await expect(
    callTool(
      'retrieve_finance_documents',
      () => {
        throw new Error('index unavailable');
      },
      ctx,
    ),
  ).rejects.toMatchObject({ reason: 'ERROR', attempts: 1 });
  expect(attempts).toHaveLength(1);
});

it('treats a read that answers after its timeout as a timeout, and retries it', async () => {
  const { tools, ctx, attempts } = setup({});
  let slow = true;
  const po = await callTool(
    'get_purchase_order',
    () => {
      if (slow) ctx.clock.advance(2100);
      slow = false;
      return tools.po('PO-55210');
    },
    ctx,
  );
  expect(po.poNumber).toBe('PO-55210');
  expect(attempts.map((a) => [a.outcome, a.durationMs])).toEqual([
    ['TIMEOUT', 2100],
    ['OK', 0],
  ]);
});

it('discards a read that answers after the request deadline', async () => {
  const { tools, ctx, attempts } = setup({}, start + 500);
  await expect(
    callTool(
      'get_purchase_order',
      () => {
        ctx.clock.advance(2100);
        return tools.po('PO-55210');
      },
      ctx,
    ),
  ).rejects.toBeInstanceOf(DeadlineReached);
  expect(attempts.map((a) => a.outcome)).toEqual(['TIMEOUT']);
});

it('discards a read that is within its timeout but past the deadline', async () => {
  const { tools, ctx, attempts } = setup({}, start + 500);
  await expect(
    callTool(
      'get_vendor_record',
      () => {
        ctx.clock.advance(600);
        return tools.vendor('V-1007');
      },
      ctx,
    ),
  ).rejects.toBeInstanceOf(DeadlineReached);
  expect(attempts.map((a) => a.outcome)).toEqual(['DEADLINE_EXCEEDED']);
});

it('keeps a late submit reply, because the write has happened', async () => {
  const { ctx, attempts } = setup({}, start + 500);
  const reply = await callTool(
    'submit_finance_decision',
    () => {
      ctx.clock.advance(6000);
      return 'posted';
    },
    ctx,
  );
  expect(reply).toBe('posted');
  expect(attempts.map((a) => a.outcome)).toEqual(['OK']);
});

it('makes a write attempt even past the deadline, because its caller has committed', async () => {
  const { ctx, attempts } = setup({}, start - 1);
  await expect(callTool('submit_finance_decision', () => 'posted', ctx)).resolves.toBe('posted');
  expect(attempts.map((a) => a.outcome)).toEqual(['OK']);
});
