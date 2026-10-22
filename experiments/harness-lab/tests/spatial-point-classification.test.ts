import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContextRef, SituationObject } from '../src/contracts/context.js';
import { extractSpatialResult, projectSpatialResult, spatialModelFormat, spatialRequestValid, type SpatialGeometry, type SpatialInput, type SpatialPointPosition, type SpatialResult } from '../src/contracts/spatial.js';
import { classifyPoint, relate } from '../src/spatial/geometry.js';
import { SpatialAnalysisService } from '../src/spatial/service.js';
import { ContextService } from '../src/context/service.js';
import { PiLab } from '../src/pi/lab.js';
import { spatialAnalyzeSchema } from '../src/pi/spatial-tools.js';
import { Value } from 'typebox/value';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';

const region:Extract<SpatialGeometry,{type:'Polygon'}>={type:'Polygon',coordinates:[
  [[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[1,3],[3,3],[3,1],[1,1]],
]};
const point=(x:number,y:number):Extract<SpatialGeometry,{type:'Point'}>=>({type:'Point',coordinates:[x,y]});
// Independent rectangle truth: outer [0,4]² minus open hole (1,3)², no Turf oracle.
const positions:Array<[string,number,number,SpatialPointPosition]>=[
  ['strict interior',0.5,2,'interior'],['outer edge',0,2,'boundary'],['outer vertex',4,4,'boundary'],
  ['outside',4.5,2,'exterior'],['hole interior',2,2,'exterior'],['hole edge',1,2,'boundary'],['hole vertex',3,3,'boundary'],
  ['just inside outer',1e-10,2,'interior'],['just outside outer',-1e-10,2,'exterior'],
  ['just inside hole',1+1e-10,2,'exterior'],['just outside hole',1-1e-10,2,'interior'],
];
describe('point classification independent geometric truth',()=>{
  it.each(positions)('%s',(_label,x,y,expected)=>{
    expect(classifyPoint(point(x,y),region)).toBe(expected);
    const reversed={...region,coordinates:region.coordinates.map(ring=>[...ring].reverse())};
    expect(classifyPoint(point(x,y),reversed)).toBe(expected);
  });
  it('classifies diagonal edges exactly without adding a distance tolerance',()=>{
    const triangle:SpatialGeometry={type:'Polygon',coordinates:[[[0,0],[2,0],[0,2],[0,0]]]};
    expect(classifyPoint(point(1,1),triangle)).toBe('boundary');
    expect(classifyPoint(point(1,1-1e-10),triangle)).toBe('interior');
    expect(classifyPoint(point(1,1+1e-10),triangle)).toBe('exterior');
  });
  it('rejects other geometry combinations and combined spans but preserves old MultiPolygon contains',()=>{
    const multi:SpatialGeometry={type:'MultiPolygon',coordinates:[region.coordinates]};
    expect(()=>classifyPoint(point(0,2),multi)).toThrow();
    expect(()=>classifyPoint(region,region)).toThrow();
    expect(()=>classifyPoint(point(15,2),region)).toThrow('10°');
    expect(relate('contains',multi,point(1,2))).toBe(true);
    expect(relate('contains',multi,point(2,2))).toBe(false);
  });
});
const input:SpatialInput={kind:'source',systemId:'fixture',objectRefs:[{systemId:'fixture',objectType:'resource',objectId:'point'}]};
const target:SpatialInput={kind:'source',systemId:'fixture',objectRefs:[{systemId:'fixture',objectType:'area',objectId:'region'}]};
function evidence():SpatialResult {
  const requestId='00000000-0000-4000-8000-000000000001';
  return {schemaVersion:2,resultRef:`spatial:${requestId}:classify`,requestId,toolCallId:'classify',operation:'classify_points',parameters:{operation:'classify_points',input,target},
    createdAt:'2026-10-22T00:00:00Z',scope:[input,target],completeness:{status:'complete',candidateCount:2},
    items:[{id:'point/内',name:'内',geometry:point(0.5,2),properties:{}},{id:'point/边',name:'边',geometry:point(1,2),properties:{}}],
    referenceItems:[{id:'region',name:'区域',geometry:region,properties:{}}],classifications:[{itemId:'point/内',position:'interior'},{itemId:'point/边',position:'boundary'}],
    values:{total:2,interior:1,boundary:1,exterior:0},method:'fixed historical method',limitations:['fixed historical limit'],
    provenance:[{input,queriedAt:'2026-10-22T00:00:00Z',asOf:'2026-10-22T00:00:00Z'},{input:target,queriedAt:'2026-10-22T00:00:00Z',asOf:'2026-10-22T00:00:00Z'}]};
}
const text=(r:SpatialResult)=>JSON.stringify({format:spatialModelFormat(r),data:projectSpatialResult(r)});
describe('classification v2 contract',()=>{
  it('matches strict tool/service request schemas and retains a geometry-free model projection',()=>{
    const request=evidence().parameters;
    expect(spatialRequestValid(request)).toBe(true);expect(Value.Check(spatialAnalyzeSchema,request)).toBe(true);
    for(const invalid of [{...request,target:undefined},{...request,geometry:region},{...request,toleranceM:5}]) {
      expect(spatialRequestValid(invalid)).toBe(false);expect(Value.Check(spatialAnalyzeSchema,invalid)).toBe(false);
    }
    const original=evidence(),decoded=extractSpatialResult({spatialResult:original},'spatial_analyze',false,text(original));
    expect(decoded).toEqual(original);expect(decoded).not.toBe(original);
    expect(text(original)).toContain('spatial.model-result.v2');expect(text(original)).not.toContain('coordinates');
    expect(JSON.parse(text(original)).data.classifications).toEqual(original.classifications);
  });
  it.each([
    ['wrong schema version',(r:SpatialResult)=>{r.schemaVersion=1;}],
    ['unsupported schema version',(r:SpatialResult)=>{Object.assign(r,{schemaVersion:3});}],
    ['missing classification',(r:SpatialResult)=>{r.classifications!.pop();}],
    ['duplicate identity',(r:SpatialResult)=>{r.classifications![1].itemId=r.classifications![0].itemId;}],
    ['wrong identity',(r:SpatialResult)=>{r.classifications![0].itemId='invented';}],
    ['invalid position',(r:SpatialResult)=>{Object.assign(r.classifications![0],{position:'nearby'});}],
    ['extra classification field',(r:SpatialResult)=>{Object.assign(r.classifications![0],{distanceM:0});}],
    ['candidate count mismatch',(r:SpatialResult)=>{r.completeness.candidateCount=3;}],
    ['count partition mismatch',(r:SpatialResult)=>{r.values={total:2,interior:2,boundary:0,exterior:0};}],
    ['total mismatch',(r:SpatialResult)=>{r.values={total:3,interior:1,boundary:1,exterior:0};}],
    ['fractional count',(r:SpatialResult)=>{r.values={total:2,interior:0.5,boundary:1.5,exterior:0};}],
    ['nonpoint candidate',(r:SpatialResult)=>{r.items[0].geometry=region;}],
    ['missing target',(r:SpatialResult)=>{delete r.referenceItems;}],
    ['multipolygon target',(r:SpatialResult)=>{r.referenceItems![0].geometry={type:'MultiPolygon',coordinates:[region.coordinates]};}],
    ['generated geometry',(r:SpatialResult)=>{r.geometry=region;}],
    ['old operation in v2',(r:SpatialResult)=>{r.operation='filter';r.parameters={operation:'filter',input};r.scope=[input];}],
  ])('rejects %s',(_label,mutate)=>{
    const r=evidence();mutate(r);expect(extractSpatialResult({spatialResult:r},'spatial_analyze',false,text(r))).toBeNull();
  });
  it('does not accept a v1 model envelope for v2 or silently attach v2 fields to v1',()=>{
    const r=evidence(),oldText=JSON.stringify({format:'spatial.model-result.v1',data:projectSpatialResult(r)});
    expect(extractSpatialResult({spatialResult:r},'spatial_analyze',false,oldText)).toBeNull();
    const v1:SpatialResult={...r,schemaVersion:1,operation:'filter',parameters:{operation:'filter',input},scope:[input],values:undefined};
    delete v1.classifications;
    const before=JSON.stringify(v1),beforeText=text(v1);
    const decoded=extractSpatialResult({spatialResult:v1},'spatial_analyze',false,beforeText)!;
    expect(JSON.stringify(decoded)).toBe(before);expect(text(decoded)).toBe(beforeText);
    expect(extractSpatialResult({spatialResult:{...v1,classifications:[]}},'spatial_analyze')).toBeNull();
  });
});
const clean:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const fn of clean.splice(0).reverse())await fn();});
const object=(id:string,geometry:SituationObject['geometry']):SituationObject=>({ref:{systemId:'source',objectType:id==='region'?'area':geometry?.type==='LineString'?'road':'resource',objectId:id},name:id,geometry,revision:7,areaIds:[id==='region'?'target':'candidates'],properties:id==='region'?{memberRefs:[]}:geometry?.type==='LineString'?{passability:'open'}:{availableCount:1,unit:'辆'},effectiveAt:'2026-10-20T00:00:00Z',validTime:null});
async function setup(objects:SituationObject[],storedTarget?:SpatialGeometry) {
  // Existing HTTP areas are single-ring; complex geometries enter through trusted fixed results.
  objects=objects.map(item=>item.ref.objectId==='region'?{...item,geometry:{type:'Polygon',coordinates:[region.coordinates[0]]}}:item);
  const dir=await mkdtemp(join(tmpdir(),'spatial-classification-'));clean.push(()=>rm(dir,{recursive:true,force:true}));
  const config=testConfig(dir,{seatId:'alpha',testSeats:[{id:'alpha',name:'甲'}]});
  const fake=await fakeRuntime(config,()=>({text:'unused'})),lab=await PiLab.create(config,fake.runtime);clean.push(()=>lab.close());
  const fetch=vi.fn<typeof globalThis.fetch>(async input=>{
    const query=new URL(String(input)).searchParams,refs=JSON.parse(query.get('objectRefs')??'null') as ContextRef[]|null,areas=JSON.parse(query.get('areaIds')??'null') as string[]|null;
    const matching=objects.filter(item=>(!refs||refs.some(ref=>ref.objectId===item.ref.objectId))&&(!areas||areas.some(area=>item.areaIds.includes(area))));
    const start=Number(query.get('cursor')??0),items=matching.slice(start,start+100),hasMore=start+items.length<matching.length;
    return new Response(JSON.stringify({systemId:'source',asOf:'2026-10-22T00:00:00Z',items,limit:100,nextCursor:hasMore?String(start+100):null,hasMore,timeUnknownCount:0,unknownRefs:[],changeCursor:'c1'}),{headers:{'content-type':'application/json'}});
  });
  const context=new ContextService({systems:[{id:'source',name:'来源',adapter:'mock-situation-http',baseUrl:'http://127.0.0.1:4401',tokenEnv:'TOKEN'}],scopes:[{id:'scope',name:'授权',systemIds:['source'],seatIds:['alpha']}]},{TOKEN:'synthetic'},{fetch});
  lab.context=context;lab.annotations!.context=context;
  const session=await lab.createSession(undefined,'alpha'),actor=lab.annotations!.actorForSeat('alpha'),service=new SpatialAnalysisService(lab.annotations!,context),controller=new AbortController();
  const stored:SpatialResult={...evidence(),schemaVersion:1,operation:'buffer',parameters:{operation:'buffer',input:{kind:'source',systemId:'source'},distanceM:100},scope:[{kind:'source',systemId:'source'}],classifications:undefined,values:undefined,geometry:storedTarget,provenance:[{input:{kind:'source',systemId:'source'},queriedAt:'2026-10-22T00:00:00Z',asOf:'2026-10-22T00:00:00Z'}]};
  const scope={actor,sessionId:session.id,taskId:lab.workspaces.get(session.workspaceId,'alpha').taskSpaceId!,signal:controller.signal,check:()=>{},resolveResult:():SpatialResult=>stored};
  const input:SpatialInput={kind:'source',systemId:'source',areaIds:['candidates']},target:SpatialInput=storedTarget?{kind:'result',resultRef:stored.resultRef,geometry:true}:{kind:'source',systemId:'source',objectRefs:[object('region',region).ref]};
  return {service,scope,input,target,fetch,context,controller};
}
describe('classification authorized service and bounded worker',()=>{
  it('returns a complete partition with exact identities, original geometry and revision/time',async()=>{
    const originals=positions.map(([id,x,y])=>object(id,point(x,y))),s=await setup([...originals,object('region',region)],region);
    const r=await s.service.analyze({operation:'classify_points',input:s.input,target:s.target},s.scope,randomUUID(),'classify');
    expect(r.schemaVersion).toBe(2);expect(r.items.map(i=>i.source?.ref)).toEqual(originals.map(i=>i.ref));
    expect(r.items.map(i=>i.geometry)).toEqual(originals.map(i=>i.geometry));expect(r.classifications?.map(c=>c.position)).toEqual(positions.map(p=>p[3]));
    expect(r.values).toEqual({total:11,interior:3,boundary:4,exterior:4});expect(r.completeness.candidateCount).toBe(11);
    expect(r.items.every(i=>i.source?.revision===7&&i.source.effectiveAt==='2026-10-20T00:00:00Z')).toBe(true);
    expect(r.referenceItems?.[0].geometry).toEqual(region);expect(r.provenance).toHaveLength(2);
    expect(extractSpatialResult({spatialResult:r},'spatial_analyze',false,text(r))).toEqual(r);
    const before=JSON.stringify(r),calls=s.fetch.mock.calls.length;
    const read=await s.service.analyze({operation:'read',resultRef:r.resultRef},{...s.scope,resolveResult:()=>r},randomUUID(),'read');
    expect(JSON.stringify(read)).toBe(before);expect(s.fetch).toHaveBeenCalledTimes(calls);
    s.context.config.scopes[0].seatIds=[];
    await expect(s.service.analyze({operation:'read',resultRef:r.resultRef},{...s.scope,resolveResult:()=>r},randomUUID(),'denied')).rejects.toMatchObject({code:'SPATIAL_FORBIDDEN'});
  });
  it('returns complete zero counts for empty candidates while still checking target type',async()=>{
    const s=await setup([object('region',region)]);
    const r=await s.service.analyze({operation:'classify_points',input:s.input,target:s.target},s.scope,randomUUID(),'empty');
    expect(r.values).toEqual({total:0,interior:0,boundary:0,exterior:0});expect(r.classifications).toEqual([]);
    expect(extractSpatialResult({spatialResult:r},'spatial_analyze',false,text(r))).toEqual(r);
  });
  it.each([
    ['missing geometry',null,'SPATIAL_GEOMETRY_MISSING'],
    ['line candidate',{type:'LineString',coordinates:[[0,0],[1,0]]},'SPATIAL_UNSUPPORTED_GEOMETRY'],
    ['combined extent',{type:'Point',coordinates:[15,2]},'SPATIAL_UNSUPPORTED_REGION'],
    ['unsupported latitude',{type:'Point',coordinates:[0,80]},'SPATIAL_GEOMETRY_INVALID'],
  ] as const)('rejects %s without classifying it exterior',async(_label,geometry,code)=>{
    const s=await setup([object('candidate',geometry===null?null:structuredClone(geometry) as SituationObject['geometry']),object('region',region)]);
    await expect(s.service.analyze({operation:'classify_points',input:s.input,target:s.target},s.scope,randomUUID(),'invalid')).rejects.toMatchObject({code});
  });
  it('checks unsupported or ambiguous targets even when candidate processing would be empty',async()=>{
    const empty=await setup([object('region',region)],{type:'MultiPolygon',coordinates:[region.coordinates]});
    await expect(empty.service.analyze({operation:'classify_points',input:empty.input,target:empty.target},empty.scope,randomUUID(),'multi')).rejects.toMatchObject({code:'SPATIAL_UNSUPPORTED_GEOMETRY'});
    const s=await setup([object('a',point(0.5,2)),object('b',point(0.6,2)),object('region',region)]);
    await expect(s.service.analyze({operation:'classify_points',input:s.input,target:s.input},s.scope,randomUUID(),'ambiguous')).rejects.toMatchObject({code:'SPATIAL_AMBIGUOUS'});
    await expect(s.service.analyze({operation:'classify_points',input:s.input,target:{kind:'source',systemId:'source',objectRefs:[object('a',point(0.5,2)).ref]}},s.scope,randomUUID(),'point-target')).rejects.toMatchObject({code:'SPATIAL_UNSUPPORTED_GEOMETRY'});
  });
  it('counts target against the existing 500-object limit, without returning a partial partition',async()=>{
    const s=await setup([...Array.from({length:500},(_,i)=>object(String(i),point(0.5,2))),object('region',region)]);
    await expect(s.service.analyze({operation:'classify_points',input:s.input,target:s.target},s.scope,randomUUID(),'limit')).rejects.toMatchObject({code:'SPATIAL_LIMIT'});
    expect(s.fetch).toHaveBeenCalledTimes(6);
  });
  it('rejects an invalid hole rather than repairing it, and observes cancellation',async()=>{
    const invalid:SituationObject['geometry']={type:'Polygon',coordinates:[region.coordinates[0],[[3,3],[3,5],[5,5],[5,3],[3,3]]]};
    const s=await setup([object('candidate',point(0.5,2)),object('region',invalid)],invalid);
    await expect(s.service.analyze({operation:'classify_points',input:s.input,target:s.target},s.scope,randomUUID(),'hole')).rejects.toMatchObject({code:'SPATIAL_GEOMETRY_INVALID'});
    s.controller.abort();await expect(s.service.analyze({operation:'classify_points',input:s.input,target:s.target},s.scope,randomUUID(),'cancel')).rejects.toThrow();
  });
});
