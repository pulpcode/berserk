import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { AccessStore } from '../src/access/store.js';
import { openDatabase } from '../src/access/database.js';
import { migrateAdministratorAccounts } from '../src/access/administrator-schema.js';
import { SystemRoles } from '../src/access/system-roles.js';
import type { AuthSession } from '../src/contracts/access.js';
import { createApp } from '../src/server/app.js';
import { PiLab } from '../src/pi/lab.js';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';

test('one login selection publishes safe administrator choices and applies the existing password/session guards', async () => {
  const dataDir=await mkdtemp(join(tmpdir(),'axon-unified-login-'));
  const db=await openDatabase(dataDir);const access=new AccessStore(db);const password='test-password-123';
  const businessId=await access.saveAccount({username:'private-business-username',displayName:'账号私有显示名',seatId:'overall',seatName:'总体席',password,createPublicTask:true,manageModelSettings:true});
  migrateAdministratorAccounts(db);
  const adminId=await access.saveAdministratorAccount({username:'private-administrator-username',displayName:'管理员',password});
  const disabledId=await access.saveAdministratorAccount({username:'disabled-administrator-username',displayName:'停用管理员',password});
  const revokedId=await access.saveAdministratorAccount({username:'revoked-administrator-username',displayName:'撤权管理员',password});
  const roles=new SystemRoles(db);roles.grant('private-business-username');access.disable('disabled-administrator-username');roles.revoke('revoked-administrator-username');
  db.close();
  const config=testConfig(dataDir,{auth:{secret:'test-only-signing-key-at-least-32-characters',sessionMs:28800000}});
  const fake=await fakeRuntime(config,()=>({text:'不应调用模型'}));const lab=await PiLab.create(config,fake.runtime);const app=await createApp(lab);
  try {
    const first=await app.inject('/api/auth/session');const anonymous=first.json<AuthSession>();
    expect(anonymous.loginSeats).toEqual([{id:'overall',name:'总体席'}]);expect(anonymous.loginUsers).toEqual([{id:adminId,name:'管理员'}]);
    expect(Object.keys(anonymous.loginUsers![0]).sort()).toEqual(['id','name']);
    for(const secret of ['private-business-username','private-administrator-username','disabled-administrator-username','revoked-administrator-username','账号私有显示名','停用管理员','撤权管理员','password_hash','granted_at'])expect(first.body).not.toContain(secret);
    expect(lab.access!.allSeatIds()).toEqual(['overall']);expect(lab.access!.identityForLoginUser(businessId)).toBeUndefined();
    const attempt=async(payload:object)=>{
      const bootstrap=await app.inject('/api/auth/session');const auth=bootstrap.json<AuthSession>();
      return app.inject({url:'/api/auth/login',method:'POST',headers:{cookie:bootstrap.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':auth.csrf!},payload});
    };
    for(const payload of [{accountId:adminId,seatId:'overall',password},{accountId:adminId,username:'private-administrator-username',password},{accountId:adminId,password,role:'administrator'}])expect((await attempt(payload)).statusCode).toBe(400);
    expect((await app.inject({url:'/api/auth/login',method:'POST',headers:{origin:'http://localhost:4310'},payload:{accountId:adminId,password}})).statusCode).toBe(403);
    for(const payload of [{accountId:businessId,password},{accountId:randomUUID(),password},{accountId:disabledId,password},{accountId:revokedId,password},{accountId:adminId,password:'wrong-password'}]){
      const denied=await attempt(payload);expect(denied.statusCode,denied.body).toBe(401);expect(denied.json().error).toEqual({code:'INVALID_CREDENTIALS',message:'账号或密码不正确。'});
    }
    const response=await attempt({accountId:adminId,password});expect(response.statusCode,response.body).toBe(200);const auth=response.json<AuthSession>();
    expect(auth.identity).toMatchObject({userId:adminId,role:'administrator',canCollaborate:false});expect(auth.identity).not.toHaveProperty('seatId');expect(auth.seats).toEqual([]);
    expect(auth.loginUsers).toBeUndefined();expect(auth.csrf).not.toBe(anonymous.csrf);expect(auth.viewId).not.toBe(anonymous.viewId);
    const headers={cookie:response.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':auth.csrf!,'x-axon-view':auth.viewId!};
    expect((await app.inject({url:'/api/admin/access',headers})).json()).toEqual({administrator:true});const tasks=await app.inject({url:'/api/tasks',headers});expect(tasks.statusCode).toBe(200);expect(tasks.json()).toEqual([]);
    expect((await app.inject({url:'/api/admin/access',headers:{...headers,'x-axon-view':anonymous.viewId!}})).statusCode).toBe(409);
    const business=await attempt({seatId:'overall',password});expect(business.statusCode,business.body).toBe(200);expect(business.json<AuthSession>().identity).toMatchObject({userId:businessId,seatId:'overall'});
    new SystemRoles(lab.access!.db).revoke('private-administrator-username');
    expect((await app.inject({url:'/api/admin/access',headers})).statusCode).toBe(401);const revokedChoices=(await app.inject('/api/auth/session')).json<AuthSession>();expect(revokedChoices.loginUsers).toBeUndefined();
    const businessHeaders={cookie:business.cookies.map(c=>`${c.name}=${c.value}`).join('; ')};expect((await app.inject({url:'/api/tasks',headers:businessHeaders})).statusCode).toBe(200);
    expect(fake.calls).toHaveLength(0);expect(lab.workspaces.listAll()).toEqual([]);
  } finally {await app.close();await rm(dataDir,{recursive:true,force:true});}
},60000);
