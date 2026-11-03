import type { AccessStore } from '../access/store.js';
import type { ContextService } from '../context/service.js';
import { TaskQueryService } from '../context/task-query.js';
import type { ContextPrincipal, ContextRef, InformationReportIndex, SituationObject } from '../contracts/context.js';
import type { BackgroundEvent } from '../contracts/background.js';
import type { ContinuousInput, TaskDiscovery } from '../contracts/continuous.js';
import { RequestError } from '../contracts/errors.js';
import { SpatialAnalysisService } from '../spatial/service.js';

const key=(ref:ContextRef)=>JSON.stringify([ref.systemId,ref.objectType,ref.objectId]);
const limit=()=>new RequestError('TASK_DISCOVERY_LIMIT','完整任务关联核验超过本轮上限，未输出截断的成功结果。',409);
const unique=(refs:ContextRef[])=>[...new Map(refs.map(ref=>[key(ref),ref])).values()];
export interface TaskDiscoveryScope {
  principal:Extract<ContextPrincipal,{kind:'service'}>;requestId:string;toolCallId:string;signal:AbortSignal;
  check():void; baseline(taskId:string):string|undefined;
}
/** Read-only discovery is itself a native tool. Nested calculations are not forged spatial tool calls. */
export async function discoverTasks(access:AccessStore,context:ContextService,inputs:ContinuousInput[],event:(id:string)=>BackgroundEvent,scope:TaskDiscoveryScope):Promise<TaskDiscovery> {
  const check=()=>{scope.signal.throwIfAborted();scope.check();context.assertServiceScope(scope.principal.scope);};check();
  const queries=new TaskQueryService(access),tasks:TaskDiscovery['tasks']=[];
  let cursor:string|undefined;
  do {
    const page=queries.search({limit:20,...(cursor?{cursor}:{})},scope.principal,scope.signal);
    for(const task of page.data.items) tasks.push({task:{id:task.id,title:task.title,goal:task.goal,revision:task.revision,...(task.context?{context:task.context}:{})},candidate:'uncertain',reason:'尚待核验关联',spatialResultRefs:[]});
    if(tasks.length>100)throw limit();cursor=page.data.nextCursor??undefined;
  } while(cursor);
  const result:TaskDiscovery={schemaVersion:1,requestId:scope.requestId,toolCallId:scope.toolCallId,queriedAt:new Date().toISOString(),inputs:[],tasks,spatialResults:[],sourceQueries:[]};
  const snapshots=new Map<string,string>(),sourceStamps=new Map<string,string>();
  const observe=(ref:ContextRef,revision:number,geometry:unknown,properties:unknown,effectiveAt:unknown,validTime:unknown)=>{
    const value=JSON.stringify([revision,geometry,properties,effectiveAt,validTime]),prior=snapshots.get(key(ref));
    if(prior!==undefined&&prior!==value)throw new RequestError('TASK_DISCOVERY_INCOMPLETE','同一轮关联计算中来源对象发生变化，请重新核验。',409);
    snapshots.set(key(ref),value);
  };
  const stamp=(systemId:string,asOf:string)=>{const prior=sourceStamps.get(systemId);if(prior!==undefined&&prior!==asOf)throw new RequestError('TASK_DISCOVERY_INCOMPLETE','同一轮关联计算的来源快照不一致，请重新核验。',409);sourceStamps.set(systemId,asOf);};
  const query=async(tool:'situation_query'|'information_search'|'information_read',params:unknown)=>{
    check();const read=await context.query(tool,params,scope.principal,scope.signal);check();
    if('changeCursor' in read.data){stamp(read.systemId,read.data.asOf);for(const object of read.data.items)observe(object.ref,object.revision,object.geometry,{...object.properties,name:object.name,objectType:object.ref.objectType},object.effectiveAt,object.validTime);}
    if(result.sourceQueries!.length>=100)throw limit();result.sourceQueries!.push(read);return read;
  };
  const situationCache=new Map<string,SituationObject[]>();
  const sourceObjects=async(systemId:string)=>{
    const saved=situationCache.get(systemId);if(saved)return saved;
    let cursor:string|undefined,stamp:string|undefined;const objects:SituationObject[]=[],seen=new Set<string>();
    do {
      const response=await query('situation_query',{systemId,mode:'current',limit:100,...(cursor?{cursor}:{})});
      if(!('changeCursor' in response.data))throw new RequestError('TASK_DISCOVERY_INCOMPLETE','来源未提供完整态势快照。');
      const data=response.data,current=JSON.stringify([data.asOf,data.changeCursor]);
      if(stamp!==undefined&&stamp!==current || data.unknownRefs.length)throw new RequestError('TASK_DISCOVERY_INCOMPLETE','来源分页变化，未完成关联核验。');stamp=current;
      objects.push(...data.items);if(objects.length>500)throw limit();
      if(data.hasMore&&(!data.nextCursor||seen.has(data.nextCursor)))throw new RequestError('TASK_DISCOVERY_INCOMPLETE','来源分页不完整。');
      cursor=data.hasMore?data.nextCursor!:undefined;if(cursor)seen.add(cursor);
    }while(cursor);
    situationCache.set(systemId,objects);return objects;
  };
  for(const input of inputs) {
    const located:TaskDiscovery['inputs'][number]={inputId:input.id,objectRefs:[],resolved:false,reason:'输入未提供可核验的业务对象身份，需结合原文逐任务核实。'};
    result.inputs.push(located);
    try {
      if(input.kind==='task_revision') {
        located.objectRefs=unique((input.task.context?.businessRefs??[]).map(({systemId,objectType,objectId})=>({systemId,objectType,objectId})));
        located.resolved=located.objectRefs.length>0 && located.objectRefs.every(ref=>scope.principal.scope.systemIds.includes(ref.systemId));
        located.reason=located.resolved?'采用人员维护的任务业务引用；修订任务本身必须重评。':'任务修订缺少获准业务对象引用，修订任务本身仍须评估。';
        if(!located.resolved)located.objectRefs=[];
        continue;
      }
      const incoming=event(input.eventId);
      if(!incoming.systemId||!incoming.subjectId)continue;
      const system=context.config.systems.find(system=>system.id===incoming.systemId);
      if(!scope.principal.scope.systemIds.includes(incoming.systemId))throw new RequestError('CONTEXT_FORBIDDEN','输入业务来源不在当前授权范围。');
      if(system?.adapter==='mock-situation-http') {
        const matches=(await sourceObjects(incoming.systemId)).filter(object=>object.ref.objectId===incoming.subjectId);
        if(matches.length!==1) {located.reason='来源对象身份不存在或不唯一，不能认定无关联。';continue;}
        located.objectRefs=[matches[0].ref];
      } else if(system?.adapter==='mock-information-http') {
        const reports=new Map<string,InformationReportIndex>();let next:string|undefined,asOf:string|undefined;const seen=new Set<string>();
        do {
          const response=await query('information_search',{systemId:incoming.systemId,subjectId:incoming.subjectId,limit:100,...(next?{cursor:next}:{})});
          if(!('items' in response.data)||'changeCursor' in response.data||'nextAfter' in response.data)throw new RequestError('TASK_DISCOVERY_INCOMPLETE','报告索引未完整返回。');
          const data=response.data;
          if(asOf!==undefined&&asOf!==data.asOf)throw new RequestError('TASK_DISCOVERY_INCOMPLETE','报告索引在分页中变化。');asOf=data.asOf;
          for(const raw of data.items){const item=raw as InformationReportIndex;if(item.subjectId!==incoming.subjectId)throw new RequestError('TASK_DISCOVERY_INCOMPLETE','报告主题与输入不匹配。');const prior=reports.get(item.reportId);if(!prior||prior.revision<item.revision)reports.set(item.reportId,item);}
          if(reports.size>20)throw limit();if(data.hasMore&&(!data.nextCursor||seen.has(data.nextCursor)))throw new RequestError('TASK_DISCOVERY_INCOMPLETE','报告分页不完整。');next=data.hasMore?data.nextCursor!:undefined;if(next)seen.add(next);
        }while(next);
        for(const index of reports.values()) {
          const read=await query('information_read',{systemId:incoming.systemId,reportId:index.reportId,revision:index.revision});
          if(!('item' in read.data)||read.data.item.subjectId!==incoming.subjectId||read.data.item.revision!==index.revision)throw new RequestError('TASK_DISCOVERY_INCOMPLETE','报告正文与索引不一致。');
          located.objectRefs.push(...read.data.item.objectRefs);
        }
        located.objectRefs=unique(located.objectRefs);
      }
      located.resolved=located.objectRefs.length>0&&located.objectRefs.every(ref=>scope.principal.scope.systemIds.includes(ref.systemId));
      if(!located.resolved){located.objectRefs=[];located.reason='未取得完整、获准的来源对象引用，需要核实。';}
      else located.reason='依据输入来源身份与主题查询得到实际业务对象引用。';
    }catch(error){check();if(error instanceof RequestError && error.code==='TASK_DISCOVERY_LIMIT')throw error;located.objectRefs=[];located.resolved=false;located.reason=error instanceof RequestError?`${error.code}：${error.message}`:'来源查询失败，关联尚未核实。';}
  }
  const targets=unique(result.inputs.flatMap(input=>input.objectRefs));
  const spatial=new SpatialAnalysisService(undefined,context);
  const cache=new Map<string,Awaited<ReturnType<typeof spatial.analyze>>|Error>();
  const spatialScope={principal:scope.principal,check,signal:scope.signal,resolveResult:()=>{throw new RequestError('SPATIAL_FORBIDDEN','任务发现仅计算实际来源对象。');}};
  for(const item of tasks) {
    check();const refs=item.task.context?.businessRefs??[];
    const direct=refs.some(ref=>targets.some(target=>key(target)===key(ref)));
    const revised=inputs.some(input=>input.kind==='task_revision'&&input.task.id===item.task.id);
    const prior=scope.baseline(item.task.id);
    const gaps:string[]=[];
    let matched=false,unknown=result.inputs.some(input=>!input.resolved)||!refs.length||refs.some(ref=>!ref.role||ref.role==='reference');
    for(const ref of refs) {
      if(!scope.principal.scope.systemIds.includes(ref.systemId)){unknown=true;gaps.push('任务引用包含当前未获准核验的来源。');continue;}
      if(!ref.role||ref.role==='reference')continue;
      for(const target of targets) {
        if(key(ref)===key(target))continue;
        const pair=JSON.stringify([key(ref),key(target)]);
        let checked=cache.get(pair);
        if(!checked) {
          if(cache.size>=100)throw limit();
          try {
            checked=await spatial.analyze({operation:'relate',relation:'intersects',input:{kind:'source',systemId:ref.systemId,objectRefs:[{systemId:ref.systemId,objectType:ref.objectType,objectId:ref.objectId}]},target:{kind:'source',systemId:target.systemId,objectRefs:[target]}},spatialScope,scope.requestId,`${scope.toolCallId}:spatial:${result.spatialResults.length}`);
            for(const proof of checked.provenance)if(proof.input.kind==='source')stamp(proof.input.systemId,proof.asOf);
            for(const object of [...checked.items,...(checked.referenceItems??[])])if(object.source)observe(object.source.ref,object.source.revision,object.geometry,object.properties,object.source.effectiveAt,object.source.validTime);
            result.spatialResults.push(checked);
          }catch(error){check();if(error instanceof RequestError&&error.code==='TASK_DISCOVERY_INCOMPLETE')throw error;checked=error instanceof Error?error:new Error('空间核验失败');}
          cache.set(pair,checked);
        }
        if(checked instanceof Error){unknown=true;gaps.push(checked instanceof RequestError?`${checked.code}：${checked.message}`:checked.message);}
        else {item.spatialResultRefs.push(checked.resultRef);if(checked.values&&'matches' in checked.values&&checked.values.matches)matched=true;}
      }
    }
    if(result.inputs.some(input=>!input.resolved))gaps.push('至少一条输入尚未定位获准对象，需结合原文核实。');
    if(!refs.length||refs.some(ref=>!ref.role||ref.role==='reference'))gaps.push('任务缺少明确用途的业务对象关联。');
    item.spatialResultRefs=[...new Set(item.spatialResultRefs)];
    item.candidate=direct||matched||revised||prior?'related':unknown?'uncertain':'unrelated';
    item.reason=revised?'本轮任务条件修订，需要明确重评。':direct?'任务业务引用与来源对象直接关联，须结合业务条件判断影响。':matched?'任务业务对象与变化对象相交，须核对生效时间和业务限制。':prior?'任务已有发布判断，须核对旧影响是否仍成立或应撤回。':unknown?'来源定位、任务对象用途或几何资料不完整，需要结合资料核实，不能判为无关联。':'已核验明确业务引用与全部变化对象，未发现直接引用或空间相交。';
    if(gaps.length)item.reason+=` 资料缺口：${[...new Set(gaps)].join('；')}`;
  }
  check();
  const current=access.listActivePublic().sort((a,b)=>a.id.localeCompare(b.id));
  if(JSON.stringify(current.map(t=>[t.id,t.revision]))!==JSON.stringify(tasks.map(i=>[i.task.id,i.task.revision]).sort(([a],[b])=>String(a).localeCompare(String(b)))))throw new RequestError('TASK_REVISION_CHANGED','任务清单在核验中变化，请重新核验。',409);
  if(Buffer.byteLength(JSON.stringify(result))>1024*1024)throw limit();
  return result;
}
