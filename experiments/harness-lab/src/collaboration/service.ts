import { createHash, randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Check } from 'typebox/value';
import { workPrepareSchema, type ActorContext, type HandoffFile, type HandoffImportResult, type Submission, type WorkAction, type WorkDetail, type WorkItem, type WorkPrepareInput, type WorkReceipt } from '../contracts/collaboration.js';
import { RequestError } from '../contracts/errors.js';
import { filePath } from '../files/service.js';
import { Mutex, parseJsonStrict, stateError } from '../resources/files.js';
import { UUID, WorkspaceStore } from '../workspaces/store.js';
import { HandoffFiles } from './files.js';
import { openDatabase } from '../access/database.js';

export type PreparationOrigin = { source: 'page'; clientActionId: string } | { source: 'agent'; sessionId: string; requestId: string; toolCallId: string };
export interface AgentCommitGrant { sessionId: string; requestId: string; toolCallId: string; interactionId: string }
export interface CollaborationOptions { seatIds: string[]; maxFileBytes?: number; maxAttachments?: number; python?: string }
interface StoredAction { action: WorkAction; input: WorkPrepareInput; origin: PreparationOrigin; hostId: string; digest: string; dedupKey: string }
interface StoredFile extends HandoffFile { operationId: string; ownerSeatId: string; taskSpaceId: string; workItemId?: string }
const notFound = () => new RequestError('WORK_NOT_FOUND', '工作或交接记录不存在。', 404);
const conflict = (message = '工作状态已变化，请查看最新记录后重新操作。') => new RequestError('WORK_CONFLICT', message, 409);
const now = () => new Date().toISOString();
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
function parse<T>(row: unknown): T {
  if (!row || typeof (row as {data?: unknown}).data !== 'string') throw stateError();
  return parseJsonStrict((row as {data: string}).data) as T;
}
/** Concrete single-process business store. Pi history is never read or rewritten here. */
export class CollaborationService {
  private readonly hostId = randomUUID();
  private readonly prepares = new Mutex();
  private readonly requests = new Map<string, string>();
  private readonly grants = new Map<string, AgentCommitGrant>();
  private closed = false;
  private constructor(readonly workspaces: WorkspaceStore, private readonly options: CollaborationOptions, private readonly db: DatabaseSync, private readonly files: HandoffFiles) {}
  static async open(workspaces: WorkspaceStore, options: CollaborationOptions, database?: DatabaseSync): Promise<CollaborationService> {
    if (!options.seatIds.length || new Set(options.seatIds).size !== options.seatIds.length || options.seatIds.some(id => !/^[a-zA-Z0-9_-]{1,64}$/.test(id))) throw stateError();
    const db = database ?? await openDatabase(workspaces.dataDir);
    const directory = join(workspaces.dataDir, 'collaboration');
    try {
      const files = new HandoffFiles(join(directory, 'files'), options.maxFileBytes ?? 104857600, options.python ?? 'python3'); await files.initialize();
      const service = new CollaborationService(workspaces, {...options, seatIds: [...options.seatIds]}, db, files);
      service.validateStored(); return service;
    } catch (error) { db.close(); throw error instanceof RequestError ? error : stateError(); }
  }
  close() { if (!this.closed) { this.closed = true; this.db.close(); } }
  hasUnfinishedTask(id: string) {
    return this.db.prepare("SELECT id FROM works WHERE json_extract(data,'$.taskSpaceId')=? AND json_extract(data,'$.state')!='completed' LIMIT 1").get(id) !== undefined
      || this.db.prepare("SELECT data FROM actions WHERE json_extract(data,'$.action.taskSpaceId')=? AND json_extract(data,'$.action.status')='prepared'").all(id).some(row=>this.live(parse<StoredAction>(row)));
  }
  private actor(actor: ActorContext) { if (!this.options.seatIds.includes(actor.seatId)) throw notFound(); }
  private validateStored() {
    // Metadata is private, but damaged records must never become a fresh/partly empty inbox.
    const works = new Map<string, WorkItem>(); const actions = new Map<string, StoredAction>(); const files = new Map<string, StoredFile>();
    const validDate = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
    for (const row of this.db.prepare('SELECT id,data FROM works').all()) {
      const work = parse<WorkItem>(row);
      if (work.id !== row.id || !UUID.test(work.id) || !UUID.test(work.taskSpaceId) || !Array.isArray(work.inputFileIds) || work.inputFileIds.some(id => !UUID.test(id)) || !['assigned', 'working', 'submitted', 'returned', 'completed'].includes(work.state) || !Number.isSafeInteger(work.revision) || work.revision < 1 || typeof work.goal !== 'string' || !work.goal.trim() || typeof work.title !== 'string' || !work.title.trim() || !validDate(work.createdAt) || !validDate(work.updatedAt) || work.creatorSeatId === work.assigneeSeatId || !this.options.seatIds.includes(work.creatorSeatId) || !this.options.seatIds.includes(work.assigneeSeatId)) throw stateError();
      works.set(work.id,work);
    }
    for (const row of this.db.prepare('SELECT id,dedup_key,data FROM actions').all()) {
      const stored = parse<StoredAction>(row); const action = stored.action;
      if (!action || action.operationId !== row.id || !UUID.test(action.operationId) || !UUID.test(stored.hostId) || !Check(workPrepareSchema, stored.input) || !['page', 'agent'].includes(stored.origin?.source) || action.source !== stored.origin.source || action.kind !== stored.input.kind || !['prepared','committed','cancelled'].includes(action.status) || !this.options.seatIds.includes(action.seatId) || !Array.isArray(action.files) || !validDate(action.createdAt) || !UUID.test(action.taskSpaceId) || stored.dedupKey !== row.dedup_key || stored.dedupKey !== canonical([action.seatId,stored.origin]) || stored.digest !== createHash('sha256').update(canonical(stored.input)).digest('hex')) throw stateError();
      if (stored.origin.source === 'agent' && (!UUID.test(stored.origin.sessionId) || !UUID.test(stored.origin.requestId) || !stored.origin.toolCallId)) throw stateError();
      if (stored.origin.source === 'page' && (typeof stored.origin.clientActionId !== 'string' || !stored.origin.clientActionId)) throw stateError();
      if ((action.status === 'committed') !== Boolean(action.receipt)) throw stateError();
      if (action.receipt) {
        const receipt = action.receipt; const work = works.get(receipt.workItemId);
        if (!work || receipt.operationId !== action.operationId || receipt.workItemId !== action.workItemId || receipt.revision > work.revision || receipt.revision < 1 || !Number.isSafeInteger(receipt.revision) || !validDate(receipt.committedAt) || !['assigned','working','submitted','returned','completed'].includes(receipt.state)) throw stateError();
      }
      actions.set(action.operationId,stored);
    }
    for (const row of this.db.prepare('SELECT id,data FROM files').all()) {
      const file = parse<StoredFile>(row); const prepared = actions.get(file.operationId);
      if (file.fileId !== row.id || !UUID.test(file.fileId) || !/^[0-9a-f]{64}$/.test(file.hash) || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.name !== 'string' || !file.name || basename(file.name) !== file.name || file.name === '.' || file.name === '..' || !validDate(file.createdAt) || !prepared || prepared.action.seatId !== file.ownerSeatId || prepared.action.taskSpaceId !== file.taskSpaceId || (file.workItemId && !works.has(file.workItemId))) throw stateError();
      if (!prepared.action.files.some(item => canonical(item) === canonical(this.publicFile(file)))) throw stateError();
      files.set(file.fileId,file);
    }
    const submissions = new Map<string, Submission>(); const attempts = new Set<string>();
    for (const row of this.db.prepare('SELECT id,work_id,data FROM submissions').all()) {
      const submission = parse<Submission>(row); const work = works.get(submission.workItemId); const file = files.get(submission.file?.fileId);
      if (submission.id !== row.id || !UUID.test(submission.id) || row.work_id !== submission.workItemId || !work || submission.submittedBy !== work.assigneeSeatId || !file || file.workItemId !== work.id || canonical(submission.file) !== canonical(this.publicFile(file)) || !Number.isSafeInteger(submission.attempt) || submission.attempt < 1 || attempts.has(`${work.id}:${submission.attempt}`) || !validDate(submission.createdAt)) throw stateError();
      const review = submission.review;
      if (review && (!['accept','return'].includes(review.decision) || review.seatId !== work.creatorSeatId || !validDate(review.createdAt) || (review.decision === 'return' && (typeof review.reason !== 'string' || !review.reason.trim())))) throw stateError();
      attempts.add(`${work.id}:${submission.attempt}`); submissions.set(submission.id,submission);
    }
    for (const work of works.values()) {
      if (work.inputFileIds.some(id => files.get(id)?.workItemId !== work.id)) throw stateError();
      const latest = work.latestSubmissionId ? submissions.get(work.latestSubmissionId) : undefined;
      if (work.latestSubmissionId && (!latest || latest.workItemId !== work.id)) throw stateError();
      if (['submitted','returned','completed'].includes(work.state) && !latest) throw stateError();
      if ((work.state === 'submitted' && latest?.review) || (work.state === 'returned' && latest?.review?.decision !== 'return') || (work.state === 'completed' && latest?.review?.decision !== 'accept')) throw stateError();
    }
    for (const stored of actions.values()) for (const file of stored.action.files) if (!files.has(file.fileId) || canonical(file) !== canonical(this.publicFile(files.get(file.fileId)!))) throw stateError();
    for (const row of this.db.prepare('SELECT session_id,work_id FROM session_links').all()) {
      const work = works.get(String(row.work_id)); const sessionId = String(row.session_id);
      const seatId = this.options.seatIds.find(seat => this.workspaces.binding(sessionId,seat));
      if (!work || !seatId || ![work.creatorSeatId,work.assigneeSeatId].includes(seatId) || this.workspaces.get(this.workspaces.binding(sessionId,seatId)!,seatId).taskSpaceId !== work.taskSpaceId) throw stateError();
    }
    if (this.db.prepare('PRAGMA foreign_key_check').all().length) throw stateError();
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private saveAction(stored: StoredAction) { this.db.prepare('UPDATE actions SET data=? WHERE id=?').run(JSON.stringify(stored), stored.action.operationId); }
  private storedAction(actor: ActorContext, id: string): StoredAction {
    this.actor(actor); const row = this.db.prepare('SELECT data FROM actions WHERE id=?').get(id); if (!row) throw notFound();
    const stored = parse<StoredAction>(row); if (stored.action.seatId !== actor.seatId) throw notFound(); return stored;
  }
  private live(stored: StoredAction) {
    if (stored.hostId !== this.hostId) return false;
    return stored.origin.source === 'page' || this.requests.get(stored.origin.sessionId) === stored.origin.requestId;
  }
  findPageAction(actor: ActorContext, clientActionId: string): WorkAction {
    this.actor(actor);
    const row = this.db.prepare('SELECT data FROM actions WHERE dedup_key=?').get(canonical([actor.seatId, {source: 'page', clientActionId}]));
    if (!row) throw notFound();
    return this.getAction(actor, parse<StoredAction>(row).action.operationId);
  }
  getAction(actor: ActorContext, id: string): WorkAction {
    const stored = this.storedAction(actor, id); const action = stored.action;
    if (action.status === 'prepared' && !this.live(stored)) action.status = 'expired';
    return action;
  }
  list(actor: ActorContext): WorkItem[] {
    this.actor(actor); return this.db.prepare('SELECT data FROM works ORDER BY rowid DESC').all().map(row => parse<WorkItem>(row)).filter(work => work.creatorSeatId === actor.seatId || work.assigneeSeatId === actor.seatId);
  }
  private work(actor: ActorContext, id: string): WorkItem {
    this.actor(actor); const row = this.db.prepare('SELECT data FROM works WHERE id=?').get(id); if (!row) throw notFound();
    const work = parse<WorkItem>(row); if (work.creatorSeatId !== actor.seatId && work.assigneeSeatId !== actor.seatId) throw notFound(); this.workspaces.access?.get(work.taskSpaceId,actor.seatId); return work;
  }
  private file(id: string): StoredFile { const row = this.db.prepare('SELECT data FROM files WHERE id=?').get(id); if (!row) throw notFound(); return parse<StoredFile>(row); }
  private publicFile(file: StoredFile): HandoffFile { const {fileId, name, size, hash, createdAt} = file; return {fileId, name, size, hash, createdAt}; }
  read(actor: ActorContext, id: string): WorkDetail {
    const work = this.work(actor, id);
    const submissions = this.db.prepare('SELECT data FROM submissions WHERE work_id=? ORDER BY rowid').all(id).map(row => parse<Submission>(row));
    const sessionIds = this.db.prepare('SELECT session_id FROM session_links WHERE work_id=?').all(id).map(row => String(row.session_id)).filter(sessionId => this.workspaces.binding(sessionId, actor.seatId));
    return {...work, inputFiles: work.inputFileIds.map(id => this.publicFile(this.file(id))), submissions, sessionIds};
  }
  workIdForSession(actor: ActorContext, sessionId: string): string | undefined {
    this.actor(actor); if (!this.workspaces.binding(sessionId, actor.seatId)) throw notFound();
    const row = this.db.prepare('SELECT work_id FROM session_links WHERE session_id=?').get(sessionId); if (!row) return undefined;
    return this.work(actor, String(row.work_id)).id;
  }
  workForSession(actor: ActorContext, sessionId: string): WorkDetail | undefined { const id = this.workIdForSession(actor, sessionId); return id ? this.read(actor, id) : undefined; }
  bindSession(actor: ActorContext, sessionId: string, workItemId: string) {
    const work = this.work(actor, workItemId); const workspaceId = this.workspaces.binding(sessionId, actor.seatId); if (!workspaceId) throw notFound();
    if (this.requests.has(sessionId)) throw conflict('会话正在处理，请结束后再关联工作。');
    const workspace = this.workspaces.get(workspaceId, actor.seatId); this.workspaces.access?.get(workspace.taskSpaceId,actor.seatId,true); if (workspace.taskSpaceId !== work.taskSpaceId) throw notFound();
    const previous = this.workIdForSession(actor, sessionId); if (previous && previous !== workItemId) throw conflict('会话已关联另一项工作。');
    this.db.prepare('INSERT OR IGNORE INTO session_links(session_id,work_id) VALUES(?,?)').run(sessionId, workItemId);
  }
  beginRequest(sessionId: string, requestId: string) {
    if (!UUID.test(sessionId) || !UUID.test(requestId) || this.requests.has(sessionId)) throw conflict('会话已有活动请求。');
    this.requests.set(sessionId, requestId);
  }
  endRequest(sessionId: string, requestId: string) {
    if (this.requests.get(sessionId) === requestId) this.requests.delete(sessionId);
    for (const [operationId, grant] of this.grants) if (grant.sessionId === sessionId && grant.requestId === requestId) this.grants.delete(operationId);
  }
  private validateInput(actor: ActorContext, input: WorkPrepareInput): WorkItem | undefined {
    this.actor(actor); if (!Check(workPrepareSchema, input)) throw new RequestError('INVALID_INPUT', '工作操作参数无效。');
    if (input.kind === 'assign') {
      const task = this.workspaces.access?.get(input.taskSpaceId,actor.seatId,true);
      if (task && !this.workspaces.access!.seats().some(seat=>seat.id===input.payload.assigneeSeatId)) throw new RequestError('INVALID_INPUT','接收席位当前不可用。');
      if (task && task.visibility !== 'public') throw new RequestError('PRIVATE_TASK','跨席位分派须在公共任务中进行。',403);
      const workspace = this.workspaces.get(input.payload.workspaceId, actor.seatId);
      if (workspace.taskSpaceId !== input.taskSpaceId || !this.options.seatIds.includes(input.payload.assigneeSeatId) || input.payload.assigneeSeatId === actor.seatId) throw new RequestError('INVALID_INPUT', '请选择本项目及另一接收席位。');
      if (!input.payload.title.trim() || !input.payload.goal.trim() || (input.payload.inputPaths?.length ?? 0) > (this.options.maxAttachments ?? 20)) throw new RequestError('INVALID_INPUT', '请填写工作标题和目标，并检查附件数量。');
      for (const path of input.payload.inputPaths ?? []) filePath(path); return undefined;
    }
    const work = this.work(actor, input.workItemId);
    this.workspaces.access?.get(work.taskSpaceId,actor.seatId,true);
    if (input.expectedRevision !== work.revision) throw conflict();
    if (input.kind === 'claim' && (work.assigneeSeatId !== actor.seatId || work.state !== 'assigned')) throw conflict();
    if (input.kind === 'submit') {
      if (work.assigneeSeatId !== actor.seatId || !['working', 'returned'].includes(work.state)) throw conflict();
      if (this.workspaces.get(input.payload.workspaceId, actor.seatId).taskSpaceId !== work.taskSpaceId) throw notFound();
      filePath(input.payload.path);
    }
    if (input.kind === 'review') {
      if (work.creatorSeatId !== actor.seatId || work.state !== 'submitted' || work.latestSubmissionId !== input.payload.submissionId) throw conflict();
      if (input.payload.decision === 'return' && !input.payload.reason?.trim()) throw new RequestError('INVALID_INPUT', '退回时请填写意见。');
    }
    return work;
  }
  async prepare(actor: ActorContext, input: WorkPrepareInput, origin: PreparationOrigin, signal?: AbortSignal): Promise<WorkAction> {
    const release=this.workspaces.access?.acquire(input.kind === 'assign' ? input.taskSpaceId : this.work(actor,input.workItemId).taskSpaceId,actor.seatId);
    try {return await this.prepareInternal(actor,input,origin,signal);} finally {release?.();}
  }
  private async prepareInternal(actor: ActorContext, input: WorkPrepareInput, origin: PreparationOrigin, signal?: AbortSignal): Promise<WorkAction> {
    // Copy before the first await: callers cannot change the approved payload during preparation.
    input = structuredClone(input); origin = structuredClone(origin); actor = {...actor}; this.actor(actor);
    if (origin.source === 'page') {
      if (typeof origin.clientActionId !== 'string' || !origin.clientActionId || origin.clientActionId.length > 128) throw new RequestError('INVALID_INPUT', '操作标识无效。');
    } else if (origin.source !== 'agent' || !UUID.test(origin.sessionId) || !UUID.test(origin.requestId) || !origin.toolCallId || origin.toolCallId.length > 256 || !this.workspaces.binding(origin.sessionId, actor.seatId) || this.requests.get(origin.sessionId) !== origin.requestId) throw conflict('原请求已结束，请重新准备。');
    const dedupKey = canonical([actor.seatId, origin]); const digest = createHash('sha256').update(canonical(input)).digest('hex');
    return this.prepares.run(async () => {
      signal?.throwIfAborted();
      const previous = this.db.prepare('SELECT data FROM actions WHERE dedup_key=?').get(dedupKey);
      if (previous) { const stored = parse<StoredAction>(previous); if (stored.digest !== digest) throw conflict('同一操作标识不能用于不同内容。'); return this.getAction(actor, stored.action.operationId); }
      const work = this.validateInput(actor, input); const taskSpaceId = work?.taskSpaceId ?? (input as Extract<WorkPrepareInput, {kind:'assign'}>).taskSpaceId;
      if (origin.source === 'agent') {
        const workspace = this.workspaces.get(this.workspaces.binding(origin.sessionId, actor.seatId)!, actor.seatId);
        if (workspace.taskSpaceId !== taskSpaceId || ((input.kind === 'assign' || input.kind === 'submit') && input.payload.workspaceId !== workspace.id)) throw notFound();
      }
      const operationId = randomUUID(); const createdAt = now(); const records: StoredFile[] = [];
      if (input.kind === 'assign' || input.kind === 'submit') {
        const paths = input.kind === 'assign' ? input.payload.inputPaths ?? [] : [input.payload.path];
        for (const source of new Set(paths.map(path => filePath(path)))) {
          const fileId = randomUUID(); const info = await this.files.freeze(this.workspaces.filesDirectory(input.payload.workspaceId, actor.seatId), source, fileId, signal);
          records.push({fileId, name: basename(source), ...info, createdAt, operationId, ownerSeatId: actor.seatId, taskSpaceId});
        }
      }
      signal?.throwIfAborted(); this.validateInput(actor, input);
      if (origin.source === 'agent' && this.requests.get(origin.sessionId) !== origin.requestId) throw conflict('原请求已结束，请重新准备。');
      const titles = {assign:'分派工作',claim:'开始办理',submit:'提交文件',review: input.kind === 'review' && input.payload.decision === 'return' ? '退回修改' : '验收通过'};
      const creatorSeatId = work?.creatorSeatId ?? actor.seatId; const assigneeSeatId = work?.assigneeSeatId ?? (input as Extract<WorkPrepareInput, {kind:'assign'}>).payload.assigneeSeatId;
      const reviewedSubmission = input.kind === 'review' ? parse<Submission>(this.db.prepare('SELECT data FROM submissions WHERE id=? AND work_id=?').get(input.payload.submissionId, work!.id)) : undefined;
      const description = input.kind === 'assign' ? `接收席位：${assigneeSeatId}\n工作：${input.payload.title}\n目标：${input.payload.goal}` : input.kind === 'review' ? `工作：${work!.title}\n提交版本：第 ${reviewedSubmission!.attempt} 次提交\n${input.payload.decision === 'return' ? '退回意见' : '验收意见'}：${input.payload.reason ?? '验收通过'}` : `工作：${work!.title}\n${input.kind === 'submit' ? `提交给席位：${creatorSeatId}\n文件：${records.map(file => file.name).join('、')}` : `承办席位：${assigneeSeatId}`}`;
      const confirmationFiles = reviewedSubmission ? [reviewedSubmission.file] : records.map(file => this.publicFile(file));
      const action: WorkAction = {operationId, source: origin.source, kind: input.kind, seatId: actor.seatId, title: titles[input.kind], description, taskSpaceId, ...(work ? {workItemId: work.id, expectedRevision: work.revision} : {}), creatorSeatId, assigneeSeatId, files: confirmationFiles, createdAt, status:'prepared'};
      const stored: StoredAction = {action, input, origin, hostId:this.hostId, digest, dedupKey};
      this.transaction(() => {
        this.db.prepare('INSERT INTO actions(id,dedup_key,data) VALUES(?,?,?)').run(operationId, dedupKey, JSON.stringify(stored));
        for (const file of records) this.db.prepare('INSERT INTO files(id,data) VALUES(?,?)').run(file.fileId, JSON.stringify(file));
      });
      return action;
    });
  }
  cancelPage(actor: ActorContext, id: string): WorkAction {
    return this.transaction(() => {
      const stored = this.storedAction(actor, id); if (stored.origin.source !== 'page') throw conflict('Agent 操作请通过原确认卡片处理。');
      if (stored.action.status === 'committed') return stored.action;
      if (!this.live(stored)) return {...stored.action, status:'expired'};
      stored.action.status = 'cancelled'; this.saveAction(stored); return stored.action;
    });
  }
  authorizeAgent(actor: ActorContext, id: string, grant: AgentCommitGrant): void {
    const stored = this.storedAction(actor, id);
    this.checkAgent(stored, grant); this.grants.set(id, {...grant});
  }
  private checkAgent(stored: StoredAction, grant: AgentCommitGrant) {
    if (stored.origin.source !== 'agent' || stored.origin.sessionId !== grant.sessionId || stored.origin.requestId !== grant.requestId || !this.live(stored) || !grant.toolCallId || !UUID.test(grant.interactionId)) throw conflict('确认与当前请求不一致。');
  }
  async commitPage(actor: ActorContext, id: string, signal?: AbortSignal): Promise<WorkReceipt> {
    const stored = this.storedAction(actor, id); if (stored.origin.source !== 'page') throw conflict('Agent 操作必须在原对话中确认。');
    return this.commit(actor, id, undefined, signal);
  }
  async commitAgent(actor: ActorContext, id: string, grant: AgentCommitGrant, signal?: AbortSignal): Promise<WorkReceipt> {
    const stored = this.storedAction(actor, id); this.checkAgent(stored, grant);
    if (canonical(this.grants.get(id)) !== canonical(grant)) throw conflict('本次操作尚未获得对应确认。');
    try { return await this.commit(actor, id, grant, signal); } finally { this.grants.delete(id); }
  }
  private async commit(actor: ActorContext, id: string, grant?: AgentCommitGrant, signal?: AbortSignal): Promise<WorkReceipt> {
    const receipt=this.storedAction(actor,id).action.receipt; if(receipt) return receipt;
    const release=this.workspaces.access?.acquire(this.storedAction(actor,id).action.taskSpaceId,actor.seatId);
    try {return await this.commitInternal(actor,id,grant,signal);} finally {release?.();}
  }
  private async commitInternal(actor: ActorContext, id: string, grant?: AgentCommitGrant, signal?: AbortSignal): Promise<WorkReceipt> {
    let stored = this.storedAction(actor, id);
    if (stored.action.receipt) return stored.action.receipt;
    this.checkPrepared(stored); signal?.throwIfAborted();
    for (const file of stored.action.files) await this.files.assertValid(file);
    if (stored.input.kind === 'assign') {
      const workspace = this.workspaces.get(stored.input.payload.workspaceId, actor.seatId);
      await this.workspaces.ensureWorkspace(workspace.taskSpaceId, stored.action.assigneeSeatId, workspace.name);
    }
    signal?.throwIfAborted();
    return this.transaction(() => {
      stored = this.storedAction(actor, id); if (stored.action.receipt) return stored.action.receipt;
      this.checkPrepared(stored); if (grant) { this.checkAgent(stored, grant); if (canonical(this.grants.get(id)) !== canonical(grant)) throw conflict('确认已失效。'); }
      signal?.throwIfAborted();
      const input = stored.input; const previous = this.validateInput(actor, input); const committedAt = now();
      let work: WorkItem; let submissionId: string | undefined;
      if (input.kind === 'assign') {
        work = {id: randomUUID(),taskSpaceId: input.taskSpaceId,creatorSeatId:actor.seatId,assigneeSeatId:input.payload.assigneeSeatId,title:input.payload.title.trim(),goal:input.payload.goal.trim(),inputFileIds:stored.action.files.map(file => file.fileId),state:'assigned',revision:1,createdAt:committedAt,updatedAt:committedAt};
        this.db.prepare('INSERT INTO works(id,data) VALUES(?,?)').run(work.id,JSON.stringify(work));
      } else {
        work = {...previous!,revision:previous!.revision+1,updatedAt:committedAt};
        if (input.kind === 'claim') work.state = 'working';
        if (input.kind === 'submit') {
          submissionId = randomUUID();
          const attempt = Number(this.db.prepare('SELECT COUNT(*) AS count FROM submissions WHERE work_id=?').get(work.id)!.count)+1;
          const submission: Submission = {id:submissionId,workItemId:work.id,attempt,file:stored.action.files[0],submittedBy:actor.seatId,createdAt:committedAt};
          this.db.prepare('INSERT INTO submissions(id,work_id,data) VALUES(?,?,?)').run(submissionId,work.id,JSON.stringify(submission));
          work.state = 'submitted'; work.latestSubmissionId = submissionId;
        }
        if (input.kind === 'review') {
          submissionId = input.payload.submissionId;
          const submission = parse<Submission>(this.db.prepare('SELECT data FROM submissions WHERE id=? AND work_id=?').get(submissionId,work.id));
          submission.review = {decision:input.payload.decision, ...(input.payload.reason ? {reason:input.payload.reason.trim()} : {}),seatId:actor.seatId,createdAt:committedAt};
          this.db.prepare('UPDATE submissions SET data=? WHERE id=?').run(JSON.stringify(submission),submissionId);
          work.state = input.payload.decision === 'accept' ? 'completed' : 'returned';
        }
        this.db.prepare('UPDATE works SET data=? WHERE id=?').run(JSON.stringify(work),work.id);
      }
      for (const publicFile of stored.action.files) {
        const file = this.file(publicFile.fileId); file.workItemId = work.id;
        this.db.prepare('UPDATE files SET data=? WHERE id=?').run(JSON.stringify(file),file.fileId);
      }
      const receipt: WorkReceipt = {operationId:id,workItemId:work.id,state:work.state,revision:work.revision,...(submissionId ? {submissionId} : {}),committedAt};
      stored.action.status = 'committed'; stored.action.workItemId = work.id; stored.action.receipt = receipt; this.saveAction(stored); return receipt;
    });
  }
  private checkPrepared(stored: StoredAction) {
    if (stored.action.status !== 'prepared' || !this.live(stored)) throw conflict('准备单已取消或失效，请重新准备。');
  }
  private authorizedFile(actor: ActorContext, id: string): StoredFile {
    this.actor(actor); const file = this.file(id);
    if (file.workItemId) this.work(actor,file.workItemId);
    else if (file.ownerSeatId !== actor.seatId) throw notFound();
    return file;
  }
  async openFile(actor: ActorContext, id: string) { return this.files.open(this.authorizedFile(actor,id)); }
  async importFile(actor: ActorContext, id: string, workspaceId: string, path?: string, signal?: AbortSignal): Promise<HandoffImportResult> {
    const release=this.workspaces.access?.acquire(this.workspaces.get(workspaceId,actor.seatId).taskSpaceId,actor.seatId);
    try {return await this.importFileInternal(actor,id,workspaceId,path,signal);} finally {release?.();}
  }
  private async importFileInternal(actor: ActorContext, id: string, workspaceId: string, path?: string, signal?: AbortSignal): Promise<HandoffImportResult> {
    const file = this.authorizedFile(actor,id); const workspace = this.workspaces.get(workspaceId,actor.seatId);
    if (!file.workItemId || workspace.taskSpaceId !== file.taskSpaceId) throw notFound();
    const target = filePath(path ?? `收到资料/${file.workItemId}/${file.fileId}/${file.name}`);
    const info = await this.files.import(file,this.workspaces.filesDirectory(workspace.id,actor.seatId),target,signal);
    return {fileId:id,workspaceId,path:target,name:basename(target),...info};
  }
}
