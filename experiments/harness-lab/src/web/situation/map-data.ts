import type { ContextCatalog, ContextQueryResult, ContextRef, SituationCurrent, SituationObject, SituationQueryParams } from '../../contracts/context';
import type { TaskContext } from '../../contracts/access';
import type { ScenarioClock } from '../../contracts/scenarios';
import { resourceFactActive } from '../../contracts/task-resources';
import { refKey } from './evidence';
export interface SourceResult { systemId: string; items: SituationObject[]; queriedAt: string; asOf: string; unknownRefs: ContextRef[]; snapshotClock?: ScenarioClock }
export type QueryTransport = (params: SituationQueryParams) => Promise<ContextQueryResult>;
const clockKey = (clock?: ScenarioClock) => clock ? JSON.stringify([clock.instanceId,clock.businessNow,clock.revision]) : '';
const clockConflict = () => new Error('场景在查询期间已推进，请刷新态势后重新查看。');
/** A scene read cannot silently resume against a newer business-time snapshot. */
export function mergeSituationParts(parts: SourceResult[]): SourceResult {
  const first=parts[0]!;
  if(parts.some(part=>part.systemId!==first.systemId || clockKey(part.snapshotClock)!==clockKey(first.snapshotClock)))throw clockConflict();
  return {...first,items:uniqueObjects(parts.flatMap(part=>part.items)),unknownRefs:parts.flatMap(part=>part.unknownRefs)};
}
export async function readSituation(transport: QueryTransport, params: SituationQueryParams): Promise<SourceResult> {
  for (let attempt = 0; ; attempt++) {
    let sceneRead=false;
    try {
      let cursor: string | undefined; const items: SituationObject[] = []; const seen = new Set<string>();
      let snapshot: string | undefined;
      let last: ContextQueryResult;
      do {
        last = await transport({ ...params, limit: 100, ...(cursor ? { cursor } : {}) });
        const page = last.data as SituationCurrent;
        const nextSnapshot=clockKey(page.snapshotClock);
        sceneRead ||= Boolean(page.snapshotClock);
        if(snapshot!==undefined && snapshot!==nextSnapshot)throw clockConflict();
        snapshot=nextSnapshot;
        items.push(...page.items);
        if (items.length > 500) throw new Error('对象超过 500 个，请缩小查询范围。');
        cursor = page.hasMore ? page.nextCursor || undefined : undefined;
        if (page.hasMore && (!cursor || seen.has(cursor))) throw new Error('来源分页不完整，请重新刷新。');
        if (cursor) seen.add(cursor);
      } while (cursor);
      const page = last!.data as SituationCurrent;
      return { systemId: params.systemId, items, queriedAt: last!.queriedAt, asOf: page.asOf, unknownRefs: page.unknownRefs || [], ...(page.snapshotClock?{snapshotClock:page.snapshotClock}:{}) };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && String(error.code).includes('CURSOR_STALE')) {
        if(sceneRead)throw clockConflict();
        if(attempt===0)continue;
      }
      throw error;
    }
  }
}
/** Separate queries preserve existing cross-filter AND semantics. */
export function taskQueries(catalog: ContextCatalog, context?: TaskContext): SituationQueryParams[] {
  const result: SituationQueryParams[] = [];
  for (const system of catalog.systems.filter(item => item.capabilities.includes('situation_current'))) {
    const objectRefs = context?.businessRefs?.filter(ref => ref.systemId === system.id && ['road','resource','area'].includes(ref.objectType)).map(({systemId,objectType,objectId}) => ({systemId,objectType,objectId}));
    if (objectRefs?.length) result.push({ systemId: system.id, mode: 'current', objectRefs });
    if (context?.focus?.areaIds?.length) result.push({ systemId: system.id, mode: 'current', areaIds: context.focus.areaIds });
  }
  return result;
}
export function uniqueObjects(items: SituationObject[]) { return [...new Map(items.map(item => [refKey(item.ref), item])).values()]; }
export function executionTrailFeatures(objects: SituationObject[], selected?: string) {
  return objects.flatMap(item => {
    if (!('executionTrack' in item.properties) || !item.properties.executionTrack || item.properties.executionTrack.length < 2) return [];
    return [{
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: item.properties.executionTrack.map(point => point.position) },
      properties: { key: refKey(item.ref), selected: refKey(item.ref) === selected, state: item.properties.executionState },
    }];
  });
}
export const sourceCategories=[['road','道路'],['vehicle','车辆'],['facility','站点与地点'],['hydrant','水源'],['resource','资源池'],['area','区域']] as const;
export type SourceCategory=typeof sourceCategories[number][0];
/** Display grouping follows declared fields, never names or inferred vehicle models. */
export function sourceCategory(item: SituationObject):SourceCategory {
  if(item.ref.objectType==='road' || item.ref.objectType==='area')return item.ref.objectType;
  const category=item.resourceData?.resource.category;
  if(category==='vehicle' || category==='fire_engine')return 'vehicle';
  if(category==='facility' || category==='hydrant')return category;
  return 'resource';
}
export function visibleSourceCategories(objects:SituationObject[]) {
  const declared=new Set(objects.map(sourceCategory));
  return sourceCategories.filter(([kind])=>kind==='road' || kind==='area' || declared.has(kind) || (kind==='resource'&&!['vehicle','facility','hydrant'].some(kind=>declared.has(kind as SourceCategory))));
}
export function resourceTypeLabel(item:SituationObject) {
  const resource=item.resourceData?.resource;
  if(resource?.vehicle)return {water_tanker:'水罐车',foam:'泡沫车',ladder:'登高车',rescue:'抢险救援车',communications:'通信车',logistics:'后勤保障车'}[resource.vehicle.type];
  return ({vehicle:'车辆',fire_engine:'消防车辆',facility:'站点或地点',hydrant:'水源点',vessel:'船舶',rescue_boat:'救援艇',unknown:'类型待确认'} as Record<string,string>)[resource?.category || ''] || '';
}
/** The short label preserves the source's clock text; full dates/offsets remain in details. */
export function shortSourceTime(value:string) { return /T(\d{2}:\d{2})/.exec(value)?.[1] || value; }
export function positionNote(item:SituationObject,at?:string) {
  const position=item.resourceData?.resource.position;
  if(!position || !item.geometry)return '';
  if(position.meaning==='planned')return '计划位置，当前位置待确认';
  if(position.meaning==='estimated')return '估计位置，当前位置待确认';
  if(position.meaning==='unknown' || position.appliesTo==='unknown' || !at || !resourceFactActive(position,at))return `${position.reportedAt?`最后记录${shortSourceTime(position.reportedAt)}，`:''}当前位置待确认`;
  return '';
}
export function objectStatus(item: SituationObject,at?:string) {
  if ('executionState' in item.properties && item.properties.executionState) return {
    waiting: '待出发 · 任务占用', en_route: '途中 · 任务占用', blocked: '受阻 · 任务占用',
    arrived: '已到场 · 任务占用', cancelled: '行动已取消',
  }[item.properties.executionState];
  if ('availableCount' in item.properties) return `可用车辆 ${item.properties.availableCount} 辆`;
  if ('passability' in item.properties) return ({ open: '可通行', restricted: '限制通行', closed: '封闭', unknown: '状态未知' } as Record<string,string>)[String(item.properties.passability)] || '状态未知';
  const resource=item.resourceData?.resource;
  if(resource?.availability) {
    if(!at || !resourceFactActive(resource.availability,at))return '可用状态待确认（声明当前不生效）';
    return {available:'来源声明可用',unavailable:'来源声明不可用',unknown:'来源声明：状态待确认'}[resource.availability.state];
  }
  if(resource)return `${resourceTypeLabel(item) || '资源'} · 来源未提供可用状态`;
  return item.ref.objectType === 'area' ? '业务区域' : '来源未提供状态';
}
