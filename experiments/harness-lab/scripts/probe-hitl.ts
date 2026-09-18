/** Real Pi/provider + Docker verification, using an independent temporary workspace. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import { evaluateCommand } from '../src/execution/command-policy.js';
import type { Interaction, InteractionResponse, SessionSnapshot, StreamEvent } from '../src/contracts/index.js';

const config = loadConfig();
assert.ok(config.apiKey, '请配置模型凭证；尚未发起真实请求。');
assert.ok(config.execution?.enabled, '真实 HITL 验收需要现有 Docker 镜像。');
config.dataDir = await mkdtemp(join(tmpdir(), 'axon-hitl-live-'));
config.agentRunTimeoutMs = 600_000; // Diagnostic deadline only; product default remains unchanged.
let lab = await PiLab.create(config);
let app = await createApp(lab);
const evidence: { label: string; snapshot: SessionSnapshot; events: StreamEvent[] }[] = [];
const checks: string[] = [];
let failure: string | undefined;
const headers = { host: '127.0.0.1' };
async function scenario(sessionId: string, input: string, label: string, respond: (item: Interaction) => InteractionResponse | 'stop') {
  const events: StreamEvent[] = [];
  const seen = new Set<string>();
  const handlers: Promise<void>[] = [];
  let handlerFailure: unknown;
  const request = lab.start(sessionId, input);
  await request.run(event => {
    events.push(event);
    if (event.type !== 'interaction.updated' || event.interaction.status !== 'pending' || seen.has(event.interaction.interactionId)) return;
    const item = event.interaction;
    seen.add(item.interactionId);
    const handler = (async () => {
      // A fresh GET exercises server-side refresh recovery without replaying the user message.
      const refreshed = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}`, headers });
      assert.equal(refreshed.statusCode, 200);
      assert.ok(refreshed.json<SessionSnapshot>().interactions?.some(value => value.interactionId === item.interactionId && value.status === 'pending'));
      const response = respond(item);
      if (response === 'stop') { lab.cancel(sessionId, request.requestId); return; }
      const url = `/api/sessions/${sessionId}/interactions/${item.interactionId}/response`;
      const first = await app.inject({ method: 'POST', url, headers, payload: response });
      assert.equal(first.statusCode, 200, first.body);
      const duplicate = await app.inject({ method: 'POST', url, headers, payload: response });
      assert.equal(duplicate.statusCode, 200, duplicate.body);
      assert.equal(duplicate.json<Interaction>().status, first.json<Interaction>().status);
    })().catch(error => { handlerFailure = error; lab.cancel(sessionId, request.requestId); });
    handlers.push(handler);
  });
  await Promise.all(handlers);
  const snapshot = lab.get(sessionId);
  evidence.push({ label, snapshot, events });
  console.info(`${label}: ${snapshot.lastResult?.status}`);
  if (handlerFailure) throw handlerFailure;
  assert.equal(seen.size, 1, '每个探针应出现且只出现一个待处理交互。');
  return snapshot;
}
try {
  assert.equal(lab.info().files?.executionAvailable, true, 'Docker 不可用，不能把真实验收记为通过。');
  const session = await lab.createSession();
  const directory = lab.files.filesDirectory(session.workspaceId);
  const first = await scenario(session.id,
    '请先通过 ask_user 只询问一个问题：报告采用 Markdown 还是纯文本？提供这两个选项。收到答案前不要写文件。收到答案后用 write 在 /workspace/hitl-report.md 写入对应格式的简短报告，内容包含“人工回答已接收”，最后用 file_output 交付文件。不要用 bash 或其他工具代替提问。',
    'AskUser→刷新查询→回答→真实文件交付', item => {
      assert.equal(item.kind, 'question');
      if (item.kind !== 'question') throw new Error('预期提问');
      assert.equal(item.questions.length, 1);
      const question = item.questions[0];
      const option = question.options?.find(value => /markdown/i.test(value.label));
      assert.ok(option, '模型须提供 Markdown 选项');
      return { requestId: item.requestId, kind: 'question', action: 'answer', answers: [{ questionId: question.id, optionIds: [option.id] }] };
    });
  assert.equal(first.lastResult?.status, 'succeeded', first.lastResult?.message);
  assert.match(await readFile(join(directory, 'hitl-report.md'), 'utf8'), /人工回答已接收/);
  assert.ok(first.fileOutputs?.some(file => file.name === 'hitl-report.md'));
  checks.push('真实 AskUser 回答经一次工具结果进入续作，生成并交付文件');

  for (const mode of ['approve', 'reject', 'stop'] as const) {
    const name = `hitl-${mode}.txt`;
    await writeFile(join(directory, name), `fixture-${mode}`);
    const target = await lab.createSession(session.workspaceId);
    const outcome = await scenario(target.id,
      `我希望删除专门为本次验收创建的一次性文件 /workspace/${name}，它的内容是 fixture-${mode}。请先用 read 核对文件，然后发起 bash 调用 rm -- /workspace/${name}，由服务端在执行前展示确认卡片，我会在卡片中作出决定。不要用 ask_user 或聊天文字代替操作授权，也不要用替代命令执行删除；拒绝后保持文件并说明，批准后简短说明实际结果。`,
      `bash ${mode}→核对实际文件效果`, item => {
        assert.equal(item.kind, 'confirmation');
        if (item.kind !== 'confirmation') throw new Error('预期操作确认');
        assert.equal(item.action.command, `rm -- /workspace/${name}`);
        assert.equal(item.action.cwd, '/workspace');
        return mode === 'stop' ? 'stop' : { requestId: item.requestId, kind: 'confirmation', decision: mode };
      });
    assert.equal(outcome.lastResult?.status, mode === 'stop' ? 'cancelled' : 'succeeded', outcome.lastResult?.message);
    if (mode === 'approve') await assert.rejects(access(join(directory, name)));
    else assert.equal(await readFile(join(directory, name), 'utf8'), `fixture-${mode}`);
    checks.push(`真实 bash ${mode} 与持久文件效果一致；重复响应无重复执行`);
  }
  assert.equal(evaluateCommand('sudo ls /workspace').decision, 'deny');
  assert.equal(evaluateCommand('python /workspace/process.py').decision, 'allow');
  await app.close();
  lab = await PiLab.create(config);
  app = await createApp(lab);
  assert.equal(lab.get(session.id).interactions?.[0].status, 'answered');
  assert.equal(lab.get(session.id).recoveryWarning, undefined);
  checks.push('重新打开服务后已完成问题与答案可查，不重发任务');
} catch (error) {
  failure = error instanceof Error ? error.message : 'HITL 真实验收失败';
  process.exitCode = 1;
} finally {
  await app.close();
  const path = join(config.dataDir, 'hitl-evidence.json');
  await writeFile(path, JSON.stringify({ date: new Date().toISOString(), model: config.model, pi: '0.85.1',
    image: config.execution?.image, passed: !failure, failure, checks, evidence }, null, 2), { mode: 0o600 });
  if (failure) console.error(failure);
  console.info(`HITL 验收证据：${path}`);
}
