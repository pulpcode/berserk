import { randomUUID } from 'node:crypto';
import type { ContextFilters, ContextQueryParams, ContextRef, InformationReport, SituationObject } from '../../../src/contracts/context.js';
import { normalizeContextQuery } from '../../../src/context/validation.js';
import { ScenarioStore, sceneChangeCursor, sceneClock, sceneError, stable } from './store.js';

const sameRef=(a:ContextRef,b:ContextRef)=>a.systemId===b.systemId&&a.objectType===b.objectType&&a.objectId===b.objectId;
const owner=(value:string)=>/^(?:scene:)?(run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-|:|$)/i.exec(value)?.[1];
function matches(item:{objectRefs:ContextRef[];areaIds:string[]},filters:ContextFilters,text:string){return (!filters.objectRefs||filters.objectRefs.some(ref=>item.objectRefs.some(other=>sameRef(ref,other))))&&(!filters.areaIds||filters.areaIds.some(id=>item.areaIds.includes(id)))&&(!filters.query||text.toLowerCase().includes(filters.query.toLowerCase()));}
function timed<T>(items:T[],stamp:(item:T)=>string|null,from?:string,to?:string){if(!from&&!to)return {items,timeUnknownCount:0};return {items:items.filter(item=>{const time=stamp(item);return time!==null&&(!from||Date.parse(time)>=Date.parse(from))&&(!to||Date.parse(time)<Date.parse(to));}),timeUnknownCount:items.filter(item=>stamp(item)===null).length};}

export function scenarioQuery(store:ScenarioStore) {
  const versions=new Map<string,{at:number;record:ReturnType<ScenarioStore['get']>}>();
  const expired=new Set<string>();
  const snapshots=new Map<string,{at:number;ttlMs:number;record:ReturnType<ScenarioStore['get']>}>();
  const cursors=new Map<string,{instanceId:string;revision:number;key:string;offset:number}>();
  return (url:URL,boundInstanceId?:string,readId?:string,mapDisplay=false):unknown|undefined => {
    const detail=/^\/intel\/reports\/([^/]+)$/.exec(url.pathname),reports=url.pathname==='/intel/reports',current=url.pathname==='/situation/objects',changes=url.pathname==='/situation/changes';
    if(!detail&&!reports&&!current&&!changes)return;
    if(boundInstanceId!==undefined&&!/^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(boundInstanceId))throw sceneError('固定来源范围无效。','SCENARIO_CLOCK_CONFLICT');
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
    const unique=[...new Set(selectedOwners)];if(unique.length>1||unique.length&&values.some(value=>!owner(value))||boundInstanceId!==undefined&&(unique.some(id=>id!==boundInstanceId)||values.some(value=>owner(value)!==boundInstanceId)))throw sceneError('同一次查询不能混合场景轮次或旧来源范围。','SCENARIO_CLOCK_CONFLICT');
    if('cursor' in params&&params.cursor&&!cursor){if(boundInstanceId!==undefined)throw sceneError('分页游标无效。','INVALID_CURSOR',400);return;}
    if(boundInstanceId===undefined&&!unique.length&&values.length)return;
    const instanceId=boundInstanceId??unique[0]??store.active().instanceId;if(!instanceId)return;
    let record=store.get(instanceId);
    const readKey=readId?`${instanceId}:${readId}`:undefined;
    if(readKey&&record.instance.definitionVersion==='7'){
      if(expired.has(readKey))throw sceneError('读取快照已过期，请重新查询。','CURSOR_STALE');
      const saved=snapshots.get(readKey);
      if(saved){if(Date.now()-saved.at>saved.ttlMs)throw sceneError('读取快照已过期，请重新查询。','CURSOR_STALE');record=saved.record;}
      else {for(const [key,value] of snapshots)if(Date.now()-value.at>value.ttlMs){expired.add(key);snapshots.delete(key);}if(expired.size>100000||snapshots.size>=2048)throw sceneError('固定读取容量已满，请稍后重试。','UNAVAILABLE',503);const versionKey=`${instanceId}:${record.instance.revision}`;
        for(const [key,value] of versions)if(Date.now()-value.at>60000)versions.delete(key);
        const shared=versions.get(versionKey);if(shared)record=shared.record;else versions.set(versionKey,{at:Date.now(),record});
        snapshots.set(readKey,{at:Date.now(),ttlMs:mapDisplay?60000:30*60000,record});}
    }
    const clock=sceneClock(record),asOf=clock.businessNow;
    const page=<T>(items:T[],filters:ContextFilters,timeUnknownCount=0,extra:(hasMore:boolean)=>Record<string,unknown>=()=>({}))=>{
      const key=stable({path:url.pathname,...Object.fromEntries(Object.entries(filters).filter(([key])=>key!=='cursor'))});let offset=0;
      if(filters.cursor){const saved=cursors.get(filters.cursor);if(!saved||saved.key!==key||saved.instanceId!==instanceId)throw sceneError('分页游标无效。','INVALID_CURSOR',400);if(saved.revision!==clock.revision)throw sceneError('场景已推进或切换，请重新查询第一页。','CURSOR_STALE');offset=saved.offset;}
      const limit=filters.limit??20,token=randomUUID();
      const response=(count:number)=>{
        const hasMore=offset+count<items.length;
        return {systemId,asOf,snapshotClock:clock,...(mapDisplay&&record.instance.advancing?{mapMotion:{businessNow:asOf,serverNow:new Date().toISOString(),progress:record.instance.advancing,vehicles:Object.values(record.execution?.roots??{}).flatMap(root=>root.vehicles).filter(v=>v.state==='en_route').map(v=>({ref:v.vehicle,path:v.path,distance:v.distanceMeters,travelled:v.travelledMeters,speed:v.speedMetersPerSecond}))}}:{}),items:items.slice(offset,offset+count),limit,nextCursor:hasMore?token:null,hasMore,timeUnknownCount,...extra(hasMore)};
      };
      let count=0;
      while(count<limit && offset+count<items.length) {
        if(Buffer.byteLength(JSON.stringify(response(count+1)),'utf8')>200*1024)break;
        count++;
      }
      const result=response(count);
      if(Buffer.byteLength(JSON.stringify(result),'utf8')>200*1024 || !count && offset<items.length)throw sceneError('单条来源资料超过分页预算，请缩小资料范围。','RESPONSE_TOO_LARGE',413);
      if(result.hasMore){cursors.set(token,{instanceId,revision:clock.revision,key,offset:offset+count});if(cursors.size>2048)cursors.delete(cursors.keys().next().value!);}
      return result;
    };
    if(detail&&'reportId' in params){const item=record.reports.filter(r=>r.reportId===params.reportId&&(!('revision' in params)||r.revision===params.revision)).sort((a,b)=>b.revision-a.revision)[0];if(!item)throw sceneError('报告或修订不存在。','NOT_FOUND',404);return {systemId,asOf,snapshotClock:clock,item};}
    if(reports&&'limit' in params){const selection=record.reports.filter(r=>(!('reportId' in params)||!params.reportId||r.reportId===params.reportId)&&(!('subjectId' in params)||!params.subjectId||r.subjectId===params.subjectId)&&matches(r,params,`${r.title}\n${r.content}`));const result=timed(selection,r=>r.observedAt,'from' in params?params.from:undefined,'to' in params?params.to:undefined);return page(result.items.sort((a,b)=>a.reportId.localeCompare(b.reportId)||a.revision-b.revision).map(({content:_content,...index}:InformationReport)=>{void _content;return index;}),params,result.timeUnknownCount);}
    const filters=params as Extract<ContextQueryParams,{mode:unknown}>;
    if(filters.objectRefs?.some(ref=>ref.systemId!=='situation'||!['road','resource','area'].includes(ref.objectType)))throw sceneError('不支持该系统或对象类型。','UNSUPPORTED_FILTER',400);
    if(filters.taskId!==undefined||filters.relation!==undefined)throw sceneError('本来源不依据平台任务编号推断分配或支援。','UNSUPPORTED_FILTER',400);
    const category=(object:SituationObject)=>(!filters.objectTypes||filters.objectTypes.includes(object.ref.objectType))&&(filters.category===undefined||object.resourceData?.resource.category===filters.category);
    const unknownRefs=filters.objectRefs?.filter(ref=>!record.objects.some(object=>sameRef(ref,object.ref)))??[],head=sceneChangeCursor(instanceId,record.changes.length);
    if(current)return page(record.objects.filter(object=>category(object)&&matches({objectRefs:[object.ref],areaIds:object.areaIds},filters,object.name)).sort((a,b)=>a.ref.objectType.localeCompare(b.ref.objectType)||a.ref.objectId.localeCompare(b.ref.objectId)),filters,0,()=>({unknownRefs,changeCursor:head,resourceCoverage:{status:'complete'}}));
    let start=0;if(filters.after!==undefined){const index=[sceneChangeCursor(instanceId,0),...record.changes.map(c=>c.cursor)].indexOf(filters.after);if(index<0)throw sceneError('变化游标不属于本轮。','INVALID_CHANGE_CURSOR',400);start=index;}
    const result=timed(record.changes.slice(start).filter(change=>category(change.after)&&matches({objectRefs:[change.after.ref],areaIds:change.after.areaIds},filters,change.after.name)),change=>change.effectiveAt,filters.from,filters.to),summary=['6','7'].includes(record.instance.definitionVersion);
    const project=(item:SituationObject):SituationObject=>{
      if(!summary || !('executionTrack' in item.properties))return item;
      const {executionState,executionCommandId}=item.properties;
      return {...item,properties:{executionState,executionCommandId,executionTrackIncluded:false}};
    };
    const items=summary?result.items.map(change=>({...change,before:project(change.before),after:project(change.after)})):result.items;
    return page(items,filters,result.timeUnknownCount,hasMore=>({unknownRefs,nextAfter:hasMore?null:head,...(summary?{historyView:'state'}:{})}));
  };
}
