import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, expect, vi } from 'vitest';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { SystemRoles } from '../src/access/system-roles.js';
import { migrateAdministratorAccounts } from '../src/access/administrator-schema.js';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import type { AuthSession } from '../src/contracts/access.js';
import type { ManagedExpertDetail, ExpertDraft, ExpertValidation, ExpertPublication, ExpertDefaultSetting } from '../src/contracts/capability-management.js';
import type { ExpertTrialRunView } from '../src/contracts/capability-trials.js';
import type { SessionSnapshot } from '../src/contracts/index.js';
import type { CapabilityLibrary } from '../src/contracts/capabilities.js';
import { testConfig, fakeRuntime } from './pi/fake-runtime.js';

test('authenticated management trial/publication and five-level defaults preserve business grants and creation idempotency', async () => {
  const dataDir=await mkdtemp(join(tmpdir(),'axon-r2-api-'));const db=await openDatabase(dataDir);const access=new AccessStore(db);
  for(const username of ['owner','user'])await access.saveAccount({username,displayName:username,seatId:username,seatName:username,password:'test-password-123',createPublicTask:username==='owner',manageModelSettings:false});
  migrateAdministratorAccounts(db);
  await access.saveAdministratorAccount({username:'admin',displayName:'系统管理员',password:'test-password-123'});db.close();
  const config=testConfig(dataDir,{auth:{secret:'test-only-signing-key-at-least-32-characters',sessionMs:28800000}});const fake=await fakeRuntime(config,()=>({text:'合成输入的代表性试用完成。'}));const lab=await PiLab.create(config,fake.runtime);const app=await createApp(lab,false,undefined,undefined,{runtimeFactory:async()=>fake.runtime});
  try {
    const login=async(username:string)=>{const first=await app.inject('/api/auth/session');const a=first.json<AuthSession>();const r=await app.inject({method:'POST',url:'/api/auth/login',headers:{cookie:first.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':a.csrf!},payload:{username,password:'test-password-123'}});expect(r.statusCode,r.body).toBe(200);const auth=r.json<AuthSession>();return {headers:{cookie:r.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':auth.csrf!,'x-axon-view':auth.viewId!},identity:auth.identity!};};
    const admin=await login('admin'),owner=await login('owner'),user=await login('user');
    const call=(who:typeof admin,url:string,payload?:object,method?:'GET'|'POST'|'PUT')=>app.inject({url,method:method??(payload?'POST':'GET'),headers:who.headers,...(payload?{payload}:{})});
    const ok=async<T>(who:typeof admin,url:string,payload?:object,method?:'GET'|'POST'|'PUT')=>{const r=await call(who,url,payload,method);expect(r.statusCode,r.body).toBe(200);return r.json<T>();};
    const root='/api/admin/capabilities/experts';
    expect(admin.identity).toMatchObject({role:'administrator',canCollaborate:false,createPublicTask:false,manageModelSettings:false});
    expect(admin.identity).not.toHaveProperty('seatId');
    expect(lab.access!.allSeatIds().sort()).toEqual(['owner','user']);
    expect(await ok(admin,'/api/admin/access')).toEqual({administrator:true});
    expect(await ok(user,'/api/admin/access')).toEqual({administrator:false});
    const library=await ok<CapabilityLibrary>(admin,'/api/capabilities/library');
    expect(library.skills.length).toBeGreaterThan(0);
    for(const skill of library.skills) expect(Object.keys(skill).sort()).toEqual(['description','id','name']);
    expect(await ok(user,'/api/capabilities/library')).toEqual(library);
    expect((await app.inject('/api/capabilities/library')).statusCode).toBe(401);
    expect((await call(admin,'/api/capabilities/library?seatId=owner')).statusCode).toBe(400);
    // Private workspace access does not turn an administrator into a business actor.
    for(const path of ['/api/settings/models','/api/information/access','/api/continuous/access','/api/me/preferences/expert','/api/context/catalog','/api/workbench/items']) {
      const denied=await call(admin,path);expect(denied.statusCode,path).toBe(403);
    }
    expect(await ok(admin,'/api/tasks')).toEqual([]);
    expect((await call(admin,'/api/info')).statusCode).toBe(200);
    expect((await call(admin,'/api/models')).statusCode).toBe(200);
    expect((await call(admin,'/api/workspaces')).statusCode).toBe(200);
    expect((await call(admin,'/api/tasks',{title:'伪造业务',goal:'不能创建公共任务',visibility:'public',clientActionId:randomUUID()})).statusCode).toBe(403);
    expect((await call(admin,'/api/sessions',{clientActionId:randomUUID()})).statusCode).toBe(404);
    expect((await call(user,root,{clientActionId:randomUUID()})).statusCode).toBe(403);
    const detail=await ok<ManagedExpertDetail>(admin,root,{clientActionId:randomUUID()});const id=detail.expert.expertId;const url=`${root}/${id}`;
    expect((await call(admin,`${url}/draft`,{expectedDraftRevision:1,system:true,content:{name:'伪造',description:'x',instructions:'x',skillIds:[],allowedTools:[]}},'PUT')).statusCode).toBe(400);
    const draft=await ok<ExpertDraft>(admin,`${url}/draft`,{expectedDraftRevision:1,content:{name:'组织核对专家',description:'合成资料核对',instructions:'仅根据输入事实回答。',skillIds:[],allowedTools:[]}},'PUT');
    await ok(admin,`${url}/policy`,{expectedRevision:0,mode:'seats',seatIds:['owner','user'],clientActionId:randomUUID()},'PUT');
    const validation=await ok<ExpertValidation>(admin,`${url}/validate`,{expectedDraftRevision:draft.draftRevision});expect(validation.valid).toBe(true);expect(fake.calls).toHaveLength(0);
    const trial=await ok<ExpertTrialRunView>(admin,`${url}/trials`,{expectedDraftRevision:draft.draftRevision,validationId:validation.validationId,input:'计划10件完成8件，请归纳。',clientActionId:randomUUID()});
    await vi.waitFor(async()=>{const view=await ok<ExpertTrialRunView>(admin,`${url}/trials/${trial.trial.trialId}`);expect(view.trial.status,view.trial.evidence?.summary).toBe('succeeded');},{timeout:10000});
    await ok(admin,`${url}/trials/${trial.trial.trialId}/confirm`,{approved:true,reason:'核对合成样例结果。',clientActionId:randomUUID()});
    const pub=await ok<ExpertPublication>(admin,`${url}/publish`,{expectedDraftRevision:draft.draftRevision,expectedCurrentRevisionId:null,validationId:validation.validationId,trialId:trial.trial.trialId,releaseNotes:'首次发布',acceptedRiskCodes:[],clientActionId:randomUUID()});
    // Managing a seat default does not require granting the administrator that seat's expert.
    await ok(admin,'/api/admin/seats/user/expert-default',{expectedRevision:0,choice:{mode:'expert',expertId:id},clientActionId:randomUUID()},'PUT');
    expect((await call(user,'/api/admin/seats/owner/expert-default',{expectedRevision:0,choice:{mode:'general'},clientActionId:randomUUID()},'PUT')).statusCode).toBe(403);
    const personal=await ok<ExpertDefaultSetting>(user,'/api/me/preferences/expert',{expectedRevision:0,choice:{mode:'general'},clientActionId:randomUUID()},'PUT');expect(personal.scope.id).toBe(user.identity.userId);
    const ownTask=await ok<{id:string}>(user,'/api/tasks',{title:'私有核对',goal:'',visibility:'private',clientActionId:randomUUID()});const workspace=await ok<{id:string}>(user,`/api/tasks/${ownTask.id}/workspace`,{});
    const first=await ok<SessionSnapshot>(user,'/api/sessions',{workspaceId:workspace.id,clientActionId:randomUUID()});expect(first.expert?.expertId).toBe('axon-general');expect(first.expertDefaultSource).toBe('personal');
    const taskDefault=await ok<ExpertDefaultSetting>(user,`/api/tasks/${ownTask.id}/expert-default`,{expectedRevision:0,choice:{mode:'expert',expertId:id},clientActionId:randomUUID()},'PUT');
    expect((await call(admin,`/api/tasks/${ownTask.id}/expert-default`,{expectedRevision:taskDefault.revision,choice:{mode:'general'},clientActionId:randomUUID()},'PUT')).statusCode).toBe(403);
    const action=randomUUID();const fixed=await ok<SessionSnapshot>(user,'/api/sessions',{workspaceId:workspace.id,clientActionId:action});expect(fixed.expert?.revisionId).toBe(pub.revisionId);expect(fixed.expertDefaultSource).toBe('task');
    await ok(user,`/api/tasks/${ownTask.id}/expert-default`,{expectedRevision:taskDefault.revision,choice:{mode:'general'},clientActionId:randomUUID()},'PUT');
    const retry=await ok<SessionSnapshot>(user,'/api/sessions',{workspaceId:workspace.id,clientActionId:action});expect(retry.id).toBe(fixed.id);expect(retry.expert?.revisionId).toBe(pub.revisionId);
    const general=await ok<SessionSnapshot>(user,'/api/sessions',{workspaceId:workspace.id,clientActionId:randomUUID()});expect(general.expert?.expertId).toBe('axon-general');
    const explicit=await ok<SessionSnapshot>(user,'/api/sessions',{workspaceId:workspace.id,expertRef:{expertId:id,revisionId:pub.revisionId},expectedDigest:pub.digest,clientActionId:randomUUID()});expect(explicit.expert?.revisionId).toBe(pub.revisionId);expect(explicit.expertDefaultSource).toBe('explicit');
    // A public-task manager retains business authority; capability admin alone gains none.
    const task=await ok<{id:string}>(owner,'/api/tasks',{title:'公共任务',goal:'明确任务',visibility:'public',clientActionId:randomUUID()});
    expect((await call(admin,`/api/tasks/${task.id}/expert-default`,{expectedRevision:0,choice:{mode:'general'},clientActionId:randomUUID()},'PUT')).statusCode).toBe(403);
    await ok(owner,`/api/tasks/${task.id}/expert-default`,{expectedRevision:0,choice:{mode:'general'},clientActionId:randomUUID()},'PUT');
    await ok(admin,`${url}/lifecycle`,{action:'disable',expectedCurrentRevisionId:pub.revisionId,expectedStateRevision:0,reason:'维护',clientActionId:randomUUID()});
    await ok(user,'/api/me/preferences/expert',{expectedRevision:personal.revision,choice:{mode:'inherit'},clientActionId:randomUUID()},'PUT');
    await ok(user,`/api/tasks/${ownTask.id}/expert-default`,{expectedRevision:taskDefault.revision+1,choice:{mode:'inherit'},clientActionId:randomUUID()},'PUT');
    const invalid=await call(user,'/api/sessions',{workspaceId:workspace.id,clientActionId:randomUUID()});expect(invalid.statusCode).toBe(409);expect(invalid.json().error.code).toBe('EXPERT_DEFAULT_UNAVAILABLE');
    expect((await ok<SessionSnapshot>(user,`/api/sessions/${fixed.id}`)).expert?.revisionId).toBe(pub.revisionId);
    new SystemRoles(lab.access!.db).revoke('admin');
    expect((await call(admin,root)).statusCode).toBe(401);
    expect((await call(admin,'/api/admin/access')).statusCode).toBe(401);
    expect((await call(user,'/api/tasks')).statusCode).toBe(200);
  } finally {await app.close();await rm(dataDir,{recursive:true,force:true});}
},60000);

test('an installation with only an independent administrator starts without inventing a business seat',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'axon-admin-only-api-'));const db=await openDatabase(dataDir);const access=new AccessStore(db);
  migrateAdministratorAccounts(db);await access.saveAdministratorAccount({username:'administrator',displayName:'管理员',password:'test-password-123'});db.close();
  const config=testConfig(dataDir,{auth:{secret:'test-only-signing-key-at-least-32-characters',sessionMs:28800000}});
  const fake=await fakeRuntime(config,()=>({text:'不应调用模型'}));const lab=await PiLab.create(config,fake.runtime);const app=await createApp(lab);
  try {
    const first=await app.inject('/api/auth/session');const anonymous=first.json<AuthSession>();expect(anonymous.loginSeats).toEqual([]);
    const response=await app.inject({method:'POST',url:'/api/auth/login',headers:{cookie:first.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':anonymous.csrf!},payload:{username:'administrator',password:'test-password-123'}});
    expect(response.statusCode,response.body).toBe(200);const auth=response.json<AuthSession>();expect(auth.seats).toEqual([]);expect(auth.identity?.role).toBe('administrator');
    const headers={cookie:response.cookies.map(c=>`${c.name}=${c.value}`).join('; '),'x-axon-view':auth.viewId!};
    const managed=await app.inject({url:'/api/admin/capabilities/experts',headers});expect(managed.statusCode,managed.body).toBe(200);
    const tasks=await app.inject({url:'/api/tasks',headers});expect(tasks.statusCode,tasks.body).toBe(200);expect(tasks.json()).toEqual([]);
    expect(lab.access!.allSeatIds()).toEqual([]);expect(lab.workspaces.listAll()).toEqual([]);expect(fake.calls).toHaveLength(0);
    const logout=await app.inject({url:'/api/auth/logout',method:'POST',headers:{...headers,origin:'http://localhost:4310','x-csrf-token':auth.csrf!},payload:{}});
    expect(logout.statusCode,logout.body).toBe(200);expect(logout.json<AuthSession>().identity).toBeUndefined();
    expect((await app.inject({url:'/api/admin/access',headers})).statusCode).toBe(401);
  } finally {await app.close();await rm(dataDir,{recursive:true,force:true});}
},30000);
