import { capabilityDigest } from '../capabilities/service.js';
import { RequestError } from '../contracts/errors.js';
import type { AuthoringProposal, AuthoringReceipt } from '../contracts/authoring.js';

export interface AuthoringGrant { interactionId: string; toolCallId: string; assertAuthorized?: () => void }
export function proposalDigest(value: Omit<AuthoringProposal, 'proposalDigest'>): string { return capabilityDigest(value); }
export function assertProposal(value: AuthoringProposal, userId: string, kind: 'expert' | 'skill'): void {
  const { proposalDigest: digest, ...body } = value;
  if (value.schemaVersion !== 1 || value.ownerUserId !== userId || value.candidate.kind !== kind
    || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(value.proposalId) || !value.sessionId || !value.requestId
    || digest !== proposalDigest(body) || !!value.targetId !== !!value.baseline
    || value.baseline && (!Number.isSafeInteger(value.baseline.draftRevision) || value.baseline.draftRevision < 1 || !/^[0-9a-f]{64}$/.test(value.baseline.digest))) {
    throw new RequestError('AUTHORING_INVALID', '候选内容或关联信息无效。');
  }
}
export function authoringReceipt(proposal: AuthoringProposal, targetId: string, revision: number, digest: string, grant: AuthoringGrant): AuthoringReceipt {
  if (!grant.interactionId || !grant.toolCallId) throw new RequestError('AUTHORING_CONFIRMATION_REQUIRED', '需要当前操作确认。', 409);
  return { schemaVersion: 1, proposalId: proposal.proposalId, proposalDigest: proposal.proposalDigest,
    ownerUserId: proposal.ownerUserId, sessionId: proposal.sessionId, requestId: proposal.requestId,
    kind: proposal.candidate.kind, targetId, ...(proposal.baseline ? { baseline: proposal.baseline } : {}),
    draftRevision: revision, draftDigest: digest, created: !proposal.targetId, savedAt: new Date().toISOString(),
    confirmation: { interactionId: grant.interactionId, toolCallId: grant.toolCallId } };
}
