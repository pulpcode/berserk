import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../src/access/database.js';
import { AccessStore } from '../../src/access/store.js';
import { BackgroundService } from '../../src/background/service.js';
import { BackgroundStore } from '../../src/background/store.js';
import { ContinuousStore } from '../../src/background/continuous-store.js';
import { ContextService } from '../../src/context/service.js';
import { DockerExecutionService } from '../../src/execution/docker.js';
import { PiLab } from '../../src/pi/lab.js';
import { createBackgroundExecutor } from '../../src/pi/background-runner.js';
import { fakeRuntime, testConfig, type Reply } from '../pi/fake-runtime.js';
import type { BackgroundJob } from '../../src/contracts/background.js';
import type { Identity, TaskSpace } from '../../src/contracts/access.js';
import type { AnalysisUpdateInput, TaskDiscovery } from '../../src/contracts/continuous.js';

const cleanup:Array<()=>Promise<unknown>|void>=[];
afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();});
type Mode='evidence'|'calculate'|'quiet'|'significant'|'unassigned'|'missing'|'omit'|'race'|'wait'|'large'|'race-before-record'|'repair'|'repair-error'|'repair-wait'|'unrelated'|'input-repair';
async function setup(options:{inputText?:string;executionUnavailable?:boolean;timeoutMs?:number;beforeReply?:(stage:number)=>void;transformUpdate?:(update:AnalysisUpdateInput,stage:number,lastToolText:string)=>AnalysisUpdateInput}={}){
  const dir=await mkdtemp(join(tmpdir(),'axon-continuous-service-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));
  const db=await openDatabase(dir),access=new AccessStore(db),actors={} as Record<'a'|'b'|'c',Identity>;
  for(const name of ['a','b','c'] as const){const id=randomUUID();db.prepare('INSERT INTO seats(id,name,create_public,manage_model) VALUES(?,?,?,?)').run(name,name,1,0);db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,1)').run(id,name,name,name,'test-only','test-only');actors[name]=access.identity(id)!;}
  db.close();
  const config=testConfig(dir,{...(options.executionUnavailable?{execution:{enabled:true,image:'test-unused',cpus:1,memoryMb:256,pidsLimit:16,uid:1000,gid:1000}}:{}),...(options.timeoutMs?{agentRunTimeoutMs:options.timeoutMs}:{}),seatId:'a',auth:{secret:'continuous-test-auth-secret-32-characters',sessionMs:100000}});
  let task:TaskSpace,mode:Mode='quiet',raceDone=false;
  const stages=new Map<string,number>();
  const fake=await fakeRuntime(config,(context):Reply=>{
    const job=host.store.listJobs().find(j=>j.status==='running')!;
    const stage=stages.get(job.id)??0;stages.set(job.id,stage+1);options.beforeReply?.(stage);
    if(mode==='wait')return {waitForAbort:true};
    if(stage===0)return {tools:[{name:'analysis_task_candidates',arguments:{}}]};
    if(mode==='evidence'&&stage===1){
      const content=context.messages.at(-1)?.content;
      const data=JSON.parse(typeof content==='string'?content:content?.filter(b=>b.type==='text').map(b=>b.text).join('')??'{}') as TaskDiscovery;
      const source=data.assessmentSources!.find(e=>e.kind==='input'&&e.jobId!==job.id)??data.assessmentSources!.find(e=>e.kind==='input')!;
      expect(source.truncated).toBe(true);expect(source.text.length).toBeLessThanOrEqual(300);
      return {tools:[{name:'analysis_evidence_read',arguments:{id:source.id,offset:4900,limit:300}}]};
    }
    if(mode==='calculate'&&stage===1)return {tools:[{name:'analysis_calculate',arguments:{operation:'subtract',values:[3,3],unit:'辆',evidence:[{id:`task:${task.id}:${task.revision}`,quote:'3 辆'},{id:`task:${task.id}:${task.revision}`,quote:'3 辆'}]}}]};
    if(mode==='repair-wait' && stage>=2)return {waitForAbort:true};
    if((mode==='repair'||mode==='repair-wait') && stage===1)return {text:'已记录变化（实际遗漏）'};
    if(mode==='repair-error' && stage===2)return {text:'工具错误后仍试图结束'};
    if(stage===1 || (mode==='calculate'||mode==='evidence') && stage===2 || mode==='input-repair' && stage===2 || mode==='repair' && stage===2 || mode==='repair-error' && stage===3){if(mode==='race-before-record'&&!raceDone){raceDone=true;task=host.lab.access!.update(actors.a,task.id,task.revision,{goal:'查询后、记录前修改条件'});}
      if(mode==='missing')return {text:'未记录的普通答复'};
      const inputs=host.continuous.store.inputs(host.continuous.store.batch(job.batchId!));
      const update:AnalysisUpdateInput={taskUpdates:mode==='omit'||mode==='unrelated'?[]:[{taskId:task.id,inputIds:mode==='repair-error'&&stage===1?[randomUUID()]:inputs.map(i=>i.id),change:'changed',reason:'资料影响已复核',significant:mode==='significant'||mode==='repair'}],unassigned:{significant:mode==='unassigned',reason:'未归属事实已核对'},uncertainties:[]};
      const candidateMessage=[...context.messages].reverse().find(m=>m.role==='toolResult'&&m.toolName==='analysis_task_candidates');
      const candidateContent=candidateMessage?.content;
      const candidateText=typeof candidateContent==='string'?candidateContent:candidateContent?.filter(b=>b.type==='text').map(b=>b.text).join('')??'{}';
      const discovery=JSON.parse(candidateText) as TaskDiscovery;
      for(const item of update.taskUpdates){
        const old=discovery.assessmentBaselines?.find(b=>b.taskId===item.taskId)?.assessment?.conditions[0];
        const source=discovery.assessmentSources?.find(e=>e.kind==='task'&&e.id.includes(item.taskId));
        if(!source)throw new Error('Fixture requires the actual discovered task source');
        const status=item.significant?(old?.status==='blocked'?'met':'blocked'):(old?.status??'unknown');
        item.assessment={summary:'最终研判：保留仍有依据的判断。',conditions:[{id:old?.id??'new:任务条件',name:'任务条件',before:old?.status??null,status,kind:'inference',change:!old?'initial':status===old.status?'unchanged':'changed',reason:'资料影响已复核',significant:item.significant,evidence:[{id:source.id,quote:source.text}]}],recommendations:[]};
      }
      if(mode==='unrelated')update.taskCoverage=[{taskId:task.id,status:'unrelated',reason:'没有发现相关关键词'}];
      const previousContent=context.messages.at(-1)?.content;
      const lastToolText=typeof previousContent==='string'?previousContent:previousContent?.filter(block=>block.type==='text').map(block=>block.text).join('')??'';
      if(mode==='evidence'){const read=JSON.parse(lastToolText) as {id:string;text:string};expect(read.text).toContain('尾部车辆正常');update.taskUpdates[0].assessment!.conditions[0].evidence=[{id:read.id,quote:'尾部车辆正常'}];}
      if(mode==='calculate'){const calculated=JSON.parse(lastToolText) as {id:string};update.taskUpdates[0].assessment!.conditions[0].evidence=[{id:calculated.id,quote:lastToolText}];}
      return {text:'这是最终答复前的处理中说明',tools:[{name:'information_record_analysis_update',arguments:{...(options.transformUpdate?.(update,stage,lastToolText)??update)}}]};
    }
    if(mode==='race'&&!raceDone){raceDone=true;task=host.lab.access!.update(actors.a,task.id,task.revision,{goal:'人员已修订的新需求'});}
    return {text:mode==='large'?'证据字符'.repeat(80000):'最终研判：保留仍有依据的判断。'};
  });
  const lab=await PiLab.create(config,fake.runtime,options.executionUnavailable?new DockerExecutionService({instanceId:dir},async()=>{throw new Error('Fixture sandbox unavailable');}):undefined);cleanup.push(()=>lab.close());
  lab.context=new ContextService({systems:[{id:'intel',name:'资料',adapter:'mock-information-http',baseUrl:'http://127.0.0.1:1',tokenEnv:'TOKEN'}],scopes:[{id:'scope',name:'共同范围',systemIds:['intel'],seatIds:['a','b','c']}]},{TOKEN:'test-only'});
  const host=new BackgroundService(lab,{enabled:true,concurrency:1,modelConcurrency:1,backlogLimit:100,sources:['one','two'].map(sourceId=>({sourceId,name:sourceId,credentialRef:'TOKEN',allowedProfileIds:['profile'],allowedRecipientSeatIds:['a','b']})),profiles:[{id:'profile',name:'分析',goal:'比较变化',tools:['source_read','task_read','task_search'],contextScopeId:'scope',skillIds:[],agentIds:[],instructions:'',resources:[]}]});
  await host.initialize();cleanup.push(()=>host.close());
  for(const source of ['one','two'])host.store.grant('seat','a',source,'manage');host.store.grant('seat','c','one','view');
  task=lab.access!.create(actors.a,{title:'公共任务',goal:'车辆需求 3 辆',visibility:'public',clientActionId:randomUUID()});
  const stream=await host.continuous.configure(actors.a,{name:'共同持续研判',sourceIds:['one','two'],profileId:'profile',recipientSeatIds:['b'],enabled:true,quietMs:0,maxWaitMs:1},{clientActionId:randomUUID()});
  const accept=(id:string=randomUUID())=>host.accept('one',{sourceMessageId:id,title:'道路通知',text:options.inputText??'SOURCE_FACT:道路封闭，时间 10:00',occurredAt:'2026-10-26T10:00:00Z'});
  async function settled(count:number){await vi.waitFor(()=>{expect(host.store.listJobs()).toHaveLength(count);expect(host.store.listJobs().some(j=>j.status==='running'||j.status==='queued')).toBe(false);},{timeout:10000,interval:20});return host.store.listJobs()[0];}
  return {dir,lab,host,actors,stream,accept,settled,fake,setMode:(value:Mode)=>{mode=value;},task:()=>task,revise:()=>{task=lab.access!.update(actors.a,task.id,task.revision,{goal:`需求更新 ${task.revision}`});return task;}};
}

describe('continuous queue, native evidence and atomic publication',()=>{
  it('pages long source originals and restores the same historical source in the next round',async()=>{
    const s=await setup({inputText:'x'.repeat(5000)+'尾部车辆正常'});s.setMode('evidence');
    await s.accept();const first=await s.settled(1);
    const firstUpdate=s.host.continuous.store.publication(first.id).update!;
    expect(s.host.continuous.store.publication(first.id).status).toBe('published');
    const source=firstUpdate.assessmentSources!.find(e=>e.kind==='input')!;
    expect(source.text).toBe('');expect(source.excerpts).toEqual(['尾部车辆正常']);
    await s.accept();const next=await s.settled(2);
    expect(s.host.continuous.store.publication(next.id).status).toBe('published');
    const snapshot=await createBackgroundExecutor(s.lab).read(next,s.stream.profile);
    const read=snapshot!.messages.find(m=>m.requestId===next.requestId&&m.toolName==='analysis_evidence_read')!;
    expect(read.isError).toBeFalsy();expect(JSON.parse(read.text)).toMatchObject({id:source.id,offset:4900});
    expect(s.host.continuous.store.publication(next.id).update!.taskUpdates[0].assessment!.conditions[0].id).toBe(firstUpdate.taskUpdates[0].assessment!.conditions[0].id);
  });
  it('preserves the fixed candidate receipt when calculation adds evidence before recording',async()=>{
    const s=await setup();s.setMode('calculate');await s.accept();const job=await s.settled(1);
    expect(s.host.continuous.store.publication(job.id).status).toBe('published');
    const detail=await s.host.continuous.detail(s.actors.b,job.id);
    const snapshot=await createBackgroundExecutor(s.lab).read(job,s.stream.profile);
    const candidate=snapshot!.messages.find(m=>m.toolName==='analysis_task_candidates')!;
    const calculation=snapshot!.messages.find(m=>m.toolName==='analysis_calculate')!;
    expect(calculation.isError).toBeFalsy();
    expect(candidate.taskDiscovery!.assessmentSources!.some(e=>e.kind==='calculation')).toBe(false);
    expect(detail.update!.assessmentSources!.some(e=>e.kind==='calculation')).toBe(true);
    expect(detail.update!.taskUpdates[0].assessment!.conditions[0].evidence[0].quote).toBe(calculation.text);
    expect(snapshot!.messages.filter(m=>m.role==='user'&&m.text.includes('[系统补做提示'))).toHaveLength(0);
    expect(s.fake.calls).toHaveLength(4);
    const condition=detail.update!.taskUpdates[0].assessment!.conditions[0];
    await s.accept();const next=await s.settled(2);
    const nextDetail=await s.host.continuous.detail(s.actors.b,next.id);
    expect(nextDetail.update!.taskUpdates[0].previousJobId).toBe(job.id);
    expect(nextDetail.update!.taskUpdates[0].assessment!.conditions[0]).toMatchObject({id:condition.id,before:condition.status,change:'unchanged'});
    const historical=await s.host.continuous.readCurrent(s.stream.epochId,{jobId:job.id,section:'result'});
    expect(historical.detail!.update!.taskUpdates[0].assessment!.conditions[0]).toEqual(condition);
  });

  it.each(['repair','repair-error'] as const)('repairs %s using native follow-up in one request and publishes only the final result',async mode=>{
    const s=await setup();s.setMode(mode);await s.accept();const job=await s.settled(1);
    expect(s.host.continuous.store.publication(job.id).status).toBe('published');
    const detail=await s.host.continuous.detail(s.actors.b,job.id);
    expect(detail.text).toContain('最终研判：保留仍有依据的判断。');
    const snapshot=await createBackgroundExecutor(s.lab).read(job,s.stream.profile);
    expect(snapshot?.messages.filter(m=>m.role==='user'&&m.text.includes('[系统补做提示'))).toHaveLength(1);
    expect(snapshot?.messages.every(m=>m.requestId===job.requestId)).toBe(true);
    expect(snapshot?.turns).toHaveLength(1);
    expect(s.fake.calls).toHaveLength(mode==='repair'?4:5);
    expect(s.host.store.listDeliveries(job.id)).toHaveLength(mode==='repair'?1:0);
    expect(s.host.continuous.store.pending(s.stream.epochId)).toHaveLength(0);
    const restored=await createBackgroundExecutor(s.lab).read(job,s.stream.profile);expect(restored?.turns?.[0].finalMessageId).toBe(snapshot?.turns?.[0].finalMessageId);
  });
  it('caps missing-record repair at two and never reuses a previous round receipt',async()=>{
    const s=await setup();await s.accept();const first=await s.settled(1);const before=s.fake.calls.length;
    s.setMode('missing');await s.accept();const job=await s.settled(2);
    expect(s.fake.calls.length-before).toBe(4);
    const snapshot=await createBackgroundExecutor(s.lab).read(job,s.stream.profile);
    expect(snapshot?.messages.filter(m=>m.role==='user'&&m.text.includes('[系统补做提示'))).toHaveLength(2);
    expect(s.host.continuous.store.publication(job.id).status).toBe('unpublished');
    expect(s.host.continuous.store.stream(s.stream.epochId).state).toBe('paused');
    expect(s.host.continuous.store.baseline(s.stream.epochId,s.task().id)).toBe(first.id);
    expect(s.host.continuous.store.pending(s.stream.epochId)).toHaveLength(1);
    expect(s.host.store.listDeliveries(job.id)).toHaveLength(0);
  });
  it.each(['cancel','timeout'] as const)('keeps the original budget and pending inputs on repair %s',async ending=>{
    const s=await setup(ending==='timeout'?{timeoutMs:1500}:{});s.setMode('repair-wait');await s.accept();
    await vi.waitFor(()=>expect(s.fake.calls).toHaveLength(3));const job=s.host.store.listJobs()[0];
    expect(s.host.continuous.store.publication(job.id).status).not.toBe('published');
    expect(s.host.store.listDeliveries()).toHaveLength(0);await s.accept();
    expect(s.host.continuous.store.batch(job.batchId!).inputIds).toHaveLength(1);
    if(ending==='cancel')await s.host.cancel(s.actors.a,job.id,job.revision);
    await s.settled(1);expect(s.fake.calls).toHaveLength(3);expect(s.fake.calls[2].aborted).toBe(true);
    expect(s.host.continuous.store.pending(s.stream.epochId)).toHaveLength(2);
    expect(s.host.continuous.store.stream(s.stream.epochId).state).toBe('paused');
  });

  it('preserves native repair evidence and final identity after reopening the lab',async()=>{
    const s=await setup();s.setMode('repair');await s.accept();const job=await s.settled(1);
    const before=await createBackgroundExecutor(s.lab).read(job,s.stream.profile);
    await s.host.close();await s.lab.close();
    const restored=await PiLab.create(s.lab.config,s.fake.runtime);restored.context=s.lab.context;cleanup.push(()=>restored.close());
    const after=await createBackgroundExecutor(restored).read(job,s.stream.profile);
    expect(after?.turns).toEqual(before?.turns);expect(after?.messages).toEqual(before?.messages);
    expect(after?.messages.filter(m=>m.role==='user'&&m.text.includes('[系统补做提示'))).toHaveLength(1);
    expect(s.fake.calls).toHaveLength(4);
  });
  it('uses the existing stale-version reassessment instead of spending more repair attempts',async()=>{
    let change=()=>{};
    const s=await setup({beforeReply:stage=>{if(stage===2)change();}});
    await s.accept();await s.settled(1);
    change=()=>{change=()=>{};s.revise();};
    s.setMode('repair');await s.accept();await s.settled(3);
    const jobs=s.host.store.listJobs();
    const stale=jobs.find(j=>s.host.continuous.store.publication(j.id).status==='superseded')!;
    expect(stale).toBeDefined();
    const snapshot=await createBackgroundExecutor(s.lab).read(stale,s.stream.profile);
    expect(snapshot?.messages.filter(m=>m.role==='user'&&m.text.includes('[系统补做提示'))).toHaveLength(1);
    expect(s.host.continuous.current(s.actors.b,s.task().id).items[0].update?.taskUpdates[0].taskRevision).toBe(2);
    expect(s.host.continuous.store.pending(s.stream.epochId)).toHaveLength(0);
  });
  it('does not send a repair request after the fixed recipient authorization is revoked',async()=>{
    let revoke=()=>{};
    const s=await setup({beforeReply:stage=>{if(stage===1)revoke();}});
    revoke=()=>{s.host.config.sources[0].allowedRecipientSeatIds=['a'];};
    s.setMode('missing');await s.accept();const job=await s.settled(1);
    expect(s.fake.calls).toHaveLength(2);expect(job.status).toBe('failed');
    expect(s.host.continuous.store.publication(job.id).status).toBe('unpublished');
    expect(s.host.store.listDeliveries(job.id)).toHaveLength(0);
    expect(s.host.continuous.store.pending(s.stream.epochId)).toHaveLength(1);
  });
  it('publishes quiet native results for fixed recipient without notification or single-source leakage, preserves raw evidence and duplicate identity',async()=>{
    const s=await setup();const receipt=await s.accept('same');const job=await s.settled(1);
    expect(job.kind).toBe('continuous_analysis');expect(job.eventId).toBeUndefined();expect(s.host.store.listDeliveries()).toEqual([]);
    expect(await s.accept('same')).toEqual(receipt);expect(s.host.continuous.rounds(s.actors.b).total).toBe(1);expect(s.host.continuous.rounds(s.actors.c).total).toBe(0);
    const detail=await s.host.continuous.detail(s.actors.b,job.id);expect(s.fake.calls).toHaveLength(3);expect(detail.text).toContain('最终研判：保留仍有依据的判断。');expect(detail.processingText).toContain('处理中说明');expect(detail.inputs?.[0].event?.text).toContain('SOURCE_FACT');expect(detail.update?.taskUpdates[0].taskRevision).toBe(1);
    const historical=await s.host.continuous.readCurrent(s.stream.epochId,{jobId:job.id,section:'evidence'});expect(historical.detail?.inputs?.[0].event?.occurredAt).toBe('2026-10-26T10:00:00Z');
    expect(new ContinuousStore(new BackgroundStore(s.lab.access!.db)).publication(job.id).status).toBe('published');
  });
  it.each(['omit','unrelated'] as const)('rejects %s coverage for a task with unresolved association and preserves input after bounded repair',async mode=>{
    const s=await setup();s.setMode(mode);await s.accept();const job=await s.settled(1);
    expect(s.host.continuous.store.publication(job.id).status).toBe('unpublished');
    expect(s.host.continuous.store.pending(s.stream.epochId)).toHaveLength(1);
    expect(s.host.store.listDeliveries()).toHaveLength(0);
    const snapshot=await createBackgroundExecutor(s.lab).read(job,s.stream.profile);
    expect(snapshot?.messages.some(m=>m.role==='tool'&&m.isError&&m.text.includes('TASK_COVERAGE_MISSING'))).toBe(true);
    expect(snapshot?.messages.filter(m=>m.role==='user'&&m.text.includes('[系统补做提示'))).toHaveLength(2);
    expect(snapshot?.messages.find(m=>m.toolName==='analysis_task_candidates')?.taskDiscovery?.tasks).toHaveLength(1);
  });
  it('identifies a one-character UUID typo and lets the native same-request loop correct it from tool feedback',async()=>{
    let bad='',valid='',rejectedWithoutRecord=false;
    const s=await setup({transformUpdate:(update,stage,text)=>{
      if(stage===1){valid=update.taskUpdates[0].inputIds[0];bad=valid.slice(0,-1)+(valid.endsWith('0')?'1':'0');update.taskUpdates[0].inputIds=[bad];}
      else {
        const diagnostic=JSON.parse(text.slice(text.indexOf('{'),text.lastIndexOf('}')+1)) as {path:string;value:string;currentBatchInputIds:string[]};
        expect(text).toContain('INVALID_INPUT');expect(diagnostic).toEqual({path:'taskUpdates[0].inputIds[0]',value:bad,currentBatchInputIds:[valid]});
        const job=s.host.store.listJobs()[0];rejectedWithoutRecord=s.host.continuous.store.publication(job.id).update===undefined;
        update.taskUpdates[0].inputIds=[diagnostic.currentBatchInputIds[0]];
      }return update;
    }});
    s.setMode('input-repair');await s.accept();const job=await s.settled(1);
    expect(rejectedWithoutRecord).toBe(true);expect(s.fake.calls).toHaveLength(4);
    const publication=s.host.continuous.store.publication(job.id);expect(publication.status).toBe('published');expect(publication.update?.taskUpdates[0].inputIds).toEqual([valid]);
    const snapshot=await createBackgroundExecutor(s.lab).read(job,s.stream.profile);expect(snapshot?.messages.every(m=>m.requestId===job.requestId)).toBe(true);
    expect(snapshot?.messages.filter(m=>m.toolName==='information_record_analysis_update').map(m=>!!m.isError)).toEqual([true,false]);
    expect(s.host.continuous.store.pending(s.stream.epochId)).toHaveLength(0);
  });
  it.each(['empty','duplicate','unknown','change','reason','significant'] as const)('separates %s recording diagnostics without persisting an invalid update',async kind=>{
    let checked=false;
    const s=await setup({transformUpdate:update=>{
      const broken=structuredClone(update),item=broken.taskUpdates[0],job=s.host.store.listJobs()[0];
      if(kind==='empty')item.inputIds=[];if(kind==='duplicate')item.inputIds.push(item.inputIds[0]);if(kind==='unknown')item.inputIds=[randomUUID()];
      if(kind==='change')Object.assign(item,{change:'wrong'});if(kind==='reason')item.reason='';if(kind==='significant')Object.assign(item,{significant:'true'});
      const call=()=>s.host.continuous.record(job,broken,{queried:true,tasks:new Map()},'invalid-direct');
      expect(call).toThrow(kind==='empty'?'必须是非空输入引用数组':kind==='duplicate'?'输入引用重复':kind==='unknown'?'currentBatchInputIds':kind);
      expect(s.host.continuous.store.publication(job.id).update).toBeUndefined();checked=true;return update;
    }});
    await s.accept();const job=await s.settled(1);expect(checked).toBe(true);expect(s.host.continuous.store.publication(job.id).status).toBe('published');
  });
  it.each(['same-epoch','other-epoch'] as const)('retains %s historical input authorization and never repairs references automatically',async kind=>{
    let history:string|undefined=undefined;
    const s=await setup({transformUpdate:update=>{if(history)update.taskUpdates[0].inputIds=[history];return update;}});
    await s.accept();const first=await s.settled(1);history=s.host.continuous.store.batch(first.batchId!).inputIds[0];
    let epoch=s.stream.epochId;
    if(kind==='other-epoch'){
      const current=s.host.continuous.store.stream(epoch);
      epoch=(await s.host.continuous.configure(s.actors.a,{name:'新配置',sourceIds:current.sourceIds,profileId:current.profileId,recipientSeatIds:current.recipientSeatIds,enabled:true,quietMs:0,maxWaitMs:1},{id:current.id,revision:current.revision})).epochId;
    }
    await s.accept();const job=await s.settled(2),publication=s.host.continuous.store.publication(job.id);
    if(kind==='same-epoch'){expect(publication.status).toBe('published');expect(publication.update?.taskUpdates[0].inputIds).toEqual([history]);}
    else {
      expect(publication.status).toBe('unpublished');expect(publication.update).toBeUndefined();expect(s.host.continuous.store.pending(epoch)).toHaveLength(1);
      const snapshot=await createBackgroundExecutor(s.lab).read(job,s.stream.profile),error=snapshot?.messages.find(m=>m.toolName==='information_record_analysis_update'&&m.isError)?.text??'';
      expect(error).toContain(history);expect(error).toContain(JSON.stringify({path:'taskUpdates[0].inputIds[0]',value:history,currentBatchInputIds:s.host.continuous.store.batch(job.batchId!).inputIds}));
      expect(snapshot?.messages.filter(m=>m.role==='user'&&m.text.includes('[系统补做提示'))).toHaveLength(2);
      expect(s.host.continuous.store.baseline(s.stream.epochId,s.task().id)).toBe(first.id);
    }
  });
  it.each([false,true])('rejects a legal historical reference replacing required current task input; native correction=%s',async correct=>{
    let history:string|undefined=undefined,required:string|undefined=undefined,checked=false;
    const s=await setup({transformUpdate:(update,stage,text)=>{
      if(!history)return update;
      if(stage===2){
        const diagnostic=JSON.parse(text.slice(text.indexOf('{'),text.lastIndexOf('}')+1)) as {requiredTaskInputIssues:Array<{taskId:string;path:string;currentTaskRevisionInputIds:string[]}>};
        expect(diagnostic).toEqual({requiredTaskInputIssues:[{taskId:s.task().id,path:'taskUpdates[0].inputIds',currentTaskRevisionInputIds:[required]}]});
        expect(s.host.continuous.store.publication(s.host.store.listJobs()[0].id).update).toBeUndefined();checked=true;
        if(correct){update.taskUpdates[0].inputIds=[diagnostic.requiredTaskInputIssues[0].currentTaskRevisionInputIds[0]];return update;}
      }
      update.taskUpdates[0].inputIds=[history];return update;
    }});
    await s.accept();const first=await s.settled(1);history=s.host.continuous.store.batch(first.batchId!).inputIds[0];
    s.setMode('input-repair');s.revise();required=s.host.continuous.store.pending(s.stream.epochId)[0].id;await s.host.pump();const job=await s.settled(2);
    expect(checked).toBe(true);const publication=s.host.continuous.store.publication(job.id);
    const snapshot=await createBackgroundExecutor(s.lab).read(job,s.stream.profile);expect(snapshot?.messages.every(m=>m.requestId===job.requestId)).toBe(true);
    const records=snapshot?.messages.filter(m=>m.toolName==='information_record_analysis_update');expect(records?.map(m=>!!m.isError)).toEqual(correct?[true,false]:[true,true]);
    expect(publication.status).toBe(correct?'published':'unpublished');expect(s.host.continuous.store.pending(s.stream.epochId)).toHaveLength(correct?0:1);
    if(correct)expect(publication.update?.taskUpdates[0].inputIds).toEqual([required]);
    else {expect(publication.update).toBeUndefined();expect(s.host.continuous.store.baseline(s.stream.epochId,s.task().id)).toBe(first.id);expect(snapshot?.messages.filter(m=>m.role==='user'&&m.text.includes('[系统补做提示'))).toHaveLength(2);}
  });
  it.each(['missing','unknown','conflicting'] as const)('reports the specific %s task coverage IDs',async kind=>{
    let unknown='';const s=await setup({transformUpdate:update=>{
      if(kind==='missing')update.taskUpdates=[];
      if(kind==='unknown'){unknown=randomUUID();update.taskUpdates[0].taskId=unknown;}
      if(kind==='conflicting')update.taskCoverage=[{taskId:update.taskUpdates[0].taskId,status:'unrelated',reason:'猜测无关'}];
      return update;
    }});
    await s.accept();const job=await s.settled(1),snapshot=await createBackgroundExecutor(s.lab).read(job,s.stream.profile);
    const error=snapshot?.messages.find(m=>m.toolName==='information_record_analysis_update'&&m.isError)?.text??'';
    expect(error).toContain('TASK_COVERAGE_MISSING');expect(error).toContain(JSON.stringify(kind==='conflicting'?{conflictingTaskIds:[s.task().id],status:'unrelated',candidate:'uncertain',hasTaskUpdate:true}:{missingTaskIds:[s.task().id],unknownTaskIds:kind==='unknown'?[unknown]:[],conflictingTaskIds:[]}));
    expect(s.host.continuous.store.publication(job.id).status).toBe('unpublished');expect(s.host.continuous.store.pending(s.stream.epochId)).toHaveLength(1);
  });
  it('commits task revision trigger atomically and requires explicit reassessment; resume uses a new request/session without discarding pending input',async()=>{
    const s=await setup();await s.accept();const first=await s.settled(1);s.setMode('omit');const revised=s.revise();expect(s.host.continuous.store.pending(s.stream.epochId)[0]).toMatchObject({kind:'task_revision',task:{revision:revised.revision}});
    await s.host.pump();const incomplete=await s.settled(2);expect(incomplete.status).toBe('succeeded');expect(s.host.continuous.store.publication(incomplete.id).status).toBe('unpublished');expect(s.host.continuous.store.stream(s.stream.epochId).state).toBe('paused');expect(s.host.continuous.current(s.actors.b,s.task().id).items[0].jobId).toBe(first.id);
    await s.accept();expect(s.host.store.listJobs()).toHaveLength(2);s.setMode('quiet');const paused=s.host.continuous.store.stream(s.stream.epochId);s.host.continuous.control(s.actors.a,paused.epochId,{revision:paused.revision,action:'resume',clientActionId:randomUUID()});const recovered=await s.settled(3);
    expect(recovered.sessionId).not.toBe(first.sessionId);expect(s.host.continuous.store.pending(s.stream.epochId)).toHaveLength(0);expect(s.host.continuous.current(s.actors.b,s.task().id).items[0].update?.taskUpdates[0].taskRevision).toBe(2);
  });
  it('computes significant notification as task OR unassigned, leaves previous handling intact and does not notify quiet rounds',async()=>{
    const s=await setup();s.setMode('significant');await s.accept();await s.settled(1);await vi.waitFor(()=>expect(s.host.store.listDeliveries()[0]?.status).toBe('delivered'));const first=s.host.store.listDeliveries()[0];s.host.handleInbox(s.actors.b,first.id,{state:'completed',revision:1,clientActionId:randomUUID()});
    s.setMode('quiet');await s.accept();await s.settled(2);expect(s.host.store.listDeliveries()).toHaveLength(1);
    s.setMode('unassigned');await s.accept();await s.settled(3);await vi.waitFor(()=>expect(s.host.store.listDeliveries()).toHaveLength(2));expect(s.host.store.handling(first.id).state).toBe('completed');expect(s.host.store.listDeliveries().every(d=>d.eventId===undefined)).toBe(true);
    expect(new BackgroundStore(s.lab.access!.db).listDeliveries()).toHaveLength(2);
  });
  it('does not publish stale task observations, automatically reassesses preserved input and freezes each batch',async()=>{
    const s=await setup();await s.accept();await s.settled(1);s.setMode('race');await s.accept();await s.settled(3);
    const rounds=s.host.store.listJobs();const stale=rounds[1];expect(s.host.continuous.store.publication(stale.id).status).toBe('superseded');expect(s.host.continuous.store.batch(stale.batchId!).inputIds).toHaveLength(1);expect(s.host.continuous.store.batch(rounds[0].batchId!).inputIds).toHaveLength(2);expect(s.host.continuous.current(s.actors.b,s.task().id).items[0].update?.taskUpdates[0].taskRevision).toBe(2);
  });
  it('keeps missing recording distinguishable from quiet and makes configuration epoch changes isolate history and pending subscriptions',async()=>{
    const s=await setup();s.setMode('missing');await s.accept();const failed=await s.settled(1);expect(s.host.continuous.store.publication(failed.id).status).toBe('unpublished');expect(s.host.continuous.store.pending(s.stream.epochId)).toHaveLength(1);
    const previous=s.host.continuous.store.stream(s.stream.epochId),next=await s.host.continuous.configure(s.actors.a,{name:'新受众',sourceIds:['one','two'],profileId:'profile',recipientSeatIds:['a'],enabled:true,quietMs:0,maxWaitMs:1},{id:previous.id,revision:previous.revision});
    expect(next.sessionId).not.toBe(previous.sessionId);expect(s.host.continuous.store.source('one')?.epochId).toBe(next.epochId);expect(s.host.continuous.store.pending(previous.epochId)).toHaveLength(1);
    // A retired paused epoch can be explicitly recovered without receiving new inputs.
    const old=s.host.continuous.store.stream(previous.epochId);s.setMode('quiet');s.host.continuous.control(s.actors.a,old.epochId,{revision:old.revision,action:'resume',clientActionId:randomUUID()});await s.settled(2);expect(s.host.continuous.store.stream(old.epochId).state).toBe('retired');
    s.revise();expect(s.host.continuous.store.pending(old.epochId)).toHaveLength(0);expect(s.host.continuous.store.pending(next.epochId)).toHaveLength(1);
  });
  it('holds cancelled work and new inputs until explicit recovery',async()=>{
    const s=await setup();s.setMode('wait');await s.accept();await vi.waitFor(()=>expect(s.fake.calls.length).toBe(1));const running=s.host.store.listJobs()[0];await s.host.cancel(s.actors.a,running.id,running.revision);await s.settled(1);await s.accept();expect(s.host.continuous.store.pending(s.stream.epochId)).toHaveLength(2);expect(s.host.continuous.store.stream(s.stream.epochId).state).toBe('paused');expect(s.host.store.listJobs()).toHaveLength(1);
  });
  it('fails closed for altered or missing fixed native evidence on browser, model and continuation reads',async()=>{
    const s=await setup();await s.accept();const job=await s.settled(1);const original=structuredClone(job);
    s.host.store.saveJob({...job,result:{...job.result!,finalMessageId:'foreign-final'}});
    await expect(s.host.continuous.detail(s.actors.b,job.id)).rejects.toMatchObject({code:'CONTINUOUS_EVIDENCE_MISSING'});
    await expect(s.host.continuous.readCurrent(s.stream.epochId,{jobId:job.id})).rejects.toMatchObject({code:'CONTINUOUS_EVIDENCE_MISSING'});
    s.host.store.saveJob(original);
    const directory=join(s.dir,'background','streams',s.stream.epochId,s.stream.sessionId,'sessions');
    for(const file of await readdir(directory))if(file.endsWith('.jsonl'))await rm(join(directory,file));
    await expect(s.host.continuous.detail(s.actors.b,job.id)).rejects.toMatchObject({code:'CONTINUOUS_EVIDENCE_MISSING'});
    await expect(s.host.continuous.analysisOptions(s.actors.b,job.id,s.task().id)).rejects.toMatchObject({code:'CONTINUOUS_EVIDENCE_MISSING'});
  });
  it('makes oversized fixed evidence recoverable through exact bounded slices',async()=>{
    const s=await setup();s.setMode('large');await s.accept();const job=await s.settled(1);
    const index=await s.host.continuous.readCurrent(s.stream.epochId,{jobId:job.id,section:'evidence'});
    expect(index.detail?.text).toContain('最终研判：保留仍有依据的判断。');expect(index.evidenceIndex?.find(e=>e.id==='native-answer')?.length).toBe(320000);
    expect(index.detail?.text).not.toContain('证据字符');
    let text='',offset=0;
    for(;;){const slice=await s.host.continuous.readCurrent(s.stream.epochId,{jobId:job.id,evidenceId:'native-answer',textOffset:offset,textLimit:32000});expect(Buffer.byteLength(JSON.stringify(slice))).toBeLessThan(256*1024);text+=slice.evidence!.text;if(slice.evidence!.nextOffset===undefined)break;offset=slice.evidence!.nextOffset;}
    expect(text).toBe('证据字符'.repeat(80000));
    await expect(s.host.continuous.readCurrent(s.stream.epochId,{jobId:job.id,evidenceId:'tool:foreign'})).rejects.toMatchObject({code:'CONTINUOUS_NOT_FOUND'});
  });
  it('rolls back the public task edit if its durable revision input cannot commit',async()=>{
    const s=await setup();await s.accept();await s.settled(1);const before=s.lab.access!.get(s.task().id,s.actors.a.seatId);
    s.lab.access!.db.exec("CREATE TRIGGER reject_continuous_revision BEFORE INSERT ON continuous_inputs WHEN NEW.task_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'injected intake failure'); END");
    expect(()=>s.revise()).toThrow('injected intake failure');expect(s.lab.access!.get(before.id,s.actors.a.seatId)).toEqual(before);expect(s.host.continuous.store.pending(s.stream.epochId)).toHaveLength(0);
    s.lab.access!.db.exec('DROP TRIGGER reject_continuous_revision');
  });
  it('freezes bounded batches despite fresh arrivals and keeps overflow pending',async()=>{
    const s=await setup();const stream=s.host.continuous.store.stream(s.stream.epochId);s.host.continuous.store.save({...stream,quietMs:60000,maxWaitMs:60000});
    for(let i=0;i<33;i++){
      const event={id:randomUUID(),sourceId:'one',sourceMessageId:`batch-${i}`,title:'事实',receivedAt:new Date(1000+i).toISOString(),payloadHash:'a'.repeat(64),files:[],revision:1,continuousEpochId:stream.epochId};
      s.host.store.acceptEvent(event,{capacity:100,expectedRule:null});s.host.continuous.store.add({id:randomUUID(),epochId:stream.epochId,kind:'event',eventId:event.id,receivedAt:event.receivedAt,bytes:10});
    }
    s.host.continuous.store.enqueueDue(62000);const queued=s.host.store.listJobs()[0];expect(s.host.continuous.store.batch(queued.batchId!).inputIds).toHaveLength(32);expect(s.host.continuous.store.pending(stream.epochId)).toHaveLength(33);
    s.host.continuous.store.enqueueDue(1000000);expect(s.host.store.listJobs()).toHaveLength(1);expect(new BackgroundStore(s.lab.access!.db).listJobs()).toHaveLength(1);
  });

  it('automatically reassesses a task changed between native task query and metadata recording',async()=>{const s=await setup();s.setMode('race-before-record');await s.accept();await s.settled(2);const jobs=s.host.store.listJobs();expect(s.host.continuous.store.publication(jobs[1].id).status).toBe('superseded');expect(s.host.continuous.store.publication(jobs[0].id).status).toBe('published');expect(s.host.continuous.store.stream(s.stream.epochId).state).toBe('active');});

  it('queued cancellation stays resolved after resume and reopening recovery',async()=>{
    const s=await setup();const old=s.host.continuous.store.stream(s.stream.epochId);s.host.continuous.store.save({...old,quietMs:60000,maxWaitMs:60000});await s.accept();expect(s.host.store.listJobs()).toHaveLength(0);s.host.continuous.store.enqueueDue(Date.now()+60001);const queued=s.host.store.listJobs()[0];await s.host.cancel(s.actors.a,queued.id,queued.revision);expect(s.fake.calls).toHaveLength(0);const paused=s.host.continuous.store.stream(old.epochId);s.host.continuous.store.save({...paused,quietMs:0,maxWaitMs:1});s.host.continuous.control(s.actors.a,old.epochId,{revision:paused.revision,action:'resume',clientActionId:randomUUID()});await s.settled(2);s.host.continuous.store.recover();expect(s.host.continuous.store.stream(old.epochId).state).toBe('active');expect(s.host.store.getJob(queued.id).status).toBe('cancelled');
  });
  it('records already archived required tasks as skipped and accepts no new revisions from them',async()=>{
    const s=await setup();await s.accept();await s.settled(1);const revised=s.revise();const archived=s.lab.access!.update(s.actors.a,revised.id,revised.revision,{state:'archived'});expect(s.host.continuous.store.pending(s.stream.epochId)).toHaveLength(1);s.setMode('omit');await s.host.pump();const job=await s.settled(2);expect(s.host.continuous.store.publication(job.id)).toMatchObject({status:'published',archivedTaskIds:[archived.id]});s.lab.access!.update(s.actors.a,archived.id,archived.revision,{goal:'归档后说明修正'});expect(s.host.continuous.store.pending(s.stream.epochId)).toHaveLength(0);
  });

  it('runs readonly continuous jobs with an unavailable execution sandbox while preserving legacy prerequisites',async()=>{
    const s=await setup({executionUnavailable:true});
    expect(s.lab.info().files?.executionAvailable).not.toBe(true);await s.accept();const job=await s.settled(1);expect(s.host.continuous.store.publication(job.id).status).toBe('published');
  });
  it('selects an eligible queued epoch after more than 200 paused queued epochs',async()=>{
    const s=await setup(),db=s.lab.access!.db;let eligible='';
    s.host.store.transaction(()=>{for(let i=0;i<201;i++){
      const epochId=randomUUID(),jobId=randomUUID(),batchId=randomUUID(),inputId=randomUUID(),eventId=randomUUID(),time=new Date(1000+i).toISOString();
      const stream={...s.stream,epochId,sessionId:randomUUID(),state:i===200?'retired':'paused'};
      db.prepare('INSERT INTO continuous_streams VALUES(?,?,0,?)').run(epochId,stream.id,JSON.stringify(stream));
      const event={id:eventId,sourceId:'one',sourceMessageId:`paused-${i}`,title:'持久输入',receivedAt:time,payloadHash:'a'.repeat(64),files:[],revision:1,continuousEpochId:epochId};s.host.store.acceptEvent(event,{capacity:1000,expectedRule:null});
      s.host.continuous.store.add({id:inputId,epochId,kind:'event',eventId,receivedAt:time,bytes:1});
      const batch={id:batchId,epochId,jobId,inputIds:[inputId],requiredTaskIds:[],createdAt:time,inputCutoff:time};db.prepare('INSERT INTO continuous_batches VALUES(?,?,?,?)').run(batchId,epochId,jobId,JSON.stringify(batch));
      const job:BackgroundJob={id:jobId,kind:'continuous_analysis',batchId,streamEpochId:epochId,status:'queued',revision:1,createdAt:time,sessionId:stream.sessionId,requestId:randomUUID()};s.host.store.insertJob(job);if(i===200)eligible=job.id;
    }});
    expect(s.host.store.queuedJobs(1,{skipPausedContinuous:true})[0].id).toBe(eligible);expect(s.host.store.queuedJobs(200)).toHaveLength(200);expect(new BackgroundStore(db).queuedJobs(1,{skipPausedContinuous:true})[0].id).toBe(eligible);
  });

});
