import type { ModelPlatform, ModelSettingsUpdate } from './index.js';

export const modelPlatformPresets = [
  { name: 'DeepSeek 官方', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', api: 'openai-completions', modelsPath: '/models', model: 'deepseek-flash', displayName: 'DeepSeek Flash' },
  { name: 'Kimi Code', provider: 'kimi-coding', baseUrl: 'https://api.kimi.com/coding', api: 'anthropic-messages', model: 'kimi-for-coding', displayName: 'Kimi K2.8 Preview',
    thinkingLevels: ['off', 'low', 'high', 'max'], defaultThinkingLevel: 'low', compat: { forceAdaptiveThinking: true, allowEmptySignature: true } },
] as const;

export function modelPlatformPreset(platform: Pick<ModelPlatform, 'provider' | 'baseUrl' | 'api'>) {
  return modelPlatformPresets.find(item => item.provider === platform.provider && item.api === platform.api
    && (item.baseUrl === platform.baseUrl || item.provider === 'deepseek' && `${item.baseUrl}/v1` === platform.baseUrl));
}

export function builtinModel(platform: Pick<ModelPlatform, 'provider' | 'baseUrl' | 'api'>): Pick<ModelSettingsUpdate, 'model' | 'displayName' | 'thinkingLevels' | 'defaultThinkingLevel' | 'compat'> | undefined {
  const preset = modelPlatformPreset(platform);
  return preset && { model: preset.model, displayName: preset.displayName, ...('thinkingLevels' in preset
    ? { thinkingLevels: [...preset.thinkingLevels], defaultThinkingLevel: preset.defaultThinkingLevel, compat: preset.compat } : {}) };
}
