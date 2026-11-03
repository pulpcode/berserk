import { afterEach, describe, expect, it } from 'vitest';
import { createMockContextServer } from '../scripts/mock-context/server.js';
import { objects } from '../scripts/mock-context/fixtures.js';
import { parseContextConfig } from '../src/context/config.js';
import { ContextService } from '../src/context/service.js';
import { decodeContextResponse, normalizeContextQuery } from '../src/context/validation.js';
import type { SituationCurrent, SituationObject, SituationResourceCoverage } from '../src/contracts/context.js';
import type { ResourceSourceCapability, TaskResource } from '../src/contracts/task-resources.js';

const token='local-resource-query-test';
const seat={kind:'seat' as const,seatId:'seat-a'};
const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0)) await close();});
const capability:ResourceSourceCapability={systemId:'situation',categories:['fire_engine','rescue_boat'],units:['辆','艘'],relations:['assigned','related','potential_support'],filters:['task','relation','category'],taskIdMapping:'identity',supportRule:{id:'explicit-task-relation',description:'Only source records explicitly declaring potential_support for this task.'},pagination:'cursor',snapshot:'fixed_revision'};
function resource(id:string, category:TaskResource['category']='fire_engine', relation?:'related'|'potential_support',taskId='task-a'):SituationObject {
  return {ref:{systemId:'situation',objectType:'resource',objectId:id},name:id,revision:1,areaIds:['zone-west'],effectiveAt:'2026-10-01T09:00:00+08:00',validTime:null,properties:{},geometry:{type:'Point',coordinates:[120,30]},resourceData:{entityId:id,resource:{meaning:'actual_resource',granularity:'individual',category,...(relation?{taskRelations:[{taskId,relation,evidence:[{kind:'declaration',note:'Source relation record'}]}]}:{})}}};
}
const sourceObjects=[resource('r1','fire_engine','related'),resource('r2','rescue_boat','potential_support'),resource('r3','fire_engine','potential_support','task-b'),resource('r4')];
function config(baseUrl:string,cap?:ResourceSourceCapability) {
  return parseContextConfig({systems:[{id:'situation',name:'态势',adapter:'mock-situation-http',baseUrl:`${baseUrl}/situation`,tokenEnv:'RESOURCE_QUERY_TOKEN',...(cap?{resourceCapability:cap}:{})}],scopes:[{id:'test',name:'Test',systemIds:['situation'],seatIds:['seat-a']}]});
}
async function setup(cap?:ResourceSourceCapability,seeds?:SituationObject[],resourceCoverage?:SituationResourceCoverage) {
  const mock=createMockContextServer({token,...(cap?{resourceCapability:cap}:{}),...(seeds?{situationObjects:seeds}:{}),...(resourceCoverage?{resourceCoverage}:{})});
  const url=await mock.listen();cleanup.push(()=>mock.close());
  return {mock,url,service:new ContextService(config(url,cap),{RESOURCE_QUERY_TOKEN:token})};
}
const current=(result:Awaited<ReturnType<ContextService['query']>>)=>result.data as SituationCurrent;

describe('resource source filtering is independent of task relationships',()=>{
  it('preserves old configuration and exact reads without any resource capability or source task ID',async()=>{
    const {mock,service}=await setup();
    const ref=objects().find(item=>item.ref.objectType==='resource')!.ref;
    const result=current(await service.query('situation_query',{systemId:'situation',mode:'current',objectRefs:[ref]},seat));
    expect(result.items.map(item=>item.ref)).toEqual([ref]);
    expect(mock.requests[0].path).not.toMatch(/taskId|relation|category/);
    expect(config('http://127.0.0.1').systems[0]).not.toHaveProperty('resourceCapability');
    await expect(service.queryTaskResources({systemId:'situation',taskId:'task-a'},seat)).rejects.toMatchObject({code:'CONTEXT_UNSUPPORTED_FILTER'});
    expect(mock.requests).toHaveLength(1);
  });
  it('filters mixed objects before paging, binds cursor to filters, and never needs task mapping',async()=>{
    const seeds=[...Array.from({length:30},(_,i)=>({...objects().find(item=>item.ref.objectType==='area')!,ref:{systemId:'situation',objectType:'area',objectId:`area-${i}`},geometry:null})),...Array.from({length:26},(_,i)=>resource(`r${String(i).padStart(2,'0')}`))];
    const {service}=await setup(undefined,seeds);
    const query={systemId:'situation',mode:'current',objectTypes:['resource'],limit:20};
    const first=current(await service.query('situation_query',query,seat));
    expect(first.items).toHaveLength(20);expect(first.items.every(item=>item.ref.objectType==='resource')).toBe(true);expect(first.hasMore).toBe(true);
    const second=current(await service.query('situation_query',{...query,cursor:first.nextCursor},seat));
    expect(second.items).toHaveLength(6);expect(second.hasMore).toBe(false);expect(second.asOf).toBe(first.asOf);
    expect(new Set([...first.items,...second.items].map(item=>item.ref.objectId)).size).toBe(26);
    await expect(service.query('situation_query',{...query,objectTypes:['area'],cursor:first.nextCursor},seat)).rejects.toMatchObject({code:'CONTEXT_INVALID_CURSOR'});
  });
  it('applies object type filtering to changes before pagination and retains the source change position',async()=>{
    const {service,mock}=await setup();mock.advance('contract');
    const roads=await service.query('situation_query',{systemId:'situation',mode:'changes',objectTypes:['road'],limit:1},seat);
    expect(roads.data).toMatchObject({items:[],hasMore:false,nextAfter:mock.snapshot().changeCursor});
    const resources=await service.query('situation_query',{systemId:'situation',mode:'changes',objectTypes:['resource'],limit:1},seat);
    expect(resources.data).toMatchObject({hasMore:true,nextAfter:null,items:[{after:{ref:{objectType:'resource'}}}]});
  });
  it('rejects invalid and contradictory filters instead of broadening the source request',()=>{
    for(const extra of [{objectTypes:[]},{objectTypes:['resource','resource']},{objectTypes:['unknown']},{objectTypes:['resource'],objectRefs:[{systemId:'situation',objectType:'road',objectId:'r'}]},{relation:'related'},{taskId:'a',objectTypes:['road']},{taskId:'a',mode:'changes'},{category:'invented'}]) {
      expect(()=>normalizeContextQuery('situation_query',{systemId:'situation',mode:'current',...extra})).toThrow();
    }
  });
});

describe('D22 source business coverage is independent of paging completion',()=>{
  it('retains a partial reason across real HTTP pages and on the final page without a cursor',async()=>{
    const resourceCoverage:SituationResourceCoverage={status:'partial',reason:'仅覆盖本站登记资源，未接入其他站点。'};
    const {service}=await setup(undefined,sourceObjects,resourceCoverage);
    const params={systemId:'situation',mode:'current',objectTypes:['resource'],limit:3};
    const first=current(await service.query('situation_query',params,seat));
    expect(first).toMatchObject({resourceCoverage,hasMore:true});
    const last=current(await service.query('situation_query',{...params,cursor:first.nextCursor},seat));
    expect(last).toMatchObject({resourceCoverage,hasMore:false,nextCursor:null});
    expect(last.items).toHaveLength(1);
  });
  it('preserves an empty partial response and leaves legacy responses unchanged',async()=>{
    const resourceCoverage:SituationResourceCoverage={status:'partial',reason:'仅登记部分区域，本次没有命中。'};
    const partial=await setup(undefined,[],resourceCoverage);
    expect(current(await partial.service.query('situation_query',{systemId:'situation',mode:'current'},seat))).toMatchObject({items:[],resourceCoverage,hasMore:false,nextCursor:null});
    const legacy=await setup();
    expect(current(await legacy.service.query('situation_query',{systemId:'situation',mode:'current'},seat))).not.toHaveProperty('resourceCoverage');
    const complete=await setup(undefined,[],{status:'complete'});
    expect(current(await complete.service.query('situation_query',{systemId:'situation',mode:'current'},seat))).toMatchObject({resourceCoverage:{status:'complete'}});
  });
  it('strictly rejects malformed coverage and does not add current-only coverage to changes',async()=>{
    const {service}=await setup();
    const result=await service.query('situation_query',{systemId:'situation',mode:'current'},seat);
    for(const resourceCoverage of [null,[],{}, {status:'unavailable'},{status:'partial'},{status:'partial',reason:''},{status:'partial',reason:'   '},{status:'partial',reason:'x'.repeat(1001)},{status:'complete',reason:1},{status:'complete',total:1}]) {
      expect(()=>decodeContextResponse('situation_query',result.query,{...result.data,resourceCoverage})).toThrow('来源返回的数据不符合查询契约');
    }
    const changes=await service.query('situation_query',{systemId:'situation',mode:'changes'},seat);
    expect(()=>decodeContextResponse('situation_query',changes.query,{...changes.data,resourceCoverage:{status:'complete'}})).toThrow();
  });
});

describe('optional source task and support discovery is implemented and gated',()=>{
  it('queries actual declared source relationships, task mapping and category with no inferred assignment',async()=>{
    const {service,mock}=await setup(capability,sourceObjects);
    const all=current(await service.queryTaskResources({systemId:'situation',taskId:'task-a'},seat));
    expect(all.items.map(item=>item.ref.objectId)).toEqual(['r1','r2']);
    const support=current(await service.queryTaskResources({systemId:'situation',taskId:'task-a',relation:'potential_support'},seat));
    expect(support.items.map(item=>item.ref.objectId)).toEqual(['r2']);
    expect(support.items[0].resourceData!.resource.taskRelations![0].relation).toBe('potential_support');
    const boats=current(await service.queryTaskResources({systemId:'situation',category:'rescue_boat'},seat));
    expect(boats.items.map(item=>item.ref.objectId)).toEqual(['r2']);
    expect(mock.requests.some(item=>item.path.includes('taskId=task-a')&&item.path.includes('relation=potential_support'))).toBe(true);
    const assigned=current(await service.queryTaskResources({systemId:'situation',taskId:'task-a',relation:'assigned'},seat));
    expect(assigned.items).toEqual([]);
  });
  it('keeps basic reads available when mapping or support rules are missing, while refusing unsupported discovery',async()=>{
    for(const cap of [{...capability,taskIdMapping:undefined},{...capability,supportRule:undefined},{...capability,taskIdMapping:'unimplemented-map'},{...capability,supportRule:{id:'nearby-distance',description:'Not implemented'}}]) {
      const {service,mock}=await setup(cap,sourceObjects);
      const before=current(await service.query('situation_query',{systemId:'situation',mode:'current',objectRefs:[sourceObjects[0].ref]},seat));
      expect(before.items.map(item=>item.ref.objectId)).toEqual(['r1']);
      await expect(service.queryTaskResources({systemId:'situation',taskId:'task-a',relation:'potential_support'},seat)).rejects.toMatchObject({code:'CONTEXT_UNSUPPORTED_FILTER'});
      expect(mock.requests).toHaveLength(1);
    }
  });
  it('source HTTP refuses undeclared filters independently of the host config',async()=>{
    const {url}=await setup();
    for(const query of ['taskId=task-a','category=fire_engine','taskId=task-a&relation=potential_support']) {
      const response=await fetch(`${url}/situation/objects?${query}`,{headers:{Authorization:`Bearer ${token}`}});
      expect(response.status).toBe(400);expect(await response.json()).toMatchObject({error:{code:'UNSUPPORTED_FILTER'}});
    }
  });
  it('rejects source responses that ignore the requested type, task or category',()=>{
    const payload={systemId:'situation',asOf:'2026-10-01T09:00:00+08:00',items:[sourceObjects[0]],limit:20,nextCursor:null,hasMore:false,timeUnknownCount:0,unknownRefs:[],changeCursor:'source-head'};
    for(const extra of [{objectTypes:['road']},{taskId:'task-b'},{taskId:'task-a',relation:'potential_support'},{category:'rescue_boat'}]) {
      const params=normalizeContextQuery('situation_query',{systemId:'situation',mode:'current',...extra});
      expect(()=>decodeContextResponse('situation_query',params,payload)).toThrow('来源返回的数据不符合查询契约');
    }
  });
  it('does not expose capability internals or bypass seat authorization',async()=>{
    const {service,mock}=await setup(capability,sourceObjects);
    expect(JSON.stringify(service.catalog('seat-a'))).not.toMatch(/token|baseUrl|taskIdMapping|supportRule/);
    await expect(service.queryTaskResources({systemId:'situation',taskId:'task-a'},{kind:'seat',seatId:'other'})).rejects.toMatchObject({code:'CONTEXT_FORBIDDEN'});
    expect(mock.requests).toEqual([]);
  });
});
