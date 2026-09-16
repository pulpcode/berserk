import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { test, expect, type Page } from '@playwright/test';
import type { SessionSnapshot, StreamEvent } from '../../src/contracts/index';

const tableReply = `| 工作项 | 负责角色 | 交付内容 | 验收条件 |
| --- | --- | --- | --- |
| 信息梳理 | 信息席 | 汇总资料与来源 | 依据可回查 |
| 方案修订 | 分析席 | 按补充条件修订 | 保留最新约束 |`;

// This is an intentionally deterministic HTTP test double. It never calls an LLM
// and does not constitute the real Pi / provider evidence required by C01–C05.
async function mockApi(page: Page) {
  const sessions = new Map<string, SessionSnapshot>(['A', 'B'].map(id => [id, {
    id, title: `会话 ${id}`, updatedAt: '2026-09-16T08:00:00Z', messages: [], active: null, lastResult: null,
  }]));
  const responses = new Map<string, ServerResponse>();
  const counts = { sends: 0, creates: 0, cancels: [] as string[] };
  const event = (id: string, data: StreamEvent) => responses.get(id)?.write(`data: ${JSON.stringify(data)}\n\n`);
  const finish = (id: string, status: 'succeeded' | 'cancelled' = 'succeeded') => {
    const session = sessions.get(id)!;
    const requestId = session.active!.requestId;
    session.active = null;
    session.lastResult = { requestId, status };
    event(id, { type: status === 'succeeded' ? 'response.completed' : 'response.cancelled', sessionId: id, requestId, snapshot: session });
    event(id, { type: 'text.delta', sessionId: id, requestId, delta: '终态之后的迟到内容不得展示' });
    responses.get(id)?.end();
    responses.delete(id);
  };
  const server = createServer(async (request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname;
    const json = (value: unknown, status = 200) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      response.end(JSON.stringify(value));
    };
    if (path === '/api/info') return json({ model: 'deepseek-flash', configured: true, sources: [
      { id: 'brief', title: '项目讨论纪要', description: '目标、约束与待明确事项' },
      { id: 'plan', title: '协作方案参考', description: '方案结构与编制要点' },
    ], limits: { timeoutMs: 60000, maxToolCalls: 4, maxOutputTokens: 4096 } });
    if (path === '/api/sessions' && request.method === 'GET') return json([...sessions.values()]);
    if (path === '/api/sessions' && request.method === 'POST') {
      const id = `new-${++counts.creates}`;
      const session: SessionSnapshot = { id, title: '新对话', updatedAt: new Date().toISOString(), messages: [], active: null, lastResult: null };
      sessions.set(id, session); return json(session);
    }
    const id = path.split('/')[3];
    const session = sessions.get(id)!;
    if (request.method === 'GET') return json(session);
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body) as { text?: string; requestId?: string };
    if (path.endsWith('/cancel')) {
      counts.cancels.push(input.requestId!);
      session.active!.status = 'stopping';
      return json(session);
    }
    const requestId = `request-${++counts.sends}`;
    if (input.text === '模拟错误') return json({ error: { code: 'PROVIDER_ERROR', message: '模型服务暂时不可用' } }, 503);
    const reply = input.text === '生成表格' ? tableReply : `${id} 的回复`;
    session.messages.push({ id: `user-${requestId}`, role: 'user', text: input.text! });
    session.messages.push({ id: `assistant-${requestId}`, role: 'assistant', text: reply });
    session.active = { requestId, status: 'responding' };
    session.lastResult = null;
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    responses.set(id, response);
    event(id, { type: 'response.started', sessionId: id, requestId });
    event(id, { type: 'text.delta', sessionId: id, requestId, delta: reply });
    if (input.text === '读取资料') {
      event(id, { type: 'tool.started', sessionId: id, requestId, toolCallId: 'tool-1', toolName: 'source.read' });
      event(id, { type: 'tool.completed', sessionId: id, requestId, toolCallId: 'tool-1', toolName: 'source.read', text: '来源：项目讨论纪要\n固定资料正文。', isError: false });
      session.messages.push({ id: 'tool-1', role: 'tool', toolName: 'source.read', text: '来源：项目讨论纪要\n固定资料正文。' });
    }
    if (input.text !== '慢速回复') finish(id);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  await page.route('**/api/**', route => route.continue({ url: `http://127.0.0.1:${address.port}${new URL(route.request().url()).pathname}` }));
  return { sessions, counts, finish, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

test('中文输入、独立草稿、多轮消息与刷新不重发', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.goto('/');
    const input = page.getByRole('textbox', { name: '发送消息' });
    await expect(page.getByRole('heading', { name: '今天，我们一起处理什么？' })).toBeVisible();
    await input.fill('输入法组合中');
    await input.dispatchEvent('compositionstart');
    await input.press('Enter');
    expect(mock.counts.sends).toBe(0);
    await input.dispatchEvent('compositionend');
    await input.fill('第一轮');
    await input.press('Shift+Enter');
    expect(mock.counts.sends).toBe(0);
    await input.fill('第一轮'); await input.press('Enter');
    await expect(page.getByText('A 的回复', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '停止回复' })).toHaveCount(0);
    await input.fill('A 草稿');
    await page.getByRole('button', { name: '会话 B', exact: true }).click();
    await expect(input).toHaveValue('');
    await input.fill('B 草稿');
    await page.getByRole('button', { name: /^会话 A/ }).click();
    await expect(input).toHaveValue('A 草稿');
    await page.reload();
    await expect(input).toHaveValue('A 草稿');
    await expect(page.getByText('A 的回复', { exact: true })).toBeVisible();
    expect(mock.counts.sends).toBe(1);
    expect(mock.counts.creates).toBe(0);
    await input.fill('第二轮'); await input.press('Enter');
    await expect(page.getByText('A 的回复', { exact: true })).toHaveCount(2);
    await expect(page.getByText('终态之后的迟到内容不得展示')).toHaveCount(0);
    await page.getByRole('button', { name: '新建对话' }).click();
    await expect(page.locator('.header-title')).toHaveText('新对话');
    expect(mock.counts.creates).toBe(1);
  } finally { await mock.close(); }
});

test('切换会话时流式回复仍归原会话，取消等待收敛', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.goto('/');
    const input = page.getByRole('textbox', { name: '发送消息' });
    await input.fill('慢速回复'); await input.press('Enter');
    await expect(page.getByText('A 的回复', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '会话 B', exact: true }).click();
    await expect(page.getByText('A 的回复', { exact: true })).toHaveCount(0);
    await input.fill('B 的问题'); await input.press('Enter');
    await expect(page.getByText('B 的回复', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^会话 A/ }).click();
    await page.getByRole('button', { name: '停止回复' }).click();
    await expect(page.getByRole('button', { name: '正在停止', exact: true })).toBeDisabled();
    await input.fill('停止时的新草稿'); await input.press('Enter');
    expect(mock.counts.sends).toBe(2);
    expect(mock.counts.cancels).toEqual(['request-1']);
    mock.finish('A', 'cancelled');
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
    await expect(input).toHaveValue('停止时的新草稿');
    await input.press('Enter');
    await expect(page.getByText('A 的回复', { exact: true })).toHaveCount(2);
    await expect(page.getByText('终态之后的迟到内容不得展示')).toHaveCount(0);
  } finally { await mock.close(); }
});

test('活动请求刷新后查询直到结束，失败保留输入', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.goto('/');
    const input = page.getByRole('textbox', { name: '发送消息' });
    await input.fill('慢速回复'); await input.press('Enter');
    await expect(page.getByText('A 的回复', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: '停止回复' })).toBeEnabled();
    expect(mock.counts.sends).toBe(1);
    mock.finish('A');
    await expect(page.getByRole('button', { name: '停止回复' })).toHaveCount(0);
    await input.fill('模拟错误'); await input.press('Enter');
    await expect(page.getByText('模型服务暂时不可用')).toBeVisible();
    await expect(input).toHaveValue('模拟错误');
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
  } finally { await mock.close(); }
});

test('实际工具结果可查看，窄屏与抽屉键盘可用', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.goto('/');
    await page.getByRole('textbox', { name: '发送消息' }).fill('读取资料');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.getByText('已读取资料', { exact: true }).click();
    await expect(page.getByText('来源：项目讨论纪要\n固定资料正文。', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    const menu = page.getByRole('button', { name: '打开会话列表' });
    await menu.click();
    await expect(page.getByRole('button', { name: '会话 B', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await page.setViewportSize({ width: 812, height: 375 });
    await expect(page.locator('main')).not.toHaveAttribute('inert');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.getByRole('textbox', { name: '发送消息' })).toBeVisible();
  } finally { await mock.close(); }
});

test('GFM 回复渲染语义表格，窄屏可滚动且刷新保留', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.goto('/');
    await page.getByRole('textbox', { name: '发送消息' }).fill('生成表格');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader')).toHaveText(['工作项', '负责角色', '交付内容', '验收条件']);
    await expect(table.getByRole('row')).toHaveCount(3);
    await expect(table.getByRole('cell', { name: '保留最新约束', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    const region = page.getByRole('region', { name: '回复表格，可横向滚动' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(await region.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    await region.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    await page.reload();
    await expect(table.getByRole('columnheader')).toHaveText(['工作项', '负责角色', '交付内容', '验收条件']);
    expect(mock.counts.sends).toBe(1);
  } finally { await mock.close(); }
});
