export interface SourceInfo { id: string; title: string; description: string }
export interface PublicMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
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
}
export interface SessionSummary { id: string; title: string; updatedAt: string }
export interface SessionSnapshot extends SessionSummary {
  messages: PublicMessage[];
  active: RequestState | null;
  lastResult: RequestResult | null;
  recoveryWarning?: string;
}
export interface AppInfo {
  model: string;
  configured: boolean;
  sources: SourceInfo[];
  limits: { timeoutMs: number; maxToolCalls: number; maxOutputTokens: number };
}
export type StreamEvent = {
  sessionId: string;
  requestId: string;
} & (
  | { type: 'response.started' }
  | { type: 'text.delta'; delta: string }
  | { type: 'tool.started'; toolCallId: string; toolName: string }
  | { type: 'tool.completed'; toolCallId: string; toolName: string; text: string; isError: boolean }
  | { type: 'response.completed' | 'response.failed' | 'response.cancelled'; snapshot: SessionSnapshot }
);
export interface ApiError { error: { code: string; message: string } }
