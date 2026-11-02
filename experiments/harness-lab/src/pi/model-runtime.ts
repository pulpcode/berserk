import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai';
import { resolveModelThinking, type LabConfig } from '../server/config.js';

/** Shared by product sessions and offline evaluations; no provider discovery/network. */
export async function configuredRuntime(config: LabConfig): Promise<ModelRuntime> {
  const thinking = resolveModelThinking(config, config.thinkingMode);
  const nativeThinking = thinking.thinkingSupported && config.thinkingMode !== undefined;
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
    modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
  });
  runtime.registerProvider(config.provider, {
    baseUrl: config.baseUrl, api: 'openai-completions',
    models: [{ id: config.model, name: config.model, reasoning: nativeThinking, input: ['text'],
      contextWindow: config.contextWindow ?? 8192, maxTokens: config.maxOutputTokens ?? 1,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { ...(nativeThinking ? { thinkingFormat: 'deepseek' as const, supportsReasoningEffort: true } : {}), supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens' },
    }],
  });
  if (config.apiKey) await runtime.setRuntimeApiKey(config.provider, config.apiKey);
  return runtime;
}
