import type { ExpertRevision, ExpertRef, SkillRevision, CapabilityState } from './capabilities';

export interface ExpertDraftContent { name: string; description: string; instructions: string; skillIds: string[]; allowedTools: string[] }
export interface ExpertUsePolicy { mode: 'none' | 'all' | 'seats'; seatIds: string[]; revision: number }
export interface ExpertDraft { expertId: string; draftRevision: number; draftDigest: string; content: ExpertDraftContent; baseRevisionId: string | null; updatedAt: string; updatedBy: string }
export interface ValidationIssue { code: string; message: string; severity: 'error' | 'warning' }
export interface ExpertValidation { validationId: string; expertId: string; draftRevision: number; draftDigest: string; valid: boolean; policyDigest: string; issues: ValidationIssue[]; skills: SkillRevision[]; tools: string[]; createdAt: string }
export interface ExpertTrialRecord { trialId: string; expertId: string; ownerId: string; draftDigest: string; validationId: string; status: 'prepared' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'; input: string; createdAt: string; completedAt?: string; evidence?: ExpertTrialEvidence; confirmedAt?: string; confirmedBy?: string; decision?: { approved: boolean; reason: string; by: string; at: string } }
export interface ExpertTrialEvidence { tools: string[]; model: string; runtime: string; fileEnvironmentVerified: boolean; success: boolean; summary: string; unverified: string[] }
export interface ExpertPublication { publicationId: string; expertId: string; revisionId: string; digest: string; releaseVersion: string; releaseNotes: string; draftDigest: string; validationId: string; trialId: string; publishedAt: string; publishedBy: string }
export interface ExpertAudit { auditId: string; expertId: string; actorId: string; action: string; createdAt: string; details: unknown }
export interface ManagedExpertSummary { expertId: string; name: string; description?: string; source: 'builtin' | 'organization'; stateRevision: number; archived: boolean; currentRevisionId: string | null; releaseVersion: string | null; draftRevision: number | null; state: CapabilityState; policy: ExpertUsePolicy }
export interface ManagedExpertDetail { expert: ManagedExpertSummary; draft: ExpertDraft | null; current: ExpertRevision | null; validations: ExpertValidation[]; trials: ExpertTrialRecord[]; publications: ExpertPublication[]; audit: ExpertAudit[] }
export interface CapabilityToolOption { id: string; name: string; group: 'read' | 'files' | 'business'; requiresFileEnvironment?: boolean }
export interface CapabilitySeatOption { id: string; name: string }
export interface CapabilityManagementCatalog { tools: CapabilityToolOption[]; skills: Array<{id:string;name:string;description:string}>; seats: CapabilitySeatOption[] }
export type ExpertDefaultChoice = { mode: 'inherit' } | { mode: 'general' } | { mode: 'expert'; expertId: string };
export interface ExpertDefaultScope { kind: 'personal' | 'seat' | 'task'; id: string }
export interface ExpertDefaultSetting { scope: ExpertDefaultScope; revision: number; choice: ExpertDefaultChoice }
export interface ResolvedExpertDefault { source: 'task' | 'personal' | 'seat' | 'general'; expertRef: ExpertRef; digest: string; name: string }
export interface ManagementActor { userId: string; seatId?: string }
export interface PublishExpertInput { clientActionId: string; expectedDraftRevision: number; expectedCurrentRevisionId: string | null; validationId: string; trialId: string; releaseNotes: string; acceptedRiskCodes: string[] }
export interface ExpertImpact { activeRequests: number; defaultReferences: number; dependentExperts: number | null }
