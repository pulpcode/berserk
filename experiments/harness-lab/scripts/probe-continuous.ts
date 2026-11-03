/** Live-provider validation; synthetic data, fixed scenario, no repaired output or automatic retry. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccessStore } from '../src/access/store.js';
import { openDatabase } from '../src/access/database.js';
import { BackgroundStore } from '../src/background/store.js';
import { parseBackgroundConfig } from '../src/background/config.js';
import { parseContextConfig } from '../src/context/config.js';
import type { AuthSession, TaskSpace } from '../src/contracts/access.js';
import type { BackgroundJob } from '../src/contracts/background.js';
import type { ContinuousRoundDetail, ContinuousStream } from '../src/contracts/continuous.js';
import { createBackgroundExecutor } from '../src/pi/background-runner.js';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import { createMockContextServer } from './mock-context/server.js';

const config = loadConfig({...process.env, LAB_AUTH_MODE:'test', LAB_TEST_SEATS:undefined, LAB_EXECUTION_ENABLED:'false', LAB_LISTEN_HOST:'127.0.0.1', LAB_PUBLIC_ORIGIN:undefined});
const withUncertainty = process.argv.includes('--with-uncertainty');
assert.ok(process.argv.slice(2).every(value=>value==='--with-uncertainty'),'唯一可选参数：--with-uncertainty');
assert.ok(config.apiKey, '需要可用模型配置；不会将未执行的验证标为通过。');
config.dataDir = await mkdtemp(join(tmpdir(),'axon-continuous-live-'));
config.testSeats = undefined; config.seatId = 'probe-manager'; config.agentRunTimeoutMs = 600_000;
config.auth = {secret:randomBytes(40).toString('hex'),sessionMs:3600000};
const password = randomBytes(24).toString('hex'), sourceToken = randomBytes(32).toString('hex'), situationToken = randomBytes(32).toString('hex'), contextToken = randomBytes(32).toString('hex');
const evidence: Record<string, unknown> = {dataDir:config.dataDir,model:config.model,withUncertainty,startedAt:new Date().toISOString(),mechanismChecksPassed:false,semanticReview:'pending',steps:[]};
const steps = evidence.steps as Array<Record<string, unknown>>;
const persist = () => writeFile(join(config.dataDir,'validation.json'),JSON.stringify(evidence,null,2),{mode:0o600});
const originalFetch = globalThis.fetch;
let providerRequestCount = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input==='string' ? input : input instanceof URL ? input.href : input.url;
  if (new URL(url).origin===new URL(config.baseUrl).origin && typeof init?.body==='string') {
    // Only the model JSON body is retained; never save request headers or credentials.
    const body: unknown = JSON.parse(init.body); providerRequestCount++;
    await writeFile(join(config.dataDir,`provider-request-${providerRequestCount}.json`),JSON.stringify(body,null,2),{mode:0o600});
  }
  return originalFetch(input,init);
};
console.info(JSON.stringify({evidence:join(config.dataDir,'validation.json'),model:config.model}));
await persist();
const mock = createMockContextServer({token:contextToken}), mockUrl = await mock.listen();
const db = await openDatabase(config.dataDir), access = new AccessStore(db);
for (const id of ['probe-manager','probe-recipient','probe-outsider']) await access.saveAccount({username:id,displayName:id,seatId:id,seatName:id,password,createPublicTask:id==='probe-manager',manageModelSettings:id==='probe-manager'});
const actor = access.identityForSeat('probe-manager')!;
const task = access.create(actor,{clientActionId:randomUUID(),title:'西区补给运输验证',visibility:'public',
  goal:'于 2026-10-01 09:40 至 10:30 通过西区通道运送补给，需要至少 3 辆车。尚未提供备用路线和当前执行进度。',
  context:{businessRefs:[{systemId:'situation',objectType:'road',objectId:'road-west-01'},{systemId:'situation',objectType:'resource',objectId:'vehicles-west-01'}],focus:{areaIds:['zone-west'],time:{from:'2026-10-01T09:40:00+08:00',to:'2026-10-01T10:30:00+08:00'},topics:['通行','车辆']}}});
evidence.initialTask = task;
db.close();
const lab = await PiLab.create(config), store = new BackgroundStore(lab.access!.db);
for (const source of ['probe-intel','probe-situation']) store.grant('seat','probe-manager',source,'manage');
const tools = ['information_search','information_read','situation_query','task_search','task_read','analysis_current_read','information_record_analysis_update'];
const goal = '持续分析获准来源的信息，查询原始资料和活动公共任务，比较任务条件、事实与此前已发布的研判。说明发生了什么变化、对任务的影响、建议及资料缺口，区分事实和推测。由工具记录任务变化与是否需要提醒，然后用中文给出简明最终结论。';
const background = parseBackgroundConfig({enabled:true,concurrency:1,modelConcurrency:1,sources:[
  {sourceId:'probe-intel',systemId:'intel',name:'验证情报',credentialRef:'PROBE_INGRESS',allowedProfileIds:['continuous'],allowedRecipientSeatIds:['probe-manager','probe-recipient']},
  {sourceId:'probe-situation',systemId:'situation',name:'验证态势',credentialRef:'PROBE_SITUATION_INGRESS',allowedProfileIds:['continuous'],allowedRecipientSeatIds:['probe-manager','probe-recipient']},
],profiles:[{id:'continuous',name:'持续研判验证',goal,tools,contextScopeId:'probe-scope',skillIds:[],agentIds:[],resources:[],instructions:''}]});
const context = parseContextConfig({systems:[
  {id:'intel',name:'验证情报',adapter:'mock-information-http',baseUrl:`${mockUrl}/intel`,tokenEnv:'PROBE_CONTEXT'},
  {id:'situation',name:'验证态势',adapter:'mock-situation-http',baseUrl:`${mockUrl}/situation`,tokenEnv:'PROBE_CONTEXT'},
],scopes:[{id:'probe-scope',name:'隔离验证资料',systemIds:['intel','situation'],seatIds:['probe-manager','probe-recipient','probe-outsider']}]});
evidence.profile = {goal,tools};
const app = await createApp(lab,false,{config:background,env:{PROBE_INGRESS:sourceToken,PROBE_SITUATION_INGRESS:situationToken}},{config:context,env:{PROBE_CONTEXT:contextToken}});
async function login(username:string) {
  const initial = await app.inject('/api/auth/session');
  const response = await app.inject({method:'POST',url:'/api/auth/login',headers:{cookie:initial.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:`http://localhost:${config.port}`,'x-csrf-token':initial.json<AuthSession>().csrf!},payload:{username,password}});
  assert.equal(response.statusCode,200,response.body); const auth = response.json<AuthSession>();
  return {cookie:response.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:`http://localhost:${config.port}`,'x-csrf-token':auth.csrf!,'x-axon-view':auth.viewId!};
}
type Headers = Awaited<ReturnType<typeof login>>;
let manager: Headers, recipient: Headers, outsider: Headers, stream: ContinuousStream;
const observed = new Set<string>();
async function collect(name:string) {
  const entry: Record<string,unknown> = {name,startedAt:new Date().toISOString()}; steps.push(entry); await persist();
  const deadline = Date.now()+660_000;
  let job: BackgroundJob | undefined;
  while (Date.now()<deadline) {
    job = store.listJobs().find(item=>item.streamEpochId===stream.epochId && !observed.has(item.id));
    if (job && !['queued','running'].includes(job.status)) break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.ok(job,'等待自动批次达到观察时限；不会自动重跑。');
  observed.add(job.id); entry.job = job;
  entry.snapshot = await createBackgroundExecutor(lab).read(job,stream.profile);
  entry.sourceRequests = [...mock.requests]; await persist();
  assert.equal(job.status,'succeeded',JSON.stringify(job.error));
  const detail = await app.inject({url:`/api/continuous/rounds/${job.id}`,headers:recipient});
  assert.equal(detail.statusCode,200,detail.body); entry.detail = detail.json<ContinuousRoundDetail>();
  const round = detail.json<ContinuousRoundDetail>(); entry.round = round;
  assert.equal(round.publication,'published','执行成功不能代替有效发布。');
  const denied = await app.inject({url:`/api/continuous/rounds/${round.jobId}`,headers:outsider});
  assert.equal(denied.statusCode,404,'公共任务可见和 scope 可见，不能替代来源集合或固定受众授权。');
  const deliveryDeadline = Date.now()+10_000;
  while (store.listDeliveries(job.id).some(item=>item.status==='pending') && Date.now()<deliveryDeadline) await new Promise(resolve=>setTimeout(resolve,100));
  entry.deliveries = store.listDeliveries(job.id);
  entry.endedAt = new Date().toISOString(); await persist();
  console.info(JSON.stringify({step:name,jobId:round.jobId,status:round.status,publication:round.publication,taskUpdates:round.update?.taskUpdates.length}));
  return round;
}
async function submit(name:'E1'|'E2'|'E3'|'E4', suffix='') {
  const input = {...mock.event(name),...(suffix ? {sourceMessageId:`${mock.event(name).sourceMessageId}-${suffix}`} : {})};
  const url = `/api/integrations/${name==='E2' ? 'probe-situation' : 'probe-intel'}/events`;
  const request = {method:'POST' as const,url,headers:{authorization:`Bearer ${name==='E2'?situationToken:sourceToken}`},payload:input};
  const response = await app.inject(request); assert.equal(response.statusCode,202,response.body);
  const duplicate = await app.inject(request); assert.equal(duplicate.statusCode,202,duplicate.body);
  assert.equal(duplicate.json<{eventId:string}>().eventId,response.json<{eventId:string}>().eventId);
  return response.json<{eventId:string}>().eventId;
}
try {
  await app.ready(); manager = await login('probe-manager'); recipient = await login('probe-recipient'); outsider = await login('probe-outsider');
  const created = await app.inject({method:'POST',url:'/api/continuous/streams',headers:manager,payload:{clientActionId:randomUUID(),name:'双来源持续研判验证',sourceIds:['probe-intel','probe-situation'],profileId:'continuous',recipientSeatIds:['probe-recipient'],enabled:true,quietMs:500,maxWaitMs:2000}});
  assert.equal(created.statusCode,200,created.body); stream = created.json<ContinuousStream>(); evidence.stream = stream; await persist();
  mock.advance('intel'); await submit('E1'); const first = await collect('道路限制');
  mock.advance('situation'); await submit('E2'); const second = await collect('车辆减少');
  mock.advance('recovery'); await submit('E4'); const third = await collect('道路恢复');
  assert.equal(second.update?.taskUpdates.find(update=>update.taskId===task.id)?.previousJobId,first.jobId);
  assert.equal(third.update?.taskUpdates.find(update=>update.taskId===task.id)?.previousJobId,second.jobId);
  const changedResponse = await app.inject({method:'PUT',url:`/api/tasks/${task.id}`,headers:manager,payload:{title:task.title,goal:task.goal.replace('至少 3 辆','至少 2 辆'),revision:task.revision}});
  assert.equal(changedResponse.statusCode,200,changedResponse.body); const changed = changedResponse.json<TaskSpace>(); evidence.changedTask = changed;
  const revised = await collect('仅任务说明修订');
  assert.equal(revised.update?.taskUpdates.find(update=>update.taskId===task.id)?.taskRevision,changed.revision);
  assert.ok(revised.batch.requiredTaskIds.includes(task.id));
  await submit('E1','late'); await collect('晚到旧通知');
  if(withUncertainty){mock.advance('unknown');mock.setUnavailable('situation',true);await submit('E3');await collect('未知对象且态势来源暂不可用');}
  const frozen = await app.inject({url:`/api/continuous/rounds/${first.jobId}`,headers:recipient});
  assert.equal(frozen.statusCode,200,frozen.body);
  assert.equal(frozen.json<ContinuousRoundDetail>().text,(steps[0].detail as ContinuousRoundDetail).text,'历史正文不得被新轮次覆盖。');
  const jobs = store.listJobs(); assert.equal(jobs.length,withUncertainty?6:5,'重复推送及连续来源不能另起旧模式作业。');
  assert.ok(jobs.every(job=>job.kind==='continuous_analysis'));
  assert.equal(new Set(jobs.map(job=>job.sessionId)).size,1,'健康流使用同一 Pi 原生会话。');
  evidence.mechanismChecksPassed = true;
  evidence.semanticReview = 'pending: inspect native final text and source evidence; no automated keyword pass';
} catch (error) {
  evidence.failure = error instanceof Error ? error.message : String(error); process.exitCode = 1;
  console.error(evidence.failure);
} finally {
  evidence.endedAt = new Date().toISOString(); evidence.providerRequestCount = providerRequestCount;
  await persist(); await app.close(); await mock.close(); globalThis.fetch = originalFetch;
  console.info(JSON.stringify({evidence:join(config.dataDir,'validation.json'),mechanismChecksPassed:evidence.mechanismChecksPassed,semanticReview:evidence.semanticReview}));
}
