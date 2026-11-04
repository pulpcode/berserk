import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import { BackgroundStore } from '../../src/background/store';
import { parseBackgroundConfig } from '../../src/background/config';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';
import type { WorkPrepareInput } from '../../src/contracts/collaboration';

const catalog = { systems: [{ id: 'external', name: '业务资料系统', objectTypes: ['record'], capabilities: ['information_search', 'information_read'], areas: [{ id: 'area-01', name: '第一片区' }] }] };
const initialContext = { businessRefs: [{ systemId: 'external', objectType: 'record', objectId: '001', label: '原始对象' }], focus: { areaIds: ['area-01'], time: { from: '2026-10-01T01:00:00.000Z' }, topics: ['现有主题'] } };
async function setup(background = false) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-context-web-'));
  const db = await openDatabase(dir); const access = new AccessStore(db);
  const id = await access.saveAccount({ username: 'a', displayName: '用户 A', seatId: 'a', seatName: '席位 A', password: 'test-password-123', createPublicTask: true, manageModelSettings: true, viewWorkOverview: true });
  await access.saveAccount({ username: 'b', displayName: '用户 B', seatId: 'b', seatName: '席位 B', password: 'test-password-123', createPublicTask: false, manageModelSettings: false });
  const actor = access.identity(id)!;
  const task = access.create(actor, { title: '上下文验证任务', goal: '根据业务资料开展工作', visibility: 'public', clientActionId: randomUUID(), context: initialContext });
  db.close();
  const config = testConfig(dir, { seatId: 'a', auth: { secret: 'test-only-signing-key-at-least-32-characters', sessionMs: 28800000 } });
  const fake = await fakeRuntime(config, () => ({ text: '已形成初步结论，仍需核实资料。' }));
  const lab = await PiLab.create(config, fake.runtime);
  const store = background ? new BackgroundStore(lab.access!.db) : undefined;
  const token = 'test-only-context-information-source-token';
  if (store) {
    store.grant('seat', 'a', 'incoming', 'manage');
    store.createRule(actor.userId, randomUUID(), { name: '验证处理规则', sourceId: 'incoming', profileId: 'analysis', recipientSeatIds: ['a'], enabled: true });
  }
  const app = await createApp(lab, false, background ? { config: parseBackgroundConfig({ enabled: true, sources: [{ sourceId: 'incoming', name: '业务通知', credentialRef: 'CONTEXT_TEST_TOKEN', allowedProfileIds: ['analysis'], allowedRecipientSeatIds: ['a'] }], profiles: [{ id: 'analysis', name: '通用综合分析', goal: '按实际资料形成结论', tools: ['source_read'] }] }), env: { CONTEXT_TEST_TOKEN: token } } : undefined);
  const pages: Page[] = [];
  const attach = async (page: Page) => {
    pages.push(page);
    await page.route('**/api/**', async route => {
      const req = route.request(); const url = new URL(req.url());
      if (url.pathname === '/api/context/catalog') return route.fulfill({ json: catalog });
      const result = await app.inject({ method: req.method() as 'GET' | 'POST' | 'PUT' | 'DELETE', url: url.pathname + url.search, headers: { ...req.headers(), host: '127.0.0.1', origin: 'http://localhost:4310' }, ...(req.postDataBuffer() ? { payload: req.postDataBuffer()! } : {}) });
      await route.fulfill({ status: result.statusCode, headers: Object.fromEntries(Object.entries(result.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])), body: result.rawPayload });
    });
  };
  return { lab, actor, task, fake, store, app, token, attach, close: async () => { for (const page of pages) if (!page.isClosed()) { await page.goto('about:blank'); await page.unrouteAll({ behavior: 'wait' }); } await app.close(); await rm(dir, { recursive: true, force: true }); } };
}
async function login(page: Page, seatId = 'a') {
  await page.goto('/'); await page.getByLabel('席位', { exact: true }).selectOption(seatId); await page.getByLabel('密码', { exact: true }).fill('test-password-123'); await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
}

test('handoff badges follow the current responsibility through submission and completion', async ({ page, browser }) => {
  const env = await setup(); await env.attach(page);
  const recipient = await browser.newPage(); await env.attach(recipient);
  try {
    const service = env.lab.collaboration!;
    const workspaceA = await env.lab.workspaces.ensureWorkspace(env.task.id, 'a', env.task.title);
    const workspaceB = await env.lab.workspaces.ensureWorkspace(env.task.id, 'b', env.task.title);
    const act = async (seatId: string, input: WorkPrepareInput) => {
      const action = await service.prepare({ seatId }, input, { source: 'page', clientActionId: randomUUID() });
      return service.commitPage({ seatId }, action.operationId);
    };
    await act('b', { kind: 'assign', taskSpaceId: env.task.id, payload: { workspaceId: workspaceB.id, assigneeSeatId: 'a', title: '核实道路通行情况', goal: '整理道路现状。', inputPaths: [] } });
    const sent = await act('a', { kind: 'assign', taskSpaceId: env.task.id, payload: { workspaceId: workspaceA.id, assigneeSeatId: 'b', title: '修订交通处置方案', goal: '补充交通安排。', inputPaths: [] } });
    await login(page);
    await page.getByRole('button', { name: /^全部 \d/ }).click();
    const incoming = page.locator('.workbench-list').getByRole('button', { name: /核实道路通行情况/ });
    const outgoing = page.locator('.workbench-list').getByRole('button', { name: /修订交通处置方案/ });
    await expect(incoming.locator('.work-item-meta')).toContainText('工作交接');
    await expect(incoming.locator('.work-item-status')).toHaveText('待签收');
    await expect(incoming.locator('.work-item-status')).toHaveClass(/work-item-status-actionable/);
    await expect(outgoing.locator('.work-item-status')).toHaveText('待对方签收');
    await expect(outgoing.locator('.work-item-status')).toHaveClass(/work-item-status-following/);
    await page.screenshot({ path: test.info().outputPath('workbench-handoff-badges-desktop.png') });
    await page.getByRole('combobox', { name: '事项类型', exact: true }).selectOption('work');
    for (const row of [incoming, outgoing]) {
      await expect(row.locator('.work-item-meta')).not.toContainText('工作交接');
      await expect(row.locator('.work-item-status')).toBeVisible();
    }
    await page.reload();
    await expect(page.getByRole('combobox', { name: '事项类型', exact: true })).toHaveValue('work');
    await expect(incoming.locator('.work-item-meta')).not.toContainText('工作交接');
    await expect(outgoing.locator('.work-item-meta')).not.toContainText('工作交接');
    await expect(incoming.locator('.work-item-status')).toHaveText('待签收');
    await expect(outgoing.locator('.work-item-status')).toHaveText('待对方签收');
    await page.screenshot({ path: test.info().outputPath('workbench-handoff-filtered-desktop.png') });
    await page.getByRole('combobox', { name: '事项类型', exact: true }).selectOption('');
    for (const row of [incoming, outgoing]) await expect(row.locator('.work-item-meta')).toContainText('工作交接');
    await page.setViewportSize({ width: 837, height: 900 });
    expect(await incoming.locator('strong').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('workbench-handoff-badges-narrow.png') });
    await act('b', { kind: 'claim', workItemId: sent.workItemId, expectedRevision: sent.revision, payload: {} });
    const working = service.read({ seatId: 'b' }, sent.workItemId);
    await writeFile(join(env.lab.workspaces.filesDirectory(workspaceB.id, 'b'), '交通方案.md'), '# 已补充交通安排');
    const submitted = await act('b', { kind: 'submit', workItemId: sent.workItemId, expectedRevision: working.revision, payload: { workspaceId: workspaceB.id, path: '交通方案.md' } });
    await page.getByRole('button', { name: '刷新待办', exact: true }).click();
    await expect(outgoing.locator('.work-item-status')).toHaveText('待我验收');
    await expect(outgoing.locator('.work-item-status')).toHaveClass(/work-item-status-actionable/);
    await login(recipient, 'b');
    await recipient.getByRole('button', { name: /^全部 \d/ }).click();
    const submittedByRecipient = recipient.locator('.workbench-list').getByRole('button', { name: /修订交通处置方案/ });
    await expect(submittedByRecipient.locator('.work-item-status')).toHaveText('等待验收');
    await expect(submittedByRecipient.locator('.work-item-status')).toHaveClass(/work-item-status-following/);
    await act('a', { kind: 'review', workItemId: sent.workItemId, expectedRevision: submitted.revision, payload: { submissionId: submitted.submissionId!, decision: 'accept' } });
    await page.getByRole('button', { name: '刷新待办', exact: true }).click();
    await recipient.getByRole('button', { name: '刷新待办', exact: true }).click();
    for (const row of [outgoing, submittedByRecipient]) {
      await expect(row.locator('.work-item-status')).toHaveText('已完成');
      await expect(row.locator('.work-item-status')).toHaveClass(/work-item-status-done/);
      await expect(row.locator('.work-item-status')).not.toHaveClass(/work-item-status-(actionable|following)/);
    }
    expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); await recipient.close(); }
});

test('workbench assignment selects a project, retains separate drafts and opens from information details', async ({ page }) => {
  const env = await setup(true); await env.attach(page);
  try {
    const first = await env.lab.workspaces.ensureWorkspace(env.task.id, 'a', env.task.title);
    const otherTask = env.lab.access!.create(env.actor, { title: '另一项工作任务', goal: '独立工作', visibility: 'public', clientActionId: randomUUID() });
    const second = await env.lab.workspaces.ensureWorkspace(otherTask.id, 'a', otherTask.title);
    await env.app.inject({ method: 'POST', url: '/api/integrations/incoming/events', headers: { host: '127.0.0.1', authorization: `Bearer ${env.token}` }, payload: { sourceMessageId: randomUUID(), title: '待核实的道路信息', text: '核实道路情况。' } });
    await expect.poll(() => env.store!.listDeliveries().filter(item => item.status === 'delivered').length).toBe(1);
    const preparations: string[] = [];
    page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/work-items/prepare')) preparations.push(request.url()); });
    await login(page);
    await expect(page.locator('.workspace-header')).not.toBeVisible();
    await expect(page.locator('.header-title')).not.toContainText('工作待办');
    await expect(page.getByText('处理席位交接与外部信息，继续需要回应的对话。', { exact: true })).toHaveCount(0);
    await expect(page.locator('.work-detail-placeholder')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('workbench-desktop.png') });
    const assign = page.locator('.workbench-actions').getByRole('button', { name: '分派工作', exact: true });
    const entryUrl = page.url();
    const historyLength = await page.evaluate(() => history.length);
    await assign.click();
    const dialog = page.getByRole('dialog', { name: '分派工作', exact: true });
    await expect(dialog.getByLabel('工作标题')).toHaveCount(0);
    await dialog.getByRole('combobox', { name: '选择项目', exact: true }).selectOption(first.id);
    await dialog.getByLabel('工作标题').fill('第一项目的草稿');
    await dialog.getByLabel('工作目标').fill('第一项目目标');
    await dialog.getByRole('combobox', { name: '选择项目', exact: true }).selectOption(second.id);
    await expect(dialog.getByLabel('工作标题')).toHaveValue('');
    await dialog.getByLabel('工作标题').fill('第二项目的草稿');
    await dialog.getByRole('combobox', { name: '选择项目', exact: true }).selectOption(first.id);
    await expect(dialog.getByLabel('工作标题')).toHaveValue('第一项目的草稿');
    await expect(dialog.getByLabel('工作目标')).toHaveValue('第一项目目标');
    await page.keyboard.press('Escape');
    await expect(assign).toBeFocused();
    expect(page.url()).toBe(entryUrl);
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    await page.getByRole('combobox', { name: '事项类型', exact: true }).selectOption('information');
    await expect(page.locator('.work-detail-placeholder')).toBeVisible();
    await page.locator('.workbench-list').getByRole('button', { name: /待核实的道路信息/ }).click();
    await expect(page.getByRole('heading', { name: '待核实的道路信息', exact: true })).toBeVisible();
    await assign.click();
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('combobox', { name: '事项类型', exact: true })).toHaveValue('information');
    await dialog.getByRole('combobox', { name: '选择项目', exact: true }).selectOption(second.id);
    await expect(dialog.getByLabel('工作标题')).toHaveValue('第二项目的草稿');
    await page.keyboard.press('Escape');
    await expect(assign).toBeFocused();
    expect(preparations).toEqual([]);
    expect(env.lab.collaboration!.list({ seatId: 'a' })).toEqual([]);
    await page.setViewportSize({ width: 1000, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('workbench-desktop-narrow.png') });
    await assign.click();
    await dialog.getByLabel('工作目标').fill('第二项目的交接目标');
    await dialog.getByRole('button', { name: '核对分派内容', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: '确认交接内容', exact: true });
    await expect(confirmation).toContainText('工作：第二项目的草稿');
    await expect(confirmation).toContainText('目标：第二项目的交接目标');
    await expect(confirmation.getByRole('region', { name: '本次附件', exact: true })).toContainText('本次附件：0 个');
    await confirmation.getByRole('button', { name: '取消本次操作', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    expect(preparations).toHaveLength(1);
    expect(env.lab.collaboration!.list({ seatId: 'a' })).toEqual([]);
  } finally { await env.close(); }
});

test('workbench explains when no project is available for assignment', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    await login(page);
    const assign = page.locator('.workbench-actions').getByRole('button', { name: '分派工作', exact: true });
    await assign.click();
    const dialog = page.getByRole('dialog', { name: '分派工作', exact: true });
    await expect(dialog.getByRole('status')).toContainText('暂无可分派的项目');
    await expect(dialog.getByRole('combobox', { name: '选择项目', exact: true })).toBeDisabled();
    await expect(dialog.getByLabel('工作标题')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(assign).toBeFocused();
    expect(env.lab.collaboration!.list({ seatId: 'a' })).toEqual([]);
    expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); }
});


test('unified inbox opens legacy links, changes handling explicitly and recovers a lost response', async ({ page }) => {
  const env = await setup(true); await env.attach(page);
  try {
    await env.app.inject({ method: 'POST', url: '/api/integrations/incoming/events', headers: { host: '127.0.0.1', authorization: `Bearer ${env.token}` }, payload: { sourceMessageId: randomUUID(), title: '新道路通告', text: '核实道路情况。' } });
    await expect.poll(() => env.store!.listDeliveries().filter(item => item.status === 'delivered').length).toBe(1);
    const delivery = env.store!.listDeliveries()[0]!;
    await login(page);
    await expect(page.getByRole('heading', { name: '工作待办', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '收到的信息', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '全部动态', exact: true })).toHaveCount(0);
    await page.goto(`/inbox?id=${delivery.id}`);
    await expect(page).toHaveURL(/\/work\?.*kind=information/);
    await expect(page.getByRole('heading', { name: '新道路通告' })).toBeVisible();
    expect(env.store!.handling(delivery.id).state).toBe('pending');
    let writes = 0;
    await page.route(`**/api/inbox/${delivery.id}/handling`, async route => {
      if (route.request().method() !== 'PUT') return route.fallback();
      writes++;
      const req = route.request();
      await env.app.inject({ method: 'PUT', url: `/api/inbox/${delivery.id}/handling`, headers: { ...req.headers(), host: '127.0.0.1', origin: 'http://localhost:4310' }, payload: req.postDataBuffer()! });
      await route.abort('failed');
    });
    await page.getByRole('button', { name: '标记已处理', exact: true }).click();
    await expect(page.getByRole('button', { name: '查询处理结果' })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: '查询处理结果' }).click();
    await expect(page.getByRole('button', { name: '重新列入待处理' })).toBeVisible();
    expect(writes).toBe(1); expect(env.store!.handling(delivery.id).state).toBe('completed');
    await page.unroute(`**/api/inbox/${delivery.id}/handling`);
    await page.getByRole('button', { name: '重新列入待处理' }).click();
    await expect(page.getByRole('button', { name: '标记已处理' })).toBeVisible();
    expect(env.store!.handling(delivery.id).state).toBe('pending');
    await page.getByRole('button', { name: '标记已处理' }).click();
    await expect(page.getByRole('button', { name: '重新列入待处理' })).toBeVisible();
    await page.getByRole('button', { name: /^已办/ }).click();
    await expect(page.locator('.workbench-list')).toContainText('新道路通告');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.locator('.workbench-list').getByRole('button', { name: /新道路通告/ }).click();
    await expect(page.getByRole('button', { name: '返回列表', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/workbench-mobile.png', fullPage: true });
  } finally { await env.close(); }
});

test('overview works without external sources and removes cached summaries after authorization denial', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    const item = { id: 'summary-one', title: '跨席位待验收工作', taskSpaceId: env.task.id, taskTitle: env.task.title, creatorSeatId: 'b', creatorSeatName: '席位 B', assigneeSeatId: 'c', assigneeSeatName: '席位 C', state: 'submitted', createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z', submissionCount: 1, participant: false };
    let denied = false;
    await page.route('**/api/work-overview/items**', route => route.fulfill(denied ? { status: 403, json: { error: { code: 'FORBIDDEN', message: '总览权限已撤销' } } } : { json: new URL(route.request().url()).pathname.endsWith('/summary-one') ? item : { items: [item], total: 1, offset: 0, limit: 25 } }));
    await login(page); await page.getByRole('button', { name: '工作总览', exact: true }).click();
    await expect(page.getByRole('button', { name: '席位工作', exact: true })).toBeVisible();
    await expect(page.getByLabel('相关席位').locator('option')).toHaveCount(3);
    await page.getByRole('button', { name: item.title, exact: true }).click();
    await expect(page.getByRole('heading', { name: item.title })).toBeVisible();
    await expect(page.getByRole('button', { name: '进入工作详情' })).toHaveCount(0);
    denied = true; await page.getByRole('button', { name: '刷新工作', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('总览权限已撤销');
    await expect(page.getByRole('heading', { name: item.title })).toHaveCount(0);
  } finally { await env.close(); }
});

test('partial workbench reads preserve failed-section rows and do not claim complete counts', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    const row = { key: 'work:one', id: 'one', kind: 'work', title: '保留的交接事项', state: 'assigned', bucket: 'actionable', label: '待签收', source: '席位 B → 席位 A', tasks: [], updatedAt: '2026-10-10T00:00:00Z' };
    let partial = false;
    await page.route('**/api/workbench/items?**', route => route.fulfill({ json: { items: partial ? [] : [row], total: partial ? 0 : 50, offset: 0, limit: 25, counts: { actionable: partial ? null : 50, following: partial ? null : 0, done: partial ? null : 0, all: partial ? null : 50 }, sections: { work: partial ? 'error' : 'available', information: 'unavailable', delivery_review: 'unavailable' }, generatedAt: new Date().toISOString() } }));
    await login(page); await expect(page.locator('.workbench-list')).toContainText(row.title);
    partial = true; await page.getByRole('button', { name: '刷新待办', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('数量暂不完整');
    await expect(page.locator('.workbench-list')).toContainText(row.title);
    await expect(page.getByRole('button', { name: '下一页' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^待我处理/ })).toContainText('—');
  } finally { await env.close(); }
});

test('formal root workbench remains in browser history when entering an existing conversation', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    await login(page);
    const create = page.getByRole('button', { name: `在项目 ${env.task.title} 中新建对话`, exact: true });
    await page.locator('.workspace-group-heading').filter({ has: create }).hover(); await create.click();
    await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('项目对话未发送草稿');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '工作待办', exact: true })).toBeVisible();
    await page.locator('.session-item').first().click();
    await expect(page).toHaveURL(/\?session=/);
    await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue('项目对话未发送草稿');
    await page.goBack();
    await expect(page.getByRole('heading', { name: '工作待办', exact: true })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue('项目对话未发送草稿');
    expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); }
});

const overviewItems = (count: number, task: { id: string; title: string }) => Array.from({ length: count }, (_, index) => ({
  id: `work-${String(index).padStart(3, '0')}`, title: `道路核实工作 ${index + 1}`, taskSpaceId: task.id, taskTitle: task.title,
  creatorSeatId: index % 2 ? 'b' : 'a', creatorSeatName: index % 2 ? '席位 B' : '席位 A', assigneeSeatId: index % 2 ? 'a' : 'b', assigneeSeatName: index % 2 ? '席位 A' : '席位 B',
  state: ['assigned', 'working', 'submitted', 'returned', 'completed'][index % 5], createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z', submissionCount: 0, participant: false,
}));

test('seat swimlane reads beyond the list page and preserves camera, filters, focus and history', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    const items = overviewItems(30, env.task); for (const item of items) { item.creatorSeatName = '同名的跨部门道路交通与应急资源综合保障协调席位'; item.assigneeSeatName = item.creatorSeatName; } items[0].title = '需要进一步核对的道路通行与应急保障安排'; const reads: string[] = []; const writes: string[] = [];
    await page.route('**/api/work-overview/items**', route => {
      const request = route.request(), url = new URL(request.url()); reads.push(url.search);
      if (request.method() !== 'GET') writes.push(request.method());
      if (!url.pathname.endsWith('/items')) return route.fulfill({ json: items.find(item => url.pathname.endsWith(`/${item.id}`)) });
      const filtered = items.filter(item => !url.searchParams.get('status') || item.state === url.searchParams.get('status'));
      const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 25);
      return route.fulfill({ json: { items: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit } });
    });
    await login(page); await page.getByRole('button', { name: '工作总览', exact: true }).click();
    await expect(page.locator('.work-overview tbody tr')).toHaveCount(25);
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(page.locator('.work-overview tbody tr')).toHaveCount(5);
    await page.getByRole('button', { name: '泳道图', exact: true }).click();
    await expect(page.locator('.work-swimlane-work')).toHaveCount(30);
    const laneLabelsFit = await page.locator('.work-swimlane-seat').evaluateAll(elements => elements.every(element => {
      const row = element.getBoundingClientRect();
      return [...element.querySelectorAll('span, small')].every(text => { const bounds = text.getBoundingClientRect(); return bounds.top >= row.top && bounds.bottom <= row.bottom; });
    }));
    expect(laneLabelsFit).toBe(true);
    expect(reads.some(query => new URLSearchParams(query).get('limit') === '200' && new URLSearchParams(query).get('offset') === '0')).toBe(true);
    expect(new URL(page.url()).searchParams.get('offset')).toBe('25');
    expect(new URL(page.url()).searchParams.get('view')).toBe('board');
    const canvas = page.getByRole('region', { name: '席位工作泳道图', exact: true }), scene = page.locator('.work-swimlane-scene');
    const label = page.locator('.work-swimlane-seat').first(), lane = page.locator('.work-swimlane-lane').first();
    const labelBefore = await label.boundingBox(), nodeBefore = await page.locator('.work-swimlane-work').first().boundingBox();
    await canvas.focus(); await canvas.press('ArrowRight');
    const labelAfterPan = await label.boundingBox(), nodeAfterPan = await page.locator('.work-swimlane-work').first().boundingBox(), canvasBounds = await canvas.boundingBox();
    expect(Math.abs(labelAfterPan!.x - labelBefore!.x)).toBeLessThan(1);
    expect(Math.abs(labelAfterPan!.x - canvasBounds!.x)).toBeLessThan(2);
    expect(nodeAfterPan!.x).toBeLessThan(nodeBefore!.x - 70);
    await canvas.press('ArrowDown');
    const labelAfterVertical = await label.boundingBox(), laneAfterVertical = await lane.boundingBox();
    expect(labelAfterVertical!.y).toBeLessThan(labelAfterPan!.y - 70);
    expect(Math.abs(labelAfterVertical!.y - laneAfterVertical!.y)).toBeLessThan(1);
    const last = page.locator('.work-swimlane-work').last();
    await last.focus();
    const revealed = await last.boundingBox(), anchoredLabel = await label.boundingBox();
    expect(revealed!.x).toBeGreaterThan(anchoredLabel!.x + anchoredLabel!.width + 8);
    expect(revealed!.x + revealed!.width).toBeLessThan(canvasBounds!.x + canvasBounds!.width - 8);
    await page.getByRole('button', { name: '放大泳道图', exact: true }).click();
    const first = page.locator('.work-swimlane-work').first();
    await first.focus(); const position = await scene.getAttribute('style');
    const cardLayout = await first.evaluate(element => {
      const card = element.getBoundingClientRect(), title = element.querySelector('strong')!.getBoundingClientRect(), task = element.querySelector('small')!.getBoundingClientRect(), status = element.querySelector('.work-swimlane-status')!.getBoundingClientRect();
      return { ordered: title.bottom <= task.top && task.bottom <= status.top, inside: title.top >= card.top && status.bottom <= card.bottom, leftAligned: Math.abs(title.left - task.left) < 1 && Math.abs(task.left - status.left) < 1 };
    });
    expect(cardLayout).toEqual({ ordered: true, inside: true, leftAligned: true });
    await canvas.focus(); await canvas.press('Control+ArrowRight');
    await expect(scene).toHaveAttribute('style', position!);
    await first.focus();
    await first.press('Enter');
    await expect(page.getByRole('heading', { name: items[0].title, exact: true })).toBeVisible();
    await expect(canvas).toBeHidden();
    await expect(page.getByRole('button', { name: '进入工作详情' })).toHaveCount(0);
    await page.getByRole('button', { name: '返回泳道图', exact: true }).click();
    await expect(canvas).toBeVisible(); await expect(first).toBeFocused();
    await expect(scene).toHaveAttribute('style', position!);
    const refreshDone = page.waitForResponse(response => response.url().includes('/api/work-overview/items?') && response.status() === 200);
    await page.getByRole('button', { name: '刷新工作', exact: true }).click(); await refreshDone;
    await expect(scene).toHaveAttribute('style', position!);
    const readCamera = () => scene.evaluate(element => {
      const matrix = new DOMMatrix(getComputedStyle(element).transform);
      return { x: matrix.e, y: matrix.f, scale: matrix.a };
    });
    const bounds = await canvas.boundingBox(), screenPoint = { x: Math.round(bounds!.x + bounds!.width - 150), y: Math.round(bounds!.y + bounds!.height / 2) };
    const point = { x: screenPoint.x - bounds!.x, y: screenPoint.y - bounds!.y };
    await page.mouse.move(screenPoint.x, screenPoint.y);
    const beforePan = await readCamera();
    await page.mouse.wheel(0, 80);
    await expect.poll(async () => (await readCamera()).y).toBeCloseTo(beforePan.y - 80, 3);
    expect((await readCamera()).scale).toBeCloseTo(beforePan.scale, 5);
    const beforeZoom = await readCamera();
    await page.keyboard.down('Control');
    try {
      await page.mouse.wheel(0, -80);
      await expect.poll(async () => (await readCamera()).scale).toBeGreaterThan(beforeZoom.scale);
    } finally { await page.keyboard.up('Control'); }
    const afterZoom = await readCamera();
    expect((point.x - afterZoom.x) / afterZoom.scale).toBeCloseTo((point.x - beforeZoom.x) / beforeZoom.scale, 2);
    expect((point.y - afterZoom.y) / afterZoom.scale).toBeCloseTo((point.y - beforeZoom.y) / beforeZoom.scale, 2);
    await page.mouse.wheel(0, 120);
    await expect.poll(async () => (await readCamera()).y).toBeCloseTo(afterZoom.y - 120, 3);
    const afterZoomPan = await readCamera();
    expect(afterZoomPan.scale).toBeCloseTo(afterZoom.scale, 5);
    await page.mouse.wheel(70, 0);
    await expect.poll(async () => (await readCamera()).x).toBeCloseTo(afterZoomPan.x - 70, 3);
    const beforeShiftPan = await readCamera();
    await page.keyboard.down('Shift');
    try {
      await page.mouse.wheel(0, 60);
      await expect.poll(async () => (await readCamera()).x).toBeCloseTo(beforeShiftPan.x - 60, 3);
    } finally { await page.keyboard.up('Shift'); }
    expect((await readCamera()).y).toBeCloseTo(beforeShiftPan.y, 3);
    expect((await readCamera()).scale).toBeCloseTo(afterZoom.scale, 5);
    // Native/default handling stays available outside the canvas and over its floating controls.
    const beforeNative = await readCamera();
    const unconsumed = await page.evaluate(() => {
      const controls = document.querySelector('.work-swimlane-controls')!, toolbar = document.querySelector('.work-overview-toolbar')!, graph = document.querySelector('.work-swimlane')!;
      return [controls, toolbar, graph, graph, graph].map((element, index) => {
        const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: index > 2 ? 0 : 80, ctrlKey: index < 2 || index === 4, altKey: index === 2 });
        element.dispatchEvent(event); return !event.defaultPrevented;
      });
    });
    expect(unconsumed).toEqual([true, true, true, true, true]);
    expect(await readCamera()).toEqual(beforeNative);
    const metaConsumed = await canvas.evaluate((element, pointer) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -40, metaKey: true, clientX: pointer.x, clientY: pointer.y });
      element.dispatchEvent(event); return event.defaultPrevented;
    }, screenPoint);
    expect(metaConsumed).toBe(true);
    await expect.poll(async () => (await readCamera()).scale).toBeGreaterThan(beforeNative.scale);
    await page.getByRole('combobox', { name: '工作状态', exact: true }).selectOption('submitted');
    await expect(page.locator('.work-swimlane-work')).toHaveCount(6);
    await page.getByRole('button', { name: '列表', exact: true }).click();
    await expect(page.locator('.work-overview tbody tr')).toHaveCount(6);
    await expect(page.getByRole('combobox', { name: '工作状态', exact: true })).toHaveValue('submitted');
    await page.goBack(); await expect(canvas).toBeVisible();
    await expect(page.getByRole('button', { name: '泳道图', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.goForward(); await expect(page.getByRole('button', { name: '列表', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.reload(); await expect(page.locator('.work-overview tbody tr')).toHaveCount(6);
    await page.goto('/overview?tab=work&view=board&workView=unknown');
    await expect(page.getByRole('button', { name: '列表', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(writes).toEqual([]); expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); }
});

test('swimlane refuses partial or over-limit diagrams and keeps same-scope results after ordinary failures', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    const items = overviewItems(201, env.task); let mode = 'valid';
    await page.route('**/api/work-overview/items**', route => {
      const url = new URL(route.request().url()), limit = Number(url.searchParams.get('limit') || 25);
      if (mode === 'failed') return route.fulfill({ status: 503, json: { error: { message: '读取暂时失败', code: 'UNAVAILABLE' } } });
      const data = mode === 'duplicate' ? [items[0], items[0], items[2]] : mode === 'missing' ? items.slice(0, 2) : mode === 'overflow' ? items.slice(0, limit) : items.slice(0, 3);
      return route.fulfill({ json: { items: data, total: mode === 'overflow' ? 201 : 3, offset: 0, limit } });
    });
    await login(page); await page.goto('/overview?tab=work&workView=flow');
    await expect(page.locator('.work-swimlane-work')).toHaveCount(3);
    mode = 'failed'; await page.getByRole('button', { name: '刷新工作', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('刷新失败，当前显示上次结果。');
    await expect(page.locator('.work-swimlane-work')).toHaveCount(3);
    for (const broken of ['duplicate', 'missing']) {
      mode = broken; await page.getByRole('button', { name: '刷新工作', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('工作数据不完整');
      await expect(page.locator('.work-swimlane-work')).toHaveCount(0);
    }
    mode = 'overflow'; await page.getByRole('button', { name: '刷新工作', exact: true }).click();
    await expect(page.getByText('工作较多，请缩小筛选范围，或切换列表查看全部。')).toBeVisible();
    await expect(page.locator('.work-swimlane-work')).toHaveCount(0);
    await page.getByRole('button', { name: '切换列表', exact: true }).click();
    await expect(page.locator('.work-overview tbody tr')).toHaveCount(25);
    await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeVisible();
  } finally { await env.close(); }
});

for (const rejection of [403, 404]) test(`summary ${rejection} discards cached diagram and list before returning`, async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    const items = overviewItems(3, env.task); let denied = false;
    await page.route('**/api/work-overview/items**', route => {
      const url = new URL(route.request().url());
      if (denied) {
        const listFailure = rejection === 403 && url.pathname.endsWith('/items');
        return route.fulfill({ status: listFailure ? 503 : rejection, json: { error: { code: 'REJECTED', message: listFailure ? '摘要列表暂时读取失败' : '此工作已不可读取' } } });
      }
      return route.fulfill({ json: url.pathname.endsWith('/items') ? { items, total: 3, offset: 0, limit: Number(url.searchParams.get('limit') || 25) } : items[0] });
    });
    await login(page); await page.getByRole('button', { name: '工作总览', exact: true }).click();
    await expect(page.locator('.work-overview tbody tr')).toHaveCount(3);
    await page.getByRole('button', { name: '泳道图', exact: true }).click();
    await expect(page.locator('.work-swimlane-work')).toHaveCount(3);
    await page.locator('.work-swimlane-work').first().click();
    await expect(page.getByRole('heading', { name: items[0].title, exact: true })).toBeVisible();
    denied = true; await page.getByRole('button', { name: '刷新工作', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('此工作已不可读取');
    await expect(page.getByRole('heading', { name: items[0].title, exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '返回泳道图', exact: true }).click();
    await expect(page.locator('.work-swimlane-work')).toHaveCount(0);
    await page.getByRole('button', { name: '列表', exact: true }).click();
    await expect(page.locator('.work-overview tbody tr')).toHaveCount(0);
  } finally { await env.close(); }
});

test('late swimlane reads cannot replace a newer filter result', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  let release: (() => void) | undefined;
  try {
    const items = overviewItems(2, env.task); let started = false;
    await page.route('**/api/work-overview/items**', async route => {
      const url = new URL(route.request().url()), search = url.searchParams.get('search');
      if (search === '旧') { started = true; await new Promise<void>(resolve => { release = resolve; }); }
      const chosen = search === '新' ? [items[1]] : search === '旧' ? [items[0]] : items;
      await route.fulfill({ json: { items: chosen, total: chosen.length, offset: 0, limit: 200 } });
    });
    await login(page); await page.goto('/overview?tab=work&workView=flow');
    await expect(page.locator('.work-swimlane-work')).toHaveCount(2);
    await page.getByRole('searchbox', { name: '搜索工作', exact: true }).fill('旧');
    await expect.poll(() => started).toBe(true);
    await page.getByRole('searchbox', { name: '搜索工作', exact: true }).fill('新');
    await expect(page.locator('.work-swimlane-work')).toHaveCount(1);
    await expect(page.locator('.work-swimlane-work')).toHaveAttribute('data-work-id', items[1].id);
    const oldDone = page.waitForResponse(response => new URL(response.url()).searchParams.get('search') === '旧');
    release!(); release = undefined; await oldDone;
    await expect(page.locator('.work-swimlane-work')).toHaveCount(1);
    await expect(page.locator('.work-swimlane-work')).toHaveAttribute('data-work-id', items[1].id);
  } finally { release?.(); await env.close(); }
});
