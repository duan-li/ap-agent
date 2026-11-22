import type { RequestMeta } from '../../domain/types.ts';
import { transaction } from '../../adapters/migrate.ts';
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
  const result = await work();
  transaction(store.db, () => {
    store.db.prepare('INSERT INTO steps VALUES(?,?,?)').run(id, name, store.json(result));
    store.db.prepare('UPDATE runs SET current_step=? WHERE id=?').run(name, id);
    store.event(id, meta, 'STEP_COMPLETED', { name });
  });
  return result;
}
export function attempt<T>(
  store: Store,
  id: string,
  meta: RequestMeta,
  name: string,
  work: () => T,
) {
  const start = store.clock.now().getTime();
  let outcome = 'ERROR';
  try {
    const result = work();
    outcome = 'OK';
    return result;
  } finally {
    store.event(id, meta, 'TOOL_CALL', {
      name,
      attempt: 1,
      outcome,
      durationMs: store.clock.now().getTime() - start,
    });
  }
}
