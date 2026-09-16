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
function integer(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number) {
  const value = Number(env[key] || fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} 必须是 ${min}～${max} 的整数。`);
  return value;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): LabConfig {
  const baseUrl = env.LLM_BASE_URL || 'https://api.deepseek.com';
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('LLM_BASE_URL 必须为不含凭证或查询参数的 HTTPS 地址。');
  }
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
