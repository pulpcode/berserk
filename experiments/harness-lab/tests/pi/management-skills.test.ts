import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { openDatabase } from '../../src/access/database.js';
import { AccessStore } from '../../src/access/store.js';
import { migrateAdministratorAccounts } from '../../src/access/administrator-schema.js';
import { SystemRoles } from '../../src/access/system-roles.js';
import { PiLab } from '../../src/pi/lab.js';
import { createApp } from '../../src/server/app.js';
import { loadManagementSkills } from '../../src/authoring/management-skills.js';
import { COMPOSER_INPUT_V8, decodeComposerInput, recordedComposerText, validSkill } from '../../src/pi/composer-input.js';
import { decodeResourceRecord } from '../../src/pi/history-evidence.js';
import type { AuthSession } from '../../src/contracts/access.js';
import type { SkillFile, WorkspaceResources } from '../../src/contracts/index.js';
import { fakeRuntime, testConfig, type Reply } from './fake-runtime.js';
import type { Context } from '@earendil-works/pi-ai';
const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
const content={name:'管理方法专家',description:'整理明确资料',instructions:'保留未知项。',skillIds:[],allowedTools:[]};
async function setup(reply:(context:Context,index:number)=>Reply=()=>({text:'已读取实际方法。'})){
 const data=await mkdtemp(join(tmpdir(),'axon-management-skills-'));cleanup.push(()=>rm(data,{recursive:true,force:true}));
 const db=await openDatabase(data),access=new AccessStore(db);
 await access.saveAccount({username:'business',displayName:'业务席',seatId:'business',seatName:'业务席',password:'test-password-123',createPublicTask:true,manageModelSettings:false});migrateAdministratorAccounts(db);
 const adminId=await access.saveAdministratorAccount({username:'admin',displayName:'管理员',password:'test-password-123'}),otherId=await access.saveAdministratorAccount({username:'other',displayName:'其他管理员',password:'test-password-123'});db.close();
 const config=testConfig(data,{auth:{secret:'test-only-signing-secret-at-least-32-characters',sessionMs:28800000}}),fake=await fakeRuntime(config,reply),lab=await PiLab.create(config,fake.runtime),app=await createApp(lab);cleanup.push(()=>app.close());
 const own=lab.access!.workspaceIdentity(adminId)!,business=lab.access!.identityForSeat('business')!,other=lab.access!.workspaceIdentity(otherId)!;
 const make=async(identity:typeof own)=>{const task=lab.access!.create(identity,{title:'私有空间',goal:'',visibility:'private',clientActionId:randomUUID()});const workspace=await lab.workspaces.create('私有空间',task.id,identity.seatId);return {workspace,session:await lab.createSession(workspace.id,identity.seatId,undefined,undefined,undefined,{userId:identity.userId})};};
 const primary=await make(own),regular=await make(business),foreign=await make(other);
 const login=async(username:string)=>{const first=await app.inject('/api/auth/session'),anonymous=first.json<AuthSession>();const response=await app.inject({method:'POST',url:'/api/auth/login',headers:{cookie:first.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':anonymous.csrf!},payload:{username,password:'test-password-123'}});expect(response.statusCode,response.body).toBe(200);const auth=response.json<AuthSession>();return {cookie:response.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':auth.csrf!,'x-axon-view':auth.viewId!};};
 return {lab,app,fake,adminId,own,business,primary,regular,foreign,login};
}

test('registered method metadata/detail is real, admin-only and own-personal scoped, with zero model/asset writes',async()=>{
 const state=await setup(),admin=await state.login('admin'),business=await state.login('business'),before=state.lab.skills.list().length;
 const response=await state.app.inject({url:'/api/admin/capabilities/authoring-skills',headers:admin});expect(response.statusCode,response.body).toBe(200);const methods=response.json<SkillFile[]>();
 expect(methods.map(s=>s.id)).toEqual(['expert-manager','skill-creator']);expect(methods.every(s=>!('content' in s))).toBe(true);
 for(const method of methods){const r=await state.app.inject({url:'/api/admin/capabilities/authoring-skills/'+method.id,headers:admin});expect(r.statusCode).toBe(200);expect(r.json()).toMatchObject({...method,content:expect.stringContaining(`name: ${method.id}`)});}
 const own=(await state.app.inject({url:`/api/workspaces/${state.primary.workspace.id}/resources`,headers:admin})).json<WorkspaceResources>();expect(own.skills.filter(s=>methods.some(m=>m.id===s.id))).toEqual(methods);
 const regular=(await state.app.inject({url:`/api/workspaces/${state.regular.workspace.id}/resources`,headers:business})).json<WorkspaceResources>();expect(regular.skills.some(s=>methods.some(m=>m.id===s.id))).toBe(false);
 expect((await state.app.inject({url:'/api/admin/capabilities/authoring-skills',headers:business})).statusCode).toBe(403);
 expect((await state.app.inject({url:`/api/workspaces/${state.foreign.workspace.id}/skills/expert-manager`,headers:admin})).statusCode).toBe(404);
 expect((await state.app.inject({url:`/api/workspaces/${state.regular.workspace.id}/skills/expert-manager`,headers:business})).statusCode).toBe(403);
 expect(state.fake.calls).toHaveLength(0);expect(state.lab.skills.list()).toHaveLength(before);
});

test('explicit method delivers exact Skill body once, original confirmation saves, native v8 reopens and next turn has no management authority',async()=>{
 const state=await setup((context,index)=>{
  if(index===0)return {tools:[{name:'capability_authoring_propose',arguments:{kind:'expert',content,summary:'创建明确专家'}}]};
  if(index===1){const r=context.messages.find(m=>m.role==='toolResult'&&m.toolName==='capability_authoring_propose');if(r?.role!=='toolResult')throw Error('proposal missing');return {tools:[{name:'capability_authoring_save',arguments:{proposalId:JSON.parse(r.content.filter(c=>c.type==='text').map(c=>c.text).join('')).proposalId}}]};}
  return {text:'保存结果已核对。'};
 });
 const method=(await loadManagementSkills(['expert-manager']))[0],request=state.lab.start(state.primary.session.id,'整理为专家草稿',{skill:{id:method.id,hash:method.hash}},state.own.seatId,undefined,state.adminId);
 await request.run(event=>{if(event.type==='interaction.updated'&&event.interaction.kind==='confirmation'&&event.interaction.status==='pending')state.lab.respondInteraction(state.primary.session.id,event.interaction.interactionId,{requestId:request.requestId,kind:'confirmation',decision:'approve'},state.own.seatId);});
 const snapshot=state.lab.get(state.primary.session.id,state.own.seatId);expect(snapshot.lastResult?.status).toBe('succeeded');expect(snapshot.messages.find(m=>m.role==='user')?.selections?.skill).toEqual(method);expect(snapshot.interactions?.[0]).toMatchObject({status:'approved',execution:'succeeded'});
 const first=state.fake.calls[0].context;expect(first.tools?.map(t=>t.name)).toContain('capability_authoring_save');expect(first.tools?.map(t=>t.name)).not.toContain('bash');
 const delivered=first.messages.map(m=>typeof m.content==='string'?m.content:m.content.filter(block=>block.type==='text').map(block=>block.text).join('')).join('\n');expect(delivered.split(JSON.stringify(method)).length-1).toBe(1);
 const saved=await state.lab.readSavedSession(state.primary.session.id,state.own.seatId);expect(saved.messages.find(m=>m.role==='user')?.selections?.skill).toEqual(method);expect(state.lab.getRequestResources(state.primary.session.id,request.requestId,state.own.seatId)).toMatchObject({schemaVersion:3});
 const next=state.lab.start(state.primary.session.id,'你好',{},state.own.seatId,undefined,state.adminId);await next.run(()=>{});expect(state.fake.calls.at(-1)?.context.tools?.some(t=>t.name.startsWith('capability_authoring_'))).toBe(false);
},30000);

test('stale hashes, conflicting selections, ordinary users and role revocation never acquire management tools',async()=>{
 const state=await setup(),method=(await loadManagementSkills(['skill-creator']))[0];
 expect(()=>state.lab.start(state.primary.session.id,'需求',{skill:{id:method.id,hash:method.hash},authoring:{kind:'expert'}},state.own.seatId,undefined,state.adminId)).toThrow(/不匹配/);
 expect(()=>state.lab.start(state.primary.session.id,'需求',{skill:{id:'review',hash:method.hash},authoring:{kind:'skill'}},state.own.seatId,undefined,state.adminId)).toThrow(/不匹配/);
 expect(()=>state.lab.start(state.regular.session.id,'需求',{skill:{id:method.id,hash:method.hash}},state.business.seatId,undefined,state.business.userId)).toThrow(/仅限/);
 const stale=state.lab.start(state.primary.session.id,'需求',{skill:{id:method.id,hash:'0'.repeat(64)}},state.own.seatId,undefined,state.adminId);await stale.run(()=>{});expect(state.lab.get(state.primary.session.id,state.own.seatId).lastResult).toMatchObject({status:'failed'});expect(state.fake.calls).toHaveLength(0);
 new SystemRoles(state.lab.access!.db).revoke('admin');expect(()=>state.lab.start(state.primary.session.id,'需求',{skill:{id:method.id,hash:method.hash}},state.own.seatId,undefined,state.adminId)).toThrow();
});

test('a same-name uploaded package is still an ordinary skill',async()=>{
 const state=await setup(),actor={userId:state.adminId,assertAdministrator:()=>new SystemRoles(state.lab.access!.db).requireAdministrator(state.adminId)};
 const item=await state.lab.skills.create(actor,{clientActionId:randomUUID(),files:[{path:'SKILL.md',contentBase64:Buffer.from('---\nname: expert-manager\ndescription: 同名普通方法\n---\n只回答摘要。\n').toString('base64')}]});
 await state.lab.skills.setPolicy(actor,item.skill.skillId,{expectedRevision:0,mode:'all',seatIds:[],clientActionId:randomUUID()});const publication=await state.lab.skills.publish(actor,item.skill.skillId,{expectedDraftRevision:1,expectedCurrentRevisionId:null,releaseNotes:'同名普通方法夹具',clientActionId:randomUUID()});
 const file=await state.lab.resources.readSkill(state.regular.workspace.id,publication.skillId,state.business.seatId,state.business.userId),request=state.lab.start(state.regular.session.id,'按选择的方法回答',{skill:{id:file.id,hash:file.hash,revisionId:file.revisionId,packageDigest:file.packageDigest}},state.business.seatId,undefined,state.business.userId);await request.run(()=>{});
 expect(state.fake.calls).toHaveLength(1);expect(state.fake.calls[0].context.tools?.some(t=>t.name.startsWith('capability_authoring_'))).toBe(false);
},30000);

test('new management native versions do not widen legacy v1-v7 or resource schemas',async()=>{
 const method=(await loadManagementSkills(['expert-manager']))[0],workspaceId=randomUUID(),sessionId=randomUUID(),requestId=randomUUID(),record={workspaceId,sessionId,requestId,skill:method};
 expect(validSkill(method,true)).toBe(false);expect(decodeComposerInput(record,workspaceId,sessionId,COMPOSER_INPUT_V8)).toEqual(record);expect(recordedComposerText(record,COMPOSER_INPUT_V8)).toContain('expert-manager');expect(()=>decodeComposerInput(record,workspaceId,sessionId)).toThrow();
 const instructions=[{fileId:'common',name:'通用',content:'',hash:null,editable:false},{fileId:'workspace',name:'项目',content:'',hash:null,editable:true}],{content:body,...info}=method;void body;
 const resource={schemaVersion:3,status:'available',requestId,workspaceId,instructions,skills:[info],readSkills:[],editableFileIds:['workspace']};expect(decodeResourceRecord(resource,workspaceId)).toMatchObject({schemaVersion:3});expect(()=>decodeResourceRecord({...resource,schemaVersion:2},workspaceId)).toThrow();expect(()=>decodeResourceRecord(resource,workspaceId,true)).toThrow();
});
