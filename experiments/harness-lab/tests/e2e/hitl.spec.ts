import { test, expect, type Page } from '@playwright/test';
import type { Interaction, InteractionResponse, QuestionInteraction, ConfirmationInteraction, SessionSnapshot, StreamEvent } from '../../src/contracts/index';

const base = { schemaVersion: 1 as const, interactionId: 'i1', workspaceId: 'w1', sessionId: 'A', requestId: 'r1', toolCallId: 't1', toolName: 'ask_user', createdAt: '2026-09-18T00:00:00Z' };
const question = (): QuestionInteraction => ({ ...base, kind: 'question', status: 'pending', questions: [
  { id: 'format', prompt: '需要什么格式？', options: [{ id: 'pdf', label: 'PDF', description: '适合阅读' }, { id: 'doc', label: 'Word' }] },
  { id: 'parts', prompt: '包含哪些部分？', multiSelect: true, options: [{ id: 'body', label: '正文' }, { id: 'appendix', label: '附录' }] },
  { id: 'note', prompt: '补充说明 <script>bad()</script>' },
] });
const confirmation = (): ConfirmationInteraction => ({ ...base, toolName: 'bash', kind: 'confirmation', status: 'pending', action: { title: '删除测试文件', description: '删除后文件不可恢复，请核对目标。', command: `rm -- '/workspace/${'测试目录/'.repeat(12)}待删除文件.txt'`, cwd: '/workspace', parameters: {} }, rule: { ruleId: 'delete', reason: '该命令包含删除操作', version: '1' } });
async function fixture(page: Page, initial: Interaction = question(), stream = false) {
  const a: SessionSnapshot = { id: 'A', workspaceId: 'w1', title: '会话 A', updatedAt: base.createdAt, active: stream ? null : { requestId: 'r1', status: 'responding', phase: initial.kind === 'question' ? 'waiting_answer' : 'waiting_confirmation' }, lastResult: null, messages: stream ? [] : [{ id: 'u1', role: 'user', text: '处理文件', requestId: 'r1' }, { id: 't1', role: 'tool', toolCallId: 't1', requestId: 'r1', toolName: initial.toolName, text: '' }], interactions: stream ? [] : [initial] };
  const b: SessionSnapshot = { id: 'B', workspaceId: 'w1', title: '会话 B', updatedAt: base.createdAt, active: null, lastResult: null, messages: [], interactions: [] };
  const state = { streamFailure: false, posts: [] as InteractionResponse[], sends: 0, cancels: 0, reads: 0, fault: '' as '' | 'lost' | 'conflict' | 'fail', readFailure: false, hold: undefined as (() => void) | undefined, delay: false };
  await page.route('**/api/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/auth/session') return json({mode:'test'});
    if (path === '/api/info') return json({ model: 'test', configured: true, contextReady: true, limits: {} });
    if (path === '/api/activity') return json({ defaultWorkspaceId: 'w1', workspaces: [{ id: 'w1', name: '测试项目', createdAt: base.createdAt }], sessions: [a, b].map(({ id, workspaceId, title, updatedAt, active, lastResult }) => ({ id, workspaceId, title, updatedAt, active, lastResult, statusUpdatedAt: updatedAt })) });
    if (path.endsWith('/resources')) return json({ workspaceId: 'w1', instructions: [], sources: [], skills: [] });
    if (path === '/api/sessions/B') return json(b);
    if (path === '/api/sessions/A') { state.reads++; return state.readFailure ? json({ error: { code: 'READ_FAILED', message: '暂时无法查询' } }, 503) : json(a); }
    if (path.endsWith('/cancel')) {
      state.cancels++; a.active = null; a.lastResult = { requestId: 'r1', status: 'cancelled' }; a.interactions = a.interactions!.map(item => ({ ...item, status: 'cancelled', reason: '本次请求已停止' })); return json(a);
    }
    if (path.endsWith('/messages')) {
      state.sends++; a.active = { requestId: 'r1', status: 'responding', phase: 'waiting_answer' }; a.interactions = [initial];
      a.messages = [{ id: 'u1', role: 'user', text: request.postDataJSON().text, requestId: 'r1' }, { id: 't1', role: 'tool', toolCallId: 't1', requestId: 'r1', toolName: 'ask_user', text: '' }];
      const events: StreamEvent[] = [{ type: 'response.started', sessionId: 'A', requestId: 'r1' }, { type: 'tool.started', sessionId: 'A', requestId: 'r1', toolCallId: 't1', toolName: 'ask_user' }, { type: 'interaction.updated', sessionId: 'B', requestId: 'r1', interaction: { ...initial, sessionId: 'B' } }, { type: 'interaction.updated', sessionId: 'A', requestId: 'r1', interaction: initial }];
      return route.fulfill({ contentType: 'text/event-stream', body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + (state.streamFailure ? 'data: broken-stream-frame\n\n' : '') });
    }
    if (path.endsWith('/response')) {
      const response = request.postDataJSON() as InteractionResponse; state.posts.push(response);
      if (state.delay) await new Promise<void>(resolve => { state.hold = resolve; });
      const item = a.interactions![0];
      if (state.fault !== 'fail') {
        if (item.kind === 'question' && response.kind === 'question') a.interactions = [{ ...item, status: state.fault === 'conflict' || response.action === 'skip' ? 'skipped' : 'answered', ...(response.action === 'answer' && state.fault !== 'conflict' ? { answers: response.answers } : {}) }];
        if (item.kind === 'confirmation' && response.kind === 'confirmation') a.interactions = [{ ...item, status: state.fault === 'conflict' || response.decision === 'reject' ? 'rejected' : 'approved' }];
        a.active = { requestId: 'r1', status: 'responding', phase: 'preparing' };
      }
      if (state.fault) return json({ error: { code: 'UNCERTAIN', message: '提交需核对' } }, state.fault === 'conflict' ? 409 : 503);
      return json(a.interactions![0]);
    }
    return json({ error: { code: 'NOT_FOUND', message: path } }, 404);
  });
  await page.goto('/');
  return { a, b, state };
}

async function answer(page: Page) {
  await page.getByRole('radio', { name: 'PDF 适合阅读' }).check();
  await page.getByLabel('正文', { exact: true }).check(); await page.getByLabel('附录', { exact: true }).check();
  await page.getByLabel('填写回答', { exact: true }).fill('中文输入内容');
}

for (const count of [0, 2]) test(`assignment card shows ${count} actual attachments before the description and preserves them after refresh`, async ({ page }) => {
  const item = confirmation();
  const files = Array.from({ length: count }, (_, index) => ({ fileId: `file-${index}`, name: index ? '修订要求.md' : '初稿.md', size: 42, hash: 'a'.repeat(64), createdAt: base.createdAt }));
  item.toolName = count ? 'work_item_action' : 'work_item_commit';
  item.rule = { ruleId: 'work-item-commit', reason: '正式交接需要用户确认', version: '1' };
  item.action = { title: '分派工作', description: '随附两份文件，接收后修订初稿。', parameters: count ? { action: { kind: 'assign', payload: { assigneeSeatId: 'seat-b', title: '修订', goal: '修订说明', inputPaths: ['初稿.md', '修订要求.md'] } } } : { operationId: 'op1' }, handoff: { operationId: 'op1', kind: 'assign', title: '分派工作', description: '随附两份文件，接收后修订初稿。', files } };
  const { state } = await fixture(page, item);
  const card = page.getByRole('region', { name: '操作确认', exact: true });
  const attachments = card.getByRole('region', { name: '本次附件', exact: true });
  await expect(attachments.getByRole('heading', { name: `本次附件：${count} 个` })).toBeVisible();
  expect((await attachments.boundingBox())!.y).toBeLessThan((await card.getByText(item.action.description, { exact: true }).boundingBox())!.y);
  if (count) {
    await page.route('**/api/handoff-files/*', route => route.fulfill({ contentType: 'text/plain', body: '# 已准备的初稿正文' }));
    await attachments.getByRole('button', { name: '查看', exact: true }).first().click();
    await expect(attachments.getByRole('region', { name: '初稿.md 固定副本预览' })).toContainText('已准备的初稿正文');
    await expect(attachments.getByRole('link', { name: '下载交接文件 初稿.md' })).toHaveAttribute('href', /handoff-files\/file-0$/);
  } else {
    await expect(attachments).toContainText('本次未附文件；在工作说明中写路径不会自动交接文件。');
  }
  await page.screenshot({ path: test.info().outputPath(`assignment-attachments-${count}.png`) });
  await page.reload();
  await expect(attachments.getByRole('heading', { name: `本次附件：${count} 个` })).toBeVisible();
  expect(state.posts).toHaveLength(0);
  await card.getByRole('button', { name: '确认执行', exact: true }).click();
  expect(state.posts).toEqual([{ requestId: 'r1', kind: 'confirmation', decision: 'approve' }]);
});

for (const kind of ['claim', 'submit', 'review'] as const) test(`${kind} confirmation does not show assignment attachment warnings`, async ({ page }) => {
  const item = confirmation();
  item.toolName = 'work_item_commit';
  item.rule = { ruleId: 'work-item-commit', reason: '正式交接需要用户确认', version: '1' };
  item.action = { title: '交接操作', description: '核对操作内容', parameters: { operationId: 'op1' }, handoff: { operationId: 'op1', kind, title: '交接操作', description: '核对操作内容', files: [] } };
  await fixture(page, item);
  await expect(page.getByRole('region', { name: '操作确认', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '本次附件', exact: true })).toHaveCount(0);
  await expect(page.getByText(/本次未附文件/)).toHaveCount(0);
});

for (const initial of [question(), confirmation()]) test(`restart expires ${initial.kind} without reopening old controls or resending chat`, async ({ page }) => {
  const { a, state } = await fixture(page, initial);
  await page.getByRole('textbox', { name: '发送消息' }).fill('重启前编辑的新草稿');
  a.active = null;
  a.lastResult = { requestId: 'r1', status: 'interrupted', message: '上次处理已中断，已保存内容保留，可继续发送消息。' };
  a.interactions = [{ ...initial, status: 'expired', reason: '服务重启，交互已失效' }];
  await page.reload();
  await expect(page.getByText('已失效', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认执行', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '提交回答', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '停止回复', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveValue('重启前编辑的新草稿');
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
  await expect(page.getByLabel('有新回复未读')).toHaveCount(0);
  expect(state.sends).toBe(0); expect(state.posts).toHaveLength(0);
});

test('question drafts survive switch and refresh, submit exact answers once without IME auto-send', async ({ page }) => {
  const { state } = await fixture(page);
  await expect(page.getByRole('button', { name: '提交回答' })).toBeDisabled();
  await answer(page);
  const text = page.getByLabel('填写回答', { exact: true });
  await text.dispatchEvent('compositionstart'); await text.press('Enter'); await text.dispatchEvent('compositionend');
  expect(state.posts).toHaveLength(0); expect(state.sends).toBe(0);
  await page.getByRole('textbox', { name: '发送消息' }).fill('下一条聊天草稿');
  await page.getByRole('button', { name: '会话 B', exact: true }).click();
  await page.getByRole('button', { name: '会话 A', exact: true }).click();
  await expect(text).toHaveValue(/中文输入内容/);
  await page.reload(); await expect(text).toHaveValue(/中文输入内容/);
  await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveValue('下一条聊天草稿');
  state.delay = true;
  await page.getByRole('button', { name: '提交回答' }).click();
  await expect(page.getByRole('button', { name: '提交中…' })).toBeDisabled();
  await expect.poll(() => state.posts.length).toBe(1); state.hold!();
  await expect(page.getByText('已回答', { exact: true })).toBeVisible();
  expect(state.posts[0]).toEqual({ requestId: 'r1', kind: 'question', action: 'answer', answers: [{ questionId: 'format', optionIds: ['pdf'] }, { questionId: 'parts', optionIds: ['body', 'appendix'] }, { questionId: 'note', text: '中文输入内容' }] });
  expect(await page.evaluate(() => sessionStorage.getItem('berserk.answer:A:r1:i1'))).toBeNull();
  expect(state.sends).toBe(0);
});

test('custom text is exclusive with choices and skip never sends draft answers', async ({ page }) => {
  const { a, state } = await fixture(page);
  await answer(page);
  const first = page.getByRole('group', { name: '1. 需要什么格式？' });
  await first.getByLabel('自定义回答').check(); await first.getByLabel('填写自定义回答').fill('Markdown');
  await page.getByRole('button', { name: '提交回答' }).click();
  expect(state.posts[0]).toMatchObject({ answers: [{ questionId: 'format', text: 'Markdown' }, { questionId: 'parts', optionIds: ['body', 'appendix'] }, { questionId: 'note', text: '中文输入内容' }] });
  a.interactions = [{ ...question(), interactionId: 'i2' }]; a.active = { requestId: 'r1', status: 'responding', phase: 'waiting_answer' }; await page.reload();
  await page.getByRole('button', { name: '跳过提问' }).click();
  expect(state.posts[1]).toEqual({ requestId: 'r1', kind: 'question', action: 'skip' });
  await expect(page.getByText('已跳过', { exact: true })).toBeVisible();
});

test('uncertain response requires GET before manual retry and keeps answers on read failure', async ({ page }) => {
  const { state } = await fixture(page); await answer(page); state.fault = 'fail'; state.readFailure = true;
  await page.getByRole('button', { name: '提交回答' }).click();
  await expect(page.getByRole('button', { name: '查询最新状态' })).toBeVisible();
  await page.getByRole('button', { name: '查询最新状态' }).click();
  await expect(page.getByText(/查询未完成，草稿已保留/)).toBeVisible();
  await expect(page.getByLabel('填写回答', { exact: true })).toHaveValue('中文输入内容');
  expect(state.posts).toHaveLength(1); state.readFailure = false;
  await page.getByRole('button', { name: '查询最新状态' }).click();
  await expect(page.getByRole('button', { name: '提交回答' })).toBeEnabled();
  expect(state.posts).toHaveLength(1); state.fault = '';
  await page.getByRole('button', { name: '提交回答' }).click();
  await expect(page.getByText('已回答', { exact: true })).toBeVisible(); expect(state.posts).toHaveLength(2);
});

for (const fault of ['lost', 'conflict'] as const) test(`confirmation ${fault} reconciles first accepted decision without repost`, async ({ page }) => {
  const { state, a } = await fixture(page, confirmation()); state.fault = fault;
  await expect(page.getByLabel('完整命令', { exact: true })).toHaveText(confirmation().action.command!); state.readFailure = true;
  await page.getByRole('button', { name: '确认执行' }).click();
  await expect(page.getByRole('button', { name: '查询最新状态' })).toBeVisible();
  state.readFailure = false; await page.getByRole('button', { name: '查询最新状态' }).click();
  await expect(page.getByText(fault === 'lost' ? '已确认，继续处理' : '已拒绝', { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(1);
  a.interactions = [confirmation()]; await page.waitForTimeout(2000);
  await expect(page.getByRole('button', { name: '确认执行' })).toHaveCount(0);
});

test('stop and expired history disable decisions; approved unknown results stay distinct', async ({ page }) => {
  const { state, a } = await fixture(page, confirmation());
  await page.getByRole('button', { name: '停止回复', exact: true }).click();
  await expect(page.getByText('已取消', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认执行' })).toHaveCount(0);
  expect(state.cancels).toBe(1); expect(state.posts).toHaveLength(0);
  a.interactions = [{ ...confirmation(), status: 'expired', reason: '服务重启，交互已失效' }, { ...confirmation(), interactionId: 'i2', toolCallId: 't2', status: 'approved', execution: 'unknown' }, { ...confirmation(), interactionId: 'i3', toolCallId: 't3', status: 'approved', execution: 'not_started' }];
  await page.reload(); await expect(page.getByText('已失效', { exact: true })).toBeVisible();
  await expect(page.getByText('执行结果未确认，请核对后再继续。')).toBeVisible(); await expect(page.getByText('未执行：操作在开始前已停止。')).toBeVisible(); expect(state.sends).toBe(0);
});

test('SSE question receives attention without unread dot or animation; mobile command wraps', async ({ page }) => {
  const { state, a } = await fixture(page, question(), true);
  await page.getByRole('textbox', { name: '发送消息' }).fill('提问'); await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Agent 提问' })).toHaveCount(1);
  await expect(page.locator('.thinking')).toHaveCount(0); await expect(page.getByLabel('有新回复未读')).toHaveCount(0);
  await page.getByRole('button', { name: '全部动态', exact: true }).click(); await page.getByRole('button', { name: '需关注', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开会话：会话 A' })).toBeVisible();
  await expect(page.getByRole('button', { name: '打开会话：会话 B' })).toHaveCount(0);
  a.interactions = [confirmation()]; a.active = { requestId: 'r1', status: 'responding', phase: 'waiting_confirmation' };
  await page.setViewportSize({ width: 375, height: 812 }); await page.reload();
  await expect(page.getByRole('region', { name: '操作确认' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 812, height: 375 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  await expect(page.getByText('已拒绝', { exact: true })).toBeVisible(); expect(state.sends).toBe(1);
});


test('arbitrary question IDs remain editable when session storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('unavailable'); }; });
  const item = question();
  item.questions = item.questions.map((entry, index) => ({ ...entry, id: ['constructor', '__proto__', 'toString'][index] }));
  const { state } = await fixture(page, item);
  await answer(page);
  await page.getByRole('button', { name: '会话 B', exact: true }).click();
  await page.getByRole('button', { name: '会话 A', exact: true }).click();
  await expect(page.getByLabel('填写回答', { exact: true })).toHaveValue('中文输入内容');
  await page.getByRole('button', { name: '提交回答' }).click();
  await expect(page.getByText('已回答', { exact: true })).toBeVisible();
  expect(state.posts[0]).toMatchObject({ answers: [{ questionId: 'constructor', optionIds: ['pdf'] }, { questionId: '__proto__', optionIds: ['body', 'appendix'] }, { questionId: 'toString', text: '中文输入内容' }] });
});


test('accepted stream failure and waiting refresh never restore the already sent message into the composer', async ({ page }) => {
  const { state } = await fixture(page, question(), true);
  state.streamFailure = true;
  const composer = page.getByRole('textbox', { name: '发送消息' });
  await composer.fill('已发送的报告要求');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Agent 提问' })).toBeVisible();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(composer).toHaveValue('');
  await page.getByLabel('填写回答', { exact: true }).fill('问题回答草稿');
  await page.reload();
  await expect(page.getByRole('article', { name: '你的消息' })).toContainText('已发送的报告要求');
  await expect(composer).toHaveValue('');
  await expect(page.getByLabel('填写回答', { exact: true })).toHaveValue('问题回答草稿');
  await composer.fill('真正的新聊天草稿');
  await page.reload();
  await expect(composer).toHaveValue('真正的新聊天草稿');
  await expect(page.getByLabel('填写回答', { exact: true })).toHaveValue('问题回答草稿');
  expect(state.sends).toBe(1); expect(state.posts).toHaveLength(0);
});
