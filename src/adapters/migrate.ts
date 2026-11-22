import type { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export function migrate(db: DatabaseSync, dir: URL) {
  for (const name of readdirSync(dir)
    .filter((n) => /^\d{4}_.+\.sql$/.test(n))
    .sort()) {
    const version = Number(name.slice(0, 4));
    transaction(db, () => {
      if (Number(db.prepare('PRAGMA user_version').get()?.user_version) >= version) return;
      db.exec(readFileSync(new URL(name, dir), 'utf8'));
      db.exec('PRAGMA user_version=' + version);
    });
  }
}
