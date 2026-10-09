import type { BackgroundJob, BackgroundProfileSnapshot } from '../contracts/background.js';
import type { FileOutput, FileRef, SessionSnapshot, StreamEvent, ComposerSelection } from '../contracts/index.js';
import type { TaskAssessment, TaskAssessmentInput } from '../contracts/task-information.js';

/** Only successful task queries from the current execution contribute evidence. */
export interface TaskAssessmentEvidence { queried: boolean; tasks: ReadonlyMap<string, number> }
export type RecordTaskAssessment = (input: TaskAssessmentInput, evidence: TaskAssessmentEvidence, toolCallId: string, signal?: AbortSignal) =>
  {status: 'recorded' | 'unchanged'; assessment: TaskAssessment; published: false}
  | Promise<{status: 'recorded' | 'unchanged'; assessment: TaskAssessment; published: false}>;

/** Adapter boundary: background queue owns admission; the Pi adapter owns native execution/history. */
export interface BackgroundExecutionInput {
  text: string; directory: string; files: FileRef[]; profile?: BackgroundProfileSnapshot;
  selection?: ComposerSelection;
  recordTaskAssessment?: RecordTaskAssessment;
  onEvent(event: StreamEvent): void;
  publish(input: {sessionId: string; requestId: string; toolCallId: string; path: string}, signal?: AbortSignal): Promise<FileOutput>;
}
export interface BackgroundExecutor {
  execute(job: BackgroundJob, input: BackgroundExecutionInput): Promise<{snapshot: SessionSnapshot}>;
  read(job: BackgroundJob): Promise<SessionSnapshot | null>;
  cancel(job: BackgroundJob): Promise<void>;
}
