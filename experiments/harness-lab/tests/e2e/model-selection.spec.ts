import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';
import type { SessionSnapshot } from '../../src/contracts/index';

const password = 'test-password-123';
const selector = (page: Page) => page.getByRole('combobox', { name: '选择模型', exact: true });
const composer = (page: Page) => page.getByRole('textbox', { name: '发送消息', exact: true });

// Real local API, Pi and persistence; only the provider and explicit failure/latency cases are simulated.
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'axon-model-selection-'));
  const db = await openDatabase(dir);
  const access = new AccessStore(db);
  const adminId = await access.saveAccount({ username: 'admin', displayName: '模型管理员', seatId: 'admin', seatName: '管理席位', password, createPublicTask: true, manageModelSettings: true });
  await access.saveAccount({ username: 'member', displayName: '普通用户', seatId: 'member', seatName: '普通席位', password, createPublicTask: false, manageModelSettings: false });
  const tasks = ['模型项目 A', '模型项目 B'].map(title => access.create(access.identity(adminId)!, { title, goal: '验证会话模型选择', visibility: 'public', clientActionId: randomUUID() }));
  db.close();
  const config = testConfig(dir, { seatId: 'admin', auth: { secret: 'test-only-signing-key-at-least-32-characters', sessionMs: 28800000 } });
  const fake = await fakeRuntime(config, () => ({ text: '默认模型测试完成', delayMs: 1200 }));
  const lab = await PiLab.create(config, fake.runtime);
  const sessions: Record<string, SessionSnapshot[]> = {};
  for (const seat of ['admin', 'member']) {
    sessions[seat] = [];
    for (const task of tasks) {
      const workspace = await lab.workspaces.ensureWorkspace(task.id, seat, task.title);
      sessions[seat].push(await lab.createSession(workspace.id, seat));
    }
  }
  const app = await createApp(lab);
  const pages: Page[] = [];
  const prepareReply = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const response = await app.inject({ method: request.method() as 'GET' | 'POST' | 'PUT' | 'DELETE', url: url.pathname + url.search, headers: { ...request.headers(), host: '127.0.0.1', origin: 'http://localhost:4310' }, ...(request.postDataBuffer() ? { payload: request.postDataBuffer()! } : {}) });
    return () => route.fulfill({ status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])), body: response.rawPayload });
  };
  return {
    lab, fake, sessions, prepareReply,
    attach: async (page: Page) => { pages.push(page); await page.route('**/api/**', async route => { await (await prepareReply(route))(); }); },
    close: async () => { for (const page of pages) if (!page.isClosed()) { await page.goto('about:blank'); await page.unrouteAll({ behavior: 'wait' }); } await app.close(); await rm(dir, { recursive: true, force: true }); },
  };
}
async function login(page: Page, username: string) {
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toHaveCount(0);
  await expect(selector(page)).toBeEnabled();
}
async function addModel(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  await page.getByLabel('服务商标识', { exact: true }).fill('test-local');
  await page.getByLabel('模型 ID', { exact: true }).fill('deterministic-alternative');
  await page.getByLabel('API 地址', { exact: true }).fill('https://no-network.invalid');
  await page.locator('#model-key').fill('test-catalog-key-not-a-real-secret');
  await page.getByLabel('上下文容量（token）', { exact: true }).fill('32768');
  await page.getByLabel('最大输出能力（token）', { exact: true }).fill('2048');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  const managed = page.getByRole('combobox', { name: '管理模型', exact: true });
  await expect(managed).not.toHaveValue('new');
  await expect(managed.locator('option')).toHaveCount(2);
  await expect(page.getByLabel('模型 ID', { exact: true })).toHaveValue('deterministic-alternative');
  await expect(page.locator('#model-key')).toHaveValue('');
  return managed.inputValue();
}
async function enter(page: Page, name: 'A' | 'B') {
  await page.getByRole('button', { name: `进入项目：模型项目 ${name}`, exact: true }).click();
  await expect(page.locator('.workspace-header .workspace-name')).toHaveText(`模型项目 ${name}`);
  await expect(composer(page)).toBeEnabled();
}

test('administrators maintain the model catalog while ordinary seats select models per conversation', async ({ page, browser }) => {
  test.setTimeout(60000);
  const env = await setup();
  const context = await browser.newContext();
  const member = await context.newPage();
  await env.attach(page); await env.attach(member);
  const forbiddenSettingsReads: string[] = [];
  member.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/settings/model')) forbiddenSettingsReads.push(request.url()); });
  try {
    await login(page, 'admin');
    const modelId = await addModel(page);
    await page.getByLabel('模型 ID', { exact: true }).fill('deterministic-reviewed');
    await page.getByLabel('上下文容量（token）', { exact: true }).fill('65536');
    await page.getByLabel('最大输出能力（token）', { exact: true }).fill('4096');
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(page.getByRole('combobox', { name: '管理模型', exact: true }).locator('option:checked')).toContainText('deterministic-reviewed');
    await expect(page.locator('#model-key')).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(selector(page).locator(`option[value="${modelId}"]`)).toContainText('deterministic-reviewed');
    await selector(page).selectOption(modelId);
    await expect(selector(page)).toHaveValue(modelId);

    const choicesResponse = member.waitForResponse(response => new URL(response.url()).pathname === '/api/models');
    await login(member, 'member');
    const choices = await (await choicesResponse).json();
    expect(JSON.stringify(choices)).not.toContain('no-network.invalid');
    expect(JSON.stringify(choices)).not.toContain('test-catalog-key-not-a-real-secret');
    await member.getByRole('button', { name: '设置', exact: true }).click();
    await expect(member.getByRole('button', { name: '账户', exact: true })).toBeVisible();
    await expect(member.getByRole('button', { name: '模型', exact: true })).toHaveCount(0);
    await expect(member.getByRole('button', { name: '添加模型', exact: true })).toHaveCount(0);
    await expect(member.getByRole('combobox', { name: '管理模型', exact: true })).toHaveCount(0);
    await member.keyboard.press('Escape');
    await enter(member, 'A');
    await composer(member).fill('A 独立草稿');
    await selector(member).selectOption(modelId);
    await expect(selector(member)).toHaveValue(modelId);
    await expect(composer(member)).toHaveValue('A 独立草稿');
    await enter(member, 'B');
    await expect(selector(member)).toHaveValue('default');
    await composer(member).fill('B 独立草稿');
    await enter(member, 'A');
    await expect(selector(member)).toHaveValue(modelId);
    await expect(composer(member)).toHaveValue('A 独立草稿');
    await member.reload();
    await expect(selector(member)).toHaveValue(modelId);
    await expect(composer(member)).toHaveValue('A 独立草稿');
    await enter(member, 'B');
    await expect(selector(member)).toHaveValue('default');
    await expect(composer(member)).toHaveValue('B 独立草稿');
    await member.route('**/api/models', route => route.fulfill({ json: { ...choices, models: [...choices.models,
      { id: 'unconfigured', provider: 'test', model: '未配置密钥', configured: false, contextReady: true, contextWindow: 32768, maxOutputTokens: 2048 },
      { id: 'incomplete', provider: 'test', model: '参数未填写', configured: true, contextReady: false, contextWindow: null, maxOutputTokens: null },
    ] } }));
    await member.reload();
    await expect(selector(member).locator('option[value="unconfigured"]')).toBeDisabled();
    await expect(selector(member).locator('option[value="incomplete"]')).toBeDisabled();
    expect(forbiddenSettingsReads).toHaveLength(0);
    expect(env.lab.get(env.sessions.member[0]!.id, 'member').modelId).toBe(modelId);
    expect(env.lab.get(env.sessions.member[1]!.id, 'member').modelId).toBe('default');
    expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); await context.close(); }
});

test('failed and delayed model selection stays with its conversation; busy and queued sessions cannot switch', async ({ page, browser }) => {
  test.setTimeout(60000);
  const env = await setup();
  const context = await browser.newContext();
  const member = await context.newPage();
  await env.attach(page); await env.attach(member);
  let release: (() => Promise<void>) | undefined;
  try {
    await login(page, 'admin');
    const modelId = await addModel(page);
    await page.keyboard.press('Escape');
    await login(member, 'member');
    await enter(member, 'A');
    await composer(member).fill('模型变更保留草稿');
    const modelUrl = `**/api/sessions/${env.sessions.member[0]!.id}/model`;
    await member.route(modelUrl, route => route.fulfill({ status: 503, json: { error: { code: 'TEMPORARILY_UNAVAILABLE', message: '模型选择暂时失败，请重试' } } }), { times: 1 });
    await selector(member).selectOption(modelId);
    await expect(member.getByRole('alert')).toContainText('模型选择暂时失败，请重试');
    await expect(selector(member)).toHaveValue('default');
    await expect(composer(member)).toHaveValue('模型变更保留草稿');

    await member.route(modelUrl, async route => { release = await env.prepareReply(route); }, { times: 1 });
    await selector(member).selectOption(modelId);
    await expect.poll(() => Boolean(release)).toBe(true);
    await enter(member, 'B');
    await composer(member).fill('等待其他会话时的 B 草稿');
    await release!(); release = undefined;
    await expect(selector(member)).toHaveValue('default');
    await expect(composer(member)).toHaveValue('等待其他会话时的 B 草稿');
    await enter(member, 'A');
    await expect(selector(member)).toHaveValue(modelId);
    await expect(composer(member)).toHaveValue('模型变更保留草稿');

    await member.route(modelUrl, route => { release = () => route.fulfill({ status: 503, json: { error: { code: 'TEMPORARILY_UNAVAILABLE', message: '来自 A 的迟到模型错误' } } }); }, { times: 1 });
    await selector(member).selectOption('default');
    await expect.poll(() => Boolean(release)).toBe(true);
    await enter(member, 'B');
    await release!(); release = undefined;
    await expect(selector(member)).toHaveValue('default');
    await expect(member.getByText(/来自 A 的迟到模型错误/)).toHaveCount(0);
    await expect(composer(member)).toHaveValue('等待其他会话时的 B 草稿');

    await member.setViewportSize({ width: 375, height: 812 });
    await expect(selector(member)).toBeInViewport();
    expect(await member.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await composer(member).fill('使用默认测试模型运行');
    await member.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(selector(member)).toBeDisabled();
    await expect(member.getByText('默认模型测试完成', { exact: true })).toBeVisible();
    await expect(selector(member)).toBeEnabled();
    expect(env.fake.calls).toHaveLength(1);

    await member.setViewportSize({ width: 1440, height: 960 });
    const reserved = { ...env.lab.get(env.sessions.member[0]!.id, 'member'), backgroundJob: { id: randomUUID(), status: 'queued', revision: 1 } };
    await member.route(`**/api/sessions/${env.sessions.member[0]!.id}`, route => route.fulfill({ json: reserved }));
    await enter(member, 'A');
    await expect(selector(member)).toBeDisabled();
    await expect(composer(member)).toHaveValue('模型变更保留草稿');
  } finally { await release?.(); await env.close(); await context.close(); }
});
