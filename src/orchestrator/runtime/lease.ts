import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { transaction } from '../../adapters/migrate.ts';
import { WorkflowError, conflict, missing } from '../errors.ts';
import type { Store } from './store.ts';

const worker = randomUUID();
const leaseMs = 2000;
interface HeldLease {
  runId: string;
  epoch: number;
  renewalError?: unknown;
}
const ownership = new AsyncLocalStorage<HeldLease>();

// Called inside the same SQLite write transaction as each durable mutation.
export function checkOwner(store: Store) {
  const held = ownership.getStore();
  if (!held) return;
  if (held.renewalError) throw held.renewalError;
  const current = store.db
    .prepare('SELECT lease_epoch,lease_owner FROM runs WHERE id=?')
    .get(held.runId);
  if (current?.lease_epoch !== held.epoch || current.lease_owner !== worker)
    return conflict('Worker lease lost');
}

export async function withLease<T>(
  store: Store,
  id: string,
  deadline: number,
  work: () => Promise<T>,
  resumeSignal?: AbortSignal,
) {
  function claim() {
    return transaction(store.db, () => {
      const now = store.clock.now().getTime();
      if (now >= deadline || resumeSignal?.aborted)
        throw new WorkflowError({ type: 'DeadlineExceeded', runId: id });
      const row = store.db.prepare('SELECT lease_owner,lease_until FROM runs WHERE id=?').get(id);
      if (!row) return missing();
      if (row.lease_owner !== null && Number(row.lease_until) > now) {
        if (row.lease_owner === worker) return conflict('Run is busy');
        return { busyUntil: Number(row.lease_until) } as const;
      }
      const acquired = store.db
        .prepare(
          'UPDATE runs SET lease_owner=?,lease_until=?,lease_epoch=lease_epoch+1 WHERE id=? RETURNING lease_epoch',
        )
        .get(worker, Math.min(now + leaseMs, deadline), id)!;
      return { epoch: Number(acquired.lease_epoch) } as const;
    });
  }

  let claimResult = claim();
  if (claimResult.busyUntil !== undefined) {
    // Resume can outwait one missed heartbeat. A renewed lease still belongs to its worker.
    if (!resumeSignal || claimResult.busyUntil >= deadline) return conflict('Run is busy');
    const remaining = claimResult.busyUntil - store.clock.now().getTime();
    if (remaining > 0) await store.clock.sleep(Math.min(remaining, leaseMs));
    claimResult = claim();
    if (claimResult.busyUntil !== undefined) return conflict('Run is busy');
  }
  const held: HeldLease = { runId: id, epoch: claimResult.epoch };
  const renew = store.db.prepare(
    'UPDATE runs SET lease_until=? WHERE id=? AND lease_epoch=? AND lease_owner=?',
  );
  const heartbeat = setInterval(() => {
    try {
      renew.run(Math.min(store.clock.now().getTime() + leaseMs, deadline), id, held.epoch, worker);
    } catch (error) {
      held.renewalError = error;
      clearInterval(heartbeat);
    }
  }, leaseMs / 4);
  heartbeat.unref();
  try {
    return await ownership.run(held, work);
  } finally {
    clearInterval(heartbeat);
    store.db
      .prepare('UPDATE runs SET lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_epoch=?')
      .run(id, held.epoch);
  }
}
