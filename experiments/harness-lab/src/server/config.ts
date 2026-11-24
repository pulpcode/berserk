import { resolve } from 'node:path';
import type { ModelParameters, ModelThinkingMode, ModelCapabilities, ModelApi, ModelCompatibility } from '../contracts/index.js';

export type ParameterSource = 'preset' | 'explicit' | 'unknown';
export interface ResolvedModelParameters extends ModelParameters {
  contextSource: ParameterSource;
  outputSource: ParameterSource;
  contextReady: boolean;
}
export interface LabConfig extends ResolvedModelParameters, ModelCapabilities {
  platformId?: string;
  displayName?: string;
  enabled?: boolean;
  usageConfirmed?: boolean;
  available?: boolean;
  platformCompat?: ModelCompatibility;
  thinkingMode?: ModelThinkingMode;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  dataDir: string;
  /** Controlled fixture directory override for isolated integration tests. */
  agentRolesDir?: string;
  port: number;
  listenHost?: '127.0.0.1' | '0.0.0.0';
  publicOrigin?: string;
  agentRunTimeoutMs: number;
  httpIdleTimeoutMs: number;
  llmRequestTimeoutMs?: number;
  auth?: { secret: string; sessionMs: number };
  seatId?: string;
  testSeats?: Array<{ id: string; name: string }>;
  hitlDemoEnabled?: boolean;
  resultUiEnabled?: boolean;
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
export const modelThinkingLevels: ModelThinkingMode[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export function isVerifiedDeepSeekModel(identity: { api?: ModelApi; model: string; baseUrl: string }): boolean {
  if (identity.api !== undefined && identity.api !== 'openai-completions') return false;
  const endpoint = normalizeModelEndpoint(identity.baseUrl);
  return (['https://api.deepseek.com', 'https://api.deepseek.com/v1'].includes(endpoint) && identity.model === 'deepseek-flash')
    || (endpoint === 'https://ark.cn-beijing.volces.com/api/plan/v3' && identity.model === 'deepseek-v4.1-flash');
}
const openAiCompat = ['supportsStore', 'supportsDeveloperRole', 'supportsReasoningEffort', 'supportsUsageInStreaming', 'supportsFinishReason', 'requiresToolResultName', 'requiresAssistantAfterToolResult', 'requiresThinkingAsText', 'requiresReasoningContentOnAssistantMessages', 'supportsStrictMode'];
const anthropicCompat = ['supportsEagerToolInputStreaming', 'supportsCacheControlOnTools', 'supportsTemperature', 'forceAdaptiveThinking', 'allowEmptySignature', 'supportsStrictTools'];
export function validateModelCompat(api: ModelApi, value: unknown): ModelCompatibility | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('兼容参数必须是对象。');
  const allowed = [...(api === 'openai-completions' ? openAiCompat : anthropicCompat), 'supportsLongCacheRetention', ...(api === 'openai-completions' ? ['maxTokensField', 'thinkingFormat'] : [])];
  for (const [name, entry] of Object.entries(value)) {
    if (!allowed.includes(name)) throw new Error(`此 API 不支持兼容参数 ${name}。`);
    if (name === 'maxTokensField' ? !['max_tokens', 'max_completion_tokens'].includes(entry as string)
      : name === 'thinkingFormat' ? !['openai', 'openrouter', 'deepseek', 'together', 'baseten', 'zai', 'qwen', 'chat-template', 'qwen-chat-template', 'string-thinking', 'ant-ling'].includes(entry as string)
      : typeof entry !== 'boolean') throw new Error(`兼容参数 ${name} 的值不正确。`);
  }
  return { ...value };
}
export function resolveModelCapabilities(identity: ModelCapabilities): ModelCapabilities {
  const api = identity.api === undefined ? 'openai-completions' : identity.api;
  if (!['openai-completions', 'anthropic-messages'].includes(api)) throw new Error('API 协议不受支持。');
  const input = identity.input;
  if (input !== undefined && (!Array.isArray(input) || !input.length || input.some(kind => !['text', 'image'].includes(kind)) || new Set(input).size !== input.length)) throw new Error('输入能力必须是 text 或 image 的非重复数组。');
  const levels = identity.thinkingLevels;
  if (levels !== undefined && (!Array.isArray(levels) || levels.some(level => !modelThinkingLevels.includes(level)) || new Set(levels).size !== levels.length)) throw new Error('思考档位数组不正确。');
  const map = identity.thinkingLevelMap;
  if (map !== undefined && (!map || typeof map !== 'object' || Array.isArray(map) || Object.entries(map).some(([level, value]) => !modelThinkingLevels.includes(level as ModelThinkingMode) || value !== null && (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{1,80}$/.test(value))))) throw new Error('思考档位映射不正确。');
  if (levels?.some(level => map?.[level] === null)) throw new Error('可用思考档位不能映射为 null。');
  if (identity.defaultThinkingLevel !== undefined && (!modelThinkingLevels.includes(identity.defaultThinkingLevel) || levels && !levels.includes(identity.defaultThinkingLevel) || map?.[identity.defaultThinkingLevel] === null)) throw new Error('默认思考档位不在可用范围内。');
  return { api, input: input ? [...input] : undefined, thinkingLevels: levels ? [...levels] : undefined,
    defaultThinkingLevel: identity.defaultThinkingLevel, thinkingLevelMap: map ? { ...map } : undefined,
    compat: identity.compat === undefined ? undefined : validateModelCompat(api, identity.compat) };
}
/** Exact legacy capability or administrator-declared model capability; never infer from registry alias. */
export function resolveModelThinking(identity: { model: string; baseUrl: string } & ModelCapabilities, requested?: unknown): { thinkingMode: ModelThinkingMode; thinkingSupported: boolean } {
  if (requested === null) throw new Error('推理模式只能为 off 或 high，或管理员声明的其他思考档位。');
  const capabilities = resolveModelCapabilities(identity);
  const explicit = capabilities.thinkingLevels;
  const supported = capabilities.thinkingLevelMap?.off === null || (explicit?.length ? explicit.some(level => level !== 'off') : isVerifiedDeepSeekModel(identity));
  const fallback = identity.defaultThinkingLevel ?? (explicit?.length && !explicit.includes('off') ? explicit[0] : capabilities.thinkingLevelMap?.off === null ? 'high' : 'off');
  const mode = requested ?? fallback;
  if (!modelThinkingLevels.includes(mode as ModelThinkingMode)) throw new Error('推理模式只能为 off 或 high，或管理员声明的其他思考档位。');
  if (explicit?.length && !explicit.includes(mode as ModelThinkingMode) || capabilities.thinkingLevelMap?.[mode as ModelThinkingMode] === null) throw new Error('此模型不支持所选思考档位。');
  if (mode !== 'off' && !supported) throw new Error('尚未核实此模型 ID 与 API 地址支持开启推理，请使用已支持的组合或保留原模式。');
  if (!explicit && capabilities.thinkingLevelMap === undefined && isVerifiedDeepSeekModel(identity) && mode !== 'off' && mode !== 'high') throw new Error('推理模式只能为 off 或 high。');
  return { thinkingMode: mode as ModelThinkingMode, thinkingSupported: supported };
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
/** Web service defaults may come from deployment, but its model keys come from the store. */
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): LabConfig {
  return loadConfig({ ...env, LLM_API_KEY: undefined });
}

/** Standalone probes can still supply credentials for their isolated runtimes. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): LabConfig {
  const listenHost = env.LAB_LISTEN_HOST ?? '127.0.0.1';
  if (listenHost !== '127.0.0.1' && listenHost !== '0.0.0.0') throw new Error('LAB_LISTEN_HOST 必须为 127.0.0.1 或 0.0.0.0。');
  const publicOrigin = env.LAB_PUBLIC_ORIGIN;
  if (publicOrigin !== undefined) {
    try {
      const url = new URL(publicOrigin);
      if (url.protocol !== 'http:' || url.origin !== publicOrigin || url.hostname === '0.0.0.0') throw new Error();
    } catch { throw new Error('LAB_PUBLIC_ORIGIN 必须为完整 HTTP 来源（协议、主机及可选端口），不含路径或凭证。'); }
  }
  if (listenHost === '0.0.0.0' && !publicOrigin) throw new Error('对外监听必须配置 LAB_PUBLIC_ORIGIN。');
  const mode = env.LAB_AUTH_MODE ?? 'login';
  if (!['login', 'test'].includes(mode)) throw new Error('LAB_AUTH_MODE 必须为 login 或 test。');
  if (mode === 'test' && (listenHost !== '127.0.0.1' || publicOrigin)) throw new Error('对外访问必须使用正式登录模式。');
  if (mode === 'login' && (!env.LAB_SESSION_SECRET || env.LAB_SESSION_SECRET.length < 32)) throw new Error('请运行 access:admin 初始化账号及本地登录签名配置；正式服务不允许匿名启动。');
  if (mode === 'login' && env.LAB_TEST_SEATS) throw new Error('正式登录模式不能启用 LAB_TEST_SEATS，请移除该配置。');
  const seatId = env.LAB_SEAT_ID ?? 'test-seat';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(seatId)) throw new Error('LAB_SEAT_ID 仅允许 1～64 个字母、数字、下划线和短横线。');
  if (env.LAB_EXECUTION_ENABLED !== undefined && !['true', 'false'].includes(env.LAB_EXECUTION_ENABLED)) throw new Error('LAB_EXECUTION_ENABLED 必须为 true 或 false。');
  if (env.LAB_HITL_DEMO_ENABLED !== undefined && !['true', 'false'].includes(env.LAB_HITL_DEMO_ENABLED)) throw new Error('LAB_HITL_DEMO_ENABLED 必须为 true 或 false。');
  if (env.LAB_RESULT_UI_ENABLED !== undefined && !['true', 'false'].includes(env.LAB_RESULT_UI_ENABLED)) throw new Error('LAB_RESULT_UI_ENABLED 必须为 true 或 false。');
  const baseUrl = normalizeModelEndpoint(env.LLM_BASE_URL || 'https://api.deepseek.com');
  const identity = { provider: env.LLM_PROVIDER || 'deepseek', model: env.LLM_MODEL || 'deepseek-flash', baseUrl };
  const parameters: ModelParameterOverrides = {};
  if (env.LLM_CONTEXT_WINDOW !== undefined) parameters.contextWindow = integer(env, 'LLM_CONTEXT_WINDOW', 0, 8192, 2_000_000);
  if (env.LLM_MAX_OUTPUT_TOKENS !== undefined) parameters.maxOutputTokens = integer(env, 'LLM_MAX_OUTPUT_TOKENS', 0, 1, 2_000_000);
  const legacy = ['REQUEST_TIMEOUT_MS', 'MAX_TOOL_CALLS', 'MAX_OUTPUT_TOKENS'].filter(name => env[name] !== undefined);
  if (legacy.length) console.warn(`已忽略旧实验配置：${legacy.join('、')}。整轮时限请使用 AGENT_RUN_TIMEOUT_MS；模型输出能力请使用 LLM_MAX_OUTPUT_TOKENS 或模型设置；不再限制累计工具次数。`);
  return { ...identity, ...resolveModelParameters(identity, parameters), thinkingMode: env.LLM_THINKING_MODE === undefined ? undefined : resolveModelThinking(identity, env.LLM_THINKING_MODE).thinkingMode, listenHost, publicOrigin,
    apiKey: env.LLM_API_KEY?.trim() || '', dataDir: resolve(env.LAB_DATA_DIR || '.local'),
    ...(mode === 'login' ? { auth: { secret: env.LAB_SESSION_SECRET!, sessionMs: integer(env, 'LAB_SESSION_HOURS', 8, 1, 168) * 3600000 } } : {}),
    seatId, testSeats: parseTestSeats(env.LAB_TEST_SEATS, seatId), hitlDemoEnabled: env.LAB_HITL_DEMO_ENABLED === 'true',
    resultUiEnabled: env.LAB_RESULT_UI_ENABLED === 'true',
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
