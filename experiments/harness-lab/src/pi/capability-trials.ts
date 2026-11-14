import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { Readable } from 'node:stream';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { ExpertRevision } from '../contracts/capabilities.js';
import type { ExpertTrialRecord, ManagementActor } from '../contracts/capability-management.js';
import type { ExpertTrialFile, ExpertTrialRunView } from '../contracts/capability-trials.js';
import type { SessionSnapshot, StreamEvent } from '../contracts/index.js';
import { RequestError } from '../contracts/errors.js';
import type { LabConfig } from '../server/config.js';
import { atomicWrite, checkDirectory, parseJsonStrict, readControlled, stateError } from '../resources/files.js';
import { UUID, WorkspaceStore } from '../workspaces/store.js';
import { FileService } from '../files/service.js';
import type { DockerExecutionService } from '../execution/docker.js';
import { PiLab } from './lab.js';
import { syntheticTrialTools, syntheticTrialToolNames, excludedTrialWriteTools } from './trial-tools.js';
import { openStrictSession } from './compaction-history.js';
import { publicToolName } from './resource-tools.js';
import { decodeExecutionManifest, EXECUTION_MANIFEST } from './capability-history.js';

const runtimeName = 'axon/pi-0.85.1';
const fileTools = new Set(['read', 'ls', 'find', 'grep', 'bash', 'write', 'edit', 'file_output']);
const trialTools = new Set([...excludedTrialWriteTools, ...syntheticTrialToolNames, ...fileTools, 'source_list', 'source_read', 'instructions_read', 'instructions_update', 'skill_read', 'subagent', 'ask_user']);
const unavailable = (message: string) => new RequestError('EXPERT_TRIAL_UNAVAILABLE', message, 409);
const notFound = () => new RequestError('EXPERT_TRIAL_NOT_FOUND', '试用不存在或无权访问。', 404);
interface StoredTrial {
  schemaVersion: 1; trial: ExpertTrialRecord; expert: ExpertRevision; sampleDigest: string; snapshot?: SessionSnapshot;
  calls: ExpertTrialRunView['calls']; environment: ExpertTrialRunView['environment'];
}
interface LiveTrial {
  lab?: PiLab; promise: Promise<void>; checkpoints: Promise<void>; lastCheckpoint?: number; stop?: 'cancelled' | 'interrupted' | 'revoked'; requestId?: string; sessionId?: string;
}
export interface CapabilityTrialsOptions {
  dataDir: string;
  /** Only selected model credentials stay in memory; never copy business config. */
  modelConfig: () => LabConfig;
  /** Require current administrator and matching owner on every access. */
  authorize: (actor: ManagementActor, trial: ExpertTrialRecord) => void;
  onUpdate?: (actor: ManagementActor, trial: ExpertTrialRecord) => void | Promise<void>;
  runtimeFactory?: (config: LabConfig) => Promise<ModelRuntime>;
  executionFactory?: (config: LabConfig) => DockerExecutionService;
  authorizationPollMs?: number;
}
/** Per-trial PiLab data/index. The existing Pi execution loop remains the only model/tool loop. */
export class CapabilityTrials {
  private readonly records = new Map<string, StoredTrial>();
  private readonly live = new Map<string, LiveTrial>();
  private readonly starting = new Map<string, Promise<ExpertTrialRunView>>();
  private closed = false;
  private constructor(private readonly options: CapabilityTrialsOptions, private readonly directory: string) {}
  static async open(options: CapabilityTrialsOptions): Promise<CapabilityTrials> {
    if (!isAbsolute(options.dataDir)) throw stateError();
    const directory = join(options.dataDir, 'capability-trials');
    await mkdir(directory, { recursive: true, mode: 0o700 }); await checkDirectory(directory);
    const service = new CapabilityTrials(options, directory);
    for (const id of await readdir(directory)) {
      if (!UUID.test(id)) throw stateError(); await checkDirectory(join(directory, id));
      const raw = await readControlled(join(directory, id, 'record.json'), 16 * 1024 * 1024, true); if (!raw) throw stateError();
      const r = parseJsonStrict(raw) as StoredTrial;
      if (r.schemaVersion !== 1 || r.trial?.trialId !== id || !r.trial.ownerId || !r.expert?.digest || !Array.isArray(r.calls)
        || !['prepared', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'].includes(r.trial.status)
        || r.environment?.sources !== 'synthetic-fixtures') throw stateError();
      if (r.trial.status === 'running' || r.trial.status === 'prepared') {
        r.trial.status = 'interrupted'; r.trial.completedAt = new Date().toISOString();
        r.trial.evidence = { tools: [], model: r.environment.model, runtime: runtimeName, fileEnvironmentVerified: false,
          success: false, summary: '服务重启，试用已中断；不会自动重新执行。', unverified: ['interrupted'] };
        if (r.snapshot) r.snapshot.active = null; await service.save(r);
        try { await options.onUpdate?.({userId:r.trial.ownerId},structuredClone(r.trial)); } catch { /* Preserve runtime evidence for the next authorized reconciliation. */ }
      }
      service.records.set(id, r);
    }
    return service;
  }
  private path(id: string) { if (!UUID.test(id)) throw notFound(); return join(this.directory, id); }
  private save(r: StoredTrial) { return atomicWrite(join(this.path(r.trial.trialId), 'record.json'), JSON.stringify(r)); }
  private require(actor: ManagementActor, id: string) {
    if (this.closed) throw unavailable('试用服务已关闭。');
    const r = this.records.get(id); if (!r || r.trial.ownerId !== actor.userId) throw notFound();
    this.options.authorize(actor, r.trial); return r;
  }
  private view(r: StoredTrial): ExpertTrialRunView {
    const active = this.live.get(r.trial.trialId);
    const snapshot = active?.lab && active.sessionId ? active.lab.get(active.sessionId) : r.snapshot;
    return structuredClone({ trial: r.trial, ...(snapshot ? { snapshot } : {}), calls: r.calls, environment: r.environment });
  }
  get(actor: ManagementActor, id: string) { return this.view(this.require(actor, id)); }
  private async update(actor: ManagementActor, r: StoredTrial) {
    await this.save(r);
    // Runtime truth persists even if the owner loses permission to update management metadata.
    try { await this.options.onUpdate?.(actor, structuredClone(r.trial)); } catch { /* Reconcile on next authorized read. */ }
  }
  async start(actor: ManagementActor, input: { trial: ExpertTrialRecord; expert: ExpertRevision }, files: ExpertTrialFile[] = []): Promise<ExpertTrialRunView> {
    const prior = this.starting.get(input.trial.trialId);
    if (prior) { await prior; return this.start(actor, input, files); }
    const pending = this.startOnce(actor, input, files); this.starting.set(input.trial.trialId, pending);
    try { return await pending; } finally { this.starting.delete(input.trial.trialId); }
  }
  private async startOnce(actor: ManagementActor, input: { trial: ExpertTrialRecord; expert: ExpertRevision }, files: ExpertTrialFile[]): Promise<ExpertTrialRunView> {
    if (this.closed) throw unavailable('试用服务已关闭。');
    const { trial, expert } = structuredClone(input);
    if (!UUID.test(trial.trialId) || trial.ownerId !== actor.userId || !['prepared', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'].includes(trial.status) || expert.expertId !== trial.expertId
      || !expert.modes.includes('interactive') || expert.allowedTools === null || !trial.input.trim() || trial.input.length > 32000) throw unavailable('试用快照无效，请重新校验草稿。');
    this.options.authorize(actor, trial);
    const sampleDigest = createHash('sha256').update(JSON.stringify(files)).digest('hex');
    const prior = this.records.get(trial.trialId);
    if (prior) {
      this.require(actor, trial.trialId);
      if (prior.trial.draftDigest !== trial.draftDigest || prior.trial.input !== trial.input || prior.expert.digest !== expert.digest || prior.sampleDigest !== sampleDigest) throw unavailable('同一试用标识不能用于不同内容。');
      return this.view(prior);
    }
    if (trial.status !== 'prepared') throw unavailable('没有可恢复的试用运行记录，不会自动重新执行。');
    if (!Array.isArray(files) || files.length > 8 || files.some(f => typeof f.name !== 'string' || typeof f.content !== 'string'
      || !f.name.trim() || f.name.includes('/') || f.name.includes('\\') || Array.from(f.name).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      || f.name === '.' || f.name === '..' || Buffer.byteLength(f.name) > 240 || Buffer.byteLength(f.content) > 1024 * 1024)
      || new Set(files.map(f => f.name)).size !== files.length) throw unavailable('请提供最多8个具名、各不超过1MiB的合成文本文件。');
    const selected = this.options.modelConfig();
    const r: StoredTrial = { schemaVersion: 1, trial: { ...trial, status: 'running' }, expert, sampleDigest, calls: [],
      environment: { sources: 'synthetic-fixtures', businessWrites: false, fileEnvironmentAvailable: false, model: `${selected.provider}/${selected.model}`, runtime: runtimeName } };
    await mkdir(this.path(trial.trialId), { mode: 0o700 }); this.records.set(trial.trialId, r); await this.save(r);
    const running: LiveTrial = { promise: Promise.resolve(), checkpoints: Promise.resolve() }; this.live.set(trial.trialId, running);
    running.promise = this.execute(actor, r, running, selected, structuredClone(files));
    void running.promise.catch(() => {}); return this.view(r);
  }
  private config(m: LabConfig, id: string, needsFiles: boolean): LabConfig {
    // Explicit allowlist: no production auth, seats, agent paths or data directory.
    return { provider: m.provider, model: m.model, baseUrl: m.baseUrl, apiKey: m.apiKey, thinkingMode: m.thinkingMode,
      contextWindow: m.contextWindow, maxOutputTokens: m.maxOutputTokens, compactionReserveTokens: m.compactionReserveTokens,
      compactionKeepRecentTokens: m.compactionKeepRecentTokens, contextSource: m.contextSource, outputSource: m.outputSource, contextReady: m.contextReady,
      dataDir: join(this.path(id), 'data'), seatId: 'trial-seat', port: 4310, listenHost: '127.0.0.1',
      agentRunTimeoutMs: m.agentRunTimeoutMs, httpIdleTimeoutMs: m.httpIdleTimeoutMs, llmRequestTimeoutMs: m.llmRequestTimeoutMs,
      hitlDemoEnabled: false, fileLimits: { maxFileBytes: 1024 * 1024, maxAttachments: 8 }, ...(needsFiles ? { execution: m.execution } : {}) };
  }
  private event(r: StoredTrial, event: StreamEvent) {
    if (event.type === 'tool.started') r.calls.push({ toolCallId: event.toolCallId, name: event.toolName, status: 'running' });
    if (event.type === 'tool.completed') {
      const call = r.calls.find(item => item.toolCallId === event.toolCallId);
      if (call) Object.assign(call, { status: 'completed', output: event.text, isError: event.isError });
    }
  }
  private async execute(actor: ManagementActor, r: StoredTrial, running: LiveTrial, selected: LabConfig, files: ExpertTrialFile[]) {
    const guard = () => {
      if (running.stop || this.closed) throw new RequestError('FORBIDDEN', '试用已停止或权限已失效。', 403);
      this.options.authorize(actor, r.trial);
    };
    const timer = setInterval(() => {
      try { guard(); } catch { if (!running.stop) running.stop = 'revoked'; this.stopLive(running); }
    }, this.options.authorizationPollMs ?? 100); timer.unref();
    let tools: string[] = [];
    try {
      guard();
      const unsupported = r.expert.allowedTools!.filter(tool => !trialTools.has(tool));
      if (unsupported.length) throw unavailable(`这些能力尚无隔离测试来源，不能调用正式业务：${unsupported.join('、')}`);
      const needsFiles = r.expert.allowedTools!.some(tool => fileTools.has(tool)); const config = this.config(selected, r.trial.trialId, needsFiles);
      const runtime = await this.options.runtimeFactory?.(config); guard();
      const execution = needsFiles ? this.options.executionFactory?.(config) : undefined;
      const lab = await PiLab.create(config, runtime, execution, { requestGuard: guard, executionMode: 'trial', skipManagement: true, extraTrialTools: syntheticTrialTools(r.expert.allowedTools!) }); running.lab = lab; guard();
      r.environment.fileEnvironmentAvailable = !!lab.info().files?.executionAvailable;
      if (needsFiles && !r.environment.fileEnvironmentAvailable) throw unavailable('试用需要文件执行环境，但受控Docker沙箱不可用。');
      const expert = await lab.capabilities.registerExpert({ expertId: r.expert.expertId, releaseVersion: r.expert.releaseVersion,
        name: r.expert.name, description: r.expert.description, instructions: r.expert.instructions, modes: r.expert.modes,
        selectable: r.expert.selectable, system: r.expert.system, allowedTools: r.expert.allowedTools, skills: r.expert.skills });
      if (expert.digest !== r.expert.digest) throw unavailable('试用快照摘要不一致。');
      const session = await lab.createSession(undefined, 'trial-seat', undefined, undefined, undefined,
        { expertRef: { expertId: expert.expertId, revisionId: expert.revisionId }, expectedDigest: expert.digest, clientActionId: randomUUID() });
      running.sessionId = session.id; r.snapshot = session; guard(); const uploadIds: string[] = [];
      for (const f of files) {
        const upload = await lab.files.createUpload(session.workspaceId, { name: f.name, size: Buffer.byteLength(f.content) }); guard();
        const uploaded = await lab.files.receiveUpload(session.workspaceId, upload.uploadId, Readable.from([Buffer.from(f.content)])); guard();
        if (uploaded.status !== 'completed') throw unavailable('试用样例文件未完成上传。'); uploadIds.push(upload.uploadId);
      }
      const request = lab.start(session.id, r.trial.input, { uploadIds }, 'trial-seat'); running.requestId = request.requestId; await this.update(actor, r);
      await request.run(event => {
        this.event(r, event);
        if (['interaction.updated', 'tool.completed', 'response.completed'].includes(event.type)
          || event.type === 'assistant.updated' && Date.now() - (running.lastCheckpoint ?? 0) >= 250) {
          running.lastCheckpoint = Date.now();
          r.snapshot = lab.get(session.id);
          const saved = JSON.stringify(r);
          running.checkpoints = running.checkpoints.then(() => atomicWrite(join(this.path(r.trial.trialId), 'record.json'), saved));
          void running.checkpoints.catch(() => {});
        }
      });
      await running.checkpoints; r.snapshot = lab.get(session.id);
      const directory = join(config.dataDir, 'sessions'); const name = (await readdir(directory)).find(name => name.endsWith(`_${session.id}.jsonl`));
      if (name) {
        const manager = await openStrictSession(join(directory, name), directory);
        const entry = manager.getBranch().find(e => e.type === 'custom' && e.customType === EXECUTION_MANIFEST);
        if (entry?.type === 'custom') tools = decodeExecutionManifest(entry.data, session.workspaceId, session.id).tools;
      }
      const excluded = r.expert.allowedTools!.filter(tool => excludedTrialWriteTools.includes(tool));
      const missing = r.expert.allowedTools!.filter(tool => !tools.includes(tool) && !excludedTrialWriteTools.includes(tool));
      const excludedAttempted = r.calls.some(call => excluded.some(tool => publicToolName(tool) === call.name));
      const success = r.snapshot.lastResult?.status === 'succeeded' && !running.stop && missing.length === 0 && !excludedAttempted;
      r.trial.status = running.stop === 'interrupted' ? 'interrupted' : running.stop === 'revoked' ? 'failed' : running.stop === 'cancelled' ? 'cancelled' : success ? 'succeeded' : 'failed';
      r.trial.evidence = { tools, model: r.environment.model, runtime: runtimeName, success,
        fileEnvironmentVerified: needsFiles && r.environment.fileEnvironmentAvailable && r.calls.some(call => call.status === 'completed' && !call.isError && ['write', 'edit', 'bash', 'read'].includes(call.name.replaceAll('.', '_'))),
        summary: success ? '代表性试用执行完成，仍需管理员确认。' : r.snapshot.lastResult?.message || '试用未通过，请检查执行记录及未验证能力。', unverified: [...missing, ...excluded.map(tool => `excluded:${tool}`), ...r.expert.allowedTools!.filter(tool => syntheticTrialToolNames.includes(tool)).map(tool => `${tool}:real-business-integration-and-schema`)] };
    } catch (error) {
      if (running.lab && running.sessionId) {
        try { r.snapshot = running.lab.get(running.sessionId); } catch { /* Preserve original error and the last validated snapshot. */ }
      }
      r.trial.status = running.stop === 'interrupted' ? 'interrupted' : running.stop === 'cancelled' ? 'cancelled' : 'failed';
      r.trial.evidence = { tools, model: r.environment.model, runtime: runtimeName, fileEnvironmentVerified: false, success: false,
        summary: error instanceof Error ? error.message : '试用执行失败。', unverified: ['execution-incomplete'] };
    } finally {
      clearInterval(timer); r.trial.completedAt = new Date().toISOString();
      try { await running.lab?.close(); } finally {
        await running.checkpoints.catch(() => {}); this.live.delete(r.trial.trialId); await this.update(actor, r);
      }
    }
  }
  private stopLive(running: LiveTrial) {
    if (running.lab && running.sessionId && running.requestId) {
      const snapshot = running.lab.get(running.sessionId); if (snapshot.active) running.lab.cancel(running.sessionId, running.requestId);
    }
  }
  async cancel(actor: ManagementActor, id: string) {
    const r = this.require(actor, id); const running = this.live.get(id);
    if (running) { running.stop ??= 'cancelled'; this.stopLive(running); await running.promise; } return this.view(r);
  }
  async wait(actor: ManagementActor, id: string) { this.require(actor, id); await this.live.get(id)?.promise; return this.get(actor, id); }
  respond(actor: ManagementActor, id: string, interactionId: string, body: unknown) {
    const r = this.require(actor, id); const running = this.live.get(id);
    if (!running?.lab || !running.sessionId || running.stop) throw unavailable('试用已结束或正在停止。');
    running.lab.respondInteraction(running.sessionId, interactionId, body, 'trial-seat'); return this.view(r);
  }
  async download(actor: ManagementActor, id: string, downloadId: string) {
    const r = this.require(actor, id); if (!r.snapshot?.fileOutputs?.some(file => file.downloadId === downloadId)) throw notFound();
    const workspaces = await WorkspaceStore.open(join(this.path(id), 'data'), 'trial-seat');
    return new FileService(workspaces).openDownload(r.snapshot.workspaceId, downloadId, 'trial-seat');
  }
  async close() {
    for (const r of this.live.values()) { r.stop ??= 'interrupted'; this.stopLive(r); }
    await Promise.all([...this.live.values()].map(r => r.promise)); this.closed = true;
  }
}
