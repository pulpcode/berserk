import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../src/access/database.js';
import { AccessStore } from '../../src/access/store.js';
import { ModelSettingsStore } from '../../src/server/model-settings.js';
import * as backgroundRuntime from '../../src/pi/background-runner.js';
import { BackgroundStore } from '../../src/background/store.js';
import { parseBackgroundConfig } from '../../src/background/config.js';
import { PiLab } from '../../src/pi/lab.js';
import { DockerExecutionService, type DockerRunner } from '../../src/execution/docker.js';
import { createApp } from '../../src/server/app.js';
import type { AuthSession, TaskSpace } from '../../src/contracts/access.js';
import type { BackgroundAction, BackgroundEventDetail, BackgroundJob, BackgroundReceipt, InformationRule, InboxDetail, BackgroundControl, BackgroundPage, InboxItem, InformationJobSummary, InformationJobDetail } from '../../src/contracts/background.js';
import { fakeRuntime, testConfig } from '../pi/fake-runtime.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn(); });
const env = {SPECIAL_TOKEN: 'test-source-special-only-123456789', OTHER_TOKEN: 'test-source-other-only-123456789'};
const catalog = () => parseBackgroundConfig({enabled: true, concurrency: 1, modelConcurrency: 1, backlogLimit: 100,
  sources: ['special', 'other'].map(sourceId => ({sourceId, name: sourceId, credentialRef: `${sourceId.toUpperCase()}_TOKEN`, allowedProfileIds: ['material'], allowedRecipientSeatIds: ['a', 'b']})),
  profiles: [{id: 'material', name: '材料预处理', goal: '生成资料摘要', tools: ['source_read'], instructions: 'PRIVATE_SERVICE_INSTRUCTIONS', resources: [{id: 'service-only', title: '服务资料', content: 'PRIVATE_SERVICE_RESOURCE'}]}]});
async function login(app: FastifyInstance, name: string) {
  const boot = await app.inject('/api/auth/session');
  const cookie = boot.cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const response = await app.inject({method: 'POST', url: '/api/auth/login', headers: {cookie, origin: 'http://localhost:4310', 'x-csrf-token': boot.json<AuthSession>().csrf!}, payload: {username: name, password: 'test-password-123'}});
  expect(response.statusCode, response.body).toBe(200);
  const auth = response.json<AuthSession>();
  const headers = {cookie: response.cookies.map(c => `${c.name}=${c.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': auth.csrf!, 'x-axon-view': auth.viewId!};
  return {auth, headers, call: (url: string, payload?: object, method: 'POST' | 'PUT' = 'POST') => app.inject({url, method: payload === undefined ? 'GET' : method, headers, ...(payload === undefined ? {} : {payload})})};
}
type Client = Awaited<ReturnType<typeof login>>;
async function setup(options: {reply?: Parameters<typeof fakeRuntime>[1]; absent?: boolean; backlogLimit?: number; docker?: boolean} = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'axon-background-api-')); cleanup.push(() => rm(dataDir, {recursive: true, force: true}));
  const db = await openDatabase(dataDir); const access = new AccessStore(db);
  for (const username of ['a', 'b']) await access.saveAccount({username, displayName: username, seatId: username, seatName: `席位 ${username}`, password: 'test-password-123', createPublicTask: true, manageModelSettings: username === 'a'});
  db.close();
  const config = testConfig(dataDir, {seatId: 'a', auth: {secret: 'test-signing-key-at-least-32-characters', sessionMs: 28800000}});
  const fake = await fakeRuntime(config, options.reply ?? (() => ({text: '预处理结果：请核对时间与地点。'})));
  const commands: string[] = [];
  const runner: DockerRunner = async (args, options) => {
    if (args[0] === 'info') return {code:0,stdout:Buffer.from('linux'),stderr:Buffer.alloc(0)};
    if (args[0] === 'exec' && args.includes('/opt/berserk/command.py')) commands.push(options?.input?.toString() ?? '');
    return {code:0,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)};
  };
  const lab = await PiLab.create(config, fake.runtime, options.docker ? new DockerExecutionService({instanceId:dataDir},runner) : undefined);
  const background = catalog(); if (options.backlogLimit) background.backlogLimit = options.backlogLimit;
  if (options.docker) background.profiles[0].tools.push('bash');
  const app = await createApp(lab, false, options.absent ? undefined : {config: background, env}); cleanup.push(() => app.close());
  const store = options.absent ? undefined : new BackgroundStore(lab.access!.db);
  if (store) for (const source of background.sources) store.grant('seat', 'a', source.sourceId, 'manage');
  const source = (url: string, payload?: object, sourceId = 'special') => app.inject({url: `/api/integrations/${sourceId}/${url}`, method: payload === undefined ? 'GET' : 'POST', headers: {authorization: `Bearer ${env[sourceId === 'special' ? 'SPECIAL_TOKEN' : 'OTHER_TOKEN']}`}, ...(payload === undefined ? {} : {payload})});
  return {app, lab, config, background, store: store!, source, fake, dataDir, commands};
}
const message = (sourceMessageId: string = randomUUID(), uploadIds?: string[]) => ({sourceMessageId, title: '测试信息', text: '收到一份材料，需要核对时间与地点。', ...(uploadIds ? {uploadIds} : {})});
async function createRule(a: Client, recipientSeatIds = ['a', 'b']) {
  const response = await a.call('/api/information/rules', {clientActionId: randomUUID(), name: '双席位接收', sourceId: 'special', profileId: 'material', recipientSeatIds, enabled: true});
  expect(response.statusCode, response.body).toBe(200); return response.json<InformationRule>();
}
async function upload(context: Awaited<ReturnType<typeof setup>>, contents = 'input-bytes') {
  const created = await context.source('uploads', {name: '材料.txt', size: Buffer.byteLength(contents)}); expect(created.statusCode, created.body).toBe(201);
  const uploadId = created.json<{uploadId: string}>().uploadId;
  const received = await context.app.inject({method: 'PUT', url: `/api/integrations/special/uploads/${uploadId}/content`, headers: {authorization: `Bearer ${env.SPECIAL_TOKEN}`, 'content-type': 'application/octet-stream'}, payload: Buffer.from(contents)});
  expect(received.statusCode, received.body).toBe(200); return uploadId;
}
async function settled(store: BackgroundStore, id: string): Promise<BackgroundJob> {
  await vi.waitFor(() => expect(['queued', 'running']).not.toContain(store.getJob(id).status), {timeout: 10_000, interval: 20});
  return store.getJob(id);
}
async function delivered(context: Awaited<ReturnType<typeof setup>>, a: Client, input = message()) {
  await createRule(a);
  const received = await context.source('events', input); expect(received.statusCode, received.body).toBe(202);
  const receipt = received.json<BackgroundReceipt>();
  const event = context.store.getEvent(receipt.eventId); const job = await settled(context.store, event.initialJobId!);
  expect(job.status, JSON.stringify(job.error)).toBe('succeeded');
  await vi.waitFor(() => expect(context.store.listDeliveries().filter(item => item.eventId === event.id && item.status === 'delivered')).toHaveLength(2));
  return {receipt, event, job, deliveries: context.store.listDeliveries().filter(item => item.eventId === event.id)};
}
async function task(client: Client, title = '个人分析任务') {
  const response = await client.call('/api/tasks', {title, goal: '', visibility: 'private', clientActionId: randomUUID()}); expect(response.statusCode, response.body).toBe(200); return response.json<TaskSpace>();
}

describe('information intake and native background service', () => {
  it('leaves the established formal service and v2 schema unchanged without background configuration', async () => {
    const context = await setup({absent: true}); const a = await login(context.app, 'a');
    expect(context.lab.access!.db.prepare('PRAGMA user_version').get()?.user_version).toBe(2);
    expect((await a.call('/api/information/access')).json().enabled).toBe(false);
    expect((await a.call('/api/inbox')).json().items).toEqual([]);
    expect((await context.source('events', message())).statusCode).not.toBe(202);
    expect(context.fake.calls).toEqual([]);
  });

  it('authenticates only exact integration routes and deduplicates reuploaded identical bytes by stable source key', async () => {
    const context = await setup(); const input = message('external-1001');
    expect((await context.app.inject({method: 'POST', url: '/api/integrations/special/events', payload: input})).statusCode).toBe(401);
    expect((await context.app.inject({method: 'POST', url: '/api/integrations/other/events', headers: {authorization: `Bearer ${env.SPECIAL_TOKEN}`}, payload: input})).statusCode).toBe(401);
    for (const url of ['/api/tasks', '/api/information/events', '/api/integrations/special/../tasks']) expect((await context.app.inject({url, headers: {authorization: `Bearer ${env.SPECIAL_TOKEN}`}})).statusCode).toBe(401);
    const firstUpload = await upload(context), secondUpload = await upload(context);
    const one = await context.source('events', {...input, uploadIds: [firstUpload]}); const two = await context.source('events', {...input, uploadIds: [secondUpload]});
    expect(one.statusCode, one.body).toBe(202); expect(two.json()).toEqual(one.json());
    expect(context.store.listEvents()).toHaveLength(1); expect(context.store.listJobs()).toEqual([]);
    expect((await context.source('events', {...input, text: 'different', uploadIds: [firstUpload]})).statusCode).toBe(409);
    expect((await context.source('events', {...input, uploadIds: [firstUpload]}, 'other')).statusCode).toBe(404);
    expect((await context.source(`events?sourceMessageId=${input.sourceMessageId}`)).json()).toEqual(one.json());
    expect((await context.source('events', {...message(), recipientSeatIds: ['b']})).statusCode).toBe(400);
    expect(one.body).not.toContain('PRIVATE_SERVICE'); expect(context.fake.calls).toEqual([]);
  });

  it('bounds unmatched backlog, persists basic rule edits and requires explicit processing of old information', async () => {
    const context = await setup({backlogLimit: 1}); const a = await login(context.app, 'a'); const b = await login(context.app, 'b');
    context.store.grant('seat', 'b', 'special', 'view');
    const first = await context.source('events', message('unmatched')); expect(first.statusCode).toBe(202);
    expect((await context.source('events', message('overflow'))).statusCode).toBe(429);
    const rule = await createRule(a); expect(context.store.listJobs()).toHaveLength(0);
    expect((await b.call('/api/information/rules', {name: '越权规则', sourceId: rule.sourceId, profileId: rule.profileId, recipientSeatIds: ['b'], enabled: true, clientActionId: randomUUID()})).statusCode).toBe(403);
    const input = {name: '改名', sourceId: rule.sourceId, profileId: rule.profileId, recipientSeatIds: ['a', 'b'], enabled: true, revision: rule.revision};
    expect((await a.call(`/api/information/rules/${rule.id}`, input, 'PUT')).statusCode).toBe(200);
    expect((await a.call(`/api/information/rules/${rule.id}`, input, 'PUT')).statusCode).toBe(409);
    const eventId = first.json<BackgroundReceipt>().eventId; const action = {clientActionId: randomUUID()};
    const processed = await a.call(`/api/information/events/${eventId}/process`, action); expect(processed.statusCode, processed.body).toBe(200);
    expect((await a.call(`/api/information/events/${eventId}/process`, action)).json().id).toBe(processed.json().id);
    expect((await settled(context.store, processed.json<BackgroundJob>().id)).status).toBe('succeeded');
    expect(context.store.listJobs()).toHaveLength(1);
    const currentControl = (await a.call('/api/information/queue')).json<BackgroundControl>();
    const stopped = await a.call('/api/information/queue', {revision: currentControl.revision, enabled: false}, 'PUT'); expect(stopped.statusCode, stopped.body).toBe(200);
    expect((await b.call('/api/information/queue', {revision: stopped.json<BackgroundControl>().revision, enabled: true}, 'PUT')).statusCode).toBe(403);
    const sourcePaused = await a.call('/api/information/sources/special', {revision: 0, accepting: false}, 'PUT'); expect(sourcePaused.statusCode, sourcePaused.body).toBe(200);
    expect((await context.source('events', message('new-paused'))).statusCode).toBe(503);
    expect((await context.source('events', message('unmatched'))).json()).toEqual(first.json());
  });

  it('rechecks a source paused while its accepted snapshot is still being prepared', async () => {
    const context = await setup(); const a = await login(context.app,'a'); await createRule(a);
    let release!: () => void; const gate = new Promise<void>(resolve => {release=resolve;});
    const original = backgroundRuntime.snapshotBackgroundProfile;
    const spy = vi.spyOn(backgroundRuntime,'snapshotBackgroundProfile').mockImplementation(async (...args) => {await gate; return original(...args);});
    const accepting = context.source('events',message('paused-during-preparation')).then(response => response);
    await vi.waitFor(() => expect(spy).toHaveBeenCalledOnce());
    try {
      expect((await a.call('/api/information/sources/special',{revision:0,accepting:false},'PUT')).statusCode).toBe(200);
    } finally {release();}
    const response = await accepting;
    expect(response.statusCode,response.body).toBe(503); expect(context.store.listEvents()).toEqual([]); expect(context.fake.calls).toEqual([]);
  });

  it('leaves jobs queued while model settings are saving, then starts after the save settles', async () => {
    const context = await setup(); const a = await login(context.app,'a'); await createRule(a);
    let release!: () => void; const gate = new Promise<void>(resolve => {release=resolve;});
    const spy = vi.spyOn(ModelSettingsStore.prototype,'save').mockImplementation(async () => {await gate; throw new Error('injected disk failure');});
    const settings = context.lab.modelSettings();
    const saving = context.lab.updateModelSettings({provider:settings.provider,model:settings.model,baseUrl:settings.baseUrl,expectedVersion:settings.version}).catch(error => error);
    await vi.waitFor(() => expect(spy).toHaveBeenCalledOnce());
    let jobId = '';
    try {
      const response = await context.source('events',message()); expect(response.statusCode,response.body).toBe(202);
      jobId = context.store.getEvent(response.json<BackgroundReceipt>().eventId).initialJobId!;
      // At least one timer pump passes while the actual settings save is held.
      await new Promise(resolve => setTimeout(resolve,300));
      expect(context.store.getJob(jobId).status).toBe('queued'); expect(context.fake.calls).toEqual([]);
    } finally {release(); await saving;}
    expect((await settled(context.store,jobId)).status).toBe('succeeded'); expect(context.fake.calls).toHaveLength(1);
  });

  it('preprocesses with no recipient online, fans out once, and prepares chat without starting a model or exposing service resources', async () => {
    const context = await setup({reply: (_context, index) => index === 0 ? {toolIds: ['service-only']} : {text: 'PUBLIC_PREPROCESS_RESULT'}});
    const a = await login(context.app, 'a'); const uploadId = await upload(context); const input = message('offline', [uploadId]);
    await createRule(a); await a.call('/api/auth/logout', {});
    const response = await context.source('events', input); const event = context.store.getEvent(response.json<BackgroundReceipt>().eventId);
    expect((await settled(context.store, event.initialJobId!)).status).toBe('succeeded');
    await vi.waitFor(() => expect(context.store.listDeliveries().filter(item => item.status === 'delivered')).toHaveLength(2));
    expect(context.fake.calls).toHaveLength(2);
    const loggedA = await login(context.app, 'a'), b = await login(context.app, 'b');
    const inboxA = (await loggedA.call('/api/inbox')).json<BackgroundPage<InboxItem>>(); const inboxB = (await b.call('/api/inbox')).json<BackgroundPage<InboxItem>>();
    expect(inboxA.items).toHaveLength(1); expect(inboxB.items).toHaveLength(1);
    const deliveryId = inboxB.items[0].delivery.id;
    expect((await loggedA.call(`/api/inbox/${deliveryId}`)).statusCode).toBe(404);
    const detailResponse = await b.call(`/api/inbox/${deliveryId}`); const detail = detailResponse.json<InboxDetail>();
    expect(detail.resultText).toBe('PUBLIC_PREPROCESS_RESULT'); expect(detailResponse.body).not.toContain('PRIVATE_SERVICE_INSTRUCTIONS'); expect(detailResponse.body).not.toContain('PRIVATE_SERVICE_RESOURCE');
    expect((await b.call(`/api/information/events/${event.id}`)).statusCode).toBe(404);
    expect((await b.call(`/api/inbox/${deliveryId}/files/${detail.event.files[0].id}`)).body).toBe('input-bytes');
    const target = await task(b); const create = {clientActionId: randomUUID(), taskSpaceId: target.id, goal: '请整理这些材料', mode: 'conversation', includeResult: true, fileIds: [detail.event.files[0].id]};
    const prepared = await b.call(`/api/inbox/${deliveryId}/analyses`, create); expect(prepared.statusCode, prepared.body).toBe(200);
    const action = prepared.json<BackgroundAction>(); expect(action.status).toBe('completed'); expect(action.draft).toContain('PUBLIC_PREPROCESS_RESULT'); expect(action.jobId).toBeUndefined();
    expect(context.fake.calls).toHaveLength(2); expect(context.lab.get(action.sessionId!, 'b').messages).toEqual([]);
    expect(await readFile(join(context.lab.files.filesDirectory(action.workspaceId!, 'b'), action.fileRefs![0].path), 'utf8')).toBe('input-bytes');
    expect((await b.call(`/api/inbox/${deliveryId}/analyses`, create)).json().sessionId).toBe(action.sessionId);
    expect((await b.call(`/api/inbox/${deliveryId}/analyses`, {...create, goal: 'different'})).statusCode).toBe(409);
    expect(context.lab.list(action.workspaceId!, 'b')).toHaveLength(1);
    expect(context.lab.access!.db.prepare('SELECT count(*) n FROM works').get()?.n).toBe(0);
  });

  it('reserves queued seat analysis against chat and archive, cancels explicitly, then continues the same native session', async () => {
    const context = await setup(); const a = await login(context.app, 'a'), b = await login(context.app, 'b');
    const completed = await delivered(context, a); const delivery = completed.deliveries.find(item => item.recipientSeatId === 'b')!;
    const target = await task(b); context.store.setControl('queue', context.store.getControl('queue').revision, false, a.auth.identity!.userId);
    const input = {clientActionId: randomUUID(), taskSpaceId: target.id, goal: '离线分析', mode: 'background', includeResult: true, fileIds: []};
    const response = await b.call(`/api/inbox/${delivery.id}/analyses`, input); expect(response.statusCode, response.body).toBe(200); const action = response.json<BackgroundAction>();
    expect(context.store.getJob(action.jobId!).status).toBe('queued');
    expect((await b.call(`/api/sessions/${action.sessionId}/messages`, {text: '不能同时发送'})).statusCode).toBe(409);
    expect((await b.call(`/api/tasks/${target.id}/archive`, {revision: target.revision})).statusCode).toBe(409);
    expect((await b.call(`/api/inbox/${delivery.id}/analyses`, input)).json().jobId).toBe(action.jobId);
    expect((await a.call(`/api/background/jobs/${action.jobId}/cancel`, {revision: 1})).statusCode).toBe(404);
    expect((await b.call(`/api/background/jobs/${action.jobId}/cancel`, {revision: 1})).json().status).toBe('cancelled');
    expect(context.fake.calls).toHaveLength(1);
    expect((await b.call(`/api/sessions/${action.sessionId}/messages`, {text: '我现在继续处理'})).body).toContain('response.completed');
    expect(context.fake.calls).toHaveLength(2); expect(context.lab.get(action.sessionId!, 'b').messages.filter(item => item.role === 'user')).toHaveLength(1);
    expect((await b.call(`/api/tasks/${target.id}/archive`, {revision: target.revision})).statusCode).toBe(200);
  });

  it('recovers an import interrupted after native session creation without exposing the reserved session or making duplicates', async () => {
    const context = await setup(); const a = await login(context.app,'a'), b = await login(context.app,'b');
    const uploadId = await upload(context), {deliveries} = await delivered(context,a,message('import-recovery',[uploadId]));
    const delivery = deliveries.find(item => item.recipientSeatId === 'b')!, target = await task(b);
    const detail = (await b.call(`/api/inbox/${delivery.id}`)).json<InboxDetail>();
    const input = {clientActionId:randomUUID(),taskSpaceId:target.id,goal:'检查资料',mode:'conversation',includeResult:true,fileIds:[detail.event.files[0].id]};
    const original = BackgroundStore.prototype.updateAction; let injected = false;
    const spy = vi.spyOn(BackgroundStore.prototype,'updateAction').mockImplementation(function (this:BackgroundStore,...args) {
      if (!injected && args[2].fileRefs) {injected=true; throw new Error('injected after native creation');}
      return original.apply(this,args);
    });
    expect((await b.call(`/api/inbox/${delivery.id}/analyses`,input)).statusCode).toBe(500); spy.mockRestore();
    const action = (await b.call(`/api/inbox/${delivery.id}/analyses?clientActionId=${input.clientActionId}`)).json<BackgroundAction>();
    expect(action.status).toBe('preparing'); expect(context.lab.list(action.workspaceId!,'b')).toHaveLength(1);
    expect((await b.call(`/api/sessions/${action.sessionId}/messages`,{text:'不能越过准备过程'})).statusCode).toBe(409);
    expect((await b.call(`/api/tasks/${target.id}/archive`,{revision:target.revision})).statusCode).toBe(409);
    const retried = await b.call(`/api/inbox/${delivery.id}/analyses`,input); expect(retried.statusCode,retried.body).toBe(200);
    expect(retried.json<BackgroundAction>().sessionId).toBe(action.sessionId);
    expect(retried.json<BackgroundAction>().fileRefs?.[0]).toMatchObject({name:'材料.txt',size:11});
    expect(context.lab.list(action.workspaceId!,'b')).toHaveLength(1); expect(context.fake.calls).toHaveLength(1);
  });

  it('runs user-confirmed analysis after logout and limits center visibility to public execution metadata', async () => {
    const context = await setup({reply: (_context, index) => ({text: index === 0 ? '预处理完成' : 'PRIVATE_SEAT_B_ANALYSIS', delayMs: index === 1 ? 120 : undefined})});
    const a = await login(context.app, 'a'), b = await login(context.app, 'b'); const {event, deliveries} = await delivered(context, a);
    const delivery = deliveries.find(item => item.recipientSeatId === 'b')!; const target = await task(b, 'PRIVATE_B_TASK_TITLE');
    const response = await b.call(`/api/inbox/${delivery.id}/analyses`, {clientActionId: randomUUID(), taskSpaceId: target.id, goal: 'PRIVATE_B_GOAL', mode: 'background', includeResult: true, fileIds: []});
    expect(response.statusCode, response.body).toBe(200); const action = response.json<BackgroundAction>();
    await b.call('/api/auth/logout', {});
    expect((await settled(context.store, action.jobId!)).status).toBe('succeeded');
    const center = await a.call(`/api/information/jobs/${action.jobId}`); expect(center.statusCode).toBe(200);
    for (const secret of ['PRIVATE_B_TASK_TITLE', 'PRIVATE_B_GOAL', 'PRIVATE_SEAT_B_ANALYSIS', action.sessionId!, action.workspaceId!, target.id]) expect(center.body).not.toContain(secret);
    expect(center.json().seatId).toBe('b'); expect(center.json().status).toBe('succeeded');
    const eventDetail = (await a.call(`/api/information/events/${event.id}`)).json<BackgroundEventDetail>(); expect(eventDetail.analyses[0].sessionId).toBeUndefined();
    for (const search of [event.title,event.sourceMessageId]) {
      const jobs = await a.call(`/api/information/jobs?search=${encodeURIComponent(search)}`);
      expect(jobs.json().total).toBe(2);
    }
    const exact = (await a.call(`/api/information/jobs?search=${action.jobId}`)).json();
    expect(exact.total).toBe(1); expect(exact.items[0].id).toBe(action.jobId);
    for (const search of ['PRIVATE_B_TASK_TITLE','PRIVATE_B_GOAL','PRIVATE_SEAT_B_ANALYSIS','no-matching-information']) {
      expect((await a.call(`/api/information/jobs?search=${encodeURIComponent(search)}`)).json().items).toEqual([]);
    }
    expect((await a.call(`/api/information/jobs?sourceId=other&search=${action.jobId}`)).json().items).toEqual([]);
    expect((await a.call(`/api/information/jobs?status=failed&search=${action.jobId}`)).json().items).toEqual([]);
    expect((await a.call('/api/information/jobs?search=')).json().total).toBe(2);
    const again = await login(context.app, 'b');
    expect((await again.call(`/api/background/jobs/${action.jobId}`)).json().text).toBe('PRIVATE_SEAT_B_ANALYSIS');
    const before = context.fake.calls.length; expect((await again.call(`/api/sessions/${action.sessionId}`)).json().lastResult.status).toBe('succeeded'); expect(context.fake.calls).toHaveLength(before);
    expect((await again.call(`/api/sessions/${action.sessionId}/messages`, {text: '请继续'})).body).toContain('response.completed');
    expect(context.lab.get(action.sessionId!, 'b').messages.filter(item => item.role === 'user')).toHaveLength(2);
    const history = (await again.call(`/api/background/jobs/${action.jobId}`)).json<InformationJobDetail>();
    expect(history.snapshot?.messages.filter(item => item.role === 'user')).toHaveLength(1);
    expect(history.snapshot?.messages.every(item => item.requestId === action.requestId)).toBe(true);
    expect(history.snapshot?.lastResult).toBeNull();
    expect(history.text).toBe('PRIVATE_SEAT_B_ANALYSIS');
    const redacted = (await a.call(`/api/information/jobs/${action.jobId}`)).json<InformationJobDetail>();
    for (const key of ['title','snapshot','input','files','text','error','deliveries','retryOfJobId','sessionId']) expect(redacted).not.toHaveProperty(key);
  });

  it('provides independent board counts and merged-state pagination without searching private content', async () => {
    const context = await setup(); const a = await login(context.app,'a'), b = await login(context.app,'b');
    context.store.setControl('queue',0,false); await createRule(a);
    const accepted = await context.source('events',{...message('board-source-id'),title:'看板筛选材料'});
    const event = context.store.getEvent(accepted.json<BackgroundReceipt>().eventId), initial = context.store.getJob(event.initialJobId!);
    const failed: BackgroundJob[] = [];
    for (let index = 0; index < 32; index++) {
      const next: BackgroundJob = {...initial,id:randomUUID(),sessionId:randomUUID(),requestId:randomUUID()};
      context.store.enqueueJob(next,100);
      if (index < 6) failed.push(context.store.finishJob(next.id,1,{status:(['failed','interrupted','cancelled'] as const)[index % 3],error:{code:'PRIVATE',message:'PRIVATE_SEAT_ERROR'}}));
    }
    const otherRule = await a.call('/api/information/rules',{clientActionId:randomUUID(),name:'另一来源',sourceId:'other',profileId:'material',recipientSeatIds:['a'],enabled:true});
    expect(otherRule.statusCode,otherRule.body).toBe(200);
    await context.source('events',message('other-source-id'), 'other');
    const query = 'sourceId=special&search=看板&statuses=failed,interrupted,cancelled&limit=2';
    const pages = await Promise.all([0,2,4].map(async offset => (await a.call(`/api/information/jobs?${query}&offset=${offset}`)).json<BackgroundPage<InformationJobSummary>>()));
    expect(pages.map(page => page.total)).toEqual([6,6,6]);
    expect(pages.flatMap(page => page.items.map(item => item.id))).toEqual(failed.toReversed().map(item => item.id));
    const queued = (await a.call('/api/information/jobs?sourceId=special&search=看板&status=queued&limit=2&offset=2')).json<BackgroundPage<InformationJobSummary>>();
    expect(queued.total).toBe(27); expect(queued.items).toHaveLength(2);
    expect(queued.items.every(item => item.status === 'queued')).toBe(true);
    expect((await a.call('/api/information/jobs?search=PRIVATE_SEAT_ERROR')).json().total).toBe(0);
    expect((await b.call(`/api/information/jobs?${query}`)).json().total).toBe(0);
    context.store.grant('seat','b','other','view');
    expect((await b.call('/api/information/jobs')).json().total).toBe(1);
    expect((await a.call('/api/information/jobs')).json().total).toBe(34);
    expect((await b.call(`/api/information/jobs?${query}`)).json().total).toBe(0);
    expect((await a.call('/api/information/jobs?statuses=failed,running&status=failed')).statusCode).toBe(400);
    expect((await a.call('/api/information/jobs?statuses=failed,unknown')).statusCode).toBe(400);
    expect((await a.call('/api/information/jobs?statuses=failed&limit=201')).statusCode).toBe(400);
    expect(context.fake.calls).toEqual([]);
  });

  it('shows native blocked-command evidence and associates delivery with the completed execution, not its failed retry', async () => {
    const context = await setup({docker:true,reply: (_context,index) => index === 0
      ? {tools:[{name:'bash',arguments:{command:'rm -rf /workspace/old'}}]}
      : index === 1 ? {text:'无法完成删除；本次命令没有执行。'} : {error:'Invalid API key'}});
    const a = await login(context.app,'a'), b = await login(context.app,'b');
    const uploadId = await upload(context); const {job,event} = await delivered(context,a,message('native-detail',[uploadId]));
    const detailResponse = await a.call(`/api/information/jobs/${job.id}`); expect(detailResponse.statusCode,detailResponse.body).toBe(200);
    const detail = detailResponse.json<InformationJobDetail>();
    expect(detail.status).toBe('succeeded'); expect(detail.text).toBe('无法完成删除；本次命令没有执行。');
    expect(detail.input).toMatchObject({title:event.title,text:message().text,files:[{id:event.files[0].id}]});
    expect(detail.snapshot?.commandPolicies).toEqual([expect.objectContaining({requestId:job.requestId,command:'rm -rf /workspace/old',cwd:'/workspace',execution:'not_started',policy:expect.objectContaining({decision:'ask',ruleId:'shell.modify'})})]);
    expect(detail.snapshot?.messages.find(item => item.role === 'tool')).toMatchObject({toolName:'bash',isError:true,text:expect.stringContaining('本次命令未执行')});
    expect(detail.deliveries?.map(item => [item.jobId,item.status])).toEqual([[job.id,'delivered'],[job.id,'delivered']]);
    expect((await b.call(`/api/information/jobs/${job.id}`)).statusCode).toBe(404);
    context.store.grant('seat','b','special','view');
    expect((await b.call(`/api/information/jobs/${job.id}`)).json().text).toBe(detail.text);
    expect((await b.call(`/api/information/jobs/${job.id}/reprocess`,{clientActionId:randomUUID()})).statusCode).toBe(403);
    const again = await a.call(`/api/information/jobs/${job.id}/reprocess`,{clientActionId:randomUUID()}); expect(again.statusCode,again.body).toBe(200);
    const retried = await settled(context.store,again.json<BackgroundJob>().id); expect(retried.status).toBe('failed');
    const retryDetail = (await a.call(`/api/information/jobs/${retried.id}`)).json<InformationJobDetail>();
    expect(retryDetail.retryOfJobId).toBe(job.id); expect(retryDetail.deliveries).toEqual([]); expect(retryDetail.error).toBeDefined();
    const originalDetail = (await a.call(`/api/information/jobs/${job.id}`)).json<InformationJobDetail>();
    expect(originalDetail.status).toBe('succeeded'); expect(originalDetail.deliveries).toHaveLength(2);
    const list = (await a.call(`/api/information/jobs?search=${event.sourceMessageId}`)).json<BackgroundPage<InformationJobSummary>>();
    expect(list.items.map(item => [item.id,item.status,item.deliveries?.length])).toEqual([[retried.id,'failed',0],[job.id,'succeeded',2]]);
    expect(context.commands).toEqual([]);
  });

  it('keeps per-seat delivery failures separate and retries delivery without a second model call', async () => {
    const context = await setup(); const a = await login(context.app, 'a'); await createRule(a);
    context.lab.access!.disable('b');
    const response = await context.source('events', message()); const event = context.store.getEvent(response.json<BackgroundReceipt>().eventId);
    expect((await settled(context.store, event.initialJobId!)).status).toBe('succeeded');
    await vi.waitFor(() => expect(context.store.listDeliveries().filter(item => item.status === 'failed')).toHaveLength(1));
    await vi.waitFor(() => expect(context.store.listDeliveries().find(item => item.recipientSeatId === 'a')?.status).toBe('delivered'));
    const failed = context.store.listDeliveries().find(item => item.recipientSeatId === 'b')!;
    context.lab.access!.db.prepare('UPDATE accounts SET enabled=1 WHERE seat_id=?').run('b');
    const action = {clientActionId: randomUUID()}; const retried = await a.call(`/api/information/deliveries/${failed.id}/retry`, action); expect(retried.statusCode, retried.body).toBe(200); expect(retried.json().status).toBe('delivered');
    expect((await a.call(`/api/information/deliveries/${failed.id}/retry`, action)).json().id).toBe(failed.id);
    expect(context.store.listDeliveries()).toHaveLength(2); expect(context.fake.calls).toHaveLength(1);
    context.background.sources[0].allowedRecipientSeatIds = ['a']; const b = await login(context.app, 'b');
    expect((await b.call(`/api/inbox/${failed.id}`)).statusCode).toBe(404); expect((await b.call('/api/inbox')).json().items).toEqual([]);
  });

  it('does not report delivery success when original text or native completion evidence is unavailable', async () => {
    const context = await setup(); const a = await login(context.app,'a'); await createRule(a); context.lab.access!.disable('b');
    const response = await context.source('events',message()); const event = context.store.getEvent(response.json<BackgroundReceipt>().eventId);
    expect((await settled(context.store,event.initialJobId!)).status).toBe('succeeded');
    await vi.waitFor(() => expect(context.store.listDeliveries().find(item => item.recipientSeatId === 'b')?.status).toBe('failed'));
    context.lab.access!.db.prepare("UPDATE accounts SET enabled=1 WHERE seat_id='b'").run();
    const delivery = context.store.listDeliveries().find(item => item.recipientSeatId === 'b')!;
    const sourcePath = join(context.dataDir,'background','events',event.id,'input.json'), original = await readFile(sourcePath);
    await writeFile(sourcePath,JSON.stringify({text:'changed after acceptance'}));
    let retried = await a.call(`/api/information/deliveries/${delivery.id}/retry`,{clientActionId:randomUUID()});
    expect(retried.json().status).toBe('failed'); expect(retried.json().error.message).toContain('损坏');
    await writeFile(sourcePath,original);
    const read = vi.spyOn(context.lab,'readPreprocess').mockRejectedValue(new Error('unreadable native history'));
    retried = await a.call(`/api/information/deliveries/${delivery.id}/retry`,{clientActionId:randomUUID()});
    expect(retried.json().status).toBe('failed'); read.mockRestore();
    retried = await a.call(`/api/information/deliveries/${delivery.id}/retry`,{clientActionId:randomUUID()});
    expect(retried.json().status).toBe('delivered'); expect(context.fake.calls).toHaveLength(1);
  });

  it('propagates an accepted running cancellation to the native model and releases the persisted reservation', async () => {
    const context = await setup({reply: (_context, index) => index === 1 ? {waitForAbort: true} : {text: '完成'}});
    const a = await login(context.app, 'a'), b = await login(context.app, 'b'); const {deliveries} = await delivered(context, a);
    const delivery = deliveries.find(item => item.recipientSeatId === 'b')!; const target = await task(b);
    const response = await b.call(`/api/inbox/${delivery.id}/analyses`, {clientActionId: randomUUID(), taskSpaceId: target.id, goal: '分析', mode: 'background', includeResult: true, fileIds: []});
    expect(response.statusCode, response.body).toBe(200); const action = response.json<BackgroundAction>();
    await vi.waitFor(() => expect(context.fake.calls).toHaveLength(2));
    const before = context.store.getJob(action.jobId!); expect(before.status).toBe('running');
    const cancel = await b.call(`/api/background/jobs/${before.id}/cancel`, {revision: before.revision}); expect(cancel.statusCode, cancel.body).toBe(200);
    expect((await settled(context.store, before.id)).status).toBe('cancelled');
    expect(context.fake.calls[1].aborted).toBe(true); expect(context.store.sessionReservation(action.sessionId!)).toBeUndefined();
    expect(context.store.listDeliveries()).toHaveLength(2);
    expect((await b.call(`/api/sessions/${action.sessionId}/messages`, {text: '现在继续'})).body).toContain('response.completed');
    expect(context.fake.calls).toHaveLength(3);
  });

  it('keeps queued seat analysis and its session reservation across a stopped service, then claims it exactly once', async () => {
    const context = await setup(); const a = await login(context.app, 'a'), b = await login(context.app, 'b');
    const {deliveries} = await delivered(context, a); const delivery = deliveries.find(item => item.recipientSeatId === 'b')!;
    const target = await task(b); context.store.setControl('queue', 0, false, a.auth.identity!.userId);
    const response = await b.call(`/api/inbox/${delivery.id}/analyses`, {clientActionId: randomUUID(), taskSpaceId: target.id, goal: '重启后分析', mode: 'background', includeResult: true, fileIds: []});
    expect(response.statusCode, response.body).toBe(200); const action = response.json<BackgroundAction>();
    await context.app.close();
    const lab = await PiLab.create(context.config, context.fake.runtime);
    const app = await createApp(lab, false, {config: context.background, env}); cleanup.push(() => app.close());
    const store = new BackgroundStore(lab.access!.db);
    expect(store.getJob(action.jobId!).status).toBe('queued'); expect(store.sessionReservation(action.sessionId!)?.id).toBe(action.jobId);
    expect(context.fake.calls).toHaveLength(1);
    const restoredB = await login(app, 'b');
    expect((await restoredB.call(`/api/sessions/${action.sessionId}/messages`, {text: '等待中的会话'})).statusCode).toBe(409);
    expect((await restoredB.call(`/api/tasks/${target.id}/archive`, {revision: 1})).statusCode).toBe(409);
    const restoredA = await login(app, 'a'); const control = (await restoredA.call('/api/information/queue')).json<BackgroundControl>();
    expect((await restoredA.call('/api/information/queue', {revision: control.revision, enabled: true}, 'PUT')).statusCode).toBe(200);
    expect((await settled(store, action.jobId!)).status).toBe('succeeded');
    expect(store.listJobs()).toHaveLength(2); expect(store.listDeliveries()).toHaveLength(2); expect(context.fake.calls).toHaveLength(2);
    expect(lab.get(action.sessionId!, 'b').messages.filter(item => item.role === 'user')).toHaveLength(1);
  });
});
