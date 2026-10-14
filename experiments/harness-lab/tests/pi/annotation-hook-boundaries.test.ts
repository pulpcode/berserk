import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ContextService } from '../../src/context/service.js';
import { PiLab } from '../../src/pi/lab.js';
import { AnnotationRequestState } from '../../src/pi/annotation-state.js';
import { annotationTools } from '../../src/pi/annotation-tools.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';

const fault = vi.hoisted(() => ({tool: '', mode: 'error' as 'error' | 'throw' | 'content'}));
// Inject only a public SDK hook before the host chains it; the native loop and tools remain real.
vi.mock('@earendil-works/pi-coding-agent', async importOriginal => {
  const sdk = await importOriginal<typeof import('@earendil-works/pi-coding-agent')>();
  return {...sdk, createAgentSession: async (...args: Parameters<typeof sdk.createAgentSession>) => {
    const result = await sdk.createAgentSession(...args), original = result.session.agent.afterToolCall;
    result.session.agent.afterToolCall = async context => {
      const prior = await original?.(context);
      if (context.toolCall.name !== fault.tool) return prior;
      if (fault.mode === 'throw') throw new Error('synthetic original hook failure');
      if (fault.mode === 'content') return {...prior, content: [{type: 'text', text: 'overridden tool result'}]};
      return {...prior, isError: true};
    };
    return result;
  }};
});
const clean: Array<() => Promise<unknown>> = [];
afterEach(async () => { fault.tool = ''; vi.restoreAllMocks(); for (const close of clean.splice(0).reverse()) await close(); });
const sourceRef = {systemId: 'situation', objectType: 'area', objectId: 'area'};
const read = {name: 'annotation_read', arguments: {mode: 'draft'}};
const query = {name: 'situation_query', arguments: {systemId: 'situation', mode: 'current'}};
const write = {name: 'annotation_action', arguments: {action: 'apply', operations: [{op: 'rename_set', title: '已修改'}]}};
async function setup(reply: Parameters<typeof fakeRuntime>[1]) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-map-hooks-')); clean.push(() => rm(dir, {force: true, recursive: true}));
  const config = testConfig(dir, {seatId: 'alpha', testSeats: [{id: 'alpha', name: '甲'}]});
  const fake = await fakeRuntime(config, reply), lab = await PiLab.create(config, fake.runtime); clean.push(() => lab.close());
  const context = new ContextService({systems: [{id: 'situation', name: '态势', adapter: 'mock-situation-http', baseUrl: 'http://127.0.0.1:4401', tokenEnv: 'TEST_TOKEN'}],
    scopes: [{id: 'visible', name: '合成范围', systemIds: ['situation'], seatIds: ['alpha']}]}, {TEST_TOKEN: 'synthetic'}, {fetch: async () => new Response(JSON.stringify({
      systemId: 'situation', asOf: '2026-10-01T01:20:00Z', items: [{ref: sourceRef, revision: 2, name: '区域', areaIds: [], effectiveAt: null, validTime: null,
        geometry: {type: 'Polygon', coordinates: [[[103,1],[104,1],[104,2],[103,1]]]}, properties: {memberRefs: []}}], limit: 20,
      nextCursor: null, hasMore: false, timeUnknownCount: 0, unknownRefs: [], changeCursor: 'cursor',
    }), {headers: {'content-type': 'application/json'}})});
  lab.context = context; lab.annotations!.context = context;
  const session = await lab.createSession(undefined, 'alpha'), actor = lab.annotations!.actorForSeat('alpha');
  const taskId = lab.workspaces.get(session.workspaceId, 'alpha').taskSpaceId!;
  lab.annotations!.action(actor, session.id, {action: 'create_draft', clientActionId: randomUUID(), baseRef: null,
    operations: [{op: 'add_layer', layer: {layerId: 'target', name: '目标层', order: 0, defaultVisible: true, features: []}}]});
  return {lab, session, actor, taskId};
}
it.each(['annotation_read', 'situation_query'])('does not promote %s results marked as errors by an original public hook', async tool => {
  fault.tool = tool; fault.mode = 'error';
  const {lab, session, actor} = await setup((_context, index) => index === 0 ? {tools: [read, query]} : index === 1 ? {tools: [{name: 'annotation_from_source', arguments: {
    items: [{mode: 'add', sourceRef, layerId: 'target', objectId: 'new'}],
  }}]} : {text: '停止'});
  await lab.start(session.id, '导入区域', {}, 'alpha').run(() => {});
  const messages = lab.get(session.id, 'alpha').messages;
  expect(messages.find(message => message.toolName === tool)).toMatchObject({isError: true});
  expect(messages.find(message => message.toolName === 'annotation_from_source')).toMatchObject({isError: true});
  expect(lab.annotations!.binding(actor, session.id).draft?.headRevision).toBe(1);
});
it('stops the native loop on an original after hook exception after a real commit', async () => {
  fault.tool = 'annotation_action'; fault.mode = 'throw';
  const {lab, session, actor} = await setup((_context, index) => index === 0 ? {tools: [read]} : {tools: [write, write]});
  await lab.start(session.id, '编辑两次', {}, 'alpha').run(() => {});
  expect(lab.get(session.id, 'alpha').lastResult?.status).toBe('failed');
  expect(lab.annotations!.binding(actor, session.id).draft).toMatchObject({headRevision: 2, title: '已修改'});
});
it('invalidates an unseen successful read when the original hook replaces its content', async () => {
  fault.tool = 'annotation_read'; fault.mode = 'content';
  const {lab, session, actor} = await setup((_context, index) => index === 0 ? {tools: [read]} : index === 1 ? {tools: [write]} : {text: '停止'});
  await lab.start(session.id, '编辑', {}, 'alpha').run(() => {});
  expect(lab.get(session.id, 'alpha').messages.find(message => message.toolName === 'annotation_action')).toMatchObject({isError: true});
  expect(lab.annotations!.binding(actor, session.id).draft?.headRevision).toBe(1);
});
it('clears direct adapter bases if cancellation arrives after commit but before the final execution check', async () => {
  const {lab, session, actor, taskId} = await setup(() => ({text: 'unused'}));
  const state = new AnnotationRequestState(), controller = new AbortController();
  state.observeDraft(lab.annotations!.binding(actor, session.id)); state.beginInference();
  const original = lab.annotations!.actionFromHost.bind(lab.annotations!);
  vi.spyOn(lab.annotations!, 'actionFromHost').mockImplementationOnce((...args) => { const result = original(...args); controller.abort(); return result; });
  const action = annotationTools(lab.annotations!, {actor, taskId, sessionId: session.id, requestId: randomUUID(), signal: controller.signal, check: () => {}, state}).find(tool => tool.name === 'annotation_action')!;
  await expect(action.execute('cancelled', write.arguments as never, undefined, undefined, {} as never)).rejects.toThrow();
  expect(() => state.draftBasis()).toThrow('重新读取');
  expect(lab.annotations!.binding(actor, session.id).draft?.headRevision).toBe(2);
});
