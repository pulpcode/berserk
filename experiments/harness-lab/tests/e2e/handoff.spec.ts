import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createApp } from '../../src/server/app.js';
import { PiLab } from '../../src/pi/lab.js';
import { fakeRuntime, testConfig } from '../pi/fake-runtime.js';

// Actual local API, Pi sessions, safe file copying and SQLite. Only the model provider is fake.
// This does not constitute live provider / Docker acceptance.
async function setup(page: Page, delayMs = 0) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-web-handoff-'));
  const config = testConfig(dir, { seatId: 'test-seat', testSeats: [{ id: 'test-seat', name: '席位 A' }, { id: 'seat-b', name: '席位 B' }] });
  const fake = await fakeRuntime(config, () => ({ text: '当前席位处理完毕', delayMs }));
  const lab = await PiLab.create(config, fake.runtime);
  const app = await createApp(lab);
  const pages: Page[] = [];
  const paths: string[] = [];
  const controls = { losePrepare: false, loseCommit: false, commits: 0, prepares: 0 };
  const connect = async (target: Page) => {
    pages.push(target);
    await target.route('**/api/**', async route => {
      const request = route.request(); const url = new URL(request.url()); const path = url.pathname + url.search; paths.push(path);
      if (url.pathname.endsWith('/commit')) controls.commits++;
      if (url.pathname.endsWith('/prepare')) controls.prepares++;
      const result = await app.inject({ method: request.method() as 'GET' | 'POST' | 'PUT' | 'DELETE', url: path, headers: { host: '127.0.0.1', ...(request.headers()['content-type'] ? { 'content-type': request.headers()['content-type'] } : {}) }, ...(request.postDataBuffer() ? { payload: request.postDataBuffer()! } : {}) });
      if (controls.losePrepare && url.pathname.endsWith('/prepare')) { controls.losePrepare = false; await route.abort('failed'); return; }
      if (controls.loseCommit && url.pathname.endsWith('/commit')) { controls.loseCommit = false; await route.abort('failed'); return; }
      await route.fulfill({ status: result.statusCode, headers: Object.fromEntries(Object.entries(result.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])), body: result.rawPayload });
    });
  };
  await connect(page);
  const workspace = lab.workspaces.get();
  await writeFile(join(lab.files.filesDirectory(workspace.id), '任务书.md'), '# 输入资料\n依据这份任务书处理。');
  await writeFile(join(lab.files.filesDirectory(workspace.id), '数据.csv'), 'name,count\n车辆,3');
  return { lab, workspace, dir, paths, controls, connect, close: async () => { for (const target of pages) if (!target.isClosed()) { await target.goto('about:blank'); await target.unrouteAll({ behavior: 'wait' }); } await app.close(); await rm(dir, { recursive: true, force: true }); } };
}
const visible = (page: Page) => page.locator('[data-seat]:visible');
async function switchSeat(page: Page, id: string) {
  const menu = page.getByRole('button', { name: '打开会话列表' });
  if (await menu.isVisible() && !await page.getByRole('combobox', { name: '测试席位' }).isVisible()) await menu.click();
  await visible(page).getByRole('combobox', { name: '测试席位' }).selectOption(id);
  await expect(visible(page)).toHaveAttribute('data-seat', id);
}
async function inbox(page: Page) {
  const menu = page.getByRole('button', { name: '打开会话列表' });
  if (await menu.isVisible() && !await page.getByRole('button', { name: '工作待办', exact: true }).isVisible()) await menu.click();
  await visible(page).getByRole('button', { name: '工作待办', exact: true }).click();
}
async function assign(page: Page, title = '编制处置方案') {
  await visible(page).getByRole('button', { name: '分派工作', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('工作标题').fill(title);
  await dialog.getByLabel('工作目标').fill('依据任务书和数据，形成方案。');
  await dialog.getByRole('checkbox', { name: /任务书.md/ }).check();
  await dialog.getByRole('checkbox', { name: /数据.csv/ }).check();
  await dialog.getByRole('button', { name: '核对分派内容' }).click();
  await expect(page.getByRole('dialog', { name: '确认交接内容' })).toBeVisible();
}
async function confirm(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: '确认执行交接' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: '查看工作' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '查看工作' }).click();
}

test('two seats assign fixed inputs, bind a conversation, submit, return and accept another version', async ({ page }) => {
  test.setTimeout(90000);
  const env = await setup(page);
  try {
    await page.goto('/'); await assign(page);
    await page.getByRole('dialog').getByRole('button', { name: '查看', exact: true }).first().click();
    await expect(page.getByRole('region', { name: '任务书.md 固定副本预览' })).toContainText('依据这份任务书处理');
    await writeFile(join(env.lab.files.filesDirectory(env.workspace.id), '任务书.md'), '源文件后来修改');
    await confirm(page);
    const work = env.lab.collaboration!.list({ seatId: 'test-seat' })[0]!;
    await switchSeat(page, 'seat-b'); await inbox(page);
    await visible(page).getByRole('button', { name: /编制处置方案.*待签收/ }).click();
    await visible(page).getByRole('button', { name: '开始办理', exact: true }).click(); await confirm(page);
    await visible(page).getByRole('button', { name: '新建对话办理' }).click();
    await expect(visible(page).getByRole('button', { name: '查看关联工作' })).toBeVisible();
    const detail = env.lab.collaboration!.read({ seatId: 'seat-b' }, work.id);
    expect(detail.sessionIds).toHaveLength(1);
    expect(env.lab.collaboration!.read({ seatId: 'test-seat' }, work.id).sessionIds).toHaveLength(0);
    await visible(page).getByRole('button', { name: '查看关联工作' }).click();
    await visible(page).getByText('复制到我的项目文件', { exact: true }).first().click();
    await visible(page).getByRole('button', { name: '确认复制' }).first().click();
    await expect(visible(page).getByRole('status').filter({ hasText: '已复制到项目文件' })).toBeVisible();
    const receiver = env.lab.workspaces.list('seat-b').workspaces.find(item => item.taskSpaceId === env.workspace.taskSpaceId)!;
    const destination = env.lab.files.filesDirectory(receiver.id, 'seat-b');
    const resultPath = join(destination, '方案.md'); await writeFile(resultPath, '# 第一版方案');
    await visible(page).getByRole('button', { name: '提交文件', exact: true }).click();
    await visible(page).getByRole('radio', { name: /方案.md/ }).check();
    await visible(page).getByRole('button', { name: '预览提交内容' }).click();
    await expect(page.getByRole('dialog', { name: '确认交接内容' })).toBeVisible();
    await writeFile(resultPath, '# 第二版方案'); await confirm(page);
    await switchSeat(page, 'test-seat'); await inbox(page);
    await visible(page).getByRole('button', { name: /待我验收/ }).click();
    await visible(page).getByRole('button', { name: /编制处置方案.*待验收/ }).click();
    await visible(page).getByRole('button', { name: '退回修改' }).click();
    await visible(page).getByLabel('退回意见').fill('补充交通安排');
    await visible(page).getByRole('button', { name: '核对退回意见' }).click(); await confirm(page);
    await switchSeat(page, 'seat-b'); await inbox(page);
    await visible(page).getByRole('button', { name: /编制处置方案.*已退回/ }).click();
    await expect(visible(page).getByText('补充交通安排', { exact: true })).toBeVisible();
    await visible(page).getByRole('button', { name: '提交文件', exact: true }).click();
    await visible(page).getByRole('radio', { name: /方案.md/ }).check();
    await visible(page).getByRole('button', { name: '预览提交内容' }).click(); await confirm(page);
    await switchSeat(page, 'test-seat'); await inbox(page);
    await visible(page).getByRole('button', { name: /待我验收/ }).click();
    await visible(page).getByRole('button', { name: /编制处置方案.*待验收/ }).click();
    await visible(page).getByRole('button', { name: '验收通过', exact: true }).click(); await confirm(page);
    const completed = env.lab.collaboration!.read({ seatId: 'test-seat' }, work.id);
    expect(completed.state).toBe('completed'); expect(completed.submissions).toHaveLength(2);
    await switchSeat(page, 'seat-b'); await inbox(page);
    await visible(page).getByRole('button', { name: /^全部 \d/ }).click();
    await visible(page).getByRole('button', { name: /编制处置方案.*已完成/ }).click();
    await expect(visible(page).getByRole('heading', { name: /第 1 次提交/ })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('handoff-desktop.png') });
    for (const submission of completed.submissions) {
      const file = await env.lab.collaboration!.openFile({ seatId: 'test-seat' }, submission.file.fileId);
      let text = ''; for await (const part of file.stream) text += part;
      expect(text).toBe(submission.attempt === 1 ? '# 第一版方案' : '# 第二版方案');
    }
    expect(env.paths.filter(path => path !== '/api/info').every(path => path.startsWith('/api/test-seats/'))).toBe(true);
  } finally { await env.close(); }
});

test('lost commit response is queried after reload without another commit or duplicate work', async ({ page }) => {
  const env = await setup(page);
  try {
    await page.goto('/'); await assign(page, '响应丢失验证');
    env.controls.loseCommit = true;
    await page.getByRole('dialog').getByRole('button', { name: '确认执行交接' }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: '查询结果' })).toBeVisible();
    await page.reload(); await inbox(page);
    await visible(page).getByRole('button', { name: '查询结果', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('已完成：待签收', { exact: true })).toBeVisible();
    expect(env.controls.commits).toBe(1); expect(env.controls.prepares).toBe(1);
    expect(env.lab.collaboration!.list({ seatId: 'test-seat' })).toHaveLength(1);
  } finally { await env.close(); }
});

test('seat switches preserve separate drafts, late Pi replies and scoped XHR uploads across tabs', async ({ page, context }) => {
  const env = await setup(page, 1800);
  try {
    await page.goto('/');
    const inputA = visible(page).getByRole('textbox', { name: '发送消息' });
    await inputA.fill('席位A开始处理'); await inputA.press('Enter');
    await expect(visible(page).getByRole('button', { name: '停止回复' })).toBeVisible();
    await inputA.fill('A下一条草稿');
    await expect(inputA).toHaveValue('A下一条草稿');
    await switchSeat(page, 'seat-b');
    await expect(visible(page).getByRole('textbox', { name: '发送消息' })).toHaveValue('');
    await visible(page).getByRole('textbox', { name: '发送消息' }).fill('B自己的草稿');
    await visible(page).getByLabel('选择附件', { exact: true }).setInputFiles({ name: 'B上传.txt', mimeType: 'text/plain', buffer: Buffer.from('B ONLY') });
    await expect(visible(page).getByText('B上传.txt', { exact: true })).toBeVisible();
    await expect(visible(page).getByRole('listitem', { name: /已保存到工作区/ })).toBeVisible();
    await expect(visible(page).getByText('当前席位处理完毕', { exact: true })).toHaveCount(0);
    await expect.poll(() => env.lab.activity('test-seat').sessions[0]?.lastResult?.status).toBe('succeeded');
    await switchSeat(page, 'test-seat');
    await expect(visible(page).getByRole('textbox', { name: '发送消息' })).toHaveValue('A下一条草稿');
    await expect(visible(page).getByText('当前席位处理完毕', { exact: true })).toBeVisible();
    await expect(visible(page).getByText('B上传.txt', { exact: true })).toHaveCount(0);
    const second = await context.newPage(); await env.connect(second); await second.goto('/'); await switchSeat(second, 'seat-b');
    expect(await visible(page).getByRole('combobox', { name: '测试席位' }).inputValue()).toBe('test-seat');
    const wb = env.lab.workspaces.list('seat-b').workspaces[0]!;
    expect(await readFile(join(env.lab.files.filesDirectory(wb.id, 'seat-b'), 'B上传.txt'), 'utf8')).toBe('B ONLY');
    await second.close();
    expect(env.paths.some(path => /test-seats\/seat-b\/workspaces\/.*\/uploads\/.*\/content$/.test(path))).toBe(true);
  } finally { await env.close(); }
});

test('375px forms preserve per-seat drafts, Escape restores focus and fixed previews stay contained', async ({ page }) => {
  const env = await setup(page);
  try {
    await page.setViewportSize({ width: 375, height: 812 }); await page.goto('/');
    await visible(page).getByRole('button', { name: '分派工作', exact: true }).click();
    await page.getByRole('dialog').getByLabel('工作标题').fill('小屏幕待提交的草稿');
    await page.keyboard.press('Escape');
    await expect(visible(page).getByRole('button', { name: '分派工作', exact: true })).toBeFocused();
    await switchSeat(page, 'seat-b'); await switchSeat(page, 'test-seat');
    await visible(page).getByRole('complementary').getByRole('button', { name: '关闭会话列表', exact: true }).click();
    await visible(page).getByRole('button', { name: '分派工作', exact: true }).click();
    await expect(page.getByRole('dialog').getByLabel('工作标题')).toHaveValue('小屏幕待提交的草稿');
    await expect(page.getByRole('dialog').getByRole('checkbox', { name: /任务书.md/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('handoff-mobile.png') });
  } finally { await env.close(); }
});


test('lost preparation response resolves by client action ID without another prepare', async ({ page }) => {
  const env = await setup(page);
  try {
    await page.goto('/');
    await visible(page).getByRole('button', { name: '分派工作', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('工作标题').fill('核对准备结果');
    await dialog.getByLabel('工作目标').fill('先查询，不重做。');
    env.controls.losePrepare = true;
    await dialog.getByRole('button', { name: '核对分派内容' }).click();
    await expect(dialog.getByRole('button', { name: '查询结果' })).toBeVisible();
    await dialog.getByRole('button', { name: '查询结果' }).click();
    await expect(page.getByRole('dialog', { name: '确认交接内容' })).toBeVisible();
    expect(env.controls.prepares).toBe(1);
    expect(env.paths.some(path => path.includes('/work-actions?clientActionId='))).toBe(true);
    await confirm(page);
    expect(env.controls.commits).toBe(1);
    expect(env.lab.collaboration!.list({ seatId: 'test-seat' })).toHaveLength(1);
  } finally { await env.close(); }
});
