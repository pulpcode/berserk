import { mkdtemp, rm, readFile, writeFile, stat, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { PiLab } from '../../src/pi/lab.js';
import { createApp } from '../../src/server/app.js';
import { ModelSettingsStore } from '../../src/server/model-settings.js';
import type { ModelSettings, ModelSettingsUpdate } from '../../src/contracts/index.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0).reverse()) await fn();
  vi.unstubAllGlobals();
});
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), 'berserk-settings-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function setup(overrides: Partial<ReturnType<typeof testConfig>> = {}) {
  const dir = await directory();
  const config = testConfig(dir, overrides);
  const lab = await PiLab.create(config);
  const app = await createApp(lab); cleanup.push(() => app.close());
  return { dir, config, lab, app };
}
const update = (settings: ModelSettings, changes: Partial<ModelSettingsUpdate> = {}): ModelSettingsUpdate => ({
  provider: settings.provider, model: settings.model, baseUrl: settings.baseUrl, expectedVersion: settings.version, ...changes,
});
function captureProvider() {
  const calls: Array<{ url: string; authorization: string | null; body: { model: string; messages: unknown[]; thinking?: unknown } }> = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const body = JSON.parse(await request.text());
    calls.push({ url: request.url, authorization: request.headers.get('authorization'), body });
    const data = [
      { id: 'settings-test', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content: '新配置响应' }, finish_reason: null }] },
      { id: 'settings-test', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } },
    ];
    return new Response(data.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  });
  return calls;
}

it('uses the new endpoint, key and model on the next real adapter call and restores them after restart', async () => {
  const calls = captureProvider();
  const { app, lab, dir, config } = await setup({ provider: 'deepseek', baseUrl: 'https://old-model.invalid/v1' });
  const read = await app.inject('/api/settings/model');
  const original = read.json<ModelSettings>();
  expect(read.headers['cache-control']).toBe('no-store');
  expect(original).toMatchObject({ provider: 'deepseek', model: config.model, baseUrl: config.baseUrl, configured: true, version: expect.any(String), source: 'environment' });
  expect(read.payload).not.toContain(config.apiKey);
  const session = await lab.createSession();
  await lab.start(session.id, '切换前').run(() => {});
  expect(calls[0]).toMatchObject({ url: 'https://old-model.invalid/v1/chat/completions', authorization: `Bearer ${config.apiKey}`, body: { model: config.model, thinking: { type: 'disabled' } } });
  const saved = await app.inject({ method: 'PUT', url: '/api/settings/model', payload: update(original, { provider: 'compatible-new', model: 'model-v2', baseUrl: 'https://NEW-model.invalid:443/v2/', apiKey: 'new-secret-only', contextWindow: 131072, maxOutputTokens: 8192 }) });
  expect(saved.statusCode).toBe(200);
  const next = saved.json<ModelSettings>();
  expect(next).toMatchObject({ provider: 'compatible-new', model: 'model-v2', baseUrl: 'https://new-model.invalid/v2', source: 'local', configured: true });
  expect(next.version).not.toBe(original.version);
  expect(saved.payload).not.toContain('new-secret-only'); expect(saved.payload).not.toContain('apiKey');
  expect((await app.inject('/api/info')).json()).toMatchObject({ model: 'model-v2', configured: true });
  expect(config.model).not.toBe('model-v2'); // The caller's environment object remains unchanged.
  await lab.start(session.id, '切换后').run(() => {});
  expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
  expect(calls[1]).toMatchObject({ url: 'https://new-model.invalid/v2/chat/completions', authorization: 'Bearer new-secret-only', body: { model: 'model-v2' } });
  expect(calls[1].body).not.toHaveProperty('thinking');
  const path = join(dir, 'model-settings.json');
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ schemaVersion: 2, version: next.version, apiKey: 'new-secret-only', contextWindow: 131072, maxOutputTokens: 8192 });
  await app.close();
  const restarted = await PiLab.create({ ...config, apiKey: 'different-env-key' }); cleanup.push(() => restarted.close());
  expect(restarted.modelSettings()).toEqual(next);
  await restarted.start(session.id, '重启后').run(() => {});
  expect(calls[2]).toMatchObject({ url: calls[1].url, authorization: calls[1].authorization, body: { model: 'model-v2' } });
  expect(restarted.get(session.id).messages.filter(message => message.role === 'user').map(message => message.text)).toEqual(['切换前', '切换后', '重启后']);
  for (const file of await readdir(join(dir, 'sessions'))) {
    const history = await readFile(join(dir, 'sessions', file), 'utf8');
    expect(history).not.toContain('new-secret-only'); expect(history).not.toContain(config.apiKey);
  }
});

it('retains a key only for the same provider and normalized destination, and rejects stale saves', async () => {
  const calls = captureProvider();
  const { app, lab, config } = await setup({ baseUrl: 'https://SAME.invalid:443/v1/' });
  const original = lab.modelSettings();
  const request = update(original, { model: 'other-model', baseUrl: 'https://same.invalid/v1', apiKey: '   ', contextWindow: 131072, maxOutputTokens: 8192 });
  const first = await app.inject({ method: 'PUT', url: '/api/settings/model', payload: request });
  expect(first.statusCode).toBe(200);
  const next = first.json<ModelSettings>();
  for (const fields of [{ provider: 'other-provider' }, { baseUrl: 'https://elsewhere.invalid/v1' }]) {
    const result = await app.inject({ method: 'PUT', url: '/api/settings/model', payload: update(next, fields) });
    expect(result.statusCode).toBe(400); expect(result.json().error.code).toBe('MODEL_API_KEY_REQUIRED');
  }
  const stale = await app.inject({ method: 'PUT', url: '/api/settings/model', payload: request });
  expect(stale.statusCode).toBe(409); expect(stale.json().error.code).toBe('MODEL_SETTINGS_CONFLICT');
  expect(lab.modelSettings()).toEqual(next);
  const session = await lab.createSession(); await lab.start(session.id, '检查密钥保留').run(() => {});
  expect(calls[0]).toMatchObject({ authorization: `Bearer ${config.apiKey}`, body: { model: 'other-model' } });
});

it('configures an initially unconfigured environment without returning the write-only key', async () => {
  const { app, lab } = await setup({ apiKey: '' });
  const original = lab.modelSettings(); expect(original.configured).toBe(false);
  const missing = await app.inject({ method: 'PUT', url: '/api/settings/model', payload: update(original) });
  expect(missing.statusCode).toBe(400); expect(missing.json().error.code).toBe('MODEL_API_KEY_REQUIRED');
  const saved = await app.inject({ method: 'PUT', url: '/api/settings/model', payload: update(original, { apiKey: 'first-key' }) });
  expect(saved.statusCode).toBe(200); expect(saved.json()).toMatchObject({ configured: true, source: 'local' });
  expect(saved.payload).not.toContain('first-key');
  expect((await app.inject('/api/settings/model')).payload).not.toContain('first-key');
});

it('rejects unsafe or extra fields and untrusted origins without changing configuration', async () => {
  const { app, lab, dir } = await setup();
  const original = lab.modelSettings();
  const invalid = [
    { provider: '' }, { provider: 'a'.repeat(81) }, { provider: 'invalid provider' },
    { model: 'a'.repeat(201) }, { model: '\n' }, { baseUrl: 'http://plain.invalid' },
    { baseUrl: 'https://user:secret@host.invalid' }, { baseUrl: 'https://host.invalid?key=secret' },
    { baseUrl: 'https://host.invalid#secret' }, { baseUrl: 'https://host.invalid?' },
    { baseUrl: 'https://host.invalid/#' }, { baseUrl: 'https://host.invalid\\route' },
    { contextWindow: null }, { contextWindow: '131072' }, { contextWindow: 8191 }, { maxOutputTokens: 0 }, { compactionReserveTokens: 1.5 }, { compactionKeepRecentTokens: null },
    { contextWindow: 8192, maxOutputTokens: 9000, compactionReserveTokens: 1000, compactionKeepRecentTokens: 1000 },
    { contextWindow: 8192, maxOutputTokens: 1000, compactionReserveTokens: 4000, compactionKeepRecentTokens: 4192 },
    { apiKey: 'invalid\nkey' }, { apiKey: 's'.repeat(4097) }, { apiKey: null },
    { expectedVersion: 'not-version' }, { extra: true }, { dataDir: '/tmp/elsewhere' },
  ];
  for (const changes of invalid) {
    const response = await app.inject({ method: 'PUT', url: '/api/settings/model', payload: { ...update(original), ...changes } });
    expect(response.statusCode, JSON.stringify(changes)).toBe(400);
    expect(response.payload).not.toContain('secret');
  }
  expect((await app.inject('/api/settings/model?apiKey=secret')).statusCode).toBe(400);
  expect((await app.inject({ method: 'PUT', url: '/api/settings/model', headers: { origin: 'https://attacker.invalid' }, payload: update(original) })).statusCode).toBe(403);
  expect(lab.modelSettings()).toEqual(original);
  expect(await readdir(dir)).not.toContain('model-settings.json');
});

it('blocks configuration updates while any session is reserved or running', async () => {
  const dir = await directory(); const config = testConfig(dir);
  const fake = await fakeRuntime(config, () => ({ waitForAbort: true }));
  const lab = await PiLab.create(config, fake.runtime); const app = await createApp(lab); cleanup.push(() => app.close());
  const session = await lab.createSession(); const original = lab.modelSettings();
  const pending = lab.start(session.id, '执行中');
  let response = await app.inject({ method: 'PUT', url: '/api/settings/model', payload: update(original, { model: 'changed' }) });
  expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe('MODEL_SETTINGS_BUSY');
  const work = pending.run(() => {}); await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
  response = await app.inject({ method: 'PUT', url: '/api/settings/model', payload: update(original, { model: 'changed' }) });
  expect(response.statusCode).toBe(409);
  lab.cancel(session.id, pending.requestId); await work;
  expect(lab.modelSettings()).toEqual(original);
  expect((await app.inject({ method: 'PUT', url: '/api/settings/model', payload: update(original, { model: 'changed' }) })).statusCode).toBe(200);
});

it('reserves the update across disk writes, rejects concurrent starts and saves, and settles before publishing', async () => {
  const { app, lab } = await setup(); const session = await lab.createSession(); const original = lab.modelSettings();
  expect(lab.canStartBackground()).toBe(true);
  const save = ModelSettingsStore.prototype.save;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const spy = vi.spyOn(ModelSettingsStore.prototype, 'save').mockImplementation(async function (this: ModelSettingsStore, next) {
    await gate; await save.call(this, next);
  });
  const saving = lab.updateModelSettings(update(original, { model: 'after-save' }));
  expect(lab.canStartBackground()).toBe(false);
  await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  try {
    expect(lab.modelSettings()).toEqual(original);
    const start = await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, payload: { text: '不能跨过保存' } });
    expect(start.statusCode).toBe(409); expect(start.json().error.code).toBe('MODEL_SETTINGS_BUSY');
    expect(lab.get(session.id).active).toBeNull();
    const concurrent = await app.inject({ method: 'PUT', url: '/api/settings/model', payload: update(original, { model: 'racing-save' }) });
    expect(concurrent.statusCode).toBe(409); expect(concurrent.json().error.code).toBe('MODEL_SETTINGS_BUSY');
  } finally { release(); await saving; }
  expect(lab.canStartBackground()).toBe(true);
  expect(lab.modelSettings().model).toBe('after-save');
});

it('leaves runtime and secret files unchanged when persistence fails, and releases the update reservation', async () => {
  const calls = captureProvider(); const { app, lab, dir, config } = await setup();
  const original = lab.modelSettings(); const outside = join(dir, 'outside-secret');
  await writeFile(outside, 'DO_NOT_REPLACE'); await symlink(outside, join(dir, 'model-settings.json'));
  const failed = await app.inject({ method: 'PUT', url: '/api/settings/model', payload: update(original, { model: 'not-applied', apiKey: 'not-applied-secret' }) });
  expect(failed.statusCode).toBe(503); expect(failed.json().error.code).toBe('MODEL_SETTINGS_SAVE_FAILED');
  expect(failed.payload).not.toContain(dir); expect(failed.payload).not.toContain('not-applied-secret');
  expect(await readFile(outside, 'utf8')).toBe('DO_NOT_REPLACE');
  expect(lab.modelSettings()).toEqual(original);
  const session = await lab.createSession(); await lab.start(session.id, '仍可使用旧配置').run(() => {});
  expect(calls[0]).toMatchObject({ authorization: `Bearer ${config.apiKey}`, body: { model: config.model } });
  expect((await readdir(dir)).filter(name => name.endsWith('.tmp'))).toEqual([]);
});

it('fails closed on corrupted, duplicate-key, oversized or symlinked local settings', async () => {
  const dir = await directory(); const config = testConfig(dir); const path = join(dir, 'model-settings.json');
  for (const text of ['{', '{}', '{"schemaVersion":1,"schemaVersion":1}', 'x'.repeat(16385)]) {
    await writeFile(path, text);
    await expect(PiLab.create(config)).rejects.toMatchObject({ code: 'MODEL_SETTINGS_INVALID' });
    expect(await readFile(path, 'utf8')).toBe(text);
  }
  await rm(path); const outside = join(dir, 'outside'); await writeFile(outside, '{}'); await symlink(outside, path);
  await expect(PiLab.create(config)).rejects.toMatchObject({ code: 'MODEL_SETTINGS_INVALID' });
  const alias = join(dir, 'alias'); await symlink(dir, alias);
  await expect(PiLab.create({ ...config, dataDir: alias })).rejects.toMatchObject({ code: 'MODEL_SETTINGS_INVALID' });
});

it('keeps history readable but rejects unknown capacity before reserving or writing a message', async () => {
  const calls = captureProvider(); const { app, lab } = await setup();
  const session = await lab.createSession();
  await lab.start(session.id, '已有历史').run(() => {});
  const changed = await app.inject({ method: 'PUT', url: '/api/settings/model', payload: update(lab.modelSettings(), { model: 'unknown-capacity-model' }) });
  expect(changed.statusCode).toBe(200);
  expect(changed.json()).toMatchObject({ contextReady: false, contextWindow: null, maxOutputTokens: null, contextSource: 'unknown', outputSource: 'unknown' });
  const before = lab.get(session.id);
  const blocked = await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, payload: { text: '不能入库的草稿' } });
  expect(blocked.statusCode).toBe(400); expect(blocked.json().error.code).toBe('MODEL_CONTEXT_REQUIRED');
  expect(lab.get(session.id)).toEqual(before);
  expect(calls).toHaveLength(1);
  expect((await app.inject(`/api/sessions/${session.id}`)).statusCode).toBe(200);
  const fixed = await app.inject({ method: 'PUT', url: '/api/settings/model', payload: update(lab.modelSettings(), { contextWindow: 65536, maxOutputTokens: 8192 }) });
  expect(fixed.statusCode).toBe(200); expect(fixed.json().contextReady).toBe(true);
  // Saving settings never replays the rejected message.
  expect(calls).toHaveLength(1);
  expect(lab.get(session.id).messages).toEqual(before.messages);
  await lab.start(session.id, '用户重新发送').run(() => {});
  expect(calls).toHaveLength(2);
});
