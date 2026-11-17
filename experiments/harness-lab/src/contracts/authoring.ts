import type { ExpertDraftContent } from './capability-management.js';
import type { SkillFileInput } from './skills.js';

export interface AuthoringIntent { kind: 'expert' | 'skill'; targetId?: string; baseline?: AuthoringBaseline }
export interface AuthoringBaseline { draftRevision: number; digest: string }
export type AuthoringCandidate = { kind: 'expert'; content: ExpertDraftContent } | { kind: 'skill'; files: SkillFileInput[]; requirements: Record<string, string> };
export interface AuthoringProposal {
  schemaVersion: 1 | 2;
  proposalId: string;
  proposalDigest: string;
  ownerUserId: string;
  sessionId: string;
  requestId: string;
  targetId?: string;
  baseline?: AuthoringBaseline;
  candidate: AuthoringCandidate;
  /** Exact saved baseline for the existing expandable confirmation. */
  before?: AuthoringCandidate;
  summary: string;
  createdAt: string;
}
export interface AuthoringConfirmation { proposal: AuthoringProposal }
export interface AuthoringReceipt {
  schemaVersion: 1;
  proposalId: string;
  proposalDigest: string;
  ownerUserId: string;
  sessionId: string;
  requestId: string;
  kind: 'expert' | 'skill';
  targetId: string;
  baseline?: AuthoringBaseline;
  draftRevision: number;
  draftDigest: string;
  created: boolean;
  savedAt: string;
  confirmation: { interactionId: string; toolCallId: string };
}
export interface AuthoringProposeInput {
  kind: 'expert' | 'skill';
  targetId?: string;
  baseline?: AuthoringBaseline;
  /** Partial fields for an existing expert; all fields required for creation. */
  content?: Partial<ExpertDraftContent>;
  /** File patch: changed/new full text bytes, plus explicit removals. Unchanged files retained. */
  files?: SkillFileInput[];
  /** Existing method body only: the host preserves SKILL.md metadata bytes. */
  methodBody?: string;
  removePaths?: string[];
  summary: string;
}

/** Shared native-result boundary; only host save receipts receive actionable locators. */
export function isAuthoringReceipt(value: unknown): value is AuthoringReceipt {
  const record = (input: unknown): input is Record<string, unknown> => input !== null && typeof input === 'object' && !Array.isArray(input);
  const text = (input: unknown): input is string => typeof input === 'string' && input.length > 0;
  const digest = (input: unknown) => typeof input === 'string' && /^[a-f0-9]{64}$/.test(input);
  const keys = ['schemaVersion','proposalId','proposalDigest','ownerUserId','sessionId','requestId','kind','targetId','baseline','draftRevision','draftDigest','created','savedAt','confirmation'];
  if (!record(value) || Object.keys(value).some(key => !keys.includes(key)) || value.schemaVersion !== 1
    || !['expert','skill'].includes(String(value.kind)) || typeof value.created !== 'boolean'
    || !['proposalId','ownerUserId','sessionId','requestId','targetId'].every(key => text(value[key]))
    || !digest(value.proposalDigest) || !digest(value.draftDigest) || !Number.isSafeInteger(value.draftRevision) || Number(value.draftRevision) < 1
    || !text(value.savedAt) || !Number.isFinite(Date.parse(value.savedAt))) return false;
  const confirmation = value.confirmation;
  if (!record(confirmation) || Object.keys(confirmation).length !== 2 || !text(confirmation.interactionId) || !text(confirmation.toolCallId)) return false;
  const baseline = value.baseline;
  return baseline === undefined || record(baseline) && Object.keys(baseline).length === 2 && Number.isSafeInteger(baseline.draftRevision) && Number(baseline.draftRevision) > 0 && digest(baseline.digest);
}
