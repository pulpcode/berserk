export interface SourceInfo { id: string; title: string; description: string; hash: string }
export interface PublicMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  requestId?: string;
  toolName?: string;
  isError?: boolean;
}
export interface RequestState {
  requestId: string;
  status: 'responding' | 'stopping';
}
export interface RequestResult {
  requestId: string;
  status: 'succeeded' | 'failed' | 'cancelled';
  message?: string;
  instructionChanges?: InstructionUpdate[];
  instructionOutcomeUncertain?: boolean;
}
export interface SessionSummary { id: string; workspaceId: string; title: string; updatedAt: string }
export interface SessionSnapshot extends SessionSummary {
  messages: PublicMessage[];
  active: RequestState | null;
  lastResult: RequestResult | null;
  recoveryWarning?: string;
}
export interface AppInfo {
  model: string;
  configured: boolean;
  limits: { timeoutMs: number; maxToolCalls: number; maxOutputTokens: number };
}
export type StreamEvent = {
  sessionId: string;
  requestId: string;
} & (
  | { type: 'response.started' }
  | { type: 'resources.loaded'; resources: WorkspaceResources }
  | { type: 'instructions.updated'; change: InstructionUpdate }
  | { type: 'text.delta'; delta: string }
  | { type: 'tool.started'; toolCallId: string; toolName: string }
  | { type: 'tool.completed'; toolCallId: string; toolName: string; text: string; isError: boolean }
  | { type: 'response.completed' | 'response.failed' | 'response.cancelled'; snapshot: SessionSnapshot }
);
export interface ApiError { error: { code: string; message: string } }

export interface Workspace { id: string; name: string; createdAt: string }
export interface WorkspaceList { defaultWorkspaceId: string; workspaces: Workspace[] }
export type InstructionFileId = 'common' | 'workspace';
export interface InstructionInfo { fileId: InstructionFileId; name: string; hash: string | null; editable: boolean }
export interface InstructionFile extends InstructionInfo { content: string }
export interface InstructionUpdate {
  fileId: 'workspace'; status: 'updated' | 'unchanged'; previousHash: string | null;
  hash: string; effectiveFrom: 'next_request';
}
export interface SkillInfo { id: string; name: string; description: string; version: string; hash: string }
export interface SkillFile extends SkillInfo { content: string }
export interface WorkspaceResources { workspaceId: string; instructions: InstructionInfo[]; sources: SourceInfo[]; skills: SkillInfo[] }
export type RequestResourcesRecord = {
  status: 'available'; requestId: string; workspaceId: string; instructions: InstructionFile[];
  skills: SkillInfo[]; readSkills: SkillFile[]; editableFileIds: InstructionFileId[];
} | { status: 'unavailable'; requestId: string; message: string };
