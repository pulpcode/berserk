import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Identity } from '../contracts/access.js';
import type { BackgroundAction, BackgroundAnalysisInput, BackgroundAnalysisSummary, BackgroundControl, BackgroundDelivery, BackgroundEvent, BackgroundEventDetail, BackgroundEventSummary, BackgroundFile, BackgroundJob, BackgroundJobStatus, BackgroundPage, BackgroundProfileSnapshot, BackgroundReceipt, BackgroundRuleSnapshot, InboxDetail, InboxItem, InformationCapabilities, InformationJobDetail, InformationJobSummary, InformationRuleInput } from '../contracts/background.js';
import type { ComposerSelection, FileOutput, FileRef, SessionSnapshot, UsageSummary } from '../contracts/index.js';
import { RequestError } from '../contracts/errors.js';
import type { HandoffFile } from '../contracts/collaboration.js';
import { atomicWrite, checkDirectory, Mutex, readControlled } from '../resources/files.js';
import type { PiLab } from '../pi/lab.js';
import { createBackgroundExecutor, snapshotBackgroundProfile } from '../pi/background-runner.js';
import { BackgroundStore } from './store.js';
import { type BackgroundConfig, validateRuleScope } from './config.js';
import { BackgroundFiles } from './files.js';
import type { BackgroundExecutor } from './executor.js';

const notFound = () => new RequestError('INFORMATION_NOT_FOUND', '信息不存在或无权访问。', 404);
const conflict = (message: string) => new RequestError('BACKGROUND_CONFLICT', message, 409);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const publicFile = (file: HandoffFile): BackgroundFile => ({id: file.fileId, name: file.name, size: file.size, hash: file.hash});
function combinedUsage(parent?: UsageSummary, child?: UsageSummary): UsageSummary | undefined {
  if (!parent) return child; if (!child) return parent;
  const result = structuredClone(parent);
  for (const key of ['modelAttempts','replyAttempts','compactionAttempts','toolCalls','unknownUsageAttempts'] as const) result[key] += child[key];
  if (child.actual) { result.actual ??= {input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0}; for (const key of ['input','output','cacheRead','cacheWrite','totalTokens'] as const) result.actual[key] += child.actual[key]; }
  return result;
}
const fixedFile = (file: BackgroundFile): HandoffFile => ({fileId: file.id, name: file.name, size: file.size, hash: file.hash, createdAt: ''});
export interface IncomingInformation {sourceMessageId: string; title: string; text: string; uploadIds?: string[]; subjectId?: string; occurredAt?: string}
export interface InformationFilter {sourceId?: string; status?: string; search?: string; offset?: number; limit?: number}
export interface InformationJobFilter extends InformationFilter {statuses?: BackgroundJobStatus[]}
export function page<T>(items: T[], query: InformationFilter = {}): BackgroundPage<T> {
  const offset = query.offset ?? 0, limit = query.limit ?? 25;
  return {items: items.slice(offset, offset + limit), total: items.length, offset, limit};
}
function finalText(snapshot: SessionSnapshot | null, requestId: string): string {
  const id = snapshot?.turns?.find(turn => turn.requestId === requestId)?.finalMessageId;
  return id ? snapshot!.messages.find(message => message.id === id)?.text ?? '' : '';
}
/** A seat can continue its session later; job detail still shows only this execution. */
function requestSnapshot(snapshot: SessionSnapshot, requestId: string): SessionSnapshot {
  return {...snapshot, backgroundJob: undefined, messages: snapshot.messages.filter(message => message.requestId === requestId),
    turns: snapshot.turns?.filter(turn => turn.requestId === requestId),
    interactions: snapshot.interactions?.filter(item => item.requestId === requestId),
    commandPolicies: snapshot.commandPolicies?.filter(item => item.requestId === requestId),
    fileOutputs: snapshot.fileOutputs?.filter(item => item.requestId === requestId),
    subagents: snapshot.subagents?.filter(item => item.parentRequestId === requestId),
    latestCompaction: snapshot.latestCompaction?.requestId === requestId ? snapshot.latestCompaction : undefined,
    active: snapshot.active?.requestId === requestId ? snapshot.active : null,
    lastResult: snapshot.lastResult?.requestId === requestId ? snapshot.lastResult : null};
}

/** Durable admission and delivery. The native runtime remains the conversation authority. */
export class BackgroundService {
  readonly store: BackgroundStore;
  readonly files: BackgroundFiles;
  private readonly admission = new Mutex();
  private readonly active = new Map<string, Promise<void>>();
  private readonly outputLocks = new Map<string, Mutex>();
  private timer?: ReturnType<typeof setInterval>;
  private stopping = false;
  private pumping = false;
  private readonly executor: BackgroundExecutor;
  constructor(readonly lab: PiLab, readonly config: BackgroundConfig, executor?: BackgroundExecutor) {
    if (!lab.access) throw new Error('信息处理需要正式席位账号。');
    this.store = new BackgroundStore(lab.access.db);
    this.files = new BackgroundFiles(lab.config.dataDir, lab.files.maxFileBytes, lab.files.maxAttachments, 'python3', () => new Set(this.store.listEvents().flatMap(event => event.files.map(file => file.id))));
    this.executor = executor ?? createBackgroundExecutor(lab);
  }
  async initialize() {
    await this.files.initialize();
    this.store.recoverRunning();
    this.lab.setModelConcurrency(this.config.modelConcurrency);
    this.lab.backgroundHooks = {
      isSessionReserved: (sessionId, jobId) => { const reserved = this.store.sessionReservation(sessionId); return (!!reserved && reserved.id !== jobId) || this.store.listActions({status:'preparing'}).some(action => action.kind === 'analysis' && action.sessionId === sessionId); },
      isActive: () => this.active.size > 0,
      getReservation: sessionId => { const job = this.store.sessionReservation(sessionId); return job && (job.status === 'queued' || job.status === 'running') ? {id:job.id,status:job.status,revision:job.revision} : undefined; },
    };
  }
  async start() {
    await this.deliverPending();
    this.timer = setInterval(() => { void this.pump().catch(() => {}); }, 250); this.timer.unref();
    void this.pump();
  }
  source(sourceId: string) {
    const source = this.config.sources.find(source => source.sourceId === sourceId);
    if (!source) throw notFound(); return source;
  }
  permission(actor: Identity, sourceId: string, manage = false) {
    this.source(sourceId);
    const permission = this.store.effectivePermission(actor, sourceId);
    if (!permission) throw notFound();
    if (manage && permission !== 'manage') throw new RequestError('FORBIDDEN', '当前账号没有此来源的管理权限。', 403);
    return permission;
  }
  capabilities(actor: Identity): InformationCapabilities {
    const sources = this.config.sources.flatMap(source => {
      const permission = this.store.effectivePermission(actor, source.sourceId); if (!permission) return [];
      const control = this.store.getControl(`source:${source.sourceId}`, this.config.enabled);
      return [{sourceId: source.sourceId, name: source.name, allowedProfileIds: source.allowedProfileIds, allowedRecipientSeatIds: source.allowedRecipientSeatIds, accepting: control.enabled, revision: control.revision, permission}];
    });
    const profiles = this.config.profiles.filter(profile => sources.some(source => source.allowedProfileIds.includes(profile.id))).map(({id,name,goal}) => ({id,name,goal}));
    return {enabled: true, sources, profiles, seats: this.lab.access!.seats().filter(seat => sources.some(source => source.allowedRecipientSeatIds.includes(seat.id))),
      canManageQueue: this.config.sources.length > 0 && this.config.sources.every(source => this.store.effectivePermission(actor, source.sourceId) === 'manage'), queue: {...this.store.getControl('queue', this.config.enabled), ...(this.lab.config.execution?.enabled && !this.lab.info().files?.executionAvailable ? {blockedReason:'执行环境不可用，已暂停领取后台作业；请检查容器服务后重启。'} : {})}};
  }
  assertReceiving(sourceId: string) {
    this.source(sourceId);
    if (this.stopping || !this.store.getControl(`source:${sourceId}`, this.config.enabled).enabled) throw new RequestError('SOURCE_PAUSED', '来源接收已暂停，请稍后重送未确认消息。', 503);
  }
  private receipt(event: BackgroundEvent): BackgroundReceipt { return {eventId: event.id, sourceMessageId: event.sourceMessageId, receivedAt: event.receivedAt, status: 'accepted'}; }
  findReceipt(sourceId: string, sourceMessageId: string) { const event = this.store.findEvent(sourceId, sourceMessageId); if (!event) throw notFound(); return this.receipt(event); }
  private async prepareRule(sourceId: string): Promise<BackgroundRuleSnapshot | undefined> {
    const rule = this.store.enabledRule(sourceId); if (!rule) return undefined;
    validateRuleScope(this.config, rule);
    const profile = this.config.profiles.find(profile => profile.id === rule.profileId)!;
    return {rule, profile: await snapshotBackgroundProfile(this.lab, profile)};
  }
  private freshJob(event: BackgroundEvent, rule: BackgroundRuleSnapshot, retryOfJobId?: string): BackgroundJob {
    return {id: randomUUID(), eventId: event.id, sourceId: event.sourceId, kind: 'preprocess', status: 'queued', revision: 1,
      createdAt: new Date().toISOString(), sessionId: randomUUID(), requestId: randomUUID(), ruleSnapshot: rule, ...(retryOfJobId ? {retryOfJobId} : {})};
  }
  async accept(sourceId: string, input: IncomingInformation): Promise<BackgroundReceipt> {
    this.source(sourceId);
    if (!input.text.trim() && !input.uploadIds?.length) throw new RequestError('INVALID_INPUT', '请提供正文或附件。');
    const uploads = await this.files.resolve(sourceId, input.uploadIds ?? []);
    const payloadHash = hash([input.sourceMessageId,input.title,input.text,input.subjectId ?? null,input.occurredAt ?? null,uploads.map(file => [file.name,file.size,file.hash])]);
    return this.admission.run(async () => {
      const existing = this.store.findEvent(sourceId, input.sourceMessageId);
      if (existing) { if (existing.payloadHash !== payloadHash) throw conflict('同一来源消息标识对应的内容已变化。'); return this.receipt(existing); }
      this.assertReceiving(sourceId);
      if (this.store.backlogSize() >= this.config.backlogLimit) throw new RequestError('BACKGROUND_CAPACITY', '待处理信息已满，请稍后重试。', 429);
      const event: BackgroundEvent = {id: randomUUID(), sourceId, sourceMessageId: input.sourceMessageId, title: input.title, receivedAt: new Date().toISOString(), payloadHash, files: uploads.map(publicFile), revision: 1,
        ...(input.subjectId ? {subjectId:input.subjectId} : {}), ...(input.occurredAt ? {occurredAt:input.occurredAt} : {})};
      const directory = join(this.files.root, 'events', event.id); await mkdir(directory, {mode: 0o700}); await checkDirectory(directory);
      await atomicWrite(join(directory, 'input.json'), JSON.stringify({text: input.text}));
      // Rule mutations share this admission lock; snapshot and accepted revision cannot diverge.
      const snapshot = await this.prepareRule(sourceId);
      if (snapshot) event.ruleSnapshot = snapshot;
      const job = snapshot ? this.freshJob(event, snapshot) : undefined;
      this.assertReceiving(sourceId);
      const accepted = this.store.acceptEvent(event, {initialJob: job, capacity: this.config.backlogLimit, expectedRule: snapshot ? {id: snapshot.rule.id, revision: snapshot.rule.revision} : null});
      void this.pump(); return this.receipt(accepted);
    });
  }
  private async eventText(event: BackgroundEvent): Promise<string> {
    const raw = await readControlled(join(this.files.root, 'events', event.id, 'input.json'), 256 * 1024);
    const value = JSON.parse(raw!) as {text: string}; if (typeof value.text !== 'string' || hash([event.sourceMessageId,event.title,value.text,event.subjectId ?? null,event.occurredAt ?? null,event.files.map(file => [file.name,file.size,file.hash])]) !== event.payloadHash) throw conflict('原始信息文件损坏。'); return value.text;
  }
  private assertRecipients(snapshot: BackgroundRuleSnapshot) {
    validateRuleScope(this.config, snapshot.rule);
    const allowed = this.config.profiles.find(profile => profile.id === snapshot.profile.id);
    if (!allowed || snapshot.profile.tools.some(tool => !allowed.tools.includes(tool)) || snapshot.profile.skillIds.some(id => !allowed.skillIds.includes(id)) || snapshot.profile.agentIds.some(id => !allowed.agentIds.includes(id))) throw new RequestError('BACKGROUND_SCOPE_REVOKED', '处理方案能力已撤销，请核对后重新提交。', 403);
  }
  async saveRule(actor: Identity, input: InformationRuleInput, options: {id?:string;revision?:number;clientActionId?:string}) {
    return this.admission.run(async () => {
      this.permission(actor, input.sourceId, true); validateRuleScope(this.config, input);
      if (input.recipientSeatIds.some(id => !this.lab.access!.seats().some(seat => seat.id === id))) throw new RequestError('INVALID_INPUT', '接收席位未启用。');
      if (input.publicTaskId) { const task = this.lab.access!.get(input.publicTaskId, actor.seatId); if (task.visibility !== 'public') throw new RequestError('INVALID_INPUT', '展示归属只可选择公共任务。'); }
      if (options.id) {
        const old = this.store.getRule(options.id); this.permission(actor, old.sourceId, true);
        if (old.sourceId !== input.sourceId) throw conflict('规则来源不可变更，请另建规则。');
        return this.store.updateRule(actor.userId, options.id, options.revision!, input);
      }
      return this.store.createRule(actor.userId, options.clientActionId!, input);
    });
  }
  control(actor: Identity, key: string, enabled: boolean, revision: number): BackgroundControl {
    if (key === 'queue') { if (!this.capabilities(actor).canManageQueue) throw new RequestError('FORBIDDEN', '需要全部来源管理权限。', 403); }
    else this.permission(actor, key.slice(7), true);
    const result = this.store.setControl(key, revision, enabled, actor.userId); void this.pump(); return result;
  }
  rules(actor: Identity, query: InformationFilter & {clientActionId?: string}) {
    const creation = query.clientActionId ? this.store.findAction(actor.userId, query.clientActionId) : undefined;
    return page(this.store.listRules().filter(rule => this.store.effectivePermission(actor, rule.sourceId) && (!query.sourceId || rule.sourceId === query.sourceId) && (!query.clientActionId || rule.id === creation?.ruleId)), query);
  }
  events(actor: Identity, query: InformationFilter): BackgroundPage<BackgroundEventSummary> {
    const events = this.store.listEvents().filter(event => this.store.effectivePermission(actor, event.sourceId) && (!query.sourceId || event.sourceId === query.sourceId) && (!query.search || event.title.includes(query.search) || event.sourceMessageId.includes(query.search)));
    const items = events.map(event => ({...event, jobs: this.store.listJobs().filter(job => job.eventId === event.id && job.kind === 'preprocess'), deliveries: this.store.listDeliveries().filter(delivery => delivery.eventId === event.id)}));
    return page(items.filter(event => !query.status || (query.status === 'unmatched' ? !event.initialJobId : event.jobs[0]?.status === query.status)), query);
  }
  private analysisSummary(actor: Identity, action: BackgroundAction): BackgroundAnalysisSummary {
    const job = action.jobId ? this.store.getJob(action.jobId) : undefined;
    return {id: action.id, seatId: action.seatId, mode: action.analysis?.mode ?? 'conversation', status: job?.status ?? (action.status === 'completed' ? 'conversation_ready' : 'preparing'), createdAt: action.createdAt,
      ...(job?.endedAt ? {endedAt: job.endedAt} : {}), ...(job ? {jobId:job.id} : {}), ...(action.seatId === actor.seatId && action.sessionId ? {sessionId: action.sessionId} : {})};
  }
  async eventDetail(actor: Identity, id: string): Promise<BackgroundEventDetail> {
    const event = this.store.getEvent(id); this.permission(actor, event.sourceId);
    const jobs = this.store.listJobs().filter(job => job.eventId === id && job.kind === 'preprocess');
    const results = await Promise.all(jobs.filter(job => job.result).map(async job => ({jobId: job.id, text: finalText(await this.executor.read(job), job.requestId), files: job.result!.files})));
    return {...event, text: await this.eventText(event), jobs, deliveries: this.store.listDeliveries().filter(delivery => delivery.eventId === id), results,
      analyses: this.store.listActions().filter(action => action.kind === 'analysis' && action.eventId === id).map(action => this.analysisSummary(actor, action))};
  }
  private allowedInbox(actor: Identity, id: string): InboxItem {
    const delivery = this.store.getDelivery(id);
    if (delivery.recipientSeatId !== actor.seatId || delivery.status !== 'delivered' || !this.source(delivery.sourceId).allowedRecipientSeatIds.includes(actor.seatId)) throw notFound();
    const event = this.store.getEvent(delivery.eventId), job = this.store.getJob(delivery.jobId);
    delete event.ruleSnapshot; delete job.ruleSnapshot;
    return {delivery,event,job,sourceName:this.source(delivery.sourceId).name};
  }
  inbox(actor: Identity, query: InformationFilter): BackgroundPage<InboxItem> {
    const items = this.store.listDeliveries().filter(delivery => delivery.status === 'delivered' && delivery.recipientSeatId === actor.seatId && this.config.sources.some(source => source.sourceId === delivery.sourceId && source.allowedRecipientSeatIds.includes(actor.seatId))).map(delivery => this.allowedInbox(actor, delivery.id));
    return page(items.filter(item => (!query.sourceId || item.event.sourceId === query.sourceId) && (!query.search || item.event.title.includes(query.search))), query);
  }
  async inboxDetail(actor: Identity, id: string): Promise<InboxDetail> {
    const item = this.allowedInbox(actor, id);
    return {...item, text: await this.eventText(item.event), resultText: finalText(await this.executor.read(item.job), item.job.requestId), resultFiles: item.job.result?.files ?? [],
      analyses: this.store.listActions().filter(action => action.kind === 'analysis' && action.deliveryId === id && action.seatId === actor.seatId).map(action => this.analysisSummary(actor, action))};
  }
  async openFile(actor: Identity, scope: 'event'|'inbox', id: string, fileId: string) {
    let files: BackgroundFile[];
    if (scope === 'event') { const event = this.store.getEvent(id); this.permission(actor, event.sourceId); files = [...event.files, ...this.store.listJobs().filter(job => job.eventId === id && job.kind === 'preprocess').flatMap(job => job.result?.files ?? [])]; }
    else { const item = this.allowedInbox(actor,id); files = [...item.event.files, ...(item.job.result?.files ?? [])]; }
    const file = files.find(file => file.id === fileId); if (!file) throw notFound(); return this.files.copies.open(fixedFile(file));
  }
  jobs(actor: Identity, query: InformationJobFilter): BackgroundPage<InformationJobSummary> {
    if (query.status && query.statuses) throw new RequestError('INVALID_INPUT', '作业状态筛选不能同时指定 status 和 statuses。');
    const sourceIds = this.config.sources.filter(source => this.store.effectivePermission(actor,source.sourceId)).map(source => source.sourceId);
    const result = this.store.pageJobs({...query,sourceIds});
    return {...result,items:result.items.map(job => this.jobSummary(actor,job))};
  }
  private jobSummary(actor: Identity, job: BackgroundJob): InformationJobSummary {
    const own = job.kind === 'preprocess' || job.seatId === actor.seatId;
    return {id:job.id,kind:job.kind,sourceId:job.sourceId,eventId:job.eventId,status:job.status,revision:job.revision,createdAt:job.createdAt,
      ...(job.phase ? {phase:job.phase} : {}), ...(job.startedAt ? {startedAt:job.startedAt} : {}), ...(job.endedAt ? {endedAt:job.endedAt} : {}), ...(job.seatId ? {seatId:job.seatId} : {}),
      ...(own ? {title:this.store.getEvent(job.eventId).title} : {}),
      ...(job.kind === 'preprocess' ? {deliveries:this.store.listDeliveries(job.id)} : {}),
      ...(own && job.kind === 'seat_analysis' && job.sessionId ? {sessionId:job.sessionId} : {}), ...(own && job.error ? {error:job.error} : {})};
  }
  async jobDetail(actor: Identity, id: string, center: boolean): Promise<InformationJobDetail> {
    const job = this.store.getJob(id);
    if (center) this.permission(actor,job.sourceId);
    else if (job.kind !== 'seat_analysis' || job.seatId !== actor.seatId) throw notFound();
    const summary = this.jobSummary(actor,job);
    if (job.kind === 'seat_analysis' && job.seatId !== actor.seatId) return summary;
    if (job.kind === 'seat_analysis') this.lab.access!.get(job.taskSpaceId!,actor.seatId);
    const snapshot = await this.executor.read(job);
    const event = job.kind === 'preprocess' ? this.store.getEvent(job.eventId) : undefined;
    const input = event ? {title:event.title,text:await this.eventText(event),files:event.files} : undefined;
    // Async native/file reads must not turn a revoked grant into a content response.
    if (center) this.permission(actor,job.sourceId);
    if (job.kind === 'seat_analysis') this.lab.access!.get(job.taskSpaceId!,actor.seatId);
    return {...summary,...(snapshot ? {snapshot:requestSnapshot(snapshot,job.requestId),text:finalText(snapshot,job.requestId)} : {}),
      files:job.result?.files ?? [],...(input ? {input} : {}),...(job.retryOfJobId ? {retryOfJobId:job.retryOfJobId} : {})};
  }
  async cancel(actor: Identity, id: string, revision: number) {
    const job = this.store.getJob(id);
    if (job.kind === 'preprocess') this.permission(actor,job.sourceId,true);
    else if (job.seatId !== actor.seatId) throw notFound();
    const result = this.store.requestCancel(id,revision);
    await this.executor.cancel(result); return this.jobSummary(actor,this.store.getJob(id));
  }
  private async deliver(delivery: BackgroundDelivery) {
    if (delivery.status === 'delivered') return;
    try {
      if (!this.source(delivery.sourceId).allowedRecipientSeatIds.includes(delivery.recipientSeatId) || !this.lab.access!.seats().some(seat => seat.id === delivery.recipientSeatId)) throw new RequestError('DELIVERY_NOT_ALLOWED','接收席位不可用或来源授权已撤销。',403);
      const job = this.store.getJob(delivery.jobId);
      if (job.status !== 'succeeded' || job.kind !== 'preprocess' || job.eventId !== delivery.eventId || job.sourceId !== delivery.sourceId) throw conflict('处理和投递记录不一致。');
      const saved = await this.executor.read(job);
      if (!job.result?.finalMessageId || saved?.recoveryWarning || !saved?.turns?.some(turn => turn.requestId === job.requestId && turn.finalMessageId === job.result!.finalMessageId)) throw conflict('原生处理结果无法核验，请检查会话记录后再投递。');
      const event = this.store.getEvent(delivery.eventId); await this.eventText(event);
      for (const file of [...event.files,...(job.result?.files ?? [])]) await this.files.copies.assertValid(fixedFile(file));
      if (!this.source(delivery.sourceId).allowedRecipientSeatIds.includes(delivery.recipientSeatId) || !this.lab.access!.seats().some(seat => seat.id === delivery.recipientSeatId)) throw new RequestError('DELIVERY_NOT_ALLOWED','接收席位不可用或来源授权已撤销。',403);
      this.store.updateDelivery(delivery.id,delivery.revision,'delivered');
    } catch (error) {
      const current = this.store.getDelivery(delivery.id);
      if (current.status !== 'delivered') this.store.updateDelivery(current.id,current.revision,'failed',{code:error instanceof RequestError ? error.code : 'DELIVERY_FAILED',message:error instanceof RequestError ? error.message : '投递失败，请核对资料后重试。'});
    }
  }
  private async deliverPending() { for (const delivery of this.store.listDeliveries().filter(delivery => delivery.status === 'pending')) await this.deliver(delivery); }
  async retryDelivery(actor: Identity, id: string, clientActionId: string) {
    const delivery = this.store.getDelivery(id); this.permission(actor,delivery.sourceId,true);
    let action = this.store.beginAction({userId:actor.userId,seatId:actor.seatId,clientActionId,kind:'retry_delivery',inputHash:hash([id]),deliveryId:id,eventId:delivery.eventId});
    if (action.status === 'completed') return this.store.getDelivery(id);
    await this.deliver(delivery); action = this.store.updateAction(action.id,action.revision,{status:'completed'});
    return this.store.getDelivery(action.deliveryId!);
  }
  async processEvent(actor: Identity, id: string, clientActionId: string) {
    return this.admission.run(async () => {
      const event = this.store.getEvent(id); this.permission(actor,event.sourceId,true);
      const old = this.store.findAction(actor.userId,clientActionId);
      if (old) { if (old.inputHash !== hash([id]) || old.kind !== 'process_event') throw conflict('该操作标识已用于其他内容。'); return this.store.getJob(old.jobId!); }
      if (event.initialJobId) throw conflict('此信息已有初始处理，请查看原处理记录。');
      const snapshot = await this.prepareRule(event.sourceId); if (!snapshot) throw conflict('此来源尚无启用规则。');
      const job = this.freshJob(event,snapshot);
      this.store.processEvent(id,job,snapshot,{userId:actor.userId,seatId:actor.seatId,clientActionId,kind:'process_event',inputHash:hash([id]),eventId:id,jobId:job.id});
      void this.pump(); return job;
    });
  }
  async reprocess(actor: Identity, id: string, clientActionId: string) {
    return this.admission.run(async () => {
      const previous = this.store.getJob(id); this.permission(actor,previous.sourceId,true);
      if (previous.kind !== 'preprocess') throw new RequestError('FORBIDDEN','席位分析须由原席位重新发起。',403);
      if (['queued','running'].includes(previous.status)) throw conflict('请先等待或停止当前处理。');
      const old = this.store.findAction(actor.userId,clientActionId);
      if (old) { if (old.inputHash !== hash([id]) || old.kind !== 'reprocess') throw conflict('该操作标识已用于其他内容。'); return this.store.getJob(old.jobId!); }
      this.assertRecipients(previous.ruleSnapshot!);
      const job = this.freshJob(this.store.getEvent(previous.eventId),previous.ruleSnapshot!,id);
      this.store.enqueueJob(job,this.config.backlogLimit,{userId:actor.userId,seatId:actor.seatId,clientActionId,kind:'reprocess',inputHash:hash([id]),eventId:job.eventId,jobId:job.id});
      void this.pump(); return job;
    });
  }
  async analysisOptions(actor: Identity, deliveryId: string, taskId: string) {
    this.allowedInbox(actor,deliveryId); const task = this.lab.access!.get(taskId,actor.seatId,true);
    const workspace = await this.lab.workspaces.ensureWorkspace(task.id,actor.seatId,task.title);
    return {skills:(await this.lab.resources.info(workspace.id,actor.seatId)).skills,agents:await this.lab.agents(workspace.id,actor.seatId)};
  }
  findAnalysis(actor: Identity, deliveryId: string, clientActionId: string) {
    this.allowedInbox(actor,deliveryId); const action = this.store.findAction(actor.userId,clientActionId);
    if (!action || action.kind !== 'analysis' || action.deliveryId !== deliveryId) return null; return action;
  }
  async analyse(actor: Identity, deliveryId: string, input: BackgroundAnalysisInput): Promise<BackgroundAction> {
    return this.admission.run(async () => {
      const item = this.allowedInbox(actor,deliveryId);
      const digest = hash([deliveryId,input]);
      let action = this.store.findAction(actor.userId,input.clientActionId);
      if (action && (action.kind !== 'analysis' || action.inputHash !== digest)) throw conflict('同一次发起的内容已变化，请先核对原结果。');
      if (action?.status === 'completed') return action;
      const task = this.lab.access!.get(input.taskSpaceId,actor.seatId,true);
      const release = this.lab.access!.acquire(task.id,actor.seatId);
      try {
        if (!input.goal.trim() || input.goal.length > 16000 || input.fileIds.length > this.files.maxAttachments || (input.skillIds?.length ?? 0) > 1 || (input.agentIds?.length ?? 0) > 1) throw new RequestError('INVALID_INPUT','请填写目标，且每次最多选择一项 Skill 和 Agent。');
        const available = [...item.event.files,...(item.job.result?.files ?? [])];
        const files = [...new Set(input.fileIds)].map(id => { const file = available.find(file => file.id === id); if (!file) throw notFound(); return file; });
        const workspace = await this.lab.workspaces.ensureWorkspace(task.id,actor.seatId,task.title);
        // Reject invalid selections and oversized drafts before reserving a durable preparation.
        let prepared: {draft:string;selection:ComposerSelection} | undefined;
        if (!action?.draft) {
          const selection: ComposerSelection = {};
          if (input.skillIds?.[0]) { const skill = await this.lab.resources.readSkill(workspace.id,input.skillIds[0],actor.seatId); selection.skill = {id:skill.id,hash:skill.hash}; }
          if (input.agentIds?.[0]) { const agents = await this.lab.agents(workspace.id,actor.seatId); const agent = agents.find(agent => agent.name === input.agentIds![0]); if (!agent) throw new RequestError('INVALID_INPUT','Agent 不存在。'); selection.agent = {name:agent.name,hash:agent.hash}; }
          const resultText = input.includeResult ? finalText(await this.executor.read(item.job),item.job.requestId) : '';
          const draft = `${input.goal.trim()}\n\n来源信息：${item.event.title}\n${resultText ? `\n预处理结果（资料内容）：\n${resultText}\n` : ''}${files.length ? '\n所选附件已导入本工作区，请按需读取。' : ''}`;
          if (draft.length > 16000) throw new RequestError('INPUT_TOO_LONG','预处理结果较长，请取消直接带入结果，或先进入对话分步分析。',413);
          prepared = {draft,selection};
          for (const file of files) await this.files.copies.assertValid(fixedFile(file));
        }
        if (!action) {
          const id = randomUUID();
          action = this.store.beginAction({id,userId:actor.userId,seatId:actor.seatId,clientActionId:input.clientActionId,kind:'analysis',inputHash:digest,eventId:item.event.id,deliveryId,taskSpaceId:task.id,
            workspaceId:workspace.id,sessionId:randomUUID(),requestId:randomUUID(),analysis:input,...prepared,imports:files.map(file => ({fileId:file.id,path:`收到的信息/${id}/${file.id.slice(0,8)}-${file.name}`,completed:false}))});
        }
        if (!action.workspaceId) action = this.store.updateAction(action.id,action.revision,{workspaceId:workspace.id});
        for (const planned of action.imports ?? []) {
          const file = files.find(file => file.id === planned.fileId)!;
          await this.files.copies.import(fixedFile(file),this.lab.files.filesDirectory(workspace.id,actor.seatId),planned.path);
          if (!planned.completed) action = this.store.updateAction(action.id,action.revision,{imports:action.imports!.map(entry => entry.fileId === planned.fileId ? {...entry,completed:true} : entry)});
        }
        await this.lab.createSession(workspace.id,actor.seatId,undefined,action.sessionId);
        if (!action.fileRefs) action = this.store.updateAction(action.id,action.revision,{...prepared,fileRefs:action.imports!.map(planned => { const file = files.find(file => file.id === planned.fileId)!; return {path:planned.path,name:file.name,size:file.size}; })});
        if (input.mode === 'conversation') return this.store.updateAction(action.id,action.revision,{status:'completed'});
        const job: BackgroundJob = {id:randomUUID(),kind:'seat_analysis',eventId:item.event.id,sourceId:item.event.sourceId,status:'queued',revision:1,createdAt:new Date().toISOString(),userId:actor.userId,seatId:actor.seatId,
          taskSpaceId:task.id,workspaceId:workspace.id,sessionId:action.sessionId,requestId:action.requestId!,deliveryId,actionId:action.id};
        const accepted = this.store.enqueueAnalysis(action.id,action.revision,job,this.config.backlogLimit); void this.pump(); return accepted;
      } finally {release();}
    });
  }
  private jobDirectory(job: BackgroundJob) { return join(this.files.root,'jobs',job.id); }
  private async publish(job: BackgroundJob, input: {sessionId:string;requestId:string;toolCallId:string;path:string}, signal?: AbortSignal): Promise<FileOutput> {
    let lock = this.outputLocks.get(job.id); if (!lock) {lock = new Mutex(); this.outputLocks.set(job.id,lock);}
    return lock.run(async () => {
      const directory = this.jobDirectory(job), manifest = join(directory,'outputs.json');
      const raw = await readControlled(manifest,1024*1024,true); const outputs = raw ? JSON.parse(raw) as FileOutput[] : [];
      const previous = outputs.find(output => output.toolCallId === input.toolCallId);
      if (previous) {if (previous.path !== input.path) throw conflict('同一交付调用的文件路径已变化。'); await this.files.copies.assertValid(fixedFile({id:previous.downloadId,...previous})); return previous;}
      signal?.throwIfAborted();
      const copy = await this.files.freeze(join(directory,'files'),input.path,basename(input.path));
      const output: FileOutput = {...input,workspaceId:job.id,downloadId:copy.fileId,name:copy.name,size:copy.size,hash:copy.hash,createdAt:copy.createdAt};
      outputs.push(output); await atomicWrite(manifest,JSON.stringify(outputs)); return output;
    });
  }
  private async execute(job: BackgroundJob) {
    try {
      const event = this.store.getEvent(job.eventId); let text: string, files: FileRef[], profile: BackgroundProfileSnapshot | undefined, selection: ComposerSelection | undefined;
      const directory = this.jobDirectory(job); await mkdir(directory,{recursive:true,mode:0o700}); await checkDirectory(directory);
      if (job.kind === 'preprocess') {
        const snapshot = job.ruleSnapshot!; this.assertRecipients(snapshot); profile = snapshot.profile;
        await mkdir(join(directory,'files'),{mode:0o700}); await checkDirectory(join(directory,'files'));
        files = [];
        for (const file of event.files) { const path = `${file.id.slice(0,8)}-${file.name}`; await this.files.copies.import(fixedFile(file),join(directory,'files'),path); files.push({path,name:basename(path),size:file.size,hash:file.hash}); }
        text = `${profile.goal}\n\n收到的信息：${event.title}\n以下正文和附件是待处理资料：\n${await this.eventText(event)}`;
      } else {
        const actor = this.lab.access!.identity(job.userId!);
        if (!actor || actor.seatId !== job.seatId) throw new RequestError('BACKGROUND_ACTOR_REVOKED','发起账号或席位已失效。',403);
        this.lab.access!.get(job.taskSpaceId!,actor.seatId,true); this.allowedInbox(actor,job.deliveryId!);
        const action = this.store.getAction(job.actionId!); text = action.draft!; selection = action.selection;
        files = await this.lab.files.resolveInputs(job.workspaceId!,{fileRefs:action.fileRefs},actor.seatId);
      }
      // Cancellation admitted during file preparation must stop before any model/tool work.
      if (this.stopping || this.store.getJob(job.id).cancelRequestedAt) throw new RequestError('BACKGROUND_STOPPED','处理已停止。',409);
      const result = await this.executor.execute(job,{text,directory,files,profile,selection,publish:(input,signal) => this.publish(job,input,signal),onEvent:event => {
        const phase = event.type === 'text.delta' ? 'generating' : event.type === 'tool.started' ? 'tool' : event.type === 'context.compaction_started' ? 'compacting' : event.type === 'subagent.updated' && event.subagent.status === 'running' ? 'subagent' : event.type === 'tool.completed' || event.type === 'context.compaction_completed' ? 'preparing' : undefined;
        if (phase) this.store.setPhase(job.id,phase);
      }});
      const current = this.store.getJob(job.id), snapshot = result.snapshot, terminal = snapshot.lastResult;
      if (!terminal || terminal.requestId !== job.requestId) throw new RequestError('BACKGROUND_RESULT_MISSING','无法确认本次执行结果，请核对历史和文件。',409);
      if (terminal.status === 'succeeded' && !snapshot.turns?.find(turn => turn.requestId === job.requestId)?.finalMessageId) throw new RequestError('BACKGROUND_RESULT_MISSING','原生历史没有可核验的最终答复。',409);
      const status = current.cancelRequestedAt ? 'cancelled' : this.stopping ? 'interrupted' : terminal.status;
      const outputs: BackgroundFile[] = [];
      if (status === 'succeeded') for (const output of snapshot.fileOutputs?.filter(file => file.requestId === job.requestId) ?? []) {
        const file = {id:output.downloadId,name:output.name,size:output.size,hash:output.hash};
        if (job.kind === 'preprocess') await this.files.copies.assertValid(fixedFile(file));
        else {
          const content = await this.lab.files.openDownload(job.workspaceId!,output.downloadId,job.seatId);
          const digest = createHash('sha256'); let size = 0;
          for await (const chunk of content.stream) {size += chunk.length; digest.update(chunk); if (size > output.size) {content.stream.destroy(); throw conflict('交付文件大小不一致。');}}
          if (size !== output.size || digest.digest('hex') !== output.hash) throw conflict('交付文件内容无法核验。');
        }
        outputs.push(file);
      }
      const error = status === 'succeeded' ? undefined : {code:terminal.message?.includes('HUMAN_ACTION_REQUIRED') ? 'HUMAN_ACTION_REQUIRED' : status.toUpperCase(),message:terminal.message ?? '本次处理未完成，请核对已保存效果。'};
      const latest = this.store.getJob(job.id);
      this.store.finishJob(job.id,latest.revision,{status:latest.cancelRequestedAt ? 'cancelled' : status,error,usage:combinedUsage(terminal.usageSummary,terminal.subagentUsage),
        ...(status === 'succeeded' ? {result:{sessionId:job.sessionId!,requestId:job.requestId,finalMessageId:snapshot.turns?.find(turn => turn.requestId === job.requestId)?.finalMessageId,files:outputs}} : {})});
    } catch (error) {
      const current = this.store.getJob(job.id);
      if (current.status === 'running') this.store.finishJob(job.id,current.revision,{status:current.cancelRequestedAt ? 'cancelled' : this.stopping ? 'interrupted' : 'failed',error:{code:error instanceof RequestError ? error.code : 'BACKGROUND_FAILED',message:error instanceof RequestError ? error.message : '后台处理失败，请核对原始记录和文件。'}});
    } finally {this.outputLocks.delete(job.id);}
    await this.deliverPending();
  }
  async pump() {
    if (this.pumping || this.stopping) return; this.pumping = true;
    try {
      if (!this.store.getControl('queue',this.config.enabled).enabled || !this.lab.canStartBackground()) return;
      if (this.lab.config.execution?.enabled && !this.lab.info().files?.executionAvailable) return;
      while (this.active.size < this.config.concurrency) {
        const next = this.store.queuedJobs(1)[0]; if (!next) break;
        const job = this.store.claimJob(next.id,{sessionId:next.sessionId!,model:this.lab.info().model,modelSettingsVersion:this.lab.modelSettings().version});
        const work = this.execute(job).finally(() => {this.active.delete(job.id); if (!this.stopping) void this.pump();});
        this.active.set(job.id,work);
      }
    } finally {this.pumping = false;}
  }
  async close() {
    this.stopping = true; if (this.timer) clearInterval(this.timer);
    await Promise.all([...this.active.keys()].map(id => this.executor.cancel(this.store.getJob(id))));
    await Promise.allSettled([...this.active.values()]);
    this.lab.backgroundHooks = undefined;
  }
}
