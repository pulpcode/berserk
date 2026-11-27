import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { ModelSettingsStore } from '../../src/server/model-settings.js';
import { configuredRuntime, modelReasoning } from '../../src/pi/model-runtime.js';
import { loadServerConfig, resolveModelThinking, type LabConfig } from '../../src/server/config.js';
import { RequestError } from '../../src/contracts/errors.js';
import type { ModelPlatformUpdate } from '../../src/contracts/index.js';
import { testConfig } from './fake-runtime.js';

const dirs: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function setup(overrides: Partial<LabConfig> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'berserk-platforms-')); dirs.push(dir);
  const config = testConfig(dir, overrides); return { dir, config, store: await ModelSettingsStore.open(config) };
}
function platformInput(store: ModelSettingsStore, extra: Partial<ModelPlatformUpdate> = {}): ModelPlatformUpdate {
  return { name: 'Kimi', provider: 'kimi-coding', baseUrl: 'https://api.kimi.com/coding/', api: 'anthropic-messages', enabled: false, expectedVersion: store.catalog().version, ...extra };
}
async function addKimi(store: ModelSettingsStore) {
  const platform = store.preparePlatform(platformInput(store), 'default', true); await store.savePlatform(platform);
  const next = store.prepare({ platformId: platform.id, model: 'k3.1-pro', displayName: 'Kimi K3.1 Pro', enabled: false, usageConfirmed: false,
    thinkingLevels: [], thinkingLevelMap: { off: null }, expectedVersion: store.catalog().version }, 'default', true);
  await store.save(next); return { platformId: platform.id, modelId: next.id };
}
function captureHttp() {
  const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  vi.stubGlobal('fetch', async (input: Request | URL | string, init?: RequestInit) => {
    const request = new Request(input, init); calls.push({ url: request.url, headers: request.headers, body: JSON.parse(await request.text()) });
    return new Response(JSON.stringify({ error: { type: 'invalid_request_error', message: 'offline transport capture' } }), { status: 400, headers: { 'content-type': 'application/json' } });
  }); return calls;
}

it('saves an unconfigured Kimi entry without inventing account capacities or enabling it', async () => {
  vi.stubEnv('KIMI_API_KEY', ''); const { store, config, dir } = await setup(); const { platformId, modelId } = await addKimi(store);
  expect(store.platform(platformId)).toMatchObject({ configured: false, enabled: false, api: 'anthropic-messages' });
  expect(store.info(modelId)).toMatchObject({ configured: false, available: false, contextReady: false, contextWindow: null, maxOutputTokens: null, enabled: false, usageConfirmed: false });
  const raw = await readFile(join(dir, 'model-settings.json'), 'utf8'); expect(JSON.parse(raw).schemaVersion).toBe(8);
  expect(raw).not.toContain('KIMI_API_KEY'); expect(raw).not.toContain('k3.1-pro-capacity');
  const restored = await ModelSettingsStore.open(config); expect(restored.info(modelId)).toEqual(store.info(modelId));
});

it('uses the saved key and gates availability on all readiness conditions', async () => {
  vi.stubEnv('KIMI_API_KEY', 'ignored-kimi-env'); const { store } = await setup(); const { platformId, modelId } = await addKimi(store);
  const enabled = store.preparePlatform(platformInput(store, { enabled: true, apiKey: 'private-kimi-local-placeholder' }), platformId); await store.savePlatform(enabled);
  expect(store.info(modelId).available).toBe(false);
  const model = store.prepare({ platformId, model: 'k3.1-pro', enabled: true, usageConfirmed: true, contextWindow: 65536, maxOutputTokens: 8192, expectedVersion: store.catalog().version }, modelId); await store.save(model);
  expect(store.info(modelId)).toMatchObject({ configured: true, available: true }); expect(store.config(modelId).apiKey).toBe('private-kimi-local-placeholder');
  for (const value of [store.catalog(), store.choices(), store.info(modelId), store.platform(platformId)]) expect(JSON.stringify(value)).not.toContain('private-kimi-local-placeholder');
});

it('rejects malformed keys before persisting a new platform', async () => {
  const { store, dir } = await setup();
  const valid = store.preparePlatform(platformInput(store), 'default', true); await store.savePlatform(valid);
  const before = store.catalog(), raw = await readFile(join(dir, 'model-settings.json'), 'utf8');
  expect(() => store.preparePlatform(platformInput(store, { apiKey: 'invalid key with spaces' }), 'default', true)).toThrow(/API Key 格式不正确/);
  expect(await readFile(join(dir, 'model-settings.json'), 'utf8')).toBe(raw);
  expect(store.catalog()).toEqual(before);
});

it('requires a fresh key when an endpoint or protocol changes and preserves the old binding on rejection', async () => {
  const { store } = await setup(); const { platformId } = await addKimi(store);
  await store.savePlatform(store.preparePlatform(platformInput(store, { apiKey: 'old-offline-key' }), platformId));
  expect(() => store.preparePlatform(platformInput(store, { baseUrl: 'https://other.invalid/coding' }), platformId)).toThrow(/重新填写/);
  expect(() => store.preparePlatform(platformInput(store, { api: 'openai-completions' }), platformId)).toThrow(/重新填写/);
  expect(store.platform(platformId).baseUrl).toBe('https://api.kimi.com/coding');
  const confirmed = store.preparePlatform(platformInput(store, { baseUrl: 'https://other.invalid/coding', apiKey: 'new-offline-key' }), platformId);
  await store.savePlatform(confirmed); expect(store.platform(platformId).baseUrl).toBe('https://other.invalid/coding');
});

it('migrates schema 6 local keys on save and ignores every old environment reference', async () => {
  const { dir } = await setup();
  const config = loadServerConfig({ LAB_AUTH_MODE: 'test', LAB_DATA_DIR: dir, LLM_API_KEY: 'ignored-startup-key' });
  expect((await ModelSettingsStore.open(config)).info().configured).toBe(false);
  vi.stubEnv('KIMI_API_KEY', 'ignored-kimi-key');
  const file = join(dir, 'model-settings.json'); const modelId = randomUUID();
  const raw = JSON.stringify({ schemaVersion: 6, version: randomUUID(), platforms: [
    { id: 'default', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', api: 'openai-completions', apiKey: 'kept-local-key' },
    { id: 'kimi', provider: 'kimi-coding', baseUrl: 'https://api.kimi.com/coding', api: 'anthropic-messages', credentialEnv: 'KIMI_API_KEY' },
  ], models: [{ id: 'default', platformId: 'default', model: 'deepseek-flash' }, { id: modelId, platformId: 'kimi', model: 'k3.1-pro' }] });
  await writeFile(file, raw);
  const store = await ModelSettingsStore.open(config);
  expect(await readFile(file, 'utf8')).toBe(raw);
  expect(store.config().apiKey).toBe('kept-local-key');
  expect(store.info(modelId).configured).toBe(false);
  await store.savePlatform(store.preparePlatform(platformInput(store), 'kimi'));
  const saved = JSON.parse(await readFile(file, 'utf8'));
  expect(saved).toMatchObject({ schemaVersion: 8, defaultModelId: 'default', credentials: { 'platform:default': 'kept-local-key' }, platforms: [
    { id: 'default', credentialRef: 'platform:default' }, { id: 'kimi', credentialRef: 'platform:kimi' },
  ] });
  expect(JSON.stringify(saved)).not.toMatch(/apiKey|credentialEnv|ignored-/);
  const restored = await ModelSettingsStore.open(config);
  expect(restored.config().apiKey).toBe('kept-local-key');
  expect(restored.info(modelId).configured).toBe(false);
});

it('shares one version across platforms and models and refuses stale updates and role revocation', async () => {
  const { store, dir } = await setup(); const before = store.info().version;
  const platform = store.preparePlatform(platformInput(store), 'default', true); await store.savePlatform(platform);
  expect(() => store.preparePlatform(platformInput(store, { expectedVersion: before }), platform.id)).toThrow(/已更新/);
  const next = store.preparePlatform(platformInput(store, { name: 'Edited' }), platform.id); const raw = await readFile(join(dir, 'model-settings.json'), 'utf8');
  await expect(store.savePlatform(next, () => { throw new RequestError('FORBIDDEN', '撤权', 403); })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await readFile(join(dir, 'model-settings.json'), 'utf8')).toBe(raw); expect(store.platform(platform.id).name).toBe('Kimi');
});

it('atomically deletes linked profiles and the credential while preserving other platforms on reopen', async () => {
  const { store, config, dir } = await setup();
  const { platformId, modelId } = await addKimi(store);
  await store.savePlatform(store.preparePlatform(platformInput(store, { apiKey: 'deletion-test-key' }), platformId));
  const file = join(dir, 'model-settings.json');
  const raw = await readFile(file, 'utf8');
  expect(raw).toContain('deletion-test-key');
  const before = store.catalog();
  const defaultId = store.info().platformId!;
  await expect(store.deletePlatform(defaultId, before.version)).rejects.toMatchObject({ code: 'DEFAULT_MODEL_PLATFORM' });
  await expect(store.deletePlatform(platformId, randomUUID())).rejects.toMatchObject({ code: 'MODEL_SETTINGS_CONFLICT' });
  let checks = 0;
  await expect(store.deletePlatform(platformId, before.version, () => {
    if (++checks === 3) throw new RequestError('FORBIDDEN', '撤权', 403);
  })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await readFile(file, 'utf8')).toBe(raw);
  expect(store.catalog()).toEqual(before);
  expect(await store.deletePlatform(platformId, before.version)).toEqual([modelId]);
  const written = await readFile(file, 'utf8');
  expect(written).not.toContain('deletion-test-key');
  expect(JSON.parse(written).credentials).not.toHaveProperty('platform:' + platformId);
  expect(store.catalog().version).not.toBe(before.version);
  const reopened = await ModelSettingsStore.open(config);
  expect(reopened.catalog()).toEqual(store.catalog());
  expect(reopened.catalog().platforms?.map(item => item.id)).toEqual([defaultId]);
  expect(reopened.choices().models.map(item => item.id)).toEqual(['default']);
});

it('keeps historical profile IDs and independent platform bindings when migrating schema 5', async () => {
  const { config, dir } = await setup(); const id = randomUUID(); const version = randomUUID(); const fields = { provider: config.provider, model: 'same-model', baseUrl: config.baseUrl, apiKey: config.apiKey, contextWindow: 65536, maxOutputTokens: 256 };
  const raw = JSON.stringify({ schemaVersion: 5, version, models: [{ id: 'default', ...fields }, { id, ...fields, baseUrl: 'https://second.invalid/v1', apiKey: 'second-placeholder' }] });
  await writeFile(join(dir, 'model-settings.json'), raw); const store = await ModelSettingsStore.open(config);
  expect(await readFile(join(dir, 'model-settings.json'), 'utf8')).toBe(raw);
  expect(store.catalog().models.map(model => model.id)).toEqual(['default', id]); expect(store.config(id).api).toBe('openai-completions');
  expect(store.config('default').platformId).not.toBe(store.config(id).platformId);
  await store.save(store.prepare({ platformId: store.info(id).platformId, model: fields.model, expectedVersion: version }, id));
  const reopened = await ModelSettingsStore.open(config); expect(reopened.config(id)).toMatchObject({ apiKey: 'second-placeholder', baseUrl: 'https://second.invalid/v1' });
});

it('forks a shared platform for a legacy model edit without changing other profiles', async () => {
  const { store, config } = await setup(); const added = store.prepare({ platformId: 'default', model: config.model, usageConfirmed: true, contextWindow: 65536, maxOutputTokens: 256, expectedVersion: store.info().version }, 'default', true); await store.save(added);
  const other = store.config(added.id);
  const edit = store.prepare({ provider: config.provider, model: config.model, baseUrl: 'https://new.invalid/v1', apiKey: 'new-placeholder', expectedVersion: store.info().version }); await store.save(edit);
  expect(store.config().platformId).not.toBe(other.platformId); expect(store.config(added.id)).toEqual(other);
});

it('requires fresh usage confirmation when an existing profile changes model identity or platform', async () => {
  const { store, config } = await setup();
  const platform = store.preparePlatform(platformInput(store), 'default', true); await store.savePlatform(platform);
  const same = store.prepare({ platformId: 'default', model: config.model, expectedVersion: store.info().version });
  expect(same.usageConfirmed).toBe(true);
  const changedModel = store.prepare({ platformId: 'default', model: 'another-model', expectedVersion: store.info().version });
  expect(changedModel.usageConfirmed).toBe(false);
  const changedPlatform = store.prepare({ platformId: platform.id, model: 'k3.1-pro', expectedVersion: store.info().version });
  expect(changedPlatform.usageConfirmed).toBe(false);
  await store.save(changedPlatform);
  expect(store.info().usageConfirmed).toBe(false);
  const confirmed = store.prepare({ platformId: platform.id, model: 'k3.1-pro', usageConfirmed: true, expectedVersion: store.info().version });
  expect(confirmed.usageConfirmed).toBe(true);
});

it('clears optional capability fields rather than inheriting the default model through config spread', async () => {
  const { store, config } = await setup({ thinkingLevels: ['off', 'high'], defaultThinkingLevel: 'high', input: ['text', 'image'], compat: { supportsStore: true } });
  const added = store.prepare({ provider: 'second', model: 'other', baseUrl: 'https://second.invalid/v1', apiKey: 'second-placeholder', contextWindow: 65536, maxOutputTokens: 512, expectedVersion: store.info().version }, 'default', true); await store.save(added);
  for (const profile of [added, store.config(added.id)]) {
    expect({ ...config, ...profile }).toMatchObject({ thinkingLevels: undefined, defaultThinkingLevel: undefined, input: undefined, compat: undefined });
  }
});

it('captures real Anthropic serialization with native default thinking and no disabled field', async () => {
  const calls = captureHttp(); const { store, config } = await setup(); const { modelId } = await addKimi(store);
  const cfg = { ...config, ...store.config(modelId), apiKey: 'offline-anthropic-placeholder', contextWindow: 65536, maxOutputTokens: 1024 };
  const runtime = await configuredRuntime(cfg); const model = runtime.getModel(cfg.provider, cfg.model)!;
  expect(model).toMatchObject({ api: 'anthropic-messages', reasoning: true, thinkingLevelMap: { off: null } });
  await runtime.completeSimple(model, { systemPrompt: '当前规则', messages: [{ role: 'user', content: 'test', timestamp: 1 }] }, { apiKey: cfg.apiKey, maxRetries: 0, reasoning: modelReasoning(cfg) });
  expect(calls).toHaveLength(1); expect(calls[0].url).toMatch(/^https:\/\/api\.kimi\.com\/coding\/v1\/messages/);
  expect(calls[0].headers.get('x-api-key')).toBe(cfg.apiKey); expect(calls[0].body).toMatchObject({ model: 'k3.1-pro', system: expect.any(Array) });
  expect(calls[0].body).not.toHaveProperty('thinking'); expect(calls[0].body).not.toHaveProperty('output_config');
  expect(() => resolveModelThinking(cfg, 'off')).toThrow(/不支持/);
});

it('imports the Kimi K2.8 preset and sends its low effort through the native Anthropic adapter', async () => {
  const calls = captureHttp(); const { store, config } = await setup();
  const platform = store.preparePlatform(platformInput(store, { apiKey: 'offline-kimi-directory-key' }), 'default', true);
  await store.savePlatform(platform);
  const models = store.prepareImport(platform.id, store.catalog().version, ['kimi-for-coding']);
  await store.saveImport(models);
  const cfg = { ...config, ...store.config(models[0].id) };
  const runtime = await configuredRuntime(cfg);
  await runtime.completeSimple(runtime.getModel(cfg.provider, cfg.model)!, { messages: [{ role: 'user', content: 'test', timestamp: 1 }] }, {
    apiKey: cfg.apiKey, reasoning: modelReasoning(cfg), maxRetries: 0,
  });
  expect(calls[0].body).toMatchObject({ model: 'kimi-for-coding', thinking: { type: 'adaptive' }, output_config: { effort: 'low' } });
  expect(store.info()).toMatchObject({ provider: config.provider, model: config.model });
});

it('merges platform compat with model overrides and serializes declared generic reasoning through Pi', async () => {
  const calls = captureHttp(); const { store, config } = await setup();
  const platform = store.preparePlatform(platformInput(store, { provider: 'generic-openai', baseUrl: 'https://generic.invalid/v1', api: 'openai-completions', apiKey: 'offline-openai', enabled: true, compat: { supportsReasoningEffort: true, supportsUsageInStreaming: false } }), 'default', true); await store.savePlatform(platform);
  const next = store.prepare({ platformId: platform.id, model: 'same-model', contextWindow: 65536, maxOutputTokens: 1024, usageConfirmed: true, thinkingLevels: ['off', 'low', 'high', 'max'], defaultThinkingLevel: 'low', compat: { supportsUsageInStreaming: true }, expectedVersion: store.info().version }, 'default', true); await store.save(next);
  const cfg = { ...config, ...store.config(next.id) }; const runtime = await configuredRuntime(cfg); const model = runtime.getModel(cfg.provider, cfg.model)!;
  expect(getSupportedThinkingLevels(model)).toContain('max');
  await runtime.completeSimple(model, { messages: [{ role: 'user', content: 'test', timestamp: 1 }] }, { apiKey: cfg.apiKey, reasoning: modelReasoning(cfg), maxRetries: 0 });
  expect(calls[0].url).toBe('https://generic.invalid/v1/chat/completions'); expect(calls[0].body).toMatchObject({ model: 'same-model', reasoning_effort: 'low', stream_options: { include_usage: true } });
  const cleared = store.prepare({ platformId: platform.id, model: 'same-model', thinkingMode: null, defaultThinkingLevel: null, expectedVersion: store.info().version }, next.id); await store.save(cleared);
  expect(modelReasoning({ ...config, ...store.config(next.id) })).toBeUndefined();
});

it('rejects protocol-mismatched compat and unsupported model capability declarations', async () => {
  const { store } = await setup();
  expect(() => store.preparePlatform(platformInput(store, { compat: { supportsStore: false } }), 'default', true)).toThrow(/不支持兼容参数/);
  expect(() => store.preparePlatform(platformInput(store, { modelsPath: '//other.invalid/v1/models' }), 'default', true)).toThrow(/同一站点/);
  const { platformId } = await addKimi(store);
  expect(() => store.prepare({ platformId, model: 'k3.1-pro', thinkingLevels: ['off'], thinkingLevelMap: { off: null }, expectedVersion: store.info().version }, 'default', true)).toThrow(/不能映射/);
});


it('round-trips a supported 200-character remote model ID and its default display name', async () => {
  const {store, config} = await setup(); const remoteId = 'm'.repeat(200);
  const next = store.prepare({provider: config.provider, baseUrl: config.baseUrl, model: remoteId, apiKey: 'offline-long-model-key',
    contextWindow: 131072, maxOutputTokens: 128, usageConfirmed: true, expectedVersion: store.catalog().version}, 'default', true);
  await store.save(next);
  const restored = await ModelSettingsStore.open(config);
  expect(restored.info(next.id)).toMatchObject({model: remoteId, displayName: remoteId});
});
