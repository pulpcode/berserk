/** W01-7: actual Axon/Pi crash boundaries, isolated data; optional real Docker/model continuation. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir, access } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentSession } from '@earendil-works/pi-coding-agent';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import { fakeRuntime, testConfig } from '../tests/pi/fake-runtime.js';
import type { StreamEvent } from '../src/contracts/index.js';

const script = fileURLToPath(import.meta.url);
const localCases = ['before_user', 'awaiting_model', 'partial_text', 'before_tool', 'after_effect', 'after_result',
  'waiting_question', 'waiting_confirmation', 'approved_confirmation', 'compaction_call', 'compaction_saved'];
const dockerCases = ['docker_after_effect', 'docker_waiting_confirmation', 'docker_approved'];
const initial = '恢复验收编号789；请记住约定：报告使用中文。只在测试目录执行本次指定的测试操作。';
const questions = [{ id: 'format', prompt: '报告格式？', options: [{ id: 'md', label: 'Markdown' }, { id: 'txt', label: '纯文本' }] }];
const summary = '## Goal\n核对编号789并继续任务。\n## Progress\n已保存基线资料。\n## Next Steps\n按照用户本轮要求继续。';
type Meta = { sessionId: string; workspaceId: string; requestId: string };
// Synchronous fault injection at public SDK/event boundaries, only in a disposable child.
function freeze() { writeFileSync(join(process.argv[5], 'boundary.ready'), 'ready'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); }
async function history(dir: string) {
  const files = (await readdir(join(dir, 'sessions'))).filter(name => name.endsWith('.jsonl'));
  assert.equal(files.length, 1); return join(dir, 'sessions', files[0]);
}
async function child(scenario: string, mode: string, dir: string, live: boolean) {
  const docker = scenario.startsWith('docker_');
  const realConfig = loadConfig();
  const config = live ? { ...realConfig, dataDir: dir } : testConfig(dir);
  config.hitlDemoEnabled = true;
  config.agentRunTimeoutMs = 120_000; // Probe-only deadline; not a product default.
  config.execution = { ...realConfig.execution!, enabled: docker };
  const compacting = scenario.startsWith('compaction_');
  if (compacting) Object.assign(config, { contextWindow: 8192, maxOutputTokens: 6000, compactionReserveTokens: mode === 'seed' ? 1024 : 7000, compactionKeepRecentTokens: 128 });
  let armed = mode !== 'seed'; let turnCalls = 0; let instructionHash: string | null = null;
  const fake = await fakeRuntime(config, context => {
    if (!armed) return { text: '已记录编号789。' + '基线内容。'.repeat(compacting ? 160 : 0), usageInput: 1800 };
    if (mode !== 'seed') return { text: !context.tools?.length ? summary : '已依据当前历史继续。' };
    if (!context.tools?.length) {
      if (scenario === 'compaction_call') freeze();
      return { text: summary };
    }
    const index = turnCalls++;
    if (scenario === 'awaiting_model' || (scenario === 'after_result' && index > 0)) freeze();
    if (scenario === 'partial_text') return { text: '未保存的流式片段' };
    if (scenario === 'waiting_question') return { tools: [{ name: 'ask_user', arguments: { questions } }] };
    if (scenario === 'waiting_confirmation' || scenario === 'approved_confirmation') return { tools: [{ name: 'confirmation_demo', arguments: { content: '只生成测试回执' } }] };
    if (docker) return { tools: [{ name: 'bash', arguments: { command: scenario === 'docker_after_effect'
      ? 'printf "effect\\n" >> /workspace/effects.txt; sleep 60'
      : 'rm -- /workspace/disposable.txt' } }] };
    if (index === 0 && ['before_tool', 'after_effect', 'after_result'].includes(scenario)) return { tools: [{ name: 'instructions_update', arguments: { fileId: 'workspace', content: '报告使用中文。', expectedHash: instructionHash } }] };
    return { text: '完成' };
  });
  let lab = await PiLab.create(config, mode === 'recover' && live ? undefined : fake.runtime);
  if (docker) assert.equal(lab.info().files?.executionAvailable, true, 'Docker required for this probe');
  const session = mode === 'seed' ? await lab.createSession() : lab.get(JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')).sessionId);
  const file = await history(dir);
  instructionHash = (await lab.resources.readInstruction(session.workspaceId, 'workspace')).hash;
  if (mode === 'seed') {
    if (compacting) {
      for (let n = 0; n < 4; n++) await lab.start(session.id, `基线${n}编号789：` + '已经核对的资料。'.repeat(160)).run(() => {});
      await lab.close(); config.compactionReserveTokens = 7000;
      lab = await PiLab.create(config, fake.runtime);
    }
    if (docker) {
      await writeFile(join(lab.files.filesDirectory(session.workspaceId), 'disposable.txt'), 'disposable fixture');
      await writeFile(join(lab.files.filesDirectory(session.workspaceId), 'next-disposable.txt'), 'fresh confirmation fixture');
    }
    const originalPrompt = AgentSession.prototype.prompt;
    AgentSession.prototype.prompt = async function (...args: Parameters<AgentSession['prompt']>) {
      const before = this.agent.beforeToolCall;
      const after = this.agent.afterToolCall;
      this.agent.beforeToolCall = async (ctx, signal) => {
        if (scenario === 'before_tool') freeze();
        return before?.(ctx, signal);
      };
      this.agent.afterToolCall = async ctx => {
        const result = await after?.(ctx);
        if (['after_effect', 'approved_confirmation', 'docker_approved'].includes(scenario)) freeze();
        return result;
      };
      return originalPrompt.apply(this, args);
    };
    armed = true;
    const request = lab.start(session.id, initial);
    await writeFile(join(dir, 'meta.json'), JSON.stringify({ sessionId: session.id, workspaceId: session.workspaceId, requestId: request.requestId } satisfies Meta));
    let notified = false;
    const timer = docker && scenario === 'docker_after_effect' ? setInterval(() => {
      void readFile(join(lab.files.filesDirectory(session.workspaceId), 'effects.txt'), 'utf8').then(value => {
        if (value === 'effect\n' && !notified) { notified = true; process.send?.({ type: 'boundary' }); }
      }).catch(() => {});
    }, 50) : undefined;
    await request.run(event => {
      if (scenario === 'before_user' && event.type === 'resources.loaded') freeze();
      if (scenario === 'partial_text' && event.type === 'text.delta') freeze();
      if (scenario === 'compaction_saved' && event.type === 'context.compaction_completed') freeze();
      if (event.type !== 'interaction.updated' || event.interaction.status !== 'pending') return;
      const item = event.interaction;
      if (['waiting_question', 'waiting_confirmation', 'docker_waiting_confirmation'].includes(scenario)) freeze();
      if (['approved_confirmation', 'docker_approved'].includes(scenario)) lab.respondInteraction(session.id, item.interactionId,
        { requestId: request.requestId, kind: 'confirmation', decision: 'approve' });
    });
    clearInterval(timer); throw new Error(`Seed unexpectedly finished: ${JSON.stringify(lab.get(session.id).lastResult)}`);
  }
  const meta: Meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'));
  const before = await readFile(file);
  const app = await createApp(lab);
  try {
    for (let n = 0; n < 3; n++) {
      const response = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}`, headers: { host: '127.0.0.1' } });
      assert.equal(response.statusCode, 200);
    }
    assert.deepEqual(await readFile(file), before, 'Loading and GET must not modify native JSONL');
    assert.equal(fake.calls.length, 0);
    const loaded = lab.get(session.id);
    assert.equal(loaded.recoveryWarning, undefined, loaded.recoveryWarning);
    assert.equal(loaded.lastResult?.status, mode === 'verify' ? 'succeeded' : 'interrupted');
    if (mode === 'verify') { await writeFile(join(dir, 'verified.json'), JSON.stringify(loaded, null, 2)); return; }
    for (const item of loaded.interactions ?? []) {
      if (item.status === 'expired') assert.throws(() => lab.respondInteraction(session.id, item.interactionId,
        item.kind === 'question' ? { requestId: item.requestId, kind: 'question', action: 'skip' } : { requestId: item.requestId, kind: 'confirmation', decision: 'approve' }));
    }
    const events: StreamEvent[] = [];
    const seen = new Set<string>();
    const prompt = !live ? '继续' : scenario === 'waiting_question'
      ? '请重新通过 ask_user 询问报告使用 Markdown 还是纯文本，收到我的新答案后再回复选择结果。不要猜测上次问题的答案。'
      : scenario === 'docker_approved' || scenario === 'docker_waiting_confirmation'
        ? `请先用 read 读取 /workspace/${scenario === 'docker_approved' ? 'next-disposable.txt' : 'disposable.txt'}，再用 bash 执行 rm -- /workspace/${scenario === 'docker_approved' ? 'next-disposable.txt' : 'disposable.txt'}，由页面重新确认；拒绝后不改用其他方式删除。上次批准不用于本次调用。`
        : scenario === 'docker_after_effect'
          ? '先用 read 查看 /workspace/effects.txt，告诉我已写入几条 effect。保留该文件不重复追加。再用 write 新建 /workspace/recovered.md，内容为“已核对中断前效果，继续处理完成”。'
          : '请根据现有历史回答验收编号；不要重复执行上次操作。';
    const request = lab.start(session.id, prompt);
    assert.notEqual(request.requestId, meta.requestId);
    await request.run(event => {
      events.push(event);
      if (event.type !== 'interaction.updated' || event.interaction.status !== 'pending' || seen.has(event.interaction.interactionId)) return;
      const item = event.interaction; seen.add(item.interactionId);
      const response = item.kind === 'question' ? { requestId: item.requestId, kind: 'question', action: 'answer', answers: item.questions.map(q => ({ questionId: q.id, text: 'Markdown' })) }
        : { requestId: item.requestId, kind: 'confirmation', decision: 'reject' };
      lab.respondInteraction(session.id, item.interactionId, response);
    });
    const after = lab.get(session.id);
    assert.equal(after.lastResult?.status, 'succeeded', after.lastResult?.message);
    const saved = await readFile(file);
    assert.ok(saved.subarray(0, before.length).equals(before));
    assert.equal(after.messages.filter(m => m.role === 'user' && m.requestId === meta.requestId).length, ['before_user', 'compaction_call', 'compaction_saved'].includes(scenario) ? 0 : 1);
    await writeFile(join(dir, 'continuation.json'), JSON.stringify({ scenario, live, loaded, after, events, actualUsage: after.lastResult?.usageSummary }, null, 2));
    if (live && ['waiting_question', 'docker_approved', 'docker_waiting_confirmation'].includes(scenario)) assert.equal(seen.size, 1, 'Must create exactly one fresh interaction');
  } finally { await app.close(); }
}
async function main() {
  const docker = process.argv.includes('--docker'); const live = process.argv.includes('--live');
  const cases = docker ? [...dockerCases, 'waiting_question'] : localCases;
  const root = await mkdtemp(join(tmpdir(), 'axon-session-recovery-'));
  console.info(`Evidence: ${root}`);
  const results: unknown[] = [];
  for (const scenario of cases) {
    const dir = join(root, scenario); await mkdir(dir);
    async function run(mode: string) {
      const child = spawn(process.execPath, ['--import', 'tsx', script, '--child', scenario, mode, dir, ...(live ? ['--live'] : [])], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      let output = ''; child.stdout!.on('data', bytes => { output += bytes; }); child.stderr!.on('data', bytes => { output += bytes; });
      let killedAtBoundary = false;
      child.on('message', (message: { type: string }) => { if (mode === 'seed' && message.type === 'boundary') { killedAtBoundary = true; child.kill('SIGKILL'); } });
      const boundaryPoll = mode === 'seed' ? setInterval(() => { void access(join(dir, 'boundary.ready')).then(() => { if (!killedAtBoundary) { killedAtBoundary = true; child.kill('SIGKILL'); } }).catch(() => {}); }, 50) : undefined;
      const timer = setTimeout(() => child.kill('SIGKILL'), live ? 180_000 : 45_000);
      try {
        await new Promise<void>((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', (code, signal) => {
            if (mode === 'seed' ? killedAtBoundary && signal === 'SIGKILL' : code === 0) resolve();
            else reject(new Error(`${scenario}/${mode}: ${code}/${signal}\n${output}`));
          });
        });
      } finally { clearTimeout(timer); clearInterval(boundaryPoll); }
    }
    await run('seed');
    const file = await history(dir); const original = await readFile(file);
    await writeFile(join(dir, 'original.jsonl'), original);
    const seedMeta: Meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'));
    if (['before_tool', 'after_effect', 'after_result'].includes(scenario)) {
      assert.equal(await readFile(join(dir, 'workspaces', seedMeta.workspaceId, 'AGENTS.md'), 'utf8'), scenario === 'before_tool' ? '' : '报告使用中文。', 'Must verify actual instruction effect, not just a missing receipt');
    }
    await run('recover'); await run('verify');
    const meta: Meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'));
    if (scenario === 'docker_after_effect') {
      assert.equal(await readFile(join(dir, 'workspaces', meta.workspaceId, 'files', 'effects.txt'), 'utf8'), 'effect\n');
      if (live) assert.match(await readFile(join(dir, 'workspaces', meta.workspaceId, 'files', 'recovered.md'), 'utf8'), /继续处理完成/);
    }
    if (scenario === 'docker_approved') {
      await assert.rejects(access(join(dir, 'workspaces', meta.workspaceId, 'files', 'disposable.txt')));
      assert.equal(await readFile(join(dir, 'workspaces', meta.workspaceId, 'files', 'next-disposable.txt'), 'utf8'), 'fresh confirmation fixture');
    }
    if (scenario === 'docker_waiting_confirmation') assert.equal(await readFile(join(dir, 'workspaces', meta.workspaceId, 'files', 'disposable.txt'), 'utf8'), 'disposable fixture');
    if (['before_tool', 'after_effect', 'after_result'].includes(scenario)) assert.equal(await readFile(join(dir, 'workspaces', meta.workspaceId, 'AGENTS.md'), 'utf8'), scenario === 'before_tool' ? '' : '报告使用中文。');
    const result = { scenario, passed: true, crash: 'SIGKILL', liveContinuation: live, nativeHistoryUnchangedOnLoad: true, originalBytes: original.length };
    results.push(result); console.info(JSON.stringify(result));
  }
  await writeFile(join(root, 'results.json'), JSON.stringify({ pi: '0.85.1', seedModel: 'deterministic transport with real Axon/Pi', results }, null, 2));
  console.info(`PASS ${results.length} Axon crash scenarios; ${root}`);
}
if (process.argv[2] === '--child') await child(process.argv[3], process.argv[4], process.argv[5], process.argv.includes('--live'));
else await main();
