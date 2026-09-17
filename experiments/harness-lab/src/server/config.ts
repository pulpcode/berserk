import { resolve } from 'node:path';

export interface LabConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  dataDir: string;
  port: number;
  timeoutMs: number;
  maxToolCalls: number;
  maxOutputTokens: number;
}
export function normalizeModelEndpoint(value: string): string {
  try {
    if (!value || value.length > 2048 || /[\s\\?#]/.test(value)) throw new Error();
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
    return url.toString().replace(/\/+$/, '');
  } catch {
    throw new Error('模型地址必须为不含凭证、查询参数或片段的 HTTPS 地址。');
  }
}
function integer(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number) {
  const value = Number(env[key] || fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} 必须是 ${min}～${max} 的整数。`);
  return value;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): LabConfig {
  const baseUrl = normalizeModelEndpoint(env.LLM_BASE_URL || 'https://api.deepseek.com');
  return {
    provider: env.LLM_PROVIDER || 'deepseek',
    model: env.LLM_MODEL || 'deepseek-flash',
    baseUrl,
    apiKey: env.LLM_API_KEY?.trim() || '',
    dataDir: resolve(env.LAB_DATA_DIR || '.local'),
    port: integer(env, 'PORT', 4310, 1024, 65535),
    timeoutMs: integer(env, 'REQUEST_TIMEOUT_MS', 120000, 1000, 300000),
    maxToolCalls: integer(env, 'MAX_TOOL_CALLS', 8, 1, 20),
    maxOutputTokens: integer(env, 'MAX_OUTPUT_TOKENS', 2048, 64, 8192),
  };
}
