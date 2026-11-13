import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { CapabilityRoles } from '../src/access/capability-roles.js';
import { AccessStore } from '../src/access/store.js';
import { openDatabase } from '../src/access/database.js';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import type { AuthSession, TaskSpace } from '../src/contracts/access.js';
import type { SessionSnapshot, Workspace } from '../src/contracts/index.js';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';

const databases: DatabaseSync[] = [];
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); for (const db of databases.splice(0)) db.close(); });
function setup() {
  const db = new DatabaseSync(':memory:'); databases.push(db);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE seats(id TEXT PRIMARY KEY,name TEXT,manage_model INTEGER,create_public INTEGER);
    CREATE TABLE accounts(id TEXT PRIMARY KEY,username TEXT,display_name TEXT,seat_id TEXT REFERENCES seats(id),enabled INTEGER);
    PRAGMA user_version=18;`);
  const adminName = randomUUID(), ordinary = randomUUID();
  db.prepare('INSERT INTO seats VALUES(?,?,?,?)').run('admin-seat', '管理员', 1, 1);
  db.prepare('INSERT INTO seats VALUES(?,?,?,?)').run('ordinary-seat', '普通席位', 0, 0);
  db.prepare('INSERT INTO accounts VALUES(?,?,?,?,1)').run(adminName, 'model-manager', '模型管理员', 'admin-seat');
  db.prepare('INSERT INTO accounts VALUES(?,?,?,?,1)').run(ordinary, 'ordinary', '普通账号', 'ordinary-seat');
  return { db, adminName, ordinary, roles: new CapabilityRoles(db) };
}

describe('explicit account capability administrator', () => {
  it('never infers authority from seat label or model/business management, including before migration', () => {
    const { db, adminName, ordinary, roles } = setup();
    expect(roles.has(adminName)).toBe(false);
    expect(roles.has(ordinary)).toBe(false);
    expect(() => roles.requireAdministrator(adminName)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN', statusCode: 403 }));
    CapabilityRoles.migrate(db); CapabilityRoles.migrate(db);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(18);
    expect(roles.list()).toEqual([]);
    expect(() => roles.requireAdministrator(undefined)).toThrowError(expect.objectContaining({ statusCode: 403 }));
  });

  it('grants an account only by an explicit operation and leaves all business/account values intact', () => {
    const { db, adminName, ordinary, roles } = setup(); CapabilityRoles.migrate(db);
    const before = { seats: db.prepare('SELECT * FROM seats').all(), accounts: db.prepare('SELECT * FROM accounts').all() };
    const granted = roles.grant('ordinary');
    expect(roles.grant('ordinary')).toEqual(granted);
    expect(roles.has(ordinary)).toBe(true); expect(roles.has(adminName)).toBe(false);
    expect(() => roles.requireAdministrator(ordinary)).not.toThrow();
    expect({ seats: db.prepare('SELECT * FROM seats').all(), accounts: db.prepare('SELECT * FROM accounts').all() }).toEqual(before);
    expect(granted).toMatchObject({ userId: ordinary, username: 'ordinary', enabled: true });
    db.prepare('UPDATE accounts SET enabled=0 WHERE id=?').run(ordinary);
    expect(roles.has(ordinary)).toBe(false);
    expect(() => roles.grant('ordinary')).toThrowError(expect.objectContaining({ code: 'ACCOUNT_NOT_FOUND' }));
    roles.revoke('ordinary'); roles.revoke('ordinary');
    expect(roles.list()).toEqual([]);
    expect(() => roles.grant('missing')).toThrowError(expect.objectContaining({ statusCode: 404 }));
  });

  it('enforces administrator access through authenticated HTTP after offline grant/revoke without expanding model or private-workspace rights', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'axon-capability-admin-api-'));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
    const provisioning = await openDatabase(dataDir);
    try {
      const access = new AccessStore(provisioning);
      for (const username of ['ordinary', 'owner']) await access.saveAccount({ username, displayName: username, seatId: username,
        seatName: username === 'ordinary' ? '管理员' : '其他业务席位', password: 'test-password-123',
        createPublicTask: username === 'owner', manageModelSettings: username === 'owner' });
    } finally { provisioning.close(); }
    const config = testConfig(dataDir, { auth: { secret: 'test-only-signing-key-at-least-32-characters', sessionMs: 28800000 } });
    const fake = await fakeRuntime(config, () => ({ text: '不应调用模型' }));
    let app: FastifyInstance | undefined;
    const start = async () => { app = await createApp(await PiLab.create(config, fake.runtime)); return app; };
    const stop = async () => { const current = app; app = undefined; await current?.close(); };
    cleanups.push(stop);
    await start();
    const login = async (username: string) => {
      const bootstrap = await app!.inject('/api/auth/session'); const anonymous = bootstrap.json<AuthSession>();
      const response = await app!.inject({ method: 'POST', url: '/api/auth/login',
        headers: { cookie: bootstrap.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': anonymous.csrf! },
        payload: { username, password: 'test-password-123' } });
      expect(response.statusCode, response.body).toBe(200); const auth = response.json<AuthSession>();
      return { cookie: response.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': auth.csrf!, 'x-axon-view': auth.viewId! };
    };
    const ordinary = await login('ordinary'), owner = await login('owner');
    const call = (headers: typeof ordinary, url: string, payload?: object) => app!.inject({ url, method: payload ? 'POST' : 'GET', headers, ...(payload ? { payload } : {}) });
    const taskResponse = await call(owner, '/api/tasks', { title: '他人私有业务', goal: '', visibility: 'private', clientActionId: randomUUID() });
    expect(taskResponse.statusCode, taskResponse.body).toBe(200); const task = taskResponse.json<TaskSpace>();
    const workspaceResponse = await call(owner, `/api/tasks/${task.id}/workspace`, {});
    expect(workspaceResponse.statusCode, workspaceResponse.body).toBe(200); const workspace = workspaceResponse.json<Workspace>();
    const sessionResponse = await call(owner, '/api/sessions', { workspaceId: workspace.id, clientActionId: randomUUID() });
    expect(sessionResponse.statusCode, sessionResponse.body).toBe(200); const session = sessionResponse.json<SessionSnapshot>();
    const assertBusinessIsolation = async () => {
      expect((await call(ordinary, '/api/settings/model')).statusCode).toBe(403);
      expect((await call(ordinary, `/api/tasks/${task.id}`)).statusCode).toBe(404);
      expect((await call(ordinary, `/api/workspaces/${workspace.id}/resources`)).statusCode).toBe(404);
      expect((await call(ordinary, `/api/sessions/${session.id}`)).statusCode).toBe(404);
      expect((await call(ordinary, '/api/sessions', { workspaceId: workspace.id, clientActionId: randomUUID() })).statusCode).toBe(404);
      expect((await call(ordinary, '/api/auth/session')).json<AuthSession>().identity).toMatchObject({ seatId: 'ordinary', manageModelSettings: false, createPublicTask: false });
    };
    expect((await call(ordinary, '/api/capabilities/access')).json()).toEqual({ administrator: false });
    expect((await call(ordinary, '/api/admin/capabilities/summary')).statusCode).toBe(403);
    expect((await call(owner, '/api/admin/capabilities/summary')).statusCode).toBe(403); // Model/task management is independent.
    await assertBusinessIsolation();
    await stop();
    const grantDb = await openDatabase(dataDir);
    try { new CapabilityRoles(grantDb).grant('ordinary'); } finally { grantDb.close(); }
    await start();
    expect((await call(ordinary, '/api/capabilities/access')).json()).toEqual({ administrator: true });
    const summary = await call(ordinary, '/api/admin/capabilities/summary');
    expect(summary.statusCode, summary.body).toBe(200); expect(summary.json().experts).toEqual(expect.any(Array));
    expect(summary.body).not.toContain(session.id); expect(summary.body).not.toContain(task.title);
    await assertBusinessIsolation();
    await stop();
    const revokeDb = await openDatabase(dataDir);
    try { new CapabilityRoles(revokeDb).revoke('ordinary'); } finally { revokeDb.close(); }
    await start();
    expect((await call(ordinary, '/api/capabilities/access')).json()).toEqual({ administrator: false });
    expect((await call(ordinary, '/api/admin/capabilities/summary')).statusCode).toBe(403);
    await assertBusinessIsolation(); expect(fake.calls).toEqual([]);
  }, 60000);
});
