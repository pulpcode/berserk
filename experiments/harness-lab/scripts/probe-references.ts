/** Real model + Docker acceptance in an isolated data directory; never opens production data. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import type { AgentInfo, ComposerSelection, SessionSnapshot, SkillFile, StreamEvent, Upload, WorkspaceResources } from '../src/contracts/index.js';

const config = loadConfig({...process.env,LAB_AUTH_MODE:'test'});
assert.ok(config.apiKey, '请先配置模型凭证。');
assert.ok(config.execution?.enabled, '需要真实 Docker 执行环境。');
config.dataDir = await mkdtemp(join(tmpdir(), 'axon-references-live-'));
config.seatId = 'test-seat';
config.testSeats = [{ id: 'test-seat', name: '席位 A' }, { id: 'seat-b', name: '席位 B' }];
config.agentRunTimeoutMs = 600_000; // Probe watchdog only; product defaults are unchanged.
let lab = await PiLab.create(config);
let app = await createApp(lab);
const prefix = '/api/test-seats/test-seat';
const headers = { host: '127.0.0.1' };
const evidence: Array<{ label: string; snapshot: SessionSnapshot; events: StreamEvent[] }> = [];
const checks: string[] = [];
let failure: string | undefined;

async function get<T>(path: string): Promise<T> {
  const response = await app.inject({ method: 'GET', url: prefix + path, headers });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<T>();
}
async function upload(workspaceId: string, name: string, content: string): Promise<Upload> {
  const registered = await app.inject({ method: 'POST', url: `${prefix}/workspaces/${workspaceId}/uploads`, headers,
    payload: { name, size: Buffer.byteLength(content) } });
  assert.equal(registered.statusCode, 201, registered.body);
  const response = await app.inject({ method: 'PUT', url: `${prefix}/workspaces/${workspaceId}/uploads/${registered.json<Upload>().uploadId}/content`,
    headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: Buffer.from(content) });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<Upload>();
}
async function ask(id: string, text: string, input: ComposerSelection & { fileRefs?: Array<{ path: string }> }, label: string) {
  const events: StreamEvent[] = [];
  const request = lab.start(id, text, input, 'test-seat');
  await request.run(event => {
    events.push(event);
    // These readonly fixture tasks have no operation needing approval or clarification.
    if (event.type === 'interaction.updated' && event.interaction.status === 'pending') lab.cancel(id, request.requestId, 'test-seat');
  });
  const snapshot = lab.get(id, 'test-seat');
  evidence.push({ label, snapshot, events });
  console.info(`${label}: ${snapshot.lastResult?.status}`);
  assert.equal(snapshot.lastResult?.status, 'succeeded', snapshot.lastResult?.message);
  assert.equal(snapshot.recoveryWarning, undefined);
  return snapshot;
}
async function readEntries(directory: string) {
  const files = (await readdir(directory)).filter(name => name.endsWith('.jsonl'));
  assert.equal(files.length, 1);
  return (await readFile(join(directory, files[0]), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as SessionEntry);
}

try {
  assert.equal(lab.info().files?.executionAvailable, true, 'Docker 不可用，不能计为真实验收通过。');
  const workspace = lab.workspaces.get();
  const sources = await upload(workspace.id, '约束.txt', '测试活动的已确认约束：12人，90分钟，预算800元；线上开展，不采购软件。');
  const draft = await upload(workspace.id, '方案.md', '# 活动方案\n20人，60分钟，预算1200元；线下开展，采购软件。\n');
  assert.ok(sources.path && draft.path);
  const fileRefs = [{ path: sources.path }, { path: draft.path }];
  const resources = await get<WorkspaceResources>(`/workspaces/${workspace.id}/resources`);
  const skill = resources.skills.find(item => item.id === 'review'); assert.ok(skill);
  const skillFile = await get<SkillFile>(`/workspaces/${workspace.id}/skills/review`);
  const roles = await get<AgentInfo[]>(`/workspaces/${workspace.id}/agents`);
  const session = await lab.createSession(workspace.id, 'test-seat');

  for (const roleName of ['reviewer', 'analyst']) {
    const role = roles.find(item => item.name === roleName); assert.ok(role);
    const snapshot = await ask(session.id,
      '请由我选择的子 Agent 实际读取所选两份文件，按所选 Skill 对照约束检查方案，指出事实错误并给出依据。子任务完成后由你简短汇总。资料完整，不需要补充提问，不要修改文件。',
      { fileRefs, skill: { id: skill.id, hash: skill.hash }, agent: { name: role.name, hash: role.hash } }, `${roleName}＋review＋文件`);
    const message = snapshot.messages.find(item => item.role === 'user' && item.requestId === snapshot.lastResult?.requestId);
    assert.equal(message?.selections?.skill?.content, skillFile.content);
    assert.equal(message?.selections?.agent?.name, roleName);
    assert.equal(message?.attachments?.length, 2);
    const children = snapshot.subagents?.filter(child => child.parentRequestId === snapshot.lastResult?.requestId) ?? [];
    const child = children.find(item => item.role === roleName); assert.ok(child, '明确选择须实际调用相应子角色');
    assert.equal(child.status, 'succeeded', child.error);
    assert.match(child.result ?? '', /12|十二/); assert.match(child.result ?? '', /90|九十/); assert.match(child.result ?? '', /800|八百/);
    assert.match(child.result ?? '', /问题与依据/); assert.match(child.result ?? '', /修订建议/); assert.match(child.result ?? '', /仍待确认/);
    const entries = await readEntries(join(config.dataDir, 'subagents', session.id, child.subagentId));
    const reads = entries.filter(entry => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === 'read' && !entry.message.isError);
    assert.ok(reads.length >= 2, '必须实际通过沙盒工具读取两份文件');
    const origin = entries.find(entry => entry.type === 'custom' && entry.customType === 'berserk.subagent-origin.v1');
    assert.ok(origin?.type === 'custom');
    const effectiveTools = (origin.data as { effectiveTools: string[] }).effectiveTools;
    assert.ok(!effectiveTools.includes('bash') && !effectiveTools.includes('write'));
    if (roleName === 'analyst') assert.ok(!effectiveTools.includes('skill_read'), '提供正文不扩大角色工具权限');
    checks.push(`${roleName} 真实调用、两份文件读取、方法格式、父会话返回及原权限保留`);
  }

  const direct = await ask(session.id, '请你自己按所选方法检查两份文件，保留方法要求的三个部分，简短回答。本轮不要委派。',
    { fileRefs, skill: { id: skill.id, hash: skill.hash } }, 'Skill 单独选用');
  assert.ok(!direct.subagents?.some(child => child.parentRequestId === direct.lastResult?.requestId));
  assert.match(direct.messages.filter(item => item.role === 'assistant').at(-1)?.text ?? '', /问题与依据/);
  const ordinary = await ask(session.id, '本轮不检查文件、不采用上一条的输出格式，也不调用工具或委派。只回复“收到”。', {}, '无选择的普通续聊');
  const ordinaryMessage = ordinary.messages.find(item => item.role === 'user' && item.requestId === ordinary.lastResult?.requestId);
  assert.equal(ordinaryMessage?.selections, undefined);
  assert.equal(ordinaryMessage?.attachments, undefined);
  assert.equal(ordinary.lastResult?.usageSummary?.toolCalls, 0, '普通续聊不应重放先前工具或委派');
  checks.push('显式加载 Skill 与普通续聊，下一条没有自动选择');

  const expected = lab.get(session.id, 'test-seat');
  await app.close(); await lab.close();
  lab = await PiLab.create(config); app = await createApp(lab);
  const restored = lab.get(session.id, 'test-seat');
  assert.equal(restored.recoveryWarning, undefined);
  assert.deepEqual(restored.messages, expected.messages);
  assert.deepEqual(restored.subagents, expected.subagents);
  const foreign = await app.inject({ method: 'GET', url: `/api/test-seats/seat-b/workspaces/${workspace.id}/agents`, headers });
  assert.equal(foreign.statusCode, 404);
  checks.push('关闭重开后父子历史及选择一致，另一席位不能查询角色入口的外部工作区');
} catch (error) {
  failure = error instanceof Error ? error.message : '真实验收失败';
  process.exitCode = 1;
} finally {
  await app.close(); await lab.close();
  const path = join(config.dataDir, 'references-evidence.json');
  await writeFile(path, JSON.stringify({ date: new Date().toISOString(), model: config.model, provider: config.provider,
    pi: '0.85.1', image: config.execution?.image, passed: !failure, checks, failure, evidence }, null, 2), { mode: 0o600 });
  if (failure) console.error(failure);
  console.info(`证据：${path}`);
}
