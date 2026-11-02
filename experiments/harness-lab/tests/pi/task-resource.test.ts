import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { PiLab } from '../../src/pi/lab.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';
import type { ResourceResult } from '../../src/contracts/resource-results.js';
const fault = vi.hoisted(() => ({ mode: '' }));
vi.mock('@earendil-works/pi-coding-agent', async original => {
  const sdk = await original<typeof import('@earendil-works/pi-coding-agent')>();
  return { ...sdk, createAgentSession: async (...args: Parameters<typeof sdk.createAgentSession>) => {
    const result = await sdk.createAgentSession(...args); const after = result.session.agent.afterToolCall;
    result.session.agent.afterToolCall = async context => {
      const old = await after?.(context);
      if (context.toolCall.name === 'task_resource_query' && fault.mode === 'mutate') (context.result.details as {resourceResult: ResourceResult}).resourceResult.items[0].name = 'altered';
      return old;
    }; return result;
  } };
});
const clean: Array<() => Promise<unknown>> = [];
afterEach(async () => { fault.mode = ''; vi.restoreAllMocks(); for (const fn of clean.splice(0).reverse()) await fn(); });
async function setup(reply: Parameters<typeof fakeRuntime>[1], overrides: Partial<ReturnType<typeof testConfig>> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'task-resource-native-')); clean.push(() => rm(dir, { recursive: true, force: true }));
  const config = testConfig(dir, { seatId: 'alpha', testSeats: [{ id: 'alpha', name: '甲' }, { id: 'bravo', name: '乙' }], ...overrides });
  const fake = await fakeRuntime(config, reply), lab = await PiLab.create(config, fake.runtime); clean.push(() => lab.close());
  const session = await lab.createSession(undefined, 'alpha'), actor = lab.annotations!.actorForSeat('alpha');
  const receipt = lab.annotations!.action(actor, session.id, { action: 'create_draft', clientActionId: randomUUID(), baseRef: null, operations: [{ op: 'add_layer', layer: {
    layerId: 'resources', name: '资源', order: 0, defaultVisible: true, features: [
      { objectId: 'r1', kind: 'point', name: '救援车', geometry: { type: 'Point', coordinates: [120, 30] }, resource: { meaning: 'actual_resource', category: 'vehicle', granularity: 'individual', position: { meaning: 'actual', appliesTo: 'resource', evidence: [{ kind: 'declaration', note: '已报告位置' }] } } },
      { objectId: 'area', kind: 'polygon', name: '区域', geometry: { type: 'Polygon', coordinates: [[[119, 29], [121, 29], [121, 31], [119, 31], [119, 29]]] } },
    ],
  } }] });
  return { config, fake, lab, session, actor, ref: receipt.ref! };
}
function lastResource(context: Parameters<Parameters<typeof fakeRuntime>[1]>[0]) {
  const message = context.messages.findLast(m => m.role === 'toolResult' && m.toolName === 'task_resource_query');
  if (!message || message.role !== 'toolResult') throw Error('missing result');
  return JSON.parse(message.content.filter(c => c.type === 'text').map(c => c.text).join('\n')).data as ResourceResult;
}
it('uses actual native query → classify → summarize → read and keeps snapshots across restart', async () => {
  let resourceRef = '', summaryRef = '';
  const s = await setup((context, index) => {
    if (index === 0) return { tools: [{ name: 'task_resource_query', arguments: { operation: 'query', purpose: 'data', annotations: [{ ref: s.ref }] } }] };
    if (index === 1) { resourceRef = lastResource(context).resultRef; return { tools: [{ name: 'spatial_analyze', arguments: { operation: 'classify_points', input: { kind: 'resource', resultRef: resourceRef }, target: { kind: 'annotation', ref: s.ref, objectIds: ['area'] } } }] }; }
    if (index === 2) {
      const message = context.messages.findLast(m => m.role === 'toolResult' && m.toolName === 'spatial_analyze')!;
      const spatial = JSON.parse((message.content as Array<{type: string; text: string}>).filter(c => c.type === 'text').map(c => c.text).join('\n')).data;
      return { tools: [{ name: 'task_resource_query', arguments: { operation: 'summarize', resultRef: resourceRef, spatialResultRef: spatial.resultRef, position: 'interior' } }] };
    }
    if (index === 3) { summaryRef = lastResource(context).resultRef; return { tools: [{ name: 'task_resource_query', arguments: { operation: 'read', resultRef: summaryRef, offset: 0, limit: 1 } }] }; }
    return { text: '完成固定范围查询。' };
  });
  await s.lab.start(s.session.id, '查询并统计区域内资源', {}, 'alpha').run(() => {});
  const before = s.lab.get(s.session.id, 'alpha'), results = before.messages.filter(m => m.role === 'tool');
  expect(results.map(m => [m.toolName, m.isError])).toEqual([['task_resource_query', false], ['spatial_analyze', false], ['task_resource_query', false], ['task_resource_query', false]]);
  expect(results[0].resourceResult!.items.map(item => item.name)).toEqual(['救援车']);
  expect(results[2].resourceResult!.summary.itemCount).toBe(1);
  expect(results[3].resourceResult!.delivery).toEqual({ requestId: results[3].requestId, toolCallId: results[3].toolCallId });
  expect(results[0].text).not.toContain('coordinates');
  await s.lab.close();
  const runtime = await fakeRuntime(s.config, (_c, index) => index % 2 === 0 ? { tools: [{ name: 'task_resource_query', arguments: { operation: 'read', resultRef: resourceRef } }] } : { text: '已读取固定结果' });
  const reopened = await PiLab.create(s.config, runtime.runtime); clean.push(() => reopened.close());
  expect(reopened.get(s.session.id, 'alpha').messages).toEqual(before.messages);
  await reopened.start(s.session.id, '继续读原结果', {}, 'alpha').run(() => {});
  expect(reopened.get(s.session.id, 'alpha').messages.findLast(m => m.toolName === 'task_resource_query')!.isError).toBe(false);
  const other = await reopened.createSession(undefined, 'alpha');
  await reopened.start(other.id, '读别会话的结果', {}, 'alpha').run(() => {});
  expect(reopened.get(other.id, 'alpha').messages.findLast(m => m.toolName === 'task_resource_query')!.text).toContain('RESOURCE_RESULT_NOT_FOUND');
});
it('fails closed after a hook changes successful resource metadata', async () => {
  const s = await setup((_c, index) => index === 0 ? { tools: [{ name: 'task_resource_query', arguments: { operation: 'query', purpose: 'task' } }] } : { text: '结束' });
  fault.mode = 'mutate'; await s.lab.start(s.session.id, '查询资源', {}, 'alpha').run(() => {});
  const message = s.lab.get(s.session.id, 'alpha').messages.find(m => m.toolName === 'task_resource_query')!;
  expect(message.resourceResult).toBeNull(); expect(message.text).not.toContain('救援车'); expect(message.text).not.toContain('altered');
  expect(() => s.lab.start(s.session.id, '继续', {}, 'alpha')).toThrow('完整性校验');
});
it('ordinary recoverable query errors do not poison future requests', async () => {
  const s = await setup((_c, index) => index === 0 ? { tools: [{ name: 'task_resource_query', arguments: { operation: 'read', resultRef: 'resource:missing' } }] } : { text: '请补充范围' });
  await s.lab.start(s.session.id, '读取结果', {}, 'alpha').run(() => {});
  expect(s.lab.get(s.session.id, 'alpha').messages.find(m => m.toolName === 'task_resource_query')!.isError).toBe(true);
  await s.lab.start(s.session.id, '重新说明', {}, 'alpha').run(() => {});
});

it('reads original resource results after actual native automatic compaction', async () => {
  let replies = 0, resultRef = '';
  const s = await setup(context => {
    if (!context.tools?.length) return { text: `摘要：资源结果 ${resultRef} 已生成`, usageInput: 50 };
    replies++;
    if (replies === 1) return { tools: [{ name: 'task_resource_query', arguments: { operation: 'query', purpose: 'task' } }] };
    if (replies === 2) { resultRef = lastResource(context).resultRef; return { text: '查询已完成，等待继续。'.repeat(500), usageInput: 1800 }; }
    if (replies === 3) return { tools: [{ name: 'task_resource_query', arguments: { operation: 'read', resultRef } }] };
    return { text: '原结果已读取' };
  }, { contextWindow: 8192, maxOutputTokens: 6000, compactionReserveTokens: 7000, compactionKeepRecentTokens: 128 });
  await s.lab.start(s.session.id, '查询资源', {}, 'alpha').run(() => {});
  const original = s.lab.get(s.session.id, 'alpha').messages.find(m => m.toolName === 'task_resource_query')!.resourceResult!;
  await s.lab.start(s.session.id, '读取刚才的结果', {}, 'alpha').run(() => {});
  const snapshot = s.lab.get(s.session.id, 'alpha');
  expect(snapshot.latestCompaction).toBeDefined();
  const read = snapshot.messages.findLast(m => m.toolName === 'task_resource_query')!;
  expect(read.isError).toBe(false); expect(read.resourceResult!.items).toEqual(original.items);
});
it('hides revoked annotation dependencies and rejects continuation before invoking the provider', async () => {
  const s = await setup((_c, index) => index === 0 ? { tools: [{ name: 'task_resource_query', arguments: { operation: 'query', purpose: 'task' } }] } : { text: '结束' });
  await s.lab.start(s.session.id, '查询资源', {}, 'alpha').run(() => {});
  const calls = s.fake.calls.length;
  vi.spyOn(s.lab.annotations!, 'version').mockImplementation(() => { throw new Error('revoked'); });
  const tool = s.lab.get(s.session.id, 'alpha').messages.find(m => m.toolName === 'task_resource_query')!;
  expect(tool.resourceResult).toBeNull(); expect(tool.text).not.toContain('救援车');
  expect(() => s.lab.start(s.session.id, '继续统计', {}, 'alpha')).toThrow();
  expect(s.fake.calls).toHaveLength(calls);
});
it('rechecks permission between tool completion and the next provider call in the same request', async () => {
  const s = await setup((_c, index) => index === 0 ? { tools: [{ name: 'task_resource_query', arguments: { operation: 'query', purpose: 'task' } }] } : { text: '此轮不得到达模型' });
  await s.lab.start(s.session.id, '查询并说明', {}, 'alpha').run(event => {
    if (event.type === 'tool.completed' && event.toolName === 'task_resource_query') vi.spyOn(s.lab.annotations!, 'version').mockImplementation(() => { throw new Error('revoked'); });
  });
  expect(s.fake.calls).toHaveLength(1);
  expect(s.lab.get(s.session.id, 'alpha').lastResult!.status).toBe('failed');
});
it('D21 native read pages stay fixed after draft edits and a fresh query observes the new draft',async()=>{
 let ref='';
 const s=await setup((context,index)=>{
  if(index===0||index===6)return {tools:[{name:'task_resource_query',arguments:{operation:'query',purpose:'task'}}]};
  if(index===1){ref=lastResource(context).resultRef;return {text:'固定查询完成'};}
  if(index===2)return {tools:[{name:'task_resource_query',arguments:{operation:'read',resultRef:ref,offset:0,limit:1}}]};
  if(index===4)return {tools:[{name:'task_resource_query',arguments:{operation:'read',resultRef:ref,offset:1,limit:1}}]};
  return {text:'读取完成'};
 });
 const d=s.lab.annotations!.binding(s.actor,s.session.id).draft!;
 s.lab.annotations!.action(s.actor,s.session.id,{action:'apply',clientActionId:randomUUID(),expectedRevision:d.headRevision,operations:[{op:'add_object',layerId:'resources',feature:{objectId:'r2',kind:'point',name:'第二辆',geometry:{type:'Point',coordinates:[120.1,30]},resource:{meaning:'actual_resource'}}}]});
 await s.lab.start(s.session.id,'查资源',{},'alpha').run(()=>{});
 const original=s.lab.get(s.session.id,'alpha').messages.find(m=>m.resourceResult)!.resourceResult!;
 const head=s.lab.annotations!.binding(s.actor,s.session.id).draft!;s.lab.annotations!.action(s.actor,s.session.id,{action:'apply',clientActionId:randomUUID(),expectedRevision:head.headRevision,operations:[{op:'update_object',objectId:'r1',changes:{name:'新的救援车名'}}]});
 for(const text of ['第一页','第二页','重新查询'])await s.lab.start(s.session.id,text,{},'alpha').run(()=>{});
 const results=s.lab.get(s.session.id,'alpha').messages.filter(m=>m.resourceResult);
 expect(results).toHaveLength(4);expect(results[1].resourceResult!.items).toEqual(original.items);expect(results[2].resourceResult!.summary).toEqual(original.summary);
 expect(JSON.parse(results[1].text).data.page).toMatchObject({offset:0,total:2,hasMore:true});expect(JSON.parse(results[2].text).data.page).toMatchObject({offset:1,total:2,hasMore:false});
 expect(results[3].resourceResult!.items[0].name).toBe('新的救援车名');
});

it('B3 T17/T19 follows explicit area selection through deployed Skill and actual assigned/available statistics', async () => {
  let queryRef = '';
  const s = await setup((context, index) => {
    if (index === 0) return { tools: [{ name: 'skill_read', arguments: { id: 'spatial-analysis' } }] };
    if (index === 1) return { tools: [{ name: 'task_resource_query', arguments: { operation: 'query', purpose: 'task' } }] };
    if (index === 2) {
      queryRef = lastResource(context).resultRef;
      return { tools: [{ name: 'spatial_analyze', arguments: { operation: 'classify_points', input: { kind: 'resource', resultRef: queryRef }, target: { kind: 'annotation', ref: chosen, objectIds: ['area'] } } }] };
    }
    if (index === 3) {
      const message = context.messages.findLast(m => m.role === 'toolResult' && m.toolName === 'spatial_analyze')!;
      const result = JSON.parse((message.content as Array<{type:string;text:string}>).filter(c => c.type === 'text').map(c => c.text).join('\n')).data;
      return { tools: [{ name: 'task_resource_query', arguments: { operation: 'summarize', resultRef: queryRef, spatialResultRef: result.resultRef, relation: 'assigned', availability: 'available', position: 'interior' } }] };
    }
    if (index === 4) return { tools: [{ name: 'task_resource_query', arguments: { operation: 'read', resultRef: lastResource(context).resultRef, offset: 0, limit: 1 } }] };
    return { text: '已完成指定范围的资源统计；未知信息仍需核验。' };
  });
  const binding = s.lab.annotations!.binding(s.actor, s.session.id);
  const evidence = [{ kind: 'declaration' as const, note: '受控测试中的明确资源报告' }];
  const resource = { meaning: 'actual_resource' as const, category: 'vehicle' as const, granularity: 'individual' as const,
    quantity: { value: 1, unit: '辆' as const, meaning: 'entities' as const, scope: '测试个体', evidence },
    taskRelations: [{ taskId: binding.taskId, relation: 'assigned' as const, evidence }],
    availability: { state: 'available' as const, evidence }, position: { meaning: 'actual' as const, appliesTo: 'resource' as const, evidence } };
  const update = s.lab.annotations!.action(s.actor, s.session.id, { action: 'apply', clientActionId: randomUUID(), expectedRevision: 1, operations: [
    { op: 'update_object', objectId: 'r1', changes: { resource } },
    { op: 'add_object', layerId: 'resources', feature: { objectId: 'r2', kind: 'point', name: '故障车', geometry: { type: 'Point', coordinates: [120, 30] }, resource: { ...resource, availability: { state: 'unavailable', evidence } } } },
    { op: 'add_object', layerId: 'resources', feature: { objectId: 'r3', kind: 'point', name: '位置待核验车', geometry: { type: 'Point', coordinates: [120, 30] }, resource: { ...resource, position: { meaning: 'planned', appliesTo: 'resource', evidence } } } },
  ] });
  const chosen = update.ref!, skill = await s.lab.resources.readSkill(s.session.workspaceId, 'spatial-analysis');
  const request = s.lab.start(s.session.id, '只统计所引用区域内部、本任务已分配且可用的车辆，列出未知位置。', { annotationRefs: [{ ...chosen, objectIds: ['area'] }] }, 'alpha');
  await request.run(() => {});
  const snapshot = s.lab.get(s.session.id, 'alpha'), tools = snapshot.messages.filter(m => m.role === 'tool');
  expect(tools.map(m => [m.toolName, m.isError])).toEqual([['skill.read', false], ['task_resource_query', false], ['spatial_analyze', false], ['task_resource_query', false], ['task_resource_query', false]]);
  expect(s.fake.calls[0].context.systemPrompt).toContain(skill.description);
  expect(JSON.stringify(s.fake.calls[0].context)).not.toContain(skill.content);
  expect(s.lab.getRequestResources(s.session.id, request.requestId, 'alpha')).toMatchObject({ readSkills: [skill] });
  expect(skill.version).toBe('2');
  expect(snapshot.messages.find(m => m.role === 'user')?.selections?.annotationRefs?.[0]).toMatchObject({ ref: chosen, objectIds: ['area'] });
  const summary = tools[3].resourceResult!;
  expect(summary.items.map(i => i.name)).toEqual(['救援车']);
  expect(summary.statisticsScope).toMatchObject({ relation: 'assigned', availability: 'available' });
  expect(summary.summary.quantities).toEqual([expect.objectContaining({ value: 1, unit: '辆', meaning: 'entities' })]);
  expect(summary.spatialCoverage).toMatchObject({ status: 'partial', candidateCount: 2, totalCandidateCount: 3, unclassified: [expect.objectContaining({ reason: expect.stringContaining('计划') })] });
  expect(summary.summary.entityCount).toBeNull();
  expect(tools[4].resourceResult!.items).toEqual(summary.items);
  expect(s.lab.annotations!.binding(s.actor, s.session.id).draft?.headRevision).toBe(2);
});
