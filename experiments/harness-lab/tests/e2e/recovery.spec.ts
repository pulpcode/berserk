import { test, expect, type Page } from '@playwright/test';
import type { SessionSnapshot, StreamEvent } from '../../src/contracts/index';

const date = '2026-09-19T00:00:00Z';
const notice = '上次处理已中断，已保存内容保留，可继续发送消息。';

async function fixture(page: Page, { saved = true, draft = '', warning = '' } = {}) {
  const a: SessionSnapshot = {
    id: 'A', workspaceId: 'w1', title: '中断会话', updatedAt: date, active: null,
    lastResult: { requestId: 'r1', status: 'interrupted', message: notice },
    messages: saved ? [{ id: 'u1', role: 'user', text: '此前发送的内容', requestId: 'r1' }] : [],
    ...(warning ? { recoveryWarning: warning } : {}),
  };
  const b: SessionSnapshot = { id: 'B', workspaceId: 'w1', title: '另一会话', updatedAt: date, active: null, lastResult: null, messages: [] };
  const state = { sends: [] as { text: string; fileRefs?: { path: string }[] }[], reads: 0, otherWrites: 0 };
  await page.addInitScript(({ draft }) => {
    if (sessionStorage.getItem('recovery-fixture')) return;
    sessionStorage.setItem('recovery-fixture', '1');
    sessionStorage.setItem('berserk.workspace', 'w1');
    sessionStorage.setItem('berserk.selections', JSON.stringify({ w1: 'A' }));
    sessionStorage.setItem('berserk.submitted', JSON.stringify({ A: '此前发送的内容' }));
    sessionStorage.setItem('berserk.drafts', JSON.stringify({ A: draft }));
    const attachment = (name: string) => ({ id: name, workspaceId: 'w1', name, size: 12, path: name, status: 'ready', progress: 100 });
    sessionStorage.setItem('berserk.submitted-attachments', JSON.stringify({ A: [attachment('此前附件.txt')] }));
    sessionStorage.setItem('berserk.attachments', JSON.stringify({ A: draft ? [attachment('新草稿附件.txt')] : [] }));
  }, { draft });
  await page.route('**/api/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/auth/session') return json({mode:'test'});
    if (path === '/api/info') return json({ model: 'test', configured: true, contextReady: true, limits: {} });
    if (path === '/api/activity') return json({ defaultWorkspaceId: 'w1', workspaces: [{ id: 'w1', name: '测试项目', createdAt: date }], sessions: [a, b].map(({ id, workspaceId, title, updatedAt, active, lastResult, recoveryWarning }) => ({ id, workspaceId, title, updatedAt, active, lastResult, recoveryWarning, statusUpdatedAt: updatedAt })) });
    if (path.endsWith('/resources')) return json({ workspaceId: 'w1', instructions: [], sources: [], skills: [] });
    if (path === '/api/sessions/A') { state.reads++; return json(a); }
    if (path === '/api/sessions/B') return json(b);
    if (path === '/api/sessions/A/messages') {
      const input = request.postDataJSON(); state.sends.push(input);
      a.messages.push({ id: 'u2', role: 'user', text: input.text, requestId: 'r2' }, { id: 'a2', role: 'assistant', text: '已检查并继续处理。', requestId: 'r2' });
      a.lastResult = { requestId: 'r2', status: 'succeeded' };
      const events: StreamEvent[] = [{ type: 'response.started', sessionId: 'A', requestId: 'r2' }, { type: 'response.completed', sessionId: 'A', requestId: 'r2', snapshot: a }];
      return route.fulfill({ contentType: 'text/event-stream', body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') });
    }
    if (request.method() !== 'GET') state.otherWrites++;
    return json({ error: { code: 'NOT_FOUND', message: path } }, 404);
  });
  await page.goto('/');
  return { a, state };
}

test('interrupted saved input stays in history; only an explicit new message continues the session', async ({ page }) => {
  const { state } = await fixture(page);
  const composer = page.getByRole('textbox', { name: '发送消息' });
  await expect(page.getByText(notice, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '中断会话', exact: true })).toContainText('已中断');
  await expect(composer).toHaveValue('');
  await expect(page.getByText('此前附件.txt', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('有新回复未读')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '停止回复', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('article', { name: '你的消息' })).toHaveText('此前发送的内容');
  await expect(composer).toHaveValue('');
  await page.getByRole('button', { name: '全部动态', exact: true }).click();
  await page.getByRole('button', { name: '需关注', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开会话：中断会话' })).toContainText('已中断');
  await expect(page.getByRole('button', { name: '打开会话：另一会话' })).toHaveCount(0);
  await page.getByRole('button', { name: '打开会话：中断会话' }).click();
  expect(state.sends).toHaveLength(0); expect(state.otherWrites).toBe(0);
  await composer.fill('先检查现有文件，再继续');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Axon 的回复' })).toContainText('已检查并继续处理。');
  expect(state.sends).toEqual([{ text: '先检查现有文件，再继续' }]);
  await expect(page.getByText(notice, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('article', { name: '你的消息' })).toHaveCount(2);
});

test('interruption preserves independent draft, attachments and focus across switch and refresh', async ({ page }) => {
  const { state } = await fixture(page, { draft: '正在编辑的新草稿' });
  const composer = page.getByRole('textbox', { name: '发送消息' });
  await expect(composer).toHaveValue('正在编辑的新草稿');
  await expect(page.getByText('新草稿附件.txt', { exact: true })).toBeVisible();
  await expect(page.getByText('此前附件.txt', { exact: true })).toHaveCount(0);
  await composer.focus();
  const before = state.reads;
  await expect.poll(() => state.reads).toBeGreaterThan(before);
  await expect(composer).toBeFocused();
  await page.getByRole('button', { name: '另一会话', exact: true }).click();
  await expect(composer).toHaveValue('');
  await page.getByRole('button', { name: '中断会话', exact: true }).click();
  await expect(composer).toHaveValue('正在编辑的新草稿');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(composer).toHaveValue('正在编辑的新草稿');
  await expect(page.getByText('新草稿附件.txt', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.sends).toHaveLength(0); expect(state.otherWrites).toBe(0);
});

test('interrupted preparation restores only unrecorded input and attachments without sending', async ({ page }) => {
  const { state } = await fixture(page, { saved: false });
  await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveValue('此前发送的内容');
  await expect(page.getByText('此前附件.txt', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
  expect(state.sends).toHaveLength(0); expect(state.otherWrites).toBe(0);
});

test('unrecorded input recovery never replaces a newer draft without an explicit click', async ({ page }) => {
  const { state } = await fixture(page, { saved: false, draft: '后来编辑的草稿' });
  const composer = page.getByRole('textbox', { name: '发送消息' });
  await expect(composer).toHaveValue('后来编辑的草稿');
  await expect(page.getByText('新草稿附件.txt', { exact: true })).toBeVisible();
  await expect(page.getByText('此前附件.txt', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '恢复刚才发送的内容', exact: true }).click();
  await expect(composer).toHaveValue('此前发送的内容');
  expect(state.sends).toHaveLength(0);
});

test('hard recovery warning remains blocking even with an interrupted result', async ({ page }) => {
  const { state } = await fixture(page, { warning: '执行环境未确认停止，请先核对。', draft: '后续消息' });
  await expect(page.getByRole('alert')).toContainText('执行环境未确认停止');
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await expect(page.getByText(notice, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveValue('后续消息');
  expect(state.sends).toHaveLength(0); expect(state.otherWrites).toBe(0);
});

test('missing tool evidence remains unknown after a successful new reply', async ({ page }) => {
  const { a, state } = await fixture(page);
  a.messages.push({ id: 'missing-t1', role: 'tool', requestId: 'r1', toolCallId: 't1', toolName: 'bash', resultMissing: true, text: '未收到执行结果，无法确认是否已执行。' });
  await page.reload();
  const tool = page.locator('details.tool-result');
  await expect(tool.locator('summary')).toContainText('未收到执行结果');
  await expect(tool).not.toHaveClass(/failed/);
  await tool.locator('summary').click();
  await expect(tool).toContainText('无法确认是否已执行');
  await page.getByRole('textbox', { name: '发送消息' }).fill('核对现有文件');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Axon 的回复' })).toBeVisible();
  await expect(tool.locator('summary')).toContainText('未收到执行结果');
  await expect(tool).not.toHaveClass(/failed/);
  await page.reload();
  await expect(tool.locator('summary')).toContainText('未收到执行结果');
  expect(state.sends).toHaveLength(1);
});

test('continued requests keep child cards at their own tool positions when call IDs repeat', async ({ page }) => {
  const { a } = await fixture(page);
  a.subagents = ['r1', 'r2'].map((requestId, index) => ({
    subagentId: `child-${requestId}`, parentRequestId: requestId, toolCallId: 'shared-call', role: 'analyst',
    description: '资料分析', task: `第 ${index + 1} 次任务`, status: 'succeeded', result: `第 ${index + 1} 次结果`,
    startedAt: date, completedAt: date,
  }));
  a.messages.push(
    { id: 'missing-r1', role: 'tool', requestId: 'r1', toolCallId: 'shared-call', toolName: 'subagent', resultMissing: true, text: '未收到执行结果，无法确认是否已执行。' },
    { id: 'u2', role: 'user', requestId: 'r2', text: '继续核对' },
    { id: 'result-r2', role: 'tool', requestId: 'r2', toolCallId: 'shared-call', toolName: 'subagent', text: '第二次子任务结果' },
  );
  a.lastResult = { requestId: 'r2', status: 'succeeded' };
  await page.reload();
  await expect(page.locator('.subagent-card')).toHaveCount(2);
  await expect(page.locator('.tool-result')).toHaveCount(0);
  await expect(page.locator('.subagent-placeholder')).toHaveCount(0);
  expect(await page.locator('.subagent-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-subagent-id')))).toEqual(['child-r1', 'child-r2']);
});

for (const oldOutputSaved of [false, true]) test(`file outputs remain request-scoped when call IDs repeat (old output saved=${oldOutputSaved})`, async ({ page }) => {
  const { a } = await fixture(page);
  a.fileOutputs = (oldOutputSaved ? ['r1', 'r2'] : ['r2']).map(requestId => ({
    workspaceId: 'w1', sessionId: 'A', requestId, toolCallId: 'shared-file-call', downloadId: `download-${requestId}`,
    path: `${requestId}.txt`, name: `${requestId}.txt`, size: 12, hash: 'a'.repeat(64), createdAt: date,
  }));
  a.messages.push(
    { id: 'missing-file-r1', role: 'tool', requestId: 'r1', toolCallId: 'shared-file-call', toolName: 'file_output', resultMissing: true, text: '未收到执行结果，无法确认是否已执行。' },
    { id: 'u2', role: 'user', requestId: 'r2', text: '继续生成文件' },
    { id: 'file-result-r2', role: 'tool', requestId: 'r2', toolCallId: 'shared-file-call', toolName: 'file_output', text: '文件已提供下载。' },
  );
  a.lastResult = { requestId: 'r2', status: 'succeeded' };
  await page.reload();
  await expect(page.getByRole('link', { name: '下载 r2.txt', exact: true })).toHaveCount(1);
  await expect(page.getByRole('link', { name: '下载 r1.txt', exact: true })).toHaveCount(oldOutputSaved ? 1 : 0);
  await expect(page.locator('.tool-result')).toHaveCount(oldOutputSaved ? 0 : 1);
  if (!oldOutputSaved) await expect(page.locator('.tool-result summary')).toContainText('未收到执行结果');
  const sequence = await page.locator('.message-list > .message, .message-list > .file-output, .message-list > .tool-result').evaluateAll(items => items.map(item => item.classList.contains('file-output') ? item.querySelector('strong')?.textContent : item.classList.contains('tool-result') ? 'missing' : 'user'));
  expect(sequence).toEqual(['user', oldOutputSaved ? 'r1.txt' : 'missing', 'user', 'r2.txt']);
});
