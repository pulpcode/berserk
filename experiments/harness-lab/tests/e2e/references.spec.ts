import { appendFile, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createApp } from '../../src/server/app.js';
import { PiLab } from '../../src/pi/lab.js';
import { fakeRuntime, testConfig } from '../pi/fake-runtime.js';

// Browser -> actual local API -> Pi; the provider is deterministic, not live acceptance.
async function setup(page: Page, maxAttachments = 20) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-web-references-'));
  const roles = join(dir, 'roles'); await cp('fixtures/agents', roles, { recursive: true });
  const config = testConfig(dir, { agentRolesDir: roles, fileLimits: { maxFileBytes: 1024 * 1024, maxAttachments }, seatId: 'test-seat', testSeats: [{ id: 'test-seat', name: '席位 A' }, { id: 'seat-b', name: '席位 B' }] });
  const fake = await fakeRuntime(config, () => ({ text: '本轮处理完成' }));
  const lab = await PiLab.create(config, fake.runtime);
  const app = await createApp(lab);
  const controls = { delayAgents: 0, delayCreate: 0, delayReply: 0 };
  const messages: Record<string, unknown>[] = [];
  const paths: string[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname + url.search; paths.push(path);
    if (request.method() === 'POST' && url.pathname.endsWith('/messages')) messages.push(request.postDataJSON());
    const response = await app.inject({ method: request.method() as 'GET' | 'POST' | 'PUT' | 'DELETE', url: path, headers: { host: '127.0.0.1', ...(request.headers()['content-type'] ? { 'content-type': request.headers()['content-type'] } : {}) }, ...(request.postDataBuffer() ? { payload: request.postDataBuffer()! } : {}) });
    if (request.method() === 'POST' && url.pathname.endsWith('/messages') && controls.delayReply) await new Promise(resolve => setTimeout(resolve, controls.delayReply));
    if (url.pathname.endsWith('/agents') && controls.delayAgents) await new Promise(resolve => setTimeout(resolve, controls.delayAgents));
    if (request.method() === 'POST' && url.pathname.endsWith('/sessions') && controls.delayCreate) await new Promise(resolve => setTimeout(resolve, controls.delayCreate));
    await route.fulfill({ status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])), body: response.rawPayload });
  });
  const workspace = lab.workspaces.get();
  const files = lab.files.filesDirectory(workspace.id);
  await mkdir(join(files, 'plans'));
  await writeFile(join(files, 'plans', '方案.md'), '# 方案');
  await writeFile(join(files, '任务书.md'), '# 任务');
  await Promise.all(Array.from({ length: 22 }, (_, index) => writeFile(join(files, `资料${String(index).padStart(2, '0')}.txt`), '资料')));
  return { lab, workspace, files, roles, controls, messages, paths, calls: fake.calls, close: async () => { await page.goto('about:blank'); await page.unrouteAll({ behavior: 'wait' }); await app.close(); await rm(dir, { recursive: true, force: true }); } };
}
const visible = (page: Page) => page.locator('[data-seat]:visible');
const input = (page: Page) => visible(page).getByRole('textbox', { name: '发送消息' });
const picks = (page: Page) => visible(page).getByLabel('本轮选择');
async function menu(page: Page, name: string) {
  await visible(page).getByRole('button', { name: '添加附件' }).click();
  await visible(page).getByRole('button', { name, exact: true }).click();
}
async function selectSkill(page: Page, name = 'synthesis') {
  await menu(page, '使用 Skill'); await visible(page).getByRole('option', { name: new RegExp(name === 'synthesis' ? '资料综合写作' : '结果检查') }).click();
}
async function selectAgent(page: Page, name = 'analyst') {
  await menu(page, 'Agents'); await visible(page).getByRole('option', { name: new RegExp(name) }).click();
}
async function seat(page: Page, id: string) {
  await visible(page).getByRole('combobox', { name: '测试席位' }).selectOption(id);
  await expect(visible(page)).toHaveAttribute('data-seat', id);
}

test('typed references select using keyboard, preserve prose, show historical Skill and do not call model before send', async ({ page }) => {
  const env = await setup(page);
  try {
    await page.goto('/');
    await input(page).pressSequentially('请处理 @plans/');
    await input(page).press('Enter');
    await expect(visible(page).getByRole('option', { name: /方案.md/ })).toBeVisible();
    await input(page).press('Enter');
    await expect(input(page)).toHaveValue('请处理 ');
    await expect(visible(page).getByLabel('消息附件')).toContainText('方案.md');
    await input(page).pressSequentially('/syn');
    await expect(visible(page).getByRole('option', { name: /资料综合写作/ })).toBeVisible();
    await input(page).press('ArrowDown'); await input(page).press('Enter');
    await expect(picks(page)).toContainText('资料综合写作');
    await expect(input(page)).toHaveValue('请处理 ');
    await input(page).pressSequentially('@analyst');
    await input(page).press('ArrowDown'); await input(page).press('Enter');
    await expect(visible(page).getByRole('option', { name: /analyst/ })).toBeVisible();
    await input(page).press('Enter');
    await expect(picks(page)).toContainText('analyst');
    expect(env.messages).toHaveLength(0); expect(env.calls).toHaveLength(0);
    await page.screenshot({ path: test.info().outputPath('composer-selected-desktop.png') });
    await picks(page).getByTitle('查看 Skill 内容').click();
    await expect(page.getByRole('dialog')).toContainText('区分资料事实');
    await page.getByRole('dialog').getByRole('button', { name: '关闭面板' }).click();
    expect(env.calls).toHaveLength(0);
    await input(page).press('Enter');
    await expect(visible(page).getByLabel('Axon 的回复')).toContainText('本轮处理完成');
    expect(env.messages).toHaveLength(1);
    expect(env.messages[0]).toMatchObject({ text: '请处理', fileRefs: [{ path: 'plans/方案.md' }], skill: { id: 'synthesis' }, agent: { name: 'analyst' } });
    expect(env.messages[0]?.skill).not.toHaveProperty('content');
    await expect(picks(page)).toHaveCount(0);
    await expect(visible(page).getByLabel('本条消息使用的能力')).toContainText('analyst');
    await page.reload();
    await visible(page).getByRole('button', { name: 'Skill · 资料综合写作', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '本次使用的 Skill · 资料综合写作' })).toContainText('区分资料事实');
    expect(env.calls).toHaveLength(1);
  } finally { await env.close(); }
});

test('IME, Escape, outside click and pasted paths remain plain text; menu allows replacement and removal', async ({ page }) => {
  const env = await setup(page);
  try {
    await page.goto('/');
    await input(page).fill('联系 a@example.com /plans/方案.md');
    await expect(visible(page).getByLabel('选择引用')).toHaveCount(0);
    await input(page).fill(''); await input(page).pressSequentially('/');
    await expect(visible(page).getByRole('option', { name: /结果检查/ })).toBeVisible();
    await input(page).dispatchEvent('compositionstart');
    await input(page).dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 });
    expect(env.calls).toHaveLength(0); await expect(picks(page)).toHaveCount(0);
    await input(page).dispatchEvent('compositionend'); await input(page).press('Escape');
    await expect(input(page)).toHaveValue('/');
    await input(page).fill(''); await input(page).pressSequentially('@');
    await expect(visible(page).getByLabel('选择引用')).toBeVisible();
    await visible(page).getByRole('heading', { name: '今天，我们一起处理什么？' }).click();
    await expect(input(page)).toHaveValue('@'); await expect(visible(page).getByLabel('选择引用')).toHaveCount(0);
    await input(page).fill(''); await selectSkill(page); await selectSkill(page, 'review');
    await expect(picks(page)).toContainText('结果检查'); await expect(picks(page)).not.toContainText('资料综合写作');
    await selectAgent(page); await selectAgent(page, 'reviewer');
    await expect(picks(page)).toContainText('reviewer'); await expect(picks(page)).not.toContainText('analyst');
    await expect(visible(page).getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
    await picks(page).getByRole('button', { name: '移除 Skill' }).click(); await picks(page).getByRole('button', { name: '移除 Agents' }).click();
    await expect(picks(page)).toHaveCount(0); expect(env.calls).toHaveLength(0);
  } finally { await env.close(); }
});

test('file picker browses directories and pagination, shares upload count and deduplicates the same ordinary path', async ({ page }) => {
  const env = await setup(page, 2);
  try {
    await page.goto('/'); await menu(page, '引用文件');
    await expect(visible(page).getByRole('button', { name: '下一页', exact: true })).toBeEnabled();
    await visible(page).getByRole('button', { name: '下一页', exact: true }).click();
    await expect(visible(page).getByRole('option', { name: /资料21.txt/ })).toBeVisible();
    await visible(page).getByRole('button', { name: '上一页', exact: true }).click();
    await visible(page).getByRole('option', { name: /^plans / }).click();
    await expect(visible(page).getByRole('option', { name: /方案.md/ })).toBeVisible();
    await visible(page).getByRole('button', { name: '上一级' }).click();
    await visible(page).getByRole('textbox', { name: '筛选引用' }).fill('任务书');
    await visible(page).getByRole('option', { name: /任务书.md/ }).click();
    await menu(page, '引用文件'); await visible(page).getByRole('textbox', { name: '筛选引用' }).fill('任务书'); await visible(page).getByRole('option', { name: /任务书.md/ }).click();
    await expect(visible(page).getByLabel('消息附件').locator('li')).toHaveCount(1);
    await visible(page).getByLabel('选择附件').setInputFiles({ name: '上传.md', mimeType: 'text/markdown', buffer: Buffer.from('# 上传文件') });
    await expect(visible(page).getByLabel('消息附件')).toContainText('上传.md');
    await expect(visible(page).getByText('上传中', { exact: false })).toHaveCount(0);
    await menu(page, '引用文件'); await visible(page).getByRole('textbox', { name: '筛选引用' }).fill('上传'); await visible(page).getByRole('option', { name: /上传.md/ }).click();
    await expect(visible(page).getByLabel('消息附件').locator('li')).toHaveCount(2);
    await menu(page, '引用文件'); await visible(page).getByRole('textbox', { name: '筛选引用' }).fill('资料00'); await visible(page).getByRole('option', { name: /资料00.txt/ }).click();
    await expect(visible(page).getByText('每条消息最多关联 2 个文件。')).toBeVisible();
    await expect(visible(page).getByLabel('消息附件').locator('li')).toHaveCount(2);
    expect(env.calls).toHaveLength(0);
  } finally { await env.close(); }
});

test('seat-scoped drafts survive refresh, delayed directories cannot leak, and first creation migrates selections once', async ({ page }) => {
  const env = await setup(page);
  try {
    await page.goto('/'); await selectSkill(page); await input(page).fill('A 的任务');
    env.controls.delayAgents = 500;
    await menu(page, 'Agents');
    await seat(page, 'seat-b');
    await expect(picks(page)).toHaveCount(0); await expect(input(page)).toHaveValue('');
    await page.waitForTimeout(650);
    await expect(visible(page).getByLabel('选择引用')).toHaveCount(0);
    await selectAgent(page, 'reviewer'); await input(page).fill('B 的草稿');
    await page.reload(); await expect(input(page)).toHaveValue('B 的草稿'); await expect(picks(page)).toContainText('reviewer');
    await seat(page, 'test-seat'); await expect(input(page)).toHaveValue('A 的任务'); await expect(picks(page)).toContainText('资料综合写作');
    await expect(visible(page).getByLabel('选择引用')).toHaveCount(0);
    env.controls.delayAgents = 0; env.controls.delayCreate = 1000;
    await visible(page).getByRole('button', { name: '发送消息', exact: true }).click();
    await selectAgent(page);
    await input(page).fill('下一轮草稿');
    await expect(visible(page).getByLabel('Axon 的回复')).toContainText('本轮处理完成');
    await expect(input(page)).toHaveValue('下一轮草稿');
    await expect(picks(page)).toContainText('analyst'); await expect(picks(page)).not.toContainText('资料综合写作');
    expect(env.messages[0]).toHaveProperty('skill'); expect(env.messages[0]).not.toHaveProperty('agent');
    await page.reload(); await expect(picks(page)).toContainText('analyst'); await expect(input(page)).toHaveValue('下一轮草稿');
    await visible(page).getByRole('button', { name: '在项目 默认工作区 中新建对话' }).click();
    await expect(picks(page)).toHaveCount(0); await expect(input(page)).toHaveValue('');
    expect(env.paths.filter(path => path.includes('/agents')).every(path => path.startsWith('/api/test-seats/'))).toBe(true);
  } finally { await env.close(); }
});

test('375px picker and Skill dialog remain contained with keyboard focus', async ({ page }) => {
  const env = await setup(page);
  try {
    await page.setViewportSize({ width: 375, height: 812 }); await page.goto('/');
    await menu(page, '使用 Skill');
    await visible(page).getByRole('textbox', { name: '筛选引用' }).fill('review');
    await expect(visible(page).getByRole('option', { name: /结果检查/ })).toBeVisible();
    await visible(page).getByRole('textbox', { name: '筛选引用' }).press('Enter');
    await expect(input(page)).toBeFocused();
    await picks(page).getByTitle('查看 Skill 内容').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(picks(page).getByTitle('查看 Skill 内容')).toBeFocused();
    await input(page).pressSequentially('@');
    await expect(visible(page).getByRole('listbox', { name: '可选引用' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('references-mobile.png') });
    expect(env.calls).toHaveLength(0);
  } finally { await env.close(); }
});


test('changed selection fails before model work and preserves all inputs until explicit correction', async ({ page }) => {
  const env = await setup(page);
  try {
    await page.goto('/'); await selectSkill(page); await selectAgent(page);
    await input(page).pressSequentially('检查资料 @plans/');
    await visible(page).getByRole('option', { name: /^项目文件或文件夹/ }).click();
    await expect(visible(page).getByRole('option', { name: /方案.md/ })).toBeVisible(); await input(page).press('Enter');
    await appendFile(join(env.roles, 'analyst.md'), '\n增加一条分析约定。\n');
    await visible(page).getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(visible(page).getByRole('alert')).toContainText('重新选择');
    await expect(input(page)).toHaveValue('检查资料');
    await expect(picks(page)).toContainText('资料综合写作'); await expect(picks(page)).toContainText('analyst');
    await expect(visible(page).getByLabel('消息附件')).toContainText('方案.md');
    expect(env.calls).toHaveLength(0); expect(env.messages).toHaveLength(1);
    await selectAgent(page);
    expect(env.calls).toHaveLength(0);
    await visible(page).getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(visible(page).getByLabel('Axon 的回复')).toContainText('本轮处理完成');
    expect(env.calls).toHaveLength(1); expect(env.messages).toHaveLength(2);
    expect(env.messages[0]?.agent).not.toEqual(env.messages[1]?.agent);
  } finally { await env.close(); }
});


test('workspace navigation preserves separate drafts and dismisses stale pickers without selecting late results', async ({ page }) => {
  const env = await setup(page);
  try {
    await page.goto('/'); await selectSkill(page); await input(page).fill('原项目草稿');
    await visible(page).getByRole('button', { name: '新建项目', exact: true }).click();
    await page.getByRole('dialog').getByLabel('项目名称').fill('另一个项目');
    await page.getByRole('dialog').getByRole('button', { name: '创建项目' }).click();
    await expect(input(page)).toHaveValue(''); await expect(picks(page)).toHaveCount(0);
    await selectAgent(page); await input(page).fill('另一个项目草稿');
    env.controls.delayAgents = 400;
    await menu(page, 'Agents');
    await visible(page).getByRole('button', { name: '进入项目：默认工作区' }).click();
    await expect(input(page)).toHaveValue('原项目草稿'); await expect(picks(page)).toContainText('资料综合写作');
    await expect(visible(page).getByLabel('选择引用')).toHaveCount(0);
    await page.waitForTimeout(500);
    await visible(page).getByRole('button', { name: '进入项目：另一个项目' }).click();
    await expect(input(page)).toHaveValue('另一个项目草稿'); await expect(picks(page)).toContainText('analyst');
    await expect(visible(page).getByLabel('选择引用')).toHaveCount(0);
    expect(env.calls).toHaveLength(0);
    await menu(page, 'Agents');
    await expect(visible(page).getByRole('option', { name: /analyst/ })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('references-desktop.png') });
  } finally { await env.close(); }
});


test('Chinese composition filters the browsed directory and caret movement abandons the trigger safely', async ({ page }) => {
  const env = await setup(page);
  try {
    await page.goto('/'); await input(page).pressSequentially('请查看 @pla');
    await visible(page).getByRole('option', { name: /^项目文件或文件夹/ }).click();
    await visible(page).getByRole('option', { name: /^plans / }).click();
    await expect(visible(page).getByRole('option', { name: /方案.md/ })).toBeVisible();
    await expect(input(page)).toHaveValue('请查看 @plans/');
    await input(page).dispatchEvent('compositionstart');
    await input(page).fill('请查看 @plans/方');
    await input(page).fill('请查看 @plans/方案');
    await input(page).dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 });
    await expect(visible(page).getByLabel('消息附件').locator('li')).toHaveCount(0); expect(env.calls).toHaveLength(0);
    await input(page).dispatchEvent('compositionend');
    await expect(visible(page).getByRole('option', { name: /方案.md/ })).toBeVisible();
    await expect(visible(page).getByRole('listbox')).toContainText('plans/方案.md');
    await input(page).press('Enter');
    await expect(input(page)).toHaveValue('请查看 '); await expect(visible(page).getByLabel('消息附件')).toContainText('方案.md');
    await input(page).pressSequentially('@plans/');
    await visible(page).getByRole('option', { name: /^项目文件或文件夹/ }).click();
    await expect(visible(page).getByRole('option', { name: /方案.md/ })).toBeVisible();
    await visible(page).getByRole('button', { name: '上一级' }).click();
    await expect(input(page)).toHaveValue('请查看 @');
    await visible(page).getByRole('button', { name: '返回类别' }).click();
    await visible(page).getByRole('option', { name: /^Agents/ }).click();
    await input(page).pressSequentially('analyst');
    await expect(visible(page).getByRole('option', { name: /analyst/ })).toBeVisible();
    await input(page).press('Home');
    await expect(visible(page).getByLabel('选择引用')).toHaveCount(0);
    await expect(input(page)).toHaveValue('请查看 @analyst'); await expect(picks(page)).toHaveCount(0);
    expect(env.calls).toHaveLength(0);
  } finally { await env.close(); }
});

for (const newerText of ['新的目标', '原始目标']) test(`late preparation failure preserves choices and explicit recovery restores text with Skill (${newerText})`, async ({ page }) => {
  const env = await setup(page);
  try {
    await page.goto('/'); await selectSkill(page, 'review'); await selectAgent(page); await input(page).fill('原始目标');
    await appendFile(join(env.roles, 'analyst.md'), '\n角色已变更。\n');
    env.controls.delayReply = 1200;
    await visible(page).getByRole('button', { name: '发送消息', exact: true }).click();
    await expect.poll(() => env.messages.length).toBe(1);
    await selectSkill(page); await input(page).fill(newerText);
    await expect(visible(page).getByRole('alert')).toContainText('重新选择');
    await expect(input(page)).toHaveValue(newerText); await expect(picks(page)).toContainText('资料综合写作'); await expect(picks(page)).not.toContainText('analyst');
    await page.reload();
    await expect(input(page)).toHaveValue(newerText); await expect(picks(page)).toContainText('资料综合写作');
    await visible(page).getByRole('button', { name: '恢复刚才发送的内容' }).click();
    await expect(input(page)).toHaveValue('原始目标'); await expect(picks(page)).toContainText('结果检查'); await expect(picks(page)).toContainText('analyst'); await expect(picks(page)).not.toContainText('资料综合写作');
    expect(env.calls).toHaveLength(0); expect(env.messages).toHaveLength(1);
  } finally { await env.close(); }
});


test('@ opens categories without loading file or agent lists and supports returning between categories', async ({ page }) => {
  const env = await setup(page);
  try {
    await page.goto('/'); await expect(input(page)).toBeEditable();
    const listings = () => env.paths.filter(path => /\/(files(?:\?|$)|agents$)/.test(path));
    const before = listings().length;
    await input(page).pressSequentially('请查看 @plans/');
    await expect(visible(page).getByRole('option', { name: /^项目文件或文件夹/ })).toBeVisible();
    await expect(visible(page).getByRole('option', { name: /^Agents/ })).toBeVisible();
    await expect(visible(page).getByRole('listbox', { name: '可选引用' }).getByRole('option')).toHaveCount(2);
    expect(listings()).toHaveLength(before);
    await page.screenshot({ path: test.info().outputPath('composer-categories-desktop.png') });
    await input(page).press('Enter');
    await expect(visible(page).getByRole('option', { name: /方案.md/ })).toBeVisible();
    expect(listings().some(path => path.endsWith('/agents'))).toBe(false);
    await page.screenshot({ path: test.info().outputPath('composer-files-desktop.png') });
    await visible(page).getByRole('button', { name: '返回类别' }).click();
    await expect(input(page)).toHaveValue('请查看 @');
    const afterFiles = listings().length;
    await expect(visible(page).getByRole('listbox', { name: '可选引用' }).getByRole('option')).toHaveCount(2);
    await input(page).press('ArrowDown'); await input(page).press('Enter');
    await expect(visible(page).getByRole('option', { name: /analyst/ })).toBeVisible();
    await input(page).pressSequentially('review');
    await expect(visible(page).getByRole('option', { name: /reviewer/ })).toBeVisible();
    await visible(page).getByRole('button', { name: '返回类别' }).click();
    await expect(input(page)).toHaveValue('请查看 @');
    expect(listings().length).toBeGreaterThan(afterFiles);
    const afterAgents = listings().length;
    await input(page).dispatchEvent('compositionstart');
    await input(page).dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 });
    await input(page).dispatchEvent('compositionend');
    await expect(visible(page).getByRole('listbox', { name: '可选引用' }).getByRole('option')).toHaveCount(2);
    expect(listings()).toHaveLength(afterAgents);
    await visible(page).getByRole('option', { name: /^项目文件或文件夹/ }).click();
    await expect(visible(page).getByRole('option', { name: /^plans / })).toBeVisible();
    await visible(page).getByRole('option', { name: /^plans / }).click();
    await expect(input(page)).toHaveValue('请查看 @plans/');
    await expect(visible(page).getByLabel('消息附件').locator('li')).toHaveCount(0);
    await input(page).press('Escape');
    await expect(input(page)).toHaveValue('请查看 @plans/');
    expect(env.messages).toHaveLength(0); expect(env.calls).toHaveLength(0);
  } finally { await env.close(); }
});
