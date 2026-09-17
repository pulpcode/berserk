import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelSettings, ModelSettingsUpdate } from '../contracts/index.js';
import { RequestError } from '../contracts/errors.js';
import { atomicWrite, checkDirectory, parseJsonStrict, readControlled } from '../resources/files.js';
import { normalizeModelEndpoint, type LabConfig } from './config.js';

type ModelConfig = Pick<LabConfig, 'provider' | 'model' | 'baseUrl' | 'apiKey'>;
interface StoredSettings extends ModelConfig { schemaVersion: 1; version: string }
const versionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const invalid = () => new RequestError('INVALID_INPUT', '模型配置格式不正确，请检查服务商、模型 ID、HTTPS 地址和 API Key。');
const stateError = () => new RequestError('MODEL_SETTINGS_INVALID', '本地模型配置无法安全读取，请检查配置文件后重启服务。', 503);
const conflict = () => new RequestError('MODEL_SETTINGS_CONFLICT', '模型配置已更新，请重新读取后再保存。', 409);

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw invalid();
  return value as Record<string, unknown>;
}
function modelFields(value: Record<string, unknown>): Omit<ModelConfig, 'apiKey'> {
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
function decode(text: string): StoredSettings {
  const value = object(parseJsonStrict(text), ['schemaVersion', 'version', 'provider', 'model', 'baseUrl', 'apiKey']);
  if (value.schemaVersion !== 1 || typeof value.version !== 'string' || !versionPattern.test(value.version)) throw invalid();
  const apiKey = key(value.apiKey);
  if (!apiKey) throw invalid();
  return { schemaVersion: 1, version: value.version, ...modelFields(value), apiKey };
}

/** One process owns the directory. PiLab serializes updates against request starts. */
export class ModelSettingsStore {
  private constructor(private readonly path: string, private current: StoredSettings, private raw: string | null) {}

  static async open(config: LabConfig): Promise<ModelSettingsStore> {
    try {
      await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
      await checkDirectory(config.dataDir);
      const path = join(config.dataDir, 'model-settings.json');
      const raw = await readControlled(path, 16384, true);
      const current = raw === null ? { schemaVersion: 1 as const, version: randomUUID(), ...modelFields({ ...config }), apiKey: key(config.apiKey) } : decode(raw);
      return new ModelSettingsStore(path, current, raw);
    } catch { throw stateError(); }
  }

  info(): ModelSettings {
    const { provider, model, baseUrl, version, apiKey } = this.current;
    return { provider, model, baseUrl, version, configured: Boolean(apiKey), source: this.raw === null ? 'environment' : 'local' };
  }

  config(): ModelConfig {
    const { provider, model, baseUrl, apiKey } = this.current;
    return { provider, model, baseUrl, apiKey };
  }

  prepare(input: ModelSettingsUpdate): StoredSettings {
    const value = object(input, ['provider', 'model', 'baseUrl', 'apiKey', 'expectedVersion']);
    const fields = modelFields(value);
    if (typeof value.expectedVersion !== 'string' || !versionPattern.test(value.expectedVersion)) throw invalid();
    if (value.expectedVersion !== this.current.version) throw conflict();
    const suppliedKey = value.apiKey === undefined ? '' : key(value.apiKey);
    const sameDestination = fields.provider === this.current.provider && fields.baseUrl === this.current.baseUrl;
    if (!suppliedKey && (!sameDestination || !this.current.apiKey)) {
      throw new RequestError('MODEL_API_KEY_REQUIRED', '请填写 API Key；更换服务商或地址时需要重新填写对应密钥。');
    }
    return { schemaVersion: 1, version: randomUUID(), ...fields, apiKey: suppliedKey || this.current.apiKey };
  }

  async save(next: StoredSettings): Promise<void> {
    const checkCurrent = async () => {
      const disk = await readControlled(this.path, 16384, true);
      if (disk !== null) decode(disk);
      if (disk !== this.raw) throw conflict();
    };
    try {
      await checkCurrent();
      const raw = `${JSON.stringify(next, null, 2)}\n`;
      // Recheck the leaf after preparing the private temporary file; never follow a symlink.
      await atomicWrite(this.path, raw, undefined, { beforeRename: checkCurrent });
      this.current = next; this.raw = raw;
    } catch (error) {
      if (error instanceof RequestError && error.code === 'MODEL_SETTINGS_CONFLICT') throw error;
      throw new RequestError('MODEL_SETTINGS_SAVE_FAILED', '模型配置未保存，请检查本地配置文件和目录权限后重试。', 503);
    }
  }
}
