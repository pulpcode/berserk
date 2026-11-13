import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { PiLab } from '../../src/pi/lab.js';
import { configuredRuntime } from '../../src/pi/model-runtime.js';
import { controlledStream, emptyUsage } from '../../src/pi/controlled-stream.js';
import { loadConfig, resolveModelThinking } from '../../src/server/config.js';
import { ModelSettingsStore } from '../../src/server/model-settings.js';
import { createBackgroundExecutor, snapshotBackgroundProfile } from '../../src/pi/background-runner.js';
import type { BackgroundJob } from '../../src/contracts/background.js';
import type { ModelThinkingMode } from '../../src/contracts/index.js';
import { testConfig } from './fake-runtime.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function config(mode: ModelThinkingMode = 'high') {
  const dir = await mkdtemp(join(tmpdir(), 'berserk-thinking-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return testConfig(dir, { provider: 'custom-ark-alias', model: 'deepseek-v4.1-flash', baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3', thinkingMode: mode });
}
type Payload = { model: string; thinking?: { type: string }; reasoning_effort?: string; max_tokens: number; messages: Array<Record<string, unknown>>; tools?: unknown[] };
type Reply = { text?: string; tool?: { name: string; arguments: object }; thoughts?: string; input?: number };
function response(reply: Reply, model: string) {
  const delta = { role: 'assistant', ...(reply.text ? { content: reply.text } : {}), ...(reply.thoughts ? { reasoning_content: reply.thoughts } : {}), ...(reply.tool ? { tool_calls: [{ index: 0, id: randomUUID(), type: 'function', function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.arguments) } }] } : {}) };
  const chunks = [{ choices: [{ index: 0, delta, finish_reason: null }] }, { choices: [{ index: 0, delta: {}, finish_reason: reply.tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: reply.input ?? 5, completion_tokens: 5, total_tokens: (reply.input ?? 5) + 5 } }];
  return new Response(chunks.map(chunk => `data: ${JSON.stringify({ id: 'offline', object: 'chat.completion.chunk', created: 1, model, ...chunk })}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}
function capture(reply: (body: Payload, index: number) => Reply = () => ({ text: '完成' })) {
  const calls: Payload[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init); const body = JSON.parse(await request.text()) as Payload;
    expect(request.url).toBe('https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions');
    calls.push(body); return response(reply(body, calls.length - 1), body.model);
  });
  return calls;
}
function expectMode(calls: Payload[], mode: ModelThinkingMode) {
  expect(calls.length).toBeGreaterThan(0);
  for (const body of calls) {
    expect(body.thinking).toEqual({ type: mode === 'high' ? 'enabled' : 'disabled' });
    expect(body.reasoning_effort).toBe(mode === 'high' ? 'high' : undefined);
  }
}

it('validates endpoint/model, accepts a custom registry alias, and keeps absent env mode unspecified', () => {
  expect(resolveModelThinking({ model: 'deepseek-v4.1-flash', baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3/' }, 'high').thinkingSupported).toBe(true);
  for (const identity of [{ model: 'deepseek-v4.1-flash', baseUrl: 'https://wrong.invalid/v1' }, { model: 'unknown', baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3' }]) {
    expect(() => resolveModelThinking(identity, 'high')).toThrow(/尚未核实/);
    expect(resolveModelThinking(identity)).toEqual({ thinkingMode: 'off', thinkingSupported: false });
  }
  expect(loadConfig({ LAB_AUTH_MODE: 'test' }).thinkingMode).toBeUndefined();
  expect(() => loadConfig({ LAB_AUTH_MODE: 'test', LLM_THINKING_MODE: 'medium' })).toThrow(/off 或 high/);
});

it.each(['off', 'high'] as const)('captures actual SDK wire %s on reply + tool continuation, with no required thought text', async mode => {
  const cfg = await config(mode); const calls = capture((_body, index) => index === 0 ? { thoughts: 'PROVIDER_VISIBLE_THOUGHT', tool: { name: 'source_read', arguments: { id: 'meeting-notes' } } } : { text: '已完成' });
  const lab = await PiLab.create(cfg); cleanup.push(() => lab.close());
  const session = await lab.createSession(); await lab.start(session.id, '查看资料').run(() => {});
  expect(lab.get(session.id).lastResult?.status).toBe('succeeded'); expect(calls).toHaveLength(2); expectMode(calls, mode);
  expect(calls[0].max_tokens).toBe(cfg.maxOutputTokens);
  expect(calls[1].messages.some(message => message.role === 'assistant' && message.reasoning_content === 'PROVIDER_VISIBLE_THOUGHT')).toBe(true);
  const answer = lab.get(session.id).messages.find(message => message.content?.some(block => block.type === 'thinking'));
  expect(answer?.content).toEqual([expect.objectContaining({ type: 'thinking', text: 'PROVIDER_VISIBLE_THOUGHT' })]);
  expect(answer?.text).toBe(''); // Visible thinking stays in process content, outside the answer text.
});

it('uses the same mode in foreground, delegated child and parent continuation', async () => {
  const cfg = await config(); const calls = capture((_body, index) => index === 0 ? { tool: { name: 'subagent', arguments: { agent: 'analyst', task: '核对资料' } } } : { text: '核对完成' });
  const lab = await PiLab.create(cfg); cleanup.push(() => lab.close()); const session = await lab.createSession();
  await lab.start(session.id, '委派核对').run(() => {});
  expect(lab.get(session.id).subagents?.[0].status).toBe('succeeded'); expect(calls).toHaveLength(3); expectMode(calls, 'high');
});

it('uses the same mode for service background execution', async () => {
  const cfg = await config(); const calls = capture(); const lab = await PiLab.create(cfg); cleanup.push(() => lab.close());
  const job: BackgroundJob = { id: randomUUID(), kind: 'preprocess', eventId: randomUUID(), sourceId: 'test', status: 'running', revision: 1, createdAt: new Date().toISOString(), sessionId: randomUUID(), requestId: randomUUID() };
  const profile = await snapshotBackgroundProfile(lab, { id: 'preprocess', name: '整理', goal: '整理资料', tools: ['source_list'], skillIds: [], agentIds: [], instructions: '整理输入', resources: [] });
  const result = await createBackgroundExecutor(lab).execute(job, { text: '后台整理', files: [], directory: join(cfg.dataDir, 'background', 'jobs', job.id), profile, onEvent: () => {}, publish: async () => { throw new Error('unused'); } });
  expect(result.snapshot.lastResult?.status).toBe('succeeded'); expectMode(calls, 'high');
});

it('keeps native compaction output allowance while applying the profile mode', async () => {
  const cfg = await config(); const calls = capture(); const runtime = await configuredRuntime(cfg); const usage = emptyUsage();
  const stream = controlledStream(runtime, cfg, runtime.getModel(cfg.provider, cfg.model)!, { messages: [{ role: 'user', content: '总结', timestamp: 1 }] }, { maxTokens: 700 }, 'compaction', '不应进入摘要', new AbortController().signal, usage);
  const result = await stream.result(); expect(result.stopReason).toBe('stop'); expectMode(calls, 'high'); expect(calls[0].max_tokens).toBe(700);
  expect(JSON.stringify(calls)).not.toContain('不应进入摘要'); expect(usage.compactionAttempts).toBe(1);
});

it('captures high mode on actual automatic compaction and subsequent reply', async () => {
  const cfg = { ...await config(), contextWindow: 8192, maxOutputTokens: 6000, compactionReserveTokens: 7000, compactionKeepRecentTokens: 128 };
  let lab = await PiLab.create(cfg); const session = await lab.createSession();
  const [filename] = await readdir(join(cfg.dataDir, 'sessions')); const manager = SessionManager.open(join(cfg.dataDir, 'sessions', filename));
  for (let index = 0; index < 4; index++) {
    manager.appendMessage({ role: 'user', content: '资料'.repeat(400), timestamp: index * 2 });
    manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: '说明'.repeat(200) }], api: 'openai-completions', provider: cfg.provider, model: cfg.model, timestamp: index * 2 + 1, stopReason: 'stop', usage: { input: 1800, output: 10, totalTokens: 1810, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } } });
  }
  await lab.close(); const calls = capture(body => ({ text: body.tools?.length ? '继续完成' : '## Goal\n完成核对\n## Progress\n已读资料' }));
  lab = await PiLab.create(cfg); cleanup.push(() => lab.close()); await lab.start(session.id, '继续').run(() => {});
  expect(lab.get(session.id).lastResult?.status).toBe('succeeded'); expect(calls.some(call => !call.tools?.length)).toBe(true); expect(calls.some(call => call.tools?.length)).toBe(true); expectMode(calls, 'high');
  // Pi's transport clamps the native 5600 summary allowance to remaining context room.
  expect(calls.find(call => !call.tools?.length)?.max_tokens).toBeGreaterThan(2048);
  expect(calls.find(call => !call.tools?.length)?.max_tokens).toBeLessThanOrEqual(5600);
});

it.each([1, 2, 3])('reads legacy schema %s without rewrite; explicit save/restart retains mode and CAS', async schemaVersion => {
  const cfg = await config(); const path = join(cfg.dataDir, 'model-settings.json'); const version = randomUUID();
  const fields = { provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl, apiKey: cfg.apiKey };
  const raw = JSON.stringify(schemaVersion === 3 ? { schemaVersion, version, models: [{ id: 'default', ...fields }] } : { schemaVersion, version, ...fields });
  await writeFile(path, raw, { mode: 0o600 }); const store = await ModelSettingsStore.open(cfg);
  expect(store.info().thinkingMode).toBe('off'); expect(await readFile(path, 'utf8')).toBe(raw);
  const update = { ...fields, expectedVersion: version, thinkingMode: 'high' as const }; const next = store.prepare(update); await store.save(next);
  expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ schemaVersion: 4, thinkingMode: 'high' });
  const reopened = await ModelSettingsStore.open(cfg); expect(reopened.info().thinkingMode).toBe('high'); expect(reopened.info().version).not.toBe(version);
  expect(JSON.stringify(reopened.info())).not.toContain(cfg.apiKey); expect(() => reopened.prepare(update)).toThrow(/已更新/);
  expect(() => reopened.prepare({ ...update, expectedVersion: reopened.info().version, thinkingMode: null as never })).toThrow(/off 或 high/);
});

it('keeps a reserved request unchanged and applies a saved mode only to the next request', async () => {
  const cfg = await config('off'); const calls = capture(); const lab = await PiLab.create(cfg); cleanup.push(() => lab.close());
  const session = await lab.createSession(); const pending = lab.start(session.id, '原设置'); const settings = lab.modelSettings();
  const update = { provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl, expectedVersion: settings.version, thinkingMode: 'high' as const };
  await expect(lab.updateModelSettings(update)).rejects.toThrow(/正在处理/);
  await pending.run(() => {}); expectMode(calls, 'off');
  const saved = await lab.updateModelSettings(update); expect(saved.thinkingMode).toBe('high'); expect(saved.version).not.toBe(settings.version);
  await lab.start(session.id, '新设置').run(() => {}); expectMode(calls.slice(1), 'high');
});

it('round trips a catalog with independent off/high profiles using schema 5', async () => {
  const cfg = await config('off'); const store = await ModelSettingsStore.open(cfg); const next = store.prepare({ provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, expectedVersion: store.info().version, thinkingMode: 'high' }, 'default', true);
  await store.save(next); const raw = JSON.parse(await readFile(join(cfg.dataDir, 'model-settings.json'), 'utf8'));
  expect(raw.schemaVersion).toBe(5); const reopened = await ModelSettingsStore.open(cfg);
  expect(reopened.info().thinkingMode).toBe('off'); expect(reopened.info(next.id).thinkingMode).toBe('high');
});

it.each(['heartbeat', 'stall', 'cancel'] as const)('high mode keeps normal transport behavior: %s, with zero provider retries', async kind => {
  const cfg = { ...await config(), httpIdleTimeoutMs: 80 }; const runtime = await configuredRuntime(cfg); let count = 0;
  const encoder = new TextEncoder(); const abort = new AbortController();
  vi.stubGlobal('fetch', async (input: Request | URL | string, init?: RequestInit) => {
    count++; const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      let interval: ReturnType<typeof setInterval> | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
      const stop = () => { clearInterval(interval); clearTimeout(timer); };
      signal?.addEventListener('abort', () => { stop(); controller.error(new Error('aborted')); }, { once: true });
      if (kind === 'heartbeat') {
        interval = setInterval(() => controller.enqueue(encoder.encode(': heartbeat\n\n')), 20);
        timer = setTimeout(() => {
          stop(); const delta = { choices: [{ index: 0, delta: { content: '完成，无思考正文' }, finish_reason: 'stop' }] };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(delta)}\n\ndata: [DONE]\n\n`)); controller.close();
        }, 200);
      }
    } }), { headers: { 'content-type': 'text/event-stream' } });
  });
  vi.useFakeTimers();
  const stream = controlledStream(runtime, cfg, runtime.getModel(cfg.provider, cfg.model)!, { messages: [{ role: 'user', content: '测试', timestamp: 1 }] }, undefined, 'reply', '规则', abort.signal, emptyUsage());
  await vi.waitFor(() => expect(count).toBe(1)); if (kind === 'cancel') abort.abort();
  await vi.advanceTimersByTimeAsync(250); const result = await stream.result();
  expect(result.stopReason).toBe(kind === 'heartbeat' ? 'stop' : kind === 'cancel' ? 'aborted' : 'error'); expect(count).toBe(1);
  if (kind === 'stall') expect(result.errorMessage).toContain('超时');
});

it.each(['custom-ark-alias', 'deepseek'])('legacy %s preserves actual wire through unrelated save; explicit off opts in', async provider => {
  const cfg = { ...await config(), provider, thinkingMode: undefined }; const calls = capture(); const lab = await PiLab.create(cfg); cleanup.push(() => lab.close());
  const session = await lab.createSession(); await lab.start(session.id, '旧配置').run(() => {});
  expect(calls[0].thinking).toEqual(provider === 'deepseek' ? { type: 'disabled' } : undefined);
  const settings = lab.modelSettings(); expect(settings.thinkingExplicit).toBe(false);
  const saved = await lab.updateModelSettings({ provider, model: cfg.model, baseUrl: cfg.baseUrl, expectedVersion: settings.version, maxOutputTokens: 100 });
  expect(saved.thinkingExplicit).toBe(false); await lab.start(session.id, '只改预算').run(() => {});
  expect(calls[1].thinking).toEqual(calls[0].thinking);
  await lab.updateModelSettings({ provider, model: cfg.model, baseUrl: cfg.baseUrl, expectedVersion: saved.version, thinkingMode: 'off' });
  await lab.start(session.id, '显式关闭').run(() => {}); expectMode(calls.slice(2), 'off');
});

it('preserves high parameters across Pi native retry while provider transport does not retry', async () => {
  const cfg = await config(); const calls: Payload[] = [];
  vi.stubGlobal('fetch', async (input: Request | URL | string, init?: RequestInit) => {
    const body = JSON.parse(await new Request(input, init).text()) as Payload; calls.push(body);
    if (calls.length === 1) return new Response(JSON.stringify({ error: { message: '503 overloaded', type: 'server_error' } }), { status: 503, headers: { 'content-type': 'application/json' } });
    return response({ text: '重试成功' }, body.model);
  });
  const lab = await PiLab.create(cfg); cleanup.push(() => lab.close()); const session = await lab.createSession();
  const events: string[] = []; await lab.start(session.id, '测试原生重试').run(event => events.push(event.type));
  expect(lab.get(session.id).lastResult?.status).toBe('succeeded'); expect(calls).toHaveLength(2); expectMode(calls, 'high');
  expect(lab.get(session.id).lastResult?.usageSummary?.modelAttempts).toBe(2);
});
