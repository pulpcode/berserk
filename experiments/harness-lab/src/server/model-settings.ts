import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelSettings, ModelSettingsUpdate, ModelCatalog, ModelChoices, ModelPlatform, ModelPlatformUpdate, ModelCapabilities, ModelCompatibility } from '../contracts/index.js';
import { modelProfileIdPattern } from '../contracts/index.js';
import { RequestError } from '../contracts/errors.js';
import { builtinModel, modelPlatformPreset } from '../contracts/model-presets.js';
import { atomicWrite, checkDirectory, parseJsonStrict, readControlled } from '../resources/files.js';
import { normalizeModelEndpoint, resolveModelParameters, resolveModelThinking, resolveModelCapabilities, validateModelCompat, modelParameterKeys, type LabConfig, type ModelParameterOverrides, type ResolvedModelParameters } from './config.js';
import { discoverPlatformModels, remoteModelIdPattern, validateModelsPath } from './model-discovery.js';

type ModelIdentity = Pick<LabConfig, 'provider' | 'model' | 'baseUrl'>;
export type ModelConfig = ModelIdentity & Pick<LabConfig, 'apiKey' | 'thinkingMode'> & ModelCapabilities & ResolvedModelParameters & {
  platformId?: string; displayName?: string; enabled?: boolean; usageConfirmed?: boolean; available?: boolean; platformCompat?: ModelCompatibility;
};
interface StoredPlatform extends Omit<ModelPlatform, 'configured' | 'version'> { apiKey: string }
export interface PreparedPlatform extends StoredPlatform { version: string }
interface StoredSettings extends ModelConfig { platformId: string }
export interface PreparedSettings extends StoredSettings { id: string; version: string; platform?: StoredPlatform }
interface StoredCatalog { version: string; defaultModelId: string; profiles: Map<string, StoredSettings>; platforms: Map<string, StoredPlatform> }
interface PreparedDefaultModel { modelId: string; expectedVersion: string; config: ModelConfig }
const maxSettingsBytes = 1024 * 1024;
const versionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const platformPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/;
const capabilityKeys = ['api', 'input', 'thinkingLevels', 'defaultThinkingLevel', 'thinkingLevelMap', 'compat'];
const modelKeys = ['provider', 'model', 'baseUrl', 'apiKey', 'thinkingMode', 'platformId', 'displayName', 'enabled', 'usageConfirmed', ...capabilityKeys, ...modelParameterKeys];
const invalid = () => new RequestError('INVALID_INPUT', '模型配置格式不正确，请检查平台、模型 ID 和 HTTPS 地址。');
const stateError = () => new RequestError('MODEL_SETTINGS_INVALID', '本地模型配置无法安全读取，请检查配置文件后重启服务。', 503);
const conflict = () => new RequestError('MODEL_SETTINGS_CONFLICT', '模型配置已更新，请重新读取后再保存。', 409);
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw invalid();
  return value as Record<string, unknown>;
}
function checked<T>(fn: () => T): T {
  try { return fn(); } catch (error) { if (error instanceof RequestError) throw error; throw new RequestError('INVALID_INPUT', error instanceof Error ? error.message : '模型配置不正确。'); }
}
function modelFields(value: Record<string, unknown>): ModelIdentity {
  if (typeof value.provider !== 'string' || typeof value.model !== 'string' || typeof value.baseUrl !== 'string') throw invalid();
  const provider = value.provider.trim(); const model = value.model.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(provider) || !remoteModelIdPattern.test(model)) throw invalid();
  return checked(() => ({ provider, model, baseUrl: normalizeModelEndpoint(value.baseUrl as string) }));
}
function key(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096 || !/^[\x21-\x7e]*$/.test(value.trim())) throw new RequestError('MODEL_API_KEY_INVALID', 'API Key 格式不正确，请填写平台提供的密钥。');
  return value.trim();
}
function label(value: unknown, fallback: string, maxLength = 200): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw invalid(); return value.trim();
}
function defined<T extends object>(value: T): T {
  for (const name of Object.keys(value) as Array<keyof T>) if (value[name] === undefined) delete value[name];
  return value;
}
function bool(value: unknown, fallback: boolean): boolean { if (value === undefined) return fallback; if (typeof value !== 'boolean') throw invalid(); return value; }
function overrides(value: Record<string, unknown>): ModelParameterOverrides {
  const result: ModelParameterOverrides = {};
  for (const field of modelParameterKeys) { if (value[field] === undefined) continue; if (typeof value[field] !== 'number' || !Number.isSafeInteger(value[field])) throw invalid(); result[field] = value[field]; }
  return result;
}
function explicitParameters(value: ResolvedModelParameters): ModelParameterOverrides {
  return { ...(value.contextSource === 'explicit' && value.contextWindow !== null ? { contextWindow: value.contextWindow } : {}),
    ...(value.outputSource === 'explicit' && value.maxOutputTokens !== null ? { maxOutputTokens: value.maxOutputTokens } : {}),
    ...(value.compactionReserveTokens === null ? {} : { compactionReserveTokens: value.compactionReserveTokens }),
    ...(value.compactionKeepRecentTokens === null ? {} : { compactionKeepRecentTokens: value.compactionKeepRecentTokens }) };
}
function thinking(identity: ModelIdentity & ModelCapabilities, mode: unknown) {
  const resolved = checked(() => resolveModelThinking(identity, mode)); return { thinkingMode: mode === undefined ? undefined : resolved.thinkingMode };
}
function sameIdentity(a: ModelIdentity, b: ModelIdentity) { return a.provider === b.provider && a.model === b.model && a.baseUrl === b.baseUrl; }
function knownModelsPath(platform: Pick<ModelPlatform, 'provider' | 'baseUrl' | 'api'>) {
  const preset = modelPlatformPreset(platform);
  return preset && 'modelsPath' in preset ? preset.modelsPath : undefined;
}
function platformFromLegacy(id: string, model: ModelConfig): StoredPlatform {
  const api = model.api ?? 'openai-completions';
  const modelsPath = knownModelsPath({ ...model, api });
  return { id, name: model.provider, provider: model.provider, baseUrl: model.baseUrl, api, modelsPath, apiKey: model.apiKey, enabled: true };
}
const platformKeys = ['id', 'name', 'provider', 'baseUrl', 'api', 'enabled', 'compat', 'modelsPath'];
const credentialRef = (id: string) => `platform:${id}`;
function readPlatform(raw: unknown): StoredPlatform {
  const value = object(raw, [...platformKeys, 'apiKey']);
  if (typeof value.id !== 'string' || !platformPattern.test(value.id) || !['openai-completions', 'anthropic-messages'].includes(value.api as string)) throw invalid();
  const identity = modelFields({ ...value, model: 'placeholder' });
  const capabilities = checked(() => resolveModelCapabilities({ api: value.api as ModelCapabilities['api'], compat: value.compat as ModelCompatibility }));
  const apiKey = value.apiKey === undefined ? '' : key(value.apiKey);
  return { id: value.id, name: label(value.name, identity.provider, 100), provider: identity.provider, baseUrl: identity.baseUrl, api: capabilities.api!,
    apiKey, modelsPath: validateModelsPath(value.modelsPath), enabled: bool(value.enabled, true), ...(capabilities.compat ? { compat: capabilities.compat } : {}) };
}
function readLegacyPlatform(raw: unknown): StoredPlatform {
  const { credentialEnv, ...fields } = object(raw, [...platformKeys, 'apiKey', 'credentialEnv']);
  if (credentialEnv !== undefined && (typeof credentialEnv !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(credentialEnv))) throw invalid();
  // Old environment references cannot contribute a model key on this version.
  const platform = readPlatform(fields);
  if (credentialEnv && platform.apiKey) throw invalid();
  return { ...platform, modelsPath: platform.modelsPath ?? knownModelsPath(platform) };
}
function decodeLegacy(text: string, environment?: LabConfig, allowUnconfigured = false): { model: StoredSettings; version: string } {
  const value = object(parseJsonStrict(text), ['schemaVersion', 'version', 'provider', 'model', 'baseUrl', 'apiKey', 'thinkingMode', ...modelParameterKeys]);
  if (![1, 2, 4].includes(value.schemaVersion as number) || typeof value.version !== 'string' || !versionPattern.test(value.version)) throw invalid();
  if (value.schemaVersion !== 4 && value.thinkingMode !== undefined || value.schemaVersion === 1 && modelParameterKeys.some(field => value[field] !== undefined)) throw invalid();
  const apiKey = key(value.apiKey); if (!apiKey && !allowUnconfigured) throw invalid();
  const identity = modelFields(value);
  const parameters = value.schemaVersion === 1 && environment && sameIdentity(identity, environment) ? explicitParameters(environment) : overrides(value);
  return { version: value.version, model: { platformId: 'default', ...identity, apiKey, ...checked(() => resolveModelParameters(identity, parameters)), ...thinking(identity, value.thinkingMode) } };
}
function readModel(raw: unknown, platforms: Map<string, StoredPlatform>): StoredSettings {
  const value = object(raw, ['id', ...modelKeys.filter(name => !['provider', 'baseUrl', 'apiKey', 'api'].includes(name))]);
  if (typeof value.platformId !== 'string' || !platforms.has(value.platformId)) throw invalid();
  const platform = platforms.get(value.platformId)!;
  const identity = modelFields({ provider: platform.provider, baseUrl: platform.baseUrl, model: value.model });
  const capabilities = checked(() => resolveModelCapabilities({ ...value, api: platform.api } as ModelCapabilities));
  const enabled = bool(value.enabled, true); const usageConfirmed = bool(value.usageConfirmed, true);
  return { platformId: platform.id, ...identity, apiKey: '', ...capabilities,
    displayName: label(value.displayName, identity.model), enabled, usageConfirmed,
    ...checked(() => resolveModelParameters(identity, overrides(value))), ...thinking({ ...identity, ...capabilities }, value.thinkingMode) };
}
function decodeCatalog(text: string, environment?: LabConfig): StoredCatalog {
  const value = parseJsonStrict(text) as Record<string, unknown>;
  const platforms = new Map<string, StoredPlatform>();
  const profiles = new Map<string, StoredSettings>();
  let defaultModelId = 'default';
  let version: string;
  if (value?.schemaVersion === 6 || value?.schemaVersion === 7 || value?.schemaVersion === 8) {
    const hasCredentials = value.schemaVersion >= 7;
    const hasDefaultPointer = value.schemaVersion === 8;
    object(value, ['schemaVersion', 'version', 'models', 'platforms', ...(hasCredentials ? ['credentials'] : []), ...(hasDefaultPointer ? ['defaultModelId'] : [])]);
    if (typeof value.version !== 'string' || !versionPattern.test(value.version) || !Array.isArray(value.models) || !value.models.length || !Array.isArray(value.platforms) || !value.platforms.length) throw invalid();
    version = value.version;
    if (hasDefaultPointer) {
      if (typeof value.defaultModelId !== 'string' || !modelProfileIdPattern.test(value.defaultModelId)) throw invalid();
      defaultModelId = value.defaultModelId;
    }
    const references = hasCredentials ? value.platforms.map(raw => {
      const row = object(raw, [...platformKeys, 'credentialRef']);
      if (typeof row.id !== 'string' || row.credentialRef !== credentialRef(row.id)) throw invalid();
      return row.credentialRef as string;
    }) : [];
    const credentials = hasCredentials ? object(value.credentials, references) : {};
    for (const raw of value.platforms) {
      let platform: StoredPlatform;
      if (hasCredentials) {
        const { credentialRef: ref, ...fields } = raw as Record<string, unknown>;
        platform = readPlatform({ ...fields, apiKey: credentials[ref as string] });
      } else platform = readLegacyPlatform(raw);
      if (platforms.has(platform.id)) throw invalid();
      platforms.set(platform.id, platform);
    }
    for (const raw of value.models) {
      const id = (raw as Record<string, unknown>)?.id;
      if (typeof id !== 'string' || !modelProfileIdPattern.test(id) || profiles.has(id)) throw invalid();
      profiles.set(id, readModel(raw, platforms));
    }
  } else if (value && (value.schemaVersion === 3 || value.schemaVersion === 5)) {
    object(value, ['schemaVersion', 'version', 'models']);
    if (typeof value.version !== 'string' || !versionPattern.test(value.version) || !Array.isArray(value.models) || !value.models.length) throw invalid();
    version = value.version;
    for (const raw of value.models) {
      const item = object(raw, ['id', 'provider', 'model', 'baseUrl', 'apiKey', 'thinkingMode', ...modelParameterKeys]); const { id, ...fields } = item;
      if (typeof id !== 'string' || !modelProfileIdPattern.test(id) || profiles.has(id)) throw invalid();
      const { model } = decodeLegacy(JSON.stringify({ ...fields, schemaVersion: value.schemaVersion === 3 ? 2 : 4, version }), undefined, id === 'default');
      model.platformId = id === 'default' ? 'default' : `legacy-${id}`; profiles.set(id, model); platforms.set(model.platformId, platformFromLegacy(model.platformId, model));
    }
  } else {
    const legacy = decodeLegacy(text, environment);
    version = legacy.version;
    profiles.set(defaultModelId, legacy.model);
    platforms.set(legacy.model.platformId, platformFromLegacy(legacy.model.platformId, legacy.model));
  }
  if (!profiles.has(defaultModelId)) throw invalid();
  return { version, defaultModelId, profiles, platforms };
}
function encodeCatalog({ version, defaultModelId, profiles, platforms }: StoredCatalog): string {
  const credentials: Record<string, string> = {};
  const storedPlatforms = [...platforms.values()].map(({ apiKey, ...platform }) => {
    const ref = credentialRef(platform.id);
    if (apiKey) credentials[ref] = apiKey;
    return { ...platform, credentialRef: ref };
  });
  return `${JSON.stringify({ schemaVersion: 8, version, defaultModelId, platforms: storedPlatforms, credentials, models: [...profiles].map(([id, model]) => ({
    id, platformId: model.platformId, model: model.model, displayName: model.displayName, enabled: model.enabled ?? true, usageConfirmed: model.usageConfirmed ?? true,
    input: model.input, thinkingLevels: model.thinkingLevels, defaultThinkingLevel: model.defaultThinkingLevel, thinkingLevelMap: model.thinkingLevelMap,
    compat: model.compat, thinkingMode: model.thinkingMode, ...explicitParameters(model),
  })) }, null, 2)}\n`;
}

/** One process owns the directory. PiLab serializes updates against request starts. */
export class ModelSettingsStore {
  private constructor(private readonly path: string, private raw: string | null, private stored: StoredCatalog) {}
  static async open(config: LabConfig): Promise<ModelSettingsStore> {
    try {
      await mkdir(config.dataDir, { recursive: true, mode: 0o700 }); await checkDirectory(config.dataDir);
      const path = join(config.dataDir, 'model-settings.json'); const raw = await readControlled(path, maxSettingsBytes, true);
      if (raw !== null) return new ModelSettingsStore(path, raw, decodeCatalog(raw, config));
      const identity = modelFields({ ...config }); const capabilities = checked(() => resolveModelCapabilities(config));
      const current: StoredSettings = { platformId: 'default', ...identity, ...capabilities,
        apiKey: key(config.apiKey), displayName: config.displayName, enabled: config.enabled, usageConfirmed: config.usageConfirmed, ...checked(() => resolveModelParameters(identity, explicitParameters(config))), ...thinking({ ...identity, ...capabilities }, config.thinkingMode) };
      return new ModelSettingsStore(path, null, { defaultModelId: 'default', version: randomUUID(),
        profiles: new Map([['default', current]]), platforms: new Map([['default', platformFromLegacy('default', current)]]) });
    } catch { throw stateError(); }
  }
  defaultModelId(): string { return this.stored.defaultModelId; }
  private profile(id: string): StoredSettings { const value = this.stored.profiles.get(id); if (!value) throw new RequestError('MODEL_NOT_FOUND', '所选模型已不存在，请重新选择。', 404); return value; }
  private platformRecord(id: string): StoredPlatform { const value = this.stored.platforms.get(id); if (!value) throw new RequestError('MODEL_PLATFORM_NOT_FOUND', '模型平台不存在，请重新选择。', 404); return value; }
  platform(id: string): ModelPlatform {
    const { apiKey, ...platform } = this.platformRecord(id);
    return { ...platform, configured: Boolean(apiKey), version: this.stored.version };
  }
  discover(id: string) {
    const platform = this.platformRecord(id);
    return discoverPlatformModels(platform, platform.apiKey);
  }
  modelIdsForPlatform(id: string): string[] { this.platformRecord(id); return [...this.stored.profiles.keys()].filter(modelId => this.profile(modelId).platformId === id); }
  catalog(): ModelCatalog { return { defaultModelId: this.defaultModelId(), version: this.stored.version, platforms: [...this.stored.platforms.keys()].map(id => this.platform(id)), models: [...this.stored.profiles.keys()].map(id => ({ id, ...this.info(id) })) }; }
  choices(): ModelChoices { return { defaultModelId: this.defaultModelId(), models: this.catalog().models.map(({ id, provider, model, platformId, platformName, displayName, available, configured, contextReady, contextWindow, maxOutputTokens }) => ({ id, provider, model, platformId, platformName, displayName, available, configured, contextReady, contextWindow, maxOutputTokens })) }; }
  info(id = this.defaultModelId()): ModelSettings {
    const config = this.config(id); const { apiKey: _apiKey, platformCompat: _platformCompat, ...safe } = config; void _apiKey; void _platformCompat;
    return defined({ ...safe, displayName: config.displayName ?? config.model, enabled: this.profile(id).enabled ?? true, ...resolveModelThinking(config, config.thinkingMode), thinkingExplicit: config.thinkingMode !== undefined,
      platformName: this.platformRecord(config.platformId!).name, configured: Boolean(config.apiKey), version: this.stored.version, source: this.raw === null ? 'environment' as const : 'local' as const });
  }
  config(id = this.defaultModelId(), platformOverride?: PreparedPlatform): ModelConfig {
    const model = this.profile(id); const platform = platformOverride?.id === model.platformId ? platformOverride : this.platformRecord(model.platformId);
    const identity = { provider: platform.provider, baseUrl: platform.baseUrl, model: model.model };
    const parameters = checked(() => resolveModelParameters(identity, explicitParameters(model)));
    const apiKey = platform.apiKey; const enabled = (model.enabled ?? true) && platform.enabled; const usageConfirmed = model.usageConfirmed ?? true;
    return { ...model, ...resolveModelCapabilities({ ...model, api: platform.api }), ...identity, ...parameters, api: platform.api, apiKey, platformCompat: platform.compat, displayName: model.displayName,
      enabled, usageConfirmed, available: enabled && usageConfirmed && Boolean(apiKey) && parameters.contextReady };
  }
  requestConfig(id: string): ModelConfig {
    const config = this.config(id);
    if (!config.enabled || !config.usageConfirmed) throw new RequestError('MODEL_UNAVAILABLE', '所选模型尚未开放使用，请选择其他模型或联系管理员。', 503);
    if (!config.apiKey) throw new RequestError('MODEL_NOT_CONFIGURED', '所选模型尚未配置，请选择其他模型或联系管理员。', 503);
    if (!config.contextReady) throw new RequestError('MODEL_CONTEXT_REQUIRED', '所选模型的上下文容量和最大输出量尚未配置完整。', 400);
    return config;
  }
  prepare(input: ModelSettingsUpdate, id = this.defaultModelId(), create = false): PreparedSettings {
    const value = object(input, ['expectedVersion', ...modelKeys]); this.checkVersion(value.expectedVersion);
    const current = create ? undefined : this.profile(id); const nextId = create ? randomUUID() : id;
    const linked = value.platformId !== undefined;
    if (linked && (typeof value.platformId !== 'string' || !platformPattern.test(value.platformId))) throw invalid();
    let platform = linked ? this.platformRecord(value.platformId as string) : current ? this.platformRecord(current.platformId) : undefined;
    let fields: ModelIdentity; let newPlatform: StoredPlatform | undefined;
    if (linked) {
      if (value.apiKey !== undefined || value.provider !== undefined && value.provider !== platform!.provider || value.baseUrl !== undefined && normalizeModelEndpoint(value.baseUrl as string) !== platform!.baseUrl || value.api !== undefined && value.api !== platform!.api) throw new RequestError('INVALID_INPUT', '平台地址、协议与凭证请在平台配置中修改。');
      fields = modelFields({ provider: platform!.provider, baseUrl: platform!.baseUrl, model: value.model });
    } else {
      fields = modelFields(value); const suppliedKey = value.apiKey === undefined ? '' : key(value.apiKey);
      const api = (value.api as ModelCapabilities['api']) ?? platform?.api ?? 'openai-completions';
      const sameDestination = current && fields.provider === platform!.provider && fields.baseUrl === platform!.baseUrl && api === platform!.api;
      if (!suppliedKey && (!sameDestination || !platform?.apiKey)) throw new RequestError('MODEL_API_KEY_REQUIRED', '请填写 API Key；更换服务商、地址或协议时需要重新填写对应密钥。');
      if (!sameDestination || suppliedKey) {
        newPlatform = { id: current && this.modelIdsForPlatform(current.platformId).length === 1 ? current.platformId : `legacy-${randomUUID()}`, name: fields.provider, provider: fields.provider, baseUrl: fields.baseUrl, api, modelsPath: sameDestination ? platform?.modelsPath : undefined, apiKey: suppliedKey || platform!.apiKey, enabled: platform?.enabled ?? true };
        platform = newPlatform;
      }
    }
    const same = current && sameIdentity(fields, this.config(id)) && current.platformId === platform!.id;
    const capabilityValues = Object.fromEntries(capabilityKeys.filter(name => name !== 'api').map(name => [name, value[name] !== undefined ? value[name] === null && name === 'defaultThinkingLevel' ? undefined : value[name] : same ? current[name as keyof StoredSettings] : undefined]));
    const capabilities = checked(() => resolveModelCapabilities({ ...capabilityValues, api: platform!.api }));
    const parameters = checked(() => resolveModelParameters(fields, { ...(same ? explicitParameters(current) : {}), ...overrides(value) }));
    const mode = value.thinkingMode === null ? undefined : value.thinkingMode !== undefined ? value.thinkingMode : same ? current.thinkingMode : undefined;
    const enabled = bool(value.enabled, current?.enabled ?? true); const usageConfirmed = bool(value.usageConfirmed, current ? same ? current.usageConfirmed ?? true : false : !linked);
    return { version: randomUUID(), id: nextId, platformId: platform!.id, ...fields, ...capabilities,
      displayName: label(value.displayName, current?.displayName ?? fields.model), enabled, usageConfirmed,
      apiKey: platform!.apiKey, platformCompat: platform!.compat, available: enabled && platform!.enabled && usageConfirmed && Boolean(platform!.apiKey) && parameters.contextReady,
      ...parameters, ...thinking({ ...fields, ...capabilities }, mode), ...(newPlatform ? { platform: newPlatform } : {}) };
  }
  preparePlatform(input: ModelPlatformUpdate, id = 'default', create = false): PreparedPlatform {
    const value = object(input, ['expectedVersion', 'name', 'provider', 'baseUrl', 'api', 'apiKey', 'modelsPath', 'enabled', 'compat']); this.checkVersion(value.expectedVersion);
    const current = create ? undefined : this.platformRecord(id); const suppliedKey = value.apiKey === undefined ? '' : key(value.apiKey);
    const identity = modelFields({ ...value, model: 'placeholder' });
    const destinationChanged = current && (identity.provider !== current.provider || identity.baseUrl !== current.baseUrl || value.api !== current.api);
    if (destinationChanged && current.apiKey && !suppliedKey) throw new RequestError('MODEL_API_KEY_REQUIRED', '更换服务商、地址或协议时，请重新填写对应的 API Key。');
    const platform = readPlatform({ id: create ? randomUUID() : id, name: value.name, provider: value.provider, baseUrl: value.baseUrl, api: value.api,
      modelsPath: value.modelsPath ?? (destinationChanged ? undefined : current?.modelsPath), apiKey: suppliedKey || current?.apiKey || '', enabled: bool(value.enabled, current?.enabled ?? false), compat: value.compat !== undefined ? value.compat : current?.compat });
    for (const modelId of create ? [] : this.modelIdsForPlatform(id)) {
      const model = this.profile(modelId); checked(() => validateModelCompat(platform.api, model.compat)); checked(() => resolveModelThinking({ ...model, ...platform, model: model.model }, model.thinkingMode));
    }
    return { ...platform, version: randomUUID() };
  }
  prepareImport(platformId: string, expectedVersion: string, modelIds: string[]): PreparedSettings[] {
    this.checkVersion(expectedVersion);
    if (!modelIds.length || modelIds.length > 100 || modelIds.some(id => !remoteModelIdPattern.test(id))) throw invalid();
    const platform = this.platformRecord(platformId);
    const existing = new Set(this.modelIdsForPlatform(platformId).map(id => this.profile(id).model));
    const preset = builtinModel(platform);
    return [...new Set(modelIds)].filter(model => !existing.has(model)).map(model => this.prepare({
      ...(preset?.model === model ? preset : {}), model, platformId, expectedVersion, enabled: false, usageConfirmed: false,
    }, undefined, true));
  }
  prepareDefaultModel(modelId: string, expectedVersion: string): PreparedDefaultModel {
    this.checkVersion(expectedVersion);
    return { modelId, expectedVersion, config: this.requestConfig(modelId) };
  }
  async saveDefaultModel(next: PreparedDefaultModel, authorize?: () => void): Promise<void> {
    this.checkVersion(next.expectedVersion);
    await this.write({ ...this.stored, defaultModelId: next.modelId, version: randomUUID() }, authorize);
  }
  private checkVersion(version: unknown) { if (typeof version !== 'string' || !versionPattern.test(version)) throw invalid(); if (version !== this.stored.version) throw conflict(); }
  private async write(next: StoredCatalog, authorize?: () => void): Promise<void> {
    const checkCurrent = async () => { const disk = await readControlled(this.path, maxSettingsBytes, true); if (disk !== null) decodeCatalog(disk); if (disk !== this.raw) throw conflict(); authorize?.(); };
    try {
      authorize?.(); await checkCurrent(); const raw = encodeCatalog(next); if (Buffer.byteLength(raw) > maxSettingsBytes) throw invalid();
      await atomicWrite(this.path, raw, undefined, { beforeRename: checkCurrent }); this.stored = next; this.raw = raw;
    } catch (error) { if (error instanceof RequestError && ['MODEL_SETTINGS_CONFLICT', 'FORBIDDEN', 'AUTH_REQUIRED', 'IDENTITY_CHANGED'].includes(error.code)) throw error; throw new RequestError('MODEL_SETTINGS_SAVE_FAILED', '模型配置未保存，请检查本地配置文件和目录权限后重试。', 503); }
  }
  async save(next: PreparedSettings, authorize?: () => void): Promise<void> {
    const profiles = new Map(this.stored.profiles);
    const platforms = new Map(this.stored.platforms);
    const { id, platform, version, ...model } = next;
    if (platform) platforms.set(platform.id, platform);
    profiles.set(id, model);
    await this.write({ ...this.stored, version, profiles, platforms }, authorize);
  }
  async savePlatform(next: PreparedPlatform, authorize?: () => void): Promise<void> {
    const { version, ...platform } = next;
    const platforms = new Map(this.stored.platforms).set(platform.id, platform);
    await this.write({ ...this.stored, version, platforms }, authorize);
  }
  async deletePlatform(id: string, expectedVersion: string, authorize?: () => void): Promise<string[]> {
    this.checkVersion(expectedVersion);
    const modelIds = this.modelIdsForPlatform(id);
    if (modelIds.includes(this.defaultModelId())) throw new RequestError('DEFAULT_MODEL_PLATFORM', '此平台包含系统默认模型，请迁移默认模型后再删除。', 409);
    const profiles = new Map(this.stored.profiles);
    const platforms = new Map(this.stored.platforms);
    for (const modelId of modelIds) profiles.delete(modelId);
    platforms.delete(id);
    await this.write({ ...this.stored, version: randomUUID(), profiles, platforms }, authorize);
    return modelIds;
  }
  async saveImport(models: PreparedSettings[], authorize?: () => void): Promise<void> {
    const last = models.at(-1);
    if (!last) return;
    const profiles = new Map(this.stored.profiles);
    for (const { id, version: _version, ...model } of models) {
      void _version;
      profiles.set(id, model);
    }
    await this.write({ ...this.stored, version: last.version, profiles }, authorize);
  }
}
