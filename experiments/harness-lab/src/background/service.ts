import { verifiedRecipientSuggestion } from './recipient-evidence.js';
import { queryEvidence, queryReferences, sourceReference } from './context-evidence.js';
import type { ContextScopeSnapshot } from '../contracts/context.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Identity } from '../contracts/access.js';
import type { BackgroundAction, BackgroundAnalysisInput, BackgroundAnalysisSummary, BackgroundControl, BackgroundDelivery, BackgroundEvent, BackgroundEventDetail, BackgroundEventSummary, BackgroundFile, BackgroundJob, BackgroundJobStatus, BackgroundPage, BackgroundProfileSnapshot, BackgroundReceipt, BackgroundRuleSnapshot, InboxDetail, InboxItem, InformationCapabilities, InformationJobDetail, InformationJobSummary, InformationRuleInput, RecipientSuggestionInput, DeliveryReviewDecisionInput, BackgroundDeliveryReview, DeliveryReviewSummary, DeliveryReviewDetail } from '../contracts/background.js';
import type { ComposerSelection, FileOutput, FileRef, SessionSnapshot, UsageSummary } from '../contracts/index.js';
import { RequestError } from '../contracts/errors.js';
import type { HandoffFile } from '../contracts/collaboration.js';
import { atomicWrite, checkDirectory, Mutex, readControlled } from '../resources/files.js';
import type { PiLab } from '../pi/lab.js';
import { createBackgroundExecutor, snapshotBackgroundProfile } from '../pi/background-runner.js';
import { BackgroundStore, validRecipientSuggestionInput } from './store.js';
import { TaskLinkService } from './task-links.js';
import type { BackgroundAnalysisOrigin } from '../contracts/task-information.js';
import { loadControlledSkills } from '../resources/service.js';
import { newWorkspace } from '../workspaces/store.js';
import { loadAgentRoles } from '../pi/roles.js';
import { agentInfo } from '../pi/composer-input.js';
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
/** Keep public analysis emitted before a recording tool, without treating it as the final answer. */
export function processingText(snapshot: SessionSnapshot | null, requestId: string): string {
  const id = snapshot?.turns?.find(turn => turn.requestId === requestId)?.finalMessageId;
  if (!id || !snapshot) return '';
  const end = snapshot.messages.findIndex(message => message.id === id && message.requestId === requestId && message.role === 'assistant' && !message.isError);
  if (end < 0) return '';
  const final = snapshot.messages[end].text;
  const earlier = snapshot.messages.slice(0, end).filter(message => message.requestId === requestId
    && message.role === 'assistant' && !message.isError && message.text.trim()).map(message => message.text);
  return earlier.length ? `## 处理过程中的说明\n\n${earlier.join('\n\n---\n\n')}\n\n## 最终答复\n\n${final}` : final;
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
  readonly taskLinks: TaskLinkService;
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
    this.taskLinks = new TaskLinkService(lab.access, this.store, {
      canRead: (actor, event, job) => this.canReadTaskInformation(actor, event, job),
      sourceName: sourceId => this.source(sourceId).name,
      analysisSummaries: (actor, taskId, eventId, jobId) => this.store.listActions().filter(action =>
        action.kind === 'analysis' && action.seatId === actor.seatId && action.origin?.kind === 'task_information'
        && action.origin.taskSpaceId === taskId && action.origin.eventId === eventId && action.origin.jobId === jobId
      ).map(action => this.analysisSummary(actor, action)),
      readContent: async (actor, event, job) => {
        const snapshot = await this.executor.read(job), text = await this.eventText(event);
        if (!this.canReadTaskInformation(actor, event, job)) throw notFound();
        return {text, resultText: processingText(snapshot, job.requestId), resultFiles: job.result?.files ?? [], queryMessages: queryEvidence(snapshot, job.requestId)};
      },
    });
  }
  async initialize() {
    await this.files.initialize();
    this.store.recoverRunning();
    this.lab.setModelConcurrency(this.config.modelConcurrency);
    this.lab.taskInformation = {
      list: (seatId, taskId, params, signal) => {
        signal?.throwIfAborted();
        return this.taskLinks.list(this.seatIdentity(seatId), taskId, params);
      },
      read: async (seatId, taskId, params, signal) => {
        signal?.throwIfAborted();
        const actor = this.seatIdentity(seatId);
        const detail = await this.taskLinks.detail(actor, taskId, params.eventId, params.jobId);
        signal?.throwIfAborted();
        return {eventId: detail.eventId, jobId: detail.jobId, taskId, title: detail.title, sourceId: detail.sourceId,
          analysisAt: detail.analysisAt, section: params.section, text: params.section === 'original' ? detail.text : detail.resultText,
          sourceReference: sourceReference(detail.event), queryReferences: queryReferences(detail.queryMessages ?? []),
          files: params.section === 'original' ? detail.event.files : detail.resultFiles};
      },
    };
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
  private configuredProfileScope(profile: BackgroundProfileSnapshot): ContextScopeSnapshot | undefined {
    if (!profile.contextScopeId) {
      if (profile.tools.some(tool => ['information_search','information_read','situation_query','task_search','task_read','information_record_task_assessment'].includes(tool))) throw new RequestError('CONTEXT_UNAVAILABLE','查询方案须配置业务资料范围。',503);
      return undefined;
    }
    if (!this.lab.context) throw new RequestError('CONTEXT_UNAVAILABLE','业务资料配置不可用。',503);
    return this.lab.context.scopeSnapshot(profile.contextScopeId);
  }
  private assertContext(seatId: string | undefined, scope?: ContextScopeSnapshot) {
    if (!scope) return;
    if (!this.lab.context) throw new RequestError('CONTEXT_UNAVAILABLE', '本次业务资料配置不可用。', 503);
    if (seatId === undefined) this.lab.context.assertServiceScope(scope);
    else {
      if (!this.lab.access!.seats().some(seat => seat.id === seatId)) throw notFound();
      this.lab.context.assertSeatScope(seatId, scope);
    }
  }
  private jobScope(job: BackgroundJob) { return job.contextScope ?? job.ruleSnapshot?.profile.contextScope; }
  private canReadJob(actor: Identity, job: BackgroundJob): boolean {
    try { this.assertContext(actor.seatId, this.jobScope(job)); return true; } catch { return false; }
  }
  private seatIdentity(seatId: string): Identity {
    const actor = this.lab.access!.identityForSeat(seatId);
    if (!actor) throw notFound(); return actor;
  }
  private canReadTaskInformation(actor: Identity, event: BackgroundEvent, job: BackgroundJob): boolean {
    const current = this.lab.access!.identity(actor.userId);
    if (!current || current.seatId !== actor.seatId || job.eventId !== event.id || job.sourceId !== event.sourceId
      || job.kind !== 'preprocess' || job.status !== 'succeeded') return false;
    const source = this.config.sources.find(source => source.sourceId === job.sourceId);
    if (!source || !this.canReadJob(current, job)) return false;
    return !!this.store.effectivePermission(current, source.sourceId) || (source.allowedRecipientSeatIds.includes(current.seatId)
      && this.store.listDeliveries(job.id).some(delivery => delivery.recipientSeatId === current.seatId && delivery.status === 'delivered'));
  }
  private canReadEvent(actor: Identity, event: BackgroundEvent): boolean {
    try {
      this.assertContext(actor.seatId, event.ruleSnapshot?.profile.contextScope);
      return this.store.listJobs().filter(job => job.eventId === event.id && job.kind === 'preprocess').every(job => this.canReadJob(actor, job));
    } catch { return false; }
  }
  private eventProjection(actor: Identity, event: BackgroundEvent): BackgroundEvent & {contentRestricted?: boolean} {
    if (this.canReadEvent(actor,event)) return event;
    return {id:event.id,sourceId:event.sourceId,sourceMessageId:'',title:'',receivedAt:event.receivedAt,
      payloadHash:'',files:[],revision:event.revision,initialJobId:event.initialJobId,contentRestricted:true};
  }
  private jobProjection(actor: Identity, job: BackgroundJob): BackgroundJob {
    if (this.canReadJob(actor,job)) return job.status === 'succeeded' ? job : {...job,taskAssessment:undefined,taskSuggestionCreation:undefined,recipientSuggestion:undefined,recipientSuggestionError:undefined};
    return {id:job.id,kind:job.kind,eventId:job.eventId,sourceId:job.sourceId,status:job.status,phase:job.phase,
      revision:job.revision,createdAt:job.createdAt,startedAt:job.startedAt,endedAt:job.endedAt,requestId:job.requestId};
  }
  private deliveryProjection(actor: Identity, delivery: BackgroundDelivery): BackgroundDelivery {
    return this.canReadJob(actor,this.store.getJob(delivery.jobId)) ? delivery : {...delivery,error:undefined};
  }
  deliveries(actor: Identity, query: InformationFilter) {
    return page(this.store.listDeliveries().filter(delivery => this.store.effectivePermission(actor,delivery.sourceId)
      && (!query.sourceId || delivery.sourceId === query.sourceId) && (!query.status || delivery.status === query.status))
      .map(delivery => this.deliveryProjection(actor,delivery)),query);
  }
  capabilities(actor: Identity): InformationCapabilities {
    const sources = this.config.sources.flatMap(source => {
      const permission = this.store.effectivePermission(actor, source.sourceId); if (!permission) return [];
      const control = this.store.getControl(`source:${source.sourceId}`, this.config.enabled);
      return [{sourceId: source.sourceId, name: source.name, allowedProfileIds: source.allowedProfileIds, allowedRecipientSeatIds: source.allowedRecipientSeatIds, accepting: control.enabled, revision: control.revision, permission}];
    });
    const profiles = this.config.profiles.filter(profile => sources.some(source => source.allowedProfileIds.includes(profile.id))).map(profile => {
      const {id,name,goal} = profile;
      try {
        const scope = this.configuredProfileScope(profile);
        if (!scope) return {id,name,goal};
        return {id,name,goal,contextScope:{...scope,systemNames:scope.systemIds.map(id => this.lab.context!.config.systems.find(system => system.id === id)!.name)}};
      } catch { return {id,name,goal,configurationError:'该处理方案的业务资料配置不可用，请联系维护人员。'}; }
    });
    return {enabled: true, sources, profiles, deliveryReviewSeatId: this.config.deliveryReviewSeatId,
      canReviewDeliveries: actor.seatId === this.config.deliveryReviewSeatId && sources.some(source => source.permission === 'manage' && this.config.profiles.some(profile => {
        if (!source.allowedProfileIds.includes(profile.id)) return false;
        try {this.assertContext(actor.seatId,this.configuredProfileScope(profile)); return true;} catch {return false;}
      })),
      pendingDeliveryReviews: this.deliveryReviews(actor, {status:'pending'}).total, seats: this.lab.access!.seats().filter(seat => sources.some(source => source.allowedRecipientSeatIds.includes(seat.id))),
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
    const snapshot: BackgroundRuleSnapshot = {rule, profile: await snapshotBackgroundProfile(this.lab, profile),
      ...(rule.supplementaryDelivery ? {supplementaryDelivery: this.supplementarySnapshot(rule, this.configuredProfileScope(profile))} : {})};
    this.assertRecipients(snapshot); return snapshot;
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
        ...(this.source(sourceId).systemId ? {systemId:this.source(sourceId).systemId} : {}), ...(input.subjectId ? {subjectId:input.subjectId} : {}), ...(input.occurredAt ? {occurredAt:input.occurredAt} : {})};
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
    // Candidate revocation must not block the still-authorized fixed delivery path.
    validateRuleScope(this.config, {...snapshot.rule,supplementaryDelivery:undefined});
    if (snapshot.profile.contextScopeId && !snapshot.profile.contextScope) throw new RequestError('CONTEXT_UNAVAILABLE','处理方案缺少已保存的资料范围。',503);
    this.assertContext(undefined,snapshot.profile.contextScope);
    for (const seatId of snapshot.rule.recipientSeatIds) this.assertContext(seatId,snapshot.profile.contextScope);
    const allowed = this.config.profiles.find(profile => profile.id === snapshot.profile.id);
    if (!allowed || snapshot.profile.tools.some(tool => !allowed.tools.includes(tool)) || snapshot.profile.skillIds.some(id => !allowed.skillIds.includes(id)) || snapshot.profile.agentIds.some(id => !allowed.agentIds.includes(id))) throw new RequestError('BACKGROUND_SCOPE_REVOKED', '处理方案能力已撤销，请核对后重新提交。', 403);
  }
  async saveRule(actor: Identity, input: InformationRuleInput, options: {id?:string;revision?:number;clientActionId?:string}) {
    return this.admission.run(async () => {
      this.permission(actor, input.sourceId, true); validateRuleScope(this.config, input);
      if (input.recipientSeatIds.some(id => !this.lab.access!.seats().some(seat => seat.id === id))) throw new RequestError('INVALID_INPUT', '接收席位未启用。');
      const scope = this.configuredProfileScope(this.config.profiles.find(profile => profile.id === input.profileId)!);
      for (const seatId of input.recipientSeatIds) this.assertContext(seatId,scope);
      if (input.supplementaryDelivery) this.supplementarySnapshot(input, scope);
      if (input.publicTaskId) { const task = this.lab.access!.get(input.publicTaskId, actor.seatId); if (task.visibility !== 'public') throw new RequestError('INVALID_INPUT', '展示归属只可选择公共任务。'); }
      if (options.id) {
        const old = this.store.getRule(options.id); this.permission(actor, old.sourceId, true);
        if (old.sourceId !== input.sourceId) throw conflict('规则来源不可变更，请另建规则。');
        return this.store.updateRule(actor.userId, options.id, options.revision!, input);
      }
      return this.store.createRule(actor.userId, options.clientActionId!, input);
    });
  }
  private supplementarySnapshot(rule: InformationRuleInput, scope?: ContextScopeSnapshot): NonNullable<BackgroundRuleSnapshot['supplementaryDelivery']> {
    const reviewerSeatId = this.config.deliveryReviewSeatId;
    const candidateIds = rule.supplementaryDelivery?.candidateSeatIds;
    const profile = this.config.profiles.find(profile => profile.id === rule.profileId);
    if (!reviewerSeatId || !candidateIds?.length || candidateIds.length > 100 || new Set(candidateIds).size !== candidateIds.length
      || !profile?.tools.includes('information_suggest_recipients')) throw new RequestError('RULE_SCOPE_INVALID', '补充投递需要配置总体席、候选席位及建议工具。');
    const reviewer = this.seatIdentity(reviewerSeatId);
    this.permission(reviewer,rule.sourceId,true); this.assertContext(reviewerSeatId,scope);
    const candidates = candidateIds.map(id => {
      const seat = this.lab.access!.seats().find(seat => seat.id === id);
      if (!seat?.responsibility?.trim() || !seat.responsibilityRevision || id === reviewerSeatId || rule.recipientSeatIds.includes(id)) throw new RequestError('RULE_SCOPE_INVALID', '候选须为职责完整的有效席位，且不与固定接收者或总体席重复。');
      this.assertCandidate(rule.sourceId,id,scope);
      return {id:seat.id,name:seat.name,responsibility:seat.responsibility,responsibilityRevision:seat.responsibilityRevision};
    });
    return {reviewerSeatId,candidates};
  }
  private assertCandidate(sourceId: string, seatId: string, scope?: ContextScopeSnapshot) {
    if (!this.source(sourceId).allowedRecipientSeatIds.includes(seatId) || !this.lab.access!.identityForSeat(seatId)) throw new RequestError('DELIVERY_NOT_ALLOWED','接收席位不可用或来源授权已撤销。',403);
    this.assertContext(seatId,scope);
  }
  recordRecipientSuggestion(jobId: string, input: RecipientSuggestionInput, toolCallId: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.stopping) throw conflict('处理已停止。');
    const job = this.store.getJob(jobId);
    if (!job.ruleSnapshot?.supplementaryDelivery || !job.ruleSnapshot.profile.tools.includes('information_suggest_recipients')) throw new RequestError('RECIPIENT_SUGGESTION_UNAVAILABLE','本次处理未启用补充建议。',409);
    if (Array.isArray(input?.recipients) && input.recipients.length && input.noAdditionalReason !== undefined) throw new RequestError('INVALID_INPUT','recipients 非空时必须省略 noAdditionalReason；请保留接收名单及逐席位 reason，删除 noAdditionalReason 后重新提交。');
    if (Array.isArray(input?.recipients) && !input.recipients.length && (typeof input.noAdditionalReason !== 'string' || !input.noAdditionalReason.trim())) throw new RequestError('INVALID_INPUT','recipients 为空数组时必须填写 noAdditionalReason，说明无需补充的理由。');
    if (!validRecipientSuggestionInput(input)) throw new RequestError('INVALID_INPUT','请提交不重复的候选席位及逐席位 reason（1～1,500 字符）；recipients 非空时省略 noAdditionalReason，为空时填写该字段（1～1,500 字符）。');
    for (const recipient of input.recipients) this.assertCandidate(job.sourceId,recipient.seatId,this.jobScope(job));
    const suggestion = {...input,toolCallId,recordedAt:new Date().toISOString()};
    this.store.saveRecipientSuggestion(job.id,job.revision,suggestion);
    return {suggestion,published:false as const};
  }
  private reviewAccess(actor: Identity, review: BackgroundDeliveryReview, decide = false) {
    const current = this.lab.access!.identity(actor.userId);
    if (!current || current.seatId !== actor.seatId) throw notFound();
    this.permission(current,review.sourceId,decide);
    const job = this.store.getJob(review.jobId);
    this.assertContext(current.seatId,this.jobScope(job));
    if (decide && (current.seatId !== review.reviewerSeatId || current.seatId !== this.config.deliveryReviewSeatId)) throw new RequestError('FORBIDDEN','只有指定总体席可以批准补充投递。',403);
    return job;
  }
  private reviewSummary(actor: Identity, review: BackgroundDeliveryReview): DeliveryReviewSummary {
    const job = this.reviewAccess(actor,review);
    return {...review,title:this.store.getEvent(review.eventId).title,sourceName:this.source(review.sourceId).name,
      fixedRecipientSeatIds:job.ruleSnapshot!.rule.recipientSeatIds,suggestion:job.recipientSuggestion!};
  }
  deliveryReviews(actor: Identity, query: InformationFilter = {}): BackgroundPage<DeliveryReviewSummary> {
    const items = this.store.listDeliveryReviews().flatMap(review => {
      if ((query.sourceId && review.sourceId !== query.sourceId) || (query.status && review.status !== query.status)) return [];
      try { const item = this.reviewSummary(actor,review); return !query.search || item.title.includes(query.search) ? [item] : []; } catch { return []; }
    });
    return page(items,query);
  }
  async deliveryReviewDetail(actor: Identity, id: string): Promise<DeliveryReviewDetail> {
    const review = this.store.getDeliveryReview(id), job = this.reviewAccess(actor,review);
    const jobDetail = await this.jobDetail(actor,job.id,true);
    const summary = this.reviewSummary(actor,this.store.getDeliveryReview(id));
    let canDecide = false;
    try {this.reviewAccess(actor,review,true); canDecide = summary.status === 'pending';} catch { /* Read-only source viewers cannot decide. */ }
    const candidates = job.ruleSnapshot!.supplementaryDelivery!.candidates.map(candidate => {
      try {this.assertCandidate(job.sourceId,candidate.id,this.jobScope(job));return {...candidate,available:true};}
      catch {return {...candidate,available:false,unavailableReason:'席位或当前资料访问权限不可用'};}
    });
    return {...summary,candidates,canDecide,jobDetail};
  }
  async decideDeliveryReview(actor: Identity, id: string, input: DeliveryReviewDecisionInput) {
    return this.admission.run(async () => {
      const review = this.store.getDeliveryReview(id), job = this.reviewAccess(actor,review,true);
      const prior = this.store.findAction(actor.userId,input.clientActionId);
      if (!prior && input.decision === 'approve') {
        if (review.status !== 'pending' || review.revision !== input.revision) throw conflict('审批已经变化，请读取最新决定。');
        const saved = await this.executor.read(job);
        if (!job.result?.finalMessageId || saved?.recoveryWarning || !saved?.turns?.some(turn => turn.requestId === job.requestId && turn.finalMessageId === job.result!.finalMessageId)) throw conflict('原生处理结果无法核验，请核对历史。');
        const event = this.store.getEvent(job.eventId); await this.eventText(event);
        for (const file of [...event.files,...job.result.files]) await this.files.copies.assertValid(fixedFile(file));
        for (const recipient of input.recipients ?? []) this.assertCandidate(job.sourceId,recipient.seatId,this.jobScope(job));
      }
      this.reviewAccess(actor,this.store.getDeliveryReview(id),true);
      const decided = this.store.decideDeliveryReview(id,input,actor);
      for (const delivery of this.store.listDeliveries(job.id).filter(item => item.reviewId === id && item.status === 'pending')) await this.deliver(delivery);
      return decided;
    });
  }
  private assertDeliveryBasis(delivery: BackgroundDelivery, job: BackgroundJob) {
    if (delivery.reviewId) {
      const review = this.store.getDeliveryReview(delivery.reviewId);
      if (review.jobId !== job.id || review.status !== 'approved' || !review.recipients?.some(item => item.seatId === delivery.recipientSeatId)) throw conflict('补充投递缺少已批准的接收依据。');
    } else if (!job.ruleSnapshot?.rule.recipientSeatIds.includes(delivery.recipientSeatId)) throw conflict('固定投递接收者不在原规则中。');
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
    const events = this.store.listEvents().filter(event => this.store.effectivePermission(actor, event.sourceId) && (!query.sourceId || event.sourceId === query.sourceId));
    const items = events.map(event => ({...this.eventProjection(actor,event), jobs: this.store.listJobs().filter(job => job.eventId === event.id && job.kind === 'preprocess').map(job => this.jobProjection(actor,job)), deliveries: this.store.listDeliveries().filter(delivery => delivery.eventId === event.id).map(delivery => this.deliveryProjection(actor,delivery))})).filter(event => !query.search || event.title.includes(query.search) || event.sourceMessageId.includes(query.search));
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
    if (!this.canReadEvent(actor,event)) return {...this.eventProjection(actor,event),jobs:jobs.map(job => this.jobProjection(actor,job)),deliveries:this.store.listDeliveries().filter(delivery => delivery.eventId === id).map(delivery => this.deliveryProjection(actor,delivery)),text:'',results:[],analyses:[]};
    const results = await Promise.all(jobs.filter(job => job.result).map(async job => ({jobId: job.id, text: processingText(await this.executor.read(job), job.requestId), files: job.result!.files})));
    const text = await this.eventText(event);
    this.permission(actor,event.sourceId);
    if (!this.canReadEvent(actor,event)) throw notFound();
    return {...event, text, jobs:jobs.map(job => this.jobProjection(actor,job)), deliveries: this.store.listDeliveries().filter(delivery => delivery.eventId === id), results,
      analyses: this.store.listActions().filter(action => action.kind === 'analysis' && action.eventId === id).map(action => this.analysisSummary(actor, action))};
  }
  private allowedInbox(actor: Identity, id: string): InboxItem {
    const delivery = this.store.getDelivery(id);
    if (delivery.recipientSeatId !== actor.seatId || delivery.status !== 'delivered' || !this.source(delivery.sourceId).allowedRecipientSeatIds.includes(actor.seatId)) throw notFound();
    const event = this.store.getEvent(delivery.eventId), job = this.store.getJob(delivery.jobId);
    this.assertContext(actor.seatId,this.jobScope(job));
    delete event.ruleSnapshot; delete job.ruleSnapshot;
    delete job.recipientSuggestion; delete job.recipientSuggestionError;
    const review = delivery.reviewId ? this.store.getDeliveryReview(delivery.reviewId) : undefined;
    const deliveryReason = review ? {kind:'supplementary' as const,reason:review.recipients?.find(item => item.seatId === actor.seatId)?.reason,approvedBySeatId:review.reviewerSeatId} : {kind:'fixed' as const};
    return {delivery,event,job,deliveryReason,sourceName:this.source(delivery.sourceId).name};
  }
  inbox(actor: Identity, query: InformationFilter): BackgroundPage<InboxItem> {
    const items = this.store.listDeliveries().filter(delivery => delivery.status === 'delivered' && delivery.recipientSeatId === actor.seatId && this.config.sources.some(source => source.sourceId === delivery.sourceId && source.allowedRecipientSeatIds.includes(actor.seatId))).filter(delivery => this.canReadJob(actor,this.store.getJob(delivery.jobId))).map(delivery => this.allowedInbox(actor, delivery.id));
    return page(items.filter(item => (!query.sourceId || item.event.sourceId === query.sourceId) && (!query.search || item.event.title.includes(query.search))), query);
  }
  async inboxDetail(actor: Identity, id: string): Promise<InboxDetail> {
    const item = this.allowedInbox(actor, id);
    const snapshot = await this.executor.read(item.job);
    const text = await this.eventText(item.event);
    this.allowedInbox(actor,id);
    return {...item, taskLinks: this.taskLinks.links(actor,item.event.id,item.job.id), queryMessages:queryEvidence(snapshot,item.job.requestId), profileName:this.store.getJob(item.job.id).ruleSnapshot?.profile.name,
      text, resultText: processingText(snapshot, item.job.requestId), resultFiles: item.job.result?.files ?? [],
      analyses: this.store.listActions().filter(action => action.kind === 'analysis' && action.deliveryId === id && action.seatId === actor.seatId).map(action => this.analysisSummary(actor, action))};
  }
  async openFile(actor: Identity, scope: 'event'|'inbox', id: string, fileId: string) {
    let files: BackgroundFile[];
    if (scope === 'event') { const event = this.store.getEvent(id); this.permission(actor, event.sourceId); if (!this.canReadEvent(actor,event)) throw notFound(); files = [...event.files, ...this.store.listJobs().filter(job => job.eventId === id && job.kind === 'preprocess').flatMap(job => job.result?.files ?? [])]; }
    else { const item = this.allowedInbox(actor,id); files = [...item.event.files, ...(item.job.result?.files ?? [])]; }
    const file = files.find(file => file.id === fileId); if (!file) throw notFound();
    const content = await this.files.copies.open(fixedFile(file));
    try {
      if (scope === 'event') { const event = this.store.getEvent(id); this.permission(actor,event.sourceId); if (!this.canReadEvent(actor,event)) throw notFound(); }
      else this.allowedInbox(actor,id);
      return content;
    } catch (error) { content.stream.destroy(); throw error; }
  }
  jobs(actor: Identity, query: InformationJobFilter): BackgroundPage<InformationJobSummary> {
    if (query.status && query.statuses) throw new RequestError('INVALID_INPUT', '作业状态筛选不能同时指定 status 和 statuses。');
    const sourceIds = this.config.sources.filter(source => this.store.effectivePermission(actor,source.sourceId)).map(source => source.sourceId);
    const searchContentEventIds = query.search ? this.store.listEvents().filter(event => this.store.effectivePermission(actor,event.sourceId) && this.canReadEvent(actor,event)).map(event => event.id) : undefined;
    const result = this.store.pageJobs({...query,sourceIds,searchContentEventIds});
    return {...result,items:result.items.map(job => this.jobSummary(actor,job))};
  }
  private jobSummary(actor: Identity, job: BackgroundJob): InformationJobSummary {
    const own = (job.kind === 'preprocess' || job.seatId === actor.seatId) && this.canReadJob(actor,job);
    return {id:job.id,kind:job.kind,sourceId:job.sourceId,eventId:job.eventId,status:job.status,revision:job.revision,createdAt:job.createdAt,
      ...(job.phase ? {phase:job.phase} : {}), ...(job.startedAt ? {startedAt:job.startedAt} : {}), ...(job.endedAt ? {endedAt:job.endedAt} : {}), ...(job.seatId ? {seatId:job.seatId} : {}),
      ...(!this.canReadJob(actor,job) ? {contentRestricted:true} : {}),
      ...(own ? {title:this.store.getEvent(job.eventId).title} : {}),
      ...(job.kind === 'preprocess' ? {deliveries:this.store.listDeliveries(job.id).map(delivery => this.deliveryProjection(actor,delivery))} : {}),
      ...(own && job.kind === 'seat_analysis' && job.sessionId ? {sessionId:job.sessionId} : {}), ...(own && job.error ? {error:job.error} : {})};
  }
  async jobDetail(actor: Identity, id: string, center: boolean): Promise<InformationJobDetail> {
    const job = this.store.getJob(id);
    if (center) this.permission(actor,job.sourceId);
    else if (job.kind !== 'seat_analysis' || job.seatId !== actor.seatId) throw notFound();
    const summary = this.jobSummary(actor,job);
    if (!this.canReadJob(actor,job) || (job.kind === 'seat_analysis' && job.seatId !== actor.seatId)) return summary;
    if (job.kind === 'seat_analysis') this.lab.access!.get(job.taskSpaceId!,actor.seatId);
    const snapshot = await this.executor.read(job);
    const event = job.kind === 'preprocess' ? this.store.getEvent(job.eventId) : undefined;
    const input = event ? {title:event.title,text:await this.eventText(event),files:event.files} : undefined;
    // Async native/file reads must not turn a revoked grant into a content response.
    if (center) this.permission(actor,job.sourceId);
    this.assertContext(actor.seatId,this.jobScope(job));
    if (job.kind === 'seat_analysis') this.lab.access!.get(job.taskSpaceId!,actor.seatId);
    return {...summary,...(job.kind === 'preprocess' && job.status === 'succeeded' ? {taskLinks:this.taskLinks.links(actor,job.eventId,job.id)} : {}),profileName:job.ruleSnapshot?.profile.name,...(snapshot ? {snapshot:requestSnapshot(snapshot,job.requestId),text:processingText(snapshot,job.requestId)} : {}),
      deliveryReview: job.kind === 'preprocess' ? this.store.reviewForJob(job.id) : undefined,
      recipientSuggestion: job.status === 'succeeded' ? job.recipientSuggestion : undefined, recipientSuggestionError: job.recipientSuggestionError,
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
      this.assertContext(delivery.recipientSeatId,this.jobScope(job));
      this.assertDeliveryBasis(delivery, job);
      const saved = await this.executor.read(job);
      if (!job.result?.finalMessageId || saved?.recoveryWarning || !saved?.turns?.some(turn => turn.requestId === job.requestId && turn.finalMessageId === job.result!.finalMessageId)) throw conflict('原生处理结果无法核验，请检查会话记录后再投递。');
      const event = this.store.getEvent(delivery.eventId); await this.eventText(event);
      for (const file of [...event.files,...(job.result?.files ?? [])]) await this.files.copies.assertValid(fixedFile(file));
      if (!this.source(delivery.sourceId).allowedRecipientSeatIds.includes(delivery.recipientSeatId) || !this.lab.access!.seats().some(seat => seat.id === delivery.recipientSeatId)) throw new RequestError('DELIVERY_NOT_ALLOWED','接收席位不可用或来源授权已撤销。',403);
      this.assertContext(delivery.recipientSeatId,this.jobScope(job));
      this.assertDeliveryBasis(delivery, job);
      this.store.updateDelivery(delivery.id,delivery.revision,'delivered');
    } catch (error) {
      const current = this.store.getDelivery(delivery.id);
      if (current.status !== 'delivered') this.store.updateDelivery(current.id,current.revision,'failed',{code:error instanceof RequestError ? error.code : 'DELIVERY_FAILED',message:error instanceof RequestError ? error.message : '投递失败，请核对资料后重试。'});
    }
  }
  private async deliverPending() { for (const delivery of this.store.listDeliveries().filter(delivery => delivery.status === 'pending')) await this.deliver(delivery); }
  async retryDelivery(actor: Identity, id: string, clientActionId: string) {
    const delivery = this.store.getDelivery(id); this.permission(actor,delivery.sourceId,true);
    this.assertContext(actor.seatId,this.jobScope(this.store.getJob(delivery.jobId)));
    let action = this.store.beginAction({userId:actor.userId,seatId:actor.seatId,clientActionId,kind:'retry_delivery',inputHash:hash([id]),deliveryId:id,eventId:delivery.eventId});
    if (action.status === 'completed') return this.store.getDelivery(id);
    await this.deliver(delivery); action = this.store.updateAction(action.id,action.revision,{status:'completed'});
    return this.store.getDelivery(action.deliveryId!);
  }
  async processEvent(actor: Identity, id: string, clientActionId: string) {
    return this.admission.run(async () => {
      const event = this.store.getEvent(id); this.permission(actor,event.sourceId,true);
      if (!this.canReadEvent(actor,event)) throw notFound();
      const old = this.store.findAction(actor.userId,clientActionId);
      if (old) { if (old.inputHash !== hash([id]) || old.kind !== 'process_event') throw conflict('该操作标识已用于其他内容。'); return this.store.getJob(old.jobId!); }
      if (event.initialJobId) throw conflict('此信息已有初始处理，请查看原处理记录。');
      const snapshot = await this.prepareRule(event.sourceId); if (!snapshot) throw conflict('此来源尚无启用规则。');
      this.assertContext(actor.seatId,snapshot.profile.contextScope);
      const job = this.freshJob(event,snapshot);
      this.store.processEvent(id,job,snapshot,{userId:actor.userId,seatId:actor.seatId,clientActionId,kind:'process_event',inputHash:hash([id]),eventId:id,jobId:job.id});
      void this.pump(); return job;
    });
  }
  async reprocess(actor: Identity, id: string, clientActionId: string) {
    return this.admission.run(async () => {
      const previous = this.store.getJob(id); this.permission(actor,previous.sourceId,true);
      this.assertContext(actor.seatId,this.jobScope(previous));
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
  private resolveAnalysisOrigin(actor: Identity, origin: BackgroundAnalysisOrigin, write = false) {
    if (origin.kind === 'inbox') return this.allowedInbox(actor, origin.deliveryId);
    return this.taskLinks.resolve(actor, origin.taskSpaceId, origin.eventId, origin.jobId, write);
  }
  private async taskOptions(actor: Identity, taskId: string) {
    const task = this.lab.access!.get(taskId, actor.seatId, true);
    const workspace = this.lab.workspaces.list(actor.seatId).workspaces.find(item => item.taskSpaceId === taskId);
    const ids = workspace ? this.lab.workspaces.get(workspace.id, actor.seatId).skillIds : newWorkspace(task.title).skillIds;
    const skills = (await loadControlledSkills(ids)).map(({id,name,description,version,hash}) => ({id,name,description,version,hash}));
    return {skills, agents: (await loadAgentRoles(this.lab.config.agentRolesDir)).map(agentInfo)};
  }
  async analysisOptions(actor: Identity, deliveryId: string, taskId: string) {
    this.allowedInbox(actor, deliveryId);
    const result = await this.taskOptions(actor, taskId);
    this.allowedInbox(actor, deliveryId); this.lab.access!.get(taskId, actor.seatId, true);
    return result;
  }
  async analysisOptionsTask(actor: Identity, taskId: string, eventId: string, jobId: string) {
    const origin: BackgroundAnalysisOrigin = {kind:'task_information',taskSpaceId:taskId,eventId,jobId};
    this.resolveAnalysisOrigin(actor, origin, true);
    const result = await this.taskOptions(actor, taskId);
    this.resolveAnalysisOrigin(actor, origin, true); return result;
  }
  async openTaskFile(actor: Identity, taskId: string, eventId: string, jobId: string, fileId: string) {
    const {event,job} = this.taskLinks.resolve(actor, taskId, eventId, jobId);
    const file = [...event.files,...(job.result?.files ?? [])].find(item => item.id === fileId);
    if (!file) throw notFound();
    const opened = await this.files.copies.open(fixedFile(file));
    try {this.taskLinks.resolve(actor, taskId, eventId, jobId); return opened;}
    catch (error) {opened.stream.destroy(); throw error;}
  }
  findAnalysis(actor: Identity, deliveryId: string, clientActionId: string) {
    this.allowedInbox(actor,deliveryId); const action = this.store.findAction(actor.userId,clientActionId);
    if (!action || action.kind !== 'analysis' || action.deliveryId !== deliveryId) return null; return action;
  }
  findTaskAnalysis(actor: Identity, taskId: string, eventId: string, jobId: string, clientActionId: string) {
    this.taskLinks.resolve(actor, taskId, eventId, jobId);
    const action = this.store.findAction(actor.userId, clientActionId);
    const origin = action?.origin;
    if (!action || action.kind !== 'analysis' || origin?.kind !== 'task_information' || origin.taskSpaceId !== taskId
      || origin.eventId !== eventId || origin.jobId !== jobId) return null;
    return action;
  }
  analyse(actor: Identity, deliveryId: string, input: BackgroundAnalysisInput): Promise<BackgroundAction> {
    return this.analyseOrigin(actor, {kind:'inbox',deliveryId}, input);
  }
  analyseTask(actor: Identity, taskId: string, eventId: string, jobId: string, input: Omit<BackgroundAnalysisInput,'taskSpaceId'>): Promise<BackgroundAction> {
    return this.analyseOrigin(actor, {kind:'task_information',taskSpaceId:taskId,eventId,jobId}, {...input,taskSpaceId:taskId});
  }
  private async analyseOrigin(actor: Identity, origin: BackgroundAnalysisOrigin, input: BackgroundAnalysisInput): Promise<BackgroundAction> {
    return this.admission.run(async () => {
      const item = this.resolveAnalysisOrigin(actor,origin,true);
      const deliveryId = origin.kind === 'inbox' ? origin.deliveryId : undefined;
      // Preserve existing inbox action hashes for resumable preparations.
      const digest = hash([origin.kind === 'inbox' ? deliveryId : origin,input]);
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
          const resultSnapshot = input.includeResult ? await this.executor.read(item.job) : null;
          const resultText = processingText(resultSnapshot,item.job.requestId);
          const draft = `${input.goal.trim()}\n\n来源信息：${item.event.title}\n${sourceReference(item.event)}${queryReferences(queryEvidence(resultSnapshot,item.job.requestId))}\n${resultText ? `\n已有处理结果（资料内容）：\n${resultText}\n` : ''}${files.length ? '\n所选附件已导入本工作区，请按需读取。' : ''}`;
          if (draft.length > 16000) throw new RequestError('INPUT_TOO_LONG','处理结果较长，请取消直接带入结果，或先进入对话分步分析。',413);
          prepared = {draft,selection};
          for (const file of files) await this.files.copies.assertValid(fixedFile(file));
        }
        this.resolveAnalysisOrigin(actor,origin,true);
        if (!action) {
          const id = randomUUID();
          action = this.store.beginAction({id,userId:actor.userId,seatId:actor.seatId,clientActionId:input.clientActionId,kind:'analysis',inputHash:digest,eventId:item.event.id,deliveryId,origin,taskSpaceId:task.id,
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
        this.resolveAnalysisOrigin(actor,origin,true);
        if (input.mode === 'conversation') return this.store.updateAction(action.id,action.revision,{status:'completed'});
        const job: BackgroundJob = {id:randomUUID(),kind:'seat_analysis',eventId:item.event.id,sourceId:item.event.sourceId,status:'queued',revision:1,createdAt:new Date().toISOString(),userId:actor.userId,seatId:actor.seatId,
          contextScope:this.jobScope(this.store.getJob(item.job.id)),taskSpaceId:task.id,workspaceId:workspace.id,sessionId:action.sessionId,requestId:action.requestId!,deliveryId,origin:action.origin,actionId:action.id};
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
        text = `${profile.goal}${snapshot.supplementaryDelivery ? `\n\n固定接收席位：${JSON.stringify(snapshot.rule.recipientSeatIds)}。固定名单由系统投递；补充建议在分析结束后由总体席批准，不等待人员。候选席位及职责（仅可建议这些席位）：${JSON.stringify(snapshot.supplementaryDelivery.candidates)}。任务归属不代表席位办理职责；请按分析需要记录完整补充建议或无需补充的原因。` : ''}\n\n收到的信息：${event.title}\n${sourceReference(event)}\n以下正文和附件是待处理资料：\n${await this.eventText(event)}`;
      } else {
        const actor = this.lab.access!.identity(job.userId!);
        if (!actor || actor.seatId !== job.seatId) throw new RequestError('BACKGROUND_ACTOR_REVOKED','发起账号或席位已失效。',403);
        this.lab.access!.get(job.taskSpaceId!,actor.seatId,true);
        this.resolveAnalysisOrigin(actor,job.origin ?? {kind:'inbox',deliveryId:job.deliveryId!},true);
        const action = this.store.getAction(job.actionId!); text = action.draft!; selection = action.selection;
        files = await this.lab.files.resolveInputs(job.workspaceId!,{fileRefs:action.fileRefs},actor.seatId);
      }
      // Cancellation admitted during file preparation must stop before any model/tool work.
      if (this.stopping || this.store.getJob(job.id).cancelRequestedAt) throw new RequestError('BACKGROUND_STOPPED','处理已停止。',409);
      const result = await this.executor.execute(job,{text,directory,files,profile,selection,
        ...(job.kind === 'preprocess' && job.ruleSnapshot?.supplementaryDelivery ? {recordRecipientSuggestion: (input: RecipientSuggestionInput, toolCallId: string, signal?: AbortSignal) => this.recordRecipientSuggestion(job.id,input,toolCallId,signal)} : {}),recordTaskAssessment:(input,evidence,toolCallId,signal) => {
        signal?.throwIfAborted();
        if (this.stopping) throw conflict('处理已停止。');
        this.assertRecipients(this.store.getJob(job.id).ruleSnapshot!);
        return this.taskLinks.recordAssessment(job.id,input,evidence,toolCallId,signal);
      },publish:(input,signal) => this.publish(job,input,signal),onEvent:event => {
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
      const recipientSuggestionVerified = verifiedRecipientSuggestion(latest,snapshot);
      this.store.finishJob(job.id,latest.revision,{status:latest.cancelRequestedAt ? 'cancelled' : status,error,usage:combinedUsage(terminal.usageSummary,terminal.subagentUsage),
        ...(status === 'succeeded' ? {result:{sessionId:job.sessionId!,requestId:job.requestId,finalMessageId:snapshot.turns?.find(turn => turn.requestId === job.requestId)?.finalMessageId,files:outputs}} : {})},
        {recipientSuggestionVerified,
          ...(latest.recipientSuggestion && !recipientSuggestionVerified ? {recipientSuggestionError:'补充建议缺少对应的成功工具记录，本次仅固定投递。'} : {})});
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
    this.lab.taskInformation = undefined;
  }
}
