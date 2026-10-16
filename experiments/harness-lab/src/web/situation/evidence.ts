import type { ContextRef, ContextQueryResult } from '../../contracts/context';
import { extractSpatialResult, type SpatialResult } from '../../contracts/spatial';
import type { PublicMessage } from '../../contracts';
import { extractAnnotationResult, receiptMapEntry, type AnnotationMapEntry } from '../../contracts/annotation-results';
export type { AnnotationMapEntry } from '../../contracts/annotation-results';
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

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const positiveRevision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
/** A native successful receipt is evidence; assistant prose and arbitrary read payloads are not. */
export function annotationMapEntries(messages: PublicMessage[]): AnnotationMapEntry[] {
  const entries = new Map<string, AnnotationMapEntry>();
  for (const message of messages) {
    if (message.role !== 'tool' || message.isError || message.resultMissing || !['annotation_action','annotation_from_source','annotation_from_analysis','annotation_read'].includes(message.toolName || '')) continue;
    try {
      const value: unknown = JSON.parse(message.text);
      const structured = extractAnnotationResult({annotationResult:message.annotationResult},message.toolName!, false, message.text);
      const modern = record(value) && typeof value.format === 'string' && value.format.startsWith('annotation.model-result.');
      const entry = structured ? receiptMapEntry(structured.receipt,message.toolName!) : message.annotationResult !== undefined || modern ? undefined : receiptMapEntry(value,message.toolName!);
      if (!entry) continue;
      const {original,publication} = entry;
      const {objectIds:ids,...ref} = entry.selection;
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

/** Spatial geometry comes only from a verified native result belonging to this request. */
export function spatialMapEntries(messages: PublicMessage[]): SpatialResult[] {
  const results = new Map<string, SpatialResult>();
  for (const message of messages) {
    if (message.role !== 'tool' || message.isError || message.resultMissing || message.toolName !== 'spatial_analyze') continue;
    const result = extractSpatialResult({ spatialResult: message.spatialResult }, message.toolName, false, message.text);
    // A read preserves its origin but carries separately verified host delivery ownership.
    // Both request and tool call must match the public message; arbitrary prior refs are not authority.
    const delivery = result?.delivery || result;
    if (result && delivery && delivery.requestId === message.requestId && delivery.toolCallId === message.toolCallId) results.set(result.resultRef, result);
  }
  return [...results.values()];
}
