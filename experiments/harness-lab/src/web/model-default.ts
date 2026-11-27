import type { ModelChoice, ModelChoices, UserModelPreferenceChoice } from '../contracts/index';

export interface ResolvedNewSessionModel {
  modelId: string;
  model?: ModelChoice;
  source: 'draft' | 'user_default' | 'system_default' | 'fallback_available' | 'unavailable';
  notice?: string;
}

export function isUsableModel(model?: ModelChoice): model is ModelChoice & { configured: true; contextReady: true; available?: true } {
  return Boolean(model?.configured && model.contextReady && model.available !== false);
}

export function modelLabel(model: ModelChoice) {
  return `${model.platformName || model.provider}－${model.displayName || model.model || '未配置模型'}`;
}

export function resolveBaseDefaultModel(models?: ModelChoices, preference?: UserModelPreferenceChoice): ResolvedNewSessionModel {
  const personal = preference?.mode === 'model' ? models?.models.find(model => model.id === preference.modelId) : undefined;
  if (isUsableModel(personal)) return { modelId: personal.id, model: personal, source: 'user_default' };

  const modelId = models?.defaultModelId ?? 'default';
  const model = models?.models.find(item => item.id === modelId);
  const personalUnavailable = Boolean(models && preference?.mode === 'model');
  if (isUsableModel(model)) return {
    modelId, model, source: 'system_default',
    notice: personalUnavailable ? `你的默认模型暂不可用，新对话将使用系统默认「${modelLabel(model)}」。` : undefined,
  };
  const fallback = models?.models.find(isUsableModel);
  if (fallback) return {
    modelId: fallback.id, model: fallback, source: 'fallback_available',
    notice: `${personalUnavailable ? '个人默认与系统默认模型' : '系统默认模型'}暂不可用，已预选「${modelLabel(fallback)}」。`,
  };
  return {
    modelId, model, source: 'unavailable',
    notice: personalUnavailable ? '你的默认模型暂不可用，目前没有其他可用模型。' : undefined,
  };
}

export function resolveNewSessionModel(models?: ModelChoices, preference?: UserModelPreferenceChoice, draftModelId?: string): ResolvedNewSessionModel {
  if (draftModelId) return { modelId: draftModelId, model: models?.models.find(model => model.id === draftModelId), source: 'draft' };
  return resolveBaseDefaultModel(models, preference);
}
