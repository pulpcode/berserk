import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai';
import type { ModelThinkingMode } from '../contracts/index.js';
import { isVerifiedDeepSeekModel, resolveModelCapabilities, resolveModelThinking, modelThinkingLevels, type LabConfig } from '../server/config.js';

/** A missing selection keeps the provider's default, including always-on thinking. */
export function modelReasoning(config: Readonly<LabConfig>): Exclude<ModelThinkingMode, 'off'> | undefined {
  const selected = config.thinkingMode ?? config.defaultThinkingLevel;
  const thinking = resolveModelThinking(config, selected);
  return selected === undefined || thinking.thinkingMode === 'off' ? undefined : thinking.thinkingMode;
}
export function nativeThinkingLevel(config: Readonly<LabConfig>): ModelThinkingMode {
  return resolveModelThinking(config, config.thinkingMode).thinkingMode;
}
/** Shared by product sessions and offline evaluations; no provider discovery/network. */
export async function configuredRuntime(config: LabConfig): Promise<ModelRuntime> {
  const capabilities = resolveModelCapabilities(config);
  const thinking = resolveModelThinking(config, config.thinkingMode);
  const declaredThinking = Boolean(config.thinkingLevels?.length || Object.keys(config.thinkingLevelMap ?? {}).length);
  const nativeThinking = thinking.thinkingSupported && (declaredThinking || config.thinkingMode !== undefined || config.defaultThinkingLevel !== undefined);
  const thinkingLevelMap = declaredThinking ? {
    ...(config.thinkingLevels?.length ? Object.fromEntries(modelThinkingLevels.map(level => [level, config.thinkingLevels!.includes(level) ? level === 'off' ? undefined : level : null])) : {}),
    ...config.thinkingLevelMap,
  } : undefined;
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
    modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
  });
  const compat = capabilities.api === 'openai-completions'
    ? { supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens' as const,
      ...(nativeThinking && isVerifiedDeepSeekModel(config) ? { thinkingFormat: 'deepseek' as const, supportsReasoningEffort: true } : {}), ...config.platformCompat, ...capabilities.compat }
    : { ...config.platformCompat, ...capabilities.compat };
  runtime.registerProvider(config.provider, {
    baseUrl: config.baseUrl, api: capabilities.api,
    models: [{ id: config.model, name: config.displayName ?? config.model, reasoning: nativeThinking, input: capabilities.input ?? ['text'],
      thinkingLevelMap, contextWindow: config.contextWindow ?? 8192, maxTokens: config.maxOutputTokens ?? 1,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat,
    }],
  });
  if (config.apiKey) await runtime.setRuntimeApiKey(config.provider, config.apiKey);
  return runtime;
}

/** Preserve legacy DeepSeek payloads only on their original protocol. */
export function providerPayload(config: Readonly<LabConfig>, payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null) throw new Error('Provider message payload unavailable');
  const thinking = resolveModelThinking(config, config.thinkingMode);
  const declaredThinking = Boolean(config.thinkingLevels?.length || Object.keys(config.thinkingLevelMap ?? {}).length) || config.defaultThinkingLevel !== undefined;
  const legacy = (config.api === undefined || config.api === 'openai-completions') && !declaredThinking
    && (!thinking.thinkingSupported || config.thinkingMode === undefined) && config.provider.toLowerCase() === 'deepseek';
  return { ...payload, ...(legacy ? { thinking: { type: 'disabled' } } : {}) };
}
