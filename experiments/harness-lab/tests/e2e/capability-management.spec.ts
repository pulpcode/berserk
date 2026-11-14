import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import { CapabilityRoles } from '../../src/access/capability-roles';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'axon-r2-management-web-'));
  const db = await openDatabase(dir); const access = new AccessStore(db);
  for (const username of ['admin', 'user']) await access.saveAccount({ username, displayName: username, seatId: username, seatName: `席位 ${username}`, password: 'test-password-123', createPublicTask: username === 'admin', manageModelSettings: false });
  CapabilityRoles.migrate(db); new CapabilityRoles(db).grant('admin'); db.close();
  const config = testConfig(dir, { seatId: 'admin', auth: { secret: 'test-only-signing-key-at-least-32-characters', sessionMs: 28800000 } });
  const fake = await fakeRuntime(config, () => ({ text: '已根据合成输入完成试用，结论仅适用于当前样例。' }));
  const lab = await PiLab.create(config, fake.runtime); const app = await createApp(lab, false, undefined, undefined, { runtimeFactory: async () => fake.runtime }); const pages: Page[] = [];
  async function attach(page: Page) {
    pages.push(page);
    await page.route('**/api/**', async route => {
      const request = route.request(); const url = new URL(request.url());
      const response = await app.inject({ method: request.method() as 'GET' | 'POST' | 'PUT', url: url.pathname + url.search, headers: { ...await request.allHeaders(), host: '127.0.0.1', origin: 'http://localhost:4310' }, ...(request.postDataBuffer() ? { payload: request.postDataBuffer()! } : {}) });
      await route.fulfill({ status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])), body: response.rawPayload });
    });
  }
  return { lab, fake, attach, close: async () => {
    for (const page of pages) if (!page.isClosed()) { await page.goto('about:blank').catch(() => {}); await page.unrouteAll({ behavior: 'wait' }); }
    await app.close(); await rm(dir, { recursive: true, force: true });
  } };
}
async function login(page: Page, username = 'admin') {
  await page.goto('/capabilities');
  await page.getByLabel('席位', { exact: true }).selectOption(username);
  await page.getByLabel('密码', { exact: true }).fill('test-password-123');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('button', { name: '能力中心', exact: true }).click();
  await expect(page.getByRole('heading', { name: '能力中心', exact: true })).toBeVisible();
}
async function newExpert(page: Page, name = '浏览器试用专家') {
  await page.getByRole('button', { name: '专家管理', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '专家管理', exact: true });
  await dialog.getByRole('button', { name: '新建专家', exact: true }).click();
  await dialog.getByLabel('专家名称', { exact: true }).fill(name);
  await dialog.getByLabel('简介', { exact: true }).fill('用合成资料检验配置发布流程。');
  await dialog.getByLabel('专业指令', { exact: true }).fill('根据用户明确提供的资料归纳事实，不假造来源，不执行外部业务动作。');
  await dialog.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(dialog.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled();
  return dialog;
}

test('admin creates and checks a draft without calling a model; shared conflicts preserve local edits', async ({ page, context }) => {
  const env = await setup(); await env.attach(page);
  try {
    await login(page); const dialog = await newExpert(page);
    expect(env.fake.calls).toHaveLength(0);
    await dialog.getByRole('button', { name: '检查与试用', exact: true }).click();
    await dialog.getByRole('button', { name: '检查配置', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: '检查通过', exact: true })).toBeVisible();
    expect(env.fake.calls).toHaveLength(0);
    await dialog.getByRole('button', { name: '编辑配置', exact: true }).click();
    await dialog.getByLabel('专业指令', { exact: true }).fill('本地保留的修改');
    const other = await context.newPage(); await env.attach(other); await other.goto('/capabilities');
    await other.getByRole('button', { name: '专家管理', exact: true }).click();
    const second = other.getByRole('dialog', { name: '专家管理', exact: true });
    await second.getByRole('navigation', { name: '管理专家列表' }).getByRole('button', { name: /浏览器试用专家/ }).click();
    await second.getByLabel('专业指令', { exact: true }).fill('另一管理员保存的最新修改');
    await second.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(second.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.getByLabel('专业指令', { exact: true })).toHaveValue('本地保留的修改');
    await dialog.getByRole('button', { name: '查看最新草稿', exact: true }).click();
    await expect(dialog.locator('.management-compare')).toContainText('另一管理员保存的最新修改');
    await expect(dialog.getByLabel('专业指令', { exact: true })).toHaveValue('本地保留的修改');
    await page.setViewportSize({ width: 1060, height: 800 });
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('r2-draft-conflict-desktop.png') });
    await other.close();
  } finally { await env.close(); }
});

test('representative plaintext trial requires human confirmation before publishing and personal defaults remain separate', async ({ page }) => {
  test.setTimeout(60000);
  const env = await setup(); await env.attach(page);
  try {
    await login(page); const dialog = await newExpert(page, '资料核对发布专家');
    await dialog.getByRole('button', { name: '使用范围', exact: true }).click();
    await dialog.getByLabel('开放方式', { exact: true }).selectOption('all');
    await dialog.getByRole('button', { name: '保存使用范围', exact: true }).click();
    await dialog.getByRole('button', { name: '检查与试用', exact: true }).click();
    await dialog.getByRole('button', { name: '检查配置', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: '检查通过', exact: true })).toBeVisible();
    await dialog.getByLabel('代表性试用任务', { exact: true }).fill('合成资料：计划10件，完成8件。请分别列出已完成与未完成数量。');
    await dialog.getByRole('button', { name: '开始试用', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: '执行成功，待管理员核对', exact: true })).toBeVisible({ timeout: 30000 });
    await expect(dialog.getByRole('button', { name: '发布新版本', exact: true })).toBeDisabled();
    await dialog.getByLabel('核对结论', { exact: true }).fill('结果符合输入事实，未执行外部业务动作。');
    await dialog.getByRole('checkbox', { name: '我已检查代表性任务结果、实际工具和未验证项目。', exact: true }).check();
    await dialog.getByRole('button', { name: '确认试用通过', exact: true }).click();
    await expect(dialog.getByText('管理员已确认本次试用。发布时仍会核对当前草稿与依赖。', { exact: true })).toBeVisible();
    await dialog.getByLabel('发布说明', { exact: true }).fill('首个经过隔离试用的配置。');
    await dialog.getByRole('checkbox', { name: '我已核对配置、试用结果和使用范围，确认发布。', exact: true }).check();
    await dialog.getByRole('button', { name: '发布新版本', exact: true }).click();
    await expect(dialog).toContainText('版本 1.0.0');
    await page.screenshot({ path: test.info().outputPath('r2-published-expert-desktop.png') });
    await dialog.getByRole('button', { name: '关闭面板', exact: true }).click();
    await expect(page.getByRole('navigation', { name: '专业专家列表' })).toContainText('资料核对发布专家');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '个人偏好', exact: true }).click();
    const preference = page.getByRole('region', { name: '个人默认专家' });
    await preference.getByLabel('默认专家', { exact: true }).selectOption({ label: '资料核对发布专家' });
    await preference.getByRole('button', { name: '保存默认专家', exact: true }).click();
    await expect(preference.getByRole('status')).toContainText('下次新建对话时生效');
    await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '关闭面板', exact: true }).click();
    await page.getByRole('button', { name: '专家管理', exact: true }).click();
    const lifecycle = page.getByRole('dialog', { name: '专家管理', exact: true });
    await lifecycle.getByRole('navigation', { name: '管理专家列表' }).getByRole('button', { name: /资料核对发布专家/ }).click();
    await lifecycle.getByRole('button', { name: '使用范围', exact: true }).click();
    await lifecycle.getByLabel('操作原因', { exact: true }).fill('测试普通停用和恢复，不影响历史。');
    await lifecycle.getByRole('button', { name: '预览影响', exact: true }).click();
    await expect(lifecycle.locator('.management-impact')).toContainText('活跃请求：');
    await lifecycle.getByRole('button', { name: '确认停用', exact: true }).click();
    await expect(lifecycle.locator('.management-expert-heading')).toContainText('已停用');
    await lifecycle.getByLabel('操作', { exact: true }).selectOption('enable');
    await lifecycle.getByLabel('操作原因', { exact: true }).fill('恢复后续新工作准入。');
    await lifecycle.getByRole('button', { name: '预览影响', exact: true }).click();
    await lifecycle.getByRole('button', { name: '确认恢复', exact: true }).click();
    await expect(lifecycle.locator('.management-expert-heading')).toContainText('已发布');
    await expect(lifecycle.getByRole('button', { name: /紧急停止|封禁/ })).toHaveCount(0);
    await lifecycle.getByLabel('开放方式', { exact: true }).selectOption('seats');
    await lifecycle.getByRole('checkbox', { name: '席位 user', exact: true }).check();
    const policySaved = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith('/policy'));
    await lifecycle.getByRole('button', { name: '保存使用范围', exact: true }).click();
    expect((await policySaved).ok()).toBe(true);
    const adminChoices = await page.evaluate(async () => (await (await fetch('/api/capabilities/experts')).json()) as Array<{ name: string }>);
    expect(adminChoices.some(expert => expert.name === '资料核对发布专家')).toBe(false);
    await lifecycle.getByRole('button', { name: '席位默认', exact: true }).click();
    await lifecycle.getByLabel('席位', { exact: true }).selectOption('user');
    const seatDefault = lifecycle.getByRole('region', { name: '席位默认专家', exact: true });
    await seatDefault.getByLabel('默认专家', { exact: true }).selectOption({ label: '资料核对发布专家' });
    await seatDefault.getByRole('button', { name: '保存默认专家', exact: true }).click();
    await expect(seatDefault.getByRole('status')).toContainText('下次新建对话时生效');
  } finally { await env.close(); }
});

test('ordinary user cannot see expert management and can explicitly choose general as personal default', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    await login(page, 'user');
    await expect(page.getByRole('button', { name: '专家管理', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '个人偏好', exact: true }).click();
    const preference = page.getByRole('region', { name: '个人默认专家' });
    await preference.getByLabel('默认专家', { exact: true }).selectOption('general');
    await preference.getByRole('button', { name: '保存默认专家', exact: true }).click();
    await expect(preference.getByRole('status')).toContainText('下次新建对话时生效');
    await page.setViewportSize({ width: 1060, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await env.close(); }
});
