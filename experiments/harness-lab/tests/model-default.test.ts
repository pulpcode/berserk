import { describe, expect, it } from 'vitest';
import type { ModelChoice, ModelChoices } from '../src/contracts/index.js';
import { resolveBaseDefaultModel, resolveNewSessionModel } from '../src/web/model-default.js';

function choice(id: string, overrides: Partial<ModelChoice> = {}): ModelChoice {
  return { id, provider: 'test', model: id, configured: true, contextReady: true, contextWindow: 65536, maxOutputTokens: 2048, ...overrides };
}

const personal = { mode: 'model', modelId: 'personal' } as const;
const catalog: ModelChoices = {
  defaultModelId: 'system',
  models: [choice('unconfigured', { configured: false }), choice('incomplete', { contextReady: false }),
    choice('disabled', { available: false }), choice('fallback'), choice('system'), choice('personal'), choice('draft')],
};

describe('new conversation model defaults', () => {
  it('honors an explicit draft, then the usable personal and system defaults', () => {
    expect(resolveNewSessionModel(catalog, personal, 'draft')).toMatchObject({ modelId: 'draft', source: 'draft' });
    expect(resolveBaseDefaultModel(catalog, personal)).toMatchObject({ modelId: 'personal', source: 'user_default' });
    expect(resolveBaseDefaultModel(catalog, { mode: 'system' })).toMatchObject({ modelId: 'system', source: 'system_default' });
    expect(resolveBaseDefaultModel({ ...catalog, defaultModelId: 'fallback' })).toMatchObject({ modelId: 'fallback', source: 'system_default' });
  });

  it('preserves a deleted or disabled explicit draft for manual recovery', () => {
    expect(resolveNewSessionModel(catalog, personal, 'deleted')).toMatchObject({ modelId: 'deleted', source: 'draft', model: undefined });
    expect(resolveNewSessionModel(catalog, personal, 'disabled')).toMatchObject({ modelId: 'disabled', source: 'draft', model: { available: false } });
  });

  it('explains unavailable defaults and preselects the first usable alternative', () => {
    const unavailablePersonal = { ...catalog, models: catalog.models.filter(model => model.id !== 'personal') };
    expect(resolveBaseDefaultModel(unavailablePersonal, personal)).toMatchObject({
      modelId: 'system', source: 'system_default', notice: expect.stringContaining('系统默认'),
    });
    const unavailableSystem = { ...unavailablePersonal, defaultModelId: 'disabled' };
    expect(resolveBaseDefaultModel(unavailableSystem, personal)).toMatchObject({
      modelId: 'fallback', source: 'fallback_available', notice: expect.stringContaining('个人默认与系统默认'),
    });
    expect(resolveBaseDefaultModel({ ...unavailableSystem, models: catalog.models.slice(0, 3) }, personal)).toMatchObject({
      modelId: 'disabled', source: 'unavailable', notice: expect.stringContaining('没有其他可用模型'),
    });
  });
});
