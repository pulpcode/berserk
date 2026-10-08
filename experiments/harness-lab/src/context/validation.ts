import { RequestError } from '../contracts/errors.js';
import type { ContextData, ContextQueryParams, ContextRef, ContextTool, SituationObject } from '../contracts/context.js';

const invalid = () => new RequestError('CONTEXT_INVALID_ARGUMENT', '查询参数无效，请核对字段、标识、时间或分页条件。');
export function contextRecord(value: unknown, allowed: string[], required: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !allowed.includes(key)) || required.some(key => !(key in record))) throw invalid();
  return record;
}
export function contextText(value: unknown, max = 128, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw invalid(); return value;
}
export function contextInteger(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw invalid(); return value;
}
export function contextTimestamp(value: unknown): string {
  const time = contextText(value, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(time) || !Number.isFinite(Date.parse(time))) throw invalid();
  const date = new Date(`${time.slice(0, 10)}T00:00:00Z`);
  if (date.toISOString().slice(0, 10) !== time.slice(0, 10)) throw invalid();
  return time;
}
export function contextRef(value: unknown): ContextRef {
  const r = contextRecord(value, ['systemId', 'objectType', 'objectId'], ['systemId', 'objectType', 'objectId']);
  return {systemId: contextText(r.systemId), objectType: contextText(r.objectType), objectId: contextText(r.objectId)};
}
function array<T>(value: unknown, max: number, decode: (value: unknown) => T, nonempty = false): T[] {
  if (!Array.isArray(value) || value.length > max || (nonempty && !value.length)) throw invalid(); return value.map(decode);
}
const textList = (value: unknown, nonempty = false) => array(value, 10, item => contextText(item), nonempty);
const refList = (value: unknown, nonempty = false) => array(value, 20, contextRef, nonempty);
const filters = ['objectRefs', 'areaIds', 'query', 'limit', 'cursor'];
export function normalizeContextQuery(tool: ContextTool, value: unknown): ContextQueryParams {
  const allowed = tool === 'information_read' ? ['systemId', 'reportId', 'revision']
    : tool === 'information_search' ? ['systemId', 'reportId', 'subjectId', 'from', 'to', ...filters]
      : ['systemId', 'mode', 'from', 'to', 'after', ...filters];
  const raw = contextRecord(value, allowed, ['systemId']);
  const result: Record<string, unknown> = {systemId: contextText(raw.systemId)};
  if (tool === 'information_read') {
    result.reportId = contextText(raw.reportId);
    // Dot segments are normalized by URL clients even when percent-encoded.
    if (raw.reportId === '.' || raw.reportId === '..') throw invalid();
    if (raw.revision !== undefined) result.revision = contextInteger(raw.revision);
  } else {
    result.limit = raw.limit === undefined ? 20 : contextInteger(raw.limit, 1, 100);
    if (raw.objectRefs !== undefined) result.objectRefs = refList(raw.objectRefs, true);
    if (raw.areaIds !== undefined) result.areaIds = textList(raw.areaIds, true);
    if (raw.query !== undefined) { const text = contextText(raw.query, 200, true).trim(); if (text) result.query = text; }
    if (raw.cursor !== undefined) result.cursor = contextText(raw.cursor, 2048);
    for (const key of ['reportId', 'subjectId'] as const) if (raw[key] !== undefined) result[key] = contextText(raw[key]);
    for (const key of ['from', 'to'] as const) if (raw[key] !== undefined) result[key] = contextTimestamp(raw[key]);
    if (raw.from !== undefined && raw.to !== undefined && Date.parse(String(raw.from)) >= Date.parse(String(raw.to))) throw invalid();
    if (tool === 'situation_query') {
      if (raw.mode !== 'current' && raw.mode !== 'changes') throw invalid(); result.mode = raw.mode;
      if (raw.mode === 'current' && ['from', 'to', 'after'].some(key => raw[key] !== undefined)) throw invalid();
      if (raw.after !== undefined) {
        if (raw.from !== undefined || raw.to !== undefined) throw invalid(); result.after = contextText(raw.after, 2048);
      }
    }
  }
  return result as unknown as ContextQueryParams;
}
function nullableTime(value: unknown) { if (value !== null) contextTimestamp(value); }
function timeRange(value: unknown) {
  if (value === null) return;
  const range = contextRecord(value, ['from', 'to'], ['from', 'to']); nullableTime(range.from); nullableTime(range.to);
  if (range.from !== null && range.to !== null && Date.parse(String(range.from)) >= Date.parse(String(range.to))) throw invalid();
}
function report(value: unknown, detail: boolean) {
  const keys = ['reportId', 'subjectId', 'revision', 'title', 'summary', 'objectRefs', 'areaIds', 'observedAt', 'publishedAt', 'validTime', ...(detail ? ['content'] : [])];
  const r = contextRecord(value, keys, keys);
  contextText(r.reportId); contextText(r.subjectId); contextInteger(r.revision);
  contextText(r.title, 200); contextText(r.summary, 1000, true); refList(r.objectRefs); textList(r.areaIds);
  nullableTime(r.observedAt); nullableTime(r.publishedAt); timeRange(r.validTime);
  if (detail) contextText(r.content, 64_000, true);
}
function situationObject(value: unknown, systemId: string): SituationObject {
  const keys = ['ref', 'name', 'revision', 'areaIds', 'effectiveAt', 'validTime', 'properties'];
  const r = contextRecord(value, keys, keys), ref = contextRef(r.ref);
  if (ref.systemId !== systemId || !['road', 'resource', 'area'].includes(ref.objectType)) throw invalid();
  contextText(r.name, 200); contextInteger(r.revision); textList(r.areaIds); nullableTime(r.effectiveAt); timeRange(r.validTime);
  if (ref.objectType === 'resource') {
    const p = contextRecord(r.properties, ['availableCount', 'unit'], ['availableCount', 'unit']);
    contextInteger(p.availableCount, 0); if (p.unit !== '辆') throw invalid();
  } else if (ref.objectType === 'area') {
    const p = contextRecord(r.properties, ['memberRefs'], ['memberRefs']);
    for (const member of refList(p.memberRefs)) if (member.systemId !== systemId || !['road', 'resource', 'area'].includes(member.objectType)) throw invalid();
  } else contextRecord(r.properties, []);
  return value as SituationObject;
}
const sameRef = (a: ContextRef, b: ContextRef) => a.systemId === b.systemId && a.objectType === b.objectType && a.objectId === b.objectId;
/** Decode once at the HTTP boundary; retain the exact validated source content. */
export function decodeContextResponse(tool: ContextTool, params: ContextQueryParams, value: unknown): ContextData {
  try {
    const detail = tool === 'information_read';
    const current = tool === 'situation_query' && 'mode' in params && params.mode === 'current';
    const changes = tool === 'situation_query' && !current;
    const keys = ['systemId', 'asOf', ...(detail ? ['item'] : ['items', 'limit', 'nextCursor', 'hasMore', 'timeUnknownCount']),
      ...(current ? ['unknownRefs', 'changeCursor'] : changes ? ['unknownRefs', 'nextAfter'] : [])];
    const r = contextRecord(value, keys, keys);
    if (r.systemId !== params.systemId) throw invalid(); contextTimestamp(r.asOf);
    if (detail) {
      report(r.item, true); const item = r.item as Record<string, unknown>;
      if (!('reportId' in params) || item.reportId !== params.reportId || ('revision' in params && item.revision !== params.revision)) throw invalid();
    } else {
      const limit = contextInteger(r.limit, 1, 100);
      if (!('limit' in params) || limit !== params.limit) throw invalid();
      if (r.nextCursor !== null) contextText(r.nextCursor, 2048);
      if (r.hasMore !== (r.nextCursor !== null)) throw invalid(); contextInteger(r.timeUnknownCount, 0);
      array(r.items, limit, item => {
        if (tool === 'information_search') report(item, false);
        else if (current) situationObject(item, params.systemId);
        else {
          const c = contextRecord(item, ['cursor', 'effectiveAt', 'before', 'after'], ['cursor', 'effectiveAt', 'before', 'after']);
          contextText(c.cursor, 2048); nullableTime(c.effectiveAt);
          const before = situationObject(c.before, params.systemId), after = situationObject(c.after, params.systemId);
          if (!sameRef(before.ref, after.ref) || before.revision >= after.revision || c.effectiveAt !== after.effectiveAt) throw invalid();
        }
      }, r.hasMore === true);
      if (current || changes) {
        const requested = 'objectRefs' in params ? params.objectRefs ?? [] : [];
        for (const ref of refList(r.unknownRefs)) if (!requested.some(item => sameRef(item, ref))) throw invalid();
        if (current) contextText(r.changeCursor, 2048);
        else if (r.hasMore) { if (r.nextAfter !== null) throw invalid(); }
        else contextText(r.nextAfter, 2048);
      }
    }
    return value as ContextData;
  } catch { throw new RequestError('CONTEXT_INVALID_RESPONSE', '来源返回的数据不符合查询契约，无法作为完整资料使用。', 502); }
}
