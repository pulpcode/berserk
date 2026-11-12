import { describe, expect, it } from 'vitest';
import type { Interaction, QuestionInteraction, SessionSnapshot } from '../../src/contracts/index';
import { currentInteraction } from '../../src/web/InteractionCard';

const base = { schemaVersion: 1 as const, interactionId: 'i1', workspaceId: 'w1', sessionId: 'A', requestId: 'r1', toolCallId: 't1', toolName: 'ask_user', createdAt: '2026-11-12T00:00:00Z' };
const question = (overrides: Partial<QuestionInteraction> = {}): QuestionInteraction => ({
  ...base, kind: 'question', status: 'pending', questions: [{ id: 'q1', prompt: '选择？', options: [{ id: 'a', label: 'A' }] }], ...overrides,
});
const snapshot = (interactions: Interaction[], active: SessionSnapshot['active']): SessionSnapshot => ({
  id: 'A', workspaceId: 'w1', title: 'A', updatedAt: base.createdAt, messages: [], interactions, active, lastResult: null,
});
const responding = { requestId: 'r1', status: 'responding' as const, phase: 'waiting_answer' as const };

describe('currentInteraction', () => {
  it('is empty without a snapshot, an active request, or while stopping', () => {
    expect(currentInteraction(undefined)).toBeUndefined();
    expect(currentInteraction(snapshot([question()], null))).toBeUndefined();
    expect(currentInteraction(snapshot([question()], { ...responding, status: 'stopping' }))).toBeUndefined();
  });
  it('ignores settled interactions and other requests', () => {
    expect(currentInteraction(snapshot([question({ status: 'answered' })], responding))).toBeUndefined();
    expect(currentInteraction(snapshot([question({ requestId: 'r0' })], responding))).toBeUndefined();
  });
  it('returns the first pending interaction of the active request in record order', () => {
    const first = question();
    const second = question({ interactionId: 'i2', toolCallId: 't2' });
    expect(currentInteraction(snapshot([first, second], responding))?.interactionId).toBe('i1');
    expect(currentInteraction(snapshot([question({ status: 'skipped' }), second], responding))?.interactionId).toBe('i2');
  });
});
