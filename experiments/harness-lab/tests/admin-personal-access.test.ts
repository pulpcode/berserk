import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { migrateAdministratorAccounts } from '../src/access/administrator-schema.js';
import { SystemRoles } from '../src/access/system-roles.js';
import { createApp } from '../src/server/app.js';
import { PiLab } from '../src/pi/lab.js';
import type { AuthSession, TaskInput, TaskSpace } from '../src/contracts/access.js';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const password = 'test-password-123';
const input = (title = '个人测试空间'): TaskInput => ({title,goal:'',visibility:'private',clientActionId:randomUUID()});
async function setup() {
  const dataDir=await mkdtemp(join(tmpdir(),'axon-admin-personal-access-'));cleanups.push(()=>rm(dataDir,{recursive:true,force:true}));
  const db=await openDatabase(dataDir),access=new AccessStore(db);let open=true;cleanups.push(async()=>{if(open)db.close();});
  await access.saveAccount({username:'business',displayName:'业务用户',seatId:'business',seatName:'业务席',password,createPublicTask:true,manageModelSettings:false});
  migrateAdministratorAccounts(db);
  const first=await access.saveAdministratorAccount({username:'admin-a',displayName:'管理员A',password});
  const second=await access.saveAdministratorAccount({username:'admin-b',displayName:'管理员B',password});
  return {dataDir,db,access,first,second,close:()=>{if(open){open=false;db.close();}}};
}

test('account personal owners reuse private spaces without creating a business seat',async()=>{
  const e=await setup(),actor=e.access.workspaceIdentity(e.first)!;
  expect(e.access.accountIdentity(e.first)).toMatchObject({role:'administrator',personalScopeId:`account-${e.first}`,canCollaborate:false});
  expect(e.access.identity(e.first)).toBeUndefined();expect(actor.seatId).toBe(`account-${e.first}`);
  expect(e.access.canCollaborate(actor.seatId)).toBe(false);expect(e.access.canUseWorkspace(actor.seatId)).toBe(true);
  expect(()=>e.access.assertCanCollaborate(actor.seatId)).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  const request=input(),space=e.access.create(actor,request);
  expect(space).toMatchObject({visibility:'private',ownerUserId:e.first,ownerSeatId:actor.seatId});
  expect(e.access.create(actor,request)).toEqual(space);expect(e.access.findCreation(actor,request.clientActionId)).toEqual([space]);
  expect(()=>e.access.create(actor,{...request,title:'同一动作不同内容'})).toThrowError(expect.objectContaining({code:'TASK_CONFLICT'}));
  const edited=e.access.update(actor,space.id,space.revision,{title:'修改后的个人空间',context:null});expect(edited.revision).toBe(2);expect(edited.context).toBeUndefined();
  expect(()=>e.access.update(actor,space.id,1,{goal:'过期写入'})).toThrowError(expect.objectContaining({code:'TASK_CONFLICT'}));
  const release=e.access.acquire(space.id,actor.seatId);
  expect(()=>e.access.update(actor,space.id,2,{state:'archived'})).toThrowError(expect.objectContaining({code:'TASK_CONFLICT'}));release();
  const archived=e.access.update(actor,space.id,2,{state:'archived'});expect(()=>e.access.acquire(space.id,actor.seatId)).toThrowError(expect.objectContaining({code:'TASK_ARCHIVED'}));
  expect(e.access.update(actor,space.id,archived.revision,{state:'active'}).state).toBe('active');
  expect(e.access.allSeatIds()).toEqual(['business']);expect(e.access.businessSeats().map(s=>s.id)).toEqual(['business']);
});

test('personal scopes cannot read public business tasks, foreign private spaces or mutate business lineage',async()=>{
  const e=await setup(),a=e.access.workspaceIdentity(e.first)!,b=e.access.workspaceIdentity(e.second)!,business=e.access.identityForSeat('business')!;
  const mine=e.access.create(a,input()),other=e.access.create(b,input('第二个管理员空间')),privateBusiness=e.access.create(business,input('业务用户私有空间'));
  const publicBusiness=e.access.create(business,{...input('公共任务'),visibility:'public',goal:'业务目标'});
  expect(e.access.list(a.seatId)).toEqual([mine]);expect(e.access.list(b.seatId)).toEqual([other]);
  expect(e.access.list('business').map(x=>x.id).sort()).toEqual([publicBusiness.id,privateBusiness.id].sort());
  for(const id of [other.id,privateBusiness.id,publicBusiness.id])expect(()=>e.access.get(id,a.seatId)).toThrowError(expect.objectContaining({code:'TASK_NOT_FOUND'}));
  for(const who of [business,b])expect(()=>e.access.get(mine.id,who.seatId)).toThrowError(expect.objectContaining({code:'TASK_NOT_FOUND'}));
  expect(()=>e.access.create(a,{...input(),visibility:'public',goal:'不应创建公共任务'})).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  expect(()=>e.access.create({...a,createPublicTask:true},{...input(),visibility:'public',goal:'伪造业务权限'})).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  const context={businessRefs:[{systemId:'situation',objectType:'resource',objectId:'private',role:'reference' as const}]};
  expect(()=>e.access.create(a,{...input(),context})).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  expect(()=>e.access.update(a,mine.id,1,{context})).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  expect(()=>e.access.create(a,input(),'scene-one')).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  expect(()=>e.access.createInTransaction(a,input(),{eventId:randomUUID(),jobId:randomUUID(),reason:'伪造业务来源'})).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  expect(()=>e.access.create({...a,userId:e.second},input())).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  expect(()=>e.access.update({...a,userId:e.second},mine.id,1,{goal:'伪造所有者'})).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
});

test('disabled and revoked personal owners retain valid history while new use is rejected',async()=>{
  const e=await setup(),a=e.access.workspaceIdentity(e.first)!,b=e.access.workspaceIdentity(e.second)!;
  const first=e.access.create(a,input()),second=e.access.create(b,input('另一个空间'));
  new SystemRoles(e.db).revoke('admin-a');e.access.disable('admin-b');
  const reopened=new AccessStore(e.db);
  for(const [actor,space]of [[a,first],[b,second]]as const){
    expect(reopened.get(space.id,actor.seatId)).toEqual(space);expect(reopened.list(actor.seatId)).toEqual([space]);
    expect(reopened.workspaceIdentity(actor.userId)).toBeUndefined();expect(reopened.canUseWorkspace(actor.seatId)).toBe(false);
    expect(()=>reopened.acquire(space.id,actor.seatId)).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
    expect(()=>reopened.create(actor,input())).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
    expect(()=>reopened.update(actor,space.id,1,{title:'失效身份'})).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
    expect(()=>reopened.findCreation(actor,randomUUID())).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  }
});

test('reserved storage namespaces and malformed personal ownership fail closed',async()=>{
  const e=await setup(),actor=e.access.workspaceIdentity(e.first)!,space=e.access.create(actor,input());
  await expect(e.access.saveAccount({username:'collision',displayName:'错误席位',seatId:actor.seatId,seatName:'错误席位',password,createPublicTask:false,manageModelSettings:false})).rejects.toThrow('保留');
  const tampered={...space,ownerUserId:e.second};e.db.prepare('UPDATE task_spaces SET data=? WHERE id=?').run(JSON.stringify(tampered),space.id);
  expect(()=>e.access.get(space.id,actor.seatId)).toThrowError(expect.objectContaining({code:'RESOURCE_STATE_INVALID'}));
  e.db.prepare('UPDATE task_spaces SET data=? WHERE id=?').run(JSON.stringify(space),space.id);
  e.db.prepare("INSERT INTO seats(id,name,create_public,manage_model) VALUES(?,'错误席位',0,0)").run(actor.seatId);
  expect(()=>e.access.accountIdentity(e.first)).toThrowError(expect.objectContaining({code:'RESOURCE_STATE_INVALID'}));
  expect(()=>e.access.list(actor.seatId)).toThrowError(expect.objectContaining({code:'RESOURCE_STATE_INVALID'}));
});

test('HTTP task metadata uses the current account owner and keeps business endpoints denied',async()=>{
  const e=await setup(),business=e.access.identityForSeat('business')!;
  const publicTask=e.access.create(business,{...input('业务公共任务'),goal:'仅业务使用',visibility:'public'}),foreign=e.access.create(business,input('业务私有空间'));
  e.close();const config=testConfig(e.dataDir,{auth:{secret:'test-only-signing-key-at-least-32-characters',sessionMs:28800000}}),fake=await fakeRuntime(config,()=>({text:'无需调用模型'})),lab=await PiLab.create(config,fake.runtime),app=await createApp(lab);cleanups.push(()=>app.close());
  const bootstrap=await app.inject('/api/auth/session'),anonymous=bootstrap.json<AuthSession>();
  const response=await app.inject({url:'/api/auth/login',method:'POST',headers:{cookie:bootstrap.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':anonymous.csrf!},payload:{accountId:e.first,password}});expect(response.statusCode,response.body).toBe(200);
  const auth=response.json<AuthSession>(),headers={cookie:response.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':auth.csrf!,'x-axon-view':auth.viewId!};
  const call=(url:string,payload?:object,method:'POST'|'PUT'='POST')=>app.inject({url,method:payload?method:'GET',headers,...(payload?{payload}:{})});
  expect((await call('/api/tasks')).json()).toEqual([]);
  const created=await call('/api/tasks',input());expect(created.statusCode,created.body).toBe(200);const mine=created.json<TaskSpace>();expect(mine.ownerUserId).toBe(e.first);
  const list=await app.inject({url:'/api/tasks',headers:{...headers,'x-axon-seat':'business'}});expect(list.json()).toEqual([mine]);
  for(const id of [publicTask.id,foreign.id]){expect((await call(`/api/tasks/${id}`)).statusCode).toBe(404);expect((await call(`/api/tasks/${id}`,{title:'越权',goal:'业务目标',revision:1},'PUT')).statusCode).toBe(404);}
  expect((await call('/api/tasks',{...input(),visibility:'public',goal:'公共任务'})).statusCode).toBe(403);
  expect((await call('/api/tasks',{...input(),ownerUserId:e.second})).statusCode).toBe(400);
  for(const path of ['/api/context/catalog','/api/information/access','/api/workbench/items','/api/settings/models'])expect((await call(path)).statusCode,path).toBe(403);
  new SystemRoles(lab.access!.db).revoke('admin-a');expect((await call('/api/tasks')).statusCode).toBe(401);
  expect(fake.calls).toHaveLength(0);expect(lab.access!.allSeatIds()).toEqual(['business']);
},30000);
