import { randomUUID } from 'node:crypto';
import type { ContextFilters, ContextQueryParams, ContextRef, InformationReport, SituationObject } from '../../../src/contracts/context.js';
import { normalizeContextQuery } from '../../../src/context/validation.js';
import { ScenarioStore, sceneChangeCursor, sceneClock, sceneError, stable } from './store.js';

const sameRef=(a:ContextRef,b:ContextRef)=>a.systemId===b.systemId&&a.objectType===b.objectType&&a.objectId===b.objectId;
const owner=(value:string)=>/^(?:scene:)?(run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-|:|$)/i.exec(value)?.[1];
function matches(item:{objectRefs:ContextRef[];areaIds:string[]},filters:ContextFilters,text:string){return (!filters.objectRefs||filters.objectRefs.some(ref=>item.objectRefs.some(other=>sameRef(ref,other))))&&(!filters.areaIds||filters.areaIds.some(id=>item.areaIds.includes(id)))&&(!filters.query||text.toLowerCase().includes(filters.query.toLowerCase()));}
function timed<T>(items:T[],stamp:(item:T)=>string|null,from?:string,to?:string){if(!from&&!to)return {items,timeUnknownCount:0};return {items:items.filter(item=>{const time=stamp(item);return time!==null&&(!from||Date.parse(time)>=Date.parse(from))&&(!to||Date.parse(time)<Date.parse(to));}),timeUnknownCount:items.filter(item=>stamp(item)===null).length};}

export function scenarioQuery(store:ScenarioStore) {
  const cursors=new Map<string,{instanceId:string;revision:number;key:string;offset:number}>();
  return (url:URL):unknown|undefined => {
    const detail=/^\/intel\/reports\/([^/]+)$/.exec(url.pathname),reports=url.pathname==='/intel/reports',current=url.pathname==='/situation/objects',changes=url.pathname==='/situation/changes';
    if(!detail&&!reports&&!current&&!changes)return;
    const systemId=detail||reports?'intel':'situation',raw:Record<string,unknown>={systemId,...(current||changes?{mode:current?'current':'changes'}:{})};
    if(detail)raw.reportId=decodeURIComponent(detail[1]);
    const allowed=detail?['revision']:reports?['reportId','subjectId','objectRefs','areaIds','from','to','query','limit','cursor']:['objectRefs','areaIds','objectTypes','taskId','relation','category','query','limit','cursor',...(changes?['after','from','to']:[])];
    for(const [key,value] of url.searchParams){if(!allowed.includes(key)||url.searchParams.getAll(key).length!==1)throw sceneError('未知或重复查询参数。','INVALID_ARGUMENT',400);if(['objectRefs','areaIds','objectTypes'].includes(key)){try{raw[key]=JSON.parse(value);}catch{throw sceneError('数组编码无效。','INVALID_ARGUMENT',400);}}else if(['limit','revision'].includes(key)){if(!/^\d+$/.test(value))throw sceneError('需要十进制整数。','INVALID_ARGUMENT',400);raw[key]=Number(value);}else raw[key]=value;}
    const params=normalizeContextQuery(detail?'information_read':reports?'information_search':'situation_query',raw);
    const values:string[]=[...('objectRefs' in params?params.objectRefs?.map(ref=>ref.objectId)??[]:[]),...('areaIds' in params?params.areaIds??[]:[]),...('reportId' in params&&params.reportId?[params.reportId]:[]),...('subjectId' in params&&params.subjectId?[params.subjectId]:[])];
    const after='after' in params?params.after:undefined;if(after)values.push(after);
    const selectedOwners=[...new Set(values.map(owner).filter((id):id is string=>Boolean(id)))];
    const cursor='cursor' in params&&params.cursor?cursors.get(params.cursor):undefined;
    if(cursor)selectedOwners.push(cursor.instanceId);
    const unique=[...new Set(selectedOwners)];if(unique.length>1||unique.length&&values.some(value=>!owner(value)))throw sceneError('同一次查询不能混合场景轮次或旧来源范围。','SCENARIO_CLOCK_CONFLICT');
    if(!unique.length&&values.length)return;
    if('cursor' in params&&params.cursor&&!cursor)return;
    const instanceId=unique[0]??store.active().instanceId;if(!instanceId)return;
    const record=store.get(instanceId),clock=sceneClock(record),asOf=clock.businessNow;
    const page=<T>(items:T[],filters:ContextFilters,timeUnknownCount=0)=>{
      const key=stable({path:url.pathname,...Object.fromEntries(Object.entries(filters).filter(([key])=>key!=='cursor'))});let offset=0;
      if(filters.cursor){const saved=cursors.get(filters.cursor);if(!saved||saved.key!==key||saved.instanceId!==instanceId)throw sceneError('分页游标无效。','INVALID_CURSOR',400);if(saved.revision!==clock.revision)throw sceneError('场景已推进或切换，请重新查询第一页。','CURSOR_STALE');offset=saved.offset;}
      const limit=filters.limit??20,hasMore=offset+limit<items.length;let nextCursor:string|null=null;
      if(hasMore){nextCursor=randomUUID();cursors.set(nextCursor,{instanceId,revision:clock.revision,key,offset:offset+limit});if(cursors.size>2048)cursors.delete(cursors.keys().next().value!);}
      return {systemId,asOf,snapshotClock:clock,items:items.slice(offset,offset+limit),limit,nextCursor,hasMore,timeUnknownCount};
    };
    if(detail&&'reportId' in params){const item=record.reports.filter(r=>r.reportId===params.reportId&&(!('revision' in params)||r.revision===params.revision)).sort((a,b)=>b.revision-a.revision)[0];if(!item)throw sceneError('报告或修订不存在。','NOT_FOUND',404);return {systemId,asOf,snapshotClock:clock,item};}
    if(reports&&'limit' in params){const selection=record.reports.filter(r=>(!('reportId' in params)||!params.reportId||r.reportId===params.reportId)&&(!('subjectId' in params)||!params.subjectId||r.subjectId===params.subjectId)&&matches(r,params,`${r.title}\n${r.content}`));const result=timed(selection,r=>r.observedAt,'from' in params?params.from:undefined,'to' in params?params.to:undefined);return page(result.items.sort((a,b)=>a.reportId.localeCompare(b.reportId)||a.revision-b.revision).map(({content:_content,...index}:InformationReport)=>{void _content;return index;}),params,result.timeUnknownCount);}
    const filters=params as Extract<ContextQueryParams,{mode:unknown}>;
    if(filters.objectRefs?.some(ref=>ref.systemId!=='situation'||!['road','resource','area'].includes(ref.objectType)))throw sceneError('不支持该系统或对象类型。','UNSUPPORTED_FILTER',400);
    if(filters.taskId!==undefined||filters.relation!==undefined)throw sceneError('本来源不依据平台任务编号推断分配或支援。','UNSUPPORTED_FILTER',400);
    const category=(object:SituationObject)=>(!filters.objectTypes||filters.objectTypes.includes(object.ref.objectType))&&(filters.category===undefined||object.resourceData?.resource.category===filters.category);
    const unknownRefs=filters.objectRefs?.filter(ref=>!record.objects.some(object=>sameRef(ref,object.ref)))??[],head=sceneChangeCursor(instanceId,record.changes.length);
    if(current)return {...page(record.objects.filter(object=>category(object)&&matches({objectRefs:[object.ref],areaIds:object.areaIds},filters,object.name)).sort((a,b)=>a.ref.objectType.localeCompare(b.ref.objectType)||a.ref.objectId.localeCompare(b.ref.objectId)),filters),unknownRefs,changeCursor:head,resourceCoverage:{status:'complete'}};
    let start=0;if(filters.after!==undefined){const index=[sceneChangeCursor(instanceId,0),...record.changes.map(c=>c.cursor)].indexOf(filters.after);if(index<0)throw sceneError('变化游标不属于本轮。','INVALID_CHANGE_CURSOR',400);start=index;}
    const result=timed(record.changes.slice(start).filter(change=>category(change.after)&&matches({objectRefs:[change.after.ref],areaIds:change.after.areaIds},filters,change.after.name)),change=>change.effectiveAt,filters.from,filters.to),response=page(result.items,filters,result.timeUnknownCount);return {...response,unknownRefs,nextAfter:response.hasMore?null:head};
  };
}
