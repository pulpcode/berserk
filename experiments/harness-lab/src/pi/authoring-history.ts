import { Type } from 'typebox';
import { Check } from 'typebox/value';
import type { AuthoringConfirmation } from '../contracts/authoring.js';
import { assertProposal } from '../authoring/integrity.js';
const strict = { additionalProperties: false };
const id = Type.String({ minLength: 1, maxLength: 160 });
const uuid = Type.String({ pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' });
const digest = Type.String({ pattern: '^[0-9a-f]{64}$' });
const text = Type.String();
const baseline = Type.Object({ draftRevision: Type.Integer({ minimum: 1 }), digest }, strict);
const candidate = Type.Union([
  Type.Object({ kind: Type.Literal('expert'), content: Type.Object({ name: text, description: text, instructions: text, skillIds: Type.Array(id), skillRefs: Type.Optional(Type.Array(Type.Object({ skillId: id, revisionId: id, packageDigest: digest }, strict))), allowedTools: Type.Array(id) }, strict) }, strict),
  Type.Object({ kind: Type.Literal('skill'), files: Type.Array(Type.Object({ path: text, contentBase64: text }, strict)), requirements: Type.Record(Type.String(), Type.String()) }, strict),
]);
export const authoringConfirmationSchema = Type.Object({ proposal: Type.Object({ schemaVersion: Type.Literal(1), proposalId: uuid, proposalDigest: digest, ownerUserId: id, sessionId: uuid, requestId: uuid, targetId: Type.Optional(id), baseline: Type.Optional(baseline), candidate, before: Type.Optional(candidate), summary: text, createdAt: text }, strict) }, strict);
export function validAuthoringConfirmation(value: unknown, sessionId: string, requestId: string): value is AuthoringConfirmation {
  if (!Check(authoringConfirmationSchema, value)) return false;
  const proposal = value.proposal;
  if (proposal.sessionId !== sessionId || proposal.requestId !== requestId || !Number.isFinite(Date.parse(proposal.createdAt))) return false;
  try { assertProposal(proposal, proposal.ownerUserId, proposal.candidate.kind); return true; } catch { return false; }
}
