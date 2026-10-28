import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { ContextPrincipal, SituationObject } from '../../src/contracts/context.js';
import type { SpatialResult } from '../../src/contracts/spatial.js';
import type { BackgroundJob } from '../../src/contracts/background.js';
import type { BackgroundExecutionInput } from '../../src/background/executor.js';
import type { ContinuousStream, TaskDiscovery } from '../../src/contracts/continuous.js';
import { ContextService } from '../../src/context/service.js';
import { SpatialAnalysisService } from '../../src/spatial/service.js';
import { PiLab } from '../../src/pi/lab.js';
import { createBackgroundExecutor, snapshotBackgroundProfile } from '../../src/pi/background-runner.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';
import { resolveSpatialResult } from '../../src/pi/spatial-results.js';

const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
const ref=(objectType:string,objectId:string)=>({systemId:'situation',objectType,objectId});
const source=(objectType:string,objectId:string)=>({kind:'source' as const,systemId:'situation',objectRefs:[ref(objectType,objectId)]});
const empty={taskUpdates:[],unassigned:{significant:false,reason:'本轮已核对'},uncertainties:[]};
async function setup(reply:Parameters<typeof fakeRuntime>[1]) {
  const dataDir=await mkdtemp(join(tmpdir(),'background-spatial-'));cleanup.push(()=>rm(dataDir,{recursive:true,force:true}));
  const config=testConfig(dataDir),fake=await fakeRuntime(config,reply);
  const objects:SituationObject[]=[
    {ref:ref('road','route'),name:'实际路线',revision:1,areaIds:[],effectiveAt:null,validTime:null,geometry:{type:'LineString',coordinates:[[120,30.5],[122,30.5]]},properties:{passability:'open'}},
    {ref:ref('area','zone'),name:'封控区域',revision:1,areaIds:[],effectiveAt:null,validTime:null,geometry:{type:'Polygon',coordinates:[[[120.5,30],[121.5,30],[121.5,31],[120.5,31],[120.5,30]]]},properties:{memberRefs:[]}},
  ];
  const fetch=vi.fn<typeof globalThis.fetch>(async input=>{
    const params=new URL(String(input)).searchParams,selected=params.get('objectRefs');
    const refs=selected?JSON.parse(selected) as Array<{objectId:string}>:undefined;
    const items=objects.filter(item=>!refs || refs.some(r=>r.objectId===item.ref.objectId));
    return new Response(JSON.stringify({systemId:'situation',asOf:'2026-10-27T01:00:00Z',items,limit:100,nextCursor:null,hasMore:false,timeUnknownCount:0,unknownRefs:[],changeCursor:'v1'}),{headers:{'content-type':'application/json'}});
  });
  const context=new ContextService({systems:[{id:'situation',name:'态势',adapter:'mock-situation-http',baseUrl:'http://127.0.0.1:4991',tokenEnv:'TOKEN'}],scopes:[{id:'scope',name:'共同来源',systemIds:['situation'],seatIds:[]}]},{TOKEN:'synthetic'},{fetch});
  const lab=await PiLab.create(config,fake.runtime);cleanup.push(()=>lab.close());lab.context=context;
  const profile=await snapshotBackgroundProfile(lab,{id:'spatial',name:'空间研判',goal:'核对任务影响',instructions:'只读分析',tools:['spatial_analyze'],skillIds:[],agentIds:[],resources:[],contextScopeId:'scope'});
  const stream:ContinuousStream={id:randomUUID(),epochId:randomUUID(),sessionId:randomUUID(),name:'空间研判',profileId:profile.id,profile,sourceIds:['situation'],recipientSeatIds:[],enabled:true,state:'active',revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),createdByUserId:randomUUID(),pendingInputs:0};
  const next=(activeStream=stream)=>{
    const job:BackgroundJob={id:randomUUID(),kind:'continuous_analysis',streamEpochId:activeStream.epochId,batchId:randomUUID(),sessionId:activeStream.sessionId,requestId:randomUUID(),status:'running',revision:1,createdAt:new Date().toISOString()};
    const input:BackgroundExecutionInput={text:'按来源对象核对空间关系。',directory:join(dataDir,'background','streams',activeStream.epochId,activeStream.sessionId),profile,files:[],onEvent:()=>{},publish:async()=>{throw Error('no writes');},
      continuous:{stream:activeStream,batch:{id:job.batchId!,epochId:activeStream.epochId,jobId:job.id,inputIds:[],requiredTaskIds:[],createdAt:job.createdAt,inputCutoff:job.createdAt},inputs:[],requiredTaskIds:[]},
      readAnalysisCurrent:async()=>({items:[],total:0}),recordAnalysisUpdate:(value,_evidence,toolCallId)=>({update:{...value,taskUpdates:[],taskCoverage:undefined,toolCallId,recordedAt:new Date().toISOString()},published:false})};
    return {job,input};
  };
  const principal:Extract<ContextPrincipal,{kind:'service'}>={kind:'service',profileId:profile.id,jobId:randomUUID(),scope:profile.contextScope!};
  return {lab,config,fake,context,objects,fetch,profile,stream,next,principal,executor:createBackgroundExecutor(lab)};
}

it('uses real source geometry under the service principal without any foreground actor or annotation binding',async()=>{
  const s=await setup(()=>({text:'unused'}));
  const service=new SpatialAnalysisService(undefined,s.context),scope={principal:s.principal,signal:new AbortController().signal,check:()=>{},resolveResult:():SpatialResult=>{throw Error('foreign result');}};
  const result=await service.analyze({operation:'relate',relation:'intersects',input:source('road','route'),target:source('area','zone')},scope,randomUUID(),'relation');
  expect(result.values).toEqual({relation:'intersects',matches:true});expect(result.provenance).toHaveLength(2);expect(result.items[0].source?.revision).toBe(1);
  await expect(service.analyze({operation:'measure',metric:'length',input:{kind:'annotation',ref:{setId:randomUUID(),revision:1}}},scope,randomUUID(),'private')).rejects.toMatchObject({code:'SPATIAL_FORBIDDEN'});
  const before=s.fetch.mock.calls.length;
  await expect(service.analyze({operation:'measure',metric:'length',input:{kind:'source',systemId:'ungranted'}},scope,randomUUID(),'foreign')).rejects.toMatchObject({code:'CONTEXT_FORBIDDEN'});
  expect(s.fetch).toHaveBeenCalledTimes(before);
  const foreign={...result,provenance:[{input:{kind:'annotation' as const,ref:{setId:randomUUID(),revision:1}},queriedAt:result.createdAt,asOf:result.createdAt}]};
  await expect(service.analyze({operation:'read',resultRef:foreign.resultRef},{...scope,resolveResult:()=>foreign},randomUUID(),'derived')).rejects.toMatchObject({code:'SPATIAL_FORBIDDEN'});
  s.context.config.scopes[0].systemIds=[];
  await expect(service.analyze({operation:'read',resultRef:result.resultRef},{...scope,resolveResult:()=>result},randomUUID(),'revoked')).rejects.toMatchObject({code:'CONTEXT_FORBIDDEN'});
});

it('publishes native spatial evidence, reads the fixed result after source changes and restart, and rejects foreign sessions',async()=>{
  let resultRef='';
  const s=await setup((_context,index)=>index===0?{tools:[{name:'spatial_analyze',arguments:{operation:'relate',relation:'intersects',input:source('road','route'),target:source('area','zone')}}]}:index===1?{tools:[{name:'information_record_analysis_update',arguments:empty}]}:{text:'路线与区域相交。'});
  const first=s.next(),one=await s.executor.execute(first.job,first.input);
  expect(one.snapshot.lastResult?.status).toBe('succeeded');
  const spatial=one.snapshot.messages.find(m=>m.toolName==='spatial_analyze')!;
  expect(spatial.isError).toBe(false);expect(spatial.spatialResult?.values).toEqual({relation:'intersects',matches:true});
  resultRef=spatial.spatialResult!.resultRef;
  const names=s.fake.calls[0].context.tools!.map(t=>t.name);expect(names).toContain('spatial_analyze');expect(names).not.toContain('annotation_from_analysis');
  const schema=s.fake.calls[0].context.tools!.find(t=>t.name==='spatial_analyze')!.parameters;
  expect(JSON.stringify(schema)).not.toContain('setId');
  s.objects[0].geometry={type:'LineString',coordinates:[[125,35],[126,35]]};s.objects[0].revision=2;
  await s.lab.close();
  const fake=await fakeRuntime(s.config,(_context,index)=>index%2===0?{tools:[{name:'spatial_analyze',arguments:{operation:'read',resultRef}}]}:{text:'已读取固定历史'});
  const restored=await PiLab.create(s.config,fake.runtime);cleanup.push(()=>restored.close());restored.context=s.context;
  const executor=createBackgroundExecutor(restored),before=s.fetch.mock.calls.length;
  const fixed=await executor.read(first.job,s.profile);expect(fixed?.messages).toEqual(one.snapshot.messages);
  const second=s.next(),two=await executor.execute(second.job,second.input);
  expect(two.snapshot.messages.find(m=>m.toolName==='spatial_analyze')?.spatialResult).toEqual({...spatial.spatialResult,delivery:{requestId:second.job.requestId,toolCallId:'call-1-0'}});
  expect(s.fetch).toHaveBeenCalledTimes(before);
  const outsider=s.next({...s.stream,epochId:randomUUID(),sessionId:randomUUID()}),outside=await executor.execute(outsider.job,outsider.input);
  expect(outside.snapshot.messages.find(m=>m.toolName==='spatial_analyze')).toMatchObject({isError:true,spatialResult:null});
  expect(outside.snapshot.messages.find(m=>m.toolName==='spatial_analyze')?.text).toContain('SPATIAL_RESULT_NOT_FOUND');
  s.context.config.scopes[0].systemIds=[];
  const revoked=await executor.read(first.job,s.profile);
  expect(revoked?.messages.find(m=>m.toolName==='spatial_analyze')?.spatialResult).toBeNull();
  expect(revoked?.messages.find(m=>m.toolName==='spatial_analyze')?.text).not.toContain('实际路线');
  const third=s.next();await expect(executor.execute(third.job,third.input)).rejects.toMatchObject({code:'CONTEXT_FORBIDDEN'});
  expect(fake.calls).toHaveLength(4);
});

it('rejects corrupted successful spatial history before feeding it to a continued background model',async()=>{
  const s=await setup((_context,index)=>index===0?{tools:[{name:'spatial_analyze',arguments:{operation:'relate',relation:'intersects',input:source('road','route'),target:source('area','zone')}}]}:{text:'完成'});
  const first=s.next();await s.executor.execute(first.job,first.input);
  const directory=join(first.input.directory,'sessions'),file=join(directory,(await readdir(directory))[0]);
  const lines=(await readFile(file,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const entry=lines.find(value=>value.type==='message'&&value.message.role==='toolResult'&&value.message.toolName==='spatial_analyze');
  entry.message.details.spatialResult.items[0].name='被篡改的结果';
  await writeFile(file,lines.map(value=>JSON.stringify(value)).join('\n')+'\n');
  const next=s.next();await expect(s.executor.execute(next.job,next.input)).rejects.toMatchObject({code:'SPATIAL_RESULT_INVALID'});
  expect(s.fake.calls).toHaveLength(2);
});

it('keeps candidate computation evidence owned by its actual tool and rechecks source scope on fixed history',async()=>{
  let discovery:TaskDiscovery|undefined;
  const s=await setup((_context,index)=>index===0?{tools:[{name:'analysis_task_candidates',arguments:{}}]}:index===1?{tools:[{name:'spatial_analyze',arguments:{operation:'read',resultRef:discovery!.spatialResults[0].resultRef}}]}:index===2?{tools:[{name:'spatial_analyze',arguments:{operation:'measure',metric:'length',input:{kind:'result',resultRef:discovery!.spatialResults[0].resultRef}}}]}:{text:'已读取并复用候选工具内的固定计算依据。'});
  const first=s.next();
  first.input.readTaskCandidates=async(toolCallId,signal)=>{
    const result=await new SpatialAnalysisService(undefined,s.context).analyze({operation:'relate',relation:'intersects',input:source('road','route'),target:source('area','zone')},
      {principal:s.principal,signal:signal??new AbortController().signal,check:()=>{},resolveResult:()=>{throw Error('no prior results');}},first.job.requestId,`${toolCallId}:spatial:0`);
    discovery={schemaVersion:1,requestId:first.job.requestId,toolCallId,queriedAt:new Date().toISOString(),inputs:[{inputId:randomUUID(),objectRefs:[ref('area','zone')],resolved:true,reason:'来源指向区域'}],
      tasks:[{task:{id:randomUUID(),title:'配送任务',goal:'使用已分配路线',revision:1},candidate:'related',reason:'实际路线与封控区域相交',spatialResultRefs:[result.resultRef]}],spatialResults:[result]};
    return discovery;
  };
  const one=await s.executor.execute(first.job,first.input),message=one.snapshot.messages.find(m=>m.toolName==='analysis_task_candidates')!;
  expect(message.isError).toBe(false);expect(message.taskDiscovery).toEqual(discovery);expect(message.text).not.toContain('coordinates');
  expect(one.snapshot.messages.find(m=>m.toolName==='spatial_analyze')).toMatchObject({isError:false,spatialResult:{...discovery!.spatialResults[0],delivery:{requestId:first.job.requestId,toolCallId:'call-2-0'}}});
  expect(one.snapshot.messages.filter(m=>m.toolName==='spatial_analyze')[1]).toMatchObject({isError:false,spatialResult:{operation:'measure'}});
  expect((await s.executor.read(first.job,s.profile))?.messages.find(m=>m.toolName==='analysis_task_candidates')?.taskDiscovery).toEqual(discovery);
  const directory=join(first.input.directory,'sessions'),file=join(directory,(await readdir(directory))[0]);
  const entries=(await readFile(file,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const resultRef=discovery!.spatialResults[0].resultRef;
  expect(resolveSpatialResult(entries,resultRef)).toEqual(discovery!.spatialResults[0]);
  const forged=structuredClone(entries);
  forged.find(value=>value.type==='message'&&value.message.role==='assistant').message.content=[];
  expect(()=>resolveSpatialResult(forged,resultRef)).toThrow(/本会话没有可验证/);
  const tampered=structuredClone(entries);
  tampered.find(value=>value.type==='message'&&value.message.toolName==='analysis_task_candidates').message.details.taskDiscovery.tasks[0].task.title='伪造任务';
  expect(()=>resolveSpatialResult(tampered,resultRef)).toThrow(/本会话没有可验证/);
  await writeFile(file,tampered.map(value=>JSON.stringify(value)).join('\n')+'\n');
  const corrupt=s.next();await expect(s.executor.execute(corrupt.job,corrupt.input)).rejects.toMatchObject({code:'TASK_DISCOVERY_INVALID'});
  await writeFile(file,entries.map(value=>JSON.stringify(value)).join('\n')+'\n');
  s.context.config.scopes[0].systemIds=[];
  const revoked=await s.executor.read(first.job,s.profile),hidden=revoked?.messages.find(m=>m.toolName==='analysis_task_candidates');
  expect(hidden?.taskDiscovery).toBeNull();expect(hidden?.text).not.toContain('配送任务');
  const next=s.next();await expect(s.executor.execute(next.job,next.input)).rejects.toMatchObject({code:'CONTEXT_FORBIDDEN'});
  expect(s.fake.calls).toHaveLength(4);
});
