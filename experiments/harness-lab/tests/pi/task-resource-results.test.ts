import oldOverlap from './fixtures/resource-result-v1-overlap.json';
import { summarizeResources } from '../../src/contracts/resource-summary.js';
import { expect, it } from 'vitest';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { resolveResourceResult, resourceToolResult, resolveResourceMessage, resourceUserMessages, validateResourceDelivery } from '../../src/pi/task-resource-results.js';
import { resourceResultValid, type ResourceResult } from '../../src/contracts/resource-results.js';
import { RESOURCE_ENTRY } from '../../src/pi/resource-tools.js';
import { recordedComposerText, decodeComposerInput } from '../../src/pi/composer-input.js';
import type { SituationCurrent } from '../../src/contracts/context.js';
import legacy from './fixtures/composer-input-v4.json';
const result: ResourceResult = {
  schemaVersion: 1, resultRef: 'resource:request:call', requestId: 'request', toolCallId: 'call', createdAt: '2026-11-02T00:00:00Z',
  owner: { userId: 'user', seatId: 'seat', taskId: 'task', sessionId: 'session' }, parameters: { operation: 'query', purpose: 'task' },
  statisticsScope:{at:'2026-11-02T00:00:00Z',relation:'related',availability:'all'},
  records: [], items: [], coverage: [], relationshipCoverage: { status: 'partial', reason: '没有关联' }, dependencies: { systemIds: [], annotations: [] }, messages: [], exclusions: [],
  summary: { recordCount: 0, itemCount: 0, knownEntityCount: 0, entityCount: null, quantities: [], limitations: [] },
};
function branch() {
  return [{ type: 'custom', customType: RESOURCE_ENTRY, data: { requestId: 'request' } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'call', name: 'task_resource_query', arguments: result.parameters }] } },
    { type: 'message', message: { role: 'toolResult', toolCallId: 'call', toolName: 'task_resource_query', isError: false, ...resourceToolResult(result) } },
  ] as unknown as SessionEntry[];
}
it('uses original successful native evidence and does not accept a copied result without its call', () => {
  expect(resolveResourceResult(branch(), result.resultRef)).toEqual(result);
  expect(() => resolveResourceResult(branch().slice(2), result.resultRef)).toThrow('没有可验证');
  expect(() => resolveResourceResult([...branch(), ...branch()], result.resultRef)).toThrow('不唯一');
});
it.each(['args', 'text', 'details', 'request', 'call', 'error', 'delivery'])('rejects %s tampering as result authority', field => {
  const entries = branch();
  const origin = entries[2] as Extract<SessionEntry, {type: 'message'}>;
  if (origin.message.role !== 'toolResult') throw Error();
  if (field === 'args') {
    const assistant = entries[1] as Extract<SessionEntry, {type: 'message'}>;
    if (assistant.message.role === 'assistant' && assistant.message.content[0].type === 'toolCall') assistant.message.content[0].arguments = { operation: 'query', purpose: 'data' };
  } else if (field === 'text') origin.message.content = [{ type: 'text', text: '复制结果' }];
  else if (field === 'error') origin.message.isError = true;
  else {
    const changed = structuredClone(result);
    if (field === 'details') changed.summary.itemCount = 10;
    if (field === 'request') changed.requestId = 'other';
    if (field === 'call') changed.toolCallId = 'other';
    if (field === 'delivery') changed.delivery = { requestId: 'request', toolCallId: 'call' };
    Object.assign(origin.message, resourceToolResult(changed));
    if (field === 'details') origin.message.content = resourceToolResult(result).content;
  }
  expect(() => resolveResourceResult(entries, result.resultRef)).toThrow('没有可验证');
});
it('read delivery preserves origin identity and validates its actual page request', () => {
  const delivery = { ...result, delivery: { requestId: 'read-request', toolCallId: 'read-call' } };
  const entries = [...branch(), { type: 'custom', customType: RESOURCE_ENTRY, data: { requestId: 'read-request' } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'read-call', name: 'task_resource_query', arguments: { operation: 'read', resultRef: result.resultRef, limit: 1 } }] } },
    { type: 'message', message: { role: 'toolResult', toolName: 'task_resource_query', toolCallId: 'read-call', isError: false, ...resourceToolResult(delivery, 0, 1) } },
  ] as unknown as SessionEntry[];
  expect(() => validateResourceDelivery(entries, delivery)).not.toThrow();
  expect(resolveResourceResult(entries, result.resultRef)).toEqual(result);
  Object.assign((entries.at(-1) as Extract<SessionEntry, {type: 'message'}>).message, resourceToolResult(delivery, 1, 1));
  expect(() => validateResourceDelivery(entries, delivery)).toThrow('读回');
});
it('does not treat assistant prose, compaction summaries, unselected users or road selections as resource reports', () => {
  const fixture = legacy.fixtures[0], record = fixture.record;
  const entries = [{ type: 'custom', customType: RESOURCE_ENTRY, data: { requestId: record.requestId } },
    { type: 'custom_message', customType: fixture.type, details: record, display: false, content: recordedComposerText(decodeComposerInput(record, record.workspaceId, record.sessionId, fixture.type), fixture.type) },
    { id: 'user', type: 'message', message: { role: 'user', content: '它坏了' } },
    { id: 'assistant', type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: '资源可用' }] } },
    { id: 'summary', type: 'compaction', summary: '资源可用' },
  ] as unknown as SessionEntry[];
  expect(resourceUserMessages(entries, record.workspaceId, record.sessionId)).toEqual([]);
  for (const id of ['user', 'assistant', 'summary', 'foreign']) expect(() => resolveResourceMessage(entries, record.workspaceId, record.sessionId, id)).toThrow('真实用户消息');
});

it('resolves only the first real user report bound to verified resource selections', () => {
  const fixture = legacy.fixtures[0];
  const record = decodeComposerInput(fixture.record, fixture.record.workspaceId, fixture.record.sessionId, fixture.type);
  const ref = { systemId: 'situation', objectType: 'resource', objectId: 'r1' };
  record.context!.refs = [ref]; const query = record.context!.queries[0].query; if (!('mode' in query)) throw Error(); query.objectRefs = [ref];
  const data = record.context!.queries[0].data as SituationCurrent;
  data.items[0].ref = ref; data.items[0].properties = { availableCount: 1, unit: '辆' };
  const entries = [{ type: 'custom', customType: RESOURCE_ENTRY, data: { requestId: record.requestId } },
    { type: 'custom_message', customType: fixture.type, details: record, display: false, content: recordedComposerText(record, fixture.type) },
    { id: 'real-user', type: 'message', message: { role: 'user', content: 'R1在12:00故障。' } },
    { id: 'later-user', type: 'message', message: { role: 'user', content: '它恢复了。' } },
    { id: 'assistant', type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'R1可用' }] } },
  ] as unknown as SessionEntry[];
  expect(resolveResourceMessage(entries, record.workspaceId, record.sessionId, 'real-user')).toEqual({ text: 'R1在12:00故障。', resourceRefs: [ref] });
  expect(() => resolveResourceMessage(entries, record.workspaceId, record.sessionId, 'later-user')).toThrow('真实用户消息');
  expect(() => resolveResourceMessage(entries, record.workspaceId, record.sessionId, 'assistant')).toThrow('真实用户消息');
  expect(() => resolveResourceMessage(entries, record.workspaceId, 'other-session', 'real-user')).toThrow();
});
it('D20 summaries retain the native parent statistics time and cannot rebind their scope',()=>{
 const summary:ResourceResult={...structuredClone(result),resultRef:'resource:summary-request:summary-call',requestId:'summary-request',toolCallId:'summary-call',createdAt:'2026-11-03T00:00:00Z',parameters:{operation:'summarize',resultRef:result.resultRef},parentResultRef:result.resultRef};
 const entries=[...branch(),{type:'custom',customType:RESOURCE_ENTRY,data:{requestId:summary.requestId}},{type:'message',message:{role:'assistant',content:[{type:'toolCall',id:summary.toolCallId,name:'task_resource_query',arguments:summary.parameters}]}},{type:'message',message:{role:'toolResult',toolCallId:summary.toolCallId,toolName:'task_resource_query',isError:false,...resourceToolResult(summary)}}] as unknown as SessionEntry[];
 expect(resolveResourceResult(entries,summary.resultRef)).toEqual(summary);
 const changed=structuredClone(summary);changed.statisticsScope.at=changed.createdAt;
 Object.assign((entries.at(-1) as Extract<SessionEntry,{type:'message'}>).message,resourceToolResult(changed));
 expect(()=>resolveResourceResult(entries,changed.resultRef)).toThrow('固定时间');
});

it('T13 freezes legacy overlap=4 bytes and native reading, while v2 recomputation requires3',()=>{
 const old=oldOverlap as ResourceResult,bytes=JSON.stringify(old);
 const native=(r:ResourceResult)=>[{type:'custom',customType:RESOURCE_ENTRY,data:{requestId:r.requestId}},{type:'message',message:{role:'assistant',content:[{type:'toolCall',id:r.toolCallId,name:'task_resource_query',arguments:r.parameters}]}},{type:'message',message:{role:'toolResult',toolCallId:r.toolCallId,toolName:'task_resource_query',isError:false,...resourceToolResult(r)}}] as unknown as SessionEntry[];
 expect(resourceResultValid(old)).toBe(true);expect(resolveResourceResult(native(old),old.resultRef).summary.quantities[0].value).toBe(4);
 expect(JSON.stringify(old)).toBe(bytes);
 const fresh:ResourceResult={...structuredClone(old),schemaVersion:2,resultRef:'resource:new:sum',requestId:'new',toolCallId:'sum',parameters:{operation:'summarize',resultRef:old.resultRef},parentResultRef:old.resultRef,summary:summarizeResources(old.records,old.items,old.statisticsScope.at)};
 expect(fresh.summary.quantities[0]).toMatchObject({value:3,knownValue:3});
 expect(resolveResourceResult([...native(old),...native(fresh)],fresh.resultRef)).toEqual(fresh);
 const relabeled={...structuredClone(old),schemaVersion:2};expect(resourceResultValid(relabeled)).toBe(false);
 const invalid=structuredClone(result);invalid.summary.entityCount=0;expect(resourceResultValid(invalid)).toBe(false);
});
