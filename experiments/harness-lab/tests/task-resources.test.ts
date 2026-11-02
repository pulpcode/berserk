import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/access/database.js';
import { AnnotationService } from '../src/annotations/service.js';
import { ContextService } from '../src/context/service.js';
import { WorkspaceStore } from '../src/workspaces/store.js';
import { canonical, document, feature } from '../src/annotations/validation.js';
import { situationObject } from '../src/context/validation.js';
import { decodeTaskResource, decodeSourceResource, decodeConversationResourceSupplement } from '../src/contracts/task-resources.js';
import type { TaskResource } from '../src/contracts/task-resources.js';
import type { SituationObject } from '../src/contracts/context.js';
import type { AnnotationFeature, AnnotationOperation, AnnotationRef } from '../src/contracts/annotations.js';
import { annotationTools } from '../src/pi/annotation-tools.js';
import { AnnotationRequestState } from '../src/pi/annotation-state.js';
import { projectAnnotationResult } from '../src/contracts/annotation-results.js';
import { validateToolArguments } from '@earendil-works/pi-ai';

const clean:Array<()=>void|Promise<unknown>>=[];
afterEach(async()=>{for(const close of clean.splice(0).reverse())await close();});
const sourceRef={systemId:'source',objectType:'resource',objectId:'R1'};
const declared=[{kind:'declaration' as const,note:'用户声明，非来源认证'}];
const resource:TaskResource={meaning:'actual_resource',category:'fire_engine',granularity:'individual',quantity:{value:1,unit:'辆',meaning:'entities',scope:'task-a',evidence:declared},availability:{state:'unknown',evidence:declared},position:{meaning:'planned',appliesTo:'resource',evidence:declared}};
const point=(id='point'):AnnotationFeature=>({objectId:id,kind:'point',name:'资源',geometry:{type:'Point',coordinates:[103,1]},resource:structuredClone(resource)});
async function setup() {
  const dir=await mkdtemp(join(tmpdir(),'task-resource-'));clean.push(()=>rm(dir,{recursive:true,force:true}));
  const db=await openDatabase(dir);clean.push(()=>db.close());const workspaces=await WorkspaceStore.open(dir,'a');
  const workspace=workspaces.get(),session=randomUUID(),second=randomUUID();await workspaces.bind(session,workspace.id);await workspaces.bind(second,workspace.id);
  const response:{items:SituationObject[]}={items:[{ref:sourceRef,name:'来源车',revision:1,areaIds:[],effectiveAt:null,validTime:null,geometry:{type:'Point',coordinates:[103,1]},properties:{},resourceData:{resource:structuredClone(resource),entityId:'vehicle-1'}}]};
  const fetch=vi.fn<typeof globalThis.fetch>(async()=>new Response(JSON.stringify({systemId:'source',asOf:'2026-11-02T04:00:00Z',items:response.items,limit:20,nextCursor:null,hasMore:false,timeUnknownCount:0,unknownRefs:[],changeCursor:'fixed-1'}),{headers:{'content-type':'application/json'}}));
  const context=new ContextService({systems:[{id:'source',name:'模拟来源',adapter:'mock-situation-http',baseUrl:'http://127.0.0.1:4401',tokenEnv:'RESOURCE_TOKEN'}],scopes:[{id:'scope',name:'范围',systemIds:['source'],seatIds:['a']}]},{RESOURCE_TOKEN:'synthetic'},{fetch});
  const service=new AnnotationService(db,workspaces,undefined,context),actor=service.actorForSeat('a');
  service.action(actor,session,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,operations:[{op:'add_layer',layer:{layerId:'places',name:'位置',order:0,defaultVisible:true,features:[]}}]});
  const head=()=>{const d=service.binding(actor,session).draft!;return {setId:d.setId,revision:d.headRevision};};
  const version=(ref:AnnotationRef=head())=>service.version(actor,workspace.taskSpaceId!,ref);
  const objects=()=>version().document.layers[0].features;
  const apply=(operations:AnnotationOperation[])=>service.action(actor,session,{action:'apply',clientActionId:randomUUID(),expectedRevision:head().revision,operations});
  const imported=()=>service.fromSource(actor,session,{clientActionId:randomUUID(),mode:'add',sourceRef,expectedSourceRevision:1,expectedRevision:head().revision,layerId:'places',objectId:'imported'});
  return {db,workspaces,workspace,session,second,service,actor,context,response,fetch,head,version,objects,apply,imported};
}

it('round-trips declarations through service, selected reads, native tool projection and restart without manufacturing identity',async()=>{
  const s=await setup();s.apply([{op:'add_object',layerId:'places',feature:point()}]);
  expect(s.objects()[0]).toEqual(point());expect(s.objects()[0].resourceAssociation).toBeUndefined();
  const read=s.service.read(s.actor,s.workspace.taskSpaceId!,{ref:s.head(),fields:['resource','resourceAssociation']});
  expect(read.objects.items[0].resource).toEqual(resource);expect(projectAnnotationResult(read)).toMatchObject({objects:{items:[{resource}]}});
  const reopened=new AnnotationService(s.db,s.workspaces,undefined,s.context);expect(reopened.version(s.actor,s.workspace.taskSpaceId!,s.head())).toEqual(s.version());
  const state=new AnnotationRequestState();state.observeDraft(s.service.binding(s.actor,s.session));state.beginInference();
  const tools=annotationTools(s.service,{actor:s.actor,sessionId:s.session,taskId:s.workspace.taskSpaceId!,requestId:randomUUID(),signal:new AbortController().signal,check:()=>{},state});
  const tool=tools.find(t=>t.name==='annotation_action')!;
  const args={action:'apply',operations:[{op:'add_object',layerId:'places',feature:point('tool')}]};
  expect(()=>validateToolArguments(tool,{type:'toolCall',id:'valid',name:tool.name,arguments:args})).not.toThrow();
  await tool.execute('valid',args,undefined,undefined,{} as never);
  expect(s.objects().find(item=>item.objectId==='tool')?.resource).toEqual(resource);
  const readTool=tools.find(t=>t.name==='annotation_read')!;
  const result=await readTool.execute('read',{mode:'draft',fields:['resource','resourceAssociation']},undefined,undefined,{} as never);
  expect(JSON.stringify(result.content)).toContain('actual_resource');
});

it('rejects invalid fields and forged authority atomically with no receipt or revision',async()=>{
  const s=await setup();
  const invalidResources=[{...resource,quantity:{...resource.quantity,value:-1}},{...resource,quantity:{...resource.quantity,value:0.5}},{...resource,quantity:{...resource.quantity,unit:'艘'}},{...resource,taskRelations:[{taskId:'t',relation:'deployed',evidence:declared}]},{...resource,availability:{state:'available',evidence:[]}},{...resource,availability:{state:'unknown',evidence:declared,effectiveAt:'2026-02-30T01:00:00Z'}},JSON.parse('{"meaning":"actual_resource","__proto__":{"certified":true}}'),Object.assign(Object.create({meaning:'actual_resource'}),{})];
  for(const candidate of invalidResources) {
    const before=s.head();expect(()=>s.apply([{op:'add_object',layerId:'places',feature:point('first')},{op:'add_object',layerId:'places',feature:{...point('bad'),resource:candidate as TaskResource}}])).toThrow();expect(s.head()).toEqual(before);expect(s.objects()).toEqual([]);
  }
  const association={source:sourceRef,sourceRevision:1,entityId:'vehicle-1'};
  for(const op of [{op:'add_object',layerId:'places',feature:{...point(),resourceAssociation:association}},{op:'add_layer',layer:{layerId:'bad',name:'坏',order:1,defaultVisible:true,features:[{...point(),resourceAssociation:association}]}},{op:'update_object',objectId:'point',changes:{resourceAssociation:association}}]) expect(()=>s.apply([op as AnnotationOperation])).toThrow();
  expect(s.db.prepare('SELECT count(*) n FROM annotation_revisions').get()?.n).toBe(1);
});

it('establishes association only from explicit source metadata, preserves independent facts on refresh and removes identity on ordinary copy',async()=>{
  const s=await setup();await s.imported();const original=s.version();
  expect(s.objects()[0].resourceAssociation).toEqual({source:sourceRef,sourceRevision:1,entityId:'vehicle-1'});
  s.apply([{op:'update_object',objectId:'imported',changes:{resource:{...resource,availability:{state:'unavailable',evidence:declared}},geometry:{type:'Point',coordinates:[104,2]}}}]);
  expect(s.objects()[0].resourceAssociation).toEqual(original.document.layers[0].features[0].resourceAssociation);
  s.response.items[0].revision=2;s.response.items[0].geometry={type:'Point',coordinates:[105,3]};
  await s.service.fromSource(s.actor,s.session,{clientActionId:randomUUID(),mode:'refresh',sourceRef,expectedSourceRevision:2,expectedRevision:s.head().revision,layerId:'places',objectId:'imported'});
  expect(s.objects()[0].resource?.availability?.state).toBe('unavailable');expect(s.objects()[0].geometry).toEqual(s.response.items[0].geometry);expect(s.version(original.ref)).toEqual(original);
  s.apply([{op:'copy_object',source:s.head(),objectId:'imported',newObjectId:'copy',layerId:'places'}]);expect(s.objects()[1].resourceAssociation).toBeUndefined();expect(s.objects()[1].resource).toEqual(s.objects()[0].resource);
  s.apply([{op:'update_object',objectId:'imported',changes:{resource:{meaning:'planned_location'}}}]);expect(s.objects()[0].resourceAssociation).toBeUndefined();
});

it('does not reinterpret legacy availableCount and rejects incompatible source identity/foreign evidence',async()=>{
  const s=await setup();delete s.response.items[0].resourceData;s.response.items[0].properties={availableCount:3,unit:'辆'};await s.imported();expect(s.objects()[0].resource).toBeUndefined();expect(s.objects()[0].resourceAssociation).toBeUndefined();expect(s.response.items[0].properties).toEqual({availableCount:3,unit:'辆'});
  expect(()=>decodeSourceResource({resource:{...resource,granularity:'aggregate'},entityId:'fake'})).toThrow();
  const bad={...s.response.items[0],resourceData:{resource:{...resource,evidence:[{kind:'source',ref:{...sourceRef,systemId:'other'},revision:1}]}}};expect(()=>situationObject(bad,'source')).toThrow();
});

it('keeps new evidence in source authorization and redacts private locators consistently in publication and derivation',async()=>{
  const s=await setup();await s.imported();const privateRef=s.head();
  const privateResource={...resource,availability:{state:'available' as const,evidence:[{kind:'annotation' as const,ref:privateRef,objectId:'imported'}]}};
  s.apply([{op:'add_object',layerId:'places',feature:{...point('private-based'),resource:privateResource}}]);
  const published=s.service.action(s.actor,s.session,{action:'publish',clientActionId:randomUUID(),revision:s.head().revision,title:'明确共享'});
  const publicVersion=s.version(published.ref);expect(document(publicVersion.document)).toEqual(publicVersion.document);
  const publicObject=publicVersion.document.layers[0].features[1];expect(publicObject.resource?.availability?.state).toBe('available');expect(publicObject.resource?.availability?.evidence[0].kind).toBe('declaration');expect(JSON.stringify(publicObject)).not.toContain(privateRef.setId);
  const derived=s.service.action(s.actor,s.second,{action:'create_draft',clientActionId:randomUUID(),baseRef:published.ref});expect(s.service.version(s.actor,s.workspace.taskSpaceId!,derived.ref!).document).toEqual(publicVersion.document);
  s.apply([{op:'update_object',objectId:'private-based',changes:{resource:{...resource,availability:{state:'unavailable',evidence:declared}}}}]);
  expect(s.version(published.ref)).toEqual(publicVersion);
  s.service.setCurrent(s.actor,s.workspace.taskSpaceId!,{clientActionId:randomUUID(),publicationId:published.publication!.publicationId,expectedCurrentSequence:0});
  expect(s.service.current(s.actor,s.workspace.taskSpaceId!).publication?.publicationId).toBe(published.publication!.publicationId);
  s.context.config.scopes[0].seatIds=[];
  for(const ref of [privateRef,published.ref!,derived.ref!]) expect(()=>s.version(ref)).toThrow('无权访问');expect(()=>s.service.receipt(s.actor,published.clientActionId)).toThrow();
});

it('rejects nonexistent private evidence and denied source evidence without partial mutations',async()=>{
  const s=await setup();
  for(const evidence of [[{kind:'annotation',ref:{setId:randomUUID(),revision:1},objectId:'secret'}],[{kind:'source',ref:{...sourceRef,systemId:'denied'},revision:1}]]) {
    expect(()=>s.apply([{op:'add_object',layerId:'places',feature:{...point(),resource:{...resource,evidence} as TaskResource}}])).toThrow();expect(s.head().revision).toBe(1);
  }
});

it('inherits evidence-only source restrictions in a fresh draft even after the dependent object is deleted',async()=>{
  const s=await setup();await s.imported();const privateRef=s.head();
  const receipt=s.service.action(s.actor,s.second,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,operations:[
    {op:'add_layer',layer:{layerId:'fresh',name:'独立草稿',order:0,defaultVisible:true,features:[{...point('dependent'),resource:{meaning:'actual_resource',evidence:[{kind:'annotation',ref:privateRef,objectId:'imported'}]}}]}},
    {op:'delete_object',objectId:'dependent'},
  ]});
  expect(s.version(receipt.ref).document.layers[0].features).toEqual([]);
  s.context.config.scopes[0].seatIds=[];
  expect(()=>s.version(receipt.ref)).toThrow('无权访问');
  expect(()=>s.service.receipt(s.actor,receipt.clientActionId)).toThrow('无权访问');
});

it('rejects existing foreign private evidence and derives the public projection across seats without private locators',async()=>{
  const s=await setup();await s.imported();const privateRef=s.head();
  const evidence=[{kind:'annotation' as const,ref:privateRef,objectId:'imported'}];
  s.apply([{op:'add_object',layerId:'places',feature:{...point('dependent'),resource:{...resource,evidence,quantity:{...resource.quantity!,evidence},availability:{state:'unknown',evidence},position:{meaning:'planned',appliesTo:'resource',evidence},taskRelations:[{taskId:'task-a',relation:'related',evidence}]}}}]);
  const workspace=await s.workspaces.ensureWorkspace(s.workspace.taskSpaceId,'b','另一席位'),session=randomUUID(),actor=s.service.actorForSeat('b');
  await s.workspaces.bind(session,workspace.id,'b');s.context.config.scopes[0].seatIds.push('b');
  const deniedId=randomUUID();
  expect(()=>s.service.action(actor,session,{action:'create_draft',clientActionId:deniedId,baseRef:null,operations:[{op:'add_layer',layer:{layerId:'foreign',name:'引用',order:0,defaultVisible:true,features:[{...point(),resource:{meaning:'actual_resource',evidence}}]}}]})).toThrow('无权访问');
  expect(s.service.binding(actor,session).draft).toBeNull();expect(s.service.receipt(actor,deniedId)).toBeNull();
  const published=s.service.action(s.actor,s.session,{action:'publish',clientActionId:randomUUID(),revision:s.head().revision,title:'共享声明'});
  const publicVersion=s.service.version(actor,s.workspace.taskSpaceId,published.ref!);
  expect(JSON.stringify(publicVersion.document)).not.toContain(privateRef.setId);
  expect(publicVersion.hash).toBe(createHash('sha256').update(canonical(publicVersion.document)).digest('hex'));
  const derived=s.service.action(actor,session,{action:'create_draft',clientActionId:randomUUID(),baseRef:published.ref});
  expect(s.service.version(actor,s.workspace.taskSpaceId,derived.ref!).document).toEqual(publicVersion.document);
  expect(publicVersion.document.layers[0].features[0].resourceAssociation).toEqual({source:sourceRef,sourceRevision:1,entityId:'vehicle-1'});
  s.context.config.scopes[0].seatIds=['a'];
  expect(()=>s.service.version(actor,s.workspace.taskSpaceId,derived.ref!)).toThrow('无权访问');
});

it('keeps fixed legacy shape and canonical hash with absent optional resource fields',()=>{
  const legacy={schemaVersion:1,title:'legacy',layers:[{layerId:'places',name:'位置',order:0,defaultVisible:true,features:[{objectId:'old',kind:'point',name:'旧点',geometry:{type:'Point',coordinates:[103,1]}}]}]};
  const decoded=document(legacy);expect(decoded).toEqual(legacy);expect(createHash('sha256').update(canonical(decoded)).digest('hex')).toBe('60ff10996ce37596f8864df65a376a2d6113a9de8bc1545546708a5063e717c4');
});

it('loads all twelve independent development cases and exercises their actual source, annotation and supplement decoders',async()=>{
  const inputs=JSON.parse(await readFile(new URL('../fixtures/task-resources-v1/inputs.json',import.meta.url),'utf8'));
  const expected=JSON.parse(await readFile(new URL('../fixtures/task-resources-v1/expected.json',import.meta.url),'utf8'));
  expect(inputs.cases.map((c:{id:string})=>c.id)).toEqual(Array.from({length:12},(_,i)=>`B1-S${String(i+1).padStart(2,'0')}`));
  const s=await setup();let count=0;
  for(const c of inputs.cases) {
    expect(Object.hasOwn(expected,c.id)).toBe(true);
    for(const source of c.sources??[]) expect(situationObject(source,source.ref.systemId)).toEqual(source);
    for(const coverage of c.coverageAlternatives??[]) if(coverage) {
      const source={...c.sources[0].resourceData,coverage};expect(decodeSourceResource(source)).toEqual(source);
    }
    for(const supplement of c.supplements??[]) expect(decodeConversationResourceSupplement(supplement)).toEqual(supplement);
    const caseIds:string[]=[];
    for(const raw of c.annotations??[]) {
      const value=feature({...raw,objectId:`case-${++count}`});caseIds.push(value.objectId);
      // Declarations with second-system dependencies stay outside this single-source harness.
      s.apply([{op:'add_object',layerId:'places',feature:value}]);expect(s.objects().at(-1)).toEqual(value);
    }
    if(c.id==='B1-S02') expect(s.service.read(s.actor,s.workspace.taskSpaceId!,{ref:s.head(),objectIds:caseIds}).objects.total).toBe(expected[c.id].graphicCount);
  }
  expect(count).toBe(11);
  const supplement=inputs.cases[11].supplements[0];expect(()=>decodeConversationResourceSupplement({...supplement,message:{...supplement.message,role:'assistant'}})).toThrow();
  expect(decodeTaskResource({meaning:'unspecified'})).toEqual({meaning:'unspecified'});
});

it.each(['missing','aggregate','changed'] as const)('refuses refresh when explicit source entity becomes %s without updating geometry or revision',async condition=>{
  const s=await setup();await s.imported();const before=s.version();s.response.items[0].revision=2;s.response.items[0].geometry={type:'Point',coordinates:[105,3]};
  if(condition==='missing') delete s.response.items[0].resourceData;
  if(condition==='aggregate') s.response.items[0].resourceData={resource:{...resource,granularity:'aggregate'}};
  if(condition==='changed') s.response.items[0].resourceData!.entityId='another-vehicle';
  if(condition==='missing') s.response.items[0].properties={availableCount:3,unit:'辆'};
  await expect(s.service.fromSource(s.actor,s.session,{clientActionId:randomUUID(),mode:'refresh',sourceRef,expectedSourceRevision:2,expectedRevision:s.head().revision,layerId:'places',objectId:'imported'})).rejects.toMatchObject({code:'ANNOTATION_CONFLICT'});
  expect(s.version()).toEqual(before);
});

it('defines capability and coverage failures distinctly from a complete empty source',async()=>{
  const {decodeResourceCapability,decodeResourceCoverage}=await import('../src/contracts/task-resources.js');
  const capability={systemId:'source',categories:['fire_engine','rescue_boat'],units:['辆','艘'],relations:['assigned','potential_support'],taskIdMapping:'mock taskId equality',supportRule:{id:'mock-support',description:'模拟任务支援关系'},filters:['category','task','relation'],pagination:'cursor',snapshot:'fixed_revision'};
  expect(decodeResourceCapability(capability)).toEqual(capability);const {supportRule,...unsupported}=capability;void supportRule;expect(()=>decodeResourceCapability(unsupported)).toThrow();
  const scope={systemId:'source',taskId:'task-a',relation:'assigned'};
  expect(()=>decodeResourceCoverage({systemId:'source',scope,status:'partial',asOf:'2026-11-02T04:00:00Z'})).toThrow();
  for(const detail of [{nextCursor:'page-2'},{reason:'仅覆盖本站登记资源，无更多分页'}]) {
    const partial={systemId:'source',scope,status:'partial',asOf:'2026-11-02T04:00:00Z',...detail};expect(decodeResourceCoverage(partial)).toEqual(partial);
  }
  expect(()=>decodeResourceCoverage({systemId:'source',scope,status:'partial',asOf:'2026-11-02T04:00:00Z',reason:'   '})).toThrow();
  expect(()=>decodeResourceCoverage({systemId:'source',scope,status:'complete',asOf:'2026-11-02T04:00:00Z',nextCursor:'page-2'})).toThrow();
  expect(()=>decodeResourceCoverage({systemId:'source',scope,status:'unavailable'})).toThrow();
  const inputs=JSON.parse(await readFile(new URL('../fixtures/task-resources-v1/inputs.json',import.meta.url),'utf8'));
  for(const value of inputs.cases[9].coverage) expect(decodeResourceCoverage(value)).toEqual(value);
});
