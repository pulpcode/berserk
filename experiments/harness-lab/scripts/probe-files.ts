/** Real Pi + provider + Docker probe in an independent data directory. Does not replace browser acceptance. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import type { FileOutput, SessionSnapshot, StreamEvent, Upload } from '../src/contracts/index.js';

const config = loadConfig();
assert.ok(config.apiKey, '请先配置 LLM_API_KEY；未发送模型请求。');
assert.ok(config.execution?.enabled, '请启用 LAB_EXECUTION_ENABLED 并准备执行镜像。');
config.dataDir = await mkdtemp(join(tmpdir(), 'berserk-files-live-'));
// This diagnostic deadline is explicit and does not change the product's unlimited default.
config.agentRunTimeoutMs = 600_000;
let lab = await PiLab.create(config);
let app = await createApp(lab);
const evidence: Array<{ label: string; input: string; snapshot: SessionSnapshot; events: StreamEvent[] }> = [];
const checks: string[] = [];
let failure: string | undefined;
async function ask(sessionId: string, input: string, label: string, refs: { uploadIds?: string[]; fileRefs?: { path: string }[] } = {}) {
  const events: StreamEvent[] = [];
  const run = lab.start(sessionId, input, refs);
  await run.run(event => events.push(event));
  const snapshot = lab.get(sessionId);
  evidence.push({ label, input, snapshot, events });
  console.info(`${label}: ${snapshot.lastResult?.status}`);
  assert.equal(snapshot.lastResult?.status, 'succeeded', snapshot.lastResult?.message);
  assert.equal(snapshot.recoveryWarning, undefined);
  return snapshot;
}
async function download(file: FileOutput) {
  const response = await app.inject({ method: 'GET', url: `/api/workspaces/${file.workspaceId}/downloads/${file.downloadId}`, headers: { host: '127.0.0.1' } });
  assert.equal(response.statusCode, 200, response.body.slice(0, 100));
  assert.equal(createHash('sha256').update(response.rawPayload).digest('hex'), file.hash);
  return response.rawPayload;
}
try {
  assert.equal(lab.info().files?.executionAvailable, true, 'Docker 不可用或镜像尚未构建；真实文件验收不能记为通过。');
  const session = await lab.createSession();
  const workspaceId = session.workspaceId;
  const input = Buffer.from('项目,金额\n甲,10\n乙,20\n丙,30\n');
  const registration = await app.inject({ method: 'POST', url: `/api/workspaces/${workspaceId}/uploads`,
    headers: { host: '127.0.0.1' }, payload: { name: '数据.csv', size: input.length } });
  assert.equal(registration.statusCode, 201, registration.body);
  const upload = registration.json<Upload>();
  const transfer = await app.inject({ method: 'PUT', url: `/api/workspaces/${workspaceId}/uploads/${upload.uploadId}/content`,
    headers: { host: '127.0.0.1', 'content-type': 'application/octet-stream' }, payload: input });
  assert.equal(transfer.statusCode, 200, transfer.body);
  assert.equal(transfer.json<Upload>().status, 'completed');
  assert.deepEqual(await readFile(join(lab.files.filesDirectory(workspaceId), '数据.csv')), input);
  checks.push('真实上传 API 保存普通工作文件');

  const first = await ask(session.id,
    '请实际读取附件数据.csv，编写并运行 analyze.py 计算金额合计。生成 result.json（键 total 为数值）、方案.md、汇总.xlsx、方案.docx、方案.pdf、统计.png。方案正文用中文，PDF可用简短英文避免字体差异；PNG标题请用镜像内 Noto 中文字体。必须实际执行并检查生成文件，保留 Python 和 JSON 中间文件。完成后使用 file_output 至少交付方案.md、汇总.xlsx、统计.png，再简短回复；不需要追问，也不要只给代码示例。',
    '上传→真实脚本分析→多格式文件交付', { uploadIds: [upload.uploadId] });
  const firstEvidence = evidence.at(-1)!;
  assert.ok(firstEvidence.events.some(event => event.type === 'tool.started' && event.toolName === 'bash'), '必须观测实际容器命令调用。');
  assert.equal(JSON.parse(await readFile(join(lab.files.filesDirectory(workspaceId), 'result.json'), 'utf8')).total, 60);
  for (const path of ['analyze.py', '方案.md', '汇总.xlsx', '方案.docx', '方案.pdf', '统计.png']) assert.ok((await readFile(join(lab.files.filesDirectory(workspaceId), path))).length > 0, path);
  const original = first.fileOutputs?.filter(file => file.requestId === first.lastResult?.requestId) ?? [];
  for (const name of ['方案.md', '汇总.xlsx', '统计.png']) assert.ok(original.some(file => file.name === name), `缺少真实交付卡 ${name}`);
  const originalBytes = new Map<string, Buffer>();
  for (const file of original) originalBytes.set(file.downloadId, await download(file));
  checks.push('真实模型调用 Pi 文件工具和 Python，生成多格式文件与可下载卡');

  const second = await ask(session.id,
    '继续修改：把数据.csv中甲的金额从10改成15，重新执行分析并更新 result.json 和所有成果文件，使金额合计变成65。使用 file_output 再次交付方案.md 和汇总.xlsx。已有脚本与中间文件继续保留，不要只在回复中改数字。',
    '多轮修改工作文件并再次交付');
  assert.equal(JSON.parse(await readFile(join(lab.files.filesDirectory(workspaceId), 'result.json'), 'utf8')).total, 65);
  assert.ok(second.fileOutputs?.some(file => file.requestId === second.lastResult?.requestId && file.name === '方案.md'));
  for (const file of original) assert.deepEqual(await download(file), originalBytes.get(file.downloadId));
  checks.push('多轮实际修改，旧下载副本字节不变');

  const reviewed = await ask(session.id,
    '请使用 subagent 委派 reviewer，明确要求其调用 read 实际读取 /workspace/result.json 和 /workspace/方案.md，核对合计是否为65、文稿是否一致。子Agent只需读取检查，不得执行命令或写文件。你收到检查结果后简短综合。',
    '子 Agent 只读检查当前文件');
  assert.ok(reviewed.subagents?.some(child => child.parentRequestId === reviewed.lastResult?.requestId && child.role === 'reviewer' && child.status === 'succeeded'));
  assert.ok(evidence.at(-1)!.events.some(event => event.type === 'subagent.updated' && event.subagent.toolName === 'read'), '子 Agent 必须实际调用只读文件工具。');
  checks.push('真实子 Agent 独立上下文按权限读取文件');

  const other = await lab.createSession(workspaceId);
  const otherReply = await ask(other.id, '请用 read 读取 /workspace/result.json，只回复 total 的数值，不改文件。', '同工作区新会话继续读取');
  assert.match(otherReply.messages.filter(message => message.role === 'assistant').at(-1)?.text ?? '', /65/);
  checks.push('同工作区另一会话复用普通文件');

  await app.close();
  lab = await PiLab.create(config);
  app = await createApp(lab);
  const restored = lab.get(session.id);
  assert.equal(restored.recoveryWarning, undefined);
  assert.deepEqual(restored.fileOutputs, reviewed.fileOutputs);
  assert.equal(JSON.parse(await readFile(join(lab.files.filesDirectory(workspaceId), 'result.json'), 'utf8')).total, 65);
  for (const file of original) assert.deepEqual(await download(file), originalBytes.get(file.downloadId));
  checks.push('服务重新打开后历史、普通文件与旧下载均保留，无请求重放');
} catch (error) {
  failure = error instanceof Error ? error.message : '真实文件验收失败';
  process.exitCode = 1;
} finally {
  await app.close();
  const path = join(config.dataDir, 'files-evidence.json');
  await writeFile(path, JSON.stringify({ date: new Date().toISOString(), provider: config.provider, model: config.model,
    pi: '0.85.1', image: config.execution?.image, passed: !failure, checks, failure, evidence }, null, 2), { mode: 0o600 });
  if (failure) console.error(failure);
  console.info(`文件验收证据：${path}`);
}
