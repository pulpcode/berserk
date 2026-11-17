import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app.js';
import { PiLab } from '../src/pi/lab.js';
import { RequestError } from '../src/contracts/errors.js';
import { AccessStore } from '../src/access/store.js';
import { openDatabase } from '../src/access/database.js';
import { migrateAdministratorAccounts } from '../src/access/administrator-schema.js';
import type { AdministratorIdentity, AuthSession, TaskSpace } from '../src/contracts/access.js';
import type { SessionSnapshot, Workspace } from '../src/contracts/index.js';
import type { PromptSuggestionRequest, PromptSuggestionResponse } from '../src/contracts/index.js';
import { fakeRuntime, testConfig, type Reply } from './pi/fake-runtime.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.useRealTimers(); for (const close of cleanup.splice(0).reverse()) await close(); });
async function setup(prediction: Reply = { text: '请把差异整理成清单。' }, controls: { blockMain?: () => boolean; duringPrediction?: () => void } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-prediction-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const config = testConfig(dir, { seatId: 'test-seat', testSeats: [{ id: 'test-seat', name: 'A' }, { id: 'seat-b', name: 'B' }] });
  const fake = await fakeRuntime(config, context => {
    if (context.systemPrompt?.startsWith('预测用户')) { controls.duringPrediction?.(); return prediction; }
    return controls.blockMain?.() ? { waitForAbort: true } : { text: '两份文件的差异已核对。' };
  });
  const lab = await PiLab.create(config, fake.runtime), app = await createApp(lab); cleanup.push(() => app.close());
  const session = await lab.createSession(); await lab.start(session.id, '核对两份文件').run(() => {});
  const snapshot = lab.get(session.id), turn = snapshot.turns!.at(-1)!;
  const input: PromptSuggestionRequest = { sourceRequestId: turn.requestId, finalMessageId: turn.finalMessageId!, expectedModelId: 'default' };
  const url = `/api/test-seats/test-seat/sessions/${session.id}/prompt-suggestion`;
  const predict = (payload: object = input) => app.inject({ method: 'POST', url, payload });
  return { dir, lab, app, fake, session, input, snapshot, url, predict };
}

it('generates only once and leaves native history, workspace files, activity and main usage unchanged', async () => {
  const state = await setup();
  const files = await readdir(join(state.dir, 'sessions'));
  const before = await Promise.all(files.map(name => readFile(join(state.dir, 'sessions', name), 'utf8')));
  const workspaceFiles = await readdir(state.lab.files.filesDirectory(state.session.workspaceId));
  const activity = state.lab.activity();
  const response = await state.predict(); expect(response.statusCode, response.body).toBe(200);
  expect(response.json<PromptSuggestionResponse>().text).toBe('请把差异整理成清单。');
  expect((await state.predict()).json<PromptSuggestionResponse>().text).toBeNull();
  expect(state.fake.calls).toHaveLength(2); expect(state.fake.calls[1].context.tools).toBeUndefined();
  expect(state.lab.get(state.session.id)).toEqual(state.snapshot); expect(state.lab.activity()).toEqual(activity);
  expect(await Promise.all(files.map(name => readFile(join(state.dir, 'sessions', name), 'utf8')))).toEqual(before);
  expect(await readdir(state.lab.files.filesDirectory(state.session.workspaceId))).toEqual(workspaceFiles);
});

it('rejects foreign seats, stale final/turn/model and extra authority fields without calling the provider', async () => {
  const state = await setup();
  const foreign = await state.app.inject({ method: 'POST', url: state.url.replace('test-seats/test-seat', 'test-seats/seat-b'), payload: state.input });
  expect(foreign.statusCode).toBe(404);
  for (const payload of [{ ...state.input, sourceRequestId: randomUUID() }, { ...state.input, finalMessageId: 'missing' }, { ...state.input, expectedModelId: randomUUID() }]) {
    expect((await state.predict(payload)).statusCode).toBe(409);
  }
  expect((await state.predict({ ...state.input, apiKey: 'not-accepted' })).statusCode).toBe(400);
  expect((await state.predict({ ...state.input, transcript: 'browser-controlled' })).statusCode).toBe(400);
  expect(state.fake.calls).toHaveLength(1);
});

it('a new foreground send aborts the old prediction without delaying the new turn', async () => {
  const state = await setup({ waitForAbort: true });
  const old = state.lab.promptSuggestion(state.session.id, state.input);
  await vi.waitFor(() => expect(state.fake.calls).toHaveLength(2));
  const work = state.lab.start(state.session.id, '继续新工作');
  expect((await old).text).toBeNull(); expect(state.fake.calls[1].aborted).toBe(true);
  await work.run(() => {}); expect(state.lab.get(state.session.id).lastResult?.status).toBe('succeeded');
});

it('deduplicates concurrent tabs and skips failures without changing the main result', async () => {
  const state = await setup({ waitForAbort: true }); const controller = new AbortController();
  const pending = state.lab.promptSuggestion(state.session.id, state.input, undefined, { signal: controller.signal });
  await vi.waitFor(() => expect(state.fake.calls).toHaveLength(2));
  expect((await state.lab.promptSuggestion(state.session.id, state.input)).text).toBeNull();
  controller.abort(); expect((await pending).text).toBeNull(); expect(state.lab.get(state.session.id)).toEqual(state.snapshot);
});

it('honors the total timeout while waiting for an occupied model permit', async () => {
  let blockMain = false;
  const state = await setup({ text: '请继续核对' }, { blockMain: () => blockMain });
  state.lab.setModelConcurrency(1);
  const other = await state.lab.createSession(); blockMain = true;
  const running = state.lab.start(other.id, '占用模型许可'); const done = running.run(() => {});
  await vi.waitFor(() => expect(state.fake.calls).toHaveLength(2));
  vi.useFakeTimers();
  const pending = state.lab.promptSuggestion(state.session.id, state.input);
  await vi.advanceTimersByTimeAsync(20_001);
  expect((await pending).text).toBeNull(); expect(state.fake.calls).toHaveLength(2);
  vi.useRealTimers(); await state.lab.cancel(other.id, running.requestId); await done;
});

it('rechecks the identity before returning a successful independent completion', async () => {
  let valid = true;
  const state = await setup({ text: '请继续核对' }, { duringPrediction: () => { valid = false; } });
  await expect(state.lab.promptSuggestion(state.session.id, state.input, undefined, {
    signal: new AbortController().signal, assertIdentity: () => { if (!valid) throw new RequestError('AUTH_REQUIRED', 'revoked', 401); },
  })).rejects.toMatchObject({ code: 'AUTH_REQUIRED', statusCode: 401 });
  expect(state.lab.get(state.session.id)).toEqual(state.snapshot);
});

it('model selection cancels an in-flight prediction and does not append suggestion history', async () => {
  const state = await setup({ waitForAbort: true });
  const pending = state.lab.promptSuggestion(state.session.id, state.input);
  await vi.waitFor(() => expect(state.fake.calls).toHaveLength(2));
  state.lab.selectModel(state.session.id, 'default');
  expect((await pending).text).toBeNull(); expect(state.fake.calls[1].aborted).toBe(true);
  expect(state.lab.get(state.session.id)).toEqual(state.snapshot);
});

it('does not invoke the provider if the session expert becomes unavailable', async () => {
  const state = await setup();
  const guard = vi.spyOn(state.lab.capabilities, 'assertAdmission').mockImplementation(() => { throw new RequestError('EXPERT_UNAVAILABLE', '已撤销', 409); });
  try {
    expect((await state.predict()).statusCode).toBe(409);
    expect(state.fake.calls).toHaveLength(1); expect(state.lab.get(state.session.id).lastResult).toEqual(state.snapshot.lastResult);
  } finally { guard.mockRestore(); }
});

it('saving a model profile aborts predictions while preserving the completed main result', async () => {
  const state = await setup({ waitForAbort: true });
  const pending = state.lab.promptSuggestion(state.session.id, state.input);
  await vi.waitFor(() => expect(state.fake.calls).toHaveLength(2));
  const current = state.lab.modelSettings();
  await state.lab.updateModelSettings({ provider: current.provider, model: current.model, baseUrl: current.baseUrl,
    expectedVersion: current.version, contextWindow: current.contextWindow!, maxOutputTokens: current.maxOutputTokens!,
    compactionReserveTokens: current.compactionReserveTokens!, compactionKeepRecentTokens: current.compactionKeepRecentTokens! });
  expect((await pending).text).toBeNull(); expect(state.fake.calls[1].aborted).toBe(true);
  expect(state.lab.get(state.session.id)).toEqual(state.snapshot);
});

it('formal identities retain CSRF, private ownership, administrator scope, task and revocation guards', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'axon-prediction-auth-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const db = await openDatabase(dir), access = new AccessStore(db);
  await access.saveAccount({ username: 'member', displayName: '普通用户', seatId: 'member', seatName: '业务席位', password: 'test-password-123', createPublicTask: false, manageModelSettings: false });
  migrateAdministratorAccounts(db);
  const adminId = await access.saveAdministratorAccount({ username: 'admin', displayName: '管理员', password: 'test-password-123' }); db.close();
  let revoke = '';
  const config = testConfig(dir, { auth: { secret: 'test-only-signing-key-at-least-32-characters', sessionMs: 28800000 } });
  const fake = await fakeRuntime(config, context => {
    if (context.systemPrompt?.startsWith('预测用户')) {
      if (revoke) lab.access!.db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(revoke);
      return { text: '请继续核对文件。' };
    }
    return { text: '本轮核对完成。' };
  });
  const lab = await PiLab.create(config, fake.runtime); const app = await createApp(lab); cleanup.push(() => app.close());
  const login = async (username: string) => {
    const first = await app.inject('/api/auth/session'), anonymous = first.json<AuthSession>();
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: {
      cookie: first.cookies.map(item => `${item.name}=${item.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': anonymous.csrf!,
    }, payload: { username, password: 'test-password-123' } });
    expect(response.statusCode, response.body).toBe(200); const auth = response.json<AuthSession>();
    return { identity: auth.identity!, headers: { cookie: response.cookies.map(item => `${item.name}=${item.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': auth.csrf!, 'x-axon-view': auth.viewId! } };
  };
  type Actor = Awaited<ReturnType<typeof login>>;
  const call = (who: Actor, url: string, payload: object) => app.inject({ method: 'POST', url, headers: who.headers, payload });
  const personal = async (who: Actor) => {
    const taskResponse = await call(who, '/api/tasks', { title: '预测验证', goal: '', visibility: 'private', clientActionId: randomUUID() });
    expect(taskResponse.statusCode, taskResponse.body).toBe(200); const task = taskResponse.json<TaskSpace>();
    const workspaceResponse = await call(who, `/api/tasks/${task.id}/workspace`, {}); const workspace = workspaceResponse.json<Workspace>();
    const response = await call(who, '/api/sessions', { workspaceId: workspace.id, clientActionId: randomUUID() });
    expect(response.statusCode, response.body).toBe(200); const session = response.json<SessionSnapshot>();
    const owner = who.identity.role === 'administrator' ? (who.identity as AdministratorIdentity).personalScopeId : who.identity.seatId;
    await lab.start(session.id, '核对文件', {}, owner, undefined, who.identity.userId).run(() => {});
    const snapshot = lab.get(session.id, owner), turn = snapshot.turns!.at(-1)!;
    const input: PromptSuggestionRequest = { sourceRequestId: turn.requestId, finalMessageId: turn.finalMessageId!, expectedModelId: 'default' };
    return { task, session, input, url: `/api/sessions/${session.id}/prompt-suggestion` };
  };
  const member = await login('member'), admin = await login('admin');
  const business = await personal(member), own = await personal(admin);
  expect((await call(admin, business.url, business.input)).statusCode).toBe(404);
  expect((await call(member, own.url, own.input)).statusCode).toBe(404);
  const { 'x-csrf-token': unused, ...withoutCsrf } = member.headers; void unused;
  expect((await app.inject({ method: 'POST', url: business.url, headers: withoutCsrf, payload: business.input })).statusCode).toBe(403);
  expect((await call(member, business.url, business.input)).json<PromptSuggestionResponse>().text).toBe('请继续核对文件。');
  expect((await call(admin, own.url, own.input)).json<PromptSuggestionResponse>().text).toBe('请继续核对文件。');
  const archived = await personal(member);
  expect((await call(member, `/api/tasks/${archived.task.id}/archive`, { revision: archived.task.revision })).statusCode).toBe(200);
  const attempts = fake.calls.length;
  expect((await call(member, archived.url, archived.input)).statusCode).toBe(409); expect(fake.calls).toHaveLength(attempts);
  const revoked = await personal(admin); revoke = adminId;
  expect((await call(admin, revoked.url, revoked.input)).statusCode).toBe(401);
  expect(lab.get(revoked.session.id, (admin.identity as AdministratorIdentity).personalScopeId).lastResult?.status).toBe('succeeded');
});
