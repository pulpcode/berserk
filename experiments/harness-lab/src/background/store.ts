import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Identity } from '../contracts/access.js';
import type { BackgroundAction, BackgroundControl, BackgroundDelivery, BackgroundEvent, BackgroundJob, BackgroundJobStatus, BackgroundPage, BackgroundPhase, BackgroundRuleSnapshot, InformationPermission, InformationRule, InformationRuleInput } from '../contracts/background.js';
import { RequestError } from '../contracts/errors.js';
import { parseJsonStrict, stateError } from '../resources/files.js';
import { UUID } from '../workspaces/store.js';

const now = () => new Date().toISOString();
const conflict = (message = '记录已变化，请查看最新状态后重试。') => new RequestError('BACKGROUND_CONFLICT', message, 409);
const missing = () => new RequestError('BACKGROUND_NOT_FOUND', '记录不存在或无权访问。', 404);
const busy = () => new RequestError('BACKGROUND_CAPACITY', '后台待处理容量已满，请稍后重试。', 429);
const active = new Set(['queued', 'running']);
const indexes = ['background_jobs_queue', 'background_jobs_reserved_session', 'background_deliveries_inbox', 'information_rules_enabled_source'];
const tables = ['background_events', 'background_jobs', 'background_deliveries', 'information_rules', 'information_grants', 'background_actions', 'background_controls'];
export const backgroundHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type BackgroundListFilter = {sourceId?: string; sourceIds?: string[]; eventId?: string; jobId?: string; status?: string; statuses?: BackgroundJobStatus[]; seatId?: string; offset?: number; limit?: number; search?: string};
export type NewBackgroundAction = Omit<BackgroundAction, 'id' | 'status' | 'revision' | 'createdAt' | 'updatedAt'> & {id?: string};

function decode<T extends {id: string; revision: number}>(row: Record<string, unknown> | undefined): T {
  if (!row) throw missing();
  try {
    const value = parseJsonStrict(String(row.data)) as T;
    if (!value || typeof value !== 'object' || value.id !== row.id || !Number.isSafeInteger(value.revision) || value.revision < 1) throw stateError();
    // Queries and permissions use SQL columns; JSON must describe the same record.
    const data = value as Record<string, unknown>;
    for (const field of ['id','eventId','jobId','initialJobId','sessionId','requestId','taskSpaceId','workspaceId','deliveryId','actionId','retryOfJobId','ruleId']) {
      if (data[field] !== undefined && (typeof data[field] !== 'string' || !UUID.test(data[field]))) throw stateError();
    }
    if (data.sourceId !== undefined && (typeof data.sourceId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(data.sourceId))) throw stateError();
    const columns: Record<string, string> = {source_id:'sourceId', message_id:'sourceMessageId', payload_hash:'payloadHash', received_at:'receivedAt', initial_job_id:'initialJobId', event_id:'eventId', job_id:'jobId', kind:'kind', status:'status', created_at:'createdAt', session_id:'sessionId', seat_id:'seatId', task_id:'taskSpaceId', user_id:'userId', client_action_id:'clientActionId'};
    for (const [column, field] of Object.entries(columns)) {
      const property = column === 'seat_id' && 'job_id' in row ? 'recipientSeatId' : field;
      if (column in row && row[column] !== (data[property] ?? null)) throw stateError();
    }
    const fileLists = [data.files, (data.result as {files?:unknown} | undefined)?.files].filter(files => files !== undefined);
    for (const files of fileLists) {
      if (!Array.isArray(files)) throw stateError();
      for (const file of files) {
        if (!file || typeof file !== 'object' || typeof file.id !== 'string' || !UUID.test(file.id) || typeof file.name !== 'string' || !file.name || file.name.includes('/') || file.name.includes('\\') || Array.from(file.name as string).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.hash !== 'string' || !/^[a-f0-9]{64}$/.test(file.hash)) throw stateError();
      }
    }
    if ('enabled' in row && (typeof data.enabled !== 'boolean' || row.enabled !== Number(data.enabled))) throw stateError();
    return value;
  } catch { throw stateError(); }
}
function pagination(filter: {offset?: number; limit?: number}) {
  const offset = filter.offset ?? 0, limit = filter.limit ?? 50;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new RequestError('INVALID_INPUT', '分页参数无效。');
  return {offset, limit};
}
function normalizeRule(input: InformationRuleInput): InformationRuleInput {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 100 || typeof input.sourceId !== 'string' || typeof input.profileId !== 'string' || !Array.isArray(input.recipientSeatIds) || !input.recipientSeatIds.length || input.recipientSeatIds.length > 100 || input.recipientSeatIds.some(id => !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) || new Set(input.recipientSeatIds).size !== input.recipientSeatIds.length || typeof input.enabled !== 'boolean') throw new RequestError('INVALID_INPUT', '请填写有效规则、处理方案及接收席位。');
  return {name: input.name.trim(), sourceId: input.sourceId, profileId: input.profileId, recipientSeatIds: [...input.recipientSeatIds], enabled: input.enabled, ...(input.publicTaskId ? {publicTaskId: input.publicTaskId} : {})};
}

/** Queue/rules/delivery metadata only. The owning service performs current authorization and file checks. */
export class BackgroundStore {
  constructor(readonly db: DatabaseSync) {
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
    if (version === 3) {
      const actual = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name)));
      if (tables.some(table => !actual.has(table))) throw stateError();
      this.validateIntegrity();
      return;
    }
    if (version !== 2) throw stateError();
    this.transaction(() => {
      db.exec(`
        CREATE TABLE background_events(id TEXT PRIMARY KEY, source_id TEXT NOT NULL, message_id TEXT NOT NULL, payload_hash TEXT NOT NULL, received_at TEXT NOT NULL, initial_job_id TEXT, data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(source_id,message_id));
        CREATE TABLE background_jobs(id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES background_events(id), source_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('preprocess','seat_analysis')), status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled','interrupted')), created_at TEXT NOT NULL, session_id TEXT, seat_id TEXT, task_id TEXT, data TEXT NOT NULL CHECK(json_valid(data)));
        CREATE INDEX background_jobs_queue ON background_jobs(status,created_at);
        CREATE UNIQUE INDEX background_jobs_reserved_session ON background_jobs(session_id) WHERE session_id IS NOT NULL AND status IN ('queued','running');
        CREATE TABLE background_deliveries(id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES background_events(id), job_id TEXT NOT NULL REFERENCES background_jobs(id), source_id TEXT NOT NULL, seat_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','delivered','failed')), created_at TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(job_id,seat_id));
        CREATE INDEX background_deliveries_inbox ON background_deliveries(seat_id,status,created_at);
        CREATE TABLE information_rules(id TEXT PRIMARY KEY, source_id TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), data TEXT NOT NULL CHECK(json_valid(data)));
        CREATE UNIQUE INDEX information_rules_enabled_source ON information_rules(source_id) WHERE enabled=1;
        CREATE TABLE information_grants(subject_kind TEXT NOT NULL CHECK(subject_kind IN ('account','seat')), subject_id TEXT NOT NULL, source_id TEXT NOT NULL, permission TEXT NOT NULL CHECK(permission IN ('view','manage')), PRIMARY KEY(subject_kind,subject_id,source_id));
        CREATE TABLE background_actions(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, client_action_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('preparing','completed')), task_id TEXT, data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(user_id,client_action_id));
        CREATE TABLE background_controls(key TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
        PRAGMA user_version=3;
      `);
    });
  }

  private validateIntegrity() {
    const actualIndexes = new Set(this.db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(row => String(row.name)));
    if (indexes.some(index => !actualIndexes.has(index)) || this.db.prepare('PRAGMA foreign_key_check').all().length) throw stateError();
    const events = new Map(this.listEvents().map(event => [event.id,event]));
    const jobs = new Map(this.listJobs().map(job => [job.id,job]));
    for (const event of events.values()) {
      if (!Array.isArray(event.files)) throw stateError();
      if (event.initialJobId) {
        const initial = jobs.get(event.initialJobId);
        if (!initial || initial.kind !== 'preprocess' || initial.eventId !== event.id || initial.sourceId !== event.sourceId) throw stateError();
      }
    }
    for (const job of jobs.values()) {
      if (events.get(job.eventId)?.sourceId !== job.sourceId || !job.requestId) throw stateError();
      if (job.kind === 'preprocess' && (!job.ruleSnapshot || job.ruleSnapshot.rule.sourceId !== job.sourceId || job.ruleSnapshot.rule.profileId !== job.ruleSnapshot.profile.id)) throw stateError();
      if (job.status === 'succeeded' && (!job.result || job.result.sessionId !== job.sessionId || job.result.requestId !== job.requestId || !Array.isArray(job.result.files))) throw stateError();
    }
    for (const delivery of this.listDeliveries()) {
      const job = jobs.get(delivery.jobId);
      if (!job || job.kind !== 'preprocess' || job.status !== 'succeeded' || job.eventId !== delivery.eventId || job.sourceId !== delivery.sourceId || !job.ruleSnapshot?.rule.recipientSeatIds.includes(delivery.recipientSeatId)) throw stateError();
    }
    this.listRules();
    const actions = new Map(this.listActions().map(action => [action.id,action]));
    for (const job of jobs.values()) {
      if (job.actionId) {
        const action = actions.get(job.actionId);
        if (!action || action.kind !== 'analysis' || action.jobId !== job.id || action.eventId !== job.eventId || action.userId !== job.userId || action.seatId !== job.seatId || action.sessionId !== job.sessionId || action.requestId !== job.requestId || action.taskSpaceId !== job.taskSpaceId || action.workspaceId !== job.workspaceId) throw stateError();
      }
    }
    for (const row of this.db.prepare('SELECT key FROM background_controls').all()) this.getControl(String(row.key));
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  getEvent(id: string) { return decode<BackgroundEvent>(this.db.prepare('SELECT * FROM background_events WHERE id=?').get(id)); }
  findEvent(sourceId: string, sourceMessageId: string): BackgroundEvent | undefined {
    const row = this.db.prepare('SELECT * FROM background_events WHERE source_id=? AND message_id=?').get(sourceId, sourceMessageId);
    return row ? decode<BackgroundEvent>(row) : undefined;
  }
  backlogSize() { return Number(this.db.prepare("SELECT (SELECT count(*) FROM background_events WHERE initial_job_id IS NULL)+(SELECT count(*) FROM background_jobs WHERE status='queued') AS n").get()?.n); }

  /** The snapshot was prepared on disk first. Recheck rule revision inside this synchronous transaction. */
  acceptEvent(event: BackgroundEvent, options: {initialJob?: BackgroundJob; capacity: number; expectedRule?: Pick<InformationRule, 'id' | 'revision'> | null}): BackgroundEvent {
    return this.transaction(() => {
      const previous = this.findEvent(event.sourceId, event.sourceMessageId);
      if (previous) { if (previous.payloadHash !== event.payloadHash) throw conflict('该来源消息标识已用于不同内容。'); return previous; }
      if (this.backlogSize() >= options.capacity) throw busy();
      this.assertRuleCurrent(event.sourceId, options.expectedRule);
      if (options.initialJob && (options.initialJob.eventId !== event.id || options.initialJob.kind !== 'preprocess' || options.initialJob.sourceId !== event.sourceId)) throw conflict('初始处理与接收记录不一致。');
      const next = {...event, initialJobId: options.initialJob?.id};
      this.db.prepare('INSERT INTO background_events VALUES(?,?,?,?,?,?,?)').run(next.id, next.sourceId, next.sourceMessageId, next.payloadHash, next.receivedAt, next.initialJobId ?? null, JSON.stringify(next));
      if (options.initialJob) this.insertJob(options.initialJob);
      return next;
    });
  }

  private assertRuleCurrent(sourceId: string, expected?: Pick<InformationRule, 'id' | 'revision'> | null) {
    const current = this.enabledRule(sourceId);
    if (current?.id !== expected?.id || current?.revision !== expected?.revision) throw conflict('处理规则已变化，请重新准备本次输入快照。');
  }

  /** Manual processing of an unmatched event consumes its existing backlog slot. */
  processEvent(eventId: string, job: BackgroundJob, snapshot: BackgroundRuleSnapshot, action?: NewBackgroundAction): BackgroundJob {
    return this.transaction(() => {
      if (action) { const previous = this.findAction(action.userId, action.clientActionId); if (previous) { this.assertSameAction(previous, action); if (previous.jobId) return this.getJob(previous.jobId); } }
      const event = this.getEvent(eventId);
      if (event.initialJobId) { if (action) throw conflict('该信息已经启动初始处理，请查看原记录。'); return this.getJob(event.initialJobId); }
      this.assertRuleCurrent(event.sourceId, snapshot.rule);
      if (job.eventId !== event.id || job.sourceId !== event.sourceId || job.kind !== 'preprocess') throw conflict();
      const next = {...event, initialJobId: job.id, ruleSnapshot: snapshot, revision: event.revision + 1};
      this.insertJob({...job, ruleSnapshot: snapshot});
      this.db.prepare('UPDATE background_events SET initial_job_id=?,data=? WHERE id=?').run(job.id, JSON.stringify(next), event.id);
      if (action) this.insertCompletedAction({...action, eventId, jobId: job.id});
      return this.getJob(job.id);
    });
  }

  getJob(id: string) { return decode<BackgroundJob>(this.db.prepare('SELECT * FROM background_jobs WHERE id=?').get(id)); }
  private insertJob(job: BackgroundJob) {
    if (job.status !== 'queued' || job.revision !== 1 || !job.requestId || (job.kind === 'seat_analysis' && (!job.userId || !job.seatId || !job.taskSpaceId || !job.workspaceId || !job.sessionId))) throw conflict('作业入队信息不完整。');
    if (job.sessionId && this.sessionReservation(job.sessionId)) throw conflict('会话已有排队或执行中的后台分析。');
    this.db.prepare('INSERT INTO background_jobs VALUES(?,?,?,?,?,?,?,?,?,?)').run(job.id, job.eventId, job.sourceId, job.kind, job.status, job.createdAt, job.sessionId ?? null, job.seatId ?? null, job.taskSpaceId ?? null, JSON.stringify(job));
  }
  enqueueJob(job: BackgroundJob, capacity: number, action?: NewBackgroundAction): BackgroundJob {
    return this.transaction(() => {
      if (action) { const previous = this.findAction(action.userId, action.clientActionId); if (previous) { this.assertSameAction(previous, action); if (previous.jobId) return this.getJob(previous.jobId); } }
      if (this.backlogSize() >= capacity) throw busy();
      this.insertJob(job);
      if (action) this.insertCompletedAction({...action, jobId: job.id, eventId: job.eventId});
      return job;
    });
  }
  /** Finishing import and admitting its preallocated session is one metadata commit. */
  enqueueAnalysis(actionId: string, revision: number, job: BackgroundJob, capacity: number): BackgroundAction {
    return this.transaction(() => {
      const action = this.getAction(actionId);
      if (action.status === 'completed' && action.jobId) return action;
      if (action.revision !== revision || action.kind !== 'analysis' || action.sessionId !== job.sessionId || action.requestId !== job.requestId || action.userId !== job.userId || action.seatId !== job.seatId || action.taskSpaceId !== job.taskSpaceId) throw conflict();
      if (this.backlogSize() >= capacity) throw busy();
      this.insertJob(job);
      return this.saveAction({...action, jobId: job.id, status: 'completed', revision: action.revision + 1, updatedAt: now()});
    });
  }
  claimJob(id: string, input: {sessionId: string; model?: string; modelSettingsVersion?: string}): BackgroundJob {
    return this.transaction(() => {
      const job = this.getJob(id); if (job.status !== 'queued') throw conflict();
      if (job.sessionId && job.sessionId !== input.sessionId) throw conflict();
      const other = this.sessionReservation(input.sessionId); if (other && other.id !== job.id) throw conflict();
      return this.saveJob({...job, ...input, status: 'running', phase: 'preparing', startedAt: now(), revision: job.revision + 1});
    });
  }
  setPhase(id: string, phase: BackgroundPhase) {
    const job = this.getJob(id); if (job.status !== 'running' || job.phase === phase) return job;
    return this.saveJob({...job, phase, revision: job.revision + 1});
  }
  requestCancel(id: string, revision: number) {
    return this.transaction(() => {
      const job = this.getJob(id);
      if (job.cancelRequestedAt) return job;
      if (job.revision !== revision || !active.has(job.status)) throw conflict();
      const time = now();
      return this.saveJob({...job, cancelRequestedAt: time, ...(job.status === 'queued' ? {status: 'cancelled' as const, endedAt: time, phase: undefined} : {}), revision: job.revision + 1});
    });
  }
  finishJob(id: string, revision: number, result: Pick<BackgroundJob, 'status' | 'result' | 'usage' | 'error'>): BackgroundJob {
    return this.transaction(() => {
      const job = this.getJob(id);
      if (job.revision !== revision || !active.has(job.status) || active.has(result.status) || (job.status === 'queued' && result.status === 'succeeded')) throw conflict();
      const status = job.cancelRequestedAt ? 'cancelled' : result.status;
      if (status === 'succeeded' && (!result.result || result.result.sessionId !== job.sessionId || result.result.requestId !== job.requestId)) throw conflict('结果与本次执行不一致。');
      const next = this.saveJob({...job, ...result, status, phase: undefined, endedAt: now(), revision: job.revision + 1});
      if (next.status === 'succeeded' && next.kind === 'preprocess') {
        if (!next.ruleSnapshot) throw conflict('预处理缺少固定规则。');
        for (const seatId of next.ruleSnapshot.rule.recipientSeatIds) {
          const delivery: BackgroundDelivery = {id: randomUUID(), eventId: next.eventId, jobId: next.id, sourceId: next.sourceId, recipientSeatId: seatId, status: 'pending', revision: 1, createdAt: next.endedAt!, updatedAt: next.endedAt!};
          this.db.prepare('INSERT INTO background_deliveries VALUES(?,?,?,?,?,?,?,?)').run(delivery.id, delivery.eventId, delivery.jobId, delivery.sourceId, seatId, delivery.status, delivery.createdAt, JSON.stringify(delivery));
        }
      }
      return next;
    });
  }
  private saveJob(job: BackgroundJob): BackgroundJob {
    this.db.prepare('UPDATE background_jobs SET status=?,session_id=?,data=? WHERE id=?').run(job.status, job.sessionId ?? null, JSON.stringify(job), job.id); return job;
  }
  recoverRunning(): BackgroundJob[] {
    return this.transaction(() => this.db.prepare("SELECT * FROM background_jobs WHERE status='running'").all().map(row => {
      const job = decode<BackgroundJob>(row);
      return this.saveJob({...job, status: job.cancelRequestedAt ? 'cancelled' : 'interrupted', phase: undefined, endedAt: now(), revision: job.revision + 1, error: {code: 'SERVICE_RESTARTED', message: '服务停止导致执行未确认完成；已保存文件和效果请核对，不会自动重新执行。'}});
    }));
  }
  sessionReservation(sessionId: string): BackgroundJob | undefined {
    const row = this.db.prepare("SELECT * FROM background_jobs WHERE session_id=? AND status IN ('queued','running')").get(sessionId);
    return row ? decode<BackgroundJob>(row) : undefined;
  }
  hasTaskReservations(taskSpaceId: string) {
    return !!this.db.prepare("SELECT 1 FROM background_jobs WHERE task_id=? AND status IN ('queued','running') UNION ALL SELECT 1 FROM background_actions WHERE task_id=? AND status='preparing' LIMIT 1").get(taskSpaceId, taskSpaceId);
  }

  getDelivery(id: string) { return decode<BackgroundDelivery>(this.db.prepare('SELECT * FROM background_deliveries WHERE id=?').get(id)); }
  updateDelivery(id: string, revision: number, status: BackgroundDelivery['status'], error?: BackgroundDelivery['error']) {
    return this.transaction(() => {
      const delivery = this.getDelivery(id);
      if (delivery.status === 'delivered') return delivery;
      if (delivery.revision !== revision || (status === 'pending' && delivery.status !== 'failed')) throw conflict();
      const time = now();
      const next = {...delivery, status, error, updatedAt: time, revision: delivery.revision + 1, ...(status === 'delivered' ? {deliveredAt: time} : {})};
      this.db.prepare('UPDATE background_deliveries SET status=?,data=? WHERE id=?').run(status, JSON.stringify(next), id); return next;
    });
  }

  getRule(id: string) { return decode<InformationRule>(this.db.prepare('SELECT * FROM information_rules WHERE id=?').get(id)); }
  enabledRule(sourceId: string): InformationRule | undefined {
    const row = this.db.prepare('SELECT * FROM information_rules WHERE source_id=? AND enabled=1').get(sourceId); return row ? decode<InformationRule>(row) : undefined;
  }
  listRules(sourceIds?: string[]) {
    if (sourceIds && !sourceIds.length) return [];
    return this.db.prepare(`SELECT * FROM information_rules${sourceIds ? ` WHERE source_id IN (${sourceIds.map(() => '?').join(',')})` : ''} ORDER BY rowid DESC`).all(...(sourceIds ?? [])).map(row => decode<InformationRule>(row));
  }
  createRule(userId: string, clientActionId: string, input: InformationRuleInput): InformationRule {
    const value = normalizeRule(input); const inputHash = backgroundHash(value);
    return this.transaction(() => {
      const old = this.findAction(userId, clientActionId);
      if (old) { if (old.kind !== 'create_rule' || old.inputHash !== inputHash || !old.ruleId) throw conflict(); return this.getRule(old.ruleId); }
      if (value.enabled && this.enabledRule(value.sourceId)) throw conflict('该来源已有启用规则，请先停用原规则。');
      const time = now(); const rule: InformationRule = {...value, id: randomUUID(), revision: 1, createdAt: time, updatedAt: time, createdByUserId: userId, updatedByUserId: userId};
      this.db.prepare('INSERT INTO information_rules VALUES(?,?,?,?)').run(rule.id, rule.sourceId, Number(rule.enabled), JSON.stringify(rule));
      this.insertCompletedAction({userId, seatId: '', clientActionId, kind: 'create_rule', inputHash, ruleId: rule.id}); return rule;
    });
  }
  updateRule(userId: string, id: string, revision: number, input: InformationRuleInput): InformationRule {
    const value = normalizeRule(input);
    return this.transaction(() => {
      const rule = this.getRule(id); if (rule.revision !== revision || rule.sourceId !== value.sourceId) throw conflict();
      const enabled = this.enabledRule(value.sourceId); if (value.enabled && enabled && enabled.id !== id) throw conflict('该来源已有启用规则，请先停用原规则。');
      const next = {...rule, ...value, publicTaskId: value.publicTaskId, revision: rule.revision + 1, updatedAt: now(), updatedByUserId: userId};
      this.db.prepare('UPDATE information_rules SET enabled=?,data=? WHERE id=?').run(Number(next.enabled), JSON.stringify(next), id); return next;
    });
  }

  grant(subjectKind: 'account' | 'seat', subjectId: string, sourceId: string, permission: InformationPermission) {
    if (!subjectId || !sourceId || !['view', 'manage'].includes(permission)) throw new RequestError('INVALID_INPUT', '授权参数无效。');
    const table = subjectKind === 'account' ? 'accounts' : 'seats';
    if (!this.db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(subjectId)) throw missing();
    this.db.prepare('INSERT INTO information_grants VALUES(?,?,?,?) ON CONFLICT(subject_kind,subject_id,source_id) DO UPDATE SET permission=excluded.permission').run(subjectKind, subjectId, sourceId, permission);
  }
  revoke(subjectKind: 'account' | 'seat', subjectId: string, sourceId: string) { this.db.prepare('DELETE FROM information_grants WHERE subject_kind=? AND subject_id=? AND source_id=?').run(subjectKind, subjectId, sourceId); }
  permissions(actor: Pick<Identity, 'userId' | 'seatId'>): Map<string, InformationPermission> {
    const enabled = this.db.prepare('SELECT seat_id FROM accounts WHERE id=? AND enabled=1').get(actor.userId);
    if (!enabled || enabled.seat_id !== actor.seatId) return new Map();
    const rows = this.db.prepare("SELECT source_id,permission FROM information_grants WHERE (subject_kind='account' AND subject_id=?) OR (subject_kind='seat' AND subject_id=?)").all(actor.userId, actor.seatId);
    const result = new Map<string, InformationPermission>();
    for (const row of rows) { const source = String(row.source_id), permission = String(row.permission) as InformationPermission; if (result.get(source) !== 'manage') result.set(source, permission); }
    return result;
  }
  effectivePermission(actor: Pick<Identity, 'userId' | 'seatId'>, sourceId: string) { return this.permissions(actor).get(sourceId); }
  listGrants() { return this.db.prepare('SELECT subject_kind AS subjectKind,subject_id AS subjectId,source_id AS sourceId,permission FROM information_grants ORDER BY subject_kind,subject_id,source_id').all(); }

  getControl(key: string, defaultEnabled = true): BackgroundControl {
    const row = this.db.prepare('SELECT data FROM background_controls WHERE key=?').get(key);
    if (!row) return {key, enabled: defaultEnabled, revision: 0, updatedAt: ''};
    const value = JSON.parse(String(row.data)) as BackgroundControl;
    if (value.key !== key || typeof value.enabled !== 'boolean' || !Number.isSafeInteger(value.revision) || value.revision < 1) throw stateError(); return value;
  }
  setControl(key: string, revision: number, enabled: boolean, userId?: string): BackgroundControl {
    return this.transaction(() => {
      const current = this.getControl(key); if (current.revision !== revision) throw conflict();
      const next = {key, enabled, revision: revision + 1, updatedAt: now(), updatedByUserId: userId};
      this.db.prepare('INSERT INTO background_controls VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run(key, JSON.stringify(next)); return next;
    });
  }

  getAction(id: string) { return decode<BackgroundAction>(this.db.prepare('SELECT * FROM background_actions WHERE id=?').get(id)); }
  findAction(userId: string, clientActionId: string): BackgroundAction | undefined {
    const row = this.db.prepare('SELECT * FROM background_actions WHERE user_id=? AND client_action_id=?').get(userId, clientActionId); return row ? decode<BackgroundAction>(row) : undefined;
  }
  private assertSameAction(old: BackgroundAction, input: NewBackgroundAction) {
    if (old.kind !== input.kind || old.inputHash !== input.inputHash || old.seatId !== input.seatId) throw conflict('相同操作标识不能用于不同参数。');
  }
  private insertAction(input: NewBackgroundAction, status: BackgroundAction['status']): BackgroundAction {
    const time = now(); const action: BackgroundAction = {...input, id: input.id ?? randomUUID(), status, revision: 1, createdAt: time, updatedAt: time};
    this.db.prepare('INSERT INTO background_actions VALUES(?,?,?,?,?,?)').run(action.id, action.userId, action.clientActionId, action.status, action.taskSpaceId ?? null, JSON.stringify(action)); return action;
  }
  private insertCompletedAction(input: NewBackgroundAction) { return this.insertAction(input, 'completed'); }
  beginAction(input: NewBackgroundAction): BackgroundAction {
    return this.transaction(() => { const old = this.findAction(input.userId, input.clientActionId); if (old) { this.assertSameAction(old, input); return old; } return this.insertAction(input, 'preparing'); });
  }
  updateAction(id: string, revision: number, change: Partial<Pick<BackgroundAction, 'status' | 'workspaceId' | 'sessionId' | 'requestId' | 'jobId' | 'imports' | 'draft' | 'fileRefs' | 'selection' | 'error'>>): BackgroundAction {
    return this.transaction(() => { const action = this.getAction(id); if (action.revision !== revision || action.status === 'completed') throw conflict(); return this.saveAction({...action, ...change, revision: action.revision + 1, updatedAt: now()}); });
  }
  private saveAction(action: BackgroundAction): BackgroundAction { this.db.prepare('UPDATE background_actions SET status=?,data=? WHERE id=?').run(action.status, JSON.stringify(action), action.id); return action; }
  listActions(filter: {eventId?: string; deliveryId?: string; userId?: string; seatId?: string; status?: string} = {}): BackgroundAction[] {
    return this.db.prepare('SELECT * FROM background_actions ORDER BY rowid').all().map(row => decode<BackgroundAction>(row)).filter(action => Object.entries(filter).every(([key, value]) => action[key as keyof BackgroundAction] === value));
  }

  private page<T extends {id: string; revision: number}>(table: 'background_events' | 'background_jobs' | 'background_deliveries', filter: BackgroundListFilter): BackgroundPage<T> {
    const {offset, limit} = pagination(filter); const clauses: string[] = [], values: SQLInputValue[] = [];
    if (filter.sourceIds) { if (!filter.sourceIds.length) return {items: [], total: 0, offset, limit}; clauses.push(`source_id IN (${filter.sourceIds.map(() => '?').join(',')})`); values.push(...filter.sourceIds); }
    if (filter.sourceId) { clauses.push('source_id=?'); values.push(filter.sourceId); }
    if (filter.eventId) { clauses.push(`${table === 'background_events' ? 'id' : 'event_id'}=?`); values.push(filter.eventId); }
    if (filter.jobId && table === 'background_deliveries') { clauses.push('job_id=?'); values.push(filter.jobId); }
    if (filter.status && table !== 'background_events') { clauses.push('status=?'); values.push(filter.status); }
    if (filter.statuses && table === 'background_jobs') {
      if (!filter.statuses.length) return {items: [], total: 0, offset, limit};
      clauses.push(`status IN (${filter.statuses.map(() => '?').join(',')})`); values.push(...filter.statuses);
    }
    if (filter.status && table === 'background_events') {
      if (filter.status === 'unmatched') clauses.push('initial_job_id IS NULL');
      else { clauses.push('EXISTS(SELECT 1 FROM background_jobs j WHERE j.event_id=background_events.id AND j.status=?)'); values.push(filter.status); }
    }
    if (filter.seatId && table !== 'background_events') { clauses.push('seat_id=?'); values.push(filter.seatId); }
    if (filter.search) {
      if (table === 'background_jobs') {
        // Only searchable public source metadata, never a seat's goal, task or native history.
        clauses.push("(instr(id,?)>0 OR EXISTS(SELECT 1 FROM background_events e WHERE e.id=background_jobs.event_id AND (instr(json_extract(e.data,'$.title'),?)>0 OR instr(e.message_id,?)>0)))");
        values.push(filter.search, filter.search, filter.search);
      } else { clauses.push("instr(lower(json_extract(data,'$.title')),lower(?))>0"); values.push(filter.search); }
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const total = Number(this.db.prepare(`SELECT count(*) AS n FROM ${table}${where}`).get(...values)?.n);
    const items = this.db.prepare(`SELECT * FROM ${table}${where} ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(...values, limit, offset).map(row => decode<T>(row));
    return {items, total, offset, limit};
  }
  pageEvents(filter: BackgroundListFilter = {}) { return this.page<BackgroundEvent>('background_events', filter); }
  pageJobs(filter: BackgroundListFilter = {}) { return this.page<BackgroundJob>('background_jobs', filter); }
  pageDeliveries(filter: BackgroundListFilter = {}) { return this.page<BackgroundDelivery>('background_deliveries', filter); }
  listEvents() { return this.db.prepare('SELECT * FROM background_events ORDER BY rowid DESC').all().map(row => decode<BackgroundEvent>(row)); }
  listJobs() { return this.db.prepare('SELECT * FROM background_jobs ORDER BY rowid DESC').all().map(row => decode<BackgroundJob>(row)); }
  listDeliveries(jobId?: string) { return this.db.prepare(`SELECT * FROM background_deliveries${jobId ? ' WHERE job_id=?' : ''} ORDER BY rowid DESC`).all(...(jobId ? [jobId] : [])).map(row => decode<BackgroundDelivery>(row)); }
  /** Stable FIFO, independent of reverse-chronological observation lists. */
  queuedJobs(limit = 100): BackgroundJob[] { return this.db.prepare("SELECT * FROM background_jobs WHERE status='queued' ORDER BY created_at,rowid LIMIT ?").all(limit).map(row => decode<BackgroundJob>(row)); }
}
