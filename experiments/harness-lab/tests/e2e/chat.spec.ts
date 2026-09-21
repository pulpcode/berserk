import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { test, expect, type Page } from '@playwright/test';
import type { SessionSnapshot, StreamEvent, InstructionFile, Workspace, ActivityOverview, ModelSettings, ModelSettingsUpdate, CompactionDetail, SubagentSummary } from '../../src/contracts/index';

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
  let modelSettings: ModelSettings = { provider: 'deepseek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', configured: true, source: 'environment', version: 'model-v1', contextWindow: 1000000, maxOutputTokens: 393216, compactionReserveTokens: 16384, compactionKeepRecentTokens: 20000, contextSource: 'preset', outputSource: 'preset', contextReady: true };
  const compactions = new Map<string, CompactionDetail>();
  const modelFaults = { read: false, write: false, conflict: false, busy: false };
  const modelWrites: ModelSettingsUpdate[] = [];
  const faults = { create: false, holdSessionRead: false, releaseSessionRead: undefined as (() => void) | undefined, holdWorkspaceCreate: false, releaseWorkspaceCreate: undefined as (() => void) | undefined, activity: false, holdActivity: false, releaseActivity: undefined as (() => void) | undefined, reads: false, puts: false, sessionReads: false, holdRead: false, releaseRead: undefined as (() => void) | undefined, holdCreate: false, releaseCreate: undefined as (() => void) | undefined };
  const responses = new Map<string, ServerResponse>();
  const counts = { compactionReads: [] as string[], activityReads: 0, sessionReads: [] as string[], sends: 0, creates: 0, cancels: [] as string[], puts: [] as { workspaceId: string; content: string; expectedHash: string | null }[], instructionReads: 0, workspaces: 0 };
  const event = (id: string, data: StreamEvent) => responses.get(id)?.write(`data: ${JSON.stringify(data)}\n\n`);
  const finish = (id: string, status: 'succeeded' | 'cancelled' | 'failed' = 'succeeded') => {
    const session = sessions.get(id)!;
    const requestId = session.active!.requestId;
    session.active = null;
    session.lastResult = { requestId, status, compactions: [...compactions.values()].filter(item => item.sessionId === id && item.requestId === requestId) };
    session.updatedAt = new Date().toISOString();
    event(id, { type: status === 'succeeded' ? 'response.completed' : status === 'failed' ? 'response.failed' : 'response.cancelled', sessionId: id, requestId, snapshot: session });
    if (session.subagents?.[0]) event(id, { type: 'subagent.updated', sessionId: id, requestId, subagent: { ...session.subagents[0], parentRequestId: requestId, role: '迟到角色', status: 'running' } });
    event(id, { type: 'context.compaction_started', sessionId: id, requestId, reason: 'threshold' });
    event(id, { type: 'text.delta', sessionId: id, requestId, delta: '终态之后的迟到内容不得展示' });
    responses.get(id)?.end();
    responses.delete(id);
  };
  const updateChild = (id: string, child: SubagentSummary) => {
    const session = sessions.get(id)!;
    const fresh = !session.subagents?.some(item => item.subagentId === child.subagentId);
    session.subagents = [...(session.subagents || []).filter(item => item.subagentId !== child.subagentId), child];
    if (session.active && session.active.status !== 'stopping') session.active.phase = ['running', 'stopping'].includes(child.status) ? 'subagent' : 'preparing';
    if (fresh) {
      session.messages.push({ id: `native-${child.toolCallId}`, toolCallId: child.toolCallId, requestId: child.parentRequestId, role: 'tool', toolName: 'subagent', text: '' });
      event(id, { type: 'tool.started', sessionId: id, requestId: child.parentRequestId, toolCallId: child.toolCallId, toolName: 'subagent' });
    }
    event(id, { type: 'subagent.updated', sessionId: id, requestId: child.parentRequestId, subagent: child });
    if (!['running', 'stopping'].includes(child.status)) {
      const text = JSON.stringify({ diagnostic: '不可展示的内部子任务 JSON', result: child.result });
      const message = session.messages.find(item => item.toolCallId === child.toolCallId)!;
      message.text = text; message.isError = child.status !== 'succeeded';
      event(id, { type: 'tool.completed', sessionId: id, requestId: child.parentRequestId, toolCallId: child.toolCallId, toolName: 'subagent', text, isError: child.status !== 'succeeded' });
    }
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    const path = url.pathname;
    if (request.method === 'OPTIONS') { response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); response.end(); return; }
    const json = (value: unknown, status = 200) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      response.end(JSON.stringify(value));
    };
    if (path === '/api/info') return json({ model: modelSettings.model, configured: modelSettings.configured, contextReady: modelSettings.contextReady, sources: [
      { id: 'brief', title: '项目讨论纪要', description: '目标、约束与待明确事项' },
      { id: 'plan', title: '协作方案参考', description: '方案结构与编制要点' },
    ], limits: { agentRunTimeoutMs: null, httpIdleTimeoutMs: 300000, llmRequestTimeoutMs: null, maxOutputTokens: modelSettings.maxOutputTokens } });
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
      const changed = update.model !== modelSettings.model || update.provider !== modelSettings.provider || update.baseUrl !== modelSettings.baseUrl;
      const contextWindow = update.contextWindow ?? (changed ? null : modelSettings.contextWindow);
      const maxOutputTokens = update.maxOutputTokens ?? (changed ? null : modelSettings.maxOutputTokens);
      const compactionReserveTokens = update.compactionReserveTokens ?? (changed ? null : modelSettings.compactionReserveTokens) ?? (contextWindow ? Math.min(16384, Math.floor(contextWindow / 4)) : null);
      const compactionKeepRecentTokens = update.compactionKeepRecentTokens ?? (changed ? null : modelSettings.compactionKeepRecentTokens) ?? (contextWindow && compactionReserveTokens ? Math.min(20000, Math.floor((contextWindow - compactionReserveTokens) / 2)) : null);
      if (contextWindow && maxOutputTokens && (maxOutputTokens > contextWindow || (compactionReserveTokens! + compactionKeepRecentTokens!) >= contextWindow)) return json({ error: { code: 'INVALID_MODEL_PARAMETERS', message: '输出能力不能超过上下文容量，压缩预留量与保留量之和须小于上下文容量。' } }, 400);
      modelSettings = { contextWindow, maxOutputTokens, compactionReserveTokens, compactionKeepRecentTokens, contextReady: Boolean(contextWindow && maxOutputTokens && compactionReserveTokens && compactionKeepRecentTokens), contextSource: update.contextWindow ? 'explicit' : changed ? 'unknown' : modelSettings.contextSource, outputSource: update.maxOutputTokens ? 'explicit' : changed ? 'unknown' : modelSettings.outputSource, provider: update.provider, model: update.model, baseUrl: update.baseUrl, configured: Boolean(update.apiKey?.trim()) || modelSettings.configured, version: `model-v${modelWrites.length + 1}`, source: 'local' };
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
    if (path.includes('/compactions/')) { const entryId = path.split('/')[5]; counts.compactionReads.push(`${id}:${entryId}`); const detail = compactions.get(entryId); return detail?.sessionId === id ? json(detail) : json({ error: { code: 'NOT_FOUND', message: '未找到当前会话的摘要。' } }, 404); }
    if (path.endsWith('/resources')) return json({ compactions: [...compactions.values()].filter(item => item.sessionId === id && item.requestId === path.split('/')[5]), status: 'available', workspaceId: session.workspaceId, requestId: path.split('/')[5], instructions: [common, { ...instructions.get(session.workspaceId)!, content: '本轮发送时的指令' }], skills, readSkills: [{ ...skills[0], content: '本轮读取的方法正文' }], editableFileIds: ['workspace'] });
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
  return { sessions, workspaces, instructions, faults, counts, finish, event, updateChild, disconnect: (id: string) => { responses.get(id)?.end(); responses.delete(id); }, compactions, modelFaults, modelWrites, setModel: (settings: Partial<ModelSettings>) => { modelSettings = { ...modelSettings, ...settings }; }, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
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

test('窄屏指令对照、键盘保存、IME 与只读 Skill', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.goto('/');
    await page.getByRole('textbox', { name: '发送消息' }).fill('读取资料');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(page.getByText('A 的回复', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '查看本轮资料' })).toHaveCount(0);
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
    // The overview may discover the new session before its POST response arrives.
    // It must not switch the composer away from the pending workspace draft.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('region', { name: '等待创建', exact: true }).getByRole('button', { name: '新对话', exact: true })).toBeVisible();
    await expect(input).toHaveValue('原始提交');
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

test('失败请求不展示调试资料入口，准备失败恢复草稿且刷新不重发', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.goto('/');
    const input = page.getByRole('textbox', { name: '发送消息' });
    await input.fill('准备阶段失败'); await input.press('Enter');
    await expect(input).toHaveValue('准备阶段失败');
    await expect(page.getByRole('alert')).toBeVisible();
    await page.reload();
    await expect(input).toHaveValue('准备阶段失败');
    await expect(page.getByRole('button', { name: '查看本轮资料' })).toHaveCount(0);
    expect(mock.counts.sends).toBe(1);
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
    mock.faults.sessionReads = true;
    await input.fill('准备阶段取消'); await input.press('Enter');
    await expect(input).toHaveValue('准备阶段取消');
    await expect(page.getByText('会话查询暂时失败', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
    mock.faults.sessionReads = false;
    await input.fill('首个模型调用失败'); await input.press('Enter');
    await expect(input).toHaveValue('首个模型调用失败');
    await expect.poll(() => mock.counts.sends).toBe(3);
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
    await expect(page.getByRole('article', { name: '你的消息' }).getByRole('button', { name: '查看本轮资料' })).toHaveCount(0);
    await input.fill('后续请求'); await input.press('Enter');
    await expect(page.getByText('A 的回复', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '查看本轮资料' })).toHaveCount(0);
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
    await expect(input).toBeEnabled();
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
    await expect(page.locator('.settings-trigger-model')).toContainText('deepseek-test');
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
    await page.getByRole('button', { name: '打开会话列表' }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByLabel('模型 ID')).toBeVisible();
    mock.finish('new-2');
    // Wait for the browser's terminal state, not merely an unread value that was already absent.
    await expect(page.locator('.request-status')).toBeEmpty();
    await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('berserk.read-results') || '{}')['new-2'])).toBeUndefined();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '设置', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '设置', exact: true })).toBeFocused();
    await page.locator('.sidebar-brand').getByRole('button', { name: '关闭会话列表' }).click();
    // Reading requires a visible foreground document; element focus alone is insufficient.
    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => document.hasFocus() && document.visibilityState === 'visible')).toBe(true);
    await expect.poll(async () => page.evaluate(() => JSON.parse(sessionStorage.getItem('berserk.read-results') || '{}')['new-2'])).toBe('request-1');
    expect(mock.counts.creates).toBe(2);
  } finally { await mock.close(); }
});

test('未知模型参数阻止发送并保留历史草稿，补填后不自动重发', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    mock.setModel({ model: 'private-model', contextWindow: null, maxOutputTokens: null, compactionReserveTokens: null, compactionKeepRecentTokens: null, contextSource: 'unknown', outputSource: 'unknown', contextReady: false });
    mock.sessions.get('A')!.messages.push({ id: 'old', role: 'assistant', text: '仍能查看的原始历史' });
    await page.goto('/');
    const input = page.getByRole('textbox', { name: '发送消息' });
    await input.fill('等待模型配置的草稿'); await input.press('Enter');
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
    await expect(page.getByText('仍能查看的原始历史')).toBeVisible();
    await expect(input).toHaveValue('等待模型配置的草稿');
    expect(mock.counts.sends).toBe(0);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByLabel('上下文容量（token）')).toBeEmpty();
    await page.getByLabel('上下文容量（token）').fill('32768');
    await page.getByLabel('最大输出能力（token）').fill('8192');
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(page.getByText('已保存，下次发送消息时使用新配置。')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(input).toHaveValue('等待模型配置的草稿');
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
    expect(mock.counts.sends).toBe(0);
    expect(mock.modelWrites[0]).toMatchObject({ contextWindow: 32768, maxOutputTokens: 8192 });
    await input.press('Enter');
    await expect.poll(() => mock.counts.sends).toBe(1);
  } finally { await mock.close(); }
});

test('容量参数来源、模型切换清空与冲突草稿保护，375px高级设置可用', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.getByRole('button', { name: '打开会话列表' }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const modal = page.getByRole('dialog', { name: '设置', exact: true });
    await expect(page.getByLabel('上下文容量（token）')).toHaveValue('1000000');
    await expect(page.getByLabel('最大输出能力（token）')).toHaveValue('393216');
    await expect(modal.getByText(/来源：已核对的模型规格/).first()).toBeVisible();
    await page.getByLabel('模型 ID').fill('private-model');
    await expect(page.getByLabel('上下文容量（token）')).toBeEmpty();
    await expect(page.getByLabel('最大输出能力（token）')).toBeEmpty();
    await page.getByLabel('上下文容量（token）').fill('32768');
    await page.getByLabel('最大输出能力（token）').fill('8192');
    await modal.getByText('高级压缩参数', { exact: true }).click();
    await page.getByLabel('压缩预留量（token）').fill('8192');
    await page.getByLabel('近期原文保留量（token）').fill('8192');
    await expect(modal.getByRole('button', { name: '关闭面板' })).toBeVisible();
    await page.screenshot({ path: '/tmp/berserk-compaction-settings-mobile.png' });
    mock.modelFaults.conflict = true;
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(modal.getByRole('alert')).toContainText('你填写的内容仍保留');
    await modal.getByRole('button', { name: '查看最新配置' }).click();
    await expect(modal.getByLabel('最新模型配置')).toContainText('1000000');
    await expect(page.getByLabel('上下文容量（token）')).toHaveValue('32768');
    await expect(page.getByLabel('近期原文保留量（token）')).toHaveValue('8192');
    expect(mock.modelWrites).toHaveLength(1);
    expect(await modal.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
    mock.modelFaults.conflict = false;
    await page.getByRole('button', { name: '按最新版本保存' }).click();
    await expect(page.getByText('已保存，下次发送消息时使用新配置。')).toBeVisible();
    expect(mock.modelWrites.at(-1)).toMatchObject({ contextWindow: 32768, maxOutputTokens: 8192, compactionReserveTokens: 8192, compactionKeepRecentTokens: 8192 });
  } finally { await mock.close(); }
});

test('压缩状态跨项目可见，摘要完成不终结请求或产生未读，停止优先且忽略迟到事件', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.goto('/');
    const input = page.getByRole('textbox', { name: '发送消息' });
    await input.fill('慢速回复'); await input.press('Enter');
    await expect(page.getByText('A 的回复', { exact: true })).toBeVisible();
    const session = mock.sessions.get('A')!;
    const requestId = session.active!.requestId;
    session.active!.phase = 'compacting';
    mock.event('A', { type: 'context.compaction_started', sessionId: 'A', requestId, reason: 'threshold' });
    await expect(page.locator('.request-status')).toHaveText('正在压缩上下文');
    await input.fill('A 的下一轮草稿');
    await page.getByRole('button', { name: '全部动态', exact: true }).click();
    await expect(page.locator('.activity-row').filter({ hasText: '会话 A' })).toContainText('正在压缩上下文');
    await page.getByRole('button', { name: '会话 C', exact: true }).click();
    await input.fill('C 的独立草稿');
    const detail: CompactionDetail = { id: 'compact-A', sessionId: 'A', requestId, createdAt: new Date().toISOString(), reason: 'threshold', tokensBefore: 20000, tokensAfter: 5000, summary: 'A 的摘要', firstKeptEntryId: 'user-retained' };
    mock.compactions.set(detail.id, detail); session.latestCompaction = detail; session.active!.phase = 'generating';
    mock.event('A', { type: 'context.compaction_completed', sessionId: 'A', requestId, compaction: detail });
    await expect(page.getByRole('button', { name: /^会话 A/ })).toContainText('生成回复');
    await expect(page.getByRole('button', { name: /^会话 A/ }).getByLabel('有新回复未读')).toHaveCount(0);
    await expect(input).toHaveValue('C 的独立草稿');
    await page.getByRole('button', { name: /^会话 A/ }).click();
    await expect(input).toHaveValue('A 的下一轮草稿');
    await page.getByRole('button', { name: '停止回复' }).click();
    mock.event('A', { type: 'context.compaction_started', sessionId: 'A', requestId, reason: 'threshold' });
    await expect(page.locator('.request-status')).toHaveText('正在停止');
    await expect(page.getByRole('button', { name: '正在停止', exact: true })).toBeDisabled();
    mock.finish('A', 'cancelled');
    await expect(page.locator('.request-status')).toHaveText('已停止');
    await expect(page.getByText('终态之后的迟到内容不得展示')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
    expect(mock.counts.cancels).toEqual([requestId]); expect(mock.counts.sends).toBe(1);
  } finally { await mock.close(); }
});

test('历史摘要详情只读且不替换原文，摘要属于历史请求并可在窄屏查看', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    const session = mock.sessions.get('A')!;
    const detail: CompactionDetail = { id: 'compact-old-A', sessionId: 'A', requestId: 'old-request', createdAt: '2026-09-17T10:00:00Z', reason: 'overflow', tokensBefore: 24000, tokensAfter: 4100, summary: '保留最新目标与尚未完成的事项。' + '长摘要内容'.repeat(50), firstKeptEntryId: 'original-entry-81', model: 'deepseek-flash', usage: { input: 18000, output: 3000, cacheRead: 0, cacheWrite: 0, totalTokens: 21000 } };
    mock.compactions.set(detail.id, detail); session.latestCompaction = detail;
    session.messages = [{ id: 'old-u', role: 'user', requestId: 'old-request', text: '完整原始问题仍在' }, { id: 'old-a', role: 'assistant', requestId: 'old-request', text: '完整原始答复仍在' }, { id: 'new-a', role: 'assistant', requestId: 'new-request', text: '后续请求答复' }];
    session.lastResult = { requestId: 'new-request', status: 'succeeded' };
    await page.goto('/');
    await expect(page.getByText('完整原始问题仍在')).toBeVisible();
    await expect(page.getByRole('button', { name: '查看本轮资料' })).toHaveCount(0);
    await page.getByRole('button', { name: '查看最近压缩摘要' }).click();
    await expect(page.getByLabel('压缩摘要正文（只读）')).toHaveText(detail.summary);
    await expect(page.getByText('original-entry-81', { exact: true })).toBeVisible();
    await expect(page.getByText('上下文超限恢复', { exact: true })).toBeVisible();
    await expect(page.getByText('21,000 token', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    const panel = page.getByRole('dialog');
    expect(await panel.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.keyboard.press('Escape');
    await expect(page.getByText('完整原始答复仍在')).toBeVisible();
    await page.getByRole('button', { name: '查看最近压缩摘要' }).click();
    await expect(page.getByLabel('压缩摘要正文（只读）')).toHaveText(detail.summary);
    await page.screenshot({ path: '/tmp/berserk-compaction-detail-mobile.png' });
    expect(mock.counts.compactionReads).toEqual(['A:compact-old-A', 'A:compact-old-A']);
    expect(mock.counts.sends).toBe(0); expect(mock.counts.puts).toHaveLength(0); expect(mock.modelWrites).toHaveLength(0);
  } finally { await mock.close(); }
});


test('刷新压缩中的会话只查询状态，最终失败可见且保留下一轮草稿', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    const session = mock.sessions.get('A')!;
    session.active = { requestId: 'existing-compaction', status: 'responding', phase: 'compacting' };
    session.messages = [{ id: 'existing-user', role: 'user', requestId: 'existing-compaction', text: '继续处理原任务' }];
    await page.goto('/');
    await expect(page.locator('.request-status')).toHaveText('正在压缩上下文');
    const input = page.getByRole('textbox', { name: '发送消息' });
    await input.fill('下一轮补充信息');
    await page.reload();
    await expect(page.locator('.request-status')).toHaveText('正在压缩上下文');
    await expect(input).toHaveValue('下一轮补充信息');
    expect(mock.counts.sends).toBe(0);
    session.active = null;
    session.lastResult = { requestId: 'existing-compaction', status: 'failed', message: '上下文压缩失败：摘要未完整生成，请调整后重试。' };
    await expect(page.getByRole('alert')).toContainText('上下文压缩失败');
    await expect(page.locator('.request-status')).toHaveText('回复未完成');
    await expect(input).toHaveValue('下一轮补充信息');
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: /^会话 A/ }).getByLabel('有新回复未读')).toHaveCount(0);
    expect(mock.counts.sends).toBe(0);
  } finally { await mock.close(); }
});


function childTask(requestId: string, id: string, role = 'analyst'): SubagentSummary {
  return { subagentId: id, parentRequestId: requestId, toolCallId: `call-${id}`, role, description: `${role} 的实际职责`, task: `处理 ${id} 的指定材料`, status: 'running', phase: 'preparing', startedAt: '2026-09-17T10:00:00Z' };
}

test('子任务按实际角色在所属请求内显示，结果替代工具正文且可键盘展开', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    const old = { ...childTask('old-request', 'old-child'), status: 'succeeded' as const, result: '上一轮的分析结果' };
    const session = mock.sessions.get('A')!;
    session.subagents = [old];
    session.messages = [{ id: 'old-user', requestId: 'old-request', role: 'user', text: '上一轮的问题' }, { id: 'old-native-tool', toolCallId: old.toolCallId, requestId: 'old-request', role: 'tool', toolName: 'subagent', text: '不可展示的旧工具 JSON' }, { id: 'old-answer', requestId: 'old-request', role: 'assistant', text: '上一轮主回复' }];
    await page.goto('/');
    const input = page.getByRole('textbox', { name: '发送消息' });
    await input.fill('慢速回复'); await input.press('Enter');
    await expect(page.getByText('A 的回复', { exact: true })).toBeVisible();
    const requestId = session.active!.requestId;
    const analyst = childTask(requestId, 'analysis-1');
    mock.updateChild('A', { ...analyst, phase: 'tool', toolName: 'source_read' });
    const analysisCard = page.locator('[data-subagent-id="analysis-1"]');
    await expect(analysisCard).toContainText('正在读取资料');
    await expect(analysisCard).not.toHaveAttribute('open');
    await analysisCard.locator('summary').focus(); await page.keyboard.press('Enter');
    await expect(analysisCard).toHaveAttribute('open', '');
    await expect(analysisCard).toContainText(analyst.description);
    await expect(analysisCard).toContainText(analyst.task);
    mock.updateChild('A', { ...analyst, status: 'succeeded', result: '**分析完成**：有两处资料差异。' });
    await expect(analysisCard.locator('strong').filter({ hasText: '分析完成' })).toBeVisible();
    await expect(analysisCard.locator('summary')).toBeFocused();
    const reviewer = childTask(requestId, 'review-2', 'reviewer');
    mock.updateChild('A', reviewer);
    mock.updateChild('A', { ...reviewer, status: 'failed', error: '资料服务暂时不可用，未完成核对。' });
    const reviewCard = page.locator('[data-subagent-id="review-2"]');
    await reviewCard.locator('summary').click();
    await expect(reviewCard).toContainText('reviewer 的实际职责');
    await expect(reviewCard).toContainText('资料服务暂时不可用，未完成核对。');
    await expect(page.locator('.subagent-card')).toHaveCount(3);
    expect(await page.locator('.message-list').evaluate(element => {
      const text = element.textContent || '';
      return text.indexOf('上一轮主回复') < text.indexOf('处理 analysis-1') && text.indexOf('上一轮的问题') < text.indexOf('上一轮主回复');
    })).toBe(true);
    await expect(page.getByText(/不可展示的.*JSON/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: '查看本轮资料' })).toHaveCount(0);
    mock.finish('A');
    await expect(page.getByText('迟到角色', { exact: true })).toHaveCount(0);
    await expect(page.locator('.subagent-card')).toHaveCount(3);
  } finally { await mock.close(); }
});

test('子任务完成不结束父请求或产生蓝点，跨项目草稿独立并拒绝外来子事件', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.goto('/');
    const input = page.getByRole('textbox', { name: '发送消息' });
    await input.fill('慢速回复'); await input.press('Enter');
    await expect(page.getByText('A 的回复', { exact: true })).toBeVisible();
    const requestId = mock.sessions.get('A')!.active!.requestId;
    const child = childTask(requestId, 'live-child', 'reviewer');
    mock.updateChild('A', { ...child, phase: 'compacting' });
    await expect(page.locator('.request-status')).toHaveText('reviewer · 正在压缩上下文');
    mock.event('A', { type: 'subagent.updated', sessionId: 'A', requestId, subagent: childTask('other-request', 'foreign-child', '不属于当前请求') });
    await expect(page.locator('[data-subagent-id="foreign-child"]')).toHaveCount(0);
    await input.fill('A 的后续草稿');
    await page.getByRole('button', { name: '全部动态', exact: true }).click();
    await expect(page.locator('.activity-row').filter({ hasText: '会话 A' })).toContainText('子任务处理中');
    await page.getByRole('button', { name: '会话 C', exact: true }).click();
    await input.fill('C 的独立草稿');
    mock.updateChild('A', { ...child, status: 'succeeded', result: '检查完成，主 Agent 仍需综合。' });
    await expect(page.getByRole('button', { name: /^会话 A/ })).toContainText('准备资料');
    await expect(page.getByRole('button', { name: /^会话 A/ }).getByLabel('有新回复未读')).toHaveCount(0);
    await expect(page.locator('.subagent-card')).toHaveCount(0);
    await expect(input).toHaveValue('C 的独立草稿');
    await page.getByRole('button', { name: /^会话 A/ }).click();
    await expect(input).toHaveValue('A 的后续草稿');
    await expect(page.getByRole('button', { name: '停止回复' })).toBeEnabled();
    mock.event('A', { type: 'subagent.updated', sessionId: 'A', requestId, subagent: { ...child, status: 'running' } });
    await expect(page.locator('[data-subagent-id="live-child"] > summary')).toContainText('已完成');
    await page.getByRole('button', { name: '会话 C', exact: true }).click();
    mock.finish('A');
    await expect(page.getByRole('button', { name: /^会话 A/ }).getByLabel('有新回复未读')).toHaveCount(1);
    expect(mock.counts.sends).toBe(1);
  } finally { await mock.close(); }
});

test('停止覆盖活动子任务，迟到进度不覆盖停止或父终态', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.goto('/');
    const input = page.getByRole('textbox', { name: '发送消息' });
    await input.fill('慢速回复'); await input.press('Enter');
    await expect(page.getByText('A 的回复', { exact: true })).toBeVisible();
    const requestId = mock.sessions.get('A')!.active!.requestId;
    const child = childTask(requestId, 'stop-child');
    mock.updateChild('A', { ...child, phase: 'retrying' });
    await expect(page.locator('.request-status')).toHaveText('analyst · 正在重试');
    await page.getByRole('button', { name: '停止回复' }).click();
    mock.event('A', { type: 'subagent.updated', sessionId: 'A', requestId, subagent: { ...child, phase: 'compacting' } });
    await expect(page.locator('[data-subagent-id="stop-child"] > summary')).toContainText('正在停止');
    await expect(page.getByRole('button', { name: '正在停止', exact: true })).toBeDisabled();
    await input.fill('停止后保留的新草稿'); await input.press('Enter');
    expect(mock.counts.sends).toBe(1);
    mock.updateChild('A', { ...child, status: 'cancelled', error: '用户停止了本次处理。' });
    mock.finish('A', 'cancelled');
    await expect(page.locator('.request-status')).toHaveText('已停止');
    const card = page.locator('[data-subagent-id="stop-child"]');
    await card.locator('summary').click();
    await expect(card).toContainText('用户停止了本次处理。');
    await expect(card).toContainText('已取消');
    await expect(page.getByText('迟到角色', { exact: true })).toHaveCount(0);
    await expect(input).toHaveValue('停止后保留的新草稿');
    expect(mock.counts.cancels).toEqual([requestId]);
  } finally { await mock.close(); }
});

test('刷新查询恢复子卡片，手机安全Markdown与中断状态可读且不重发', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    await page.setViewportSize({ width: 375, height: 812 });
    const session = mock.sessions.get('A')!;
    const child = childTask('existing-parent', 'restored-child', 'custom-role');
    session.active = { requestId: child.parentRequestId, status: 'responding', phase: 'subagent' };
    mock.updateChild('A', { ...child, phase: 'tool', toolName: 'skill_read' });
    session.messages.unshift({ id: 'parent-user', requestId: child.parentRequestId, role: 'user', text: '先前已发送的任务' });
    await page.goto('/');
    const input = page.getByRole('textbox', { name: '发送消息' });
    await input.fill('刷新仍保留的草稿');
    await page.reload();
    const card = page.locator('[data-subagent-id="restored-child"]');
    await expect(card).toContainText('正在读取 Skill');
    await expect(input).toHaveValue('刷新仍保留的草稿');
    await card.locator('summary').focus(); await page.keyboard.press('Enter');
    const result = `| 列一 | 很长的列二 | 很长的列三 |
| --- | --- | --- |
| 结果 | 需要横向查看的长字段 | 另一个长字段 |

<script>window.subagentInjected=true</script>
[不安全链接](javascript:alert(1))`;
    mock.updateChild('A', { ...child, status: 'succeeded', result });
    await expect(card).toContainText('已完成');
    await expect(card.getByRole('table')).toBeVisible();
    expect(await page.evaluate(() => 'subagentInjected' in window)).toBe(false);
    await expect(card.locator('a')).not.toHaveAttribute('href', /^javascript:/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: '/tmp/berserk-subagent-mobile.png' });
    const interrupted = { ...childTask(child.parentRequestId, 'interrupted-child'), status: 'interrupted' as const, error: '上次执行中断，未自动重新委派。' };
    mock.updateChild('A', interrupted);
    session.active = null; session.lastResult = { requestId: child.parentRequestId, status: 'failed', message: '上次执行中断。' };
    await expect(page.locator('[data-subagent-id="interrupted-child"]')).toContainText('执行中断');
    await expect(page.locator('.request-status')).toHaveText('回复未完成');
    expect(mock.counts.sends).toBe(0); expect(mock.counts.creates).toBe(0);
  } finally { await mock.close(); }
});

test('子事件不抢阅读位置或输入焦点，断线后查询恢复且不重复发送', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    const session = mock.sessions.get('A')!;
    session.messages = [{ id: 'long-old', requestId: 'old-request', role: 'assistant', text: '旧历史正文。\n\n'.repeat(150) }];
    await page.goto('/');
    const input = page.getByRole('textbox', { name: '发送消息' });
    await input.fill('慢速回复'); await input.press('Enter');
    await expect(page.getByText('A 的回复', { exact: true })).toBeVisible();
    const child = childTask(session.active!.requestId, 'reconnect-child');
    mock.updateChild('A', child);
    await expect(page.locator('[data-subagent-id="reconnect-child"]')).toHaveCount(1);
    await input.fill('断线也不丢失的下一轮草稿');
    const conversation = page.getByLabel('对话内容', { exact: true });
    await conversation.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
    mock.updateChild('A', { ...child, phase: 'tool', toolName: 'source_read' });
    await expect(page.locator('.request-status')).toHaveText('analyst · 正在读取资料');
    await expect(input).toBeFocused();
    expect(await conversation.evaluate(element => element.scrollTop)).toBeLessThan(5);
    const beforeReads = mock.counts.sessionReads.length;
    mock.disconnect('A');
    await expect.poll(() => mock.counts.sessionReads.length).toBeGreaterThan(beforeReads);
    await expect(page.locator('[data-subagent-id="reconnect-child"]')).toHaveCount(1);
    mock.updateChild('A', { ...child, status: 'succeeded', result: '断线后由查询获取的结果。' });
    mock.finish('A');
    await expect(page.locator('[data-subagent-id="reconnect-child"] > summary')).toContainText('已完成');
    await expect(page.locator('.request-status')).toBeEmpty();
    expect(await conversation.evaluate(element => element.scrollTop)).toBeLessThan(5);
    await expect(input).toHaveValue('断线也不丢失的下一轮草稿');
    await expect(page.getByRole('button', { name: /^会话 A/ }).getByLabel('有新回复未读')).toHaveCount(1);
    expect(mock.counts.sends).toBe(1);
  } finally { await mock.close(); }
});


test('启动工作区归属读取完成前保护输入，随后文字归入初始会话且可发送', async ({ page }) => {
  const mock = await mockApi(page);
  mock.faults.holdActivity = true;
  try {
    await page.goto('/');
    const input = page.getByRole('textbox', { name: '发送消息' });
    await expect(input).toBeDisabled();
    await expect(page.getByRole('button', { name: '添加附件' })).toBeDisabled();
    await expect.poll(() => Boolean(mock.faults.releaseActivity)).toBe(true);
    mock.faults.releaseActivity!(); mock.faults.releaseActivity = undefined;
    await expect(input).toBeEditable();
    await input.fill('生成表格');
    await page.getByRole('button', { name: '会话 B', exact: true }).click();
    await expect(input).toHaveValue('');
    await page.getByRole('button', { name: '会话 A', exact: true }).click();
    await expect(input).toHaveValue('生成表格');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(page.getByRole('table')).toBeVisible();
    expect(mock.counts.sends).toBe(1);
  } finally { mock.faults.releaseActivity?.(); await mock.close(); }
});

function presentationSession(session: SessionSnapshot) {
  session.active = { requestId: 'presentation', status: 'responding', phase: 'tool' };
  session.messages = [
    { id: 'presentation-user', requestId: 'presentation', role: 'user', text: '分析资料并提供结果。' },
    { id: 'presentation-note', requestId: 'presentation', role: 'assistant', text: '先核对资料中的依据。' },
    { id: 'presentation-read', requestId: 'presentation', role: 'tool', toolName: 'read', toolCallId: 'read-call', text: '资料原文完整保留。' },
  ];
}
function completePresentation(session: SessionSnapshot) {
  session.active = null;
  session.lastResult = { requestId: 'presentation', status: 'succeeded' };
  session.turns = [{ requestId: 'presentation', status: 'succeeded', finalMessageId: 'presentation-final' }];
  session.messages.push({ id: 'presentation-final', requestId: 'presentation', role: 'assistant', text: '核对完毕，最终建议如下。' });
  session.updatedAt = new Date().toISOString();
}

test('可靠成功后折叠连续过程，确认错误与成果保持顺序且手动展开跨会话稳定', async ({ page }, testInfo) => {
  const mock = await mockApi(page);
  try {
    const session = mock.sessions.get('A')!; presentationSession(session);
    session.interactions = [{ schemaVersion: 1, interactionId: 'past-confirm', workspaceId: 'w1', sessionId: 'A', requestId: 'presentation', toolCallId: 'confirm', toolName: 'bash', createdAt: '', kind: 'confirmation', status: 'approved', execution: 'unknown', action: { title: '处理文件', description: '核对操作', parameters: {}, command: 'echo test' }, rule: { ruleId: 'r', reason: '需要确认', version: '1' } }];
    session.messages.push(
      { id: 'confirmation', requestId: 'presentation', role: 'tool', toolName: 'bash', toolCallId: 'confirm', resultMissing: true, text: '未收到执行结果，无法确认是否已执行。' },
      { id: 'error', requestId: 'presentation', role: 'tool', toolName: 'custom_tool', isError: true, text: '服务暂不可用' },
      { id: 'file', requestId: 'presentation', role: 'tool', toolName: 'file_output', toolCallId: 'output', text: '已生成文件' },
    );
    session.fileOutputs = [{ downloadId: 'fixed', workspaceId: 'w1', sessionId: 'A', requestId: 'presentation', toolCallId: 'output', path: '报告.md', name: '报告.md', size: 40, hash: 'hash', createdAt: '' }];
    completePresentation(session);
    await page.goto('/');
    const process = page.locator('.process-group');
    await expect(process).not.toHaveAttribute('open');
    await expect(page.getByText('核对完毕，最终建议如下。', { exact: true })).toBeVisible();
    await expect(page.locator('.interaction-card')).toContainText('执行结果未确认');
    await expect(page.locator('.tool-result.failed > summary')).toHaveText('调用工具失败');
    await expect(page.locator('.file-output')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('chat-process-collapsed.png') });
    await process.locator(':scope > summary').click();
    await expect(page.getByText('先核对资料中的依据。', { exact: true })).toBeVisible();
    await page.locator('.tool-result').first().locator('summary').click();
    await expect(page.getByText('资料原文完整保留。', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('chat-process-expanded.png') });
    await page.getByRole('button', { name: /^会话 B/ }).click();
    await page.getByRole('button', { name: /^会话 A/ }).click();
    await expect(process).toHaveAttribute('open', '');
    expect(mock.counts.sends).toBe(0);
  } finally { await mock.close(); }
});

test('完成不会自动折叠有焦点的过程，也不重置手动展开', async ({ page }, testInfo) => {
  const mock = await mockApi(page);
  try {
    const session = mock.sessions.get('A')!; presentationSession(session);
    await page.goto('/');
    const process = page.locator('.process-group');
    await expect(process).toHaveAttribute('open', '');
    const tool = page.locator('.tool-result > summary'); await tool.focus();
    await page.screenshot({ path: testInfo.outputPath('chat-process-running.png') });
    completePresentation(session);
    await expect(page.getByText('核对完毕，最终建议如下。', { exact: true })).toBeVisible();
    await expect(process).toHaveAttribute('open', ''); await expect(tool).toBeFocused();
    await page.getByRole('textbox', { name: '发送消息' }).focus();
    await expect(process).toHaveAttribute('open', '');
    await process.locator(':scope > summary').click();
    await expect(process).not.toHaveAttribute('open');
    await expect(process.locator(':scope > summary')).toBeFocused();
    expect(mock.counts.sends).toBe(0);
  } finally { await mock.close(); }
});

test('向上阅读时完成保留展开与阅读位置，旧快照无终态依据不隐藏过程', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    const session = mock.sessions.get('A')!; presentationSession(session);
    session.messages.unshift({ id: 'old-long', role: 'assistant', text: Array.from({ length: 60 }, (_, index) => `早前说明 ${index}`).join('\n\n') });
    await page.goto('/');
    const process = page.locator('.process-group'); await expect(process).toHaveAttribute('open', '');
    const scroll = page.locator('.conversation-scroll');
    await scroll.evaluate(node => { node.scrollTop = 200; node.dispatchEvent(new Event('scroll')); });
    completePresentation(session);
    await expect(page.getByText('核对完毕，最终建议如下。', { exact: true })).toBeAttached();
    await expect(process).toHaveAttribute('open', '');
    await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBe(200);
    delete session.turns;
    await page.reload();
    await expect(process).toHaveAttribute('open', '');
    expect(mock.counts.sends).toBe(0);
  } finally { await mock.close(); }
});

test('后台完成后返回向上阅读会话不自动收起新过程段', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    const session = mock.sessions.get('A')!; presentationSession(session);
    session.messages.unshift({ id: 'old-long', role: 'assistant', text: Array.from({ length: 60 }, (_, index) => `早前说明 ${index}`).join('\n\n') });
    await page.goto('/'); await expect(page.locator('.process-group')).toHaveAttribute('open', '');
    const scroll = page.locator('.conversation-scroll');
    await scroll.evaluate(node => { node.scrollTop = 200; node.dispatchEvent(new Event('scroll')); });
    await page.getByRole('button', { name: /^会话 B/ }).click();
    session.messages.push({ id: 'boundary', requestId: 'presentation', role: 'tool', toolName: 'bash', isError: true, text: '需要核对' }, { id: 'another-read', requestId: 'presentation', role: 'tool', toolName: 'read', text: '新的资料结果' });
    completePresentation(session);
    await page.getByRole('button', { name: /^会话 A/ }).click();
    await expect(page.locator('.process-group')).toHaveCount(2);
    await expect(page.locator('.process-group[open]')).toHaveCount(2);
    await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBe(200);
    expect(mock.counts.sends).toBe(0);
  } finally { await mock.close(); }
});

for (const target of ['link', 'table'] as const) test(`流式说明移入过程时保留${target}焦点且不自动折叠`, async ({ page }) => {
  const mock = await mockApi(page);
  try {
    const session = mock.sessions.get('A')!; presentationSession(session);
    session.messages.pop();
    session.messages[1].text = target === 'link' ? '[来源](https://example.com/source)' : '| 字段 | 数据 |\n| --- | --- |\n| 目标 | 内容 |';
    await page.goto('/');
    const control = target === 'link' ? page.getByRole('link', { name: '来源', exact: true }) : page.getByRole('region', { name: '回复表格，可横向滚动' });
    await control.focus(); await expect(control).toBeFocused();
    session.messages.push({ id: 'new-read', requestId: 'presentation', role: 'tool', toolName: 'read', text: '读取完成' });
    completePresentation(session);
    await expect(page.getByText('核对完毕，最终建议如下。', { exact: true })).toBeVisible();
    await expect(control).toBeFocused();
    await expect(page.locator('.process-group')).toHaveAttribute('open', '');
    await page.getByRole('button', { name: /^会话 B/ }).click();
    await page.getByRole('textbox', { name: '发送消息' }).focus();
    await page.getByRole('button', { name: /^会话 A/ }).click();
    await expect(control).not.toBeFocused();
    expect(mock.counts.sends).toBe(0);
  } finally { await mock.close(); }
});

test('尾部说明并入手动收起的过程时焦点优先，摘要焦点不阻止手动收起', async ({ page }) => {
  const mock = await mockApi(page);
  try {
    const session = mock.sessions.get('A')!; presentationSession(session);
    session.messages.push({ id: 'tail-note', requestId: 'presentation', role: 'assistant', text: '[继续核对来源](https://example.com/source)' });
    await page.goto('/');
    const process = page.locator('.process-group');
    await expect(process).toHaveAttribute('open', '');
    await process.locator(':scope > summary').click();
    await expect(process).not.toHaveAttribute('open');
    const link = page.getByRole('link', { name: '继续核对来源' }); await link.focus();
    session.messages.push({ id: 'last-read', requestId: 'presentation', role: 'tool', toolName: 'read', text: '核对结果' });
    completePresentation(session);
    await expect(page.getByText('核对完毕，最终建议如下。', { exact: true })).toBeVisible();
    await expect(link).toBeFocused(); await expect(process).toHaveAttribute('open', '');
    await process.locator(':scope > summary').click();
    await expect(process).not.toHaveAttribute('open'); await expect(process.locator(':scope > summary')).toBeFocused();
    await page.getByRole('textbox', { name: '发送消息' }).fill('保留下一轮草稿');
    await expect(process).not.toHaveAttribute('open');
    expect(mock.counts.sends).toBe(0);
  } finally { await mock.close(); }
});
