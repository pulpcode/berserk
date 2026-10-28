import { randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach,expect,it,vi } from 'vitest';
import { openDatabase } from '../../src/access/database.js';
import { AccessStore } from '../../src/access/store.js';
import { ContextService } from '../../src/context/service.js';
import { discoverTasks } from '../../src/background/task-discovery.js';
import { BackgroundStore } from '../../src/background/store.js';
import { ContinuousStore } from '../../src/background/continuous-store.js';
import { extractTaskDiscovery,projectTaskDiscovery,type ContinuousInput,type ContinuousStream } from '../../src/contracts/continuous.js';
import type { BackgroundEvent } from '../../src/contracts/background.js';
import type { TaskBusinessRef } from '../../src/contracts/access.js';
import type { SituationObject,ContextRef } from '../../src/contracts/context.js';
import { TaskQueryService } from '../../src/context/task-query.js';

const clean:Array<()=>unknown|Promise<unknown>>=[];
afterEach(async()=>{for(const fn of clean.splice(0).reverse())await fn();});
const time='2026-10-27T01:00:00Z';
const ref=(objectType:string,objectId:string):ContextRef=>({systemId:'situation',objectType,objectId});
const zone:SituationObject={ref:ref('area','z'),name:'无关名称甲',revision:1,areaIds:['tag-z'],effectiveAt:time,validTime:null,properties:{memberRefs:[]},geometry:{type:'Polygon',coordinates:[[[120,30],[120.02,30],[120.02,30.02],[120,30.02],[120,30]]]}};
const road=(id:string,coordinates:[number,number][]):SituationObject=>({ref:ref('road',id),name:'同名道路',revision:1,areaIds:['tag-route'],effectiveAt:time,validTime:null,properties:{passability:'open'},geometry:{type:'LineString',coordinates}});
async function setup() {
  const dir=await mkdtemp(join(tmpdir(),'task-discovery-'));clean.push(()=>rm(dir,{recursive:true,force:true}));
  const db=await openDatabase(dir);clean.push(()=>db.close());const access=new AccessStore(db);
  const id=randomUUID();db.prepare('INSERT INTO seats(id,name,create_public,manage_model) VALUES(?,?,?,?)').run('a','甲',1,0);db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,1)').run(id,'a','a','a','unused','unused');const actor=access.identity(id)!;
  const objects=[zone,road('r1',[[119.99,30.01],[120.03,30.01]]),road('r2',[[120.1,30.1],[120.11,30.1]])].map(o=>structuredClone(o));
  let mode:'normal'|'failure'|'missing'|'version'|'geometry'|'snapshot'='normal',zoneReads=0;
  const fetch=vi.fn<typeof globalThis.fetch>(async input=>{
    const url=new URL(String(input));
    if(mode==='failure')return new Response('unavailable',{status:503});
    const meta={systemId:url.hostname==='intel.local'?'intel':'situation',asOf:time};
    const report={reportId:'notice',subjectId:'notice',revision:1,title:'封控',summary:'09:00—12:00禁止进入',objectRefs:[zone.ref],areaIds:[],observedAt:time,publishedAt:time,validTime:null};
    if(url.hostname==='intel.local')return Response.json(url.pathname==='/reports'?{...meta,items:[report],limit:100,nextCursor:null,hasMore:false,timeUnknownCount:0}:{...meta,item:{...report,content:'区域内禁止进入；以正式对象边界为准。'}});
    const refs=JSON.parse(url.searchParams.get('objectRefs')??'null') as ContextRef[]|null;
    const items=objects.filter(o=>!refs||refs.some(r=>JSON.stringify(r)===JSON.stringify(o.ref))).map(o=>structuredClone(o));
    if(items.some(o=>o.ref.objectId==='z'))zoneReads++;
    if(mode==='missing')for(const o of items)if(o.ref.objectId==='r1')delete o.geometry;
    if(zoneReads>1){for(const o of items)if(o.ref.objectId==='z'){if(mode==='version')o.revision=2;if(mode==='geometry'&&o.geometry?.type==='Polygon')o.geometry.coordinates[0][1][0]=120.025;}}
    return Response.json({...meta,...(mode==='snapshot'&&zoneReads>1?{asOf:'2026-10-27T01:01:00Z'}:{}),items,limit:100,nextCursor:null,hasMore:false,timeUnknownCount:0,unknownRefs:refs?.filter(r=>!items.some(o=>JSON.stringify(o.ref)===JSON.stringify(r)))??[],changeCursor:'fixed'});
  });
  const context=new ContextService({systems:[{id:'intel',name:'报告',adapter:'mock-information-http',baseUrl:'http://intel.local',tokenEnv:'INTEL'},{id:'situation',name:'态势',adapter:'mock-situation-http',baseUrl:'http://situation.local',tokenEnv:'SITUATION'}],scopes:[{id:'scope',name:'范围',systemIds:['intel','situation'],seatIds:['a']}]},{INTEL:'test-only',SITUATION:'test-only'},{fetch});
  const task=(title:string,refs?:TaskBusinessRef[],visibility:'public'|'private'='public')=>access.create(actor,{title,goal:'从仓库配送至医院，按既定计划执行。',visibility,clientActionId:randomUUID(),...(refs?{context:{businessRefs:refs}}:{})});
  const event={id:randomUUID(),systemId:'intel',subjectId:'notice'} as BackgroundEvent;
  const inputs:ContinuousInput[]=[{id:randomUUID(),epochId:randomUUID(),receivedAt:time,bytes:1,kind:'event',eventId:event.id}];
  const scope={principal:{kind:'service' as const,profileId:'profile',jobId:randomUUID(),scope:context.scopeSnapshot('scope')},requestId:randomUUID(),toolCallId:'discover',signal:new AbortController().signal,check:()=>{},baseline:(id:string):string|undefined=>{void id;return undefined;}};
  return {access,actor,db,context,task,event,inputs,scope,fetch,objects,setMode:(value:typeof mode)=>{mode=value;},run:()=>discoverTasks(access,context,inputs,()=>event,scope)};
}
it('finds geometry-linked tasks without keywords and preserves per-task candidate evidence and uncertain gaps',async()=>{
  const s=await setup(),a=s.task('甲',[{...ref('road','r1'),role:'route'}]),b=s.task('乙',[{...ref('road','r1'),role:'route'}]),c=s.task('丙',[{...ref('road','r2'),role:'route'}]),d=s.task('缺路线');s.task('私有',undefined,'private');
  const result=await s.run();
  expect(result.tasks.map(t=>[t.task.id,t.candidate]).sort()).toEqual([[a.id,'related'],[b.id,'related'],[c.id,'unrelated'],[d.id,'uncertain']].sort());
  expect(result.spatialResults).toHaveLength(2);expect(result.tasks.find(t=>t.task.id===a.id)?.spatialResultRefs).toEqual(result.tasks.find(t=>t.task.id===b.id)?.spatialResultRefs);
  expect(result.inputs[0]).toMatchObject({resolved:true,objectRefs:[zone.ref]});expect(result.sourceQueries?.some(q=>'item' in q.data&&q.data.item.reportId==='notice')).toBe(true);
  const text=JSON.stringify(projectTaskDiscovery(result));expect(extractTaskDiscovery({taskDiscovery:result},'analysis_task_candidates',false,text)).toEqual(result);
  expect(extractTaskDiscovery({taskDiscovery:result},'spatial_analyze',false,text)).toBeNull();
  const changed=structuredClone(result);changed.spatialResults[0].toolCallId='other';expect(extractTaskDiscovery({taskDiscovery:changed},'analysis_task_candidates')).toBeNull();
  const invalidSource=structuredClone(result);Object.assign(invalidSource.sourceQueries![0].data,{items:{}});expect(extractTaskDiscovery({taskDiscovery:invalidSource},'analysis_task_candidates')).toBeNull();
});
it('enumerates all task pages when a compound query finds nothing, and exposes a limit instead of truncating',async()=>{
  const s=await setup();for(let i=0;i<23;i++)s.task(`任务${i}`);
  expect(new TaskQueryService(s.access).search({query:'东桥 封闭 车辆'},s.scope.principal).data.items).toEqual([]);
  delete s.event.subjectId;const result=await s.run();expect(result.tasks).toHaveLength(23);expect(result.tasks.every(t=>t.candidate==='uncertain')).toBe(true);expect(s.fetch).not.toHaveBeenCalled();
  for(let i=23;i<101;i++)s.task(`任务${i}`);await expect(s.run()).rejects.toMatchObject({code:'TASK_DISCOVERY_LIMIT'});
});
it.each(['failure','missing'] as const)('retains %s gaps even for a previously assessed task',async mode=>{
  const s=await setup(),task=s.task('甲',[{...ref('road','r1'),role:'route'}]);s.scope.baseline=id=>id===task.id?'previous':undefined;s.setMode(mode);
  const result=await s.run();expect(result.tasks[0].candidate).toBe('related');expect(result.tasks[0].reason).toContain('资料缺口');expect(result.tasks[0].reason).toMatch(/核实|GEOMETRY/);
});
it.each(['version','geometry','snapshot'] as const)('refuses cross-calculation %s drift',async mode=>{
  const s=await setup();s.task('甲',[{...ref('road','r1'),role:'route'}]);s.task('乙',[{...ref('road','r2'),role:'route'}]);s.setMode(mode);
  await expect(s.run()).rejects.toMatchObject({code:'TASK_DISCOVERY_INCOMPLETE'});
});
it('rechecks a former relation even when geometry is now disjoint and never turns an unbound event into an unrelated judgment',async()=>{
  const s=await setup(),task=s.task('甲',[{...ref('road','r2'),role:'route'}]);s.scope.baseline=id=>id===task.id?'previous':undefined;
  expect((await s.run()).tasks[0]).toMatchObject({candidate:'related',reason:expect.stringContaining('撤回')});
  s.scope.baseline=()=>undefined;delete s.event.subjectId;expect((await s.run()).tasks[0].candidate).toBe('uncertain');
});
it('queues public creation and no-baseline edits atomically only to current eligible streams',async()=>{
  const s=await setup(),store=new ContinuousStore(new BackgroundStore(s.db));
  const stream=(systems:string[],enabled=true):ContinuousStream=>({id:randomUUID(),epochId:randomUUID(),revision:1,profileId:'p',name:'流',sourceIds:[randomUUID()],recipientSeatIds:['a'],enabled,sessionId:randomUUID(),state:'active',createdAt:time,updatedAt:time,createdByUserId:s.actor.userId,pendingInputs:0,profile:{id:'p',name:'p',goal:'分析',tools:[],skillIds:[],agentIds:[],instructions:'',resources:[],contextScope:{scopeId:'s',systemIds:systems}}});
  const current=store.create(stream(['situation'])),foreign=store.create(stream(['other'])),disabled=store.create(stream(['situation'],false));
  const task=s.task('新建',[{...ref('road','r1'),role:'route'}]);expect(store.pending(current.epochId)).toHaveLength(1);expect(store.pending(foreign.epochId)).toHaveLength(0);expect(store.pending(disabled.epochId)).toHaveLength(0);
  s.access.update(s.actor,task.id,task.revision,{goal:'条件修订'});expect(store.pending(current.epochId)).toHaveLength(2);
  s.task('私有',[{...ref('road','r1'),role:'route'}],'private');expect(store.pending(current.epochId)).toHaveLength(2);
  const next=store.create({...stream(['situation']),id:current.id,revision:2,sourceIds:current.sourceIds},current);
  const latest=s.access.get(task.id,s.actor.seatId);s.access.update(s.actor,task.id,latest.revision,{goal:'再次修订'});expect(store.pending(current.epochId)).toHaveLength(2);expect(store.pending(next.epochId)).toHaveLength(1);
  const before=s.access.listActivePublic().length;s.db.exec('BEGIN IMMEDIATE');s.access.createInTransaction(s.actor,{title:'回滚',goal:'测试',visibility:'public',clientActionId:randomUUID()});s.db.exec('ROLLBACK');expect(s.access.listActivePublic()).toHaveLength(before);expect(store.pending(next.epochId)).toHaveLength(1);
});
it('persists explicit business roles and rejects ambiguous duplicate roles',async()=>{
  const s=await setup(),task=s.task('角色',[{...ref('road','r1'),role:'route'}]);expect(new AccessStore(s.db).get(task.id,s.actor.seatId).context?.businessRefs?.[0].role).toBe('route');
  expect(()=>s.task('冲突',[{...ref('road','r1'),role:'route'},{...ref('road','r1'),role:'reference'}])).toThrow();
});
