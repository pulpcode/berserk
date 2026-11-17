import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { migrateAdministratorAccounts } from '../src/access/administrator-schema.js';
import { SystemRoles } from '../src/access/system-roles.js';
import type { AdministratorIdentity, AuthSession, TaskSpace } from '../src/contracts/access.js';
import type { SessionSnapshot, Workspace } from '../src/contracts/index.js';
import type { SkillSummary } from '../src/contracts/skills.js';
import { DockerExecutionService, type DockerRunner } from '../src/execution/docker.js';
import { PiLab } from '../src/pi/lab.js';
import { packageMethod } from '../src/resources/skill-package.js';
import { createApp } from '../src/server/app.js';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const done of cleanup.splice(0).reverse()) await done(); });
const body = '---\nname: personal-summary\ndescription: 管理员个人方法\n---\nADMIN-PERSONAL-METHOD\n';
const resource = 'ADMIN-PERSONAL-RESOURCE';

async function setup(reply: Parameters<typeof fakeRuntime>[1] = () => ({ text: '完成个人请求。' })) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-admin-skills-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const db = await openDatabase(dir), access = new AccessStore(db);
  await access.saveAccount({ username: 'business', displayName: '业务', seatId: 'business', seatName: '业务', password: 'test-password-123', createPublicTask: true, manageModelSettings: false });
  migrateAdministratorAccounts(db);
  const adminId = await access.saveAdministratorAccount({ username: 'admin', displayName: '管理员', password: 'test-password-123' });
  await access.saveAdministratorAccount({ username: 'other-admin', displayName: '其他管理员', password: 'test-password-123' }); db.close();
  const config = testConfig(dir, { auth: { secret: 'test-only-signing-key-at-least-32-characters', sessionMs: 28800000 } });
  const fake = await fakeRuntime(config, reply);
  let mountedSkills = ''; const mounts: string[][] = []; let mountedIds: string[] = [];
  const ok = (text = '') => ({ code: 0, stdout: Buffer.from(text), stderr: Buffer.alloc(0) });
  const runner: DockerRunner = async args => {
    if (args[0] === 'info') return ok('linux');
    if (args[0] === 'run') {
      mounts.push(args);
      const mount = args.find(arg => arg.startsWith('type=bind,src=') && arg.endsWith(',dst=/skills,readonly'));
      if (mount) { mountedSkills = mount.slice('type=bind,src='.length, -',dst=/skills,readonly'.length); mountedIds = await readdir(mountedSkills); }
      return ok();
    }
    if (args[0] !== 'exec') return ok();
    const at = args.indexOf('/opt/berserk/files.py');
    if (args[0] === 'exec' && at >= 0) {
      const [operation, path] = args.slice(at + 1);
      if (operation === 'read' && path.startsWith('/skills/')) return ok(await readFile(join(mountedSkills, path.slice('/skills/'.length)), 'utf8'));
      if (operation === 'stat') return ok(JSON.stringify({ directory: false }));
      if (operation === 'exists') return ok('true');
    }
    return ok();
  };
  const lab = await PiLab.create(config, fake.runtime, new DockerExecutionService({ instanceId: dir }, runner));
  const app = await createApp(lab); cleanup.push(() => app.close());
  async function login(username: string) {
    const first = await app.inject('/api/auth/session'), anonymous = first.json<AuthSession>();
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { cookie: first.cookies.map(c => `${c.name}=${c.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': anonymous.csrf! }, payload: { username, password: 'test-password-123' } });
    expect(response.statusCode, response.body).toBe(200); const session = response.json<AuthSession>();
    return { identity: session.identity!, headers: { cookie: response.cookies.map(c => `${c.name}=${c.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': session.csrf!, 'x-axon-view': session.viewId! } };
  }
  type User = Awaited<ReturnType<typeof login>>;
  const call = (user: User, url: string, payload?: object) => app.inject({ url, headers: user.headers, method: payload ? 'POST' : 'GET', ...(payload ? { payload } : {}) });
  async function value<T>(user: User, url: string, payload?: object) { const result = await call(user, url, payload); expect(result.statusCode, result.body).toBe(200); return result.json<T>(); }
  async function personal(user: User) {
    const task = await value<TaskSpace>(user, '/api/tasks', { title: '个人技能测试', goal: '', visibility: 'private', clientActionId: randomUUID() });
    const workspace = await value<Workspace>(user, `/api/tasks/${task.id}/workspace`, {});
    const session = await value<SessionSnapshot>(user, '/api/sessions', { workspaceId: workspace.id, clientActionId: randomUUID() });
    return { task, workspace, session };
  }
  const actor = { userId: adminId, assertAdministrator: () => new SystemRoles(lab.access!.db).requireAdministrator(adminId) };
  async function draft() {
    const created = await lab.skills.create(actor, { clientActionId: randomUUID() });
    const saved = await lab.skills.saveDraft(actor, created.skill.skillId, { expectedDraftRevision: 1, files: [{ path: 'SKILL.md', contentBase64: Buffer.from(body).toString('base64') }, { path: 'assets/sample.txt', contentBase64: Buffer.from(resource).toString('base64') }] });
    return { id: created.skill.skillId, draft: saved };
  }
  async function publish(mode: 'none' | 'all' | 'seats' = 'none') {
    const item = await draft();
    await lab.skills.setPolicy(actor, item.id, { expectedRevision: 0, mode, seatIds: mode === 'seats' ? ['business'] : [], clientActionId: randomUUID() });
    return lab.skills.publish(actor, item.id, { expectedDraftRevision: item.draft.draftRevision, expectedCurrentRevisionId: null, releaseNotes: '个人使用不要求开放业务席位', clientActionId: randomUUID() });
  }
  return { lab, app, fake, actor, adminId, login, call, value, personal, draft, publish, mounts, mountedIds: () => mountedIds };
}

test('administrator uses a published package in personal native chat with readonly resources and no business access', async () => {
  let skillId = '', virtual = '';
  const state = await setup((_context, index) => index === 0 ? { tools: [{ name: 'skill_read', arguments: { id: skillId } }] }
    : index === 1 ? { tools: [{ name: 'read', arguments: { path: `${virtual}/assets/sample.txt` } }] } : { text: '已使用个人技能。' });
  const { lab, fake, adminId, login, personal, value, call, publish, draft } = state;
  const admin = await login('admin'), other = await login('other-admin'), business = await login('business');
  const own = await personal(admin), foreign = await personal(other), businessOwn = await personal(business);
  const shared = await value<TaskSpace>(business, '/api/tasks', { title: '业务公共任务', goal: '仅业务席位可访问', visibility: 'public', clientActionId: randomUUID() });
  const pending = await draft(), published = await publish(); skillId = published.skillId;
  const catalog = await value<SkillSummary[]>(admin, '/api/capabilities/skills');
  expect(catalog.some(s => s.skillId === pending.id)).toBe(false); expect(catalog.some(s => s.skillId === skillId)).toBe(true);
  expect((await value<SkillSummary[]>(business, '/api/capabilities/skills')).some(s => s.skillId === skillId)).toBe(false);
  const identity = admin.identity as AdministratorIdentity;
  const method = packageMethod(await lab.skills.resolve(published, { userId: adminId, seatId: identity.personalScopeId, canCollaborate: false })); virtual = method.resourceRoot!;
  const resources = await value<{ skills: Array<{ id: string }> }>(admin, `/api/workspaces/${own.workspace.id}/resources`); expect(resources.skills.some(s => s.id === skillId)).toBe(true);
  const response = await call(admin, `/api/sessions/${own.session.id}/messages`, { text: '在个人对话使用此技能', skill: { id: method.id, hash: method.hash, revisionId: method.revisionId, packageDigest: method.packageDigest } });
  expect(response.statusCode, response.body).toBe(200);
  const snapshot = lab.get(own.session.id, identity.personalScopeId); expect(snapshot.lastResult?.status).toBe('succeeded');
  expect(snapshot.messages.find(m => m.role === 'user')?.selections?.skill).toMatchObject({ schemaVersion: 2, content: body, packageDigest: published.packageDigest });
  expect(JSON.stringify(fake.calls[0].context.messages)).toContain('ADMIN-PERSONAL-METHOD');
  expect(JSON.stringify(fake.calls[2].context.messages)).toContain(resource);
  expect(state.mountedIds()).toEqual([skillId]); expect(state.mounts[0].some(arg => arg.endsWith(',dst=/skills,readonly'))).toBe(true);
  for (const captured of fake.calls) expect(captured.context.tools?.some(tool => /^(context_|task_|work_|handoff_|annotation_|spatial_|command_)/.test(tool.name))).toBe(false);
  for (const target of [foreign, businessOwn]) {
    for (const path of [`/api/tasks/${target.task.id}`, `/api/sessions/${target.session.id}`, `/api/workspaces/${target.workspace.id}/files`, `/api/workspaces/${target.workspace.id}/resources`]) expect((await call(admin, path)).statusCode, path).toBe(404);
    expect((await call(admin, '/api/sessions', { workspaceId: target.workspace.id, clientActionId: randomUUID() })).statusCode).toBe(404);
  }
  expect((await call(admin, `/api/tasks/${shared.id}`)).statusCode).toBe(404);
  expect((await call(admin, `/api/tasks/${shared.id}/workspace`, {})).statusCode).toBe(404);
  for (const path of ['/api/context/catalog', '/api/workbench/items', '/api/information/access']) expect((await call(admin, path)).statusCode).toBe(403);
  expect(lab.access!.allSeatIds()).toEqual(['business']);
}, 30000);

test('administrator personal use bypasses only business scope and preserves lifecycle, account denial and corrupt-state checks', async () => {
  const { lab, actor, adminId, login, publish } = await setup();
  const admin = await login('admin'), identity = admin.identity as AdministratorIdentity;
  const ref = await publish('seats'), principal = { userId: adminId, seatId: identity.personalScopeId, canCollaborate: false };
  await expect(lab.skills.resolve(ref, principal)).resolves.toMatchObject({ skillId: ref.skillId, revisionId: ref.revisionId, packageDigest: ref.packageDigest });
  await lab.skills.setPolicy(actor, ref.skillId, { expectedRevision: 1, mode: 'none', seatIds: [], clientActionId: randomUUID() });
  await expect(lab.skills.resolve(ref, principal)).resolves.toMatchObject({ skillId: ref.skillId, revisionId: ref.revisionId, packageDigest: ref.packageDigest });
  await expect(lab.skills.resolve(ref, { ...principal, seatId: 'business' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(lab.skills.resolve(ref, { ...principal, canCollaborate: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const business = lab.access!.identityForSeat('business')!;
  await expect(lab.skills.resolve(ref, { userId: business.userId, seatId: 'business', canCollaborate: false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(lab.skills.resolve(ref, { userId: business.userId, seatId: 'business', canCollaborate: true })).rejects.toMatchObject({ code: 'SKILL_NOT_FOUND' });
  await lab.skills.lifecycle(actor, ref.skillId, { action: 'disable', expectedStateRevision: 0, clientActionId: randomUUID() });
  await expect(lab.skills.resolve(ref, principal)).rejects.toMatchObject({ code: 'SKILL_NOT_FOUND' });
  await lab.skills.lifecycle(actor, ref.skillId, { action: 'restore', expectedStateRevision: 1, clientActionId: randomUUID() });
  lab.capabilities.setAccess(adminId, ref.skillId, false);
  await expect(lab.skills.resolve(ref, principal)).rejects.toMatchObject({ code: 'SKILL_NOT_FOUND' });
  lab.capabilities.setAccess(adminId, ref.skillId, true);
  lab.skills.db.prepare("UPDATE r3_skill_assets SET data=json_set(data,'$.state','banned') WHERE id=?").run(ref.skillId);
  await expect(lab.skills.resolve(ref, principal)).rejects.toMatchObject({ code: 'SKILL_NOT_FOUND' });
  lab.skills.db.prepare("UPDATE r3_skill_assets SET data=json_set(data,'$.state','enabled') WHERE id=?").run(ref.skillId);
  lab.skills.db.prepare("UPDATE r3_skill_policies SET data=json_set(data,'$.mode','broken') WHERE id=?").run(ref.skillId);
  await expect(lab.skills.resolve(ref, principal)).rejects.toMatchObject({ code: 'SKILL_STATE_INVALID' });
}, 30000);

test.each(['revoke', 'disable'] as const)('administrator %s during package IO receives no body or new personal work', async action => {
  const { lab, adminId, login, publish } = await setup();
  const admin = await login('admin'), identity = admin.identity as AdministratorIdentity;
  const ref = await publish(), principal = { userId: adminId, seatId: identity.personalScopeId, canCollaborate: false };
  const reading = lab.skills.resolve(ref, principal);
  if (action === 'revoke') new SystemRoles(lab.access!.db).revoke('admin'); else lab.access!.disable('admin');
  await expect(reading).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  expect(lab.skills.catalog(principal)).toEqual([]);
  await expect(lab.skills.resolve(ref, principal)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
}, 30000);
