import type { ContextData, ContextRef, MapReference, SituationObject } from '../contracts/context.js';

export const contextRefKey = (ref: ContextRef) => JSON.stringify([ref.systemId, ref.objectType, ref.objectId]);
export function mapReferences(data: ContextData): MapReference[] {
  const result = new Map<string, MapReference>();
  const add = (ref: ContextRef, revision?: number) => {
    if (!['road', 'resource', 'area'].includes(ref.objectType)) return;
    const params = new URLSearchParams({...ref, ...(revision ? {revision: String(revision)} : {})});
    const item = {ref, ...(revision ? {revision} : {}), href: `/situation?${params}`};
    result.set(`${contextRefKey(ref)}:${revision ?? ''}`, item);
  };
  const spatial = (item: SituationObject) => { if (item.geometry) add(item.ref, item.revision); };
  if ('item' in data) data.item.objectRefs.forEach(ref => add(ref));
  else for (const item of data.items) {
    if ('ref' in item) spatial(item);
    else if ('before' in item) { spatial(item.before); spatial(item.after); }
    else item.objectRefs.forEach(ref => add(ref));
  }
  return [...result.values()];
}
