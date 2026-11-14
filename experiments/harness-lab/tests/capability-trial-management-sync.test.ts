import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, test, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AccessStore } from '../src/access/store.js';
import { openDatabase } from '../src/access/database.js';
import { CapabilityRoles } from '../src/access/capability-roles.js';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import type { AuthSession } from '../src/contracts/access.js';
import type { ExpertTrialRecord } from '../src/contracts/capability-management.js';
import type { ExpertTrialRunView } from '../src/contracts/capability-trials.js';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function setup(){
  const root=await mkdtemp(join(tmpdir(),'r2-trial-management-sync-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
  const db=await openDatabase(root);const access=new AccessStore(db);
  await access.saveAccount({username:'admin',displayName:'测试管理员',seatId:'a',seatName:'测试席位',password:'test-password-123',createPublicTask:false,manageModelSettings:false});
  CapabilityRoles.migrate(db);new CapabilityRoles(db).grant('admin');db.close();
  const config=testConfig(root,{seatId:'a',auth:{secret:'test-only-signing-key-at-least-32-characters',sessionMs:3600000}});
  const fake=await fakeRuntime(config,()=>({waitForAbort:true}));let constructions=0;let app:FastifyInstance|undefined;let lab!:PiLab;
  const start=async()=>{lab=await PiLab.create(config,fake.runtime);app=await createApp(lab,false,undefined,undefined,{runtimeFactory:async()=>{constructions++;return fake.runtime;}});};
  const stop=async()=>{const prior=app;app=undefined;await prior?.close();};cleanup.push(stop);await start();
  const first=await app!.inject('/api/auth/session');const anonymous=first.json<AuthSession>();
  const login=await app!.inject({url:'/api/auth/login',method:'POST',headers:{cookie:first.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':anonymous.csrf!},payload:{username:'admin',password:'test-password-123'}});
  expect(login.statusCode,login.body).toBe(200);const auth=login.json<AuthSession>();const actor={userId:auth.identity!.userId,seatId:'a'};
  const headers={cookie:login.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':auth.csrf!,'x-axon-view':auth.viewId!};
  const call=(url:string,payload?:object)=>app!.inject({url,method:payload?'POST':'GET',headers,...(payload?{payload}:{})});
  const detail=await lab.management!.create(actor,{clientActionId:randomUUID()});const id=detail.expert.expertId;
  const draft=await lab.management!.save(actor,id,{expectedDraftRevision:1,content:{name:'合成核对专家',description:'仅运行合成试用',instructions:'核对合成事实，禁止执行生产操作。',skillIds:[],allowedTools:[]}});
  const validation=await lab.management!.validate(actor,id,{expectedDraftRevision:draft.draftRevision});
  const input={expectedDraftRevision:draft.draftRevision,validationId:validation.validationId,input:'合成输入：计划10件、完成8件。',clientActionId:randomUUID()};
  const url=`/api/admin/capabilities/experts/${id}/trials`;
  const response=await call(url,input);expect(response.statusCode,response.body).toBe(200);const view=response.json<ExpertTrialRunView>();
  await vi.waitFor(()=>expect(fake.calls).toHaveLength(1),{timeout:10000});
  return {root,actor,id,input,url,trialId:view.trial.trialId,fake,call,start,stop,lab:()=>lab,constructions:()=>constructions};
}

test('admin revocation converges both native trial and management record without allowing another call',async()=>{
  const env=await setup();new CapabilityRoles(env.lab().access!.db).revoke('admin');
  await vi.waitFor(async()=>{
    const detail=await env.lab().management!.get(env.id);const trial=detail.trials.find(item=>item.trialId===env.trialId);
    expect(trial?.status).toBe('failed');expect(trial?.evidence?.success).toBe(false);
  },{timeout:10000});
  const stored=JSON.parse(await readFile(join(env.root,'capability-trials',env.trialId,'record.json'),'utf8')) as {trial:ExpertTrialRecord};
  expect(stored.trial.status).toBe('failed');expect(stored.trial.evidence?.success).toBe(false);
  expect(env.fake.calls).toHaveLength(1);expect(env.fake.calls[0].aborted).toBe(true);
  expect((await env.call(`${env.url}/${env.trialId}`)).statusCode).toBe(403);
  expect((await env.call(`${env.url}/${env.trialId}/confirm`,{approved:true,reason:'伪造确认',clientActionId:randomUUID()})).statusCode).toBe(403);
},30000);

test('restart reconciles trusted interrupted metadata to management without rebuilding or replaying a runtime',async()=>{
  const env=await setup();const path=join(env.root,'capability-trials',env.trialId,'record.json');
  // Capture an actual in-flight durable checkpoint before orderly close, then restore it as a crash fixture.
  const checkpoint=await readFile(path,'utf8');const running=JSON.parse(checkpoint) as {trial:ExpertTrialRecord};expect(running.trial.status).toBe('running');
  await env.stop();await writeFile(path,checkpoint);
  const cap=new DatabaseSync(join(env.root,'capabilities','capabilities.sqlite'));
  try{cap.prepare('UPDATE r2_trials SET data=? WHERE id=?').run(JSON.stringify(running.trial),env.trialId);}finally{cap.close();}
  await env.start();
  const core=(await env.lab().management!.get(env.id)).trials.find(item=>item.trialId===env.trialId)!;
  expect(core.status).toBe('interrupted');expect(core.evidence?.success).toBe(false);
  const response=await env.call(`${env.url}/${env.trialId}`);expect(response.statusCode,response.body).toBe(200);expect(response.json<ExpertTrialRunView>().trial.status).toBe('interrupted');
  const retry=await env.call(env.url,env.input);expect(retry.statusCode,retry.body).toBe(200);expect(retry.json<ExpertTrialRunView>().trial.status).toBe('interrupted');
  expect(env.constructions()).toBe(1);expect(env.fake.calls).toHaveLength(1);
},30000);


test('a denied prepared expert is rejected before work-input inspection or import',async()=>{
  const env=await setup();const lab=env.lab();const identity=lab.access!.identity(env.actor.userId)!;
  const task=lab.access!.create(identity,{title:'仅本人可见的合成任务',goal:'',visibility:'private',clientActionId:randomUUID()});
  const workspace=await lab.workspaces.ensureWorkspace(task.id,'a',task.title);
  const expert=await lab.capabilities.registerExpert({expertId:'prepared-admission-test',releaseVersion:'1.0.0',name:'准备中的核对专家',description:'用于准入检查',instructions:'只做合成核对。',modes:['interactive'],selectable:true,system:false,allowedTools:[],skills:[]});
  const action=randomUUID(),workItemId=randomUUID();
  await lab.capabilities.reserveCreation({principalId:env.actor.userId,seatId:'a',clientActionId:action,input:{workspaceId:workspace.id,seatId:'a',workItemId,expertRef:{expertId:expert.expertId,revisionId:expert.revisionId},expectedDigest:expert.digest},expertRef:expert,expectedDigest:expert.digest});
  const inspected=vi.spyOn(lab.collaboration!,'read').mockImplementation(()=>{throw new Error('Denied creation must not inspect or import work input');});
  const bindings=lab.workspaces.allBindings();lab.capabilities.setAccess(env.actor.userId,expert.expertId,false);
  await expect(lab.createSession(workspace.id,'a',workItemId,undefined,undefined,{userId:env.actor.userId,clientActionId:action,expertRef:{expertId:expert.expertId,revisionId:expert.revisionId},expectedDigest:expert.digest})).rejects.toMatchObject({code:'EXPERT_UNAVAILABLE'});
  expect(inspected).not.toHaveBeenCalled();expect(lab.workspaces.allBindings()).toEqual(bindings);expect(env.fake.calls).toHaveLength(1);
},30000);
