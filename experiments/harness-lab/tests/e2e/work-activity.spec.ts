import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import { fakeRuntime, testConfig, type Reply } from '../pi/fake-runtime';
import type { WorkActivityEvidence } from '../../src/contracts/work-activity';
import type { WorkPrepareInput, ConfirmationInteraction } from '../../src/contracts';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import { migrateAdministratorAccounts } from '../../src/access/administrator-schema';

const box = (page: Page) => page.getByRole('textbox', { name: '发送消息', exact: true });
const panel = (page: Page) => page.getByRole('complementary', { name: '工作面板', exact: true });
const detail = (page: Page, text: string) => panel(page).locator('.work-activity-item .work-activity-link').and(panel(page).locator(`[title*=${JSON.stringify(text)}]`));
const barrier = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };

// Real PiLab, SQLite, native history and scoped API; only provider completion is deterministic.
async function setup(page: Page, options: { models?: boolean; receipt?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-work-panel-'));
  const config = testConfig(dir, { maxOutputTokens: 2048, seatId: 'test-seat', testSeats: [{ id: 'test-seat', name: 'A席位' }, { id: 'seat-b', name: 'B席位' }] });
  let claim: { workItemId: string; revision: number } | undefined;
  let invalid = false;
  let holdTurn = false;
  const fake = await fakeRuntime(config, context => {
    if (context.systemPrompt?.startsWith('预测用户')) return { text: 'NONE' };
    if (context.systemPrompt?.startsWith('识别当前对话近期处理的工作')) {
      if (invalid) return { text: 'invalid result' };
      const message = context.messages[0];
      const input = JSON.parse(typeof message.content === 'string' ? message.content : JSON.stringify(message.content)) as {
        source: { sourceRequestId: string }; evidence: WorkActivityEvidence[]; candidates: Array<{ id: string; title: string }>;
      };
      const evidence = input.evidence.filter(item => item.kind === 'user' && item.requestId === input.source.sourceRequestId).at(-1)!;
      const titles = evidence.text.includes('先处理待接收事项') ? ['待接收事项'] : evidence.text.includes('独立事项') ? ['B 独立事项'] : evidence.text.includes('闲聊') ? [] : ['采购建议', '培训计划'];
      return { text: JSON.stringify({ items: titles.map((title, index) => ({ workItemId: input.candidates.find(item => item.title === title)?.id || null,
        title, description: `${title}的本轮分析内容`, relation: evidence.text.includes('仅参考') && index === 1 ? 'reference' : evidence.text.includes('不确定') ? 'uncertain' : 'processing', evidenceIds: [evidence.id] })) }) };
    }
    if (claim) {
      const current = claim; claim = undefined;
      return { tools: [{ name: 'work_item_action', arguments: { action: { kind: 'claim', workItemId: current.workItemId, expectedRevision: current.revision, payload: {} } } }] } satisfies Reply;
    }
    if (holdTurn) return { waitForAbort: true };
    return { text: '本轮文件工作已讨论。' };
  });
  const lab = await PiLab.create(config, fake.runtime), app = await createApp(lab);
  const workspace = lab.workspaces.get();
  const creator = await lab.workspaces.ensureWorkspace(workspace.taskSpaceId, 'seat-b', workspace.name);
  const act = async (seatId: string, input: WorkPrepareInput) => {
    const action = await lab.collaboration!.prepare({ seatId }, input, { source: 'page', clientActionId: randomUUID() });
    return lab.collaboration!.commitPage({ seatId }, action.operationId);
  };
  const works = [];
  for (const title of ['采购建议', '培训计划', '其他待办', '待接收事项']) {
    const receipt = await act('seat-b', { kind: 'assign', taskSpaceId: workspace.taskSpaceId, payload: { workspaceId: creator.id, assigneeSeatId: 'test-seat', title, goal: `独立编制${title}并提交`, inputPaths: [] } });
    const work = lab.collaboration!.read({ seatId: 'test-seat' }, receipt.workItemId);
    if (title !== '待接收事项' && !(options.receipt && title === '采购建议')) await act('test-seat', { kind: 'claim', workItemId: work.id, expectedRevision: work.revision, payload: {} });
    works.push(lab.collaboration!.read({ seatId: 'test-seat' }, receipt.workItemId));
  }
  const a = await lab.createSession(), b = await lab.createSession();
  await lab.start(a.id, '工作对话 A：编制采购建议与培训计划').run(() => {});
  await lab.start(b.id, '工作对话 B：编制独立事项').run(() => {});
  if (options.receipt) {
    claim = { workItemId: works[0].id, revision: works[0].revision };
    const running = lab.start(a.id, '签收采购建议，并继续编制采购建议与培训计划');
    const done = running.run(() => {});
    await expect.poll(() => lab.get(a.id).interactions?.some(item => item.status === 'pending')).toBe(true);
    const item = lab.get(a.id).interactions!.find(item => item.status === 'pending')! as ConfirmationInteraction;
    lab.respondInteraction(a.id, item.interactionId, { requestId: item.requestId, kind: 'confirmation', decision: 'approve' }); await done;
  }
  let alternativeModel: string | undefined;
  if (options.models) {
    const current = lab.modelSettings();
    alternativeModel = (await lab.updateModelProfile({ provider: current.provider, model: 'deterministic-alternative', baseUrl: current.baseUrl, apiKey: 'offline-key',
      expectedVersion: current.version, contextWindow: 131072, maxOutputTokens: 2048, compactionReserveTokens: 16384, compactionKeepRecentTokens: 20000 }, undefined, true)).id;
  }
  const counts = { analyses: 0, reads: 0, sends: 0 };
  let heldPost: ReturnType<typeof barrier> | undefined, heldRead: ReturnType<typeof barrier> | undefined;
  let denyRead = false;
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const target = url.pathname.endsWith('/work-activity-analysis'), post = target && request.method() === 'POST';
    if (post) counts.analyses++; else if (target) counts.reads++;
    if (url.pathname.endsWith('/messages')) counts.sends++;
    if (target && !post && url.pathname.includes(a.id) && heldRead) await heldRead.promise;
    if (target && !post && url.pathname.includes(a.id) && denyRead) { await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'FORBIDDEN', message: '工作读取权限已撤销' } }) }); return; }
    const response = await app.inject({ method: request.method() as 'GET' | 'POST' | 'PUT', url: url.pathname + url.search,
      headers: { ...request.headers(), host: '127.0.0.1', origin: 'http://localhost:4310' },
      ...(request.postDataBuffer() ? { payload: request.postDataBuffer()! } : {}) });
    if (post && url.pathname.includes(a.id) && heldPost) await heldPost.promise;
    await route.fulfill({ status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])), body: response.rawPayload });
  });
  await page.goto(`/?session=${a.id}`); await expect(box(page)).toBeEnabled();
  return { lab, a, b, counts, works, alternativeModel, invalid: (value: boolean) => { invalid = value; }, deny: (value: boolean) => { denyRead = value; },
    open: () => page.getByRole('button', { name: '工作面板', exact: true }).click(),
    choose: (which: 'A' | 'B') => page.getByRole('button', { name: new RegExp(`^工作对话 ${which}`) }).click(),
    holdPost: () => { heldPost = barrier(); }, releasePost: () => { heldPost?.release(); heldPost = undefined; },
    holdRead: () => { heldRead = barrier(); }, releaseRead: () => { heldRead?.release(); heldRead = undefined; },
    send: async (text: string) => { await box(page).fill(text); const response = page.waitForResponse(value => value.url().endsWith('/messages')); await box(page).press('Enter'); await (await response).finished(); },
    startHeldTurn: () => {
      holdTurn = true;
      const running = lab.start(a.id, '继续编制，稍后结束本轮');
      const done = running.run(() => {});
      return async () => { holdTurn = false; if (lab.get(a.id).active) lab.cancel(a.id, running.requestId); await done; };
    },
    close: async () => { heldPost?.release(); heldRead?.release(); await page.goto('about:blank'); await page.unrouteAll({ behavior: 'wait' }); await app.close(); await rm(dir, { recursive: true, force: true }); },
  };
}

test('shows compact work rows with hover details, settings-only preference and no evidence controls', async ({ page }) => {
  const state = await setup(page, { receipt: true });
  try {
    const before = state.lab.get(state.a.id);
    const composerBefore = await box(page).boundingBox();
    expect(state.counts.analyses).toBe(0); await state.open();
    await expect(detail(page, '采购建议的本轮分析内容')).toBeVisible();
    expect(await box(page).boundingBox()).toEqual(composerBefore);
    const activity = panel(page).locator('.work-activity-item');
    await expect(activity).toHaveCount(2);
    const purchase = activity.filter({ has: page.getByRole('button', { name: '采购建议', exact: true }) });
    await expect(purchase).toHaveCount(1);
    await expect(purchase).toHaveText('采购建议');
    await expect(purchase.locator('.work-activity-link')).toHaveAttribute('title', /已接收该项工作/);
    await expect(panel(page).getByText(/判断依据|操作依据|根据最近对话识别/)).toHaveCount(0);
    await expect(panel(page).getByRole('checkbox')).toHaveCount(0);
    await expect(panel(page).getByText(/根据最近对话识别|尚未识别工作|已忽略本次识别结果|开始对话后可识别工作/)).toHaveCount(0);
    await expect(panel(page).getByRole('heading', { name: '工作', exact: true })).toHaveCount(0);
    await expect(panel(page).getByRole('heading', { name: /待接收工作/ })).toBeVisible();
    await expect(panel(page).getByRole('region', { name: /待接收工作/ }).getByRole('button', { name: '待接收事项', exact: true })).toBeVisible();
    const todo = panel(page).getByRole('region', { name: /席位待办/ });
    await expect(todo.getByRole('button', { name: '其他待办', exact: true })).toBeVisible();
    await expect(todo.getByRole('button', { name: '采购建议', exact: true })).toHaveCount(0);
    await expect(todo.getByRole('button', { name: '培训计划', exact: true })).toHaveCount(0);
    expect(state.lab.get(state.a.id)).toEqual(before);
    await box(page).fill('下一条尚未发送'); await box(page).blur(); expect(state.counts.analyses).toBe(1);
    await purchase.hover(); await purchase.getByRole('button', { name: '忽略采购建议的本次判断' }).click();
    await expect(detail(page, '采购建议的本轮分析内容')).toHaveCount(0);
    await expect(detail(page, '已接收该项工作')).toBeVisible();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '个人偏好', exact: true }).click();
    await page.getByRole('checkbox', { name: '识别本对话工作' }).uncheck();
    await page.getByRole('button', { name: '关闭面板', exact: true }).click();
    await expect(activity).toHaveCount(1); await expect(detail(page, '已接收该项工作')).toBeVisible();
    await expect(panel(page).getByRole('button', { name: '本席位', exact: true })).toHaveCount(0);
    await expect(panel(page).getByRole('region', { name: /席位待办/ }).getByRole('button', { name: '培训计划', exact: true })).toBeVisible();
    await panel(page).getByRole('button', { name: '收起工作面板' }).press('Escape');
    await expect(panel(page)).toHaveCount(0); await expect(page.getByRole('button', { name: '工作面板', exact: true })).toBeFocused();
  } finally { await state.close(); }
});

test('pending acceptance stays in its business section even when conversation analysis mentions it', async ({ page }) => {
  const state = await setup(page);
  try {
    await state.open(); await expect(detail(page, '采购建议的本轮分析内容')).toBeVisible();
    await state.send('先处理待接收事项');
    await expect(panel(page).getByRole('heading', { name: /^本对话处理中\s*0$/ })).toBeVisible();
    await expect(panel(page).getByRole('button', { name: '待接收事项', exact: true })).toHaveCount(1);
    const todo = panel(page).getByRole('region', { name: /席位待办/ });
    await expect(todo.getByRole('button', { name: '采购建议', exact: true })).toBeVisible();
    await expect(todo.getByRole('button', { name: '培训计划', exact: true })).toBeVisible();
  } finally { await state.close(); }
});

test('retains per-chat results across conversations, pages and models without persisting content', async ({ page }) => {
  const state = await setup(page, { models: true });
  try {
    await state.open(); await expect(detail(page, '采购建议的本轮分析内容')).toBeVisible();
    await state.choose('B'); await expect(detail(page, 'B 独立事项的本轮分析内容')).toBeVisible(); await expect(panel(page).getByText('未匹配工作记录')).toHaveCount(0);
    await state.choose('A'); await expect(detail(page, '采购建议的本轮分析内容')).toBeVisible();
    await page.getByRole('button', { name: '能力中心', exact: true }).click(); await state.choose('A'); await expect(detail(page, '采购建议的本轮分析内容')).toBeVisible();
    await page.getByRole('combobox', { name: '选择模型', exact: true }).selectOption(state.alternativeModel!);
    await expect(page.getByRole('combobox', { name: '选择模型', exact: true })).toBeEnabled(); await expect(detail(page, '采购建议的本轮分析内容')).toBeVisible();
    expect(state.counts.analyses).toBe(2);
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    expect(storage).not.toContain('本轮分析内容');
    await page.getByRole('combobox', { name: '选择模型', exact: true }).selectOption('default'); await expect(page.getByRole('combobox', { name: '选择模型', exact: true })).toBeEnabled();
    await page.reload(); await expect(box(page)).toBeEnabled(); await state.open(); await expect(detail(page, '采购建议的本轮分析内容')).toBeVisible(); expect(state.counts.analyses).toBe(3);
  } finally { await state.close(); }
});

test('activity updates keep confirmed receipts during a new running or cancelled turn while discarding old inference', async ({ page }) => {
  const state = await setup(page, { receipt: true });
  let finish: (() => Promise<void>) | undefined;
  try {
    await state.open(); await expect(detail(page, '采购建议的本轮分析内容')).toBeVisible();
    finish = state.startHeldTurn();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(detail(page, '采购建议的本轮分析内容')).toHaveCount(0); await expect(detail(page, '已接收该项工作')).toHaveCount(1);
    await expect(panel(page).getByText('此前处理 1', { exact: true })).toBeVisible();
    await expect(panel(page).getByText('对话处理结束后再识别工作。', { exact: true })).toHaveCount(0);
    await expect(detail(page, '已接收该项工作')).toBeHidden();
    await panel(page).getByText('此前处理 1', { exact: true }).click();
    await expect(detail(page, '已接收该项工作')).toBeVisible();
    const update = await page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/activity')); await update.finished();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(detail(page, '已接收该项工作')).toHaveCount(1); await expect(panel(page).getByRole('status', { name: '正在读取会话工作' })).toHaveCount(0);
    await finish(); finish = undefined;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(detail(page, '已接收该项工作')).toHaveCount(1); await expect(detail(page, '采购建议的本轮分析内容')).toHaveCount(0); expect(state.counts.analyses).toBe(1);
    state.holdRead(); finish = state.startHeldTurn();
    const started = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/activity'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await (await started).finished();
    await expect(detail(page, '已接收该项工作')).toHaveCount(0);
    state.releaseRead(); await expect(detail(page, '已接收该项工作')).toHaveCount(1);
  } finally { await finish?.(); await state.close(); }
});

test('a late analysis can cache to its original chat but cannot bypass a delayed return authorization read', async ({ page }) => {
  const state = await setup(page);
  try {
    state.holdPost(); await state.open(); await expect.poll(() => state.counts.analyses).toBe(1);
    await state.choose('B'); await expect(detail(page, 'B 独立事项的本轮分析内容')).toBeVisible();
    state.holdRead(); await state.choose('A'); await expect(panel(page).getByRole('status', { name: '正在读取会话工作' })).toBeVisible();
    const delivered = page.waitForResponse(response => response.url().includes(state.a.id) && response.url().endsWith('/work-activity-analysis') && response.request().method() === 'POST');
    state.releasePost(); await (await delivered).finished();
    await expect(detail(page, '采购建议的本轮分析内容')).toHaveCount(0);
    state.releaseRead(); await expect(detail(page, '采购建议的本轮分析内容')).toBeVisible(); expect(state.counts.analyses).toBe(2);
  } finally { await state.close(); }
});

test('denied reads remove cached analysis and a new turn replaces the old intent', async ({ page }) => {
  const state = await setup(page);
  try {
    await state.open(); await expect(detail(page, '采购建议的本轮分析内容')).toBeVisible();
    await state.choose('B'); await expect(detail(page, 'B 独立事项的本轮分析内容')).toBeVisible();
    state.deny(true); await state.choose('A'); await expect(panel(page)).toContainText('工作读取权限已撤销'); await expect(detail(page, '采购建议的本轮分析内容')).toHaveCount(0);
    state.deny(false); await panel(page).getByRole('button', { name: '重新识别' }).click(); await expect(detail(page, '采购建议的本轮分析内容')).toBeVisible();
    await state.send('闲聊一下，不处理工作'); await expect(panel(page).getByRole('heading', { name: /^本对话处理中\s*0$/ })).toBeVisible(); await expect(detail(page, '采购建议的本轮分析内容')).toHaveCount(0);
  } finally { await state.close(); }
});

test('failed analysis retries only explicitly and keeps references out of current work', async ({ page }) => {
  const state = await setup(page);
  try {
    state.invalid(true); await state.open(); await expect(panel(page).getByRole('button', { name: '重新识别' })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect(panel(page).getByRole('button', { name: '重新识别' })).toBeVisible(); expect(state.counts.analyses).toBe(1);
    state.invalid(false); await panel(page).getByRole('button', { name: '重新识别' }).click(); await expect(detail(page, '采购建议的本轮分析内容')).toBeVisible();
    await state.send('采购建议继续编制，培训计划仅参考');
    await expect(panel(page).locator('.work-activity-other')).toContainText('参考与待确认 1');
    await panel(page).locator('.work-activity-other > summary').click(); await expect(panel(page).locator('.work-activity-other .work-activity-link')).toHaveAttribute('title', /仅供参考/);
  } finally { await state.close(); }
});

test('seat changes clear all conversation analysis caches', async ({ page }) => {
  const state = await setup(page);
  try {
    await state.open(); await expect(detail(page, '采购建议的本轮分析内容')).toBeVisible();
    await state.choose('B'); await expect(detail(page, 'B 独立事项的本轮分析内容')).toBeVisible();
    const selector = () => page.locator('[data-seat]:visible').getByRole('combobox', { name: '测试席位', exact: true });
    await selector().selectOption('seat-b'); await expect(page.locator('[data-seat]:visible')).toHaveAttribute('data-seat', 'seat-b');
    await selector().selectOption('test-seat'); await expect(detail(page, 'B 独立事项的本轮分析内容')).toBeVisible();
    await state.choose('A'); await expect(detail(page, '采购建议的本轮分析内容')).toBeVisible(); expect(state.counts.analyses).toBe(4);
  } finally { await state.close(); }
});

test('desktop narrow panes retain readable work rows, composer and keyboard controls', async ({ page }) => {
  const state = await setup(page);
  try {
    await state.open(); await expect(detail(page, '采购建议的本轮分析内容')).toBeVisible();
    for (const width of [1440, 960]) {
      await page.setViewportSize({ width, height: 960 });
      await expect(box(page)).toBeVisible(); await expect(panel(page)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect((await box(page).boundingBox())!.width).toBeGreaterThan(120);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const composer = (await box(page).boundingBox())!;
      expect(composer.y + composer.height).toBeLessThanOrEqual(960);
      const floating = (await panel(page).boundingBox())!;
      expect(floating.y + floating.height).toBeLessThanOrEqual(composer.y);
      await expect(panel(page)).toHaveCSS('position', 'absolute');
      await page.screenshot({ path: `/tmp/axon-work-activity-${width === 1440 ? 'desktop' : 'narrow'}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByRole('button', { name: '打开态势地图', exact: true }).click();
    await expect(box(page)).toBeVisible(); await expect(panel(page)).toBeVisible(); expect((await box(page).boundingBox())!.width).toBeGreaterThan(120);
    await page.screenshot({ path: '/tmp/axon-work-activity-map-pane.png' });
  } finally { await state.close(); }
});

test('personal account activity stays private and logout/relogin never restores the previous identity cache', async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), 'axon-work-panel-personal-'));
  const db = await openDatabase(dir), access = new AccessStore(db); migrateAdministratorAccounts(db);
  const users = [];
  for (const [index, name] of ['甲', '乙'].entries()) users.push({ name, id: await access.saveAdministratorAccount({ username: `admin-${index}`, displayName: `管理员${name}`, password: 'test-password-123' }) });
  db.close();
  const config = testConfig(dir, { maxOutputTokens: 2048, auth: { secret: 'test-only-signing-key-at-least-32-characters', sessionMs: 28800000 } });
  const fake = await fakeRuntime(config, context => {
    if (!context.systemPrompt?.startsWith('识别当前对话近期处理的工作')) return { text: '个人资料已讨论。' };
    const message = context.messages[0];
    const value = JSON.parse(typeof message.content === 'string' ? message.content : JSON.stringify(message.content)) as { evidence: WorkActivityEvidence[]; candidates: unknown[] };
    expect(value.candidates).toEqual([]);
    const evidence = value.evidence.find(item => item.kind === 'user')!;
    return { text: JSON.stringify({ items: [{ workItemId: null, title: '个人编制事项', description: `${evidence.text}的分析内容`, relation: 'processing', evidenceIds: [evidence.id] }] }) };
  });
  const lab = await PiLab.create(config, fake.runtime), app = await createApp(lab);
  for (const user of users) {
    const identity = lab.access!.workspaceIdentity(user.id)!;
    const task = lab.access!.create(identity, { title: `个人资料${user.name}`, goal: '', visibility: 'private', clientActionId: randomUUID() });
    const workspace = await lab.workspaces.ensureWorkspace(task.id, identity.seatId, task.title);
    const session = await lab.createSession(workspace.id, identity.seatId, undefined, undefined, undefined, { userId: user.id });
    await lab.start(session.id, `个人会话${user.name}`, {}, identity.seatId, undefined, user.id).run(() => {});
  }
  let analyses = 0, businessReads = 0;
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith('/work-activity-analysis') && request.method() === 'POST') analyses++;
    if (url.pathname.endsWith('/work-items')) businessReads++;
    const response = await app.inject({ method: request.method() as 'GET' | 'POST' | 'PUT', url: url.pathname + url.search,
      headers: { ...request.headers(), host: '127.0.0.1', origin: 'http://localhost:4310' }, ...(request.postDataBuffer() ? { payload: request.postDataBuffer()! } : {}) });
    await route.fulfill({ status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])), body: response.rawPayload });
  });
  const login = async (name: string) => {
    await page.getByLabel('席位', { exact: true }).selectOption({ label: `管理员${name}` }); await page.getByLabel('密码', { exact: true }).fill('test-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click(); await page.getByRole('button', { name: `个人会话${name}`, exact: true }).click();
    await expect(box(page)).toBeEnabled(); await page.getByRole('button', { name: '工作面板', exact: true }).click();
    await expect(detail(page, `个人会话${name}的分析内容`)).toBeVisible();
  };
  const logout = async () => {
    await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: '账户', exact: true }).click();
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  };
  try {
    await page.goto('/'); await login('甲'); await expect(panel(page).getByText('待接收工作', { exact: true })).toHaveCount(0);
    await logout(); await login('乙'); await expect(detail(page, '个人会话甲的分析内容')).toHaveCount(0);
    await logout(); await login('甲'); expect(analyses).toBe(3); expect(businessReads).toBe(0);
  } finally { await page.goto('about:blank'); await page.unrouteAll({ behavior: 'wait' }); await app.close(); await rm(dir, { recursive: true, force: true }); }
});
