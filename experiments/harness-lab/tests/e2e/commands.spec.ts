import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import { parseBackgroundConfig } from '../../src/background/config';
import { BackgroundStore } from '../../src/background/store';
import type { AuthSession } from '../../src/contracts/access';
import type { CommandRecord } from '../../src/contracts/commands';
import type { ScenarioDefinitions, ScenarioInstances, ScenarioMutationResult } from '../../src/contracts/scenarios';
import type { ContextConfig } from '../../src/context/config';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import { createMockContextServer } from '../../scripts/mock-context/server';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';

const director = 'seat-director', overall = 'seat-overall', planning = 'seat-planning', control = 'seat-control';
const names: Record<string, string> = { [director]: '导演席', [overall]: '总体席', [planning]: '筹划席', [control]: '控制席' };
const password = 'command-browser-test-password';

async function apiLogin(app: FastifyInstance, seatId: string) {
  const boot = await app.inject('/api/auth/session');
  const result = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { cookie: boot.cookies.map(item => `${item.name}=${item.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': boot.json<AuthSession>().csrf! }, payload: { seatId, password } });
  expect(result.statusCode, result.body).toBe(200);
  const auth = result.json<AuthSession>();
  return async <T,>(url: string, payload?: object): Promise<T> => {
    const response = await app.inject({ method: payload === undefined ? 'GET' : 'POST', url, headers: { cookie: result.cookies.map(item => `${item.name}=${item.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': auth.csrf!, 'x-axon-view': auth.viewId! }, ...(payload === undefined ? {} : { payload }) });
    expect(response.statusCode, response.body).toBe(200); return response.json<T>();
  };
}

/** Browser uses real authenticated APIs, SQLite and the actual HTTP source. Model calls are not needed. */
async function setup(context: BrowserContext) {
  await context.addInitScript(() => { Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true }); });
  const dir = await mkdtemp(join(tmpdir(), 'axon-command-browser-'));
  const env = { QUERY: 'command-test-query', CONTROL: 'command-test-control', INTEL: 'command-test-intel-token', SITUATION: 'command-test-situation-token' };
  const source = createMockContextServer({ token: env.QUERY, controlToken: env.CONTROL, scenariosEnabled: true, databasePath: join(dir, 'source.sqlite'), targets: [] });
  const sourceUrl = await source.listen();
  const dataDir = join(dir, 'axon'), db = await openDatabase(dataDir), access = new AccessStore(db);
  for (const seatId of [director, overall, planning, control]) await access.saveAccount({ username: seatId, displayName: names[seatId], seatId, seatName: names[seatId], password, createPublicTask: seatId === director || seatId === overall, manageModelSettings: false, controlScenarios: seatId === director });
  db.close();
  const config = testConfig(dataDir, { seatId: overall, auth: { secret: 'commands-browser-signing-secret-long-enough', sessionMs: 28800000 } });
  const fake = await fakeRuntime(config, () => ({ text: '本测试无需模型分析。' }));
  const lab = await PiLab.create(config, fake.runtime);
  const background = parseBackgroundConfig({ enabled: true, sources: ['intel', 'situation'].map(systemId => ({ sourceId: `${systemId}-source`, systemId, name: systemId, credentialRef: systemId === 'intel' ? 'INTEL' : 'SITUATION', allowedProfileIds: ['analysis'], allowedRecipientSeatIds: [overall, planning, control] })), profiles: [{ id: 'analysis', name: '核对', goal: '本测试未启用分析规则', tools: ['source_read'] }] });
  const contextConfig: ContextConfig = { systems: [
    { id: 'intel', name: '特情系统', adapter: 'mock-information-http', baseUrl: `${sourceUrl}/intel`, tokenEnv: 'QUERY', scenarioClock: true },
    { id: 'situation', name: '态势系统', adapter: 'mock-situation-http', baseUrl: `${sourceUrl}/situation`, tokenEnv: 'QUERY', scenarioClock: true },
  ], scopes: [{ id: 'demo', name: '业务资料', systemIds: ['intel', 'situation'], seatIds: [director, overall, planning, control] }], commands: { enabled: true, seatIds: [control] }, simulation: { enabled: true, baseUrl: sourceUrl, tokenEnv: 'CONTROL', directorSeatId: director, sources: [{ systemId: 'intel', sourceId: 'intel-source' }, { systemId: 'situation', sourceId: 'situation-source' }] } };
  const app = await createApp(lab, false, { config: background, env }, { config: contextConfig, env });
  const store = new BackgroundStore(lab.access!.db);
  for (const sourceId of ['intel-source', 'situation-source']) store.grant('seat', director, sourceId, 'view');
  const call = await apiLogin(app, director);
  const definition = (await call<ScenarioDefinitions>('/api/simulation/scenarios')).items[0];
  const created = await call<ScenarioMutationResult>('/api/simulation/instances', { definitionId: definition.id, version: definition.version, mode: 'source_replay', clientActionId: randomUUID() });
  await call(`/api/simulation/instances/${created.instance.instanceId}/initialize`, { clientActionId: randomUUID() });
  const runs = await call<ScenarioInstances>('/api/simulation/instances');
  await call(`/api/simulation/instances/${created.instance.instanceId}/activate`, { clientActionId: randomUUID(), expectedRevision: created.instance.revision, expectedActiveRevision: runs.activeRevision });
  const actor = lab.access!.identityForSeat(director)!;
  const task = lab.access!.create(actor, { title: '临港仓库支援', goal: '核实资源并组织仓库支援。', visibility: 'public', clientActionId: randomUUID() }, created.instance.instanceId);
  const workspace = await lab.workspaces.ensureWorkspace(task.id, overall, task.title);
  await writeFile(join(lab.files.filesDirectory(workspace.id, overall), '任务书.md'), '# 支援要求\n形成车辆与路线安排。');
  const requests: string[] = [];
  const network = { loseCommit: false, losePrepare: false };
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()); requests.push(`${request.method()} ${url.pathname}`);
    const response = await app.inject({ method: request.method() as 'GET' | 'POST' | 'PUT' | 'DELETE', url: url.pathname + url.search, headers: { ...await request.allHeaders(), host: '127.0.0.1', origin: 'http://localhost:4310' }, ...(request.postDataBuffer() ? { payload: request.postDataBuffer()! } : {}) });
    if (network.loseCommit && request.method() === 'POST' && /^\/api\/commands\/[^/]+\/commit$/.test(url.pathname)) { network.loseCommit = false; await route.abort('failed'); return; }
    if (network.losePrepare && url.pathname === '/api/commands/prepare') { network.losePrepare = false; await route.abort('failed'); return; }
    await route.fulfill({ status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])), body: response.rawPayload });
  });
  return { app, lab, fake, source, task, workspace, network, requests, call, dir, close: async () => { await context.unrouteAll({ behavior: 'wait' }); await app.close(); await source.close(); await rm(dir, { recursive: true, force: true }); } };
}

async function login(page: Page, seat: string) {
  page.setDefaultTimeout(15000);
  await page.context().clearCookies(); await page.goto('/');
  await page.getByLabel('席位', { exact: true }).selectOption(seat);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
}
async function openTask(page: Page, id: string) {
  await page.goto(`/tasks/${id}/information`);
  await expect(page.getByRole('heading', { name: '临港仓库支援', exact: true })).toBeVisible();
}
async function inbox(page: Page) { await page.getByRole('button', { name: '工作待办', exact: true }).click(); }
async function confirmWork(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: '确认执行交接' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '查看工作' }).click();
}
async function prepareCommand(page: Page, withAttachment: boolean) {
  await page.getByRole('button', { name: '下达指令', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '下达指令', exact: true });
  await panel.getByRole('checkbox', { name: /V01/ }).check();
  await panel.getByLabel('目的地').selectOption({ label: '临港三号仓库' });
  if (withAttachment) await panel.getByLabel('方案附件（可选）').selectOption({ index: 1 });
  await panel.getByLabel('执行说明（可选）').fill('按交接内容核对并下达。');
  await panel.getByRole('button', { name: '核对指令', exact: true }).click();
}

test('three business seats submit, return, accept and hand off a fixed document before a real command receipt', async ({ page, context }) => {
  test.setTimeout(150000);
  const f = await setup(context);
  try {
    await login(page, overall); await openTask(page, f.task.id);
    await expect(page.getByRole('button', { name: '下达指令', exact: true })).toHaveCount(0);
    await inbox(page); await page.getByRole('button', { name: '分派工作', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('选择项目').selectOption(f.workspace.id);
    await dialog.getByLabel('工作标题').fill('编写支援安排'); await dialog.getByLabel('工作目标').fill('形成支援车辆和路线安排。');
    await dialog.getByLabel('接收席位').selectOption(planning);
    await dialog.getByRole('checkbox', { name: /任务书.md/ }).check();
    await dialog.getByRole('button', { name: '核对分派内容' }).click(); await confirmWork(page);
    const work = f.lab.collaboration!.list({ seatId: overall }).find(item => item.title === '编写支援安排')!;
    await login(page, planning); await inbox(page);
    await page.getByRole('button', { name: /编写支援安排.*待签收/ }).click();
    await page.getByRole('button', { name: '开始办理', exact: true }).click(); await confirmWork(page);
    const workspace = f.lab.workspaces.list(planning).workspaces.find(item => item.taskSpaceId === f.task.id)!;
    const planPath = join(f.lab.files.filesDirectory(workspace.id, planning), '支援安排.md');
    await writeFile(planPath, '# 初稿\n安排V01支援。');
    await page.getByRole('button', { name: '提交文件', exact: true }).click();
    await page.getByRole('radio', { name: /支援安排.md/ }).check(); await page.getByRole('button', { name: '预览提交内容' }).click(); await confirmWork(page);
    await login(page, overall); await inbox(page);
    await page.getByRole('button', { name: /编写支援安排.*待我验收/ }).click();
    await page.getByRole('button', { name: '退回修改', exact: true }).click(); await page.getByLabel('退回意见').fill('补充目的地。');
    await page.getByRole('button', { name: '核对退回意见' }).click(); await confirmWork(page);
    await login(page, planning); await inbox(page); await page.getByRole('button', { name: /编写支援安排.*待修改/ }).click();
    const finalText = '# 支援安排\nV01前往临港三号仓库，路线由控制席核对。';
    await writeFile(planPath, finalText);
    await page.getByRole('button', { name: '提交文件', exact: true }).click(); await page.getByRole('radio', { name: /支援安排.md/ }).check();
    await page.getByRole('button', { name: '预览提交内容' }).click(); await confirmWork(page);
    await login(page, overall); await inbox(page); await page.getByRole('button', { name: /编写支援安排.*待我验收/ }).click();
    await page.getByRole('button', { name: '验收通过', exact: true }).click(); await confirmWork(page);
    const completed = f.lab.collaboration!.read({ seatId: overall }, work.id);
    const submitted = completed.submissions.at(-1)!;
    await page.getByText('复制到我的项目文件', { exact: true }).last().click();
    await page.getByLabel('另存路径（可选）').last().fill('支援安排.md');
    await page.getByRole('button', { name: '确认复制', exact: true }).last().click();
    await expect(page.getByRole('status').filter({ hasText: '已复制到项目文件' })).toBeVisible();
    await page.getByRole('button', { name: '分派工作', exact: true }).click(); dialog = page.getByRole('dialog');
    await dialog.getByLabel('选择项目').selectOption(f.workspace.id);
    await dialog.getByLabel('工作标题').fill('执行支援安排'); await dialog.getByLabel('工作目标').fill('核对交接方案并下达指令。');
    await dialog.getByLabel('接收席位').selectOption(control); await dialog.getByRole('checkbox', { name: /支援安排.md/ }).check();
    await dialog.getByRole('button', { name: '核对分派内容' }).click(); await confirmWork(page);
    await login(page, control); await inbox(page); await page.getByRole('button', { name: /执行支援安排.*待签收/ }).click();
    await page.getByRole('button', { name: '开始办理', exact: true }).click(); await confirmWork(page);
    const execution = f.lab.collaboration!.list({ seatId: control }).find(item => item.title === '执行支援安排')!;
    const receivedFile = f.lab.collaboration!.read({ seatId: control }, execution.id).inputFiles[0];
    expect(receivedFile.hash).toBe(submitted.file.hash);
    const imported = await f.lab.collaboration!.openFile({ seatId: control }, receivedFile.fileId);
    let fileText = ''; for await (const part of imported.stream) fileText += part;
    expect(fileText).toBe(finalText);
    await openTask(page, f.task.id); await prepareCommand(page, true);
    await expect(page.getByRole('dialog', { name: '指令详情' })).toContainText('支援安排.md');
    await page.screenshot({ path: test.info().outputPath('command-confirmation.png') });
    await page.getByRole('button', { name: '确认下达', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('status')).toHaveText('已接收');
    await page.screenshot({ path: test.info().outputPath('command-received.png') });
    expect(f.source.requests.filter(item => item.path === '/control/commands' && item.method === 'POST')).toHaveLength(1);
    expect(f.fake.calls).toHaveLength(0);
    expect(completed.state).toBe('completed');
  } finally { await page.goto('about:blank'); await f.close(); }
});

test('control seat can issue without an approval or attachment and recovers a lost response by querying', async ({ page, context }) => {
  test.setTimeout(100000);
  const f = await setup(context);
  try {
    await login(page, control); await openTask(page, f.task.id); await prepareCommand(page, false);
    f.network.loseCommit = true;
    await page.getByRole('button', { name: '确认下达', exact: true }).click();
    await expect(page.getByRole('button', { name: '查询接收回执' })).toBeVisible();
    await page.getByRole('button', { name: '查询接收回执' }).click();
    await expect(page.getByRole('dialog').getByRole('status')).toHaveText('已接收');
    const commands = await (await apiLogin(f.app, control))<CommandRecord[]>(`/api/commands?taskId=${f.task.id}`);
    expect(commands).toHaveLength(1); expect(commands[0].attachment).toBeUndefined();
    expect(f.lab.collaboration!.list({ seatId: control })).toHaveLength(0);
    expect(f.requests.filter(item => /^POST \/api\/commands\/[^/]+\/commit$/.test(item))).toHaveLength(1);
    expect(f.source.requests.filter(item => item.path === '/control/commands' && item.method === 'POST')).toHaveLength(1);
  } finally { await page.goto('about:blank'); await f.close(); }
});

test('a lost preparation is recovered after reload and cancellation sends no command', async ({ page, context }) => {
  test.setTimeout(100000);
  const f = await setup(context);
  try {
    await login(page, control); await openTask(page, f.task.id);
    f.network.losePrepare = true; await prepareCommand(page, false);
    await expect(page.getByRole('button', { name: '查询准备结果', exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: '核对下达结果', exact: true }).click();
    await expect(page.getByRole('button', { name: '取消本次下达', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '取消本次下达', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('status')).toHaveText('已取消');
    expect(f.requests.filter(item => item === 'POST /api/commands/prepare')).toHaveLength(1);
    expect(f.source.requests.filter(item => item.path === '/control/commands' && item.method === 'POST')).toHaveLength(0);
  } finally { await page.goto('about:blank'); await f.close(); }
});
