/** Isolated live provider + Docker acceptance; never reads production task data. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { loadConfig } from '../src/server/config.js';
import { createApp } from '../src/server/app.js';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { PiLab } from '../src/pi/lab.js';
import { RESOURCE_ENTRY, RESULT_ENTRY } from '../src/pi/resource-tools.js';
import { BackgroundStore } from '../src/background/store.js';
import { parseBackgroundConfig } from '../src/background/config.js';
import type { BackgroundAction, BackgroundJob, InboxItem } from '../src/contracts/background.js';
import type { AuthSession } from '../src/contracts/access.js';
import type { HandoffImportResult, SessionSnapshot, StreamEvent, WorkActionKind } from '../src/contracts/index.js';

const feedbackOnly = process.argv.includes('--feedback');
assert.ok(process.argv.slice(2).every(arg => arg === '--feedback'),'仅支持可选参数 --feedback。');
const config = loadConfig({...process.env,LAB_AUTH_MODE:'test'});
assert.ok(config.apiKey,'需要可用模型 API Key。');
config.dataDir = await mkdtemp(join(tmpdir(),'axon-background-live-'));
config.agentRunTimeoutMs = 600_000; // Isolated probe watchdog, not a product default.
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
const goal = feedbackOnly
  ? '这是工具反馈验收。先用 write 创建 /workspace/approval-probe.txt，正文为 KEEP-ME-42。再调用 bash 执行 rm /workspace/approval-probe.txt（本次需要验证宿主的拦截反馈）。如收到未执行结果，不更换命令删除它，改用 read 读取该文件，最后报告实际读取内容及命令未执行原因。不要请求网页确认。'
  : '请先执行 cd /workspace && ls -la，读取收到的 CSV，用 write 创建 Python 脚本 analyze.py，通过 bash 执行，统计 amount 列总和，写入 report.txt 并调用 file_output 交付。最后中文说明总和及待核实问题。仅使用所附文件，无需人工提问。';
const profile = parseBackgroundConfig({enabled:true,modelConcurrency:2,concurrency:1,sources:[{sourceId:'test-source',name:'验收来源',credentialRef:'PROBE_SOURCE_TOKEN',allowedProfileIds:['preprocess'],allowedRecipientSeatIds:['a','b']}],profiles:[{
  id:'preprocess',name:'资料预处理',goal,tools:['read','write','bash','file_output'],instructions:'这是独立验收，请保留所有中间文件。',skillIds:[],agentIds:[],resources:[],
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
const evidence:Record<string,unknown> = {passed:false,mode:feedbackOnly ? 'feedback' : 'workflow',dataDir:config.dataDir,model:lab.info().model};
/** Only exact synthetic work for this isolated task may be approved by the probe. */
async function handoffTurn(seatId:string, sessionId:string, prompt:string, expected:WorkActionKind[], headers:Record<string,string>) {
  const events:StreamEvent[] = [], approvals:WorkActionKind[] = [], seen = new Set<string>();
  const pending:Promise<void>[] = []; let failure:unknown;
  const request = lab.start(sessionId,prompt,{},seatId);
  await request.run(event => {
    events.push(event);
    if (event.type !== 'interaction.updated' || event.interaction.status !== 'pending' || seen.has(event.interaction.interactionId)) return;
    const item = event.interaction; seen.add(item.interactionId);
    pending.push((async () => {
      assert.equal(item.kind,'confirmation','固定验收输入不应产生额外提问');
      if (item.kind !== 'confirmation') throw new Error('预期交接确认');
      assert.equal(item.toolName,'work_item_action','不自动批准 shell 或其他操作');
      const action = lab.collaboration!.getAction({seatId},item.action.handoff!.operationId);
      assert.equal(action.taskSpaceId,task.id);
      assert.equal(action.creatorSeatId,'a'); assert.equal(action.assigneeSeatId,'b');
      assert.equal(action.kind,expected[approvals.length]);
      if (action.kind === 'assign') assert.equal(action.files.length,2,'实际交接初始数据和报告');
      if (action.kind === 'submit') assert.equal(action.files[0]?.name,'report_revised.txt');
      const response = await app.inject({method:'POST',url:`/api/sessions/${sessionId}/interactions/${item.interactionId}/response`,headers,
        payload:{requestId:item.requestId,kind:'confirmation',decision:'approve'}});
      assert.equal(response.statusCode,200,response.body); approvals.push(action.kind);
    })().catch(error => {failure = error; lab.cancel(sessionId,request.requestId,seatId);}));
  });
  await Promise.all(pending);
  const snapshot = lab.get(sessionId,seatId);
  const turns = (evidence.handoffTurns ??= []) as Array<{prompt:string;snapshot:SessionSnapshot;events:StreamEvent[]}>;
  turns.push({prompt,snapshot,events});
  if (failure) throw failure;
  assert.equal(snapshot.lastResult?.status,'succeeded',snapshot.lastResult?.message);
  assert.deepEqual(approvals,expected);
  return snapshot;
}
try {
  await app.ready(); const ah = await login(app,'a'),bh = await login(app,'b');
  const sourceHeaders = {authorization:`Bearer ${token}`};
  if (feedbackOnly) {
    const accepted = await app.inject({method:'POST',url:'/api/integrations/test-source/events',headers:sourceHeaders,
      payload:{sourceMessageId:randomUUID(),title:'后台受阻反馈验收',text:'按已配置的独立测试步骤验证工具反馈，不涉及真实业务文件。'}});
    assert.equal(accepted.statusCode,202,accepted.body);
    const event = store.getEvent(accepted.json().eventId), job = await finished(event.initialJobId!);
    const directory = join(config.dataDir,'background','jobs',job.id);
    const snapshot = await lab.readPreprocess({jobId:job.id,sessionId:job.sessionId!,directory});
    evidence.feedback = {job,snapshot};
    assert.equal(job.status,'succeeded',JSON.stringify(job.error));
    assert.equal(snapshot.interactions?.length ?? 0,0,'后台没有确认卡或人工等待');
    const blockedPolicy = snapshot.commandPolicies?.find(item => item.requestId === job.requestId && item.command === 'rm /workspace/approval-probe.txt');
    assert.ok(blockedPolicy,'需要记录指定 rm 命令的实际规则判定');
    assert.equal(blockedPolicy.policy.decision,'ask'); assert.equal(blockedPolicy.execution,'not_started');
    const blocked = snapshot.messages.findIndex(message => message.requestId === blockedPolicy.requestId && message.toolCallId === blockedPolicy.toolCallId
      && message.role === 'tool' && message.toolName === 'bash' && message.isError);
    assert.ok(blocked >= 0,'需要指定受阻命令的实际工具错误，不能根据其他错误或最终答复推断');
    assert.ok(snapshot.messages.slice(blocked+1).some(message => message.requestId === job.requestId && message.role === 'tool'
      && message.toolName === 'read' && !message.isError && message.text.includes('KEEP-ME-42')),'工具受阻后仍能读取');
    assert.equal((await readFile(join(directory,'files','approval-probe.txt'),'utf8')).trim(),'KEEP-ME-42');
    evidence.passed = true;
    console.info(JSON.stringify({passed:true,mode:'feedback',dataDir:config.dataDir,jobId:job.id}));
  } else {
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
  const prepare = await app.inject({method:'POST',url:`/api/inbox/${ai.delivery.id}/analyses`,headers:ah,payload:{clientActionId:randomUUID(),taskSpaceId:task.id,goal:'请简要核验预处理总和，并指出需要确认的信息。',mode:'conversation',includeResult:true,fileIds:[...ai.event.files,...pre.result!.files].map(file => file.id)}});
  assert.equal(prepare.statusCode,200,prepare.body); const chat = prepare.json<BackgroundAction>(); assert.equal(store.listJobs().length,callsBefore); assert.equal(lab.get(chat.sessionId!,'a').messages.length,0);
  const stream = await app.inject({method:'POST',url:`/api/sessions/${chat.sessionId}/messages`,headers:ah,payload:{text:chat.draft,fileRefs:chat.fileRefs}}); assert.equal(stream.statusCode,200,stream.body); assert.equal(lab.get(chat.sessionId!,'a').lastResult?.status,'succeeded'); evidence.conversation = lab.get(chat.sessionId!,'a').lastResult;
  const analyse = await app.inject({method:'POST',url:`/api/inbox/${bi.delivery.id}/analyses`,headers:bh,payload:{clientActionId:randomUUID(),taskSpaceId:task.id,goal:'请读取所附 CSV，使用 write 创建 Python 脚本 seat_analysis.py，通过 bash 执行，计算 amount 总和和均值，生成 seat-report.txt 并用 file_output 交付。无需人工提问。',mode:'background',includeResult:true,fileIds:bi.event.files.map(file => file.id)}});
  assert.equal(analyse.statusCode,200,analyse.body); const action = analyse.json<BackgroundAction>();
  const bg = await finished(action.jobId!); evidence.seatAnalysis = bg; assert.equal(bg.status,'succeeded',JSON.stringify(bg.error)); assert.ok(bg.result?.files.length);
  assert.notEqual(action.workspaceId,chat.workspaceId); assert.ok((await readFile(join(config.dataDir,'workspaces',action.workspaceId!,'files','seat-report.txt'),'utf8')).includes('42'));
  const continuation = await app.inject({method:'POST',url:`/api/sessions/${action.sessionId}/messages`,headers:bh,payload:{text:'用一句话告诉我刚才报告中的总和和均值，无需工具。'}}); assert.equal(continuation.statusCode,200); assert.equal(lab.get(action.sessionId!,'b').lastResult?.status,'succeeded'); evidence.continuation = lab.get(action.sessionId!,'b').lastResult;
  await handoffTurn('a',chat.sessionId!,'请把报告完善工作分派给席位 B，附上本次导入的 CSV 和 report.txt 两个文件。要求 B 保留原文件，核对总和并补上均值，另存 report_revised.txt 后正式提交给 A。其他格式自行决定，无需再提问。',['assign'],ah);
  const works = lab.collaboration!.list({seatId:'b'}).filter(work => work.taskSpaceId === task.id);
  assert.equal(works.length,1); const work = works[0];
  const bSession = await lab.createSession(action.workspaceId,'b',work.id);
  await handoffTurn('b',bSession.id,'请签收当前关联工作。',['claim'],bh);
  const revised = await handoffTurn('b',bSession.id,'请导入并读取本次工作交接的两个附件，按工作要求完成修订，保留原文件，另存 report_revised.txt，然后正式提交给 A。',['submit'],bh);
  const detail = lab.collaboration!.read({seatId:'a'},work.id);
  assert.equal(detail.state,'submitted'); assert.equal(detail.inputFiles.length,2);
  const directory = join(config.dataDir,'sessions');
  const nativeFile = (await readdir(directory)).find(name => name.includes(bSession.id) && name.endsWith('.jsonl'));
  assert.ok(nativeFile,'需要实际 Pi 会话证据');
  const entries = SessionManager.open(join(directory,nativeFile),directory).getBranch();
  const requestId = revised.lastResult!.requestId;
  const requestStart = entries.findIndex(entry => entry.type === 'custom' && entry.customType === RESOURCE_ENTRY
    && (entry.data as {requestId?:string}).requestId === requestId);
  const requestEnd = entries.findIndex((entry,index) => index > requestStart && entry.type === 'custom'
    && [RESOURCE_ENTRY,RESULT_ENTRY].includes(entry.customType));
  assert.ok(requestStart >= 0 && requestEnd > requestStart,'需要本次修订请求完整的原生记录边界');
  const reads = entries.slice(requestStart+1,requestEnd).flatMap(entry => entry.type === 'message' && entry.message.role === 'assistant'
    ? entry.message.content.filter(block => block.type === 'toolCall' && block.name === 'read') : []);
  const requestMessages = revised.messages.filter(message => message.requestId === requestId);
  const imports = requestMessages.flatMap((message,index) => message.role === 'tool' && message.toolName === 'handoff_import_file' && !message.isError
    ? [{index,result:JSON.parse(message.text) as HandoffImportResult}] : []);
  for (const file of detail.inputFiles) {
    const importedEntry = imports.find(value => value.result.fileId === file.fileId);
    assert.ok(importedEntry,`必须实际导入 ${file.name}，不能使用 B 已有资料替代`);
    const imported = importedEntry.result;
    assert.equal(imported.workspaceId,action.workspaceId);
    const bytes = await readFile(join(lab.files.filesDirectory(action.workspaceId!,'b'),imported.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),file.hash);
    assert.ok(reads.some(call => call.type === 'toolCall' && [imported.path,`/workspace/${imported.path}`].includes(String(call.arguments.path))
      && requestMessages.findIndex(message => message.role === 'tool' && message.toolCallId === call.id && message.toolName === 'read' && !message.isError) > importedEntry.index),'需要在本次导入成功之后读取实际导入路径');
  }
  evidence.handoffImports = imports.map(value => value.result);
  const submitted = detail.submissions.at(-1)!;
  const download = await app.inject({url:`/api/handoff-files/${submitted.file.fileId}`,headers:ah});
  assert.equal(download.statusCode,200,download.body); assert.match(download.body,/42/); assert.match(download.body,/14/);
  evidence.handoff = detail;
  evidence.passed = true;
  console.info(JSON.stringify({passed:true,dataDir:config.dataDir,preprocessJob:pre.id,seatAnalysisJob:bg.id}));
  }
} catch (error) { evidence.failure = error instanceof Error ? error.message : String(error); throw error; }
finally {await writeFile(join(config.dataDir,'validation.json'),JSON.stringify(evidence,null,2)); await app.close();}
