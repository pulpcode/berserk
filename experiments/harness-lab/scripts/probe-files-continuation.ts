/** Real Pi/provider/container continuation and stop checks. Run only after probe:execution passes. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PiLab } from '../src/pi/lab.js';
import { loadConfig } from '../src/server/config.js';
import { runDocker } from '../src/execution/docker.js';
import type { FileOutput, SessionSnapshot, StreamEvent } from '../src/contracts/index.js';

const config = loadConfig({...process.env,LAB_AUTH_MODE:'test'});
assert.ok(config.apiKey, '需要已配置的模型 API；未发送请求。');
assert.ok(config.execution?.enabled, '需要启用真实执行环境，并先完成 Docker P0。');
assert.ok(config.contextWindow && config.maxOutputTokens, '需要真实模型容量与输出配置。');
config.dataDir = await mkdtemp(join(tmpdir(), 'berserk-files-continuation-'));
// A diagnostic deadline, not a product default or a model capacity override.
config.agentRunTimeoutMs = 600_000;
const lab = await PiLab.create(config);
const evidence: Array<{label: string; input: string; snapshot: SessionSnapshot; events: StreamEvent[]}> = [];
const checks: string[] = [];
let failure: string | undefined;
let stopEvidence: {requestId: string; ready: unknown; before: string[]; after: string[]; remainingContainers: string} | undefined;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function ask(sessionId: string, input: string, label: string, uploadIds: string[] = []) {
  const events: StreamEvent[] = [];
  const request = lab.start(sessionId, input, {uploadIds});
  await request.run(event => events.push(event));
  const snapshot = lab.get(sessionId);
  evidence.push({label, input, snapshot, events});
  console.info(`${label}: ${snapshot.lastResult?.status}; 压缩 ${snapshot.lastResult?.compactionIds?.length ?? 0}`);
  assert.equal(snapshot.lastResult?.status, 'succeeded', snapshot.lastResult?.message);
  assert.equal(snapshot.recoveryWarning, undefined);
  return snapshot;
}
async function upload(workspaceId: string, name: string, text: string) {
  const bytes = Buffer.from(text);
  const record = await lab.files.createUpload(workspaceId, {name, size: bytes.length});
  return lab.files.receiveUpload(workspaceId, record.uploadId, (async function* () { yield bytes; })());
}
async function fixedDownload(file: FileOutput) {
  const content = await lab.files.openDownload(file.workspaceId, file.downloadId);
  const chunks: Buffer[] = [];
  for await (const chunk of content.stream) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks); assert.equal(hash(bytes), file.hash);
  return bytes;
}
async function setCompaction(reserve: number, keep: number) {
  const current = lab.modelSettings();
  await lab.updateModelSettings({provider: current.provider, model: current.model, baseUrl: current.baseUrl,
    expectedVersion: current.version, compactionReserveTokens: reserve, compactionKeepRecentTokens: keep});
  assert.equal(lab.modelSettings().contextWindow, config.contextWindow, '不能伪造模型容量触发压缩。');
  assert.equal(lab.modelSettings().maxOutputTokens, config.maxOutputTokens);
}
const background = (round: number) => Array.from({length: 95}, (_, index) =>
  `背景记录${round}-${index + 1}：日常资料归档与讨论仅供参考，不增加工作，也不改变已确认的 CSV 处理目标、文件名称及金额；本条无需逐项回复。`).join('\n');

async function verifyStoppedProcess() {
  const session = await lab.createSession();
  const root = lab.files.filesDirectory(session.workspaceId);
  // Test-owned input script. A real model must choose bash and actually execute it.
  const childCode = `from pathlib import Path\nimport time\nwhile True:\n    with Path('child-ticks.log').open('a') as f:\n        f.write('tick\\n'); f.flush()\n    time.sleep(0.1)\n`;
  const script = `from pathlib import Path\nimport subprocess, sys, time, json, os\nchild = subprocess.Popen([sys.executable, '-u', '-c', ${JSON.stringify(childCode)}], start_new_session=True)\nPath('cancel-ready.json').write_text(json.dumps({'parent': os.getpid(), 'child': child.pid}))\nprint('cancel probe ready', flush=True)\nwhile True:\n    with Path('parent-ticks.log').open('a') as f:\n        f.write('tick\\n'); f.flush()\n    time.sleep(0.1)\n`;
  const uploaded = await upload(session.workspaceId, 'cancel_probe.py', script);
  const input = '这是独立测试目录中的停止验收。请立即通过 bash 执行 python -u /workspace/cancel_probe.py，保持前台运行；不要修改脚本、不要主动结束程序、不要转后台，我会通过停止按钮取消本次请求。脚本会产生一个仅写本目录测试日志的子进程，这正是本次停止测试的目标。无需追问。';
  const events: StreamEvent[] = [];
  const request = lab.start(session.id, input, {uploadIds: [uploaded.uploadId]});
  let settled = false; let observedBash = false; let stopped = false;
  const run = request.run(event => { events.push(event); if (event.type === 'tool.started' && event.toolName === 'bash') observedBash = true; }).finally(() => { settled = true; });
  // Observe persistence produced by the real process, not merely a tool-start event.
  let ready: unknown;
  try {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline && !settled) {
      if (observedBash) {
        try {
          ready = JSON.parse(await readFile(join(root, 'cancel-ready.json'), 'utf8'));
          const ticks = await Promise.all(['parent-ticks.log', 'child-ticks.log'].map(path => readFile(join(root, path), 'utf8')));
          if (ticks.every(text => text.split('\n').length >= 4)) break;
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      }
      ready = undefined;
      await delay(100);
    }
    assert.ok(ready && observedBash && !settled, '没有观测实际父子进程写入，不能将停止项记为通过。');
    lab.cancel(session.id, request.requestId); stopped = true;
    await run;
    const snapshot = lab.get(session.id);
    evidence.push({label: '真实长命令与子进程停止', input, snapshot, events});
    assert.equal(snapshot.lastResult?.status, 'cancelled', snapshot.lastResult?.message);
    assert.equal(snapshot.active, null); assert.equal(snapshot.recoveryWarning, undefined);
    const paths = ['parent-ticks.log', 'child-ticks.log'];
    const before = await Promise.all(paths.map(async path => hash(await readFile(join(root, path)))));
    await delay(1500);
    const after = await Promise.all(paths.map(async path => hash(await readFile(join(root, path)))));
    assert.deepEqual(after, before, '停止返回后父进程或脱离进程组的子进程仍在写入。');
    const containers = await runDocker(['ps', '-aq', '--filter', `label=io.berserk.harness.request=${request.requestId}`], {timeoutMs: 15_000});
    assert.equal(containers.code, 0); assert.equal(containers.stdout.toString().trim(), '', '请求容器没有清理。');
    stopEvidence = {requestId: request.requestId, ready, before, after, remainingContainers: containers.stdout.toString().trim()};
    checks.push('真实模型调用长命令，父请求停止后父／子进程无继续写入且专属容器已销毁');
    const continued = await ask(session.id, '停止测试已经结束，不要重新执行 cancel_probe.py。请用 read 读取 cancel-ready.json，仅确认记录中的两个进程号；不要执行 bash。', '停止后读取保留文件');
    assert.ok(evidence.at(-1)!.events.some(event => event.type === 'tool.started' && event.toolName === 'read'));
    assert.equal(continued.lastResult?.status, 'succeeded');
    assert.deepEqual(await Promise.all(paths.map(async path => hash(await readFile(join(root, path))))), before, '继续对话不应重放旧脚本。');
    checks.push('停止后可继续读取已保存文件，不自动重放旧命令');
  } finally {
    if (!settled && !stopped) lab.cancel(session.id, request.requestId);
    await run;
  }
}
try {
  assert.equal(lab.info().files?.executionAvailable, true, '真实 Docker 或文件镜像不可用；不执行模型验收。');
  const session = await lab.createSession();
  const input = await upload(session.workspaceId, 'ledger.csv', '编号,金额\n甲,10\n乙,20\n丙,30\n');
  const initial = await ask(session.id,
    '我们正在完成“青松文件续作”任务。请实际读取 ledger.csv，编写并运行 calc.py，生成 total.json（唯一键 total，值为金额合计数值）和 report.md（中文说明合计）。调用 file_output 交付 report.md。保留 CSV、脚本、中间 JSON 与报告；后续我还会要求修改乙的金额。不要修改 AGENTS.md。',
    '建立真实文件任务', [input.uploadId]);
  const root = lab.files.filesDirectory(session.workspaceId);
  assert.equal(JSON.parse(await readFile(join(root, 'total.json'), 'utf8')).total, 60);
  const original = initial.fileOutputs?.find(file => file.requestId === initial.lastResult?.requestId && file.path === 'report.md');
  assert.ok(original, '没有真实报告交付记录。');
  const originalBytes = await fixedDownload(original);
  const initialMessages = initial.messages;
  const ordinaryHashes = Object.fromEntries(await Promise.all(['ledger.csv', 'calc.py', 'total.json', 'report.md'].map(async path => [path, hash(await readFile(join(root, path)))])));
  const originalSettings = lab.modelSettings();
  // Only native retention/reserve settings change in this isolated probe; capacity and summary prompt remain real/default.
  await setCompaction(config.contextWindow! - 7000, 700);
  let compacted: SessionSnapshot | undefined;
  for (let round = 0; round < 6; round++) {
    const result = await ask(session.id, `保留青松文件续作的任务目标和文件路径。以下仅是可压缩的背景，不执行文件操作，不委派任务；请只回复“收到”。\n${background(round)}`, `原生自动压缩准备 ${round + 1}`);
    if (result.latestCompaction && result.latestCompaction.id !== initial.latestCompaction?.id) { compacted = result; break; }
  }
  assert.ok(compacted?.latestCompaction, '真实上下文未触发原生自动压缩，不能记为通过。');
  assert.ok(lab.getCompaction(session.id, compacted.latestCompaction.id).summary.trim());
  for (const message of initialMessages) assert.deepEqual(compacted.messages.find(item => item.id === message.id), message, '压缩不得改写原始历史。');
  for (const [path, expected] of Object.entries(ordinaryHashes)) assert.equal(hash(await readFile(join(root, path))), expected, '压缩本身不能改动普通文件。');
  await setCompaction(originalSettings.compactionReserveTokens!, originalSettings.compactionKeepRecentTokens!);
  const continued = await ask(session.id,
    '继续之前的青松文件续作任务：请把乙的金额从20改为25，重新执行之前的计算脚本，更新 JSON 和中文报告，再交付更新后的报告文件。保留其他项目与中间文件，不要只在回复中改数字。', '压缩后依据任务记录继续修改文件');
  assert.equal(JSON.parse(await readFile(join(root, 'total.json'), 'utf8')).total, 65);
  assert.ok(evidence.at(-1)!.events.some(event => event.type === 'tool.started' && event.toolName === 'bash'));
  assert.ok(continued.fileOutputs?.some(file => file.requestId === continued.lastResult?.requestId && file.path === 'report.md'));
  assert.deepEqual(await fixedDownload(original), originalBytes);
  checks.push('默认 Pi 自动压缩后真实读取／修改／执行继续工作，原始历史与磁盘文件保留，旧下载字节不变');
  await verifyStoppedProcess();
} catch (error) {
  failure = error instanceof Error ? error.message : '文件续作／停止验收失败';
  process.exitCode = 1;
} finally {
  try { await lab.close(); } catch { failure ||= '执行环境最终清理失败，请核对本次验收容器。'; process.exitCode = 1; }
  const path = join(config.dataDir, 'files-continuation-evidence.json');
  await writeFile(path, JSON.stringify({date: new Date().toISOString(), provider: config.provider, model: config.model, pi: '0.85.1', image: config.execution?.image,
    modelContextWindow: config.contextWindow, maxOutputTokens: config.maxOutputTokens, probeRunTimeoutMs: config.agentRunTimeoutMs,
    passed: !failure, failure, checks, stopEvidence, evidence}, null, 2), {mode: 0o600});
  if (failure) console.error(failure);
  console.info(`续作与停止验收证据：${path}`);
}
