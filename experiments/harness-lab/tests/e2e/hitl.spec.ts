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
    if (path === '/api/models') return json({ defaultModelId: 'default', models: [{ id: 'default', provider: 'test', model: 'test', configured: true, contextReady: true, contextWindow: 1000000, maxOutputTokens: 393216 }] });
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
      const id = /\/interactions\/([^/]+)\/response$/.exec(path)?.[1];
      const index = a.interactions!.findIndex(item => item.interactionId === id);
      const item = a.interactions![index];
      if (state.fault !== 'fail') {
        if (item.kind === 'question' && response.kind === 'question') a.interactions![index] = { ...item, status: state.fault === 'conflict' || response.action === 'skip' ? 'skipped' : 'answered', ...(response.action === 'answer' && state.fault !== 'conflict' ? { answers: response.answers } : {}) };
        if (item.kind === 'confirmation' && response.kind === 'confirmation') a.interactions![index] = { ...item, status: state.fault === 'conflict' || response.decision === 'reject' ? 'rejected' : 'approved' };
        a.active = { requestId: 'r1', status: 'responding', phase: 'preparing' };
      }
      if (state.fault) return json({ error: { code: 'UNCERTAIN', message: '提交需核对' } }, state.fault === 'conflict' ? 409 : 503);
      return json(a.interactions![index]);
    }
    return json({ error: { code: 'NOT_FOUND', message: path } }, 404);
  });
  await page.goto('/');
  return { a, b, state };
}

const composerCard = (page: Page, name: string) => page.locator('.composer-dock').getByRole('region', { name, exact: true });
/** Fill all three fixture questions through the card's pagination; ends on the last page. */
async function answer(page: Page) {
  const card = composerCard(page, 'Agent 提问');
  await card.getByRole('radio', { name: 'PDF 适合阅读' }).check();
  await card.getByRole('button', { name: '下一题', exact: true }).click();
  await card.getByLabel('正文', { exact: true }).check(); await card.getByLabel('附录', { exact: true }).check();
  await card.getByRole('button', { name: '下一题', exact: true }).click();
  await card.getByLabel('填写回答', { exact: true }).fill('中文输入内容');
}
async function lastQuestionPage(page: Page) {
  const card = composerCard(page, 'Agent 提问');
  await card.getByRole('button', { name: '下一题', exact: true }).click();
  await card.getByRole('button', { name: '下一题', exact: true }).click();
  return card;
}

test('a pending question occupies the composer as the only operable form, with stop still available', async ({ page }) => {
  const { state } = await fixture(page);
  const card = composerCard(page, 'Agent 提问');
  await expect(card).toBeVisible();
  const pointer = page.getByRole('region', { name: '提问状态', exact: true });
  await expect(pointer).toBeVisible();
  await expect(pointer.getByText('请在下方输入区处理', { exact: true })).toBeVisible();
  await expect(pointer.getByRole('radio')).toHaveCount(0);
  await expect(pointer.getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '停止回复', exact: true })).toBeEnabled();
  expect(state.sends).toBe(0); expect(state.posts).toHaveLength(0);
});

test('a multi-question card pages through questions and keeps drafts across pages', async ({ page }) => {
  const { state } = await fixture(page);
  const card = composerCard(page, 'Agent 提问');
  await expect(card.getByText(/第 1 \/ 3 题/)).toBeVisible();
  await expect(card.getByRole('button', { name: '上一题' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: '提交回答' })).toBeDisabled();
  await card.getByRole('radio', { name: 'PDF 适合阅读' }).check();
  await card.getByRole('button', { name: '下一题', exact: true }).click();
  await expect(card.getByText(/第 2 \/ 3 题/)).toBeVisible();
  await expect(card.getByRole('group', { name: '1. 需要什么格式？' })).toHaveCount(0);
  await card.getByLabel('正文', { exact: true }).check();
  await card.getByRole('button', { name: '下一题', exact: true }).click();
  await card.getByLabel('填写回答', { exact: true }).fill('中文输入内容');
  await expect(card.getByRole('button', { name: '下一题' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: '提交回答' })).toBeEnabled();
  await card.getByRole('button', { name: '上一题', exact: true }).click();
  await expect(card.getByLabel('正文', { exact: true })).toBeChecked();
  await card.getByRole('button', { name: '上一题', exact: true }).click();
  await expect(card.getByRole('radio', { name: 'PDF 适合阅读' })).toBeChecked();
  await page.screenshot({ path: test.info().outputPath('composer-question-paged.png') });
  expect(state.posts).toHaveLength(0); expect(state.sends).toBe(0);
});

test('a question card collapses to its title bar without freeing the composer', async ({ page }) => {
  await fixture(page);
  const card = composerCard(page, 'Agent 提问');
  await card.getByRole('radio', { name: 'PDF 适合阅读' }).check();
  await card.getByRole('button', { name: '收起提问', exact: true }).click();
  await expect(card.getByRole('radio')).toHaveCount(0);
  await expect(card.getByRole('button', { name: '提交回答' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveCount(0);
  await expect(card.getByText('需要你的回答', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: '展开提问', exact: true }).click();
  await expect(card.getByRole('radio', { name: 'PDF 适合阅读' })).toBeChecked();
});

test('a pending confirmation occupies the composer without a collapse option and keeps actions reachable', async ({ page }) => {
  const { state } = await fixture(page, confirmation());
  const card = composerCard(page, '操作确认');
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: /收起/ })).toHaveCount(0);
  await expect(card.getByLabel('完整命令', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: '允许本次执行', exact: true })).toBeEnabled();
  const pointer = page.getByRole('region', { name: '确认状态', exact: true });
  await expect(pointer.getByText('删除测试文件', { exact: true })).toBeVisible();
  await expect(pointer.getByRole('button')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const width of [960, 680]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(card.getByRole('button', { name: '允许本次执行', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: test.info().outputPath('composer-confirmation.png'), fullPage: true });
  expect(state.posts).toHaveLength(0);
});

test('pending cards are handled one at a time in record order and the composer returns after the last', async ({ page }) => {
  const first = question();
  const second: QuestionInteraction = { ...question(), interactionId: 'i2', toolCallId: 't2', questions: [{ id: 'go', prompt: '是否继续？', options: [{ id: 'yes', label: '继续' }] }] };
  const { a, state } = await fixture(page, first);
  a.interactions = [first, second];
  await page.reload();
  const card = composerCard(page, 'Agent 提问');
  await expect(card.getByRole('group', { name: '1. 需要什么格式？' })).toBeVisible();
  await expect(card.getByRole('group', { name: '是否继续？' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '提问状态' })).toHaveCount(2);
  await answer(page);
  await card.getByRole('button', { name: '提交回答' }).click();
  // Acceptance exits the first card at once; the next card follows without waiting for the reply.
  await expect(card.getByRole('group', { name: '是否继续？', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: '下一题' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '回答记录', exact: true })).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveCount(0);
  await card.getByRole('radio', { name: '继续', exact: true }).check();
  await card.getByRole('button', { name: '提交回答' }).click();
  await expect(page.getByRole('textbox', { name: '发送消息' })).toBeVisible();
  await expect(page.getByRole('region', { name: '提问状态' })).toHaveCount(0);
  expect(state.posts.map(post => post.kind)).toEqual(['question', 'question']);
  expect(state.sends).toBe(0);
});

test('an accepted answer exits the card at once, keeps the running request, and preserves the composer draft', async ({ page }) => {
  await page.addInitScript(() => { sessionStorage.setItem('berserk.drafts', JSON.stringify({ A: '保留的聊天草稿' })); });
  const { state } = await fixture(page);
  await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveCount(0);
  await answer(page);
  await composerCard(page, 'Agent 提问').getByRole('button', { name: '提交回答' }).click();
  // The request is still running; acceptance alone returns the ordinary composer with its draft.
  await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveValue('保留的聊天草稿');
  await expect(page.getByRole('button', { name: '停止回复', exact: true })).toBeEnabled();
  const record = page.getByRole('region', { name: '回答记录', exact: true });
  await expect(record.locator('.qa-answer').nth(0)).toHaveText('PDF');
  await expect(record.getByText('已回答', { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(1);
  expect(state.sends).toBe(0);
});

test('focus moves from the composer into the card and returns after the answer', async ({ page }) => {
  const { state } = await fixture(page, question(), true);
  const composer = page.getByRole('textbox', { name: '发送消息' });
  await composer.fill('提问');
  await composer.press('Enter');
  const card = composerCard(page, 'Agent 提问');
  await expect(card).toBeVisible();
  await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveCount(0);
  // Focus had been in the composer, so it lands inside the card instead of being lost.
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[aria-label="Agent 提问"]') ? 'card' : 'elsewhere')).toBe('card');
  await answer(page);
  await card.getByRole('button', { name: '提交回答' }).click();
  await expect(composer).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.id || '')).toBe('message-input');
  expect(state.sends).toBe(1); expect(state.posts).toHaveLength(1);
});

test('an approved confirmation shows in-progress only while its own tool is executing', async ({ page }) => {
  const item = confirmation();
  const { a, state } = await fixture(page, item);
  const card = composerCard(page, '操作确认');
  await card.getByRole('button', { name: '允许本次执行', exact: true }).click();
  const history = page.getByRole('region', { name: '操作确认', exact: true });
  const summary = history.locator('details.confirmation-history > summary');
  await expect(summary.getByText('执行结果待确认。', { exact: true })).toBeVisible();
  a.active = { requestId: 'r1', status: 'responding', phase: 'tool', toolName: 'bash' };
  await page.reload();
  await expect(summary.getByText('正在执行…', { exact: true })).toBeVisible();
  a.active = { requestId: 'r1', status: 'responding', phase: 'generating' };
  await page.reload();
  await expect(summary.getByText('执行结果待确认。', { exact: true })).toBeVisible();
  await expect(history.getByText('正在执行…', { exact: true })).toHaveCount(0);
  expect(state.posts).toHaveLength(1);
  expect(state.sends).toBe(0);
});

for (const count of [0, 2]) test(`assignment card shows ${count} actual attachments before the description and preserves them after refresh`, async ({ page }) => {
  const item = confirmation();
  const files = Array.from({ length: count }, (_, index) => ({ fileId: `file-${index}`, name: index ? '修订要求.md' : '初稿.md', size: 42, hash: 'a'.repeat(64), createdAt: base.createdAt }));
  item.toolName = count ? 'work_item_action' : 'work_item_commit';
  item.rule = { ruleId: 'work-item-commit', reason: '正式交接需要用户确认', version: '1' };
  item.action = { title: '分派「修订说明」给 B', description: '随附两份文件，接收后修订初稿。', parameters: count ? { action: { kind: 'assign', payload: { assigneeSeatId: 'seat-b', title: '修订', goal: '修订说明', inputPaths: ['初稿.md', '修订要求.md'] } } } : { operationId: 'op1' }, handoff: { operationId: 'op1', kind: 'assign', title: '分派「修订说明」给 B', description: '随附两份文件，接收后修订初稿。', files } };
  const { state } = await fixture(page, item);
  const card = composerCard(page, '操作确认');
  const attachments = card.getByRole('region', { name: '本次附件', exact: true });
  await expect(card.getByRole('heading', { level: 3, name: item.action.title, exact: true })).toBeVisible();
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
  await card.getByRole('button', { name: '确认分派', exact: true }).click();
  expect(state.posts).toEqual([{ requestId: 'r1', kind: 'confirmation', decision: 'approve' }]);
});

for (const { kind, label, title } of [
  { kind: 'claim', label: '确认签收', title: '签收「修订说明」' },
  { kind: 'submit', label: '确认提交', title: '提交「修订说明」' },
  { kind: 'review', label: '确认审核', title: '审核「修订说明」' },
] as const) test(`${kind} confirmation names its action and does not show assignment attachment warnings`, async ({ page }) => {
  const item = confirmation();
  item.toolName = 'work_item_commit';
  item.rule = { ruleId: 'work-item-commit', reason: '正式交接需要用户确认', version: '1' };
  item.action = { title, description: '核对操作内容', parameters: { operationId: 'op1' }, handoff: { operationId: 'op1', kind, title, description: '核对操作内容', files: [] } };
  const { state } = await fixture(page, item);
  const card = composerCard(page, '操作确认');
  await expect(card.getByRole('heading', { level: 3, name: title, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '本次附件', exact: true })).toHaveCount(0);
  await expect(page.getByText(/本次未附文件/)).toHaveCount(0);
  await card.getByRole('button', { name: label, exact: true }).click();
  expect(state.posts).toEqual([{ requestId: 'r1', kind: 'confirmation', decision: 'approve' }]);
});

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
]) test(`pending confirmation is fully reviewable on ${viewport.name}`, async ({ page }) => {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const item = confirmation();
  const { state } = await fixture(page, item);
  const card = composerCard(page, '操作确认');
  await expect(card.getByRole('heading', { level: 3, name: item.action.title, exact: true })).toBeVisible();
  await expect(card.getByText('请确认本次操作', { exact: true })).toHaveCount(0);
  await expect(card.getByText(item.action.description, { exact: true })).toBeVisible();
  await expect(card.getByLabel('完整命令', { exact: true })).toHaveText(item.action.command!);
  await expect(card.getByLabel('完整命令', { exact: true })).toBeVisible();
  await expect(card.getByText(item.action.cwd!, { exact: true })).toBeVisible();
  await expect(card.getByText(item.rule.reason, { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: '允许本次执行', exact: true })).toBeEnabled();
  await expect(card.locator('details.confirmation-history')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`confirmation-pending-${viewport.name}.png`), fullPage: true });
  expect(state.posts).toHaveLength(0); expect(state.sends).toBe(0);
});

test('confirmation without a command keeps a generic explicit approval action', async ({ page }) => {
  const item = confirmation();
  item.action = { title: '应用文件变更', description: '核对后应用本次文件变更。', parameters: {} };
  const { state } = await fixture(page, item);
  const card = page.getByRole('region', { name: '操作确认', exact: true });
  await expect(card.getByRole('heading', { level: 3, name: item.action.title, exact: true })).toBeVisible();
  await card.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect(card.locator('details.confirmation-history > summary').getByText('执行结果待确认。', { exact: true })).toBeVisible();
  expect(state.posts).toEqual([{ requestId: 'r1', kind: 'confirmation', decision: 'approve' }]);
});

for (const scenario of [
  { status: 'approved', label: '已确认', execution: undefined, outcome: '执行结果待确认。' },
  { status: 'approved', label: '已确认', execution: 'succeeded', outcome: '执行已完成。' },
  { status: 'approved', label: '已确认', execution: 'failed', outcome: '执行失败，请查看详情。' },
  { status: 'approved', label: '已确认', execution: 'unknown', outcome: '执行结果未确认，请核对后再继续。' },
  { status: 'approved', label: '已确认', execution: 'not_started', outcome: '未执行：操作在开始前已停止。' },
  { status: 'rejected', label: '已拒绝', execution: undefined, outcome: undefined },
  { status: 'cancelled', label: '已取消', execution: undefined, outcome: undefined },
  { status: 'expired', label: '已失效', execution: undefined, outcome: undefined },
] as const) test(`${scenario.status} confirmation history keeps ${scenario.execution ?? 'no execution evidence'} visible while collapsed`, async ({ page }) => {
  const item: ConfirmationInteraction = { ...confirmation(), status: scenario.status, execution: scenario.execution, reason: '历史记录只供核对，不能再次执行。' };
  const { a, state } = await fixture(page, item);
  a.active = null;
  a.messages[1] = { ...a.messages[1], text: '工具返回的原始记录：已保留本次操作详情。' };
  await page.reload();
  const card = page.getByRole('region', { name: '操作确认', exact: true });
  const history = card.locator('details.confirmation-history');
  const summary = history.locator(':scope > summary');
  await expect(history).toHaveJSProperty('open', false);
  await expect(summary.getByText(item.action.title, { exact: true })).toBeVisible();
  await expect(summary.getByText(scenario.label, { exact: true })).toBeVisible();
  if (scenario.outcome) await expect(summary.getByText(scenario.outcome, { exact: true })).toBeVisible();
  await expect(card.getByLabel('完整命令', { exact: true })).toBeHidden();
  await expect(card.getByText(item.action.description, { exact: true })).toBeHidden();
  await expect(card.getByRole('button', { name: /^(允许本次执行|确认执行|拒绝)$/ })).toHaveCount(0);
  if (scenario.execution === 'unknown') await page.screenshot({ path: test.info().outputPath('confirmation-history-collapsed.png'), fullPage: true });
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(history).toHaveJSProperty('open', true);
  await expect(card.getByText(item.action.description, { exact: true })).toBeVisible();
  await expect(card.getByLabel('完整命令', { exact: true })).toHaveText(item.action.command!);
  await expect(card.getByLabel('完整命令', { exact: true })).toBeVisible();
  await expect(card.getByText(item.action.cwd!, { exact: true })).toBeVisible();
  await expect(card.getByText(item.rule.reason, { exact: true })).toBeVisible();
  await expect(card.getByText(item.reason!, { exact: true })).toBeVisible();
  await history.locator('.interaction-result > summary').click();
  await expect(history.getByText(a.messages[1].text, { exact: true })).toBeVisible();
  if (scenario.execution === 'unknown') await page.screenshot({ path: test.info().outputPath('confirmation-history-expanded.png'), fullPage: true });
  await summary.click(); await expect(history).toHaveJSProperty('open', false);
  expect(state.posts).toHaveLength(0); expect(state.sends).toBe(0);
});

for (const initial of [question(), confirmation()]) test(`restart expires ${initial.kind} without reopening old controls or resending chat`, async ({ page }) => {
  const { a, state } = await fixture(page, initial);
  a.inputQueue = { requestId: 'r1', revision: 1, available: false, reason: '请先回答或确认当前问题。', items: [] };
  await page.reload();
  // The pending card occupies the composer; the ordinary input stays hidden and stop remains available.
  await expect(page.getByRole('button', { name: '停止回复', exact: true })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveCount(0);
  await expect(page.locator('.composer-footnote')).toHaveCount(0);
  await expect(page.getByText('请先回答或确认当前问题。', { exact: true })).toHaveCount(0);
  if (initial.kind === 'confirmation') await page.screenshot({ path: test.info().outputPath('composer-waiting-confirmation.png') });
  a.active = null;
  a.lastResult = { requestId: 'r1', status: 'interrupted', message: '上次处理已中断，已保存内容保留，可继续发送消息。' };
  a.interactions = [{ ...initial, status: 'expired', reason: '服务重启，交互已失效' }];
  await page.reload();
  await expect(page.getByText('已失效', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '允许本次执行', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '提交回答', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '停止回复', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: '发送消息' }).fill('重启后编辑的新草稿');
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
  await expect(page.getByLabel('有新回复未读')).toHaveCount(0);
  expect(state.sends).toBe(0); expect(state.posts).toHaveLength(0);
});

test('question drafts survive switch and refresh, submit exact answers once without IME auto-send', async ({ page }) => {
  const { state } = await fixture(page);
  const card = composerCard(page, 'Agent 提问');
  await expect(card.getByRole('button', { name: '提交回答' })).toBeDisabled();
  await answer(page);
  const text = card.getByLabel('填写回答', { exact: true });
  await text.dispatchEvent('compositionstart'); await text.press('Enter'); await text.dispatchEvent('compositionend');
  expect(state.posts).toHaveLength(0); expect(state.sends).toBe(0);
  await page.getByRole('button', { name: '会话 B', exact: true }).click();
  await page.getByRole('button', { name: '会话 A', exact: true }).click();
  // Pagination restarts from the first question; the answers themselves are preserved.
  await lastQuestionPage(page);
  await expect(composerCard(page, 'Agent 提问').getByLabel('填写回答', { exact: true })).toHaveValue(/中文输入内容/);
  await page.reload();
  await lastQuestionPage(page);
  await expect(composerCard(page, 'Agent 提问').getByLabel('填写回答', { exact: true })).toHaveValue(/中文输入内容/);
  state.delay = true;
  await composerCard(page, 'Agent 提问').getByRole('button', { name: '提交回答' }).click();
  await expect(composerCard(page, 'Agent 提问').getByRole('button', { name: '提交中…' })).toBeDisabled();
  await expect.poll(() => state.posts.length).toBe(1); state.hold!();
  // The accepted answer exits the composer immediately; the request is still running.
  await expect(page.getByRole('textbox', { name: '发送消息' })).toBeVisible();
  await expect(page.getByText('已回答', { exact: true })).toBeVisible();
  const answered = page.getByRole('region', { name: '回答记录', exact: true });
  await expect(answered.locator('.qa-answer').nth(0)).toHaveText('PDF');
  await expect(answered.locator('.qa-answer').nth(1)).toHaveText('正文、附录');
  await expect(answered.locator('.qa-answer').nth(2)).toHaveText('中文输入内容');
  await expect(answered.getByText('Word', { exact: true })).toBeHidden();
  await page.screenshot({ path: test.info().outputPath('question-answered.png'), fullPage: true });
  await answered.getByText('查看全部选项', { exact: true }).first().click();
  await expect(answered.getByText('Word', { exact: true })).toBeVisible();
  // The ordinary composer draft works again after the card exits.
  await page.getByRole('textbox', { name: '发送消息' }).fill('下一条聊天草稿');
  await page.reload();
  await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveValue('下一条聊天草稿');
  expect(state.posts[0]).toEqual({ requestId: 'r1', kind: 'question', action: 'answer', answers: [{ questionId: 'format', optionIds: ['pdf'] }, { questionId: 'parts', optionIds: ['body', 'appendix'] }, { questionId: 'note', text: '中文输入内容' }] });
  expect(await page.evaluate(() => sessionStorage.getItem('berserk.answer:A:r1:i1'))).toBeNull();
  expect(state.sends).toBe(0);
});

test('custom text is exclusive with choices and skip never sends draft answers', async ({ page }) => {
  const { a, state } = await fixture(page);
  const card = composerCard(page, 'Agent 提问');
  await answer(page);
  await card.getByRole('button', { name: '上一题', exact: true }).click();
  await card.getByRole('button', { name: '上一题', exact: true }).click();
  const first = card.getByRole('group', { name: '1. 需要什么格式？' });
  await first.getByLabel('自定义回答').check(); await first.getByLabel('填写自定义回答').fill('Markdown');
  await card.getByRole('button', { name: '提交回答' }).click();
  expect(state.posts[0]).toMatchObject({ answers: [{ questionId: 'format', text: 'Markdown' }, { questionId: 'parts', optionIds: ['body', 'appendix'] }, { questionId: 'note', text: '中文输入内容' }] });
  a.interactions = [{ ...question(), interactionId: 'i2' }]; a.active = { requestId: 'r1', status: 'responding', phase: 'waiting_answer' }; await page.reload();
  await card.getByRole('button', { name: '跳过提问' }).click();
  expect(state.posts[1]).toEqual({ requestId: 'r1', kind: 'question', action: 'skip' });
  await expect(page.getByText('已跳过', { exact: true })).toBeVisible();
  await expect(page.locator('.qa-answer')).toHaveCount(0);
});

test('uncertain response requires GET before manual retry and keeps answers on read failure', async ({ page }) => {
  const { state } = await fixture(page); await answer(page); state.fault = 'fail'; state.readFailure = true;
  const card = composerCard(page, 'Agent 提问');
  await card.getByRole('button', { name: '提交回答' }).click();
  await expect(card.getByRole('button', { name: '查询最新状态' })).toBeVisible();
  await card.getByRole('button', { name: '查询最新状态' }).click();
  await expect(card.getByText(/查询未完成，草稿已保留/)).toBeVisible();
  await expect(card.getByLabel('填写回答', { exact: true })).toHaveValue('中文输入内容');
  expect(state.posts).toHaveLength(1); state.readFailure = false;
  await card.getByRole('button', { name: '查询最新状态' }).click();
  await expect(card.getByRole('button', { name: '提交回答' })).toBeEnabled();
  expect(state.posts).toHaveLength(1); state.fault = '';
  await card.getByRole('button', { name: '提交回答' }).click();
  await expect(page.getByText('已回答', { exact: true })).toBeVisible(); expect(state.posts).toHaveLength(2);
});

test('uncertain confirmation must be queried before explicit retry and approval does not imply execution', async ({ page }) => {
  await page.addInitScript(() => { sessionStorage.setItem('berserk.drafts', JSON.stringify({ A: '下一条聊天草稿' })); });
  const item = confirmation();
  const { state } = await fixture(page, item);
  const card = page.getByRole('region', { name: '操作确认', exact: true });
  await expect(card.getByRole('button', { name: '允许本次执行', exact: true })).toBeEnabled();
  state.fault = 'fail'; state.readFailure = true;
  await card.getByRole('button', { name: '允许本次执行', exact: true }).click();
  await expect(card.getByRole('button', { name: '查询最新状态', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: '允许本次执行', exact: true })).toHaveCount(0);
  await card.getByRole('button', { name: '查询最新状态', exact: true }).click();
  await expect(card.getByRole('alert')).toContainText('查询未完成');
  await expect(card.getByLabel('完整命令', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: '允许本次执行', exact: true })).toHaveCount(0);
  expect(state.posts).toHaveLength(1);
  state.readFailure = false;
  const readsBeforeQuery = state.reads;
  await card.getByRole('button', { name: '查询最新状态', exact: true }).click();
  await expect(card.getByRole('button', { name: '允许本次执行', exact: true })).toBeEnabled();
  expect(state.reads).toBeGreaterThan(readsBeforeQuery); expect(state.posts).toHaveLength(1);
  state.fault = '';
  await card.getByRole('button', { name: '允许本次执行', exact: true }).click();
  const summary = page.getByRole('region', { name: '操作确认', exact: true }).locator('details.confirmation-history > summary');
  await expect(summary.getByText('已确认', { exact: true })).toBeVisible();
  await expect(summary.getByText('执行结果待确认。', { exact: true })).toBeVisible();
  await expect(page.getByText('执行已完成。', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveValue('下一条聊天草稿');
  expect(state.posts).toEqual(Array.from({ length: 2 }, () => ({ requestId: 'r1', kind: 'confirmation', decision: 'approve' })));
  expect(state.sends).toBe(0);
});

for (const fault of ['lost', 'conflict'] as const) test(`confirmation ${fault} reconciles first accepted decision without repost`, async ({ page }) => {
  const { state, a } = await fixture(page, confirmation()); state.fault = fault;
  await expect(page.getByLabel('完整命令', { exact: true })).toHaveText(confirmation().action.command!); state.readFailure = true;
  await page.getByRole('button', { name: '允许本次执行' }).click();
  await expect(page.getByRole('button', { name: '查询最新状态' })).toBeVisible();
  state.readFailure = false; await page.getByRole('button', { name: '查询最新状态' }).click();
  await expect(page.getByText(fault === 'lost' ? '已确认' : '已拒绝', { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(1);
  a.interactions = [confirmation()]; await page.waitForTimeout(2000);
  await expect(page.getByRole('button', { name: '允许本次执行' })).toHaveCount(0);
});

test('stop and expired history disable decisions; approved unknown results stay distinct', async ({ page }) => {
  const { state, a } = await fixture(page, confirmation());
  await page.getByRole('button', { name: '停止回复', exact: true }).click();
  await expect(page.getByText('已取消', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '允许本次执行' })).toHaveCount(0);
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
  await expect(page.getByRole('button', { name: '会话 A', exact: true }).getByRole('img', { name: '待回答' })).toBeVisible();
  await expect(page.getByRole('button', { name: '会话 A', exact: true })).toHaveText('会话 A');
  await expect(page.getByRole('button', { name: '会话 B', exact: true }).getByRole('img')).toHaveCount(0);
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
  await lastQuestionPage(page);
  await expect(composerCard(page, 'Agent 提问').getByLabel('填写回答', { exact: true })).toHaveValue('中文输入内容');
  await composerCard(page, 'Agent 提问').getByRole('button', { name: '提交回答' }).click();
  await expect(page.getByText('已回答', { exact: true })).toBeVisible();
  expect(state.posts[0]).toMatchObject({ answers: [{ questionId: 'constructor', optionIds: ['pdf'] }, { questionId: '__proto__', optionIds: ['body', 'appendix'] }, { questionId: 'toString', text: '中文输入内容' }] });
});


test('accepted stream failure and waiting refresh never restore the already sent message into the composer', async ({ page }) => {
  const { state } = await fixture(page, question(), true);
  state.streamFailure = true;
  const composer = page.getByRole('textbox', { name: '发送消息' });
  await composer.fill('已发送的报告要求');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const card = composerCard(page, 'Agent 提问');
  await expect(card).toBeVisible();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(composer).toHaveCount(0);
  await lastQuestionPage(page);
  await card.getByLabel('填写回答', { exact: true }).fill('问题回答草稿');
  await page.reload();
  await expect(page.getByRole('article', { name: '你的消息' })).toContainText('已发送的报告要求');
  await lastQuestionPage(page);
  await expect(composerCard(page, 'Agent 提问').getByLabel('填写回答', { exact: true })).toHaveValue('问题回答草稿');
  await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveCount(0);
  // Skipping frees the composer; the already sent text is not restored into it.
  await composerCard(page, 'Agent 提问').getByRole('button', { name: '跳过提问' }).click();
  await expect(composer).toHaveValue('');
  await composer.fill('真正的新聊天草稿');
  await page.reload();
  await expect(composer).toHaveValue('真正的新聊天草稿');
  expect(state.sends).toBe(1); expect(state.posts).toEqual([{ requestId: 'r1', kind: 'question', action: 'skip' }]);
});

for (const kind of ['confirmation', 'question'] as const) test(`${kind} cards align with reply content at desktop and narrow widths`, async ({ page }) => {
  const item = kind === 'confirmation' ? confirmation() : question();
  const { a, state } = await fixture(page, item);
  a.messages.unshift({ id: 'previous-reply', role: 'assistant', text: '请核对以下内容后继续。' });
  await page.reload();
  const card = page.locator('.message-list > .interaction-card');
  const reply = page.locator('.message-list > .assistant .message-content > p');
  for (const width of [1280, 800, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(card).toBeVisible();
    const cardBox = (await card.boundingBox())!;
    const replyBox = (await reply.boundingBox())!;
    expect(Math.abs(cardBox.x - replyBox.x)).toBeLessThan(1);
    expect(Math.abs(cardBox.width - replyBox.width)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (kind === 'confirmation') await page.screenshot({ path: test.info().outputPath(`aligned-confirmation-${width}.png`), fullPage: true });
  }
  if (kind === 'confirmation') {
    a.interactions = [{ ...confirmation(), status: 'approved', execution: 'succeeded' }];
    await page.reload();
    const history = card.locator('.confirmation-history');
    await expect(history).not.toHaveAttribute('open');
    await history.locator('summary').click();
    await expect(history).toHaveAttribute('open', '');
    expect(Math.abs((await card.boundingBox())!.x - (await reply.boundingBox())!.x)).toBeLessThan(1);
  }
  expect(state.posts).toHaveLength(0);
  expect(state.sends).toBe(0);
});


test('querying an unaccepted first card keeps its order and its answer draft', async ({ page }) => {
  const { a, state } = await fixture(page);
  a.interactions!.push({ ...question(), interactionId: 'i2', toolCallId: 't2', questions: [{ id: 'later', prompt: '第二张卡的问题' }] });
  await page.reload(); await answer(page);
  const card = composerCard(page, 'Agent 提问'); state.fault = 'fail';
  await card.getByRole('button', { name: '提交回答' }).click();
  await card.getByRole('button', { name: '查询最新状态' }).click();
  await expect(card.getByRole('button', { name: '提交回答' })).toBeEnabled();
  await expect(card.getByLabel('填写回答', { exact: true })).toHaveValue('中文输入内容');
  await expect(card).not.toContainText('第二张卡的问题');
  expect(state.posts).toHaveLength(1);
  state.fault = ''; await card.getByRole('button', { name: '提交回答' }).click();
  await expect(card).toContainText('第二张卡的问题');
  expect(state.posts).toHaveLength(2);
});

test('same-name confirmations without exact running identity keep a neutral execution state', async ({ page }) => {
  const { a } = await fixture(page, confirmation());
  a.interactions = [
    { ...confirmation(), status: 'approved' },
    { ...confirmation(), interactionId: 'i2', toolCallId: 't2', status: 'approved' },
  ];
  a.active = { requestId: 'r1', status: 'responding', phase: 'tool', toolName: 'bash' };
  await page.reload();
  await expect(page.locator('.confirmation-outcome')).toHaveCount(2);
  await expect(page.getByText('正在执行…', { exact: true })).toHaveCount(0);
  await expect(page.getByText('执行结果待确认。', { exact: true })).toHaveCount(2);
});

test('leaving a focused card for another session does not transfer focus into the new composer', async ({ page }) => {
  await fixture(page);
  await composerCard(page, 'Agent 提问').focus();
  await page.evaluate(() => { history.pushState(null, '', '/?session=B'); window.dispatchEvent(new PopStateEvent('popstate')); });
  const input = page.getByRole('textbox', { name: '发送消息', exact: true });
  await expect(input).toBeVisible();
  await expect(input).not.toBeFocused();
});


test('a card arriving after the user clicks outside the input does not steal reading focus', async ({ page }) => {
  await fixture(page, question(), true);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started = false;
  await page.route('**/api/sessions/A/messages', async route => { started = true; await gate; await route.fallback(); });
  const input = page.getByRole('textbox', { name: '发送消息', exact: true });
  await input.fill('请求处理文件'); await input.press('Enter');
  await expect.poll(() => started).toBe(true);
  await page.locator('.workspace-header').click({ position: { x: 200, y: 20 } });
  release();
  await expect(composerCard(page, 'Agent 提问')).toBeVisible();
  await expect(composerCard(page, 'Agent 提问')).not.toBeFocused();
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.composer-interaction')))).toBe(false);
});
