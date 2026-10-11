import { isDeepStrictEqual } from 'node:util';
import type { ContextPrincipal, LoadedContextSelection, SituationCurrent } from '../contracts/context.js';
import { RequestError } from '../contracts/errors.js';
import { contextRef, contextRecord, contextTimestamp, decodeContextResponse, normalizeContextQuery } from './validation.js';
import { contextRefKey, mapReferences } from './map-references.js';
import type { ContextService } from './service.js';

export function selectedContextRefs(value: unknown) {
  if (!Array.isArray(value) || value.length > 20) throw new RequestError('CONTEXT_INVALID_ARGUMENT', '每次最多引用 20 个态势对象。');
  const refs = value.map(contextRef);
  if (refs.some(ref => !['road', 'resource', 'area'].includes(ref.objectType))) throw new RequestError('CONTEXT_INVALID_ARGUMENT', '仅支持态势对象引用。');
  return [...new Map(refs.map(ref => [contextRefKey(ref), ref])).values()];
}
export async function loadComposerContext(value: unknown, context: ContextService | undefined, principal: ContextPrincipal, signal?: AbortSignal): Promise<LoadedContextSelection | undefined> {
  const refs = selectedContextRefs(value);
  if (!refs.length) return undefined;
  if (!context) throw new RequestError('CONTEXT_UNAVAILABLE', '业务资料查询不可用。', 503);
  const queries = [];
  for (const systemId of new Set(refs.map(ref => ref.systemId))) {
    const objectRefs = refs.filter(ref => ref.systemId === systemId);
    const query = await context.query('situation_query', {systemId, mode: 'current', objectRefs, limit: 100}, principal, signal);
    const data = query.data as SituationCurrent;
    if (data.hasMore || data.unknownRefs.length || data.items.length !== objectRefs.length || new Set(data.items.map(item => contextRefKey(item.ref))).size !== objectRefs.length || data.items.some(item => !objectRefs.some(ref => contextRefKey(ref) === contextRefKey(item.ref)))) {
      throw new RequestError('CONTEXT_REFERENCE_MISSING', '所选对象未全部读取，请刷新或移除失效引用后再发送。', 409);
    }
    queries.push(query);
  }
  const result = {refs, queries};
  if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) throw new RequestError('CONTEXT_RESPONSE_TOO_LARGE', '引用资料超过 256 KiB，请减少对象后再发送。', 413);
  return result;
}
export function validLoadedContext(value: unknown): boolean {
  try {
    const raw = contextRecord(value, ['refs', 'queries'], ['refs', 'queries']);
    const refs = selectedContextRefs(raw.refs);
    if (!refs.length || !isDeepStrictEqual(refs, raw.refs) || !Array.isArray(raw.queries) || raw.queries.length > 20 || Buffer.byteLength(JSON.stringify(value)) > 256 * 1024) return false;
    const found: string[] = [];
    const systems = new Set<string>();
    for (const item of raw.queries) {
      const record = contextRecord(item, ['systemId','query','queriedAt','data','mapReferences'], ['systemId','query','queriedAt','data']);
      const params = normalizeContextQuery('situation_query', record.query);
      if (!('mode' in params) || params.mode !== 'current' || params.systemId !== record.systemId || systems.has(params.systemId)) return false;
      contextTimestamp(record.queriedAt);
      const expected = normalizeContextQuery('situation_query', {systemId: params.systemId, mode: 'current', objectRefs: refs.filter(ref => ref.systemId === params.systemId), limit: 100});
      if (!isDeepStrictEqual(record.query, expected)) return false;
      systems.add(params.systemId);
      const data = decodeContextResponse('situation_query', params, record.data) as SituationCurrent;
      if (data.hasMore || data.unknownRefs.length || !isDeepStrictEqual(record.mapReferences, mapReferences(data))) return false;
      found.push(...data.items.map(item => contextRefKey(item.ref)));
    }
    return isDeepStrictEqual(found.sort(), refs.map(contextRefKey).sort());
  } catch { return false; }
}
