import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { BackgroundStore } from '../src/background/store.js';
import { AnnotationStore, annotationTables } from '../src/annotations/store.js';
import { AnnotationService } from '../src/annotations/service.js';
import * as validation from '../src/annotations/validation.js';
import type { AnnotationFeature, AnnotationRef } from '../src/contracts/annotations.js';
import { ContextService } from '../src/context/service.js';
import { WorkspaceStore } from '../src/workspaces/store.js';

const cleanup: Array<()=>Promise<unknown>|void>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse()) await close();});
async function setup() {
  const dir=await mkdtemp(join(tmpdir(),'annotations-unit-')); cleanup.push(()=>rm(dir,{recursive:true,force:true}));
  const db=await openDatabase(dir); cleanup.push(()=>db.close());
  const workspaces=await WorkspaceStore.open(dir,'a'); const workspace=workspaces.get();
  const session=randomUUID(),second=randomUUID(); await workspaces.bind(session,workspace.id); await workspaces.bind(second,workspace.id);
  const service=new AnnotationService(db,workspaces),actor=service.actorForSeat('a');
  return {dir,db,workspaces,workspace,session,second,service,actor,taskId:workspace.taskSpaceId};
}
const point=(objectId='point-a'): AnnotationFeature=>({objectId,kind:'point',name:objectId,geometry:{type:'Point',coordinates:[103,1]},note:'机密业务备注',attributes:{capacity:20},style:{color:'#aabbcc'}});
const initial=()=>({action:'create_draft' as const,clientActionId:randomUUID(),baseRef:null,title:'标注',operations:[{op:'add_layer' as const,layer:{layerId:'layer-a',name:'集合点',order:0,defaultVisible:true,features:[point()]}}]});
const draftRef=(service: AnnotationService,actor: ReturnType<AnnotationService['actorForSeat']>,session: string): AnnotationRef=>{const draft=service.binding(actor,session).draft!;return {setId:draft.setId,revision:draft.headRevision};};

it('pins a baseline without creating a draft, rejects stale/busy rebinding, and creates atomically',async()=>{
  const {service,actor,session,second,taskId,db}=await setup();
  expect(service.automaticContext(actor,session)).toBeUndefined();
  expect(service.binding(actor,session).bindingRevision).toBe(0);
  service.action(actor,session,initial());const source=draftRef(service,actor,session);
  const input={clientActionId:randomUUID(),expectedBindingRevision:0,baseRef:source};
  const saved=service.setBase(actor,second,input);
  expect(service.setBase(actor,second,input)).toEqual(saved);
  expect(service.binding(actor,second).draft).toBeNull();
  service.isSessionBusy=()=>true;
  expect(service.setBase(actor,second,input)).toEqual(saved);
  expect(()=>service.setBase(actor,second,{...input,clientActionId:randomUUID(),expectedBindingRevision:1,baseRef:null})).toThrow('正在处理');
  service.isSessionBusy=()=>false;
  expect(()=>service.setBase(actor,second,{...input,clientActionId:randomUUID()})).toThrow('已变化');
  expect(()=>service.action(actor,second,{action:'create_draft',clientActionId:randomUUID(),baseRef:null})).toThrow('不一致');
  service.action(actor,second,{action:'create_draft',clientActionId:randomUUID()});
  const derived=draftRef(service,actor,second);
  expect(derived).not.toEqual(source); expect(service.version(actor,taskId,derived).document).toEqual(service.version(actor,taskId,source).document);
  expect(()=>service.setBase(actor,second,{...input,clientActionId:randomUUID(),expectedBindingRevision:1})).toThrow('已有草稿');
  const revisions=db.prepare('SELECT count(*) n FROM annotation_revisions').get()?.n;
  expect(()=>service.action(actor,second,{action:'apply',clientActionId:randomUUID(),expectedRevision:1,operations:[{op:'delete_object',objectId:'point-a'},{op:'delete_layer',layerId:'missing'}]})).toThrow();
  expect(db.prepare('SELECT count(*) n FROM annotation_revisions').get()?.n).toBe(revisions);
});

it('keeps ordinary context constant-size and only resolves explicitly selected descriptions',async()=>{
  const {service,actor,session,taskId}=await setup();service.action(actor,session,initial());
  const first=service.automaticContext(actor,session)!;
  service.action(actor,session,{action:'apply',clientActionId:randomUUID(),expectedRevision:1,operations:[{op:'add_layer',layer:{layerId:'large',name:'大图层',order:1,defaultVisible:true,features:Array.from({length:200},(_,i)=>point(`point-${i}`))}}]});
  const latest=service.automaticContext(actor,session)!;
  expect(JSON.stringify(latest).length).toBe(JSON.stringify(first).length);
  expect(JSON.stringify(latest)).not.toContain('geometry');expect(JSON.stringify(latest)).not.toContain('大图层');
  const ref=draftRef(service,actor,session);
  const whole=service.resolveSelections(actor,taskId,[ref])[0];expect(whole.layers).toEqual([]);expect(whole.objects).toEqual([]);
  const layer=service.resolveSelections(actor,taskId,[{...ref,layerIds:['large']}])[0];expect(layer.layers).toEqual([{layerId:'large',name:'大图层'}]);expect(layer.objects).toEqual([]);
  const objectIds=Array.from({length:150},(_,i)=>`point-${i}`);
  const selected=service.resolveSelections(actor,taskId,[{...ref,objectIds}])[0];expect(selected.objects).toHaveLength(150);
  expect(JSON.stringify(selected)).not.toMatch(/geometry|capacity|机密业务备注/);
  expect(()=>service.resolveSelections(actor,taskId,[{...ref,layerIds:['large'],objectIds}])).toThrow();
  const read=service.read(actor,taskId,{ref,objectIds:['point-3','point-4'],fields:['geometry']});
  expect(read.layers).toHaveLength(1);expect(read.objects.total).toBe(2);expect(read.objects.items[0].geometry).toEqual(point().geometry);
  expect(JSON.stringify(read)).not.toMatch(/capacity|机密业务备注/);
  expect(service.read(actor,taskId,{ref,layerIds:['large'],offset:100,limit:100}).objects.hasMore).toBe(false);
});

it('compares only common-lineage IDs and preserves saved historical geometry',async()=>{
  const {service,actor,session,second,taskId,workspaces,workspace}=await setup();
  service.action(actor,session,initial()); service.action(actor,second,initial());
  const original=draftRef(service,actor,session),unrelated=draftRef(service,actor,second);
  expect(service.compare(actor,taskId,original,unrelated).counts).toEqual({added:2,removed:2,changed:0});
  const branch=randomUUID();await workspaces.bind(branch,workspace.id);
  service.action(actor,branch,{action:'create_draft',clientActionId:randomUUID(),baseRef:original});
  service.action(actor,branch,{action:'apply',clientActionId:randomUUID(),expectedRevision:1,operations:[{op:'update_object',objectId:'point-a',changes:{geometry:{type:'Point',coordinates:[104,2]}}}]});
  expect(service.compare(actor,taskId,original,draftRef(service,actor,branch)).changes.items).toEqual([{kind:'object',id:'point-a',change:'changed',fields:['geometry']}]);
  expect(service.version(actor,taskId,original).document.layers[0].features[0].geometry).toEqual(point().geometry);
});

it('resolves exact layer names in saved order before object filtering and pagination',async()=>{
  const {service,actor,session,taskId}=await setup();
  service.action(actor,session,{...initial(),operations:[
    {op:'add_layer',layer:{layerId:'opaque-a',name:'河岸巡查',order:0,defaultVisible:true,features:[point('a'),point('b'),point('c')]}},
    {op:'add_layer',layer:{layerId:'opaque-b',name:'外围',order:1,defaultVisible:true,features:[point('d')]}},
    {op:'add_layer',layer:{layerId:'empty',name:'空图层',order:2,defaultVisible:true,features:[]}},
  ]});
  const ref=draftRef(service,actor,session);
  const byName=service.read(actor,taskId,{ref,layerNames:['河岸巡查'],offset:1,limit:2,fields:['note']});
  expect(byName).toEqual(service.read(actor,taskId,{ref,layerIds:['opaque-a'],offset:1,limit:2,fields:['note']}));
  expect(byName.objects).toMatchObject({total:3,hasMore:false,items:[{objectId:'b',note:point().note},{objectId:'c',note:point().note}]});
  expect(byName.layers.map(layer=>layer.layerId)).toEqual(['opaque-a']);
  expect(service.read(actor,taskId,{ref,layerNames:['外围','河岸巡查']}).objects.items.map(item=>item.objectId)).toEqual(['a','b','c','d']);
  expect(service.read(actor,taskId,{ref,layerNames:['河岸巡查'],objectIds:['b']}).objects.total).toBe(1);
  expect(()=>service.read(actor,taskId,{ref,layerNames:['河岸巡查'],objectIds:['d']})).toThrow('无权访问');
  expect(service.read(actor,taskId,{ref,layerNames:['空图层']})).toMatchObject({layers:[{layerId:'empty'}],objects:{total:0,items:[]}});
});

it('rejects missing and ambiguous names without falling back, guessing, or partially returning objects',async()=>{
  const {service,actor,session,taskId}=await setup();
  service.action(actor,session,{...initial(),operations:[
    {op:'add_layer',layer:{layerId:'dock-a',name:'临时停靠',order:0,defaultVisible:true,features:[point('a')]}},
    {op:'add_layer',layer:{layerId:'dock-b',name:'临时停靠',order:1,defaultVisible:true,features:[point('b')]}},
    {op:'add_layer',layer:{layerId:'north',name:'North',order:2,defaultVisible:true,features:[point('c')]}},
  ]});
  const ref=draftRef(service,actor,session);
  expect(()=>service.read(actor,taskId,{ref,layerNames:['临时停靠']})).toThrow(expect.objectContaining({code:'ANNOTATION_LAYER_NAME_AMBIGUOUS',message:expect.stringContaining('["dock-a","dock-b"]')}));
  for(const names of [['不存在'],['临时'],['north'],[' North'],['North '],['North','不存在']]) {
    expect(()=>service.read(actor,taskId,{ref,layerNames:names})).toThrow(expect.objectContaining({code:'ANNOTATION_LAYER_NAME_NOT_FOUND'}));
  }
  expect(()=>service.read(actor,taskId,{ref,layerNames:['North','临时停靠']})).toThrow(expect.objectContaining({code:'ANNOTATION_LAYER_NAME_AMBIGUOUS'}));
  expect(service.read(actor,taskId,{ref,layerIds:['dock-b']}).objects.items.map(item=>item.objectId)).toEqual(['b']);
});

it('matches names inside the requested historical revision and publication after a layer is renamed',async()=>{
  const {service,actor,session,second,taskId}=await setup();service.action(actor,session,initial());
  const original=draftRef(service,actor,session);
  const published=service.action(actor,session,{action:'publish',clientActionId:randomUUID(),revision:1,title:'旧版'}).ref!;
  service.action(actor,session,{action:'apply',clientActionId:randomUUID(),expectedRevision:1,operations:[{op:'update_layer',layerId:'layer-a',changes:{name:'新名称'}}]});
  service.action(actor,second,initial());
  for(const ref of [original,published])expect(service.read(actor,taskId,{ref,layerNames:['集合点']}).layers).toMatchObject([{layerId:'layer-a',name:'集合点'}]);
  const latest=draftRef(service,actor,session);
  expect(()=>service.read(actor,taskId,{ref:latest,layerNames:['集合点']})).toThrow(expect.objectContaining({code:'ANNOTATION_LAYER_NAME_NOT_FOUND'}));
  expect(service.read(actor,taskId,{ref:latest,layerNames:['新名称']}).layers).toMatchObject([{layerId:'layer-a'}]);
});

it('authorizes the fixed snapshot before disclosing any name matches or candidate IDs',async()=>{
  const {service,actor,session,taskId,workspaces}=await setup();
  service.context=new ContextService({systems:[{id:'source',name:'范围',adapter:'mock-situation-http',baseUrl:'http://127.0.0.1:4401',tokenEnv:'TEST_QUERY'}],scopes:[{id:'scope',name:'范围',systemIds:['source'],seatIds:['a','b']}]},{TEST_QUERY:'test-only-token'});
  const input=initial();input.operations[0].layer.features[0].sourceRefs=[{systemId:'source',objectType:'resource',objectId:'object',revision:1}];
  input.operations.push({op:'add_layer',layer:{layerId:'secret-candidate',name:'集合点',order:1,defaultVisible:true,features:[]}});
  service.action(actor,session,input);const privateRef=draftRef(service,actor,session);
  const published=service.action(actor,session,{action:'publish',clientActionId:randomUUID(),revision:1,title:'共享'}).ref!;
  await workspaces.ensureWorkspace(taskId,'b','B');const b=service.actorForSeat('b');
  const otherTask=await workspaces.create('其他任务',randomUUID(),'a');
  for(const layerNames of [['集合点'],['不存在']]) {
    expect(()=>service.read(b,taskId,{ref:privateRef,layerNames})).toThrow(expect.objectContaining({code:'ANNOTATION_NOT_FOUND',message:'标注不存在或无权访问。'}));
    expect(()=>service.read(actor,otherTask.taskSpaceId!,{ref:privateRef,layerNames})).toThrow(expect.objectContaining({code:'ANNOTATION_NOT_FOUND'}));
  }
  service.context.config.scopes[0].seatIds=['a'];
  expect(()=>service.read(b,taskId,{ref:published,layerNames:['集合点']})).toThrow(expect.objectContaining({code:'ANNOTATION_NOT_FOUND',message:'标注不存在或无权访问。'}));
  for(const objectNames of [['point-a'],['不存在']])expect(()=>service.read(b,taskId,{ref:published,objectNames})).toThrow(expect.objectContaining({code:'ANNOTATION_NOT_FOUND',message:'标注不存在或无权访问。'}));
});

it('validates name selectors without normalizing them or extending composer references',()=>{
  const ref={setId:randomUUID(),revision:1};
  for(const layerNames of [[],[''],['  '],['x'.repeat(121)],['x','x'],[1],Array.from({length:33},(_,index)=>String(index))])expect(()=>validation.readInput({ref,layerNames})).toThrow();
  expect(()=>validation.readInput({ref,layerNames:['集合点'],layerIds:['layer-a']})).toThrow('只能指定一种');
  expect(validation.readInput({ref,layerNames:[' 集合点 '],objectIds:['a']})).toMatchObject({layerNames:[' 集合点 '],objectIds:['a']});
  expect(()=>validation.selection({...ref,layerNames:['集合点']})).toThrow();
});

it('does not equate independently created object IDs in branches of the same fixed baseline',async()=>{
  const {service,actor,session,second,taskId,workspace,workspaces}=await setup();
  service.action(actor,session,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,operations:[{op:'add_layer',layer:{layerId:'layer-a',name:'空基线',order:0,defaultVisible:true,features:[]}}]});
  const baseline=draftRef(service,actor,session),third=randomUUID();await workspaces.bind(third,workspace.id);
  for(const branch of [second,third])service.action(actor,branch,{action:'create_draft',clientActionId:randomUUID(),baseRef:baseline,operations:[{op:'add_object',layerId:'layer-a',feature:{...point('point-a'),geometry:{type:'Point',coordinates:branch===second ? [103,1] : [104,2]}}}]});
  expect(service.compare(actor,taskId,draftRef(service,actor,second),draftRef(service,actor,third)).changes.items).toEqual([
    {kind:'object',id:'point-a',change:'removed',fields:[]},{kind:'object',id:'point-a',change:'added',fields:[]},
  ]);
  service.action(actor,session,{action:'apply',clientActionId:randomUUID(),expectedRevision:1,operations:[{op:'add_object',layerId:'layer-a',feature:point('point-a')}]});
  expect(service.compare(actor,taskId,draftRef(service,actor,second),draftRef(service,actor,session)).counts).toEqual({added:1,removed:1,changed:0});
});

it('inherits source restrictions through deletion, publication and derivation without exposing private ancestry',async()=>{
  const {service,actor,session,second,taskId,workspaces}=await setup();
  service.context=new ContextService({systems:[{id:'source',name:'范围',adapter:'mock-situation-http',baseUrl:'http://127.0.0.1:4401',tokenEnv:'TEST_QUERY'}],scopes:[{id:'scope',name:'范围',systemIds:['source'],seatIds:['a','b']}]},{TEST_QUERY:'test-only-token'});
  const input=initial(); input.operations[0].layer.features[0].sourceRefs=[{systemId:'source',objectType:'resource',objectId:'source-object',revision:1}];
  service.action(actor,session,input);const original=draftRef(service,actor,session);
  service.action(actor,second,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,operations:[{op:'add_layer',layer:{layerId:'copy-layer',name:'复制',order:0,defaultVisible:true,features:[]}},{op:'copy_object',source:original,objectId:'point-a',newObjectId:'copied',layerId:'copy-layer'}]});
  const published=service.action(actor,second,{action:'publish',clientActionId:randomUUID(),revision:1,title:'共享'}).publication!;
  const wb=await workspaces.ensureWorkspace(taskId,'b','B');const sb=randomUUID();await workspaces.bind(sb,wb.id,'b');const b=service.actorForSeat('b');
  const shared=service.publishedVersion(b,published.publicationId);expect(shared.hash).toBe(published.hash);expect(shared.document.layers[0].features[0].originFeatureRef).toBeUndefined();
  service.action(b,sb,{action:'create_draft',clientActionId:randomUUID(),baseRef:{publicationId:published.publicationId}});
  const branch=draftRef(service,b,sb);expect(service.version(b,taskId,branch).document.layers[0].features[0].originFeatureRef).toBeUndefined();
  service.action(b,sb,{action:'apply',clientActionId:randomUUID(),expectedRevision:1,operations:[{op:'delete_object',objectId:'copied'}]});
  const receipt=service.action(b,sb,{action:'publish',clientActionId:randomUUID(),revision:2,title:'空图也保留范围'});
  service.context.config.scopes[0].seatIds=['a'];
  expect(()=>service.version(b,taskId,branch)).toThrow('无权访问');expect(()=>service.receipt(b,receipt.clientActionId)).toThrow('无权访问');
  expect(service.list(b,taskId).publications.total).toBe(0);expect(service.list(b,taskId).drafts.total).toBe(0);
});

it('checks captured identity at each action and does not manufacture state after cancellation',async()=>{
  const {service,actor,session,db}=await setup();const controller=new AbortController();controller.abort();
  expect(()=>service.action(actor,session,initial(),controller.signal)).toThrow();expect(service.binding(actor,session).draft).toBeNull();
  expect(db.prepare('SELECT count(*) n FROM annotation_actions').get()?.n).toBe(0);
  expect(()=>service.action({...actor,userId:'different'},session,initial())).toThrow();
});

it.each([1,7,8])('migrates v%i once and keeps Access/Background constructors from downgrading',async version=>{
  const {db}=await setup();
  // setup created the anonymous schema; reset only this empty fixture's annotation tables.
  for(const name of [...annotationTables].reverse()) db.exec(`DROP TABLE ${name}`);
  if(version>=7) {new AccessStore(db);if(version===8)new BackgroundStore(db);}
  new AnnotationStore(db);expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(version===1 ? 1 : version===7 ? 9 : 10);
  new AnnotationStore(db);
  if(version>=7) {new AccessStore(db);new BackgroundStore(db);expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(10);new AccessStore(db);expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(10);}
  db.exec('DROP TABLE annotation_actions');expect(()=>new AnnotationStore(db)).toThrow('状态');
  if(version>=7) expect(()=>new AccessStore(db)).toThrow('状态');
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name='annotation_actions'").get()).toBeUndefined();
});

it('rejects unknown authority fields, invalid geometry and unsupported holes; validates a large valid ring promptly',()=>{
  expect(()=>validation.action({...initial(),seatId:'foreign'})).toThrow();
  expect(()=>validation.document({schemaVersion:1,title:'x',layers:[{layerId:'x',name:'x',order:0,defaultVisible:true,features:[{...point(),kind:'polygon',geometry:{type:'Polygon',coordinates:[[[0,0],[1,1],[1,0],[0,1],[0,0]]]}}]}]})).toThrow();
  expect(()=>validation.feature({...point(),kind:'polygon',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]],[[0.1,0.1],[0.2,0.1],[0.2,0.2],[0.1,0.1]]]}})).toThrow();
  expect(()=>validation.feature({...point(),geometry:{type:'Point',coordinates:[Infinity,0]}})).toThrow();
  const ring=Array.from({length:19999},(_,i)=>[Math.cos(i/19999*2*Math.PI),Math.sin(i/19999*2*Math.PI)]);ring.push(ring[0]);
  const start=performance.now();validation.feature({...point(),kind:'polygon',geometry:{type:'Polygon',coordinates:[ring]}});
  expect(performance.now()-start).toBeLessThan(2000);
});

it('deduplicates a repeated publication of the same revision and permits explicit publication names',async()=>{
  const {service,actor,session,taskId}=await setup();service.action(actor,session,initial());
  const a=service.action(actor,session,{action:'publish',clientActionId:randomUUID(),revision:1,title:'固定发布名称'});
  const b=service.action(actor,session,{action:'publish',clientActionId:randomUUID(),revision:1,title:'固定发布名称'});
  expect(a.publication).toEqual(b.publication);expect(a.clientActionId).not.toBe(b.clientActionId);
  expect(service.list(actor,taskId).publications.total).toBe(1);
  expect(service.version(actor,taskId,a.ref!).title).toBe('固定发布名称');
  expect(service.version(actor,taskId,a.ref!).document.title).toBe('标注');
});

it('rejects malformed update source references before inspecting scope and leaves the revision unchanged',async()=>{
  const {service,actor,session}=await setup();service.action(actor,session,initial());
  for(const sourceRefs of [{systemId:'source'},[null],['source']]) {
    const input=JSON.parse(JSON.stringify({action:'apply',clientActionId:randomUUID(),expectedRevision:1,operations:[{op:'update_object',objectId:'point-a',changes:{sourceRefs}}]}));
    expect(()=>service.action(actor,session,input)).toThrowError(expect.objectContaining({code:'INVALID_INPUT',statusCode:400}));
    expect(service.binding(actor,session).draft?.headRevision).toBe(1);
    expect(service.receipt(actor,input.clientActionId)).toBeNull();
  }
});

it('returns all exact object-name matches in document order with layer intersection and pagination',async()=>{
  const {service,actor,session,taskId}=await setup();
  service.action(actor,session,{...initial(),operations:[
    {op:'add_layer',layer:{layerId:'reference',name:'参照',order:0,defaultVisible:true,features:[{...point('base-a'),name:'基点'},{...point('base-b'),name:'基点'},point('North')]}},
    {op:'add_layer',layer:{layerId:'resources',name:'资源',order:1,defaultVisible:true,features:[{...point('base-c'),name:'基点'},point('target')]}},
  ]});
  const ref=draftRef(service,actor,session),before=service.version(actor,taskId,ref);
  const all=service.read(actor,taskId,{ref,objectNames:['基点','target'],limit:2});
  expect(all.ref).toEqual(ref);expect(all.objects).toMatchObject({total:4,offset:0,limit:2,hasMore:true,items:[{objectId:'base-a',name:'基点',layerId:'reference'},{objectId:'base-b',name:'基点',layerId:'reference'}]});
  expect(all.layers.map(layer=>layer.layerId)).toEqual(['reference','resources']);
  expect(all.objects.items.every(item=>!('geometry' in item) && !('note' in item))).toBe(true);
  const next=service.read(actor,taskId,{ref,objectNames:['target','基点'],offset:2,limit:2,fields:['geometry']});
  expect(next.objects).toMatchObject({total:4,hasMore:false,items:[{objectId:'base-c',geometry:point().geometry},{objectId:'target',geometry:point().geometry}]});
  const selected=service.read(actor,taskId,{ref,layerNames:['资源'],objectNames:['基点']});
  expect(selected.objects).toMatchObject({total:1,items:[{objectId:'base-c',layerId:'resources'}]});
  expect(selected).toEqual(service.read(actor,taskId,{ref,layerIds:['resources'],objectNames:['基点']}));
  expect(service.read(actor,taskId,{ref,objectNames:['基点','absent']}).objects.total).toBe(3);
  for(const objectNames of [['north'],[' North'],['North '],['基'],['absent']])expect(service.read(actor,taskId,{ref,objectNames})).toMatchObject({layers:[],objects:{total:0,items:[],hasMore:false}});
  expect(service.read(actor,taskId,{ref,layerIds:['reference'],objectNames:['target']}).objects.total).toBe(0);
  expect(service.read(actor,taskId,{ref,objectNames:['基点'],offset:99}).objects).toMatchObject({total:3,items:[],hasMore:false});
  expect(service.version(actor,taskId,ref)).toEqual(before);
  expect(service.binding(actor,session).draft?.headRevision).toBe(1);
});

it('pins object-name searches to the authorized revision or publication without changing ID-based reads',async()=>{
  const {service,actor,session,taskId,workspaces}=await setup();service.action(actor,session,initial());
  const original=draftRef(service,actor,session),published=service.action(actor,session,{action:'publish',clientActionId:randomUUID(),revision:1,title:'固定名称'}).ref!;
  service.action(actor,session,{action:'apply',clientActionId:randomUUID(),expectedRevision:1,operations:[{op:'update_object',objectId:'point-a',changes:{name:'改名后'}}]});
  const latest=draftRef(service,actor,session);
  for(const ref of [original,published])expect(service.read(actor,taskId,{ref,objectNames:['point-a']}).objects).toMatchObject({total:1,items:[{objectId:'point-a',name:'point-a'}]});
  expect(service.read(actor,taskId,{ref:latest,objectNames:['point-a']}).objects.total).toBe(0);
  expect(service.read(actor,taskId,{ref:latest,objectNames:['改名后']})).toEqual(service.read(actor,taskId,{ref:latest,objectIds:['point-a']}));
  await workspaces.ensureWorkspace(taskId,'b','B');const b=service.actorForSeat('b'),otherTask=await workspaces.create('其他任务',randomUUID(),'a');
  for(const objectNames of [['point-a'],['absent']]){
    expect(()=>service.read(b,taskId,{ref:original,objectNames})).toThrow(expect.objectContaining({code:'ANNOTATION_NOT_FOUND',message:'标注不存在或无权访问。'}));
    expect(()=>service.read(actor,otherTask.taskSpaceId!,{ref:original,objectNames})).toThrow(expect.objectContaining({code:'ANNOTATION_NOT_FOUND'}));
  }
});

it('validates bounded exact object names independently of layer selectors and composer references',()=>{
  const ref={setId:randomUUID(),revision:1};
  for(const objectNames of [[],[''],['  '],['x'.repeat(121)],['x','x'],[1],null,'name',Array.from({length:33},(_,index)=>String(index))])expect(()=>validation.readInput({ref,objectNames})).toThrow();
  expect(()=>validation.readInput({ref,objectNames:['基点'],objectIds:['a']})).toThrow('只能指定一种');
  expect(()=>validation.readInput({ref,objectNames:['基点'],layerIds:['a'],layerNames:['图层']})).toThrow('只能指定一种');
  const objectNames=[' 基点 '];const input=validation.readInput({ref,objectNames,layerIds:['a']});
  expect(input).toMatchObject({objectNames:[' 基点 '],layerIds:['a']});expect(input.objectNames).not.toBe(objectNames);
  expect(validation.readInput({ref,objectNames:Array.from({length:32},(_,index)=>String(index))}).objectNames).toHaveLength(32);
  expect(()=>validation.selection({...ref,objectNames:['基点']})).toThrow();
});
