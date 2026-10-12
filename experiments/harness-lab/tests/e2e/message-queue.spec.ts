import { test, expect, type Page, type Route } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';

const composer = (page: Page) => page.getByRole('textbox', { name: '发送消息', exact: true });
async function setup(page: Page) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-queue-browser-'));
  const config = testConfig(dir);
  const fake = await fakeRuntime(config, () => ({ waitForAbort: true }));
  const lab = await PiLab.create(config, fake.runtime);
  const session = await lab.createSession();
  const request = lab.start(session.id, '开始测试');
  const running = request.run(() => {});
  await expect.poll(() => lab.get(session.id).inputQueue?.available).toBe(true);
  const app = await createApp(lab);
  const reply = async (route: Route) => {
    const req = route.request(); const url = new URL(req.url());
    return app.inject({ method: req.method() as 'GET' | 'POST' | 'PUT' | 'DELETE', url: url.pathname + url.search,
      headers: { ...req.headers(), host: '127.0.0.1', origin: 'http://localhost:4310' },
      ...(req.postDataBuffer() ? { payload: req.postDataBuffer()! } : {}) });
  };
  await page.route('**/api/**', async route => {
    const response = await reply(route);
    await route.fulfill({ status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])), body: response.rawPayload });
  });
  await page.addInitScript(() => { Object.defineProperty(crypto, 'randomUUID', { value: undefined }); });
  await page.goto('/');
  await expect(composer(page)).toBeEnabled();
  await expect(page.getByRole('button', { name: '停止回复', exact: true })).toBeEnabled();
  return { lab, session, reply, close: async () => {
    if (lab.get(session.id).active?.requestId === request.requestId) lab.cancel(session.id, request.requestId);
    await running;
    await page.goto('about:blank'); await page.unrouteAll({ behavior: 'wait' });
    await app.close(); await rm(dir, { recursive: true, force: true });
  } };
}

test('queue keeps identical submissions independent, supports 引导 / undo / takeback and restores on stop', async ({ page }) => {
  const env = await setup(page);
  const rows = page.locator('.input-queue-row');
  try {
    for (let n = 0; n < 2; n++) {
      await composer(page).fill('相同的补充'); await composer(page).press('Enter');
      await expect(rows).toHaveCount(n + 1); await expect(composer(page)).toHaveValue('');
    }
    await rows.first().getByRole('button', { name: '引导', exact: true }).click();
    await expect(rows.first()).toContainText('等待引导');
    await rows.last().getByRole('button', { name: '删除排队消息' }).click();
    await expect(rows).toHaveCount(1);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(rows).toHaveCount(2);
    await composer(page).fill('正在编辑的草稿');
    await rows.last().getByRole('button', { name: '更多消息操作' }).click();
    await page.getByRole('button', { name: '取回编辑', exact: true }).click();
    await expect(composer(page)).toHaveValue('正在编辑的草稿\n\n相同的补充');
    await expect(rows).toHaveCount(1);
    await page.getByRole('button', { name: '停止回复', exact: true }).click();
    await expect(rows).toHaveCount(0);
    await expect(composer(page)).toHaveValue('正在编辑的草稿\n\n相同的补充\n\n相同的补充');
    await page.reload();
    await expect(composer(page)).toHaveValue('正在编辑的草稿\n\n相同的补充\n\n相同的补充');
    expect(env.lab.get(env.session.id).messages.filter(item => item.role === 'user')).toHaveLength(1);
  } finally { await env.close(); }
});

test('lost acceptance response is queried after reload without reposting; shortcut and narrow layout work', async ({ page }) => {
  const env = await setup(page); let posted = 0;
  try {
    await page.route('**/api/sessions/*/inputs', async route => {
      posted++; await env.reply(route); await route.abort('failed');
    });
    await composer(page).fill('确认只接收一次'); await composer(page).press('Control+Enter');
    await expect(page.getByRole('button', { name: '查询状态', exact: true })).toBeVisible();
    await expect(composer(page)).toHaveValue('确认只接收一次');
    await page.reload();
    await page.getByRole('button', { name: '查询状态', exact: true }).click();
    await expect(composer(page)).toHaveValue('');
    await expect(page.locator('.input-queue-row')).toHaveCount(1);
    await expect(page.locator('.input-queue-row')).toContainText('等待引导');
    expect(posted).toBe(1);
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator('.input-queue-row')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/axon-message-queue-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.screenshot({ path: '/tmp/axon-message-queue-desktop.png' });
  } finally { await env.close(); }
});

test('late acknowledgement preserves a retyped draft and composition never submits', async ({ page }) => {
  const env = await setup(page);
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let accepted = false;
  try {
    await composer(page).fill('同文新草稿');
    await composer(page).dispatchEvent('compositionstart');
    await composer(page).press('Enter');
    expect(env.lab.get(env.session.id).inputQueue?.items).toHaveLength(0);
    await composer(page).dispatchEvent('compositionend');
    await page.route('**/api/sessions/*/inputs', async route => {
      const response = await env.reply(route); accepted = true; await gate;
      await route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.rawPayload });
    });
    await composer(page).press('Enter');
    await expect.poll(() => accepted).toBe(true);
    await composer(page).fill(''); await composer(page).fill('同文新草稿');
    release();
    await expect(page.locator('.input-queue-row')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '排队', exact: true })).toBeEnabled();
    await expect(composer(page)).toHaveValue('同文新草稿');
    await composer(page).press('Shift+Enter');
    await expect(composer(page)).toHaveValue('同文新草稿\n');
    expect(env.lab.get(env.session.id).inputQueue?.items).toHaveLength(1);
    await page.getByRole('button', { name: '选择追加方式', exact: true }).click();
    await page.getByRole('button', { name: '引导发送', exact: true }).click();
    await expect(page.locator('.input-queue-row')).toHaveCount(2);
    await expect(page.locator('.input-queue-row').last()).toContainText('等待引导');
    await expect(composer(page)).toHaveValue('');
  } finally { release(); await env.close(); }
});
