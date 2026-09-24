import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelSettings, ModelSettingsUpdate, ModelCatalog, ModelChoices } from '../contracts/index.js';
import { RequestError } from '../contracts/errors.js';
import { atomicWrite, checkDirectory, parseJsonStrict, readControlled } from '../resources/files.js';
import { normalizeModelEndpoint, resolveModelParameters, modelParameterKeys, type LabConfig, type ModelParameterOverrides, type ResolvedModelParameters } from './config.js';

type ModelIdentity = Pick<LabConfig, 'provider' | 'model' | 'baseUrl'>;
export type ModelConfig = ModelIdentity & Pick<LabConfig, 'apiKey'> & ResolvedModelParameters;
interface StoredSettings extends ModelConfig { schemaVersion: 2; version: string }
interface PreparedSettings extends StoredSettings { id: string }
const maxSettingsBytes = 1024 * 1024;
const versionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const invalid = () => new RequestError('INVALID_INPUT', '模型配置格式不正确，请检查服务商、模型 ID、HTTPS 地址和 API Key。');
const stateError = () => new RequestError('MODEL_SETTINGS_INVALID', '本地模型配置无法安全读取，请检查配置文件后重启服务。', 503);
const conflict = () => new RequestError('MODEL_SETTINGS_CONFLICT', '模型配置已更新，请重新读取后再保存。', 409);

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw invalid();
  return value as Record<string, unknown>;
}
function modelFields(value: Record<string, unknown>): ModelIdentity {
  if (typeof value.provider !== 'string' || typeof value.model !== 'string' || typeof value.baseUrl !== 'string') throw invalid();
  const provider = value.provider.trim(); const model = value.model.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(provider) || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(model)) throw invalid();
  try { return { provider, model, baseUrl: normalizeModelEndpoint(value.baseUrl.trim()) }; } catch { throw invalid(); }
}
function key(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096) throw invalid();
  const trimmed = value.trim();
  if (trimmed && !/^[\x21-\x7e]+$/.test(trimmed)) throw invalid();
  return trimmed;
}
function overrides(value: Record<string, unknown>): ModelParameterOverrides {
  const result: ModelParameterOverrides = {};
  for (const field of modelParameterKeys) {
    if (value[field] === undefined) continue;
    if (typeof value[field] !== 'number' || !Number.isSafeInteger(value[field])) throw invalid();
    result[field] = value[field];
  }
  return result;
}
function explicitParameters(value: ResolvedModelParameters): ModelParameterOverrides {
  return { ...(value.contextSource === 'explicit' && value.contextWindow !== null ? { contextWindow: value.contextWindow } : {}),
    ...(value.outputSource === 'explicit' && value.maxOutputTokens !== null ? { maxOutputTokens: value.maxOutputTokens } : {}),
    ...(value.compactionReserveTokens === null ? {} : { compactionReserveTokens: value.compactionReserveTokens }),
    ...(value.compactionKeepRecentTokens === null ? {} : { compactionKeepRecentTokens: value.compactionKeepRecentTokens }) };
}
function resolve(identity: ModelIdentity, values: ModelParameterOverrides): ResolvedModelParameters {
  try { return resolveModelParameters(identity, values); }
  catch (error) { throw new RequestError('INVALID_INPUT', error instanceof Error ? error.message : '模型容量或压缩参数不正确。'); }
}
function sameIdentity(a: ModelIdentity, b: ModelIdentity) {
  return a.provider === b.provider && a.model === b.model && a.baseUrl === b.baseUrl;
}
function decode(text: string, environment?: LabConfig, allowUnconfigured = false): StoredSettings {
  const value = object(parseJsonStrict(text), ['schemaVersion', 'version', 'provider', 'model', 'baseUrl', 'apiKey', ...modelParameterKeys]);
  if ((value.schemaVersion !== 1 && value.schemaVersion !== 2) || typeof value.version !== 'string' || !versionPattern.test(value.version)) throw invalid();
  if (value.schemaVersion === 1 && modelParameterKeys.some(field => value[field] !== undefined)) throw invalid();
  const apiKey = key(value.apiKey);
  if (!apiKey && !allowUnconfigured) throw invalid();
  const identity = modelFields(value);
  const parameters = value.schemaVersion === 1 && environment && sameIdentity(identity, modelFields({ ...environment }))
    ? explicitParameters(environment) : overrides(value);
  return { schemaVersion: 2, version: value.version, ...identity, apiKey, ...resolve(identity, parameters) };
}
function encode(next: StoredSettings): string {
  const { schemaVersion, version, provider, model, baseUrl, apiKey } = next;
  return `${JSON.stringify({ schemaVersion, version, provider, model, baseUrl, apiKey, ...explicitParameters(next) }, null, 2)}\n`;
}

/** Catalogs reuse the single-profile validator, endpoint/key policy and atomic writer. */
function decodeCatalog(text: string, environment?: LabConfig): { current: StoredSettings; profiles: Map<string, StoredSettings> } {
  const value = parseJsonStrict(text) as Record<string, unknown>;
  if (!value || value.schemaVersion !== 3) return { current: decode(text, environment), profiles: new Map() };
  object(value, ['schemaVersion', 'version', 'models']);
  if (typeof value.version !== 'string' || !versionPattern.test(value.version) || !Array.isArray(value.models) || !value.models.length) throw invalid();
  const profiles = new Map<string, StoredSettings>();
  for (const raw of value.models) {
    const item = object(raw, ['id', 'provider', 'model', 'baseUrl', 'apiKey', ...modelParameterKeys]);
    const { id, ...fields } = item;
    if (typeof id !== 'string' || (id !== 'default' && !versionPattern.test(id)) || profiles.has(id)) throw invalid();
    profiles.set(id, decode(JSON.stringify({ ...fields, schemaVersion: 2, version: value.version }), undefined, id === 'default'));
  }
  const current = profiles.get('default'); if (!current) throw invalid();
  profiles.delete('default'); return { current, profiles };
}
function encodeCatalog(current: StoredSettings, profiles: Map<string, StoredSettings>): string {
  if (!profiles.size) return encode(current);
  const models = [['default', current], ...profiles] as Array<[string, StoredSettings]>;
  return `${JSON.stringify({ schemaVersion: 3, version: current.version, models: models.map(([id, model]) => {
    const { provider, model: name, baseUrl, apiKey } = model;
    return { id, provider, model: name, baseUrl, apiKey, ...explicitParameters(model) };
  }) }, null, 2)}\n`;
}

/** One process owns the directory. PiLab serializes updates against request starts. */
export class ModelSettingsStore {
  private constructor(private readonly path: string, private current: StoredSettings, private raw: string | null, private profiles = new Map<string, StoredSettings>()) {}

  static async open(config: LabConfig): Promise<ModelSettingsStore> {
    try {
      await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
      await checkDirectory(config.dataDir);
      const path = join(config.dataDir, 'model-settings.json');
      const raw = await readControlled(path, maxSettingsBytes, true);
      const identity = modelFields({ ...config });
      const stored = raw === null ? undefined : decodeCatalog(raw, config);
      const current = !stored ? { schemaVersion: 2 as const, version: randomUUID(), ...identity, apiKey: key(config.apiKey), ...resolve(identity, explicitParameters(config)) } : stored.current;
      return new ModelSettingsStore(path, current, raw, stored?.profiles);
    } catch { throw stateError(); }
  }

  private profile(id: string): StoredSettings {
    const value = id === 'default' ? this.current : this.profiles.get(id);
    if (!value) throw new RequestError('MODEL_NOT_FOUND', '所选模型已不存在，请重新选择。', 404);
    return value;
  }

  catalog(): ModelCatalog {
    return { version: this.current.version, models: ['default', ...this.profiles.keys()].map(id => ({ id, ...this.info(id) })) };
  }

  choices(): ModelChoices {
    return { defaultModelId: 'default', models: this.catalog().models.map(({ id, provider, model, configured, contextReady, contextWindow, maxOutputTokens }) => ({ id, provider, model, configured, contextReady, contextWindow, maxOutputTokens })) };
  }

  info(id = 'default'): ModelSettings {
    const current = this.profile(id);
    const { provider, model, baseUrl, apiKey } = current;
    const version = this.current.version;
    const { contextWindow, maxOutputTokens, compactionReserveTokens, compactionKeepRecentTokens, contextSource, outputSource, contextReady } = current;
    return { provider, model, baseUrl, version, configured: Boolean(apiKey), source: this.raw === null ? 'environment' : 'local', contextWindow, maxOutputTokens, compactionReserveTokens, compactionKeepRecentTokens, contextSource, outputSource, contextReady };
  }

  config(id = 'default'): ModelConfig {
    const current = this.profile(id);
    const { provider, model, baseUrl, apiKey } = current;
    const { contextWindow, maxOutputTokens, compactionReserveTokens, compactionKeepRecentTokens, contextSource, outputSource, contextReady } = current;
    return { provider, model, baseUrl, apiKey, contextWindow, maxOutputTokens, compactionReserveTokens, compactionKeepRecentTokens, contextSource, outputSource, contextReady };
  }

  prepare(input: ModelSettingsUpdate, id = 'default', create = false): PreparedSettings {
    const value = object(input, ['provider', 'model', 'baseUrl', 'apiKey', 'expectedVersion', ...modelParameterKeys]);
    const fields = modelFields(value);
    if (typeof value.expectedVersion !== 'string' || !versionPattern.test(value.expectedVersion)) throw invalid();
    if (value.expectedVersion !== this.current.version) throw conflict();
    const current = create ? undefined : this.profile(id);
    const suppliedKey = value.apiKey === undefined ? '' : key(value.apiKey);
    const sameDestination = current && fields.provider === current.provider && fields.baseUrl === current.baseUrl;
    if (!suppliedKey && (!sameDestination || !current?.apiKey)) {
      throw new RequestError('MODEL_API_KEY_REQUIRED', '请填写 API Key；更换服务商或地址时需要重新填写对应密钥。');
    }
    const parameters = { ...(current && sameIdentity(fields, current) ? explicitParameters(current) : {}), ...overrides(value) };
    return { schemaVersion: 2, version: randomUUID(), id: create ? randomUUID() : id, ...fields, apiKey: suppliedKey || current!.apiKey, ...resolve(fields, parameters) };
  }

  async save(next: PreparedSettings): Promise<void> {
    const checkCurrent = async () => {
      const disk = await readControlled(this.path, maxSettingsBytes, true);
      if (disk !== null) decodeCatalog(disk);
      if (disk !== this.raw) throw conflict();
    };
    try {
      await checkCurrent();
      const profiles = new Map(this.profiles);
      const current = next.id === 'default' ? next : { ...this.current, version: next.version };
      if (next.id !== 'default') profiles.set(next.id, next);
      const raw = encodeCatalog(current, profiles);
      if (Buffer.byteLength(raw) > maxSettingsBytes) throw invalid();
      // Recheck the leaf after preparing the private temporary file; never follow a symlink.
      await atomicWrite(this.path, raw, undefined, { beforeRename: checkCurrent });
      this.current = current; this.profiles = profiles; this.raw = raw;
    } catch (error) {
      if (error instanceof RequestError && error.code === 'MODEL_SETTINGS_CONFLICT') throw error;
      throw new RequestError('MODEL_SETTINGS_SAVE_FAILED', '模型配置未保存，请检查本地配置文件和目录权限后重试。', 503);
    }
  }
}
