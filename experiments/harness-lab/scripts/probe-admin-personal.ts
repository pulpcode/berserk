/** Synthetic administrator personal-space acceptance; real configured provider/Docker, no production data. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { migrateAdministratorAccounts } from '../src/access/administrator-schema.js';
import { loadConfig } from '../src/server/config.js';
import { configuredRuntime } from '../src/pi/model-runtime.js';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import type { AuthSession, TaskSpace } from '../src/contracts/access.js';
import type { SessionSnapshot, StreamEvent } from '../src/contracts/index.js';

const dataDir=await mkdtemp(join(tmpdir(),'axon-admin-personal-live-'));
delete process.env.LAB_CONTEXT_CONFIG;delete process.env.LAB_BACKGROUND_CONFIG;
const config=loadConfig({...process.env,PORT:'4310',LAB_DATA_DIR:dataDir,LAB_AUTH_MODE:'login',LAB_TEST_SEATS:undefined,LAB_SESSION_SECRET:randomBytes(40).toString('hex'),LAB_EXECUTION_ENABLED:'true',AGENT_RUN_TIMEOUT_MS:'180000'});
assert.ok(config.apiKey,'需要已有授权模型配置。');
const password=randomBytes(24).toString('base64url'),started=Date.now(),checks:string[]=[],records:unknown[]=[],tools:string[][]=[];
let app:FastifyInstance|undefined,lab:PiLab|undefined,failure:string|undefined,attempts=0;
const runtime=await configuredRuntime(config);const stream=runtime.streamSimple.bind(runtime);
runtime.streamSimple=(...args)=>{assert.ok(++attempts<=20,'模型调用预算20次已耗尽。');tools.push(args[1].tools?.map(t=>t.name)??[]);return stream(...args);};
const db=await openDatabase(dataDir);
try {
  const access=new AccessStore(db);await access.saveAccount({username:'business',displayName:'合成业务用户',seatId:'business',seatName:'合成业务席位',password,createPublicTask:true,manageModelSettings:false});
  migrateAdministratorAccounts(db);
  for(const username of ['admin','other-admin'])await access.saveAdministratorAccount({username,displayName:username,password});
} finally {db.close();}
let timer:ReturnType<typeof setTimeout>|undefined;
try {
  lab=await PiLab.create(config,runtime);app=await createApp(lab,false,undefined,{config:{systems:[],scopes:[]},env:{}});assert.equal(lab.info().files?.executionAvailable,true,'真实文件沙箱不可用。');
  timer=setTimeout(()=>{void app?.close();},360000);timer.unref();
  const login=async(username:string)=>{
    const first=await app!.inject('/api/auth/session'),a=first.json<AuthSession>();
    const response=await app!.inject({url:'/api/auth/login',method:'POST',headers:{origin:'http://localhost:4310',cookie:first.cookies.map(c=>`${c.name}=${c.value}`).join('; '),'x-csrf-token':a.csrf!},payload:{username,password}});
    assert.equal(response.statusCode,200);const session=response.json<AuthSession>();
    return {identity:session.identity!,headers:{origin:'http://localhost:4310',cookie:response.cookies.map(c=>`${c.name}=${c.value}`).join('; '),'x-csrf-token':session.csrf!,'x-axon-view':session.viewId!}};
  };
  const admin=await login('admin'),other=await login('other-admin'),business=await login('business');
  const call=(who:typeof admin,url:string,payload?:object,method?:'GET'|'POST'|'PUT')=>app!.inject({url,method:method??(payload?'POST':'GET'),headers:who.headers,...(payload?{payload}:{})});
  const ok=async<T>(who:typeof admin,url:string,payload?:object,method?:'GET'|'POST'|'PUT')=>{const r=await call(who,url,payload,method);assert.equal(r.statusCode,200,`${url}: ${r.body}`);return r.json<T>();};
  const publicTask=await ok<TaskSpace>(business,'/api/tasks',{title:'合成公共任务',goal:'不应向管理员个人空间开放',visibility:'public',clientActionId:randomUUID()});
  assert.deepEqual(await ok(admin,'/api/tasks'),[]);assert.equal((await call(admin,`/api/tasks/${publicTask.id}`)).statusCode,404);
  assert.equal((await call(admin,'/api/tasks',{title:'禁止创建公共任务',goal:'合成输入',visibility:'public',clientActionId:randomUUID()})).statusCode,403);
  const own=await ok<TaskSpace>(admin,'/api/tasks',{title:'管理员合成个人空间',goal:'',visibility:'private',clientActionId:randomUUID()});
  assert.equal(own.ownerUserId,admin.identity.userId);assert.equal(own.visibility,'private');assert.deepEqual(lab.access!.allSeatIds(),['business']);
  for(const who of [business,other])assert.equal((await call(who,`/api/tasks/${own.id}`)).statusCode,404);
  const workspace=await ok<{id:string}>(admin,`/api/tasks/${own.id}/workspace`,{}),session=await ok<SessionSnapshot>(admin,'/api/sessions',{workspaceId:workspace.id,clientActionId:randomUUID()});
  assert.deepEqual(session.messages,[]);assert.equal(attempts,0);checks.push('无业务席位的管理员可显式创建个人空间和空会话，公共任务与他人私有空间隔离');
  const csv=Buffer.from('项目,数量\n苹果,10\n香蕉,20\n');
  const upload=await call(admin,`/api/workspaces/${workspace.id}/uploads`,{name:'sample.csv',size:csv.length});assert.equal(upload.statusCode,201);const uploadId=upload.json<{uploadId:string}>().uploadId;
  const uploaded=await app.inject({method:'PUT',url:`/api/workspaces/${workspace.id}/uploads/${uploadId}/content`,headers:{...admin.headers,'content-type':'application/octet-stream'},payload:csv});assert.equal(uploaded.statusCode,200);assert.equal(uploaded.json<{status:string}>().status,'completed');
  const ask=async(text:string,uploadIds?:string[])=>{
    const r=await call(admin,`/api/sessions/${session.id}/messages`,{text,...(uploadIds?{uploadIds}:{})});assert.equal(r.statusCode,200);
    const events=r.body.split('\n').filter(s=>s.startsWith('data: ')).map(s=>JSON.parse(s.slice(6))as StreamEvent);assert.ok(events.some(e=>e.type==='response.completed'));
    const saved=await ok<SessionSnapshot>(admin,`/api/sessions/${session.id}`);assert.equal(saved.lastResult?.status,'succeeded',saved.lastResult?.message);records.push(saved);return {saved,events};
  };
  const first=await ask('这是明确提供的合成CSV。请使用read读取本条上传文件，按数量求和，必须用write生成summary.md，写入“总数量：30”，再用file_output交付。不要用bash，不查询业务资料，不修改工作区约定。',[uploadId]);
  for(const name of ['read','write','file_output'])assert.ok(first.events.some(e=>e.type==='tool.started'&&e.toolName===name),`未实际调用${name}`);
  const output=first.saved.fileOutputs?.find(f=>f.name==='summary.md');assert.ok(output,'缺少真实交付文件');const download=await call(admin,`/api/workspaces/${workspace.id}/downloads/${output.downloadId}`);assert.equal(download.statusCode,200);assert.match(download.body,/30/);checks.push('真实方舟模型与Docker完成管理员个人文件上传、读写和下载');
  for(const who of [business,other]){assert.equal((await call(who,`/api/sessions/${session.id}`)).statusCode,404);assert.equal((await call(who,`/api/workspaces/${workspace.id}/downloads/${output.downloadId}`)).statusCode,404);}
  const second=await ask('延续刚才的合成数字，若增加5件，总数量是多少？不用工具，用阿拉伯数字回答。');assert.match(second.saved.messages.filter(m=>m.role==='assistant').at(-1)?.text??'',/35/);checks.push('原会话真实第二轮及重新读取历史通过，其他管理员与业务用户不能读取会话/文件');
  for(const names of tools)assert.ok(!names.some(n=>/^(context_|information_|situation_|task_|work_item_|handoff_|simulation_|annotation_|scenario_|spatial_)/.test(n)),`个人会话出现业务工具：${names.join(',')}`);
  assert.equal((await call(admin,'/api/context/catalog')).statusCode,403);assert.equal((await call(admin,'/api/workbench/items')).statusCode,403);checks.push('个人请求未注册业务工具，业务API仍被拒绝');
} catch(error){failure=error instanceof Error?error.message:'验收失败';}
finally {
  clearTimeout(timer);if(app)await app.close();else await lab?.close();
  const report={passed:!failure,...(failure?{failure}:{}),dataDir,elapsedMs:Date.now()-started,attempts,model:{provider:config.provider,id:config.model},checks,tools,records};
  const serialized=JSON.stringify(report,null,2);assert.ok(!serialized.includes(config.apiKey)&&!serialized.includes(password),'证据包含凭证，拒绝落盘');
  const path=join(dataDir,'admin-personal-evidence.json');await writeFile(path,serialized,{mode:0o600});console.info(JSON.stringify({passed:!failure,...(failure?{failure}:{}),checks,evidence:path}));if(failure)process.exitCode=1;
}
