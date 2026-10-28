import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { SituationObject } from '../../src/contracts/context';
import type { ContinuousRoundDetail } from '../../src/contracts/continuous';
import { basemapFixture, captureMap, localVectorTiles } from './basemap-fixtures';
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
async function fixture(page: Page, activeTask = true, sourceUrl?: string) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-continuous-web-'));
  const db = await openDatabase(dir); const access = new AccessStore(db);
  const users = new Map<string, string>();
  for (const seat of ['a', 'b', 'c']) users.set(seat, await access.saveAccount({ username: seat, displayName: seat, seatId: seat, seatName: `席位 ${seat}`, password: 'test-password-123', createPublicTask: seat === 'a', manageModelSettings: seat === 'a' }));
  const actor = access.identity(users.get('a')!)!;
  const task = access.create(actor, { title: '持续分析测试任务', goal: '核对来源条件与任务需求', ...(sourceUrl ? { context: { businessRefs: [{ systemId: 'facts', objectType: 'road', objectId: 'route-01', role: 'route' as const }] } } : {}), visibility: 'public', clientActionId: randomUUID() });
  if (!activeTask) access.update(actor, task.id, task.revision, { state: 'archived' });
  db.close();
  let sequence = 0; let linked = true; let significant = false; let uncertain = false;
  const config = testConfig(dir, { seatId: 'a', auth: { secret: 'continuous-e2e-test-signing-secret-value', sessionMs: 28800000 } });
  const fake = await fakeRuntime(config, context => {
    if (!context.tools?.some(tool => tool.name === 'information_record_analysis_update')) return { text: '私有讨论完成。' };
    const last = context.messages.at(-1);
    if (last?.role === 'user') return { tools: [{ name: 'analysis_task_candidates', arguments: {} }] };
    if (last?.role === 'toolResult' && last.toolName === 'analysis_task_candidates') return { tools: [{ name: 'information_record_analysis_update', arguments: {
      taskUpdates: linked ? [{ taskId: task.id, inputIds: continuous.pending(stream.epochId).map(input => input.id), change: uncertain ? 'uncertain' : sequence === 1 ? 'initial' : 'changed', reason: uncertain ? '缺少实际路线，不能排除影响' : `第 ${sequence} 轮变化依据`, significant }] : [],
      unassigned: { significant: !linked && significant, reason: linked ? '已核对任务影响' : '独立来源事实已核对' }, uncertainties: uncertain ? ['实际路线待补充'] : [],
    } }] };
    return { text: uncertain ? '缺少实际路线，关联待核实。' : `第 ${sequence} 轮固定研判正文。` };
  });
  const lab = await PiLab.create(config, fake.runtime);
  const background = parseBackgroundConfig({ enabled: true, sources: [{ sourceId: 'incoming', name: '测试来报', ...(sourceUrl ? { systemId: 'facts' } : {}), credentialRef: 'CONTINUOUS_TEST_TOKEN', allowedProfileIds: ['analysis'], allowedRecipientSeatIds: ['a', 'b'] }], profiles: [{ id: 'analysis', name: '测试持续方案', goal: '核对实际输入', tools: ['source_list', 'task_read'], contextScopeId: 'test-scope' }] });
  const app = await createApp(lab, false, { config: background, env: { CONTINUOUS_TEST_TOKEN: 'continuous-test-source-secret-long-value' } }, { config: { systems: [{ id: 'facts', name: '测试资料', adapter: sourceUrl ? 'mock-situation-http' : 'mock-information-http', baseUrl: sourceUrl ?? 'https://no-network.invalid/facts', tokenEnv: 'CONTEXT_TEST_TOKEN' }], scopes: [{ id: 'test-scope', name: '共同资料范围', systemIds: ['facts'], seatIds: ['a', 'b'] }] }, env: { CONTEXT_TEST_TOKEN: 'context-test-token-value' } });
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
  async function receive(options: { linked?: boolean; significant?: boolean; uncertain?: boolean } = {}) {
    sequence++; linked = options.linked ?? true; significant = options.significant ?? false; uncertain = options.uncertain ?? false;
    const response = await app.inject({ method: 'POST', url: '/api/integrations/incoming/events', headers: { authorization: 'Bearer continuous-test-source-secret-long-value' }, payload: { sourceMessageId: randomUUID(), title: `来源更新 ${sequence}`, text: `第 ${sequence} 条真实输入。`, ...(sourceUrl ? { subjectId: 'zone-01' } : {}) } });
    expect(response.statusCode, response.body).toBe(202);
    await expect.poll(() => store.listJobs().filter(job => job.kind === 'continuous_analysis' && continuous.publication(job.id).status === 'published').length).toBe(sequence);
    return store.listJobs().find(job => job.kind === 'continuous_analysis' && continuous.publication(job.id).status === 'published')!;
  }
  return { task, store, continuous, stream, fake, receive, detail: async (jobId: string) => { const response = await app.inject({ url: `/api/continuous/rounds/${jobId}`, headers }); expect(response.statusCode, response.body).toBe(200); return response.json<ContinuousRoundDetail>(); }, close: async () => { await page.goto('about:blank').catch(() => {}); await page.unrouteAll({ behavior: 'wait' }).catch(() => {}); await app.close(); await rm(dir, { recursive: true, force: true }); } };
}
async function login(page: Page, seat = 'b') { await page.goto('/'); await page.getByLabel('席位', { exact: true }).selectOption(seat); await page.getByLabel('密码', { exact: true }).fill('test-password-123'); await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible(); }

test('fixed task assessment and private draft survive newer publication; evidence and history stay explicit', async ({ page }) => {
  const env = await fixture(page);
  try {
    const first = await env.receive(); await login(page);
    await page.getByRole('button', { name: `进入项目：${env.task.title}`, exact: true }).click();
    const assessments = page.getByRole('region', { name: '当前研判', exact: true });
    await expect(assessments).toContainText('第 1 轮固定研判正文。');
    await assessments.locator('.continuous-coverage summary').click();
    await expect(assessments.locator('.continuous-coverage')).toContainText('已评估');
    await expect(assessments.locator('.continuous-coverage')).toContainText('第 1 轮变化依据');
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
  const env = await fixture(page, false);
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


test('embedded candidate spatial evidence reopens historical geometry after the source moves', async ({ page }) => {
  test.setTimeout(60000);
  page.setDefaultTimeout(10000);
  let revision = 1;
  const route: SituationObject = { ref: { systemId: 'facts', objectType: 'road', objectId: 'route-01' }, name: '实际运输路线', revision: 1, areaIds: [], effectiveAt: null, validTime: null, geometry: { type: 'LineString', coordinates: [[120.31,36.04],[120.33,36.04]] }, properties: {} };
  const zone = (): SituationObject => { const x = revision === 1 ? 120.315 : 120.35; return { ref: { systemId: 'facts', objectType: 'area', objectId: 'zone-01' }, name: '来源限制区域', revision, areaIds: [], effectiveAt: null, validTime: null, geometry: { type: 'Polygon', coordinates: [[[x,36.035],[x+0.01,36.035],[x+0.01,36.045],[x,36.045],[x,36.035]]] }, properties: { memberRefs: [] } }; };
  const source = createServer((request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    if (request.headers.authorization !== 'Bearer context-test-token-value' || url.pathname !== '/objects') { response.writeHead(404); response.end(); return; }
    const refs = JSON.parse(url.searchParams.get('objectRefs') || '[]') as Array<{ objectId: string }>;
    const items = [route, zone()].filter(item => !refs.length || refs.some(ref => ref.objectId === item.ref.objectId));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ systemId: 'facts', asOf: `2026-10-27T0${revision}:00:00Z`, items, limit: 100, nextCursor: null, hasMore: false, timeUnknownCount: 0, unknownRefs: [], changeCursor: `revision-${revision}` }));
  });
  await new Promise<void>(resolve => source.listen(0, '127.0.0.1', resolve));
  const address = source.address(); if (!address || typeof address === 'string') throw new Error('Missing source port');
  const env = await fixture(page, true, `http://127.0.0.1:${address.port}`);
  try {
    await captureMap(page); await localVectorTiles(page);
    await page.route('**/basemap-fonts/**', r => r.fulfill({ status: 404, body: '' }));
    const raster = await readFile(new URL('../fixtures/basemap-raster.png', import.meta.url));
    await page.route('**/test-tiles/**', r => r.fulfill({ contentType: 'image/png', body: raster }));
    await page.route('**/api/context/map-config', r => r.fulfill({ json: basemapFixture(new URL(r.request().url()).origin) }));
    const first = await env.receive();
    const firstDetail = await env.detail(first.id);
    const original = firstDetail.queryMessages?.find(message => message.toolName === 'analysis_task_candidates')?.taskDiscovery?.spatialResults[0];
    expect(original, JSON.stringify(firstDetail.queryMessages)).toBeTruthy();
    expect(original?.values).toEqual({ relation: 'intersects', matches: true });
    expect(original?.referenceItems?.[0]?.source?.revision).toBe(1);
    expect(firstDetail.queryMessages?.some(message => message.toolName === 'spatial_analyze')).toBe(false);
    revision = 2;
    const second = await env.receive(); const secondDetail = await env.detail(second.id);
    const latest = secondDetail.queryMessages?.find(message => message.taskDiscovery)?.taskDiscovery?.spatialResults[0];
    expect(latest?.values).toEqual({ relation: 'intersects', matches: false });
    expect(latest?.referenceItems?.[0]?.source?.revision).toBe(2);
    expect(latest?.referenceItems?.[0]?.geometry).not.toEqual(original?.referenceItems?.[0]?.geometry);
    await login(page);
    await page.getByRole('button', { name: `进入项目：${env.task.title}`, exact: true }).click();
    const assessments = page.getByRole('region', { name: '当前研判', exact: true });
    await assessments.getByRole('button', { name: '研判历史', exact: true }).click();
    const history = page.getByRole('dialog', { name: '研判历史', exact: true });
    await history.locator('.continuous-history > button').last().click();
    await history.locator('.context-evidence > summary').click();
    await history.getByText('任务关联核对 · 1 个任务', { exact: true }).click();
    await expect(history).toContainText('关联候选');
    const calls = env.fake.calls.length;
    await history.getByRole('button', { name: /空间关系 · 相交：是/ }).click();
    await expect(history).toHaveCount(0);
    await expect(page.getByRole('region', { name: '空间分析结果' })).toBeVisible();
    const panel = page.getByRole('region', { name: '空间分析结果' });
    await expect(panel).toContainText('相交：是');
    await panel.getByText('范围与计算依据', { exact: true }).click();
    await expect(panel).toContainText('zone-01 r1');
    await expect.poll(() => page.evaluate(() => Boolean(window.__basemapTestMap?.getSource('analysis:results')))).toBe(true);
    const rendered = await page.evaluate(() => {
      const source = window.__basemapTestMap!.getStyle().sources['analysis:results'];
      if (source.type !== 'geojson' || typeof source.data === 'string' || source.data.type !== 'FeatureCollection') throw new Error('Missing fixed geometry');
      return source.data.features.map(feature => ({ role: feature.properties?.role, geometry: feature.geometry }));
    });
    expect(rendered).toContainEqual({ role: 'reference', geometry: original!.referenceItems![0].geometry });
    expect(rendered).toContainEqual({ role: 'result', geometry: route.geometry });
    expect(rendered).not.toContainEqual({ role: 'reference', geometry: latest!.referenceItems![0].geometry });
    expect(env.fake.calls.length).toBe(calls);
    expect((await env.detail(first.id)).queryMessages).toEqual(firstDetail.queryMessages);
    await panel.getByRole('button', { name: '定位分析', exact: true }).click();
    await page.getByRole('button', { name: '关闭图层与对象', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__basemapTestMap!.queryRenderedFeatures({ layers: ['analysis:line'] }).length)).toBeGreaterThan(0);
    await expect(page.getByText(/facts：更新失败/)).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('continuous-fixed-spatial-history.png'), fullPage: true });
  } finally { await env.close(); await new Promise<void>((resolve, reject) => source.close(error => error ? reject(error) : resolve())); }
});


test('unresolved association remains visible in the current task assessment and coverage', async ({ page }) => {
  const env = await fixture(page);
  try {
    await env.receive({ uncertain: true }); await login(page);
    await page.getByRole('button', { name: `进入项目：${env.task.title}`, exact: true }).click();
    const assessment = page.getByRole('region', { name: '当前研判', exact: true });
    await expect(assessment).toContainText('依据不足');
    await assessment.locator('.continuous-coverage summary').click();
    await expect(assessment.locator('.continuous-coverage')).toContainText('关联待核实');
    await expect(assessment.locator('.continuous-coverage')).toContainText('缺少实际路线，不能排除影响');
    await expect(assessment.locator('.continuous-coverage')).not.toContainText('已核验无关联');
  } finally { await env.close(); }
});
