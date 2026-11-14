import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import { migrateAdministratorAccounts } from '../../src/access/administrator-schema';
import { SystemRoles } from '../../src/access/system-roles';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'axon-system-admin-web-'));
  const db = await openDatabase(dir); const access = new AccessStore(db);
  await access.saveAccount({ username: 'business', displayName: '总体业务用户', seatId: 'overall', seatName: '总体席', password: 'test-password-123', createPublicTask: true, manageModelSettings: true });
  migrateAdministratorAccounts(db);
  await access.saveAdministratorAccount({ username: 'system-admin', displayName: '系统管理员', password: 'test-password-123' });
  db.close();
  const config = testConfig(dir, { seatId: 'overall', auth: { secret: 'test-only-signing-key-at-least-32-characters', sessionMs: 28800000 } });
  const fake = await fakeRuntime(config, () => ({ text: '合成样例已核对。' }));
  const lab = await PiLab.create(config, fake.runtime);
  const app = await createApp(lab, false, undefined, undefined, { runtimeFactory: async () => fake.runtime });
  const paths: string[] = []; const writes: string[] = []; const pages: Page[] = [];
  async function attach(page: Page) {
    pages.push(page);
    await page.route('**/api/**', async route => {
      const request = route.request(); const url = new URL(request.url()); paths.push(url.pathname);
      if (request.method() !== 'GET') writes.push(url.pathname);
      const response = await app.inject({ method: request.method() as 'GET' | 'POST' | 'PUT', url: url.pathname + url.search, headers: { ...await request.allHeaders(), host: '127.0.0.1', origin: 'http://localhost:4310' }, ...(request.postDataBuffer() ? { payload: request.postDataBuffer()! } : {}) });
      await route.fulfill({ status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])), body: response.rawPayload });
    });
  }
  return { lab, fake, paths, writes, attach, close: async () => {
    for (const page of pages) if (!page.isClosed()) { await page.goto('about:blank').catch(() => {}); await page.unrouteAll({ behavior: 'wait' }); }
    await app.close(); await rm(dir, { recursive: true, force: true });
  } };
}

async function login(page: Page, path = '/') {
  await page.goto(path);
  const selector = page.getByLabel('席位', { exact: true });
  await expect(selector.locator('option')).toHaveText(['请选择席位', '总体席', '系统管理员']);
  await expect(page.getByRole('button', { name: '管理员登录', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('管理员账号', { exact: true })).toHaveCount(0);
  await selector.selectOption({ label: '系统管理员' });
  await page.getByLabel('密码', { exact: true }).fill('test-password-123');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '能力中心', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Axon', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '管理后台', exact: true })).toHaveCount(0);
}

function businessRequests(paths: string[]) {
  return paths.filter(path => /^\/api\/(settings|context|information|continuous|collaboration|commands|scenarios|work|work-items|background)(\/|$)/.test(path) || /^\/api\/tasks\/[^/]+\/(context|work|execution|progress|plan|annotations|expert-default)(\/|$)/.test(path));
}

async function expectSidebarSpacing(page: Page) {
  const brand = await page.locator('.sidebar-brand').boundingBox();
  const newChat = await page.getByRole('button', { name: '新建对话', exact: true }).boundingBox();
  const capabilities = await page.getByRole('button', { name: '能力中心', exact: true }).boundingBox();
  expect(newChat!.y - brand!.y - brand!.height).toBeGreaterThanOrEqual(16);
  expect(newChat!.y - brand!.y - brand!.height).toBeLessThanOrEqual(32);
  expect(capabilities!.y - newChat!.y - newChat!.height).toBeGreaterThanOrEqual(8);
  expect(capabilities!.y - newChat!.y - newChat!.height).toBeLessThanOrEqual(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('independent administrator manages experts without mounting a seat workbench', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    await login(page);
    await expect(page).toHaveURL(/\/capabilities$/);
    await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '工作总览', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '新建对话', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '新建对话', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '新建个人空间', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '新建任务空间', exact: true })).toHaveCount(0);
    expect(env.writes.filter(path => /^\/api\/(tasks|workspaces|sessions)(\/|$)/.test(path))).toEqual([]);
    await expectSidebarSpacing(page);
    await expect(page.getByText('任务空间', { exact: true })).toHaveCount(0);
    expect(env.writes.filter(path => path === '/api/admin/capabilities/experts')).toHaveLength(0);
    await page.getByRole('button', { name: '创建专家', exact: true }).click();
    const management = page.getByRole('dialog', { name: '专家管理', exact: true });
    await management.getByLabel('专家名称', { exact: true }).fill('独立管理员创建专家');
    expect(env.writes.filter(path => path === '/api/admin/capabilities/experts')).toHaveLength(1);
    await management.getByLabel('简介', { exact: true }).fill('验证管理职责独立于总体业务席位。');
    await management.getByLabel('专业指令', { exact: true }).fill('仅依据明确提供的输入进行归纳。');
    await management.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(management.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled();
    await management.getByRole('button', { name: '检查与试用', exact: true }).click();
    await management.getByRole('button', { name: '检查配置', exact: true }).click();
    await expect(management.getByRole('heading', { name: '检查通过', exact: true })).toBeVisible();
    expect(env.fake.calls).toHaveLength(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: '能力中心', exact: true })).toBeVisible();
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/capabilities$/);
    await page.goto('/tasks/00000000-0000-4000-8000-000000000000/information');
    await expect(page).toHaveURL(/\/capabilities$/);
    await expect(page.getByRole('heading', { name: '能力中心', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1060, height: 800 });
    await expectSidebarSpacing(page);
    await page.screenshot({ path: test.info().outputPath('independent-administrator-desktop.png') });
    expect(businessRequests(env.paths)).toEqual([]);
    expect(env.lab.access!.seats().map(seat => seat.id)).toEqual(['overall']);
    await page.getByRole('button', { name: '折叠侧边栏', exact: true }).click();
    await expect(page.getByRole('button', { name: '展开侧边栏', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '设置', exact: true })).toContainText('系统管理员');
    await expect(page.getByRole('button', { name: '模型', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '个人偏好', exact: true })).toHaveCount(0);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: '专家管理', exact: true })).toHaveCount(0);
  } finally { await env.close(); }
});

test('an administrator creates personal spaces and resumes ordinary two-turn chat without business access', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    await login(page);
    expect(env.writes.filter(path => /^\/api\/(tasks|workspaces|sessions)(\/|$)/.test(path))).toEqual([]);
    await page.getByRole('button', { name: '新建对话', exact: true }).click();
    const space = page.getByRole('dialog', { name: '新建个人空间', exact: true });
    await expect(space).toContainText('先创建个人空间，再开始对话');
    await page.keyboard.press('Escape');
    await expect(space).toBeHidden();
    expect(env.writes.filter(path => /^\/api\/(tasks|workspaces|sessions)(\/|$)/.test(path))).toEqual([]);
    await page.getByRole('button', { name: '新建对话', exact: true }).click();
    await space.getByLabel('空间名称', { exact: true }).fill('管理员个人资料');
    await space.getByLabel('目标与说明', { exact: true }).fill('用于个人整理与对话。');
    await expect(space.getByText('任务范围', { exact: true })).toHaveCount(0);
    await space.getByRole('button', { name: '创建并开始对话', exact: true }).click();
    await expect(space).toBeHidden();
    await expect(page).toHaveURL(/\/\?session=/);
    await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toBeEnabled();
    expect(env.writes.filter(path => path === '/api/sessions')).toHaveLength(1);
    const sessionUrl = page.url();
    await page.getByRole('button', { name: '新建对话', exact: true }).click();
    const conversation = page.getByRole('dialog', { name: '新建对话', exact: true });
    await expect(conversation.getByLabel('选择项目', { exact: true }).locator('option')).toHaveText(['管理员个人资料']);
    await page.keyboard.press('Escape');
    await expect(conversation).toBeHidden();
    expect(env.writes.filter(path => path === '/api/sessions')).toHaveLength(1);
    const input = page.getByRole('textbox', { name: '发送消息', exact: true });
    for (const [index, message] of ['请整理我的个人资料。', '继续概括为三个要点。'].entries()) {
      await input.fill(message);
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      await expect(page.getByText('合成样例已核对。', { exact: true })).toHaveCount(index + 1);
      await expect(input).toBeEnabled();
    }
    expect(env.fake.calls).toHaveLength(2);
    await page.reload();
    await expect(page.getByText('请整理我的个人资料。', { exact: true })).toBeVisible();
    await expect(page.getByText('继续概括为三个要点。', { exact: true })).toBeVisible();
    await expect(page.getByText('合成样例已核对。', { exact: true })).toHaveCount(2);
    await expect(page.getByRole('button', { name: '进入项目：管理员个人资料', exact: true })).toBeVisible();
    for (const name of ['新建任务空间', '工作待办', '工作总览', '态势地图', '场景导演台', '打开态势地图', '分派工作']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(page.getByText('任务空间', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '空间说明', exact: true }).click();
    const description = page.getByRole('dialog', { name: '空间说明', exact: true });
    await expect(description.getByLabel('空间名称', { exact: true })).toHaveValue('管理员个人资料');
    await expect(description.getByRole('button', { name: '相关信息', exact: true })).toHaveCount(0);
    await expect(description.getByText('默认专家', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(description).toBeHidden();
    await page.getByRole('button', { name: '能力中心', exact: true }).click();
    await expect(page.getByRole('button', { name: '创建专家', exact: true })).toBeVisible();
    const createSpace = page.getByRole('button', { name: '新建个人空间', exact: true });
    await page.locator('.catalog-heading').filter({ has: createSpace }).hover();
    await createSpace.click();
    const secondSpace = page.getByRole('dialog', { name: '新建个人空间', exact: true });
    await secondSpace.getByLabel('空间名称', { exact: true }).fill('管理员另一个空间');
    await secondSpace.getByRole('button', { name: '创建个人空间', exact: true }).click();
    await expect(secondSpace).toBeHidden();
    await expect(page.getByRole('button', { name: '进入项目：管理员另一个空间', exact: true })).toBeVisible();
    // The sidebar plus creates only a space; workspace and conversation stay lazy.
    expect(env.writes.filter(path => path === '/api/sessions')).toHaveLength(1);
    await expectSidebarSpacing(page);
    await page.screenshot({ path: test.info().outputPath('administrator-personal-space-wide.png') });
    await page.setViewportSize({ width: 1060, height: 800 });
    await expectSidebarSpacing(page);
    await page.screenshot({ path: test.info().outputPath('administrator-personal-space-desktop.png') });
    expect(businessRequests(env.paths)).toEqual([]);
    expect(env.lab.access!.seats().map(seat => seat.id)).toEqual(['overall']);
    const admin = env.lab.access!.db.prepare("SELECT id,seat_id FROM accounts WHERE username='system-admin'").get()!;
    expect(admin.seat_id).toBeNull();
    expect(env.lab.access!.accountIdentity(String(admin.id))).toMatchObject({ role: 'administrator', canCollaborate: false });
    expect(env.lab.workspaces.listAll()).toHaveLength(1);
    expect(env.lab.workspaces.listAll()[0].seatId).toBe(`account-${String(admin.id)}`);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '设置', exact: true })).toContainText('系统管理员');
    await expect(page.getByRole('button', { name: '模型', exact: true })).toHaveCount(0);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    await expect(page.getByText('请整理我的个人资料。', { exact: true })).toHaveCount(0);
    await page.getByLabel('席位', { exact: true }).selectOption('overall');
    await page.getByLabel('密码', { exact: true }).fill('test-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('button', { name: '新建任务空间', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '进入项目：管理员个人资料', exact: true })).toHaveCount(0);
    await page.goto(sessionUrl);
    await expect(page.getByText('请整理我的个人资料。', { exact: true })).toHaveCount(0);
    await expect(page.getByText('继续概括为三个要点。', { exact: true })).toHaveCount(0);
  } finally { await env.close(); }
});

test('revoking an independent administrator returns to login and overall remains a business seat', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    await login(page);
    new SystemRoles(env.lab.access!.db).revoke('system-admin');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '管理后台', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('席位', { exact: true }).locator('option')).toHaveText(['请选择席位', '总体席']);
    await page.getByLabel('席位', { exact: true }).selectOption('overall');
    await page.getByLabel('密码', { exact: true }).fill('test-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('button', { name: '能力中心', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '能力中心', exact: true }).click();
    await expect(page.getByRole('heading', { name: '能力中心', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '创建专家', exact: true })).toHaveCount(0);
    expect(env.lab.access!.identityForSeat('overall')?.viewWorkOverview).toBe(false);
  } finally { await env.close(); }
});

test('an administrator card opens the selected expert configuration without creating another draft', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    const userId = String(env.lab.access!.db.prepare("SELECT id FROM accounts WHERE username='system-admin'").get()!.id);
    for (const name of ['AAA 配置专家', 'ZZZ 配置专家']) {
      const detail = await env.lab.management!.create({ userId }, { clientActionId: crypto.randomUUID() });
      await env.lab.management!.save({ userId }, detail.expert.expertId, { expectedDraftRevision: detail.draft!.draftRevision, content: {
        name, description: `${name}的测试说明。`, instructions: `只使用${name}对应的合成输入。`, skillIds: [], allowedTools: [],
      } });
    }
    await login(page);
    await page.getByRole('button', { name: '配置ZZZ 配置专家', exact: true }).click();
    const management = page.getByRole('dialog', { name: '专家管理', exact: true });
    await expect(management.getByLabel('专家名称', { exact: true })).toHaveValue('ZZZ 配置专家');
    await expect(management.getByLabel('专业指令', { exact: true })).toHaveValue('只使用ZZZ 配置专家对应的合成输入。');
    expect(env.writes.filter(path => path === '/api/admin/capabilities/experts')).toHaveLength(0);
    expect(env.fake.calls).toHaveLength(0);
    await management.getByRole('button', { name: '关闭面板', exact: true }).click();
    await expect(management).toBeHidden();
    await page.screenshot({ path: test.info().outputPath('administrator-shared-axon-wide.png') });
    await page.setViewportSize({ width: 1060, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('administrator-shared-axon-desktop.png') });
  } finally { await env.close(); }
});
