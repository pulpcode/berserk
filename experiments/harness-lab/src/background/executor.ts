import type { CalculationInput } from '../pi/analysis-calculation.js';
import type { BackgroundJob, BackgroundProfileSnapshot, RecipientSuggestionInput, RecipientSuggestion } from '../contracts/background.js';
import type { FileOutput, FileRef, SessionSnapshot, StreamEvent, ComposerSelection } from '../contracts/index.js';
import type { TaskAssessment, TaskAssessmentInput } from '../contracts/task-information.js';
import type { AnalysisUpdateInput, AnalysisUpdate, ContinuousExecutionContext, ContinuousCurrentQuery, ContinuousCurrentResult, TaskDiscovery } from '../contracts/continuous.js';

/** Only successful task queries from the current execution contribute evidence. */
export interface TaskAssessmentEvidence { queried: boolean; tasks: ReadonlyMap<string, number>; messages?: SessionSnapshot["messages"] }
export type RecordTaskAssessment = (input: TaskAssessmentInput, evidence: TaskAssessmentEvidence, toolCallId: string, signal?: AbortSignal) =>
  {status: 'recorded' | 'unchanged'; assessment: TaskAssessment; published: false}
  | Promise<{status: 'recorded' | 'unchanged'; assessment: TaskAssessment; published: false}>;

export type RecordRecipientSuggestion = (input: RecipientSuggestionInput, toolCallId: string, signal?: AbortSignal) =>
  {suggestion: RecipientSuggestion; published: false} | Promise<{suggestion: RecipientSuggestion; published: false}>;

export type RecordAnalysisUpdate = (input: AnalysisUpdateInput, evidence: TaskAssessmentEvidence, toolCallId: string, signal?: AbortSignal) =>
  {update: AnalysisUpdate; published: false} | Promise<{update: AnalysisUpdate; published: false}>;
export type ReadTaskCandidates = (toolCallId:string, signal?:AbortSignal) => Promise<TaskDiscovery>;
export type ReadAnalysisCurrent = (query: ContinuousCurrentQuery, signal?: AbortSignal) => Promise<ContinuousCurrentResult>;
/** Read-only host check while the same native request is still active. */
export type CheckAnalysisCompletion = (snapshot: SessionSnapshot) => 'ready' | 'missing' | 'stale';

/** Adapter boundary: background queue owns admission; the Pi adapter owns native execution/history. */
export interface BackgroundExecutionInput {
  text: string; directory: string; files: FileRef[]; profile?: BackgroundProfileSnapshot;
  selection?: ComposerSelection;
  recordTaskAssessment?: RecordTaskAssessment;
  recordRecipientSuggestion?: RecordRecipientSuggestion;
  continuous?: ContinuousExecutionContext;
  recordAnalysisUpdate?: RecordAnalysisUpdate;
  readAnalysisCurrent?: ReadAnalysisCurrent;
  readTaskCandidates?: ReadTaskCandidates;
  readAssessmentSource?: (id:string,offset:number,limit:number,signal?:AbortSignal)=>Promise<unknown>;
  calculateAnalysis?: (input:CalculationInput,toolCallId:string,signal?:AbortSignal,evidence?:TaskAssessmentEvidence)=>unknown;
  checkAnalysisCompletion?: CheckAnalysisCompletion;
  onEvent(event: StreamEvent): void;
  publish(input: {sessionId: string; requestId: string; toolCallId: string; path: string}, signal?: AbortSignal): Promise<FileOutput>;
}
export interface BackgroundExecutor {
  execute(job: BackgroundJob, input: BackgroundExecutionInput): Promise<{snapshot: SessionSnapshot}>;
  read(job: BackgroundJob, profile?: BackgroundProfileSnapshot): Promise<SessionSnapshot | null>;
  cancel(job: BackgroundJob): Promise<void>;
}
