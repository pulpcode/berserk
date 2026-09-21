import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { createApp } from '../src/server/app.js';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PiLab } from '../src/pi/lab.js';
import { readNativeCompactionEvidence } from '../src/pi/validation.js';
import { loadConfig } from '../src/server/config.js';
import type { RequestResourcesRecord, SessionSnapshot, StreamEvent } from '../src/contracts/index.js';

const config = loadConfig({...process.env,LAB_AUTH_MODE:'test'});
assert.ok(config.apiKey, '请先配置 LLM_API_KEY；未发送任何模型请求。');
assert.ok(config.contextWindow && config.maxOutputTokens, '真实模型容量和输出能力必须已知。');
const resume = process.argv.indexOf('--resume');
const browserMode = process.argv.indexOf('--browser');
const existing = Math.max(resume, browserMode);
config.dataDir = existing >= 0 ? process.argv[existing + 1] : await mkdtemp(join(tmpdir(), 'berserk-compaction-live-'));
// Probe safety deadline only; never persist this as the product default.
config.agentRunTimeoutMs = 300_000;
if (browserMode >= 0) {
  const socket = createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address(); assert.ok(address && typeof address !== 'string');
  config.port = address.port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
}
const lab = await PiLab.create(config);
const evidence: Array<{ label: string; input: string; snapshot: SessionSnapshot; events: StreamEvent[]; resources: RequestResourcesRecord }> = [];
const answer = (snapshot: SessionSnapshot) => snapshot.messages.filter(message => message.role === 'assistant').at(-1)?.text ?? '';
let failure: string | undefined;
async function ask(sessionId: string, input: string, label: string, stopDuringCompaction = false) {
  const events: StreamEvent[] = [];
  const request = lab.start(sessionId, input);
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  try {
    await request.run(event => {
      events.push(event);
      if (stopDuringCompaction && !stopTimer && event.type === 'context.compaction_started') {
        stopTimer = setTimeout(() => { cancelled = true; lab.cancel(sessionId, request.requestId); }, 500);
      }
    });
  } finally { clearTimeout(stopTimer); }
  const snapshot = lab.get(sessionId);
  evidence.push({ label, input, snapshot, events, resources: lab.getRequestResources(sessionId, request.requestId) });
  console.info(`${label}: ${snapshot.lastResult?.status}; 摘要 ${snapshot.lastResult?.compactionIds?.length ?? 0}; 模型尝试 ${snapshot.lastResult?.usageSummary?.modelAttempts ?? '未知'}`);
  assert.equal(snapshot.lastResult?.status, stopDuringCompaction ? 'cancelled' : 'succeeded', snapshot.lastResult?.message);
  if (stopDuringCompaction) assert.ok(cancelled, '没有在真实压缩阶段取消，不能记为通过。');
  return snapshot;
}
async function threshold(tokens: number, keep = 700) {
  const current = lab.modelSettings();
  await lab.updateModelSettings({ provider: current.provider, model: current.model, baseUrl: current.baseUrl,
    expectedVersion: current.version, compactionReserveTokens: current.contextWindow! - tokens, compactionKeepRecentTokens: keep });
}
const background = (round: number) => Array.from({ length: 95 }, (_, index) =>
  `历史参考${round}-${index + 1}：资料归档记录仅作背景，会议安排仍按最新确认目标执行，不形成新的执行任务；此处无需逐条回复。`).join('\n');
async function fillUntilCompaction(sessionId: string, oldId: string | undefined, label: string) {
  for (let round = 0; round < 6; round++) {
    const result = await ask(sessionId, `以下是可概括的背景资料。仍需保留最新项目要求和未完成交付物；请只回复“收到”。\n${background(round)}`, `${label}-${round + 1}`);
    if (result.latestCompaction && result.latestCompaction.id !== oldId) return result;
  }
  throw new Error('真实背景输入未触发自动压缩，不能把此项记为通过。');
}
try {
  if (browserMode >= 0) {
    const sessionId = process.argv[browserMode + 2];
    const before = lab.get(sessionId);
    const detail = lab.getCompaction(sessionId, before.latestCompaction!.id);
    const app = await createApp(lab, true);
    await app.listen({ port: config.port, host: '127.0.0.1' });
    const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || (existsSync('/Applications/Google Chrome.app') ? 'chrome' : undefined) });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
      let posts = 0;
      page.on('request', request => { if (request.method() === 'POST') posts++; });
      await page.goto(`http://127.0.0.1:${config.port}`);
      await page.getByRole('button', { name: before.title, exact: true }).click();
      await page.getByRole('button', { name: '查看最近压缩摘要' }).click();
      await expect(page.getByLabel('压缩摘要正文（只读）')).toHaveText(detail.summary);
      await page.screenshot({ path: join(config.dataDir, 'compaction-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 375, height: 812 });
      await page.screenshot({ path: join(config.dataDir, 'compaction-mobile.png'), fullPage: true });
      assert.equal(posts, 0, '查看摘要不能启动模型或工具操作');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.keyboard.press('Escape');
      const input = '仅按最新记录简短列出项目代号、人数、时长、交付地点和未完成交付物。';
      await page.getByRole('textbox', { name: '发送消息' }).fill(input);
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      await expect.poll(() => lab.get(sessionId).lastResult?.requestId, { timeout: 300000 }).not.toBe(before.lastResult?.requestId);
      await expect.poll(() => lab.get(sessionId).lastResult?.status, { timeout: 300000 }).toBe('succeeded');
      const snapshot = lab.get(sessionId);
      assert.match(answer(snapshot), /青松/); assert.match(answer(snapshot), /37|三十七/); assert.match(answer(snapshot), /45|四十五/);
      assert.match(answer(snapshot), /海棠厅/); assert.match(answer(snapshot), /检查清单/);
      assert.doesNotMatch(answer(snapshot), /验收[甲乙]/);
      assert.equal(posts, 1);
      evidence.push({ label: '真实网页续聊与只读摘要', input, snapshot, events: [], resources: lab.getRequestResources(sessionId, snapshot.lastResult!.requestId) });
      await page.screenshot({ path: join(config.dataDir, 'continued-mobile.png'), fullPage: true });
      console.info('真实网页摘要详情、375px布局与一次发送续聊通过。');
    } finally { await browser.close(); await app.close(); }
  } else if (resume >= 0) {
    const sessionId = process.argv[resume + 2];
    const before = lab.get(sessionId);
    assert.ok(before.latestCompaction, '独立进程没有恢复摘要');
    assert.equal(before.recoveryWarning, undefined);
    const result = await ask(sessionId, '请根据当前记录，简短列出项目代号、最新人数、最新时长、尚待完成的交付物和交付地点。', '独立进程恢复');
    assert.match(answer(result), /青松/); assert.match(answer(result), /37|三十七/); assert.match(answer(result), /45|四十五/);
    assert.match(answer(result), /海棠厅/); assert.match(answer(result), /检查清单/);
  } else {
    const session = await lab.createSession();
    const instruction = await lab.resources.readInstruction(session.workspaceId, 'workspace');
    await lab.resources.updateInstruction(session.workspaceId, 'workspace', '每次正常回答末尾单独写【验收甲】。', instruction.hash);
    const sourcePath = join(lab.workspaces.directory(session.workspaceId), 'sources', 'meeting-notes.md');
    await writeFile(sourcePath, `${await readFile(sourcePath, 'utf8')}\n${'附录：仅作背景，不改变最新用户要求。\n'.repeat(130)}`);
    await ask(session.id, '我们准备青松培训项目，人数原定20人，时长原定60分钟。待完成的交付物是一份执行检查清单，暂时不要生成。请简短确认。', '建立目标');
    await ask(session.id, '确认变更：最新人数37人，最新时长45分钟；以后仅以这两个最新数字为准，其他目标不变。请简短确认。', '两项纠正');
    await ask(session.id, '请实际读取 meeting-notes，记录其资料标识与原始培训时长；该资料的原始时长不覆盖刚确认的45分钟。只简短确认，检查清单仍待生成。', '真实工具读取');
    const original = lab.get(session.id).messages;
    assert.match(answer(lab.get(session.id)), /验收甲/);
    assert.ok(original.some(message => message.role === 'tool' && message.text.length > 2000), '需要真实长工具结果用于原文保留核对');
    await threshold(7000);
    const first = await fillUntilCompaction(session.id, undefined, '首次压缩');
    const firstDetail = lab.getCompaction(session.id, first.latestCompaction!.id);
    assert.match(firstDetail.summary, /青松/); assert.match(firstDetail.summary, /37|三十七/); assert.match(firstDetail.summary, /45|四十五/);
    const continued = await ask(session.id, '不要生成检查清单。只说当前项目代号、人数、时长、待交付内容。', '首次压缩后续作');
    assert.match(answer(continued), /青松/); assert.match(answer(continued), /37|三十七/); assert.match(answer(continued), /45|四十五/);
    assert.match(answer(continued), /检查清单/);
    await threshold(900_000);
    await ask(session.id, '补充仅限本会话的事实：交付地点为海棠厅。不要修改任何指令文件，只简短确认；检查清单仍待生成。', '新增保留事实');
    await threshold(7000);
    const second = await fillUntilCompaction(session.id, lab.get(session.id).latestCompaction?.id, '再次压缩');
    const secondDetail = lab.getCompaction(session.id, second.latestCompaction!.id);
    assert.match(secondDetail.summary, /海棠厅/);
    for (const message of original) assert.deepEqual(second.messages.find(item => item.id === message.id), message, '压缩不得改写原始消息');
    await threshold(900_000);
    const currentInstruction = await lab.resources.readInstruction(session.workspaceId, 'workspace');
    await lab.resources.updateInstruction(session.workspaceId, 'workspace', '每次正常回答末尾单独写【验收乙】。', currentInstruction.hash);
    const updated = await ask(session.id, '仅简短确认最新人数和时长。', '压缩后更换当前指令');
    assert.match(answer(updated), /验收乙/); assert.doesNotMatch(answer(updated), /验收甲/);
    const updatedInstruction = await lab.resources.readInstruction(session.workspaceId, 'workspace');
    await lab.resources.updateInstruction(session.workspaceId, 'workspace', '', updatedInstruction.hash);
    const deleted = await ask(session.id, '请自然简短回答当前人数与时长。', '压缩后删除指令');
    assert.doesNotMatch(answer(deleted), /验收[甲乙]/);
    await writeFile(join(config.dataDir, 'native-evidence.json'), JSON.stringify(await readNativeCompactionEvidence(config.dataDir, session.id), null, 2), { mode: 0o600 });
    // Finish a separate conversation under a generous threshold, then lower R/K's trigger for the next request.
    await threshold(900_000);
    const stopSession = await lab.createSession();
    await ask(stopSession.id, `停止测试，仅回复收到。\n${background(9)}`, '停止测试准备');
    await ask(stopSession.id, `再补充一轮历史，仅回复收到。\n${background(10)}`, '停止测试准备第二轮');
    await threshold(2000, 300);
    await ask(stopSession.id, '继续简短确认。', '真实摘要中停止', true);
    const stopped = lab.get(stopSession.id);
    assert.ok((stopped.lastResult?.usageSummary?.compactionAttempts ?? 0) > 0);
    await threshold(900_000);
    await ask(stopSession.id, '停止之前工作，只回复可以继续。', '停止后续聊');
    await lab.close();
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--resume', config.dataDir, session.id], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let childOutput = '';
    child.stdout.on('data', chunk => { childOutput += String(chunk); process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { childOutput += String(chunk); });
    const exitCode = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    assert.equal(exitCode, 0, `独立进程恢复失败：${childOutput.slice(-3000)}`);
    const childEvidence = JSON.parse(await readFile(join(config.dataDir, 'restart-evidence.json'), 'utf8')) as { failure?: string };
    assert.equal(childEvidence.failure, undefined);
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  const settings = lab.modelSettings();
  await lab.close();
  const output = join(config.dataDir, browserMode >= 0 ? 'browser-evidence.json' : resume >= 0 ? 'restart-evidence.json' : 'evidence.json');
  await writeFile(output, JSON.stringify({ date: new Date().toISOString(), pi: '0.85.1', settings,
    probeRunTimeoutMs: config.agentRunTimeoutMs, failure, evidence }, null, 2), { mode: 0o600 });
  console.info(`证据：${output}`);
}
