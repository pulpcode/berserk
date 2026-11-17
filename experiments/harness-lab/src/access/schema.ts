import type { DatabaseSync } from 'node:sqlite';
import { stateError } from '../resources/files.js';

/** Each generation retains the six v7—v12 optional-module layouts.
 * v13—v18 add scenario grants; v19—v24 permit independent system accounts.
 * Earlier binaries reject the newer generation instead of losing its boundary. */
export function baseSchemaVersion(version:number):number {
  return version >= 19 && version <= 24 ? version - 12 : version >= 13 && version <= 18 ? version - 6 : version;
}
export function scenarioSchemaVersion(version:number, previous?:number):number {
  if (version < 7 || version > 12) throw stateError();
  return version + (previous !== undefined && previous >= 19 && previous <= 24 ? 12 : 6);
}
export function preserveScenarioSchema(version:number, previous:number):number {
  return previous >= 13 && previous <= 24 ? scenarioSchemaVersion(version, previous) : version;
}

/** Called inside the owning migration transaction. v5 has two historical
 * predecessors, distinguished by their mandatory tables/columns, never repaired
 * by guessing. v7 is auth-only; v8 includes all background metadata. */
export function upgradeSeatColumns(db:DatabaseSync, version:number, background:boolean) {
  const columns = new Set(db.prepare('PRAGMA table_info(seats)').all().map(row => String(row.name)));
  const base = baseSchemaVersion(version);
  if (![2,3,4,5,6,7,8,9,10,11,12].includes(base)) throw stateError();
  if (([7,8,9,10,11,12].includes(base) || (base === 5 && background)) && (!columns.has('responsibility') || !columns.has('responsibility_revision'))) throw stateError();
  if (([6,7,8,9,10,11,12].includes(base) || (base === 5 && !background)) && !columns.has('view_work_overview')) throw stateError();
  if (version >= 13 && !columns.has('control_scenarios')) throw stateError();
  if (version >= 19) {
    const seat = db.prepare('PRAGMA table_info(accounts)').all().find(column => column.name === 'seat_id');
    if (!seat || seat.notnull !== 0 || !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='account_roles'").get()) throw stateError();
  }
  if (!columns.has('responsibility')) db.exec("ALTER TABLE seats ADD COLUMN responsibility TEXT NOT NULL DEFAULT ''");
  if (!columns.has('responsibility_revision')) db.exec('ALTER TABLE seats ADD COLUMN responsibility_revision INTEGER NOT NULL DEFAULT 1');
  if (!columns.has('view_work_overview')) db.exec('ALTER TABLE seats ADD COLUMN view_work_overview INTEGER NOT NULL DEFAULT 0 CHECK(view_work_overview IN (0,1))');
  if (!columns.has('control_scenarios')) db.exec('ALTER TABLE seats ADD COLUMN control_scenarios INTEGER NOT NULL DEFAULT 0 CHECK(control_scenarios IN (0,1))');
  if (db.prepare('SELECT 1 FROM seats WHERE control_scenarios NOT IN (0,1) OR control_scenarios IS NULL LIMIT 1').get()) throw stateError();
}
