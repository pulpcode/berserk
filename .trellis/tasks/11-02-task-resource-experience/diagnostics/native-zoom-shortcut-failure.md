# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: model-selection.spec.ts >> thinking settings preserve legacy until an explicit supported mode is saved, without model calls
- Location: tests/e2e/model-selection.spec.ts:85:1

# Error details

```
Error: expect(received).not.toBe(expected) // Object.is equality

Expected: not 1
```

# Test source

```ts
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
  104 |     await expect(page.getByText('已保存，下次发送消息时使用新配置。', { exact: true })).toBeVisible();
  105 |     await expect(thinking).toHaveValue('high');
  106 |     expect(env.lab.modelSettings()).toMatchObject({ thinkingExplicit: true, thinkingMode: 'high', thinkingSupported: true });
  107 |     await expect(page.locator('#model-key')).toHaveValue('');
  108 |     await thinking.scrollIntoViewIfNeeded();
  109 |     await page.screenshot({ path: test.info().outputPath('model-thinking-settings-1440.png') });
  110 |     if (process.env.B3_VERIFY_BROWSER_ZOOM === 'true') {
  111 |       const before = await page.evaluate(() => ({ ratio: devicePixelRatio, width: innerWidth }));
  112 |       await page.keyboard.press('Meta+-');
  113 |       await page.waitForTimeout(500);
  114 |       const after = await page.evaluate(() => ({ ratio: devicePixelRatio, width: innerWidth }));
  115 |       await test.info().attach('native-browser-zoom-attempt', { body: JSON.stringify({ before, after }), contentType: 'application/json' });
  116 |       await page.screenshot({ path: test.info().outputPath('model-settings-native-zoom-attempt.png') });
> 117 |       expect(after.ratio).not.toBe(before.ratio);
      |                               ^ Error: expect(received).not.toBe(expected) // Object.is equality
  118 |     }
  119 |     expect(env.fake.calls).toHaveLength(0);
  120 |   } finally { await env.close(); }
  121 | });
  122 | 
  123 | test('administrators maintain the model catalog while ordinary seats select models per conversation', async ({ page, browser }) => {
  124 |   test.setTimeout(60000);
  125 |   const env = await setup();
  126 |   const context = await browser.newContext();
  127 |   const member = await context.newPage();
  128 |   await env.attach(page); await env.attach(member);
  129 |   const forbiddenSettingsReads: string[] = [];
  130 |   member.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/settings/model')) forbiddenSettingsReads.push(request.url()); });
  131 |   try {
  132 |     await login(page, 'admin');
  133 |     const modelId = await addModel(page);
  134 |     await page.getByLabel('模型 ID', { exact: true }).fill('deterministic-reviewed');
  135 |     await page.getByLabel('上下文容量（token）', { exact: true }).fill('65536');
  136 |     await page.getByLabel('最大输出能力（token）', { exact: true }).fill('4096');
  137 |     await page.getByRole('button', { name: '保存配置', exact: true }).click();
  138 |     await expect(page.getByRole('combobox', { name: '管理模型', exact: true }).locator('option:checked')).toContainText('deterministic-reviewed');
  139 |     await expect(page.locator('#model-key')).toHaveValue('');
  140 |     await page.keyboard.press('Escape');
  141 |     await expect(selector(page).locator(`option[value="${modelId}"]`)).toContainText('deterministic-reviewed');
  142 |     await selector(page).selectOption(modelId);
  143 |     await expect(selector(page)).toHaveValue(modelId);
  144 | 
  145 |     const choicesResponse = member.waitForResponse(response => new URL(response.url()).pathname === '/api/models');
  146 |     await login(member, 'member');
  147 |     const choices = await (await choicesResponse).json();
  148 |     expect(JSON.stringify(choices)).not.toContain('no-network.invalid');
  149 |     expect(JSON.stringify(choices)).not.toContain('test-catalog-key-not-a-real-secret');
  150 |     await member.getByRole('button', { name: '设置', exact: true }).click();
  151 |     await expect(member.getByRole('button', { name: '账户', exact: true })).toBeVisible();
  152 |     await expect(member.getByRole('button', { name: '模型', exact: true })).toHaveCount(0);
  153 |     await expect(member.getByRole('button', { name: '添加模型', exact: true })).toHaveCount(0);
  154 |     await expect(member.getByRole('combobox', { name: '管理模型', exact: true })).toHaveCount(0);
  155 |     await member.keyboard.press('Escape');
  156 |     await enter(member, 'A');
  157 |     await composer(member).fill('A 独立草稿');
  158 |     await selector(member).selectOption(modelId);
  159 |     await expect(selector(member)).toHaveValue(modelId);
  160 |     await expect(composer(member)).toHaveValue('A 独立草稿');
  161 |     await enter(member, 'B');
  162 |     await expect(selector(member)).toHaveValue('default');
  163 |     await composer(member).fill('B 独立草稿');
  164 |     await enter(member, 'A');
  165 |     await expect(selector(member)).toHaveValue(modelId);
  166 |     await expect(composer(member)).toHaveValue('A 独立草稿');
  167 |     await member.reload();
  168 |     await expect(selector(member)).toHaveValue(modelId);
  169 |     await expect(composer(member)).toHaveValue('A 独立草稿');
  170 |     await enter(member, 'B');
  171 |     await expect(selector(member)).toHaveValue('default');
  172 |     await expect(composer(member)).toHaveValue('B 独立草稿');
  173 |     await member.route('**/api/models', route => route.fulfill({ json: { ...choices, models: [...choices.models,
  174 |       { id: 'unconfigured', provider: 'test', model: '未配置密钥', configured: false, contextReady: true, contextWindow: 32768, maxOutputTokens: 2048 },
  175 |       { id: 'incomplete', provider: 'test', model: '参数未填写', configured: true, contextReady: false, contextWindow: null, maxOutputTokens: null },
  176 |     ] } }));
  177 |     await member.reload();
  178 |     await expect(selector(member).locator('option[value="unconfigured"]')).toBeDisabled();
  179 |     await expect(selector(member).locator('option[value="incomplete"]')).toBeDisabled();
  180 |     expect(forbiddenSettingsReads).toHaveLength(0);
  181 |     expect(env.lab.get(env.sessions.member[0]!.id, 'member').modelId).toBe(modelId);
  182 |     expect(env.lab.get(env.sessions.member[1]!.id, 'member').modelId).toBe('default');
  183 |     expect(env.fake.calls).toHaveLength(0);
  184 |   } finally { await env.close(); await context.close(); }
  185 | });
  186 | 
  187 | test('failed and delayed model selection stays with its conversation; busy and queued sessions cannot switch', async ({ page, browser }) => {
  188 |   test.setTimeout(60000);
  189 |   const env = await setup();
  190 |   const context = await browser.newContext();
  191 |   const member = await context.newPage();
  192 |   await env.attach(page); await env.attach(member);
  193 |   let release: (() => Promise<void>) | undefined;
  194 |   try {
  195 |     await login(page, 'admin');
  196 |     const modelId = await addModel(page);
  197 |     await page.keyboard.press('Escape');
  198 |     await login(member, 'member');
  199 |     await enter(member, 'A');
  200 |     await composer(member).fill('模型变更保留草稿');
  201 |     const modelUrl = `**/api/sessions/${env.sessions.member[0]!.id}/model`;
  202 |     await member.route(modelUrl, route => route.fulfill({ status: 503, json: { error: { code: 'TEMPORARILY_UNAVAILABLE', message: '模型选择暂时失败，请重试' } } }), { times: 1 });
  203 |     await selector(member).selectOption(modelId);
  204 |     await expect(member.getByRole('alert')).toContainText('模型选择暂时失败，请重试');
  205 |     await expect(selector(member)).toHaveValue('default');
  206 |     await expect(composer(member)).toHaveValue('模型变更保留草稿');
  207 | 
  208 |     await member.route(modelUrl, async route => { release = await env.prepareReply(route); }, { times: 1 });
  209 |     await selector(member).selectOption(modelId);
  210 |     await expect.poll(() => Boolean(release)).toBe(true);
  211 |     await enter(member, 'B');
  212 |     await composer(member).fill('等待其他会话时的 B 草稿');
  213 |     await release!(); release = undefined;
  214 |     await expect(selector(member)).toHaveValue('default');
  215 |     await expect(composer(member)).toHaveValue('等待其他会话时的 B 草稿');
  216 |     await enter(member, 'A');
  217 |     await expect(selector(member)).toHaveValue(modelId);
```