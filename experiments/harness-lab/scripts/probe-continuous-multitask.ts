/** Three-task, twelve-update live-provider validation; synthetic data, fixed scenario, no repaired output or automatic retry. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
interface FixtureStep {round:number; businessTime:string; kind:'event'|'duplicate'|'task_revision'; title:string; duplicateOf?:number; taskKey?:string; goal?:string; payload?:{sourceMessageId:string;title:string;text:string;occurredAt:string}}
interface Fixture {id:string;tasks:Array<{key:string;title:string;goal:string}>;steps:FixtureStep[]}
assert.equal(process.argv.length,3,'需要唯一的模型可见输入JSON路径，不接受核验答案。');
const fixtureBytes = await readFile(process.argv[2],'utf8');
const fixture = JSON.parse(fixtureBytes) as Fixture;
assert.equal(fixture.tasks.length,3); assert.equal(fixture.steps.length,13);
assert.equal(fixture.steps.filter(s=>s.kind==='duplicate').length,1);
assert.equal(fixture.steps.filter(s=>s.kind==='task_revision').length,1);
assert.ok(config.apiKey, '需要可用模型配置；不会将未执行的验证标为通过。');
config.dataDir = await mkdtemp(join(tmpdir(),'axon-continuous-multi-'));
config.testSeats = undefined; config.seatId = 'probe-manager'; config.agentRunTimeoutMs = 600_000;
config.auth = {secret:randomBytes(40).toString('hex'),sessionMs:3600000};
const password = randomBytes(24).toString('hex'), sourceToken = randomBytes(32).toString('hex'), situationToken = randomBytes(32).toString('hex'), contextToken = randomBytes(32).toString('hex');
const evidence: Record<string, unknown> = {dataDir:config.dataDir,model:config.model,sourceRevision:process.env.PROBE_SOURCE_REVISION??'unknown',fixtureHash:createHash('sha256').update(fixtureBytes).digest('hex'),runnerHash:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),startedAt:new Date().toISOString(),mechanismChecksPassed:false,semanticReview:'pending',steps:[]};
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
const tasks = new Map(fixture.tasks.map(input=>[input.key,access.create(actor,{clientActionId:randomUUID(),title:input.title,visibility:'public',goal:input.goal})]));
evidence.initialTasks = Object.fromEntries(tasks);
db.close();
const lab = await PiLab.create(config), store = new BackgroundStore(lab.access!.db);
for (const source of ['probe-intel','probe-situation']) store.grant('seat','probe-manager',source,'manage');
const tools = ['task_search','task_read','analysis_current_read','information_record_analysis_update'];
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
  entry.snapshot = await createBackgroundExecutor(lab).read(job);
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
  entry.currentBaselines = Object.fromEntries([...tasks].map(([key,task])=>[key,store.db.prepare('SELECT job_id FROM continuous_current WHERE epoch_id=? AND task_id=?').get(stream.epochId,task.id)?.job_id??null]));
  entry.endedAt = new Date().toISOString(); await persist();
  console.info(JSON.stringify({step:name,jobId:round.jobId,status:round.status,publication:round.publication,taskUpdates:round.update?.taskUpdates.length}));
  return round;
}
const receipts = new Map<number,string>();
async function submit(step:FixtureStep) {
  assert.ok(step.payload);
  const source = step.title.startsWith('CL-')?'probe-situation':'probe-intel';
  const response = await app.inject({method:'POST',url:`/api/integrations/${source}/events`,headers:{authorization:`Bearer ${source==='probe-intel'?sourceToken:situationToken}`},payload:step.payload});
  assert.equal(response.statusCode,202,response.body);
  const receipt=response.json<{eventId:string}>();
  (evidence.receipts as unknown[]).push({round:step.round,payload:step.payload,receipt});await persist();
  return receipt.eventId;
}
evidence.receipts=[];

try {
  await app.ready(); manager = await login('probe-manager'); recipient = await login('probe-recipient'); outsider = await login('probe-outsider');
  const created = await app.inject({method:'POST',url:'/api/continuous/streams',headers:manager,payload:{clientActionId:randomUUID(),name:'双来源持续研判验证',sourceIds:['probe-intel','probe-situation'],profileId:'continuous',recipientSeatIds:['probe-recipient'],enabled:true,quietMs:500,maxWaitMs:2000}});
  assert.equal(created.statusCode,200,created.body); stream = created.json<ContinuousStream>(); evidence.stream = stream; await persist();
  let first:ContinuousRoundDetail|undefined;
  for(const step of fixture.steps) {
    if(step.kind==='duplicate') {
      const original=fixture.steps.find(s=>s.round===step.duplicateOf)!;
      const beforeJobs=store.listJobs().length, beforeDeliveries=store.listDeliveries().length;
      const receipt=await submit(original);
      assert.equal(receipt,receipts.get(original.round));
      await new Promise(resolve=>setTimeout(resolve,6000));
      const observation={name:`R${step.round} 重复消息`,businessTime:step.businessTime,duplicateOf:step.duplicateOf,receipt,jobsBefore:beforeJobs,jobsAfter:store.listJobs().length,deliveriesBefore:beforeDeliveries,deliveriesAfter:store.listDeliveries().length};
      steps.push(observation); await persist();
      assert.equal(observation.jobsAfter,beforeJobs); assert.equal(observation.deliveriesAfter,beforeDeliveries);
      console.info(JSON.stringify(observation));continue;
    }
    if(step.kind==='task_revision') {
      const task=tasks.get(step.taskKey!)!;
      const response=await app.inject({method:'PUT',url:`/api/tasks/${task.id}`,headers:manager,payload:{title:task.title,goal:step.goal,revision:task.revision}});
      assert.equal(response.statusCode,200,response.body);tasks.set(step.taskKey!,response.json<TaskSpace>());
      evidence.changedTask=response.json<TaskSpace>();await persist();
    } else receipts.set(step.round,await submit(step));
    const round=await collect(`R${step.round} ${step.title}`);first??=round;
    steps.at(-1)!.businessTime=step.businessTime;
    if(step.kind==='task_revision') {
      const task=tasks.get(step.taskKey!)!;
      assert.equal(round.update?.taskUpdates.find(u=>u.taskId===task.id)?.taskRevision,task.revision);
      assert.ok(round.batch.requiredTaskIds.includes(task.id));
    }
    await persist();
  }
  const frozen=await app.inject({url:`/api/continuous/rounds/${first!.jobId}`,headers:recipient});
  assert.equal(frozen.statusCode,200);assert.equal(frozen.json<ContinuousRoundDetail>().text,first!.text);
  const jobs=store.listJobs();assert.equal(jobs.length,12);
  assert.ok(jobs.every(j=>j.kind==='continuous_analysis'));
  assert.equal(new Set(jobs.map(j=>j.sessionId)).size,1);
  assert.equal(mock.requests.length,0,'文本测试没有调用外部态势或报告查询');
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
