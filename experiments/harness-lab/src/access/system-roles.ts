import type { DatabaseSync } from 'node:sqlite';
import { RequestError } from '../contracts/errors.js';
import { stateError } from '../resources/files.js';

export interface SystemAdministrator {
  userId: string;
  username: string;
  displayName: string;
  enabled: boolean;
  grantedAt: string;
}

/** System roles belong to accounts, independently of seat business capabilities. */
export class SystemRoles {
  constructor(private readonly db: DatabaseSync) {}

  /** Safe metadata-only upgrade; nullable account migration is separately offline. */
  static migrate(db: DatabaseSync): void {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts'").get()) throw stateError();
    const legacy = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='capability_account_roles'").get());
    const installed = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='account_roles'").get());
    for (const name of [...(legacy ? ['capability_account_roles'] : []), ...(installed ? ['account_roles'] : [])]) SystemRoles.check(db, name);
    db.exec('SAVEPOINT system_roles_upgrade');
    try {
      if (legacy && !installed) db.exec('ALTER TABLE capability_account_roles RENAME TO account_roles');
      else {
        db.exec(`CREATE TABLE IF NOT EXISTS account_roles(
          user_id TEXT NOT NULL REFERENCES accounts(id),
          role TEXT NOT NULL CHECK(role='administrator'),
          granted_at TEXT NOT NULL,
          PRIMARY KEY(user_id,role)
        )`);
        if (legacy) db.exec('INSERT OR IGNORE INTO account_roles SELECT user_id,role,granted_at FROM capability_account_roles; DROP TABLE capability_account_roles');
      }
      SystemRoles.check(db, 'account_roles');
      db.exec('RELEASE system_roles_upgrade');
    } catch (error) { db.exec('ROLLBACK TO system_roles_upgrade; RELEASE system_roles_upgrade'); throw error; }
  }

  private static check(db: DatabaseSync, table: string) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name));
    if (JSON.stringify(columns) !== JSON.stringify(['user_id', 'role', 'granted_at'])
      || db.prepare(`SELECT 1 FROM ${table} WHERE role<>'administrator' OR granted_at IS NULL OR user_id NOT IN (SELECT id FROM accounts) LIMIT 1`).get()) throw stateError();
  }
  private table(): 'account_roles' | 'capability_account_roles' | undefined {
    // Reading an older root does not mutate it. Its next explicit migration moves
    // the same grants, and does not infer a role from any business permission.
    for (const table of ['account_roles', 'capability_account_roles'] as const) if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) return table;
    return undefined;
  }
  has(userId: string): boolean {
    const table = this.table(); if (!table) return false;
    return Boolean(this.db.prepare(`SELECT 1 FROM ${table} r JOIN accounts a ON a.id=r.user_id
      WHERE r.user_id=? AND r.role='administrator' AND a.enabled=1`).get(userId));
  }
  requireAdministrator(userId: string | undefined): void {
    if (!userId || !this.has(userId)) throw new RequestError('FORBIDDEN', '当前账号没有管理员权限。', 403);
  }
  grant(username: string): SystemAdministrator {
    const table = this.table();
    if (!table) throw new RequestError('ACCESS_MIGRATION_REQUIRED', '请先完成管理员账号迁移。', 409);
    const account = this.db.prepare('SELECT id FROM accounts WHERE username=? AND enabled=1').get(username);
    if (!account) throw new RequestError('ACCOUNT_NOT_FOUND', '账号不存在或已停用。', 404);
    this.db.prepare(`INSERT INTO ${table}(user_id,role,granted_at) VALUES(?,'administrator',?) ON CONFLICT(user_id,role) DO NOTHING`).run(String(account.id), new Date().toISOString());
    return this.list().find(role => role.userId === account.id)!;
  }
  revoke(username: string): void {
    const table = this.table();
    if (!table) throw new RequestError('ACCESS_MIGRATION_REQUIRED', '请先完成管理员账号迁移。', 409);
    const account = this.db.prepare('SELECT id FROM accounts WHERE username=?').get(username);
    if (!account) throw new RequestError('ACCOUNT_NOT_FOUND', '账号不存在。', 404);
    this.db.prepare(`DELETE FROM ${table} WHERE user_id=? AND role='administrator'`).run(String(account.id));
    // A revoked seatless administrator has no remaining login identity.
    if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='auth_sessions'").get()) this.db.prepare('DELETE FROM auth_sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND seat_id IS NULL)').run(String(account.id), String(account.id));
  }
  list(): SystemAdministrator[] {
    const table = this.table(); if (!table) return [];
    return this.db.prepare(`SELECT a.id userId,a.username,a.display_name displayName,a.enabled,r.granted_at grantedAt
      FROM ${table} r JOIN accounts a ON a.id=r.user_id WHERE r.role='administrator' ORDER BY a.username`).all().map(row => ({
      userId: String(row.userId), username: String(row.username), displayName: String(row.displayName), enabled: Boolean(row.enabled), grantedAt: String(row.grantedAt),
    }));
  }
}
