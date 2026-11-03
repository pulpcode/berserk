import type { BackgroundJobStatus, BackgroundProfileSnapshot, BackgroundResultRef, BackgroundFile } from './background.js';
import type { TaskSpace } from './access.js';
import type { ContextRef, ContextQueryResult } from './context.js';
import { decodeSpatialResult, projectSpatialResult, type SpatialResult } from './spatial.js';
import { normalizeContextQuery, decodeContextResponse } from '../context/validation.js';
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
export interface AssessmentEvidence { id: string; quote: string }
export interface AssessmentCondition {
  id: string; name: string; before: string | null; status: 'met' | 'blocked' | 'unknown' | 'not_applicable';
  kind: 'source' | 'inference'; change: 'initial' | 'changed' | 'unchanged' | 'corrected' | 'withdrawn';
  reason: string; significant: boolean; evidence: AssessmentEvidence[];
}
export interface TaskAssessmentResult { summary: string; conditions: AssessmentCondition[]; recommendations: string[] }
export interface AssessmentSource { id: string; text: string; kind: 'input' | 'task' | 'query' | 'calculation'; jobId: string; length?:number; truncated?:boolean; excerpts?:string[]; digest?:string }
export interface AnalysisTaskUpdateInput {
  taskId: string; inputIds: string[]; change: AnalysisChange; reason: string; significant: boolean; assessment?: TaskAssessmentResult;
}
export interface AnalysisTaskCoverageInput {taskId:string;status:'assessed'|'unrelated'|'uncertain';reason:string}
export interface AnalysisUpdateInput {
  taskCoverage?: AnalysisTaskCoverageInput[];
  taskUpdates: AnalysisTaskUpdateInput[];
  unassigned: {significant: boolean; reason: string};
  uncertainties: string[];
}
export interface AnalysisUpdate extends Omit<AnalysisUpdateInput, 'taskUpdates' | 'taskCoverage'> {
  assessmentSources?: AssessmentSource[];
  discoveryToolCallId?: string;
  discoveryDigest?: string;
  taskCoverage?: Array<AnalysisTaskCoverageInput & {taskRevision:number;taskTitle:string}>;
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
export interface ContinuousCurrentResult { items: ContinuousRound[]; total: number; detail?: ContinuousRoundDetail; evidenceIndex?:Array<{id:string;kind:'input'|'tool'|'result'|'processing';length:number}>; evidenceTotal?:number; evidence?:{id:string;citationId?:string;text:string;offset:number;total:number;nextOffset?:number} }
export interface ContinuousAccess { enabled: boolean; canRead: boolean; canManage: boolean }
export interface ContinuousExecutionContext {
  stream: ContinuousStream; batch: ContinuousBatch; inputs: ContinuousInput[]; requiredTaskIds: string[];
}

/** Complete host discovery; geometry is kept in native details, not transcribed by the model. */
export interface TaskDiscovery {
  schemaVersion:1; requestId:string; toolCallId:string; queriedAt:string;
  inputs:Array<{inputId:string;objectRefs:ContextRef[];resolved:boolean;reason:string}>;
  tasks:Array<{task:Pick<TaskSpace,'id'|'title'|'goal'|'revision'|'context'>;candidate:'related'|'unrelated'|'uncertain';reason:string;spatialResultRefs:string[]}>;
  spatialResults:SpatialResult[];
  sourceQueries?:ContextQueryResult[];
  assessmentSources?: AssessmentSource[];
  assessmentBaselines?: Array<{taskId:string;jobId?:string;assessment?:TaskAssessmentResult}>;
}
export function projectTaskDiscovery(result:TaskDiscovery) {
  return {...result, spatialResults:result.spatialResults.map(projectSpatialResult)};
}
export function extractTaskDiscovery(details:unknown,toolName:string,isError=false,text?:string):TaskDiscovery|null|undefined {
  if(!details || typeof details!=='object' || !Object.hasOwn(details,'taskDiscovery')) return;
  const v=(details as {taskDiscovery?:unknown}).taskDiscovery;
  if(isError || toolName!=='analysis_task_candidates' || !v || typeof v!=='object') return null;
  const d=v as TaskDiscovery;
  const str=(v:unknown)=>typeof v==='string' && !!v.trim();
  const ref=(v:ContextRef)=>v && str(v.systemId) && str(v.objectType) && str(v.objectId);
  if(d.schemaVersion!==1 || !str(d.requestId) || !str(d.toolCallId) || !Number.isFinite(Date.parse(d.queriedAt))
    || !Array.isArray(d.inputs) || d.inputs.length>32 || !d.inputs.every(i=>i && str(i.inputId) && typeof i.resolved==='boolean' && str(i.reason) && Array.isArray(i.objectRefs) && i.objectRefs.every(ref))
    || !Array.isArray(d.tasks) || d.tasks.length>100 || !d.tasks.every(i=>i && i.task && str(i.task.id) && str(i.task.title) && typeof i.task.goal==='string' && Number.isSafeInteger(i.task.revision) && i.task.revision>0 && ['related','unrelated','uncertain'].includes(i.candidate) && str(i.reason) && Array.isArray(i.spatialResultRefs) && i.spatialResultRefs.every(str))
    || new Set(d.tasks.map(i=>i.task.id)).size!==d.tasks.length || !Array.isArray(d.spatialResults) || d.spatialResults.length>100) return null;
  if(d.sourceQueries!==undefined) {
    if(!Array.isArray(d.sourceQueries) || d.sourceQueries.length>100)return null;
    try {for(const q of d.sourceQueries) {
      if(!q || !str(q.systemId) || !Number.isFinite(Date.parse(q.queriedAt)) || !q.query || typeof q.query!=='object' || !q.data) return null;
      const tool='mode' in q.query?'situation_query':'item' in q.data?'information_read':'information_search';
      const params=normalizeContextQuery(tool,q.query);
      if(params.systemId!==q.systemId)return null;
      decodeContextResponse(tool,params,q.data);
    }} catch {return null;}
  }
  if(d.spatialResults.some((r,index)=>!decodeSpatialResult(r) || r.requestId!==d.requestId || r.toolCallId!==`${d.toolCallId}:spatial:${index}` || r.delivery || r.scope.some(i=>i.kind!=='source'))) return null;
  if(d.tasks.some(t=>t.spatialResultRefs.some(ref=>!d.spatialResults.some(r=>r.resultRef===ref)))) return null;
  try {if(text!==undefined && JSON.stringify(JSON.parse(text))!==JSON.stringify(projectTaskDiscovery(d))) return null; return structuredClone(d);} catch {return null;}
}
