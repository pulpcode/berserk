/** Capability validation against real models and HTTP sources, using isolated synthetic data. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { BackgroundStore } from '../src/background/store.js';
import { parseBackgroundConfig } from '../src/background/config.js';
import { PiLab } from '../src/pi/lab.js';
import { createBackgroundExecutor } from '../src/pi/background-runner.js';
import { createApp } from '../src/server/app.js';
import { parseContextConfig } from '../src/context/config.js';
import type { BackgroundJob } from '../src/contracts/background.js';
import { createMockContextServer } from './mock-context/server.js';

const contextCases = ['E1', 'E2', 'E1-E2', 'unknown', 'unavailable', 'previous-day', 'swapped', 'late-notice'] as const;
const linkingCases = ['existing', 'multiple', 'new-task', 'reference', 'existing-draft', 'insufficient'] as const;
type Case = typeof contextCases[number] | typeof linkingCases[number];
const taskLinking = process.argv.includes('--task-linking');
const allCases: readonly Case[] = taskLinking ? linkingCases : contextCases;
const selected = process.argv.slice(2).filter(value => value !== '--task-linking');
assert.ok(selected.every(value => allCases.includes(value as Case)), `场景可选：${allCases.join(', ')}`);
const cases = selected.length ? selected as Case[] : [...allCases];
const root = await mkdtemp(join(tmpdir(), 'axon-context-live-'));
console.info(JSON.stringify({evidence: root, cases, mode: taskLinking ? 'task-linking' : 'context'}));
const queryTools = ['information_search','information_read','situation_query','task_search','task_read'];
const tools = [...queryTools, ...(taskLinking ? ['information_record_task_assessment'] : [])];
const goal = '根据收到的更新，自主查询报告正文与历史、当前态势和 Axon 活动公共任务，综合说明变化、可能影响哪些任务及依据，区分事实、建议和资料缺口。比较任务的目标、资源条件与有效时间。结论用中文，列出来源与版本；不要修改任务或自动分派。'
  + (taskLinking ? '结合已查询的任务记录关联；若需独立开展工作且无合适任务承接，提出新建公共任务建议；否则说明暂不归口原因。' : '');
const evidence: Record<string, unknown>[] = [];
let evidenceWrite = Promise.resolve();
async function saveEvidence() {
  const snapshot = JSON.stringify(evidence,null,2);
  evidenceWrite = evidenceWrite.then(() => writeFile(join(root,'evidence.json'),snapshot));
  await evidenceWrite;
}
async function run(name: Case) {
  const dataDir = await mkdtemp(join(root, `${name}-`));
  const token = randomBytes(32).toString('hex'), incomingToken = randomBytes(32).toString('hex');
  const mock = createMockContextServer({token}); const url = await mock.listen();
  const config = loadConfig({...process.env, LAB_AUTH_MODE:'test', LAB_EXECUTION_ENABLED:'false'});
  assert.ok(config.apiKey, '需要配置可用模型密钥。');
  config.dataDir = dataDir; config.agentRunTimeoutMs = 600_000;
  config.testSeats = undefined; config.seatId = 'seat-a';
  config.auth = {secret:randomBytes(40).toString('hex'),sessionMs:3_600_000};
  const db = await openDatabase(dataDir), access = new AccessStore(db);
  for (const seat of ['a','b']) await access.saveAccount({username:seat,displayName:seat,seatId:`seat-${seat}`,seatName:`席位 ${seat}`,password:randomBytes(24).toString('hex'),createPublicTask:true,manageModelSettings:seat === 'a'});
  const actor = access.identity(String(db.prepare("SELECT id FROM accounts WHERE username='a'").get()!.id))!;
  const taskIds: Record<string,string> = {};
  for (const [key,title,count,zone,road,resource,time] of [
    ['A','西区补给方案',name === 'swapped' ? 1 : 3,'west','road-west-01','vehicles-west-01','09:40'],
    ['B','西区设备转移方案',name === 'swapped' ? 3 : 1,'west','road-west-01','vehicles-west-01','09:50'],
    ['C','东区补给方案',2,'east','road-east-01','vehicles-east-01','09:45'],
  ] as const) {
    if (name === 'existing' && key === 'B') continue;
    const day = name === 'previous-day' && key === 'C' ? '2026-09-30' : '2026-10-01';
    const actualZone = name === 'previous-day' && key === 'C' ? 'west' : zone;
    taskIds[key] = access.create(actor,{title:name === 'previous-day' && key === 'C' ? '西区前一日补给方案' : title,goal:`在${day} ${time} 开始执行，至少需要 ${count} 辆车。使用${actualZone === 'west' ? '西' : '东'}区道路与车辆池。`,visibility:'public',clientActionId:randomUUID(),
      context:{businessRefs:[{systemId:'situation',objectType:'road',objectId:actualZone === 'west' ? 'road-west-01' : road},{systemId:'situation',objectType:'resource',objectId:actualZone === 'west' ? 'vehicles-west-01' : resource}],
        focus:{areaIds:[`zone-${actualZone}`],time:{from:`${day}T${time}:00+08:00`,to:`${day}T10:30:00+08:00`},topics:['车辆','通行']}}}).id;
  }
  if (name === 'existing-draft') taskIds.D = access.create(actor,{title:'访客接待须知编制',
    goal:'在 2026-10-03 交付访客接待须知 Markdown 文稿，包含预约信息、到访登记、联系人和离场事项；未明确要求标注待确认。',
    visibility:'public',clientActionId:randomUUID()}).id;
  db.close();
  const lab = await PiLab.create(config), store = new BackgroundStore(lab.access!.db);
  const context = parseContextConfig({systems:[
    {id:'intel',name:'模拟特情系统',adapter:'mock-information-http',baseUrl:`${url}/intel`,tokenEnv:'PROBE_CONTEXT_TOKEN'},
    {id:'situation',name:'模拟态势系统',adapter:'mock-situation-http',baseUrl:`${url}/situation`,tokenEnv:'PROBE_CONTEXT_TOKEN'},
  ],scopes:[{id:'demo-context',name:'演示业务资料',systemIds:['intel','situation'],seatIds:['seat-a','seat-b']}]});
  const background = parseBackgroundConfig({enabled:true,concurrency:1,modelConcurrency:2,sources:[
    {sourceId:'mock-intel-source',systemId:'intel',name:'特情通知',credentialRef:'PROBE_INGRESS_TOKEN',allowedProfileIds:['synthesis'],allowedRecipientSeatIds:['seat-a','seat-b']},
    {sourceId:'mock-situation-source',systemId:'situation',name:'态势通知',credentialRef:'PROBE_INGRESS_TOKEN_2',allowedProfileIds:['synthesis'],allowedRecipientSeatIds:['seat-a','seat-b']},
  ],profiles:[{id:'synthesis',name:'多源综合分析',goal,tools,contextScopeId:'demo-context',skillIds:[],agentIds:[],instructions:'',resources:[]}]});
  for (const source of background.sources) store.createRule(actor.userId,randomUUID(),{name:'固定投递验证',sourceId:source.sourceId,profileId:'synthesis',recipientSeatIds:['seat-a','seat-b'],enabled:true});
  const app = await createApp(lab,false,{config:background,env:{PROBE_INGRESS_TOKEN:incomingToken,PROBE_INGRESS_TOKEN_2:incomingToken}},{config:context,env:{PROBE_CONTEXT_TOKEN:token}});
  const entry: Record<string,unknown> = {name,dataDir,model:lab.info().model,profile:{goal,tools},taskIds,initialTasks:lab.access!.list('seat-a'),jobs:[]}; evidence.push(entry);
  async function submit(eventName: 'E1'|'E2'|'E3', previousRevision = false) {
    const sourceId = eventName === 'E2' ? 'mock-situation-source' : 'mock-intel-source';
    const input = ['new-task','existing-draft'].includes(name) ? {
      sourceMessageId: 'new-request-0001', title: '访客接待须知编制需求',
      text: '综合事务部门来文：拟编制一份访客接待须知。请形成 Markdown 文稿，说明预约信息、到访登记、联系人以及离场事项；资料未明确的要求应标注待确认。交付日期为 2026-10-03。',
      subjectId: 'visitor-guidance', occurredAt: '2026-10-01T09:20:00+08:00',
    } : name === 'insufficient' ? {
      sourceMessageId: 'unclear-reference-0001', title: '访客接待交流片段',
      text: '资料摘要：交流会上有人提到访客接待体验似乎有改进空间，但记录未说明具体问题、受影响对象、拟采取的行动、期望交付物或办理期限。除此之外没有附加材料。',
      subjectId: 'visitor-discussion', occurredAt: '2026-10-01T09:20:00+08:00',
    } : name === 'reference' ? {
      sourceMessageId: 'reference-0001', title: '公制长度单位换算资料',
      text: '本条内容为一般参考资料：1 千米等于 1000 米，1 米等于 100 厘米。资料发布时间为 2026-10-01，不涉及具体地域、道路、人员、资源数量或正在办理事项。',
      subjectId: 'length-units', occurredAt: '2026-10-01T09:20:00+08:00',
    } : previousRevision ? {
      sourceMessageId:'intel-msg-0000', title:'西区通道信息',
      text:'报告 report-west-01 修订 1，关联对象 situation/road/road-west-01，观测时间为 2026-10-01T08:50:00+08:00。请查询报告正文及历史。',
      subjectId:'report-west-01', occurredAt:'2026-10-01T08:55:00+08:00',
    } : mock.event(eventName);
    const response = await app.inject({method:'POST',url:`/api/integrations/${sourceId}/events`,headers:{authorization:`Bearer ${incomingToken}`},payload:input});
    assert.equal(response.statusCode,202,response.body);
    const eventId = response.json().eventId as string;
    const duplicate = await app.inject({method:'POST',url:`/api/integrations/${sourceId}/events`,headers:{authorization:`Bearer ${incomingToken}`},payload:input});
    assert.equal(duplicate.json().eventId,eventId);
    const jobId = store.getEvent(eventId).initialJobId!;
    const deadline = Date.now()+660_000;
    let job: BackgroundJob = store.getJob(jobId);
    while (['queued','running'].includes(job.status) && Date.now()<deadline) {
      await new Promise(resolve => setTimeout(resolve,500)); job = store.getJob(jobId);
    }
    const snapshot = await createBackgroundExecutor(lab).read(job);
    const finalId = snapshot?.turns?.find(turn => turn.requestId === job.requestId)?.finalMessageId;
    const final = snapshot?.messages.find(message => message.id === finalId)?.text;
    const assistantMessages = snapshot?.messages.filter(message => message.role === 'assistant' && message.requestId === job.requestId) ?? [];
    const queries = snapshot?.messages.filter(message => message.role === 'tool' && tools.includes(message.toolName ?? '')) ?? [];
    const assessment = job.taskAssessment;
    const expectedTaskIds = name === 'existing' ? [taskIds.A] : name === 'multiple' ? [taskIds.A,taskIds.B] : name === 'existing-draft' ? [taskIds.D] : [];
    const actualTaskIds = assessment?.items.map(item => item.taskSpaceId) ?? [];
    const noAssociation = ['reference','insufficient'].includes(name);
    const semanticCheck = !taskLinking ? undefined : {expected: name === 'new-task' ? 'new-task-suggestion' : noAssociation ? 'no-association' : 'existing-tasks',
      expectedTaskIds, actualTaskIds, matches: name === 'new-task' ? !!assessment?.newTaskSuggestion
        : noAssociation ? !!assessment?.emptyReason && !assessment.items.length
          : !!assessment && expectedTaskIds.length === actualTaskIds.length && expectedTaskIds.every(id => actualTaskIds.includes(id))};
    (entry.jobs as unknown[]).push({eventName:taskLinking ? name : previousRevision ? 'previous-revision' : eventName,input,job,queries,final,assistantMessages,semanticCheck,
      deliveries:store.listDeliveries(job.id),requests:[...mock.requests],usage:snapshot?.lastResult?.usageSummary});
    await saveEvidence();
    console.info(JSON.stringify({case:name,eventName:taskLinking ? name : eventName,status:job.status,queries:queries.length,jobId,...(semanticCheck ? {judgmentMatches:semanticCheck.matches} : {})}));
    assert.equal(job.status,'succeeded',job.error?.message);
    assert.ok(queries.some(message => message.toolName === 'task_search' && !message.isError),'必须实际查询任务');
    if (!taskLinking) {
      assert.ok(queries.some(message => message.toolName === 'information_read' && !message.isError),'必须实际读取报告');
      assert.ok(queries.some(message => message.toolName === 'situation_query'),'必须尝试查询态势');
    } else {
      entry.jobCount = store.listJobs().length;
      entry.tasksUnchanged = JSON.stringify(lab.access!.list('seat-a')) === JSON.stringify(entry.initialTasks);
      assert.equal(store.listJobs().length,1,'一条信息只启动一次分析，不因关联多个任务拆分作业');
      assert.equal(entry.tasksUnchanged,true,'建议不能自动创建或修改任务');
    }
  }
  try {
    await app.ready();
    if (['E1','E1-E2','unavailable','previous-day','late-notice','existing','multiple'].includes(name)) mock.advance('intel');
    if (['E2','swapped'].includes(name)) mock.advance('situation');
    if (name === 'unknown') mock.advance('unknown');
    if (name === 'unavailable') mock.setUnavailable('situation',true);
    await submit(name === 'unknown' ? 'E3' : ['E2','swapped'].includes(name) ? 'E2' : 'E1');
    if (name === 'E1-E2') { mock.advance('situation'); await submit('E2'); }
    if (name === 'late-notice') await submit('E1',true);
    entry.completed = true;
  } catch (error) { entry.error = error instanceof Error ? error.message : String(error); }
  finally { await app.close(); await mock.close(); await saveEvidence(); }
}
for (let index = 0; index < cases.length; index += 2) await Promise.all(cases.slice(index,index+2).map(run));
const judgments = evidence.flatMap(row => row.jobs as Array<{semanticCheck?: {matches: boolean}}>).filter(job => job.semanticCheck);
console.info(JSON.stringify({evidence:join(root,'evidence.json'),completed:evidence.filter(row => row.completed).length,total:evidence.length,
  ...(taskLinking ? {judgmentsMatched:judgments.filter(job=>job.semanticCheck!.matches).length,judgmentsTotal:judgments.length} : {})}));
if (evidence.some(row => !row.completed)) process.exitCode = 1;
