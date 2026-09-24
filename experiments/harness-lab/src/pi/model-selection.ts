import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { stateError } from '../resources/files.js';
import { UUID } from '../workspaces/store.js';

/** Profile IDs disambiguate identical provider/model names at different endpoints. */
export const MODEL_SELECTION = 'berserk.model-selection.v1';
export function decodeModelSelection(value: unknown, workspaceId: string, sessionId?: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw stateError();
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !['schemaVersion', 'workspaceId', 'sessionId', 'modelId'].includes(key))
    || data.schemaVersion !== 1 || data.workspaceId !== workspaceId || typeof data.sessionId !== 'string' || !UUID.test(data.sessionId)
    || (sessionId !== undefined && data.sessionId !== sessionId)
    || typeof data.modelId !== 'string' || (data.modelId !== 'default' && !UUID.test(data.modelId))) throw stateError();
  return data.modelId;
}
export function selectedModelId(entries: SessionEntry[], workspaceId: string, sessionId: string): string {
  let modelId = 'default';
  for (const entry of entries) if (entry.type === 'custom' && entry.customType === MODEL_SELECTION) {
    modelId = decodeModelSelection(entry.data, workspaceId, sessionId);
  }
  return modelId;
}
