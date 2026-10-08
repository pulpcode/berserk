import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessStore } from '../src/access/store.js';
import { openDatabase } from '../src/access/database.js';
import { parseBackgroundConfig } from '../src/background/config.js';
import { BackgroundStore } from '../src/background/store.js';
import type { AuthSession, TaskSpace } from '../src/contracts/access.js';
import type { BackgroundAction, BackgroundEventDetail, BackgroundJob, BackgroundPage, BackgroundReceipt, InboxDetail, InboxItem, InformationCapabilities, InformationJobDetail, InformationRule } from '../src/contracts/background.js';
import type { ContextConfig } from '../src/context/config.js';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { createMockContextServer } from '../scripts/mock-context/server.js';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';

// The provider is deterministic; HTTP queries, Pi loops/history, SQLite and file copies are real.
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const env = {INTEL_SOURCE_TOKEN: 'test-intel-source-token-at-least-24', LEGACY_SOURCE_TOKEN: 'test-legacy-source-token-at-least-24', CONTEXT_TOKEN: 'test-query-only-secret'};
const privateMarkers = ['RESTRICTED_INPUT_TITLE', 'RESTRICTED_MESSAGE_ID', 'RESTRICTED_INPUT_BODY', 'restricted-input.txt', 'RESTRICTED_FILE_BODY', 'PROVIDER_ANALYSIS_RESULT', 'PRIVATE_PROFILE_INSTRUCTIONS', 'PRIVATE_PROFILE_RESOURCE'];

async function login(app: FastifyInstance, username: string) {
  const boot = await app.inject('/api/auth/session');
  const response = await app.inject({method: 'POST', url: '/api/auth/login', headers: {
    cookie: boot.cookies.map(c => `${c.name}=${c.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': boot.json<AuthSession>().csrf!,
  }, payload: {username, password: 'test-password-123'}});
  expect(response.statusCode, response.body).toBe(200);
  const auth = response.json<AuthSession>();
  const headers = {cookie: response.cookies.map(c => `${c.name}=${c.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': auth.csrf!, 'x-axon-view': auth.viewId!};
  return {auth, call: (url: string, payload?: object, method: 'POST' | 'PUT' = 'POST') => app.inject({url, method: payload === undefined ? 'GET' : method, headers, ...(payload === undefined ? {} : {payload})})};
}
type Client = Awaited<ReturnType<typeof login>>;

async function setup(contextFailure?: 'missing-scope' | 'missing-context' | 'unspecified-scope') {
  const dir = await mkdtemp(join(tmpdir(), 'axon-context-background-'));
  cleanup.push(() => rm(dir, {recursive: true, force: true}));
  const mock = createMockContextServer({token: env.CONTEXT_TOKEN});
  const baseUrl = await mock.listen(); cleanup.push(() => mock.close()); mock.advance('intel');
  const db = await openDatabase(dir); const access = new AccessStore(db);
  for (const name of ['a', 'b', 'c']) await access.saveAccount({username: name, displayName: name, seatId: name, seatName: `席位 ${name}`, password: 'test-password-123', createPublicTask: true, manageModelSettings: name === 'a'});
  db.close();
  const config = testConfig(dir, {seatId: 'a', auth: {secret: 'test-context-background-at-least-32-characters', sessionMs: 28800000}});
  const fake = await fakeRuntime(config, context => {
    if (context.messages.at(-1)?.role === 'user' && context.tools?.some(tool => tool.name === 'information_read')) return {tools: [
      {name: 'information_read', arguments: {systemId: 'intel', reportId: 'report-west-01', revision: 2}},
      {name: 'situation_query', arguments: {systemId: 'situation', mode: 'current', objectRefs: [{systemId: 'situation', objectType: 'resource', objectId: 'vehicles-west-01'}]}},
      {name: 'task_search', arguments: {}},
    ]};
    return {text: 'PROVIDER_ANALYSIS_RESULT'};
  });
  const lab = await PiLab.create(config, fake.runtime);
  const background = parseBackgroundConfig({enabled: true, concurrency: 1, modelConcurrency: 1,
    sources: [
      {sourceId: 'intel-source', systemId: 'intel', name: '特情来源', credentialRef: 'INTEL_SOURCE_TOKEN', allowedProfileIds: ['analysis'], allowedRecipientSeatIds: ['a', 'b', 'c']},
      {sourceId: 'legacy-source', name: '旧来源', credentialRef: 'LEGACY_SOURCE_TOKEN', allowedProfileIds: ['legacy'], allowedRecipientSeatIds: ['a', 'b', 'c']},
    ],
    profiles: [
      {id: 'analysis', name: '综合研判', goal: '查询实际来源及任务资料', contextScopeId: 'demo-context', tools: ['information_read', 'situation_query', 'task_search'], instructions: 'PRIVATE_PROFILE_INSTRUCTIONS', resources: [{id: 'internal', title: '服务资料', content: 'PRIVATE_PROFILE_RESOURCE'}]},
      {id: 'legacy', name: '旧方案', goal: '旧方式处理', tools: ['source_read']},
    ],
  });
  const contextConfig: ContextConfig = {
    systems: [
      {id: 'intel', name: '特情系统', adapter: 'mock-information-http', baseUrl: `${baseUrl}/intel`, tokenEnv: 'CONTEXT_TOKEN'},
      {id: 'situation', name: '态势系统', adapter: 'mock-situation-http', baseUrl: `${baseUrl}/situation`, tokenEnv: 'CONTEXT_TOKEN'},
    ], scopes: [{id: 'demo-context', name: '共同资料', systemIds: ['intel', 'situation'], seatIds: ['a', 'b']}],
  };
  if (contextFailure === 'missing-scope') background.profiles[0].contextScopeId = 'missing-scope';
  if (contextFailure === 'unspecified-scope') delete background.profiles[0].contextScopeId;
  const app = await createApp(lab, false, {config: background, env}, {config: contextConfig, env: contextFailure === 'missing-context' ? {} : env}); cleanup.push(() => app.close());
  const store = new BackgroundStore(lab.access!.db);
  for (const source of background.sources) for (const seat of ['a', 'c']) store.grant('seat', seat, source.sourceId, 'manage');
  const source = (path: string, payload: object, sourceId = 'intel-source') => app.inject({method: 'POST', url: `/api/integrations/${sourceId}/${path}`, headers: {authorization: `Bearer ${sourceId === 'intel-source' ? env.INTEL_SOURCE_TOKEN : env.LEGACY_SOURCE_TOKEN}`}, payload});
  const a = await login(app, 'a'), b = await login(app, 'b'), c = await login(app, 'c');
  return {dir, app, lab, store, mock, fake, source, background, a, b, c};
}
type Fixture = Awaited<ReturnType<typeof setup>>;

async function rule(actor: Client, legacy = false, recipients = ['a', 'b']) {
  const result = await actor.call('/api/information/rules', {clientActionId: randomUUID(), sourceId: legacy ? 'legacy-source' : 'intel-source', profileId: legacy ? 'legacy' : 'analysis', name: '处理规则', recipientSeatIds: recipients, enabled: true});
  expect(result.statusCode, result.body).toBe(200); return result.json<InformationRule>();
}
async function task(actor: Client, visibility: 'public' | 'private' = 'private') {
  const result = await actor.call('/api/tasks', {clientActionId: randomUUID(), title: `${visibility} 任务`, goal: visibility === 'public' ? 'PUBLIC_TASK_GOAL' : 'PRIVATE_TASK_GOAL', visibility});
  expect(result.statusCode, result.body).toBe(200); return result.json<TaskSpace>();
}
async function upload(f: Fixture) {
  const created = await f.source('uploads', {name: 'restricted-input.txt', size: Buffer.byteLength('RESTRICTED_FILE_BODY')});
  expect(created.statusCode, created.body).toBe(201); const {uploadId} = created.json<{uploadId: string}>();
  const received = await f.app.inject({method: 'PUT', url: `/api/integrations/intel-source/uploads/${uploadId}/content`, headers: {authorization: `Bearer ${env.INTEL_SOURCE_TOKEN}`, 'content-type': 'application/octet-stream'}, payload: Buffer.from('RESTRICTED_FILE_BODY')});
  expect(received.statusCode, received.body).toBe(200); return uploadId;
}
async function accept(f: Fixture, uploadIds: string[] = [], legacy = false) {
  const response = await f.source('events', {sourceMessageId: 'RESTRICTED_MESSAGE_ID', title: 'RESTRICTED_INPUT_TITLE', text: 'RESTRICTED_INPUT_BODY', subjectId: 'report-west-01', occurredAt: '2026-10-01T09:20:00+08:00', uploadIds}, legacy ? 'legacy-source' : 'intel-source');
  expect(response.statusCode, response.body).toBe(202); const receipt = response.json<BackgroundReceipt>();
  return f.store.getEvent(receipt.eventId);
}
async function settled(f: Fixture, id: string) {
  await vi.waitFor(() => expect(['queued', 'running']).not.toContain(f.store.getJob(id).status), {timeout: 10000, interval: 20});
  const job = f.store.getJob(id); expect(job.status, JSON.stringify(job.error)).toBe('succeeded');
  if (job.kind === 'preprocess') await vi.waitFor(() => expect(f.store.listDeliveries(job.id).every(item => item.status === 'delivered')).toBe(true));
  return job;
}

describe('background multi-source permission and evidence integration', () => {
  it('freezes source/scope at admission and returns actual HTTP and task-query evidence from native history', async () => {
    const f = await setup(); await rule(f.a); const pub = await task(f.a, 'public'); await task(f.a);
    f.store.setControl('queue', 0, false, f.a.auth.identity!.userId);
    const event = await accept(f);
    expect(event.systemId).toBe('intel');
    expect(event.ruleSnapshot?.profile.contextScope).toEqual({scopeId: 'demo-context', systemIds: ['intel', 'situation']});
    const queued = f.store.getJob(event.initialJobId!);
    expect(queued.status).toBe('queued'); expect(queued.ruleSnapshot?.profile.contextScope).toEqual(event.ruleSnapshot!.profile.contextScope);
    // Mutating the config object afterwards cannot rewrite the already accepted source/profile evidence.
    f.background.sources[0].systemId = 'changed-after-admission'; f.background.profiles[0].goal = 'CHANGED_AFTER_ADMISSION';
    expect(f.store.getEvent(event.id).systemId).toBe('intel');
    expect(f.store.getJob(queued.id).ruleSnapshot?.profile.goal).toBe('查询实际来源及任务资料');
    const start = await f.a.call('/api/information/queue', {revision: 1, enabled: true}, 'PUT'); expect(start.statusCode, start.body).toBe(200);
    const job = await settled(f, queued.id);
    expect(f.mock.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({method: 'GET', path: '/intel/reports/report-west-01?revision=2', status: 200}),
      expect.objectContaining({method: 'GET', status: 200}),
    ]));
    const callText = JSON.stringify(f.fake.calls[0].context.messages);
    expect(callText).toContain('intel-source'); expect(callText).toContain('report-west-01');
    expect(callText).toContain('2026-10-01T09:20:00+08:00'); expect(callText).not.toContain('CHANGED_AFTER_ADMISSION');
    const delivery = f.store.listDeliveries(job.id).find(item => item.recipientSeatId === 'b')!;
    const detailResponse = await f.b.call(`/api/inbox/${delivery.id}`); expect(detailResponse.statusCode, detailResponse.body).toBe(200);
    const detail = detailResponse.json<InboxDetail>();
    expect(detail.profileName).toBe('综合研判'); expect(detail.resultText).toBe('PROVIDER_ANALYSIS_RESULT');
    expect(detail.queryMessages?.map(message => message.toolName)).toEqual(['information_read', 'situation_query', 'task_search']);
    const report = JSON.parse(detail.queryMessages![0].text);
    expect(report).toMatchObject({systemId: 'intel', query: {reportId: 'report-west-01', revision: 2}, data: {item: {revision: 2, reportId: 'report-west-01'}}});
    expect(report.data.item.content).toContain('西区通道'); expect(report.queriedAt).toMatch(/^\d{4}-/);
    const tasks = JSON.parse(detail.queryMessages![2].text);
    expect(tasks.data.items.map((item: {id: string}) => item.id)).toEqual([pub.id]);
    expect(JSON.stringify(tasks)).toContain('PUBLIC_TASK_GOAL'); expect(JSON.stringify(tasks)).not.toContain('PRIVATE_TASK_GOAL');
    expect(detailResponse.body).not.toContain('PRIVATE_PROFILE_INSTRUCTIONS'); expect(detailResponse.body).not.toContain('PRIVATE_PROFILE_RESOURCE');
    const jobResponse = await f.a.call(`/api/information/jobs/${job.id}`);
    expect(jobResponse.statusCode, jobResponse.body).toBe(200);
    const jobDetail = jobResponse.json<InformationJobDetail>();
    expect(jobDetail.profileName).toBe('综合研判'); expect(jobDetail.snapshot?.messages.filter(message => message.role === 'tool')).toEqual(detail.queryMessages);
    expect(jobDetail.input?.text).toBe('RESTRICTED_INPUT_BODY');
    const callCount = f.fake.calls.length;
    await f.b.call(`/api/inbox/${delivery.id}`); await f.a.call(`/api/information/jobs/${job.id}`);
    expect(f.fake.calls).toHaveLength(callCount);

    expect(JSON.parse(detail.queryMessages![1].text).data.items).toEqual([
      expect.objectContaining({revision: 1, properties: {availableCount: 4, unit: '辆'}}),
    ]);
    f.mock.advance('situation');
    expect((await f.b.call(`/api/inbox/${delivery.id}`)).json<InboxDetail>().queryMessages).toEqual(detail.queryMessages);
    expect((await f.a.call(`/api/information/jobs/${job.id}`)).json<InformationJobDetail>().snapshot).toEqual(jobDetail.snapshot);
    expect(f.fake.calls).toHaveLength(callCount);
    const reprocess = await f.a.call(`/api/information/jobs/${job.id}/reprocess`, {clientActionId: randomUUID()});
    expect(reprocess.statusCode, reprocess.body).toBe(200);
    const next = await settled(f, reprocess.json<BackgroundJob>().id);
    expect(next.id).not.toBe(job.id); expect(next.retryOfJobId).toBe(job.id);
    const nextDelivery = f.store.listDeliveries(next.id).find(item => item.recipientSeatId === 'b')!;
    const nextDetail = (await f.b.call(`/api/inbox/${nextDelivery.id}`)).json<InboxDetail>();
    expect(JSON.parse(nextDetail.queryMessages![1].text).data.items).toEqual([
      expect.objectContaining({revision: 2, properties: {availableCount: 2, unit: '辆'}}),
    ]);
    expect((await f.b.call(`/api/inbox/${delivery.id}`)).json<InboxDetail>().queryMessages).toEqual(detail.queryMessages);
    expect((await f.a.call(`/api/information/jobs/${job.id}`)).json<InformationJobDetail>().snapshot).toEqual(jobDetail.snapshot);
  });

  it.each(['missing-scope', 'missing-context', 'unspecified-scope'] as const)('isolates %s configuration failures from legacy queue management and execution', async contextFailure => {
    const f = await setup(contextFailure);
    expect(Boolean(f.lab.context)).toBe(contextFailure !== 'missing-context');
    const access = await f.a.call('/api/information/access'); expect(access.statusCode, access.body).toBe(200);
    const capabilities = access.json<InformationCapabilities>();
    expect(capabilities.profiles.find(profile => profile.id === 'analysis')).toMatchObject({configurationError: expect.any(String)});
    expect(capabilities.profiles.find(profile => profile.id === 'analysis')?.contextScope).toBeUndefined();
    expect(capabilities.profiles.find(profile => profile.id === 'legacy')).toEqual({id: 'legacy', name: '旧方案', goal: '旧方式处理'});
    expect(capabilities.canManageQueue).toBe(true);
    for (const path of ['/api/information/sources', '/api/information/queue']) expect((await f.a.call(path)).statusCode).toBe(200);
    const stop = await f.a.call('/api/information/queue', {revision: 0, enabled: false}, 'PUT'); expect(stop.statusCode, stop.body).toBe(200);

    const invalidRule = {sourceId: 'intel-source', profileId: 'analysis', name: '配置缺失的规则', recipientSeatIds: ['a'], enabled: true};
    const errorStatus = contextFailure === 'missing-scope' ? 403 : 503;
    const actionId = randomUUID();
    const rejected = await f.a.call('/api/information/rules', {...invalidRule, clientActionId: actionId});
    expect(rejected.statusCode, rejected.body).toBe(errorStatus);
    expect(f.store.listRules()).toEqual([]); expect(f.store.findAction(f.a.auth.identity!.userId, actionId)).toBeUndefined();
    // A previously saved rule must also fail admission when its deployment configuration is unavailable.
    f.store.createRule(f.a.auth.identity!.userId, randomUUID(), invalidRule);
    const admission = await f.source('events', {sourceMessageId: 'invalid-scope-event', title: '新查询被拒绝', text: '查询业务资料'});
    expect(admission.statusCode, admission.body).toBe(errorStatus);
    expect(f.store.findEvent('intel-source', 'invalid-scope-event')).toBeUndefined();
    expect(f.store.listJobs()).toEqual([]); expect(f.fake.calls).toEqual([]); expect(f.mock.requests).toEqual([]);

    await rule(f.a, true, ['c']);
    const event = await accept(f, [], true);
    expect(f.store.getJob(event.initialJobId!).status).toBe('queued');
    const start = await f.a.call('/api/information/queue', {revision: stop.json().revision, enabled: true}, 'PUT');
    expect(start.statusCode, start.body).toBe(200);
    const job = await settled(f, event.initialJobId!);
    const delivery = f.store.listDeliveries(job.id)[0];
    const result = await f.c.call(`/api/inbox/${delivery.id}`); expect(result.statusCode, result.body).toBe(200);
    expect(result.json<InboxDetail>().resultText).toBe('PROVIDER_ANALYSIS_RESULT');
    expect(f.mock.requests).toEqual([]);
  });

  it('denies source managers without context grants content/search/file/import paths and rejects out-of-scope recipients', async () => {
    const f = await setup(); const savedRule = await rule(f.a); const fileId = await upload(f); const event = await accept(f, [fileId]);
    const job = await settled(f, event.initialJobId!); const bDelivery = f.store.listDeliveries(job.id).find(item => item.recipientSeatId === 'b')!;
    const ruleResponse = await f.c.call(`/api/information/rules/${savedRule.id}`, {name: '越权收件', sourceId: savedRule.sourceId, profileId: savedRule.profileId, recipientSeatIds: ['c'], enabled: true, revision: savedRule.revision}, 'PUT');
    expect(ruleResponse.statusCode).toBe(403); expect(f.store.getRule(savedRule.id)).toEqual(savedRule);
    for (const url of ['/api/information/events', '/api/information/jobs', `/api/information/events/${event.id}`, `/api/information/jobs/${job.id}`]) {
      const response = await f.c.call(url); expect(response.statusCode, `${url}: ${response.body}`).toBe(200);
      for (const marker of [...privateMarkers, 'report-west-01', 'contextScope', 'ruleSnapshot']) expect(response.body, url).not.toContain(marker);
      expect(response.body).toContain('succeeded');
    }
    const hiddenEvent = (await f.c.call(`/api/information/events/${event.id}`)).json<BackgroundEventDetail>();
    expect(hiddenEvent).toMatchObject({contentRestricted: true, text: '', results: [], files: [], analyses: []});
    const hiddenJob = (await f.c.call(`/api/information/jobs/${job.id}`)).json<InformationJobDetail>();
    expect(hiddenJob.contentRestricted).toBe(true); expect(hiddenJob.snapshot).toBeUndefined(); expect(hiddenJob.input).toBeUndefined(); expect(hiddenJob.error).toBeUndefined();
    for (const area of ['events', 'jobs']) for (const search of ['RESTRICTED_INPUT_TITLE', 'RESTRICTED_MESSAGE_ID']) {
      const response = await f.c.call(`/api/information/${area}?search=${search}`); expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({items: [], total: 0});
    }
    expect((await f.c.call(`/api/information/jobs?search=${job.id}`)).json().items).toHaveLength(1);
    expect((await f.c.call(`/api/information/events/${event.id}/files/${event.files[0].id}`)).statusCode).toBe(404);
    expect((await f.c.call('/api/inbox')).json<BackgroundPage<InboxItem>>().items).toEqual([]);
    expect((await f.c.call(`/api/inbox/${bDelivery.id}`)).statusCode).toBe(404);
    expect((await f.c.call(`/api/inbox/${bDelivery.id}/files/${event.files[0].id}`)).statusCode).toBe(404);
    const target = await task(f.c);
    for (const mode of ['conversation', 'background']) expect((await f.c.call(`/api/inbox/${bDelivery.id}/analyses`, {clientActionId: randomUUID(), taskSpaceId: target.id, goal: '读取结果', mode, includeResult: true, fileIds: []})).statusCode).toBe(404);
    expect((await f.c.call(`/api/information/jobs/${job.id}/reprocess`, {clientActionId: randomUUID()})).statusCode).toBe(403);
    expect((await f.c.call('/api/context/catalog')).json()).toEqual({systems: []});
    const workspace = (await f.c.call(`/api/tasks/${target.id}/workspace`, {})).json();
    const session = (await f.c.call('/api/sessions', {workspaceId: workspace.id})).json();
    const httpCount = f.mock.requests.length;
    const stream = await f.c.call(`/api/sessions/${session.id}/messages`, {text: '查询特情和态势'}); expect(stream.statusCode, stream.body).toBe(200);
    const toolErrors = f.lab.get(session.id, 'c').messages.filter(message => message.role === 'tool' && message.isError);
    expect(toolErrors.map(message => message.toolName)).toEqual(['information_read', 'situation_query']);
    expect(f.mock.requests).toHaveLength(httpCount);
    const allowedFile = await f.b.call(`/api/inbox/${bDelivery.id}/files/${event.files[0].id}`); expect(allowedFile.statusCode, allowedFile.body).toBe(200); expect(allowedFile.body).toBe('RESTRICTED_FILE_BODY');
  });

  it('prepares an unsent follow-up with source/query references and preserves scope for seat background analysis', async () => {
    const f = await setup(); await rule(f.a); const event = await accept(f); const job = await settled(f, event.initialJobId!);
    const delivery = f.store.listDeliveries(job.id).find(item => item.recipientSeatId === 'b')!;
    const target = await task(f.b);
    const count = f.fake.calls.length;
    const request = {clientActionId: randomUUID(), taskSpaceId: target.id, goal: '为什么得出这个结论？', mode: 'conversation', includeResult: true, fileIds: []};
    const response = await f.b.call(`/api/inbox/${delivery.id}/analyses`, request); expect(response.statusCode, response.body).toBe(200);
    const action = response.json<BackgroundAction>();
    expect(action.status).toBe('completed'); expect(action.jobId).toBeUndefined();
    for (const text of ['为什么得出这个结论', 'PROVIDER_ANALYSIS_RESULT', '来源标识', 'intel-source', 'report-west-01', '当次查询线索', 'information_read', 'revision', 'queriedAt']) expect(action.draft).toContain(text);
    expect(action.draft).not.toContain('PRIVATE_PROFILE');
    expect(f.lab.get(action.sessionId!, 'b').messages).toEqual([]); expect(f.fake.calls).toHaveLength(count);
    expect((await f.b.call(`/api/inbox/${delivery.id}/analyses`, request)).json().sessionId).toBe(action.sessionId);
    const sent = await f.b.call(`/api/sessions/${action.sessionId}/messages`, {text: action.draft}); expect(sent.statusCode, sent.body).toBe(200);
    expect(f.lab.get(action.sessionId!, 'b').messages.filter(message => message.role === 'tool' && message.isError)).toEqual([]);
    const background = await f.b.call(`/api/inbox/${delivery.id}/analyses`, {...request, clientActionId: randomUUID(), mode: 'background'});
    expect(background.statusCode, background.body).toBe(200);
    const backgroundAction = background.json<BackgroundAction>(); const seatJob = await settled(f, backgroundAction.jobId!);
    expect(seatJob).toMatchObject({kind: 'seat_analysis', seatId: 'b', taskSpaceId: target.id, contextScope: {scopeId: 'demo-context', systemIds: ['intel', 'situation']}});
    const own = await f.b.call(`/api/background/jobs/${seatJob.id}`); expect(own.statusCode, own.body).toBe(200); expect(own.json<InformationJobDetail>().snapshot).toBeDefined();
    for (const viewer of [f.a, f.c]) {
      const other = await viewer.call(`/api/information/jobs/${seatJob.id}`); expect(other.statusCode, other.body).toBe(200);
      expect(other.json<InformationJobDetail>().snapshot).toBeUndefined(); expect(other.body).not.toContain(target.id); expect(other.body).not.toContain('PRIVATE_TASK_GOAL');
    }
  });

  it('keeps legacy unscoped jobs readable and usable by their authorized recipients', async () => {
    const f = await setup(); await rule(f.a, true, ['c']); const event = await accept(f, [], true);
    expect(event.systemId).toBeUndefined(); expect(event.ruleSnapshot?.profile.contextScope).toBeUndefined();
    const job = await settled(f, event.initialJobId!);
    const delivery = f.store.listDeliveries(job.id)[0]; expect(delivery.recipientSeatId).toBe('c');
    const detailResponse = await f.c.call(`/api/inbox/${delivery.id}`); expect(detailResponse.statusCode, detailResponse.body).toBe(200);
    const detail = detailResponse.json<InboxDetail>(); expect(detail.resultText).toBe('PROVIDER_ANALYSIS_RESULT'); expect(detail.queryMessages).toEqual([]);
    const center = await f.c.call(`/api/information/jobs/${job.id}`); expect(center.statusCode, center.body).toBe(200); expect(center.json<InformationJobDetail>().snapshot).toBeDefined();
    expect(f.mock.requests).toEqual([]);
    const target = await task(f.c); const before = f.fake.calls.length;
    const prepared = await f.c.call(`/api/inbox/${delivery.id}/analyses`, {clientActionId: randomUUID(), taskSpaceId: target.id, goal: '解释结果', mode: 'conversation', includeResult: true, fileIds: []});
    expect(prepared.statusCode, prepared.body).toBe(200); expect(prepared.json<BackgroundAction>().draft).toContain('PROVIDER_ANALYSIS_RESULT'); expect(f.fake.calls).toHaveLength(before);
  });
});
