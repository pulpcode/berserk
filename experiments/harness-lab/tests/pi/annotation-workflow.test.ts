import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ContextService } from '../../src/context/service.js';
import type { SituationCurrent, SituationObject } from '../../src/contracts/context.js';
import type { LabConfig } from '../../src/server/config.js';
import { PiLab } from '../../src/pi/lab.js';
import { AnnotationRequestState } from '../../src/pi/annotation-state.js';
import { annotationTools } from '../../src/pi/annotation-tools.js';
import { fakeRuntime, testConfig, type Reply } from './fake-runtime.js';

const clean: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of clean.splice(0).reverse()) await close(); });
const refs = ['area', 'road', 'resource'].map(objectType => ({systemId: 'situation', objectType, objectId: objectType}));
const draftRead = {name: 'annotation_read', arguments: {mode: 'draft'}};
const sourceRead = {name: 'situation_query', arguments: {systemId: 'situation', mode: 'current'}};
const rename = (title: string) => ({name: 'annotation_action', arguments: {action: 'apply', operations: [{op: 'rename_set', title}]}});
const imports = refs.map((sourceRef, index) => ({name: 'annotation_from_source', arguments: {items: [{mode: 'add', sourceRef, layerId: 'target', objectId: `object-${index}`} ]}}));
async function setup(reply: Parameters<typeof fakeRuntime>[1], overrides: Partial<LabConfig> = {}, empty = false) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-map-workflow-')); clean.push(() => rm(dir, {recursive: true, force: true}));
  const config = testConfig(dir, {seatId: 'alpha', testSeats: [{id: 'alpha', name: '甲'}], ...overrides});
  const objects: SituationObject[] = refs.map((ref, index) => ({ref, revision: 2, name: ref.objectType, areaIds: [], effectiveAt: null, validTime: null,
    geometry: index === 0 ? {type: 'Polygon', coordinates: [[[103,1],[104,1],[104,2],[103,1]]]} : index === 1 ? {type: 'LineString', coordinates: [[103,1],[104,2]]} : {type: 'Point', coordinates: [103,1]}, properties: index === 0 ? {memberRefs: []} : index === 1 ? {passability: 'open'} : {availableCount: 3, unit: '辆'}}));
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    const body: SituationCurrent = {systemId: 'situation', asOf: '2026-10-01T01:20:00Z', items: objects, limit: 20,
      nextCursor: null, hasMore: false, timeUnknownCount: 0, unknownRefs: [], changeCursor: 'cursor'};
    return new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}});
  });
  const context = new ContextService({systems: [{id: 'situation', name: '态势', adapter: 'mock-situation-http', baseUrl: 'http://127.0.0.1:4401', tokenEnv: 'TEST_QUERY_TOKEN'}],
    scopes: [{id: 'visible', name: '合成范围', systemIds: ['situation'], seatIds: ['alpha']}]}, {TEST_QUERY_TOKEN: 'synthetic'}, {fetch});
  const fake = await fakeRuntime(config, reply);
  const lab = await PiLab.create(config, fake.runtime); clean.push(() => lab.close());
  lab.context = context; lab.annotations!.context = context;
  const session = await lab.createSession(undefined, 'alpha'), actor = lab.annotations!.actorForSeat('alpha');
  const taskId = lab.workspaces.get(session.workspaceId, 'alpha').taskSpaceId!;
  if (!empty) lab.annotations!.action(actor, session.id, {action: 'create_draft', clientActionId: randomUUID(), baseRef: null,
    operations: [{op: 'add_layer', layer: {layerId: 'target', name: '目标层', order: 0, defaultVisible: true, features: []}}]});
  return {lab, session, actor, taskId, fetch, objects, config, ...fake};
}

it('runs three source writes from one assistant output sequentially using its own successful CAS chain', async () => {
  const {lab, session, actor, taskId, calls, fetch, objects} = await setup((_context, index) => index === 0 ? {tools: [draftRead, sourceRead]} : index === 1 ? {tools: imports} : {text: '已保存三个对象'});
  await lab.start(session.id, '添加三个已查询对象', {}, 'alpha').run(() => {});
  const snapshot = lab.get(session.id, 'alpha');
  const results = snapshot.messages.filter(message => message.toolName === 'annotation_from_source');
  expect(results).toHaveLength(3); expect(results.filter(message => message.isError).map(message => message.text)).toEqual([]);
  const receipts = results.map(message => JSON.parse(message.text));
  expect(receipts.map(receipt => [receipt.beforeRef.revision, receipt.afterRef.revision])).toEqual([[1,2],[2,3],[3,4]]);
  const features = lab.annotations!.version(actor, taskId, receipts[2].afterRef).document.layers[0].features;
  expect(features.map(feature => feature.geometry)).toEqual(objects.map(object => object.geometry));
  expect(fetch).toHaveBeenCalledTimes(4);
  const schemas = calls[0].context.tools!.filter(tool => tool.name === 'annotation_action' || tool.name === 'annotation_from_source');
  expect(JSON.stringify(schemas)).not.toMatch(/expectedRevision|expectedSourceRevision|expectedCurrentSequence/);
});

it('does not use a draft read in the same output to justify a pre-generated write; reread in a later inference recovers', async () => {
  const {lab, session, actor} = await setup((_context, index) => [
    {tools: [draftRead, rename('不得执行')]}, {tools: [rename('仍未读')]}, {tools: [draftRead]}, {tools: [rename('已重读')]}, {text: '结束'},
  ][index] as Reply);
  await lab.start(session.id, '修改标题', {}, 'alpha').run(() => {});
  const writes = lab.get(session.id, 'alpha').messages.filter(message => message.toolName === 'annotation_action');
  expect(writes.map(message => Boolean(message.isError))).toEqual([true,true,false]);
  expect(writes[0].text).toContain('ANNOTATION_READ_REQUIRED');
  expect(lab.annotations!.binding(actor, session.id).draft).toMatchObject({headRevision: 2, title: '已重读'});
});

it('requires source observations from an earlier inference as well as a draft read', async () => {
  const {lab, session, actor, fetch} = await setup((_context, index) => index === 0 ? {tools: [draftRead]} : index === 1 ? {tools: [sourceRead, imports[0], imports[1]]} : {text: '停止'});
  await lab.start(session.id, '导入来源', {}, 'alpha').run(() => {});
  const writes = lab.get(session.id, 'alpha').messages.filter(message => message.toolName === 'annotation_from_source');
  expect(writes.map(message => Boolean(message.isError))).toEqual([true,true]);
  expect(writes[0].text).toContain('SOURCE_READ_REQUIRED');
  expect(fetch).toHaveBeenCalledTimes(1); expect(lab.annotations!.binding(actor, session.id).draft?.headRevision).toBe(1);
});

it('does not absorb an external write inserted between two same-output writes', async () => {
  const {lab, session, actor} = await setup((_context, index) => index === 0 ? {tools: [draftRead]} : index === 1 ? {tools: [rename('本链第一步'), rename('不得覆盖'), rename('必须停止')]} : {text: '保留外部修改'});
  let inserted = false;
  await lab.start(session.id, '连续编辑', {}, 'alpha').run(event => {
    if (event.type === 'tool.completed' && event.toolName === 'annotation_action' && !inserted) {
      inserted = true;
      lab.annotations!.action(actor, session.id, {action: 'apply', clientActionId: randomUUID(), expectedRevision: 2, operations: [{op: 'rename_set', title: '人工保存'}]});
    }
  });
  const writes = lab.get(session.id, 'alpha').messages.filter(message => message.toolName === 'annotation_action');
  expect(writes.map(message => Boolean(message.isError))).toEqual([false,true,true]);
  expect(writes[1].text).toContain('CONFLICT'); expect(writes[2].text).toContain('ANNOTATION_READ_REQUIRED');
  expect(lab.annotations!.binding(actor, session.id).draft).toMatchObject({headRevision: 3, title: '人工保存'});
});

it('blocks subsequent writes after a schema error even though the invalid call never entered execute', async () => {
  const {lab, session, actor} = await setup((_context, index) => index === 0 ? {tools: [draftRead]} : index === 1 ? {tools: [
    {name: 'annotation_action', arguments: {action: 'apply'}}, rename('不得继续'),
  ]} : {text: '停止'});
  await lab.start(session.id, '编辑', {}, 'alpha').run(() => {});
  const writes = lab.get(session.id, 'alpha').messages.filter(message => message.toolName === 'annotation_action');
  expect(writes.map(message => Boolean(message.isError))).toEqual([true,true]);
  expect(lab.annotations!.binding(actor, session.id).draft?.headRevision).toBe(1);
});

it('creates from an observed empty draft and advances immediately for a following same-output edit', async () => {
  const {lab, session, actor} = await setup((_context, index) => index === 0 ? {tools: [draftRead]} : index === 1 ? {tools: [
    {name: 'annotation_action', arguments: {action: 'create_draft', baseRef: null, title: '新图'}}, rename('新标题'),
  ]} : {text: '已保存'}, {}, true);
  await lab.start(session.id, '创建空白地图', {}, 'alpha').run(() => {});
  const writes = lab.get(session.id, 'alpha').messages.filter(message => message.toolName === 'annotation_action');
  expect(writes.map(message => Boolean(message.isError))).toEqual([false,false]);
  expect(JSON.parse(writes[0].text).beforeRef).toBeNull();
  expect(lab.annotations!.binding(actor, session.id).draft).toMatchObject({headRevision: 2, title: '新标题'});
});

it('keeps replay receipts identifiable and never uses an old receipt to rewind the next write', async () => {
  const {lab, session, actor, taskId} = await setup(() => ({text: 'unused'}));
  const state = new AnnotationRequestState(); const controller = new AbortController();
  state.observeDraft(lab.annotations!.binding(actor, session.id)); state.beginInference();
  const tools = annotationTools(lab.annotations!, {actor, taskId, sessionId: session.id, requestId: randomUUID(), signal: controller.signal, check: () => {}, state});
  const action = tools.find(tool => tool.name === 'annotation_action')!;
  const execute = (callId: string, title: string) => action.execute(callId, rename(title).arguments as never, undefined, undefined, {} as never);
  await execute('a', 'A'); await execute('b', 'B');
  const replay = await execute('a', 'A');
  expect(JSON.parse((replay.content[0] as {text: string}).text)).toMatchObject({replayed: true, afterRef: {revision: 2}});
  await execute('c', 'C'); expect(lab.annotations!.binding(actor, session.id).draft?.headRevision).toBe(4);
  state.invalidate(); await execute('a', 'A');
  await expect(execute('d', 'D')).rejects.toThrow('ANNOTATION_READ_REQUIRED');
  await expect(execute('a', 'altered')).rejects.toThrow('CONFLICT');
});

it.each(['followUp', 'steer'] as const)('invalidates editing bases when native %s input is actually consumed', async mode => {
  const {lab, session, actor} = await setup((_context, index) => index === 0 ? {tools: [draftRead]} : index === (mode === 'followUp' ? 2 : 1) ? {tools: [rename('需重读')]} : {text: '停止'});
  const request = lab.start(session.id, '读草稿', {}, 'alpha'); let sent = false;
  await request.run(event => {
    if (!sent && event.type === 'tool.completed' && event.toolName === 'annotation_read') {
      sent = true; lab.submitInput(session.id, {submissionId: randomUUID(), expectedRequestId: request.requestId, text: '新的编辑要求', mode});
    }
  });
  const result = lab.get(session.id, 'alpha');
  expect(result.messages.find(message => message.toolName === 'annotation_action')).toMatchObject({isError: true, text: expect.stringContaining('ANNOTATION_READ_REQUIRED')});
  expect(lab.annotations!.binding(actor, session.id).draft?.headRevision).toBe(1);
});

it('retains committed data on cancellation and does not carry edit bases into the next request', async () => {
  let phase = 0;
  const {lab, session, actor} = await setup((_context, index) => phase === 1 ? {tools: index < 3 ? [rename('重读前不得改')] : [] , text: index < 3 ? undefined : '结束'}
    : index === 0 ? {tools: [draftRead]} : {tools: [rename('已提交'), rename('取消后不得改')]});
  const request = lab.start(session.id, '两步编辑', {}, 'alpha');
  await request.run(event => { if (event.type === 'tool.completed' && event.toolName === 'annotation_action') lab.cancel(session.id, request.requestId); });
  expect(lab.annotations!.binding(actor, session.id).draft).toMatchObject({headRevision: 2, title: '已提交'});
  phase = 1; await lab.start(session.id, '继续', {}, 'alpha').run(() => {});
  expect(lab.get(session.id, 'alpha').messages.findLast(message => message.toolName === 'annotation_action')).toMatchObject({isError: true});
  expect(lab.annotations!.binding(actor, session.id).draft?.headRevision).toBe(2);
});

it('invalidates bases after native automatic compaction even when the summary mentions the old revision', async () => {
  let replies = 0; let priming = true;
  const {lab, session, actor, calls} = await setup(context => {
    if (priming) return {text: '此前讨论地图需求。'.repeat(250)};
    if (!context.tools?.length) return {text: '摘要：已经读取草稿第 1 版，可以重命名。', usageInput: 50};
    replies++;
    if (replies === 1) return {tools: [draftRead], usageInput: 1800};
    if (replies === 2) return {tools: [rename('不得信任摘要')]};
    return {text: '需要重新读取'};
  }, {contextWindow: 8192, maxOutputTokens: 6000, compactionReserveTokens: 7000, compactionKeepRecentTokens: 128});
  await lab.start(session.id, '预先讨论地图', {}, 'alpha').run(() => {});
  priming = false;
  await lab.start(session.id, '读取后修改标题', {}, 'alpha').run(() => {});
  expect(calls.some(call => !call.context.tools?.length), JSON.stringify(lab.get(session.id, 'alpha').lastResult)).toBe(true);
  expect(lab.get(session.id, 'alpha').messages.find(message => message.toolName === 'annotation_action')).toMatchObject({isError: true, text: expect.stringContaining('ANNOTATION_READ_REQUIRED')});
  expect(lab.annotations!.binding(actor, session.id).draft?.headRevision).toBe(1);
});

it('does not establish edit authority by reading a fixed historical reference', async () => {
  const selected: {ref?: unknown} = {};
  const {lab, session, actor} = await setup((_context, index) => index === 0 ? {tools: [{name: 'annotation_read', arguments: {mode: 'read', ref: selected.ref}}]} : index === 1 ? {tools: [rename('不得切换目标')]} : {text: '停止'});
  const draft = lab.annotations!.binding(actor, session.id).draft!; selected.ref = {setId: draft.setId, revision: draft.headRevision};
  await lab.start(session.id, '查看固定版本后修改', {}, 'alpha').run(() => {});
  expect(lab.get(session.id, 'alpha').messages.find(message => message.toolName === 'annotation_action')).toMatchObject({isError: true, text: expect.stringContaining('ANNOTATION_READ_REQUIRED')});
  expect(lab.annotations!.binding(actor, session.id).draft?.headRevision).toBe(1);
});

it('requires observed current sequence and rejects external adoption without absorbing its latest value', async () => {
  let publicationId = ''; let intervene = () => {};
  const {lab, session, actor, taskId} = await setup((_context, index) => {
    if (index === 0) return {tools: [{name: 'annotation_list', arguments: {}}]};
    if (index === 1) { intervene(); return {tools: [{name: 'annotation_action', arguments: {action: 'set_current', publicationId}}]}; }
    return {text: '保留当前设定'};
  });
  publicationId = lab.annotations!.action(actor, session.id, {action: 'publish', revision: 1, title: '测试发布', clientActionId: randomUUID()}).publication!.publicationId;
  intervene = () => { lab.annotations!.setCurrent(actor, taskId, {publicationId, expectedCurrentSequence: 0, clientActionId: randomUUID()}); };
  await lab.start(session.id, '设为当前', {}, 'alpha').run(() => {});
  expect(lab.get(session.id, 'alpha').messages.find(message => message.toolName === 'annotation_action')).toMatchObject({isError: true, text: expect.stringContaining('CONFLICT')});
  expect(lab.annotations!.current(actor, taskId).sequence).toBe(1);
});

it('stops later writes when a committed service result is lost and recovers only through the original receipt', async () => {
  const {lab, session, actor} = await setup((_context, index) => index === 0 ? {tools: [draftRead]} : index === 1 ? {tools: [rename('已提交但返回失败'), rename('不得继续')]} : {text: '需核对回执'});
  const original = lab.annotations!.actionFromHost.bind(lab.annotations!);
  const spy = vi.spyOn(lab.annotations!, 'actionFromHost').mockImplementationOnce((...args) => { original(...args); throw new Error('synthetic result delivery failure'); });
  const request = lab.start(session.id, '编辑', {}, 'alpha');
  await request.run(() => {});
  const writes = lab.get(session.id, 'alpha').messages.filter(message => message.toolName === 'annotation_action');
  expect(writes.map(message => Boolean(message.isError))).toEqual([true,true]);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(lab.annotations!.binding(actor, session.id).draft).toMatchObject({headRevision: 2, title: '已提交但返回失败'});
});

it('retains known bases through a native transient model retry without replaying the completed write', async () => {
  const {lab, session, actor} = await setup((_context, index) => index === 0 ? {tools: [draftRead]} : index === 1 ? {tools: [rename('第一步')]}
    : index === 2 ? {error: '503 overloaded'} : index === 3 ? {tools: [rename('第二步')]} : {text: '完成'});
  await lab.start(session.id, '两步修改', {}, 'alpha').run(() => {});
  const writes = lab.get(session.id, 'alpha').messages.filter(message => message.toolName === 'annotation_action');
  expect(writes).toHaveLength(2); expect(writes.every(message => !message.isError)).toBe(true);
  expect(lab.annotations!.binding(actor, session.id).draft).toMatchObject({headRevision: 3, title: '第二步'});
}, 15000);
