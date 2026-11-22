import type { RequestMeta } from '../../domain/types.ts';
import { transaction } from '../../adapters/migrate.ts';
import { callTool, type ToolName } from '../../evidence/tools.ts';
import type { Store } from './store.ts';
export async function step<T>(
  store: Store,
  id: string,
  meta: RequestMeta,
  name: string,
  work: () => T | Promise<T>,
): Promise<T> {
  const saved = store.db
    .prepare('SELECT output_json FROM steps WHERE run_id=? AND name=?')
    .get(id, name);
  if (saved) return JSON.parse(String(saved.output_json)) as T;
  store.spend(id, 'steps');
  const result = await work();
  transaction(store.db, () => {
    store.db.prepare('INSERT INTO steps VALUES(?,?,?)').run(id, name, store.json(result));
    store.db.prepare('UPDATE runs SET current_step=? WHERE id=?').run(name, id);
    store.event(id, meta, 'STEP_COMPLETED', { name });
  });
  return result;
}
// Every attempt, retries included, is charged to the run's tool budget and
// written as a TOOL_CALL event before the next one starts.
export function attempt<T>(
  store: Store,
  id: string,
  meta: RequestMeta,
  name: ToolName,
  work: () => T,
): Promise<T> {
  return callTool(name, work, {
    clock: store.clock,
    deadline: meta.deadline,
    signal: meta.signal,
    beforeAttempt: () => store.spend(id, 'tool_calls'),
    afterAttempt: (record) => store.event(id, meta, 'TOOL_CALL', { name, ...record }),
  });
}
