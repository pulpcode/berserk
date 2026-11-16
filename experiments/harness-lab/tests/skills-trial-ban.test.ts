import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { migrateAdministratorAccounts } from '../src/access/administrator-schema.js';
import { createApp } from '../src/server/app.js';
import { PiLab } from '../src/pi/lab.js';
import { SkillTrials } from '../src/pi/skill-trials.js';
import type { AuthSession } from '../src/contracts/access.js';
import type { ExpertTrialRunView } from '../src/contracts/capability-trials.js';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';

const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(waitForAbort=false){
  const dataDir=await mkdtemp(join(tmpdir(),'axon-r3-trial-ban-'));cleanup.push(()=>rm(dataDir,{recursive:true,force:true}));
  const db=await openDatabase(dataDir),access=new AccessStore(db);migrateAdministratorAccounts(db);
  const adminId=await access.saveAdministratorAccount({username:'admin',displayName:'管理员',password:'test-password-123'});db.close();
  const config=testConfig(dataDir,{auth:{secret:'test-only-trial-ban-secret-at-least-32',sessionMs:28800000}});
  const fake=await fakeRuntime(config,()=>waitForAbort?{waitForAbort:true}:{text:'按当前固定方法完成合成试用'});
  const lab=await PiLab.create(config,fake.runtime),app=await createApp(lab,false,undefined,undefined,{runtimeFactory:async()=>fake.runtime});cleanup.push(()=>app.close());
  const bootstrap=await app.inject('/api/auth/session'),anonymous=bootstrap.json<AuthSession>();
  const response=await app.inject({method:'POST',url:'/api/auth/login',headers:{cookie:bootstrap.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':anonymous.csrf!},payload:{accountId:adminId,password:'test-password-123'}});
  expect(response.statusCode,response.body).toBe(200);const auth=response.json<AuthSession>();
  const headers={cookie:response.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':auth.csrf!,'x-axon-view':auth.viewId!};
  const actor={userId:adminId,assertAdministrator:()=>{}};
  const created=await lab.skills.create(actor,{clientActionId:randomUUID()}),id=created.skill.skillId;
  await lab.skills.setPolicy(actor,id,{expectedRevision:0,mode:'none',seatIds:[],clientActionId:randomUUID()});
  const published=await lab.skills.publish(actor,id,{expectedDraftRevision:1,expectedCurrentRevisionId:null,releaseNotes:'只用于合成管理试用',clientActionId:randomUUID()});
  const root=`/api/admin/capabilities/skills/${id}`;
  const start=()=>app.inject({method:'POST',url:root+'/trials',headers,payload:{revisionId:published.revisionId,input:'仅按固定方法回答，不调用工具',clientActionId:randomUUID()}});
  const get=(trialId:string)=>app.inject({url:`${root}/trials/${trialId}`,headers});
  const ban=()=>{const row=lab.skills.db.prepare('SELECT data FROM r3_skill_assets WHERE id=?').get(id)!;const asset=JSON.parse(String(row.data));lab.skills.db.prepare('UPDATE r3_skill_assets SET data=? WHERE id=?').run(JSON.stringify({...asset,state:'banned',stateRevision:asset.stateRevision+1}),id);};
  return{app,lab,fake,actor,id,root,published,start,get,headers,ban,dataDir,config};
}

test('a globally banned skill cannot start draft or published trials, while management/history inspection remains available',async()=>{
  const f=await fixture();f.ban();
  expect(()=>f.lab.skills.assertTrialAllowed(f.id)).toThrowError(expect.objectContaining({code:'SKILL_BANNED'}));
  const denied=await f.start();expect(denied.statusCode,denied.body).toBe(409);expect(denied.json().error.code).toBe('SKILL_BANNED');
  await expect(f.lab.skills.prepareTrial(f.actor,f.id,{expectedDraftRevision:1})).rejects.toMatchObject({code:'SKILL_BANNED'});
  const detail=await f.app.inject({url:f.root,headers:f.headers});expect(detail.statusCode).toBe(200);expect(detail.json().skill.state).toBe('banned');
  const revision=await f.app.inject({url:`${f.root}/revisions/${f.published.revisionId}`,headers:f.headers});expect(revision.statusCode,revision.body).toBe(200);expect(revision.json().skillId).toBe(f.id);expect(revision.json().files.some((file:{path:string})=>file.path==='SKILL.md')).toBe(true);
  const foreign=f.lab.skills.list().find(skill=>skill.system)!;const wrongOwner=await f.app.inject({url:`${f.root}/revisions/${foreign.revisionId}`,headers:f.headers});expect(wrongOwner.statusCode).toBe(404);
  expect((await f.app.inject({url:f.root+'/trials',headers:f.headers})).statusCode).toBe(200);expect(f.fake.calls).toHaveLength(0);
});

test('ordinary disabled and policy-none skill remains trialable; banning it later does not hide its completed history',async()=>{
  const f=await fixture();await f.lab.skills.lifecycle(f.actor,f.id,{action:'disable',expectedStateRevision:0,clientActionId:randomUUID()});
  const started=await f.start();expect(started.statusCode,started.body).toBe(200);const view=started.json<ExpertTrialRunView>();
  await vi.waitFor(async()=>expect((await f.get(view.trial.trialId)).json<ExpertTrialRunView>().trial.status).toBe('succeeded'),{timeout:10000});
  expect(f.fake.calls).toHaveLength(1);f.ban();
  const history=await f.get(view.trial.trialId);expect(history.statusCode,history.body).toBe(200);expect(history.json<ExpertTrialRunView>().trial.status).toBe('succeeded');
  const listed=await f.app.inject({url:f.root+'/trials',headers:f.headers});expect(listed.statusCode).toBe(200);expect(listed.json<ExpertTrialRunView[]>()).toHaveLength(1);
  expect((await f.start()).statusCode).toBe(409);expect(f.fake.calls).toHaveLength(1);
},20000);

test('the existing execution guard timer aborts a live trial on global ban without denying its administrator history reads',async()=>{
  const f=await fixture(true);const started=await f.start();expect(started.statusCode,started.body).toBe(200);const view=started.json<ExpertTrialRunView>();
  await vi.waitFor(()=>expect(f.fake.calls).toHaveLength(1),{timeout:10000});f.ban();
  await vi.waitFor(async()=>{const response=await f.get(view.trial.trialId);expect(response.statusCode,response.body).toBe(200);expect(response.json<ExpertTrialRunView>().trial.status).toBe('failed');},{timeout:10000});
  expect(f.fake.calls[0].aborted).toBe(true);expect(f.fake.calls).toHaveLength(1);
  const listed=await f.app.inject({url:f.root+'/trials',headers:f.headers});expect(listed.statusCode).toBe(200);
  expect(listed.json<ExpertTrialRunView[]>()[0].trial.evidence?.success).toBe(false);
},20000);

test('published trial preparation rechecks a ban arriving while its immutable snapshot is being loaded',async()=>{
  const f=await fixture();const load=f.lab.skills.resolveForManagement.bind(f.lab.skills);
  const spy=vi.spyOn(f.lab.skills,'resolveForManagement').mockImplementation(async(...args)=>{const snapshot=await load(...args);f.ban();return snapshot;});
  try{await expect(f.lab.skills.prepareTrial(f.actor,f.id,{revisionId:f.published.revisionId})).rejects.toMatchObject({code:'SKILL_BANNED'});}
  finally{spy.mockRestore();}
  expect(f.fake.calls).toHaveLength(0);
  await expect(f.lab.skills.resolveForManagement(f.published,f.actor)).resolves.toMatchObject({skillId:f.id});
});

test('an R2 expert trial with a fixed organization skill is stopped by the same global-ban execution guard',async()=>{
  const f=await fixture(true),management=f.lab.management!;
  const created=await management.create(f.actor,{clientActionId:randomUUID()}),expertId=created.expert.expertId;
  const draft=await management.save(f.actor,expertId,{expectedDraftRevision:1,content:{name:'固定依赖试用',description:'用于验证既有封禁约束',instructions:'使用固定技能并核对输入',skillIds:[],skillRefs:[{skillId:f.id,revisionId:f.published.revisionId,packageDigest:f.published.packageDigest}],allowedTools:['skill_read']}});
  const validation=await management.validate(f.actor,expertId,{expectedDraftRevision:draft.draftRevision});expect(validation.valid).toBe(true);
  const root=`/api/admin/capabilities/experts/${expertId}/trials`;
  const response=await f.app.inject({method:'POST',url:root,headers:f.headers,payload:{expectedDraftRevision:draft.draftRevision,validationId:validation.validationId,input:'执行固定技能的合成任务',clientActionId:randomUUID()}});
  expect(response.statusCode,response.body).toBe(200);const trialId=response.json<ExpertTrialRunView>().trial.trialId;
  await vi.waitFor(()=>expect(f.fake.calls).toHaveLength(1),{timeout:10000});f.ban();
  await vi.waitFor(async()=>{const result=await f.app.inject({url:`${root}/${trialId}`,headers:f.headers});expect(result.statusCode,result.body).toBe(200);expect(result.json<ExpertTrialRunView>().trial.status).toBe('failed');},{timeout:10000});
  expect(f.fake.calls[0].aborted).toBe(true);expect(f.fake.calls).toHaveLength(1);
},20000);

test('trial and rescan action retries retain the original results after draft edits, bans and service restart',async()=>{
  const f=await fixture();
  const trialInput={expectedDraftRevision:1,input:'原始合成试用',files:[{name:'sample.txt',content:'固定合成附件'}],clientActionId:randomUUID()};
  const request=(payload:typeof trialInput)=>f.app.inject({method:'POST',url:f.root+'/trials',headers:f.headers,payload});
  const response=await request(trialInput);expect(response.statusCode,response.body).toBe(200);const original=response.json<ExpertTrialRunView>();
  await vi.waitFor(async()=>expect((await f.get(original.trial.trialId)).json<ExpertTrialRunView>().trial.status).toBe('succeeded'),{timeout:10000});
  const scanInput={expectedDraftRevision:1,clientActionId:randomUUID()};
  const firstScan=await f.app.inject({method:'POST',url:f.root+'/scans',headers:f.headers,payload:scanInput});expect(firstScan.statusCode,firstScan.body).toBe(200);
  await f.lab.skills.saveDraft(f.actor,f.id,{expectedDraftRevision:1,files:[{path:'SKILL.md',contentBase64:Buffer.from('---\nname: edited-method\ndescription: 已经编辑的草稿\n---\n后续内容\n').toString('base64')}]});
  const count=f.lab.skills.scans(f.actor,f.id).length;
  const retryScan=await f.app.inject({method:'POST',url:f.root+'/scans',headers:f.headers,payload:scanInput});expect(retryScan.statusCode,retryScan.body).toBe(200);expect(retryScan.json().scanId).toBe(firstScan.json().scanId);expect(f.lab.skills.scans(f.actor,f.id)).toHaveLength(count);
  expect((await f.app.inject({method:'POST',url:f.root+'/scans',headers:f.headers,payload:{...scanInput,expectedDraftRevision:2}})).statusCode).toBe(409);
  const retry=await request(trialInput);expect(retry.statusCode,retry.body).toBe(200);expect(retry.json<ExpertTrialRunView>().trial.trialId).toBe(original.trial.trialId);expect(f.fake.calls).toHaveLength(1);
  expect((await request({...trialInput,input:'篡改同一动作的目标'})).statusCode).toBe(409);
  expect((await request({...trialInput,files:[{name:'sample.txt',content:'篡改附件'}]})).statusCode).toBe(409);
  f.ban();const bannedRetry=await request(trialInput);expect(bannedRetry.statusCode,bannedRetry.body).toBe(200);expect(bannedRetry.json<ExpertTrialRunView>().trial.trialId).toBe(original.trial.trialId);
  await f.app.close();
  const fresh=await fakeRuntime(f.config,()=>({text:'不应重放模型'})),lab=await PiLab.create(f.config,fresh.runtime),app=await createApp(lab,false,undefined,undefined,{runtimeFactory:async()=>fresh.runtime});cleanup.push(()=>app.close());
  const restored=await app.inject({method:'POST',url:f.root+'/trials',headers:f.headers,payload:trialInput});expect(restored.statusCode,restored.body).toBe(200);expect(restored.json<ExpertTrialRunView>().trial.trialId).toBe(original.trial.trialId);expect(restored.json<ExpertTrialRunView>().trial.status).toBe('succeeded');expect(fresh.calls).toHaveLength(0);
  expect((await app.inject({method:'POST',url:f.root+'/trials',headers:f.headers,payload:{...trialInput,expectedDraftRevision:2}})).statusCode).toBe(409);
},20000);

test('a reserved trial action without a native record fails closed instead of automatically replaying',async()=>{
  const f=await fixture(),body={expectedDraftRevision:1,input:'注入派发前崩溃窗口',clientActionId:randomUUID()};
  const spy=vi.spyOn(SkillTrials.prototype,'start').mockRejectedValueOnce(new Error('Injected before native runtime record'));
  try{expect((await f.app.inject({method:'POST',url:f.root+'/trials',headers:f.headers,payload:body})).statusCode).toBe(500);}finally{spy.mockRestore();}
  const retry=await f.app.inject({method:'POST',url:f.root+'/trials',headers:f.headers,payload:body});expect(retry.statusCode,retry.body).toBe(503);expect(retry.json().error.code).toBe('SKILL_TRIAL_OUTCOME_UNCERTAIN');expect(f.fake.calls).toHaveLength(0);
  const list=await f.app.inject({url:f.root+'/trials',headers:f.headers});expect(list.statusCode).toBe(200);expect(list.json()).toEqual([]);
});

test('a concurrent retry before native dispatch fails closed and cannot launch a second trial',async()=>{
  const f=await fixture(),body={expectedDraftRevision:1,input:'并发动作只执行一次',clientActionId:randomUUID()};
  let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});
  const start=SkillTrials.prototype.start;
  const spy=vi.spyOn(SkillTrials.prototype,'start').mockImplementation(async function(this:SkillTrials,...args){entered();await gate;return start.apply(this,args);});
  const first=Promise.resolve(f.app.inject({method:'POST',url:f.root+'/trials',headers:f.headers,payload:body}));
  try{
    await ready;const concurrent=await f.app.inject({method:'POST',url:f.root+'/trials',headers:f.headers,payload:body});expect(concurrent.statusCode,concurrent.body).toBe(503);expect(f.fake.calls).toHaveLength(0);release();
    const original=await first;expect(original.statusCode,original.body).toBe(200);const trialId=original.json<ExpertTrialRunView>().trial.trialId;
    await vi.waitFor(async()=>expect((await f.get(trialId)).json<ExpertTrialRunView>().trial.status).toBe('succeeded'),{timeout:10000});
    const replay=await f.app.inject({method:'POST',url:f.root+'/trials',headers:f.headers,payload:body});expect(replay.statusCode).toBe(200);expect(replay.json<ExpertTrialRunView>().trial.trialId).toBe(trialId);expect(f.fake.calls).toHaveLength(1);
  }finally{release();await first;spy.mockRestore();}
},20000);
