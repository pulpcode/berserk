import { resolveSpatialResult } from './spatial-results.js';
import { isDeepStrictEqual } from 'node:util';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { extractResourceResult, projectResourceResult, resourceRequestValid, type ResourceResult } from '../contracts/resource-results.js';
import { RequestError } from '../contracts/errors.js';
import { RESOURCE_ENTRY, RESULT_ENTRY } from './resource-tools.js';
import { composerHistory } from './composer-input.js';

export function resourceToolResult(result: ResourceResult, offset = 0, limit = 100) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ format: 'resource.model-result.v1', data: projectResourceResult(result, offset, limit) }) }], details: { resourceResult: result } };
}

/** Only an original successful tool call in this native branch grants result authority. */
export function resolveResourceResult(entries: SessionEntry[], ref: string, ancestors = new Set<string>()): ResourceResult {
  if(ancestors.has(ref))throw new RequestError('RESOURCE_RESULT_INVALID','资源统计引用存在循环。',409);
  const path=new Set(ancestors).add(ref);
  let requestId: string | undefined;
  const calls = new Map<string, unknown>();
  let found: ResourceResult | undefined;
  for (const entry of entries) {
    if (entry.type === 'custom' && entry.customType === RESOURCE_ENTRY) { requestId = (entry.data as { requestId: string }).requestId; calls.clear(); }
    if (entry.type === 'custom' && entry.customType === RESULT_ENTRY) { requestId = undefined; calls.clear(); }
    if (entry.type !== 'message' || !requestId) continue;
    const message = entry.message;
    if (message.role === 'assistant') for (const call of message.content) if (call.type === 'toolCall' && call.name === 'task_resource_query') calls.set(call.id, call.arguments);
    if (message.role !== 'toolResult' || message.toolName !== 'task_resource_query') continue;
    const args = calls.get(message.toolCallId); calls.delete(message.toolCallId);
    const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    if ((message.details as {resourceRejected?: boolean} | undefined)?.resourceRejected) continue;
    const result = extractResourceResult(message.details, message.toolName, message.isError, text);
    if (!result || result.delivery || result.resultRef !== ref || result.requestId !== requestId || result.toolCallId !== message.toolCallId
      || !resourceRequestValid(args) || args.operation === 'read' || !isDeepStrictEqual(args, result.parameters)
      || result.resultRef !== `resource:${requestId}:${encodeURIComponent(message.toolCallId)}`
      || (args.operation === 'summarize' && (args.resultRef !== result.parentResultRef || args.spatialResultRef !== result.spatialResultRef))) continue;
    if (found) throw new RequestError('RESOURCE_RESULT_INVALID', '原生历史中资源结果引用不唯一。', 409);
    found = result;
  }
  if (!found) throw new RequestError('RESOURCE_RESULT_NOT_FOUND', '本会话没有可验证的该资源结果；不能采用复制或改写的结果。', 404);
  if(found.parameters.operation==='summarize'){
    const parent=resolveResourceResult(entries,found.parameters.resultRef,path);
    if(found.statisticsScope.at!==parent.statisticsScope.at||found.statisticsScope.relation!==(found.parameters.relation??parent.statisticsScope.relation))throw new RequestError('RESOURCE_RESULT_INVALID','资源统计的固定时间或关系范围与原结果不一致。',409);
    let expected=parent.items;
    if(found.parameters.spatialResultRef){
      const spatial=resolveSpatialResult(entries,found.parameters.spatialResultRef);
      if(!isDeepStrictEqual(found.spatialCoverage,spatial.completeness)||spatial.resourceInput?.resultRef!==parent.resultRef)throw new RequestError('RESOURCE_RESULT_INVALID','资源统计的空间依据不一致。',409);
      for(const provenance of spatial.provenance){
        const systems=[...(provenance.input.kind==='source'?[provenance.input.systemId]:[]),...(provenance.resourceContext?.dependencies.systemIds??[])];
        const annotations=[...(provenance.input.kind==='annotation'?[provenance.input.ref]:[]),...(provenance.resourceContext?.dependencies.annotations??[])];
        if(systems.some(id=>!found!.dependencies.systemIds.includes(id))||annotations.some(ref=>!found!.dependencies.annotations.some(candidate=>isDeepStrictEqual(ref,candidate))))throw new RequestError('RESOURCE_RESULT_INVALID','资源统计丢失空间依据。',409);
      }
      const position=found.parameters.position;
      if(position&&!spatial.classifications)throw new RequestError('RESOURCE_RESULT_INVALID','资源统计缺少分类依据。',409);
      const ids=new Set(position?spatial.classifications!.filter(c=>c.position===position).map(c=>c.itemId):spatial.items.map(i=>i.id));expected=expected.filter(i=>ids.has(i.id));
    }
    if(!found.parameters.spatialResultRef&&!isDeepStrictEqual(found.spatialCoverage,parent.spatialCoverage))throw new RequestError('RESOURCE_RESULT_INVALID','资源统计丢失原空间覆盖限制。',409);
    const {relation,availability}=found.statisticsScope;
    expected=expected.filter(i=>(relation==='all'||(relation==='related'?i.relation!=='unconfirmed':i.relation===relation))&&(availability==='all'||i.availability===availability));
    const ids=new Set(expected.flatMap(i=>i.recordIds));
    if(!isDeepStrictEqual(expected,found.items)||!isDeepStrictEqual(parent.records.filter(r=>ids.has(r.id)),found.records)||!isDeepStrictEqual(parent.coverage,found.coverage)||!isDeepStrictEqual(parent.relationshipCoverage,found.relationshipCoverage)||parent.dependencies.systemIds.some(id=>!found.dependencies.systemIds.includes(id))||parent.dependencies.annotations.some(ref=>!found.dependencies.annotations.some(candidate=>isDeepStrictEqual(ref,candidate))))throw new RequestError('RESOURCE_RESULT_INVALID','资源统计改写了原结果或丢失依据。',409);

  }
  return found;
}

/** Read delivery is checked against its own call, while authority stays with the origin. */
export function validateResourceDelivery(entries: SessionEntry[], result: ResourceResult) {
  if (!result.delivery) return;
  let requestId: string | undefined;
  const calls = new Map<string, unknown>();
  let matches = 0;
  for (const entry of entries) {
    if (entry.type === 'custom' && entry.customType === RESOURCE_ENTRY) { requestId = (entry.data as {requestId: string}).requestId; calls.clear(); }
    if (entry.type === 'custom' && entry.customType === RESULT_ENTRY) { requestId = undefined; calls.clear(); }
    if (entry.type !== 'message' || requestId !== result.delivery.requestId) continue;
    const message = entry.message;
    if (message.role === 'assistant') for (const call of message.content) if (call.type === 'toolCall' && call.name === 'task_resource_query') calls.set(call.id, call.arguments);
    if (message.role !== 'toolResult' || message.toolCallId !== result.delivery.toolCallId || message.toolName !== 'task_resource_query') continue;
    const args = calls.get(message.toolCallId); calls.delete(message.toolCallId);
    const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    const extracted = extractResourceResult(message.details, message.toolName, message.isError, text);
    if (!resourceRequestValid(args) || args.operation !== 'read' || args.resultRef !== result.resultRef || !isDeepStrictEqual(extracted, result)) continue;
    const projected = JSON.parse(text).data;
    if (projected.page.offset !== (args.offset ?? 0) || projected.page.limit !== (args.limit ?? 100)) continue;
    matches++;
  }
  if (matches !== 1) throw new RequestError('RESOURCE_RESULT_INVALID', '资源结果读回与真实调用不一致。', 409);
}

/** A selection belongs only to the first real user message of its original request. */
export function resourceUserMessages(entries: SessionEntry[], workspaceId: string, sessionId: string) {
  const selections = composerHistory(entries, workspaceId, sessionId);
  let requestId: string | undefined;
  const seen = new Set<string>();
  const reports: Array<{ entryId: string; text: string; resourceRefs: Array<{ systemId: string; objectType: string; objectId: string }> }> = [];
  for (const entry of entries) {
    if (entry.type === 'custom' && entry.customType === RESOURCE_ENTRY) requestId = (entry.data as { requestId: string }).requestId;
    if (entry.type === 'custom' && entry.customType === RESULT_ENTRY) requestId = undefined;
    if (!requestId || entry.type !== 'message' || entry.message.role !== 'user' || seen.has(requestId)) continue;
    seen.add(requestId);
    const resourceRefs = selections.get(requestId)?.context?.refs.filter(ref => ref.objectType === 'resource') ?? [];
    if (!resourceRefs.length) continue;
    const text = typeof entry.message.content === 'string' ? entry.message.content : entry.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    reports.push({ entryId: entry.id, text, resourceRefs });
  }
  return reports;
}
export function resolveResourceMessage(entries: SessionEntry[], workspaceId: string, sessionId: string, entryId: string) {
  const found = resourceUserMessages(entries, workspaceId, sessionId).find(message => message.entryId === entryId);
  if (!found) throw new RequestError('RESOURCE_MESSAGE_INVALID', '没有本分支真实用户消息及明确资源引用，不能采用助手转述或压缩摘要。', 409);
  return { text: found.text, resourceRefs: found.resourceRefs };
}
