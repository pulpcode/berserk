import type { ResourceRecord, ResourceItem, ResourceSummary, ResourceResult } from './resource-results.js';
import { RequestError } from './errors.js';

export const resourceNamespace = (r: ResourceRecord) => r.association?.source.systemId ?? r.source?.ref.systemId;
const entityId = (r: ResourceRecord) => r.association?.entityId ?? r.source?.data?.entityId;
const entity = (r: ResourceRecord) => entityId(r) ? JSON.stringify([resourceNamespace(r), entityId(r)]) : undefined;
export const resourceQuantitySignature = (r: ResourceRecord) => {
  const q = r.resource.quantity;
  return JSON.stringify([r.resource.category ?? 'unknown', q?.unit, q?.meaning, q?.scope, q?.effectiveAt ?? null, q?.validUntil ?? null, q?.conditions ?? []]);
};
const current = (r: ResourceRecord, at: string) => {
  const q = r.resource.quantity;
  return !!q && !q.conditions?.length && (!q.effectiveAt || Date.parse(q.effectiveAt) <= Date.parse(at)) && (!q.validUntil || Date.parse(q.validUntil) > Date.parse(at));
};

/** Query keeps original rows; only the explicit statistics selection is counted. */
export function resourceStatisticsItems(result: Pick<ResourceResult, 'parameters' | 'items'>): ResourceItem[] {
  return result.parameters.operation === 'query' && result.parameters.purpose === 'task'
    ? result.items.filter(i => i.relation !== 'unconfirmed') : result.items;
}
export function resourceEntityCountUnknown(result: Pick<ResourceResult, 'coverage' | 'relationshipCoverage' | 'statisticsScope' | 'spatialCoverage'>, items: ResourceItem[]): boolean {
  return result.spatialCoverage?.status === 'partial' || (!items.length && (result.coverage.some(c => c.status !== 'complete') || result.relationshipCoverage.status === 'partial' && result.statisticsScope.relation !== 'all'));
}

/** A member list represents this quantity only for a complete, consistent entity count. */
export function resourceQuantityMembers(r: ResourceRecord, at: string): string[] | undefined {
  const q = r.resource.quantity;
  if (!q || q.meaning !== 'entities' || !current(r, at) || !resourceNamespace(r)) return;
  if (r.resource.granularity === 'individual' && entityId(r) && q.value === 1) return [entityId(r)!];
  const coverage = r.source?.data?.coverage;
  if (r.resource.granularity === 'aggregate' && coverage?.complete && coverage.scope === q.scope && coverage.memberEntityIds && new Set(coverage.memberEntityIds).size === q.value) return coverage.memberEntityIds;
}

export function summarizeResources(records: ResourceRecord[], items: ResourceItem[], at = new Date().toISOString()): ResourceSummary {
  const selected = new Set(items.flatMap(i => i.recordIds)), rows = records.filter(r => selected.has(r.id));
  const limitations: string[] = [];
  const unknown = items.filter(i => !i.entityKey);
  const groups = new Map<string, ResourceRecord[]>();
  const seen = new Set<string>();
  const conflicts = new Set(rows.filter(r => entity(r) && rows.some(other => entity(other) === entity(r) && (resourceQuantitySignature(other) !== resourceQuantitySignature(r) || other.resource.quantity?.value !== r.resource.quantity?.value))).map(r => entity(r)!));
  for (const row of rows) {
    const q = row.resource.quantity;
    if (!q) { limitations.push(`记录 ${row.id} 数量未注明。`); continue; }
    const id = entity(row);
    // Conflicting copies stay in their own semantic groups as unknown evidence.
    const dedup = id && JSON.stringify([id, resourceQuantitySignature(row), q.value]);
    if (dedup && seen.has(dedup)) continue;
    if (dedup) seen.add(dedup);
    const key = JSON.stringify([resourceQuantitySignature(row), resourceNamespace(row) ?? ['declaration', row.id], row.resource.granularity === 'individual' && !id ? row.id : null]);
    groups.set(key, [...groups.get(key) ?? [], row]);
  }
  const quantities: ResourceSummary['quantities'] = [];
  for (const groupRows of groups.values()) {
    const first = groupRows[0], q = first.resource.quantity!;
    const group: ResourceSummary['quantities'][number] = { category: first.resource.category ?? 'unknown', unit: q.unit, meaning: q.meaning, scope: q.scope, value: 0, knownValue: 0, unknownCount: 0, recordIds: groupRows.map(r => r.id), limitations: [] };
    const needsIdentityEvidence = groupRows.some(r => r.resource.granularity === 'aggregate' || !entity(r));
    const knownMembers = new Set<string>();
    for (const row of groupRows) {
      const quantity = row.resource.quantity!, id = entity(row);
      const conflict = !!id && conflicts.has(id);
      const set = conflict ? undefined : resourceQuantityMembers(row, at);
      const coverage = row.source?.data?.coverage;
      const inconsistent = row.resource.granularity === 'aggregate' && quantity.meaning === 'entities' && coverage?.complete && coverage.memberEntityIds && (coverage.scope !== quantity.scope || coverage.memberEntityIds.length !== quantity.value);
      if (set) { for (const member of set) knownMembers.add(member); continue; }
      const unresolvedOverlap = needsIdentityEvidence && groupRows.length > 1;
      if (conflict || inconsistent || quantity.value === null || !current(row, at) || unresolvedOverlap) {
        group.value = null; group.unknownCount++;
        group.limitations.push(inconsistent ? '完整成员与声明数量或范围不一致，不据此合计。' : unresolvedOverlap ? '缺少可用于当前数量含义的完整成员依据，不推导去重合计。' : '数量、有效时间、条件或重复实体存在未确认信息。');
      } else {
        group.knownValue += quantity.value;
      }
    }
    group.knownValue += knownMembers.size;
    if (!Number.isSafeInteger(group.knownValue)) throw new RequestError('RESOURCE_LIMIT', '资源数量合计超过安全整数范围。');
    if (group.value !== null) group.value = group.knownValue;
    quantities.push(group);
  }
  const crossSource = new Set(items.filter(i => i.entityKey).map(i => JSON.parse(i.entityKey!)[0])).size > 1;
  if (crossSource) limitations.push('多个来源实体身份没有跨系统映射，不能确定跨系统去重后的实体总数。');
  if (unknown.length) limitations.push('存在实体身份未确认记录；记录数不能作为确定实体总数。');
  return { recordCount: rows.length, itemCount: items.length, knownEntityCount: items.length - unknown.length, entityCount: unknown.length || crossSource ? null : items.length, quantities, limitations };
}
