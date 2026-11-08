import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Context } from '@earendil-works/pi-ai';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { parseBackgroundConfig } from '../src/background/config.js';
import { BackgroundStore } from '../src/background/store.js';
import type { AuthSession, TaskSpace } from '../src/contracts/access.js';
import type { BackgroundJob, BackgroundPage, InboxDetail, InboxItem, InformationRule } from '../src/contracts/background.js';
import type { WorkAction, WorkDetail, WorkPrepareInput, WorkReceipt } from '../src/contracts/collaboration.js';
import type { ContextPage, ContextQueryResult, InformationDetail, InformationReportIndex } from '../src/contracts/context.js';
import type { SessionSnapshot, Workspace } from '../src/contracts/index.js';
import type { ScenarioAction, ScenarioDefinitions, ScenarioInstance, ScenarioInstances, ScenarioMutationResult, ScenarioTaskInitialization } from '../src/contracts/scenarios.js';
import type { TaskInformationPage, TaskLinksView, TaskSuggestionCreateResult } from '../src/contracts/task-information.js';
import type { ContextConfig } from '../src/context/config.js';
import type { TaskQueryItem } from '../src/context/task-query.js';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { createMockContextServer } from '../scripts/mock-context/server.js';
import type { NotificationTarget } from '../scripts/mock-context/control-api.js';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const directorSeat = 'seat-director', overallSeat = 'seat-overall', intelSeat = 'seat-intelligence';
const env = {
  QUERY_TOKEN: 'business-flow-test-query-token', CONTROL_TOKEN: 'business-flow-test-control-token',
  INTEL_TOKEN: 'business-flow-test-intel-source-token', SITUATION_TOKEN: 'business-flow-test-situation-source-token',
};

async function login(app: FastifyInstance, seatId: string) {
  const boot = await app.inject('/api/auth/session');
  const response = await app.inject({ method: 'POST', url: '/api/auth/login',
    headers: { cookie: boot.cookies.map(c => `${c.name}=${c.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': boot.json<AuthSession>().csrf! },
    payload: { seatId, password: 'business-flow-test-password' } });
  expect(response.statusCode, response.body).toBe(200);
  const auth = response.json<AuthSession>();
  const headers = { cookie: response.cookies.map(c => `${c.name}=${c.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': auth.csrf!, 'x-axon-view': auth.viewId! };
  return { auth, call: (url: string, payload?: object) => app.inject({ url, method: payload === undefined ? 'GET' : 'POST', headers, ...(payload === undefined ? {} : { payload }) }) };
}
type Client = Awaited<ReturnType<typeof login>>;
async function json<T>(request: ReturnType<Client['call']>, status = 200) {
  const response = await request; expect(response.statusCode, response.body).toBe(status); return response.json<T>();
}

function toolResult<T>(context: Context, toolName: string): T {
  const message = context.messages.findLast(message => message.role === 'toolResult' && message.toolName === toolName);
  if (!message || message.role !== 'toolResult' || message.isError) throw new Error(`Missing successful native tool result: ${toolName}`);
  const text = message.content.find(block => block.type === 'text');
  if (text?.type !== 'text') throw new Error(`Missing native tool text: ${toolName}`);
  return JSON.parse(text.text) as T;
}
const sameRef = (a: { systemId: string; objectType: string; objectId: string }, b: { systemId: string; objectType: string; objectId: string }) =>
  a.systemId === b.systemId && a.objectType === b.objectType && a.objectId === b.objectId;

/** Only the provider is fake: queries, observed-task checks, Pi history and business commits are real. */
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'axon-scenario-business-flow-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const targets: NotificationTarget[] = [], sourcePath = join(directory, 'source.sqlite');
  const source = createMockContextServer({ token: env.QUERY_TOKEN, controlToken: env.CONTROL_TOKEN, scenariosEnabled: true, databasePath: sourcePath, targets });
  const sourceUrl = await source.listen(); cleanup.push(() => source.close());
  const dataDir = join(directory, 'axon'), database = await openDatabase(dataDir), access = new AccessStore(database);
  for (const seatId of [directorSeat, overallSeat, intelSeat]) await access.saveAccount({ username: seatId, displayName: seatId,
    seatId, seatName: seatId, password: 'business-flow-test-password', createPublicTask: seatId !== intelSeat,
    manageModelSettings: false, controlScenarios: seatId === directorSeat });
  database.close();
  const config = testConfig(dataDir, { seatId: overallSeat, auth: { secret: 'business-flow-signing-secret-at-least-32', sessionMs: 28800000 } });
  let holdNext = false, holdRepair = false, heldCall: number | undefined;
  const fake = await fakeRuntime(config, (context, index) => {
    const last = context.messages.at(-1), preprocessing = context.tools?.some(tool => tool.name === 'information_record_task_assessment');
    if (!preprocessing) {
      if (last?.role === 'user') return { tools: [{ name: 'task_search', arguments: {} }] };
      if (last?.role === 'toolResult' && last.toolName === 'task_search') return { tools: [{ name: 'situation_query', arguments: { systemId: 'situation', mode: 'current', limit: 1 } }] };
      return { text: '已依据本任务与当前来源核对事实。' };
    }
    if (last?.role === 'user') {
      if (holdNext || holdRepair && JSON.stringify(last).includes('[系统补做提示')) { holdNext = false; holdRepair = false; heldCall = index; return { waitForAbort: true }; }
      return { tools: [{ name: 'information_search', arguments: { systemId: 'intel', limit: 100 } }] };
    }
    if (last?.role !== 'toolResult') throw new Error('Expected the native Pi tool loop');
    switch (last.toolName) {
      case 'information_search': {
        const reports = toolResult<ContextQueryResult & { data: ContextPage<InformationReportIndex> }>(context, 'information_search').data.items;
        const input = JSON.stringify(context.messages.findLast(message => message.role === 'user'));
        const report = reports.find(item => input.includes(item.title));
        if (!report) throw new Error('Incoming notification must resolve to an actual source report');
        return { tools: [{ name: 'information_read', arguments: { systemId: 'intel', reportId: report.reportId, revision: report.revision } }] };
      }
      case 'information_read': return { tools: [{ name: 'situation_query', arguments: { systemId: 'situation', mode: 'current', limit: 100 } }] };
      case 'situation_query': return { tools: [{ name: 'task_search', arguments: {} }] };
      case 'task_search': {
        if (holdRepair) return {text: '任务判断已记录（本测试故意省略调用）'};
        const report = toolResult<{ data: InformationDetail }>(context, 'information_read').data.item;
        const candidates = toolResult<{ data: { items: TaskQueryItem[] } }>(context, 'task_search').data.items;
        const relevant = candidates.find(task => task.context?.businessRefs?.some(ref => report.objectRefs.some(other => sameRef(ref, other))));
        return relevant ? { tools: [{ name: 'task_read', arguments: { taskId: relevant.id } }] }
          : { tools: [{ name: 'information_record_task_assessment', arguments: { relations: [], emptyReason: '已查询当轮活动任务，现有任务没有承接这条来报的业务对象；由人员决定是否另立任务。' } }] };
      }
      case 'task_read': {
        const task = toolResult<{ data: { item: TaskQueryItem } }>(context, 'task_read').data.item;
        return { tools: [{ name: 'information_record_task_assessment', arguments: { relations: [{ taskId: task.id, reason: '已核对报告与该任务的实际来源对象引用一致，作为办理事实补充。' }] } }] };
      }
      case 'information_record_task_assessment': return { text: '已读取原始报告、当前态势及当轮任务；位置与资源仍以各条来源事实和业务时间为准，后续办理由人员确认。' };
      default: throw new Error(`Unexpected tool: ${last.toolName}`);
    }
  });
  const background = parseBackgroundConfig({ enabled: true, concurrency: 1, modelConcurrency: 1,
    sources: [
      { sourceId: 'scene-intel', systemId: 'intel', name: '特情来源', credentialRef: 'INTEL_TOKEN', allowedProfileIds: ['analysis'], allowedRecipientSeatIds: [overallSeat] },
      { sourceId: 'scene-situation', systemId: 'situation', name: '态势来源', credentialRef: 'SITUATION_TOKEN', allowedProfileIds: ['analysis'], allowedRecipientSeatIds: [overallSeat] },
    ], profiles: [{ id: 'analysis', name: '来报初析', requireTaskAssessment: true, goal: '核对实际报告、对象、业务时间与已有任务，将分析投递总体席。',
      tools: ['information_search', 'information_read', 'situation_query', 'task_search', 'task_read', 'information_record_task_assessment'], contextScopeId: 'scene' }] });
  const context: ContextConfig = { systems: [
    { id: 'intel', name: '特情', adapter: 'mock-information-http', baseUrl: `${sourceUrl}/intel`, tokenEnv: 'QUERY_TOKEN', scenarioClock: true },
    { id: 'situation', name: '态势', adapter: 'mock-situation-http', baseUrl: `${sourceUrl}/situation`, tokenEnv: 'QUERY_TOKEN', scenarioClock: true },
  ], scopes: [{ id: 'scene', name: '双系统资料', systemIds: ['intel', 'situation'], seatIds: [directorSeat, overallSeat, intelSeat] }],
  simulation: { enabled: true, baseUrl: sourceUrl, tokenEnv: 'CONTROL_TOKEN', directorSeatId: directorSeat,
    sources: [{ systemId: 'intel', sourceId: 'scene-intel' }, { systemId: 'situation', sourceId: 'scene-situation' }] } };
  let creationGate: (() => Promise<void>) | undefined;
  async function openHost() {
    const lab = await PiLab.create(config, fake.runtime), app = await createApp(lab, false, { config: background, env }, { config: context, env });
    app.addHook('preHandler', async request => {
      if (request.method === 'POST' && /^\/api\/information\/events\/[^/]+\/tasks$/.test(request.url)) await creationGate?.();
    });
    const appUrl = await app.listen({ host: '127.0.0.1', port: 0 });
    targets.splice(0, targets.length, { systemId: 'intel', sourceId: 'scene-intel', url: appUrl, token: env.INTEL_TOKEN },
      { systemId: 'situation', sourceId: 'scene-situation', url: appUrl, token: env.SITUATION_TOKEN });
    const store = new BackgroundStore(lab.access!.db);
    return { lab, app, appUrl, store, director: await login(app, directorSeat), overall: await login(app, overallSeat), intel: await login(app, intelSeat) };
  }
  let host = await openHost();
  cleanup.push(async () => { await host.app.close(); });
  for (const sourceId of ['scene-intel', 'scene-situation']) {
    host.store.grant('seat', overallSeat, sourceId, 'manage'); host.store.grant('seat', directorSeat, sourceId, 'view');
    await json<InformationRule>(host.overall.call('/api/information/rules', { clientActionId: randomUUID(), sourceId, profileId: 'analysis',
      name: `${sourceId}普通初析`, recipientSeatIds: [overallSeat], enabled: true }));
  }
  async function create() {
    const definition = (await json<ScenarioDefinitions>(host.director.call('/api/simulation/scenarios'))).items.find(item => item.version === '4')!;
    expect(definition.version).toBe('4');
    const result = await json<ScenarioMutationResult>(host.director.call('/api/simulation/instances', { definitionId: definition.id, version: definition.version, mode: 'source_replay', clientActionId: randomUUID() }));
    const tasks = await json<ScenarioTaskInitialization>(host.director.call(`/api/simulation/instances/${result.instance.instanceId}/initialize`, { clientActionId: randomUUID() }));
    expect(tasks.initialized).toBe(true); expect(tasks.tasks.map(task => task.code)).toEqual(['T02', 'T03']);
    expect(tasks.taskBootstrap).toEqual({ schemaVersion: 2, definitionId: definition.id, definitionVersion: '4',
      definitionHash: definition.definitionHash, expectedTaskCodes: ['T02', 'T03'] });
    return { result, tasks };
  }
  async function activate(created: ScenarioMutationResult) {
    const list = await json<ScenarioInstances>(host.director.call('/api/simulation/instances'));
    return json<ScenarioMutationResult>(host.director.call(`/api/simulation/instances/${created.instance.instanceId}/activate`, {
      clientActionId: randomUUID(), expectedRevision: created.instance.revision, expectedActiveRevision: list.activeRevision }));
  }
  async function apply(instance: ScenarioInstance, step: string) {
    return json<ScenarioMutationResult>(host.director.call(`/api/simulation/instances/${instance.instanceId}/steps/${step}`, { clientActionId: randomUUID(), expectedRevision: instance.revision }));
  }
  async function pause(instance: ScenarioInstance) {
    return json<ScenarioMutationResult>(host.director.call(`/api/simulation/instances/${instance.instanceId}/control`, { clientActionId: randomUUID(), expectedRevision: instance.revision, action: 'pause' }));
  }
  async function send(action: ScenarioAction) {
    return json<ScenarioAction>(host.director.call(`/api/simulation/actions/${action.id}/send`, {}));
  }
  async function completed(action: ScenarioAction) {
    const sent = await send(action), event = host.store.getEvent(sent.receipt!.eventId);
    expect(event.initialJobId).toBeDefined();
    await vi.waitFor(() => expect(['queued', 'running']).not.toContain(host.store.getJob(event.initialJobId!).status), { timeout: 10000, interval: 20 });
    const job = host.store.getJob(event.initialJobId!);
    expect(job.status, JSON.stringify(job.error)).toBe('succeeded');
    await vi.waitFor(() => expect(host.store.listDeliveries(job.id)).toEqual([expect.objectContaining({ recipientSeatId: overallSeat, status: 'delivered' })]));
    return { sent, event, job };
  }
  async function native(job: BackgroundJob) {
    const directory = join(dataDir, 'background', 'jobs', job.id), profile = job.ruleSnapshot!.profile;
    return host.lab.readPreprocess({ jobId: job.id, sessionId: job.sessionId!, directory,
      contextPrincipal: { kind: 'service', profileId: profile.id, jobId: job.id, scope: profile.contextScope!, scenarioInstanceId: job.scenarioInstanceId } });
  }
  async function nativeBytes(job: BackgroundJob) {
    const sessions = join(dataDir, 'background', 'jobs', job.id, 'sessions');
    const files = (await readdir(sessions)).filter(name => name.endsWith(`_${job.sessionId}.jsonl`));
    expect(files).toHaveLength(1); return readFile(join(sessions, files[0]), 'utf8');
  }
  async function work(actor: Client, input: WorkPrepareInput) {
    const action = await json<WorkAction>(actor.call('/api/work-items/prepare', { ...input, clientActionId: randomUUID() }));
    return json<WorkReceipt>(actor.call(`/api/work-actions/${action.operationId}/commit`, { confirm: true }));
  }
  return { get host() { return host; }, directory, dataDir, sourcePath, fake, create, activate, apply, pause, send, completed, native, nativeBytes, work,
    get heldCall() { return heldCall; }, holdNextAnalysis() { holdNext = true; }, holdNextRepair() { holdRepair = true; },
    holdTaskCreation() {
      let arrive!: () => void, release!: () => void;
      const reached = new Promise<void>(resolve => { arrive = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
      creationGate = async () => { creationGate = undefined; arrive(); await released; };
      return { reached, release };
    },
    async restartHost() { await host.app.close(); host = await openHost(); } };
}

describe('scenario business flow through authenticated HTTP, SQLite and native Pi', () => {
  it('starts with two background tasks, lets a human create from real analysis, collaborates and isolates the next run', async () => {
    const f = await setup(), a = await f.create(), active = await f.activate(a.result), aId = active.instance.instanceId;
    expect(await json<TaskSpace[]>(f.host.overall.call('/api/tasks'))).toHaveLength(2);
    expect(f.host.lab.workspaces.listAll()).toEqual([]); expect(f.fake.calls).toHaveLength(0);
    const first = await f.apply(active.instance, 'E01'), received = await f.completed(first.actions[0]);
    expect(received.event.scenarioInstanceId).toBe(aId); expect(received.job.scenarioInstanceId).toBe(aId);
    expect(received.job.taskAssessment).toMatchObject({ items: [], emptyReason: expect.any(String) });
    expect(received.job.taskAssessment?.newTaskSuggestion).toBeUndefined();
    expect(await json<TaskSpace[]>(f.host.overall.call('/api/tasks'))).toHaveLength(2);
    const firstNative = await f.native(received.job), firstBytes = await f.nativeBytes(received.job);
    const sourceReport = JSON.parse(firstNative.messages.find(message => message.toolName === 'information_read')!.text) as { data: InformationDetail };
    expect(sourceReport.data.snapshotClock?.instanceId).toBe(aId); expect(sourceReport.data.item.content).toContain('位置待核实');
    expect(firstNative.messages.filter(message => message.toolName && !message.isError).map(message => message.toolName)).toEqual(
      ['information_search', 'information_read', 'situation_query', 'task_search', 'information_record_task_assessment']);
    expect(firstBytes).toContain('information_record_task_assessment');
    const taskSearch = JSON.parse(firstNative.messages.find(message => message.toolName === 'task_search')!.text) as { data: { items: TaskQueryItem[] } };
    expect(taskSearch.data.items.map(task => task.id).sort()).toEqual(a.tasks.tasks.map(task => task.taskId).sort());
    const inbox = await json<BackgroundPage<InboxItem>>(f.host.overall.call('/api/inbox'));
    const delivered = inbox.items.find(item => item.job.id === received.job.id)!;
    const detail = await json<InboxDetail>(f.host.overall.call(`/api/inbox/${delivered.delivery.id}`));
    expect(detail.resultText).toContain('已读取原始报告');
    const linksUrl = `/api/information/events/${received.event.id}/task-links?jobId=${received.job.id}`;
    expect(await json<TaskLinksView>(f.host.overall.call(linksUrl))).toMatchObject({ canCreateTask: true, links: [] });
    const createUrl = `/api/information/events/${received.event.id}/tasks`, createBody = { jobId: received.job.id, clientActionId: randomUUID(),
      title: '仓储烟情事实核实', goal: '核实仓库位置、现时道路及可用资源，形成事实核实材料，由总体席决定后续办理。', reason: '总体席决定将独立的仓储来报立项核实。',
      context: { businessRefs: sourceReport.data.item.objectRefs, focus: { areaIds: sourceReport.data.item.areaIds } } };
    expect((await f.host.director.call(createUrl, createBody)).statusCode).toBe(403);
    expect((await f.host.intel.call(createUrl, createBody)).statusCode).toBe(404);
    f.host.store.grant('seat', intelSeat, 'scene-intel', 'view');
    expect((await f.host.intel.call(createUrl, createBody)).statusCode).toBe(403);
    f.host.store.revoke('seat', intelSeat, 'scene-intel');
    const created = await json<TaskSuggestionCreateResult>(f.host.overall.call(createUrl, createBody));
    expect(created.link).toMatchObject({ eventId: received.event.id, jobId: received.job.id, taskSpaceId: created.task.id, mode: 'include' });
    expect(f.host.lab.access!.get(created.task.id, overallSeat).scenarioInstanceId).toBe(aId);
    expect((await json<TaskSuggestionCreateResult>(f.host.overall.call(createUrl, createBody))).task.id).toBe(created.task.id);
    const jobsBeforeDuplicate = f.host.store.listJobs().length;
    expect((await f.send(first.actions[0])).receipt?.eventId).toBe(received.event.id);
    expect(f.host.store.listJobs()).toHaveLength(jobsBeforeDuplicate);
    const reprocess = await json<BackgroundJob>(f.host.overall.call(`/api/information/jobs/${received.job.id}/reprocess`, { clientActionId: randomUUID() }));
    await vi.waitFor(() => expect(f.host.store.getJob(reprocess.id).status).toBe('succeeded'), { timeout: 10000, interval: 20 });
    expect(f.host.store.getJob(reprocess.id).eventId).toBe(received.event.id); expect(reprocess.id).not.toBe(received.job.id);
    const reprocessedLinks = await json<TaskLinksView>(f.host.overall.call(`/api/information/events/${received.event.id}/task-links?jobId=${reprocess.id}`));
    expect(reprocessedLinks).toMatchObject({ canCreateTask: false, creation: { taskSpaceId: created.task.id } });
    expect((await json<TaskSuggestionCreateResult>(f.host.overall.call(createUrl, { ...createBody, jobId: reprocess.id, clientActionId: randomUUID() }))).task.id).toBe(created.task.id);
    expect(await json<TaskSpace[]>(f.host.overall.call('/api/tasks'))).toHaveLength(3);
    const second = await f.apply(first.instance, 'E02'); await f.completed(second.actions[0]);
    const third = await f.apply(second.instance, 'E03'); await f.completed(third.actions[0]);
    const fourth = await f.apply(third.instance, 'E04'), followup = await f.completed(fourth.actions[0]); await f.completed(fourth.actions[1]);
    expect(followup.job.taskAssessment?.items.map(item => item.taskSpaceId)).toEqual([created.task.id]);
    const followupNative = await f.native(followup.job);
    expect(followupNative.messages.find(message => message.toolName === 'task_read')).toMatchObject({ isError: false });
    expect(JSON.parse(followupNative.messages.find(message => message.toolName === 'information_record_task_assessment')!.text)).toMatchObject({ status: 'recorded' });
    const fifth = await f.apply(fourth.instance, 'E05'); await f.completed(fifth.actions[0]);
    const sixth = await f.apply(fifth.instance, 'E06'), situationNotice = await f.completed(sixth.actions[0]);
    expect(situationNotice.event.sourceId).toBe('scene-situation'); expect(situationNotice.job.ruleSnapshot?.rule.recipientSeatIds).toEqual([overallSeat]);
    const related = await json<TaskInformationPage>(f.host.overall.call(`/api/tasks/${created.task.id}/information`));
    expect(related.items).toEqual(expect.arrayContaining([expect.objectContaining({ eventId: received.event.id, jobId: received.job.id, mode: 'include' }), expect.objectContaining({ eventId: followup.event.id, jobId: followup.job.id, mode: 'auto' })]));
    // A public task association does not grant the receiving business seat source access.
    expect((await json<TaskInformationPage>(f.host.intel.call(`/api/tasks/${created.task.id}/information`))).items).toEqual([]);
    expect((await f.host.intel.call(`/api/information/events/${followup.event.id}/task-links?jobId=${followup.job.id}`)).statusCode).toBe(404);
    f.host.store.grant('seat', intelSeat, 'scene-intel', 'view');
    expect((await json<TaskInformationPage>(f.host.intel.call(`/api/tasks/${created.task.id}/information`))).items.length).toBeGreaterThan(0);
    const sender = await json<Workspace>(f.host.overall.call(`/api/tasks/${created.task.id}/workspace`, {}));
    await writeFile(join(f.host.lab.files.filesDirectory(sender.id, overallSeat), '核实要求.md'), '# 请核实位置与现时道路\n不代表车辆已经出动。');
    const assigned = await f.work(f.host.overall, { kind: 'assign', taskSpaceId: created.task.id, payload: { workspaceId: sender.id, assigneeSeatId: intelSeat, title: '核实仓库事实', goal: '依据来报核实仓库位置与当前道路，提交核实记录。', inputPaths: ['核实要求.md'] } });
    expect(assigned.state).toBe('assigned');
    const claimed = await f.work(f.host.intel, { kind: 'claim', workItemId: assigned.workItemId, expectedRevision: assigned.revision, payload: {} });
    expect(claimed.state).toBe('working');
    const receiver = await json<Workspace>(f.host.intel.call(`/api/tasks/${created.task.id}/workspace`, {}));
    const inputFile = (await json<WorkDetail>(f.host.intel.call(`/api/work-items/${assigned.workItemId}`))).inputFiles[0];
    const workSession = await json<SessionSnapshot>(f.host.intel.call('/api/sessions', { workspaceId: receiver.id, workItemId: assigned.workItemId }));
    expect(await readFile(join(f.host.lab.files.filesDirectory(receiver.id, intelSeat), '收到资料', assigned.workItemId, inputFile.fileId, inputFile.name), 'utf8')).toContain('不代表车辆已经出动');
    await writeFile(join(f.host.lab.files.filesDirectory(receiver.id, intelSeat), '核实记录.md'), '# 核实记录\n园区值班员与无人机均确认三号仓库，车辆未派出。');
    const submitted = await f.work(f.host.intel, { kind: 'submit', workItemId: assigned.workItemId, expectedRevision: claimed.revision, payload: { workspaceId: receiver.id, path: '核实记录.md' } });
    expect(submitted.state).toBe('submitted');
    await writeFile(join(f.host.lab.files.filesDirectory(receiver.id, intelSeat), '核实记录.md'), '# 后续尚未提交的改动');
    expect((await f.host.overall.call(`/api/handoff-files/${(await json<WorkDetail>(f.host.overall.call(`/api/work-items/${assigned.workItemId}`))).submissions[0].file.fileId}?preview=1`)).body).toContain('车辆未派出');
    const reviewed = await f.work(f.host.overall, { kind: 'review', workItemId: assigned.workItemId, expectedRevision: submitted.revision, payload: { submissionId: submitted.submissionId!, decision: 'accept' } });
    expect(reviewed.state).toBe('completed');
    const nativeSession = await json<SessionSnapshot>(f.host.overall.call('/api/sessions', { workspaceId: sender.id }));
    await f.host.lab.start(nativeSession.id, '核对本任务的当前事实。', {}, overallSeat).run(() => {});
    const savedConversation = f.host.lab.get(nativeSession.id, overallSeat), beforeCalls = f.fake.calls.length;
    const backgroundTask = a.tasks.tasks.find(task => task.code === 'T02')!, backgroundWorkspace = await json<Workspace>(f.host.overall.call(`/api/tasks/${backgroundTask.taskId}/workspace`, {}));
    const unfinished = await f.work(f.host.overall, { kind: 'assign', taskSpaceId: backgroundTask.taskId, payload: { workspaceId: backgroundWorkspace.id, assigneeSeatId: intelSeat, title: '继续核对占用状态', goal: '等待实际释放回报，不能提前记为完成。', inputPaths: [] } });
    const staleClaim = await json<WorkAction>(f.host.intel.call('/api/work-items/prepare', { kind: 'claim', workItemId: unfinished.workItemId, expectedRevision: unfinished.revision, payload: {}, clientActionId: randomUUID() }));
    await f.pause(sixth.instance); const b = await f.create(), enabledB = await f.activate(b.result), bId = enabledB.instance.instanceId;
    expect(await json<TaskSpace>(f.host.overall.call(`/api/tasks/${created.task.id}`))).toMatchObject({ state: 'archived', readOnly: true });
    expect(await json<TaskSpace>(f.host.overall.call(`/api/tasks/${backgroundTask.taskId}`))).toMatchObject({ state: 'active', readOnly: true });
    expect(await json<WorkDetail>(f.host.intel.call(`/api/work-items/${unfinished.workItemId}`))).toMatchObject({ state: 'assigned', readOnly: true });
    expect((await f.host.intel.call(`/api/work-actions/${staleClaim.operationId}/commit`, { confirm: true })).statusCode).toBe(409);
    expect((await f.host.overall.call(createUrl, createBody)).statusCode).toBe(409);
    expect((await f.host.overall.call(`/api/sessions/${nativeSession.id}/messages`, { text: '旧页面继续办理' })).statusCode).toBe(409);
    expect(f.host.lab.get(nativeSession.id, overallSeat).messages).toEqual(savedConversation.messages);
    expect(f.host.lab.get(workSession.id, intelSeat).messages).toEqual([]); expect(f.fake.calls).toHaveLength(beforeCalls);
    expect((await json<TaskSpace[]>(f.host.overall.call('/api/tasks'))).map(task => task.id).sort()).toEqual(b.tasks.tasks.map(task => task.taskId).sort());
    expect((await f.host.overall.call('/api/inbox')).body).not.toContain(received.event.id);
    const bFirst = await f.apply(enabledB.instance, 'E01'), bReceived = await f.completed(bFirst.actions[0]), bBytes = await f.nativeBytes(bReceived.job);
    expect(bReceived.job.taskAssessment?.items).toEqual([]); expect(bReceived.job.sessionId).not.toBe(received.job.sessionId);
    for (const old of [aId, created.task.id, backgroundTask.taskId, received.event.id, received.job.id, nativeSession.id, assigned.workItemId]) {
      expect(bBytes).not.toContain(old); expect(JSON.stringify(f.fake.calls.slice(beforeCalls).map(call => call.context.messages))).not.toContain(old);
    }
    expect(bBytes).toContain(bId); expect(await f.nativeBytes(received.job)).toBe(firstBytes);
    const sourceDb = new DatabaseSync(f.sourcePath);
    try { expect(JSON.parse(String(sourceDb.prepare('SELECT body FROM scenario_instances WHERE instance_id=?').get(aId)!.body)).instance.status).toBe('frozen'); }
    finally { sourceDb.close(); }
    await f.restartHost();
    expect(f.host.lab.scenario!.activeId()).toBe(bId); expect(await f.nativeBytes(received.job)).toBe(firstBytes);
    expect(await json<TaskSpace>(f.host.overall.call(`/api/tasks/${created.task.id}`))).toMatchObject({ state: 'archived', readOnly: true });
    expect(await json<WorkDetail>(f.host.overall.call(`/api/work-items/${unfinished.workItemId}`))).toMatchObject({ state: 'assigned', readOnly: true });
    expect((await json<WorkDetail>(f.host.overall.call(`/api/work-items/${assigned.workItemId}`))).submissions).toHaveLength(1);
    expect(await json<ScenarioTaskInitialization>(f.host.director.call(`/api/simulation/instances/${bId}/initialize`))).toMatchObject({ initialized: true, tasks: b.tasks.tasks });
  }, 60000);

  it('rejects an already submitted A creation after B activates without guessing a new owner', async () => {
    const f = await setup(), a = await f.create(), active = await f.activate(a.result);
    const step = await f.apply(active.instance, 'E01'), received = await f.completed(step.actions[0]);
    const nativeBefore = await f.nativeBytes(received.job), gate = f.holdTaskCreation();
    const body = { jobId: received.job.id, clientActionId: randomUUID(), title: '切换前提交的核实任务', goal: '核实原来报中的仓储事实。', reason: '由总体席确认原来报需要独立核实。' };
    const submitted = f.host.overall.call(`/api/information/events/${received.event.id}/tasks`, body).then(response => response);
    try {
      await gate.reached;
      await f.pause(step.instance); const b = await f.create(), enabledB = await f.activate(b.result);
      expect(f.host.lab.scenario!.activeId()).toBe(enabledB.instance.instanceId);
      expect((await json<TaskSpace[]>(f.host.overall.call('/api/tasks'))).map(task => task.id).sort()).toEqual(b.tasks.tasks.map(task => task.taskId).sort());
      expect(await json<ScenarioTaskInitialization>(f.host.director.call(`/api/simulation/instances/${a.result.instance.instanceId}/initialize`))).toEqual(a.tasks);
      expect(await json<ScenarioTaskInitialization>(f.host.director.call(`/api/simulation/instances/${b.result.instance.instanceId}/initialize`))).toEqual(b.tasks);
    } finally { gate.release(); }
    const rejected = await submitted;
    expect(rejected.statusCode, rejected.body).toBe(409);
    expect(f.host.store.getJob(received.job.id).taskSuggestionCreation).toBeUndefined();
    expect(f.host.lab.access!.db.prepare('SELECT 1 FROM task_actions WHERE action_id=?').get(body.clientActionId)).toBeUndefined();
    expect(f.host.lab.access!.db.prepare('SELECT count(*) n FROM task_spaces').get()?.n).toBe(4);
    expect(f.host.store.getEvent(received.event.id)).toMatchObject({ scenarioInstanceId: a.result.instance.instanceId, payloadHash: received.event.payloadHash });
    expect(await f.nativeBytes(received.job)).toBe(nativeBefore);
  }, 30000);

  it('ends A during a native completion repair without delivering or carrying the follow-up into B', async () => {
    const f = await setup(), a = await f.create(), active = await f.activate(a.result);
    f.holdNextRepair(); const step = await f.apply(active.instance, 'E01'), sent = await f.send(step.actions[0]);
    await vi.waitFor(() => expect(f.heldCall).toBeDefined());
    const event = f.host.store.getEvent(sent.receipt!.eventId), job = f.host.store.getJob(event.initialJobId!);
    expect((await f.native(job)).messages.filter(m => m.role === 'user' && m.text.startsWith('[系统补做提示'))).toHaveLength(1);
    await f.pause(step.instance); const b = await f.create(), activeB = await f.activate(b.result);
    expect(f.fake.calls[f.heldCall!].aborted).toBe(true); expect(f.host.store.getJob(job.id).status).toBe('cancelled');
    expect(f.host.store.listDeliveries(job.id)).toEqual([]);
    const before = f.fake.calls.length, old = await f.nativeBytes(job);
    const next = await f.apply(activeB.instance, 'E01'), received = await f.completed(next.actions[0]);
    expect(received.job.scenarioInstanceId).toBe(b.result.instance.instanceId);
    expect(JSON.stringify(f.fake.calls.slice(before).map(call => call.context.messages))).not.toContain('[系统补做提示');
    expect(await f.nativeBytes(job)).toBe(old);
  }, 30000);

  it('cancels an actual in-flight native analysis before B and preserves its A history without delivery', async () => {
    const f = await setup(), a = await f.create(), active = await f.activate(a.result);
    f.holdNextAnalysis(); const step = await f.apply(active.instance, 'E01'), sent = await f.send(step.actions[0]);
    await vi.waitFor(() => expect(f.heldCall).toBeDefined());
    const event = f.host.store.getEvent(sent.receipt!.eventId), job = f.host.store.getJob(event.initialJobId!);
    expect(job.status).toBe('running'); await f.pause(step.instance); const b = await f.create(), enabledB = await f.activate(b.result);
    expect(f.fake.calls[f.heldCall!].aborted).toBe(true); expect(f.host.store.getJob(job.id).status).toBe('cancelled');
    expect(f.host.store.listDeliveries(job.id).every(delivery => delivery.status !== 'delivered')).toBe(true);
    expect((await f.native(job)).lastResult?.status).toBe('cancelled');
    const oldBytes = await f.nativeBytes(job), beforeCalls = f.fake.calls.length;
    const bStep = await f.apply(enabledB.instance, 'E01'), receivedB = await f.completed(bStep.actions[0]);
    expect(receivedB.job.scenarioInstanceId).toBe(b.result.instance.instanceId);
    expect(receivedB.job.sessionId).not.toBe(job.sessionId);
    expect(JSON.stringify(f.fake.calls.slice(beforeCalls).map(call => call.context.messages))).not.toContain(a.result.instance.instanceId);
    expect((await f.host.overall.call('/api/information/events')).body).not.toContain(event.id);
    expect(await f.nativeBytes(job)).toBe(oldBytes);
  }, 30000);
});
