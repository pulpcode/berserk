import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { AccessStore } from '../src/access/store.js';
import { openDatabase } from '../src/access/database.js';
import { migrateAdministratorAccounts } from '../src/access/administrator-schema.js';
import { SystemRoles } from '../src/access/system-roles.js';
import type { AdministratorIdentity, AuthSession, TaskSpace } from '../src/contracts/access.js';
import type { FileOutput, Interaction, SessionSnapshot, Upload, Workspace } from '../src/contracts/index.js';
import { DockerExecutionService, type DockerRunner } from '../src/execution/docker.js';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const questions = [{ id: 'format', prompt: '采用什么格式？', options: [{ id: 'md', label: 'Markdown' }] }];

async function setup(reply: Parameters<typeof fakeRuntime>[1] = () => ({ text: '个人对话已完成。' })) {
  const dataDir = await mkdtemp(join(tmpdir(), 'axon-admin-personal-'));
  cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
  const db = await openDatabase(dataDir); const access = new AccessStore(db);
  await access.saveAccount({ username: 'business', displayName: '业务用户', seatId: 'business', seatName: '业务席位', password: 'test-password-123', createPublicTask: true, manageModelSettings: false });
  migrateAdministratorAccounts(db);
  for (const username of ['admin', 'other-admin']) await access.saveAdministratorAccount({ username, displayName: username, password: 'test-password-123' });
  db.close();
  const config = testConfig(dataDir, { auth: { secret: 'test-only-signing-key-at-least-32-characters', sessionMs: 28800000 } });
  const fake = await fakeRuntime(config, reply);
  const commands: string[] = []; let workspace = '';
  const result = (body = '') => ({ code: 0, stdout: Buffer.from(body), stderr: Buffer.alloc(0) });
  const runner: DockerRunner = async (args, options) => {
    if (args[0] === 'info') return result('linux');
    if (args[0] === 'run') {
      const mount = args.find(arg => arg.startsWith('type=bind,src=') && arg.endsWith(',dst=/workspace'))!;
      workspace = mount.slice('type=bind,src='.length, -',dst=/workspace'.length); return result();
    }
    if (args[0] !== 'exec') return result();
    if (args.includes('/opt/berserk/command.py')) { commands.push(options?.input?.toString() ?? ''); options?.onData?.(Buffer.from('executed')); return result(); }
    const at = args.indexOf('/opt/berserk/files.py');
    const [operation, file] = args.slice(at + 1);
    const path = join(workspace, (file ?? '').replace(/^\/workspace\/?/, ''));
    if (operation === 'write') { await writeFile(path, options?.input ?? ''); return result(); }
    if (operation === 'mkdir') { await mkdir(path, { recursive: true }); return result(); }
    if (operation === 'stat') return result(JSON.stringify({ directory: file === '/workspace' }));
    if (operation === 'read') return { ...result(), stdout: await readFile(path) };
    if (operation === 'exists') return result('true');
    return result();
  };
  const execution = new DockerExecutionService({ instanceId: dataDir }, runner);
  const lab = await PiLab.create(config, fake.runtime, execution);
  const app = await createApp(lab); cleanup.push(() => app.close());
  const login = async (username: string) => {
    const first = await app.inject('/api/auth/session'); const anonymous = first.json<AuthSession>();
    const accountId = username === 'business' ? undefined : anonymous.loginUsers?.find(item => item.name === username)?.id;
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: {
      cookie: first.cookies.map(item => `${item.name}=${item.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': anonymous.csrf!,
    }, payload: { ...(accountId ? { accountId } : { username }), password: 'test-password-123' } });
    expect(response.statusCode, response.body).toBe(200); const auth = response.json<AuthSession>();
    return { identity: auth.identity!, headers: { cookie: response.cookies.map(item => `${item.name}=${item.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': auth.csrf!, 'x-axon-view': auth.viewId! } };
  };
  type LoggedIn = Awaited<ReturnType<typeof login>>;
  const call = (who: LoggedIn, url: string, payload?: object, method: 'GET' | 'POST' | 'PUT' = payload ? 'POST' : 'GET') => app.inject({ url, method, headers: who.headers, ...(payload ? { payload } : {}) });
  const ok = async <T>(who: LoggedIn, url: string, payload?: object, method?: 'GET' | 'POST' | 'PUT'): Promise<T> => {
    const response = await call(who, url, payload, method); expect(response.statusCode, response.body).toBe(200); return response.json<T>();
  };
  const personal = async (who: LoggedIn) => {
    const task = await ok<TaskSpace>(who, '/api/tasks', { title: '个人资料', goal: '', visibility: 'private', clientActionId: randomUUID() });
    const workspace = await ok<Workspace>(who, `/api/tasks/${task.id}/workspace`, {});
    const session = await ok<SessionSnapshot>(who, '/api/sessions', { workspaceId: workspace.id, clientActionId: randomUUID() });
    return { task, workspace, session };
  };
  return { dataDir, config, fake, lab, app, commands, login, call, ok, personal };
}

it('runs administrator personal files, two turns and native question/confirmation without business tools, then restores history', async () => {
  const state = await setup((_context, index) => index === 0 ? { tools: [
    { name: 'write', arguments: { path: 'report.md', content: '# 个人汇总\n总数：3\n' } },
    { name: 'file_output', arguments: { path: 'report.md' } },
  ] } : index === 1 ? { text: '汇总已生成。' } : index === 2 ? { tools: [{ name: 'ask_user', arguments: { questions } }] }
    : index === 3 ? { tools: [{ name: 'bash', arguments: { command: 'rm -- /workspace/obsolete.md' } }] } : { text: '已确认完成。' });
  const { lab, app, fake, commands, login, ok, personal } = state;
  const admin = await login('admin'); const identity = admin.identity as AdministratorIdentity;
  const { task, workspace, session } = await personal(admin);
  expect(task).toMatchObject({ visibility: 'private', ownerUserId: identity.userId, ownerSeatId: identity.personalScopeId });
  expect(session.messages).toEqual([]); expect(fake.calls).toHaveLength(0);
  expect(lab.access!.allSeatIds()).toEqual(['business']); expect(lab.access!.identity(identity.userId)).toBeUndefined();
  const csv = Buffer.from('name,value\na,3\n');
  const uploadResponse = await app.inject({ method: 'POST', url: `/api/workspaces/${workspace.id}/uploads`, headers: admin.headers, payload: { name: 'sample.csv', size: csv.length } });
  expect(uploadResponse.statusCode, uploadResponse.body).toBe(201); const upload = uploadResponse.json<Upload>();
  const received = await app.inject({ method: 'PUT', url: `/api/workspaces/${workspace.id}/uploads/${upload.uploadId}/content`, headers: { ...admin.headers, 'content-type': 'application/octet-stream' }, payload: csv });
  expect(received.statusCode, received.body).toBe(200);
  const first = await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, headers: admin.headers, payload: { text: '生成个人汇总', uploadIds: [upload.uploadId] } });
  expect(first.statusCode, first.body).toBe(200);
  expect(lab.get(session.id, identity.personalScopeId).lastResult?.status).toBe('succeeded');
  const output = first.body.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).find(event => event.type === 'files.output')?.file as FileOutput;
  expect(output?.name).toBe('report.md');
  const download = await app.inject({ url: `/api/workspaces/${workspace.id}/downloads/${output.downloadId}`, headers: admin.headers });
  expect(download.statusCode, download.body).toBe(200); expect(download.body).toContain('总数：3');
  const run = lab.start(session.id, '先问我格式，再确认删除旧文件', {}, identity.personalScopeId, undefined, identity.userId);
  const done = run.run(() => {});
  const pending = async (kind: Interaction['kind']) => {
    await vi.waitFor(() => expect(lab.get(session.id, identity.personalScopeId).interactions?.some(item => item.kind === kind && item.status === 'pending')).toBe(true));
    return lab.get(session.id, identity.personalScopeId).interactions!.find(item => item.kind === kind && item.status === 'pending')!;
  };
  const question = await pending('question');
  await ok(admin, `/api/sessions/${session.id}/interactions/${question.interactionId}/response`, { requestId: run.requestId, kind: 'question', action: 'answer', answers: [{ questionId: 'format', optionIds: ['md'] }] });
  const confirmation = await pending('confirmation'); expect(commands).toEqual([]);
  await ok(admin, `/api/sessions/${session.id}/interactions/${confirmation.interactionId}/response`, { requestId: run.requestId, kind: 'confirmation', decision: 'approve' });
  await done; expect(commands).toHaveLength(1);
  const history = await ok<SessionSnapshot>(admin, `/api/sessions/${session.id}`);
  expect(history.lastResult?.status).toBe('succeeded');
  expect(history.messages.filter(message => message.role === 'user')).toHaveLength(2);
  expect(history.interactions?.map(item => item.status)).toEqual(['answered', 'approved']);
  for (const captured of fake.calls) {
    const names = captured.context.tools?.map(tool => tool.name) ?? [];
    expect(names).toContain('source_read'); expect(names).toContain('skill_read');
    expect(names.some(name => /^(context_|task_|work_|handoff_|annotation_|spatial_|command_)/.test(name))).toBe(false);
    expect(captured.context.systemPrompt).not.toContain('业务席位');
    expect(captured.context.systemPrompt).not.toContain('work_item_action');
  }
  await app.close();
  const restored = await PiLab.create(state.config, fake.runtime); cleanup.push(() => restored.close());
  expect(restored.get(session.id, identity.personalScopeId).messages).toEqual(history.messages);
  expect(restored.get(session.id, identity.personalScopeId).interactions).toEqual(history.interactions);
});

it('keeps administrator personal storage isolated from other administrators, business users and public tasks', async () => {
  const { lab, app, fake, login, call, ok, personal } = await setup();
  const admin = await login('admin'), other = await login('other-admin'), business = await login('business');
  const own = await personal(admin), foreign = await personal(other), businessOwn = await personal(business);
  const shared = await ok<TaskSpace>(business, '/api/tasks', { title: '公共任务', goal: '业务目标', visibility: 'public', clientActionId: randomUUID() });
  for (const who of [other, business]) {
    for (const path of [`/api/tasks/${own.task.id}`, `/api/tasks/${own.task.id}/workspace`, `/api/sessions/${own.session.id}`, `/api/workspaces/${own.workspace.id}/files`]) {
      const response = await call(who, path, path.endsWith('/workspace') ? {} : undefined); expect(response.statusCode, path).toBe(404);
    }
  }
  for (const target of [foreign, businessOwn]) {
    expect((await call(admin, `/api/tasks/${target.task.id}`)).statusCode).toBe(404);
    expect((await call(admin, `/api/sessions/${target.session.id}`)).statusCode).toBe(404);
    expect((await call(admin, '/api/sessions', { workspaceId: target.workspace.id, clientActionId: randomUUID() })).statusCode).toBe(404);
  }
  expect((await call(admin, `/api/tasks/${shared.id}`)).statusCode).toBe(404);
  expect((await call(admin, `/api/tasks/${shared.id}/workspace`, {})).statusCode).toBe(404);
  expect((await call(admin, '/api/tasks', { title: '公共伪造', goal: '', visibility: 'public', clientActionId: randomUUID() })).statusCode).toBe(403);
  expect((await call(admin, '/api/sessions', { workspaceId: own.workspace.id, workItemId: randomUUID(), clientActionId: randomUUID() })).statusCode).toBe(403);
  expect((await call(admin, `/api/sessions/${own.session.id}/messages`, { text: '读取业务', contextRefs: [{ systemId: 'business', objectType: 'road', objectId: 'road-1' }] })).statusCode).toBe(403);
  expect((await call(admin, '/api/tasks', { title: '伪造所有者', goal: '', visibility: 'private', ownerSeatId: 'business', clientActionId: randomUUID() })).statusCode).toBe(400);
  const forgedHeader = await app.inject({ url: '/api/tasks', headers: { ...admin.headers, 'x-seat-id': 'business' } });
  expect(forgedHeader.statusCode, forgedHeader.body).toBe(200); expect(forgedHeader.json()).toEqual([own.task]);
  expect((await call(admin, '/api/tasks?seatId=business')).statusCode).toBe(400);
  expect(await ok<TaskSpace[]>(admin, '/api/tasks')).toEqual([own.task]);
  for (const path of ['/api/context/catalog', '/api/workbench/items', '/api/information/access', '/api/settings/models']) expect((await call(admin, path)).statusCode, path).toBe(403);
  expect(lab.get(own.session.id, (admin.identity as AdministratorIdentity).personalScopeId).messages).toEqual([]);
  expect(fake.calls).toHaveLength(0); expect(lab.access!.allSeatIds()).toEqual(['business']);
});

it('keeps personal subagents on the same account scope with only the existing read-only tools', async () => {
  const { lab, fake, login, personal } = await setup((context, index) => context.systemPrompt?.includes('你是子 Agent')
    ? { text: '个人资料核对完成。' } : index === 0 ? { tools: [{ name: 'subagent', arguments: { agent: 'reviewer', task: '只核对当前个人资料，不读取业务任务。' } }] } : { text: '已根据子任务结果完成核对。' });
  const admin = await login('admin'); const identity = admin.identity as AdministratorIdentity; const { session } = await personal(admin);
  await lab.start(session.id, '请委派核对个人资料', {}, identity.personalScopeId, undefined, identity.userId).run(() => {});
  const history = lab.get(session.id, identity.personalScopeId);
  expect(history.lastResult?.status).toBe('succeeded');
  expect(history.subagents).toEqual([expect.objectContaining({ role: 'reviewer', status: 'succeeded' })]);
  const child = fake.calls.find(call => call.context.systemPrompt?.includes('你是子 Agent'));
  expect(child).toBeDefined();
  expect(child!.context.tools?.every(tool => ['source_list', 'source_read', 'instructions_read', 'skill_read', 'read', 'ls', 'find'].includes(tool.name))).toBe(true);
  expect(child!.context.systemPrompt).not.toContain('work_item_action');
  expect(child!.context.systemPrompt).not.toContain('业务席位');
});

it.each(['revoke', 'disable'] as const)('stops subsequent tools after administrator %s and preserves owned history at startup', async action => {
  const state = await setup((_context, index) => index === 0 ? { delayMs: 200, tools: [{ name: 'write', arguments: { path: 'should-not-exist.md', content: 'forbidden' } }] } : { text: '不应继续' });
  const { lab, app, fake, login, call, personal } = state;
  const admin = await login('admin'); const identity = admin.identity as AdministratorIdentity; const { session, workspace } = await personal(admin);
  const run = lab.start(session.id, '等待期间撤权', {}, identity.personalScopeId, undefined, identity.userId);
  const done = run.run(() => {});
  await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
  if (action === 'revoke') new SystemRoles(lab.access!.db).revoke('admin'); else lab.access!.disable('admin');
  await done;
  expect(fake.calls).toHaveLength(1); expect(lab.get(session.id, identity.personalScopeId).lastResult?.status).toBe('failed');
  await expect(readFile(join(lab.files.filesDirectory(workspace.id, identity.personalScopeId), 'should-not-exist.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await call(admin, '/api/tasks')).statusCode).toBe(401);
  expect(() => lab.start(session.id, '不可继续', {}, identity.personalScopeId, undefined, identity.userId)).toThrow();
  await app.close();
  const restored = await PiLab.create(state.config, fake.runtime); cleanup.push(() => restored.close());
  expect(restored.get(session.id, identity.personalScopeId).messages.some(message => message.role === 'user')).toBe(true);
  expect(restored.access!.allSeatIds()).toEqual(['business']);
});

it('reauthorizes an administrator after waiting for the shared model permit', async () => {
  const { lab, fake, login, personal } = await setup(() => ({ waitForAbort: true }));
  lab.setModelConcurrency(1);
  const business = await login('business'), admin = await login('admin'); const identity = admin.identity as AdministratorIdentity;
  const first = await personal(business), queued = await personal(admin);
  const busy = lab.start(first.session.id, '占用模型', {}, 'business', undefined, business.identity.userId);
  const busyDone = busy.run(() => {}); await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
  const waiting = lab.start(queued.session.id, '排队期间撤销管理员', {}, identity.personalScopeId, undefined, identity.userId);
  const waitingDone = waiting.run(() => {});
  await vi.waitFor(() => expect(lab.get(queued.session.id, identity.personalScopeId).messages.some(message => message.role === 'user')).toBe(true));
  new SystemRoles(lab.access!.db).revoke('admin');
  lab.cancel(first.session.id, busy.requestId, 'business');
  await Promise.all([busyDone, waitingDone]);
  expect(fake.calls).toHaveLength(1);
  expect(lab.get(queued.session.id, identity.personalScopeId).lastResult?.status).toBe('failed');
});
