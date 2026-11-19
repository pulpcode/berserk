import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type Page, type Route } from '@playwright/test';
import { openDatabase } from '../../src/access/database';
import { migrateAdministratorAccounts } from '../../src/access/administrator-schema';
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
  migrateAdministratorAccounts(db);
  await access.saveAdministratorAccount({username:'system-admin',displayName:'系统模型管理员',password});
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
  await page.getByLabel('席位', { exact: true }).selectOption(username === 'system-admin' ? {label:'系统模型管理员'} : username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toHaveCount(0);
  if(username !== 'system-admin') { await enter(page, 'A'); await expect(selector(page)).toBeEnabled(); }
}
async function addPlatform(page: Page, name = '测试平台', provider = 'test-local', url = 'https://no-network.invalid', modelsPath?: string) {
  await page.getByRole('button', { name: '添加平台', exact: true }).click();
  await page.getByLabel('选择平台', { exact: true }).selectOption('custom');
  await page.getByLabel('平台名称', { exact: true }).fill(name);
  await page.getByLabel('服务商标识', { exact: true }).fill(provider);
  await page.getByLabel('API 地址', { exact: true }).fill(url);
  await page.getByLabel('API Key', { exact: true }).fill('test-catalog-key-not-a-real-secret');
  if (modelsPath) {
    await page.getByText('平台高级设置', { exact: true }).click();
    await page.getByLabel('模型目录路径', { exact: true }).fill(modelsPath);
  }
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
}
async function editDefaultModel(page: Page) {
  await page.getByRole('list', { name: '平台列表', exact: true }).getByRole('button', { name: /含系统默认/ }).click();
  await page.getByRole('listitem').filter({ has: page.getByText('系统默认', { exact: true }) })
    .getByRole('button', { name: /^编辑模型 / }).click();
}
async function addModel(page: Page, lab: PiLab) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await addPlatform(page);
  await page.getByRole('button', { name: '手动添加', exact: true }).click();
  await page.getByLabel('模型 ID', { exact: true }).fill('deterministic-alternative');
  await page.getByLabel('上下文容量（token）', { exact: true }).fill('32768');
  await page.getByLabel('最大输出能力（token）', { exact: true }).fill('2048');
  await page.getByLabel('已确认该凭证可用于本系统的使用方式', {exact:true}).check();
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑模型 deterministic-alternative', exact: true })).toBeEnabled();
  return lab.modelCatalog().models.find(model => model.model === 'deterministic-alternative')!.id;
}
async function enter(page: Page, name: 'A' | 'B') {
  await page.getByRole('button', { name: `进入项目：模型项目 ${name}`, exact: true }).click();
  // The project title opens task details; explicitly enter its existing conversation.
  await page.getByRole('region', { name: `模型项目 ${name}`, exact: true }).getByRole('button', { name: '新会话', exact: true }).click();
  await expect(page.locator('.workspace-header .workspace-name')).toHaveText(`模型项目 ${name}`);
  await expect(composer(page)).toBeEnabled();
}

test('thinking settings preserve legacy until an explicit supported mode is saved, without model calls', async ({ page }) => {
  const extensionPath = process.env.B3_ZOOM_EXTENSION;
  const zoomContext = extensionPath ? await chromium.launchPersistentContext('', { channel: 'chromium', headless: false, ignoreDefaultArgs: ['--disable-extensions'], viewport: { width: 1440, height: 960 }, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] }) : undefined;
  if (zoomContext) page = await zoomContext.newPage();
  const env = await setup(); await env.attach(page);
  try {
    await login(page, 'system-admin');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await editDefaultModel(page);
    await expect(page.getByLabel('推理模式', { exact: true })).toHaveValue('legacy');
    await page.getByLabel('上下文容量（token）', { exact: true }).fill('65536');
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(page.getByText('已保存，下次发送消息时使用新配置。', { exact: true })).toBeVisible();
    expect(env.lab.modelSettings().thinkingExplicit).toBe(false);
    await page.getByRole('button', { name: '平台列表', exact: true }).click();
    await addPlatform(page, '方舟测试', 'ark-browser-check', 'https://ark.cn-beijing.volces.com/api/plan/v3');
    await page.getByRole('button', { name: '平台列表', exact: true }).click();
    await editDefaultModel(page);
    await page.getByLabel('所属平台', {exact:true}).selectOption({label:'方舟测试'});
    await page.getByLabel('模型 ID', { exact: true }).fill('deepseek-v4.1-flash');
    await page.getByLabel('上下文容量（token）', { exact: true }).fill('65536');
    await page.getByLabel('最大输出能力（token）', { exact: true }).fill('8192');
    const thinking = page.getByLabel('推理模式', { exact: true });
    await thinking.focus(); await thinking.selectOption('high');
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(page.getByText('已保存，下次发送消息时使用新配置。', { exact: true })).toBeVisible();
    expect(env.lab.modelSettings()).toMatchObject({ thinkingExplicit: true, thinkingMode: 'high', thinkingSupported: true });
    await page.getByRole('listitem').filter({ has: page.getByText('系统默认', { exact: true }) })
      .getByRole('button', { name: /^编辑模型 / }).click();
    await expect(thinking).toHaveValue('high');
    await thinking.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('model-thinking-settings-1440.png') });
    if (process.env.B3_VERIFY_BROWSER_ZOOM === 'true') {
      const before = await page.evaluate(() => ({ ratio: devicePixelRatio, width: innerWidth }));
      let nativeFactor: number | undefined;
      if (zoomContext) {
        const worker = zoomContext.serviceWorkers()[0] ?? await zoomContext.waitForEvent('serviceworker');
        nativeFactor = await worker.evaluate(async url => {
          const chrome = (globalThis as unknown as { chrome: { tabs: { query: (query: object) => Promise<Array<{ id: number; url?: string }>>; setZoom: (id: number, factor: number) => Promise<void>; getZoom: (id: number) => Promise<number> } } }).chrome;
          const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
          await chrome.tabs.setZoom(tab.id, 1.25); return chrome.tabs.getZoom(tab.id);
        }, page.url());
        expect(nativeFactor).toBe(1.25);
      } else await page.keyboard.press('Meta+-');
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => ({ ratio: devicePixelRatio, width: innerWidth }));
      await test.info().attach('native-browser-zoom-attempt', { body: JSON.stringify({ before, after, nativeFactor }), contentType: 'application/json' });
      await page.screenshot({ path: test.info().outputPath('model-settings-native-zoom-attempt.png') });
      expect(after.ratio).not.toBe(before.ratio);
    }
    expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); await zoomContext?.close(); }
});

test('administrators maintain the model catalog while ordinary seats select models per conversation', async ({ page, browser }) => {
  test.setTimeout(60000);
  const env = await setup();
  const context = await browser.newContext();
  const member = await context.newPage();
  await env.attach(page); await env.attach(member);
  const forbiddenSettingsReads: string[] = [];
  member.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/settings/model')) forbiddenSettingsReads.push(request.url()); });
  try {
    await login(page, 'system-admin');
    const modelId = await addModel(page, env.lab);
    const settingNav = page.getByRole('navigation', { name: '设置分类' });
    await expect(settingNav.getByRole('button')).toHaveText(['账户', '个人偏好', '模型管理']);
    await expect(settingNav.getByRole('button', { name: '模型管理', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', { name: '编辑模型 deterministic-alternative', exact: true }).click();
    await page.getByLabel('模型 ID', { exact: true }).fill('deterministic-reviewed');
    await page.getByLabel('显示名称', { exact: true }).fill('deterministic-reviewed');
    await expect(page.getByLabel('已确认该凭证可用于本系统的使用方式', {exact:true})).not.toBeChecked();
    await page.getByLabel('已确认该凭证可用于本系统的使用方式', {exact:true}).check();
    await page.getByLabel('上下文容量（token）', { exact: true }).fill('65536');
    await page.getByLabel('最大输出能力（token）', { exact: true }).fill('4096');
    await settingNav.getByRole('button', { name: '账户', exact: true }).click();
    await settingNav.getByRole('button', { name: '模型管理', exact: true }).click();
    await expect(page.getByLabel('模型 ID', { exact: true })).toHaveValue('deterministic-reviewed');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: '平台列表', exact: true }).click();
    await expect(page.getByLabel('模型 ID', { exact: true })).toHaveValue('deterministic-reviewed');
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(page.getByRole('button', { name: '编辑模型 deterministic-reviewed', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    const choicesResponse = member.waitForResponse(response => new URL(response.url()).pathname === '/api/models');
    await login(member, 'member');
    const choices = await (await choicesResponse).json();
    expect(JSON.stringify(choices)).not.toContain('no-network.invalid');
    expect(JSON.stringify(choices)).not.toContain('test-catalog-key-not-a-real-secret');
    await member.getByRole('button', { name: '设置', exact: true }).click();
    await expect(member.getByRole('button', { name: '账户', exact: true })).toBeVisible();
    await expect(member.getByRole('navigation', { name: '设置分类' }).getByRole('button')).toHaveText(['账户', '个人偏好']);
    await expect(member.getByRole('button', { name: '手动添加', exact: true })).toHaveCount(0);
    await member.getByRole('dialog', { name: '设置', exact: true }).screenshot({ path: test.info().outputPath('seat-settings-desktop.png') });
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
    await login(page, 'system-admin');
    const modelId = await addModel(page, env.lab);
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

    await member.setViewportSize({ width: 1060, height: 800 });
    await expect(selector(member)).toBeInViewport();
    expect(await member.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await composer(member).fill('使用默认测试模型运行');
    await member.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(selector(member)).toBeDisabled();
    await expect(member.getByText('默认模型测试完成', { exact: true })).toBeVisible();
    await expect(selector(member)).toBeEnabled();
    // This assertion counts Agent execution; input prediction is an independent no-tool call.
    expect(env.fake.calls.filter(call => Boolean(call.context.tools?.length))).toHaveLength(1);

    await member.setViewportSize({ width: 1440, height: 960 });
    const reserved = { ...env.lab.get(env.sessions.member[0]!.id, 'member'), backgroundJob: { id: randomUUID(), status: 'queued', revision: 1 } };
    await member.route(`**/api/sessions/${env.sessions.member[0]!.id}`, route => route.fulfill({ json: reserved }));
    await enter(member, 'A');
    await expect(selector(member)).toBeDisabled();
    await expect(composer(member)).toHaveValue('模型变更保留草稿');
  } finally { await release?.(); await env.close(); await context.close(); }
});

test('an administrator can prepare disabled Kimi entries without a key while a legacy model manager has no configuration entry', async ({page,browser}) => {
  const env = await setup(), context = await browser.newContext(), legacy = await context.newPage();
  await env.attach(page); await env.attach(legacy);
  try {
    await login(page,'system-admin');
    await page.getByRole('button',{name:'设置',exact:true}).click();
    await page.getByRole('button',{name:'添加平台',exact:true}).click();
    const platformChoice = page.getByLabel('选择平台', { exact: true });
    await expect(platformChoice.locator(':scope > option')).toHaveText(['请选择平台', 'DeepSeek 官方', 'Kimi Code', '自定义配置']);
    await expect(platformChoice.locator('optgroup')).toHaveCount(0);
    await expect(page.getByLabel('API 地址',{exact:true})).toHaveCount(0);
    await platformChoice.selectOption('kimi-coding');
    await expect(page.getByLabel('API 地址',{exact:true})).toHaveValue('https://api.kimi.com/coding');
    await expect(page.getByLabel('API 协议',{exact:true})).toHaveValue('anthropic-messages');
    await expect(page.getByLabel('API Key',{exact:true})).toHaveCount(1);
    await expect(page.getByLabel('API Key',{exact:true})).toBeVisible();
    await expect(page.getByLabel('密钥环境变量',{exact:true})).toHaveCount(0);
    await expect(page.getByLabel('启用平台',{exact:true})).not.toBeChecked();
    await page.getByRole('button',{name:'保存连接',exact:true}).click();
    const detail = page.getByRole('region', { name: 'Kimi Code', exact: true });
    await expect(detail.getByRole('heading', { name: '连接配置', exact: true })).toBeVisible();
    await detail.getByRole('button',{name:'选择模型',exact:true}).click();
    await detail.getByRole('checkbox',{name:/Kimi K2.8 Preview/}).check();
    await expect(page.getByRole('button',{name:'获取模型',exact:true})).toHaveCount(0);
    await detail.getByRole('button',{name:'添加所选模型',exact:true}).click();
    const imported = detail.getByText('模型已添加，请在下方核对配置后启用。', { exact: true });
    await expect(imported).toBeVisible();
    await detail.getByRole('button',{name:'编辑模型 Kimi K2.8 Preview',exact:true}).click();
    await expect(imported).toHaveCount(0);
    await expect(page.getByLabel('模型 ID',{exact:true})).toHaveValue('kimi-for-coding');
    await expect(page.getByLabel('启用模型',{exact:true})).not.toBeChecked();
    await expect(page.getByLabel('默认思考档位',{exact:true})).toHaveValue('low');
    expect(env.lab.modelCatalog().models.find(model=>model.model==='kimi-for-coding')).toMatchObject({available:false,enabled:false,usageConfirmed:false,defaultThinkingLevel:'low'});
    await page.getByRole('button', { name: '取消编辑', exact: true }).click();
    await page.setViewportSize({width:1060,height:800});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:test.info().outputPath('kimi-model-settings-desktop.png')});
    // Registry aliases also trigger credential rebinding, even when the URL stays unchanged.
    const kimiPlatform = env.lab.modelCatalog().platforms!.find(platform=>platform.provider==='kimi-coding')!;
    await page.getByRole('button',{name:'编辑连接',exact:true}).click();
    await page.getByLabel('API Key',{exact:true}).fill('kimi-test-saved-key');
    await page.getByLabel('启用平台',{exact:true}).check();
    await page.getByRole('button',{name:'保存连接',exact:true}).click();
    await expect(detail.getByText('已保存',{exact:true})).toBeVisible();
    await detail.getByRole('button',{name:'编辑模型 Kimi K2.8 Preview',exact:true}).click();
    await page.getByLabel('启用模型',{exact:true}).check();
    await page.getByLabel('已确认该凭证可用于本系统的使用方式',{exact:true}).check();
    await page.getByRole('button',{name:'保存配置',exact:true}).click();
    await expect(detail.getByRole('listitem').filter({ hasText: 'Kimi K2.8 Preview' })).toContainText('待补容量');
    await page.getByLabel('上下文容量（token）',{exact:true}).fill('32768');
    await page.getByLabel('最大输出能力（token）',{exact:true}).fill('8192');
    await page.getByRole('button',{name:'保存配置',exact:true}).click();
    await expect(detail.getByRole('listitem').filter({ hasText: 'Kimi K2.8 Preview' })).toContainText('可供席位选择');
    await page.getByRole('button', { name: '取消编辑', exact: true }).click();
    await page.getByRole('dialog', { name: '设置', exact: true }).screenshot({ path: test.info().outputPath('admin-platform-detail-desktop.png') });
    await page.getByRole('button',{name:'编辑连接',exact:true}).click();
    await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('');
    await page.getByLabel('服务商标识',{exact:true}).fill('kimi-official-alias');
    await page.getByRole('button',{name:'保存连接',exact:true}).click();
    await expect(page.locator('#platform-key-error')).toContainText('重新填写');
    await page.getByLabel('API Key',{exact:true}).fill('kimi-test-replacement-key');
    await page.getByRole('button',{name:'保存连接',exact:true}).click();
    await expect.poll(()=>env.lab.modelCatalog().platforms!.find(platform=>platform.id===kimiPlatform.id)?.provider).toBe('kimi-official-alias');
    await page.getByRole('button',{name:'编辑连接',exact:true}).click();
    await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('');
    const storage = await page.evaluate(() => JSON.stringify({ session: { ...sessionStorage }, local: { ...localStorage } }));
    expect(storage).not.toContain('kimi-test-replacement-key');
    await login(legacy,'admin');
    await legacy.getByRole('button',{name:'设置',exact:true}).click();
    await expect(legacy.getByRole('button',{name:'模型管理',exact:true})).toHaveCount(0);
    await expect(legacy.getByRole('button',{name:'账户',exact:true})).toBeVisible();
    expect(env.fake.calls).toHaveLength(0);
  } finally {await env.close();await context.close();}
});

test('directory candidates can be saved selectively and failures preserve manual entry', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    await login(page, 'system-admin');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await addPlatform(page, '目录平台', 'custom-directory', 'https://directory.invalid/v1', '/v1/models');
    const platform = env.lab.modelCatalog().platforms!.find(item => item.provider === 'custom-directory')!;
    const directory = `**/api/settings/platforms/${platform.id}/models`;
    let fail = false;
    await page.route(directory, route => route.request().method() !== 'GET' ? route.fallback() : fail
      ? route.fulfill({ status: 502, json: { error: { code: 'MODEL_DISCOVERY_FAILED', message: '无法读取平台目录，请手动填写模型 ID。' } } })
      : route.fulfill({ json: { version: env.lab.modelCatalog().version, models: [{ id: 'candidate-a' }, { id: 'candidate-b' }] } }));
    await page.getByRole('button', { name: '获取模型', exact: true }).click();
    await page.getByRole('checkbox', { name: 'candidate-a', exact: true }).check();
    await page.getByRole('button', { name: '添加所选模型', exact: true }).click();
    await page.getByRole('button', { name: '选择目录模型', exact: true }).click();
    await expect(page.getByText('candidate-a（已添加）', { exact: true })).toBeVisible();
    expect(env.lab.modelCatalog().models.filter(model => model.platformId === platform.id)).toMatchObject([
      { model: 'candidate-a', enabled: false, usageConfirmed: false, available: false },
    ]);
    await page.getByRole('button', { name: '手动添加', exact: true }).click();
    const field = page.getByLabel('模型 ID', { exact: true });
    await field.fill('manual-model'); fail = true;
    await page.getByRole('button', { name: '重新获取', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('请手动填写模型 ID');
    await expect(field).toHaveValue('manual-model');
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await expect.poll(() => env.lab.modelCatalog().models.filter(model => model.platformId === platform.id).map(model => model.model)).toEqual(['candidate-a', 'manual-model']);
  } finally { await env.close(); }
});

test('a previously selected model becoming unavailable disables sending and preserves the draft until another model is selected', async ({page,browser}) => {
  const env = await setup(), context = await browser.newContext(), member = await context.newPage();
  await env.attach(page); await env.attach(member);
  try {
    await login(page,'system-admin'); const modelId = await addModel(page, env.lab);
    await page.keyboard.press('Escape');
    await login(member,'member');
    await selector(member).selectOption(modelId); await expect(selector(member)).toHaveValue(modelId);
    await composer(member).fill('停用期间仍保留的草稿');
    const current = env.lab.modelCatalog().models.find(model=>model.id===modelId)!;
    await env.lab.updateModelProfile({platformId:current.platformId,model:current.model,enabled:false,expectedVersion:current.version},modelId);
    const refreshed = member.waitForResponse(response=>new URL(response.url()).pathname==='/api/models');
    await member.evaluate(()=>window.dispatchEvent(new Event('focus'))); await refreshed;
    await expect(member.getByText('当前模型已停用或尚未开放，请在下方改选其他可用模型。草稿会保留。',{exact:true})).toBeVisible();
    await expect(selector(member)).toHaveValue(modelId);
    await expect(selector(member).locator(`option[value="${modelId}"]`)).toBeDisabled();
    await expect(member.getByRole('button',{name:'发送消息',exact:true})).toBeDisabled();
    await expect(composer(member)).toHaveValue('停用期间仍保留的草稿');
    await selector(member).selectOption('default');
    await expect(selector(member)).toHaveValue('default');
    await expect(member.getByRole('button',{name:'发送消息',exact:true})).toBeEnabled();
    await expect(composer(member)).toHaveValue('停用期间仍保留的草稿');
    expect(env.fake.calls).toHaveLength(0);
  } finally {await env.close();await context.close();}
});

test('deleting a platform removes its choices and preserves affected conversations', async ({ page, browser }) => {
  const env = await setup(), context = await browser.newContext(), member = await context.newPage();
  await env.attach(page); await env.attach(member);
  try {
    await login(page, 'system-admin');
    const modelId = await addModel(page, env.lab);
    await login(member, 'member');
    await composer(member).fill('这段会话历史需要保留');
    await member.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(member.getByText('默认模型测试完成', { exact: true })).toBeVisible();
    await selector(member).selectOption(modelId);
    await expect(selector(member)).toHaveValue(modelId);
    await composer(member).fill('删除配置后保留草稿');
    const remove = page.getByRole('button', { name: '删除平台', exact: true });
    page.once('dialog', async dialog => {
      await dialog.dismiss();
      expect(dialog.message()).toContain('1 个模型');
    });
    await remove.click();
    await expect(page.getByRole('heading', { name: '测试平台', exact: true })).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await remove.click();
    await expect(page.getByRole('heading', { name: '平台列表', exact: true })).toBeVisible();
    await expect(page.getByText('平台配置已删除。', { exact: true })).toBeVisible();
    await expect(page.getByRole('list', { name: '平台列表', exact: true }).getByRole('button', { name: /测试平台/ })).toHaveCount(0);
    await page.getByRole('list', { name: '平台列表', exact: true }).getByRole('button', { name: /含系统默认/ }).click();
    await expect(page.getByRole('button', { name: '删除平台', exact: true })).toBeDisabled();

    await member.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(member.getByText('当前模型已删除，请在下方改选其他可用模型。草稿会保留。', { exact: true })).toBeVisible();
    await expect(member.getByRole('article', { name: '你的消息' }).getByText('这段会话历史需要保留', { exact: true })).toBeVisible();
    await expect(member.getByText('默认模型测试完成', { exact: true })).toBeVisible();
    await expect(composer(member)).toHaveValue('删除配置后保留草稿');
    await expect(member.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
    await expect(selector(member).locator(`option[value="${modelId}"]`)).toHaveCount(0);
    await selector(member).selectOption('default');
    await expect(member.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
    await expect(composer(member)).toHaveValue('删除配置后保留草稿');
  } finally { await env.close(); await context.close(); }
});
