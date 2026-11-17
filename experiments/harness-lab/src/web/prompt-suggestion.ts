import type { PromptSuggestionRequest, PromptSuggestionResponse, SessionSnapshot } from '../contracts/index';

/** Missing/legacy terminal evidence must never be treated as a completed answer. */
export function promptSuggestionSource(snapshot: SessionSnapshot | undefined, modelId: string): PromptSuggestionRequest | undefined {
  if (!snapshot || snapshot.active || snapshot.backgroundJob || snapshot.recoveryWarning || snapshot.expert?.availability.available === false
    || snapshot.modelId !== modelId || snapshot.lastResult?.status !== 'succeeded'
    || snapshot.inputQueue?.items.some(item => item.status === 'pending') || snapshot.interactions?.some(item => item.status === 'pending')) return;
  const turn = snapshot.turns?.at(-1);
  if (!turn?.finalMessageId || turn.status !== 'succeeded' || turn.requestId !== snapshot.lastResult.requestId) return;
  if (!snapshot.messages.some(message => message.id === turn.finalMessageId && message.requestId === turn.requestId && message.role === 'assistant' && message.text.trim())) return;
  return { sourceRequestId: turn.requestId, finalMessageId: turn.finalMessageId, expectedModelId: modelId };
}

/** Existing text belongs to a reply, not to whichever model is selected next. */
export function matchesPromptSuggestion(snapshot: SessionSnapshot | undefined,
  candidate: Pick<PromptSuggestionResponse, 'sourceRequestId' | 'finalMessageId'>): boolean {
  const source = promptSuggestionSource(snapshot, snapshot?.modelId || '');
  return Boolean(source && source.sourceRequestId === candidate.sourceRequestId && source.finalMessageId === candidate.finalMessageId);
}
