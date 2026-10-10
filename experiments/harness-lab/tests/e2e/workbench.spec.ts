import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
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
async function login(page: Page) {
  await page.goto('/'); await page.getByLabel('账号', { exact: true }).fill('a'); await page.getByLabel('密码', { exact: true }).fill('test-password-123'); await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
}


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
    await page.getByRole('button', { name: `进入项目：${env.task.title}`, exact: true }).click();
    await expect(page).toHaveURL(/\?session=/);
    await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue('项目对话未发送草稿');
    await page.goBack();
    await expect(page.getByRole('heading', { name: '工作待办', exact: true })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue('项目对话未发送草稿');
    expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); }
});
