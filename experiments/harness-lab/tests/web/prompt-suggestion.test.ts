import { expect, it } from 'vitest';
import { matchesPromptSuggestion, promptSuggestionSource } from '../../src/web/prompt-suggestion';
import { isPromptSuggestionResponse } from '../../src/contracts/prompt-suggestions';
import type { SessionSnapshot } from '../../src/contracts/index';

function snapshot(): SessionSnapshot {
  return { id: 'session', workspaceId: 'workspace', title: '', updatedAt: '', modelId: 'default', active: null,
    lastResult: { requestId: 'turn', status: 'succeeded' }, turns: [{ requestId: 'turn', status: 'succeeded', finalMessageId: 'final' }],
    messages: [{ id: 'final', requestId: 'turn', role: 'assistant', text: '核对完成。' }] };
}
it('requires same-request successful final evidence instead of guessing from the last assistant text', () => {
  expect(promptSuggestionSource(snapshot(), 'default')).toEqual({ sourceRequestId: 'turn', finalMessageId: 'final', expectedModelId: 'default' });
  for (const value of [{ ...snapshot(), turns: undefined }, { ...snapshot(), lastResult: { requestId: 'other', status: 'succeeded' as const } },
    { ...snapshot(), messages: [{ id: 'final', role: 'assistant' as const, requestId: 'other', text: '仍有正文' }] },
    { ...snapshot(), turns: [{ requestId: 'turn', status: 'succeeded' as const }] }, { ...snapshot(), messages: [] }]) {
    expect(promptSuggestionSource(value, 'default')).toBeUndefined();
  }
});
it('does not offer suggestions for active/reserved/recovery/failed states or a different selected model', () => {
  const base = snapshot();
  for (const value of [{ ...base, active: { requestId: 'next', status: 'responding' as const } },
    { ...base, backgroundJob: { id: 'job', status: 'queued' as const, revision: 1 } }, { ...base, recoveryWarning: '需核对' },
    ...(['failed', 'cancelled', 'interrupted'] as const).map(status => ({ ...base, lastResult: { requestId: 'turn', status } }))]) {
    expect(promptSuggestionSource(value, 'default')).toBeUndefined();
  }
  expect(promptSuggestionSource(base, 'another-model')).toBeUndefined();
});
it('decodes the common response contract including a deliberate empty result', () => {
  const response = { sourceRequestId: 'turn', finalMessageId: 'final', modelId: 'default', text: null };
  expect(isPromptSuggestionResponse(response)).toBe(true); expect(isPromptSuggestionResponse({ ...response, text: '请继续核对' })).toBe(true);
  expect(isPromptSuggestionResponse({ ...response, text: ['wrong'] })).toBe(false);
  expect(isPromptSuggestionResponse({ text: 'missing-owner' })).toBe(false); expect(isPromptSuggestionResponse(null)).toBe(false);
});
it('reuses a cached reply after a model change but rejects newer turns or unavailable sources', () => {
  const cached = { sourceRequestId: 'turn', finalMessageId: 'final' };
  expect(matchesPromptSuggestion({ ...snapshot(), modelId: 'another-model' }, cached)).toBe(true);
  expect(matchesPromptSuggestion({ ...snapshot(), active: { requestId: 'next', status: 'responding' } }, cached)).toBe(false);
  expect(matchesPromptSuggestion({ ...snapshot(), lastResult: { requestId: 'next', status: 'succeeded' } }, cached)).toBe(false);
  expect(matchesPromptSuggestion({ ...snapshot(), recoveryWarning: '需核对' }, cached)).toBe(false);
  expect(matchesPromptSuggestion(undefined, cached)).toBe(false);
});
