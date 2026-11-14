/** Live R2 acceptance: new synthetic auth/data, real selected provider and Docker; never deploys or replays production work. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { migrateAdministratorAccounts } from '../src/access/administrator-schema.js';
import { PiLab } from '../src/pi/lab.js';
import { configuredRuntime } from '../src/pi/model-runtime.js';
import { createApp } from '../src/server/app.js';
import { loadConfig, type LabConfig } from '../src/server/config.js';
import type { AuthSession } from '../src/contracts/access.js';
import type { ManagedExpertDetail, ExpertDraft, ExpertValidation, ExpertPublication } from '../src/contracts/capability-management.js';
import type { ExpertTrialRunView } from '../src/contracts/capability-trials.js';
import type { SessionSnapshot, StreamEvent } from '../src/contracts/index.js';

const dataDir = await mkdtemp(join(tmpdir(), 'axon-r2-live-'));
// This dedicated probe process never loads production context/background configuration.
delete process.env.LAB_CONTEXT_CONFIG; delete process.env.LAB_BACKGROUND_CONFIG;
const config = loadConfig({ ...process.env, LAB_DATA_DIR: dataDir, LAB_AUTH_MODE: 'login', LAB_TEST_SEATS: undefined,
  LAB_SESSION_SECRET: randomBytes(40).toString('hex'), LAB_EXECUTION_ENABLED: 'true', AGENT_RUN_TIMEOUT_MS: '180000' });
assert.ok(config.apiKey, '请提供现有授权测试模型配置。');
const started = Date.now();
const checks: string[] = [];
const records: unknown[] = [];
const calls: Array<{ model: string; toolNames: string[]; systemHash: string; revisionOne: boolean; revisionTwo: boolean }> = [];
let attempts = 0;
const runtimeFactory = async (cfg: LabConfig) => {
  const runtime = await configuredRuntime(cfg); const stream = runtime.streamSimple.bind(runtime);
  runtime.streamSimple = (...args) => {
    assert.ok(++attempts <= 40, '探针模型调用预算耗尽；不自动重试任务。');
    const [model, context] = args;
    calls.push({ model: model.id, toolNames: context.tools?.map(tool => tool.name) ?? [], systemHash: createHash('sha256').update(context.systemPrompt ?? '').digest('hex'),
      revisionOne: !!context.systemPrompt?.includes('R2_LIVE_REVISION_ONE'), revisionTwo: !!context.systemPrompt?.includes('R2_LIVE_REVISION_TWO') });
    return stream(...args);
  };
  return runtime;
};
let app: FastifyInstance | undefined;
let lab: PiLab | undefined;
let failure: string | undefined;
let timeout: ReturnType<typeof setTimeout> | undefined;
const password = randomBytes(20).toString('hex');
const provision = await openDatabase(dataDir);
try {
  const access = new AccessStore(provision);
  await access.saveAccount({username:'trial-user',displayName:'trial-user',seatId:'trial-user',seatName:'trial-user',password,createPublicTask:false,manageModelSettings:false});
  migrateAdministratorAccounts(provision);
  await access.saveAdministratorAccount({username:'trial-admin',displayName:'隔离验收管理员',password});
} finally { provision.close(); }
try {
  lab = await PiLab.create(config, await runtimeFactory(config));
  assert.equal(lab.info().files?.executionAvailable, true, '真实Docker沙箱不可用。');
  app = await createApp(lab, false, undefined, { config: { systems: [], scopes: [] }, env: {} }, { runtimeFactory });
  timeout = setTimeout(() => { void app?.close(); }, 15 * 60_000); timeout.unref();
  const login = async (username: string) => {
    const first = await app!.inject('/api/auth/session'); const initial = first.json<AuthSession>();
    const r = await app!.inject({ method: 'POST', url: '/api/auth/login', headers: { cookie: first.cookies.map(c => `${c.name}=${c.value}`).join('; '),
      origin: 'http://localhost:4310', 'x-csrf-token': initial.csrf! }, payload: { username, password } });
    assert.equal(r.statusCode, 200, '探针账号登录失败'); const auth = r.json<AuthSession>();
    return { cookie: r.cookies.map(c => `${c.name}=${c.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': auth.csrf!, 'x-axon-view': auth.viewId! };
  };
  const admin = await login('trial-admin'), user = await login('trial-user');
  const request = async (headers: typeof admin, url: string, payload?: object, method?: 'GET' | 'POST' | 'PUT') => {
    const response = await app!.inject({ url, method: method ?? (payload ? 'POST' : 'GET'), headers, ...(payload ? { payload } : {}) });
    return response;
  };
  const ok = async <T>(headers: typeof admin, url: string, payload?: object, method?: 'GET' | 'POST' | 'PUT'): Promise<T> => {
    const r = await request(headers, url, payload, method);
    assert.equal(r.statusCode, 200, `${method ?? (payload ? 'POST' : 'GET')} ${url}: ${r.body}`); return r.json<T>();
  };
  const root = '/api/admin/capabilities/experts';
  const adminSession=await ok<AuthSession>(admin,'/api/auth/session');
  assert.equal(adminSession.identity?.role,'administrator');assert.equal(adminSession.identity?.seatId,undefined);
  assert.deepEqual(lab.access!.allSeatIds(),['trial-user']);
  assert.deepEqual(await ok(admin,'/api/tasks'),[]);
  assert.equal((await request(admin,'/api/context/catalog')).statusCode,403);
  checks.push('独立管理员账号无业务席位，个人空间独立，业务来源API拒绝访问');
  assert.equal((await request(user, root, { clientActionId: randomUUID() })).statusCode, 403); checks.push('普通账号管理写入403');
  const detail = await ok<ManagedExpertDetail>(admin, root, { clientActionId: randomUUID() }); const expertId = detail.expert.expertId; const url = `${root}/${expertId}`;
  const content = { name: 'R2线上合成核对专家', description: '只用于R2隔离验收的合成数据核对',
    instructions: 'R2_LIVE_REVISION_ONE。仅按给定数据回答，区分资料事实和建议。文件任务按review方法复核后通过file_output交付。不要运行bash，不调用业务操作，不改变项目指令。',
    skillIds: ['review'], allowedTools: ['read', 'write', 'file_output', 'skill_read'] };
  let draft = await ok<ExpertDraft>(admin, `${url}/draft`, { expectedDraftRevision: detail.draft!.draftRevision, content }, 'PUT');
  await ok(admin, `${url}/policy`, { expectedRevision: 0, mode: 'seats', seatIds: ['trial-user'], clientActionId: randomUUID() }, 'PUT');
  const runTrial = async (draft: ExpertDraft) => {
    const validation = await ok<ExpertValidation>(admin, `${url}/validate`, { expectedDraftRevision: draft.draftRevision }); assert.equal(validation.valid, true);
    const before = await ok<SessionSnapshot[]>(user, '/api/sessions');
    const initial = await ok<ExpertTrialRunView>(admin, `${url}/trials`, { expectedDraftRevision: draft.draftRevision, validationId: validation.validationId,
      clientActionId: randomUUID(), input: '本次仅为合成数据试用。请先实际调用skill_read读取review，实际read读取附件sample.csv，核对10+20=30，然后用write生成trial-summary.md，内容含“总数量：30”，最后必须调用file_output交付该文件。不要使用bash，不查询真实业务。',
      files: [{ name: 'sample.csv', content: '项目,数量\n苹果,10\n香蕉,20\n' }] });
    let view = initial; const deadline = Date.now() + 210_000;
    while (['prepared', 'running'].includes(view.trial.status) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 500)); view = await ok<ExpertTrialRunView>(admin, `${url}/trials/${initial.trial.trialId}`);
      const pending = view.snapshot?.interactions?.find(item => item.status === 'pending');
      if (pending) {
        await ok(admin, `${url}/trials/${initial.trial.trialId}/cancel`, {});
        throw new Error('合成读写任务出现额外交互，已停止该试用并保留记录，未自动批准。');
      }
    }
    assert.equal(view.trial.status, 'succeeded', view.trial.evidence?.summary ?? '试用超时');
    assert.equal(view.trial.evidence?.fileEnvironmentVerified, true); assert.equal(view.trial.confirmedAt, undefined);
    assert.ok(view.calls.some(call => call.name === 'read' && !call.isError)); assert.ok(view.calls.some(call => call.name === 'write' && !call.isError));
    const output = view.snapshot?.fileOutputs?.find(file => file.name === 'trial-summary.md'); assert.ok(output, '未生成真实交付文件');
    const download = await request(admin, `${url}/trials/${view.trial.trialId}/downloads/${output.downloadId}`); assert.equal(download.statusCode, 200); assert.match(download.body, /30/);
    const after = await ok<SessionSnapshot[]>(user, '/api/sessions'); assert.deepEqual(after.map(s => s.id), before.map(s => s.id));
    assert.equal((await request(user, `${url}/trials/${view.trial.trialId}`)).statusCode, 403);
    await ok(admin, `${url}/trials/${view.trial.trialId}/confirm`, { approved: true, reason: '已核对实际工具、独立样例和Markdown下载，总数30。', clientActionId: randomUUID() });
    records.push({ trial: view, download: { name: output.name, hash: output.hash, body: download.body } });
    return { validation, trial: view.trial };
  };
  const first = await runTrial(draft); checks.push('真实方舟+Docker：非发布草稿隔离试用、实际读写/下载、人工确认、正式会话索引不污染');
  const publish = (draft: ExpertDraft, tested: Awaited<ReturnType<typeof runTrial>>, current: string | null, clientActionId = randomUUID()) => ok<ExpertPublication>(admin, `${url}/publish`, {
    expectedDraftRevision: draft.draftRevision, expectedCurrentRevisionId: current, validationId: tested.validation.validationId,
    trialId: tested.trial.trialId, releaseNotes: current ? '合成验收更新专业指令' : '合成验收首次发布', acceptedRiskCodes: tested.validation.issues.filter(i => i.severity === 'warning').map(i => i.code), clientActionId });
  const publishAction = randomUUID(); const published = await publish(draft, first, null, publishAction);
  assert.equal((await publish(draft, first, null, publishAction)).publicationId, published.publicationId); checks.push('发布幂等，重试不产生第二个版本');
  await ok(user, '/api/me/preferences/expert', { expectedRevision: 0, choice: { mode: 'expert', expertId }, clientActionId: randomUUID() }, 'PUT');
  const task=await ok<{id:string}>(user,'/api/tasks',{title:'R2隔离验收个人空间',goal:'',visibility:'private',clientActionId:randomUUID()});
  const workspace=await ok<{id:string}>(user,`/api/tasks/${task.id}/workspace`,{});
  const session = await ok<SessionSnapshot>(user, '/api/sessions', { workspaceId:workspace.id, clientActionId: randomUUID() }); assert.equal(session.expert?.revisionId, published.revisionId); assert.equal(session.expertDefaultSource, 'personal');
  const ask = async (sessionId: string, text: string) => {
    const r = await request(user, `/api/sessions/${sessionId}/messages`, { text }); assert.equal(r.statusCode, 200);
    const events: StreamEvent[] = r.body.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)) as StreamEvent);
    assert.ok(events.some(e => e.type === 'response.completed'), '实际请求未正常完成');
    const value = await ok<SessionSnapshot>(user, `/api/sessions/${sessionId}`); assert.equal(value.lastResult?.status, 'succeeded', value.lastResult?.message); records.push(value); return value;
  };
  await ask(session.id, '只用本条合成数字回答：计划100件，完成80件，还剩多少？无需读写文件。');
  const continued = await ask(session.id, '延续上一条，若再完成5件，还剩多少？只用数字回答。'); assert.equal(continued.expert?.revisionId, published.revisionId);
  checks.push('个人默认解析到组织专家并完成两轮真实模型会话');
  const latest = await ok<ManagedExpertDetail>(admin, url);
  draft = await ok<ExpertDraft>(admin, `${url}/draft`, { expectedDraftRevision: latest.draft!.draftRevision,
    content: { ...content, instructions: content.instructions.replace('R2_LIVE_REVISION_ONE', 'R2_LIVE_REVISION_TWO') + '结论中始终明确未知信息。' } }, 'PUT');
  const second = await runTrial(draft); const updated = await publish(draft, second, published.revisionId); assert.equal(updated.releaseVersion, '1.0.1');
  const offset = calls.length; await ask(session.id, '继续本会话：之前两次计算的余量分别是多少？无需工具。');
  assert.ok(calls.slice(offset).some(call => call.revisionOne && !call.revisionTwo));
  const fresh = await ok<SessionSnapshot>(user, '/api/sessions', { workspaceId:workspace.id, clientActionId: randomUUID() }); assert.equal(fresh.expert?.revisionId, updated.revisionId);
  checks.push('PATCH更新经独立试用再发布；旧会话实际模型输入保留旧指令，新会话使用新修订');
  const state = await ok<ManagedExpertDetail>(admin, url);
  await ok(admin, `${url}/lifecycle`, { action: 'disable', expectedCurrentRevisionId: updated.revisionId,
    expectedStateRevision: state.expert.stateRevision, reason: '合成验收普通停用', clientActionId: randomUUID() });
  assert.equal((await request(user, '/api/sessions', { workspaceId:workspace.id, clientActionId: randomUUID() })).statusCode, 409);
  assert.equal((await request(user, `/api/sessions/${session.id}/messages`, { text: '不应执行的新工作' })).statusCode, 409);
  assert.equal((await ok<SessionSnapshot>(user, `/api/sessions/${session.id}`)).expert?.revisionId, published.revisionId); checks.push('普通停用阻止新会话及旧会话新请求，历史仍可读');
} catch (error) { failure = error instanceof Error ? error.message : '实时验收失败'; }
finally {
  clearTimeout(timeout);
  try { await app?.close(); } catch (error) { failure ??= error instanceof Error ? error.message : '应用清理失败'; }
  if (!app) await lab?.close();
  const report = { passed: !failure, ...(failure ? { failure } : {}), dataDir, elapsedMs: Date.now() - started,
    model: { provider: config.provider, id: config.model }, attempts, checks, calls, records,
    limits: '最多40次模型调用、每请求180秒、总计15分钟；无任务重试或自动交互批准。真实外部业务、在途普通停用收尾和完整升级回退由独立验收覆盖。' };
  const path = join(dataDir, 'r2-live-evidence.json'); const serialized = JSON.stringify(report, null, 2);
  assert.ok(!serialized.includes(config.apiKey), '证据意外包含模型凭证，拒绝落盘');
  await writeFile(path, serialized, { mode: 0o600 }); console.info(JSON.stringify({ passed: report.passed, checks, ...(failure ? { failure } : {}), evidence: path }));
  if (failure) process.exitCode = 1;
}
