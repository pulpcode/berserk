import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import { BackgroundStore } from '../../src/background/store';
import { parseBackgroundConfig } from '../../src/background/config';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';

async function setup(rule = true, reply?: Parameters<typeof fakeRuntime>[1], withRoles = false) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-information-web-'));
  if (withRoles) await cp('fixtures/agents', join(dir, 'roles'), { recursive: true });
  const db = await openDatabase(dir); const access = new AccessStore(db);
  const users = new Map<string, string>();
  for (const name of ['a', 'b', 'c']) users.set(name, await access.saveAccount({ username: name, displayName: `用户 ${name}`, seatId: name, seatName: `席位 ${name.toUpperCase()}`, password: 'test-password-123', createPublicTask: name === 'a', manageModelSettings: name === 'a' }));
  const actor = access.identity(users.get('a')!)!;
  const task = access.create(actor, { title: '联合分析任务', goal: '综合收到资料形成分析', visibility: 'public', clientActionId: randomUUID() });
  db.close();
  const config = testConfig(dir, { ...(withRoles ? { agentRolesDir: join(dir, 'roles') } : {}), seatId: 'a', auth: { secret: 'test-only-signing-key-at-least-32-characters', sessionMs: 28800000 } });
  const fake = await fakeRuntime(config, reply || (() => ({ text: '预处理结果：道路中断，需要核实恢复时间。' })));
  const lab = await PiLab.create(config, fake.runtime); const store = new BackgroundStore(lab.access!.db);
  store.grant('seat', 'a', 'incoming', 'manage'); store.grant('seat', 'c', 'incoming', 'view');
  const ruleInput = { name: '资料预处理并投递', sourceId: 'incoming', profileId: 'preprocess', recipientSeatIds: ['a', 'b'], enabled: true };
  if (rule) store.createRule(actor.userId, randomUUID(), ruleInput);
  const background = parseBackgroundConfig({ enabled: true, sources: [{ sourceId: 'incoming', name: '资料接入', credentialRef: 'TEST_INFORMATION_TOKEN', allowedProfileIds: ['preprocess'], allowedRecipientSeatIds: ['a', 'b'] }], profiles: [{ id: 'preprocess', name: '资料预处理', goal: '整理事实和待核实问题', tools: ['source_read'] }] });
  const token = 'test-information-source-secret-value'; const app = await createApp(lab, false, { config: background, env: { TEST_INFORMATION_TOKEN: token } });
  const pages: Page[] = []; let losePreparationResponse = false; let hideSkills = false;
  const messages: { sessionId: string; body: Record<string, unknown> }[] = [];
  const attach = async (page: Page) => {
    pages.push(page);
    await page.route('**/api/**', async route => {
      const request = route.request(); const url = new URL(request.url());
      if (request.method() === 'POST' && url.pathname.endsWith('/messages')) messages.push({ sessionId: url.pathname.split('/')[3]!, body: request.postDataJSON() });
      const response = await app.inject({ method: request.method() as 'GET' | 'POST' | 'PUT' | 'DELETE', url: url.pathname + url.search, headers: { ...request.headers(), host: '127.0.0.1', origin: 'http://localhost:4310' }, ...(request.postDataBuffer() ? { payload: request.postDataBuffer()! } : {}) });
      if (hideSkills && request.method() === 'GET' && url.pathname.endsWith('/resources') && response.statusCode === 200) {
        await route.fulfill({ json: { ...response.json(), skills: [] } }); return;
      }
      if (losePreparationResponse && request.method() === 'POST' && url.pathname.endsWith('/analyses')) {
        losePreparationResponse = false;
        await route.fulfill({ status: 503, json: { error: { code: 'LOST_RESPONSE', message: '准备响应丢失，请核对' } } }); return;
      }
      await route.fulfill({ status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])), body: response.rawPayload });
    });
  };
  async function receive(title = '道路通行信息', withFile = false) {
    let uploadIds: string[] | undefined;
    if (withFile) {
      const bytes = Buffer.from('附件原文：道路施工，等待恢复。');
      const created = await app.inject({ method: 'POST', url: '/api/integrations/incoming/uploads', headers: { host: '127.0.0.1', authorization: `Bearer ${token}` }, payload: { name: '任务材料.txt', size: bytes.length } });
      expect(created.statusCode, created.body).toBe(201); const uploadId = created.json<{ uploadId: string }>().uploadId;
      const saved = await app.inject({ method: 'PUT', url: `/api/integrations/incoming/uploads/${uploadId}/content`, headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' }, payload: bytes });
      expect(saved.statusCode, saved.body).toBe(200); uploadIds = [uploadId];
    }
    const result = await app.inject({ method: 'POST', url: '/api/integrations/incoming/events', headers: { host: '127.0.0.1', authorization: `Bearer ${token}` }, payload: { sourceMessageId: randomUUID(), title, text: '道路因施工中断，恢复时间待核实。', ...(uploadIds ? { uploadIds } : {}) } });
    expect(result.statusCode, result.body).toBe(202); return result.json<{ eventId: string }>().eventId;
  }
  return { hideSkills: (value: boolean) => { hideSkills = value; }, loseNextPreparationResponse: () => { losePreparationResponse = true; }, lab, store, fake, messages, task, actor, ruleInput, attach, receive, close: async () => { for (const page of pages) if (!page.isClosed()) { await page.goto('about:blank').catch(() => {}); await page.unrouteAll({ behavior: 'wait' }); } await app.close(); await rm(dir, { recursive: true, force: true }); } };
}
async function login(page: Page, name: string) {
  await page.goto('/'); await page.getByLabel('账号', { exact: true }).fill(name); await page.getByLabel('密码', { exact: true }).fill('test-password-123'); await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page.getByRole('button', { name: '登录', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
}
async function inbox(page: Page) { await page.getByRole('button', { name: '工作待办', exact: true }).click(); await page.locator('.workbench-list').getByRole('button', { name: /道路通行信息/ }).click(); }

test('one preprocessing reaches two seats; explicit continuation sends once to its own session, background requires confirmation', async ({ page, browser }) => {
  const env = await setup(); const context = await browser.newContext(); const b = await context.newPage(); await env.attach(page); await env.attach(b);
  try {
    await env.receive(); await expect.poll(() => env.store.listDeliveries().filter(item => item.status === 'delivered').length).toBe(2);
    const initialCalls = env.fake.calls.length; expect(initialCalls).toBeGreaterThan(0);
    await login(page, 'a'); await login(b, 'b');
    await expect(page.getByRole('button', { name: '工作总览', exact: true })).toBeVisible(); await expect(b.getByRole('button', { name: '工作总览', exact: true })).toHaveCount(0);
    await page.locator('.workspace-group-heading').filter({ has: page.getByRole('button', { name: '在项目 联合分析任务 中新建对话' }) }).hover(); await page.getByRole('button', { name: '在项目 联合分析任务 中新建对话' }).click(); await page.getByRole('textbox', { name: '发送消息' }).fill('保留在原对话的草稿');
    await page.getByRole('button', { name: '工作总览', exact: true }).click(); await expect(page.getByRole('heading', { name: '工作总览' })).toBeVisible(); await expect(page.getByRole('complementary', { name: '会话与资料' })).toBeVisible(); await expect(page.getByRole('button', { name: '返回工作台', exact: true })).toHaveCount(0); await page.locator('.session-item').first().click(); await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveValue('保留在原对话的草稿');
    await inbox(page); await page.getByLabel('处理位置', { exact: true }).selectOption(env.task.id); await page.getByRole('textbox', { name: '问题或工作要求', exact: true }).fill('请确认道路信息对任务的影响'); await page.getByRole('button', { name: '发送并进入对话', exact: true }).click();
    await expect.poll(() => env.fake.calls.length).toBe(initialCalls + 1);
    await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveValue('');
    const prepared = env.store.listActions().find(item => item.kind === 'analysis')!;
    expect(env.messages).toHaveLength(1); expect(env.messages[0]!.sessionId).toBe(prepared.sessionId);
    expect(env.messages[0]!.body.text).toContain('请确认道路信息对任务的影响');
    await inbox(page);
    await expect(page.getByLabel('问题或工作要求')).toBeEnabled();
    await expect(page.getByLabel('问题或工作要求')).toHaveValue('');
    await expect(page.getByRole('button', { name: '查询本次结果', exact: true })).toHaveCount(0);
    await page.locator('.information-timeline').getByRole('button', { name: '进入关联对话', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveValue('');
    expect(env.messages).toHaveLength(1);
    await page.locator('.session-item:not(.selected)').click();
    await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveValue('保留在原对话的草稿');
    await inbox(b); await b.getByLabel('处理位置', { exact: true }).selectOption(env.task.id); await b.getByRole('textbox', { name: '问题或工作要求', exact: true }).fill('席位 B 私有分析目标');
    await b.getByRole('button', { name: '后台处理', exact: true }).click(); await expect(b.getByRole('dialog', { name: '确认后台分析' })).toBeVisible(); expect(env.store.listJobs().filter(item => item.kind === 'seat_analysis')).toHaveLength(0);
    await b.getByRole('button', { name: '确认提交后台分析', exact: true }).click(); await expect.poll(() => env.store.listJobs().find(item => item.kind === 'seat_analysis')?.status).toBe('succeeded');
    await page.getByRole('button', { name: '工作总览', exact: true }).click(); await page.getByRole('button', { name: '处理运行', exact: true }).click(); await page.getByRole('button', { name: '刷新记录', exact: true }).click(); await page.locator(`[data-information-id="${env.store.listJobs().find(item => item.kind === 'seat_analysis')!.id}"]`).click();
    const detail = page.getByRole('complementary', { name: '后台作业详情' }); await expect(detail).toContainText('席位 B'); await expect(detail).not.toContainText('席位 B 私有分析目标'); await expect(detail.getByRole('button', { name: '进入关联对话' })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/information-center-desktop.png', fullPage: true });
  } finally { await env.close(); await context.close(); }
});

test('rule creation processes unmatched input only on explicit action; conflicts preserve draft and show separate latest values', async ({ page }) => {
  const env = await setup(false); await env.attach(page);
  try {
    await env.receive(); expect(env.fake.calls).toHaveLength(0); await login(page, 'a'); await page.getByRole('button', { name: '工作总览', exact: true }).click();
    await page.getByRole('button', { name: '处理与投递规则', exact: true }).click(); await page.getByRole('button', { name: '新建规则', exact: true }).click(); await page.getByLabel('规则名称').fill('网页投递规则'); await page.getByLabel('席位 A', { exact: true }).check(); await page.getByLabel('席位 B', { exact: true }).check(); await page.getByRole('button', { name: '保存规则', exact: true }).click(); await expect(page.locator('.information-rules').getByRole('status')).toContainText('规则已保存'); expect(env.fake.calls).toHaveLength(0);
    await page.getByLabel('规则名称').fill('正在编辑的名称'); const rule = env.store.listRules()[0]!; env.store.updateRule(env.actor.userId, rule.id, rule.revision, { ...env.ruleInput, name: '其他人保存的名称' });
    await page.getByRole('button', { name: '保存规则', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('编辑已保留'); await page.getByRole('button', { name: '查看最新规则', exact: true }).click(); await expect(page.locator('.task-comparison')).toContainText('其他人保存的名称'); await expect(page.getByLabel('规则名称')).toHaveValue('正在编辑的名称');
    await page.getByRole('button', { name: '已核对，继续合并编辑', exact: true }).click(); await page.getByRole('button', { name: '保存规则', exact: true }).click();
    await page.getByRole('button', { name: '信息流转', exact: true }).click(); await page.getByRole('button', { name: '道路通行信息', exact: true }).click(); await page.getByRole('button', { name: '按当前规则处理', exact: true }).click(); await expect.poll(() => env.store.listDeliveries().filter(item => item.status === 'delivered').length).toBe(2);
  } finally { await env.close(); }
});

test('view-only source permissions show no mutation controls; ungranted seat direct URL is denied', async ({ page, browser }) => {
  const env = await setup(); const context = await browser.newContext(); const b = await context.newPage(); await env.attach(page); await env.attach(b);
  try {
    await env.receive(); await login(page, 'c'); await page.getByRole('button', { name: '工作总览', exact: true }).click(); await page.getByRole('combobox', { name: '来源', exact: true }).selectOption('incoming'); await expect(page.getByRole('button', { name: '停止此来源接收' })).toHaveCount(0); await expect(page.getByRole('button', { name: '暂停领取后台作业' })).toHaveCount(0); await page.getByRole('button', { name: '处理与投递规则', exact: true }).click(); await expect(page.getByRole('button', { name: '新建规则', exact: true })).toHaveCount(0); await page.getByRole('button', { name: /资料预处理并投递/ }).click(); await expect(page.getByLabel('规则名称')).toBeDisabled();
    await login(b, 'b'); await b.goto('/information'); await expect(b.getByRole('heading', { name: '没有工作总览的访问权限' })).toBeVisible(); await expect(b.getByRole('button', { name: '信息流转', exact: true })).toHaveCount(0);
  } finally { await env.close(); await context.close(); }
});

test('queued seat analysis reserves the conversation, cancellation releases it without invoking a model', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    await env.receive(); await expect.poll(() => env.store.listDeliveries().filter(item => item.status === 'delivered').length).toBe(2);
    const calls = env.fake.calls.length; const queue = env.store.getControl('queue'); env.store.setControl('queue', queue.revision, false, env.actor.userId);
    await login(page, 'a'); await inbox(page); await page.getByLabel('处理位置', { exact: true }).selectOption(env.task.id); await page.getByLabel('问题或工作要求').fill('请结合这份信息核实任务影响');
    await page.getByRole('button', { name: '后台处理', exact: true }).click(); await page.getByRole('button', { name: '确认提交后台分析', exact: true }).click();
    await expect.poll(() => env.store.listJobs().find(item => item.kind === 'seat_analysis')?.status).toBe('queued');
    await page.getByRole('button', { name: '进入关联对话', exact: true }).first().click(); await expect(page.getByRole('button', { name: '取消排队', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toHaveCount(0); await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('排队时编辑的下一条消息');
    await page.getByRole('button', { name: '取消排队', exact: true }).click(); await expect.poll(() => env.store.listJobs().find(item => item.kind === 'seat_analysis')?.status).toBe('cancelled');
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled(); await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue('排队时编辑的下一条消息'); expect(env.fake.calls).toHaveLength(calls);
  } finally { await env.close(); }
});


test('received attachment and explicit capabilities are carried into the first continuation message', async ({ page }) => {
  const env = await setup(true, undefined, true); await env.attach(page);
  try {
    await env.receive('道路通行信息', true); await expect.poll(() => env.store.listDeliveries().filter(item => item.status === 'delivered').length).toBe(2);
    await login(page, 'a'); await inbox(page); const deepLink = page.url(); await page.reload(); await expect(page.getByRole('heading', { name: '道路通行信息', exact: true })).toBeVisible(); expect(page.url()).toBe(deepLink);
    await page.getByText('查看原文与附件', { exact: true }).click(); const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 任务材料.txt', exact: true }).click(); const download = await downloading; expect(await readFile((await download.path())!, 'utf8')).toBe('附件原文：道路施工，等待恢复。');
    await page.getByLabel('处理位置', { exact: true }).selectOption(env.task.id); await page.getByLabel('问题或工作要求').fill('请结合这份信息核实任务影响'); await page.locator('.continuation-materials > summary').click(); await page.getByRole('checkbox', { name: /任务材料.txt/ }).check();
    await page.getByText('更多选项', { exact: true }).click();
    await page.getByLabel('Skill（可选）').selectOption('synthesis'); await page.getByLabel('Agents（可选）').selectOption('analyst');
    const calls = env.fake.calls.length;
    await page.getByRole('button', { name: '发送并进入对话', exact: true }).click(); await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveValue('');
    await expect.poll(() => env.fake.calls.length).toBe(calls + 1);
    const action = env.store.listActions().find(item => item.kind === 'analysis')!; expect(action.imports).toHaveLength(1);
    expect(await readFile(join(env.lab.files.filesDirectory(action.workspaceId!, 'a'), action.imports![0]!.path), 'utf8')).toBe('附件原文：道路施工，等待恢复。'); expect(env.messages).toHaveLength(1);
    expect(env.messages[0]).toMatchObject({ sessionId: action.sessionId, body: { fileRefs: [{ path: action.imports![0]!.path }], skill: { id: 'synthesis' }, agent: { name: 'analyst' } } });
    const snapshot = env.lab.get(action.sessionId!, 'a');
    expect(snapshot.messages.filter(message => message.role === 'user')).toHaveLength(1);
    expect(snapshot.messages.find(message => message.role === 'user')?.text).toContain('请结合这份信息');
  } finally { await env.close(); }
});

test('job board uses independent pages, retains filters and restores drawer deep links and keyboard focus', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    const queue = env.store.getControl('queue'); env.store.setControl('queue', queue.revision, false, env.actor.userId);
    for (let index = 0; index < 12; index++) await env.receive(`批次信息 ${index + 1}`);
    await env.receive('其他信息');
    await login(page, 'a'); await page.getByRole('button', { name: '工作总览', exact: true }).click();
    await page.getByRole('button', { name: '处理运行', exact: true }).click();
    await expect(page.getByRole('button', { name: '看板', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('combobox', { name: '来源', exact: true }).selectOption('incoming');
    await page.getByRole('searchbox', { name: '搜索', exact: true }).fill('批次信息');
    const column = page.getByRole('region', { name: '排队中作业', exact: true });
    await expect(column.getByLabel('排队中共 12 项')).toBeVisible(); await expect(column.locator('.information-job-card')).toHaveCount(10);
    await column.locator('.information-job-card').last().click();
    const scrollTop = await page.locator('.information-center-body:visible').evaluate(element => element.scrollTop);
    expect(scrollTop).toBeGreaterThan(100); await page.keyboard.press('Escape');
    await expect(column.locator('.information-job-card').last()).toBeFocused();
    expect(await page.locator('.information-center-body:visible').evaluate(element => element.scrollTop)).toBe(scrollTop);
    await page.getByRole('navigation', { name: '排队中分页', exact: true }).getByRole('button', { name: '下一页' }).click();
    await expect(column.locator('.information-job-card')).toHaveCount(2);
    await expect(page.getByRole('region', { name: '异常／已停止作业', exact: true }).getByText('暂无作业')).toBeVisible();
    const selectedId = await column.locator('.information-job-card').first().getAttribute('data-information-id');
    const card = page.locator(`[data-information-id="${selectedId}"]`); await card.click();
    const detail = page.getByRole('complementary', { name: '后台作业详情', exact: true });
    await expect(detail.getByRole('button', { name: '取消预处理', exact: true })).toBeVisible();
    await expect(detail.getByRole('button', { name: '关闭后台作业详情', exact: true })).toBeFocused();
    const deepLink = page.url();
    await page.keyboard.press('Escape'); await expect(detail).toHaveCount(0); await expect(card).toBeFocused();
    await page.goBack(); await expect(detail).toBeVisible(); expect(page.url()).toBe(deepLink);
    await page.goForward(); await expect(detail).toHaveCount(0); await expect(card).toBeFocused();
    await card.click(); await page.reload(); await expect(detail).toBeVisible(); expect(page.url()).toBe(deepLink);
    await detail.getByRole('button', { name: '关闭后台作业详情' }).click();
    await expect(column.locator('.information-job-card')).toHaveCount(2); await expect(page.getByRole('searchbox', { name: '搜索', exact: true })).toHaveValue('批次信息');
    expect(env.fake.calls).toHaveLength(0); expect(env.store.listJobs()).toHaveLength(13);
    await page.getByRole('button', { name: '列表', exact: true }).click(); await expect(page.getByRole('table')).toContainText('批次信息');
    await page.getByRole('button', { name: '看板', exact: true }).click(); await expect(column.locator('.information-job-card')).toHaveCount(2);
    await page.screenshot({ path: 'test-results/information-board-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 1100, height: 760 });
    await expect(page.getByRole('complementary', { name: '会话与资料' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await column.locator('.information-job-card').first().click();
    await expect(page.getByRole('button', { name: '关闭后台作业详情' })).toBeInViewport();
    await page.screenshot({ path: 'test-results/information-drawer-desktop.png', fullPage: true });
    await page.keyboard.press('Escape');
    for (const job of env.store.listJobs().slice(0, 4)) env.store.requestCancel(job.id, job.revision);
    await page.getByRole('button', { name: '刷新记录', exact: true }).click();
    await expect(column.locator('.information-job-card')).toHaveCount(0);
    await page.getByRole('navigation', { name: '排队中分页', exact: true }).getByRole('button', { name: '上一页' }).click();
    await expect(column.locator('.information-job-card')).toHaveCount(9);
  } finally { await env.close(); }
});

test('latest failed execution does not inherit previous delivery; each history entry keeps its own result', async ({ page }) => {
  const env = await setup(true, (_context, index) => index === 0 ? { text: '已读取附件，仍需人员核实。' } : { error: '本次测试模型不可用' }); await env.attach(page);
  try {
    const eventId = await env.receive(); await expect.poll(() => env.store.listDeliveries().filter(item => item.status === 'delivered').length).toBe(2);
    const first = env.store.listJobs()[0]!;
    await login(page, 'a'); await page.goto(`/information?tab=jobs&id=${first.id}`);
    const detail = page.getByRole('complementary', { name: '后台作业详情', exact: true });
    await expect(detail).toContainText('执行完成'); await expect(detail).toContainText('已送达');
    page.once('dialog', dialog => dialog.accept()); await detail.getByRole('button', { name: '重新预处理', exact: true }).click();
    await expect.poll(() => env.store.listJobs().find(item => item.retryOfJobId === first.id)?.status).toBe('failed');
    const second = env.store.listJobs().find(item => item.retryOfJobId === first.id)!;
    await detail.getByRole('button', { name: '关闭后台作业详情' }).click(); await page.getByRole('button', { name: '刷新记录', exact: true }).click();
    const failed = page.locator(`[data-information-id="${second.id}"]`); await expect(failed).toContainText('执行失败'); await expect(failed).toContainText('尚无投递'); await expect(failed).not.toContainText('已送达');
    await failed.click(); await expect(detail).toContainText('模型调用失败'); await expect(detail).not.toContainText('已送达');
    await detail.getByRole('button', { name: '查看来源信息', exact: true }).click();
    const event = page.getByRole('complementary', { name: '信息详情', exact: true });
    await expect(event.locator(`[data-job-id="${first.id}"]`)).toContainText('已送达');
    await expect(event.locator(`[data-job-id="${second.id}"]`)).toContainText('本次执行尚无投递记录');
    await event.getByRole('button', { name: '关闭信息详情' }).click();
    const row = page.locator('tr').filter({ has: page.locator(`[data-information-id="${eventId}"]`) });
    await expect(row).toContainText('执行失败'); await expect(row).not.toContainText('已送达'); await expect(row).toContainText('共 2 次执行');
    const calls = env.fake.calls.length; await page.reload(); await expect(row).toContainText('执行失败'); expect(env.fake.calls).toHaveLength(calls);
  } finally { await env.close(); }
});

test('opening information keeps the running chat and next draft; sidebar directly returns to the same request', async ({ page }) => {
  const env = await setup(true, () => ({ text: '本次处理已经结束。', delayMs: 1500 })); await env.attach(page);
  try {
    await login(page, 'a'); await page.locator('.workspace-group-heading').filter({ has: page.getByRole('button', { name: '在项目 联合分析任务 中新建对话' }) }).hover(); await page.getByRole('button', { name: '在项目 联合分析任务 中新建对话' }).click();
    const composer = page.getByRole('textbox', { name: '发送消息', exact: true }); await composer.fill('正在处理的请求'); await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect.poll(() => env.fake.calls.length).toBe(1); await composer.fill('下一条独立草稿');
    await page.getByRole('button', { name: '工作总览', exact: true }).click();
    await expect(page.getByRole('complementary', { name: '会话与资料' })).toBeVisible();
    await expect(page.getByRole('button', { name: '信息流转', exact: true })).toHaveAttribute('aria-current', 'page'); expect(env.fake.calls[0]!.aborted).toBe(false);
    await page.locator('.session-item').first().click(); await expect(composer).toHaveValue('下一条独立草稿');
    await expect(page.getByText('本次处理已经结束。', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled(); await expect(composer).toHaveValue('下一条独立草稿'); expect(env.fake.calls).toHaveLength(1);
  } finally { await env.close(); }
});

test('linked conversation failures stay visible in the drawer; late failures cannot replace a different view', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  let release: (() => void) | undefined;
  try {
    await env.receive(); await expect.poll(() => env.store.listDeliveries().filter(item => item.status === 'delivered').length).toBe(2);
    await login(page, 'a'); await inbox(page); await page.getByLabel('处理位置', { exact: true }).selectOption(env.task.id); await page.getByLabel('问题或工作要求').fill('请结合这份信息核实任务影响');
    await page.getByRole('button', { name: '后台处理', exact: true }).click(); await page.getByRole('button', { name: '确认提交后台分析', exact: true }).click();
    await expect.poll(() => env.store.listJobs().find(item => item.kind === 'seat_analysis')?.status).toBe('succeeded');
    const job = env.store.listJobs().find(item => item.kind === 'seat_analysis')!;
    await page.goto(`/information?tab=jobs&id=${job.id}`);
    let failing = true; let hold = false;
    await page.route(`**/api/sessions/${job.sessionId}`, async route => {
      if (!failing) return route.fallback();
      if (hold) await new Promise<void>(resolve => { release = resolve; });
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_READ_FAILED', message: '关联会话暂时无法读取' } }) });
    });
    const detail = page.getByRole('complementary', { name: '后台作业详情', exact: true });
    await expect(detail.getByRole('button', { name: '进入关联对话', exact: true })).toBeVisible();
    const url = page.url(); await detail.getByRole('button', { name: '进入关联对话', exact: true }).click();
    await expect(detail.getByRole('alert')).toContainText('关联会话暂时无法读取'); expect(page.url()).toBe(url);
    await detail.getByRole('button', { name: '关闭提示', exact: true }).click(); await expect(detail.getByRole('alert')).toHaveCount(0);
    hold = true; await detail.getByRole('button', { name: '进入关联对话', exact: true }).click(); await expect.poll(() => Boolean(release)).toBe(true);
    await detail.getByRole('button', { name: '关闭后台作业详情', exact: true }).click(); await page.getByRole('button', { name: '信息流转', exact: true }).click();
    const failure = page.waitForResponse(response => response.url().endsWith(`/api/sessions/${job.sessionId}`) && response.status() === 503); release!(); await failure;
    await expect(page.getByRole('button', { name: '信息流转', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('alert')).toHaveCount(0);
    failing = false; await page.getByRole('button', { name: '处理运行', exact: true }).click(); await page.locator(`[data-information-id="${job.id}"]`).click();
    await detail.getByRole('button', { name: '进入关联对话', exact: true }).click(); await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
  } finally { release?.(); await env.close(); }
});

test('uncertain conversation preparation is queried without sending; manual draft edits survive reopening', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    await env.receive(); await expect.poll(() => env.store.listDeliveries().filter(item => item.status === 'delivered').length).toBe(2);
    await login(page, 'a'); await inbox(page);
    await page.getByLabel('处理位置', { exact: true }).selectOption(env.task.id);
    await page.getByLabel('问题或工作要求').fill('响应丢失仍要保留的要求');
    const calls = env.fake.calls.length;
    env.loseNextPreparationResponse();
    await page.getByRole('button', { name: '发送并进入对话', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('提交结果尚需核对');
    expect(env.messages).toHaveLength(0); expect(env.fake.calls).toHaveLength(calls);
    await expect(page.getByLabel('问题或工作要求')).toBeDisabled();
    await page.reload();
    await expect(page.getByLabel('问题或工作要求')).toBeEnabled();
    await expect(page.getByLabel('问题或工作要求')).toHaveValue('响应丢失仍要保留的要求');
    await expect(page.getByRole('heading', { name: '道路通行信息', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '查询本次结果', exact: true })).toHaveCount(0);
    expect(env.messages).toHaveLength(0); expect(env.fake.calls).toHaveLength(calls);
    await page.locator('.information-continuation').getByRole('button', { name: '进入关联对话', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue(/响应丢失仍要保留的要求/);
    expect(env.messages).toHaveLength(0); expect(env.store.listActions().filter(item => item.kind === 'analysis')).toHaveLength(1);
    await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('我在对话里改过的新要求');
    await inbox(page); await page.locator('.information-timeline').getByRole('button', { name: '进入关联对话', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue('我在对话里改过的新要求');
    expect(env.messages).toHaveLength(0);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect.poll(() => env.fake.calls.length).toBe(calls + 1);
    expect(env.messages).toHaveLength(1); expect(env.messages[0]!.body.text).toBe('我在对话里改过的新要求');
  } finally { await env.close(); }
});

test('unavailable target model keeps the prepared draft without sending or retrying on a read', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    await env.receive(); await expect.poll(() => env.store.listDeliveries().filter(item => item.status === 'delivered').length).toBe(2);
    await page.route('**/api/models', route => route.fulfill({ json: { defaultModelId: 'default', models: [{ id: 'default', provider: 'test-local', model: 'deterministic-model', configured: false, contextReady: true, contextWindow: 131072, maxOutputTokens: 128 }] } }));
    await login(page, 'a'); await inbox(page);
    await page.getByLabel('处理位置', { exact: true }).selectOption(env.task.id);
    await page.getByLabel('问题或工作要求').fill('模型不可用时保留的要求');
    const calls = env.fake.calls.length;
    await page.getByRole('button', { name: '发送并进入对话', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue(/模型不可用时保留的要求/);
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
    expect(env.messages).toHaveLength(0); expect(env.fake.calls).toHaveLength(calls);
    await inbox(page); await page.locator('.information-timeline').getByRole('button', { name: '进入关联对话', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue(/模型不可用时保留的要求/);
    expect(env.messages).toHaveLength(0);
  } finally { await env.close(); }
});


test('a selected capability disappearing during preparation never sends without it', async ({ page }) => {
  const env = await setup(true, undefined, true); await env.attach(page);
  try {
    await env.receive(); await expect.poll(() => env.store.listDeliveries().filter(item => item.status === 'delivered').length).toBe(2);
    await login(page, 'a'); await inbox(page);
    await page.getByLabel('处理位置', { exact: true }).selectOption(env.task.id);
    await page.getByLabel('问题或工作要求').fill('按已选 Skill 继续处理');
    await page.getByText('更多选项', { exact: true }).click();
    await page.getByLabel('Skill（可选）').selectOption('synthesis');
    env.hideSkills(true);
    await page.getByRole('button', { name: '发送并进入对话', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('所选 Skill 已不可用，未发送消息');
    expect(env.messages).toHaveLength(0);
    env.hideSkills(false);
    await expect(page.getByLabel('问题或工作要求')).toBeEnabled();
    await expect(page.getByRole('button', { name: '查询本次结果', exact: true })).toHaveCount(0);
    await page.locator('.information-continuation').getByRole('button', { name: '进入关联对话', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue(/按已选 Skill 继续处理/);
    await expect(page.getByLabel('本轮选择')).toContainText('资料综合写作');
    expect(env.messages).toHaveLength(0);
  } finally { await env.close(); }
});

test('a capability-only draft in a prepared conversation is preserved when reopening the action', async ({ page }) => {
  const env = await setup(true, undefined, true); await env.attach(page);
  try {
    await env.receive(); await expect.poll(() => env.store.listDeliveries().filter(item => item.status === 'delivered').length).toBe(2);
    await login(page, 'a'); await inbox(page);
    await page.getByLabel('处理位置', { exact: true }).selectOption(env.task.id);
    await page.getByLabel('问题或工作要求').fill('原准备要求');
    env.loseNextPreparationResponse();
    await page.getByRole('button', { name: '发送并进入对话', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('提交结果尚需核对');
    await page.locator('.session-item').click();
    await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue('');
    await page.getByRole('button', { name: '添加附件', exact: true }).click();
    await page.getByRole('button', { name: '使用 Skill', exact: true }).click();
    await page.getByRole('option', { name: /结果检查/ }).click();
    await inbox(page); await page.locator('.information-continuation').getByRole('button', { name: '进入关联对话', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue('');
    await expect(page.getByLabel('本轮选择')).toContainText('结果检查');
    expect(env.messages).toHaveLength(0);
    await inbox(page);
    await expect(page.getByLabel('问题或工作要求')).toBeEnabled();
    await expect(page.getByLabel('问题或工作要求')).toHaveValue('原准备要求');
  } finally { await env.close(); }
});

test('reopening during an in-flight submission reconciles once after its uncertain response without replaying', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  let release: (() => void) | undefined; let reads = 0; let posts = 0;
  try {
    await env.receive(); await expect.poll(() => env.store.listDeliveries().filter(item => item.status === 'delivered').length).toBe(2);
    await login(page, 'a'); await inbox(page);
    await page.getByLabel('处理位置', { exact: true }).selectOption(env.task.id);
    await page.getByLabel('问题或工作要求').fill('离开再返回仍保留的要求');
    await page.route('**/api/inbox/*/analyses*', async route => {
      if (route.request().method() === 'POST') { posts++; await new Promise<void>(resolve => { release = resolve; }); }
      else reads++;
      await route.fallback();
    });
    env.loseNextPreparationResponse();
    await page.getByRole('button', { name: '发送并进入对话', exact: true }).click();
    await expect.poll(() => Boolean(release)).toBe(true);
    await page.getByRole('button', { name: '工作总览', exact: true }).click();
    await inbox(page);
    await expect(page.getByLabel('问题或工作要求')).toBeDisabled(); expect(reads).toBe(0);
    release!(); release = undefined;
    await expect(page.getByLabel('问题或工作要求')).toBeEnabled();
    await expect(page.getByLabel('问题或工作要求')).toHaveValue('离开再返回仍保留的要求');
    await expect(page.getByRole('heading', { name: '道路通行信息', exact: true })).toBeVisible();
    expect(reads).toBe(1); expect(posts).toBe(1); expect(env.messages).toHaveLength(0);
    expect(env.store.listActions().filter(action => action.kind === 'analysis')).toHaveLength(1);
  } finally { release?.(); await env.close(); }
});

test('failed or unfinished read-only recovery keeps its protection; a completed query unlocks without opening a conversation', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  let reads = 0; let recovery: 'error' | 'preparing' | 'completed' = 'error';
  try {
    await env.receive(); await expect.poll(() => env.store.listDeliveries().filter(item => item.status === 'delivered').length).toBe(2);
    await login(page, 'a'); await inbox(page);
    await page.getByLabel('处理位置', { exact: true }).selectOption(env.task.id);
    await page.getByLabel('问题或工作要求').fill('待核对操作不应重复创建');
    env.loseNextPreparationResponse();
    await page.getByRole('button', { name: '发送并进入对话', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('提交结果尚需核对');
    await page.route('**/api/inbox/*/analyses?*', async route => {
      reads++;
      if (recovery === 'error') return route.fulfill({ status: 503, json: { error: { code: 'RECOVERY_UNAVAILABLE', message: '核对暂不可用' } } });
      if (recovery === 'preparing') return route.fulfill({ json: { ...env.store.listActions().find(action => action.kind === 'analysis')!, status: 'preparing' } });
      await route.fallback();
    });
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('核对暂不可用');
    await expect(page.getByLabel('问题或工作要求')).toBeDisabled();
    await expect(page.getByLabel('问题或工作要求')).toHaveValue('待核对操作不应重复创建');
    const refresh = page.waitForResponse(response => new URL(response.url()).pathname.startsWith('/api/inbox/') && !response.url().includes('analyses'));
    await page.getByRole('button', { name: '刷新待办', exact: true }).click(); await refresh;
    expect(reads).toBe(1);
    recovery = 'preparing';
    await page.getByRole('button', { name: '查询本次结果', exact: true }).click();
    await expect(page.getByRole('button', { name: '继续原操作', exact: true })).toBeVisible();
    await expect(page.getByLabel('问题或工作要求')).toBeDisabled(); expect(reads).toBe(2);
    recovery = 'completed';
    await page.getByRole('button', { name: '查询本次结果', exact: true }).click();
    await expect(page.getByLabel('问题或工作要求')).toBeEnabled();
    await expect(page.getByRole('heading', { name: '道路通行信息', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '查询本次结果', exact: true })).toHaveCount(0);
    expect(reads).toBe(3); expect(env.messages).toHaveLength(0);
    expect(env.store.listActions().filter(action => action.kind === 'analysis')).toHaveLength(1);
  } finally { await env.close(); }
});

test('reopening an unregistered submission preserves its draft and allows a new explicit send', async ({ page }) => {
  const env = await setup(); await env.attach(page); let posts = 0;
  try {
    await env.receive(); await expect.poll(() => env.store.listDeliveries().filter(item => item.status === 'delivered').length).toBe(2);
    await login(page, 'a'); await inbox(page);
    await page.getByLabel('处理位置', { exact: true }).selectOption(env.task.id);
    await page.getByLabel('问题或工作要求').fill('未提交成功的原要求');
    await page.route('**/api/inbox/*/analyses', async route => {
      posts++;
      if (posts === 1) return route.fulfill({ status: 503, json: { error: { code: 'TEMPORARY_UNAVAILABLE', message: '测试接入暂不可用' } } });
      await route.fallback();
    });
    await page.getByRole('button', { name: '发送并进入对话', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('提交结果尚需核对');
    await expect(page.getByLabel('问题或工作要求')).toBeDisabled();
    await page.reload();
    await expect(page.getByLabel('问题或工作要求')).toBeEnabled();
    await expect(page.getByLabel('问题或工作要求')).toHaveValue('未提交成功的原要求');
    await expect(page.getByLabel('处理位置', { exact: true })).toHaveValue(env.task.id);
    await expect(page.getByRole('button', { name: '查询本次结果', exact: true })).toHaveCount(0);
    expect(posts).toBe(1); expect(env.store.listActions().filter(action => action.kind === 'analysis')).toHaveLength(0);
    await page.getByLabel('问题或工作要求').fill('人员修改后重新发送');
    await page.getByRole('button', { name: '发送并进入对话', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue('');
    await expect.poll(() => env.messages.length).toBe(1); expect(posts).toBe(2);
    expect(env.messages[0]!.body.text).toContain('人员修改后重新发送');
  } finally { await env.close(); }
});
