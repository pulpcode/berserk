/** Isolated real-provider/Docker acceptance. Never opens production data or changes its server. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import type { WorkAction, WorkActionKind, WorkDetail, WorkReceipt, SessionSnapshot, StreamEvent } from '../src/contracts/index.js';

const config = loadConfig({...process.env,LAB_AUTH_MODE:'test'});
assert.ok(config.apiKey, '模型凭证尚未配置。'); assert.ok(config.execution?.enabled, '需要真实 Docker 执行环境。');
config.dataDir = await mkdtemp(join(tmpdir(), 'axon-handoff-live-'));
config.seatId = 'test-seat'; config.testSeats = [{ id:'test-seat', name:'席位 A' }, { id:'seat-b', name:'席位 B' }];
config.agentRunTimeoutMs = 600_000; // Probe watchdog only, never a product default.
let lab = await PiLab.create(config); let app = await createApp(lab);
const headers = {host:'127.0.0.1'};
const root = (seatId: string) => `/api/test-seats/${seatId}`;
const checks: string[] = [];
const evidence: {label:string; seatId:string; snapshot:SessionSnapshot; events:StreamEvent[]}[] = [];
let failure: string | undefined;
async function json<T>(seatId:string, path:string, body?:object):Promise<T> {
  const response = await app.inject({method:body ? 'POST':'GET',url:root(seatId)+path,headers,...(body ? {payload:body}:{})});
  assert.ok(response.statusCode>=200 && response.statusCode<300, `${response.statusCode}: ${response.body}`); return response.json<T>();
}
async function upload(workspaceId:string,name:string,content:string) {
  const registered = await json<{uploadId:string}>('test-seat',`/workspaces/${workspaceId}/uploads`,{name,size:Buffer.byteLength(content)});
  const response = await app.inject({method:'PUT',url:`${root('test-seat')}/workspaces/${workspaceId}/uploads/${registered.uploadId}/content`,headers:{...headers,'content-type':'application/octet-stream'},payload:Buffer.from(content)});
  assert.equal(response.statusCode,200,response.body);
}
async function scenario(seatId:string,sessionId:string,prompt:string,label:string,expected:WorkActionKind) {
  const events:StreamEvent[]=[]; const approvals=new Set<string>(); const jobs:Promise<void>[]=[]; let handlerError:unknown; let businessApprovals = 0;
  const request=lab.start(sessionId,prompt,{},seatId);
  await request.run(event=>{
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
      assert.equal(item.toolName,'work_item_commit'); assert.equal(item.action.handoff?.kind,expected);
      const action=await json<WorkAction>(seatId,`/work-actions/${item.action.handoff!.operationId}`);
      assert.equal(action.source,'agent'); assert.equal(action.status,'prepared');
      const forbidden=await app.inject({method:'POST',url:`${root(seatId)}/work-actions/${action.operationId}/commit`,headers,payload:{confirm:true}});
      assert.equal(forbidden.statusCode,409,'页面不得绕过原 Agent 确认');
      const fresh=await json<SessionSnapshot>(seatId,`/sessions/${sessionId}`);
      assert.ok(fresh.interactions?.some(x=>x.interactionId===item.interactionId&&x.status==='pending'));
      const payload={requestId:item.requestId,kind:'confirmation',decision:'approve'};
      const response=await json<{status:string}>(seatId,`/sessions/${sessionId}/interactions/${item.interactionId}/response`,payload);
      const duplicate=await json<{status:string}>(seatId,`/sessions/${sessionId}/interactions/${item.interactionId}/response`,payload);
      assert.equal(duplicate.status,response.status);
    })().catch(error=>{handlerError=error;lab.cancel(sessionId,request.requestId,seatId);}));
  });
  await Promise.all(jobs); const snapshot=lab.get(sessionId,seatId); evidence.push({label,seatId,snapshot,events});
  console.info(`${label}: ${snapshot.lastResult?.status}`);
  if(handlerError)throw handlerError;
  assert.equal(snapshot.lastResult?.status,'succeeded',snapshot.lastResult?.message); assert.equal(businessApprovals,1);
  return snapshot;
}
async function fixed(seatId:string,fileId:string) {
  const response=await app.inject({method:'GET',url:`${root(seatId)}/handoff-files/${fileId}`,headers});assert.equal(response.statusCode,200,response.body);return response.body;
}
try {
  assert.equal(lab.info().files?.executionAvailable,true,'Docker 不可用，不能算真实验收通过');
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
} catch(error) {failure=error instanceof Error?error.message:'真实验收失败';process.exitCode=1;}
finally {
  await app.close();const path=join(config.dataDir,'handoff-evidence.json');
  await writeFile(path,JSON.stringify({date:new Date().toISOString(),model:config.model,pi:'0.85.1',image:config.execution?.image,passed:!failure,failure,checks,evidence},null,2),{mode:0o600});
  if(failure)console.error(failure);console.info(`任务交接验收证据：${path}`);
}
