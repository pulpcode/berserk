import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@earendil-works/pi-ai';
import { afterEach, expect, it, vi } from 'vitest';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { RequestError } from '../src/contracts/errors.js';
import { AccessStore } from '../src/access/store.js';
import { openDatabase } from '../src/access/database.js';
import { migrateAdministratorAccounts } from '../src/access/administrator-schema.js';
import type { AdministratorIdentity, AuthSession, TaskSpace } from '../src/contracts/access.js';
import type { SessionSnapshot, Workspace } from '../src/contracts/index.js';
import type { ConfirmationInteraction } from '../src/contracts/index.js';
import type { WorkActivityRequest, WorkActivityResponse, WorkActivityView } from '../src/contracts/work-activity.js';
import { isWorkActivityResponse, isWorkActivityView } from '../src/contracts/work-activity.js';
import { fakeRuntime, testConfig, type Reply } from './pi/fake-runtime.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });
const source = (view: WorkActivityView): WorkActivityRequest => ({ ...view.source!, version: view.version });
function analysisReply(context: Context): Reply {
  const payload = JSON.parse(String(context.messages[0].content));
  const user = payload.evidence.find((item: { kind: string; requestId: string }) => item.kind === 'user' && item.requestId === payload.source.sourceRequestId);
  return { text: JSON.stringify({ items: [{ workItemId: null, title: '整理采购建议', description: '正在编制采购建议。', relation: 'processing', evidenceIds: [user.id] }] }) };
}
async function setup(reply: (context: Context) => Reply = analysisReply, main: (context: Context) => Reply = () => ({ text: '本轮编制已完成。' })) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-work-activity-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const config = testConfig(dir, { maxOutputTokens: 4096, seatId: 'test-seat', testSeats: [{ id: 'test-seat', name: 'A' }, { id: 'seat-b', name: 'B' }] });
  const fake = await fakeRuntime(config, context => context.systemPrompt?.startsWith('识别当前对话') ? reply(context) : main(context));
  const lab = await PiLab.create(config, fake.runtime), app = await createApp(lab); cleanup.push(() => app.close());
  const session = await lab.createSession(); await lab.start(session.id, '编制采购建议').run(() => {});
  const url = `/api/test-seats/test-seat/sessions/${session.id}/work-activity-analysis`;
  const get = () => app.inject(url);
  const post = (payload = source(lab.workActivity(session.id))) => app.inject({ method: 'POST', url, payload });
  return { dir, config, fake, lab, app, session, url, get, post };
}

it('reads old conversations without generating, then analyzes without altering history, files, business state or main usage', async () => {
  const state = await setup();
  const names = await readdir(join(state.dir, 'sessions'));
  const saved = await Promise.all(names.map(name => readFile(join(state.dir, 'sessions', name), 'utf8')));
  const before = state.lab.get(state.session.id), activity = state.lab.activity(), works = state.lab.collaboration!.list({ seatId: 'test-seat' });
  const view = (await state.get()).json<WorkActivityView>(); expect(isWorkActivityView(view)).toBe(true); expect(view.canAnalyze).toBe(true);
  expect(state.fake.calls).toHaveLength(1);
  const response = await state.post(); expect(response.statusCode, response.body).toBe(200);
  expect(isWorkActivityResponse(response.json())).toBe(true); expect(response.json<WorkActivityResponse>()).toMatchObject({ status: 'ready', items: [{ workItemId: null }] });
  expect(state.fake.calls).toHaveLength(2); expect(state.fake.calls[1].context.tools).toBeUndefined();
  expect(state.lab.get(state.session.id)).toEqual(before); expect(state.lab.activity()).toEqual(activity);
  expect(state.lab.collaboration!.list({ seatId: 'test-seat' })).toEqual(works);
  expect(await Promise.all(names.map(name => readFile(join(state.dir, 'sessions', name), 'utf8')))).toEqual(saved);
});

it('rejects foreign seats, stale source and browser-supplied authority/context before calling models', async () => {
  const state = await setup(), input = source(state.lab.workActivity(state.session.id));
  expect((await state.app.inject(state.url.replace('test-seats/test-seat', 'test-seats/seat-b'))).statusCode).toBe(404);
  for (const payload of [{ ...input, sourceRequestId: randomUUID() }, { ...input, finalMessageId: 'missing' }, { ...input, version: 'f'.repeat(64) }]) {
    expect((await state.post(payload)).statusCode).toBe(409);
  }
  for (const extra of [{ candidates: [] }, { seatId: 'seat-b' }, { transcript: 'fabrication' }]) {
    expect((await state.app.inject({ method: 'POST', url: state.url, payload: { ...input, ...extra } })).statusCode).toBe(400);
  }
  expect(state.fake.calls).toHaveLength(1);
});

it('keeps versions independent of selected model but changes them for business revisions', async () => {
  const state = await setup(), before = state.lab.workActivity(state.session.id);
  state.lab.selectModel(state.session.id, 'default'); expect(state.lab.workActivity(state.session.id).version).toBe(before.version);
  const workspace = state.lab.workspaces.get();
  const action = await state.lab.collaboration!.prepare({ seatId: 'test-seat' }, { kind: 'assign', taskSpaceId: workspace.taskSpaceId,
    payload: { workspaceId: workspace.id, assigneeSeatId: 'seat-b', title: '新增工作', goal: '编制采购建议', inputPaths: [] } }, { source: 'page', clientActionId: randomUUID() });
  await state.lab.collaboration!.commitPage({ seatId: 'test-seat' }, action.operationId);
  expect(state.lab.workActivity(state.session.id).version).not.toBe(before.version);
  expect((await state.post(source(before))).statusCode).toBe(409);
});

it('deduplicates in-flight requests, permits explicit retry after failure and rechecks every caller identity', async () => {
  const state = await setup(() => ({ waitForAbort: true }));
  const input = source(state.lab.workActivity(state.session.id)), abort = new AbortController();
  const first = state.lab.analyzeWorkActivity(state.session.id, input, undefined, { signal: abort.signal });
  await vi.waitFor(() => expect(state.fake.calls).toHaveLength(2));
  let valid = true;
  const second = state.lab.analyzeWorkActivity(state.session.id, input, undefined, { signal: new AbortController().signal,
    assertIdentity: () => { if (!valid) throw new RequestError('AUTH_REQUIRED', 'revoked', 401); } });
  const rejected = expect(second).rejects.toMatchObject({ statusCode: 401 });
  valid = false; abort.abort(); expect((await first).status).toBe('unavailable'); await rejected;
  expect(state.fake.calls).toHaveLength(2);
  const retryAbort = new AbortController();
  const retry = state.lab.analyzeWorkActivity(state.session.id, input, undefined, { signal: retryAbort.signal });
  await vi.waitFor(() => expect(state.fake.calls).toHaveLength(3)); retryAbort.abort(); await retry;
});

it('new foreground work in another chat preempts an analysis occupying the only permit', async () => {
  const state = await setup(() => ({ waitForAbort: true })); state.lab.setModelConcurrency(1);
  const pending = state.lab.analyzeWorkActivity(state.session.id, source(state.lab.workActivity(state.session.id)));
  await vi.waitFor(() => expect(state.fake.calls).toHaveLength(2));
  const other = await state.lab.createSession(); await state.lab.start(other.id, '开始另一项工作').run(() => {});
  expect((await pending).status).toBe('unavailable'); expect(state.fake.calls[1].aborted).toBe(true);
  expect(state.lab.get(other.id).lastResult?.status).toBe('succeeded');
});

it('foreground preempts both auxiliary kinds across chats with one permit', async () => {
  const state = await setup(() => ({ waitForAbort: true }), context => context.systemPrompt?.startsWith('预测用户') ? { waitForAbort: true } : { text: '正式回复' });
  const other = await state.lab.createSession(); await state.lab.start(other.id, '第二个会话').run(() => {});
  state.lab.setModelConcurrency(1);
  const analysis = state.lab.analyzeWorkActivity(state.session.id, source(state.lab.workActivity(state.session.id)));
  await vi.waitFor(() => expect(state.fake.calls).toHaveLength(3));
  const turn = state.lab.get(other.id).turns!.at(-1)!;
  const prediction = state.lab.promptSuggestion(other.id, { sourceRequestId: turn.requestId, finalMessageId: turn.finalMessageId!, expectedModelId: 'default' });
  const third = await state.lab.createSession(); await state.lab.start(third.id, '优先处理正式工作').run(() => {});
  expect((await analysis).status).toBe('unavailable'); expect((await prediction).text).toBeNull();
  expect(state.fake.calls[2].aborted).toBe(true); expect(state.fake.calls).toHaveLength(4);
  expect(state.lab.get(third.id).lastResult?.status).toBe('succeeded');
});

it('a rejected foreground request cannot cancel another conversation analysis', async () => {
  const state = await setup(() => ({ waitForAbort: true }));
  const other = await state.lab.createSession(), abort = new AbortController();
  const pending = state.lab.analyzeWorkActivity(state.session.id, source(state.lab.workActivity(state.session.id)), undefined, { signal: abort.signal });
  await vi.waitFor(() => expect(state.fake.calls).toHaveLength(2));
  expect(() => state.lab.start(other.id, '无权创作', { authoring: { kind: 'expert' } })).toThrow();
  expect(state.fake.calls[1].aborted).toBe(false); abort.abort(); await pending;
});

it('applies the twenty-second total timeout while a model permit is occupied', async () => {
  let block = false;
  const state = await setup(analysisReply, () => block ? { waitForAbort: true } : { text: '正式回复' });
  state.lab.setModelConcurrency(1); const other = await state.lab.createSession(); block = true;
  const running = state.lab.start(other.id, '占用许可'), done = running.run(() => {});
  await vi.waitFor(() => expect(state.fake.calls).toHaveLength(2)); vi.useFakeTimers();
  const pending = state.lab.analyzeWorkActivity(state.session.id, source(state.lab.workActivity(state.session.id)));
  await vi.advanceTimersByTimeAsync(20_001); expect((await pending).status).toBe('unavailable'); expect(state.fake.calls).toHaveLength(2);
  vi.useRealTimers(); await state.lab.cancel(other.id, running.requestId); await done;
});

it('model selection cancels pending analysis while completed-source version remains stable', async () => {
  const state = await setup(() => ({ waitForAbort: true })), view = state.lab.workActivity(state.session.id);
  const pending = state.lab.analyzeWorkActivity(state.session.id, source(view));
  await vi.waitFor(() => expect(state.fake.calls).toHaveLength(2)); state.lab.selectModel(state.session.id, 'default');
  expect((await pending).status).toBe('unavailable'); expect(state.fake.calls[1].aborted).toBe(true);
  expect(state.lab.workActivity(state.session.id).version).toBe(view.version);
});

it('rechecks revoked permissions even when the model returned invalid JSON', async () => {
  let revoked = false;
  const state = await setup(() => { revoked = true; return { text: 'invalid' }; });
  await expect(state.lab.analyzeWorkActivity(state.session.id, source(state.lab.workActivity(state.session.id)), undefined, {
    signal: new AbortController().signal, assertIdentity: () => { if (revoked) throw new RequestError('AUTH_REQUIRED', 'revoked', 401); },
  })).rejects.toMatchObject({ statusCode: 401 });
});

it('returns actual committed receipt facts even when the rest of the formal turn fails', async () => {
  let perform = false;
  const state = await setup(analysisReply, context => {
    if (!perform) return { text: '请明确工作。' };
    if (context.messages.some(message => message.role === 'toolResult' && message.toolName === 'work_item_action')) return { text: '之后失败', length: true };
    return { tools: [{ name: 'work_item_action', arguments: { action: { kind: 'assign', payload: { assigneeSeatId: 'seat-b', title: '采购建议', goal: '编制设备采购建议', inputPaths: [] } } } }] };
  });
  perform = true;
  const request = state.lab.start(state.session.id, '分派采购建议工作'); const done = request.run(() => {});
  await vi.waitFor(() => expect(state.lab.get(state.session.id).interactions?.some(item => item.status === 'pending')).toBe(true));
  const card = state.lab.get(state.session.id).interactions!.find(item => item.status === 'pending')! as ConfirmationInteraction;
  state.lab.respondInteraction(state.session.id, card.interactionId, { requestId: card.requestId, kind: 'confirmation', decision: 'approve' });
  await done;
  const view = state.lab.workActivity(state.session.id);
  expect(state.lab.get(state.session.id).lastResult?.status).toBe('failed'); expect(view.canAnalyze).toBe(false);
  expect(view.facts).toHaveLength(1); expect(view.facts[0]).toMatchObject({ origin: 'receipt', title: '采购建议', state: 'assigned', recency: 'current' });
  expect(view.evidence.find(item => item.id === view.facts[0].evidenceIds[0])?.kind).toBe('receipt');
});

it('preserves formal login, CSRF, personal ownership, archived-task and revoked-login boundaries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'axon-work-activity-auth-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const db = await openDatabase(dir), access = new AccessStore(db);
  await access.saveAccount({ username: 'member', displayName: '用户', seatId: 'member', seatName: '业务席位', password: 'test-password-123', createPublicTask: false, manageModelSettings: false });
  migrateAdministratorAccounts(db);
  const adminId = await access.saveAdministratorAccount({ username: 'admin', displayName: '管理员', password: 'test-password-123' }); db.close();
  const config = testConfig(dir, { maxOutputTokens: 4096, auth: { secret: 'test-only-signing-key-at-least-32-characters', sessionMs: 28800000 } });
  let revoke = false;
  const fake = await fakeRuntime(config, context => {
    if (!context.systemPrompt?.startsWith('识别当前对话')) return { text: '已编制建议。' };
    if (revoke) lab.access!.db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(adminId);
    return analysisReply(context);
  });
  const lab = await PiLab.create(config, fake.runtime), app = await createApp(lab); cleanup.push(() => app.close());
  const login = async (username: string) => {
    const first = await app.inject('/api/auth/session');
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: {
      cookie: first.cookies.map(item => `${item.name}=${item.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': first.json<AuthSession>().csrf!,
    }, payload: { username, password: 'test-password-123' } });
    expect(response.statusCode, response.body).toBe(200); const auth = response.json<AuthSession>();
    return { identity: auth.identity!, headers: { cookie: response.cookies.map(item => `${item.name}=${item.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': auth.csrf!, 'x-axon-view': auth.viewId! } };
  };
  type Actor = Awaited<ReturnType<typeof login>>;
  const post = (who: Actor, url: string, payload: object) => app.inject({ method: 'POST', url, payload, headers: who.headers });
  const create = async (who: Actor) => {
    const task = (await post(who, '/api/tasks', { title: '工作识别', goal: '', visibility: 'private', clientActionId: randomUUID() })).json<TaskSpace>();
    const workspace = (await post(who, `/api/tasks/${task.id}/workspace`, {})).json<Workspace>();
    const session = (await post(who, '/api/sessions', { workspaceId: workspace.id, clientActionId: randomUUID() })).json<SessionSnapshot>();
    const owner = who.identity.role === 'administrator' ? (who.identity as AdministratorIdentity).personalScopeId : who.identity.seatId;
    await lab.start(session.id, '编制采购建议', {}, owner, undefined, who.identity.userId).run(() => {});
    return { task, session, owner, input: source(lab.workActivity(session.id, owner, who.identity.userId)), url: `/api/sessions/${session.id}/work-activity-analysis` };
  };
  const member = await login('member'), admin = await login('admin');
  const business = await create(member), personal = await create(admin);
  expect((await app.inject({ url: business.url, headers: admin.headers })).statusCode).toBe(404);
  expect((await post(member, personal.url, personal.input)).statusCode).toBe(404);
  const { 'x-csrf-token': unused, ...withoutCsrf } = member.headers; void unused;
  expect((await app.inject({ method: 'POST', url: business.url, payload: business.input, headers: withoutCsrf })).statusCode).toBe(403);
  expect((await post(admin, personal.url, personal.input)).json<WorkActivityResponse>().status).toBe('ready');
  const analysis = fake.calls.find(call => call.context.systemPrompt?.startsWith('识别当前对话'))!;
  expect(JSON.parse(String(analysis.context.messages[0].content)).candidates).toEqual([]);
  expect((await post(member, `/api/tasks/${business.task.id}/archive`, { revision: business.task.revision })).statusCode).toBe(200);
  const archived = (await app.inject({ url: business.url, headers: member.headers })).json<WorkActivityView>();
  expect(archived.canAnalyze).toBe(false); expect((await post(member, business.url, business.input)).statusCode).toBe(409);
  revoke = true;
  expect((await post(admin, personal.url, personal.input)).statusCode).toBe(401);
  expect(lab.get(personal.session.id, personal.owner).lastResult?.status).toBe('succeeded');
});
