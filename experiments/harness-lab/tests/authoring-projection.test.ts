import { expect, test } from 'vitest';
import { isAuthoringReceipt, type AuthoringReceipt } from '../src/contracts/authoring';
import { publicToolDetails } from '../src/pi/chat-projection';

test('only a well-formed successful host authoring result exposes a management locator', () => {
  const receipt: AuthoringReceipt = { schemaVersion: 1, proposalId: 'proposal-id', proposalDigest: 'a'.repeat(64), ownerUserId: 'owner', sessionId: 'session', requestId: 'request', kind: 'skill', targetId: 'skill-id', draftRevision: 1, draftDigest: 'b'.repeat(64), created: true, savedAt: '2026-11-16T00:00:00Z', confirmation: { interactionId: 'interaction', toolCallId: 'call' } };
  expect(isAuthoringReceipt(receipt)).toBe(true);
  expect(publicToolDetails('capability_authoring_save', { authoringReceipt: receipt })?.authoringReceipt).toEqual(receipt);
  expect(publicToolDetails('capability_authoring_read', { authoringReceipt: receipt })?.authoringReceipt).toEqual(receipt);
  expect(publicToolDetails('read', { authoringReceipt: receipt })).toBeUndefined();
  expect(publicToolDetails('capability_authoring_save', { authoringReceipt: receipt }, true)).toBeUndefined();
  for (const changed of [{ targetId: '' }, { kind: 'administrator' }, { draftRevision: 0 }, { proposalDigest: 'wrong' }, { savedAt: 'tomorrow' }, { confirmation: { interactionId: 'interaction' } }, { baseline: { draftRevision: 1, digest: 'wrong' } }]) {
    const invalid: unknown = { ...receipt, ...changed };
    expect(isAuthoringReceipt(invalid)).toBe(false);
    expect(publicToolDetails('capability_authoring_save', { authoringReceipt: invalid })).toBeUndefined();
  }
});
