import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { test, expect, type Page } from '@playwright/test';
import type { SessionSnapshot, StreamEvent, InstructionFile, Workspace, ActivityOverview, ModelSettings, ModelSettingsUpdate } from '../../src/contracts/index';

const tableReply = `| 工作项 | 负责角色 | 交付内容 | 验收条件 |
| --- | --- | --- | --- |
| 信息梳理 | 信息席 | 汇总资料与来源 | 依据可回查 |
| 方案修订 | 分析席 | 按补充条件修订 | 保留最新约束 |`;

// This is an intentionally deterministic HTTP test double. It never calls an LLM
// and does not constitute the real Pi / provider evidence required by C01–C05.
async function mockApi(page: Page) {
  const sessions = new Map<string, SessionSnapshot>(['A', 'B', 'C', 'D'].map(id => [id, {
    id, workspaceId: ['A', 'B'].includes(id) ? 'w1' : 'w2', title: `会话 ${id}`, updatedAt: '2026-09-16T08:00:00Z', messages: [], active: null, lastResult: null,
  }]));
  const workspaces: Workspace[] = [{ id: 'w1', name: '默认工作区', createdAt: '2026-09-16' }, { id: 'w2', name: '另一工作区', createdAt: '2026-09-16' }];
  const instructions = new Map<string, InstructionFile>(workspaces.map(item => [item.id, { fileId: 'workspace', name: 'AGENTS.md', content: `${item.name}：使用中文回答`, hash: `hash-${item.id}-1`, editable: true }]));
  const common: InstructionFile = { fileId: 'common', name: '通用 AGENTS.md', content: '尊重事实，说明来源。', hash: 'common-hash', editable: false };
  const skills = [{ id: 'synthesis', name: '资料综合写作', description: '综合资料并注明来源', version: '1.0', hash: 'skill-hash' }];
  let modelSettings: ModelSettings = { provider: 'deepseek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', configured: true, source: 'environment', version: 'model-v1' };
  const modelFaults = { read: false, write: false, conflict: false, busy: false };
  const modelWrites: ModelSettingsUpdate[] = [];
  const faults = { create: false, holdSessionRead: false, releaseSessionRead: undefined as (() => void) | undefined, holdWorkspaceCreate: false, releaseWorkspaceCreate: undefined as (() => void) | undefined, activity: false, holdActivity: false, releaseActivity: undefined as (() => void) | undefined, reads: false, puts: false, sessionReads: false, holdRead: false, releaseRead: undefined as (() => void) | undefined, holdCreate: false, releaseCreate: undefined as (() => void) | undefined };
  const responses = new Map<string, ServerResponse>();
  const counts = { activityReads: 0, sessionReads: [] as string[], sends: 0, creates: 0, cancels: [] as string[], puts: [] as { workspaceId: string; content: string; expectedHash: string | null }[], instructionReads: 0, workspaces: 0 };
  const event = (id: string, data: StreamEvent) => responses.get(id)?.write(`data: ${JSON.stringify(data)}\n\n`);
  const finish = (id: string, status: 'succeeded' | 'cancelled' | 'failed' = 'succeeded') => {
    const session = sessions.get(id)!;
    const requestId = session.active!.requestId;
    session.active = null;
    session.lastResult = { requestId, status };
    session.updatedAt = new Date().toISOString();
    event(id, { type: status === 'succeeded' ? 'response.completed' : status === 'failed' ? 'response.failed' : 'response.cancelled', sessionId: id, requestId, snapshot: session });
    event(id, { type: 'text.delta', sessionId: id, requestId, delta: '终态之后的迟到内容不得展示' });
    responses.get(id)?.end();
    responses.delete(id);
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    const path = url.pathname;
    if (request.method === 'OPTIONS') { response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); response.end(); return; }
    const json = (value: unknown, status = 200) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      response.end(JSON.stringify(value));
    };
    if (path === '/api/info') return json({ model: modelSettings.model, configured: modelSettings.configured, sources: [
      { id: 'brief', title: '项目讨论纪要', description: '目标、约束与待明确事项' },
      { id: 'plan', title: '协作方案参考', description: '方案结构与编制要点' },
    ], limits: { timeoutMs: 60000, maxToolCalls: 4, maxOutputTokens: 4096 } });
    let body = '';
    if (request.method !== 'GET') for await (const chunk of request) body += chunk;
    if (path === '/api/settings/model') {
      if (request.method === 'GET') return modelFaults.read ? json({ error: { code: 'SERVER_ERROR', message: '暂时无法读取模型配置' } }, 503) : json(modelSettings);
      const update = JSON.parse(body) as ModelSettingsUpdate;
      modelWrites.push(update);
      if (modelFaults.write) return json({ error: { code: 'MODEL_SETTINGS_SAVE_FAILED', message: '模型配置保存失败' } }, 503);
      if (modelFaults.busy) return json({ error: { code: 'MODEL_SETTINGS_BUSY', message: '仍有会话正在回复，请结束后再保存。' } }, 409);
      if (modelFaults.conflict || update.expectedVersion !== modelSettings.version) return json({ error: { code: 'MODEL_SETTINGS_CONFLICT', message: '模型配置已被更新，请读取最新配置后再保存。' } }, 409);
      if ((update.provider !== modelSettings.provider || update.baseUrl !== modelSettings.baseUrl) && !update.apiKey?.trim()) return json({ error: { code: 'MODEL_API_KEY_REQUIRED', message: '更换提供方或端点时，请输入新的 API Key。' } }, 400);
      modelSettings = { provider: update.provider, model: update.model, baseUrl: update.baseUrl, configured: Boolean(update.apiKey?.trim()) || modelSettings.configured, version: `model-v${modelWrites.length + 1}`, source: 'local' };
      return json(modelSettings);
    }
    const input = JSON.parse(body || '{}') as { text?: string; requestId?: string; workspaceId?: string; name?: string; content?: string; expectedHash?: string | null };
    if (path === '/api/activity') {
      counts.activityReads++;
      if (faults.activity) return json({ error: { code: 'SERVER_ERROR', message: '动态暂时不可用' } }, 503);
      const overview: ActivityOverview = { defaultWorkspaceId: 'w1', workspaces, sessions: [...sessions.values()].map(({ id, workspaceId, title, updatedAt, active, lastResult, recoveryWarning }) => ({
        id, workspaceId, title, updatedAt, active, lastResult: lastResult ? { requestId: lastResult.requestId, status: lastResult.status } : null, recoveryWarning, statusUpdatedAt: updatedAt,
      })) };
      if (faults.holdActivity) { faults.holdActivity = false; const captured = JSON.parse(JSON.stringify(overview)) as ActivityOverview; faults.releaseActivity = () => json(captured); return; }
      return json(overview);
    }
    if (path === '/api/workspaces' && request.method === 'GET') return json({ defaultWorkspaceId: 'w1', workspaces });
    if (path === '/api/workspaces' && request.method === 'POST') {
      const workspace = { id: `w${workspaces.length + 1}`, name: input.name!, createdAt: new Date().toISOString() };
      workspaces.push(workspace); counts.workspaces++;
      instructions.set(workspace.id, { ...common, fileId: 'workspace', content: '', hash: `empty-${workspace.id}`, editable: true });
      if (faults.holdWorkspaceCreate) { faults.holdWorkspaceCreate = false; faults.releaseWorkspaceCreate = () => json(workspace, 201); return; }
      return json(workspace, 201);
    }
    if (path.startsWith('/api/workspaces/')) {
      const workspaceId = path.split('/')[3];
      if (path.endsWith('/resources')) return json({ workspaceId, instructions: [common, instructions.get(workspaceId)], sources: [{ id: 'brief', title: '项目讨论纪要', description: `${workspaceId} 的资料`, hash: 'source-hash' }], skills });
      if (path.includes('/skills/')) return json({ ...skills[0], content: '综合多个来源，区分事实和建议。' });
      if (request.method === 'GET') {
        if (path.endsWith('/common')) return json(common);
        counts.instructionReads++;
        if (faults.reads) return json({ error: { code: 'RESOURCE_LOAD_FAILED', message: '指令暂时无法读取' } }, 503);
        const captured = { ...instructions.get(workspaceId)! };
        if (faults.holdRead) { faults.holdRead = false; faults.releaseRead = () => json(captured); return; }
        return json(captured);
      }
      counts.puts.push({ workspaceId, content: input.content!, expectedHash: input.expectedHash! });
      if (faults.puts) return json({ error: { code: 'RESOURCE_LOAD_FAILED', message: '保存失败' } }, 503);
      const current = instructions.get(workspaceId)!;
      if (current.content !== input.content && current.hash !== input.expectedHash) return json({ error: { code: 'INSTRUCTION_CONFLICT', message: '版本冲突' } }, 409);
      const hash = `hash-${workspaceId}-${counts.puts.length + 1}`;
      instructions.set(workspaceId, { ...current, content: input.content!, hash });
      return json({ fileId: 'workspace', status: current.content === input.content ? 'unchanged' : 'updated', previousHash: current.hash, hash, effectiveFrom: 'next_request' });
    }
    if (path === '/api/sessions' && request.method === 'GET') return json([...sessions.values()].filter(item => item.workspaceId === (url.searchParams.get('workspaceId') || 'w1')));
    if (path === '/api/sessions' && request.method === 'POST') {
      if (faults.create) return json({ error: { code: 'SERVER_ERROR', message: '会话创建失败' } }, 503);
      const id = `new-${++counts.creates}`;
      const session: SessionSnapshot = { id, workspaceId: input.workspaceId || 'w1', title: '新对话', updatedAt: new Date().toISOString(), messages: [], active: null, lastResult: null };
      sessions.set(id, session);
      if (faults.holdCreate) { faults.holdCreate = false; faults.releaseCreate = () => json(session); return; }
      return json(session);
    }
    const id = path.split('/')[3];
    const session = sessions.get(id)!;
    if (path.endsWith('/resources')) return json({ status: 'available', workspaceId: session.workspaceId, requestId: path.split('/')[5], instructions: [common, { ...instructions.get(session.workspaceId)!, content: '本轮发送时的指令' }], skills, readSkills: [{ ...skills[0], content: '本轮读取的方法正文' }], editableFileIds: ['workspace'] });
    if (request.method === 'GET') { counts.sessionReads.push(id); if (faults.holdSessionRead) { const captured = JSON.parse(JSON.stringify(session)) as SessionSnapshot; faults.releaseSessionRead = () => json(captured); return; } return faults.sessionReads ? json({ error: { code: 'SERVER_ERROR', message: '会话查询暂时失败' } }, 503) : json(session); }
    if (path.endsWith('/cancel')) {
      counts.cancels.push(input.requestId!);
      session.active!.status = 'stopping';
      return json(session);
    }
    const requestId = `request-${++counts.sends}`;
    if (input.text === '模拟错误') return json({ error: { code: 'PROVIDER_ERROR', message: '模型服务暂时不可用' } }, 503);
    if (input.text === '准备阶段失败' || input.text === '准备阶段取消' || input.text === '首个模型调用失败') {
      if (input.text === '首个模型调用失败') session.messages.push({ id: `user-${requestId}`, role: 'user', requestId, text: input.text });
      session.active = null;
      const status = input.text === '准备阶段取消' ? 'cancelled' : 'failed';
      session.lastResult = { requestId, status, message: '本次回复未完成，请核对资源。' };
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' });
      responses.set(id, response);
      event(id, { type: 'response.started', sessionId: id, requestId });
      event(id, { type: status === 'cancelled' ? 'response.cancelled' : 'response.failed', sessionId: id, requestId, snapshot: session });
      response.end(); responses.delete(id); return;
    }
    const reply = input.text === '生成表格' ? tableReply : `${id} 的回复`;
    session.messages.push({ id: `user-${requestId}`, role: 'user', requestId, text: input.text! });
    session.messages.push({ id: `assistant-${requestId}`, role: 'assistant', requestId, text: reply });
    session.active = { requestId, status: 'responding' };
    session.lastResult = null;
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    responses.set(id, response);
    event(id, { type: 'response.started', sessionId: id, requestId });
    event(id, { type: 'text.delta', sessionId: id, requestId: 'old-request', delta: '其他请求的迟到消息' });
    event(id, { type: 'text.delta', sessionId: 'other-session', requestId, delta: '其他会话的迟到消息' });
    event(id, { type: 'text.delta', sessionId: id, requestId, delta: reply });
    if (input.text === '读取资料') {
      event(id, { type: 'tool.started', sessionId: id, requestId, toolCallId: 'tool-1', toolName: 'source.read' });
      event(id, { type: 'tool.completed', sessionId: id, requestId, toolCallId: 'tool-1', toolName: 'source.read', text: '来源：项目讨论纪要\n固定资料正文。', isError: false });
      session.messages.push({ id: 'tool-1', role: 'tool', toolName: 'source.read', text: '来源：项目讨论纪要\n固定资料正文。' });
    }
    if (input.text === '记住引用来源') {
      const previous = instructions.get(session.workspaceId)!;
      const change = { fileId: 'workspace' as const, status: 'updated' as const, previousHash: previous.hash, hash: 'agent-hash', effectiveFrom: 'next_request' as const };
      instructions.set(session.workspaceId, { ...previous, content: `${previous.content}\n引用资料时注明来源`, hash: change.hash });
      event(id, { type: 'instructions.updated', sessionId: id, requestId, change });
    }
    if (input.text !== '慢速回复') finish(id);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  await page.route('**/api/**', route => route.continue({ url: `http://127.0.0.1:${address.port}${new URL(route.request().url()).pathname}${new URL(route.request().url()).search}` }));
  return { sessions, workspaces, instructions, faults, counts, finish, modelFaults, modelWrites, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
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
    await expect(page.getByText('其他请求的迟到消息')).toHaveCount(0);
    await expect(page.getByText('其他会话的迟到消息')).toHaveCount(0);
    await page.getByRole('button', { name: '新建对话', exact: true }).click();
    await page.getByRole('button', { name: '创建对话', exact: true }).click();
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
    await input.fill('模拟错误');
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
    await input.press('Enter');
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

test('工作区隔离运行中的流、会话历史、选择与草稿，新建工作区可发送', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.goto('/');
    const input = page.getByRole('textbox', { name: '发送消息' });
    await input.fill('慢速回复'); await input.press('Enter');
    await expect(page.getByText('A 的回复', { exact: true })).toBeVisible();
    await input.fill('A 下轮草稿');
    await page.getByRole('button', { name: '进入项目：另一工作区', exact: true }).click();
    await expect(page.getByRole('button', { name: '会话 A', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '会话 C', exact: true })).toBeVisible();
    await expect(input).toHaveValue('');
    await input.fill('C 的消息'); await input.press('Enter');
    await expect(page.getByText('C 的回复', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '会话 D', exact: true }).click();
    await expect(page.getByText('C 的回复', { exact: true })).toHaveCount(0);
    await input.fill('D 的草稿');
    mock.finish('A');
    await page.getByRole('button', { name: '进入项目：默认工作区', exact: true }).click();
    await expect(input).toHaveValue('A 下轮草稿');
    await expect(page.getByText('A 的回复', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '停止回复' })).toHaveCount(0);
    await page.getByRole('button', { name: '进入项目：另一工作区', exact: true }).click();
    await expect(input).toHaveValue('D 的草稿');
    await page.reload();
    await expect(page.locator('.workspace-header .workspace-name')).toHaveText('另一工作区');
    await expect(input).toHaveValue('D 的草稿');
    expect(mock.counts.cancels).toHaveLength(0);
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await page.getByLabel('项目名称').fill('新方案');
    await page.getByRole('button', { name: '创建项目', exact: true }).click();
    await expect(page.locator('.workspace-header .workspace-name')).toHaveText('新方案');
    await expect(page.getByRole('heading', { name: '今天，我们一起处理什么？' })).toBeVisible();
    await input.fill('新方案的消息'); await input.press('Enter');
    await expect(page.getByText('new-1 的回复', { exact: true })).toBeVisible();
    expect(mock.sessions.get('new-1')?.workspaceId).toBe('w3');
    await page.reload();
    await expect(page.locator('.workspace-header .workspace-name')).toHaveText('新方案');
    expect(mock.counts.workspaces).toBe(1);
    expect(mock.counts.sends).toBe(3);
  } finally { await mock.close(); }
});

test('Agent 更新期间保留草稿，冲突可查看、人工合并，再次冲突仍校验版本', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.goto('/');
    const open = page.getByRole('button', { name: '项目资料', exact: true });
    await open.click();
    const draft = page.getByLabel(/^你的草稿/);
    await expect(draft).toHaveValue('默认工作区：使用中文回答');
    await draft.fill('使用中文回答\n先给结论');
    await page.getByRole('button', { name: '关闭面板' }).click();
    await expect(open).toBeFocused();
    await page.getByRole('textbox', { name: '发送消息' }).fill('记住引用来源');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(page.getByText('项目指令已保存，下次发送时生效。', { exact: true })).toBeVisible();
    await open.click();
    await expect(draft).toHaveValue('使用中文回答\n先给结论');
    await page.getByRole('button', { name: '保存指令', exact: true }).click();
    await expect(page.getByText('项目指令已更新，本次保存未完成，你的修改已保留。')).toBeVisible();
    await expect(page.getByRole('button', { name: '合并后保存' })).toBeDisabled();
    await page.getByRole('button', { name: '查看最新内容' }).click();
    const latest = page.getByLabel('最新内容（只读）');
    await expect(latest).toContainText('引用资料时注明来源');
    await expect(draft).toHaveValue('使用中文回答\n先给结论');
    expect(mock.counts.puts).toHaveLength(1);
    mock.faults.reads = true;
    await page.getByRole('button', { name: '查看最新内容' }).click();
    await expect(page.getByText('指令暂时无法读取')).toBeVisible();
    await expect(latest).toContainText('引用资料时注明来源');
    await expect(draft).toHaveValue('使用中文回答\n先给结论');
    mock.faults.reads = false;
    await draft.fill('使用中文回答\n先给结论\n引用资料时注明来源');
    const concurrent = { ...mock.instructions.get('w1')!, content: '再次新增约定', hash: 'second-editor' };
    mock.instructions.set('w1', concurrent);
    await page.getByRole('button', { name: '合并后保存' }).click();
    await expect(page.getByRole('button', { name: '合并后保存' })).toBeDisabled();
    await expect(draft).toHaveValue('使用中文回答\n先给结论\n引用资料时注明来源');
    expect(mock.counts.puts[1]?.expectedHash).toBe('agent-hash');
    await page.getByRole('button', { name: '查看最新内容' }).click();
    await expect(latest).toHaveText('再次新增约定');
    await draft.fill('使用中文回答\n先给结论\n引用资料时注明来源\n再次新增约定');
    await page.getByRole('button', { name: '合并后保存' }).click();
    await expect(page.getByText('已保存，下次发送时生效。', { exact: true })).toBeVisible();
    expect(mock.counts.puts[2]?.expectedHash).toBe('second-editor');
    expect(mock.instructions.get('w1')?.content).toContain('再次新增约定');
    expect(mock.counts.puts).toHaveLength(3);
  } finally { await mock.close(); }
});

test('查看、放弃与刷新不写文件，失败和工作区旧响应不覆盖草稿', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.goto('/');
    const open = page.getByRole('button', { name: '项目资料', exact: true });
    const draft = page.getByLabel(/^你的草稿/);
    await open.click();
    await expect(draft).toBeVisible();
    await draft.fill('我的未保存草稿');
    mock.faults.holdRead = true;
    await page.getByRole('button', { name: '查看最新内容' }).click();
    await expect.poll(() => Boolean(mock.faults.releaseRead)).toBe(true);
    await page.getByRole('button', { name: '关闭面板' }).click();
    await page.getByRole('button', { name: '进入项目：另一工作区', exact: true }).click();
    await open.click();
    await expect(draft).toHaveValue('另一工作区：使用中文回答');
    await draft.fill('另一工作区的草稿');
    mock.faults.releaseRead!();
    await expect(draft).toHaveValue('另一工作区的草稿');
    await page.getByRole('button', { name: '关闭面板' }).click();
    await page.getByRole('button', { name: '进入项目：默认工作区', exact: true }).click();
    await open.click();
    await expect(draft).toHaveValue('我的未保存草稿');
    await page.getByRole('button', { name: '查看最新内容' }).click();
    await expect(page.getByLabel('最新内容（只读）')).toHaveText('默认工作区：使用中文回答');
    await page.getByRole('button', { name: '放弃草稿，使用最新内容' }).click();
    await expect(draft).toHaveValue('默认工作区：使用中文回答');
    expect(mock.counts.puts).toHaveLength(0);
    await draft.fill('刷新仍保留');
    await page.reload();
    await open.click();
    await expect(draft).toHaveValue('刷新仍保留');
    expect(mock.counts.puts).toHaveLength(0);
    mock.faults.puts = true;
    await page.getByRole('button', { name: '保存指令', exact: true }).click();
    await expect(page.getByText('保存结果尚未确认，你的修改已保留。请查看最新内容核对后再操作。')).toBeVisible();
    await expect(draft).toHaveValue('刷新仍保留');
    await expect(page.getByRole('button', { name: '合并后保存' })).toBeDisabled();
    mock.faults.reads = true;
    await page.getByRole('button', { name: '查看最新内容' }).click();
    await expect(page.getByText('指令暂时无法读取')).toBeVisible();
    await expect(page.getByRole('button', { name: '合并后保存' })).toBeDisabled();
    mock.faults.reads = false; mock.faults.puts = false;
    await page.getByRole('button', { name: '重试读取指令' }).click();
    await expect(page.getByRole('button', { name: '合并后保存' })).toBeEnabled();
    expect(mock.counts.puts).toHaveLength(1);
    await page.getByRole('button', { name: '放弃草稿，使用最新内容' }).click();
    expect(mock.counts.puts).toHaveLength(1);
  } finally { await mock.close(); }
});

test('窄屏指令对照、键盘保存、IME 与只读 Skill 和请求记录', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.goto('/');
    await page.getByRole('textbox', { name: '发送消息' }).fill('读取资料');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.getByRole('button', { name: '查看本轮资料' }).click();
    await expect(page.getByText('本轮发送时的指令', { exact: true })).toBeVisible();
    await page.getByText('资料综合写作 · 1.0', { exact: true }).click();
    await expect(page.getByText('本轮读取的方法正文', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole('button', { name: '打开会话列表' }).click();
    const open = page.getByRole('button', { name: '项目资料', exact: true });
    await open.click();
    const draft = page.getByLabel(/^你的草稿/);
    await expect(draft).toBeVisible();
    await expect(page.getByText('尊重事实，说明来源。', { exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: /资料综合写作/ }).click();
    await expect(page.getByText('综合多个来源，区分事实和建议。', { exact: true })).toBeVisible();
    await draft.fill('键盘保存约定');
    await draft.dispatchEvent('compositionstart');
    await draft.press('Control+s');
    expect(mock.counts.puts).toHaveLength(0);
    await draft.dispatchEvent('compositionend');
    await draft.press('Control+s');
    await expect(page.getByText('已保存，下次发送时生效。', { exact: true })).toBeVisible();
    expect(mock.instructions.get('w1')?.content).toBe('键盘保存约定');
    await draft.fill('窄屏草稿');
    await page.getByRole('button', { name: '查看最新内容' }).click();
    await expect(page.getByLabel('最新内容（只读）')).toHaveText('键盘保存约定');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
    await page.keyboard.press('Escape');
    await expect(open).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '打开会话列表' })).toBeFocused();
    expect(mock.counts.puts).toHaveLength(1);
  } finally { await mock.close(); }
});

test('指令初次读取失败可恢复，存储不可用仍能编辑并清空保存', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('storage unavailable'); }; });
    mock.faults.reads = true;
    await page.goto('/');
    await page.getByRole('button', { name: '项目资料', exact: true }).click();
    await expect(page.getByText('指令暂时无法读取')).toBeVisible();
    await expect(page.getByRole('button', { name: '保存指令', exact: true })).toHaveCount(0);
    mock.faults.reads = false;
    await page.getByRole('button', { name: '重试读取指令' }).click();
    const draft = page.getByLabel(/^你的草稿/);
    await expect(draft).toHaveValue('默认工作区：使用中文回答');
    await draft.fill('只存在内存中的编辑');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '项目资料', exact: true }).click();
    await expect(draft).toHaveValue('只存在内存中的编辑');
    await page.getByRole('button', { name: '清空草稿' }).click();
    await expect(draft).toHaveValue('');
    expect(mock.counts.puts).toHaveLength(0);
    await page.getByRole('button', { name: '保存指令', exact: true }).click();
    await expect(page.getByText('已保存，下次发送时生效。', { exact: true })).toBeVisible();
    expect(mock.instructions.get('w1')?.content).toBe('');
    expect(mock.counts.puts).toHaveLength(1);
  } finally { await mock.close(); }
});

test('首条消息创建会话等待期间切区，新输入和请求仍归原工作区', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await page.getByLabel('项目名称').fill('等待创建');
    await page.getByRole('button', { name: '创建项目', exact: true }).click();
    await expect(page.locator('.workspace-header .workspace-name')).toHaveText('等待创建');
    const input = page.getByRole('textbox', { name: '发送消息' });
    mock.faults.holdCreate = true;
    await input.fill('原始提交'); await input.press('Enter');
    await expect.poll(() => Boolean(mock.faults.releaseCreate)).toBe(true);
    await input.fill('创建期间的新草稿');
    await page.getByRole('button', { name: '进入项目：默认工作区', exact: true }).click();
    await expect(input).toHaveValue('');
    await input.fill('默认区独立草稿');
    mock.faults.releaseCreate!();
    await expect.poll(() => mock.counts.sends).toBe(1);
    await expect(input).toHaveValue('默认区独立草稿');
    await expect(page.getByText('new-1 的回复', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '进入项目：等待创建', exact: true }).click();
    await expect(input).toHaveValue('创建期间的新草稿');
    await expect(page.getByText('new-1 的回复', { exact: true })).toBeVisible();
    expect(mock.sessions.get('new-1')?.messages[0].text).toBe('原始提交');
    expect(mock.sessions.get('new-1')?.workspaceId).toBe('w3');
  } finally { await mock.close(); }
});

test('没有助手回复的失败请求可查看资料，准备失败恢复草稿且刷新不重发', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.goto('/');
    const input = page.getByRole('textbox', { name: '发送消息' });
    await input.fill('准备阶段失败'); await input.press('Enter');
    await expect(input).toHaveValue('准备阶段失败');
    await page.getByRole('button', { name: '查看本轮资料' }).click();
    await expect(page.getByText('本轮发送时的指令', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(input).toHaveValue('准备阶段失败');
    await expect(page.getByRole('button', { name: '查看本轮资料' })).toHaveCount(1);
    expect(mock.counts.sends).toBe(1);
    mock.faults.sessionReads = true;
    await input.fill('准备阶段取消'); await input.press('Enter');
    await expect(input).toHaveValue('准备阶段取消');
    await expect(page.getByText('会话查询暂时失败', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
    mock.faults.sessionReads = false;
    await input.fill('首个模型调用失败'); await input.press('Enter');
    await expect(input).toHaveValue('首个模型调用失败');
    await expect(page.getByRole('article', { name: '你的消息' }).getByRole('button', { name: '查看本轮资料' })).toHaveCount(1);
    await input.fill('后续请求'); await input.press('Enter');
    await expect(page.getByText('A 的回复', { exact: true })).toBeVisible();
    await page.getByRole('article', { name: '你的消息' }).getByRole('button', { name: '查看本轮资料' }).click();
    await expect(page.getByText('本轮发送时的指令', { exact: true })).toBeVisible();
    expect(mock.counts.sends).toBe(4);
  } finally { await mock.close(); }
});

test('分组侧栏与全部动态持续汇总未打开会话，未读回复用蓝点显示并在阅读后清除', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    const c = mock.sessions.get('C')!;
    c.active = { requestId: 'external-c', status: 'responding', phase: 'tool', toolName: 'source.read' };
    mock.sessions.get('D')!.lastResult = { requestId: 'failed-d', status: 'failed' };
    await page.goto('/');
    const group = page.getByRole('region', { name: '另一工作区', exact: true });
    await expect(group.getByRole('button', { name: '会话 C', exact: true })).toContainText('读取资料');
    await expect(page.locator('#activity-counts')).toHaveText('1 个处理中 · 0 个新回复 · 1 个异常');
    expect(mock.counts.sessionReads).not.toContain('C');
    expect(mock.counts.sessionReads).not.toContain('D');
    const originalOrder = await page.locator('.workspace-groups .session-item').allTextContents();
    await page.getByRole('button', { name: '折叠项目：另一工作区' }).click();
    await expect(group.getByLabel('1 个处理中', { exact: true })).toBeVisible();
    await expect(group.getByRole('button', { name: '会话 C', exact: true })).toBeHidden();
    await page.getByRole('button', { name: '全部动态', exact: true }).click();
    const overview = page.locator('.activity-overview');
    await overview.getByRole('button', { name: '处理中', exact: true }).click();
    await expect(overview.getByRole('button', { name: /^打开会话：/ })).toHaveCount(1);
    await expect(overview.getByRole('button', { name: '打开会话：会话 C' })).toContainText('另一工作区');
    c.messages.push({ id: 'external-answer', role: 'assistant', requestId: 'external-c', text: '来自后台的 C 回复' });
    mock.finish('C');
    await expect(overview.getByText('目前没有正在处理的会话。')).toBeVisible();
    await overview.getByRole('button', { name: '需关注', exact: true }).click();
    await expect(overview.getByRole('button', { name: /^打开会话：/ })).toHaveCount(2);
    await expect(overview.getByRole('button', { name: '打开会话：会话 C' }).getByRole('img', { name: '有新回复未读' })).toBeVisible();
    await expect(overview).not.toContainText('本轮完成');
    await page.reload();
    await page.getByRole('button', { name: '全部动态', exact: true }).click();
    await overview.getByRole('button', { name: '需关注', exact: true }).click();
    await expect(overview.getByRole('button', { name: '打开会话：会话 C' }).getByRole('img', { name: '有新回复未读' })).toBeVisible();
    await overview.getByRole('button', { name: '打开会话：会话 C' }).click();
    await expect(page.getByText('来自后台的 C 回复', { exact: true })).toBeVisible();
    await expect(page.locator('#activity-counts')).toHaveText('0 个处理中 · 0 个新回复 · 1 个异常');
    await page.reload();
    await expect(page.locator('#activity-counts')).toHaveText('0 个处理中 · 0 个新回复 · 1 个异常');
    const finalOrder = await page.locator('.workspace-groups .session-item').allTextContents();
    expect(originalOrder.map(text => text.slice(0, 4))).toEqual(finalOrder.map(text => text.slice(0, 4)));
    expect(mock.counts.sends).toBe(0);
    expect(mock.counts.cancels).toEqual([]);
  } finally { await mock.close(); }
});

test('旧动态请求不覆盖新流状态，更新失败保留状态并可恢复', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.goto('/');
    const input = page.getByRole('textbox', { name: '发送消息' });
    await expect(input).toBeVisible();
    mock.faults.holdActivity = true;
    await expect.poll(() => Boolean(mock.faults.releaseActivity)).toBe(true);
    await input.fill('慢速回复'); await input.press('Enter');
    await expect(page.getByText('A 的回复', { exact: true })).toBeVisible();
    mock.faults.releaseActivity!();
    await expect(page.locator('#activity-counts')).toContainText('1 个处理中');
    mock.faults.activity = true;
    await expect(page.getByText(/动态更新失败，显示的是上次获取的状态/)).toBeVisible();
    await expect(page.locator('#activity-counts')).toContainText('1 个处理中');
    await input.fill('保留草稿');
    mock.faults.activity = false;
    await expect(page.getByText(/动态更新失败，显示的是上次获取的状态/)).toHaveCount(0);
    mock.finish('A');
    await expect(page.getByRole('button', { name: '停止回复' })).toHaveCount(0);
    await expect(input).toHaveValue('保留草稿');
    expect(mock.counts.sends).toBe(1);
  } finally { await mock.close(); }
});

test('切换会话和全部动态保留阅读位置，阅读旧内容不误标新回复已读', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    const a = mock.sessions.get('A')!;
    a.messages = Array.from({ length: 30 }, (_, index) => ({ id: `history-${index}`, role: 'assistant' as const, text: `历史段落 ${index}\n\n${'需要继续阅读的内容。'.repeat(12)}` }));
    await page.goto('/');
    const conversation = page.getByLabel('对话内容', { exact: true });
    await expect(page.getByText(/^历史段落 0/)).toBeVisible();
    await conversation.evaluate(element => { element.scrollTop = 120; element.dispatchEvent(new Event('scroll')); });
    await page.getByRole('textbox', { name: '发送消息' }).fill('A 阅读草稿');
    await page.getByRole('button', { name: '会话 C', exact: true }).click();
    await page.getByRole('button', { name: '会话 A', exact: true }).click();
    await expect.poll(() => conversation.evaluate(element => element.scrollTop)).toBeCloseTo(120, 0);
    await page.getByRole('button', { name: '全部动态', exact: true }).click();
    await page.getByRole('button', { name: '打开会话：会话 A', exact: true }).click();
    await expect.poll(() => conversation.evaluate(element => element.scrollTop)).toBeCloseTo(120, 0);
    await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveValue('A 阅读草稿');
    a.messages.push({ id: 'new-answer', role: 'assistant', requestId: 'new-a', text: '新的最后一条回复' });
    a.lastResult = { requestId: 'new-a', status: 'succeeded' }; a.updatedAt = new Date().toISOString();
    await expect(page.locator('#activity-counts')).toContainText('1 个新回复');
    await expect.poll(() => conversation.evaluate(element => element.scrollTop)).toBeCloseTo(120, 0);
    await expect(page.getByText('新的最后一条回复', { exact: true })).toHaveCount(1);
    await conversation.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
    await expect(page.locator('#activity-counts')).toContainText('0 个新回复');
    expect(mock.counts.sends).toBe(0);
  } finally { await mock.close(); }
});

test('窄屏可从全部动态进入其他工作区，会话列表折叠可用且页面不溢出', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    mock.sessions.get('C')!.active = { requestId: 'background', status: 'responding', phase: 'generating' };
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.getByRole('button', { name: '打开会话列表' }).click();
    await page.getByRole('button', { name: '全部动态', exact: true }).click();
    await page.locator('.activity-overview').getByRole('button', { name: '处理中', exact: true }).click();
    await expect(page.getByRole('button', { name: '打开会话：会话 C' })).toContainText('生成回复');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.getByRole('button', { name: '打开会话：会话 C' }).click();
    await expect(page.locator('.workspace-name')).toHaveText('另一工作区');
    await expect(page.getByRole('button', { name: '停止回复' })).toBeVisible();
    await page.getByRole('button', { name: '打开会话列表' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '打开会话列表' })).toBeFocused();
    expect(mock.counts.sends).toBe(0);
  } finally { await mock.close(); }
});

test('动态先发现新工作区，创建响应随后返回时只保留一个分组', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await page.getByLabel('项目名称').fill('并发创建区');
    mock.faults.holdWorkspaceCreate = true;
    await page.getByRole('button', { name: '创建项目', exact: true }).click();
    await expect.poll(() => Boolean(mock.faults.releaseWorkspaceCreate)).toBe(true);
    await expect(page.locator('.workspace-group[aria-label="并发创建区"]')).toHaveCount(1);
    mock.faults.releaseWorkspaceCreate!();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.workspace-name')).toHaveText('并发创建区');
    await expect(page.locator('.workspace-group[aria-label="并发创建区"]')).toHaveCount(1);
    await expect(page.locator('.workspace-group')).toHaveCount(3);
    expect(mock.counts.workspaces).toBe(1);
    expect(mock.counts.sends).toBe(0);
  } finally { await mock.close(); }
});

test('刷新后摘要先于正文到达，停止按钮等待同一请求的正文快照就绪', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    const a = mock.sessions.get('A')!;
    a.active = { requestId: 'background-active', status: 'responding', phase: 'generating' };
    mock.faults.holdSessionRead = true;
    await page.goto('/');
    await expect.poll(() => Boolean(mock.faults.releaseSessionRead)).toBe(true);
    await expect(page.locator('#activity-counts')).toContainText('1 个处理中');
    await expect(page.getByRole('button', { name: '停止回复', exact: true })).toBeDisabled();
    await expect(page.getByText('正在读取会话…', { exact: true })).toBeVisible();
    mock.faults.holdSessionRead = false; mock.faults.releaseSessionRead!();
    await expect(page.getByRole('button', { name: '停止回复', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '停止回复', exact: true }).click();
    await expect.poll(() => mock.counts.cancels).toEqual(['background-active']);
    mock.finish('A', 'cancelled');
    await page.getByRole('textbox', { name: '发送消息' }).fill('可以继续');
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
    expect(mock.counts.sends).toBe(0);
  } finally { await mock.close(); }
});

test('新建对话先选项目，取消不创建，折叠项目加号直接创建且不抢回后续导航', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.goto('/');
    const newChat = page.getByRole('button', { name: '新建对话', exact: true });
    await newChat.click();
    await expect(page.getByLabel('选择项目')).toHaveValue('w1');
    expect(mock.counts.creates).toBe(0);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(newChat).toBeFocused();
    expect(mock.counts.creates).toBe(0);
    await newChat.click();
    await page.getByLabel('选择项目').selectOption('w2');
    await page.getByRole('button', { name: '创建对话', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.workspace-header .workspace-name')).toHaveText('另一工作区');
    expect(mock.sessions.get('new-1')?.workspaceId).toBe('w2');
    await page.getByRole('button', { name: '折叠项目：默认工作区' }).click();
    await page.getByRole('button', { name: '在项目 默认工作区 中新建对话', exact: true }).click();
    await expect(page.locator('.workspace-header .workspace-name')).toHaveText('默认工作区');
    expect(mock.sessions.get('new-2')?.workspaceId).toBe('w1');
    expect(mock.counts.creates).toBe(2);
    await page.getByRole('textbox', { name: '发送消息' }).fill('保留在默认项目的草稿');
    mock.faults.holdCreate = true;
    await page.getByRole('button', { name: '在项目 另一工作区 中新建对话', exact: true }).click();
    await expect.poll(() => Boolean(mock.faults.releaseCreate)).toBe(true);
    await page.getByRole('button', { name: '会话 D', exact: true }).click();
    await page.getByRole('textbox', { name: '发送消息' }).fill('D 的独立草稿');
    mock.faults.releaseCreate!();
    await expect(page.getByRole('button', { name: '在项目 另一工作区 中新建对话', exact: true })).toBeEnabled();
    await expect(page.locator('.header-title')).toHaveText('会话 D');
    await expect(page.getByRole('textbox', { name: '发送消息' })).toHaveValue('D 的独立草稿');
    expect(mock.sessions.get('new-3')?.workspaceId).toBe('w2');
    expect(mock.counts.creates).toBe(3);
    expect(mock.counts.sends).toBe(0);
  } finally { await mock.close(); }
});

test('模型设置保存后更新模型，密钥只写且关闭后清空，手机窗口不溢出', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: '设置', exact: true });
    await trigger.click();
    const modal = page.getByRole('dialog', { name: '设置', exact: true });
    const key = page.locator('#model-key');
    await expect(page.getByLabel('模型 ID')).toHaveValue('deepseek-flash');
    await expect(key).toHaveValue('');
    await expect(key).toHaveAttribute('type', 'password');
    await page.getByLabel('模型 ID').fill('deepseek-test');
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(modal.getByText('已保存，下次发送消息时使用新配置。')).toBeVisible();
    expect(mock.modelWrites).toHaveLength(1);
    expect(mock.modelWrites[0].apiKey).toBeUndefined();
    await expect(page.locator('.model-badge')).toContainText('deepseek-test');
    await page.getByLabel('服务商标识').fill('custom');
    await page.getByLabel('API 地址', { exact: true }).fill('https://models.example.com/v1');
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(modal.getByRole('alert')).toContainText('请输入新的 API Key');
    await key.fill('test-ui-secret-never-persist');
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(modal.getByText('已保存，下次发送消息时使用新配置。')).toBeVisible();
    await expect(key).toHaveValue('');
    expect(mock.modelWrites.at(-1)?.apiKey).toBe('test-ui-secret-never-persist');
    const storage = await page.evaluate(() => JSON.stringify({ session: { ...sessionStorage }, local: { ...localStorage } }));
    expect(storage).not.toContain('test-ui-secret-never-persist');
    await key.fill('discard-this-unsaved-key');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(key).toHaveValue('');
    await expect(page.getByLabel('模型 ID')).toHaveValue('deepseek-test');
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(await modal.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
    await page.getByLabel('模型 ID').focus();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    expect(mock.modelWrites).toHaveLength(3);
  } finally { await mock.close(); }
});

test('模型配置读取可重试，冲突和失败保留填写内容并要求读取后手动保存', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    mock.modelFaults.read = true;
    await page.goto('/');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const modal = page.getByRole('dialog', { name: '设置', exact: true });
    await expect(modal.getByRole('alert')).toContainText('暂时无法读取模型配置');
    mock.modelFaults.read = false;
    await modal.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByLabel('模型 ID').fill('my-draft-model');
    mock.modelFaults.conflict = true;
    await modal.getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(modal.getByRole('alert')).toContainText('你填写的内容仍保留');
    await expect(page.getByLabel('模型 ID')).toHaveValue('my-draft-model');
    await expect(modal.getByRole('button', { name: '按最新版本保存', exact: true })).toBeDisabled();
    await modal.getByRole('button', { name: '查看最新配置', exact: true }).click();
    await expect(modal.getByLabel('最新模型配置')).toContainText('deepseek-flash');
    await expect(page.getByLabel('模型 ID')).toHaveValue('my-draft-model');
    expect(mock.modelWrites).toHaveLength(1);
    mock.modelFaults.conflict = false;
    mock.modelFaults.busy = true;
    await modal.getByRole('button', { name: '按最新版本保存', exact: true }).click();
    await expect(modal.getByRole('alert')).toContainText('仍有会话正在回复');
    await expect(page.getByLabel('模型 ID')).toHaveValue('my-draft-model');
    mock.modelFaults.busy = false;
    mock.modelFaults.write = true;
    await modal.getByRole('button', { name: '按最新版本保存', exact: true }).click();
    await expect(modal.getByRole('alert')).toContainText('模型配置保存失败');
    await expect(modal.getByRole('button', { name: '按最新版本保存', exact: true })).toBeDisabled();
    expect(mock.modelWrites).toHaveLength(3);
    mock.modelFaults.write = false;
    await modal.getByRole('button', { name: '查看最新配置', exact: true }).click();
    await modal.getByRole('button', { name: '按最新版本保存', exact: true }).click();
    await expect(modal.getByText('已保存，下次发送消息时使用新配置。')).toBeVisible();
    expect(mock.modelWrites).toHaveLength(4);
    expect(mock.modelWrites.at(-1)?.model).toBe('my-draft-model');
  } finally { await mock.close(); }
});

test('跨项目创建失败可见，全部动态保护后续选择，手机新建聚焦输入且设置遮挡不误读', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.goto('/');
    mock.faults.create = true;
    await page.getByRole('button', { name: '在项目 另一工作区 中新建对话' }).click();
    await expect(page.getByRole('alert')).toContainText('在「另一工作区」中创建对话未完成');
    await expect(page.locator('.workspace-header .workspace-name')).toHaveText('默认工作区');
    mock.faults.create = false;
    mock.faults.holdCreate = true;
    await page.getByRole('button', { name: '在项目 另一工作区 中新建对话' }).click();
    await expect.poll(() => Boolean(mock.faults.releaseCreate)).toBe(true);
    await page.getByRole('button', { name: '全部动态', exact: true }).click();
    mock.faults.releaseCreate!();
    await expect(page.getByRole('button', { name: '在项目 另一工作区 中新建对话' })).toBeEnabled();
    expect(await page.evaluate(() => sessionStorage.getItem('berserk.workspace'))).toBe('w1');
    await expect(page.locator('.header-title')).toHaveText('全部动态');
    await page.getByRole('button', { name: '打开会话：会话 A', exact: true }).click();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole('button', { name: '打开会话列表' }).click();
    await page.getByRole('button', { name: '新建对话', exact: true }).click();
    await page.getByRole('button', { name: '创建对话', exact: true }).click();
    const input = page.getByRole('textbox', { name: '发送消息' });
    await expect(input).toBeFocused();
    await input.fill('慢速回复'); await input.press('Enter');
    await expect(page.getByText('new-2 的回复', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '模型设置', exact: true }).click();
    await expect(page.getByLabel('模型 ID')).toBeVisible();
    mock.finish('new-2');
    await expect.poll(async () => page.evaluate(() => JSON.parse(sessionStorage.getItem('berserk.read-results') || '{}')['new-2'])).toBeUndefined();
    await page.keyboard.press('Escape');
    await expect.poll(async () => page.evaluate(() => JSON.parse(sessionStorage.getItem('berserk.read-results') || '{}')['new-2'])).toBe('request-1');
    expect(mock.counts.creates).toBe(2);
  } finally { await mock.close(); }
});
