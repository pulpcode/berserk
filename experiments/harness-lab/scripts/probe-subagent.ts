import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PiLab } from '../src/pi/lab.js';
import { loadConfig } from '../src/server/config.js';
import { createApp } from '../src/server/app.js';
import type { SessionSnapshot, StreamEvent } from '../src/contracts/index.js';

const config = loadConfig({...process.env,LAB_AUTH_MODE:'test'});
assert.ok(config.apiKey, '请先配置 LLM_API_KEY；未发送模型请求。');
const resume = process.argv.indexOf('--resume');
const browserMode = process.argv.indexOf('--browser');
const stopMode = process.argv.indexOf('--stop');
const existing = Math.max(resume, browserMode, stopMode);
config.dataDir = existing >= 0 ? process.argv[existing + 1] : await mkdtemp(join(tmpdir(), 'berserk-subagent-live-'));
if (browserMode >= 0) {
  const socket = createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address(); assert.ok(address && typeof address !== 'string'); config.port = address.port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
}
// Explicit probe deadline only. Product defaults remain unlimited whole-request duration.
config.agentRunTimeoutMs = 300_000;
const lab = await PiLab.create(config);
const evidence: Array<{ label: string; input: string; snapshot: SessionSnapshot; events: StreamEvent[] }> = [];
let failure: string | undefined;
const answer = (snapshot: SessionSnapshot) => snapshot.messages.filter(message => message.role === 'assistant').at(-1)?.text ?? '';
async function ask(sessionId: string, input: string, label: string, cancelChild = false) {
  const events: StreamEvent[] = [];
  const request = lab.start(sessionId, input);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await request.run(event => {
      events.push(event);
      if (cancelChild && !timer && event.type === 'subagent.updated' && event.subagent.phase === 'generating' && event.subagent.status === 'running') {
        timer = setTimeout(() => { stopped = true; lab.cancel(sessionId, request.requestId); }, 500);
      }
    });
  } finally { clearTimeout(timer); }
  const snapshot = lab.get(sessionId);
  evidence.push({ label, input, snapshot, events });
  console.info(`${label}: ${snapshot.lastResult?.status}; 子任务 ${snapshot.subagents?.filter(child => child.parentRequestId === request.requestId).length ?? 0}`);
  assert.equal(snapshot.lastResult?.status, cancelChild ? 'cancelled' : 'succeeded', snapshot.lastResult?.message);
  if (cancelChild) assert.ok(stopped, '必须实际进入子模型执行后停止，才能记为通过。');
  return snapshot;
}
async function verifyStop() {
    const stopping = await lab.createSession();
    const stopped = await ask(stopping.id,
      '请立即调用 subagent，agent 为 analyst，task 为：实际读取 meeting-notes 和 resource-brief，提取培训目标、人数、时长、形式、预算、约束及待确认事项，列明来源。目标是形成培训方案前的资料核对，不需澄清，也没有字数要求。取得子任务结果后再综合。', '真实子模型执行中停止', true);
    assert.ok(stopped.subagents?.some(child => child.status === 'cancelled'));
    assert.ok(stopped.subagents?.every(child => !['running', 'stopping'].includes(child.status)));
    await ask(stopping.id, '不继续上一项分析，不委派子任务。请只回复“可以继续”。', '停止后正常续聊');

}
try {
  if (stopMode >= 0) {
    await verifyStop();
  } else if (browserMode >= 0) {
    const { chromium, expect } = await import('@playwright/test');
    const snapshot = lab.get(process.argv[browserMode + 2]);
    assert.ok(snapshot.subagents?.length);
    const app = await createApp(lab, true);
    await app.listen({ port: config.port, host: '127.0.0.1' });
    const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || (existsSync('/Applications/Google Chrome.app') ? 'chrome' : undefined) });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
      let posts = 0;
      page.on('request', request => { if (request.method() === 'POST') posts++; });
      await page.goto(`http://127.0.0.1:${config.port}`);
      await page.getByRole('button', { name: snapshot.title, exact: true }).click();
      await expect(page.locator('.subagent-card')).toHaveCount(snapshot.subagents.length);
      for (const child of snapshot.subagents) {
        const card = page.locator(`[data-subagent-id="${child.subagentId}"]`);
        await expect(card.locator('summary')).toHaveAttribute('aria-label', `${child.role} 子任务：已完成`);
      }
      const first = page.locator('.subagent-card').first();
      await first.locator('summary').focus(); await page.keyboard.press('Enter');
      await expect(first.locator('.subagent-result')).toBeVisible();
      await expect(first.locator('.subagent-task')).toHaveText(snapshot.subagents[0].task);
      await page.screenshot({ path: join(config.dataDir, 'subagents-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 375, height: 812 });
      await first.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: join(config.dataDir, 'subagents-mobile.png'), fullPage: true });
      await page.reload();
      await expect(page.locator('.subagent-card')).toHaveCount(snapshot.subagents.length);
      assert.equal(posts, 0, '查看和刷新子任务不得启动模型或重复委派');
      evidence.push({ label: '真实历史网页展示、键盘、375px及刷新', input: '', snapshot, events: [] });
      console.info('真实父子历史网页展示通过，查看／刷新没有 POST。');
    } finally { await browser.close(); await app.close(); }
  } else if (resume >= 0) {
    const sessionId = process.argv[resume + 2];
    const expected = JSON.parse(await readFile(join(config.dataDir, 'expected-subagents.json'), 'utf8'));
    const snapshot = lab.get(sessionId);
    assert.equal(snapshot.recoveryWarning, undefined);
    assert.deepEqual(snapshot.subagents, expected);
    assert.equal(lab.list().some(session => expected.some((child: { subagentId: string }) => child.subagentId === session.id)), false);
    console.info('独立进程重新加载父子记录通过；没有重发模型请求。');
  } else {
    const session = await lab.createSession();
    const first = await ask(session.id,
      '请委派一名适合资料分析的子 Agent，实际读取 meeting-notes 和 resource-brief，提取培训人数、时长、形式、预算和待确认事项。子任务完成后由你综合成简短表格，保留来源标识。', '资料分析角色选择与综合');
    const analyst = first.subagents?.find(child => child.parentRequestId === first.lastResult?.requestId && child.role === 'analyst');
    assert.equal(analyst?.status, 'succeeded');
    assert.match(answer(first), /12|十二/); assert.match(answer(first), /90|九十/); assert.match(answer(first), /800|八百/);
    assert.ok(evidence.at(-1)?.events.some(event => event.type === 'subagent.updated' && event.subagent.toolName === 'source.read'), '需观测真实子工具调用');

    const second = await ask(session.id,
      '请委派适合内容检查的子 Agent，根据 meeting-notes 和 resource-brief 核对草稿：“培训20人，60分钟，线下举行，预算1200元用于采购软件，所有事项已经确定。”需要真正读取资料；返回问题和依据。你据此给出修订后的简短版本。', '内容检查角色选择与修订');
    const reviewer = second.subagents?.find(child => child.parentRequestId === second.lastResult?.requestId && child.role === 'reviewer');
    assert.equal(reviewer?.status, 'succeeded');
    assert.match(answer(second), /12|十二/); assert.match(answer(second), /90|九十/); assert.match(answer(second), /800|八百/);
    assert.match(answer(second), /线上/);
    assert.ok((second.lastResult?.subagentUsage?.modelAttempts ?? 0) > 0);
    assert.ok((second.lastResult?.usageSummary?.modelAttempts ?? 0) > 0);

    const third = await ask(session.id,
      '请在本轮依次做两次委派：先由 analyst 实际读取 meeting-notes 并提取三项关键事实；再由 reviewer 根据这些返回事实检查“活动90分钟，12名新成员，线上举行”是否与原资料一致。不要省略其中任何一次委派，最后简短综合两份结果。', 'single 先后选择不同角色');
    const children = third.subagents?.filter(child => child.parentRequestId === third.lastResult?.requestId) ?? [];
    assert.ok(children.some(child => child.role === 'analyst' && child.status === 'succeeded'));
    assert.ok(children.some(child => child.role === 'reviewer' && child.status === 'succeeded'));
    assert.equal(new Set(children.map(child => child.subagentId)).size, children.length);
    await writeFile(join(config.dataDir, 'expected-subagents.json'), JSON.stringify(third.subagents, null, 2), { mode: 0o600 });

    await verifyStop();

    await lab.close();
    const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), '--resume', config.dataDir, session.id], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += String(chunk); }); child.stderr.on('data', chunk => { output += String(chunk); });
    const exitCode = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    assert.equal(exitCode, 0, `独立进程加载失败：${output.slice(-1500)}`);
    console.info(output.trim());
  }
} catch (error) {
  failure = error instanceof Error ? error.message : '真实验收失败';
  process.exitCode = 1;
} finally {
  await lab.close();
  const filename = browserMode >= 0 ? 'browser-evidence.json' : resume >= 0 ? 'resume-evidence.json' : stopMode >= 0 ? 'stop-evidence.json' : 'evidence.json';
  await writeFile(join(config.dataDir, filename), JSON.stringify({ date: new Date().toISOString(), provider: config.provider,
    model: config.model, pi: '0.85.1', failure, evidence }, null, 2), { mode: 0o600 });
  if (failure) console.error(failure);
  console.info(`证据：${join(config.dataDir, filename)}`);
}
