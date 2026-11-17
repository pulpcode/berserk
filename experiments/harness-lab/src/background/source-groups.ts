import type { BackgroundConfig } from './config.js';

/** Display/filter grouping only. Callers must authorize each original record before grouping. */
export function sourceGroup(config: BackgroundConfig, sourceId: string): {id: string; name: string} {
  const source = config.sources.find(item => item.sourceId === sourceId);
  const canonical = config.sources.find(item => !item.retired && item.operationPolicies && Object.values(item.operationPolicies).includes(sourceId));
  const group = canonical ?? source;
  return {id: group?.sourceId ?? sourceId, name: group?.name ?? sourceId};
}
export function matchesSourceGroup(config: BackgroundConfig, sourceId: string, filter?: string): boolean {
  return !filter || sourceId === filter || sourceGroup(config, sourceId).id === filter;
}
