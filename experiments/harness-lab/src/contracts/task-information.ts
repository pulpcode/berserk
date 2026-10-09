import type { TaskContext, TaskSpace } from './access.js';
import type { BackgroundAnalysisSummary, BackgroundEvent, BackgroundFile, BackgroundJob, BackgroundPage } from './background.js';
import type { PublicMessage } from './index.js';

export interface NewTaskSuggestion { title: string; goal: string; reason: string }
export interface TaskAssessmentInput {
  relations: Array<{taskId: string; reason: string}>;
  newTaskSuggestion?: NewTaskSuggestion;
  emptyReason?: string;
}
export interface TaskAssessment {
  recordedAt: string; toolCallId: string;
  items: Array<{taskSpaceId: string; taskRevision: number; reason: string}>;
  newTaskSuggestion?: NewTaskSuggestion;
  emptyReason?: string;
}
export interface TaskSuggestionCreation {
  taskSpaceId: string; createdByUserId: string; clientActionId: string; createdAt: string;
}
export type BackgroundAnalysisOrigin = {kind: 'inbox'; deliveryId: string}
  | {kind: 'task_information'; taskSpaceId: string; eventId: string; jobId: string};
export interface TaskInformationOverride {
  eventId: string; taskSpaceId: string; mode: 'include' | 'exclude' | 'auto';
  jobId: string; taskRevision: number; reason: string; revision: number;
  updatedByUserId: string; updatedAt: string;
}
export interface TaskLinkUpdateInput {
  revision: number; mode: TaskInformationOverride['mode']; jobId: string; reason?: string;
}
export interface TaskSuggestionCreateInput {
  jobId: string; clientActionId: string; title: string; goal: string; reason: string; context?: TaskContext;
}
export interface TaskInformationLink {
  task: TaskSpace; jobId: string; reason: string;
  mode: TaskInformationOverride['mode']; revision: number; taskRevision: number; taskChanged: boolean; canManage: boolean;
}
export interface TaskLinksView {
  eventId: string; jobId: string; assessment?: TaskAssessment; creation?: TaskSuggestionCreation;
  /** This job's historical judgment, with current human overrides. */
  links: TaskInformationLink[]; canCreateTask: boolean;
  /** Editable decision versions, including auto decisions without a current association. */
  revisions?: Record<string, number>;
}
export interface TaskInformationItem {
  eventId: string; jobId: string; taskSpaceId: string; title: string; sourceId: string; sourceName?: string;
  receivedAt: string; occurredAt?: string; analysisAt: string; reason: string;
  mode: 'auto' | 'include'; revision: number; taskRevision: number; taskChanged: boolean;
}
export interface TaskInformationPage extends BackgroundPage<TaskInformationItem> {
  /** Sources from authorized effective associations, before search/filter/pagination; never a global source directory. */
  sources: Array<{id: string; name: string}>;
}
export interface TaskInformationContent {
  text: string; resultText: string; resultFiles: BackgroundFile[]; queryMessages?: PublicMessage[];
}
export interface TaskInformationDetail extends TaskInformationItem, TaskInformationContent {
  event: BackgroundEvent; job: BackgroundJob;
  analyses?: BackgroundAnalysisSummary[];
}
export interface TaskInformationFilter { query?: string; sourceId?: string; offset?: number; limit?: number }
export interface TaskSuggestionCreateResult { task: TaskSpace; creation: TaskSuggestionCreation; link: TaskInformationOverride }
