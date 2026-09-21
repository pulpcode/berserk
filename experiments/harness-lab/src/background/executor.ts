import type { BackgroundJob, BackgroundProfileSnapshot } from '../contracts/background.js';
import type { FileOutput, FileRef, SessionSnapshot, StreamEvent, ComposerSelection } from '../contracts/index.js';

/** Adapter boundary: background queue owns admission; the Pi adapter owns native execution/history. */
export interface BackgroundExecutionInput {
  text: string; directory: string; files: FileRef[]; profile?: BackgroundProfileSnapshot;
  selection?: ComposerSelection;
  onEvent(event: StreamEvent): void;
  publish(input: {sessionId: string; requestId: string; toolCallId: string; path: string}, signal?: AbortSignal): Promise<FileOutput>;
}
export interface BackgroundExecutor {
  execute(job: BackgroundJob, input: BackgroundExecutionInput): Promise<{snapshot: SessionSnapshot}>;
  read(job: BackgroundJob): Promise<SessionSnapshot | null>;
  cancel(job: BackgroundJob): Promise<void>;
}
