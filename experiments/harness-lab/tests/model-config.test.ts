import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { loadConfig, resolveModelParameters } from '../src/server/config.js';
import { ModelSettingsStore } from '../src/server/model-settings.js';
const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
async function directory() { const path = await mkdtemp(join(tmpdir(), 'berserk-context-config-')); directories.push(path); return path; }
const official = { provider: 'deepseek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com' };
const identity = { provider: 'custom', model: 'custom-model', baseUrl: 'https://custom.invalid/v1' };
const stored = () => ({ schemaVersion: 1, version: randomUUID(), ...identity, apiKey: 'private-key' });
it('applies verified preset only to the official model and endpoint, independently of key presence', () => {
  expect(loadConfig({LAB_AUTH_MODE:'test',})).toMatchObject({ ...official, contextWindow: 1000000, maxOutputTokens: 393216,
    compactionReserveTokens: 16384, compactionKeepRecentTokens: 20000, contextSource: 'preset', outputSource: 'preset', contextReady: true, apiKey: '' });
  expect(resolveModelParameters({ ...official, baseUrl: 'https://api.deepseek.com:443/v1/' })).toMatchObject({ contextReady: true });
  for (const fields of [{ ...official, provider: 'other' }, { ...official, model: 'deepseek-chat' }, { ...official, baseUrl: 'https://proxy.invalid' }, { ...official, baseUrl: 'https://api.deepseek.com/other' }]) {
    expect(resolveModelParameters(fields)).toMatchObject({ contextWindow: null, maxOutputTokens: null, contextReady: false, contextSource: 'unknown', outputSource: 'unknown' });
  }
  expect(loadConfig({LAB_AUTH_MODE:'test', LLM_CONTEXT_WINDOW: '8192', LLM_MAX_OUTPUT_TOKENS: '4096' })).toMatchObject({ contextWindow: 8192, maxOutputTokens: 4096,
    compactionReserveTokens: 2048, compactionKeepRecentTokens: 3072, contextReady: true, contextSource: 'explicit', outputSource: 'explicit' });
});
it('validates small-window parameters without requiring output <= reserve', () => {
  expect(resolveModelParameters(identity, { contextWindow: 8192, maxOutputTokens: 8192 })).toMatchObject({ contextReady: true, compactionReserveTokens: 2048, compactionKeepRecentTokens: 3072 });
  for (const fields of [{ contextWindow: 8191 }, { contextWindow: 2000001 }, { maxOutputTokens: 1.5 },
    { contextWindow: 8192, maxOutputTokens: 8193 }, { contextWindow: 8192, compactionReserveTokens: 4096, compactionKeepRecentTokens: 4096 }]) expect(() => resolveModelParameters(identity, fields)).toThrow();
  expect(() => loadConfig({LAB_AUTH_MODE:'test', LLM_CONTEXT_WINDOW: 'invalid' })).toThrow('LLM_CONTEXT_WINDOW');
  expect(() => loadConfig({LAB_AUTH_MODE:'test', LLM_MAX_OUTPUT_TOKENS: '0' })).toThrow('LLM_MAX_OUTPUT_TOKENS');
});
it('reads v1 without rewriting, only supplements matching environment identity and saves v2', async () => {
  const dataDir = await directory(); const path = join(dataDir, 'model-settings.json');
  const original = JSON.stringify(stored()); await writeFile(path, original);
  const env = loadConfig({LAB_AUTH_MODE:'test', LAB_DATA_DIR: dataDir, LLM_PROVIDER: identity.provider, LLM_MODEL: identity.model,
    LLM_BASE_URL: identity.baseUrl + '/', LLM_CONTEXT_WINDOW: '65536', LLM_MAX_OUTPUT_TOKENS: '8192' });
  const store = await ModelSettingsStore.open(env);
  expect(store.info()).toMatchObject({ contextWindow: 65536, maxOutputTokens: 8192, contextReady: true, contextSource: 'explicit' });
  expect(await readFile(path, 'utf8')).toBe(original);
  expect((await ModelSettingsStore.open({ ...env, model: 'different-model' })).info()).toMatchObject({ contextWindow: null, maxOutputTokens: null, contextReady: false });
  await store.save(store.prepare({ ...identity, expectedVersion: store.info().version }));
  expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ schemaVersion: 2, contextWindow: 65536, maxOutputTokens: 8192 });
  expect((await ModelSettingsStore.open({ ...env, contextWindow: 8192, maxOutputTokens: 1024 })).info()).toEqual(store.info());
});
it('v2 unknown fields never borrow environment values; changing model drops old capabilities', async () => {
  const dataDir = await directory(); const path = join(dataDir, 'model-settings.json');
  await writeFile(path, JSON.stringify({ ...stored(), schemaVersion: 2 }));
  const env = loadConfig({LAB_AUTH_MODE:'test', LAB_DATA_DIR: dataDir, LLM_PROVIDER: identity.provider, LLM_MODEL: identity.model,
    LLM_BASE_URL: identity.baseUrl, LLM_CONTEXT_WINDOW: '65536', LLM_MAX_OUTPUT_TOKENS: '8192' });
  const store = await ModelSettingsStore.open(env);
  expect(store.info().contextReady).toBe(false);
  await store.save(store.prepare({ ...identity, expectedVersion: store.info().version, contextWindow: 65536, maxOutputTokens: 8192 }));
  expect(store.prepare({ ...identity, expectedVersion: store.info().version })).toMatchObject({ contextReady: true, contextWindow: 65536 });
  const changed = store.prepare({ ...identity, model: 'another-model', expectedVersion: store.info().version });
  expect(changed).toMatchObject({ contextWindow: null, maxOutputTokens: null, compactionReserveTokens: null, compactionKeepRecentTokens: null, contextReady: false });
  await store.save(changed);
  expect((await ModelSettingsStore.open(env)).info().contextReady).toBe(false);
});
it('preserves preset provenance and rejects corrupt numeric fields instead of defaulting', async () => {
  const dataDir = await directory(); const config = loadConfig({LAB_AUTH_MODE:'test', LAB_DATA_DIR: dataDir, LLM_API_KEY: 'private' });
  const store = await ModelSettingsStore.open(config);
  await store.save(store.prepare({ ...official, expectedVersion: store.info().version }));
  expect((await ModelSettingsStore.open(config)).info()).toEqual(store.info());
  const path = join(dataDir, 'model-settings.json');
  for (const fields of [{ contextWindow: null }, { maxOutputTokens: '8192' }, { compactionReserveTokens: -1 }, { contextWindow: 8192, maxOutputTokens: 9000 }]) {
    await writeFile(path, JSON.stringify({ ...stored(), schemaVersion: 2, ...fields }));
    await expect(ModelSettingsStore.open(config)).rejects.toMatchObject({ code: 'MODEL_SETTINGS_INVALID' });
  }
});
