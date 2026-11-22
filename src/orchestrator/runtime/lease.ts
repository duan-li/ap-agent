import { AsyncLocalStorage } from 'node:async_hooks';
import { transaction } from '../../adapters/migrate.ts';
import { conflict, missing } from '../errors.ts';
import type { Store } from './store.ts';

const ownership = new AsyncLocalStorage<{ runId: string; epoch: number }>();

// Called inside the same SQLite write transaction as each durable mutation.
// A worker returning from a slow call cannot write after its lease was taken.
export function checkOwner(store: Store) {
  const held = ownership.getStore();
  if (!held) return;
  const current = store.db
    .prepare('SELECT lease_epoch,lease_owner FROM runs WHERE id=?')
    .get(held.runId);
  if (current?.lease_epoch !== held.epoch || current.lease_owner !== process.pid)
    return conflict('Worker lease lost');
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export async function withLease<T>(
  store: Store,
  id: string,
  until: number,
  work: () => Promise<T>,
) {
  const epoch = transaction(store.db, () => {
    const row = store.db.prepare('SELECT lease_owner,lease_until FROM runs WHERE id=?').get(id);
    if (!row) return missing();
    if (
      row.lease_owner !== null &&
      Number(row.lease_until) > store.clock.now().getTime() &&
      alive(Number(row.lease_owner))
    )
      return conflict('Run is busy');
    const acquired = store.db
      .prepare(
        'UPDATE runs SET lease_owner=?,lease_until=?,lease_epoch=lease_epoch+1 WHERE id=? RETURNING lease_epoch',
      )
      .get(process.pid, until, id)!;
    return Number(acquired.lease_epoch);
  });
  try {
    return await ownership.run({ runId: id, epoch }, work);
  } finally {
    store.db
      .prepare('UPDATE runs SET lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_epoch=?')
      .run(id, epoch);
  }
}
