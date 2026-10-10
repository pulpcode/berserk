import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { assertDataMode, openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';

const run = promisify(execFile);
const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const account = { username: 'a', displayName: '验证人员', seatId: 'seat-a', seatName: '席位 A', password: 'seat-test-password', createPublicTask: true, manageModelSettings: false };

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'axon-seat-responsibilities-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const db = await openDatabase(dir);
  let closed = false;
  const close = () => { if (!closed) { db.close(); closed = true; } };
  cleanups.push(close);
  return { dir, db, close };
}

async function legacy(version: 2 | 3 | 4) {
  const value = await fixture();
  value.db.exec(`
    CREATE TABLE seats(id TEXT PRIMARY KEY, name TEXT NOT NULL, create_public INTEGER NOT NULL, manage_model INTEGER NOT NULL);
    CREATE TABLE accounts(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, seat_id TEXT NOT NULL REFERENCES seats(id), salt TEXT NOT NULL, password_hash TEXT NOT NULL, enabled INTEGER NOT NULL);
    CREATE UNIQUE INDEX one_enabled_account_per_seat ON accounts(seat_id) WHERE enabled=1;
    CREATE TABLE auth_sessions(id TEXT PRIMARY KEY, user_id TEXT, expires INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE task_spaces(id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
    CREATE TABLE task_actions(user_id TEXT NOT NULL, action_id TEXT NOT NULL, input TEXT NOT NULL, task_id TEXT NOT NULL REFERENCES task_spaces(id), PRIMARY KEY(user_id,action_id));
    PRAGMA user_version=${version};
  `);
  const userId = randomUUID();
  value.db.prepare('INSERT INTO seats VALUES(?,?,?,?)').run('seat-a', '席位 A', 1, 0);
  value.db.prepare('INSERT INTO seats VALUES(?,?,?,?)').run('seat-old', '历史席位', 0, 1);
  value.db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?)').run(userId, 'a', '旧用户', 'seat-a', 'retained-salt', 'retained-hash', 1);
  value.db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?)').run(randomUUID(), 'old', '停用用户', 'seat-old', 'old-salt', 'old-hash', 0);
  value.db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run('retained-session', userId, Date.now() + 60_000, '{"existing":true}');
  return { ...value, userId };
}

describe('central seat responsibilities', () => {
  it.each([2, 3, 4] as const)('adds defaults to legacy v%i seats without changing existing identities or sessions', async version => {
    const { db, userId } = await legacy(version);
    const accounts = db.prepare('SELECT * FROM accounts ORDER BY id').all();
    const sessions = db.prepare('SELECT * FROM auth_sessions').all();
    const store = new AccessStore(db);
    expect(store.seats()).toEqual([{ id: 'seat-a', name: '席位 A', responsibility: '', responsibilityRevision: 1 }]);
    expect(store.allSeatIds()).toEqual(expect.arrayContaining(['seat-a', 'seat-old']));
    expect(store.identity(userId)).toMatchObject({ seatId: 'seat-a', createPublicTask: true, manageModelSettings: false });
    expect(store.identityForSeat('seat-old')).toBeUndefined();
    expect(db.prepare('SELECT * FROM accounts ORDER BY id').all()).toEqual(accounts);
    expect(db.prepare('SELECT * FROM auth_sessions').all()).toEqual(sessions);
    // The background store owns the remaining v5 tables and advances the shared schema version.
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(version);
    expect(new AccessStore(db).seats()).toEqual(store.seats());
  });

  it.each(['responsibility', 'responsibility_revision', 'both'])('rejects a v5 data root missing %s without silently repairing it', async missing => {
    const { db } = await legacy(4);
    if (missing !== 'responsibility' && missing !== 'both') db.exec("ALTER TABLE seats ADD COLUMN responsibility TEXT NOT NULL DEFAULT ''");
    if (missing !== 'responsibility_revision' && missing !== 'both') db.exec('ALTER TABLE seats ADD COLUMN responsibility_revision INTEGER NOT NULL DEFAULT 1');
    db.exec('PRAGMA user_version=5');
    const columns = db.prepare('PRAGMA table_info(seats)').all();
    expect(() => new AccessStore(db)).toThrow(expect.objectContaining({ code: 'RESOURCE_STATE_INVALID' }));
    expect(db.prepare('PRAGMA table_info(seats)').all()).toEqual(columns);
  });

  it('opens a v5 root through the common database entry point and retains formal-mode protection', async () => {
    const { dir, db, close } = await fixture();
    new AccessStore(db);
    db.exec('PRAGMA user_version=5'); close();
    const reopened = await openDatabase(dir); cleanups.push(() => reopened.close());
    expect(new AccessStore(reopened).seats()).toEqual([]);
    await expect(assertDataMode(dir, false)).rejects.toMatchObject({ code: 'AUTH_MODE_CONFLICT' });
    await expect(assertDataMode(dir, true)).resolves.toBeUndefined();
  });

  it('updates name and responsibility without resetting accounts, passwords, sessions or permissions', async () => {
    const { db } = await fixture(); const store = new AccessStore(db);
    const userId = await store.saveAccount(account);
    db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run('existing-session', userId, Date.now() + 60_000, '{"csrf":"test-only"}');
    const beforeAccount = db.prepare('SELECT * FROM accounts').all();
    const beforeSessions = db.prepare('SELECT * FROM auth_sessions').all();
    const originalIdentity = store.identity(userId)!;
    const ownTask = store.create(originalIdentity, { title: '个人资料', goal: '', visibility: 'private', clientActionId: randomUUID() });
    const result = store.updateSeat(account.seatId, { name: ' 情报席 ', responsibility: ' 核实来源与事实，识别矛盾和缺失信息。\n' });
    expect(result).toEqual({ id: account.seatId, name: '情报席', responsibility: '核实来源与事实，识别矛盾和缺失信息。', responsibilityRevision: 2 });
    expect(store.identity(userId)).toEqual({ ...originalIdentity, seatName: '情报席' });
    expect(await store.authenticate(account.username, account.password)).toEqual(store.identity(userId));
    expect(db.prepare('SELECT * FROM accounts').all()).toEqual(beforeAccount);
    expect(db.prepare('SELECT * FROM auth_sessions').all()).toEqual(beforeSessions);
    expect(store.get(ownTask.id, account.seatId)).toEqual(ownTask);
    expect(() => store.get(ownTask.id, 'another-seat')).toThrow(expect.objectContaining({ code: 'TASK_NOT_FOUND' }));
  });

  it('keeps unchanged revisions stable and increments once for actual directory changes', async () => {
    const { db } = await legacy(4); const store = new AccessStore(db);
    const initial = store.updateSeat('seat-a', { responsibility: '维护态势' });
    expect(initial.responsibilityRevision).toBe(2);
    expect(store.updateSeat('seat-a', { name: ' 席位 A ', responsibility: ' 维护态势\n' })).toEqual(initial);
    expect(store.updateSeat('seat-a', { name: '态势席', responsibility: '维护态势' }).responsibilityRevision).toBe(3);
    expect(store.updateSeat('seat-a', { responsibility: '维护态势并分析变化' }).responsibilityRevision).toBe(4);
    expect(new AccessStore(db).seats()[0]).toMatchObject({ name: '态势席', responsibilityRevision: 4 });
  });

  it('preserves responsibilities when account credentials or capabilities are maintained', async () => {
    const { db } = await fixture(); const store = new AccessStore(db);
    const userId = await store.saveAccount(account);
    const directory = store.updateSeat(account.seatId, { responsibility: '分析信息变化' });
    const editedAccount = { ...account, password: 'changed-test-password', manageModelSettings: true };
    expect(await store.saveAccount(editedAccount)).toBe(userId);
    expect(store.seats()[0]).toEqual(directory);
    expect(await store.authenticate(account.username, editedAccount.password)).toMatchObject({ userId, manageModelSettings: true });
    await store.saveAccount({ ...editedAccount, seatName: '情报席' });
    expect(store.seats()[0]).toEqual({ ...directory, name: '情报席', responsibilityRevision: directory.responsibilityRevision + 1 });
  });

  it('rejects empty, oversized and unknown-seat updates without partial writes', async () => {
    const { db } = await legacy(4); const store = new AccessStore(db);
    const before = db.prepare('SELECT * FROM seats ORDER BY id').all();
    const inputs = [
      { responsibility: '' }, { responsibility: ' \n\t' }, { responsibility: 'a'.repeat(1001) },
      { responsibility: '有效职责', name: ' ' }, { responsibility: '有效职责', name: 'a'.repeat(101) },
    ];
    for (const input of inputs) {
      expect(() => store.updateSeat('seat-a', input)).toThrow('请填写席位职责');
      expect(db.prepare('SELECT * FROM seats ORDER BY id').all()).toEqual(before);
    }
    expect(() => store.updateSeat('absent', { responsibility: '有效职责' })).toThrow('席位不存在');
    expect(db.prepare('SELECT * FROM seats ORDER BY id').all()).toEqual(before);
    expect(store.updateSeat('seat-a', { responsibility: 'a'.repeat(1000), name: 'a'.repeat(100) })).toMatchObject({ responsibilityRevision: 2 });
  });

  it('retains disabled historical seats without re-enabling them or advertising them as recipients', async () => {
    const { db } = await legacy(4); const store = new AccessStore(db);
    const before = db.prepare('SELECT * FROM accounts WHERE username=?').get('old');
    store.updateSeat('seat-old', { name: '历史情报席', responsibility: '保留历史办理归属' });
    expect(store.allSeatIds()).toContain('seat-old');
    expect(store.seats().map(seat => seat.id)).not.toContain('seat-old');
    expect(store.identityForSeat('seat-old')).toBeUndefined();
    expect(db.prepare('SELECT * FROM accounts WHERE username=?').get('old')).toEqual(before);
  });

  it('provides a password-free offline CLI for seat maintenance and enforces the stopped-service acknowledgement', async () => {
    const { dir, db, close } = await legacy(4); new AccessStore(db);
    const beforeAccounts = db.prepare('SELECT * FROM accounts ORDER BY id').all();
    const beforeSessions = db.prepare('SELECT * FROM auth_sessions').all();
    close();
    const file = join(dir, 'responsibility.md'); await writeFile(file, '核实情报来源及事实\n');
    const args = ['--import', 'tsx', resolve('scripts/access-admin.ts'), 'seat', '--data-dir', dir, '--seat', 'seat-a', '--seat-name', '情报席', '--responsibility-file', file];
    await expect(run(process.execPath, args)).rejects.toThrow('--service-stopped');
    const output = await run(process.execPath, [...args, '--service-stopped']);
    expect(output.stdout).toContain('情报席职责已保存，版本 2');
    const reopened = await openDatabase(dir); cleanups.push(() => reopened.close());
    expect(new AccessStore(reopened).seats()[0]).toMatchObject({ name: '情报席', responsibility: '核实情报来源及事实', responsibilityRevision: 2 });
    expect(reopened.prepare('SELECT * FROM accounts ORDER BY id').all()).toEqual(beforeAccounts);
    expect(reopened.prepare('SELECT * FROM auth_sessions').all()).toEqual(beforeSessions);
  });
});
