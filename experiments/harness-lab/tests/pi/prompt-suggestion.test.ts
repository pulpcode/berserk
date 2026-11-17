import { afterEach, expect, it, vi } from 'vitest';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { PromptSuggestionRequest, SessionSnapshot } from '../../src/contracts/index.js';
import { generatePromptSuggestion, suggestionContext, suggestionText } from '../../src/pi/prompt-suggestion.js';
import { configuredRuntime } from '../../src/pi/model-runtime.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';

const input: PromptSuggestionRequest = { sourceRequestId: 'turn', finalMessageId: 'final', expectedModelId: 'default' };
const snapshot = (): SessionSnapshot => ({ id: 'session', workspaceId: 'workspace', title: '', updatedAt: '', active: null, lastResult: null,
  messages: [
    { id: 'user', requestId: 'turn', role: 'user', text: '同时整理两份文件。' },
    { id: 'tool', requestId: 'turn', role: 'tool', toolName: 'work_item_action', toolStatus: 'completed', text: '两份文件已交接', toolInput: { command: 'PRIVATE_ARGUMENT' }, toolDetails: { diff: 'PRIVATE_DIFF' } },
    { id: 'queued-user', requestId: 'turn', role: 'user', text: '先列出差异。' },
    { id: 'final', requestId: 'turn', role: 'assistant', text: '差异清单已列出。', content: [{ id: 'thought', type: 'thinking', text: 'PRIVATE_REASONING' }] },
  ],
});
afterEach(() => { vi.unstubAllGlobals(); });

it('uses real user boundaries and authorized text only, bounded to recent context', () => {
  const value = snapshot();
  value.messages.splice(1, 0,
    { id: 'read-result', requestId: 'turn', role: 'tool', toolName: 'read', toolStatus: 'completed', text: 'PRIVATE_FILE_BODY' },
    { id: 'shell-result', requestId: 'turn', role: 'tool', toolName: 'bash', toolStatus: 'completed', text: 'PRIVATE_SHELL_LOG' },
    { id: 'skill-result', requestId: 'turn', role: 'tool', toolName: 'skill_read', toolStatus: 'completed', text: 'PRIVATE_SKILL_BODY' });
  value.messages.unshift(...Array.from({ length: 12 }, (_, i) => ({ id: `old-${i}`, role: 'user' as const, text: '旧内容'.repeat(300) })));
  const context = suggestionContext(value, input, testConfig('/unused'))!;
  const text = JSON.stringify(context);
  expect(text).toContain('同时整理两份文件'); expect(text).toContain('先列出差异'); expect(text).toContain('差异清单已列出');
  expect(text).toContain('两份文件已交接');
  for (const secret of ['PRIVATE_ARGUMENT', 'PRIVATE_DIFF', 'PRIVATE_REASONING', 'PRIVATE_FILE_BODY', 'PRIVATE_SHELL_LOG', 'PRIVATE_SKILL_BODY']) expect(text).not.toContain(secret);
  const payload = JSON.parse(String(context.messages[0].content));
  expect(payload.dialogue).toHaveLength(6); expect(payload.historyTruncated).toBe(true);
  expect(context.tools).toBeUndefined();
});

it('keeps completion facts without copying file, shell or method bodies into predictions', () => {
  for (const toolName of ['read', 'bash', 'edit', 'write', 'grep', 'source_read', 'instructions_read', 'skill_read',
    'capability_authoring_read', 'capability_authoring_method', 'capability_authoring_propose']) {
    const value = snapshot();
    value.messages.splice(-1, 0, { id: 'body', requestId: 'turn', role: 'tool', toolName, toolStatus: 'completed', text: 'PRIVATE_BODY' });
    const text = String(suggestionContext(value, input, testConfig('/unused'))!.messages[0].content);
    expect(text).toContain(toolName); expect(text).not.toContain('PRIVATE_BODY');
  }
});

it('keeps the six-message bound when five same-turn user messages leave no older slots', () => {
  const value = snapshot();
  value.messages = [
    { id: 'older', role: 'user', requestId: 'previous', text: '旧目标' },
    ...Array.from({ length: 5 }, (_, i) => ({ id: `user-${i}`, requestId: 'turn', role: 'user' as const, text: `补充 ${i}` })),
    value.messages.at(-1)!,
  ];
  const context = suggestionContext(value, input, testConfig('/unused'))!;
  const payload = JSON.parse(String(context.messages[0].content));
  expect(payload.dialogue).toHaveLength(6); expect(JSON.stringify(payload)).not.toContain('旧目标');
});

it('skips when essential context or configured capacity cannot fit, without another compression call', () => {
  const value = snapshot(); value.messages[0].text = '长'.repeat(7000);
  expect(suggestionContext(value, input, testConfig('/unused'))).toBeNull();
  expect(suggestionContext(snapshot(), input, { contextWindow: 32, maxOutputTokens: 128 })).toBeNull();
  expect(suggestionContext(snapshot(), { ...input, finalMessageId: 'missing' }, testConfig('/unused'))).toBeNull();
});

it.each(['NONE', '', '第一段\n第二段', 'a'.repeat(257), '无效\u0001内容'])('rejects an unusable candidate %j', async text => {
  const config = testConfig('/unused'); const fake = await fakeRuntime(config, () => ({ text }));
  expect(await generatePromptSuggestion(fake.runtime, config, snapshot(), input, new AbortController().signal)).toBeNull();
});

it('rejects truncated, thinking-only and tool-bearing outputs', async () => {
  const config = testConfig('/unused');
  for (const plan of [{ text: '继续核对', length: true }, { blocks: [{ type: 'thinking' as const, thinking: 'private' }] }, { text: '继续核对', tools: [{ name: 'read', arguments: {} }] }]) {
    const fake = await fakeRuntime(config, () => plan);
    expect(await generatePromptSuggestion(fake.runtime, config, snapshot(), input, new AbortController().signal)).toBeNull();
  }
});

it('accepts one textual candidate while discarding any returned reasoning', async () => {
  const config = testConfig('/unused'); const fake = await fakeRuntime(config, () => ({ text: '请按差异清单修改两份文件。', blocks: [{ type: 'thinking', thinking: 'hidden' }] }));
  expect(await generatePromptSuggestion(fake.runtime, config, snapshot(), input, new AbortController().signal)).toBe('请按差异清单修改两份文件。');
  expect(fake.calls).toHaveLength(1); expect(fake.calls[0].maxTokens).toBe(config.maxOutputTokens);
});

it.each(['off', 'high'] as const)('uses the actual SDK wire with captured %s configuration, no tools or host execution reminder', async thinkingMode => {
  const config = testConfig('/unused', { provider: 'deepseek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', thinkingMode, maxOutputTokens: 1024 });
  const runtime = await configuredRuntime(config);
  const calls: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); calls.push(body);
    const data = { id: 'prediction', model: config.model, choices: [{ index: 0, delta: { role: 'assistant', content: '请继续核对差异清单。' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } };
    return new Response(`data: ${JSON.stringify(data)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  });
  expect(await generatePromptSuggestion(runtime, config, snapshot(), input, new AbortController().signal)).toBe('请继续核对差异清单。');
  expect(calls).toHaveLength(1); expect(calls[0].max_tokens).toBe(512); expect(calls[0].tools).toBeUndefined();
  expect(calls[0].thinking).toEqual({ type: thinkingMode === 'high' ? 'enabled' : 'disabled' });
  expect(JSON.stringify(calls)).not.toContain('host_request_instructions');
});

it('does not treat a provider failure as an ordinary suggestion', () => {
  expect(suggestionText({ stopReason: 'error', content: [{ type: 'text', text: '错误详情' }] } as AssistantMessage)).toBeNull();
});
