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

const allCases = ['E1', 'E2', 'E1-E2', 'unknown', 'unavailable', 'previous-day', 'swapped', 'late-notice'] as const;
type Case = typeof allCases[number];
const selected = process.argv.slice(2);
assert.ok(selected.every(value => allCases.includes(value as Case)), `场景可选：${allCases.join(', ')}`);
const cases = selected.length ? selected as Case[] : [...allCases];
const root = await mkdtemp(join(tmpdir(), 'axon-context-live-'));
console.info(JSON.stringify({evidence: root, cases}));
const queryTools = ['information_search','information_read','situation_query','task_search','task_read'];
const goal = '根据收到的更新，自主查询报告正文与历史、当前态势和 Axon 活动公共任务，综合说明变化、可能影响哪些任务及依据，区分事实、建议和资料缺口。比较任务的目标、资源条件与有效时间。结论用中文，列出来源与版本；不要修改任务或自动分派。';
const evidence: Record<string, unknown>[] = [];
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
    const day = name === 'previous-day' && key === 'C' ? '2026-09-30' : '2026-10-01';
    const actualZone = name === 'previous-day' && key === 'C' ? 'west' : zone;
    taskIds[key] = access.create(actor,{title:name === 'previous-day' && key === 'C' ? '西区前一日补给方案' : title,goal:`在${day} ${time} 开始执行，至少需要 ${count} 辆车。使用${actualZone === 'west' ? '西' : '东'}区道路与车辆池。`,visibility:'public',clientActionId:randomUUID(),
      context:{businessRefs:[{systemId:'situation',objectType:'road',objectId:actualZone === 'west' ? 'road-west-01' : road},{systemId:'situation',objectType:'resource',objectId:actualZone === 'west' ? 'vehicles-west-01' : resource}],
        focus:{areaIds:[`zone-${actualZone}`],time:{from:`${day}T${time}:00+08:00`,to:`${day}T10:30:00+08:00`},topics:['车辆','通行']}}}).id;
  }
  db.close();
  const lab = await PiLab.create(config), store = new BackgroundStore(lab.access!.db);
  const context = parseContextConfig({systems:[
    {id:'intel',name:'模拟特情系统',adapter:'mock-information-http',baseUrl:`${url}/intel`,tokenEnv:'PROBE_CONTEXT_TOKEN'},
    {id:'situation',name:'模拟态势系统',adapter:'mock-situation-http',baseUrl:`${url}/situation`,tokenEnv:'PROBE_CONTEXT_TOKEN'},
  ],scopes:[{id:'demo-context',name:'演示业务资料',systemIds:['intel','situation'],seatIds:['seat-a','seat-b']}]});
  const background = parseBackgroundConfig({enabled:true,concurrency:1,modelConcurrency:2,sources:[
    {sourceId:'mock-intel-source',systemId:'intel',name:'特情通知',credentialRef:'PROBE_INGRESS_TOKEN',allowedProfileIds:['synthesis'],allowedRecipientSeatIds:['seat-a','seat-b']},
    {sourceId:'mock-situation-source',systemId:'situation',name:'态势通知',credentialRef:'PROBE_INGRESS_TOKEN_2',allowedProfileIds:['synthesis'],allowedRecipientSeatIds:['seat-a','seat-b']},
  ],profiles:[{id:'synthesis',name:'多源综合分析',goal,tools:queryTools,contextScopeId:'demo-context',skillIds:[],agentIds:[],instructions:'',resources:[]}]});
  for (const source of background.sources) store.createRule(actor.userId,randomUUID(),{name:'固定投递验证',sourceId:source.sourceId,profileId:'synthesis',recipientSeatIds:['seat-a','seat-b'],enabled:true});
  const app = await createApp(lab,false,{config:background,env:{PROBE_INGRESS_TOKEN:incomingToken,PROBE_INGRESS_TOKEN_2:incomingToken}},{config:context,env:{PROBE_CONTEXT_TOKEN:token}});
  const entry: Record<string,unknown> = {name,dataDir,model:lab.info().model,taskIds,jobs:[]}; evidence.push(entry);
  async function submit(eventName: 'E1'|'E2'|'E3', previousRevision = false) {
    const sourceId = eventName === 'E2' ? 'mock-situation-source' : 'mock-intel-source';
    const input = previousRevision ? {
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
    const queries = snapshot?.messages.filter(message => message.role === 'tool' && queryTools.includes(message.toolName ?? '')) ?? [];
    (entry.jobs as unknown[]).push({eventName:previousRevision ? 'previous-revision' : eventName,input,job,queries,final,deliveries:store.listDeliveries(job.id),requests:[...mock.requests]});
    await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));
    console.info(JSON.stringify({case:name,eventName,status:job.status,queries:queries.length,jobId}));
    assert.equal(job.status,'succeeded',job.error?.message);
    assert.ok(queries.some(message => message.toolName === 'task_search' && !message.isError),'必须实际查询任务');
    assert.ok(queries.some(message => message.toolName === 'information_read' && !message.isError),'必须实际读取报告');
    assert.ok(queries.some(message => message.toolName === 'situation_query'),'必须尝试查询态势');
  }
  try {
    await app.ready();
    if (['E1','E1-E2','unavailable','previous-day','late-notice'].includes(name)) mock.advance('intel');
    if (['E2','swapped'].includes(name)) mock.advance('situation');
    if (name === 'unknown') mock.advance('unknown');
    if (name === 'unavailable') mock.setUnavailable('situation',true);
    await submit(name === 'unknown' ? 'E3' : ['E2','swapped'].includes(name) ? 'E2' : 'E1');
    if (name === 'E1-E2') { mock.advance('situation'); await submit('E2'); }
    if (name === 'late-notice') await submit('E1',true);
    entry.completed = true;
  } catch (error) { entry.error = error instanceof Error ? error.message : String(error); }
  finally { await app.close(); await mock.close(); await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2)); }
}
for (let index = 0; index < cases.length; index += 2) await Promise.all(cases.slice(index,index+2).map(run));
console.info(JSON.stringify({evidence:join(root,'evidence.json'),completed:evidence.filter(row => row.completed).length,total:evidence.length}));
if (evidence.some(row => !row.completed)) process.exitCode = 1;
