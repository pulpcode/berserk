import type { ContextCatalog, ContextQueryResult, ContextRef, SituationCurrent, SituationObject, SituationQueryParams } from '../../contracts/context';
import type { TaskContext } from '../../contracts/access';
import { refKey } from './evidence';
export interface SourceResult { systemId: string; items: SituationObject[]; queriedAt: string; asOf: string; unknownRefs: ContextRef[] }
export type QueryTransport = (params: SituationQueryParams) => Promise<ContextQueryResult>;
export async function readSituation(transport: QueryTransport, params: SituationQueryParams): Promise<SourceResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      let cursor: string | undefined; const items: SituationObject[] = []; const seen = new Set<string>();
      let last: ContextQueryResult;
      do {
        last = await transport({ ...params, limit: 100, ...(cursor ? { cursor } : {}) });
        const page = last.data as SituationCurrent;
        items.push(...page.items);
        if (items.length > 500) throw new Error('对象超过 500 个，请缩小查询范围。');
        cursor = page.hasMore ? page.nextCursor || undefined : undefined;
        if (page.hasMore && (!cursor || seen.has(cursor))) throw new Error('来源分页不完整，请重新刷新。');
        if (cursor) seen.add(cursor);
      } while (cursor);
      const page = last!.data as SituationCurrent;
      return { systemId: params.systemId, items, queriedAt: last!.queriedAt, asOf: page.asOf, unknownRefs: page.unknownRefs || [] };
    } catch (error) {
      if (attempt === 0 && error && typeof error === 'object' && 'code' in error && String(error.code).includes('CURSOR_STALE')) continue;
      throw error;
    }
  }
}
/** Separate queries preserve existing cross-filter AND semantics. */
export function taskQueries(catalog: ContextCatalog, context?: TaskContext): SituationQueryParams[] {
  const result: SituationQueryParams[] = [];
  for (const system of catalog.systems.filter(item => item.capabilities.includes('situation_current'))) {
    const objectRefs = context?.businessRefs?.filter(ref => ref.systemId === system.id && ['road','resource','area'].includes(ref.objectType));
    if (objectRefs?.length) result.push({ systemId: system.id, mode: 'current', objectRefs });
    if (context?.focus?.areaIds?.length) result.push({ systemId: system.id, mode: 'current', areaIds: context.focus.areaIds });
  }
  return result;
}
export function uniqueObjects(items: SituationObject[]) { return [...new Map(items.map(item => [refKey(item.ref), item])).values()]; }
export function objectStatus(item: SituationObject) {
  if ('availableCount' in item.properties) return `可用车辆 ${item.properties.availableCount} 辆`;
  if ('passability' in item.properties) return ({ open: '可通行', restricted: '限制通行', closed: '封闭', unknown: '状态未知' } as Record<string,string>)[String(item.properties.passability)] || '状态未知';
  return item.ref.objectType === 'area' ? '业务区域' : '来源未提供状态';
}
