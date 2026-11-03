import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { validateToolArguments } from '@earendil-works/pi-ai';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { AnnotationService } from '../src/annotations/service.js';
import { ContextService } from '../src/context/service.js';
import type { AnnotationFromSourceInput, AnnotationRef } from '../src/contracts/annotations.js';
import type { SituationCurrent, SituationObject } from '../src/contracts/context.js';
import { annotationTools } from '../src/pi/annotation-tools.js';
import { AnnotationRequestState } from '../src/pi/annotation-state.js';
import { WorkspaceStore } from '../src/workspaces/store.js';

const clean: Array<()=>void|Promise<unknown>>=[];
afterEach(async()=>{vi.useRealTimers();for(const close of clean.splice(0).reverse())await close();});
const sourceRef={systemId:'source',objectType:'area',objectId:'area-west'};
const source=(): SituationObject=>({ref:sourceRef,name:'西区',revision:2,areaIds:['west'],effectiveAt:'2026-10-01T09:20:00+08:00',validTime:null,
  properties:{memberRefs:[]},geometry:{type:'Polygon',coordinates:[[[103,1],[104,1],[104,2],[103,2],[103,1]]]}});
const input=(): AnnotationFromSourceInput=>({clientActionId:randomUUID(),mode:'add',sourceRef,expectedSourceRevision:2,expectedRevision:1,layerId:'places',objectId:'west'});
async function setup(formal=false) {
  const dir=await mkdtemp(join(tmpdir(),'annotation-source-'));clean.push(()=>rm(dir,{recursive:true,force:true}));
  const db=await openDatabase(dir);clean.push(()=>db.close());
  const access=formal ? new AccessStore(db) : undefined;
  if(access)await access.saveAccount({username:'original',displayName:'原账号',seatId:'a',seatName:'甲',password:'source-test-password',createPublicTask:true,manageModelSettings:false});
  const workspaces=await WorkspaceStore.open(dir,'a',formal);workspaces.access=access;
  const task=access?.create(access.identityForSeat('a')!,{clientActionId:randomUUID(),title:'来源标注验证',goal:'核对来源',visibility:'public'});
  const workspace=task ? await workspaces.ensureWorkspace(task.id,'a',task.title) : workspaces.get();
  const session=randomUUID(),second=randomUUID();await workspaces.bind(session,workspace.id);await workspaces.bind(second,workspace.id);
  const response: {items:SituationObject[];status:number;hasMore:boolean;before?:()=>void|Promise<void>}={items:[source()],status:200,hasMore:false};
  const fetch=vi.fn<typeof globalThis.fetch>(async()=>{
    await response.before?.();
    const body: SituationCurrent={systemId:'source',asOf:'2026-10-01T09:20:00+08:00',items:response.items,limit:20,nextCursor:response.hasMore ? 'next' : null,
      hasMore:response.hasMore,timeUnknownCount:0,unknownRefs:response.items.length ? [] : [sourceRef],changeCursor:'change-2'};
    return new Response(JSON.stringify(response.status===200 ? body : {error:{code:'UNAVAILABLE'}}),{status:response.status,headers:{'content-type':'application/json'}});
  });
  const context=new ContextService({systems:[{id:'source',name:'模拟态势',adapter:'mock-situation-http',baseUrl:'http://127.0.0.1:4401',tokenEnv:'SOURCE_TEST_TOKEN'}],
    scopes:[{id:'scope',name:'范围',systemIds:['source'],seatIds:['a']}]},{SOURCE_TEST_TOKEN:'synthetic-token'},{fetch});
  const service=new AnnotationService(db,workspaces,access,context),actor=service.actorForSeat('a');
  service.action(actor,session,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,operations:[{op:'add_layer',layer:{layerId:'places',name:'位置',order:0,defaultVisible:true,features:[]}}]});
  const head=()=>{const draft=service.binding(actor,session).draft!;return {setId:draft.setId,revision:draft.headRevision};};
  const objects=(ref:AnnotationRef=head())=>service.version(actor,workspace.taskSpaceId!,ref).document.layers[0].features;
  return {db,dir,access,workspaces,workspace,task,session,second,service,actor,context,response,fetch,head,objects};
}

it('copies exact geometry and host UTC query time, persists a bounded receipt, and replays without another source query',async()=>{
  const {service,actor,session,context,fetch,objects,head,db,workspaces}=await setup();
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-14T10:37:05.660Z'));
  const request=input(),receipt=await service.fromSource(actor,session,request);
  expect(objects()).toEqual([{objectId:'west',kind:'polygon',name:'西区',geometry:source().geometry,sourceRefs:[{...sourceRef,revision:2,queriedAt:'2026-10-14T10:37:05.660Z'}]}]);
  expect(receipt.fromSource).toEqual({mode:'add',layerId:'places',objectId:'west',sourceRef,sourceRevision:2,queriedAt:'2026-10-14T10:37:05.660Z',effectiveAt:source().effectiveAt,validTime:null});
  expect(JSON.stringify(receipt)).not.toContain('coordinates');expect(receipt.action).toBe('from_source');expect(head().revision).toBe(2);
  const url=new URL(String(fetch.mock.calls[0][0]));expect(url.pathname).toBe('/objects');expect(JSON.parse(url.searchParams.get('objectRefs')!)).toEqual([sourceRef]);
  expect(url.searchParams.has('areaIds')).toBe(false);
  vi.setSystemTime(new Date('2026-10-14T18:00:00Z'));
  // Reopen the service over persisted tables; no memory receipt cache is involved.
  const reopened=new AnnotationService(db,workspaces,undefined,context);
  expect(await reopened.fromSource(actor,session,request)).toEqual(receipt);expect(fetch).toHaveBeenCalledTimes(1);
  await expect(reopened.fromSource(actor,session,{...request,objectId:'different'})).rejects.toThrow('不同内容');
  expect(fetch).toHaveBeenCalledTimes(1);expect(head().revision).toBe(2);
});

it('refreshes one source geometry in place while preserving identity, business fields, other references and fixed versions',async()=>{
  const {service,actor,session,response,objects,head}=await setup();
  await service.fromSource(actor,session,input());
  service.action(actor,session,{action:'apply',clientActionId:randomUUID(),expectedRevision:2,operations:[{op:'update_object',objectId:'west',changes:{name:'讨论区域',note:'待核对说明',attributes:{priority:1},style:{color:'#aabbcc'},sourceRefs:[
    {...sourceRef,revision:2,queriedAt:'2026-10-14T10:00:00Z'},{...sourceRef,objectId:'related',revision:1},
  ]}}]});
  const old=head(),before=objects()[0],publication=service.action(actor,session,{action:'publish',clientActionId:randomUUID(),revision:3,title:'原版'}).ref!;
  response.items=[{...source(),revision:3,geometry:{type:'Polygon',coordinates:[[[103,1],[105,1],[105,2],[103,2],[103,1]]]}}];
  await service.fromSource(actor,session,{...input(),mode:'refresh',expectedRevision:3,expectedSourceRevision:3});
  expect(objects()[0]).toEqual({...before,geometry:response.items[0].geometry,sourceRefs:[{...sourceRef,revision:3,queriedAt:expect.any(String)},before.sourceRefs![1]]});
  expect(objects(old)[0]).toEqual(before);expect(objects(publication)[0]).toEqual(before);
  expect(head().revision).toBe(4);
});

it.each(['revision','missing','offline','invalid-ring','holes','duplicate','partial'] as const)('rejects %s source without committing a draft or receipt',async condition=>{
  const {service,actor,session,response,head,db}=await setup();const request=input();
  if(condition==='revision')response.items[0].revision=3;
  if(condition==='missing')response.items[0].geometry=null;
  if(condition==='offline')response.status=503;
  if(condition==='invalid-ring')response.items[0].geometry={type:'Polygon',coordinates:[[[0,0],[1,1],[1,0],[0,1],[0,0]]]};
  if(condition==='holes')response.items[0].geometry={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]],[[0.1,0.1],[0.2,0.1],[0.2,0.2],[0.1,0.1]]]};
  if(condition==='duplicate')response.items.push(source());
  if(condition==='partial')response.hasMore=true;
  await expect(service.fromSource(actor,session,request)).rejects.toThrow();
  expect(head().revision).toBe(1);expect(service.receipt(actor,request.clientActionId)).toBeNull();
  expect(db.prepare('SELECT count(*) n FROM annotation_revisions').get()?.n).toBe(1);
});

it('does not infer a missing object from other returned geometry or create a draft implicitly',async()=>{
  const {service,actor,session,second,response,fetch,head}=await setup();
  await expect(service.fromSource(actor,second,input())).rejects.toThrow('不存在');expect(fetch).not.toHaveBeenCalled();
  response.items=[];await expect(service.fromSource(actor,session,input())).rejects.toMatchObject({code:'ANNOTATION_SOURCE_NOT_FOUND'});
  response.items=[{...source(),ref:{...sourceRef,objectId:'elsewhere'}}];
  await expect(service.fromSource(actor,session,input())).rejects.toMatchObject({code:'ANNOTATION_SOURCE_NOT_FOUND'});
  expect(head().revision).toBe(1);
});

it.each(['wrong-source','duplicates','wrong-kind','wrong-layer'] as const)('rejects refresh with %s rather than replacing a different logical object',async condition=>{
  const {service,actor,session,head}=await setup();
  service.action(actor,session,{action:'apply',clientActionId:randomUUID(),expectedRevision:1,operations:[{op:'add_object',layerId:'places',feature:{objectId:'west',kind:condition==='wrong-kind' ? 'point' : 'polygon',name:'已有标注',
    geometry:condition==='wrong-kind' ? {type:'Point',coordinates:[103,1]} : source().geometry!,sourceRefs:condition==='wrong-source' ? [{...sourceRef,objectId:'other',revision:2}] : condition==='duplicates' ? [{...sourceRef,revision:1},{...sourceRef,revision:2}] : [{...sourceRef,revision:2}]}}]});
  await expect(service.fromSource(actor,session,{...input(),mode:'refresh',expectedRevision:2,...(condition==='wrong-layer' ? {layerId:'elsewhere'} : {})})).rejects.toThrow();
  expect(head().revision).toBe(2);
});

it('keeps concurrent manual changes and rejects stale source writes after the HTTP wait',async()=>{
  const {service,actor,session,response,head,objects}=await setup();const request=input();
  response.before=()=>{service.action(actor,session,{action:'apply',clientActionId:randomUUID(),expectedRevision:1,operations:[{op:'rename_set',title:'人工修改'}]});};
  await expect(service.fromSource(actor,session,request)).rejects.toMatchObject({code:'ANNOTATION_CONFLICT'});
  expect(head().revision).toBe(2);expect(objects()).toEqual([]);expect(service.receipt(actor,request.clientActionId)).toBeNull();
});

it.each(['cancel','scope','request'] as const)('rechecks %s after awaiting source data and does not write',async condition=>{
  const {service,actor,session,response,context,head,db}=await setup();const controller=new AbortController(),request=input();let active=true;
  response.before=()=>{if(condition==='cancel')controller.abort();if(condition==='scope')context.config.scopes[0].seatIds=[];if(condition==='request')active=false;};
  const check=()=>{if(!active)throw new Error('请求已失效');};
  await expect(service.fromSource(actor,session,request,controller.signal,check)).rejects.toThrow();
  expect(head().revision).toBe(1);expect(db.prepare('SELECT 1 FROM annotation_actions WHERE action_id=?').get(request.clientActionId)).toBeUndefined();
});

it('denies source access before fetch and rechecks source grants for an old receipt',async()=>{
  const {service,actor,session,context,fetch}=await setup();
  context.config.scopes[0].seatIds=[];
  await expect(service.fromSource(actor,session,input())).rejects.toThrow('无权访问');expect(fetch).not.toHaveBeenCalled();
  context.config.scopes[0].seatIds=['a'];const request=input();await service.fromSource(actor,session,request);
  context.config.scopes[0].seatIds=[];await expect(service.fromSource(actor,session,request)).rejects.toThrow('无权访问');expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps the captured account and refuses a disabled account even if a new account occupies its seat',async()=>{
  const {service,actor,session,access,response,db}=await setup(true);const request=input();
  response.before=async()=>{access!.disable('original');await access!.saveAccount({username:'replacement',displayName:'接替账号',seatId:'a',seatName:'甲',password:'source-test-password',createPublicTask:true,manageModelSettings:false});};
  await expect(service.fromSource(actor,session,request)).rejects.toMatchObject({code:'AUTH_REQUIRED'});
  expect(access!.identityForSeat('a')?.userId).not.toBe(actor.userId);
  expect(db.prepare('SELECT count(*) n FROM annotation_revisions').get()?.n).toBe(1);
  expect(db.prepare('SELECT 1 FROM annotation_actions WHERE action_id=?').get(request.clientActionId)).toBeUndefined();
});

it('does not return a different task receipt through the scoped tool and rejects injected authority/coordinates',async()=>{
  const {service,actor,session,workspace,workspaces,fetch,context}=await setup();
  const state=new AnnotationRequestState();
  const scope={actor,sessionId:session,taskId:workspace.taskSpaceId!,requestId:randomUUID(),signal:new AbortController().signal,check:()=>{},state};
  const tool=annotationTools(service,scope).find(item=>item.name==='annotation_from_source')!;
  const {clientActionId: _unused,expectedRevision: _draft,expectedSourceRevision: _source,...item}=input();void _unused;void _draft;void _source;const params={items:[item]};
  for(const extra of [{geometry:source().geometry},{queriedAt:'2026-01-01T00:00:00Z'},{seatId:'foreign'},{sessionId:randomUUID()}]) {
    expect(()=>validateToolArguments(tool,{type:'toolCall',id:'bad',name:tool.name,arguments:{...params,...extra}})).toThrow();
    await expect(service.fromSource(actor,session,{...input(),...extra})).rejects.toMatchObject({code:'INVALID_INPUT'});
  }
  expect(fetch).not.toHaveBeenCalled();
  state.observeDraft(service.binding(actor,session));
  state.observeSources(await context.query('situation_query',{systemId:sourceRef.systemId,mode:'current',objectRefs:[sourceRef]},{kind:'seat',seatId:actor.seatId}));
  state.beginInference();
  await tool.execute('source-call',params,undefined,undefined,{} as never);
  const other=await workspaces.create('另一任务'),otherSession=randomUUID();await workspaces.bind(otherSession,other.id);
  const read=annotationTools(service,{...scope,taskId:other.taskSpaceId!,sessionId:otherSession}).find(item=>item.name==='annotation_read')!;
  await expect(read.execute('receipt',{mode:'receipt',requestId:scope.requestId,toolCallId:'source-call'} as never,undefined,undefined,{} as never)).rejects.toThrow('无权访问');
});

it('returns one durable effect for simultaneous identical calls despite different host query times',async()=>{
  const {service,actor,session,response,head,db,fetch}=await setup();const request=input();
  const gates=Array.from({length:2},()=>{let resolve!: ()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};});let index=0;
  response.before=()=>gates[index++].promise;
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-14T10:00:00Z'));
  const a=service.fromSource(actor,session,request),b=service.fromSource(actor,session,request);
  gates[0].resolve();const saved=await a;
  vi.setSystemTime(new Date('2026-10-14T11:00:00Z'));gates[1].resolve();expect(await b).toEqual(saved);
  expect(fetch).toHaveBeenCalledTimes(2);expect(head().revision).toBe(2);
  expect(db.prepare('SELECT count(*) n FROM annotation_actions WHERE action_id=?').get(request.clientActionId)?.n).toBe(1);
});

it('refuses a task archived during the source wait and blocks already archived tasks before any fetch',async()=>{
  const {service,actor,session,access,task,response,db,fetch}=await setup(true);const request=input();
  response.before=()=>{access!.update(access!.identity(actor.userId)!,task!.id,1,{state:'archived'});};
  await expect(service.fromSource(actor,session,request)).rejects.toMatchObject({code:'TASK_ARCHIVED'});
  expect(db.prepare('SELECT count(*) n FROM annotation_revisions').get()?.n).toBe(1);
  expect(db.prepare('SELECT 1 FROM annotation_actions WHERE action_id=?').get(request.clientActionId)).toBeUndefined();
  await expect(service.fromSource(actor,session,input())).rejects.toMatchObject({code:'TASK_ARCHIVED'});expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps same-seat conversations isolated when another draft is referenced or its object id is reused',async()=>{
  const {service,actor,session,second,fetch,head,objects}=await setup();
  await service.fromSource(actor,session,input());
  const ref=head();service.action(actor,second,{action:'create_draft',clientActionId:randomUUID(),baseRef:ref});
  const secondInput={...input(),mode:'refresh' as const};
  await service.fromSource(actor,second,secondInput);
  expect(head()).toEqual(ref);expect(objects()[0].sourceRefs![0].revision).toBe(2);
  expect(service.binding(actor,second).draft!.setId).not.toBe(ref.setId);
  const before=fetch.mock.calls.length;
  await expect(service.fromSource({...actor,seatId:'b'},session,input())).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(before);
});

it('atomically imports a host batch and replays original intent after state and source revisions advance',async()=>{
  const {service,actor,session,head,objects,response,fetch,db,workspaces,context}=await setup();
  const basis=head(),single=input();
  const {clientActionId,expectedRevision,...item}=single;
  const request={clientActionId,expectedRevision,items:[item,{...item,objectId:'east'}]};
  const result=await service.fromSourcesFromHost(actor,session,request,basis);
  expect(result.replayed).toBe(false);expect(head().revision).toBe(2);expect(objects()).toHaveLength(2);
  expect(result.receipt).toMatchObject({action:'from_source',beforeRef:basis,afterRef:head(),objectIds:['west','east'],fromSources:[{objectId:'west',sourceRevision:2},{objectId:'east',sourceRevision:2}]});
  expect(result.receipt.fromSource).toBeUndefined();expect(JSON.stringify(result.receipt)).not.toContain('coordinates');
  response.items[0].revision=3;
  service.action(actor,session,{action:'apply',clientActionId:randomUUID(),expectedRevision:2,operations:[{op:'rename_set',title:'人工后续修改'}]});
  const reopened=new AnnotationService(db,workspaces,undefined,context);
  expect(await reopened.fromSourcesFromHost(actor,session,{...request,expectedRevision:3,items:request.items.map(item=>({...item,expectedSourceRevision:3}))},head())).toEqual({receipt:result.receipt,replayed:true});
  expect(fetch).toHaveBeenCalledTimes(2);expect(head().revision).toBe(3);
  await expect(reopened.fromSourcesFromHost(actor,session,{...request,items:[item,{...item,objectId:'changed'}]},head())).rejects.toThrow('不同内容');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each(['missing','offline','revision','cancel','revoke','concurrent'] as const)('keeps the entire source batch unchanged when the second item encounters %s',async condition=>{
  const {service,actor,session,head,objects,response,context,db}=await setup();
  const single=input(),{clientActionId,expectedRevision,...item}=single,basis=head(),controller=new AbortController();let calls=0;
  response.before=()=>{
    if(++calls!==2)return;
    if(condition==='missing')response.items[0].geometry=null;
    if(condition==='offline')response.status=503;
    if(condition==='revision')response.items[0].revision=3;
    if(condition==='cancel')controller.abort();
    if(condition==='revoke')context.config.scopes[0].seatIds=[];
    if(condition==='concurrent')service.action(actor,session,{action:'apply',clientActionId:randomUUID(),expectedRevision:1,operations:[{op:'rename_set',title:'人工编辑'}]});
  };
  const promise=service.fromSourcesFromHost(actor,session,{clientActionId,expectedRevision,items:[item,{...item,objectId:'east'}]},basis,controller.signal);
  if(['missing','offline','revision','revoke'].includes(condition))await expect(promise).rejects.toMatchObject({itemIndex:1});else await expect(promise).rejects.toThrow();
  expect(db.prepare('SELECT count(*) n FROM annotation_revisions').get()?.n).toBe(condition==='concurrent' ? 2 : 1);
  expect(db.prepare('SELECT 1 FROM annotation_actions WHERE action_id=?').get(clientActionId)).toBeUndefined();
  context.config.scopes[0].seatIds=['a'];expect(objects()).toEqual([]);
});

it('rejects invalid batch targets and unknown authority before any source request',async()=>{
  const {service,actor,session,head,fetch}=await setup();const {clientActionId,expectedRevision,...item}=input();
  for(const items of [[],Array.from({length:21},(_,index)=>({...item,objectId:`o${index}`})),[item,item],[item,{...item,objectId:'other',layerId:'unknown'}],[{...item,geometry:source().geometry}]]) {
    await expect(service.fromSourcesFromHost(actor,session,{clientActionId,expectedRevision,items},head())).rejects.toThrow();
  }
  await expect(service.fromSourcesFromHost(actor,session,{clientActionId,expectedRevision,items:[item]}, {setId:randomUUID(),revision:1})).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();expect(head().revision).toBe(1);
});

it('reports fresh versus concurrent replay accurately without double committing a source batch',async()=>{
  const {service,actor,session,response,head}=await setup();const {clientActionId,expectedRevision,...item}=input();
  const gates=Array.from({length:2},()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};});let count=0;
  response.before=()=>gates[count++].promise;
  const request={clientActionId,expectedRevision,items:[item]},basis=head();
  const a=service.fromSourcesFromHost(actor,session,request,basis),b=service.fromSourcesFromHost(actor,session,request,basis);
  gates[0].resolve();const first=await a;gates[1].resolve();const second=await b;
  expect(first.replayed).toBe(false);expect(second).toEqual({receipt:first.receipt,replayed:true});expect(head().revision).toBe(2);
});

it('creates from a fixed baseline without empty-read authority and isolates host replay by session and intent',async()=>{
  const {service,actor,session,second,head}=await setup();
  const create={action:'create_draft' as const,clientActionId:randomUUID(),baseRef:null,title:'新草稿'};
  service.setBase(actor,second,{clientActionId:randomUUID(),expectedBindingRevision:0,baseRef:head()});
  expect(()=>service.actionFromHost(actor,second,create)).toThrow('不一致');
  const binding=service.binding(actor,second),basis={bindingRevision:binding.bindingRevision,baseRef:binding.baseRef};
  const actual={...create,baseRef:binding.baseRef};const first=service.actionFromHost(actor,second,actual,basis);
  expect(first.replayed).toBe(false);expect(first.receipt.beforeRef).toBeNull();expect(first.receipt.afterRef?.revision).toBe(1);
  expect(service.actionFromHost(actor,second,actual)).toEqual({receipt:first.receipt,replayed:true});
  expect(()=>service.hostReplay(actor,session,actual)).toThrow('不同内容');
  expect(()=>service.hostReplay(actor,second,{...actual,title:'篡改意图'})).toThrow('不同内容');
});

it('keeps ordinary host writes bound to prior read versions while replay ignores advanced mechanical state',async()=>{
  const {service,actor,session,head}=await setup();
  const basis=head(),intent={action:'apply' as const,clientActionId:randomUUID(),operations:[{op:'rename_set' as const,title:'讨论标注'}]};
  const first=service.actionFromHost(actor,session,{...intent,expectedRevision:1},basis);
  expect(first.receipt).toMatchObject({beforeRef:basis,afterRef:head(),objectIds:[]});
  expect(service.hostReplay(actor,session,intent)).toEqual({receipt:first.receipt,replayed:true});
  expect(service.actionFromHost(actor,session,{...intent,expectedRevision:2},head())).toEqual({receipt:first.receipt,replayed:true});
  expect(()=>service.actionFromHost(actor,session,{...intent,clientActionId:randomUUID(),expectedRevision:1},basis)).toThrow('新修订');
  expect(()=>service.action(actor,session,{...intent,expectedRevision:2})).toThrow('不同内容');
  expect(()=>service.action(actor,session,{...intent,clientActionId:randomUUID(),expectedRevision:2,hostIntent:intent} as never)).toThrow('输入无效');
  const published=service.actionFromHost(actor,session,{action:'publish',clientActionId:randomUUID(),revision:1,title:'选择旧保存版'});
  expect(published.receipt.action).toBe('publish');expect(service.version(actor,service.binding(actor,session).taskId,published.receipt.ref!).document.title).not.toBe('讨论标注');
  const currentInput={clientActionId:randomUUID(),publicationId:published.receipt.publication!.publicationId,expectedCurrentSequence:0};
  const current=service.setCurrentFromHost(actor,session,currentInput);
  expect(current.replayed).toBe(false);expect(current.receipt.current?.sequence).toBe(1);
  expect(service.setCurrentFromHost(actor,session,{...currentInput,expectedCurrentSequence:1})).toEqual({receipt:current.receipt,replayed:true});
  expect(()=>service.setCurrentFromHost(actor,session,{...currentInput,clientActionId:randomUUID()})).toThrow('当前标注已更新');
});

it('rejects capacity overflow atomically and keeps original per-object metadata during a batch refresh',async()=>{
  const {service,actor,session,head,objects,response}=await setup();const {expectedRevision,...single}=input();
  const {clientActionId,...item}=single;
  const add=await service.fromSourcesFromHost(actor,session,{clientActionId,expectedRevision,items:[item,{...item,objectId:'east'}]},head());
  service.action(actor,session,{action:'apply',clientActionId:randomUUID(),expectedRevision:2,operations:[{op:'update_object',objectId:'west',changes:{name:'人工标题',note:'保留说明',attributes:{priority:1},style:{color:'#aabbcc'}}}]});
  const before=objects();response.items[0]={...source(),revision:3,geometry:{type:'Polygon',coordinates:[[[103,1],[105,1],[105,2],[103,2],[103,1]]]}};
  const refreshed=await service.fromSourcesFromHost(actor,session,{clientActionId:randomUUID(),expectedRevision:3,items:[{...item,mode:'refresh',expectedSourceRevision:3},{...item,mode:'refresh',objectId:'east',expectedSourceRevision:3}]},head());
  expect(refreshed.receipt.afterRef?.revision).toBe(4);
  for(const [index,feature] of objects().entries())expect(feature).toEqual({...before[index],geometry:response.items[0].geometry,sourceRefs:[{...sourceRef,revision:3,queriedAt:expect.any(String)}]});
  expect(objects(add.receipt.ref!)[0].geometry).toEqual(source().geometry);
  service.action(actor,session,{action:'apply',clientActionId:randomUUID(),expectedRevision:4,operations:[{op:'add_layer',layer:{layerId:'full',name:'容量验证',order:1,defaultVisible:true,features:Array.from({length:497},(_,index)=>({objectId:`extra${index}`,kind:'point',name:'点',geometry:{type:'Point',coordinates:[103,1]}}))}}]});
  const over={clientActionId:randomUUID(),expectedRevision:5,items:[{...item,objectId:'new-a',expectedSourceRevision:3},{...item,objectId:'new-b',expectedSourceRevision:3}]};
  await expect(service.fromSourcesFromHost(actor,session,over,head())).rejects.toMatchObject({code:'ANNOTATION_TOO_LARGE'});
  expect(head().revision).toBe(5);expect(service.receipt(actor,over.clientActionId)).toBeNull();expect(objects()).toHaveLength(2);
});

it('rechecks authorization for a host replay and rejects stale empty-state creation after another client created a draft',async()=>{
  const {service,actor,session,second,head,context,fetch}=await setup();const {clientActionId,expectedRevision,...item}=input();
  await service.fromSourcesFromHost(actor,session,{clientActionId,expectedRevision,items:[item]},head());
  context.config.scopes[0].seatIds=[];
  expect(()=>service.hostReplay(actor,session,{action:'from_source',clientActionId,items:[{mode:item.mode,sourceRef:item.sourceRef,layerId:item.layerId,objectId:item.objectId}]})).toThrow('无权访问');
  expect(fetch).toHaveBeenCalledTimes(1);
  const create={action:'create_draft' as const,clientActionId:randomUUID(),baseRef:null};
  service.action(actor,second,{...create,clientActionId:randomUUID()});
  expect(()=>service.actionFromHost(actor,second,create,{bindingRevision:0,baseRef:null})).toThrow('草稿或基线已变化');
});

it.each(['binding','create','cancel','revoke'] as const)('rechecks direct creation after preparation when another client changes %s',async condition=>{
  const {service,actor,second,head,db,access}=await setup(condition==='revoke');
  const create={action:'create_draft' as const,clientActionId:randomUUID(),baseRef:null,title:'Agent 创建'};
  const controller=new AbortController(),transaction=service.store.transaction.bind(service.store);
  vi.spyOn(service.store,'transaction').mockImplementationOnce(work=>{
    if(condition==='binding')service.setBase(actor,second,{clientActionId:randomUUID(),baseRef:head(),expectedBindingRevision:0});
    if(condition==='create')service.action(actor,second,{...create,clientActionId:randomUUID(),title:'另一客户端'});
    if(condition==='cancel')controller.abort();
    if(condition==='revoke')access!.disable('original');
    return transaction(work);
  });
  expect(()=>service.actionFromHost(actor,second,create,undefined,controller.signal)).toThrow();
  expect(db.prepare('SELECT 1 FROM annotation_actions WHERE action_id=?').get(create.clientActionId)).toBeUndefined();
  const rows=db.prepare('SELECT data FROM annotation_sets WHERE owner_session_id=?').all(second);
  expect(rows).toHaveLength(condition==='create' ? 1 : 0);
  if(condition==='create')expect(JSON.parse(String(rows[0].data))).toMatchObject({title:'另一客户端',headRevision:1});
});


it('keeps explicit symbol and role metadata on a source snapshot refresh without inferring equipment type',async()=>{
  const {service,actor,session,response,objects}=await setup();
  const resourceRef={systemId:'source',objectType:'resource',objectId:'resource-a'};
  response.items=[{...source(),ref:resourceRef,properties:{availableCount:1,unit:'辆'},geometry:{type:'Point',coordinates:[103,1]}}];
  const request={...input(),sourceRef:resourceRef};await service.fromSource(actor,session,request);
  expect(objects()[0].style).toBeUndefined();expect(objects()[0].informationRole).toBeUndefined();
  const style={symbolId:'xf3013-2020.6.2.1',iconSize:40,heading:180};
  service.action(actor,session,{action:'apply',clientActionId:randomUUID(),expectedRevision:2,operations:[{op:'update_object',objectId:'west',changes:{style,informationRole:'observation',geometry:{type:'Point',coordinates:[104,2]}}}]});
  const before=objects()[0];response.items[0]={...response.items[0],revision:3,geometry:{type:'Point',coordinates:[105,3]}};
  // Only an explicit refresh replaces the manually adjusted position.
  expect(objects()[0]).toEqual(before);
  await service.fromSource(actor,session,{...request,clientActionId:randomUUID(),mode:'refresh',expectedRevision:3,expectedSourceRevision:3});
  expect(objects()[0]).toEqual({...before,geometry:response.items[0].geometry,sourceRefs:[{...resourceRef,revision:3,queriedAt:expect.any(String)}]});
});
