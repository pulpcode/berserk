import { resolve } from 'node:path';
import type { ModelParameters } from '../contracts/index.js';

export type ParameterSource = 'preset' | 'explicit' | 'unknown';
export interface ResolvedModelParameters extends ModelParameters {
  contextSource: ParameterSource;
  outputSource: ParameterSource;
  contextReady: boolean;
}
export interface LabConfig extends ResolvedModelParameters {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  dataDir: string;
  /** Controlled fixture directory override for isolated integration tests. */
  agentRolesDir?: string;
  port: number;
  agentRunTimeoutMs: number;
  httpIdleTimeoutMs: number;
  llmRequestTimeoutMs?: number;
  auth?: { secret: string; sessionMs: number };
  seatId?: string;
  testSeats?: Array<{ id: string; name: string }>;
  hitlDemoEnabled?: boolean;
  fileLimits?: { maxFileBytes: number; maxAttachments: number };
  execution?: { enabled: boolean; image: string; cpus: number; memoryMb: number; pidsLimit: number; uid: number; gid: number };
}
export const modelParameterKeys = ['contextWindow', 'maxOutputTokens', 'compactionReserveTokens', 'compactionKeepRecentTokens'] as const;
export type ModelParameterOverrides = Partial<Record<typeof modelParameterKeys[number], number>>;
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
/** Only this verified provider/model/endpoint tuple receives the official preset. */
export function resolveModelParameters(identity: { provider: string; model: string; baseUrl: string }, values: ModelParameterOverrides = {}): ResolvedModelParameters {
  for (const name of modelParameterKeys) {
    const value = values[name];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < (name === 'contextWindow' ? 8192 : 1) || value > 2_000_000)) {
      throw new Error(`${name} 必须是范围内的整数。`);
    }
  }
  // Official API specifies max_tokens <= 393216 (384K); C uses the documented decimal 1M.
  // https://api-docs.deepseek.com/api/create-chat-completion/
  const preset = identity.provider === 'deepseek' && identity.model === 'deepseek-flash'
    && ['https://api.deepseek.com', 'https://api.deepseek.com/v1'].includes(normalizeModelEndpoint(identity.baseUrl));
  const contextWindow = values.contextWindow ?? (preset ? 1_000_000 : null);
  const maxOutputTokens = values.maxOutputTokens ?? (preset ? 393216 : null);
  const compactionReserveTokens = values.compactionReserveTokens ?? (contextWindow === null ? null : Math.min(16384, Math.floor(contextWindow / 4)));
  const compactionKeepRecentTokens = values.compactionKeepRecentTokens ?? (contextWindow === null || compactionReserveTokens === null ? null : Math.min(20000, Math.floor((contextWindow - compactionReserveTokens) / 2)));
  if (contextWindow !== null && maxOutputTokens !== null && maxOutputTokens > contextWindow) throw new Error('模型最大输出量不能超过上下文容量。');
  if (compactionKeepRecentTokens !== null && compactionKeepRecentTokens < 1) throw new Error('上下文容量不足，请调整压缩预留量。');
  if (contextWindow !== null && compactionReserveTokens !== null && compactionKeepRecentTokens !== null && compactionReserveTokens + compactionKeepRecentTokens >= contextWindow) throw new Error('压缩预留量与近期保留量之和必须小于上下文容量。');
  return { contextWindow, maxOutputTokens, compactionReserveTokens, compactionKeepRecentTokens,
    contextSource: values.contextWindow !== undefined ? 'explicit' : preset ? 'preset' : 'unknown',
    outputSource: values.maxOutputTokens !== undefined ? 'explicit' : preset ? 'preset' : 'unknown',
    contextReady: [contextWindow, maxOutputTokens, compactionReserveTokens, compactionKeepRecentTokens].every(value => value !== null) };
}
function integer(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number) {
  const raw = env[key];
  const value = raw === undefined ? fallback : /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${key} 必须是 ${min}～${max} 的整数。`);
  return value;
}
export function parseTestSeats(raw: string | undefined, seatId: string): LabConfig['testSeats'] {
  if (raw === undefined) return undefined;
  try {
    const seats: unknown = JSON.parse(raw);
    if (!Array.isArray(seats) || seats.length !== 2 || seats.some(seat => !seat || typeof seat !== 'object' || Object.keys(seat).some(key => !['id', 'name'].includes(key)) || typeof seat.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(seat.id) || typeof seat.name !== 'string' || !seat.name.trim() || seat.name.length > 60) || new Set(seats.map(seat => seat.id)).size !== 2 || !seats.some(seat => seat.id === seatId)) throw new Error();
    return seats.map(seat => ({ id: seat.id, name: seat.name.trim() }));
  } catch { throw new Error('LAB_TEST_SEATS 必须为两个不同的 {id,name} 席位组成的 JSON 数组，且包含 LAB_SEAT_ID。'); }
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): LabConfig {
  const mode = env.LAB_AUTH_MODE ?? 'login';
  if (!['login', 'test'].includes(mode)) throw new Error('LAB_AUTH_MODE 必须为 login 或 test。');
  if (mode === 'login' && (!env.LAB_SESSION_SECRET || env.LAB_SESSION_SECRET.length < 32)) throw new Error('请运行 access:admin 初始化账号及本地登录签名配置；正式服务不允许匿名启动。');
  if (mode === 'login' && env.LAB_TEST_SEATS) throw new Error('正式登录模式不能启用 LAB_TEST_SEATS，请移除该配置。');
  const seatId = env.LAB_SEAT_ID ?? 'test-seat';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(seatId)) throw new Error('LAB_SEAT_ID 仅允许 1～64 个字母、数字、下划线和短横线。');
  if (env.LAB_EXECUTION_ENABLED !== undefined && !['true', 'false'].includes(env.LAB_EXECUTION_ENABLED)) throw new Error('LAB_EXECUTION_ENABLED 必须为 true 或 false。');
  if (env.LAB_HITL_DEMO_ENABLED !== undefined && !['true', 'false'].includes(env.LAB_HITL_DEMO_ENABLED)) throw new Error('LAB_HITL_DEMO_ENABLED 必须为 true 或 false。');
  const baseUrl = normalizeModelEndpoint(env.LLM_BASE_URL || 'https://api.deepseek.com');
  const identity = { provider: env.LLM_PROVIDER || 'deepseek', model: env.LLM_MODEL || 'deepseek-flash', baseUrl };
  const parameters: ModelParameterOverrides = {};
  if (env.LLM_CONTEXT_WINDOW !== undefined) parameters.contextWindow = integer(env, 'LLM_CONTEXT_WINDOW', 0, 8192, 2_000_000);
  if (env.LLM_MAX_OUTPUT_TOKENS !== undefined) parameters.maxOutputTokens = integer(env, 'LLM_MAX_OUTPUT_TOKENS', 0, 1, 2_000_000);
  const legacy = ['REQUEST_TIMEOUT_MS', 'MAX_TOOL_CALLS', 'MAX_OUTPUT_TOKENS'].filter(name => env[name] !== undefined);
  if (legacy.length) console.warn(`已忽略旧实验配置：${legacy.join('、')}。整轮时限请使用 AGENT_RUN_TIMEOUT_MS；模型输出能力请使用 LLM_MAX_OUTPUT_TOKENS 或模型设置；不再限制累计工具次数。`);
  return { ...identity, ...resolveModelParameters(identity, parameters),
    apiKey: env.LLM_API_KEY?.trim() || '', dataDir: resolve(env.LAB_DATA_DIR || '.local'),
    ...(mode === 'login' ? { auth: { secret: env.LAB_SESSION_SECRET!, sessionMs: integer(env, 'LAB_SESSION_HOURS', 8, 1, 168) * 3600000 } } : {}),
    seatId, testSeats: parseTestSeats(env.LAB_TEST_SEATS, seatId), hitlDemoEnabled: env.LAB_HITL_DEMO_ENABLED === 'true',
    fileLimits: { maxFileBytes: integer(env, 'LAB_MAX_FILE_BYTES', 100 * 1024 * 1024, 1, 1024 * 1024 * 1024), maxAttachments: integer(env, 'LAB_MAX_ATTACHMENTS', 20, 1, 100) },
    execution: { enabled: env.LAB_EXECUTION_ENABLED !== 'false', image: env.LAB_EXECUTION_IMAGE || 'berserk-file-runtime:w01-5',
      cpus: integer(env, 'LAB_EXECUTION_CPUS', 2, 1, 32), memoryMb: integer(env, 'LAB_EXECUTION_MEMORY_MB', 1024, 128, 65536),
      pidsLimit: integer(env, 'LAB_EXECUTION_PIDS', 128, 16, 4096),
      uid: integer(env, 'LAB_EXECUTION_UID', process.getuid?.() || 1000, 1, 2147483647),
      gid: integer(env, 'LAB_EXECUTION_GID', process.getgid?.() || 1000, 1, 2147483647) },
    port: integer(env, 'PORT', 4310, 1024, 65535),
    agentRunTimeoutMs: integer(env, 'AGENT_RUN_TIMEOUT_MS', 0, 0, 2147483647),
    httpIdleTimeoutMs: integer(env, 'LLM_HTTP_IDLE_TIMEOUT_MS', 300000, 0, 2147483647),
    ...(env.LLM_REQUEST_TIMEOUT_MS === undefined ? {} : { llmRequestTimeoutMs: integer(env, 'LLM_REQUEST_TIMEOUT_MS', 0, 1, 2147483647) }),
  };
}
