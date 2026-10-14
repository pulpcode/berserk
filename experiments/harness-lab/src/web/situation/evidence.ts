import type { ContextRef, ContextQueryResult } from '../../contracts/context';
import type { PublicMessage } from '../../contracts';
import type { AnnotationRef, AnnotationSelection } from '../../contracts/annotations';
export interface MapReference { ref: ContextRef; revision?: number; href: string }
export const refKey = (ref: ContextRef) => JSON.stringify([ref.systemId, ref.objectType, ref.objectId]);
export function isRef(value: unknown): value is ContextRef {
  if (!value || typeof value !== 'object') return false;
  const ref = value as ContextRef;
  return [ref.systemId, ref.objectType, ref.objectId].every(v => typeof v === 'string' && Boolean(v.trim()) && v.length<=128) && ['road','resource','area'].includes(ref.objectType);
}
export function mapHref(ref: ContextRef, revision?: number) {
  return `/situation?${new URLSearchParams({ ...ref, ...(revision === undefined ? {} : { revision: String(revision) }) })}`;
}
export function parseMapHref(href?: string): MapReference | undefined {
  if (!href?.startsWith('/situation?')) return;
  const url = new URL(href, 'https://axon.invalid');
  if (url.pathname !== '/situation' || url.hash || [...url.searchParams.keys()].some(key => !['systemId','objectType','objectId','revision'].includes(key)) || new Set(url.searchParams.keys()).size !== [...url.searchParams.keys()].length) return;
  const ref = { systemId: url.searchParams.get('systemId')!, objectType: url.searchParams.get('objectType')!, objectId: url.searchParams.get('objectId')! };
  const version = url.searchParams.get('revision');
  if (!isRef(ref) || (version !== null && (!/^[1-9]\d*$/.test(version) || !Number.isSafeInteger(Number(version))))) return;
  return { ref, ...(version === null ? {} : { revision: Number(version) }), href };
}
/** Derive only from actual query payloads, never from prose or supplied link labels. */
export function queryReferences(query: ContextQueryResult): MapReference[] {
  if (!record(query) || !record(query.data)) return [];
  const data = query.data;
  const items = Array.isArray(data.items) ? data.items : record(data.item) ? [data.item] : [];
  const result: MapReference[] = [];
  for (const item of items) {
    if (!record(item)) continue;
    const values = 'after' in item ? [item.before,item.after] : [item];
    for (const value of values) {
      if (!record(value)) continue;
      if (isRef(value.ref) && value.geometry && positiveRevision(value.revision)) result.push({ref:value.ref,revision:value.revision,href:mapHref(value.ref,value.revision)});
      if (Array.isArray(value.objectRefs)) for (const ref of value.objectRefs) if (isRef(ref)) result.push({ref,href:mapHref(ref)});
    }
  }
  return [...new Map(result.map(item=>[item.href,item])).values()];
}

export function messageReferences(messages: PublicMessage[]): MapReference[] {
  const refs: MapReference[] = [];
  for (const message of messages) {
    if (message.role === 'tool' && !message.isError && !message.resultMissing && ['situation_query','information_read','information_search'].includes(message.toolName || '')) {
      try { const query = JSON.parse(message.text) as ContextQueryResult; if (query.data) refs.push(...queryReferences(query)); } catch { /* Legacy/nonstructured tool text has no map authority. */ }
    }
    for (const query of message.selections?.context?.queries || []) refs.push(...queryReferences(query));
  }
  return refs;
}
export function verifiedReference(href: string | undefined, evidence: MapReference[]): MapReference | undefined {
  const candidate = parseMapHref(href);
  return candidate && evidence.find(item => refKey(item.ref) === refKey(candidate.ref) && item.revision === candidate.revision);
}

export interface AnnotationMapEntry { selection: AnnotationSelection; original: boolean; publication: boolean }
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const positiveRevision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const objectId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
function fixedRef(value: unknown): AnnotationRef | undefined {
  if (!record(value)) return;
  if (uuid(value.publicationId) && value.setId === undefined && value.revision === undefined) return {publicationId:value.publicationId};
  if (uuid(value.setId) && positiveRevision(value.revision) && value.publicationId === undefined) return {setId:value.setId,revision:value.revision};
}
/** A native successful receipt is evidence; assistant prose and arbitrary read payloads are not. */
export function annotationMapEntries(messages: PublicMessage[]): AnnotationMapEntry[] {
  const entries = new Map<string, AnnotationMapEntry>();
  for (const message of messages) {
    if (message.role !== 'tool' || message.isError || message.resultMissing || !['annotation_action','annotation_from_source','annotation_read'].includes(message.toolName || '')) continue;
    try {
      const value: unknown = JSON.parse(message.text);
      if (!record(value) || !uuid(value.clientActionId) || !uuid(value.taskId) || typeof value.committedAt !== 'string' || !Number.isFinite(Date.parse(value.committedAt))) continue;
      if (!['create_draft','apply','from_source','publish','set_current'].includes(String(value.action))) continue;
      if (message.toolName === 'annotation_from_source' && value.action !== 'from_source') continue;
      if (message.toolName === 'annotation_action' && value.action === 'from_source') continue;
      if (value.replayed !== undefined && typeof value.replayed !== 'boolean') continue;
      const publication = value.action === 'publish' || value.action === 'set_current';
      const ref = fixedRef(value.ref);
      if (!ref || publication !== ('publicationId' in ref)) continue;
      // Conflicting receipt metadata must not manufacture a target.
      if (value.afterRef !== undefined && JSON.stringify(fixedRef(value.afterRef)) !== JSON.stringify(ref)) continue;
      const sources = value.fromSources !== undefined ? value.fromSources : value.fromSource !== undefined ? [value.fromSource] : undefined;
      if (value.action === 'from_source' && (!Array.isArray(sources) || !sources.length || sources.length > 20 || !sources.every(item => record(item) && ['add','refresh'].includes(String(item.mode)) && objectId(item.objectId) && objectId(item.layerId) && isRef(item.sourceRef) && positiveRevision(item.sourceRevision) && typeof item.queriedAt === 'string' && Number.isFinite(Date.parse(item.queriedAt))))) continue;
      let ids: string[] | undefined;
      if (value.objectIds !== undefined) {
        if (!Array.isArray(value.objectIds) || value.objectIds.length > 500 || !value.objectIds.every(objectId)) continue;
        ids = [...new Set(value.objectIds)];
      } else if (value.action === 'from_source') {
        if (!Array.isArray(sources)) continue;
        ids = [...new Set(sources.map(item => (item as {objectId:string}).objectId))];
      }
      const original = message.toolName === 'annotation_read' || value.replayed === true;
      const key = JSON.stringify([ref,original]);
      const previous = entries.get(key);
      // A whole-version receipt subsumes object-specific selections of the same fixed version.
      const objectIds = previous ? previous.selection.objectIds && ids?.length ? [...new Set([...previous.selection.objectIds,...ids])] : undefined : ids?.length ? ids : undefined;
      if (objectIds && objectIds.length > 500) continue;
      entries.set(key,{selection:{...ref,...(objectIds ? {objectIds} : {})},original,publication});
    } catch { /* Unstructured or malformed history has no successful map-entry projection. */ }
  }
  return [...entries.values()];
}
/** Do not borrow earlier requests' successful effects for a later answer. */
export function requestMapEvidence(message: PublicMessage, preceding: PublicMessage[]): PublicMessage[] {
  return message.role === 'assistant' && message.requestId ? preceding.filter(item => item.requestId === message.requestId) : [];
}
