import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { AccessStore } from '../src/access/store.js';
import { openDatabase } from '../src/access/database.js';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';
import type { AuthSession, TaskSpace } from '../src/contracts/access.js';

const cleanups:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
async function setup() {
  const dir=await mkdtemp(join(tmpdir(),'axon-access-'));cleanups.push(()=>rm(dir,{recursive:true,force:true}));
  const db=await openDatabase(dir);const store=new AccessStore(db);
  for(const name of ['a','b','c'])await store.saveAccount({username:name,displayName:name,seatId:name,seatName:`席位 ${name}`,password:'test-password-123',createPublicTask:name==='a',manageModelSettings:name==='a'});
  db.close();
  const config=testConfig(dir,{seatId:'a',auth:{secret:'test-only-signing-key-at-least-32-characters',sessionMs:28800000}});
  const fake=await fakeRuntime(config,()=>({text:'任务处理完成'})); const lab=await PiLab.create(config,fake.runtime);const app=await createApp(lab);cleanups.push(()=>app.close());
  return {app,lab,dir,config,fake};
}
async function login(app:FastifyInstance,name:string) {
  let boot=await app.inject('/api/auth/session'); let cookie=boot.cookies.map(c=>`${c.name}=${c.value}`).join('; ');
  const anonymous=cookie;
  boot=await app.inject({method:'POST',url:'/api/auth/login',headers:{cookie,origin:'http://localhost:4310','x-csrf-token':boot.json<AuthSession>().csrf!},payload:{username:name,password:'test-password-123'}});
  expect(boot.statusCode,boot.body).toBe(200);cookie=boot.cookies.map(c=>`${c.name}=${c.value}`).join('; ');expect(cookie).not.toBe(anonymous);
  expect(boot.headers['set-cookie']).toContain('HttpOnly');
  expect(boot.headers['set-cookie']).toContain('SameSite=Strict');
  const auth=boot.json<AuthSession>();
  const headers={cookie,origin:'http://localhost:4310','x-csrf-token':auth.csrf!,'x-axon-view':auth.viewId!};
  return {auth,headers,call:(url:string,payload?:object,method:'POST'|'PUT'|'DELETE'='POST')=>app.inject({url,method:payload===undefined?'GET':method,headers,...(payload===undefined?{}:{payload})})};
}
const input=(visibility:'public'|'private'='public')=>({title:'联合任务',goal:'汇总资料形成计划',visibility,clientActionId:randomUUID()});
describe('authenticated task scopes',()=>{
  it('requires explicit production credentials and rejects test-seat bypass, CSRF and stale views',async()=>{
    expect(()=>loadConfig({})).toThrow('初始化');
    expect(()=>loadConfig({LAB_SESSION_SECRET:'x'.repeat(40),LAB_TEST_SEATS:'[]'})).toThrow('LAB_TEST_SEATS');
    const {app}=await setup();
    for(const url of ['/api/info','/api/activity','/api/workspaces','/api/test-seats/a/activity'])expect((await app.inject(url)).statusCode).toBe(401);
    const a=await login(app,'a');expect(a.auth.identity?.seatId).toBe('a');
    expect((await a.call('/api/test-seats/b/activity')).statusCode).toBe(404);
    expect((await app.inject({method:'POST',url:'/api/tasks',headers:{cookie:a.headers.cookie,origin:a.headers.origin},payload:input()})).statusCode).toBe(403);
    const b=await login(app,'b');expect((await app.inject({method:'POST',url:'/api/tasks',headers:{...b.headers,'x-axon-view':a.auth.viewId!},payload:input('private')})).statusCode).toBe(409);
    expect((await b.call('/api/tasks',input())).statusCode).toBe(403);
    expect((await b.call('/api/settings/model',{provider:'deepseek',model:'deepseek-flash',baseUrl:'https://api.deepseek.com',expectedVersion:randomUUID()},'PUT')).statusCode).toBe(403);
    const logout=await a.call('/api/auth/logout',{});
    expect(logout.statusCode).toBe(200);expect(logout.json().identity).toBeUndefined();
    const anonymousCookie=logout.cookies.map(c=>`${c.name}=${c.value}`).join('; ');
    const tabs=await Promise.all([1,2].map(()=>app.inject({url:'/api/auth/session',headers:{cookie:anonymousCookie}})));
    expect(tabs.map(r=>r.json().csrf)).toEqual([logout.json().csrf,logout.json().csrf]);
    expect((await a.call('/api/activity')).statusCode).toBe(401);
  });
  it('keeps public metadata separate from per-seat histories and files, and preserves native task context',async()=>{
    const {app,lab,dir,fake}=await setup();const a=await login(app,'a'),b=await login(app,'b');
    lab.access!.disable('c');
    expect(lab.workspaces.listAll()).toHaveLength(0);
    const publicInput=input();const task=(await a.call('/api/tasks',publicInput)).json<TaskSpace>();
    expect(task.id).toBeTruthy();expect((await a.call('/api/tasks',publicInput)).json().id).toBe(task.id);
    expect((await a.call('/api/tasks',{...publicInput,title:'不同'})).statusCode).toBe(409);
    const privateTask=(await a.call('/api/tasks',input('private'))).json<TaskSpace>();
    expect((await b.call('/api/tasks')).json().map((x:TaskSpace)=>x.id)).toEqual([task.id]);
    for(const suffix of ['', '/workspace'])expect((await b.call(`/api/tasks/${privateTask.id}${suffix}`,suffix?{}:undefined)).statusCode).toBe(404);
    expect(lab.workspaces.listAll()).toHaveLength(0);
    const wa=(await a.call(`/api/tasks/${task.id}/workspace`,{})).json(),wb=(await b.call(`/api/tasks/${task.id}/workspace`,{})).json();expect(wa.id).not.toBe(wb.id);
    await writeFile(join(dir,'workspaces',wa.id,'files','私密.txt'),'only A');
    expect((await b.call(`/api/workspaces/${wa.id}/files`)).statusCode).toBe(404);
    const sa=(await a.call('/api/sessions',{workspaceId:wa.id})).json();
    expect((await b.call(`/api/sessions/${sa.id}`)).statusCode).toBe(404);
    const stream=await a.call(`/api/sessions/${sa.id}/messages`,{text:'请继续'});expect(stream.body).toContain('response.completed');
    expect(lab.get(sa.id,'a').lastResult?.status).toBe('succeeded');
    expect(fake.calls.at(-1)!.context.systemPrompt).toContain('"id":"b","name":"席位 b"');
    expect(fake.calls.at(-1)!.context.systemPrompt).not.toContain('"id":"c","name":"席位 c"');
    expect(fake.calls.at(-1)!.context.systemPrompt).not.toContain('可分派测试席位：undefined');
    const resources=await a.call(`/api/sessions/${sa.id}/requests/${lab.get(sa.id,'a').lastResult!.requestId}/resources`);expect(resources.json().task.goal).toBe(task.goal);
    const edited=await a.call(`/api/tasks/${task.id}`,{revision:1,title:'新的任务名称',goal:'新目标'},'PUT');expect(edited.statusCode).toBe(200);
    expect((await b.call('/api/workspaces')).json().workspaces[0].name).toBe('新的任务名称');
    expect((await a.call(`/api/tasks/${task.id}`,{revision:1,title:'旧修改',goal:'x'},'PUT')).statusCode).toBe(409);
    lab.access!.disable('b');
    await a.call(`/api/sessions/${sa.id}/messages`,{text:'现在可以指派给谁'});
    expect(fake.calls.at(-1)!.context.systemPrompt).not.toContain('"id":"b","name":"席位 b"');
  });
  it('holds archive admission across execution and uploads, with history readable after archiving',async()=>{
    const {app,lab}=await setup();const a=await login(app,'a');const task=(await a.call('/api/tasks',input())).json<TaskSpace>();const w=(await a.call(`/api/tasks/${task.id}/workspace`,{})).json();
    const s=(await a.call('/api/sessions',{workspaceId:w.id})).json();const execution=lab.start(s.id,'continue',{},'a');
    expect((await a.call(`/api/tasks/${task.id}/archive`,{revision:1})).statusCode).toBe(409);
    await execution.run(()=>{});
    const release=lab.workspaces.acquireWrite(w.id,'a');expect((await a.call(`/api/tasks/${task.id}/archive`,{revision:1})).statusCode).toBe(409);release();
    expect((await a.call(`/api/tasks/${task.id}/archive`,{revision:1})).statusCode).toBe(200);
    expect((await a.call(`/api/sessions/${s.id}`)).statusCode).toBe(200);
    expect((await a.call('/api/sessions',{workspaceId:w.id})).statusCode).toBe(409);
    expect((await a.call(`/api/workspaces/${w.id}/uploads`,{name:'x.txt',size:1})).statusCode).toBe(409);
    expect((await a.call(`/api/sessions/${s.id}/messages`,{text:'new'})).statusCode).toBe(409);
    expect((await a.call(`/api/tasks/${task.id}/reopen`,{revision:2})).statusCode).toBe(200);
    expect((await a.call('/api/sessions',{workspaceId:w.id})).statusCode).toBe(200);
  });
  it('keeps handoff participants private and refuses private task assignments',async()=>{
    const {app}=await setup();const a=await login(app,'a'),b=await login(app,'b'),c=await login(app,'c');
    for(const visibility of ['private','public'] as const){
      const task=(await a.call('/api/tasks',input(visibility))).json<TaskSpace>();const workspace=(await a.call(`/api/tasks/${task.id}/workspace`,{})).json();
      const result=await a.call('/api/work-items/prepare',{clientActionId:randomUUID(),kind:'assign',taskSpaceId:task.id,payload:{workspaceId:workspace.id,assigneeSeatId:'b',title:'编制文件',goal:'完成汇总',inputPaths:[]}});
      if(visibility==='private'){expect(result.statusCode,result.body).toBe(403);continue;}
      expect(result.statusCode,result.body).toBe(200);const action=result.json();
      expect((await a.call(`/api/tasks/${task.id}/archive`,{revision:1})).statusCode).toBe(409);
      const receipt=(await a.call(`/api/work-actions/${action.operationId}/commit`,{confirm:true})).json();expect(receipt.workItemId).toBeTruthy();
      expect((await b.call(`/api/work-items/${receipt.workItemId}`)).statusCode).toBe(200);
      expect((await c.call(`/api/work-items/${receipt.workItemId}`)).statusCode).toBe(404);
      expect((await a.call(`/api/tasks/${task.id}/archive`,{revision:1})).statusCode).toBe(409);
    }
  });
  it('revokes expired/reset sessions and retains hashed credentials only',async()=>{
    const {app,lab,dir}=await setup();const a=await login(app,'a');
    lab.access!.db.prepare('UPDATE auth_sessions SET expires=0 WHERE user_id=?').run(a.auth.identity!.userId);
    expect((await a.call('/api/info')).statusCode).toBe(401);
    const again=await login(app,'a');lab.access!.disable('a');expect((await again.call('/api/info')).statusCode).toBe(401);
    const content=await readFile(join(dir,'collaboration','collaboration.sqlite'));expect(content.includes(Buffer.from('test-password-123'))).toBe(false);
  });
});

it('reopens native history and login metadata without importing unrelated old workspaces',async()=>{
  const {app,config,dir}=await setup();const a=await login(app,'a');
  const task=(await a.call('/api/tasks',input())).json<TaskSpace>();const w=(await a.call(`/api/tasks/${task.id}/workspace`,{})).json();const s=(await a.call('/api/sessions',{workspaceId:w.id})).json();
  await a.call(`/api/sessions/${s.id}/messages`,{text:'hello'});
  const {readdir}=await import('node:fs/promises');const file=(await readdir(join(dir,'sessions'))).find(name=>name.endsWith('.jsonl'))!;const bytes=await readFile(join(dir,'sessions',file));
  await app.close();
  await expect(PiLab.create({...config,auth:undefined})).rejects.toThrow('测试身份');
  const fake=await fakeRuntime(config,()=>({text:'continued'}));const restored=await PiLab.create(config,fake.runtime);const reopened=await createApp(restored);cleanups.push(()=>reopened.close());
  expect((await reopened.inject({url:'/api/activity',headers:a.headers})).statusCode).toBe(200);
  expect(restored.get(s.id,'a').lastResult?.status).toBe('succeeded');expect(await readFile(join(dir,'sessions',file))).toEqual(bytes);
  restored.access!.disable('b');await reopened.close();const again=await PiLab.create(config,fake.runtime);cleanups.push(()=>again.close());expect(again.access!.seats().map(s=>s.id)).toEqual(['a','c']);
});

it('backs up old data intact before clean initialization and never overwrites a backup',async()=>{
  const {execFileSync}=await import('node:child_process');
  const {mkdir}=await import('node:fs/promises');
  const root=await mkdtemp(join(tmpdir(),'axon-reset-'));cleanups.push(()=>rm(root,{recursive:true,force:true}));
  const dir=join(root,'data'),backup=join(root,'backup');await mkdir(join(dir,'sessions'),{recursive:true});await writeFile(join(dir,'sessions','old.jsonl'),'exact old history\n');await writeFile(join(dir,'model-settings.json'),'{}');
  const args=['--import','tsx','scripts/access-admin.ts','reset','--data-dir',dir,'--backup-dir',backup,'--service-stopped'];
  execFileSync(process.execPath,args,{stdio:'pipe'});
  expect(await readFile(join(backup,'sessions','old.jsonl'),'utf8')).toBe('exact old history\n');expect(await readFile(join(dir,'model-settings.json'),'utf8')).toBe('{}');
  expect(()=>execFileSync(process.execPath,args,{stdio:'pipe'})).toThrow();
  expect(await readFile(join(backup,'sessions','old.jsonl'),'utf8')).toBe('exact old history\n');
});
