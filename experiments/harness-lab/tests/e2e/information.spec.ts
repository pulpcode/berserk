import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

async function setup(rule = true) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-information-web-'));
  const db = await openDatabase(dir); const access = new AccessStore(db);
  const users = new Map<string, string>();
  for (const name of ['a', 'b', 'c']) users.set(name, await access.saveAccount({ username: name, displayName: `用户 ${name}`, seatId: name, seatName: `席位 ${name.toUpperCase()}`, password: 'test-password-123', createPublicTask: name === 'a', manageModelSettings: name === 'a' }));
  const actor = access.identity(users.get('a')!)!;
  const task = access.create(actor, { title: '联合分析任务', goal: '综合收到资料形成分析', visibility: 'public', clientActionId: randomUUID() });
  db.close();
  const config = testConfig(dir, { seatId: 'a', auth: { secret: 'test-only-signing-key-at-least-32-characters', sessionMs: 28800000 } });
  const fake = await fakeRuntime(config, () => ({ text: '预处理结果：道路中断，需要核实恢复时间。' }));
  const lab = await PiLab.create(config, fake.runtime); const store = new BackgroundStore(lab.access!.db);
  store.grant('seat', 'a', 'incoming', 'manage'); store.grant('seat', 'c', 'incoming', 'view');
  const ruleInput = { name: '资料预处理并投递', sourceId: 'incoming', profileId: 'preprocess', recipientSeatIds: ['a', 'b'], enabled: true };
  if (rule) store.createRule(actor.userId, randomUUID(), ruleInput);
  const background = parseBackgroundConfig({ enabled: true, sources: [{ sourceId: 'incoming', name: '资料接入', credentialRef: 'TEST_INFORMATION_TOKEN', allowedProfileIds: ['preprocess'], allowedRecipientSeatIds: ['a', 'b'] }], profiles: [{ id: 'preprocess', name: '资料预处理', goal: '整理事实和待核实问题', tools: ['source_read'] }] });
  const token = 'test-information-source-secret-value'; const app = await createApp(lab, false, { config: background, env: { TEST_INFORMATION_TOKEN: token } });
  const pages: Page[] = [];
  const attach = async (page: Page) => {
    pages.push(page);
    await page.route('**/api/**', async route => {
      const request = route.request(); const url = new URL(request.url());
      const response = await app.inject({ method: request.method() as 'GET' | 'POST' | 'PUT' | 'DELETE', url: url.pathname + url.search, headers: { ...request.headers(), host: '127.0.0.1', origin: 'http://localhost:4310' }, ...(request.postDataBuffer() ? { payload: request.postDataBuffer()! } : {}) });
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
  return { lab, store, fake, task, actor, ruleInput, attach, receive, close: async () => { for (const page of pages) if (!page.isClosed()) { await page.goto('about:blank').catch(() => {}); await page.unrouteAll({ behavior: 'wait' }); } await app.close(); await rm(dir, { recursive: true, force: true }); } };
}
async function login(page: Page, name: string) {
  await page.goto('/'); await page.getByLabel('账号', { exact: true }).fill(name); await page.getByLabel('密码', { exact: true }).fill('test-password-123'); await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page.locator('.account-footer')).toContainText(`用户 ${name}`);
}
async function inbox(page: Page) { await page.getByRole('button', { name: '收到的信息', exact: true }).click(); await page.getByRole('button', { name: /道路通行信息/ }).click(); }

test('one preprocessing reaches two seats; conversation prepares a draft without invoking the model, background requires explicit confirmation', async ({ page, browser }) => {
  const env = await setup(); const context = await browser.newContext(); const b = await context.newPage(); await env.attach(page); await env.attach(b);
  try {
    await env.receive(); await expect.poll(() => env.store.listDeliveries().filter(item => item.status === 'delivered').length).toBe(2);
    const initialCalls = env.fake.calls.length; expect(initialCalls).toBeGreaterThan(0);
    await login(page, 'a'); await login(b, 'b');
    await expect(page.getByRole('button', { name: '信息处理中心', exact: true })).toBeVisible(); await expect(b.getByRole('button', { name: '信息处理中心', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '在项目 联合分析任务 中新建对话' }).click(); await page.getByRole('textbox', { name: '发送消息' }).fill('保留在原对话的草稿');
    await page.getByRole('button', { name: '信息处理中心', exact: true }).click(); await expect(page.getByRole('heading', { name: '信息处理中心' })).toBeVisible(); await page.getByRole('button', { name: '返回工作台', exact: true }).click(); await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveValue('保留在原对话的草稿');
    await inbox(page); await page.getByLabel('分析所属任务').selectOption(env.task.id); await page.getByRole('textbox', { name: '分析目标', exact: true }).fill('请确认道路信息对任务的影响'); await page.getByRole('button', { name: '进入对话分析', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveValue(/请确认道路信息对任务的影响/); expect(env.fake.calls).toHaveLength(initialCalls);
    await page.getByRole('button', { name: '发送消息', exact: true }).click(); await expect.poll(() => env.fake.calls.length).toBe(initialCalls + 1);
    await inbox(b); await b.getByLabel('分析所属任务').selectOption(env.task.id); await b.getByRole('textbox', { name: '分析目标', exact: true }).fill('席位 B 私有分析目标');
    await b.getByRole('button', { name: '提交后台分析', exact: true }).click(); await expect(b.getByRole('dialog', { name: '确认后台分析' })).toBeVisible(); expect(env.store.listJobs().filter(item => item.kind === 'seat_analysis')).toHaveLength(0);
    await b.getByRole('button', { name: '确认提交后台分析', exact: true }).click(); await expect.poll(() => env.store.listJobs().find(item => item.kind === 'seat_analysis')?.status).toBe('succeeded');
    await page.getByRole('button', { name: '信息处理中心', exact: true }).click(); await page.getByRole('button', { name: '后台作业', exact: true }).click(); await page.getByRole('button', { name: '刷新记录', exact: true }).click(); await page.getByRole('button', { name: '席位 B分析', exact: true }).click();
    const detail = page.getByRole('complementary', { name: '后台作业详情' }); await expect(detail).toContainText('席位 B'); await expect(detail).not.toContainText('席位 B 私有分析目标'); await expect(detail.getByRole('button', { name: '进入关联对话' })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/information-center-desktop.png', fullPage: true });
  } finally { await env.close(); await context.close(); }
});

test('rule creation processes unmatched input only on explicit action; conflicts preserve draft and show separate latest values', async ({ page }) => {
  const env = await setup(false); await env.attach(page);
  try {
    await env.receive(); expect(env.fake.calls).toHaveLength(0); await login(page, 'a'); await page.getByRole('button', { name: '信息处理中心', exact: true }).click();
    await page.getByRole('button', { name: '处理与投递规则', exact: true }).click(); await page.getByRole('button', { name: '新建规则', exact: true }).click(); await page.getByLabel('规则名称').fill('网页投递规则'); await page.getByLabel('席位 A', { exact: true }).check(); await page.getByLabel('席位 B', { exact: true }).check(); await page.getByRole('button', { name: '保存规则', exact: true }).click(); await expect(page.getByRole('status')).toContainText('规则已保存'); expect(env.fake.calls).toHaveLength(0);
    await page.getByLabel('规则名称').fill('正在编辑的名称'); const rule = env.store.listRules()[0]!; env.store.updateRule(env.actor.userId, rule.id, rule.revision, { ...env.ruleInput, name: '其他人保存的名称' });
    await page.getByRole('button', { name: '保存规则', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('编辑已保留'); await page.getByRole('button', { name: '查看最新规则', exact: true }).click(); await expect(page.locator('.task-comparison')).toContainText('其他人保存的名称'); await expect(page.getByLabel('规则名称')).toHaveValue('正在编辑的名称');
    await page.getByRole('button', { name: '已核对，继续合并编辑', exact: true }).click(); await page.getByRole('button', { name: '保存规则', exact: true }).click();
    await page.getByRole('button', { name: '信息记录', exact: true }).click(); await page.getByRole('button', { name: '道路通行信息', exact: true }).click(); await page.getByRole('button', { name: '按当前规则处理', exact: true }).click(); await expect.poll(() => env.store.listDeliveries().filter(item => item.status === 'delivered').length).toBe(2);
  } finally { await env.close(); }
});

test('view-only source permissions show no mutation controls; ungranted seat direct URL is denied', async ({ page, browser }) => {
  const env = await setup(); const context = await browser.newContext(); const b = await context.newPage(); await env.attach(page); await env.attach(b);
  try {
    await env.receive(); await login(page, 'c'); await page.getByRole('button', { name: '信息处理中心', exact: true }).click(); await page.getByRole('combobox', { name: '来源', exact: true }).selectOption('incoming'); await expect(page.getByRole('button', { name: '停止此来源接收' })).toHaveCount(0); await expect(page.getByRole('button', { name: '暂停领取后台作业' })).toHaveCount(0); await page.getByRole('button', { name: '处理与投递规则', exact: true }).click(); await expect(page.getByRole('button', { name: '新建规则', exact: true })).toHaveCount(0); await page.getByRole('button', { name: /资料预处理并投递/ }).click(); await expect(page.getByLabel('规则名称')).toBeDisabled();
    await login(b, 'b'); await b.goto('/information'); await expect(b.getByRole('heading', { name: '没有信息处理中心的访问权限' })).toBeVisible(); await expect(b.getByRole('button', { name: '信息记录', exact: true })).toHaveCount(0);
  } finally { await env.close(); await context.close(); }
});

test('queued seat analysis reserves the conversation, cancellation releases it without invoking a model', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    await env.receive(); await expect.poll(() => env.store.listDeliveries().filter(item => item.status === 'delivered').length).toBe(2);
    const calls = env.fake.calls.length; const queue = env.store.getControl('queue'); env.store.setControl('queue', queue.revision, false, env.actor.userId);
    await login(page, 'a'); await inbox(page); await page.getByLabel('分析所属任务').selectOption(env.task.id);
    await page.getByRole('button', { name: '提交后台分析', exact: true }).click(); await page.getByRole('button', { name: '确认提交后台分析', exact: true }).click();
    await expect.poll(() => env.store.listJobs().find(item => item.kind === 'seat_analysis')?.status).toBe('queued');
    await page.getByRole('button', { name: '进入关联对话', exact: true }).first().click(); await expect(page.getByRole('button', { name: '取消排队', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toHaveCount(0); await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('排队时编辑的下一条消息');
    await page.getByRole('button', { name: '取消排队', exact: true }).click(); await expect.poll(() => env.store.listJobs().find(item => item.kind === 'seat_analysis')?.status).toBe('cancelled');
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled(); await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue('排队时编辑的下一条消息'); expect(env.fake.calls).toHaveLength(calls);
  } finally { await env.close(); }
});


test('received attachment downloads fixed bytes and imports as a normal workspace file; deep links restore detail', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    await env.receive('道路通行信息', true); await expect.poll(() => env.store.listDeliveries().filter(item => item.status === 'delivered').length).toBe(2);
    await login(page, 'a'); await inbox(page); const deepLink = page.url(); await page.reload(); await expect(page.getByRole('heading', { name: '道路通行信息', exact: true })).toBeVisible(); expect(page.url()).toBe(deepLink);
    await page.getByText('查看原文与附件', { exact: true }).click(); const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 任务材料.txt', exact: true }).click(); const download = await downloading; expect(await readFile((await download.path())!, 'utf8')).toBe('附件原文：道路施工，等待恢复。');
    await page.getByLabel('分析所属任务').selectOption(env.task.id); await page.getByRole('checkbox', { name: /任务材料.txt/ }).check(); const calls = env.fake.calls.length;
    await page.getByRole('button', { name: '进入对话分析', exact: true }).click(); await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveValue(/请结合这份信息/);
    const action = env.store.listActions().find(item => item.kind === 'analysis')!; expect(action.imports).toHaveLength(1);
    expect(await readFile(join(env.lab.files.filesDirectory(action.workspaceId!, 'a'), action.imports![0]!.path), 'utf8')).toBe('附件原文：道路施工，等待恢复。'); expect(env.fake.calls).toHaveLength(calls);
    await expect(page.getByRole('list', { name: '消息附件', exact: true })).toContainText('任务材料.txt');
  } finally { await env.close(); }
});
