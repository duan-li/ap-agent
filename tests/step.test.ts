import { expect, it } from 'vitest';
import { durableRun, value } from './durableRun.ts';
it('replays through reconcile after restarting and executes only the remaining steps', async () => {
  const t = durableRun('FIN-001-crash');
  try {
    await t.start();
    const row = t.runtime.db.prepare('SELECT id,current_step FROM runs').get()!;
    expect(row.current_step).toBe('reconcile');
    t.reopen();
    const id = String(row.id);
    const before = value(await t.runtime.app.getRun(id, t.meta('get')));
    const after = value(await t.runtime.app.resume(id, t.meta('resume')));
    expect(after.status).toBe('AWAITING_APPROVAL');
    expect(after.budget.toolCalls).toBe(before.budget.toolCalls);
    expect(
      after.events
        .slice(before.events.length)
        .filter((e) => e.type === 'STEP_COMPLETED')
        .map((e) => e.name),
    ).toEqual(['report', 'request_approval']);
  } finally {
    t.close();
  }
});
