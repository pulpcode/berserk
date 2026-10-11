import type { ContextRef, ContextQueryResult } from '../../contracts/context';
import type { PublicMessage } from '../../contracts';
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
  const data = query.data;
  const items = 'items' in data ? data.items : 'item' in data ? [data.item] : [];
  const result: MapReference[] = [];
  for (const item of items) {
    const values = 'after' in item ? [item.before,item.after] : [item];
    for(const value of values) {
    if ('ref' in value && isRef(value.ref) && value.geometry) result.push({ ref: value.ref, revision: value.revision, href: mapHref(value.ref, value.revision) });
    if ('objectRefs' in value) for (const ref of value.objectRefs) if (isRef(ref)) result.push({ ref, href: mapHref(ref) });
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
