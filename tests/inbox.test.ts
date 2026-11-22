import { expect, it } from 'vitest';
import { durableRun, value } from './durableRun.ts';
it('replays the original body after restart and refuses a changed request', async () => {
  const t = durableRun('FIN-005');
  try {
    const cmd = await t.command(),
      meta = t.meta('same');
    const first = await t.runtime.app.resolveApproval(cmd, meta);
    t.reopen();
    const second = await t.runtime.app.resolveApproval(cmd, meta);
    expect(second.kind).toBe('duplicate');
    expect(JSON.stringify(value(second))).toBe(JSON.stringify(value(first)));
    expect(
      await t.runtime.app.resolveApproval({ ...cmd, decision: 'REJECT', reason: 'Changed' }, meta),
    ).toMatchObject({ kind: 'error', error: { type: 'Conflict' } });
  } finally {
    t.close();
  }
});
