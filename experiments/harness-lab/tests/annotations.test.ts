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
