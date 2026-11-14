import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';

/** Browser + real application API and Pi persistence; only the model transport is replaced. */
async function setup(page: Page) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-capability-web-'));
  const config = testConfig(dir);
  const fake = await fakeRuntime(config, () => ({ text: '资料综合完成。' }));
  const lab = await PiLab.create(config, fake.runtime);
  const app = await createApp(lab);
  const creationBodies: Array<Record<string, unknown>> = [];
  let loseNextCreationResponse = false;
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const creation = request.method() === 'POST' && url.pathname === '/api/sessions';
    if (creation) creationBodies.push(request.postDataJSON() as Record<string, unknown>);
    const response = await app.inject({ method: request.method() as 'GET' | 'POST' | 'PUT', url: url.pathname + url.search,
      headers: { ...await request.allHeaders(), host: '127.0.0.1', origin: 'http://localhost:4310' },
      ...(request.postDataBuffer() ? { payload: request.postDataBuffer()! } : {}) });
    if (creation && loseNextCreationResponse) { loseNextCreationResponse = false; await route.abort('failed'); return; }
    await route.fulfill({ status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])), body: response.rawPayload });
  });
  return { lab, fake, creationBodies, loseCreationResponse: () => { loseNextCreationResponse = true; }, close: async () => {
    if (!page.isClosed()) { await page.goto('about:blank'); await page.unrouteAll({ behavior: 'wait' }); }
    await app.close(); await rm(dir, { recursive: true, force: true });
  } };
}

test('professional expert creation is empty, cancelable and retains existing conversation drafts', async ({ page }) => {
  const env = await setup(page);
  try {
    const prior = await env.lab.createSession();
    await page.goto(`/?session=${prior.id}`);
    await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('保留在原会话的草稿');
    await page.getByRole('button', { name: '能力中心', exact: true }).click();
    const center = page.locator('.capability-center');
    await expect(center.getByRole('heading', { name: /^资料综合专家/ })).toBeVisible();
    await expect(center.getByRole('navigation', { name: '专业专家列表' })).not.toContainText('Axon 通用助手');
    await expect(center.getByRole('navigation', { name: '专业专家列表' })).not.toContainText('analyst');
    await center.getByRole('button', { name: '查看资料综合专家（示范）', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('资料综合写作');
    await page.getByRole('button', { name: '与专家协作', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /^与资料综合专家.*协作$/ });
    await expect(dialog.getByRole('button', { name: '创建专家会话' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await env.lab.list()).toHaveLength(1);
    expect(env.fake.calls).toHaveLength(0);
    await page.getByRole('button', { name: '与专家协作', exact: true }).click();
    const workspaces = env.lab.workspaces.list().workspaces;
    await page.getByLabel('工作空间', { exact: true }).selectOption(workspaces[0].id);
    await page.getByRole('button', { name: '创建专家会话', exact: true }).click();
    await expect(page.locator('.session-expert-identity')).toContainText('资料综合专家');
    await expect(page.locator('.composer-toolbar .session-expert-identity')).toBeVisible();
    await expect(page.locator('.session-expert-identity')).not.toContainText(/版本|修订|rev-/);
    await expect(page.locator('.session-expert-notice')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('expert-composer-desktop.png') });
    await page.setViewportSize({ width: 1060, height: 800 });
    const toolbar = page.locator('.composer-toolbar');
    expect(await toolbar.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeVisible();

    await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue('');
    expect(await env.lab.list()).toHaveLength(2);
    expect(env.fake.calls).toHaveLength(0);
    expect(env.creationBodies[0]).toMatchObject({ expertRef: expect.objectContaining({ expertId: expect.any(String), revisionId: expect.any(String) }), expectedDigest: expect.stringMatching(/^[a-f0-9]{64}$/), clientActionId: expect.any(String) });
    await page.reload();
    await expect(page.locator('.session-expert-identity')).toContainText('资料综合专家');
    await page.goto(`/?session=${prior.id}`);
    await expect(page.locator('.session-expert-identity')).toContainText('Axon 通用助手');
    await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue('保留在原会话的草稿');
  } finally { await env.close(); }
});

test('a lost creation response is retried with the same action and does not create another session', async ({ page }) => {
  const env = await setup(page);
  try {
    await page.goto('/capabilities');
    await page.getByRole('button', { name: /^查看资料综合专家/ }).click();
    await page.getByRole('button', { name: '与专家协作', exact: true }).click();
    await page.getByLabel('工作空间', { exact: true }).selectOption(env.lab.workspaces.list().workspaces[0].id);
    env.loseCreationResponse();
    await page.getByRole('button', { name: '创建专家会话', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('暂时无法连接服务');
    expect(await env.lab.list()).toHaveLength(1);
    await page.reload();
    await page.getByRole('button', { name: /^查看资料综合专家/ }).click();
    await page.getByRole('button', { name: '与专家协作', exact: true }).click();
    await page.getByLabel('工作空间', { exact: true }).selectOption(env.lab.workspaces.list().workspaces[0].id);
    await page.getByRole('button', { name: '创建专家会话', exact: true }).click();
    await expect(page.locator('.session-expert-identity')).toContainText('资料综合专家');
    expect(env.creationBodies).toHaveLength(2);
    expect(env.creationBodies[1]).toEqual(env.creationBodies[0]);
    expect(await env.lab.list()).toHaveLength(1);
    expect(env.fake.calls).toHaveLength(0);
    await page.screenshot({ path: test.info().outputPath('capability-empty-conversation-desktop.png') });
  } finally { await env.close(); }
});

test('ordinary new conversation keeps the general assistant and uses an action ID', async ({ page }) => {
  const env = await setup(page);
  try {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto('/');
    await page.getByRole('button', { name: '新建对话', exact: true }).click();
    await page.getByRole('button', { name: '创建对话', exact: true }).click();
    await expect(page.locator('.session-expert-identity')).toContainText('Axon 通用助手');
    expect(env.creationBodies[0]).toMatchObject({ clientActionId: expect.any(String) });
    expect(env.creationBodies[0].expertRef).toBeUndefined();
    expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); }
});

test('a disabled expert retains its conversation and draft while sending is blocked', async ({ page }) => {
  const env = await setup(page);
  try {
    await page.goto('/capabilities');
    await page.getByRole('button', { name: /^查看资料综合专家/ }).click();
    await page.getByRole('button', { name: '与专家协作', exact: true }).click();
    await page.getByLabel('工作空间', { exact: true }).selectOption(env.lab.workspaces.list().workspaces[0].id);
    await page.getByRole('button', { name: '创建专家会话', exact: true }).click();
    await expect(page.locator('.session-expert-identity')).toContainText('资料综合专家');
    const session = (await env.lab.list())[0];
    const detail = await env.lab.get(session.id);
    env.lab.capabilities.setState({ expertId: detail.expert!.expertId }, 'disabled', '专家已停用，请联系管理员核对。');
    await expect(page.locator('.expert-unavailable')).toContainText('专家已停用');
    await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('保留这段待发送内容');
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
    await page.reload();
    await expect(page.locator('.expert-unavailable')).toContainText('专家已停用');
    await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue('保留这段待发送内容');
    expect(await env.lab.list()).toHaveLength(1);
    expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); }
});

test('capability tabs share searchable cards and real read-only skills without creating work', async ({ page }) => {
  const env = await setup(page);
  try {
    await page.goto('/capabilities');
    const center = page.locator('.capability-center');
    await expect(center.getByRole('heading', { name: '资料综合专家（示范）', exact: true })).toBeVisible();
    await expect(center.getByRole('button', { name: '创建专家', exact: true })).toHaveCount(0);
    await expect(center.locator('.expert-list')).not.toContainText(/版本|修订|rev-/);
    await center.getByRole('searchbox', { name: '搜索专家', exact: true }).fill('没有匹配的内容');
    await expect(center.getByRole('heading', { name: '没有找到相关专家', exact: true })).toBeVisible();
    await center.getByRole('tab', { name: '技能', exact: true }).click();
    await expect(center.locator('.capability-skill-list')).toContainText('资料综合写作');
    await page.screenshot({ path: test.info().outputPath('capability-skills-desktop-wide.png') });
    await center.getByRole('searchbox', { name: '搜索技能', exact: true }).fill('资料综合');
    await expect(center.locator('.skill-card')).toHaveCount(1);
    await center.getByRole('button', { name: '查看技能资料综合写作', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '资料综合写作', exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: '关闭面板', exact: true }).click();
    await center.getByRole('tab', { name: '技能', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(center.getByRole('tab', { name: '连接器', exact: true })).toBeFocused();
    await expect(center.getByRole('heading', { name: '暂无连接器', exact: true })).toBeVisible();
    await expect(center.getByRole('button', { name: /连接$|安装|添加技能/ })).toHaveCount(0);
    await center.getByRole('tab', { name: '专家', exact: true }).click();
    const selectedTab = center.getByRole('tab', { name: '专家', exact: true });
    await selectedTab.hover();
    const contrast = await selectedTab.evaluate(element => {
      const style = getComputedStyle(element);
      const luminance = (color: string) => { const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => { const component = value / 255; return component <= .04045 ? component / 12.92 : ((component + .055) / 1.055) ** 2.4; }); return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]; };
      const foreground = luminance(style.color), background = luminance(style.backgroundColor);
      return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: test.info().outputPath('capability-grid-desktop-wide.png') });
    await page.setViewportSize({ width: 1060, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await center.locator('.capability-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2);
    await page.screenshot({ path: test.info().outputPath('capability-grid-desktop-narrow.png') });
    await center.getByRole('tab', { name: '技能', exact: true }).click();
    await expect(center.locator('.skill-card').first()).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('capability-skills-desktop-narrow.png') });
    expect(env.creationBodies).toHaveLength(0); expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); }
});
