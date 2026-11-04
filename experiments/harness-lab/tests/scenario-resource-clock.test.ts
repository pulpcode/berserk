import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { WorkspaceStore } from '../src/workspaces/store.js';
import { AnnotationService } from '../src/annotations/service.js';
import { ContextService } from '../src/context/service.js';
import { TaskResourceService } from '../src/context/task-resources.js';
import { projectResourceResult, resourceResultValid } from '../src/contracts/resource-results.js';
import type { ScenarioClock } from '../src/contracts/scenarios.js';
import type { SituationObject } from '../src/contracts/context.js';

const clean:Array<()=>unknown|Promise<unknown>>=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-04T06:00:00Z'));});
afterEach(async()=>{vi.useRealTimers();for(const close of clean.splice(0).reverse())await close();});
async function setup() {
  const directory=await mkdtemp(join(tmpdir(),'axon-scene-clock-'));clean.push(()=>rm(directory,{recursive:true,force:true}));
  const db=await openDatabase(directory);clean.push(()=>db.close());const access=new AccessStore(db),userId=randomUUID();
  db.prepare('INSERT INTO seats(id,name,create_public,manage_model) VALUES(?,?,?,?)').run('a','A',1,0);
  db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,1)').run(userId,'a','A','a','salt','hash');
  const identity=access.identity(userId)!,task=access.create(identity,{title:'时钟核验',goal:'查询明确来源范围',visibility:'public',clientActionId:randomUUID()});
  const clocks:Record<string,ScenarioClock|undefined>={source:{instanceId:'run-test',businessNow:'2026-11-03T09:20:00+08:00',revision:1},second:{instanceId:'run-test',businessNow:'2026-11-03T09:20:00+08:00',revision:1}};
  const token='synthetic-clock-test';
  const server=createServer((req,res)=>{
    const url=new URL(req.url!,'http://localhost'),systemId=url.pathname.split('/')[1],clock=clocks[systemId],limit=Number(url.searchParams.get('limit')??20);
    if(req.headers.authorization!==`Bearer ${token}`){res.writeHead(401);res.end();return;}
    const ref={systemId,objectType:'resource',objectId:'run-test-V12'},evidence=[{kind:'source' as const,ref,revision:1}];
    const item:SituationObject={ref,name:'V12 检修车辆',revision:1,areaIds:['run-test-A03'],effectiveAt:'2026-11-03T09:10:00+08:00',validTime:null,properties:{},geometry:{type:'Point',coordinates:[121.79,30.90]},resourceData:{entityId:'run-test-V12',resource:{meaning:'actual_resource',category:'fire_engine',granularity:'individual',quantity:{value:1,unit:'辆',meaning:'entities',scope:'fleet',evidence},availability:{state:'unavailable',effectiveAt:'2026-11-03T09:10:00+08:00',validUntil:'2026-11-03T09:40:00+08:00',evidence},position:{meaning:'actual',appliesTo:'resource',evidence}}}};
    res.setHeader('content-type','application/json');res.end(JSON.stringify({systemId,asOf:clock?.businessNow??'2026-11-04T06:00:00Z',...(clock?{snapshotClock:clock}:{}),items:[item],limit,nextCursor:null,hasMore:false,timeUnknownCount:0,unknownRefs:[],changeCursor:'fixed'}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));clean.push(()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());}));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const configuration={systems:['source','second'].map(id=>({id,name:id,adapter:'mock-situation-http' as const,baseUrl:`${base}/${id}`,tokenEnv:'TEST_TOKEN',scenarioClock:true})),scopes:[{id:'scene',name:'场景',systemIds:['source','second'],seatIds:['a']}]};
  const context=new ContextService(configuration,{TEST_TOKEN:token});
  const workspaces=await WorkspaceStore.open(directory,'a',true);workspaces.access=access;const workspace=await workspaces.ensureWorkspace(task.id,'a',task.title),sessionId=randomUUID();await workspaces.bind(sessionId,workspace.id);
  const annotations=new AnnotationService(db,workspaces,access,context),actor=annotations.actorForSeat('a');
  const scope={actor,taskId:task.id,sessionId,signal:new AbortController().signal,check:()=>{},resolveMessage:()=>{throw new Error('未使用消息补充');}};
  const service=new TaskResourceService(annotations,context);
  const query=(sources=['source'])=>service.query({operation:'query',purpose:'data',sources:sources.map(systemId=>({systemId}))},scope,randomUUID(),'query');
  return {context,service,scope,clocks,configuration,query,token,access,identity,task};
}

describe('scene resource time is independent of the real execution date',()=>{
  it('uses a trusted scene clock for actual availability and preserves wall-clock audit fields',async()=>{
    const s=await setup(),first=await s.query();
    expect(first.schemaVersion).toBe(4);expect(first.statisticsScope.at).toBe('2026-11-03T09:20:00+08:00');expect(first.createdAt).toBe('2026-11-04T06:00:00.000Z');expect(first.items[0].availability).toBe('unavailable');expect(resourceResultValid(first)).toBe(true);
    vi.setSystemTime(new Date('2027-01-10T12:00:00Z'));const later=await s.query();
    expect(later.items).toEqual(first.items);expect(later.statisticsScope).toEqual(first.statisticsScope);expect(later.createdAt).not.toBe(first.createdAt);
    const model=projectResourceResult(later);expect(model).toHaveProperty('snapshotClock',s.clocks.source);expect(JSON.stringify(model)).toContain('真实处理时间');
  });
  it('keeps fixed summaries at their old scene time; expiry without repair confirmation becomes unknown',async()=>{
    const s=await setup(),first=await s.query();s.clocks.source={...s.clocks.source!,businessNow:'2026-11-03T09:41:00+08:00',revision:2};
    const current=await s.query();expect(current.items[0].availability).toBe('unknown');
    const summary=s.service.summarize({operation:'summarize',resultRef:first.resultRef,availability:'unavailable'},first,s.scope,randomUUID(),'summary');
    expect(summary.schemaVersion).toBe(4);expect(summary.items).toHaveLength(1);expect(summary.snapshotClock).toEqual(first.snapshotClock);expect(summary.statisticsScope.at).toBe(first.statisticsScope.at);expect(resourceResultValid(summary)).toBe(true);
    expect(resourceResultValid({...first,statisticsScope:{...first.statisticsScope,at:first.createdAt}})).toBe(false);
    expect(resourceResultValid({...first,schemaVersion:3})).toBe(false);
  });
  it('fails without a declared valid scene clock rather than falling back to real-time statistics',async()=>{
    const s=await setup();s.clocks.source=undefined;
    await expect(s.query()).rejects.toMatchObject({code:'CONTEXT_TIME_BASIS_CONFLICT'});
    s.clocks.source={instanceId:'run-test',businessNow:'2026-02-30T09:20:00+08:00',revision:1};
    await expect(s.query()).rejects.toMatchObject({code:'RESOURCE_TIME_BASIS_CONFLICT'});
  });
  it('rejects invalid scene time in task-linked context even if another linked resource has a valid clock',async()=>{
    const s=await setup();
    s.access.update(s.identity,s.task.id,s.task.revision,{context:{businessRefs:[{systemId:'source',objectType:'area',objectId:'run-test-A03'},{systemId:'second',objectType:'resource',objectId:'run-test-V12'}]}});
    s.clocks.source={instanceId:'run-test',businessNow:'2026-02-30T09:20:00+08:00',revision:1};
    await expect(s.service.query({operation:'query',purpose:'task'},s.scope,randomUUID(),'query')).rejects.toMatchObject({code:'RESOURCE_TIME_BASIS_CONFLICT'});
  });
  it('rejects mixed instance revisions and mixed real/scenario sources',async()=>{
    const s=await setup();s.clocks.second={...s.clocks.second!,revision:2};
    await expect(s.query(['source','second'])).rejects.toMatchObject({code:'RESOURCE_TIME_BASIS_CONFLICT'});
    s.clocks.second=undefined;s.context.config.systems[1].scenarioClock=false;
    await expect(s.query(['source','second'])).rejects.toMatchObject({code:'RESOURCE_TIME_BASIS_CONFLICT'});
  });
  it('does not grant time authority to a source merely because it supplies a clock',async()=>{
    const s=await setup();s.context.config.systems[0].scenarioClock=false;
    await expect(s.query()).rejects.toMatchObject({code:'CONTEXT_TIME_BASIS_CONFLICT'});
    expect(resourceResultValid({...await (async()=>{s.context.config.systems[0].scenarioClock=true;return s.query();})(),timeBasis:undefined})).toBe(false);
  });
});
