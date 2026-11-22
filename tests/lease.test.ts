import { Store } from '../src/orchestrator/runtime/store.ts';
import { withLease } from '../src/orchestrator/runtime/lease.ts';
import { expect, it } from 'vitest';
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
