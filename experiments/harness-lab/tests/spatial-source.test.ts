import { randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach,expect,it,vi } from 'vitest';
import { ContextService } from '../src/context/service.js';
import { SpatialAnalysisService } from '../src/spatial/service.js';
import { PiLab } from '../src/pi/lab.js';
import { fakeRuntime,testConfig } from './pi/fake-runtime.js';
import type { SituationObject } from '../src/contracts/context.js';
import type { SpatialInput, SpatialResult } from '../src/contracts/spatial.js';
const clean:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const fn of clean.splice(0).reverse())await fn();});
const point=(id:string,x=120):SituationObject=>({ref:{systemId:'source',objectType:'resource',objectId:id},name:id,revision:1,areaIds:[],effectiveAt:null,validTime:null,geometry:{type:'Point',coordinates:[x,30]},properties:{availableCount:1,unit:'辆'}});
async function setup(pages:Array<{items:SituationObject[];asOf?:string;changeCursor?:string;status?:number}>) {
  const dir=await mkdtemp(join(tmpdir(),'spatial-source-'));clean.push(()=>rm(dir,{recursive:true,force:true}));
  const config=testConfig(dir,{seatId:'alpha',testSeats:[{id:'alpha',name:'甲'}]});
  const runtime=await fakeRuntime(config,(_c,index)=>index%2===0?{tools:[{name:'spatial_analyze',arguments:{operation:'summarize',input:{kind:'source',systemId:'source'},field:'unit'}}]}:{text:'已分析'});
  const lab=await PiLab.create(config,runtime.runtime);clean.push(()=>lab.close());
  const fetch=vi.fn<typeof globalThis.fetch>(async input=>{const index=Number(new URL(String(input)).searchParams.get('cursor')??'0'),page=pages[index];return new Response(JSON.stringify({systemId:'source',asOf:page.asOf??'2026-10-16T00:00:00Z',items:page.items,limit:100,nextCursor:index+1<pages.length?String(index+1):null,hasMore:index+1<pages.length,timeUnknownCount:0,unknownRefs:[],changeCursor:page.changeCursor??'c1'}),{status:page.status??200,headers:{'content-type':'application/json'}});});
  const context=new ContextService({systems:[{id:'source',name:'来源',adapter:'mock-situation-http',baseUrl:'http://127.0.0.1:4401',tokenEnv:'TOKEN'}],scopes:[{id:'scope',name:'授权',systemIds:['source'],seatIds:['alpha']}]},{TOKEN:'synthetic'},{fetch});
  lab.context=context;lab.annotations!.context=context;const session=await lab.createSession(undefined,'alpha'),actor=lab.annotations!.actorForSeat('alpha'),service=new SpatialAnalysisService(lab.annotations!,context),controller=new AbortController();
  const scope={actor,sessionId:session.id,taskId:lab.workspaces.get(session.workspaceId,'alpha').taskSpaceId!,signal:controller.signal,check:()=>{},resolveResult:():SpatialResult=>{throw Error('missing');}};
  const input:SpatialInput={kind:'source',systemId:'source'};return {lab,service,scope,input,fetch,context,session,runtime};
}
it('collects full source pages, deduplicates full identity and retains page time/version provenance',async()=>{
  const s=await setup([{items:[point('a')]},{items:[point('b'),point('a')]}]);
  const result=await s.service.analyze({operation:'summarize',input:s.input,field:'unit'},s.scope,randomUUID(),'sum');
  expect(result.values).toEqual({total:2,groups:[{value:'辆',count:2}]});expect(result.provenance).toHaveLength(2);expect(s.fetch).toHaveBeenCalledTimes(2);
});
it.each(['version','properties','missing','failure'] as const)('rejects %s instead of a partial whole-scope answer',async condition=>{
  const second={items:[point('b')],asOf:'2026-10-16T00:00:00Z',status:200};
  if(condition==='version')second.asOf='2026-10-16T01:00:00Z';
  if(condition==='properties')second.items=[{...point('a'),properties:{availableCount:2,unit:'辆'}}];
  if(condition==='missing')second.items[0].geometry=null;
  if(condition==='failure')second.status=503;
  const s=await setup([{items:[point('a')]},second]);
  await expect(s.service.analyze({operation:'summarize',input:s.input,field:'unit'},s.scope,randomUUID(),'sum')).rejects.toThrow();
});
it('returns an honest complete empty result and refuses an unmatched requested revision',async()=>{
  const s=await setup([{items:[]}]);
  expect((await s.service.analyze({operation:'summarize',input:s.input,field:'unit'},s.scope,randomUUID(),'sum')).values).toEqual({total:0,groups:[]});
  await expect(s.service.analyze({operation:'summarize',input:{...s.input,kind:'source',systemId:'source',revisions:[{ref:point('absent').ref,revision:1}]},field:'unit'},s.scope,randomUUID(),'sum')).rejects.toMatchObject({code:'SPATIAL_INCOMPLETE'});
});
it('redacts denied historical spatial evidence and prevents replay into a new model request',async()=>{
  const s=await setup([{items:[point('private-location')]}]);await s.lab.start(s.session.id,'统计',{},'alpha').run(()=>{});
  const before=s.lab.get(s.session.id,'alpha').messages.find(m=>m.toolName==='spatial_analyze')!;expect(before.spatialResult).toBeTruthy();
  s.context.config.scopes[0].seatIds=[];
  const after=s.lab.get(s.session.id,'alpha').messages.find(m=>m.toolName==='spatial_analyze')!;expect(after.spatialResult).toBeNull();expect(after.text).not.toContain('private-location');
  expect(()=>s.lab.start(s.session.id,'继续',{},'alpha')).toThrow();expect(s.runtime.calls).toHaveLength(2);
});
it('saves exact geometry with CAS/idempotency and inherits source access even without public private-result pointers',async()=>{
  const s=await setup([{items:[point('a')]}]),annotations=s.lab.annotations!;
  const draft=annotations.action(s.scope.actor,s.session.id,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,operations:[{op:'add_layer',layer:{layerId:'derived',name:'分析',order:0,defaultVisible:true,features:[]}}]});
  const result=await s.service.analyze({operation:'buffer',input:s.input,distanceM:100},s.scope,randomUUID(),'buffer');
  const basis=draft.afterRef!,intent={action:'from_analysis' as const,clientActionId:randomUUID(),resultRef:result.resultRef,layerId:'derived',objectId:'saved',name:'范围'};
  const saved=annotations.fromAnalysisFromHost(s.scope.actor,s.session.id,intent,result,basis);
  expect(saved.replayed).toBe(false);expect(annotations.fromAnalysisFromHost(s.scope.actor,s.session.id,intent,result,basis)).toEqual({receipt:saved.receipt,replayed:true});
  expect(annotations.version(s.scope.actor,s.scope.taskId,saved.receipt.ref!).document.layers[0].features[0].geometry).toEqual(result.geometry);
  expect(()=>annotations.fromAnalysisFromHost(s.scope.actor,s.session.id,{...intent,clientActionId:randomUUID(),objectId:'stale'},result,basis)).toThrow('新修订');
  const publication=annotations.action(s.scope.actor,s.session.id,{action:'publish',clientActionId:randomUUID(),revision:2,title:'固定范围'});
  expect(JSON.stringify(annotations.version(s.scope.actor,s.scope.taskId,publication.ref!))).not.toContain(result.resultRef);
  s.context.config.scopes[0].seatIds=[];
  expect(()=>annotations.version(s.scope.actor,s.scope.taskId,publication.ref!)).toThrow();
  expect(()=>annotations.hostReplay(s.scope.actor,s.session.id,intent)).toThrow();
});
it('refuses lossy complex geometry saves atomically',async()=>{
  const s=await setup([{items:[point('a')]}]),annotations=s.lab.annotations!;
  const draft=annotations.action(s.scope.actor,s.session.id,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,operations:[{op:'add_layer',layer:{layerId:'derived',name:'分析',order:0,defaultVisible:true,features:[]}}]});
  const result=await s.service.analyze({operation:'buffer',input:s.input,distanceM:100},s.scope,randomUUID(),'buffer');
  result.geometry={type:'Polygon',coordinates:[[[120,30],[121,30],[121,31],[120,31],[120,30]],[[120.2,30.2],[120.8,30.2],[120.8,30.8],[120.2,30.8],[120.2,30.2]]]};
  const intent={action:'from_analysis' as const,clientActionId:randomUUID(),resultRef:result.resultRef,layerId:'derived',objectId:'saved',name:'含孔面'};
  expect(()=>annotations.fromAnalysisFromHost(s.scope.actor,s.session.id,intent,result,draft.afterRef!)).toThrow('不能无损保存');
  expect(annotations.binding(s.scope.actor,s.session.id).draft?.headRevision).toBe(1);
  expect(annotations.receipt(s.scope.actor,intent.clientActionId)).toBeNull();
});
it('retains both fixed measurement geometries without changing the reusable input result set',async()=>{
  const s=await setup([{items:[point('a'),point('b',120.01)]}]);
  // ContextService validates exact-reference responses; use annotations for a deterministic two-input snapshot.
  const annotations=s.lab.annotations!,draft=annotations.action(s.scope.actor,s.session.id,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,operations:[{op:'add_layer',layer:{layerId:'p',name:'点',order:0,defaultVisible:true,features:[{objectId:'a',kind:'point',name:'a',geometry:point('a').geometry!},{objectId:'b',kind:'point',name:'b',geometry:point('b',120.01).geometry!}]}}]});
  const result=await s.service.analyze({operation:'measure',metric:'distance',input:{kind:'annotation',ref:draft.ref!,objectIds:['a']},target:{kind:'annotation',ref:draft.ref!,objectIds:['b']}},s.scope,randomUUID(),'measure');
  expect(result.items).toHaveLength(1);expect(result.referenceItems?.map(i=>i.name)).toEqual(['b']);expect(result.referenceItems?.[0].geometry).toEqual(point('b',120.01).geometry);
});

it('rejects conflicting duplicate revision conditions and selectors beyond the existing source contract before HTTP',async()=>{
  const s=await setup([{items:[point('a')]}]);
  const invalid:SpatialInput[]=[
    {kind:'source',systemId:'source',revisions:[{ref:point('a').ref,revision:1},{ref:{objectId:'a',objectType:'resource',systemId:'source'},revision:2}]},
    {kind:'source',systemId:'source',objectRefs:Array.from({length:21},(_,i)=>point(String(i)).ref)},
    {kind:'source',systemId:'source',areaIds:Array.from({length:11},(_,i)=>String(i))},
  ];
  for(const input of invalid)await expect(s.service.analyze({operation:'summarize',input,field:'unit'},s.scope,randomUUID(),'sum')).rejects.toMatchObject({code:'SPATIAL_INVALID_INPUT'});
  expect(s.fetch).not.toHaveBeenCalled();
});

it('accepts source object identifiers allowed by ContextRef without imposing annotation ID syntax',async()=>{
  const item=point('救援点/甲'),s=await setup([{items:[item]}]);
  const result=await s.service.analyze({operation:'buffer',input:{kind:'source',systemId:'source',objectRefs:[item.ref]},distanceM:100},s.scope,randomUUID(),'buffer');
  expect(result.items[0].source?.ref).toEqual(item.ref);expect(result.geometry?.type).toBe('Polygon');
});

it('preserves source business time separately from query and snapshot time',async()=>{
  const item={...point('timed'),effectiveAt:'2026-10-15T08:00:00+08:00',validTime:{from:'2026-10-15T00:00:00Z',to:'2026-10-17T00:00:00Z'}},s=await setup([{items:[item]}]);
  const result=await s.service.analyze({operation:'summarize',input:s.input,field:'unit'},s.scope,randomUUID(),'sum');
  expect(result.items[0].source).toMatchObject({effectiveAt:item.effectiveAt,validTime:item.validTime});
  expect(result.provenance[0].asOf).toBe('2026-10-16T00:00:00Z');expect(result.items[0].source?.queriedAt).toMatch(/Z$/);
});

it('requires an explicit generated-result selection while preserving fixed reads and ordinary item chains',async()=>{
  const s=await setup([{items:[point('a')]}]);
  const buffer=await s.service.analyze({operation:'buffer',input:s.input,distanceM:100},s.scope,randomUUID(),'buffer');
  const original=structuredClone(buffer),scope={...s.scope,resolveResult:()=>buffer};
  const input={kind:'result' as const,resultRef:buffer.resultRef};
  await expect(s.service.inputs.read(input,scope)).rejects.toMatchObject({code:'SPATIAL_AMBIGUOUS',message:expect.stringContaining('geometry:true')});
  expect((await s.service.inputs.read({...input,geometry:true},scope)).items).toEqual([{id:buffer.resultRef,name:'分析范围',geometry:buffer.geometry,properties:{}}]);
  expect((await s.service.inputs.read({...input,geometry:false},scope)).items).toEqual(buffer.items);
  expect((await s.service.inputs.read({...input,itemIds:[buffer.items[0].id]},scope)).items).toEqual(buffer.items);
  await expect(s.service.inputs.read({...input,itemIds:['absent']},scope)).rejects.toMatchObject({code:'SPATIAL_OBJECT_NOT_FOUND'});
  expect(await s.service.analyze({operation:'read',resultRef:buffer.resultRef},scope,randomUUID(),'read')).toEqual(original);
  const summary=await s.service.analyze({operation:'summarize',input:{...input,geometry:false},field:'unit'},scope,randomUUID(),'sum');
  const summaryScope={...scope,resolveResult:()=>summary};
  expect((await s.service.inputs.read({kind:'result',resultRef:summary.resultRef},summaryScope)).items).toEqual(buffer.items);
  await expect(s.service.inputs.read({kind:'result',resultRef:summary.resultRef,geometry:true},summaryScope)).rejects.toMatchObject({code:'SPATIAL_GEOMETRY_MISSING'});
  expect(buffer).toEqual(original);expect(s.fetch).toHaveBeenCalledTimes(1);
  expect(buffer.method).toContain('32 segments per quadrant');
  expect(buffer.limitations.join(' ')).toContain('线缓冲总边数随形状变化');
  s.context.config.scopes[0].seatIds=[];
  await expect(s.service.inputs.read(input,scope)).rejects.toMatchObject({code:'SPATIAL_FORBIDDEN'});
  await expect(s.service.analyze({operation:'read',resultRef:buffer.resultRef},scope,randomUUID(),'denied-read')).rejects.toMatchObject({code:'SPATIAL_FORBIDDEN'});
});
