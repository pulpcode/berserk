# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: model-selection.spec.ts >> thinking settings preserve legacy until an explicit supported mode is saved, without model calls
- Location: tests/e2e/model-selection.spec.ts:85:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('已保存，下次发送消息时使用新配置。', { exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('已保存，下次发送消息时使用新配置。', { exact: true }) with timeout 5000ms
  - waiting for getByText('已保存，下次发送消息时使用新配置。', { exact: true })

```

```yaml
- link "跳至对话":
  - /url: "#conversation-admin"
- complementary "会话与资料":
  - img "Axon"
  - button "折叠侧边栏" [expanded]
  - button "新建对话"
  - button "工作待办"
  - navigation "会话列表":
    - button "折叠工作任务" [expanded]: 工作任务
    - button "新建工作任务"
    - region "模型项目 B":
      - button "折叠项目：模型项目 B" [expanded]
      - button "进入项目：模型项目 B": 模型项目 B
      - button "在项目 模型项目 B 中新建对话"
      - button "新会话"
    - region "模型项目 A":
      - button "折叠项目：模型项目 A" [expanded]
      - button "进入项目：模型项目 A": 模型项目 A
      - button "在项目 模型项目 A 中新建对话"
      - button "新会话"
    - button "折叠个人空间" [expanded]: 个人空间
    - button "新建个人空间"
  - button "设置" [expanded]
- main:
  - text: 新会话 模型项目 A
  - group "项目工具":
    - button "打开态势地图"
    - button "分派工作"
    - button "项目文件"
    - button "项目资料"
  - button "查看任务说明"
  - paragraph: 想法，从这里展开
  - heading "今天，我们一起处理什么？" [level=1]
  - paragraph: 说出你的目标，随时追问、补充或调整。 从梳理信息，到形成清晰的思路。
  - button "一起梳理思路 从一个问题开始讨论":
    - strong: 一起梳理思路
    - text: 从一个问题开始讨论
  - button "从资料中找线索 读取资料，提炼关键信息":
    - strong: 从资料中找线索
    - text: 读取资料，提炼关键信息
  - textbox "发送消息":
    - /placeholder: 描述你的问题，或继续补充想法…
  - button "选择附件"
  - button "添加附件"
  - combobox "选择模型":
    - option "deterministic-model" [selected]
  - button "发送消息" [disabled]
  - status
  - text: Enter 发送 · Shift + Enter 换行
- dialog "设置":
  - banner:
    - heading "设置" [level=2]
    - button "关闭面板"
  - navigation "设置分类":
    - button "模型"
    - button "账户"
  - region "模型配置":
    - heading "模型配置" [level=3]
    - paragraph: 配置可供所有席位在对话中选择的模型。
    - text: 管理模型
    - combobox "管理模型":
      - option "deterministic-model · test-local（默认）" [selected]
    - button "添加模型"
    - group:
      - text: 服务商标识
      - textbox "服务商标识":
        - /placeholder: deepseek
        - text: ark-browser-check
      - text: 模型 ID
      - textbox "模型 ID":
        - /placeholder: deepseek-flash
        - text: deepseek-v4.1-flash
      - text: API 地址
      - textbox "API 地址":
        - /placeholder: https://api.deepseek.com
        - text: https://ark.cn-beijing.volces.com/api/plan/v3
      - paragraph: 使用兼容 OpenAI 的 HTTPS 服务地址。
      - text: API Key 已配置
      - textbox "API Key 已配置":
        - /placeholder: 留空保留已有密钥
        - text: offline-placeholder-not-a-real-key
      - paragraph: 更换服务商或 API 地址时，请填写对应的新密钥。
      - text: 推理模式
      - combobox "推理模式":
        - option "沿用旧请求（未指定开关）"
        - option "关闭"
        - option "开启（high）" [selected]
      - paragraph: 旧配置沿用原请求，不表示远端一定关闭思考；需明确选择并保存开关。仅已核实的模型和地址允许开启。主回复、工具续轮、压缩、子任务和后台使用同一设置。没有思考文字不代表推理未开启。
      - text: 上下文容量（token）
      - spinbutton "上下文容量（token）": "65536"
      - paragraph: 输入与输出合计容量。来源：保存时重新解析。
      - text: 最大输出能力（token）
      - spinbutton "最大输出能力（token）": "8192"
      - paragraph: 来源：保存时重新解析。不能超过上下文容量。
      - paragraph: 模型身份已编辑，保存时重新解析规格；未填写的参数不沿用其他模型。仍为原模型时，留空保留已有配置。
      - group: 高级压缩参数
    - alert: 请求格式不正确或内容过长。
    - text: 当前使用已保存的配置
    - button "保存配置"
```

# Test source

```ts
  4   | import { join } from 'node:path';
  5   | import { expect, test, type Page, type Route } from '@playwright/test';
  6   | import { openDatabase } from '../../src/access/database';
  7   | import { AccessStore } from '../../src/access/store';
  8   | import { PiLab } from '../../src/pi/lab';
  9   | import { createApp } from '../../src/server/app';
  10  | import { fakeRuntime, testConfig } from '../pi/fake-runtime';
  11  | import type { SessionSnapshot } from '../../src/contracts/index';
  12  | 
  13  | const password = 'test-password-123';
  14  | const selector = (page: Page) => page.getByRole('combobox', { name: '选择模型', exact: true });
  15  | const composer = (page: Page) => page.getByRole('textbox', { name: '发送消息', exact: true });
  16  | 
  17  | // Real local API, Pi and persistence; only the provider and explicit failure/latency cases are simulated.
  18  | async function setup() {
  19  |   const dir = await mkdtemp(join(tmpdir(), 'axon-model-selection-'));
  20  |   const db = await openDatabase(dir);
  21  |   const access = new AccessStore(db);
  22  |   const adminId = await access.saveAccount({ username: 'admin', displayName: '模型管理员', seatId: 'admin', seatName: '管理席位', password, createPublicTask: true, manageModelSettings: true });
  23  |   await access.saveAccount({ username: 'member', displayName: '普通用户', seatId: 'member', seatName: '普通席位', password, createPublicTask: false, manageModelSettings: false });
  24  |   const tasks = ['模型项目 A', '模型项目 B'].map(title => access.create(access.identity(adminId)!, { title, goal: '验证会话模型选择', visibility: 'public', clientActionId: randomUUID() }));
  25  |   db.close();
  26  |   const config = testConfig(dir, { seatId: 'admin', auth: { secret: 'test-only-signing-key-at-least-32-characters', sessionMs: 28800000 } });
  27  |   const fake = await fakeRuntime(config, () => ({ text: '默认模型测试完成', delayMs: 1200 }));
  28  |   const lab = await PiLab.create(config, fake.runtime);
  29  |   const sessions: Record<string, SessionSnapshot[]> = {};
  30  |   for (const seat of ['admin', 'member']) {
  31  |     sessions[seat] = [];
  32  |     for (const task of tasks) {
  33  |       const workspace = await lab.workspaces.ensureWorkspace(task.id, seat, task.title);
  34  |       sessions[seat].push(await lab.createSession(workspace.id, seat));
  35  |     }
  36  |   }
  37  |   const app = await createApp(lab);
  38  |   const pages: Page[] = [];
  39  |   const prepareReply = async (route: Route) => {
  40  |     const request = route.request();
  41  |     const url = new URL(request.url());
  42  |     const response = await app.inject({ method: request.method() as 'GET' | 'POST' | 'PUT' | 'DELETE', url: url.pathname + url.search, headers: { ...request.headers(), host: '127.0.0.1', origin: 'http://localhost:4310' }, ...(request.postDataBuffer() ? { payload: request.postDataBuffer()! } : {}) });
  43  |     return () => route.fulfill({ status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])), body: response.rawPayload });
  44  |   };
  45  |   return {
  46  |     lab, fake, sessions, prepareReply,
  47  |     attach: async (page: Page) => { pages.push(page); await page.route('**/api/**', async route => { await (await prepareReply(route))(); }); },
  48  |     close: async () => { for (const page of pages) if (!page.isClosed()) { await page.goto('about:blank'); await page.unrouteAll({ behavior: 'wait' }); } await app.close(); await rm(dir, { recursive: true, force: true }); },
  49  |   };
  50  | }
  51  | async function login(page: Page, username: string) {
  52  |   await page.goto('/');
  53  |   await page.getByLabel('席位', { exact: true }).selectOption(username);
  54  |   await page.getByLabel('密码', { exact: true }).fill(password);
  55  |   await page.getByRole('button', { name: '登录', exact: true }).click();
  56  |   await expect(page.getByRole('button', { name: '登录', exact: true })).toHaveCount(0);
  57  |   await enter(page, 'A');
  58  |   await expect(selector(page)).toBeEnabled();
  59  | }
  60  | async function addModel(page: Page) {
  61  |   await page.getByRole('button', { name: '设置', exact: true }).click();
  62  |   await page.getByRole('button', { name: '添加模型', exact: true }).click();
  63  |   await page.getByLabel('服务商标识', { exact: true }).fill('test-local');
  64  |   await page.getByLabel('模型 ID', { exact: true }).fill('deterministic-alternative');
  65  |   await page.getByLabel('API 地址', { exact: true }).fill('https://no-network.invalid');
  66  |   await page.locator('#model-key').fill('test-catalog-key-not-a-real-secret');
  67  |   await page.getByLabel('上下文容量（token）', { exact: true }).fill('32768');
  68  |   await page.getByLabel('最大输出能力（token）', { exact: true }).fill('2048');
  69  |   await page.getByRole('button', { name: '保存配置', exact: true }).click();
  70  |   const managed = page.getByRole('combobox', { name: '管理模型', exact: true });
  71  |   await expect(managed).not.toHaveValue('new');
  72  |   await expect(managed.locator('option')).toHaveCount(2);
  73  |   await expect(page.getByLabel('模型 ID', { exact: true })).toHaveValue('deterministic-alternative');
  74  |   await expect(page.locator('#model-key')).toHaveValue('');
  75  |   return managed.inputValue();
  76  | }
  77  | async function enter(page: Page, name: 'A' | 'B') {
  78  |   await page.getByRole('button', { name: `进入项目：模型项目 ${name}`, exact: true }).click();
  79  |   await expect(page.locator('.workspace-header .workspace-name')).toHaveText(`模型项目 ${name}`);
  80  |   // The project title opens task details; explicitly enter its existing conversation.
  81  |   await page.getByRole('region', { name: `模型项目 ${name}`, exact: true }).getByRole('button', { name: '新会话', exact: true }).click();
  82  |   await expect(composer(page)).toBeEnabled();
  83  | }
  84  | 
  85  | test('thinking settings preserve legacy until an explicit supported mode is saved, without model calls', async ({ page }) => {
  86  |   const env = await setup(); await env.attach(page);
  87  |   try {
  88  |     await login(page, 'admin');
  89  |     await page.getByRole('button', { name: '设置', exact: true }).click();
  90  |     await expect(page.getByLabel('推理模式', { exact: true })).toHaveValue('legacy');
  91  |     await page.getByLabel('上下文容量（token）', { exact: true }).fill('65536');
  92  |     await page.getByRole('button', { name: '保存配置', exact: true }).click();
  93  |     await expect(page.getByText('已保存，下次发送消息时使用新配置。', { exact: true })).toBeVisible();
  94  |     expect(env.lab.modelSettings().thinkingExplicit).toBe(false);
  95  |     await page.getByLabel('服务商标识', { exact: true }).fill('ark-browser-check');
  96  |     await page.getByLabel('模型 ID', { exact: true }).fill('deepseek-v4.1-flash');
  97  |     await page.getByLabel('API 地址', { exact: true }).fill('https://ark.cn-beijing.volces.com/api/plan/v3');
  98  |     await page.locator('#model-key').fill('offline-placeholder-not-a-real-key');
  99  |     await page.getByLabel('上下文容量（token）', { exact: true }).fill('65536');
  100 |     await page.getByLabel('最大输出能力（token）', { exact: true }).fill('8192');
  101 |     const thinking = page.getByLabel('推理模式', { exact: true });
  102 |     await thinking.focus(); await thinking.selectOption('high');
  103 |     await page.getByRole('button', { name: '保存配置', exact: true }).click();
> 104 |     await expect(page.getByText('已保存，下次发送消息时使用新配置。', { exact: true })).toBeVisible();
      |                                                                        ^ Error: expect(locator).toBeVisible() failed
  105 |     await expect(thinking).toHaveValue('high');
  106 |     expect(env.lab.modelSettings()).toMatchObject({ thinkingExplicit: true, thinkingMode: 'high', thinkingSupported: true });
  107 |     await expect(page.locator('#model-key')).toHaveValue('');
  108 |     await thinking.scrollIntoViewIfNeeded();
  109 |     await page.screenshot({ path: test.info().outputPath('model-thinking-settings-1440.png') });
  110 |     expect(env.fake.calls).toHaveLength(0);
  111 |   } finally { await env.close(); }
  112 | });
  113 | 
  114 | test('administrators maintain the model catalog while ordinary seats select models per conversation', async ({ page, browser }) => {
  115 |   test.setTimeout(60000);
  116 |   const env = await setup();
  117 |   const context = await browser.newContext();
  118 |   const member = await context.newPage();
  119 |   await env.attach(page); await env.attach(member);
  120 |   const forbiddenSettingsReads: string[] = [];
  121 |   member.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/settings/model')) forbiddenSettingsReads.push(request.url()); });
  122 |   try {
  123 |     await login(page, 'admin');
  124 |     const modelId = await addModel(page);
  125 |     await page.getByLabel('模型 ID', { exact: true }).fill('deterministic-reviewed');
  126 |     await page.getByLabel('上下文容量（token）', { exact: true }).fill('65536');
  127 |     await page.getByLabel('最大输出能力（token）', { exact: true }).fill('4096');
  128 |     await page.getByRole('button', { name: '保存配置', exact: true }).click();
  129 |     await expect(page.getByRole('combobox', { name: '管理模型', exact: true }).locator('option:checked')).toContainText('deterministic-reviewed');
  130 |     await expect(page.locator('#model-key')).toHaveValue('');
  131 |     await page.keyboard.press('Escape');
  132 |     await expect(selector(page).locator(`option[value="${modelId}"]`)).toContainText('deterministic-reviewed');
  133 |     await selector(page).selectOption(modelId);
  134 |     await expect(selector(page)).toHaveValue(modelId);
  135 | 
  136 |     const choicesResponse = member.waitForResponse(response => new URL(response.url()).pathname === '/api/models');
  137 |     await login(member, 'member');
  138 |     const choices = await (await choicesResponse).json();
  139 |     expect(JSON.stringify(choices)).not.toContain('no-network.invalid');
  140 |     expect(JSON.stringify(choices)).not.toContain('test-catalog-key-not-a-real-secret');
  141 |     await member.getByRole('button', { name: '设置', exact: true }).click();
  142 |     await expect(member.getByRole('button', { name: '账户', exact: true })).toBeVisible();
  143 |     await expect(member.getByRole('button', { name: '模型', exact: true })).toHaveCount(0);
  144 |     await expect(member.getByRole('button', { name: '添加模型', exact: true })).toHaveCount(0);
  145 |     await expect(member.getByRole('combobox', { name: '管理模型', exact: true })).toHaveCount(0);
  146 |     await member.keyboard.press('Escape');
  147 |     await enter(member, 'A');
  148 |     await composer(member).fill('A 独立草稿');
  149 |     await selector(member).selectOption(modelId);
  150 |     await expect(selector(member)).toHaveValue(modelId);
  151 |     await expect(composer(member)).toHaveValue('A 独立草稿');
  152 |     await enter(member, 'B');
  153 |     await expect(selector(member)).toHaveValue('default');
  154 |     await composer(member).fill('B 独立草稿');
  155 |     await enter(member, 'A');
  156 |     await expect(selector(member)).toHaveValue(modelId);
  157 |     await expect(composer(member)).toHaveValue('A 独立草稿');
  158 |     await member.reload();
  159 |     await expect(selector(member)).toHaveValue(modelId);
  160 |     await expect(composer(member)).toHaveValue('A 独立草稿');
  161 |     await enter(member, 'B');
  162 |     await expect(selector(member)).toHaveValue('default');
  163 |     await expect(composer(member)).toHaveValue('B 独立草稿');
  164 |     await member.route('**/api/models', route => route.fulfill({ json: { ...choices, models: [...choices.models,
  165 |       { id: 'unconfigured', provider: 'test', model: '未配置密钥', configured: false, contextReady: true, contextWindow: 32768, maxOutputTokens: 2048 },
  166 |       { id: 'incomplete', provider: 'test', model: '参数未填写', configured: true, contextReady: false, contextWindow: null, maxOutputTokens: null },
  167 |     ] } }));
  168 |     await member.reload();
  169 |     await expect(selector(member).locator('option[value="unconfigured"]')).toBeDisabled();
  170 |     await expect(selector(member).locator('option[value="incomplete"]')).toBeDisabled();
  171 |     expect(forbiddenSettingsReads).toHaveLength(0);
  172 |     expect(env.lab.get(env.sessions.member[0]!.id, 'member').modelId).toBe(modelId);
  173 |     expect(env.lab.get(env.sessions.member[1]!.id, 'member').modelId).toBe('default');
  174 |     expect(env.fake.calls).toHaveLength(0);
  175 |   } finally { await env.close(); await context.close(); }
  176 | });
  177 | 
  178 | test('failed and delayed model selection stays with its conversation; busy and queued sessions cannot switch', async ({ page, browser }) => {
  179 |   test.setTimeout(60000);
  180 |   const env = await setup();
  181 |   const context = await browser.newContext();
  182 |   const member = await context.newPage();
  183 |   await env.attach(page); await env.attach(member);
  184 |   let release: (() => Promise<void>) | undefined;
  185 |   try {
  186 |     await login(page, 'admin');
  187 |     const modelId = await addModel(page);
  188 |     await page.keyboard.press('Escape');
  189 |     await login(member, 'member');
  190 |     await enter(member, 'A');
  191 |     await composer(member).fill('模型变更保留草稿');
  192 |     const modelUrl = `**/api/sessions/${env.sessions.member[0]!.id}/model`;
  193 |     await member.route(modelUrl, route => route.fulfill({ status: 503, json: { error: { code: 'TEMPORARILY_UNAVAILABLE', message: '模型选择暂时失败，请重试' } } }), { times: 1 });
  194 |     await selector(member).selectOption(modelId);
  195 |     await expect(member.getByRole('alert')).toContainText('模型选择暂时失败，请重试');
  196 |     await expect(selector(member)).toHaveValue('default');
  197 |     await expect(composer(member)).toHaveValue('模型变更保留草稿');
  198 | 
  199 |     await member.route(modelUrl, async route => { release = await env.prepareReply(route); }, { times: 1 });
  200 |     await selector(member).selectOption(modelId);
  201 |     await expect.poll(() => Boolean(release)).toBe(true);
  202 |     await enter(member, 'B');
  203 |     await composer(member).fill('等待其他会话时的 B 草稿');
  204 |     await release!(); release = undefined;
```