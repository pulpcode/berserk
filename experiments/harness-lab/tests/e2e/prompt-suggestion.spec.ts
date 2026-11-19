import { randomUUID } from 'node:crypto';
import { AccessStore } from '../../src/access/store';
import { openDatabase } from '../../src/access/database';
import { migrateAdministratorAccounts } from '../../src/access/administrator-schema';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';

const suggestion = '请把两份文件的修改点整理成清单。';
const box = (page: Page) => page.getByRole('textbox', { name: '发送消息', exact: true });
const candidate = (page: Page) => box(page).and(page.locator('.has-prompt-suggestion'));
const visibility = (page: Page, state: 'visible' | 'hidden') => page.evaluate(value => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  document.dispatchEvent(new Event('visibilitychange'));
}, state);

async function setup(page: Page, options: { admin?: boolean; text?: string; seats?: boolean; otherUser?: boolean; models?: boolean; distinct?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-web-prediction-'));
  let adminId: string | undefined, otherUserId: string | undefined;
  if (options.admin) {
    const db = await openDatabase(dir), access = new AccessStore(db); migrateAdministratorAccounts(db);
    adminId = await access.saveAdministratorAccount({ username: 'admin', displayName: '系统管理员', password: 'test-password-123' });
    if (options.otherUser) otherUserId = await access.saveAdministratorAccount({ username: 'other-admin', displayName: '另一管理员', password: 'test-password-123' });
    db.close();
  }
  const config = testConfig(dir, options.admin ? { auth: { secret: 'test-only-signing-key-at-least-32-characters', sessionMs: 28800000 } } : options.seats ? { seatId: 'test-seat', testSeats: [{ id: 'test-seat', name: 'A席位' }, { id: 'seat-b', name: 'B席位' }] } : {});
  const fake = await fakeRuntime(config, context => ({ text: context.systemPrompt?.startsWith('预测用户')
    ? options.distinct && JSON.stringify(context.messages).includes('历史对话 B') ? '请核对B的清单。' : options.text ?? suggestion : '两份文件的差异已整理。' }));
  const lab = await PiLab.create(config, fake.runtime), app = await createApp(lab);
  let alternativeModel: string | undefined;
  if (options.models) {
    const current = lab.modelSettings();
    alternativeModel = (await lab.updateModelProfile({ provider: current.provider, model: 'deterministic-alternative', baseUrl: current.baseUrl,
      apiKey: 'offline-fixture-key', expectedVersion: current.version, contextWindow: 131072, maxOutputTokens: 128,
      compactionReserveTokens: 16384, compactionKeepRecentTokens: 20000 }, undefined, true)).id;
  }
  let workspaceId: string | undefined, owner: string | undefined;
  if (adminId) {
    const identity = lab.access!.workspaceIdentity(adminId)!; owner = identity.seatId;
    const task = lab.access!.create(identity, { title: '个人资料', goal: '', visibility: 'private', clientActionId: randomUUID() });
    workspaceId = (await lab.workspaces.ensureWorkspace(task.id, owner, task.title)).id;
  }
  const makeSession = () => lab.createSession(workspaceId, owner, undefined, undefined, undefined, adminId ? { userId: adminId } : {});
  const a = await makeSession(); await lab.start(a.id, '历史对话 A', {}, owner, undefined, adminId).run(() => {});
  const b = await makeSession(); await lab.start(b.id, '历史对话 B', {}, owner, undefined, adminId).run(() => {});
  if (otherUserId) {
    const who = lab.access!.workspaceIdentity(otherUserId)!;
    const task = lab.access!.create(who, { title: '另一用户资料', goal: '', visibility: 'private', clientActionId: randomUUID() });
    const workspace = await lab.workspaces.ensureWorkspace(task.id, who.seatId, task.title);
    const session = await lab.createSession(workspace.id, who.seatId, undefined, undefined, undefined, { userId: otherUserId });
    await lab.start(session.id, '另一用户对话', {}, who.seatId, undefined, otherUserId).run(() => {});
  }
  const counts = { suggestions: 0, sends: 0 };
  let hold: { promise: Promise<void>; release: () => void } | undefined;
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const isSuggestion = url.pathname.endsWith('/prompt-suggestion');
    if (isSuggestion) counts.suggestions++;
    if (url.pathname.endsWith('/messages')) counts.sends++;
    const response = await app.inject({ method: request.method() as 'GET' | 'POST' | 'PUT', url: url.pathname + url.search,
      headers: { ...request.headers(), host: '127.0.0.1', origin: 'http://localhost:4310' },
      ...(request.postDataBuffer() ? { payload: request.postDataBuffer()! } : {}) });
    if (isSuggestion && hold) await hold.promise;
    await route.fulfill({ status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])), body: response.rawPayload });
  });
  await page.goto(`/?session=${a.id}`);
  if (options.admin) {
    await page.getByLabel('席位', { exact: true }).selectOption({ label: options.otherUser ? '系统管理员' : '管理员席' });
    await page.getByLabel('密码', { exact: true }).fill('test-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('button', { name: '历史对话 A', exact: true }).click();
  }
  await expect(box(page)).toBeEnabled();
  return { a, b, counts, lab, alternativeModel,
    hold: () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); hold = { promise, release }; },
    release: () => { hold?.release(); hold = undefined; },
    send: async () => {
      await box(page).fill('核对两份文件');
      await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
      const response = page.waitForResponse(value => new URL(value.url()).pathname.endsWith('/messages') && value.request().method() === 'POST');
      await box(page).press('Enter'); await (await response).finished();
    },
    close: async () => { hold?.release(); await page.goto('about:blank'); await page.unrouteAll({ behavior: 'wait' }); await app.close(); await rm(dir, { recursive: true, force: true }); },
  };
}

test('shows only after a fresh turn, hides for any input, restores on empty and accepts without sending', async ({ page }) => {
  const state = await setup(page);
  try {
    expect(state.counts.suggestions).toBe(0);
    const originalHeight = await box(page).evaluate(node => node.getBoundingClientRect().height);
    await state.send(); await expect(candidate(page)).toBeVisible();
    await expect(page.getByRole('button', { name: /采纳建议/ })).toHaveCount(0);
    await expect(box(page)).toHaveValue(''); await expect(box(page)).toHaveAttribute('placeholder', suggestion);
    expect(await box(page).evaluate(node => node.getBoundingClientRect().height)).toBe(originalHeight);
    await box(page).press('Enter'); expect(state.counts.sends).toBe(1);
    await box(page).fill('请把两份文件'); await expect(candidate(page)).toBeHidden();
    await box(page).press('Tab'); await expect(box(page)).toHaveValue('请把两份文件');
    await box(page).fill('请'); await expect(candidate(page)).toBeHidden();
    await box(page).fill(' '); await expect(candidate(page)).toBeHidden();
    await box(page).fill('\n'); await expect(candidate(page)).toBeHidden();
    await box(page).fill(''); await expect(candidate(page)).toBeVisible();
    await box(page).press('Tab'); await expect(box(page)).toHaveValue(suggestion);
    expect(state.counts.sends).toBe(1); expect(state.counts.suggestions).toBe(1);
    await box(page).fill(''); await expect(candidate(page)).toBeVisible();
    await box(page).press('Tab'); await expect(box(page)).toHaveValue(suggestion); expect(state.counts.sends).toBe(1);
    await page.reload(); await expect(box(page)).toHaveValue(suggestion); expect(state.counts.suggestions).toBe(1);
    await box(page).fill(''); await expect(candidate(page)).toBeHidden();
  } finally { await state.close(); }
});

test('IME and reference menu own their keys, Escape rejects the candidate, and other controls keep Tab', async ({ page }) => {
  const state = await setup(page);
  try {
    await state.send(); await expect(candidate(page)).toBeVisible();
    await box(page).dispatchEvent('compositionstart'); await expect(candidate(page)).toBeHidden();
    await box(page).dispatchEvent('keydown', { key: 'Tab', code: 'Tab', isComposing: true, keyCode: 229 });
    await box(page).dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 });
    await expect(box(page)).toHaveValue(''); expect(state.counts.sends).toBe(1);
    await box(page).dispatchEvent('compositionend'); await expect(candidate(page)).toBeVisible();
    await page.getByRole('button', { name: '添加附件', exact: true }).click(); await expect(candidate(page)).toBeHidden();
    await box(page).press('Escape'); await expect(candidate(page)).toBeVisible();
    await page.getByRole('button', { name: '添加附件', exact: true }).focus(); await page.keyboard.press('Tab'); await expect(box(page)).toHaveValue('');
    await box(page).focus(); await box(page).press('Escape'); await expect(candidate(page)).toBeHidden();
    await box(page).fill('请'); await box(page).fill(''); await expect(candidate(page)).toBeHidden(); expect(state.counts.suggestions).toBe(1);
  } finally { await state.close(); }
});

test('typing before the prediction arrives cancels it permanently for that turn', async ({ page }) => {
  const state = await setup(page);
  try {
    state.hold(); await state.send(); await expect.poll(() => state.counts.suggestions).toBe(1);
    await box(page).fill('我自己的输入'); await box(page).fill(''); state.release();
    await expect(box(page)).not.toHaveAttribute('placeholder', suggestion); await expect(candidate(page)).toBeHidden();
    await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: '关闭面板', exact: true }).click();
    expect(state.counts.suggestions).toBe(1); await expect(candidate(page)).toBeHidden();
  } finally { await state.close(); }
});

test('backgrounding preserves an existing candidate and restores it without another request', async ({ page }) => {
  const state = await setup(page);
  try {
    await state.send(); await expect(candidate(page)).toBeVisible();
    await visibility(page, 'hidden'); await expect(candidate(page)).toBeHidden();
    await visibility(page, 'visible'); await expect(candidate(page)).toBeVisible();
    await expect(box(page)).toHaveAttribute('placeholder', suggestion); await expect(box(page)).toHaveValue('');
    expect(state.counts.suggestions).toBe(1);
    await box(page).press('Tab'); await expect(box(page)).toHaveValue(suggestion); expect(state.counts.sends).toBe(1);
    await box(page).fill(''); await expect(candidate(page)).toBeVisible();
    await page.getByRole('button', { name: /历史对话 B/ }).click();
    await page.getByRole('button', { name: /历史对话 A/ }).click();
    await expect(candidate(page)).toBeVisible(); expect(state.counts.suggestions).toBe(1);
  } finally { await state.close(); }
});

test('backgrounding cancels a pending prediction and returning does not revive or retry it', async ({ page }) => {
  const state = await setup(page);
  try {
    state.hold(); await state.send(); await expect.poll(() => state.counts.suggestions).toBe(1);
    await visibility(page, 'hidden'); await visibility(page, 'visible'); state.release();
    await expect(candidate(page)).toBeHidden(); await expect(box(page)).toHaveValue('');
    await expect(box(page)).not.toHaveAttribute('placeholder', suggestion); expect(state.counts.suggestions).toBe(1);
  } finally { await state.close(); }
});

test('switching A→B→A rejects a delayed response and preserves each draft', async ({ page }) => {
  const state = await setup(page);
  try {
    state.hold(); await state.send(); await expect.poll(() => state.counts.suggestions).toBe(1);
    await page.getByRole('button', { name: /历史对话 B/ }).click(); await expect(box(page)).toHaveValue('');
    await box(page).fill('B 的草稿');
    await page.getByRole('button', { name: /历史对话 A/ }).click(); state.release();
    await expect(box(page)).toHaveValue(''); await expect(candidate(page)).toBeHidden();
    await page.getByRole('button', { name: /历史对话 B/ }).click(); await expect(box(page)).toHaveValue('B 的草稿');
    expect(state.counts.suggestions).toBe(1);
  } finally { await state.close(); }
});

test('keeps separate candidates across conversations, business views and model selection', async ({ page }) => {
  const state = await setup(page, { models: true, distinct: true });
  try {
    await state.send(); await expect(candidate(page)).toHaveAttribute('placeholder', suggestion);
    await page.getByRole('button', { name: '历史对话 B', exact: true }).click();
    await state.send(); await expect(candidate(page)).toHaveAttribute('placeholder', '请核对B的清单。');
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    expect(storage).not.toContain(suggestion); expect(storage).not.toContain('请核对B的清单。');
    await page.getByRole('button', { name: '历史对话 A', exact: true }).click();
    await expect(candidate(page)).toHaveAttribute('placeholder', suggestion);
    await page.getByRole('button', { name: '能力中心', exact: true }).click();
    await page.getByRole('button', { name: '历史对话 A', exact: true }).click();
    await expect(candidate(page)).toHaveAttribute('placeholder', suggestion);
    await page.getByRole('combobox', { name: '选择模型', exact: true }).selectOption(state.alternativeModel!);
    await expect(page.getByRole('combobox', { name: '选择模型', exact: true })).toBeEnabled();
    await expect(candidate(page)).toHaveAttribute('placeholder', suggestion);
    await box(page).press('Tab'); await expect(box(page)).toHaveValue(suggestion); await box(page).fill('');
    await page.getByRole('button', { name: '历史对话 B', exact: true }).click();
    await expect(candidate(page)).toHaveAttribute('placeholder', '请核对B的清单。');
    expect(state.counts.suggestions).toBe(2); expect(state.counts.sends).toBe(2);
    await page.reload(); await expect(box(page)).toBeEnabled(); await expect(candidate(page)).toBeHidden();
    await page.getByRole('button', { name: '历史对话 A', exact: true }).click(); await expect(candidate(page)).toBeHidden();
    expect(state.counts.suggestions).toBe(2);
  } finally { await state.close(); }
});

test('rejects cached text when another window has started a newer turn', async ({ page }) => {
  const state = await setup(page);
  try {
    await state.send(); await expect(candidate(page)).toBeVisible();
    await page.getByRole('button', { name: '历史对话 B', exact: true }).click();
    await state.lab.start(state.a.id, '另一个窗口的新任务').run(() => {});
    const read = page.waitForResponse(response => response.url().endsWith(`/sessions/${state.a.id}`) && response.request().method() === 'GET');
    await page.getByRole('button', { name: '历史对话 A', exact: true }).click(); await (await read).finished();
    await expect(candidate(page)).toBeHidden(); await box(page).press('Tab'); await expect(box(page)).toHaveValue('');
    expect(state.counts.suggestions).toBe(1);
  } finally { await state.close(); }
});

test('rechecks access before restoring and discards a denied candidate', async ({ page }) => {
  const state = await setup(page);
  const path = `**/api/sessions/${state.a.id}`;
  try {
    await state.send(); await expect(candidate(page)).toBeVisible();
    await page.getByRole('button', { name: '历史对话 B', exact: true }).click();
    await page.route(path, route => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'FORBIDDEN', message: '权限已撤销' } }) }));
    const denied = page.waitForResponse(response => response.url().endsWith(`/sessions/${state.a.id}`) && response.status() === 403);
    await page.getByRole('button', { name: '历史对话 A', exact: true }).click(); await denied;
    await expect(candidate(page)).toBeHidden(); await box(page).press('Tab'); await expect(box(page)).toHaveValue('');
    await page.unroute(path);
    await page.getByRole('button', { name: '历史对话 B', exact: true }).click();
    await page.getByRole('button', { name: '历史对话 A', exact: true }).click();
    await expect(candidate(page)).toBeHidden(); expect(state.counts.suggestions).toBe(1);
  } finally { await page.unroute(path); await state.close(); }
});

test('switching seats clears every cached conversation, including when switching back', async ({ page }) => {
  const state = await setup(page, { seats: true });
  try {
    await state.send(); await expect(candidate(page)).toBeVisible();
    await page.getByRole('button', { name: '历史对话 B', exact: true }).click();
    await state.send(); await expect(candidate(page)).toBeVisible();
    const selector = () => page.locator('[data-seat]:visible').getByRole('combobox', { name: '测试席位', exact: true });
    await selector().selectOption('seat-b'); await selector().selectOption('test-seat');
    await expect(candidate(page)).toBeHidden();
    await page.getByRole('button', { name: '历史对话 A', exact: true }).click();
    await expect(candidate(page)).toBeHidden(); expect(state.counts.suggestions).toBe(2);
  } finally { await state.close(); }
});

test('logout and another user cannot restore an earlier identity cache', async ({ page }) => {
  const state = await setup(page, { admin: true, otherUser: true });
  const logout = async () => {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '账户', exact: true }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  };
  const login = async (name: string, title: string) => {
    await page.getByLabel('席位', { exact: true }).selectOption({ label: name });
    await page.getByLabel('密码', { exact: true }).fill('test-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('button', { name: title, exact: true }).click(); await expect(box(page)).toBeEnabled();
  };
  try {
    await state.send(); await expect(candidate(page)).toBeVisible();
    await logout(); await login('另一管理员', '另一用户对话');
    await expect(candidate(page)).toBeHidden();
    await logout(); await login('系统管理员', '历史对话 A');
    await expect(candidate(page)).toBeHidden(); expect(state.counts.suggestions).toBe(1);
  } finally { await state.close(); }
});

test('the preference disables generation and survives refresh without a new prediction', async ({ page }) => {
  const state = await setup(page);
  try {
    await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: '个人偏好', exact: true }).click();
    await page.getByRole('checkbox', { name: '显示下一步输入建议', exact: true }).uncheck();
    await page.getByRole('button', { name: '关闭面板', exact: true }).click();
    await state.send(); await expect.poll(() => state.counts.sends).toBe(1);
    await expect(page.getByText('两份文件的差异已整理。', { exact: true }).last()).toBeVisible();
    expect(state.counts.suggestions).toBe(0); await page.reload();
    await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: '个人偏好', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: '显示下一步输入建议', exact: true })).not.toBeChecked();
    await page.getByRole('checkbox', { name: '显示下一步输入建议', exact: true }).check(); await page.getByRole('button', { name: '关闭面板', exact: true }).click();
    await expect(candidate(page)).toBeHidden(); expect(state.counts.suggestions).toBe(0);
    await state.send(); await expect(candidate(page)).toBeVisible(); expect(state.counts.suggestions).toBe(1);
  } finally { await state.close(); }
});

test('desktop widths and enlarged text keep the native placeholder and controls contained', async ({ page }) => {
  const state = await setup(page);
  try {
    await state.send(); await expect(candidate(page)).toBeVisible();
    for (const [width, zoom] of [[1440, 1], [960, 1], [1440, 1.25], [1440, 1.5]] as const) {
      await page.setViewportSize({ width, height: 960 }); await page.evaluate(value => { document.body.style.zoom = String(value); }, zoom);
      await expect(candidate(page)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const rect = await box(page).boundingBox(); expect(rect!.width).toBeGreaterThan(120);
    }
    await page.evaluate(() => { document.body.style.zoom = ''; }); await page.setViewportSize({ width: 1440, height: 960 });
    await page.screenshot({ path: '/tmp/axon-input-prediction-desktop.png' });
    await page.getByRole('button', { name: '打开态势地图', exact: true }).click();
    await expect(candidate(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/axon-input-prediction-three-pane.png' });
  } finally { await state.close(); }
});


test('a long candidate remains a placeholder until acceptance and is available in full', async ({ page }) => {
  const text = '请逐一核对两个文件中的修改内容、日期、负责人及待确认事项，保留已知限制，整理为可复核的清单。'.repeat(4) + ' Include emoji 🌟。';
  const state = await setup(page, { text });
  try {
    await page.setViewportSize({ width: 960, height: 960 });
    await state.send();
    await expect(candidate(page)).toBeVisible(); await expect(box(page)).toHaveAttribute('title', text); await expect(box(page)).toHaveValue('');
    expect(await box(page).evaluate(node => node.getBoundingClientRect().height)).toBeLessThan(50);
    await box(page).press('Tab'); await expect(box(page)).toHaveValue(text); expect(state.counts.sends).toBe(1);
    expect(await box(page).evaluate(node => node.getBoundingClientRect().height)).toBeLessThanOrEqual(180);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally { await state.close(); }
});

test('administrator personal chats expose the general preference alongside model management', async ({ page }) => {
  const state = await setup(page, { admin: true });
  try {
    await state.send(); await expect(candidate(page)).toBeVisible();
    await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: '个人偏好', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: '显示下一步输入建议', exact: true })).toBeChecked();
    await expect(page.getByRole('navigation', { name: '设置分类', exact: true }).getByRole('button', { name: '模型管理', exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: '显示下一步输入建议', exact: true }).uncheck(); await page.getByRole('button', { name: '关闭面板', exact: true }).click();
    await expect(candidate(page)).toBeHidden(); await box(page).fill('测试输入'); await box(page).fill(''); await expect(candidate(page)).toBeHidden();
  } finally { await state.close(); }
});
