import { fork } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { BackgroundService } from '../src/background/service.js';
import type { BackgroundJob } from '../src/contracts/background.js';
import type { ContinuousStream } from '../src/contracts/continuous.js';
import { PiLab } from '../src/pi/lab.js';
import { fakeRuntime } from './pi/fake-runtime.js';
import { crashCatalog, crashConfig, crashContext } from './fixtures/continuous-crash-child.js';

it('retains actual SIGKILL inputs and published baseline; resumes once with a fresh native session',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'axon-continuous-sigkill-'));
  const child=fork(fileURLToPath(new URL('./fixtures/continuous-crash-child.ts',import.meta.url)),[dataDir],{execArgv:['--import','tsx'],env:{...process.env,CONTINUOUS_CRASH_CHILD:'1'},stdio:['ignore','pipe','pipe','ipc']});
  let diagnostics='';child.stderr?.on('data',chunk=>{diagnostics+=String(chunk);});
  let service:BackgroundService|undefined,lab:PiLab|undefined;
  try {
    const state=await new Promise<{stream:ContinuousStream;first:BackgroundJob;second:BackgroundJob;pendingIds:string[]}>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error(`Child readiness timed out: ${diagnostics}`)),15000);
      child.once('message',message=>{clearTimeout(timer);const value=message as {error?:string;stream:ContinuousStream;first:BackgroundJob;second:BackgroundJob;pendingIds:string[]};if(value.error)reject(new Error(value.error));else resolve(value);});
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',(code,signal)=>{clearTimeout(timer);reject(new Error(`Unexpected child exit ${code}/${signal}: ${diagnostics}`));});
    });
    expect(state.first.status).toBe('succeeded');expect(state.second.status).toBe('running');expect(state.pendingIds).toHaveLength(1);
    const exit=once(child,'exit');expect(child.kill('SIGKILL')).toBe(true);expect((await exit)[1]).toBe('SIGKILL');
    const config=crashConfig(dataDir);
    const fake=await fakeRuntime(config,context=>context.messages.at(-1)?.role==='user'
      ?{tools:[{name:'information_record_analysis_update',arguments:{taskUpdates:[],unassigned:{significant:false,reason:'显式恢复核对输入'},uncertainties:[]}}]}
      :{text:'显式恢复后的固定结论'});
    lab=await PiLab.create(config,fake.runtime);lab.context=crashContext();service=new BackgroundService(lab,crashCatalog());await service.initialize();await service.start();
    const actor=lab.access!.identityForSeat('crash-seat')!;
    expect(service.store.getJob(state.second.id).status).toBe('interrupted');
    expect(service.store.listDeliveries()).toHaveLength(1);
    expect(service.store.listDeliveries()[0]).toMatchObject({jobId:state.first.id,status:'delivered'});
    const paused=service.continuous.store.stream(state.stream.epochId);expect(paused.state).toBe('paused');expect(paused.latestJobId).toBe(state.first.id);
    expect(service.continuous.store.pending(paused.epochId).map(input=>input.id)).toEqual(state.pendingIds);
    await service.pump();expect(fake.calls).toHaveLength(0);
    const previous=await service.continuous.detail(actor,state.first.id);expect(previous.text).toBe('SIGKILL 前已发布的固定结论');
    expect(previous.inputs?.some(input=>input.event?.text==='首次来源事实')).toBe(true);
    const action={revision:paused.revision,action:'resume' as const,clientActionId:randomUUID()};
    const resumed=service.continuous.control(actor,paused.id,action);expect(resumed.sessionId).not.toBe(state.second.sessionId);
    expect(service.continuous.control(actor,paused.id,action)).toEqual(resumed);
    await vi.waitFor(()=>expect(service!.continuous.store.pending(paused.epochId)).toHaveLength(0),{timeout:10000,interval:25});
    const jobs=service.store.listJobs();expect(jobs).toHaveLength(3);
    const recovered=jobs.find(job=>job.id!==state.first.id&&job.id!==state.second.id)!;
    expect(recovered.status).toBe('succeeded');expect(recovered.requestId).not.toBe(state.second.requestId);
    expect(service.store.getJob(state.second.id).status).toBe('interrupted');expect(fake.calls).toHaveLength(2);
    expect(service.store.listDeliveries()).toHaveLength(1);
    expect((await service.continuous.detail(actor,state.first.id)).text).toBe(previous.text);
  } finally {
    if(child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.kill('SIGKILL');await exit;}
    await service?.close();await lab?.close();await rm(dataDir,{recursive:true,force:true});
  }
},30000);
