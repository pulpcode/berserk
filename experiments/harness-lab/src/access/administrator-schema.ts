import type { DatabaseSync } from 'node:sqlite';
import { RequestError } from '../contracts/errors.js';
import { stateError } from '../resources/files.js';
import { baseSchemaVersion } from './schema.js';
import { SystemRoles } from './system-roles.js';

/** Offline only: caller owns stopped-data backup and migration marker.
 * Rebuild with foreign_keys disabled outside the transaction, retaining the
 * parent name so references in every existing child table remain unchanged. */
export function migrateAdministratorAccounts(db: DatabaseSync): void {
  if (db.isTransaction) throw new Error('管理员账号迁移必须在独立离线事务中运行。');
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
  const base = baseSchemaVersion(version);
  if (version < 13 || version > 24 || base < 7 || base > 12) throw stateError();
  const columns = db.prepare('PRAGMA table_info(accounts)').all();
  if (JSON.stringify(columns.map(column => column.name)) !== JSON.stringify(['id','username','display_name','seat_id','salt','password_hash','enabled'])) throw stateError();
  const nullable = columns.find(column => column.name === 'seat_id')?.notnull === 0;
  if (version >= 19) {
    if (!nullable || !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='account_roles'").get()) throw stateError();
    if (db.prepare('PRAGMA foreign_key_check').get()) throw stateError();
    return;
  }
  if (nullable || db.prepare('PRAGMA foreign_key_check').get()) throw stateError();
  const related = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='accounts' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type,name").all().map(row => String(row.sql));
  const previousForeignKeys = Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys);
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      SystemRoles.migrate(db);
      db.exec(`CREATE TABLE accounts_independent_migration(
        id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL,
        seat_id TEXT REFERENCES seats(id), salt TEXT NOT NULL, password_hash TEXT NOT NULL, enabled INTEGER NOT NULL
      );
      INSERT INTO accounts_independent_migration SELECT id,username,display_name,seat_id,salt,password_hash,enabled FROM accounts;
      DROP TABLE accounts;
      ALTER TABLE accounts_independent_migration RENAME TO accounts;`);
      for (const sql of related) db.exec(sql);
      if (db.prepare('PRAGMA foreign_key_check').get()) throw stateError();
      db.exec(`PRAGMA user_version=${base + 12}; COMMIT`);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.exec(`PRAGMA foreign_keys=${previousForeignKeys ? 'ON' : 'OFF'}`); }
}

export function requireAdministratorSchema(db: DatabaseSync): void {
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
  if (version < 19 || version > 24) throw new RequestError('ACCESS_MIGRATION_REQUIRED', '请先停服备份并执行管理员账号迁移。', 409);
  const seat = db.prepare('PRAGMA table_info(accounts)').all().find(column => column.name === 'seat_id');
  if (!seat || seat.notnull !== 0 || !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='account_roles'").get()) throw stateError();
}
