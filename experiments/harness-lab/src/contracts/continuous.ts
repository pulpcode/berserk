import type { BackgroundJobStatus, BackgroundProfileSnapshot, BackgroundResultRef, BackgroundFile } from './background.js';
import type { TaskSpace } from './access.js';
import type { PublicMessage } from './index.js';

export interface ContinuousStreamInput {
  name: string; sourceIds: string[]; profileId: string; recipientSeatIds: string[];
  enabled: boolean; quietMs?: number; maxWaitMs?: number;
}
/** Each configuration edit creates a fresh epoch and native session. */
export interface ContinuousStream extends ContinuousStreamInput {
  id: string; epochId: string; revision: number; profile: BackgroundProfileSnapshot;
  sessionId: string; state: 'active' | 'paused' | 'retired';
  createdAt: string; updatedAt: string; createdByUserId: string;
  pauseReason?: string; latestJobId?: string; pendingInputs: number; isCurrent?:boolean;
}
export type ContinuousInput = {
  id: string; epochId: string; receivedAt: string; bytes: number;
} & ({kind: 'event'; eventId: string} | {kind: 'task_revision'; task: TaskSpace});
export interface ContinuousBatch {
  id: string; epochId: string; jobId: string; inputIds: string[]; requiredTaskIds: string[];
  createdAt: string; inputCutoff: string; previousJobId?: string;
}
export type AnalysisChange = 'initial' | 'changed' | 'unchanged' | 'retracted' | 'uncertain';
export interface AnalysisTaskUpdateInput {
  taskId: string; inputIds: string[]; change: AnalysisChange; reason: string; significant: boolean;
}
export interface AnalysisUpdateInput {
  taskUpdates: AnalysisTaskUpdateInput[];
  unassigned: {significant: boolean; reason: string};
  uncertainties: string[];
}
export interface AnalysisUpdate extends Omit<AnalysisUpdateInput, 'taskUpdates'> {
  taskUpdates: Array<AnalysisTaskUpdateInput & {taskRevision: number; taskTitle: string; previousJobId?: string}>;
  toolCallId: string; recordedAt: string;
}
export interface ContinuousRound {
  jobId: string; streamId: string; epochId: string; streamName: string; sourceIds: string[];
  batch: ContinuousBatch; status: BackgroundJobStatus; publication: 'pending' | 'published' | 'unpublished' | 'superseded';
  createdAt: string; publishedAt?: string; resultRef?: BackgroundResultRef; update?: AnalysisUpdate;
  error?: {code: string; message: string}; pendingInputs: number; streamState: ContinuousStream['state']; pauseReason?: string; latestJobId?: string; archivedTaskIds?:string[];
}
export type ContinuousInputEvidence = ContinuousInput & {event?:{id:string;sourceId:string;sourceMessageId:string;title:string;text:string;occurredAt?:string;receivedAt:string;files:BackgroundFile[]}};
export interface ContinuousRoundDetail extends ContinuousRound { text: string; processingText?:string; queryMessages: PublicMessage[]; inputs?:ContinuousInputEvidence[] }
export interface ContinuousCurrentQuery { taskId?: string; jobId?: string; offset?: number; limit?: number; section?: 'result' | 'evidence'; evidenceId?:string; textOffset?:number; textLimit?:number }
export interface ContinuousCurrentResult { items: ContinuousRound[]; total: number; detail?: ContinuousRoundDetail; evidenceIndex?:Array<{id:string;kind:'input'|'tool'|'result'|'processing';length:number}>; evidenceTotal?:number; evidence?:{id:string;text:string;offset:number;total:number;nextOffset?:number} }
export interface ContinuousAccess { enabled: boolean; canRead: boolean; canManage: boolean }
export interface ContinuousExecutionContext {
  stream: ContinuousStream; batch: ContinuousBatch; inputs: ContinuousInput[]; requiredTaskIds: string[];
}
