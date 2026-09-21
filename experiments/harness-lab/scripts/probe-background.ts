/** Isolated live provider + Docker acceptance; never reads production task data. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/server/config.js';
import { createApp } from '../src/server/app.js';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { PiLab } from '../src/pi/lab.js';
import { BackgroundStore } from '../src/background/store.js';
import { parseBackgroundConfig } from '../src/background/config.js';
import type { BackgroundAction, BackgroundJob, InboxItem } from '../src/contracts/background.js';
import type { AuthSession } from '../src/contracts/access.js';

const config = loadConfig({...process.env,LAB_AUTH_MODE:'test'});
assert.ok(config.apiKey,'需要可用模型 API Key。');
config.dataDir = await mkdtemp(join(tmpdir(),'axon-background-live-'));
config.testSeats = undefined; config.seatId = 'a';
config.auth = {secret:randomBytes(40).toString('hex'),sessionMs:3600000};
const password = randomBytes(24).toString('hex');
const db = await openDatabase(config.dataDir), access = new AccessStore(db);
for (const seatId of ['a','b']) await access.saveAccount({username:seatId,displayName:seatId,seatId,seatName:`席位 ${seatId}`,password,createPublicTask:true,manageModelSettings:seatId === 'a'});
const aid = String(db.prepare("SELECT id FROM accounts WHERE username='a'").get()!.id), a = access.identity(aid)!;
const task = access.create(a,{title:'信息处理真实验收',goal:'计算验证数据，并保留各席位独立分析。',visibility:'public',clientActionId:randomUUID()});
db.close();
const lab = await PiLab.create(config);
assert.equal(lab.info().files?.executionAvailable,true,'需要真实 Docker 沙盒。');
const store = new BackgroundStore(lab.access!.db);
store.grant('seat','a','test-source','manage');
const profile = parseBackgroundConfig({enabled:true,modelConcurrency:2,concurrency:1,sources:[{sourceId:'test-source',name:'验收来源',credentialRef:'PROBE_SOURCE_TOKEN',allowedProfileIds:['preprocess'],allowedRecipientSeatIds:['a','b']}],profiles:[{
  id:'preprocess',name:'资料预处理',goal:'请读取收到的 CSV，用 write 创建 Python 脚本 analyze.py，用 bash 执行 python3 analyze.py，统计 amount 列总和，写入 report.txt 并调用 file_output 交付。最后中文说明总和及待核实问题。仅使用所附文件，无需人工提问。当前目录已经是 /workspace，不使用 cd。执行脚本只调用 bash 的 command="python3 analyze.py"。',tools:['read','write','bash','file_output'],instructions:'这是独立验收，请保留所有中间文件。',skillIds:[],agentIds:[],resources:[],
}]});
store.createRule(aid,randomUUID(),{sourceId:'test-source',name:'双席位预处理投递',profileId:'preprocess',recipientSeatIds:['a','b'],enabled:true});
const token = randomBytes(32).toString('hex');
const app = await createApp(lab,false,{config:profile,env:{PROBE_SOURCE_TOKEN:token}});
async function login(app:FastifyInstance,name:string) {
  const initial = await app.inject('/api/auth/session'); const cookie = initial.cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const response = await app.inject({method:'POST',url:'/api/auth/login',headers:{cookie,origin:`http://localhost:${config.port}`,'x-csrf-token':initial.json<AuthSession>().csrf!},payload:{username:name,password}});
  assert.equal(response.statusCode,200,response.body); const auth = response.json<AuthSession>();
  return {cookie:response.cookies.map(c => `${c.name}=${c.value}`).join('; '),origin:`http://localhost:${config.port}`,'x-csrf-token':auth.csrf!,'x-axon-view':auth.viewId!};
}
async function finished(id:string):Promise<BackgroundJob> {
  const deadline = Date.now()+15*60*1000;
  while (Date.now()<deadline) {const job = store.getJob(id); if (!['queued','running'].includes(job.status)) return job; await new Promise(resolve => setTimeout(resolve,500));}
  throw new Error('真实后台验收未在15分钟内结束；记录保留供核对。');
}
const evidence:Record<string,unknown> = {passed:false,dataDir:config.dataDir,model:lab.info().model};
try {
  await app.ready(); const ah = await login(app,'a'),bh = await login(app,'b');
  const sourceHeaders = {authorization:`Bearer ${token}`};
  const csv = 'name,amount\n甲,10\n乙,20\n丙,12\n';
  const upload = await app.inject({method:'POST',url:'/api/integrations/test-source/uploads',headers:sourceHeaders,payload:{name:'data.csv',size:Buffer.byteLength(csv)}}); assert.equal(upload.statusCode,201,upload.body);
  const receive = await app.inject({method:'PUT',url:`/api/integrations/test-source/uploads/${upload.json().uploadId}/content`,headers:{...sourceHeaders,'content-type':'application/octet-stream'},payload:Buffer.from(csv)}); assert.equal(receive.statusCode,200,receive.body);
  const input = {sourceMessageId:randomUUID(),title:'离线收到数据',text:'请核对附件数据。',uploadIds:[upload.json().uploadId]};
  const accepted = await app.inject({method:'POST',url:'/api/integrations/test-source/events',headers:sourceHeaders,payload:input}); assert.equal(accepted.statusCode,202,accepted.body);
  const duplicate = await app.inject({method:'POST',url:'/api/integrations/test-source/events',headers:sourceHeaders,payload:input}); assert.deepEqual(duplicate.json(),accepted.json());
  const event = store.getEvent(accepted.json().eventId); const pre = await finished(event.initialJobId!); evidence.preprocess = pre;
  assert.equal(pre.status,'succeeded',JSON.stringify(pre.error)); assert.ok(pre.result?.files.length);
  assert.ok((await readFile(join(config.dataDir,'background','jobs',pre.id,'files','report.txt'),'utf8')).includes('42'));
  let deliveries = store.listDeliveries().filter(delivery => delivery.jobId === pre.id);
  for (let attempts=0; attempts<40 && deliveries.some(delivery => delivery.status !== 'delivered'); attempts++) {await new Promise(resolve => setTimeout(resolve,100)); deliveries = store.listDeliveries().filter(delivery => delivery.jobId === pre.id);}
  assert.equal(deliveries.length,2); assert.ok(deliveries.every(delivery => delivery.status === 'delivered')); evidence.deliveries = deliveries;
  const ai = (await app.inject({url:'/api/inbox',headers:ah})).json<{items:InboxItem[]}>().items[0];
  const bi = (await app.inject({url:'/api/inbox',headers:bh})).json<{items:InboxItem[]}>().items[0];
  assert.equal(ai.event.ruleSnapshot,undefined); assert.equal(bi.job.ruleSnapshot,undefined);
  const callsBefore = store.listJobs().length;
  const prepare = await app.inject({method:'POST',url:`/api/inbox/${ai.delivery.id}/analyses`,headers:ah,payload:{clientActionId:randomUUID(),taskSpaceId:task.id,goal:'请简要核验预处理总和，并指出需要确认的信息。',mode:'conversation',includeResult:true,fileIds:pre.result!.files.map(file => file.id)}});
  assert.equal(prepare.statusCode,200,prepare.body); const chat = prepare.json<BackgroundAction>(); assert.equal(store.listJobs().length,callsBefore); assert.equal(lab.get(chat.sessionId!,'a').messages.length,0);
  const stream = await app.inject({method:'POST',url:`/api/sessions/${chat.sessionId}/messages`,headers:ah,payload:{text:chat.draft,fileRefs:chat.fileRefs}}); assert.equal(stream.statusCode,200,stream.body); assert.equal(lab.get(chat.sessionId!,'a').lastResult?.status,'succeeded'); evidence.conversation = lab.get(chat.sessionId!,'a').lastResult;
  const analyse = await app.inject({method:'POST',url:`/api/inbox/${bi.delivery.id}/analyses`,headers:bh,payload:{clientActionId:randomUUID(),taskSpaceId:task.id,goal:'请读取所附 CSV，使用 write 创建 Python 脚本 seat_analysis.py，通过 bash 执行 python3 seat_analysis.py，计算 amount 总和和均值，生成 seat-report.txt 并用 file_output 交付。无需人工提问。当前目录已经是 /workspace，不使用 cd，执行脚本只调用 command="python3 seat_analysis.py"。',mode:'background',includeResult:true,fileIds:bi.event.files.map(file => file.id)}});
  assert.equal(analyse.statusCode,200,analyse.body); const action = analyse.json<BackgroundAction>();
  const bg = await finished(action.jobId!); evidence.seatAnalysis = bg; assert.equal(bg.status,'succeeded',JSON.stringify(bg.error)); assert.ok(bg.result?.files.length);
  assert.notEqual(action.workspaceId,chat.workspaceId); assert.ok((await readFile(join(config.dataDir,'workspaces',action.workspaceId!,'files','seat-report.txt'),'utf8')).includes('42'));
  const continuation = await app.inject({method:'POST',url:`/api/sessions/${action.sessionId}/messages`,headers:bh,payload:{text:'用一句话告诉我刚才报告中的总和和均值，无需工具。'}}); assert.equal(continuation.statusCode,200); assert.equal(lab.get(action.sessionId!,'b').lastResult?.status,'succeeded'); evidence.continuation = lab.get(action.sessionId!,'b').lastResult;
  evidence.passed = true;
  console.info(JSON.stringify({passed:true,dataDir:config.dataDir,preprocessJob:pre.id,seatAnalysisJob:bg.id}));
} finally {await writeFile(join(config.dataDir,'validation.json'),JSON.stringify(evidence,null,2)); await app.close();}
