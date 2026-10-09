import type { DatabaseSync } from 'node:sqlite';
import type { AccessStore } from '../access/store.js';
import type { Identity, TaskSpace } from '../contracts/access.js';
import type { BackgroundAnalysisSummary, BackgroundEvent, BackgroundJob } from '../contracts/background.js';
import type { BackgroundAnalysisOrigin, TaskAssessment, TaskAssessmentInput, TaskInformationContent, TaskInformationDetail, TaskInformationFilter, TaskInformationItem, TaskInformationLink, TaskInformationOverride, TaskInformationPage, TaskLinkUpdateInput, TaskLinksView, TaskSuggestionCreateInput, TaskSuggestionCreateResult, TaskSuggestionCreation } from '../contracts/task-information.js';
import { RequestError } from '../contracts/errors.js';
import { parseJsonStrict, stateError } from '../resources/files.js';
import { UUID } from '../workspaces/store.js';
import type { BackgroundStore } from './store.js';

const missing = () => new RequestError('INFORMATION_NOT_FOUND', '信息不存在或无权访问。', 404);
const conflict = (message = '关联已变化，请读取最新内容后重试。') => new RequestError('INFORMATION_LINK_CONFLICT', message, 409);
const invalid = (message = '请提供有效的任务判断。') => new RequestError('INVALID_INPUT', message);
const reasonText = (value: unknown) => typeof value === 'string' && !!value.trim() && value.length <= 1500;
const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const positive = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function suggestion(value: unknown) {
  return object(value) && typeof value.title === 'string' && !!value.title.trim() && value.title.length <= 60
    && typeof value.goal === 'string' && !!value.goal.trim() && value.goal.length <= 8000 && reasonText(value.reason)
    && Object.keys(value).every(key => ['title', 'goal', 'reason'].includes(key));
}
/** Shared by recording and database reopen; malformed persisted judgment fails closed. */
export function validTaskAssessment(value: unknown): value is TaskAssessment {
  if (!object(value) || !timestamp(value.recordedAt) || typeof value.toolCallId !== 'string' || !value.toolCallId.trim()
    || !Array.isArray(value.items) || value.items.length > 100 || Object.keys(value).some(key => !['recordedAt', 'toolCallId', 'items', 'newTaskSuggestion', 'emptyReason'].includes(key))) return false;
  const ids = new Set<string>();
  for (const item of value.items) {
    if (!object(item) || typeof item.taskSpaceId !== 'string' || !UUID.test(item.taskSpaceId) || !positive(item.taskRevision) || !reasonText(item.reason)
      || Object.keys(item).some(key => !['taskSpaceId', 'taskRevision', 'reason'].includes(key)) || ids.has(item.taskSpaceId)) return false;
    ids.add(item.taskSpaceId);
  }
  const modes = Number(value.items.length > 0) + Number(value.newTaskSuggestion !== undefined) + Number(value.emptyReason !== undefined);
  return modes === 1 && (value.newTaskSuggestion === undefined || suggestion(value.newTaskSuggestion))
    && (value.emptyReason === undefined || reasonText(value.emptyReason));
}
export function validSuggestionCreation(value: unknown): value is TaskSuggestionCreation {
  return object(value) && Object.keys(value).every(key => ['taskSpaceId', 'createdByUserId', 'clientActionId', 'createdAt'].includes(key))
    && [value.taskSpaceId, value.createdByUserId, value.clientActionId].every(id => typeof id === 'string' && UUID.test(id)) && timestamp(value.createdAt);
}
export function validAnalysisOrigin(value: unknown): value is BackgroundAnalysisOrigin {
  if (!object(value)) return false;
  if (value.kind === 'inbox') return typeof value.deliveryId === 'string' && UUID.test(value.deliveryId) && Object.keys(value).every(key => ['kind', 'deliveryId'].includes(key));
  return value.kind === 'task_information' && [value.taskSpaceId, value.eventId, value.jobId].every(id => typeof id === 'string' && UUID.test(id))
    && Object.keys(value).every(key => ['kind', 'taskSpaceId', 'eventId', 'jobId'].includes(key));
}
function decodeOverride(row: Record<string, unknown>): TaskInformationOverride {
  try {
    const value = JSON.parse(String(row.data)) as TaskInformationOverride;
    if (!value || value.eventId !== row.event_id || value.taskSpaceId !== row.task_id || value.jobId !== row.job_id
      || ![value.eventId, value.taskSpaceId, value.jobId, value.updatedByUserId].every(id => typeof id === 'string' && UUID.test(id))
      || !['include', 'exclude', 'auto'].includes(value.mode) || !positive(value.revision) || !positive(value.taskRevision)
      || !timestamp(value.updatedAt) || typeof value.reason !== 'string' || value.reason.length > 1500 || (value.mode === 'include' && !value.reason.trim())) throw stateError();
    return value;
  } catch { throw stateError(); }
}
export function validateTaskLinkIntegrity(db: DatabaseSync, jobs: Map<string, BackgroundJob>) {
  for (const row of db.prepare('SELECT * FROM information_task_overrides').all()) {
    const link = decodeOverride(row), job = jobs.get(link.jobId);
    if (!job || job.kind !== 'preprocess' || job.status !== 'succeeded' || job.eventId !== link.eventId) throw stateError();
  }
  for (const job of jobs.values()) {
    if (job.taskAssessment) for (const item of job.taskAssessment.items) {
      const row = db.prepare('SELECT data FROM task_spaces WHERE id=?').get(item.taskSpaceId);
      if (!row || JSON.parse(String(row.data)).visibility !== 'public') throw stateError();
    }
    const creation = job.taskSuggestionCreation;
    if (creation) {
      const action = db.prepare('SELECT task_id,input FROM task_actions WHERE user_id=? AND action_id=?').get(creation.createdByUserId, creation.clientActionId);
      if (action?.task_id !== creation.taskSpaceId) throw stateError();
      const input = parseJsonStrict(String(action.input));
      const origin = Array.isArray(input) ? input.at(-1) : undefined;
      if (!origin || origin.eventId !== job.eventId || origin.jobId !== job.id
        || !db.prepare('SELECT 1 FROM information_task_overrides WHERE event_id=? AND task_id=?').get(job.eventId, creation.taskSpaceId)) throw stateError();
    }
    const origin = job.origin;
    if (origin?.kind === 'task_information') {
      const source = jobs.get(origin.jobId);
      if (!source || source.kind !== 'preprocess' || source.status !== 'succeeded' || source.eventId !== origin.eventId || job.eventId !== origin.eventId || job.taskSpaceId !== origin.taskSpaceId) throw stateError();
    }
  }
}

export interface TaskLinkDependencies {
  /** Current source permission OR an actual delivery to this seat, plus scope. Not scope alone. */
  canRead(actor: Identity, event: BackgroundEvent, job: BackgroundJob): boolean;
  sourceName(sourceId: string): string;
  readContent(actor: Identity, event: BackgroundEvent, job: BackgroundJob): Promise<TaskInformationContent>;
  analysisSummaries?(actor: Identity, taskId: string, eventId: string, jobId: string): BackgroundAnalysisSummary[];
}
export interface ObservedTasks { queried: boolean; tasks: ReadonlyMap<string, number> }

/** Metadata relations only. Native Pi history remains the authority for all analysis content. */
export class TaskLinkService {
  constructor(readonly access: AccessStore, readonly store: BackgroundStore, private readonly dependencies: TaskLinkDependencies) {}
  private actor(actor: Identity) {
    const current = this.access.identity(actor.userId);
    if (!current || current.seatId !== actor.seatId) throw missing();
    return current;
  }
  private readable(actor: Identity, event: BackgroundEvent, job: BackgroundJob) {
    return job.eventId === event.id && job.sourceId === event.sourceId && job.kind === 'preprocess' && job.status === 'succeeded'
      && !!job.result && this.dependencies.canRead(actor, event, job);
  }
  authorize(actor: Identity, eventId: string, jobId: string) {
    actor = this.actor(actor);
    const event = this.store.getEvent(eventId), job = this.store.getJob(jobId);
    if (!this.readable(actor, event, job)) throw missing();
    return {actor, event, job};
  }
  private manageable(actor: Identity, task: TaskSpace) { return task.visibility === 'public' ? actor.createPublicTask : task.ownerSeatId === actor.seatId; }
  private overrides(eventId?: string, taskId?: string) {
    const where = [eventId ? 'event_id=?' : '', taskId ? 'task_id=?' : ''].filter(Boolean);
    return this.store.db.prepare(`SELECT * FROM information_task_overrides${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`).all(...[eventId, taskId].filter((value): value is string => value !== undefined)).map(decodeOverride);
  }
  private writeOverride(value: TaskInformationOverride) {
    this.store.db.prepare('INSERT INTO information_task_overrides VALUES(?,?,?,?) ON CONFLICT(event_id,task_id) DO UPDATE SET job_id=excluded.job_id,data=excluded.data')
      .run(value.eventId, value.taskSpaceId, value.jobId, JSON.stringify(value));
    return value;
  }
  recordAssessment(jobId: string, input: TaskAssessmentInput, observed: ObservedTasks, toolCallId: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    return this.store.transaction(() => {
      signal?.throwIfAborted();
      const job = this.store.getJob(jobId);
      if (job.kind !== 'preprocess' || job.status !== 'running' || job.cancelRequestedAt
        || !job.ruleSnapshot?.profile.tools.includes('information_record_task_assessment')) throw new RequestError('TASK_ASSESSMENT_UNAVAILABLE', '本次处理不能记录任务判断。', 409);
      if (!input || !Array.isArray(input.relations) || input.relations.length > 100 || Object.keys(input).some(key => !['relations', 'newTaskSuggestion', 'emptyReason'].includes(key))) throw invalid();
      const items: TaskAssessment['items'] = [], seen = new Set<string>();
      for (const relation of input.relations) {
        if (!relation || typeof relation.taskId !== 'string' || !UUID.test(relation.taskId) || !reasonText(relation.reason)
          || Object.keys(relation).some(key => !['taskId', 'reason'].includes(key))) throw invalid();
        const revision = observed.tasks.get(relation.taskId);
        if (revision === undefined) throw new RequestError('TASK_NOT_QUERIED', '请先查询需要关联的任务。');
        const task = this.access.getActivePublic(relation.taskId);
        if (task.revision !== revision) throw conflict('任务已变化，请重新查询后记录判断。');
        if (seen.has(task.id)) {
          if (items.find(item => item.taskSpaceId === task.id)?.reason !== relation.reason.trim()) throw invalid('同一任务不能提交不同关联理由。');
          continue;
        }
        seen.add(task.id); items.push({taskSpaceId: task.id, taskRevision: revision, reason: relation.reason.trim()});
      }
      if (input.newTaskSuggestion !== undefined && !observed.queried) throw new RequestError('TASK_NOT_QUERIED', '请先成功查询活动公共任务，再记录新建建议。');
      const assessment: TaskAssessment = {recordedAt: new Date().toISOString(), toolCallId, items,
        ...(input.emptyReason !== undefined ? {emptyReason: input.emptyReason} : {}),
        ...(input.newTaskSuggestion !== undefined ? {newTaskSuggestion: input.newTaskSuggestion} : {})};
      if (!validTaskAssessment(assessment)) throw invalid('请选择关联已有任务、建议新建或暂不归口其中一种，并填写理由。');
      if (assessment.emptyReason) assessment.emptyReason = assessment.emptyReason.trim();
      if (assessment.newTaskSuggestion) assessment.newTaskSuggestion = {title: assessment.newTaskSuggestion.title.trim(), goal: assessment.newTaskSuggestion.goal.trim(), reason: assessment.newTaskSuggestion.reason.trim()};
      const content = (value: TaskAssessment) => JSON.stringify([value.items, value.newTaskSuggestion, value.emptyReason]);
      if (job.taskAssessment && content(job.taskAssessment) === content(assessment)) return {status: 'unchanged' as const, assessment: job.taskAssessment, published: false as const};
      this.store.saveTaskAssessmentInTransaction(job, assessment);
      return {status: 'recorded' as const, assessment, published: false as const};
    });
  }
  /** Choose a whole batch in persisted insertion order, after authorization. */
  private effective(actor: Identity, task: TaskSpace, event: BackgroundEvent, jobs: BackgroundJob[], override?: TaskInformationOverride): TaskInformationItem | undefined {
    if (override?.mode === 'exclude') return;
    const job = override?.mode === 'include'
      ? jobs.find(job => job.id === override.jobId && this.readable(actor, event, job))
      : jobs.find(job => !!job.taskAssessment && this.readable(actor, event, job));
    if (!job) return;
    const item = job.taskAssessment?.items.find(item => item.taskSpaceId === task.id);
    if (override?.mode !== 'include' && !item) return;
    const version = override?.mode === 'include' ? override.taskRevision : item!.taskRevision;
    return {eventId: event.id, jobId: job.id, taskSpaceId: task.id, title: event.title, sourceId: event.sourceId, sourceName: this.dependencies.sourceName(event.sourceId),
      receivedAt: event.receivedAt, occurredAt: event.occurredAt, analysisAt: job.endedAt ?? job.createdAt,
      reason: override?.mode === 'include' ? override.reason : item!.reason, mode: override?.mode === 'include' ? 'include' : 'auto',
      revision: override?.revision ?? 0, taskRevision: version, taskChanged: version !== task.revision};
  }
  list(actor: Identity, taskId: string, filter: TaskInformationFilter = {}): TaskInformationPage {
    actor = this.actor(actor); const task = this.access.get(taskId, actor.seatId);
    const offset = filter.offset ?? 0, limit = filter.limit ?? 20;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (filter.query !== undefined && (typeof filter.query !== 'string' || filter.query.length > 200))) throw invalid('分页或搜索参数无效。');
    const jobs = this.store.listJobs(), overrides = new Map(this.overrides(undefined, taskId).map(item => [item.eventId, item]));
    const query = filter.query?.trim().toLocaleLowerCase();
    const authorized = this.store.listEvents().flatMap(event => {
      const item = this.effective(actor, task, event, jobs, overrides.get(event.id));
      return item ? [item] : [];
    });
    // The source picker covers every readable effective association, not only this page or filter.
    const sources = [...new Map(authorized.map(item => [item.sourceId, {id: item.sourceId, name: item.sourceName ?? item.sourceId}])).values()];
    const items = authorized.filter(item => (!filter.sourceId || filter.sourceId === item.sourceId)
      && (!query || [item.title, item.reason, item.sourceName ?? item.sourceId].some(text => text.toLocaleLowerCase().includes(query))))
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    return {items: items.slice(offset, offset + limit), total: items.length, offset, limit, sources};
  }

  resolve(actor: Identity, taskId: string, eventId: string, jobId: string, write = false) {
    const authorized = this.authorize(actor, eventId, jobId); actor = authorized.actor;
    const task = this.access.get(taskId, actor.seatId, write);
    const item = this.effective(actor, task, authorized.event, this.store.listJobs(), this.overrides(eventId, taskId)[0]);
    if (!item || item.jobId !== jobId) throw conflict('当前任务的信息关联或分析版本已变化，请返回列表刷新。');
    return {...authorized, task, item};
  }
  async detail(actor: Identity, taskId: string, eventId: string, jobId: string): Promise<TaskInformationDetail> {
    const initial = this.resolve(actor, taskId, eventId, jobId);
    const content = await this.dependencies.readContent(initial.actor, initial.event, initial.job);
    const current = this.resolve(actor, taskId, eventId, jobId);
    const job = {...current.job}, event = {...current.event};
    delete job.ruleSnapshot; delete event.ruleSnapshot;
    return {...current.item, event, job, ...content, analyses: this.dependencies.analysisSummaries?.(current.actor, taskId, eventId, jobId) ?? []};
  }
  links(actor: Identity, eventId: string, jobId: string): TaskLinksView {
    const authorized = this.authorize(actor, eventId, jobId); actor = authorized.actor;
    const {job, event} = authorized, tasks = this.access.list(actor.seatId), decisions = new Map(this.overrides(eventId).map(value => [value.taskSpaceId, value]));
    const links: TaskInformationLink[] = [];
    for (const task of tasks) {
      const decision = decisions.get(task.id), item = job.taskAssessment?.items.find(item => item.taskSpaceId === task.id);
      if (!decision && !item) continue;
      const mode = decision?.mode ?? 'auto';
      if (mode === 'auto' && !item) continue;
      const chosen = mode === 'auto' ? job : this.store.getJob(decision!.jobId);
      if (!this.readable(actor, event, chosen) || (mode === 'exclude' && !this.manageable(actor, task))) continue;
      const version = mode === 'auto' ? item!.taskRevision : decision!.taskRevision;
      links.push({task, jobId: chosen.id, reason: mode === 'auto' ? item!.reason : decision!.reason, mode,
        revision: decision?.revision ?? 0, taskRevision: version, taskChanged: version !== task.revision, canManage: this.manageable(actor, task)});
    }
    const assessment = job.taskAssessment ? {...job.taskAssessment, items: job.taskAssessment.items.filter(item => tasks.some(task => task.id === item.taskSpaceId))} : undefined;
    const revisions = Object.fromEntries(tasks.filter(task => this.manageable(actor, task) && decisions.has(task.id))
      .map(task => [task.id, decisions.get(task.id)!.revision]));
    return {eventId, jobId, assessment, creation: job.taskSuggestionCreation, links, revisions, canCreateTask: !!job.taskAssessment?.newTaskSuggestion && actor.createPublicTask && !job.taskSuggestionCreation};
  }
  update(actor: Identity, eventId: string, taskId: string, input: TaskLinkUpdateInput): TaskInformationOverride {
    return this.store.transaction(() => {
      const authorized = this.authorize(actor, eventId, input.jobId); actor = authorized.actor;
      const task = this.access.get(taskId, actor.seatId, true);
      if (!this.manageable(actor, task)) throw new RequestError('FORBIDDEN', '当前席位无权调整此任务的关联。', 403);
      if (!['include', 'exclude', 'auto'].includes(input.mode) || !Number.isSafeInteger(input.revision) || input.revision < 0
        || (input.reason !== undefined && (typeof input.reason !== 'string' || input.reason.length > 1500)) || (input.mode === 'include' && !reasonText(input.reason))) throw invalid('请填写有效的关联理由。');
      const reason = input.reason?.trim() ?? '', old = this.overrides(eventId, taskId)[0];
      if (old?.mode === input.mode && old.jobId === input.jobId && old.reason === reason) return old;
      if ((old?.revision ?? 0) !== input.revision) throw conflict();
      return this.writeOverride({eventId, taskSpaceId: taskId, jobId: input.jobId, mode: input.mode, reason, taskRevision: task.revision,
        revision: (old?.revision ?? 0) + 1, updatedByUserId: actor.userId, updatedAt: new Date().toISOString()});
    });
  }
  createFromSuggestion(actor: Identity, eventId: string, input: TaskSuggestionCreateInput): TaskSuggestionCreateResult {
    return this.store.transaction(() => {
      const {actor: current, job} = this.authorize(actor, eventId, input.jobId); actor = current;
      if (!actor.createPublicTask) throw new RequestError('FORBIDDEN', '当前席位无权创建工作任务。', 403);
      if (!job.taskAssessment?.newTaskSuggestion) throw conflict('该分析没有新建任务建议。');
      if (!UUID.test(input.clientActionId) || !reasonText(input.reason) || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 60
        || typeof input.goal !== 'string' || !input.goal.trim() || input.goal.length > 8000) throw invalid('请填写有效的任务名称、目标和关联理由。');
      const creationInput = {title: input.title, goal: input.goal, visibility: 'public' as const, clientActionId: input.clientActionId, context: input.context};
      const origin = {eventId, jobId: job.id, reason: input.reason.trim()};
      if (job.taskSuggestionCreation) {
        const creation = job.taskSuggestionCreation, used = this.access.findCreation(actor, input.clientActionId)[0];
        if (used && used.id !== creation.taskSpaceId) throw conflict('相同操作标识已用于另一项任务。');
        // The original action must keep its original payload, even after response loss.
        if (creation.createdByUserId === actor.userId && creation.clientActionId === input.clientActionId) this.access.createInTransaction(actor, creationInput, origin);
        const link = this.overrides(eventId, creation.taskSpaceId)[0]; if (!link) throw stateError();
        return {task: this.access.get(creation.taskSpaceId, actor.seatId), creation, link};
      }
      const task = this.access.createInTransaction(actor, creationInput, origin), time = new Date().toISOString();
      const link = this.writeOverride({eventId, taskSpaceId: task.id, mode: 'include', jobId: job.id, taskRevision: task.revision, reason: input.reason.trim(), revision: 1, updatedByUserId: actor.userId, updatedAt: time});
      const creation: TaskSuggestionCreation = {taskSpaceId: task.id, createdByUserId: actor.userId, clientActionId: input.clientActionId, createdAt: time};
      this.store.saveTaskSuggestionCreationInTransaction(job, creation);
      return {task, creation, link};
    });
  }
}
