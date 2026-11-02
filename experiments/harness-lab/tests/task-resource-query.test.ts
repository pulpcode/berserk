import legacyOverlap from './pi/fixtures/resource-result-v1-overlap.json';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { WorkspaceStore } from '../src/workspaces/store.js';
import { AnnotationService } from '../src/annotations/service.js';
import { ContextService } from '../src/context/service.js';
import { TaskResourceService, type ResourceScope } from '../src/context/task-resources.js';
import { classifyPoint } from '../src/spatial/geometry.js';
import { SpatialAnalysisService } from '../src/spatial/service.js';
import { resourceResultValid, type ResourceQuery, type ResourceResult } from '../src/contracts/resource-results.js';
import type { AnnotationFeature } from '../src/contracts/annotations.js';
import type { ContextRef, SituationObject, SituationGeometry, Position } from '../src/contracts/context.js';
import { decodeSourceResource, type ResourceSourceCapability, type SourceResource } from '../src/contracts/task-resources.js';
import type { SpatialResult } from '../src/contracts/spatial.js';

interface Fixture {id:string;taskId:string;sources?:SituationObject[];annotations?:AnnotationFeature[];controlledImports?:Array<{objectId:string;sourceRef:ContextRef}>;coverageAlternatives?:Array<SourceResource['coverage']|null>;region?:SituationGeometry;messages?:Array<{entryId:string;role:string;text:string}>}
const fixtures=(JSON.parse(await readFile(new URL('../fixtures/task-resources-v1/inputs.json',import.meta.url),'utf8')) as {cases:Fixture[]}).cases;
const expected=JSON.parse(await readFile(new URL('../fixtures/task-resources-v1/expected.json',import.meta.url),'utf8'));
const clean:Array<()=>void|Promise<unknown>>=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-02T05:00:00Z'));});
afterEach(async()=>{vi.useRealTimers();for(const close of clean.splice(0).reverse())await close();});
const cap=(systemId:string):ResourceSourceCapability=>({systemId,categories:['fire_engine','rescue_boat'],units:['辆','艘'],relations:['assigned','related','potential_support'],filters:['task','relation','category'],taskIdMapping:'identity',supportRule:{id:'explicit-task-relation',description:'来源显式记录的支援'},pagination:'cursor',snapshot:'fixed_revision'});
const evidence=[{kind:'declaration' as const,note:'独立测试来源事实'}];
const rawResource=(id:string,coordinates:Position|null=[103.5,1.5]):SituationObject=>({ref:{systemId:'source',objectType:'resource',objectId:id},name:id,revision:1,areaIds:['A'],effectiveAt:'2026-11-02T04:00:00Z',validTime:null,properties:{},geometry:coordinates?{type:'Point',coordinates}:null,resourceData:{entityId:id,resource:{meaning:'actual_resource',category:'fire_engine',granularity:'individual',quantity:{value:1,unit:'辆',meaning:'entities',scope:'fleet',evidence},position:{meaning:'actual',appliesTo:'resource',evidence}}}});
const query:ResourceQuery={operation:'query',purpose:'data',sources:[{systemId:'source'}]};

// Independent wire source supplies facts and filters only, never ResourceResult or expected answers.
async function setup(fixture?:Fixture,options:{capabilities?:Record<string,ResourceSourceCapability>;businessRefs?:ContextRef[];sources?:SituationObject[];fault?:'snapshot'|'selection-snapshot'|'cursor'|'duplicate'|'missing';unavailable?:string[];partial?:boolean}={}) {
 const dir=await mkdtemp(join(tmpdir(),'resource-service-'));clean.push(()=>rm(dir,{recursive:true,force:true}));
 const db=await openDatabase(dir);clean.push(()=>db.close());const access=new AccessStore(db);
 const userId=randomUUID();db.prepare('INSERT INTO seats(id,name,create_public,manage_model) VALUES(?,?,?,?)').run('a','A',1,0);db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,1)').run(userId,'a','A','a','test-salt','test-hash');const identity=access.identity(userId)!;
 const task=access.create(identity,{title:'独立资源验收',goal:'读取明确资源范围',visibility:'public',clientActionId:randomUUID(),...(options.businessRefs?{context:{businessRefs:options.businessRefs}}:{})});
 const adapt=<T>(value:T):T=>JSON.parse(JSON.stringify(value).replaceAll('"task-a"',JSON.stringify(task.id)));
 const sources=adapt(structuredClone(options.sources??fixture?.sources??[]));
 const requests:URL[]=[];
 const server=createServer((req,res)=>{
  const url=new URL(req.url!,'http://localhost');requests.push(url);const systemId=url.pathname.split('/')[1];res.setHeader('content-type','application/json');
  if(options.unavailable?.includes(systemId)){res.statusCode=503;res.end(JSON.stringify({error:{code:'UNAVAILABLE',message:'离线'}}));return;}
  const refs=JSON.parse(url.searchParams.get('objectRefs')??'null') as ContextRef[]|null;
  const types=JSON.parse(url.searchParams.get('objectTypes')??'null') as string[]|null;
  const areas=JSON.parse(url.searchParams.get('areaIds')??'null') as string[]|null;
  const taskId=url.searchParams.get('taskId');
  const all=sources.filter(o=>o.ref.systemId===systemId&&(!refs||refs.some(r=>JSON.stringify(r)===JSON.stringify(o.ref)))&&(!types||types.includes(o.ref.objectType))&&(!areas||areas.some(a=>o.areaIds.includes(a)))&&(!taskId||o.resourceData?.resource.taskRelations?.some(r=>r.taskId===taskId)));
  const offset=Number(url.searchParams.get('cursor')??0),limit=Number(url.searchParams.get('limit')??20);
  let items=structuredClone(all.slice(offset,offset+limit));
  if(options.fault==='duplicate'&&offset)items=[{...all[0],name:'同一ID被改名',revision:2}];
  if(options.fault==='missing')items=[];
  const more=options.fault==='cursor'||offset+limit<all.length;
  res.end(JSON.stringify({systemId,...(options.partial?{resourceCoverage:{status:'partial',reason:'仍有缺口，分页结束不代表全量'}}:{}),asOf:(options.fault==='snapshot'&&offset||options.fault==='selection-snapshot'&&requests.length>1)?'2026-11-02T04:01:00Z':'2026-11-02T04:00:00Z',items,limit,nextCursor:more?options.fault==='cursor'?'1':String(offset+limit):null,hasMore:more,timeUnknownCount:0,unknownRefs:refs?.filter(r=>!all.some(o=>JSON.stringify(o.ref)===JSON.stringify(r)))??[],changeCursor:'fixed-source-1'}));
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});clean.push(()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());}));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const context=new ContextService({systems:['source','second'].map(id=>({id,name:id,adapter:'mock-situation-http' as const,baseUrl:`${base}/${id}`,tokenEnv:'TEST_TOKEN',...(options.capabilities?.[id]?{resourceCapability:options.capabilities[id]}:{})})),scopes:[{id:'scope',name:'测试范围',systemIds:['source','second'],seatIds:['a']}]},{TEST_TOKEN:'synthetic'});
 const workspaces=await WorkspaceStore.open(dir,'a',true);workspaces.access=access;const workspace=await workspaces.ensureWorkspace(task.id,'a','测试');const session=randomUUID();await workspaces.bind(session,workspace.id);
 const annotations=new AnnotationService(db,workspaces,access,context),actor=annotations.actorForSeat('a');
 annotations.action(actor,session,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,operations:[{op:'add_layer',layer:{layerId:'resources',name:'资源',order:0,defaultVisible:true,features:[]}}]});
 const head=()=>{const d=annotations.binding(actor,session).draft!;return {setId:d.setId,revision:d.headRevision};};
 const apply=(feature:AnnotationFeature)=>annotations.action(actor,session,{action:'apply',clientActionId:randomUUID(),expectedRevision:head().revision,operations:[{op:'add_object',layerId:'resources',feature}]});
 for(const feature of adapt(fixture?.annotations??[])){
  const controlled=fixture?.controlledImports?.find(i=>i.objectId===feature.objectId);
  if(controlled){await annotations.fromSource(actor,session,{clientActionId:randomUUID(),mode:'add',sourceRef:controlled.sourceRef,expectedSourceRevision:1,expectedRevision:head().revision,layerId:'resources',objectId:feature.objectId});annotations.action(actor,session,{action:'apply',clientActionId:randomUUID(),expectedRevision:head().revision,operations:[{op:'update_object',objectId:feature.objectId,changes:{name:feature.name,geometry:feature.geometry,resource:feature.resource}}]});}
  else apply(feature);
 }
 const messages=adapt(fixture?.messages??[]);
 const scope:ResourceScope={actor,taskId:task.id,sessionId:session,signal:new AbortController().signal,check:()=>{},resolveMessage:entryId=>{const m=messages.find(m=>m.entryId===entryId&&m.role==='user');if(!m)throw new Error('用户消息不存在');return {text:m.text,resourceRefs:[{systemId:'source',objectType:'resource',objectId:'R1'}]};}};
 const resources=new TaskResourceService(annotations,context);
 const run=(request:ResourceQuery=query)=>resources.query(request,scope,randomUUID(),randomUUID());
 const classify=async(result:ResourceResult,region:SituationGeometry=fixture?.region??{type:'Polygon',coordinates:[[[103,1],[104,1],[104,2],[103,2],[103,1]]]})=>{
  const polygonId=`region-${randomUUID()}`;apply({objectId:polygonId,kind:'polygon',name:'明确范围',geometry:region});
  return new SpatialAnalysisService(annotations,context).analyze({operation:'classify_points',input:{kind:'resource',resultRef:result.resultRef},target:{kind:'annotation',ref:head(),objectIds:[polygonId]}},{...scope,resolveResult:()=>{throw new Error('not requested');},resolveResourceResult:()=>result},randomUUID(),randomUUID());
 };
 return {dir,db,access,identity,task,context,workspaces,workspace,session,annotations,actor,scope,resources,run,head,apply,classify,sources,requests,messages};
}
const itemNamed=(result:ResourceResult,name:string)=>result.items.find(i=>i.recordIds.some(id=>result.records.some(r=>r.id===id&&r.name===name)))!;

 describe('independent first-batch business fixtures run through actual services',()=>{
 it('D01 queries default task resources, merges controlled imports and classifies five resources',async()=>{
  const s=await setup(fixtures[0],{capabilities:{source:cap('source')}});const result=await s.run({operation:'query',purpose:'task'});const e=expected['B1-S01'];
  expect(result.items).toHaveLength(e.include.length);expect(result.items.map(i=>i.name).sort()).toEqual([...e.include].sort());expect(itemNamed(result,'R1').recordIds).toHaveLength(2);
  expect(result.exclusions.some(x=>x.id.includes('D4'))).toBe(true);expect(result.records.some(r=>r.name==='R3'||r.name==='D3')).toBe(false);
  expect(itemNamed(result,'D2').availability).toBe('unknown');expect(itemNamed(result,'R4').availability).toBe('unavailable');expect(itemNamed(result,'R5').geometry).toBeUndefined();
  const spatial=await s.classify(result);expect(spatial.classifications).toHaveLength(4);expect(spatial.completeness.unclassified).toHaveLength(1);
  const inside=new Set(spatial.classifications!.filter(c=>c.position==='interior').map(c=>c.itemId));expect(result.items.filter(i=>inside.has(i.id)&&i.relation==='assigned'&&i.availability==='available')).toHaveLength(e.confirmedInside.fire_engine.value);expect(itemNamed(result,'R2').relation).toBe('potential_support');expect(resourceResultValid(result)).toBe(true);
  const ready=s.resources.summarize({operation:'summarize',resultRef:result.resultRef,spatialResultRef:spatial.resultRef,position:'interior',relation:'assigned',availability:'available'},result,s.scope,randomUUID(),'ready',spatial);expect(ready.items).toHaveLength(1);expect(ready.summary.quantities[0]).toMatchObject({unit:'辆',value:1});expect(resourceResultValid(ready)).toBe(true);
 });
 it('D02 keeps ordinary four-point annotation reading available without new resource semantics',async()=>{
  const s=await setup(fixtures[1]);const result=s.annotations.read(s.actor,s.task.id,{ref:s.head(),layerIds:['resources']});expect(result.objects.total).toBe(expected['B1-S02'].graphicCount);expect(result.objects.items.every(i=>i.resource===undefined)).toBe(true);expect(s.requests).toHaveLength(0);
 });
 it('D03 preserves two same-name cross-system records and does not certify an entity total',async()=>{
  const s=await setup(fixtures[2]);const r=await s.run({...query,sources:[{systemId:'source'},{systemId:'second'}]});expect(r.records.map(i=>i.source!.ref.objectId).sort()).toEqual(expected['B1-S03'].independentRecords);expect(r.items).toHaveLength(2);expect(r.summary.entityCount).toBe(expected['B1-S03'].entityCount);
 });
 it('D04 does not treat a manual source reference as a controlled identity or inherited availability',async()=>{
  const s=await setup(fixtures[3]);const r=await s.run({...query,annotations:[{ref:s.head()}]});const manual=s.annotations.version(s.actor,s.task.id,s.head()).document.layers[0].features[0];expect(manual.objectId).toBe(expected['B1-S04'].referenceOnly);expect(manual.resourceAssociation).toBeUndefined();expect(manual.resource?.availability).toBeUndefined();expect(r.items).toHaveLength(1);expect(r.exclusions.some(x=>x.id.includes('manual'))).toBe(true);
  // Separate explicit resource declaration still must not inherit identity from sourceRefs.
  s.annotations.action(s.actor,s.session,{action:'apply',clientActionId:randomUUID(),expectedRevision:s.head().revision,operations:[{op:'update_object',objectId:'manual',changes:{resource:{meaning:'actual_resource',category:'fire_engine'}}}]});
  const declared=await s.run({...query,annotations:[{ref:s.head()}]});expect(declared.items).toHaveLength(2);expect(itemNamed(declared,'manual').availability).toBe('unknown');
 });
 it('D05 one source entity with conflicting reports remains one entity and not available',async()=>{
  const s=await setup(fixtures[4]);const r=await s.run();expect(r.records).toHaveLength(2);expect(r.items).toHaveLength(1);expect(r.items[0].availability).toBe(expected['B1-S05'].availability);expect(r.items.filter(i=>i.availability==='available')).toHaveLength(expected['B1-S05'].confirmedAvailable);expect(r.summary.quantities.some(q=>q.value===1&&q.unit==='艘')).toBe(true);
 });
 it.each([false,true])('D06 aggregate and detail respect explicit coverage=%s, station geometry is not vehicle geometry',async covered=>{
  const f=structuredClone(fixtures[5]);if(covered)f.sources![0].resourceData!.coverage=f.coverageAlternatives![0]!;const s=await setup(f);const r=await s.run();expect(itemNamed(r,'station').geometry).toBeUndefined();
  expect(r.summary.quantities).toEqual(expect.arrayContaining([expect.objectContaining({meaning:'available',value:3}),expect.objectContaining({meaning:'entities',value:1})]));expect(r.summary.quantities.some(q=>q.value===4)).toBe(false); // Distinct meanings must retain both facts, even with membership coverage.
 });
 it('D07 preserves known quantities separately from unknown counts and different units',async()=>{
  const s=await setup(fixtures[6]);const r=await s.run();for(const known of expected['B1-S07'].knownQuantities)expect(r.summary.quantities).toEqual(expect.arrayContaining([expect.objectContaining({category:known.category,unit:known.unit,knownValue:known.value})]));expect(r.summary.quantities).toContainEqual(expect.objectContaining({unit:'艘',knownValue:1,unknownCount:1,value:null}));expect(r.summary.entityCount).toBeNull();
 });
 it('D08 planned position retains the resource as unclassified, never outside',async()=>{
  const s=await setup(fixtures[7]);const r=await s.run({operation:'query',purpose:'data',annotations:[{ref:s.head()}]});expect(r.items).toHaveLength(1);expect(r.items[0].geometry).toBeUndefined();expect(r.items[0].positionReason).toMatch(/计划|实际/);const spatial=await s.classify(r);expect(spatial.classifications).toEqual([]);expect(spatial.completeness.unclassified).toHaveLength(1);
 });
 it('D09 registered region selection remains distinct from actual geometry',async()=>{
  const s=await setup(fixtures[8]);const r=await s.run({...query,sources:[{systemId:'source',areaIds:['A']}]});expect(r.items).toHaveLength(1);expect(s.requests[0].searchParams.get('areaIds')).toBe('["A"]');expect((await s.classify(r)).classifications![0].position).toBe(expected['B1-S09'].actualPosition);
 });
 it('D10 an empty source and failed source never become a complete zero-resource task',async()=>{
  const s=await setup(fixtures[9],{unavailable:['second']});const r=await s.run({...query,purpose:'task',sources:[{systemId:'source'},{systemId:'second'}]});expect(r.coverage).toEqual(expect.arrayContaining([expect.objectContaining({source:'source',status:'complete'}),expect.objectContaining({source:'second',status:'unavailable'})]));expect(r.relationshipCoverage.status).toBe('partial');expect(r.summary.limitations.join('')).toMatch(/不证明|不能/);expect(r.summary.entityCount).toBeNull();
 });
 it('D11 adopted publication is fixed while another session draft changes',async()=>{
  const s=await setup(fixtures[10]);const published=s.annotations.action(s.actor,s.session,{action:'publish',clientActionId:randomUUID(),revision:s.head().revision,title:'采用版'});s.annotations.setCurrent(s.actor,s.task.id,{clientActionId:randomUUID(),publicationId:published.publication!.publicationId,expectedCurrentSequence:0});
  s.annotations.action(s.actor,s.session,{action:'apply',clientActionId:randomUUID(),expectedRevision:s.head().revision,operations:[{op:'update_object',objectId:'published-car',changes:{resource:{...s.annotations.version(s.actor,s.task.id,s.head()).document.layers[0].features[0].resource!,availability:{state:'unavailable',evidence}}}}]});
  const another=randomUUID();await s.workspaces.bind(another,s.workspace.id);const r=await s.resources.query({operation:'query',purpose:'task'},{...s.scope,sessionId:another},randomUUID(),randomUUID());expect(r.items).toHaveLength(1);expect(r.items[0].availability).toBe('available');expect(r.dependencies.annotations).toContainEqual(published.ref);expect(r.dependencies.annotations).not.toContainEqual(s.head());
 });
 it('D12 preserves exact user report, never converts assistant prose into evidence or mutates facts',async()=>{
  const s=await setup(fixtures[11],{sources:[rawResource('R1')]});const before=structuredClone(s.sources),draft=s.head();const quote=s.messages[0].text;const r=await s.run({...query,messages:[{entryId:'user-12',resourceRef:s.sources[0].ref,quote}]});expect(r.messages[0]).toMatchObject({entryId:expected['B1-S12'].keepUserReport,quote,interpretation:'unverified_user_report'});expect(r.messages[0].quote).toContain('2026-11-02 04:00 UTC');expect(s.sources).toEqual(before);expect(s.head()).toEqual(draft);await expect(s.run({...query,messages:[{entryId:'assistant-13',resourceRef:s.sources[0].ref,quote:'重复早先可用说法'}]})).rejects.toThrow();
 });
});

describe('D13—D18 source coverage, relationship and geometry boundaries',()=>{
 it('D13 reads more than one full resource page without consuming unrelated geometry-less records',async()=>{
  const source=Array.from({length:120},(_,i)=>rawResource(`r-${i}`));const areas:SituationObject[]=Array.from({length:120},(_,i)=>({ref:{systemId:'source',objectType:'area',objectId:`a-${i}`},name:`a-${i}`,revision:1,areaIds:[],effectiveAt:null,validTime:null,properties:{memberRefs:[]},geometry:null}));
  const s=await setup(undefined,{sources:[...areas,...source]});const r=await s.run();expect(r.items).toHaveLength(120);expect(r.coverage).toEqual([expect.objectContaining({status:'complete'})]);expect(s.requests).toHaveLength(2);expect(s.requests.every(u=>u.searchParams.get('objectTypes')==='["resource"]')).toBe(true);
 });
 it.each(['snapshot','cursor','duplicate','missing'] as const)('D14 rejects incomplete %s data without a successful partial sum or retries',async fault=>{
  const sources=Array.from({length:101},(_,i)=>rawResource(`r-${i}`));const s=await setup(undefined,{sources,fault});const r=await s.run(fault==='missing'?{...query,sources:[{systemId:'source',objectRefs:[sources[0].ref]}]}:query);expect(r.records).toEqual([]);expect(r.coverage[0].status).toBe('unavailable');expect(r.summary.quantities).toEqual([]);expect(s.requests).toHaveLength(fault==='missing'?1:2);
 });
 it('D14 never mixes changing source snapshots across separate exact-reference selections',async()=>{
  const sources=[rawResource('R1'),rawResource('R2')];const s=await setup(undefined,{sources,fault:'selection-snapshot'});const r=await s.run({...query,sources:sources.map(o=>({systemId:'source',objectRefs:[o.ref]}))});expect(s.requests).toHaveLength(2);expect(r.records).toEqual([]);expect(r.summary.quantities).toEqual([]);expect(r.coverage.some(c=>c.status!=='complete'&&c.reason?.includes('快照'))).toBe(true);
 });
 it('D15-a no source task API is needed for platform-linked resource reads',async()=>{
  const sources=[rawResource('R1')];const s=await setup(undefined,{sources,businessRefs:[sources[0].ref]});const r=await s.run({operation:'query',purpose:'task'});expect(r.items).toHaveLength(1);expect(r.items[0].relation).toBe('related');expect(r.relationshipCoverage.status).toBe('partial');expect(s.requests).toHaveLength(1);expect(s.requests[0].searchParams.has('taskId')).toBe(false);expect(s.requests[0].searchParams.has('objectRefs')).toBe(true);
 });
 it('D15-b explicit source region query retains both unrelated resources for spatial analysis',async()=>{
  const s=await setup(undefined,{sources:[rawResource('R1'),rawResource('R2',[105,3])]});const r=await s.run();expect(r.items.map(i=>i.relation)).toEqual(['unconfirmed','unconfirmed']);expect(r.coverage.every(c=>c.status==='complete')).toBe(true);expect(r.relationshipCoverage.status).toBe('partial');const spatial=await s.classify(r);expect(spatial.classifications!.map(c=>c.position).sort()).toEqual(['exterior','interior']);expect(r.summary.recordCount).toBe(2);
 });
 it('D15-c missing all task links does not trigger broad scans or certify zero assignment',async()=>{
  const s=await setup(undefined,{sources:[rawResource('R1')]});const r=await s.run({operation:'query',purpose:'task'});expect(s.requests).toEqual([]);expect(r.items).toEqual([]);expect(r.summary.entityCount).toBeNull();expect(r.summary.limitations.join('')).toMatch(/不证明|不能/);const assigned=s.resources.summarize({operation:'summarize',resultRef:r.resultRef,relation:'assigned'},r,s.scope,randomUUID(),randomUUID());expect(assigned.summary.limitations.join('')).toMatch(/空名单|零项|未确认/);
 });
 it('D15-d explicit data scope keeps related and unknown records without manufacturing assignment',async()=>{
  const sources=[rawResource('R1'),rawResource('R2')];const s=await setup(undefined,{sources,businessRefs:[sources[0].ref]});const r=await s.run();expect(r.items).toHaveLength(2);expect(itemNamed(r,'R1').relation).toBe('related');expect(itemNamed(r,'R2').relation).toBe('unconfirmed');expect(r.items.some(i=>i.relation==='assigned')).toBe(false);expect(r.summary.recordCount).toBe(2);
 });
 it.each(['complete','no-map','no-rule'] as const)('D15-e optional source task discovery works only with actual capability %s',async variant=>{
  const f=structuredClone(fixtures[0]);f.sources=f.sources!.slice(0,2);f.annotations=[];f.controlledImports=[];const capability=cap('source');if(variant==='no-map')delete capability.taskIdMapping;if(variant==='no-rule')delete capability.supportRule;
  const s=await setup(f,{capabilities:{source:capability}});const r=await s.run({operation:'query',purpose:'task'});
  if(variant==='no-map'){expect(s.requests).toEqual([]);expect(r.items).toEqual([]);}else{expect(s.requests.some(u=>u.searchParams.get('taskId')===s.task.id)).toBe(true);expect(itemNamed(r,'R1').relation).toBe('assigned');expect(itemNamed(r,'R2').relation).toBe(variant==='complete'?'potential_support':'unconfirmed');}
  const basic=await s.run({...query,sources:[{systemId:'source',objectRefs:[s.sources[0].ref]}]});expect(basic.records).toHaveLength(1);expect(s.requests.at(-1)!.searchParams.has('taskId')).toBe(false);
 });
 it('D16 rechecks source permissions and owner binding on read, summary and spatial use',async()=>{
  const s=await setup(undefined,{sources:[rawResource('R1')]});const r=await s.run();
  for(const scope of [{...s.scope,taskId:randomUUID()},{...s.scope,sessionId:randomUUID()},{...s.scope,actor:{userId:'other',seatId:'other'}}])expect(()=>s.resources.authorize(r,scope)).toThrow();
  s.context.config.scopes[0].seatIds=[];expect(()=>s.resources.authorize(r,s.scope)).toThrow();expect(()=>s.resources.summarize({operation:'summarize',resultRef:r.resultRef},r,s.scope,randomUUID(),randomUUID())).toThrow();await expect(s.classify(r)).rejects.toThrow();
 });
 it('D16 does not admit another seat private draft or an unbound session',async()=>{
  const s=await setup();const id=randomUUID();s.db.prepare('INSERT INTO seats(id,name,create_public,manage_model) VALUES(?,?,?,?)').run('b','B',1,0);s.db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,1)').run(id,'b','B','b','test-salt','test-hash');s.context.config.scopes[0].seatIds.push('b');const ws=await s.workspaces.ensureWorkspace(s.task.id,'b','B');const session=randomUUID();await s.workspaces.bind(session,ws.id,'b');const actor=s.annotations.actorForSeat('b');const privateDraft=s.annotations.action(actor,session,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,operations:[{op:'add_layer',layer:{layerId:'private',name:'私有',order:0,defaultVisible:true,features:[]}}]});
  await expect(s.run({operation:'query',purpose:'data',annotations:[{ref:privateDraft.ref!}]})).rejects.toThrow();await expect(s.resources.query(query,{...s.scope,sessionId:randomUUID()},randomUUID(),randomUUID())).rejects.toThrow();expect(s.requests).toEqual([]);
 });
 it('D17 expired and conditional status is not made current by query time; a later effective report can supersede expired facts',async()=>{
  const a=rawResource('old'),b=rawResource('new'),conditional=rawResource('conditional');a.resourceData!.entityId=b.resourceData!.entityId='one-car';a.resourceData!.resource.availability={state:'available',evidence,effectiveAt:'2026-11-02T03:00:00Z',validUntil:'2026-11-02T04:00:00Z'};b.resourceData!.resource.availability={state:'unavailable',evidence,effectiveAt:'2026-11-02T04:00:00Z'};conditional.resourceData!.resource.availability={state:'available',evidence,conditions:['等待调度批准']};
  const s=await setup(undefined,{sources:[a,b,conditional]});const r=await s.run();expect(r.items).toHaveLength(2);expect(itemNamed(r,'old').availability).toBe('unavailable');expect(itemNamed(r,'conditional').availability).toBe('unknown');expect(r.records[0].resource.availability!.validUntil).toBe('2026-11-02T04:00:00Z');
 });
 it('D17 identical entity IDs from different source namespaces never establish cross-source identity',async()=>{
  const first=rawResource('same'),second=rawResource('same');second.ref.systemId='second';const s=await setup(undefined,{sources:[first,second]});const r=await s.run({...query,sources:[{systemId:'source'},{systemId:'second'}]});expect(r.records).toHaveLength(2);expect(r.items).toHaveLength(2);expect(r.items[0].entityKey).not.toBe(r.items[1].entityKey);expect(r.summary.entityCount).toBeNull();
 });
 it('D17 an ordinary copy loses controlled identity while the imported record keeps its association',async()=>{
  const s=await setup(undefined,{sources:[rawResource('R1')]});await s.annotations.fromSource(s.actor,s.session,{clientActionId:randomUUID(),mode:'add',sourceRef:s.sources[0].ref,expectedSourceRevision:1,expectedRevision:s.head().revision,layerId:'resources',objectId:'imported'});s.annotations.action(s.actor,s.session,{action:'apply',clientActionId:randomUUID(),expectedRevision:s.head().revision,operations:[{op:'copy_object',source:s.head(),objectId:'imported',newObjectId:'copy',layerId:'resources'}]});const r=await s.run({...query,annotations:[{ref:s.head()}]});expect(r.records).toHaveLength(3);expect(r.items).toHaveLength(2);expect(r.records.find(x=>x.annotation?.objectId==='copy')!.association).toBeUndefined();expect(r.summary.entityCount).toBeNull();
 });
 it('D17 different annotation sets with identical contents are independent records without entity evidence',async()=>{
  const s=await setup();const feature:AnnotationFeature={objectId:'same-point',kind:'point',name:'资源声明',geometry:{type:'Point',coordinates:[103.5,1.5]},resource:{meaning:'actual_resource',category:'fire_engine'}};s.apply(feature);
  const another=randomUUID();await s.workspaces.bind(another,s.workspace.id);const other=s.annotations.action(s.actor,another,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,operations:[{op:'add_layer',layer:{layerId:'resources',name:'资源',order:0,defaultVisible:true,features:[feature]}}]});
  expect(s.annotations.version(s.actor,s.task.id,s.head()).hash).toBe(s.annotations.version(s.actor,s.task.id,other.ref!).hash);
  const r=await s.run({operation:'query',purpose:'data',annotations:[{ref:s.head()},{ref:other.ref!}]});expect(r.records).toHaveLength(2);expect(r.items).toHaveLength(2);expect(r.summary.entityCount).toBeNull();expect(new Set(r.records.map(i=>i.id)).size).toBe(2);
 });
 it('D18 classifies independent inside/boundary/outside/hole points and retains every missing-position reason',async()=>{
  const points=[rawResource('inside',[103.2,1.2]),rawResource('boundary',[103,1.5]),rawResource('outside',[105,3]),rawResource('hole',[103.5,1.5]),rawResource('hole-edge',[103.4,1.5]),rawResource('missing',null),rawResource('planned'),rawResource('estimated'),rawResource('site'),rawResource('conflict-a',[103.1,1.1]),rawResource('conflict-b',[103.9,1.9])];points[6].resourceData!.resource.position!.meaning='planned';points[7].resourceData!.resource.position!.meaning='estimated';points[8].resourceData!.resource.position!.appliesTo='site';points[9].resourceData!.entityId=points[10].resourceData!.entityId='conflict';
  const s=await setup(undefined,{sources:points});const r=await s.run();const geometry:SituationGeometry={type:'Polygon',coordinates:[[[103,1],[104,1],[104,2],[103,2],[103,1]],[[103.4,1.4],[103.4,1.6],[103.6,1.6],[103.6,1.4],[103.4,1.4]]]};const spatial=await s.classify(r);
  // Saved annotations accept single rings; hole semantics use the same geometry engine over actual queried resource positions.
  const holePositions=Object.fromEntries(r.items.filter(i=>i.geometry).map(i=>[i.name,classifyPoint(i.geometry!,geometry)]));expect(holePositions).toEqual({inside:'interior',boundary:'boundary',outside:'exterior',hole:'exterior','hole-edge':'boundary'});
  const positions=Object.fromEntries(spatial.classifications!.map(c=>[r.items.find(i=>i.id===c.itemId)!.name,c.position]));expect(positions).toEqual({inside:'interior',boundary:'boundary',outside:'exterior',hole:'interior','hole-edge':'interior'});expect(spatial.completeness.unclassified).toHaveLength(5);expect(spatial.completeness.unclassified!.every(i=>i.reason.length>0)).toBe(true);expect(spatial.completeness.status).toBe('partial');
  const service=new SpatialAnalysisService(s.annotations,s.context),scope={...s.scope,resolveResult:():SpatialResult=>spatial,resolveResourceResult:()=>r};const next=await service.analyze({operation:'filter',input:{kind:'result',resultRef:spatial.resultRef},attributes:[{field:'category',op:'eq',value:'fire_engine'}]},scope,randomUUID(),randomUUID());expect(next.completeness.unclassified).toHaveLength(5);
  s.apply({objectId:'origin',kind:'point',name:'比较基点',geometry:{type:'Point',coordinates:[103.2,1.2]}});const nearest=await service.analyze({operation:'nearest',input:{kind:'resource',resultRef:r.resultRef},target:{kind:'annotation',ref:s.head(),objectIds:['origin']},count:1},scope,randomUUID(),randomUUID());expect(nearest.items[0].name).toBe('inside');expect(nearest.completeness.unclassified).toHaveLength(5);
  await expect(s.classify(r,{type:'LineString',coordinates:[[103,1],[104,1]]})).rejects.toThrow();
 });
});

it('D21 source and adopted-publication changes do not mutate old fixed pages or totals',async()=>{
 const s=await setup(fixtures[10],{sources:[rawResource('R1')]});
 const firstPublication=s.annotations.action(s.actor,s.session,{action:'publish',clientActionId:randomUUID(),revision:s.head().revision,title:'旧版'});s.annotations.setCurrent(s.actor,s.task.id,{clientActionId:randomUUID(),publicationId:firstPublication.publication!.publicationId,expectedCurrentSequence:0});
 const another=randomUUID();await s.workspaces.bind(another,s.workspace.id);const scope={...s.scope,sessionId:another};
 const before=await s.resources.query({operation:'query',purpose:'task'},scope,randomUUID(),'before'),raw=JSON.stringify(before);
 const sourceBefore=await s.run(),sourceRaw=JSON.stringify(sourceBefore);s.sources[0].name='来源新版';s.sources[0].revision=2;
 s.annotations.action(s.actor,s.session,{action:'apply',clientActionId:randomUUID(),expectedRevision:s.head().revision,operations:[{op:'update_object',objectId:'published-car',changes:{name:'草稿新版'}}]});
 const next=s.annotations.action(s.actor,s.session,{action:'publish',clientActionId:randomUUID(),revision:s.head().revision,title:'新版'});s.annotations.setCurrent(s.actor,s.task.id,{clientActionId:randomUUID(),publicationId:next.publication!.publicationId,expectedCurrentSequence:1});
 const after=await s.resources.query({operation:'query',purpose:'task'},scope,randomUUID(),'after');expect(after.items[0].name).toBe('草稿新版');expect((await s.run()).items[0].name).toBe('来源新版');
 s.resources.authorize(before,scope);s.resources.authorize(sourceBefore,s.scope);expect(JSON.stringify(before)).toBe(raw);expect(JSON.stringify(sourceBefore)).toBe(sourceRaw);expect(resourceResultValid(before)).toBe(true);
});

it.each(['valid','missing','expired'] as const)('D06 comparable quantities respect %s coverage without hiding separate facts',async mode=>{
 const f=structuredClone(fixtures[5]);f.sources![1].resourceData!.resource.quantity!.meaning='available';
 if(mode!=='missing')f.sources![0].resourceData!.coverage=f.coverageAlternatives![0]!;
 if(mode==='expired')f.sources![0].resourceData!.resource.quantity!.validUntil='2026-11-02T04:30:00Z';
 const s=await setup(f),result=await s.run();
 // Complete all-member coverage does not identify the available subset. Keep both source declarations.
 if(mode==='valid'){expect(result.summary.quantities.map(q=>q.value)).toEqual([null]);expect(result.records.map(r=>r.resource.quantity!.value)).toEqual([3,1]);}
 else if(mode==='missing'){expect(result.summary.quantities.every(q=>q.value===null)).toBe(true);}
 else {expect(result.summary.quantities).toContainEqual(expect.objectContaining({value:1}));expect(result.summary.quantities).toContainEqual(expect.objectContaining({value:null}));}
 expect(resourceResultValid(result)).toBe(true);
});

it('T02 keeps original unconfirmed rows while an empty selected task set remains unknown',async()=>{
 const s=await setup(undefined,{sources:[rawResource('unconfirmed')]});
 const r=await s.run({...query,purpose:'task'});
 expect(r.records).toHaveLength(1);expect(r.items).toHaveLength(1);
 expect(r.summary).toMatchObject({recordCount:0,itemCount:0,knownEntityCount:0,entityCount:null});
 expect(resourceResultValid(r)).toBe(true);
});
it('T06 complete overlapping member declarations count their union, not their sum',async()=>{
 const a=rawResource('A'),b=rawResource('B');
 for(const [row,members] of [[a,['X','Y']],[b,['Y','Z']]] as const){delete row.resourceData!.entityId;row.resourceData!.resource.granularity='aggregate';row.resourceData!.resource.quantity!.value=2;row.resourceData!.coverage={scope:'fleet',complete:true,memberEntityIds:[...members]};}
 const s=await setup(undefined,{sources:[a,b]});const r=await s.run();
 expect(r.summary.quantities).toEqual([expect.objectContaining({value:3,knownValue:3})]);
 expect(resourceResultValid(r)).toBe(true);
});

it.each([false,true])('T01/T05 empty source partial=%s distinguishes known zero from unknown total',async partial=>{
 const s=await setup(undefined,{partial});const r=await s.run();
 expect(r.summary).toMatchObject({recordCount:0,itemCount:0,knownEntityCount:0,entityCount:partial?null:0});
 expect(r.coverage[0].status).toBe(partial?'partial':'complete');expect(resourceResultValid(r)).toBe(true);
});
it('T03 data query then task summary uses the same empty-selection rules',async()=>{
 const s=await setup(undefined,{sources:[rawResource('unknown')]});const data=await s.run();
 expect(data.summary.entityCount).toBe(1);
 const task=s.resources.summarize({operation:'summarize',resultRef:data.resultRef,relation:'related'},data,s.scope,randomUUID(),'selected');
 expect(task.summary).toMatchObject({recordCount:0,itemCount:0,knownEntityCount:0,entityCount:null});expect(resourceResultValid(task)).toBe(true);
 expect(data.records).toHaveLength(1);expect(task.records).toHaveLength(0);
});
it.each([false,true])('T04 mixed relationship records preserve final-page coverage partial=%s',async partial=>{
 const known=rawResource('known'),unknown=rawResource('unknown');
 const s=await setup(undefined,{sources:[known,unknown],businessRefs:[known.ref],partial});
 const r=await s.run({...query,purpose:'task'});
 expect(r.records).toHaveLength(2);expect(r.items).toHaveLength(2);
 expect(r.summary).toMatchObject({recordCount:1,itemCount:1,knownEntityCount:1,entityCount:1});
 expect(r.coverage[0].status).toBe(partial?'partial':'complete');expect(r.relationshipCoverage.status).toBe('partial');expect(resourceResultValid(r)).toBe(true);
});

it('T10 actual controlled import is deduplicated with source members across multiple aggregates',async()=>{
 const x=rawResource('X'),a=rawResource('A'),b=rawResource('B');
 for(const [r,ids] of [[a,['X','Y']],[b,['X','Z']]] as const){delete r.resourceData!.entityId;r.resourceData!.resource.granularity='aggregate';r.resourceData!.resource.quantity!.value=2;r.resourceData!.coverage={scope:'fleet',complete:true,memberEntityIds:[...ids]};}
 const s=await setup(undefined,{sources:[a,b,x]});
 await s.annotations.fromSource(s.actor,s.session,{clientActionId:randomUUID(),mode:'add',sourceRef:x.ref,expectedSourceRevision:1,expectedRevision:s.head().revision,layerId:'resources',objectId:'imported-X'});
 const r=await s.run({...query,annotations:[{ref:s.head()}]});
 expect(r.records).toHaveLength(4);expect(r.items).toHaveLength(3);expect(r.summary.quantities[0]).toMatchObject({value:3,knownValue:3});expect(resourceResultValid(r)).toBe(true);
});

it('T13 actual service recomputes v1 parent into a new v2 result without rewriting the old result',async()=>{
 const s=await setup();const old=structuredClone(legacyOverlap) as ResourceResult;
 old.owner={...s.actor,taskId:s.task.id,sessionId:s.session};const bytes=JSON.stringify(old);
 expect(resourceResultValid(old)).toBe(true);s.resources.authorize(old,s.scope);
 const fresh=s.resources.summarize({operation:'summarize',resultRef:old.resultRef},old,s.scope,randomUUID(),'recompute');
 expect(fresh.schemaVersion).toBe(2);expect(fresh.resultRef).not.toBe(old.resultRef);expect(fresh.parentResultRef).toBe(old.resultRef);
 expect(fresh.summary.quantities[0]).toMatchObject({value:3,knownValue:3});expect(resourceResultValid(fresh)).toBe(true);
 expect(JSON.stringify(old)).toBe(bytes);expect(old.summary.quantities[0].value).toBe(4);
});

it.each(['unknown',undefined] as const)('T09 missing identity with granularity=%s cannot imply disjoint additive counts',async granularity=>{
 const rows=[rawResource('A'),rawResource('B')];
 for(const r of rows){delete r.resourceData!.entityId;if(granularity)r.resourceData!.resource.granularity=granularity;else delete r.resourceData!.resource.granularity;r.resourceData!.resource.quantity!.value=2;expect(()=>decodeSourceResource(r.resourceData)).not.toThrow();}
 const s=await setup(undefined,{sources:rows});
 const both=await s.run();expect(both.records).toHaveLength(2);expect(both.summary.quantities[0]).toMatchObject({value:null,knownValue:0,unknownCount:2});expect(resourceResultValid(both)).toBe(true);
 const single=await s.run({...query,sources:[{systemId:'source',objectRefs:[rows[0].ref]}]});expect(single.summary.quantities[0]).toMatchObject({value:2,knownValue:2});expect(resourceResultValid(single)).toBe(true);
});
