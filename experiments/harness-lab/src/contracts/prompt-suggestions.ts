/** Ephemeral input assistance; never part of the persisted conversation. */
export interface PromptSuggestionRequest {
  sourceRequestId: string;
  finalMessageId: string;
  expectedModelId: string;
}
export interface PromptSuggestionResponse {
  sourceRequestId: string;
  finalMessageId: string;
  modelId: string;
  text: string | null;
}

export function isPromptSuggestionResponse(value: unknown): value is PromptSuggestionResponse {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.sourceRequestId === 'string' && typeof item.finalMessageId === 'string'
    && typeof item.modelId === 'string' && (item.text === null || typeof item.text === 'string');
}
