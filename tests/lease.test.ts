import { Store } from '../src/orchestrator/runtime/store.ts';
import { withLease } from '../src/orchestrator/runtime/lease.ts';
import { expect, it, vi } from 'vitest';
import { durableRun } from './durableRun.ts';
it('records one decision for concurrent approval deliveries', async () => {
  const t = durableRun('FIN-005');
  const peer = t.openPeer();
  try {
    const cmd = await t.command();
    const replies = await Promise.all([
      t.runtime.app.resolveApproval(cmd, t.meta('one')),
      peer.app.resolveApproval(cmd, t.meta('two')),
    ]);
    expect(replies.map((r) => r.kind).sort()).toEqual(['error', 'ok']);
    expect(replies.find((r) => r.kind === 'error')).toMatchObject({ error: { type: 'Conflict' } });
    expect(t.runtime.erp.prepare('SELECT count(*) AS n FROM erp_postings').get()?.n).toBe(1);
  } finally {
    peer.close();
    t.close();
  }
});

it('fences an expired owner after a new worker acquires the run', async () => {
  const t = durableRun('FIN-005');
  const peer = t.openPeer();
  try {
    const cmd = await t.command();
    const store = new Store(
      t.runtime.db,
      t.clock,
      (s) => s,
      () => {},
    );
    const other = new Store(
      peer.db,
      t.clock,
      (s) => s,
      () => {},
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const old = withLease(store, cmd.runId, t.clock.now().getTime() + 10, async () => {
      await gate;
      store.event(cmd.runId, t.meta('late'), 'STALE_WRITE');
    });
    t.clock.advance(11);
    await withLease(other, cmd.runId, t.clock.now().getTime() + 1000, async () => {
      release();
      await expect(old).rejects.toMatchObject({ detail: { type: 'Conflict' } });
    });
    expect(store.view(cmd.runId)?.events.some((e) => e.type === 'STALE_WRITE')).toBe(false);
  } finally {
    peer.close();
    t.close();
  }
});

it('resumes an abandoned run immediately when the replacement has the same PID', async () => {
  const t = durableRun('FIN-001-crash');
  try {
    const start = await t.start();
    if (start.kind !== 'error' || !('runId' in start.error) || !start.error.runId)
      throw new Error('Missing interrupted run');
    const id = start.error.runId;
    // Recreate the v3 column and an unexpired lease from a worker whose PID has been reused.
    t.runtime.db.exec(
      'ALTER TABLE runs DROP COLUMN lease_owner; ALTER TABLE runs ADD COLUMN lease_owner INTEGER; PRAGMA user_version=3',
    );
    t.runtime.db
      .prepare('UPDATE runs SET lease_owner=?,lease_until=? WHERE id=?')
      .run(process.pid, t.clock.now().getTime() + 60000, id);
    t.reopen();
    const resumed = await t.runtime.app.resume(id, t.meta('resume'));
    expect(resumed).toMatchObject({ kind: 'ok', value: { status: 'AWAITING_APPROVAL' } });
  } finally {
    t.close();
  }
});

it('resumes after one missed renewal from a different worker within the same request', async () => {
  const t = durableRun('FIN-001-crash');
  try {
    const start = await t.start();
    if (start.kind !== 'error' || !('runId' in start.error) || !start.error.runId)
      throw new Error('Missing interrupted run');
    const id = start.error.runId;
    const expires = t.clock.now().getTime() + 2000;
    t.runtime.db
      .prepare('UPDATE runs SET lease_owner=?,lease_until=? WHERE id=?')
      .run('dead-worker', expires, id);
    t.reopen();
    expect(await t.runtime.app.resume(id, t.meta('resume'))).toMatchObject({
      kind: 'ok',
      value: { status: 'AWAITING_APPROVAL' },
    });
    expect(t.clock.now().getTime()).toBe(expires);
  } finally {
    t.close();
  }
});

it('renews a live lease only up to the request deadline', async () => {
  const t = durableRun('FIN-005');
  try {
    const { runId } = await t.command();
    const store = new Store(
      t.runtime.db,
      t.clock,
      (s) => s,
      () => {},
    );
    const row = () => t.runtime.db.prepare('SELECT lease_until FROM runs WHERE id=?').get(runId)!;
    const start = t.clock.now().getTime();
    const deadline = start + 2500;
    vi.useFakeTimers();
    await withLease(store, runId, deadline, async () => {
      expect(row().lease_until).toBe(start + 2000);
      t.clock.advance(1000);
      vi.advanceTimersByTime(1000);
      expect(row().lease_until).toBe(deadline);
    });
    expect(row().lease_until).toBeNull();
  } finally {
    vi.useRealTimers();
    t.close();
  }
});
