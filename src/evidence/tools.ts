import { Decimal } from 'decimal.js';
import { ZodError } from 'zod';
import {
  BackendTimeout,
  BackendUnavailable,
  RecordNotFound,
  faultInjector,
  normaliseInvoice,
  type backends,
} from '../adapters/toolBackends.ts';
import type { Clock } from '../adapters/clock.ts';
import {
  toolSchemas as s,
  type Index,
  type Query,
  type HistoryQuery,
  type WorkflowCase,
} from '../domain/types.ts';
import { retrieve } from './retrieve.ts';

// One attempt per call. Retries, backoff and the deadline live in callTool.
export function readTools(
  data: ReturnType<typeof backends>,
  index: Index,
  faults: WorkflowCase['faults'] = {},
) {
  const inject = faultInjector(faults);
  return {
    retrieve(query: Query, date: string) {
      return s.retrieve_finance_documents.output.parse(
        retrieve(index, s.retrieve_finance_documents.input.parse(query), date),
      );
    },
    vendor(id: string) {
      const { vendorId } = s.get_vendor_record.input.parse({ vendorId: id });
      inject('get_vendor_record');
      const v = data.vendors.find((v) => v.vendorId === vendorId);
      if (!v) throw new RecordNotFound('get_vendor_record');
      return s.get_vendor_record.output.parse({
        vendorId,
        status: v.status,
        riskFlags: v.riskFlags,
        bankLast4: v.bank.accountNumber.slice(-4),
        bankAccountVersion: v.bank.lastChangedAt,
        lastChangedAt: v.bank.lastChangedAt,
        verified: v.bank.verified,
        lastUpdated: v.lastUpdated,
      });
    },
    po(id: string) {
      const { poNumber } = s.get_purchase_order.input.parse({ poNumber: id });
      inject('get_purchase_order');
      const order = data.orders.find((p) => p.poNumber === poNumber);
      if (!order) throw new RecordNotFound('get_purchase_order');
      return s.get_purchase_order.output.parse({
        ...order,
        receipts: data.receipts.filter((r) => r.poNumber === poNumber),
      });
    },
    history(input: HistoryQuery) {
      const q = s.check_invoice_history.input.parse(input);
      inject('check_invoice_history');
      const exact = data.history.filter(
        (h) =>
          h.vendorId === q.vendorId &&
          h.currency === q.currency &&
          h.normalisedNumber === normaliseInvoice(q.invoiceNumber) &&
          new Decimal(h.grossAmount).eq(q.grossAmount),
      );
      return s.check_invoice_history.output.parse({
        exact: exact.map((h) => ({
          recordId: h.historyId,
          status: h.status,
          matchBasis: 'vendor, invoice and gross amount',
        })),
        fuzzy: [],
      });
    },
  };
}
export type ReadTools = ReturnType<typeof readTools>;

// Apply the case's vendor-master change to this run's view of the simulator.
export function submitEvidence(
  tools: ReadTools,
  settings: WorkflowCase['faults'],
  resumed: boolean,
): ReadTools {
  const change =
    (resumed && settings.vendorChangeBeforeResume) || settings.vendorChangeBeforeSubmit;
  if (!change) return tools;
  return {
    ...tools,
    vendor(id) {
      const record = tools.vendor(id);
      return change.vendorId === id ? { ...record, ...change.set } : record;
    },
  };
}

// The tool table in TECH.md, Contracts. Local retrieval is not retried. Submit
// retries belong to outbox recovery, so it makes one attempt per send here.
// A read that answers after its timeout or the request deadline is discarded.
// A submit reply is always kept: once the ERP answered, the write happened.
export const toolPolicy = {
  retrieve_finance_documents: { timeoutMs: 2000, attempts: 1, read: true },
  get_vendor_record: { timeoutMs: 2000, attempts: 3, read: true },
  get_purchase_order: { timeoutMs: 2000, attempts: 3, read: true },
  check_invoice_history: { timeoutMs: 2000, attempts: 3, read: true },
  submit_finance_decision: { timeoutMs: 5000, attempts: 1, read: false },
} as const;
export type ToolName = keyof typeof toolPolicy;

// Exponential backoff without jitter: 100 ms, then 200 ms.
export function backoffMs(failedAttempt: number) {
  return 100 * 2 ** (failedAttempt - 1);
}

export type AttemptOutcome =
  'OK' | 'TIMEOUT' | 'TRANSIENT' | 'VALIDATION' | 'NOT_FOUND' | 'ERROR' | 'DEADLINE_EXCEEDED';
export interface AttemptRecord {
  attempt: number;
  outcome: AttemptOutcome;
  durationMs: number;
  retryInMs?: number;
}
export interface CallContext {
  clock: Clock;
  deadline: number;
  signal: AbortSignal;
  // Called before every attempt; may throw to refuse it (the run budget).
  beforeAttempt(): void;
  afterAttempt(record: AttemptRecord): void;
}

export class ToolFailure extends Error {
  constructor(
    readonly tool: ToolName,
    readonly attempts: number,
    readonly reason: Exclude<AttemptOutcome, 'OK'>,
  ) {
    super(tool + ' failed after ' + attempts + ' attempt(s): ' + reason);
  }
}
export class DeadlineReached extends Error {
  constructor() {
    super('Request deadline reached');
  }
}

function classify(error: unknown): Exclude<AttemptOutcome, 'OK'> {
  if (error instanceof BackendTimeout) return 'TIMEOUT';
  if (error instanceof BackendUnavailable) return 'TRANSIENT';
  if (error instanceof ZodError) return 'VALIDATION';
  if (error instanceof RecordNotFound) return 'NOT_FOUND';
  return 'ERROR';
}

export function checkDeadline(ctx: Pick<CallContext, 'clock' | 'deadline' | 'signal'>) {
  if (ctx.signal.aborted || ctx.clock.now().getTime() >= ctx.deadline) throw new DeadlineReached();
}

// Timeouts and transient errors are retried up to the tool's attempt limit.
// Validation errors and missing records are answers, so they are never retried.
// A backoff that would end past the request deadline is not started.
// The simulated backends are synchronous and cannot be interrupted, so each
// attempt is judged when it returns.
export async function callTool<T>(
  tool: ToolName,
  work: () => T | Promise<T>,
  ctx: CallContext,
): Promise<T> {
  const { attempts, timeoutMs, read } = toolPolicy[tool];
  for (let attempt = 1; ; attempt++) {
    // A write is checked by its caller before the intent moves to SENDING.
    // Refusing it here would leave a SENDING row that was never sent.
    if (read) checkDeadline(ctx);
    ctx.beforeAttempt();
    const started = ctx.clock.now().getTime();
    let value: T | undefined;
    let reason: Exclude<AttemptOutcome, 'OK'> | undefined;
    try {
      value = await work();
    } catch (error) {
      reason = classify(error);
    }
    const durationMs = ctx.clock.now().getTime() - started;
    const pastDeadline = ctx.signal.aborted || ctx.clock.now().getTime() >= ctx.deadline;
    if (!reason && read && durationMs > timeoutMs) reason = 'TIMEOUT';
    if (!reason && !(read && pastDeadline)) {
      ctx.afterAttempt({ attempt, outcome: 'OK', durationMs });
      return value as T;
    }
    if (pastDeadline) {
      ctx.afterAttempt({ attempt, outcome: reason ?? 'DEADLINE_EXCEEDED', durationMs });
      throw new DeadlineReached();
    }
    const failed = reason!;
    const retry = (failed === 'TIMEOUT' || failed === 'TRANSIENT') && attempt < attempts;
    if (!retry) {
      ctx.afterAttempt({ attempt, outcome: failed, durationMs });
      throw new ToolFailure(tool, attempt, failed);
    }
    const wait = backoffMs(attempt);
    ctx.afterAttempt({ attempt, outcome: failed, durationMs, retryInMs: wait });
    if (ctx.clock.now().getTime() + wait >= ctx.deadline) throw new DeadlineReached();
    await ctx.clock.sleep(wait);
  }
}
