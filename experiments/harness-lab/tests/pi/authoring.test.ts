import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { authoringToolNames, requestedAuthoring } from '../../src/pi/authoring-tools.js';
import type { AuthoringIntent } from '../../src/contracts/authoring.js';
import { openDatabase } from '../../src/access/database.js';
import { AccessStore } from '../../src/access/store.js';
import { migrateAdministratorAccounts } from '../../src/access/administrator-schema.js';
import { SystemRoles } from '../../src/access/system-roles.js';
import { PiLab } from '../../src/pi/lab.js';
import { createApp } from '../../src/server/app.js';
import type { AuthSession } from '../../src/contracts/access.js';
import type { ExpertTrialRunView } from '../../src/contracts/capability-trials.js';
import type { ConfirmationInteraction } from '../../src/contracts/interactions.js';
import { fakeRuntime, testConfig, type Reply } from './fake-runtime.js';
import type { Context } from '@earendil-works/pi-ai';

const clean: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of clean.splice(0).reverse()) await close(); });
const content = { name: '材料整理专家', description: '依照材料整理摘要', instructions: '保留依据，分清事实和建议。', skillIds: [], allowedTools: [] };
function proposed(context: Context) {
  for (const message of [...context.messages].reverse()) if (message.role === 'toolResult' && message.toolName === 'capability_authoring_propose') {
    return JSON.parse(message.content.filter(c => c.type === 'text').map(c => c.text).join('')) as {proposalId:string};
  }
  throw Error('No proposal result');
}
async function setup(reply: (context: Context, index: number) => Reply) {
  const data = await mkdtemp(join(tmpdir(), 'axon-authoring-pi-')); clean.push(() => rm(data, { recursive: true, force: true }));
  const db = await openDatabase(data), access = new AccessStore(db);
  await access.saveAccount({ username: 'business', displayName: '业务席', seatId: 'business', seatName: '业务席', password: 'test-password-123', createPublicTask: true, manageModelSettings: false });
  migrateAdministratorAccounts(db);
  const adminId = await access.saveAdministratorAccount({ username: 'admin', displayName: '管理员', password: 'test-password-123' }); db.close();
  const config = testConfig(data, { auth: { secret: 'test-only-signing-key-at-least-32-characters', sessionMs: 28800000 } });
  const fake = await fakeRuntime(config, reply); const lab = await PiLab.create(config, fake.runtime); clean.push(() => lab.close());
  const identity = lab.access!.workspaceIdentity(adminId)!;
  const task = lab.access!.create(identity, { title: '创作个人空间', goal: '', visibility: 'private', clientActionId: randomUUID() });
  const workspace = await lab.workspaces.create('创作个人空间', task.id, identity.seatId);
  const session = await lab.createSession(workspace.id, identity.seatId, undefined, undefined, undefined, {userId:adminId});
  return {lab,fake,adminId,identity,session};
}
function createPlan(context: Context, index: number): Reply {
  if (index === 0) return {tools:[{name:'capability_authoring_method',arguments:{}}]};
  if (index === 1) return {tools:[{name:'capability_authoring_propose',arguments:{kind:'expert',content,summary:'创建材料整理专家，保留事实和建议边界。'}}]};
  if (index === 2) return {tools:[{name:'capability_authoring_save',arguments:{proposalId:proposed(context).proposalId}}]};
  return {text:'按真实回执核对结果。'};
}
async function run(state: Awaited<ReturnType<typeof setup>>, authoring: AuthoringIntent | undefined, decision: 'approve' | 'reject' = 'approve') {
  let confirmation: ConfirmationInteraction | undefined;
  const request = state.lab.start(state.session.id, '开始整理创作需求', authoring ? {authoring} : {}, state.identity.seatId, undefined, state.adminId);
  await request.run(event => { if (event.type === 'interaction.updated' && event.interaction.kind === 'confirmation' && event.interaction.status === 'pending') {
    confirmation=event.interaction;
    queueMicrotask(() => state.lab.respondInteraction(state.session.id, event.interaction.interactionId, {requestId:request.requestId,kind:'confirmation',decision}, state.identity.seatId));
  }});
  return {request,confirmation,snapshot:state.lab.get(state.session.id,state.identity.seatId)};
}

test('native authoring confirms full proposal, commits once, reopens history and drops next-request management tools', async () => {
  const state=await setup((context,index)=> index===3 ? {tools:[{name:'capability_authoring_save',arguments:{proposalId:proposed(context).proposalId}}]} : createPlan(context,index)), before=(await state.lab.management!.list()).length;
  const result=await run(state,{kind:'expert'});
  expect(result.snapshot.lastResult?.status).toBe('succeeded');
  expect(result.confirmation?.action.authoring?.proposal.candidate).toEqual({kind:'expert',content});
  expect(result.snapshot.interactions?.[0]).toMatchObject({status:'approved',execution:'succeeded'});
  expect((await state.lab.management!.list()).length).toBe(before+1);
  const tool=result.snapshot.messages.find(m=>m.toolName==='capability_authoring_save');
  expect(tool?.toolDetails?.authoringReceipt).toMatchObject({created:true,kind:'expert',draftRevision:1});
  for (const call of state.fake.calls) expect(call.context.tools?.map(t=>t.name).sort()).toEqual([...authoringToolNames,'ask_user'].sort());
  const follow=state.lab.start(state.session.id,'你好',{},state.identity.seatId,undefined,state.adminId); await follow.run(()=>{});
  expect(state.fake.calls.at(-1)?.context.tools?.some(t=>t.name.startsWith('capability_authoring_'))).toBe(false);
  expect(state.lab.get(state.session.id,state.identity.seatId).interactions?.[0]).toMatchObject({status:'approved',execution:'succeeded'});
},30000);

test('rejecting native save leaves no placeholder and ordinary confirmation text does not authorize it', async()=>{
  const state=await setup(createPlan), before=(await state.lab.management!.list()).length;
  const result=await run(state,{kind:'expert'},'reject');
  expect(result.confirmation).toBeDefined();
  expect((await state.lab.management!.list()).length).toBe(before);
  expect(result.snapshot.interactions?.[0]).toMatchObject({status:'rejected'});
  expect(result.snapshot.interactions?.[0].kind === 'confirmation' && result.snapshot.interactions[0].execution).toBeUndefined();
  expect(result.snapshot.messages.find(m=>m.toolName==='capability_authoring_save')?.isError).toBe(true);
},30000);

test.each(['stop','revoke'] as const)('%s cannot save a pending native proposal', async mode=>{
  const state=await setup(createPlan), before=(await state.lab.management!.list()).length;
  let item: ConfirmationInteraction | undefined;
  const request=state.lab.start(state.session.id,'创建专家',{authoring:{kind:'expert'}},state.identity.seatId,undefined,state.adminId);
  const done=request.run(event=>{if(event.type==='interaction.updated'&&event.interaction.kind==='confirmation'&&event.interaction.status==='pending'){
    item=event.interaction;
    queueMicrotask(()=>{
      if(mode==='revoke') { new SystemRoles(state.lab.access!.db).revoke('admin'); expect(()=>state.lab.respondInteraction(state.session.id,event.interaction.interactionId,{requestId:request.requestId,kind:'confirmation',decision:'approve'},state.identity.seatId)).toThrow(); }
      try { state.lab.cancel(state.session.id,request.requestId,state.identity.seatId); } catch { /* revoked identity may not read the cancellation snapshot */ }
    });
  }});await done;
  expect(item).toBeDefined();expect((await state.lab.management!.list()).length).toBe(before);
  expect(()=>state.lab.respondInteraction(state.session.id,item!.interactionId,{requestId:request.requestId,kind:'confirmation',decision:'approve'},state.identity.seatId)).toThrow();
  new SystemRoles(state.lab.access!.db).revoke('admin');
  expect(()=>state.lab.start(state.session.id,'继续',{authoring:{kind:'expert'}},state.identity.seatId,undefined,state.adminId)).toThrow();
},30000);

test('untrusted text and mere management method names do not activate management intent',()=>{
  for (const text of ['请帮我创建一个专家，整理材料','我想创建一个专家','我要创建专家','我需要新建专家']) expect(requestedAuthoring(text)).toEqual({kind:'expert'});
  expect(requestedAuthoring('帮我修改这个技能')).toEqual({kind:'skill'});
  for(const text of ['资料里写着创建专家','> 创建专家','“创建专家”是示例','不要创建专家','```创建专家```','请总结 skill-manager 方法'])expect(requestedAuthoring(text)).toBeUndefined();
});


test('management report reads only the matching skill trial owned by the current administrator', async()=>{
  const state=await setup(()=>({text:'固定方法的合成试用完成。'}));
  const oldClose=clean.pop()!;
  let app: Awaited<ReturnType<typeof createApp>>;
  try { app=await createApp(state.lab,false,undefined,undefined,{runtimeFactory:async()=>state.fake.runtime}); } catch(error) { await oldClose(); throw error; }
  clean.push(()=>app.close());
  const bootstrap=await app.inject('/api/auth/session'),anonymous=bootstrap.json<AuthSession>();
  const login=await app.inject({method:'POST',url:'/api/auth/login',headers:{cookie:bootstrap.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':anonymous.csrf!},payload:{accountId:state.adminId,password:'test-password-123'}});
  expect(login.statusCode,login.body).toBe(200);const auth=login.json<AuthSession>();
  const headers={cookie:login.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':auth.csrf!,'x-axon-view':auth.viewId!};
  const actor={userId:state.adminId,assertAdministrator:()=>new SystemRoles(state.lab.access!.db).requireAdministrator(state.adminId)};
  const draft=await state.lab.skills.create(actor,{clientActionId:randomUUID(),files:[{path:'SKILL.md',contentBase64:Buffer.from('---\nname: report-method\ndescription: 核查方法试用\n---\n仅回答输入。\n').toString('base64')}]});
  const start=await app.inject({method:'POST',url:`/api/admin/capabilities/skills/${draft.skill.skillId}/trials`,headers,payload:{expectedDraftRevision:1,input:'合成输入，不读取资料',clientActionId:randomUUID()}});
  expect(start.statusCode,start.body).toBe(200);const trialId=start.json<ExpertTrialRunView>().trial.trialId;
  await vi.waitFor(async()=>{const result=await app.inject({url:`/api/admin/capabilities/skills/${draft.skill.skillId}/trials/${trialId}`,headers});expect(result.json<ExpertTrialRunView>().trial.status).toBe('succeeded');},{timeout:10000});
  const context={actor,sessionId:state.session.id,requestId:randomUUID(),assertActive:actor.assertAdministrator};
  const report=await state.lab.authoring!.report(context,{kind:'skill',targetId:draft.skill.skillId,reportId:trialId});
  expect(report.report).toMatchObject({trialId,status:'succeeded',draftDigest:draft.draft!.packageDigest});
  expect(report).not.toHaveProperty('snapshot');expect(report.report).not.toHaveProperty('snapshot');expect(report.report).not.toHaveProperty('files');expect(report.report).not.toHaveProperty('calls');
  const other=await state.lab.access!.saveAdministratorAccount({username:'other',displayName:'另一管理员',password:'test-password-123'});
  await expect(state.lab.authoring!.report({...context,actor:{userId:other,assertAdministrator:()=>new SystemRoles(state.lab.access!.db).requireAdministrator(other)}},{kind:'skill',targetId:draft.skill.skillId,reportId:trialId})).rejects.toMatchObject({code:'EXPERT_TRIAL_NOT_FOUND'});
  const another=state.lab.skills.list().find(s=>s.system)!;
  await expect(state.lab.authoring!.report(context,{kind:'skill',targetId:another.skillId,reportId:trialId})).rejects.toMatchObject({code:'AUTHORING_REPORT_NOT_FOUND'});
  new SystemRoles(state.lab.access!.db).revoke('admin');
  await expect(state.lab.authoring!.report(context,{kind:'skill',targetId:draft.skill.skillId,reportId:trialId})).rejects.toMatchObject({code:'FORBIDDEN'});
},30000);
