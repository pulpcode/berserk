import type { Interaction } from './interactions.js';
export type * from './interactions.js';
import type { FileRef, FileOutput } from './files.js';
export type * from './files.js';
export type * from './collaboration.js';
export interface SourceInfo { id: string; title: string; description: string; hash: string }
export interface PublicMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  requestId?: string;
  toolName?: string;
  isError?: boolean;
  toolCallId?: string;
  /** UI-only notice for an interrupted call, not a persisted tool result. */
  resultMissing?: true;
  attachments?: FileRef[];
  selections?: LoadedComposerSelection;
}
export interface SubagentSummary {
  subagentId: string;
  parentRequestId: string;
  toolCallId: string;
  role: string;
  description: string;
  task: string;
  status: 'running' | 'stopping' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  phase?: 'preparing' | 'generating' | 'tool' | 'compacting' | 'retrying';
  toolName?: string;
  result?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
}
export interface RequestState {
  requestId: string;
  status: 'responding' | 'stopping';
  phase?: 'preparing' | 'generating' | 'tool' | 'compacting' | 'subagent' | 'waiting_answer' | 'waiting_confirmation';
  toolName?: string;
}
export interface RequestResult {
  requestId: string;
  /** interrupted is a read projection only; native terminal records keep their existing format. */
  status: 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  message?: string;
  instructionChanges?: InstructionUpdate[];
  instructionOutcomeUncertain?: boolean;
  compactionIds?: string[];
  compactions?: CompactionSummary[];
  usageSummary?: UsageSummary;
  subagentUsage?: UsageSummary;
}
/** Read-only evidence for presentation; absence of a final ID must not imply a final answer. */
export interface ConversationTurn {
  requestId: string;
  status: RequestResult['status'];
  finalMessageId?: string;
}
export interface SessionSummary { id: string; workspaceId: string; workItemId?: string; title: string; updatedAt: string }
export interface SessionActivity extends SessionSummary {
  active: RequestState | null;
  lastResult: Pick<RequestResult, 'requestId' | 'status'> | null;
  recoveryWarning?: string;
  statusUpdatedAt: string;
}
export interface SessionSnapshot extends SessionSummary {
  turns?: ConversationTurn[];
  interactions?: Interaction[];
  fileOutputs?: FileOutput[];
  subagents?: SubagentSummary[];
  latestCompaction?: CompactionSummary;
  messages: PublicMessage[];
  active: RequestState | null;
  lastResult: RequestResult | null;
  recoveryWarning?: string;
}
export interface AppInfo {
  testSeats?: Array<{ id: string; name: string }>;
  defaultSeatId?: string;
  files?: { enabled: boolean; maxFileBytes: number; maxAttachments: number; executionAvailable: boolean };
  model: string;
  configured: boolean;
  contextReady: boolean;
  limits: { agentRunTimeoutMs: number | null; httpIdleTimeoutMs: number; llmRequestTimeoutMs: number | null; maxOutputTokens: number | null };
}
export interface ModelParameters {
  contextWindow: number | null;
  maxOutputTokens: number | null;
  compactionReserveTokens: number | null;
  compactionKeepRecentTokens: number | null;
}
export interface ModelSettings extends ModelParameters {
  contextSource: 'preset' | 'explicit' | 'unknown';
  outputSource: 'preset' | 'explicit' | 'unknown';
  contextReady: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  configured: boolean;
  version: string;
  source: 'environment' | 'local';
}
export interface ModelSettingsUpdate {
  contextWindow?: number;
  maxOutputTokens?: number;
  compactionReserveTokens?: number;
  compactionKeepRecentTokens?: number;
  provider: string;
  model: string;
  baseUrl: string;
  expectedVersion: string;
  apiKey?: string;
}
export type StreamEvent = {
  sessionId: string;
  requestId: string;
} & (
  | { type: 'response.started' }
  | { type: 'context.compaction_started'; reason: CompactionReason }
  | { type: 'context.compaction_completed'; compaction: CompactionSummary }
  | { type: 'resources.loaded'; resources: WorkspaceResources }
  | { type: 'instructions.updated'; change: InstructionUpdate }
  | { type: 'text.delta'; delta: string }
  | { type: 'tool.started'; toolCallId: string; toolName: string }
  | { type: 'tool.completed'; toolCallId: string; toolName: string; text: string; isError: boolean }
  | { type: 'interaction.updated'; interaction: Interaction }
  | { type: 'subagent.updated'; subagent: SubagentSummary }
  | { type: 'files.output'; file: FileOutput }
  | { type: 'response.completed' | 'response.failed' | 'response.cancelled'; snapshot: SessionSnapshot }
);
export interface ApiError { error: { code: string; message: string } }

export interface Workspace { id: string; name: string; createdAt: string; taskSpaceId?: string; seatId?: string }
export interface WorkspaceList { defaultWorkspaceId: string; workspaces: Workspace[] }
export interface ActivityOverview extends WorkspaceList { sessions: SessionActivity[] }
export type InstructionFileId = 'common' | 'workspace';
export interface InstructionInfo { fileId: InstructionFileId; name: string; hash: string | null; editable: boolean }
export interface InstructionFile extends InstructionInfo { content: string }
export interface InstructionUpdate {
  fileId: 'workspace'; status: 'updated' | 'unchanged'; previousHash: string | null;
  hash: string; effectiveFrom: 'next_request';
}
export interface SkillInfo { id: string; name: string; description: string; version: string; hash: string }
export interface SkillFile extends SkillInfo { content: string }
export interface AgentInfo { name: string; description: string; hash: string }
export interface ComposerSelection { skill?: { id: string; hash: string }; agent?: { name: string; hash: string } }
export interface LoadedComposerSelection { skill?: SkillFile; agent?: AgentInfo }
export interface WorkspaceResources { workspaceId: string; instructions: InstructionInfo[]; sources: SourceInfo[]; skills: SkillInfo[] }
export type RequestResourcesRecord = { compactions?: CompactionSummary[]; usageSummary?: UsageSummary } & ({
  status: 'available'; requestId: string; workspaceId: string; instructions: InstructionFile[];
  skills: SkillInfo[]; readSkills: SkillFile[]; editableFileIds: InstructionFileId[];
} | { status: 'unavailable'; requestId: string; message: string });

export type CompactionReason = 'threshold' | 'overflow' | 'unknown';
/** Actual provider usage, distinct from context-size estimates; null means unavailable. */
export interface TokenUsage { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number }
export interface UsageSummary {
  modelAttempts: number;
  replyAttempts: number;
  compactionAttempts: number;
  toolCalls: number;
  unknownUsageAttempts: number;
  actual: TokenUsage | null;
}
export interface CompactionSummary {
  id: string;
  createdAt: string;
  reason: CompactionReason;
  tokensBefore: number;
  tokensAfter: number | null;
  requestId?: string;
  model?: string;
  modelSettingsVersion?: string;
  usage?: TokenUsage | null;
}
export interface CompactionDetail extends CompactionSummary {
  sessionId: string;
  summary: string;
  firstKeptEntryId: string;
}
