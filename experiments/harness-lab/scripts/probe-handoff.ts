/** Isolated real-provider/Docker acceptance. Never opens production data or changes its server. */
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import type { HandoffFile, HandoffImportResult, WorkAction, WorkActionKind, WorkDetail, WorkReceipt, SessionSnapshot, StreamEvent } from '../src/contracts/index.js';
import type { WorkActionInput } from '../src/contracts/collaboration.js';

// No arguments retains the original full handoff/return/resubmit/restart probe.
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.info('npm run probe:handoff -- [--attachments baseline|verify]\nbaseline: 1 个自然多轮场景；verify: 3 个自然多轮 + 单文件、纯文字、明确两份及成果回传。全部使用新隔离数据，逐项保留失败，不自动重跑。');
  process.exit(0);
}
const attachmentMode = args[0] === '--attachments' ? args[1] : undefined;
assert.ok(args.length === 0 || (args.length === 2 && ['baseline', 'verify'].includes(attachmentMode ?? '')), '参数应为 --attachments baseline 或 --attachments verify。');

const config = loadConfig({...process.env,LAB_AUTH_MODE:'test'});
assert.ok(config.apiKey, '模型凭证尚未配置。'); assert.ok(config.execution?.enabled, '需要真实 Docker 执行环境。');
config.dataDir = await mkdtemp(join(tmpdir(), 'axon-handoff-live-'));
config.seatId = 'test-seat'; config.testSeats = [{ id:'test-seat', name:'席位 A' }, { id:'seat-b', name:'席位 B' }];
config.agentRunTimeoutMs = 600_000; // Probe watchdog only, never a product default.
let lab = await PiLab.create(config); let app = await createApp(lab);
const headers = {host:'127.0.0.1'};
const root = (seatId: string) => `/api/test-seats/${seatId}`;
const checks: string[] = [];
interface NativeTrace {
  calls: Array<{ entryId:string; id:string; name:string; arguments:Record<string,unknown> }>;
  results: Array<{ entryId:string; toolCallId:string; toolName:string; isError:boolean; text:string; details?:unknown }>;
}
const evidence: {label:string; seatId:string; prompt:string; snapshot:SessionSnapshot; events:StreamEvent[]; native?:NativeTrace}[] = [];
const attachmentCases: {label:string; passed:boolean; failure?:string; workspaceId?:string; work?:WorkDetail; checks:string[]}[] = [];
const modelInputsPath = join(config.dataDir, 'handoff-model-inputs.jsonl');
const originalFetch = globalThis.fetch;
let currentTurn: {label:string; seatId:string; sessionId:string; requestId:string} | undefined;
let modelInputCount = 0;
if (attachmentMode) {
  // Observe the final provider payload after Pi and the host's onPayload transformation.
  // Only body JSON is recorded; request headers, endpoint and options can hold credentials.
  await writeFile(modelInputsPath, '', { mode:0o600 });
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).origin === new URL(config.baseUrl).origin) {
      const body = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.clone().text() : '';
      if (body) {
        const payload = JSON.parse(body) as Record<string,unknown>;
        if (Array.isArray(payload.messages)) {
          const record = JSON.stringify({index:++modelInputCount, ...currentTurn, payload});
          assert.ok(!config.apiKey || !record.includes(config.apiKey), '验收记录不能包含模型凭证。');
          await appendFile(modelInputsPath, `${record}\n`);
        }
      }
    }
    return originalFetch(input, init);
  };
}
let failure: string | undefined;

async function nativeTrace(sessionId:string):Promise<NativeTrace> {
  const directory = join(config.dataDir, 'sessions');
  const filename = (await readdir(directory)).find(name => name.endsWith('.jsonl') && name.includes(sessionId));
  assert.ok(filename, '缺少实际 Pi 会话文件');
  const manager = SessionManager.open(join(directory, filename), directory);
  const trace:NativeTrace = {calls:[], results:[]};
  for (const entry of manager.getBranch()) {
    if (entry.type !== 'message') continue;
    const message = entry.message;
    if (message.role === 'assistant') {
      for (const block of message.content) if (block.type === 'toolCall') trace.calls.push({entryId:entry.id, id:block.id, name:block.name, arguments:block.arguments});
    } else if (message.role === 'toolResult') {
      trace.results.push({entryId:entry.id, toolCallId:message.toolCallId, toolName:message.toolName, isError:message.isError,
        text:message.content.filter(block => block.type === 'text').map(block => block.text).join('\n'), details:message.details});
    }
  }
  return trace;
}
async function json<T>(seatId:string, path:string, body?:object):Promise<T> {
  const response = await app.inject({method:body ? 'POST':'GET',url:root(seatId)+path,headers,...(body ? {payload:body}:{})});
  assert.ok(response.statusCode>=200 && response.statusCode<300, `${response.statusCode}: ${response.body}`); return response.json<T>();
}
async function upload(workspaceId:string,name:string,content:string) {
  const registered = await json<{uploadId:string}>('test-seat',`/workspaces/${workspaceId}/uploads`,{name,size:Buffer.byteLength(content)});
  const response = await app.inject({method:'PUT',url:`${root('test-seat')}/workspaces/${workspaceId}/uploads/${registered.uploadId}/content`,headers:{...headers,'content-type':'application/octet-stream'},payload:Buffer.from(content)});
  assert.equal(response.statusCode,200,response.body);
}
async function scenario(seatId:string,sessionId:string,prompt:string,label:string,expected?:WorkActionKind) {
  const events:StreamEvent[]=[]; const approvals=new Set<string>(); const jobs:Promise<void>[]=[]; let handlerError:unknown; let businessApprovals = 0;
  const request=lab.start(sessionId,prompt,{},seatId);
  currentTurn = {label,seatId,sessionId,requestId:request.requestId};
  try { await request.run(event=>{
    events.push(event);
    if(event.type!=='interaction.updated'||event.interaction.status!=='pending'||approvals.has(event.interaction.interactionId))return;
    const item=event.interaction; approvals.add(item.interactionId);
    jobs.push((async()=>{
      assert.equal(item.kind,'confirmation','固定验收目标不应产生额外问题');
      if(item.kind!=='confirmation')throw new Error('预期业务确认');
      if (item.toolName === 'bash') {
        // Only these inspected fixture commands may be approved by this diagnostic script.
        assert.ok(['python3 /workspace/统计.py', 'cd /workspace && python3 统计.py && echo "-----" && cat 方案.md'].includes(item.action.command || ''), '遇到非固定验收命令，需要人工检查');
        await json(seatId,`/sessions/${sessionId}/interactions/${item.interactionId}/response`,{requestId:item.requestId,kind:'confirmation',decision:'approve'});
        return;
      }
      businessApprovals++;
      assert.equal(item.toolName,'work_item_action'); assert.equal(item.action.handoff?.kind,expected);
      const action=await json<WorkAction>(seatId,`/work-actions/${item.action.handoff!.operationId}`);
      assert.equal(action.source,'agent'); assert.equal(action.status,'prepared');
      if (action.kind === 'assign') {
        assert.equal(lab.collaboration!.list({seatId:action.assigneeSeatId}).filter(work => work.taskSpaceId === action.taskSpaceId).length,0,'批准前不产生正式分派');
      }
      const forbidden=await app.inject({method:'POST',url:`${root(seatId)}/work-actions/${action.operationId}/commit`,headers,payload:{confirm:true}});
      assert.equal(forbidden.statusCode,409,'页面不得绕过原 Agent 确认');
      const fresh=await json<SessionSnapshot>(seatId,`/sessions/${sessionId}`);
      assert.ok(fresh.interactions?.some(x=>x.interactionId===item.interactionId&&x.status==='pending'));
      const payload={requestId:item.requestId,kind:'confirmation',decision:'approve'};
      const response=await json<{status:string}>(seatId,`/sessions/${sessionId}/interactions/${item.interactionId}/response`,payload);
      const duplicate=await json<{status:string}>(seatId,`/sessions/${sessionId}/interactions/${item.interactionId}/response`,payload);
      assert.equal(duplicate.status,response.status);
    })().catch(error=>{handlerError=error;lab.cancel(sessionId,request.requestId,seatId);}));
  }); } finally {
    await Promise.all(jobs);
    const snapshot=lab.get(sessionId,seatId);
    evidence.push({label,seatId,prompt,snapshot,events,...(attachmentMode ? {native:await nativeTrace(sessionId)} : {})});
    currentTurn = undefined;
  }
  const snapshot=lab.get(sessionId,seatId);
  console.info(`${label}: ${snapshot.lastResult?.status}`);
  if(handlerError)throw handlerError;
  assert.equal(snapshot.lastResult?.status,'succeeded',snapshot.lastResult?.message); assert.equal(businessApprovals,expected ? 1 : 0);
  return snapshot;
}
async function fixed(seatId:string,fileId:string) {
  const response=await app.inject({method:'GET',url:`${root(seatId)}/handoff-files/${fileId}`,headers});assert.equal(response.statusCode,200,response.body);return response.body;
}
interface AttachmentFixture {
  label:string;
  draft:{name:string; content:string; marker:string};
  requirements:{name:string; content:string; marker:string};
  resultName:string;
  selection:'natural'|'one'|'none'|'explicit';
}
function fixture(label:string, title:string, requirement:string, selection:AttachmentFixture['selection']):AttachmentFixture {
  const marker = `测试文稿：${title}`;
  const requiredMarker = `本次要求：${requirement}`;
  return {label,selection,resultName:`${title}_修订稿.md`,
    draft:{name:`${title}_初稿.md`,marker,content:`# ${title}\n${marker}\n本文件仅用于流程测试。\n旧说明：相关事项口头告知即可，无须保留记录。\n`},
    requirements:{name:`${title}_修订要求.md`,marker:requiredMarker,content:`# 修订要求\n${requiredMarker}\n修订旧说明，保留测试声明，新增一个虚构填写示例。保留初稿，将修订稿另存为 ${title}_修订稿.md。不查询外部制度，其余排版自行决定。\n`}};
}
const attachmentFixtures = [
  fixture('自然多轮 1', '值班交接说明', '改为双方核对书面记录，日期统一为 YYYY-MM-DD。', 'natural'),
  fixture('自然多轮 2', '设备借用说明', '登记设备名称、借用人和归还日期，归还时双方确认。', 'natural'),
  fixture('自然多轮 3', '会议材料归档说明', '登记会议日期、材料名称和归档负责人，完成后核对清单。', 'natural'),
  fixture('仅交一份', '培训安排说明', '培训结束后保留签到记录。', 'one'),
  fixture('纯文字任务', '来访登记说明', '保留来访日期和接待人。', 'none'),
  fixture('明确双附件与成果回传', '活动结束检查说明', '活动结束时记录场地、检查人和遗留事项。', 'explicit'),
];
const digest = (bytes:Buffer) => createHash('sha256').update(bytes).digest('hex');
function traceFor(sessionId:string) {
  const trace = evidence.findLast(item => item.snapshot.id === sessionId)?.native;
  assert.ok(trace, '缺少本次真实工具调用记录'); return trace;
}
async function verifyImported(seatId:string, workspaceId:string, sessionId:string, files:HandoffFile[]) {
  const trace = traceFor(sessionId);
  const imports = trace.results.filter(result => result.toolName === 'handoff_import_file' && !result.isError)
    .map(result => result.details as HandoffImportResult);
  for (const file of files) {
    const imported = imports.find(result => result.fileId === file.fileId);
    assert.ok(imported, `模型未实际导入 ${file.name}`);
    assert.equal(imported.workspaceId, workspaceId);
    const bytes = await readFile(join(lab.files.filesDirectory(workspaceId, seatId), imported.path));
    const response = await app.inject({method:'GET',url:`${root(seatId)}/handoff-files/${file.fileId}`,headers});
    assert.equal(response.statusCode,200,response.body);
    assert.deepEqual(bytes,response.rawPayload,`${file.name} 导入字节必须与固定副本相同`);
    assert.equal(digest(bytes),file.hash);
  }
}
async function attachmentScenario(item:AttachmentFixture) {
  const result:typeof attachmentCases[number] = {label:item.label,passed:false,checks:[]};
  attachmentCases.push(result);
  try {
    const a = await lab.workspaces.create(item.label);
    result.workspaceId = a.id;
    for (const file of [item.draft,item.requirements,{name:'绿植养护记录.txt',content:'绿萝每周浇水一次。这是另一件工作的备忘，与文稿修订无关。\n'}]) await upload(a.id,file.name,file.content);
    const sender = await lab.createSession(a.id,'test-seat');
    if (item.selection !== 'none') {
      await scenario('test-seat',sender.id,`请先读取当前工作区的《${item.draft.name}》和《${item.requirements.name}》，简短说明需要修改什么。先不修改或分派。`,`${item.label} / A 先读两份文稿`);
      const text = traceFor(sender.id).results.filter(value => !value.isError).map(value => value.text).join('\n');
      for (const file of [item.draft,item.requirements]) assert.ok(text.includes(file.marker), `模型未通过工具实际读取 ${file.name}`);
      result.checks.push('首轮真实工具结果含初稿和修订要求正文');
    }
    const prompt = item.selection === 'natural' ? '直接全部分派给 B 去执行' : item.selection === 'one'
      ? `请把这项修订工作分派给席位 B。只附上《${item.draft.name}》，把修订要求写进工作说明，不附其他文件。`
      : item.selection === 'none' ? '请分派给席位 B 一项纯文字工作：拟三条会议室使用提醒。无需参考资料，也不附任何文件。'
      : `请把这项修订工作分派给席位 B，附上《${item.draft.name}》和《${item.requirements.name}》。`;
    await scenario('test-seat',sender.id,prompt,`${item.label} / A 分派`,'assign');
    const works = lab.collaboration!.list({seatId:'seat-b'}).filter(work => work.taskSpaceId === a.taskSpaceId);
    assert.equal(works.length,1,'每个独立场景只能创建一项分派工作');
    const work = await json<WorkDetail>('seat-b',`/work-items/${works[0].id}`);
    result.work = work;
    const expected = item.selection === 'none' ? [] : item.selection === 'one' ? [item.draft] : [item.draft,item.requirements];
    const sorted = (names:string[]) => names.toSorted();
    assert.deepEqual(sorted(work.inputFiles.map(file => file.name)),sorted(expected.map(file => file.name)), '实际附件必须恰为用户选择的资料，不能漏传或附上无关文件');
    const trace = traceFor(sender.id);
    const committed = trace.results.find(value => value.toolName === 'work_item_action' && !value.isError &&
      work.id === (value.details as WorkReceipt).workItemId);
    assert.ok(committed,'缺少本工作真实工具回执');
    const receipt = committed.details as WorkReceipt;
    const confirmed = lab.collaboration!.getAction({seatId:'test-seat'},receipt.operationId);
    assert.equal(confirmed.status,'committed');
    assert.ok(confirmed.receipt,'交接必须保存实际业务回执');
    for (const key of Object.keys(confirmed.receipt) as (keyof WorkReceipt)[]) {
      assert.equal(receipt[key],confirmed.receipt[key],`工具回执字段 ${key} 必须与业务记录一致`);
    }
    const call = trace.calls.find(value => value.id === committed.toolCallId && value.name === 'work_item_action');
    assert.ok(call,'缺少本工作真实调用参数');
    const action = call.arguments.action as WorkActionInput;
    assert.equal(action.kind,'assign');
    if (action.kind !== 'assign') throw new Error('预期分派调用');
    assert.ok(!('taskSpaceId' in action) && !('workspaceId' in action.payload),'模型不填写宿主已知的项目与工作区');
    const card = evidence.findLast(value => value.snapshot.id === sender.id)?.snapshot.interactions?.find(value =>
      value.kind === 'confirmation' && value.toolCallId === call.id);
    assert.ok(card?.kind === 'confirmation' && card.status === 'approved','同一工具调用必须有真实批准');
    assert.deepEqual(card.action.parameters,call.arguments,'确认参数与原始模型调用一致');
    assert.equal(card.action.handoff?.operationId,receipt.operationId);
    assert.deepEqual(card.action.handoff?.files,work.inputFiles,'卡片实际附件与交接文件一致');
    const paths = action.payload.inputPaths ?? [];
    assert.ok(Array.isArray(paths),'真实附件参数应为路径数组');
    assert.deepEqual(sorted(paths.map(path => path.replace(/^\/workspace\//,''))),sorted(expected.map(file => file.name)), '实际调用选择的路径必须与本场景资料一致');
    assert.deepEqual(confirmed.files,work.inputFiles,'准备时的固定附件应与确认交接后的工作输入相同');
    for (const file of work.inputFiles) {
      const original = expected.find(value => value.name === file.name)!;
      const bytes = Buffer.from(original.content);
      assert.equal(file.hash,digest(bytes));
      assert.equal(file.size,bytes.length);
      assert.equal(await fixed('seat-b',file.fileId),original.content);
    }
    result.checks.push(`实际准备/确认附件为 ${expected.length} 份，名称、字节、hash 一致，无关文件未交接`);
    const b = lab.workspaces.list('seat-b').workspaces.find(workspace => workspace.taskSpaceId === a.taskSpaceId)!;
    const forbidden = await app.inject({method:'GET',url:`${root('seat-b')}/workspaces/${a.id}/files`,headers});
    assert.equal(forbidden.statusCode,404);
    assert.deepEqual(await readdir(lab.files.filesDirectory(b.id,'seat-b')),[],'分派不应自动复制 A 的整个目录');
    result.checks.push('B 工作区初始为空且不能读取 A 工作区');
    if (expected.length) {
      const claim = await json<WorkAction>('seat-b','/work-items/prepare',{clientActionId:randomUUID(),kind:'claim',workItemId:work.id,expectedRevision:work.revision,payload:{}});
      await json<WorkReceipt>('seat-b',`/work-actions/${claim.operationId}/commit`,{confirm:true});
      const receiver = await lab.createSession(b.id,'seat-b',work.id);
      await scenario('seat-b',receiver.id,'请把关联工作的输入资料放到当前工作区并读取，简短说明收到哪些资料，先不修改或提交。',`${item.label} / B 接收资料`);
      await verifyImported('seat-b',b.id,receiver.id,work.inputFiles);
      result.checks.push('B 通过真实模型调用导入资料，本地文件与交接副本逐字节一致');
      if (item.selection === 'explicit') {
        await scenario('seat-b',receiver.id,`请按已收到的要求完成这项修订，保存为 ${item.resultName}，保留原始资料，并正式提交修订稿给分派方。`,`${item.label} / B 修订并提交`,'submit');
        const submitted = await json<WorkDetail>('test-seat',`/work-items/${work.id}`);
        assert.equal(submitted.state,'submitted'); assert.equal(submitted.submissions.length,1);
        const output = submitted.submissions[0].file;
        assert.ok(output.size > 0); assert.equal(output.name,item.resultName);
        lab.bindWorkItem(sender.id,work.id,'test-seat');
        await scenario('test-seat',sender.id,'请把 B 提交的修订成果放到当前工作区并读取，简短说明收到什么，暂不验收或退回。',`${item.label} / A 接收成果`);
        await verifyImported('test-seat',a.id,sender.id,[output]);
        result.work = submitted;
        result.checks.push('B 正式提交成果，A 通过实际模型调用导入且字节与提交副本一致');
        await scenario('test-seat',sender.id,'我已确认这份修订稿符合要求，请验收通过当前提交。',`${item.label} / A 验收`,'review');
        result.work = await json<WorkDetail>('test-seat',`/work-items/${work.id}`);
        assert.equal(result.work.state,'completed');
        result.checks.push('A 确认验收，实际回执对应工作完成状态');
      }
    }
    result.passed = true;
  } catch (error) {
    result.failure = error instanceof Error ? error.message : '附件场景失败';
    console.error(`${item.label}：${result.failure}`);
  } finally {
    // Flush each case, including failure, before starting another independent conversation.
    await writeFile(join(config.dataDir,'handoff-attachment-cases.json'),JSON.stringify(attachmentCases,null,2),{mode:0o600});
    await writeFile(join(config.dataDir,'handoff-attachment-turns.json'),JSON.stringify(evidence,null,2),{mode:0o600});
  }
}
async function attachmentProbe() {
  for (const item of attachmentMode === 'baseline' ? attachmentFixtures.slice(0,1) : attachmentFixtures) await attachmentScenario(item);
  assert.ok(modelInputCount > 0,'没有捕获真实模型输入，不能完成说明核对');
  checks.push(`保存全部 ${attachmentCases.length} 个场景及 ${modelInputCount} 次实际模型请求，未自动重跑失败场景`);
  const failed = attachmentCases.filter(item => !item.passed);
  assert.equal(failed.length,0,`附件验收有 ${failed.length} 个场景失败：${failed.map(item => item.label).join('、')}`);
}
try {
  assert.equal(lab.info().files?.executionAvailable,true,'Docker 不可用，不能算真实验收通过');
  if (attachmentMode) {
    await attachmentProbe();
  } else {
  const a=lab.workspaces.get();
  await upload(a.id,'任务书.txt','根据数据.csv编制中文简短方案。必须用Python脚本计算数量总和，保存脚本和方案。');
  await upload(a.id,'数据.csv','地点,数量\n甲区,3\n乙区,5\n');
  const sender=await lab.createSession(a.id,'test-seat');
  await scenario('test-seat',sender.id,'请把一项工作分派给席位 B（seat-b）：标题“编制统计方案”，目标是根据任务书与数据计算总量并编制中文方案。附上当前项目的任务书.txt和数据.csv。请使用工作交接工具准备并提交，等待我在确认卡片批准。','A 分派文字与两份资料','assign');
  const list=lab.collaboration!.list({seatId:'seat-b'}); assert.equal(list.length,1); const workId=list[0].id;
  const work=await json<WorkDetail>('seat-b',`/work-items/${workId}`); assert.equal(work.inputFiles.length,2);
  const target=lab.workspaces.list('seat-b').workspaces.find(w=>w.taskSpaceId===a.taskSpaceId)!;
  const foreign=await app.inject({method:'GET',url:`${root('seat-b')}/workspaces/${a.id}/files`,headers});assert.equal(foreign.statusCode,404);
  const action=await json<WorkAction>('seat-b','/work-items/prepare',{clientActionId:randomUUID(),kind:'claim',workItemId:workId,expectedRevision:work.revision,payload:{}});
  await json<WorkReceipt>('seat-b',`/work-actions/${action.operationId}/commit`,{confirm:true});
  const receiver=await lab.createSession(target.id,'seat-b',workId);lab.bindWorkItem(sender.id,workId,'test-seat');
  checks.push('单服务两席位，真实上传两份文件并确认分派，接收方独立目录，显式签收关联会话');
  await scenario('seat-b',receiver.id,'请办理关联工作：先将两份输入资料导入当前工作区并读取；编写 /workspace/统计.py，用 Python 读取收到的数据.csv，计算数量总和并生成 /workspace/方案.md，方案正文写明“总量：8”。用 bash 命令 python3 /workspace/统计.py 实际执行脚本，勿连接其他命令。完成后将方案.md通过工作交接工具提交给分派方，由我在卡片确认。只提交这一份文件。','B 读取资料、编写执行脚本并提交','submit');
  let detail=await json<WorkDetail>('test-seat',`/work-items/${workId}`);assert.equal(detail.state,'submitted');assert.equal(detail.submissions.length,1);
  const first=detail.submissions[0].file.fileId;const firstText=await fixed('test-seat',first);assert.match(firstText,/8/);
  assert.ok(await readFile(join(lab.files.filesDirectory(target.id,'seat-b'),'统计.py'),'utf8'));
  assert.ok(lab.get(receiver.id,'seat-b').messages.some(m=>m.role==='tool'&&m.toolName==='bash'&&!m.isError));
  checks.push('真实Pi/模型调用导入与文件工具，Docker执行Python生成方案，确认提交保存固定字节');
  await scenario('test-seat',sender.id,'请将当前待验收的这份方案退回，原因写“请补充风险提示：数据仅供测试，不用于现场决策。”请通过工作交接工具执行退回，等待我确认。','A 退回并给出修改意见','review');
  await scenario('seat-b',receiver.id,'请根据关联工作的最新退回意见修改方案.md，明确补充“数据仅供测试，不用于现场决策”，保留总量8；然后再次通过工作交接工具提交方案.md，等待我确认。','B 修改后再次提交','submit');
  detail=await json<WorkDetail>('test-seat',`/work-items/${workId}`);assert.equal(detail.submissions.length,2);
  const secondText=await fixed('test-seat',detail.submissions[1].file.fileId);assert.match(secondText,/数据仅供测试，不用于现场决策/);assert.equal(await fixed('test-seat',first),firstText);assert.notEqual(secondText,firstText);
  await scenario('test-seat',sender.id,'当前第二次提交的方案符合要求，请验收通过当前这一次提交，使用工作交接工具并等待我确认。','A 验收通过','review');
  assert.equal(lab.collaboration!.read({seatId:'test-seat'},workId).state,'completed');
  checks.push('退回意见进入后续对话，重提交保留两个不同固定版本，只验收当前版本');
  await app.close();lab=await PiLab.create(config);app=await createApp(lab);
  assert.equal(lab.collaboration!.read({seatId:'test-seat'},workId).state,'completed');assert.equal(lab.get(receiver.id,'seat-b').recoveryWarning,undefined);
  assert.equal(lab.get(sender.id,'test-seat').recoveryWarning,undefined);assert.equal(lab.get(receiver.id,'seat-b').workItemId,workId);
  checks.push('重启读回业务结果、两席位原生历史及会话关联，无自动重放');
  }
} catch(error) {failure=error instanceof Error?error.message:'真实验收失败';process.exitCode=1;}
finally {
  globalThis.fetch = originalFetch;
  await app.close();const path=join(config.dataDir,'handoff-evidence.json');
  await writeFile(path,JSON.stringify({date:new Date().toISOString(),model:config.model,pi:'0.85.1',image:config.execution?.image,mode:attachmentMode ?? 'full',passed:!failure,failure,checks,
    ...(attachmentMode ? {modelInputsPath,modelInputCount,attachmentCases} : {}),evidence},null,2),{mode:0o600});
  if(failure)console.error(failure);console.info(`任务交接验收证据：${path}`);
}
