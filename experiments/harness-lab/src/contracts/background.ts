import type { ComposerSelection, SessionSnapshot, SkillFile, UsageSummary } from './index.js';

export type BackgroundJobKind = 'preprocess' | 'seat_analysis';
export type BackgroundJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export type BackgroundPhase = 'preparing' | 'waiting_model' | 'generating' | 'tool' | 'compacting' | 'subagent';
export type InformationPermission = 'view' | 'manage';

/** Controlled identifiers, never host paths. Bodies are read from fixed files/native history. */
export interface BackgroundFile {
  id: string; name: string; size: number; hash: string;
}
export interface InformationRuleInput {
  name: string; sourceId: string; profileId: string; recipientSeatIds: string[];
  publicTaskId?: string; enabled: boolean;
}
export interface InformationRule extends InformationRuleInput {
  id: string; revision: number; createdAt: string; updatedAt: string;
  createdByUserId: string; updatedByUserId: string;
}
/** Frozen at acceptance, not re-read from the editable rule at claim time. */
export interface BackgroundProfileSnapshot {
  id: string; name: string; goal: string; tools: string[]; skillIds: string[]; agentIds: string[];
  instructions: string;
  resources: Array<{ id: string; title: string; content: string }>;
  skills?: SkillFile[];
  agents?: Array<{name: string; description: string; systemPrompt: string; tools: readonly string[]; hash: string}>;
}
export interface BackgroundRuleSnapshot { rule: InformationRule; profile: BackgroundProfileSnapshot }
export interface BackgroundEvent {
  id: string; sourceId: string; sourceMessageId: string; title: string;
  subjectId?: string; occurredAt?: string; receivedAt: string;
  payloadHash: string; files: BackgroundFile[]; ruleSnapshot?: BackgroundRuleSnapshot;
  initialJobId?: string; revision: number;
}
export interface BackgroundResultRef {
  sessionId: string; requestId: string; finalMessageId?: string; files: BackgroundFile[];
}
export interface BackgroundJob {
  id: string; kind: BackgroundJobKind; eventId: string; sourceId: string;
  status: BackgroundJobStatus; phase?: BackgroundPhase; revision: number;
  createdAt: string; startedAt?: string; endedAt?: string; cancelRequestedAt?: string;
  sessionId?: string; requestId: string; retryOfJobId?: string;
  ruleSnapshot?: BackgroundRuleSnapshot;
  userId?: string; seatId?: string; taskSpaceId?: string; workspaceId?: string;
  deliveryId?: string; actionId?: string;
  model?: string; modelSettingsVersion?: string; result?: BackgroundResultRef; usage?: UsageSummary;
  error?: { code: string; message: string };
}
export interface BackgroundDelivery {
  id: string; eventId: string; jobId: string; sourceId: string; recipientSeatId: string;
  status: 'pending' | 'delivered' | 'failed'; revision: number;
  createdAt: string; updatedAt: string; deliveredAt?: string; error?: { code: string; message: string };
}
export interface BackgroundControl { key: string; enabled: boolean; revision: number; updatedAt: string; updatedByUserId?: string }
export interface InformationSource {
  sourceId: string; name: string; allowedProfileIds: string[]; allowedRecipientSeatIds: string[];
  accepting: boolean; revision: number; permission: InformationPermission;
}
export interface InformationProfile { id: string; name: string; goal: string }
export interface InformationCapabilities {
  enabled: boolean; sources: InformationSource[]; profiles: InformationProfile[];
  seats: Array<{ id: string; name: string }>; canManageQueue: boolean; queue: BackgroundControl & {blockedReason?: string};
}
export interface BackgroundPage<T> { items: T[]; total: number; offset: number; limit: number }
export interface BackgroundEventSummary extends BackgroundEvent { jobs: BackgroundJob[]; deliveries: BackgroundDelivery[] }
export interface BackgroundEventDetail extends BackgroundEventSummary { text: string; results: Array<{jobId: string; text: string; files: BackgroundFile[]}>; analyses: BackgroundAnalysisSummary[] }
/** The center receives only this projection for another seat's analysis. */
export interface BackgroundAnalysisSummary {
  id: string; seatId: string; mode: 'conversation' | 'background';
  status: 'preparing' | 'conversation_ready' | BackgroundJobStatus;
  createdAt: string; endedAt?: string; jobId?: string; sessionId?: string;
}
export interface InboxItem { sourceName?: string; delivery: BackgroundDelivery; event: BackgroundEvent; job: BackgroundJob }
export interface InboxDetail extends InboxItem { text: string; resultText: string; resultFiles: BackgroundFile[]; analyses: BackgroundAnalysisSummary[] }
export interface BackgroundAnalysisInput {
  clientActionId: string; taskSpaceId: string; goal: string;
  mode: 'conversation' | 'background'; includeResult: boolean; fileIds: string[];
  skillIds?: string[]; agentIds?: string[];
}
export interface BackgroundAction {
  id: string; userId: string; seatId: string; clientActionId: string;
  kind: 'analysis' | 'reprocess' | 'process_event' | 'retry_delivery' | 'create_rule';
  inputHash: string; status: 'preparing' | 'completed'; revision: number; createdAt: string; updatedAt: string;
  eventId?: string; deliveryId?: string; taskSpaceId?: string; workspaceId?: string;
  sessionId?: string; requestId?: string; jobId?: string; ruleId?: string;
  analysis?: BackgroundAnalysisInput;
  selection?: ComposerSelection;
  /** Relative destination paths selected once, before copying; retry uses the same plan. */
  imports?: Array<{fileId: string; path: string; completed: boolean}>;
  draft?: string; error?: { code: string; message: string };
  fileRefs?: Array<{path: string; name?: string; size?: number}>;
}
/** All optional content fields require the owning seat's authority for seat analysis. */
export interface InformationJobSummary {
  id: string; kind: BackgroundJobKind; sourceId: string; eventId: string;
  status: BackgroundJobStatus; phase?: BackgroundPhase; revision: number;
  createdAt: string; startedAt?: string; endedAt?: string; seatId?: string; sessionId?: string;
  title?: string;
  /** Preprocessing deliveries belong to this execution, never the latest event-wide state. */
  deliveries?: BackgroundDelivery[];
  error?: {code: string; message: string};
}
export interface InformationJobDetail extends InformationJobSummary {
  text?: string; files?: BackgroundFile[]; snapshot?: SessionSnapshot;
  input?: {title: string; text: string; files: BackgroundFile[]};
  retryOfJobId?: string;
}
export interface BackgroundReceipt { eventId: string; sourceMessageId: string; receivedAt: string; status: 'accepted' }
