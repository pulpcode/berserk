import { randomUUID } from 'node:crypto';
import type { CapabilityManagement } from '../capabilities/management.js';
import type { SkillService } from '../skills/service.js';
import type { SkillActor, SkillFileInput } from '../contracts/skills.js';
import type { ExpertDraftContent } from '../contracts/capability-management.js';
import type { ExpertTrialRecord } from '../contracts/capability-management.js';
import type { AuthoringIntent, AuthoringProposal, AuthoringProposeInput, AuthoringCandidate, AuthoringBaseline } from '../contracts/authoring.js';
import { RequestError } from '../contracts/errors.js';
import { methodFiles } from './method-files.js';
import { replaceMethodBody } from './method-body.js';
import { proposalDigest, type AuthoringGrant } from './integrity.js';

export interface AuthoringContext {
  actor: SkillActor;
  sessionId: string;
  requestId: string;
  assertActive: () => void;
}
const invalid = (message = '创作参数无效。') => new RequestError('INVALID_INPUT', message);
const conflict = (message = '目标或草稿已变化，请重新读取并提出候选。') => new RequestError('AUTHORING_CONFLICT', message, 409);
const strict = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const scope = (context: AuthoringContext) => JSON.stringify([context.actor.userId, context.sessionId, context.requestId]);
const target = (input: AuthoringIntent) => `${input.kind}:${input.targetId ?? 'new'}`;

/** No background jobs or alternate asset storage: proposals exist only in the current native request. */
export class AuthoringService {
  private readonly proposals = new Map<string, AuthoringProposal>();
  private readonly selected = new Map<string, string>();
  private readonly latest = new Map<string, string>();
  constructor(private readonly management: CapabilityManagement, private readonly skills: SkillService) {}
  /** Original SkillTrials owns authorization and private trial storage. */
  readSkillTrial?: (context: AuthoringContext, input: {targetId:string;reportId:string}) => Promise<ExpertTrialRecord>;
  private auth(context: AuthoringContext) {
    context.assertActive(); context.actor.assertAdministrator();
    if (!context.actor.userId || !context.sessionId || !context.requestId) throw invalid();
  }
  private select(context: AuthoringContext, input: AuthoringIntent) {
    const key = scope(context), next = target(input);
    if (this.selected.get(key) !== next) { this.selected.set(key, next); this.latest.delete(key); }
  }
  release(context: AuthoringContext) {
    const key = scope(context);
    for (const [id, value] of this.proposals) if (value.ownerUserId === context.actor.userId && value.sessionId === context.sessionId && value.requestId === context.requestId) this.proposals.delete(id);
    this.selected.delete(key); this.latest.delete(key);
  }
  async catalog(context: AuthoringContext) {
    this.auth(context);
    const experts = (await this.management.list()).map(item => ({ expertId: item.expertId, name: item.name, description: item.description, source: item.source, archived: item.archived }));
    this.auth(context);
    return { ...this.management.catalog(), experts, skillAssets: this.skills.list() };
  }
  async read(context: AuthoringContext, input: { kind: 'expert' | 'skill'; targetId: string }) {
    this.auth(context);
    if (!strict(input, ['kind', 'targetId']) || !['expert', 'skill'].includes(input.kind) || typeof input.targetId !== 'string' || !input.targetId) throw invalid();
    this.select(context, input);
    if (input.kind === 'expert') {
      const detail = await this.management.get(input.targetId); this.auth(context);
      const content = detail.draft?.content ?? (detail.current ? { name: detail.current.name, description: detail.current.description, instructions: detail.current.instructions, allowedTools: detail.current.allowedTools ?? [], skillIds: detail.current.skills.filter(s => s.schemaVersion !== 2).map(s => s.id), skillRefs: detail.current.skills.filter(s => s.schemaVersion === 2).map(s => ({ skillId: s.id, revisionId: s.revisionId, packageDigest: s.packageDigest! })) } : undefined);
      return { kind: input.kind, targetId: input.targetId, readonly: !detail.draft || detail.expert.archived,
        ...(detail.draft ? { baseline: { draftRevision: detail.draft.draftRevision, digest: detail.draft.draftDigest } } : {}),
        candidate: content ? { kind: 'expert' as const, content } : undefined,
        reports: { validations: detail.validations, trials: detail.trials.filter(trial => trial.ownerId === context.actor.userId), publications: detail.publications } };
    }
    const detail = this.skills.detail(input.targetId); this.auth(context);
    const draft = detail.draft;
    return { kind: input.kind, targetId: input.targetId, readonly: detail.skill.system || detail.skill.archived,
      ...(draft ? { baseline: { draftRevision: draft.draftRevision, digest: draft.packageDigest }, candidate: { kind: 'skill' as const, files: draft.files, requirements: draft.requirements } } : {}),
      reports: { validation: detail.validation, scans: detail.scans, publications: detail.publications } };
  }
  async propose(context: AuthoringContext, input: AuthoringProposeInput): Promise<AuthoringProposal> {
    this.auth(context); input = structuredClone(input);
    if (!strict(input, ['kind', 'targetId', 'baseline', 'content', 'files', 'methodBody', 'removePaths', 'summary']) || !['expert', 'skill'].includes(input.kind)
      || typeof input.summary !== 'string' || !input.summary.trim() || input.summary.length > 4000
      || input.targetId !== undefined && (typeof input.targetId !== 'string' || !input.targetId)
      || !!input.targetId !== !!input.baseline) throw invalid();
    if (input.baseline && (!strict(input.baseline, ['draftRevision', 'digest']) || !Number.isSafeInteger(input.baseline.draftRevision) || input.baseline.draftRevision < 1 || !/^[a-f0-9]{64}$/.test(input.baseline.digest))) throw invalid();
    const saved = input.targetId ? await this.read(context, { kind: input.kind, targetId: input.targetId }) : undefined;
    this.auth(context);
    if (saved && (saved.readonly || !saved.baseline || saved.baseline.draftRevision !== input.baseline!.draftRevision || saved.baseline.digest !== input.baseline!.digest)) throw conflict();
    this.select(context, input);
    const before = saved?.candidate as AuthoringCandidate | undefined;
    let candidate: AuthoringCandidate;
    if (input.kind === 'expert') {
      if (input.files !== undefined || input.methodBody !== undefined || input.removePaths !== undefined || !strict(input.content, ['name', 'description', 'instructions', 'skillIds', 'skillRefs', 'allowedTools'])) throw invalid();
      const content = await this.management.prepareAuthoringContent(context.actor, { ...(before?.kind === 'expert' ? before.content : {}), ...input.content } as ExpertDraftContent);
      candidate = { kind: 'expert', content };
    } else {
      const patches = input.files ?? [];
      if (input.content !== undefined || input.files === undefined && input.methodBody === undefined || input.files !== undefined && !Array.isArray(input.files) || !Array.isArray(patches) || patches.some(file => !strict(file, ['path', 'contentBase64'])) || new Set(patches.map(f => f.path)).size !== patches.length
        || input.methodBody !== undefined && (typeof input.methodBody !== 'string' || !input.targetId || patches.some(file => file.path === 'SKILL.md') || Array.isArray(input.removePaths) && input.removePaths.includes('SKILL.md'))
        || input.removePaths !== undefined && (!Array.isArray(input.removePaths) || input.removePaths.some(path => typeof path !== 'string') || new Set(input.removePaths).size !== input.removePaths.length)) throw invalid();
      if (before?.kind === 'skill') methodFiles(before.files, before.requirements);
      const original = before?.kind === 'skill' ? before.files : [];
      const files = new Map<string, SkillFileInput>(original.map(file => [file.path, { path: file.path, contentBase64: file.contentBase64 }]));
      for (const path of input.removePaths ?? []) { if (!files.has(path) || patches.some(file => file.path === path)) throw invalid('删除清单包含不存在的文件或与修改冲突。'); files.delete(path); }
      for (const file of patches) files.set(file.path, structuredClone(file));
      if (input.methodBody !== undefined) {
        const method = files.get('SKILL.md'); if (!method) throw invalid('正文修改需要已有SKILL.md。');
        files.set('SKILL.md', replaceMethodBody(method, input.methodBody));
      }
      const requirements = before?.kind === 'skill' ? before.requirements : {};
      const fullFiles = [...files.values()]; methodFiles(fullFiles, requirements);
      candidate = { kind: 'skill', files: fullFiles, requirements };
    }
    this.auth(context);
    const value: Omit<AuthoringProposal, 'proposalDigest'> = { schemaVersion: 1, proposalId: randomUUID(), ownerUserId: context.actor.userId, sessionId: context.sessionId, requestId: context.requestId,
      ...(input.targetId ? { targetId: input.targetId, baseline: structuredClone(input.baseline!) } : {}), candidate, ...(before ? { before: structuredClone(before) } : {}), summary: input.summary, createdAt: new Date().toISOString() };
    const proposal = { ...value, proposalDigest: proposalDigest(value) };
    this.proposals.set(proposal.proposalId, proposal); this.latest.set(scope(context), proposal.proposalId);
    return structuredClone(proposal);
  }
  getProposal(context: AuthoringContext, proposalId: string): AuthoringProposal {
    this.auth(context); const value = this.proposals.get(proposalId);
    if (!value || value.ownerUserId !== context.actor.userId || value.sessionId !== context.sessionId || value.requestId !== context.requestId) throw new RequestError('AUTHORING_NOT_FOUND', '本次请求中没有这个候选，请重新提出保存。', 404);
    if (this.latest.get(scope(context)) !== proposalId || this.selected.get(scope(context)) !== target({ kind: value.candidate.kind, targetId: value.targetId })) throw conflict('已切换目标或候选，请核对当前内容后重新请求保存。');
    return structuredClone(value);
  }
  async commit(context: AuthoringContext, proposalId: string, grant: AuthoringGrant) {
    const value = this.getProposal(context, proposalId); this.auth(context);
    const result = value.candidate.kind === 'expert' ? await this.management.saveAuthoring(context.actor, value, { ...grant, assertAuthorized: () => this.auth(context) }) : await this.skills.saveAuthoring(context.actor, value, { ...grant, assertAuthorized: () => this.auth(context) });
    // A committed effect remains true even if authorization was revoked after the transaction.
    return result;
  }
  receipt(context: AuthoringContext, input: { kind: 'expert' | 'skill'; proposalId: string }) {
    this.auth(context);
    if (!strict(input, ['kind', 'proposalId']) || !['expert', 'skill'].includes(input.kind) || typeof input.proposalId !== 'string') throw invalid();
    const value = input.kind === 'expert' ? this.management.authoringReceipt(context.actor, input.proposalId) : this.skills.authoringReceipt(context.actor, input.proposalId);
    if (value && (value.ownerUserId !== context.actor.userId || value.sessionId !== context.sessionId)) throw new RequestError('AUTHORING_NOT_FOUND', '该保存回执不属于当前对话。', 404);
    return value;
  }
  async report(context: AuthoringContext, input: { kind: 'expert' | 'skill'; targetId: string; reportId: string }) {
    this.auth(context);
    if (!strict(input, ['kind', 'targetId', 'reportId']) || typeof input.reportId !== 'string') throw invalid();
    const detail = await this.read(context, { kind: input.kind, targetId: input.targetId });
    const reports = detail.reports;
    const found = 'validations' in reports ? [...(reports.validations ?? []), ...(reports.trials ?? [])].find(item => 'validationId' in item && item.validationId === input.reportId || 'trialId' in item && item.trialId === input.reportId)
      : reports.scans.find(item => item.scanId === input.reportId) ?? (reports.validation?.packageDigest === input.reportId ? reports.validation : undefined);
    const report = found ?? (input.kind === 'skill' && this.readSkillTrial ? await this.readSkillTrial(context, input) : undefined);
    this.auth(context);
    if (!report) throw new RequestError('AUTHORING_REPORT_NOT_FOUND', '报告不存在或不属于当前可访问内容。', 404);
    return { kind: input.kind, targetId: input.targetId, currentBaseline: detail.baseline as AuthoringBaseline | undefined, report };
  }
}
