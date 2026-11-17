import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { CapabilityService } from '../src/capabilities/service.js';
import { CapabilityManagement } from '../src/capabilities/management.js';
import { RequestError } from '../src/contracts/errors.js';
import { loadControlledSkills } from '../src/resources/service.js';
const actor={userId:'administrator',seatId:'a'};
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const close of cleanups.splice(0).reverse())await close();});
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
async function setup(){
  const root=await mkdtemp(join(tmpdir(),'r2-management-security-'));const cap=await CapabilityService.open(root);
  cleanups.push(async()=>{cap.close();await rm(root,{recursive:true,force:true});});
  const skills=await loadControlledSkills(['synthesis','review']);await cap.registerBuiltins({skills,roles:[]});let authorized=true;
  const management=await CapabilityManagement.open(cap,{skills:()=>skills,tools:()=>[],seats:()=>[{id:'a',name:'A'}],reauthorize:()=>{if(!authorized)throw new RequestError('FORBIDDEN','管理员已撤权。',403);}});
  return {cap,management,revoke:()=>{authorized=false;}};
}
async function draftAndValidation(env:Awaited<ReturnType<typeof setup>>){
  const detail=await env.management.create(actor,{clientActionId:randomUUID()});const id=detail.expert.expertId;
  const draft=await env.management.save(actor,id,{expectedDraftRevision:1,content:{name:'核对专家',description:'合成资料核对',instructions:'仅依据用户提供的合成事实回答。',skillIds:[],allowedTools:[]}});
  const validation=await env.management.validate(actor,id,{expectedDraftRevision:draft.draftRevision});return {id,draft,validation};
}
async function holdManagementQueue(env:Awaited<ReturnType<typeof setup>>){
  const entered=deferred(),release=deferred();const current=env.cap.current.bind(env.cap);
  vi.spyOn(env.cap,'current').mockImplementationOnce(async id=>{entered.resolve();await release.promise;return current(id);});
  const blocker=env.management.create(actor,{clientActionId:randomUUID(),copyFrom:{expertId:'synthesis-expert'}});
  const rejected=expect(blocker).rejects.toMatchObject({code:'FORBIDDEN'});await entered.promise;
  return {release:release.resolve,rejected};
}
test('queued trial preparation rechecks administrator before writing trial and action receipt',async()=>{
  const env=await setup();const p=await draftAndValidation(env);const queue=await holdManagementQueue(env);const actionId=randomUUID();
  const trial=env.management.prepareTrial(actor,p.id,{expectedDraftRevision:p.draft.draftRevision,validationId:p.validation.validationId,input:'合成任务',clientActionId:actionId});
  const rejection=expect(trial).rejects.toMatchObject({code:'FORBIDDEN'});env.revoke();queue.release();await queue.rejected;await rejection;
  expect((await env.management.get(p.id)).trials).toEqual([]);expect(env.cap.db.prepare('SELECT 1 FROM r2_actions WHERE action_id=?').get(actionId)).toBeUndefined();
});
test('a queued idempotent create receipt does not bypass current administrator revocation',async()=>{
  const env=await setup();const input={clientActionId:randomUUID()};const first=await env.management.create(actor,input);const queue=await holdManagementQueue(env);
  const retry=env.management.create(actor,input);const rejection=expect(retry).rejects.toMatchObject({code:'FORBIDDEN'});env.revoke();queue.release();await queue.rejected;await rejection;
  expect((await env.management.get(first.expert.expertId)).draft?.draftRevision).toBe(1);
});
test('publication rolls back pointer, release and receipt if seat range is closed during content persistence',async()=>{
  const env=await setup();const p=await draftAndValidation(env);
  const prepared=await env.management.prepareTrial(actor,p.id,{expectedDraftRevision:p.draft.draftRevision,validationId:p.validation.validationId,input:'合成任务',clientActionId:randomUUID()});
  env.management.recordTrialResult(actor,prepared.trial.trialId,{status:'succeeded',evidence:{tools:[],model:'test-only',runtime:'pi',fileEnvironmentVerified:false,success:true,summary:'确定性测试宿主提供的运行证据',unverified:[]}});
  env.management.confirmTrial(actor,prepared.trial.trialId,{approved:true,reason:'核对合成任务',clientActionId:randomUUID()});
  env.management.setPolicy(actor,p.id,{expectedRevision:0,mode:'seats',seatIds:['a'],clientActionId:randomUUID()});
  const entered=deferred(),release=deferred();const register=env.cap.registerExpert.bind(env.cap);
  vi.spyOn(env.cap,'registerExpert').mockImplementationOnce(async(...args)=>{entered.resolve();await release.promise;return register(...args);});
  const actionId=randomUUID();const result=env.management.publish(actor,p.id,{expectedDraftRevision:p.draft.draftRevision,expectedCurrentRevisionId:null,validationId:p.validation.validationId,trialId:prepared.trial.trialId,releaseNotes:'首版',acceptedRiskCodes:[],clientActionId:actionId});
  const rejection=expect(result).rejects.toMatchObject({code:'CAPABILITY_CONFLICT'});await entered.promise;
  env.management.setPolicy(actor,p.id,{expectedRevision:1,mode:'seats',seatIds:[],clientActionId:randomUUID()});release.resolve();await rejection;
  expect((await env.management.get(p.id)).publications).toEqual([]);await expect(env.cap.current(p.id)).rejects.toMatchObject({code:'EXPERT_NOT_FOUND'});
  expect(env.cap.db.prepare('SELECT 1 FROM r2_actions WHERE action_id=?').get(actionId)).toBeUndefined();
});

test('an existing R1 store with no sessions still requires explicit migration before schema upgrade',async()=>{
  const root=await mkdtemp(join(tmpdir(),'r2-existing-r1-empty-'));const cap=await CapabilityService.open(root);
  const skills=await loadControlledSkills(['synthesis','review']);await cap.registerBuiltins({skills,roles:[]});cap.setAccess('previous-account','synthesis-expert',false);cap.close();
  const reopened=await CapabilityService.open(root);cleanups.push(async()=>{reopened.close();await rm(root,{recursive:true,force:true});});
  expect(reopened.createdNew).toBe(false);expect(reopened.db.prepare('PRAGMA user_version').get()?.user_version).toBe(1);
  await expect(CapabilityManagement.open(reopened,{skills:()=>skills,tools:()=>[],seats:()=>[]})).rejects.toMatchObject({code:'CAPABILITY_R2_MIGRATION_REQUIRED'});
  expect(reopened.db.prepare('PRAGMA user_version').get()?.user_version).toBe(1);
  expect(reopened.db.prepare('SELECT allowed FROM access_rules WHERE principal_id=?').get('previous-account')?.allowed).toBe(0);
  expect(reopened.db.prepare("SELECT 1 FROM sqlite_master WHERE name='r2_experts'").get()).toBeUndefined();
});
