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
import type { PublicMessage } from '../../src/contracts';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';

const catalog = { systems: [{ id: 'external', name: '业务资料系统', objectTypes: ['record'], capabilities: ['information_search', 'information_read'], areas: [{ id: 'area-01', name: '第一片区' }] }] };
const initialContext = { businessRefs: [{ systemId: 'external', objectType: 'record', objectId: '001', label: '原始对象' }], focus: { areaIds: ['area-01'], time: { from: '2026-10-01T01:00:00.000Z' }, topics: ['现有主题'] } };
async function setup(background = false) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-context-web-'));
  const db = await openDatabase(dir); const access = new AccessStore(db);
  const id = await access.saveAccount({ username: 'a', displayName: '用户 A', seatId: 'a', seatName: '席位 A', password: 'test-password-123', createPublicTask: true, manageModelSettings: true });
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

test('task context saves generic references, open time ranges and explicit clearing without creating a workspace', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    await login(page); await page.getByRole('button', { name: '任务说明：上下文验证任务', exact: true }).click();
    await expect(page.getByLabel('对象编号', { exact: true })).toHaveValue('001');
    await page.getByLabel('对象编号', { exact: true }).fill('');
    await page.getByRole('button', { name: '保存说明', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('请填写完整');
    expect(env.lab.access!.get(env.task.id, 'a').revision).toBe(env.task.revision);
    await page.getByLabel('对象编号', { exact: true }).fill('00042');
    await page.getByLabel('关注区域编码').fill('area-01\narea-01\narea-02');
    await page.getByLabel('关注主题').fill('补充核实\n时间比较');
    await page.getByLabel('开始时间（含时区）').fill('2026-02-31T09:00:00+08:00');
    await page.getByRole('button', { name: '保存说明', exact: true }).click();
    await expect(page.getByLabel('开始时间（含时区）')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('button', { name: '查看最新说明' })).toHaveCount(0);
    expect(env.lab.access!.get(env.task.id, 'a').revision).toBe(env.task.revision);
    await page.getByLabel('开始时间（含时区）').fill('2026-10-01T09:00:00+08:00');
    await page.getByLabel('结束时间（含时区）').fill('2026-10-01T08:00:00+08:00');
    await page.getByRole('button', { name: '保存说明', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('结束时间必须晚于开始时间');
    await page.getByLabel('结束时间（含时区）').fill('');
    await page.screenshot({ path: 'test-results/context-task-desktop.png', fullPage: true });
    await page.getByRole('button', { name: '保存说明', exact: true }).click(); await expect(page.getByRole('dialog')).toBeHidden();
    const saved = env.lab.access!.get(env.task.id, 'a');
    expect(saved.context).toEqual({ businessRefs: [{ systemId: 'external', objectType: 'record', objectId: '00042', label: '原始对象' }], focus: { areaIds: ['area-01', 'area-02'], topics: ['时间比较', '补充核实'], time: { from: '2026-10-01T01:00:00.000Z' } } });
    expect(env.lab.workspaces.listAll()).toHaveLength(0); expect(env.fake.calls).toHaveLength(0);
    await page.getByRole('button', { name: '任务说明：上下文验证任务', exact: true }).click();
    await page.getByRole('button', { name: '移除第 1 项业务引用' }).click();
    for (const name of ['关注区域编码', '关注主题', '开始时间（含时区）']) await page.getByLabel(name).fill('');
    await page.getByRole('button', { name: '保存说明', exact: true }).click(); await expect(page.getByRole('dialog')).toBeHidden();
    expect(env.lab.access!.get(env.task.id, 'a').context).toBeUndefined();
  } finally { await env.close(); }
});

test('context conflicts retain the full draft; catalog failure and ordinary text edits never erase existing context', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  const puts: Record<string, unknown>[] = [];
  page.on('request', req => { if (req.method() === 'PUT' && new URL(req.url()).pathname === `/api/tasks/${env.task.id}`) puts.push(req.postDataJSON()); });
  try {
    await login(page); await page.getByRole('button', { name: '任务说明：上下文验证任务', exact: true }).click();
    await page.getByLabel('对象编号', { exact: true }).fill('local-edit');
    env.lab.access!.update(env.actor, env.task.id, env.task.revision, { title: env.task.title, goal: '另一窗口修改目标', context: { businessRefs: [{ systemId: 'external', objectType: 'record', objectId: 'remote-edit' }], focus: { topics: ['另一窗口主题'] } } });
    await page.getByRole('button', { name: '保存说明', exact: true }).click();
    await expect(page.getByLabel('对象编号', { exact: true })).toHaveValue('local-edit');
    await expect(page.getByRole('button', { name: '保存说明', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '查看最新说明' }).click();
    await expect(page.locator('.task-comparison')).toContainText('remote-edit'); await expect(page.locator('.task-comparison')).toContainText('另一窗口主题');
    await page.getByRole('button', { name: '已核对，继续合并编辑' }).click(); await expect(page.getByLabel('对象编号', { exact: true })).toHaveValue('local-edit');
    await page.getByRole('button', { name: '保存说明', exact: true }).click(); await expect(page.getByRole('dialog')).toBeHidden();
    const retained = env.lab.access!.get(env.task.id, 'a').context;
    expect(retained?.businessRefs?.[0]?.objectId).toBe('local-edit');
    await page.route('**/api/context/catalog', route => route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: '目录暂不可用' } } }));
    await page.getByRole('button', { name: '任务说明：上下文验证任务', exact: true }).click();
    await expect(page.getByText('业务系统列表暂不可用，已填写的内容仍保留。', { exact: false })).toBeVisible();
    await expect(page.getByLabel('对象编号', { exact: true })).toHaveValue('local-edit');
    await page.getByLabel('目标与说明').fill('只更新说明，不改关注范围');
    await page.getByRole('button', { name: '保存说明', exact: true }).click(); await expect(page.getByRole('dialog')).toBeHidden();
    expect(puts.at(-1)).not.toHaveProperty('context'); expect(env.lab.access!.get(env.task.id, 'a').context).toEqual(retained);
    expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); }
});

test('inbox shows native query evidence and sends the explicit question without rerunning preprocessing', async ({ page }) => {
  const env = await setup(true); await env.attach(page);
  try {
    const received = await env.app.inject({ method: 'POST', url: '/api/integrations/incoming/events', headers: { host: '127.0.0.1', authorization: `Bearer ${env.token}` }, payload: { sourceMessageId: randomUUID(), title: '综合研判测试信息', text: '请检查业务资料变化。' } });
    expect(received.statusCode).toBe(202);
    await expect.poll(() => env.store!.listDeliveries().filter(item => item.status === 'delivered').length).toBe(1);
    const delivery = env.store!.listDeliveries()[0]!;
    const message: PublicMessage = { id: 'query-evidence-1', role: 'tool', requestId: 'request-evidence-1', toolName: 'information_read', toolCallId: 'tool-evidence-1', text: JSON.stringify({ systemId: 'external', query: { systemId: 'external', reportId: 'record-01' }, queriedAt: '2026-10-01T02:00:00.000Z', data: { systemId: 'external', item: { reportId: 'record-01', revision: 2, observedAt: '2026-10-01T09:30:00+08:00', content: '当次查询保存的资料正文' } } }) };
    // This browser test supplies an authorized projection; backend tests own native evidence extraction.
    await page.route(`**/api/inbox/${delivery.id}`, async route => {
      const req = route.request(); const response = await env.app.inject({ method: 'GET', url: `/api/inbox/${delivery.id}`, headers: { ...req.headers(), host: '127.0.0.1' } });
      await route.fulfill({ status: response.statusCode, json: { ...response.json(), profileName: '通用综合分析', queryMessages: [message] } });
    });
    await login(page); await page.getByRole('button', { name: '收到的信息', exact: true }).click(); await page.getByRole('button', { name: /综合研判测试信息/ }).click();
    const calls = env.fake.calls.length;
    await expect(page.getByRole('heading', { name: '处理结果', exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: '继续处理' })).toBeVisible();
    await page.getByText('查询依据 · 1 次查询', { exact: true }).click(); await page.getByText('报告正文 · external · 1 条记录', { exact: true }).click();
    await expect(page.locator('.context-evidence-records')).toContainText('record-01'); await expect(page.locator('.context-evidence-records')).toContainText('版本 2');
    await page.getByText('实际查询条件与返回内容', { exact: true }).click(); await expect(page.locator('.context-evidence pre')).toContainText('当次查询保存的资料正文');
    await expect(page.getByRole('button', { name: '发送并进入对话', exact: true })).toBeDisabled();
    await page.getByLabel('处理位置', { exact: true }).selectOption(env.task.id); await expect(page.getByRole('button', { name: '发送并进入对话', exact: true })).toBeDisabled();
    await page.getByLabel('问题或工作要求').fill('请解释这个结论的依据，并列出需要核实的问题');
    await page.getByText('更多选项', { exact: true }).click();
    await expect(page.getByText('可查询系统：业务资料系统')).toBeVisible();
    await page.screenshot({ path: 'test-results/context-inbox-desktop.png', fullPage: true });
    expect(env.fake.calls).toHaveLength(calls);
    await page.getByRole('button', { name: '发送并进入对话', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue('');
    await expect.poll(() => env.fake.calls.length).toBe(calls + 1); expect(env.store!.listJobs()).toHaveLength(1);
  } finally { await env.close(); }
});

test('late prepared conversation reads preserve a newer inbox selection and the original action', async ({ page }) => {
  const env = await setup(true); await env.attach(page);
  let release: (() => void) | undefined;
  try {
    for (const title of ['接续原信息', '新选择的信息']) {
      const received = await env.app.inject({ method: 'POST', url: '/api/integrations/incoming/events', headers: { host: '127.0.0.1', authorization: `Bearer ${env.token}` }, payload: { sourceMessageId: randomUUID(), title, text: '用于接续验证的资料。' } });
      expect(received.statusCode).toBe(202);
    }
    await expect.poll(() => env.store!.listDeliveries().filter(item => item.status === 'delivered').length).toBe(2);
    await login(page); await page.getByRole('button', { name: '收到的信息', exact: true }).click();
    await page.getByRole('button', { name: /接续原信息/ }).click();
    await page.getByLabel('处理位置', { exact: true }).selectOption(env.task.id);
    await page.getByLabel('问题或工作要求').fill('保留原信息的后续问题');
    const calls = env.fake.calls.length;
    await page.route('**/api/sessions/*', async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      await new Promise<void>(resolve => { release = resolve; });
      await route.fallback();
    }, { times: 1 });
    await page.getByRole('button', { name: '发送并进入对话', exact: true }).click();
    await expect.poll(() => Boolean(release)).toBe(true);
    await page.getByRole('button', { name: /新选择的信息/ }).click();
    const selectedUrl = page.url();
    await expect(page.getByRole('heading', { name: '新选择的信息', exact: true })).toBeVisible();
    release!(); release = undefined;
    await expect(page.getByLabel('处理位置', { exact: true })).toBeEnabled();
    expect(page.url()).toBe(selectedUrl);
    await expect(page.getByLabel('问题或工作要求')).toHaveValue('');
    expect(env.fake.calls).toHaveLength(calls);
    await page.getByRole('button', { name: /接续原信息/ }).click();
    await expect(page.getByLabel('问题或工作要求')).toBeEnabled();
    await expect(page.getByLabel('问题或工作要求')).toHaveValue('保留原信息的后续问题');
    await expect(page.getByRole('button', { name: '查询本次结果', exact: true })).toHaveCount(0);
    expect(env.fake.calls).toHaveLength(calls);
    expect(env.fake.calls).toHaveLength(calls);
    expect(env.store!.listActions().filter(action => action.kind === 'analysis')).toHaveLength(1);
  } finally { release?.(); await env.close(); }
});

test('rules disclose safe query systems and restricted job detail keeps only status', async ({ page }) => {
  const env = await setup(true); await env.attach(page); let brokenProfile = false;
  try {
    await page.route('**/api/information/access', async route => {
      const response = await env.app.inject({ method: 'GET', url: '/api/information/access', headers: { ...route.request().headers(), host: '127.0.0.1' } });
      const data = response.json();
      if (response.statusCode === 200) data.profiles = data.profiles.map((profile: { id: string }) => ({ ...profile, ...(brokenProfile ? { configurationError: '资料范围未配置，请联系维护人员。' } : { contextScope: { scopeId: 'context-demo', systemIds: ['external'], systemNames: ['业务资料系统'] } }) }));
      await route.fulfill({ status: response.statusCode, json: data });
    });
    await env.app.inject({ method: 'POST', url: '/api/integrations/incoming/events', headers: { host: '127.0.0.1', authorization: `Bearer ${env.token}` }, payload: { sourceMessageId: randomUUID(), title: '权限投影测试信息', text: '资料原文' } });
    await expect.poll(() => env.store!.listJobs()[0]?.status).toBe('succeeded');
    const job = env.store!.listJobs()[0]!;
    await page.route(`**/api/information/jobs/${job.id}`, route => route.fulfill({ json: { id: job.id, kind: 'preprocess', sourceId: job.sourceId, eventId: job.eventId, status: 'succeeded', revision: job.revision, createdAt: job.createdAt, endedAt: job.endedAt, contentRestricted: true } }));
    await login(page); await page.getByRole('button', { name: '信息处理中心', exact: true }).click();
    await page.getByRole('button', { name: '处理与投递规则', exact: true }).click(); await page.getByRole('button', { name: /验证处理规则/ }).click();
    await expect(page.getByText('允许查询的系统：业务资料系统')).toBeVisible();
    await expect(page.getByText('展示归属只用于分类，不限定可能涉及的任务，也不扩大查询权限。')).toBeVisible();
    brokenProfile = true; await page.reload();
    await expect(page.getByRole('alert')).toContainText('此处理方案暂不可用');
    await expect(page.getByRole('button', { name: '保存规则', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '后台作业', exact: true })).toBeVisible();
    await page.goto(`/information?tab=jobs&id=${job.id}`);
    const detail = page.getByRole('complementary', { name: '后台作业详情' });
    await expect(detail).toContainText('无该资料范围访问权限'); await expect(detail).toContainText('执行完成');
    await expect(detail.getByRole('heading', { name: '处理结果' })).toHaveCount(0);
    await expect(detail.getByRole('button', { name: '重新预处理' })).toHaveCount(0);
    await expect(detail.getByText('查看执行过程')).toHaveCount(0);
  } finally { await env.close(); }
});
