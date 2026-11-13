import type { DatabaseSync } from 'node:sqlite';
import { RequestError } from '../contracts/errors.js';
import { stateError } from '../resources/files.js';

export interface CapabilityAdministrator {
  userId: string;
  username: string;
  displayName: string;
  enabled: boolean;
  grantedAt: string;
}

/** Account administration is independent of every seat/business capability. */
export class CapabilityRoles {
  constructor(private readonly db: DatabaseSync) {}

  /** Explicit upgrade step. Never changes the existing optional-module schema version. */
  static migrate(db: DatabaseSync): void {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts'").get()) throw stateError();
    db.exec(`CREATE TABLE IF NOT EXISTS capability_account_roles(
      user_id TEXT NOT NULL REFERENCES accounts(id),
      role TEXT NOT NULL CHECK(role='administrator'),
      granted_at TEXT NOT NULL,
      PRIMARY KEY(user_id,role)
    )`);
    const columns = db.prepare('PRAGMA table_info(capability_account_roles)').all().map(row => String(row.name));
    if (JSON.stringify(columns) !== JSON.stringify(['user_id', 'role', 'granted_at'])
      || db.prepare("SELECT 1 FROM capability_account_roles WHERE role<>'administrator' OR granted_at IS NULL LIMIT 1").get()) throw stateError();
  }

  private installed(): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='capability_account_roles'").get());
  }

  has(userId: string): boolean {
    if (!this.installed()) return false;
    return Boolean(this.db.prepare(`SELECT 1 FROM capability_account_roles r
      JOIN accounts a ON a.id=r.user_id WHERE r.user_id=? AND r.role='administrator' AND a.enabled=1`).get(userId));
  }

  requireAdministrator(userId: string | undefined): void {
    if (!userId || !this.has(userId)) throw new RequestError('FORBIDDEN', '当前账号无权管理能力中心。', 403);
  }

  grant(username: string): CapabilityAdministrator {
    if (!this.installed()) throw new RequestError('CAPABILITY_MIGRATION_REQUIRED', '请先完成能力中心数据迁移。', 409);
    const account = this.db.prepare('SELECT id FROM accounts WHERE username=? AND enabled=1').get(username);
    if (!account) throw new RequestError('ACCOUNT_NOT_FOUND', '账号不存在或已停用。', 404);
    this.db.prepare("INSERT INTO capability_account_roles(user_id,role,granted_at) VALUES(?,'administrator',?) ON CONFLICT(user_id,role) DO NOTHING").run(String(account.id), new Date().toISOString());
    return this.list().find(role => role.userId === account.id)!;
  }

  revoke(username: string): void {
    if (!this.installed()) throw new RequestError('CAPABILITY_MIGRATION_REQUIRED', '请先完成能力中心数据迁移。', 409);
    const account = this.db.prepare('SELECT id FROM accounts WHERE username=?').get(username);
    if (!account) throw new RequestError('ACCOUNT_NOT_FOUND', '账号不存在。', 404);
    this.db.prepare("DELETE FROM capability_account_roles WHERE user_id=? AND role='administrator'").run(String(account.id));
  }

  list(): CapabilityAdministrator[] {
    if (!this.installed()) return [];
    return this.db.prepare(`SELECT a.id userId,a.username,a.display_name displayName,a.enabled,r.granted_at grantedAt
      FROM capability_account_roles r JOIN accounts a ON a.id=r.user_id
      WHERE r.role='administrator' ORDER BY a.username`).all().map(row => ({
      userId: String(row.userId), username: String(row.username), displayName: String(row.displayName),
      enabled: Boolean(row.enabled), grantedAt: String(row.grantedAt),
    }));
  }
}
