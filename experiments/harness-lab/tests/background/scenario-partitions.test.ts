import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/access/database.js';
import { AccessStore } from '../../src/access/store.js';
import { BackgroundStore } from '../../src/background/store.js';
import { ContinuousService } from '../../src/background/continuous-service.js';
import type { BackgroundService } from '../../src/background/service.js';
import type { BackgroundExecutor } from '../../src/background/executor.js';
import { ContinuousStore, enqueueContinuousTaskChange } from '../../src/background/continuous-store.js';
import type { ContinuousStream, AnalysisUpdate } from '../../src/contracts/continuous.js';
import type { TaskSpace } from '../../src/contracts/access.js';

const cleanup:Array<()=>Promise<void>|void>=[];
afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();});
async function setup(){
  const dir=await mkdtemp(join(tmpdir(),'axon-scene-partitions-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));
  const db=await openDatabase(dir);cleanup.push(()=>db.close());const access=new AccessStore(db);
  await access.saveAccount({username:'a',displayName:'席位',seatId:'a',seatName:'席位',password:'test-password-123',createPublicTask:true,manageModelSettings:false});
  const actor=access.identityForSeat('a')!,background=new BackgroundStore(db),store=new ContinuousStore(background);
  const scope={scopeId:'sources',systemIds:['situation']},time=new Date().toISOString();
  const configuration:ContinuousStream={id:randomUUID(),epochId:randomUUID(),name:'持续研判',sourceIds:['scene'],profileId:'p',recipientSeatIds:['a'],enabled:true,quietMs:0,maxWaitMs:1,
    profile:{id:'p',name:'查询',goal:'核实',tools:['task_search'],skillIds:[],agentIds:[],instructions:'',resources:[],contextScopeId:'sources',contextScope:scope},sessionId:randomUUID(),state:'active',revision:1,createdAt:time,updatedAt:time,createdByUserId:actor.userId,pendingInputs:0};
  store.create(configuration);
  const task=(owner?:string)=>{const value=access.create(actor,{title:'相同任务名称',goal:'核实车辆',visibility:'public',clientActionId:randomUUID()});const task={...value,...(owner?{scenarioInstanceId:owner}:{})};db.prepare('UPDATE task_spaces SET data=? WHERE id=?').run(JSON.stringify(task),task.id);if(owner)db.prepare('DELETE FROM continuous_inputs WHERE task_id=?').run(task.id);return task;};
  return {db,access,actor,background,store,configuration,task};
}

describe('continuous scene and configuration partitions',()=>{
  it('separates native sessions, first task inputs, revisions and publication baselines',async()=>{
    const {db,background,store,configuration,task}=await setup(),a=`run-${randomUUID()}`,b=`run-${randomUUID()}`;
    const ta=task(a),tb=task(b),ordinary=task();
    const pa=store.forRun(configuration,a),pb=store.forRun(configuration,b);
    expect(pa.epochId).not.toBe(pb.epochId);expect(pa.sessionId).not.toBe(pb.sessionId);expect(pa.sessionId).not.toBe(configuration.sessionId);
    expect(store.forRun(configuration,a).sessionId).toBe(pa.sessionId);
    expect(store.pending(pa.epochId).map(i=>i.kind==='task_revision'?i.task.id:undefined)).toEqual([ta.id]);
    expect(store.pending(pb.epochId).map(i=>i.kind==='task_revision'?i.task.id:undefined)).toEqual([tb.id]);
    const revision:TaskSpace={...tb,revision:2,updatedAt:new Date(Date.now()+1).toISOString()};
    db.prepare('UPDATE task_spaces SET data=? WHERE id=?').run(JSON.stringify(revision),tb.id);enqueueContinuousTaskChange(db,revision);
    expect(store.pending(pa.epochId)).toHaveLength(1);expect(store.pending(pb.epochId)).toHaveLength(2);
    expect(store.pending(configuration.epochId).every(i=>i.kind==='task_revision'&&i.task.id===ordinary.id)).toBe(true);
    store.enqueueDue(Date.now()+1000,id=>id===a);
    const job=background.listJobs().find(j=>j.scenarioInstanceId===a)!;expect(job).toBeDefined();expect(background.listJobs().some(j=>j.scenarioInstanceId===b)).toBe(false);expect(job.sessionId).toBe(pa.sessionId);
    background.claimJob(job.id,{sessionId:job.sessionId!,model:'fixture',modelSettingsVersion:'fixture'});
    const batch=store.batch(job.batchId!);
    const update:AnalysisUpdate={taskCoverage:[{taskId:ta.id,taskRevision:ta.revision,taskTitle:ta.title,status:'assessed',reason:'已核实'}],taskUpdates:[{taskId:ta.id,taskRevision:ta.revision,taskTitle:ta.title,inputIds:batch.inputIds,change:'initial',reason:'已核实',significant:false}],unassigned:{significant:false,reason:'无其他信息'},uncertainties:[],toolCallId:'fixed-tool',recordedAt:new Date().toISOString()};
    const running=background.getJob(job.id),finished=background.finishJob(job.id,running.revision,{status:'succeeded',result:{sessionId:job.sessionId!,requestId:job.requestId,finalMessageId:'final',files:[]}});
    expect(store.publish(finished,update)).toBe(true);expect(store.baseline(pa.epochId,ta.id)).toBe(job.id);expect(store.baseline(pb.epochId,ta.id)).toBeUndefined();
    const reopened=new ContinuousStore(new BackgroundStore(db));expect(reopened.baseline(pa.epochId,ta.id)).toBe(job.id);expect(reopened.pending(pb.epochId)).toHaveLength(2);
  });
  it('creates a fresh partition on configuration edit and rejects cross-run coverage',async()=>{
    const {store,background,configuration,task}=await setup(),a=`run-${randomUUID()}`,b=`run-${randomUUID()}`;
    const ta=task(a),tb=task(b),pa=store.forRun(configuration,a);
    const changed={...configuration,epochId:randomUUID(),sessionId:randomUUID(),revision:2};store.create(changed,configuration);
    const next=store.forRun(changed,a);expect(next.epochId).not.toBe(pa.epochId);expect(next.sessionId).not.toBe(pa.sessionId);expect(next.configurationEpochId).toBe(changed.epochId);
    store.enqueueDue(Date.now()+1000,id=>id===a);
    const job=background.listJobs().find(j=>j.streamEpochId===next.epochId)!;
    const update:AnalysisUpdate={taskCoverage:[{taskId:tb.id,taskRevision:tb.revision,taskTitle:tb.title,status:'assessed',reason:'错误范围'}],taskUpdates:[],unassigned:{significant:false,reason:'无'},uncertainties:[],toolCallId:'wrong',recordedAt:new Date().toISOString()};
    expect(store.publicationIssue(job,update)).toBe('stale');expect(store.pending(next.epochId).every(i=>i.kind==='task_revision'&&i.task.id===ta.id)).toBe(true);
  });
  it('projects the active execution health and resumes that exact partition only',async()=>{
    const {access,actor,background,store,configuration}=await setup(),a=`run-${randomUUID()}`,b=`run-${randomUUID()}`;
    let active=a;
    const writable=(id?:string)=>id===undefined||id===active;
    const host={store:background,config:{profiles:[configuration.profile]},lab:{access,scenario:{activeId:()=>active}},
      assertContext:()=>{},assertRun:(id?:string)=>{if(!writable(id))throw new Error('readonly');},runVisible:writable,
      permission:()=>{},source:()=>({allowedProfileIds:['p'],allowedRecipientSeatIds:['a']}),pump:async()=>{}} as unknown as BackgroundService;
    const executor={execute:async()=>{throw new Error('No model allowed');},read:async()=>null,cancel:async()=>{}} satisfies BackgroundExecutor;
    const service=new ContinuousService(host,executor),partition=store.forRun(configuration,a);
    store.pause(partition.epochId,'原处理未完成，等待显式恢复。');
    const paused=store.stream(partition.epochId),projection=service.publicStream(configuration);
    expect(projection.epochId).toBe(configuration.epochId);expect(projection.revision).toBe(configuration.revision);
    expect(projection.execution).toMatchObject({epochId:paused.epochId,revision:paused.revision,state:'paused',pauseReason:'原处理未完成，等待显式恢复。'});
    const resumed=service.control(actor,paused.epochId,{revision:paused.revision,action:'resume',clientActionId:randomUUID()});
    expect(resumed.state).toBe('active');expect(resumed.sessionId).not.toBe(partition.sessionId);
    active=b;store.forRun(configuration,b);
    expect(()=>service.control(actor,resumed.epochId,{revision:resumed.revision,action:'pause',clientActionId:randomUUID()})).toThrow('readonly');
    expect(service.publicStream(configuration).execution?.epochId).not.toBe(resumed.epochId);
  });

});
