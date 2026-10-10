import type { DatabaseSync } from 'node:sqlite';
import { stateError } from '../resources/files.js';

/** Called inside the owning migration transaction. v5 has two historical
 * predecessors, distinguished by their mandatory tables/columns, never repaired
 * by guessing. v7 is auth-only; v8 includes all background metadata. */
export function upgradeSeatColumns(db:DatabaseSync, version:number, background:boolean) {
  const columns = new Set(db.prepare('PRAGMA table_info(seats)').all().map(row => String(row.name)));
  if (![2,3,4,5,6,7,8].includes(version)) throw stateError();
  if (([7,8].includes(version) || (version === 5 && background)) && (!columns.has('responsibility') || !columns.has('responsibility_revision'))) throw stateError();
  if (([6,7,8].includes(version) || (version === 5 && !background)) && !columns.has('view_work_overview')) throw stateError();
  if (!columns.has('responsibility')) db.exec("ALTER TABLE seats ADD COLUMN responsibility TEXT NOT NULL DEFAULT ''");
  if (!columns.has('responsibility_revision')) db.exec('ALTER TABLE seats ADD COLUMN responsibility_revision INTEGER NOT NULL DEFAULT 1');
  if (!columns.has('view_work_overview')) db.exec('ALTER TABLE seats ADD COLUMN view_work_overview INTEGER NOT NULL DEFAULT 0 CHECK(view_work_overview IN (0,1))');
}
