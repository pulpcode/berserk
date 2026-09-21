import { createAssistantMessageEventStream, type AssistantMessage, type Context, type Model, type Api, type SimpleStreamOptions } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { LabConfig } from '../server/config.js';
import type { UsageSummary } from '../contracts/index.js';
import { tokenUsage } from './compaction-history.js';
import type { ModelPermits } from '../background/model-permits.js';

/** Fixed, credential-free categories also preserve Pi's native retry/overflow classifiers. */
export function providerError(raw: string): string {
  if (/401|403|authentication|api.?key|unauthorized|认证失败/i.test(raw)) return '模型认证失败，请检查服务端 API Key 和访问权限。';
  if (/quota|balance|billing|402|额度不足/i.test(raw)) return 'insufficient_quota: 模型额度不足，请检查账户后重试。';
  if (/429|rate.?limit|too many requests/i.test(raw)) return '429 rate limit: 模型请求频率受限，请稍后重试。';
  if (/timeout|timed out|超时/i.test(raw)) return 'timeout: 模型响应超时，请稍后重试。';
  if (/context|maximum.*token|too long|too many tokens|token limit exceeded/i.test(raw)) return 'context_length_exceeded: 当前输入超过模型上下文容量。';
  if (/404|model.*not.*found/i.test(raw)) return '模型或端点不可用，请检查服务端配置。';
  if (/50[02349]|529|overload|server.?error|network|connection|fetch failed|socket|econn|stream.*(closed|ended|disconnect)/i.test(raw)) return '503 overloaded: 模型服务暂时不可用，请稍后重试。';
  return '模型调用失败，请检查服务端模型配置或稍后重试。';
}
export function emptyUsage(): UsageSummary {
  return { modelAttempts: 0, replyAttempts: 0, compactionAttempts: 0, toolCalls: 0, unknownUsageAttempts: 0, actual: null };
}
function failedMessage(model: Model<Api>, text: string, aborted = false): AssistantMessage {
  return { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
    timestamp: Date.now(), stopReason: aborted ? 'aborted' : 'error', errorMessage: text,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
export function controlledStream(runtime: ModelRuntime, config: Readonly<LabConfig>, selected: Model<Api>, context: Context,
  options: SimpleStreamOptions | undefined, purpose: 'reply' | 'compaction', reminder: string, signal: AbortSignal, usage: UsageSummary,
  admission?: { permits: ModelPermits; waiting: () => void; started: () => void }) {
  const safe = createAssistantMessageEventStream();
  void (async () => {
    let final: AssistantMessage | undefined;
    let receivedUsage = false;
    let attempted = false;
    let release: (() => void) | undefined;
    const idle = new AbortController();
    const combined = AbortSignal.any([signal, idle.signal, ...(options?.signal ? [options.signal] : [])]);
    let transportActive = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const progress = () => {
      clearTimeout(idleTimer);
      if (config.httpIdleTimeoutMs) idleTimer = setTimeout(() => idle.abort(new Error('模型流空闲超时。')), config.httpIdleTimeoutMs);
    };
    try {
      combined.throwIfAborted();
      if (admission) { admission.waiting(); release = await admission.permits.acquire(combined); }
      combined.throwIfAborted();
      attempted = true;
      usage.modelAttempts++;
      if (purpose === 'compaction') usage.compactionAttempts++; else usage.replyAttempts++;
      admission?.started();
      progress();
      const upstream = runtime.streamSimple(selected, context, {
        ...options, signal: combined,
        apiKey: config.apiKey, maxRetries: 0,
        fetch: async (input, init) => {
          transportActive = true;
          const response = await (options?.fetch ?? globalThis.fetch)(input, init);
          progress();
          if (!response.body) return response;
          // Count HTTP bytes (including SSE heartbeat/usage chunks), not only model text events.
          const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) { progress(); controller.enqueue(chunk); },
          }));
          return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
        },
        ...(config.llmRequestTimeoutMs ? { timeoutMs: config.llmRequestTimeoutMs } : {}),
        onPayload: payload => {
          if (typeof payload !== 'object' || payload === null) throw new Error('Provider message payload unavailable');
          const providerOptions = config.provider.toLowerCase() === 'deepseek' ? { thinking: { type: 'disabled' } } : {};
          if (purpose === 'compaction') return { ...payload, ...providerOptions };
          if (!('messages' in payload) || !Array.isArray(payload.messages)) throw new Error('Provider message payload unavailable');
          const messages: unknown[] = payload.messages;
          const index = messages.findLastIndex(message => typeof message === 'object' && message !== null && 'role' in message && message.role === 'user');
          if (index < 0) throw new Error('Current user message unavailable');
          return { ...payload, ...providerOptions, messages: [...messages.slice(0, index), { role: 'system', content: reminder }, ...messages.slice(index)] };
        },
      });
      for await (const event of upstream) {
        if (!transportActive) progress();
        // Hold terminal events until the complete summary has been validated.
        if (event.type === 'done' || event.type === 'error') continue;
        safe.push(event);
      }
      final = await upstream.result();
      if (idle.signal.aborted) final = { ...final, stopReason: 'error', errorMessage: 'timeout: 模型流空闲超时。' };
      const actual = tokenUsage(final.usage);
      // Pi/provider adapters initialize all-zero placeholders even on transport failure.
      receivedUsage = actual !== null && actual.totalTokens > 0;
      if (receivedUsage && actual) {
        usage.actual ||= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
        for (const key of Object.keys(actual) as Array<keyof typeof actual>) usage.actual[key] += actual[key];
      }
      if (final.stopReason === 'error') final.errorMessage = providerError(final.errorMessage || '');
      if (purpose === 'compaction' && final.stopReason !== 'error' && final.stopReason !== 'aborted' && final.stopReason !== 'length'
        && (final.content.some(block => block.type === 'toolCall') || !final.content.some(block => block.type === 'text' && block.text.trim()))) {
        final = { ...final, stopReason: 'error', errorMessage: '摘要无有效正文或包含工具调用，压缩失败。' };
      }
    } catch (error) {
      final = failedMessage(selected, providerError(idle.signal.aborted ? 'timeout' : error instanceof Error ? error.message : ''), signal.aborted || options?.signal?.aborted);
    } finally {
      clearTimeout(idleTimer);
      release?.();
      if (attempted && !receivedUsage) usage.unknownUsageAttempts++;
      const result = !final || final.stopReason === 'pending' ? failedMessage(selected, providerError('')) : final;
      if (result.stopReason === 'error' || result.stopReason === 'aborted') safe.push({ type: 'error', reason: result.stopReason, error: result });
      else safe.push({ type: 'done', reason: result.stopReason as 'stop' | 'length' | 'toolUse' | 'deferred', message: result });
    }
  })();
  return safe;
}
