import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openDatabase } from '../src/access/database.js';
import { WorkspaceStore } from '../src/workspaces/store.js';
import { AnnotationService } from '../src/annotations/service.js';
import { ContextService } from '../src/context/service.js';
import { TaskResourceService } from '../src/context/task-resources.js';
import { SpatialAnalysisService } from '../src/spatial/service.js';
import { extractSpatialResult, projectSpatialResult, spatialModelFormat, type SpatialResult } from '../src/contracts/spatial.js';
import { resourceResultValid, projectResourceResult, extractResourceResult } from '../src/contracts/resource-results.js';
import type { AnnotationFeature } from '../src/contracts/annotations.js';
import type { TaskResource } from '../src/contracts/task-resources.js';

const clean:Array<()=>unknown>=[];
afterEach(async()=>{for(const close of clean.splice(0).reverse())await close();});
const evidence=[{kind:'declaration' as const,note:'验收资料'}];
const resource=(position:NonNullable<TaskResource['position']>['meaning']='actual'):TaskResource=>({meaning:'actual_resource',category:'fire_engine',granularity:'individual',quantity:{value:1,unit:'辆',meaning:'entities',scope:'fixture',evidence},position:{meaning:position,appliesTo:'resource',evidence},availability:{state:'available',evidence}});
const feature=(id:string,x:number,position:NonNullable<TaskResource['position']>['meaning']='actual'):AnnotationFeature=>({objectId:id,name:id,kind:'point',geometry:{type:'Point',coordinates:[x,1]},resource:resource(position)});
async function setup(){
 const dir=await mkdtemp(join(tmpdir(),'resource-spatial-'));clean.push(()=>rm(dir,{recursive:true,force:true}));const db=await openDatabase(dir);clean.push(()=>db.close());
 const workspaces=await WorkspaceStore.open(dir,'a'),workspace=workspaces.get(),session=randomUUID();await workspaces.bind(session,workspace.id);
 const context=new ContextService({systems:[{id:'source',name:'来源',adapter:'mock-situation-http',baseUrl:'http://127.0.0.1:4401',tokenEnv:'TOKEN'}],scopes:[{id:'scope',name:'授权',systemIds:['source'],seatIds:['a']}]},{TOKEN:'synthetic'});
 const annotations=new AnnotationService(db,workspaces,undefined,context),actor=annotations.actorForSeat('a');
 const region:AnnotationFeature={objectId:'region',name:'范围',kind:'polygon',geometry:{type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]}};
 annotations.action(actor,session,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,operations:[{op:'add_layer',layer:{layerId:'resources',name:'资源',order:0,defaultVisible:true,features:[feature('inside',1),feature('edge',2),feature('outside',3),feature('planned',1,'planned'),feature('unknown',1,'unknown')]}},{op:'add_layer',layer:{layerId:'area',name:'区域',order:1,defaultVisible:true,features:[region]}}]});
 const draft=annotations.binding(actor,session).draft!,ref={setId:draft.setId,revision:draft.headRevision};
 const scope={actor,sessionId:session,taskId:workspace.taskSpaceId!,signal:new AbortController().signal,check:()=>{},resolveMessage:()=>({text:'',resourceRefs:[]})};
 const resources=new TaskResourceService(annotations,context),query=await resources.query({operation:'query',purpose:'data',annotations:[{ref,layerIds:['resources']}]},scope,randomUUID(),'query');
 const spatial=new SpatialAnalysisService(annotations,context),spatialScope={...scope,resolveResult:():SpatialResult=>{throw Error('no result');},resolveResourceResult:()=>query};
 return {dir,db,annotations,context,resources,scope,query,spatial,spatialScope,ref,target:{kind:'annotation' as const,ref,objectIds:['region']},input:{kind:'resource' as const,resultRef:query.resultRef}};
}
it('D18 resource classification preserves five candidates, independent counts and two unknown positions',async()=>{
 const s=await setup(),r=await s.spatial.analyze({operation:'classify_points',input:s.input,target:s.target},s.spatialScope,randomUUID(),'classify');
 expect(r.schemaVersion).toBe(3);expect(r.values).toEqual({total:3,interior:1,boundary:1,exterior:1});expect(r.completeness).toMatchObject({status:'partial',candidateCount:3,totalCandidateCount:5});expect(r.completeness.unclassified).toHaveLength(2);
 expect(r.provenance[0].resourceContext?.dependencies.annotations).toEqual([s.ref]);
 expect(extractSpatialResult({spatialResult:r},'spatial_analyze',false,JSON.stringify({format:spatialModelFormat(r),data:projectSpatialResult(r)}))).toEqual(r);
 for(const position of ['interior','boundary','exterior'] as const){const summary=s.resources.summarize({operation:'summarize',resultRef:s.query.resultRef,spatialResultRef:r.resultRef,position},s.query,s.scope,randomUUID(),position,r);expect(summary.summary.itemCount).toBe(1);expect(summary.summary.entityCount).toBeNull();expect(summary.spatialCoverage?.unclassified).toHaveLength(2);expect(summary.summary.limitations.join()).toContain('没有计入外部');expect(resourceResultValid(summary)).toBe(true);}
});
it('D18 keeps missing positions through nearest, result reuse and resource read without changing old geometry algorithms',async()=>{
 const s=await setup(),target={kind:'annotation' as const,ref:s.ref,objectIds:['inside']};
 const nearest=await s.spatial.analyze({operation:'nearest',input:s.input,target,count:1},s.spatialScope,randomUUID(),'nearest');
 expect(nearest.items[0].name).toBe('inside');expect(nearest.items[0].distanceM).toBe(0);expect(nearest.completeness.unclassified).toHaveLength(2);
 const next=await s.spatial.analyze({operation:'classify_points',input:{kind:'result',resultRef:nearest.resultRef},target:s.target},{...s.spatialScope,resolveResult:()=>nearest},randomUUID(),'classify');
 expect(next.values).toEqual({total:1,interior:1,boundary:0,exterior:0});expect(next.completeness).toMatchObject({candidateCount:1,totalCandidateCount:3,status:'partial'});
 const before=JSON.stringify(s.query);s.resources.authorize(s.query,s.scope);expect(JSON.stringify(s.query)).toBe(before);
});
it('D19 rejects unrelated spatial summaries and keeps unclassified positions out of explicit exterior counts',async()=>{
 const s=await setup(),r=await s.spatial.analyze({operation:'classify_points',input:s.input,target:s.target},s.spatialScope,randomUUID(),'classify');
 const wrong=structuredClone(r);wrong.resourceInput={resultRef:'resource:other:query',itemIds:[]};
 expect(()=>s.resources.summarize({operation:'summarize',resultRef:s.query.resultRef,spatialResultRef:wrong.resultRef,position:'exterior'},s.query,s.scope,randomUUID(),'summary',wrong)).toThrow('不是由');
 const noPosition=structuredClone(s.query);noPosition.items.forEach(i=>{delete i.geometry;i.positionReason='没有实际位置';});
 const none=await s.spatial.analyze({operation:'classify_points',input:s.input,target:s.target},{...s.spatialScope,resolveResourceResult:()=>noPosition},randomUUID(),'none');
 expect(none.values).toEqual({total:0,interior:0,boundary:0,exterior:0});expect(none.completeness.unclassified).toHaveLength(5);
 const summary=s.resources.summarize({operation:'summarize',resultRef:s.query.resultRef,spatialResultRef:none.resultRef,position:'interior'},s.query,s.scope,randomUUID(),'unknown',none);expect(summary.summary.entityCount).toBeNull();expect(summary.spatialCoverage?.unclassified).toHaveLength(5);expect(resourceResultValid(summary)).toBe(true);
 const repeated=s.resources.summarize({operation:'summarize',resultRef:summary.resultRef},summary,s.scope,randomUUID(),'repeat');expect(repeated.spatialResultRef).toBeUndefined();expect(repeated.spatialCoverage).toEqual(summary.spatialCoverage);expect(repeated.summary.entityCount).toBeNull();expect(resourceResultValid(repeated)).toBe(true);
});
it('D20/D21 rejects forged identities, partition counts, dropped dependencies and tampered model projection',async()=>{
 const s=await setup();expect(resourceResultValid(s.query)).toBe(true);
 const missing=structuredClone(s.query);missing.dependencies.annotations=[];expect(resourceResultValid(missing)).toBe(false);
 const badCount=structuredClone(s.query);badCount.summary.itemCount=99;expect(resourceResultValid(badCount)).toBe(false);
 const model={format:'resource.model-result.v1',data:projectResourceResult(s.query,1,2)};
 expect(model.data.items).toHaveLength(2);expect(model.data.records).toHaveLength(2);expect(extractResourceResult({resourceResult:s.query},'task_resource_query',false,JSON.stringify(model))).toEqual(s.query);
 model.data.summary.itemCount=99;expect(extractResourceResult({resourceResult:s.query},'task_resource_query',false,JSON.stringify(model))).toBeNull();
 const r=await s.spatial.analyze({operation:'classify_points',input:s.input,target:s.target},s.spatialScope,randomUUID(),'classify');r.completeness.totalCandidateCount=99;expect(extractSpatialResult({spatialResult:r},'spatial_analyze')).toBeNull();
});
it('D16 rechecks source and fixed annotation dependencies on resource read and derived spatial reuse',async()=>{
 const s=await setup();s.query.dependencies.systemIds=['source'];const r=await s.spatial.analyze({operation:'classify_points',input:s.input,target:s.target},s.spatialScope,randomUUID(),'classify');
 s.context.config.scopes[0].seatIds=[];
 expect(()=>s.resources.authorize(s.query,s.scope)).toThrow('来源');expect(()=>s.spatial.inputs.authorize(r,s.spatialScope)).toThrow('来源');
 await expect(s.spatial.analyze({operation:'read',resultRef:r.resultRef},{...s.spatialScope,resolveResult:()=>r},randomUUID(),'read')).rejects.toThrow('来源');
});
it('D24 saves exact derived geometry, carries source ACL, and never publishes private result locators',async()=>{
 const s=await setup();s.query.dependencies.systemIds=['source'];const r=await s.spatial.analyze({operation:'nearest',input:s.input,target:{kind:'annotation',ref:s.ref,objectIds:['inside']},count:1},s.spatialScope,randomUUID(),'nearest');
 const intent={action:'from_analysis' as const,clientActionId:randomUUID(),resultRef:r.resultRef,itemId:r.items[0].id,layerId:'resources',objectId:'saved',name:'保存对象'};
 const result=s.annotations.fromAnalysisFromHost(s.scope.actor,s.scope.sessionId,intent,r,s.ref);
 expect(result.receipt.ref).toBeDefined();const saved=s.annotations.version(s.scope.actor,s.scope.taskId,result.receipt.ref!).document.layers[0].features.find(f=>f.objectId==='saved')!;
 expect(saved.geometry).toEqual(r.items[0].geometry);expect(JSON.stringify(saved)).not.toContain('resource:');expect(JSON.stringify(saved)).not.toContain(s.ref.setId);
 const binding=s.annotations.binding(s.scope.actor,s.scope.sessionId);const publication=s.annotations.action(s.scope.actor,s.scope.sessionId,{action:'publish',clientActionId:randomUUID(),revision:binding.draft!.headRevision,title:'共享派生结果'});
 const published=s.annotations.version(s.scope.actor,s.scope.taskId,publication.ref!);expect(JSON.stringify(published.document)).not.toContain(s.ref.setId);
 s.context.config.scopes[0].seatIds=[];expect(()=>s.annotations.version(s.scope.actor,s.scope.taskId,publication.ref!)).toThrow();
});
it('D22 honours cancellation before resource/spatial access and rejects sibling session ownership',async()=>{
 const s=await setup(),controller=new AbortController();controller.abort();expect(()=>s.resources.authorize(s.query,{...s.scope,signal:controller.signal})).toThrow();
 await expect(s.spatial.analyze({operation:'classify_points',input:s.input,target:s.target},{...s.spatialScope,signal:controller.signal},randomUUID(),'cancel')).rejects.toThrow();
 const forged=structuredClone(s.query);forged.owner.sessionId=randomUUID();expect(()=>s.resources.authorize(forged,s.scope)).toThrow('会话');
});
it.each(['records','pages','bytes','cancel'] as const)('D22 resource %s limit never yields a truncated successful inventory',async condition=>{
 const s=await setup(),controller=new AbortController();let calls=0;
 const context=new ContextService(s.context.config,{TOKEN:'synthetic'},{fetch:async input=>{
  calls++;const cursor=Number(new URL(String(input)).searchParams.get('cursor')??0),count=condition==='bytes'?10:condition==='pages'?1:100;
  const total=condition==='records'?501:condition==='bytes'?60:500;
  const items=Array.from({length:Math.min(count,total-cursor)},(_,index)=>{const id=String(cursor+index);return {ref:{systemId:'source',objectType:'resource',objectId:id},name:id,revision:1,areaIds:[],effectiveAt:null,validTime:null,geometry:null,properties:{},resourceData:{resource:{meaning:'actual_resource',...(condition==='bytes'?{evidence:Array.from({length:20},()=>({kind:'declaration',note:'验'.repeat(300)}))}:{})}}};});
  if(condition==='cancel'&&calls===2)controller.abort(new Error('controlled cancellation'));
  return new Response(JSON.stringify({systemId:'source',asOf:'2026-11-02T04:00:00Z',items,limit:100,hasMore:condition==='pages'||cursor+count<total,nextCursor:condition==='pages'?String(cursor+1):cursor+count<total?String(cursor+count):null,timeUnknownCount:0,unknownRefs:[],changeCursor:'fixed'}),{headers:{'content-type':'application/json'}});
 }});
 const promise=new TaskResourceService(s.annotations,context).query({operation:'query',purpose:'data',sources:[{systemId:'source'}]},{...s.scope,signal:controller.signal},randomUUID(),condition);
 if(condition==='cancel')await expect(promise).rejects.toThrow('controlled cancellation');else await expect(promise).rejects.toMatchObject({code:'RESOURCE_LIMIT'});
 expect(calls).toBeLessThanOrEqual(condition==='pages'?50:6);
});
it('D18/D20 generated resource buffers remain reusable geometry without becoming resource positions',async()=>{
 const s=await setup(),first=s.query.items.find(i=>i.name==='inside')!;
 const buffer=await s.spatial.analyze({operation:'buffer',input:{...s.input,itemIds:[first.id]},distanceM:100},s.spatialScope,randomUUID(),'buffer');
 const area=await s.spatial.analyze({operation:'measure',input:{kind:'result',resultRef:buffer.resultRef,geometry:true},metric:'area'},{...s.spatialScope,resolveResult:()=>buffer},randomUUID(),'area');
 expect(area.resourceInput).toBeUndefined();expect(extractSpatialResult({spatialResult:area},'spatial_analyze')).toEqual(area);
 expect(area.provenance.some(p=>p.resourceContext?.dependencies.annotations.length)).toBe(true);
 expect(()=>s.resources.summarize({operation:'summarize',resultRef:s.query.resultRef,spatialResultRef:area.resultRef},s.query,s.scope,randomUUID(),'wrong',area)).toThrow('不是由');
 const classification=await s.spatial.analyze({operation:'classify_points',input:s.input,target:s.target},s.spatialScope,randomUUID(),'classify');
 Object.assign(classification.resourceInput!,{unexpected:'not allowed'});expect(extractSpatialResult({spatialResult:classification},'spatial_analyze')).toBeNull();
});
it('D18 resource nonpoint positions reject point-only operations instead of becoming missing data',async()=>{
 const s=await setup(),query=structuredClone(s.query);query.items[0].geometry={type:'LineString',coordinates:[[1,1],[1.1,1]]};
 await expect(s.spatial.analyze({operation:'classify_points',input:s.input,target:s.target},{...s.spatialScope,resolveResourceResult:()=>query},randomUUID(),'bad')).rejects.toMatchObject({code:'SPATIAL_UNSUPPORTED_GEOMETRY'});
});
it('D19 counts requested availability and rejects changed quantities even when text matches details',async()=>{
 const s=await setup();s.query.items[0].availability='unavailable';
 const summary=s.resources.summarize({operation:'summarize',resultRef:s.query.resultRef,availability:'unavailable'},s.query,s.scope,randomUUID(),'unavailable');
 expect(summary.items.map(i=>i.name)).toEqual(['inside']);expect(summary.summary.quantities[0].value).toBe(1);expect(resourceResultValid(summary)).toBe(true);
 const changed=structuredClone(summary);changed.summary.quantities[0].value=100;changed.summary.quantities[0].knownValue=100;
 expect(extractResourceResult({resourceResult:changed},'task_resource_query',false,JSON.stringify({format:'resource.model-result.v1',data:projectResourceResult(changed)}))).toBeNull();
 const fixed=structuredClone(s.query);fixed.records.forEach(r=>{r.resource.quantity!.validUntil=new Date(Date.parse(fixed.createdAt)+10000).toISOString();});
 const first=s.resources.summarize({operation:'summarize',resultRef:fixed.resultRef},fixed,s.scope,randomUUID(),'first');
 first.createdAt=new Date(Date.parse(fixed.createdAt)+20000).toISOString();
 const later=s.resources.summarize({operation:'summarize',resultRef:first.resultRef},first,s.scope,randomUUID(),'later');
 expect(later.statisticsScope.at).toBe(fixed.createdAt);expect(later.summary.quantities).toEqual(first.summary.quantities);expect(resourceResultValid(later)).toBe(true);
});
it('D22 partial final source page retains known rows and its coverage reason',async()=>{
 const s=await setup(),context=new ContextService(s.context.config,{TOKEN:'synthetic'},{fetch:async()=>new Response(JSON.stringify({systemId:'source',asOf:'2026-11-02T04:00:00Z',items:[],limit:100,hasMore:false,nextCursor:null,timeUnknownCount:0,unknownRefs:[],changeCursor:'fixed',resourceCoverage:{status:'partial',reason:'仅覆盖登记港口，海上数据未接入'}}),{headers:{'content-type':'application/json'}})});
 const result=await new TaskResourceService(s.annotations,context).query({operation:'query',purpose:'data',sources:[{systemId:'source'}]},s.scope,randomUUID(),'partial');
 expect(result.coverage).toContainEqual({source:'source',status:'partial',reason:'仅覆盖登记港口，海上数据未接入',asOf:'2026-11-02T04:00:00Z'});expect(result.summary.entityCount).toBeNull();expect(resourceResultValid(result)).toBe(true);
});
