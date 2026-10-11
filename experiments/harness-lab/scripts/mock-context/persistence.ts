import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
/** One bounded scene snapshot, including actions, is committed as one SQLite row. */
export function simulationPersistence(path?: string) {
  if (!path) return {load: () => undefined as unknown, save: (_value: unknown) => {void _value;}, close: () => {}};
  mkdirSync(dirname(path), {recursive:true});
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS simulation_snapshot (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)');
  return {
    load(): unknown {const row = db.prepare('SELECT body FROM simulation_snapshot WHERE id=1').get(); return row ? JSON.parse(String(row.body)) : undefined;},
    save(value: unknown) {db.prepare('INSERT INTO simulation_snapshot(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(value));},
    close() {db.close();},
  };
}
