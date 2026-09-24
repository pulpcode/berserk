import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { ModelCatalog, ModelChoices, ModelProfile, ModelSettingsUpdate, SessionSnapshot } from '../../src/contracts/index.js';
import { PiLab } from '../../src/pi/lab.js';
import { MODEL_SELECTION } from '../../src/pi/model-selection.js';
import { createApp } from '../../src/server/app.js';
import { testConfig } from './fake-runtime.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.unstubAllGlobals();
});
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), 'berserk-model-catalog-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function setup(overrides: Partial<ReturnType<typeof testConfig>> = {}) {
  const dir = await directory(); const config = testConfig(dir, overrides);
  const lab = await PiLab.create(config); const app = await createApp(lab);
  cleanup.push(() => app.close());
  return { dir, config, lab, app };
}
type App = Awaited<ReturnType<typeof createApp>>;
async function addModel(app: App, changes: Partial<ModelSettingsUpdate> = {}) {
  const catalog = (await app.inject('/api/settings/models')).json<ModelCatalog>();
  const saved = await app.inject({ method: 'POST', url: '/api/settings/models', payload: {
    provider: 'catalog-compatible', model: 'second-model', baseUrl: 'https://second-model.invalid/v1',
    apiKey: 'second-test-key-NEVER-LEAK', contextWindow: 131072, maxOutputTokens: 256,
    compactionReserveTokens: 16384, compactionKeepRecentTokens: 20000,
    expectedVersion: catalog.version, ...changes,
  } });
  expect(saved.statusCode, saved.payload).toBe(201);
  expect(saved.payload).not.toContain('apiKey');
  expect(saved.payload).not.toContain('second-test-key-NEVER-LEAK');
  return saved.json<ModelProfile>();
}
async function createSession(app: App, modelId?: string) {
  const response = await app.inject({ method: 'POST', url: '/api/sessions', payload: modelId ? { modelId } : {} });
  expect(response.statusCode, response.payload).toBe(200);
  return response.json<SessionSnapshot>();
}
function captureProvider() {
  const calls: Array<{ url: string; authorization: string | null; body: { model: string; max_tokens: number; messages: unknown[] } }> = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init); const body = JSON.parse(await request.text());
    calls.push({ url: request.url, authorization: request.headers.get('authorization'), body });
    const chunks = [
      { id: 'catalog-test', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content: '目录测试响应' }, finish_reason: null }] },
      { id: 'catalog-test', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } },
    ];
    return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  });
  return calls;
}

it.each([1, 2])('keeps legacy schema v%s as the default and persists a second profile across restart', async schemaVersion => {
  const calls = captureProvider(); const dir = await directory(); const config = testConfig(dir);
  const legacy = { schemaVersion, version: randomUUID(), provider: config.provider, model: config.model,
    baseUrl: config.baseUrl, apiKey: 'legacy-private-test-key', ...(schemaVersion === 2 ? {
      contextWindow: config.contextWindow, maxOutputTokens: config.maxOutputTokens,
      compactionReserveTokens: config.compactionReserveTokens, compactionKeepRecentTokens: config.compactionKeepRecentTokens,
    } : {}),
  };
  const settingsPath = join(dir, 'model-settings.json'); await writeFile(settingsPath, JSON.stringify(legacy));
  const lab = await PiLab.create(config); const app = await createApp(lab); cleanup.push(() => app.close());
  const initial = (await app.inject('/api/settings/models')).json<ModelCatalog>();
  expect(initial).toMatchObject({ version: legacy.version, models: [{ id: 'default', model: legacy.model, configured: true, contextReady: true }] });
  const second = await addModel(app);
  const catalog = (await app.inject('/api/settings/models')).json<ModelCatalog>();
  expect(catalog.models).toHaveLength(2);
  expect(catalog.models.find(model => model.id === 'default')).toMatchObject({ model: legacy.model, baseUrl: legacy.baseUrl, version: second.version });
  expect(catalog.version).toBe(second.version); expect(catalog.version).not.toBe(initial.version);
  expect((await stat(settingsPath)).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toMatchObject({ schemaVersion: 3, version: catalog.version });
  await app.close();
  const restored = await PiLab.create({ ...config, apiKey: 'different-environment-key' }); cleanup.push(() => restored.close());
  expect(restored.modelCatalog()).toEqual(catalog);
  const session = await restored.createSession(); await restored.start(session.id, '验证兼容默认配置').run(() => {});
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ authorization: 'Bearer legacy-private-test-key', body: { model: legacy.model, max_tokens: config.maxOutputTokens } });
  expect(config.apiKey).not.toBe('legacy-private-test-key');
});

it('isolates simultaneous same-name models by profile endpoint, credentials and output limit', async () => {
  const calls = captureProvider();
  const { app, lab, dir, config } = await setup({ provider: 'same-provider', model: 'same-model', baseUrl: 'https://first-model.invalid/v1' });
  const second = await addModel(app, { provider: config.provider, model: config.model, maxOutputTokens: 256 });
  const firstChat = await createSession(app); const secondChat = await createSession(app, second.id);
  expect(firstChat.modelId).toBe('default'); expect(secondChat.modelId).toBe(second.id);
  await Promise.all([
    lab.start(firstChat.id, 'FIRST_PROFILE_MESSAGE').run(() => {}),
    lab.start(secondChat.id, 'SECOND_PROFILE_MESSAGE').run(() => {}),
  ]);
  expect(lab.get(firstChat.id).lastResult?.status).toBe('succeeded');
  expect(lab.get(secondChat.id).lastResult?.status).toBe('succeeded');
  expect(calls).toHaveLength(2);
  const firstCall = calls.find(call => JSON.stringify(call.body.messages).includes('FIRST_PROFILE_MESSAGE'));
  const secondCall = calls.find(call => JSON.stringify(call.body.messages).includes('SECOND_PROFILE_MESSAGE'));
  expect(firstCall).toMatchObject({ url: 'https://first-model.invalid/v1/chat/completions', authorization: `Bearer ${config.apiKey}`, body: { model: 'same-model', max_tokens: 128 } });
  expect(secondCall).toMatchObject({ url: 'https://second-model.invalid/v1/chat/completions', authorization: 'Bearer second-test-key-NEVER-LEAK', body: { model: 'same-model', max_tokens: 256 } });
  expect(JSON.stringify(firstCall?.body.messages)).not.toContain('SECOND_PROFILE_MESSAGE');
  expect(JSON.stringify(secondCall?.body.messages)).not.toContain('FIRST_PROFILE_MESSAGE');
  // Native model_change shares provider/model identity; it must not erase the host profile identity.
  await lab.start(firstChat.id, 'FIRST_PROFILE_CONTINUATION').run(() => {});
  expect(calls[2]).toMatchObject({ url: firstCall?.url, authorization: firstCall?.authorization, body: { max_tokens: 128 } });
  const choices = await app.inject('/api/models');
  expect(choices.json<ModelChoices>()).toMatchObject({ defaultModelId: 'default', models: [{ id: 'default' }, { id: second.id }] });
  for (const secret of [config.apiKey, 'second-test-key-NEVER-LEAK', 'baseUrl', 'first-model.invalid', 'second-model.invalid']) expect(choices.payload).not.toContain(secret);
  for (const file of await readdir(join(dir, 'sessions'))) {
    const history = await readFile(join(dir, 'sessions', file), 'utf8');
    expect(history).not.toContain(config.apiKey); expect(history).not.toContain('second-test-key-NEVER-LEAK');
  }
  await app.close();
  const restored = await PiLab.create(config); cleanup.push(() => restored.close());
  expect(restored.get(firstChat.id).modelId).toBe('default'); expect(restored.get(secondChat.id).modelId).toBe(second.id);
  await restored.start(secondChat.id, 'SECOND_PROFILE_AFTER_RESTART').run(() => {});
  expect(calls[3]).toMatchObject({ url: secondCall?.url, authorization: secondCall?.authorization, body: { model: 'same-model', max_tokens: 256 } });
});

it('runs a configured profile when the default has neither credentials nor known capacity', async () => {
  const calls = captureProvider();
  const { app, lab } = await setup({ apiKey: '', contextWindow: null, maxOutputTokens: null, compactionReserveTokens: null,
    compactionKeepRecentTokens: null, contextSource: 'unknown', outputSource: 'unknown', contextReady: false });
  const second = await addModel(app);
  expect((await app.inject('/api/info')).json()).toMatchObject({ configured: false, contextReady: false });
  const unavailable = await createSession(app);
  const blocked = await app.inject({ method: 'POST', url: `/api/sessions/${unavailable.id}/messages`, payload: { text: '不得执行默认模型' } });
  expect(blocked.statusCode).toBe(503); expect(blocked.json().error.code).toBe('MODEL_NOT_CONFIGURED'); expect(lab.get(unavailable.id).messages).toEqual([]);
  const usable = await createSession(app, second.id);
  await lab.start(usable.id, '使用可用的另一模型').run(() => {});
  expect(lab.get(usable.id).lastResult?.status).toBe('succeeded'); expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ url: 'https://second-model.invalid/v1/chat/completions', authorization: 'Bearer second-test-key-NEVER-LEAK', body: { model: second.model, max_tokens: 256 } });
});

it('persists an empty conversation model choice without invoking a provider or adding a message', async () => {
  const calls = captureProvider(); const { app, lab, config } = await setup(); const second = await addModel(app);
  const session = await createSession(app);
  const selected = await app.inject({ method: 'PUT', url: `/api/sessions/${session.id}/model`, payload: { modelId: second.id } });
  expect(selected.statusCode, selected.payload).toBe(200);
  expect(selected.json<SessionSnapshot>()).toMatchObject({ id: session.id, modelId: second.id, messages: [], active: null, lastResult: null });
  expect(lab.get(session.id).modelId).toBe(second.id);
  expect(calls).toHaveLength(0);
  await app.close(); const restored = await PiLab.create(config); cleanup.push(() => restored.close());
  expect(restored.get(session.id)).toMatchObject({ modelId: second.id, messages: [], active: null, lastResult: null });
  expect(calls).toHaveLength(0);
});

it('rejects invalid or unavailable choices and switching a reserved conversation without mutating its selection', async () => {
  const calls = captureProvider(); const { app, lab } = await setup(); const second = await addModel(app);
  const session = await createSession(app); const before = lab.get(session.id);
  for (const modelId of ['../../outside', 'unknown-profile', randomUUID()]) {
    const response = await app.inject({ method: 'PUT', url: `/api/sessions/${session.id}/model`, payload: { modelId } });
    expect([400, 404]).toContain(response.statusCode);
    expect(lab.get(session.id)).toEqual(before);
  }
  const pending = lab.start(session.id, '保留的请求');
  const busy = await app.inject({ method: 'PUT', url: `/api/sessions/${session.id}/model`, payload: { modelId: second.id } });
  expect(busy.statusCode).toBe(409); expect(lab.get(session.id).modelId).toBe('default');
  lab.cancel(session.id, pending.requestId); await pending.run(() => {});
  expect(calls).toHaveLength(0);
  const selected = await app.inject({ method: 'PUT', url: `/api/sessions/${session.id}/model`, payload: { modelId: second.id } });
  expect(selected.statusCode, selected.payload).toBe(200); expect(lab.get(session.id).modelId).toBe(second.id);
});

it.each(['profile-id', 'extra-key', 'session-binding'])('refuses to resume a conversation with %s-tampered model selection history', async corruption => {
  const calls = captureProvider(); const { app, dir, config } = await setup(); const second = await addModel(app);
  const session = await createSession(app, second.id); await app.close();
  const sessionDir = join(dir, 'sessions'); const name = (await readdir(sessionDir)).find(file => file.endsWith(`_${session.id}.jsonl`));
  expect(name).toBeDefined(); const path = join(sessionDir, name!);
  const entries = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const entry = entries.find(entry => entry.type === 'custom' && entry.customType === MODEL_SELECTION);
  expect(entry).toBeDefined();
  if (corruption === 'profile-id') entry.data.modelId = '../../outside';
  if (corruption === 'extra-key') entry.data.apiKey = 'injected-key';
  if (corruption === 'session-binding') entry.data.sessionId = randomUUID();
  const damaged = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n'; await writeFile(path, damaged);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const restored = await PiLab.create(config); cleanup.push(() => restored.close());
  expect(restored.list()).toEqual([]);
  expect(() => restored.get(session.id)).toThrow(/不存在/);
  expect(() => restored.start(session.id, '禁止续跑')).toThrow(/不存在/);
  expect(calls).toHaveLength(0); expect(await readFile(path, 'utf8')).toBe(damaged);
});
