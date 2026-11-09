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
import type { ScenarioDefinitions, ScenarioInstances, ScenarioMutationResult, ScenarioInstanceDetail } from '../../src/contracts/scenarios';
import type { ContextConfig } from '../../src/context/config';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import { createMockContextServer } from '../../scripts/mock-context/server';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';
import type { NotificationTarget } from '../../scripts/mock-context/control-api';
import { basemapFixture, captureMap, localVectorTiles } from './basemap-fixtures';

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
async function setup(context: BrowserContext, version='6') {
  await context.addInitScript(() => { Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true }); });
  const dir = await mkdtemp(join(tmpdir(), 'axon-command-browser-'));
  const env = { QUERY: 'command-test-query', CONTROL: 'command-test-control', INTEL: 'command-test-intel-token', SITUATION: 'command-test-situation-token' };
  const targets: NotificationTarget[] = [];
  const source = createMockContextServer({ token: env.QUERY, controlToken: env.CONTROL, scenariosEnabled: true, databasePath: join(dir, 'source.sqlite'), targets });
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
  const appUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  targets.push({systemId:'intel',sourceId:'intel-source',url:appUrl,token:env.INTEL},{systemId:'situation',sourceId:'situation-source',url:appUrl,token:env.SITUATION});
  const store = new BackgroundStore(lab.access!.db);
  for (const id of ['intel-source', 'situation-source']) store.grant('seat', overall, id, 'manage');
  for (const sourceId of ['intel-source', 'situation-source']) store.grant('seat', director, sourceId, 'view');
  const call = await apiLogin(app, director);
  const definition = (await call<ScenarioDefinitions>('/api/simulation/scenarios')).items.find(item => item.version === version)!;
  expect(definition).toBeDefined();
  const created = await call<ScenarioMutationResult>('/api/simulation/instances', { definitionId: definition.id, version: definition.version, mode: 'source_replay', clientActionId: randomUUID() });
  await call(`/api/simulation/instances/${created.instance.instanceId}/initialize`, { clientActionId: randomUUID() });
  const runs = await call<ScenarioInstances>('/api/simulation/instances');
  await call(`/api/simulation/instances/${created.instance.instanceId}/activate`, { clientActionId: randomUUID(), expectedRevision: created.instance.revision, expectedActiveRevision: runs.activeRevision });
  const actor = lab.access!.identityForSeat(director)!;
  const ref = (id: string, objectType = 'resource') => ({ systemId: 'situation', objectType, objectId: `${created.instance.instanceId}-${id}` });
  const refs = ['V01','V03','V06','V07','V08','V11','V13','L01'].map(id => ref(id));
  const task = lab.access!.create(actor, { context: { businessRefs: refs }, title: '临港仓库支援', goal: '核实资源并组织仓库支援。', visibility: 'public', clientActionId: randomUUID() }, created.instance.instanceId);
  const workspace = await lab.workspaces.ensureWorkspace(task.id, overall, task.title);
  await writeFile(join(lab.files.filesDirectory(workspace.id, overall), '任务书.md'), '# 支援要求\n形成车辆与路线安排。');
  const requests: string[] = [];
  const network = { loseCommit: false, losePrepare: false };
  const contexts: BrowserContext[] = [];
  async function connect(target: BrowserContext) {
    contexts.push(target);
    await target.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()); requests.push(`${request.method()} ${url.pathname}`);
    const response = await app.inject({ method: request.method() as 'GET' | 'POST' | 'PUT' | 'DELETE', url: url.pathname + url.search, headers: { ...await request.allHeaders(), host: '127.0.0.1', origin: 'http://localhost:4310' }, ...(request.postDataBuffer() ? { payload: request.postDataBuffer()! } : {}) });
    if (url.pathname === '/api/context/map-config' && response.statusCode === 200) { await route.fulfill({ json: { ...response.json(), ...basemapFixture(url.origin), defaultView: 'road' } }); return; }
    if (network.loseCommit && request.method() === 'POST' && /^\/api\/commands\/[^/]+\/commit$/.test(url.pathname)) { network.loseCommit = false; await route.abort('failed'); return; }
    if (network.losePrepare && url.pathname === '/api/commands/prepare') { network.losePrepare = false; await route.abort('failed'); return; }
    await route.fulfill({ status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])), body: response.rawPayload });
    });
  }
  await connect(context);
  return { app, lab, fake, source, store, task, workspace, network, requests, call, dir, connect, runId: created.instance.instanceId, close: async () => {
    for (const target of contexts) {
      for (const page of target.pages()) if (!page.isClosed()) await page.goto('about:blank');
      await target.unrouteAll({ behavior: 'wait' });
    }
    await app.close(); await source.close(); await rm(dir, { recursive: true, force: true });
  } };
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

type Fixture = Awaited<ReturnType<typeof setup>>;
const detail = (f: Fixture) => f.call<ScenarioInstanceDetail>(`/api/simulation/instances/${f.runId}`);
async function advanceOne(page: Page, f: Fixture) {
  const before = await detail(f);
  const accepted = before.actions.filter(action => action.sendState === 'accepted').length;
  const stepId = before.actions.find(action => action.sendState !== 'accepted')?.stepId || before.timeline?.find(step => step.state === 'pending')?.id;
  const button = page.locator('.director-delivery').getByRole('button', { name: /^(投放事件|推进节点|继续投放|核对接收回执)$/ });
  await expect(button).toBeEnabled(); await button.click();
  await expect.poll(async () => {
    const state = await detail(f);
    return state.instance.revision > before.instance.revision || state.actions.filter(action => action.sendState === 'accepted').length > accepted;
  }).toBe(true);
  await expect.poll(async () => (await detail(f)).actions.filter(action => action.stepId === stepId && action.sendState !== 'accepted').length).toBe(0);
}
async function advanceUntil(page: Page, f: Fixture, ready: (state: ScenarioInstanceDetail) => boolean) {
  for (let index = 0; index < 100; index++) {
    const state = await detail(f);
    if (ready(state) && state.actions.every(action => action.sendState === 'accepted')) return;
    await advanceOne(page, f);
  }
  throw new Error('导演推进未达到预期节点');
}
async function sendCommand(page: Page, vehicles: string[], roads: string[]) {
  await page.getByRole('button', { name: '下达指令', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '下达指令', exact: true });
  await expect(dialog.getByRole('checkbox', { name: /^V01 / })).toBeVisible();
  const checked = dialog.locator('input[type="checkbox"]:checked');
  while (await checked.count()) await checked.first().uncheck();
  for (const id of vehicles) await dialog.getByRole('checkbox', { name: new RegExp(`^${id} `) }).check();
  await dialog.getByLabel('目的地').selectOption({ label: '临港三号仓库' });
  for (const road of roads) await dialog.getByRole('checkbox', { name: road, exact: true }).check();
  await dialog.getByRole('button', { name: '核对指令', exact: true }).click();
  await page.getByRole('button', { name: '确认下达', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('已接收');
  await page.getByRole('button', { name: '查询进展', exact: true }).click();
}
async function closePanel(page: Page) { await page.getByRole('dialog').getByRole('button', { name: '关闭面板', exact: true }).click(); }

test('director nodes drive real vehicle movement, bridge blockage, confirmed reroute and source map trails', async ({ page: directorPage, context, browser }) => {
  test.setTimeout(240000);
  const f = await setup(context);
  const controlContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const overallContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await f.connect(controlContext); await f.connect(overallContext);
  const controlPage = await controlContext.newPage(), overallPage = await overallContext.newPage();
  await captureMap(controlPage); await localVectorTiles(controlPage);
  let page = directorPage;
  try {
    const readControl = await apiLogin(f.app, control);
    await login(page, director); await page.goto('/scenario-director');
    await advanceUntil(page, f, state => state.instance.businessNow.slice(11, 16) === '09:18');
    expect((await detail(f)).timeline?.filter(step => step.kind === 'execution')).toHaveLength(0);
    page = controlPage;
    await login(page, control); await openTask(page, f.task.id);
    await sendCommand(page, ['V01', 'V03', 'V06'], ['滨港路']); await closePanel(page);
    await sendCommand(page, ['V07', 'V08', 'V11', 'V13'], ['中轴桥', '滨港路']);
    let records = await readControl<CommandRecord[]>(`/api/commands?taskId=${f.task.id}`);
    const cross = records.find(item => item.command.vehicles.length === 4)!;
    const local = records.find(item => item.command.vehicles.length === 3)!;
    await closePanel(page);
    page = directorPage; await page.goto('/scenario-director');
    await advanceUntil(page, f, state => state.instance.businessNow.slice(11, 16) === '09:23');
    const blocked = await readControl<CommandRecord>(`/api/commands/${cross.id}/execution`);
    const arrived = await readControl<CommandRecord>(`/api/commands/${local.id}/execution`);
    expect(blocked.execution?.vehicles.map(vehicle => vehicle.state)).toEqual(['blocked', 'blocked', 'blocked', 'blocked']);
    expect(arrived.execution?.vehicles.every(vehicle => vehicle.state === 'arrived')).toBe(true);
    expect((await detail(f)).timeline?.filter(step => step.kind === 'execution').every(step => step.businessTime.endsWith('+08:00'))).toBe(true);
    const executionNode = page.locator('li[data-kind="execution"] .director-step-toggle').first();
    await executionNode.hover({ position: { x: 12, y: 12 } });
    await expect(executionNode).toHaveAttribute('aria-expanded', 'true');
    await page.screenshot({ path: test.info().outputPath('director-execution-nodes.png') });
    await advanceUntil(page, f, state => state.instance.businessNow.slice(11, 16) >= '09:25');
    const stillBlocked = await readControl<CommandRecord>(`/api/commands/${cross.id}/execution`);
    expect(stillBlocked.execution?.vehicles.every(vehicle => vehicle.state === 'blocked')).toBe(true);
    page = overallPage; await login(page, overall); await page.goto('/overview?tab=events');
    const feedback = f.store.listEvents().find(event => /道路封闭，等待调整/.test(event.title));
    expect(feedback).toBeDefined();
    await expect(page.getByText(feedback!.title, { exact: true }).first()).toBeVisible();
    page = controlPage; await openTask(page, f.task.id);
    await page.getByRole('button', { name: /^4 辆车/ }).click();
    await expect(page.getByRole('region', { name: '逐车进展' })).toContainText('受阻');
    await page.screenshot({ path: test.info().outputPath('command-blocked.png') });
    await page.getByRole('button', { name: '调整路线', exact: true }).click();
    const adjust = page.getByRole('dialog', { name: '调整路线', exact: true });
    await adjust.getByRole('checkbox', { name: '东环线', exact: true }).check();
    await adjust.getByRole('checkbox', { name: '滨港路', exact: true }).check();
    await adjust.getByRole('button', { name: '核对指令', exact: true }).click();
    await page.getByRole('button', { name: '确认调整路线', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('status')).toHaveText('已接收');
    await closePanel(page);
    page = directorPage; await page.goto('/scenario-director');
    await advanceUntil(page, f, state => !state.timeline?.some(step => step.state === 'pending'));
    const finished = await readControl<CommandRecord>(`/api/commands/${cross.id}/execution`);
    expect(finished.execution?.vehicles.every(vehicle => vehicle.state === 'arrived')).toBe(true);
    expect(finished.execution?.history.map(item => item.action)).toEqual(['dispatch', 'reroute']);
    expect((await readControl<CommandRecord>(`/api/commands/${local.id}/execution`)).execution?.vehicles.map(vehicle => vehicle.arrivedAt)).toEqual(arrived.execution?.vehicles.map(vehicle => vehicle.arrivedAt));
    page = controlPage;
    await openTask(page, f.task.id);
    await page.getByRole('button', { name: /^4 辆车/ }).first().click();
    await expect(page.getByRole('region', { name: '逐车进展' })).toContainText('已到场');
    await page.screenshot({ path: test.info().outputPath('command-arrived.png') });
    await closePanel(page);
    await page.goto(`/tasks/${f.task.id}/information?tab=situation`);
    await expect(page.locator('.situation-canvas')).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean(window.__basemapTestMap?.getSource('business:execution-tracks')))).toBe(true);
    const rendered = await page.evaluate(() => window.__basemapTestMap!.getStyle().sources['business:execution-tracks']);
    expect(rendered.type).toBe('geojson');
    if (rendered.type !== 'geojson' || typeof rendered.data === 'string' || rendered.data?.type !== 'FeatureCollection') throw new Error('地图轨迹来源未装载');
    expect(rendered.data.features.length).toBeGreaterThanOrEqual(7);
    const source = await detail(f);
    for (const feature of rendered.data.features) {
      const object = source.objects.find(item => JSON.stringify([item.ref.systemId, item.ref.objectType, item.ref.objectId]) === feature.properties?.key);
      expect(object).toBeDefined();
      if (!object || !('executionTrack' in object.properties)) throw new Error('轨迹必须来自对应来源对象');
      expect(feature.geometry).toEqual({ type: 'LineString', coordinates: object.properties.executionTrack?.map(point => point.position) });
    }
    await expect.poll(() => page.evaluate(() => window.__basemapTestMap!.isSourceLoaded('business:execution-tracks'))).toBe(true);
    await page.evaluate(async () => {
      const map = window.__basemapTestMap!;
      await new Promise<void>(resolve => { map.once('render', () => resolve()); map.triggerRepaint(); });
    });
    await page.screenshot({ path: test.info().outputPath('source-execution-trails.png') });
    await page.setViewportSize({ width: 1100, height: 760 });
    await expect(page.locator('.situation-canvas')).toBeVisible();
    records = await readControl<CommandRecord[]>(`/api/commands?taskId=${f.task.id}`);
    expect(records).toHaveLength(3); expect(f.fake.calls).toHaveLength(0);
  } finally { await f.close(); await controlContext.close(); await overallContext.close(); }
});

test('received refusal is distinct, cancellation is confirmed and uncertain reception only queries', async ({ page, context }) => {
  test.setTimeout(120000);
  const f = await setup(context);
  try {
    await login(page, control); await openTask(page, f.task.id);
    await sendCommand(page, ['V02'], ['中轴桥', '滨港路']);
    await expect(page.getByRole('dialog')).toContainText('未受理');
    await closePanel(page);
    await sendCommand(page, ['V01'], ['滨港路']);
    await expect(page.getByRole('region', { name: '逐车进展' })).toContainText('待出发');
    await page.getByRole('button', { name: '取消行动', exact: true }).click();
    await page.getByRole('button', { name: '核对取消内容', exact: true }).click();
    f.network.loseCommit = true;
    await page.getByRole('button', { name: '确认取消行动', exact: true }).click();
    await expect(page.getByRole('button', { name: '查询接收回执', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '查询接收回执', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('status')).toHaveText('已接收');
    await page.getByRole('button', { name: '查询进展', exact: true }).click();
    await expect(page.getByRole('region', { name: '逐车进展' })).toContainText('已取消');
    expect(f.requests.filter(request => /POST \/api\/commands\/[^/]+\/commit$/.test(request))).toHaveLength(3);
    const old = await detail(f);
    expect(old.instance.businessNow.slice(11, 16)).toBe('09:10');
    expect(f.fake.calls).toHaveLength(0);
  } finally { await page.goto('about:blank'); await f.close(); }
});

test('a new rehearsal starts with separate commands and old progress stays unchanged', async ({ page, context }) => {
  test.setTimeout(100000);
  const f = await setup(context);
  try {
    const readControl = await apiLogin(f.app, control);
    await login(page, control); await openTask(page, f.task.id);
    await sendCommand(page, ['V01'], ['滨港路']);
    const original = (await readControl<CommandRecord[]>(`/api/commands?taskId=${f.task.id}`))[0];
    const before = await readControl<CommandRecord>(`/api/commands/${original.id}/execution`);
    const old = await detail(f);
    await f.call(`/api/simulation/instances/${f.runId}/control`, { clientActionId: randomUUID(), expectedRevision: old.instance.revision, action: 'pause' });
    const created = await f.call<ScenarioMutationResult>('/api/simulation/instances', { definitionId: 'harbor-fire', version: '6', mode: 'source_replay', clientActionId: randomUUID() });
    await f.call(`/api/simulation/instances/${created.instance.instanceId}/initialize`, { clientActionId: randomUUID() });
    const instances = await f.call<ScenarioInstances>('/api/simulation/instances');
    await f.call(`/api/simulation/instances/${created.instance.instanceId}/activate`, { clientActionId: randomUUID(), expectedRevision: created.instance.revision, expectedActiveRevision: instances.activeRevision, terminateUnsent: true });
    const task = f.lab.access!.create(f.lab.access!.identityForSeat(director)!, { title: '临港仓库支援', goal: '重新核实并组织本次支援。', visibility: 'public', clientActionId: randomUUID() }, created.instance.instanceId);
    await page.goto(`/tasks/${task.id}/information`);
    await expect(page.getByRole('region', { name: '指令记录' })).toContainText('暂无指令');
    await sendCommand(page, ['V01'], ['滨港路']);
    await expect(page.getByRole('region', { name: '逐车进展' })).toContainText('待出发');
    const next = await readControl<CommandRecord[]>(`/api/commands?taskId=${task.id}`);
    expect(next).toHaveLength(1); expect(next[0].id).not.toBe(original.id);
    expect((await readControl<CommandRecord>(`/api/commands/${original.id}/execution`)).execution?.vehicles).toEqual(before.execution?.vehicles);
  } finally { await page.goto('about:blank'); await f.close(); }
});

test('scenario selector distinguishes definition versions and can start the legacy version', async ({ page, context }) => {
  test.setTimeout(100000);
  const f = await setup(context);
  try {
    await login(page, director); await page.goto('/scenario-director');
    await page.getByRole('button', { name: '重新演示', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '重新演示', exact: true });
    const scenario = panel.getByLabel('场景');
    await expect(scenario.locator('option')).toHaveText(['临港仓储火情 · v7', '临港仓储火情 · v6', '临港仓储火情 · v5', '临港仓储火情 · v4']);
    await scenario.selectOption('harbor-fire@4');
    await panel.getByRole('button', { name: '开始演示', exact: true }).click();
    await expect.poll(async () => {
      const instances = await f.call<ScenarioInstances>('/api/simulation/instances');
      return instances.items.find(item => item.instanceId === instances.activeInstanceId)?.definitionVersion;
    }).toBe('4');
    await expect(page.getByRole('button', { name: '投放事件', exact: true })).toBeEnabled();
    await expect(page.getByText('场景版本已变化', { exact: false })).toHaveCount(0);
  } finally { await page.goto('about:blank'); await f.close(); }
});

test('cancelling the remaining vehicle preserves arrival and shows an ended mixed action', async ({ page, context }) => {
  test.setTimeout(150000);
  const f = await setup(context);
  try {
    await login(page, control); await openTask(page, f.task.id);
    await sendCommand(page, ['V07', 'V13'], ['东环线', '滨港路']);
    await closePanel(page);
    await login(page, director); await page.goto('/scenario-director');
    await advanceUntil(page, f, state => {
      const states = state.objects.filter(item => ['V07', 'V13'].some(id => item.ref.objectId.endsWith(`-${id}`)))
        .map(item => 'executionState' in item.properties ? item.properties.executionState : undefined);
      return states.includes('arrived') && states.includes('en_route');
    });
    await login(page, control); await openTask(page, f.task.id);
    await page.getByRole('button', { name: /^2 辆车/ }).click();
    await page.getByRole('button', { name: '取消行动', exact: true }).click();
    const cancel = page.getByRole('dialog', { name: '取消行动', exact: true });
    await expect(cancel.getByRole('checkbox', { name: /^V13 / })).toBeChecked();
    await expect(cancel.getByRole('checkbox', { name: /^V07 / })).toHaveCount(0);
    await cancel.getByRole('button', { name: '核对取消内容', exact: true }).click();
    await page.getByRole('button', { name: '确认取消行动', exact: true }).click();
    await page.getByRole('button', { name: '查询进展', exact: true }).click();
    const execution = page.getByRole('region', { name: '执行进展', exact: true });
    await expect(execution).toContainText('本指令行动已结束');
    await expect(execution.getByRole('row', { name: /^V07 / })).toContainText('已到场');
    await expect(execution.getByRole('row', { name: /^V13 / })).toContainText('已取消');
    await expect(execution).not.toContainText('本指令车辆已到场');
    await page.screenshot({ path: test.info().outputPath('mixed-terminal-progress.png') });
  } finally { await page.goto('about:blank'); await f.close(); }
});


test('v7 advances once while two business maps join the shared live journey',async({page,context,browser})=>{
  test.setTimeout(180000);
  const f=await setup(context,'7');
  const viewers=await Promise.all([browser.newContext({recordVideo:{dir:test.info().outputPath('control-video')}}),browser.newContext({recordVideo:{dir:test.info().outputPath('overall-video')}})]);
  try{
    await login(page,director);await page.goto('/scenario-director');
    await advanceUntil(page,f,state=>state.instance.stepIndex>=5);
    const pages:Page[]=[];
    for(const [index,viewer] of viewers.entries()){
      await f.connect(viewer);const map=await viewer.newPage();await captureMap(map);await localVectorTiles(map);await login(map,index===0?control:overall);await map.goto('/situation');pages.push(map);
      await expect.poll(()=>map.evaluate(()=>{const source=window.__basemapTestMap?.getStyle()?.sources['business:objects'];return Boolean(source&&'data' in source&&typeof source.data==='object'&&'features' in source.data&&source.data.features.length);})).toBe(true);
      await map.evaluate(()=>window.__basemapTestMap!.fitBounds([[121.8627,30.8822],[121.8646,30.8846]],{padding:60,duration:0}));
    }
    const ref=(code:string)=>({systemId:'situation' as const,objectType:code[0]==='R'?'road':'resource',objectId:`${f.runId}-${code}`});
    await expect.poll(()=>pages[0].evaluate(()=>window.__basemapTestMap!.queryRenderedFeatures({layers:['business:symbols']}).length)).toBeGreaterThan(0);
    await expect(pages[0].locator('.source-point-label')).toContainText(['同位置记录']);
    await pages[0].screenshot({path:test.info().outputPath('source-category-icons.png')});
    const command={vehicles:[ref('V01'),ref('V06')],route:[ref('R03')],destination:ref('L01')};
    // The same authorized control-page API and explicit confirmation as the normal UI.
    const call=await apiLogin(f.app,control);
    const workspace=await f.lab.workspaces.ensureWorkspace(f.task.id,control,f.task.title);
    const prepared=await call<CommandRecord>('/api/commands/prepare',{workspaceId:workspace.id,clientActionId:randomUUID(),command});
    await call(`/api/commands/${prepared.id}/commit`,{confirm:true});
    await page.reload();await advanceOne(page,f); // departure, no travel yet
    const samples:number[][][]=[[],[]];
    const sample=async()=>{for(const [index,map] of pages.entries()){
      const point=await map.evaluate((id)=>{const source=window.__basemapTestMap?.getStyle()?.sources['business:objects'];if(!source||!('data' in source)||typeof source.data!=='object')return;const data=source.data as {features?:Array<{properties?:{key?:string};geometry?:{type:string;coordinates:number[]}}>};return data.features?.find(feature=>feature.properties?.key?.includes(id))?.geometry?.coordinates;},`${f.runId}-V01`);
      if(point)samples[index].push(point);
    }};
    const button=page.locator('.director-delivery').getByRole('button',{name:'推进节点',exact:true});await expect(button).toBeEnabled();await button.click();
    for(let i=0;i<12;i++){await sample();await new Promise(resolve=>setTimeout(resolve,350));}
    await expect.poll(async()=>Boolean((await detail(f)).instance.advancing)).toBe(false);
    for(const points of samples)expect(new Set(points.map(point=>JSON.stringify(point))).size).toBeGreaterThan(3);
    await test.info().attach('map-motion-samples',{body:JSON.stringify(samples),contentType:'application/json'});
    await pages[0].locator('.source-point-label button').filter({hasText:/^V01 /}).click();
    await expect(pages[0].getByRole('heading',{name:'V01 水罐车',exact:true})).toBeVisible();
    await expect.poll(()=>pages[0].evaluate((id)=>{
      const map=window.__basemapTestMap!,feature=map.queryRenderedFeatures({layers:['business:symbols']}).find(feature=>String(feature.properties?.key).includes(id));
      return feature?.properties?.image;
    },`${f.runId}-V01`)).toBe('annotation-symbol:xf3013-2020.6.2.1');
    await pages[0].locator('.situation-detail button[aria-label="关闭对象详情"]').click();
    await pages[0].evaluate(()=>window.__basemapTestMap!.fitBounds([[121.8627,30.8822],[121.8646,30.8846]],{padding:60,duration:0}));
    await expect.poll(()=>pages[0].evaluate((id)=>window.__basemapTestMap!.queryRenderedFeatures({layers:['business:symbols']}).some(feature=>String(feature.properties?.key).includes(id)),`${f.runId}-V01`)).toBe(true);
    const anchor=await pages[0].evaluate((id)=>{
      const map=window.__basemapTestMap!,feature=map.queryRenderedFeatures({layers:['business:symbols']}).find(feature=>String(feature.properties?.key).includes(id));
      if(feature?.geometry.type!=='Point')return;
      const p=map.project(feature.geometry.coordinates as [number,number]);return {x:p.x,y:p.y};
    },`${f.runId}-V01`);
    expect(anchor).toBeDefined();
    if(anchor)await pages[0].locator('.maplibregl-canvas').click({position:anchor});
    await expect(pages[0].getByRole('heading',{name:/^V0[156] /})).toBeVisible();
    await pages[0].screenshot({path:test.info().outputPath('motion-arrived.png')});
    expect(f.fake.calls).toHaveLength(0);
  }finally{await f.close();for(const viewer of viewers)await viewer.close();}
});
