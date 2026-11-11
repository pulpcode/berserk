import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import { BackgroundStore } from '../../src/background/store';
import { parseBackgroundConfig } from '../../src/background/config';
import type { WorkPrepareInput } from '../../src/contracts/collaboration';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';

/** Actual authentication, collaboration, fixed files and analysis reads; no model is called by viewing. */
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'axon-task-overview-'));
  const db = await openDatabase(dir), access = new AccessStore(db);
  for (const seat of ['overall', 'planning', 'observer', 'ordinary']) await access.saveAccount({ username: seat, displayName: seat, seatId: seat, seatName: ({ overall: '总体席', planning: '筹划席', observer: '观察席', ordinary: '普通席' })[seat]!, password: 'task-home-test-password', createPublicTask: seat === 'overall', manageModelSettings: seat === 'overall', viewWorkOverview: ['overall', 'observer'].includes(seat) });
  const actor = access.identityForSeat('overall')!;
  const task = access.create(actor, { title: '临港三号仓库火情', goal: '组织支援并持续核对道路与车辆状态。\n\n背景说明保留原文。', visibility: 'public', clientActionId: randomUUID() });
  db.close();
  const config = testConfig(dir, { seatId: 'overall', auth: { secret: 'task-home-browser-signing-secret-long-enough', sessionMs: 28800000 } });
  const fake = await fakeRuntime(config, () => ({ text: '单条来报分析：桥梁封闭，需要核实绕行条件。' }));
  const lab = await PiLab.create(config, fake.runtime);
  const background = parseBackgroundConfig({ enabled: true, sources: [{ sourceId: 'incoming', name: '态势系统', credentialRef: 'HOME_TEST_TOKEN', allowedProfileIds: ['preprocess'], allowedRecipientSeatIds: ['overall'] }], profiles: [{ id: 'preprocess', name: '来报初析', goal: '核实事实', tools: ['source_read'] }] });
  const app = await createApp(lab, false, { config: background, env: { HOME_TEST_TOKEN: 'task-home-test-source-token' } });
  const store = new BackgroundStore(lab.access!.db);
  store.grant('seat', 'overall', 'incoming', 'manage');
  store.createRule(actor.userId, randomUUID(), { name: '来源分析', sourceId: 'incoming', profileId: 'preprocess', recipientSeatIds: ['overall'], enabled: true });
  const wa = await lab.workspaces.ensureWorkspace(task.id, 'overall', task.title);
  const wb = await lab.workspaces.ensureWorkspace(task.id, 'planning', task.title);
  async function act(seatId: string, input: WorkPrepareInput) {
    const a = await lab.collaboration!.prepare({ seatId }, input, { source: 'page', clientActionId: randomUUID() });
    return lab.collaboration!.commitPage({ seatId }, a.operationId);
  }
  const assigned = await act('overall', { kind: 'assign', taskSpaceId: task.id, payload: { workspaceId: wa.id, assigneeSeatId: 'planning', title: '修订支援安排', goal: '核对受阻车辆与绕行安排。私有工作目标。', inputPaths: [] } });
  const claimed = await act('planning', { kind: 'claim', workItemId: assigned.workItemId, expectedRevision: assigned.revision, payload: {} });
  await writeFile(join(lab.workspaces.filesDirectory(wb.id, 'planning'), '支援安排.md'), '# 固定提交版本\n保留首批三辆车。');
  const submitted = await act('planning', { kind: 'submit', workItemId: assigned.workItemId, expectedRevision: claimed.revision, payload: { workspaceId: wb.id, path: '支援安排.md' } });
  // The current workspace file changes after submission: the homepage must still reference the fixed submission.
  await writeFile(join(lab.workspaces.filesDirectory(wb.id, 'planning'), '支援安排.md'), '# 私有新草稿，不得替换固定版本');
  const pages: Page[] = [], requests: string[] = [];
  let denyWork = false;
  async function attach(page: Page) {
    pages.push(page);
    await page.route('**/api/**', async route => {
      const req = route.request(), url = new URL(req.url()); requests.push(`${req.method()} ${url.pathname}`);
      if (denyWork && ['/api/work-items', '/api/work-overview/items'].includes(url.pathname)) return route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', message: '工作读取权限已变更' } } });
      const response = await app.inject({ method: req.method() as 'GET' | 'POST' | 'PUT' | 'DELETE', url: url.pathname + url.search, headers: { ...await req.allHeaders(), host: '127.0.0.1', origin: 'http://localhost:4310' }, ...(req.postDataBuffer() ? { payload: req.postDataBuffer()! } : {}) });
      await route.fulfill({ status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])), body: response.rawPayload });
    });
  }
  async function receive() {
    const result = await app.inject({ method: 'POST', url: '/api/integrations/incoming/events', headers: { authorization: 'Bearer task-home-test-source-token' }, payload: { sourceMessageId: randomUUID(), title: '中轴桥封闭', text: '中轴桥封闭，请核实绕行条件。' } });
    expect(result.statusCode, result.body).toBe(202);
    await expect.poll(() => store.listDeliveries().filter(d => d.status === 'delivered').length).toBe(1);
    const job = store.listJobs().find(j => j.kind === 'preprocess')!;
    store.transaction(() => store.saveTaskAssessmentInTransaction(job, { recordedAt: new Date().toISOString(), toolCallId: 'test-home-assessment', items: [{ taskSpaceId: task.id, taskRevision: task.revision, reason: '道路影响仓库支援。' }] }));
    return result.json<{ eventId: string }>().eventId;
  }
  return { lab, task, fake, submitted, act, receive, attach, requests, denyWork: () => { denyWork = true; }, close: async () => { for (const p of pages) if (!p.isClosed()) { await p.goto('about:blank').catch(() => {}); await p.unrouteAll({ behavior: 'wait' }); } await app.close(); await rm(dir, { recursive: true, force: true }); } };
}
async function login(page: Page, seat: string, taskId: string) {
  await page.goto('/'); await page.getByLabel('席位', { exact: true }).selectOption(seat); await page.getByLabel('密码', { exact: true }).fill('task-home-test-password'); await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
  await page.goto(`/tasks/${taskId}/information?tab=description`);
  await expect(page.getByRole('heading', { name: '临港三号仓库火情', exact: true })).toBeVisible();
}

test('task home shows saved related analysis and real work without running a new model or command', async ({ page }, testInfo) => {
  const f = await fixture(); await f.attach(page);
  try {
    await f.receive(); const calls = f.fake.calls.length;
    await login(page, 'overall', f.task.id);
    await expect(page.locator('.task-home')).toContainText('组织支援');
    await expect(page.locator('.task-home')).toContainText('最近来报分析');
    await expect(page.locator('.task-home')).toContainText('单条来报分析：桥梁封闭');
    await expect(page.locator('.task-home')).toContainText('修订支援安排');
    const input = page.getByLabel('问题或工作要求', { exact: true });
    await input.fill('我的独立首页草稿');
    const work = page.locator('.task-home-work');
    const download = work.getByRole('link', { name: '下载交接文件 支援安排.md', exact: true });
    await expect(download).toBeVisible();
    const saved = f.lab.collaboration!.read({ seatId: 'overall' }, f.submitted.workItemId).submissions.find(x => x.id === f.submitted.submissionId)!;
    await expect(download).toHaveAttribute('href', new RegExp(`/api/handoff-files/${saved.file.fileId}`));
    await work.getByRole('button', { name: '查看', exact: true }).click();
    await expect(work).toContainText('固定提交版本');
    await expect(work).not.toContainText('私有新草稿');
    await work.getByRole('button', { name: '收起预览', exact: true }).click();
    const title = work.getByRole('button', { name: '修订支援安排', exact: true });
    await title.click();
    const dialog = page.getByRole('dialog', { name: '修订支援安排', exact: true });
    await expect(dialog).toContainText('私有工作目标');
    await page.mouse.click(4, 100);
    await expect(dialog).toHaveCount(0); await expect(title).toBeFocused();
    await title.click(); await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0); await expect(input).toHaveValue('我的独立首页草稿');
    await f.act('overall', { kind: 'review', workItemId: f.submitted.workItemId, expectedRevision: f.submitted.revision, payload: { submissionId: f.submitted.submissionId!, decision: 'accept' } });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(work).toContainText('验收通过');
    await page.screenshot({ path: testInfo.outputPath('task-home-overall.png'), fullPage: true });
    await page.getByRole('button', { name: '相关信息', exact: true }).click();
    await page.getByRole('button', { name: '任务说明', exact: true }).click();
    await expect(input).toHaveValue('我的独立首页草稿');
    await page.setViewportSize({ width: 960, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('task-home-narrow.png'), fullPage: true });
    expect(f.fake.calls).toHaveLength(calls);
    expect(f.requests.filter(x => /^POST .*\/commands/.test(x))).toHaveLength(0);
  } finally { await f.close(); }
});

test('long task homes scroll inside the main pane without moving the sidebar or extending the document', async ({ page }) => {
  const f = await fixture(); await f.attach(page);
  try {
    await f.receive();
    await login(page, 'overall', f.task.id);
    await expect(page.locator('.task-home')).toContainText('修订支援安排');
    for (const width of [1440, 960]) {
      await page.setViewportSize({ width, height: 600 });
      const pane = page.locator('.task-information');
      await expect.poll(() => pane.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
      await pane.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect(page.getByLabel('问题或工作要求', { exact: true })).toBeInViewport();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      expect((await page.locator('.sidebar').boundingBox())?.y).toBe(0);
      expect(await pane.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    }
  } finally { await f.close(); }
});

test('an overview observer sees work summaries without private work details or document names', async ({ page }, testInfo) => {
  const f = await fixture(); await f.attach(page);
  try {
    await login(page, 'observer', f.task.id);
    const home = page.locator('.task-home');
    await expect(home).toContainText('修订支援安排');
    await expect(home).not.toContainText('支援安排.md');
    await expect(home).not.toContainText('私有工作目标');
    await expect(home).not.toContainText('单条来报分析：桥梁封闭');
    await page.screenshot({ path: testInfo.outputPath('task-home-observer.png'), fullPage: true });
    expect(f.requests.some(x => /GET \/api\/work-items\/[^/]+$/.test(x))).toBe(false);
    expect(f.fake.calls).toHaveLength(0);
  } finally { await f.close(); }
});

test('an uninvolved business seat cannot acquire work summaries from a public task', async ({ page }) => {
  const f = await fixture(); await f.attach(page);
  try {
    await login(page, 'ordinary', f.task.id);
    await expect(page.locator('.task-home')).not.toContainText('修订支援安排');
    await expect(page.locator('.task-home')).not.toContainText('支援安排.md');
    expect(f.requests.some(x => x.startsWith('GET /api/work-overview/'))).toBe(false);
    expect(f.fake.calls).toHaveLength(0);
  } finally { await f.close(); }
});


test('revoked work reads remove previously displayed fixed documents and details', async ({ page }) => {
  const f = await fixture(); await f.attach(page);
  try {
    await login(page, 'overall', f.task.id);
    const work = page.locator('.task-home-work');
    await expect(work.getByRole('link', { name: '下载交接文件 支援安排.md', exact: true })).toBeVisible();
    await work.getByRole('button', { name: '修订支援安排', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '修订支援安排', exact: true });
    await expect(dialog).toContainText('私有工作目标');
    f.denyWork(); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(dialog).toContainText('工作读取权限已变更');
    await expect(dialog).not.toContainText('私有工作目标');
    await expect(dialog).not.toContainText('支援安排.md');
    await page.keyboard.press('Escape');
    await expect(work).not.toContainText('支援安排.md');
    expect(f.fake.calls).toHaveLength(0);
  } finally { await f.close(); }
});
