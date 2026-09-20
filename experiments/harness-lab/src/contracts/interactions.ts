import type { HandoffConfirmation } from './collaboration.js';
export interface InteractionQuestion {
  id: string;
  prompt: string;
  options?: { id: string; label: string; description?: string }[];
  multiSelect?: boolean;
}
export type InteractionAnswer = { questionId: string; optionIds: string[] } | { questionId: string; text: string };
interface InteractionBase {
  schemaVersion: 1;
  interactionId: string;
  workspaceId: string;
  sessionId: string;
  requestId: string;
  toolCallId: string;
  toolName: string;
  createdAt: string;
  resolvedAt?: string;
  reason?: string;
}
export interface QuestionInteraction extends InteractionBase {
  kind: 'question';
  questions: InteractionQuestion[];
  status: 'pending' | 'answered' | 'skipped' | 'cancelled' | 'expired';
  answers?: InteractionAnswer[];
}
export interface ConfirmationInteraction extends InteractionBase {
  kind: 'confirmation';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';
  action: { title: string; description: string; command?: string; cwd?: string; parameters: Record<string, unknown>; handoff?: HandoffConfirmation };
  rule: { ruleId: string; reason: string; version: string };
  /** Derived from the native tool result, never from approval alone. */
  execution?: 'succeeded' | 'failed' | 'unknown' | 'not_started';
}
export type Interaction = QuestionInteraction | ConfirmationInteraction;
export type InteractionResponse =
  | { requestId: string; kind: 'question'; action: 'answer'; answers: InteractionAnswer[] }
  | { requestId: string; kind: 'question'; action: 'skip' }
  | { requestId: string; kind: 'confirmation'; decision: 'approve' | 'reject' };
