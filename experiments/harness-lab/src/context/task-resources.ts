import { summarizeResources, resourceStatisticsItems, resourceEntityCountUnknown } from '../contracts/resource-summary.js';
import type { AnnotationService, AnnotationActor } from '../annotations/service.js';
import type { ContextService } from './service.js';
import type { ContextRef } from '../contracts/context.js';
import { resourceRequestValid } from '../contracts/resource-results.js';
import type { ResourceQuery, ResourceResult, ResourceRecord, ResourceItem, ResourceSourceSelection, ResourceRequest } from '../contracts/resource-results.js';
import { resourceEvidence } from '../contracts/task-resources.js';
import type { SpatialResult } from '../contracts/spatial.js';
import { RequestError } from '../contracts/errors.js';

export interface ResourceScope {actor:AnnotationActor;taskId:string;sessionId:string;signal:AbortSignal;check:()=>void;resolveMessage:(entryId:string)=>{text:string;resourceRefs:ContextRef[]};listMessages?:()=>Array<{entryId:string;text:string;resourceRefs:ContextRef[]}>}
const key=(ref:ContextRef)=>JSON.stringify([ref.systemId,ref.objectType,ref.objectId]);
const entity=(r:ResourceRecord)=>r.association?JSON.stringify([r.association.source.systemId,r.association.entityId]):r.source?.data?.entityId?JSON.stringify([r.source.ref.systemId,r.source.data.entityId]):undefined;
const fail=(code:string,message:string)=>new RequestError(`RESOURCE_${code}`,message);
const active=(fact:{effectiveAt?:string;validUntil?:string;conditions?:string[]}|undefined,at:string)=>!!fact&&(!fact.effectiveAt||Date.parse(fact.effectiveAt)<=Date.parse(at))&&(!fact.validUntil||Date.parse(fact.validUntil)>Date.parse(at))&&!fact.conditions?.length;
export function organizeResources(records:ResourceRecord[],taskId:string,at:string):ResourceItem[] {
 const groups=new Map<string,ResourceRecord[]>();
 for(const r of records){const id=entity(r)??r.id;groups.set(id,[...groups.get(id)??[],r]);}
 return [...groups].map(([id,rows])=>{
  const relations=rows.flatMap(r=>(r.resource.taskRelations??[]).filter(x=>x.taskId===taskId&&active(x,at)&&(!r.source||r.relationBasis.includes('来源任务映射已核实'))&&(x.relation!=='potential_support'||!r.source||r.relationBasis.includes('来源支援规则已核实'))).map(x=>x.relation));
  const relationBasis=[...new Set(rows.flatMap(r=>r.relationBasis))];
  const linked=relationBasis.some(x=>!x.startsWith('来源任务映射')&&!x.startsWith('来源支援规则'));
  const nonUnknown=[...new Set(relations.filter(x=>x!=='unconfirmed'))];
  const relation=nonUnknown.length===1?nonUnknown[0]:nonUnknown.length>1?'unconfirmed':linked?'related':'unconfirmed';
  const statuses=[...new Set(rows.filter(r=>active(r.resource.availability,at)).map(r=>r.resource.availability!.state).filter(s=>s!=='unknown'))];
  const availability=statuses.length>1?'conflict':statuses[0]??'unknown';
  const positions=rows.filter(r=>r.geometry&&r.resource.position?.meaning==='actual'&&r.resource.position.appliesTo==='resource'&&active(r.resource.position,at));
  const geometries=[...new Map(positions.map(r=>[JSON.stringify(r.geometry),r.geometry!])).values()];
  const categories=[...new Set(rows.map(r=>r.resource.category??'unknown'))];
  const limitations:string[]=[];
  if(!entity(rows[0]))limitations.push('没有可靠实体关联，是否重复未确认。');
  if(rows.some(r=>r.resource.taskRelations?.some(x=>x.taskId!==taskId))&&!linked&&!nonUnknown.length)limitations.push('资料明确关联其他任务，本任务关系未确认。');
  if(nonUnknown.length>1)limitations.push('任务关系存在冲突。');
  if(availability==='conflict')limitations.push('可用状态存在冲突。');
  const positionReason=geometries.length===1?undefined:geometries.length>1?'实际位置存在冲突。':'缺少有效且适用于资源的实际位置；计划、估计及站点位置未用于当前位置判断。';
  return {id,name:rows[0].name,recordIds:rows.map(r=>r.id),...(entity(rows[0])?{entityKey:entity(rows[0])}:{}),category:categories.length===1?categories[0]:'unknown',relation,relationBasis,availability,...(geometries.length===1?{geometry:geometries[0]}:{positionReason}),limitations} satisfies ResourceItem;
 });
}
export class TaskResourceService {
 constructor(readonly annotations:AnnotationService,readonly context?:ContextService){}
 authorize(result:ResourceResult,scope:ResourceScope){
  scope.signal.throwIfAborted();scope.check();const binding=this.annotations.binding(scope.actor,scope.sessionId);
  if(binding.taskId!==scope.taskId||result.owner.taskId!==scope.taskId||result.owner.sessionId!==scope.sessionId||result.owner.userId!==scope.actor.userId||result.owner.seatId!==scope.actor.seatId)throw fail('FORBIDDEN','当前身份或会话无法读取资源结果。');
  const systems=new Set(this.context?.catalog(scope.actor.seatId).systems.map(s=>s.id)??[]);
  if(result.dependencies.systemIds.some(id=>!systems.has(id)))throw fail('FORBIDDEN','当前身份无法读取结果依赖来源。');
  for(const ref of result.dependencies.annotations)this.annotations.version(scope.actor,scope.taskId,ref);
 }
 async query(request:ResourceQuery,scope:ResourceScope,requestId:string,toolCallId:string):Promise<ResourceResult>{
  if(!resourceRequestValid(request)||request.operation!=='query')throw fail('INVALID_INPUT','资源查询参数无效。');
  scope.signal.throwIfAborted();scope.check();const binding=this.annotations.binding(scope.actor,scope.sessionId);
  if(binding.taskId!==scope.taskId)throw fail('FORBIDDEN','任务与当前会话不一致。');
  if(request.purpose==='data'&&!request.sources?.length&&!request.annotations?.length)throw fail('SCOPE_REQUIRED','明确数据查询需要来源范围或固定标绘引用。');
  const task=this.annotations.access?.get(scope.taskId,scope.actor.seatId),refs=task?.context?.businessRefs??[];
  const result:ResourceResult={schemaVersion:2,resultRef:`resource:${requestId}:${encodeURIComponent(toolCallId)}`,requestId,toolCallId,createdAt:new Date().toISOString(),owner:{...scope.actor,taskId:scope.taskId,sessionId:scope.sessionId},parameters:structuredClone(request),statisticsScope:{at:'',relation:request.purpose==='task'?'related':'all',availability:'all'},records:[],items:[],coverage:[],relationshipCoverage:{status:'partial',reason:'仅按实际关联证据判断；已有平台引用不保证任务关联或分配名单完整。'},dependencies:{systemIds:[],annotations:[]},messages:[],exclusions:[],summary:{recordCount:0,itemCount:0,knownEntityCount:0,entityCount:null,quantities:[],limitations:[]}};
  result.statisticsScope.at=result.createdAt;
  let rawCount=0,pages=0;const sourceSnapshots=new Map<string,string>(),invalidSources=new Set<string>();
  const add=(record:ResourceRecord,count=true)=>{if(count&&++rawCount>500)throw fail('LIMIT','资源读取超过500条，未截断为完整清单。');if(result.records.some(r=>r.id===record.id))return;
   if(record.resource.meaning!=='actual_resource'){result.exclusions.push({id:record.id,reason:record.resource.meaning==='unspecified'?'未注明资源含义。':'不是实际资源声明。'});return;}
   if(request.category&&record.resource.category!==request.category){result.exclusions.push({id:record.id,reason:'不匹配本次资源类别。'});return;}result.records.push(record);};
  const derivedRefs:ContextRef[]=[];const derivedBasis=new Map<string,string>();
  const defaultTask=request.purpose==='task'&&request.sources===undefined&&request.annotations===undefined;
  if(defaultTask&&this.context)for(const ref of refs.filter(r=>r.objectType!=='resource')){
   result.dependencies.systemIds.push(ref.systemId);
   try{const response=await this.context.query(ref.objectType==='report'?'information_read':'situation_query',ref.objectType==='report'?{systemId:ref.systemId,reportId:ref.objectId}:{systemId:ref.systemId,mode:'current',objectRefs:[ref],limit:1},{kind:'seat',seatId:scope.actor.seatId},scope.signal);
    const linked='item' in response.data?response.data.item.objectRefs:'changeCursor' in response.data?response.data.items.flatMap(o=>'memberRefs' in o.properties?o.properties.memberRefs:[]):[];
    for(const linkedRef of linked.filter(r=>r.objectType==='resource')){derivedRefs.push(linkedRef);derivedBasis.set(key(linkedRef),`平台任务引用 ${key(ref)} 的结构化资源关联`);}
    result.coverage.push({source:key(ref),status:'complete',asOf:response.data.asOf});
   }catch(error){scope.signal.throwIfAborted();scope.check();if(error instanceof RequestError&&/FORBIDDEN|AUTH/.test(error.code))throw error;result.coverage.push({source:key(ref),status:'unavailable',reason:error instanceof Error?error.message:'关联资料读取失败。'});}
  }
  const sourceSelections:Array<ResourceSourceSelection & {optionalTask?:boolean}>=structuredClone(request.sources??[]);
  if(defaultTask){
   const linkedRefs=[...refs,...derivedRefs];
   const systems=[...new Set(linkedRefs.filter(r=>r.objectType==='resource').map(r=>r.systemId))];
   for(const systemId of systems){const list=linkedRefs.filter(r=>r.systemId===systemId&&r.objectType==='resource').map(({systemId,objectType,objectId})=>({systemId,objectType,objectId}));for(let i=0;i<list.length;i+=20)sourceSelections.push({systemId,objectRefs:list.slice(i,i+20)});}
  }
  if(defaultTask&&this.context)for(const system of this.context.config.systems.filter(s=>this.context!.catalog(scope.actor.seatId).systems.some(c=>c.id===s.id)&&s.adapter==='mock-situation-http')){
   const cap=system.resourceCapability;
   if(cap?.relations.includes('potential_support')&&cap.supportRule?.id!=='explicit-task-relation')(result.relationshipCoverage.sources??=[]).push({source:`${system.id}:support`,status:'unsupported',reason:'未配置可执行的支援规则；不会根据邻近位置认定支援。'});
   if(cap?.filters.includes('task')&&cap.taskIdMapping==='identity')sourceSelections.push({systemId:system.id,optionalTask:true});
   else (result.relationshipCoverage.sources??=[]).push({source:system.id,status:'unsupported',reason:'未配置可靠的任务查询映射；不影响明确对象的基础读取。'});
  }
  for(const selection of sourceSelections){
   if(invalidSources.has(selection.systemId))continue;
   scope.signal.throwIfAborted();scope.check();
   if(!this.context){result.coverage.push({source:selection.systemId,status:'unavailable',reason:'来源未配置。'});continue;}
   if(!this.context.catalog(scope.actor.seatId).systems.some(s=>s.id===selection.systemId))throw fail('FORBIDDEN','来源不存在或无权访问。');
   result.dependencies.systemIds.push(selection.systemId);
   const collected:ResourceRecord[]=[];let cursor:string|undefined,snapshot:string|undefined;let declaredCoverage:{status:'complete'|'partial';reason?:string}|undefined;const seen=new Set<string>();
   try{do{
    if(++pages>50)throw fail('LIMIT','资源分页超过50页。');
    const {optionalTask,...basic}=selection;
    const response=optionalTask?await this.context.queryTaskResources({systemId:selection.systemId,taskId:scope.taskId,...(cursor?{cursor}:{})},{kind:'seat',seatId:scope.actor.seatId},scope.signal):await this.context.query('situation_query',{...basic,mode:'current',...(selection.objectRefs?{}:{objectTypes:['resource']}),limit:100,...(cursor?{cursor}:{})},{kind:'seat',seatId:scope.actor.seatId},scope.signal);
    if(!('changeCursor' in response.data))throw fail('INCOMPLETE','来源未返回当前对象快照。');const data=response.data;
    declaredCoverage=data.resourceCoverage;const stamp=JSON.stringify([data.asOf,data.changeCursor,data.resourceCoverage??null]);if(snapshot&&snapshot!==stamp||data.unknownRefs.length)throw fail('INCOMPLETE','来源分页变化或精确对象缺失。');snapshot=stamp;const previousStamp=sourceSnapshots.get(selection.systemId);if(previousStamp&&previousStamp!==stamp)throw fail('INCOMPLETE','同一来源的多段读取快照发生变化。');sourceSnapshots.set(selection.systemId,stamp);
    for(const o of data.items){if(++rawCount>500)throw fail('LIMIT','资源原始记录读取超过500条。');if(o.ref.objectType!=='resource')throw fail('INCOMPLETE','来源未遵守资源类型筛选。');const id=key(o.ref);const resource=o.resourceData?.resource??('availableCount' in o.properties?{meaning:'actual_resource' as const,category:'vehicle' as const,granularity:'aggregate' as const,quantity:{value:o.properties.availableCount,unit:'辆' as const,meaning:'available' as const,scope:key(o.ref),evidence:[{kind:'source' as const,ref:o.ref,revision:o.revision}],...(o.effectiveAt?{effectiveAt:o.effectiveAt}:{}),...(o.validTime?.to?{validUntil:o.validTime.to}:{})}}:{meaning:'unspecified' as const});
     const cap=this.context.config.systems.find(s=>s.id===o.ref.systemId)?.resourceCapability;
     const row:ResourceRecord={id,name:o.name,resource,...(o.geometry?{geometry:o.geometry}:{}),source:{ref:o.ref,revision:o.revision,asOf:data.asOf,queriedAt:response.queriedAt,...(o.resourceData?{data:o.resourceData}:{})},relationBasis:[...(refs.some(r=>key(r)===id)?['平台任务业务引用']:[]),...(derivedBasis.has(id)?[derivedBasis.get(id)!]:[]),...(cap?.taskIdMapping==='identity'?['来源任务映射已核实']:[]),...(cap?.supportRule?.id==='explicit-task-relation'?['来源支援规则已核实']:[])]};
     const old=collected.find(r=>r.id===id)??result.records.find(r=>r.id===id);if(old){const stable=(r:ResourceRecord)=>JSON.stringify({...r,source:{...r.source,queriedAt:null}});if(stable(old)!==stable(row))throw fail('INCOMPLETE','重复对象在分页中变化。');}if(!collected.some(r=>r.id===id))collected.push(row);

    }
    cursor=data.hasMore?data.nextCursor??undefined:undefined;if(data.hasMore&&(!cursor||seen.has(cursor)))throw fail('INCOMPLETE','来源游标无法继续。');if(cursor)seen.add(cursor);
   }while(cursor);
   if(selection.objectRefs?.some(ref=>!collected.some(r=>r.id===key(ref))))throw fail('INCOMPLETE','指定对象未完整返回。');
   collected.forEach(r=>add(r,false));result.coverage.push({source:selection.systemId,status:declaredCoverage?.status??'complete',...(declaredCoverage?.reason?{reason:declaredCoverage.reason}:{}),asOf:collected[0]?.source?.asOf??JSON.parse(snapshot!)[0]});
   }catch(error){scope.signal.throwIfAborted();scope.check();if(error instanceof RequestError&&(/FORBIDDEN|AUTH|LIMIT/.test(error.code)))throw error;if(error instanceof RequestError&&error.code==='RESOURCE_INCOMPLETE'){invalidSources.add(selection.systemId);result.records=result.records.filter(r=>r.source?.ref.systemId!==selection.systemId);for(const coverage of result.coverage.filter(c=>c.source===selection.systemId)){coverage.status='unavailable';coverage.reason='同一来源快照不一致，已撤去其本次全部记录。';}}(selection.optionalTask?(result.relationshipCoverage.sources??=[]):result.coverage).push({source:selection.systemId,status:'unavailable',reason:error instanceof Error?error.message:'来源读取失败。'});}
  }
  const selections=structuredClone(request.annotations??[]);
  if(defaultTask){
   const ref=binding.draft?{setId:binding.draft.setId,revision:binding.draft.headRevision}:binding.baseRef;
   if(ref)selections.push({ref});const current=this.annotations.current(scope.actor,scope.taskId);if(current.publication)selections.push({ref:{publicationId:current.publication.publicationId}});
  }
  for(const selection of selections){
   const version=this.annotations.version(scope.actor,scope.taskId,selection.ref);result.dependencies.annotations.push(selection.ref);
   const layers=version.document.layers.filter(l=>!selection.layerIds||selection.layerIds.includes(l.layerId));
   if(selection.layerIds?.some(id=>!layers.some(l=>l.layerId===id)))throw fail('NOT_FOUND','固定图层不存在。');
   const features=layers.flatMap(l=>l.features).filter(f=>!selection.objectIds||selection.objectIds.includes(f.objectId));
   if(selection.objectIds?.some(id=>!features.some(f=>f.objectId===id)))throw fail('NOT_FOUND','固定对象不存在。');
   for(const f of features){add({id:JSON.stringify(['annotation',selection.ref,f.objectId]),name:f.name,resource:f.resource??{meaning:'unspecified'},geometry:f.geometry,annotation:{ref:selection.ref,objectId:f.objectId,hash:version.hash},...(f.resourceAssociation?{association:f.resourceAssociation}:{}),relationBasis:['当前任务的明确固定标绘资料']});
    if(f.resourceAssociation)result.dependencies.systemIds.push(f.resourceAssociation.source.systemId);
    for(const e of resourceEvidence(f.resource)){if(e.kind==='source')result.dependencies.systemIds.push(e.ref.systemId);if(e.kind==='annotation')result.dependencies.annotations.push(e.ref);}
   }
   result.coverage.push({source:JSON.stringify(selection.ref),status:'complete',asOf:version.createdAt});
  }
  if(scope.listMessages){const refs=new Set(result.records.flatMap(r=>[...(r.source?[key(r.source.ref)]:[]),...(r.association?[key(r.association.source)]:[])]));result.messageCandidates=scope.listMessages().filter(m=>m.text.length<=4000&&m.resourceRefs.some(r=>refs.has(key(r)))).map(m=>({...m,resourceRefs:m.resourceRefs.filter(r=>refs.has(key(r)))})).slice(-20);}
  for(const message of request.messages??[]){const actual=scope.resolveMessage(message.entryId);if(!actual.text.includes(message.quote)||!actual.resourceRefs.some(r=>key(r)===key(message.resourceRef)))throw fail('MESSAGE_INVALID','用户消息或其明确资源引用不能核实。');result.messages.push({...message,interpretation:'unverified_user_report'});result.dependencies.systemIds.push(message.resourceRef.systemId);}
  for(const record of result.records)for(const e of resourceEvidence(record.resource)){if(e.kind==='source')result.dependencies.systemIds.push(e.ref.systemId);else if(e.kind==='annotation')result.dependencies.annotations.push(e.ref);}
  result.dependencies.systemIds=[...new Set(result.dependencies.systemIds)];result.dependencies.annotations=[...new Map(result.dependencies.annotations.map(ref=>[JSON.stringify(ref),ref])).values()];
  result.items=organizeResources(result.records,scope.taskId,result.createdAt);
  for(const report of result.messages)for(const item of result.items)if(item.recordIds.some(id=>{const record=result.records.find(r=>r.id===id);return record?.source&&key(record.source.ref)===key(report.resourceRef)||record?.association&&key(record.association.source)===key(report.resourceRef);})){item.availability='unknown';item.limitations.push('存在需核实的用户报告，原文保留；未将模型解释认证为来源事实。');}
  const selected=resourceStatisticsItems(result);
  result.summary=summarizeResources(result.records,selected,result.createdAt);
  if(request.purpose==='task')result.summary.limitations.push('仅统计有关系依据的已知部分，关系未确认项保留在清单；不能表示完整任务分配量。');
  if(resourceEntityCountUnknown(result,selected))result.summary.entityCount=null;
  if(!selected.length)result.summary.limitations.push(request.purpose==='task'?'没有读到明确关联资源，不证明任务现实中没有资源或已分配数量为零。':'本次明确范围内没有可分类资源；请同时核对未分类记录和来源覆盖。');
  if(result.coverage.some(c=>c.status!=='complete'))result.summary.limitations.push('来源未完整覆盖，数量仅对应已知部分。');
  this.authorize(result,scope);if(Buffer.byteLength(JSON.stringify(result))>1024*1024)throw fail('LIMIT','资源结果超过1MiB，未截断输出。');return result;
 }
 summarize(request:Extract<ResourceRequest,{operation:'summarize'}>,parent:ResourceResult,scope:ResourceScope,requestId:string,toolCallId:string,spatial?:SpatialResult):ResourceResult {
  if(!resourceRequestValid(request)||request.operation!=='summarize')throw fail('INVALID_INPUT','资源统计参数无效。');
  this.authorize(parent,scope);
  if(request.resultRef!==parent.resultRef)throw fail('RESULT_INVALID','资源结果引用不一致。');
  if(Boolean(request.spatialResultRef)!==Boolean(spatial)||request.position&&!spatial)throw fail('SPATIAL_REQUIRED','位置统计需要对应的固定空间结果。');
  let items=parent.items;
  if(spatial){
   if(spatial.resultRef!==request.spatialResultRef||spatial.resourceInput?.resultRef!==parent.resultRef)throw fail('RESULT_INVALID','空间结果不是由本次资源结果产生。');
   if(request.position){if(!spatial.classifications)throw fail('RESULT_INVALID','所选结果没有点面分类。');const ids=new Set(spatial.classifications.filter(c=>c.position===request.position).map(c=>c.itemId));items=items.filter(i=>ids.has(i.id));}
   else {const ids=new Set(spatial.items.map(i=>i.id));items=items.filter(i=>ids.has(i.id));}
  }
  const relation=request.relation??parent.statisticsScope.relation;
  const availability=request.availability??'all';
  if(availability!=='all')items=items.filter(i=>i.availability===availability);
  if(relation!=='all')items=items.filter(i=>relation==='related'?i.relation!=='unconfirmed':i.relation===relation);
  const ids=new Set(items.flatMap(i=>i.recordIds));
  const result:ResourceResult={...structuredClone(parent),schemaVersion:2,resultRef:`resource:${requestId}:${encodeURIComponent(toolCallId)}`,requestId,toolCallId,createdAt:new Date().toISOString(),parameters:structuredClone(request),statisticsScope:{at:parent.statisticsScope.at,relation,availability},parentResultRef:parent.resultRef,...(spatial?{spatialResultRef:spatial.resultRef,spatialCoverage:structuredClone(spatial.completeness)}:{}),records:parent.records.filter(r=>ids.has(r.id)),items:structuredClone(items),summary:summarizeResources(parent.records,items,parent.statisticsScope.at)};
  delete result.delivery;
  if(!spatial)delete result.spatialResultRef;
  if(spatial)for(const p of spatial.provenance){if(p.input.kind==='source')result.dependencies.systemIds.push(p.input.systemId);if(p.input.kind==='annotation')result.dependencies.annotations.push(p.input.ref);if(p.resourceContext){result.dependencies.systemIds.push(...p.resourceContext.dependencies.systemIds);result.dependencies.annotations.push(...p.resourceContext.dependencies.annotations);}}
  result.dependencies.systemIds=[...new Set(result.dependencies.systemIds)];result.dependencies.annotations=[...new Map(result.dependencies.annotations.map(ref=>[JSON.stringify(ref),ref])).values()];
  if(resourceEntityCountUnknown(result,items))result.summary.entityCount=null;
  if(parent.relationshipCoverage.status==='partial'&&relation!=='all')result.summary.limitations.push('只统计已核实关系的部分；缺少完整关系资料，空名单不能表述为已分配零项。');
  if(result.spatialCoverage?.status==='partial'){result.summary.entityCount=null;result.summary.limitations.push('空间分类未覆盖缺位置或不适用的位置；这些资源没有计入外部。');}
  if(parent.coverage.some(c=>c.status!=='complete'))result.summary.limitations.push('来源覆盖不完整，仅统计已知部分。');
  this.authorize(result,scope);return result;
 }

}
