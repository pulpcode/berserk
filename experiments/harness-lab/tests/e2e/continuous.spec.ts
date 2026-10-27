import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import { BackgroundStore } from '../../src/background/store';
import { ContinuousStore } from '../../src/background/continuous-store';
import { parseBackgroundConfig } from '../../src/background/config';
import type { AuthSession } from '../../src/contracts/access';
import type { ContinuousStream } from '../../src/contracts/continuous';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';

/** Real HTTP handlers, SQLite and native Pi history; only the provider response is deterministic. */
async function fixture(page: Page) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-continuous-web-'));
  const db = await openDatabase(dir); const access = new AccessStore(db);
  const users = new Map<string, string>();
  for (const seat of ['a', 'b', 'c']) users.set(seat, await access.saveAccount({ username: seat, displayName: seat, seatId: seat, seatName: `席位 ${seat}`, password: 'test-password-123', createPublicTask: seat === 'a', manageModelSettings: seat === 'a' }));
  const actor = access.identity(users.get('a')!)!;
  const task = access.create(actor, { title: '持续分析测试任务', goal: '核对来源条件与任务需求', visibility: 'public', clientActionId: randomUUID() }); db.close();
  let sequence = 0; let linked = true; let significant = false;
  const config = testConfig(dir, { seatId: 'a', auth: { secret: 'continuous-e2e-test-signing-secret-value', sessionMs: 28800000 } });
  const fake = await fakeRuntime(config, context => {
    if (!context.tools?.some(tool => tool.name === 'information_record_analysis_update')) return { text: '私有讨论完成。' };
    const last = context.messages.at(-1);
    if (last?.role === 'user' && linked) return { tools: [{ name: 'task_read', arguments: { taskId: task.id } }] };
    if (last?.role === 'user' || last?.role === 'toolResult' && last.toolName === 'task_read') return { tools: [{ name: 'information_record_analysis_update', arguments: {
      taskUpdates: linked ? [{ taskId: task.id, inputIds: continuous.pending(stream.epochId).map(input => input.id), change: sequence === 1 ? 'initial' : 'changed', reason: `第 ${sequence} 轮变化依据`, significant }] : [],
      unassigned: { significant: !linked && significant, reason: linked ? '已核对任务影响' : '独立来源事实已核对' }, uncertainties: [],
    } }] };
    return { text: `第 ${sequence} 轮固定研判正文。` };
  });
  const lab = await PiLab.create(config, fake.runtime);
  const background = parseBackgroundConfig({ enabled: true, sources: [{ sourceId: 'incoming', name: '测试来报', credentialRef: 'CONTINUOUS_TEST_TOKEN', allowedProfileIds: ['analysis'], allowedRecipientSeatIds: ['a', 'b'] }], profiles: [{ id: 'analysis', name: '测试持续方案', goal: '核对实际输入', tools: ['source_list', 'task_read'], contextScopeId: 'test-scope' }] });
  const app = await createApp(lab, false, { config: background, env: { CONTINUOUS_TEST_TOKEN: 'continuous-test-source-secret-long-value' } }, { config: { systems: [{ id: 'facts', name: '测试资料', adapter: 'mock-information-http', baseUrl: 'https://no-network.invalid/facts', tokenEnv: 'CONTEXT_TEST_TOKEN' }], scopes: [{ id: 'test-scope', name: '共同资料范围', systemIds: ['facts'], seatIds: ['a', 'b'] }] }, env: { CONTEXT_TEST_TOKEN: 'context-test-token-value' } });
  const store = new BackgroundStore(lab.access!.db); const continuous = new ContinuousStore(store); store.grant('seat', 'a', 'incoming', 'manage');
  const boot = await app.inject('/api/auth/session');
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { cookie: boot.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': boot.json<AuthSession>().csrf! }, payload: { username: 'a', password: 'test-password-123' } });
  const auth = login.json<AuthSession>();
  const headers = { cookie: login.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': auth.csrf!, 'x-axon-view': auth.viewId! };
  const created = await app.inject({ method: 'POST', url: '/api/continuous/streams', headers, payload: { clientActionId: randomUUID(), name: '共同范围持续研判', sourceIds: ['incoming'], profileId: 'analysis', recipientSeatIds: ['a', 'b'], enabled: true, quietMs: 20, maxWaitMs: 100 } });
  expect(created.statusCode, created.body).toBe(200); const stream = created.json<ContinuousStream>();
  await page.route('**/api/**', async route => {
    const request = route.request(); const url = new URL(request.url());
    const response = await app.inject({ method: request.method() as 'GET' | 'POST' | 'PUT' | 'DELETE', url: url.pathname + url.search, headers: { ...request.headers(), host: '127.0.0.1', origin: 'http://localhost:4310' }, ...(request.postDataBuffer() ? { payload: request.postDataBuffer()! } : {}) });
    await route.fulfill({ status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])), body: response.rawPayload });
  });
  async function receive(options: { linked?: boolean; significant?: boolean } = {}) {
    sequence++; linked = options.linked ?? true; significant = options.significant ?? false;
    const response = await app.inject({ method: 'POST', url: '/api/integrations/incoming/events', headers: { authorization: 'Bearer continuous-test-source-secret-long-value' }, payload: { sourceMessageId: randomUUID(), title: `来源更新 ${sequence}`, text: `第 ${sequence} 条真实输入。` } });
    expect(response.statusCode, response.body).toBe(202);
    await expect.poll(() => store.listJobs().filter(job => job.kind === 'continuous_analysis' && continuous.publication(job.id).status === 'published').length).toBe(sequence);
    return store.listJobs().find(job => job.kind === 'continuous_analysis' && continuous.publication(job.id).status === 'published')!;
  }
  return { task, store, continuous, stream, fake, receive, close: async () => { await page.goto('about:blank').catch(() => {}); await page.unrouteAll({ behavior: 'wait' }); await app.close(); await rm(dir, { recursive: true, force: true }); } };
}
async function login(page: Page, seat = 'b') { await page.goto('/'); await page.getByLabel('席位', { exact: true }).selectOption(seat); await page.getByLabel('密码', { exact: true }).fill('test-password-123'); await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible(); }

test('fixed task assessment and private draft survive newer publication; evidence and history stay explicit', async ({ page }) => {
  const env = await fixture(page);
  try {
    const first = await env.receive(); await login(page);
    await page.getByRole('button', { name: `进入项目：${env.task.title}`, exact: true }).click();
    const assessments = page.getByRole('region', { name: '当前研判', exact: true });
    await expect(assessments).toContainText('第 1 轮固定研判正文。');
    await page.locator('.task-home-composer').getByLabel('问题或工作要求').fill('任务页独立草稿');
    await assessments.getByRole('button', { name: '讨论此版本', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '讨论固定版本', exact: true });
    await panel.getByLabel('问题或工作要求').fill('固定旧版本私有假设');
    await expect(panel.getByRole('button', { name: '后台处理', exact: true })).toHaveCount(0);
    await env.receive(); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(panel).toContainText('有新研判可查看');
    await expect(panel).toContainText('第 1 轮固定研判正文。');
    await expect(panel).not.toContainText('第 2 轮固定研判正文。');
    await expect(panel.getByLabel('问题或工作要求')).toHaveValue('固定旧版本私有假设');
    const calls = env.fake.calls.length;
    await panel.getByRole('button', { name: '关闭面板' }).click();
    await expect(page.locator('.task-home-composer').getByLabel('问题或工作要求')).toHaveValue('任务页独立草稿');
    await assessments.getByRole('button', { name: '研判历史', exact: true }).click();
    const history = page.getByRole('dialog', { name: '研判历史', exact: true });
    await expect(history.locator('.continuous-history > button')).toHaveCount(2);
    await history.locator('.continuous-history > button').last().click();
    await expect(history).toContainText('第 1 轮固定研判正文。');
    await history.getByRole('button', { name: '讨论此版本', exact: true }).click();
    await expect(history.getByLabel('问题或工作要求')).toHaveValue('固定旧版本私有假设');
    expect(env.fake.calls.length).toBe(calls);
    await page.screenshot({ path: 'test-results/continuous-fixed-history.png', fullPage: true });
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(history.getByLabel('问题或工作要求')).toHaveValue('固定旧版本私有假设');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/continuous-history-narrow-desktop.png', fullPage: true });
    await history.getByRole('button', { name: '发送并进入对话', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toBeVisible();
    await expect.poll(() => env.fake.calls.length).toBe(calls + 1);
    const action = env.store.listActions().find(item => item.continuousJobId === first.id)!;
    expect(action.continuousJobId).toBe(first.id); expect(action.taskSpaceId).toBe(env.task.id);
    const context = JSON.stringify(env.fake.calls.at(-1)!.context.messages);
    expect(context).toContain('第 1 轮固定研判正文。');
    expect(context).not.toContain('第 2 轮固定研判正文。');
  } finally { await env.close(); }
});

test('recipient-only seat can browse quiet unassigned rounds and must explicitly handle important rounds', async ({ page }) => {
  const env = await fixture(page);
  try {
    await env.receive({ linked: false }); await login(page);
    await page.getByRole('button', { name: '工作总览', exact: true }).click();
    await expect(page.getByRole('button', { name: '研判记录', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '处理与投递规则', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '席位工作', exact: true })).toHaveCount(0);
    const records = page.getByRole('region', { name: '研判记录', exact: true });
    await expect(records).toContainText('未关联任务 · 静默更新');
    expect(env.store.listDeliveries()).toHaveLength(0);
    await records.getByRole('button', { name: /共同范围持续研判.*版本/ }).click();
    await expect(page.getByRole('dialog', { name: '研判记录详情' })).toContainText('第 1 轮固定研判正文。');
    await page.getByRole('button', { name: '关闭面板' }).click();
    await env.receive({ linked: false, significant: true });
    await page.getByRole('button', { name: '工作待办', exact: true }).click(); await page.getByRole('button', { name: '刷新待办', exact: true }).click();
    await page.locator('.workbench-list').getByRole('button', { name: /共同范围持续研判/ }).click();
    const handling = page.getByRole('region', { name: '本席位处理状态' });
    await expect(handling).toContainText('待处理');
    await expect(page.getByRole('region', { name: '重要研判提醒' })).toContainText('第 2 轮固定研判正文。');
    await page.getByRole('button', { name: '刷新待办', exact: true }).click();
    await expect(handling).toContainText('待处理');
    await handling.getByRole('button', { name: '标记已处理', exact: true }).click();
    await expect(handling).toContainText('已处理');
  } finally { await env.close(); }
});


test('public task visibility alone does not expose assessments, record counts or titles', async ({ page }) => {
  const env = await fixture(page);
  try {
    await env.receive(); await login(page, 'c');
    await page.getByRole('button', { name: `进入项目：${env.task.title}`, exact: true }).click();
    await expect(page.getByRole('region', { name: '当前研判', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '工作总览', exact: true })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('共同范围持续研判');
    await page.goto('/overview?tab=assessments');
    await expect(page.getByRole('heading', { name: '没有工作总览的访问权限', exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('第 1 轮固定研判正文。');
  } finally { await env.close(); }
});


test('configuration edits preserve retired generations and pause controls address the selected epoch', async ({ page }) => {
  const env = await fixture(page);
  try {
    await login(page, 'a');
    await page.getByRole('button', { name: '工作总览', exact: true }).click();
    await page.getByRole('button', { name: '处理与投递规则', exact: true }).click();
    await page.getByRole('button', { name: '持续后台研判', exact: true }).click();
    const rules = page.getByRole('region', { name: '持续分析配置', exact: true });
    await rules.getByRole('button', { name: /共同范围持续研判.*运行中/ }).click();
    await rules.getByLabel('持续配置名称', { exact: true }).fill('调整后的持续研判');
    await rules.getByRole('button', { name: '保存持续配置', exact: true }).click();
    await expect(rules).toContainText('持续分析配置已保存');
    await expect.poll(() => env.continuous.streams().length).toBe(2);
    const next = env.continuous.current(env.stream.id);
    expect(next.epochId).not.toBe(env.stream.epochId);
    const active = rules.locator('.information-list li').filter({ hasText: '调整后的持续研判' });
    await active.getByRole('button', { name: '暂停分析', exact: true }).click();
    await expect(active.getByRole('button', { name: '恢复分析', exact: true })).toBeVisible();
    expect(env.continuous.stream(next.epochId).state).toBe('paused');
    expect(env.continuous.stream(env.stream.epochId).state).toBe('retired');
    await active.getByRole('button', { name: '恢复分析', exact: true }).click();
    await expect(active.getByRole('button', { name: '暂停分析', exact: true })).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await rules.getByRole('button', { name: /共同范围持续研判.*历史配置/ }).click();
    await expect(rules.getByLabel('持续配置名称', { exact: true })).toBeDisabled();
    await expect(rules.getByRole('button', { name: '保存持续配置', exact: true })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/continuous-config-generations.png', fullPage: true });
    expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); }
});
