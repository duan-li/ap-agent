import { DatabaseSync } from 'node:sqlite';
import { migrate } from './migrate.ts';
export function openDatabase(path: string, schema: 'migrations' | 'erp-sim') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON');
  migrate(db, new URL('../../' + schema + '/', import.meta.url));
  return db;
}
