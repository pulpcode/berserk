import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  CapabilityAdminSummary, CapabilityAvailability, CapabilityMode, CapabilityState, ExpertDetail,
  ExpertRef, ExpertRevision, ExpertSummary, SessionExpert, SkillRevision,
} from '../contracts/capabilities.js';
import { RequestError } from '../contracts/errors.js';
import { atomicWrite, checkDirectory, hashContent, Mutex, parseJsonStrict, readControlled } from '../resources/files.js';

export const GENERAL_EXPERT_ID = 'axon-general';
export const SYNTHESIS_EXPERT_ID = 'synthesis-expert';
const idPattern = /^[a-z][a-z0-9_-]{0,127}$/;
const digestPattern = /^[0-9a-f]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const invalid = () => new RequestError('CAPABILITY_STATE_INVALID', '能力配置缺失或摘要不匹配，请核对数据或恢复备份。', 409);
const changed = () => new RequestError('EXPERT_CHANGED', '专家配置已更新，请刷新详情后重新选择。', 409);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));

/** Sorted object keys; arrays retain their declared order. Undefined/non-JSON values fail closed. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  throw invalid();
}
export const capabilityDigest = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex');
export interface ControlledSkill { id: string; name: string; description: string; version: string; hash: string; content: string }
export interface ControlledRole { name: string; description: string; tools: readonly string[]; systemPrompt: string; hash: string }
export interface ExpertDefinition {
  expertId: string; releaseVersion: string; name: string; description: string; instructions: string;
  modes: CapabilityMode[]; selectable: boolean; system: boolean; allowedTools: string[] | null;
  skills: ControlledSkill[];
}
export interface CreationIntent {
  principalId: string; clientActionId: string; inputDigest: string; sessionId: string;
  expertRef: ExpertRef; digest: string; selectionSource?: 'explicit' | 'task' | 'personal' | 'seat' | 'general'; state: 'prepared' | 'completed' | 'blocked'; createdAt: string;
}
export interface LegacySession { sessionId: string; workspaceId: string; seatId: string }
interface AcceptedRequest { ref: ExpertRef; principalId?: string; seatId?: string; cancel: () => void; skills: SkillRevision[] }

export function skillRevision(value: ControlledSkill): SkillRevision {
  if (!idPattern.test(value.id) || !value.name.trim() || !value.description.trim() || !value.version.trim()
    || !value.content.trim() || Buffer.byteLength(value.content) > 16384 || value.hash !== hashContent(value.content)) throw invalid();
  const body = { id: value.id, name: value.name, description: value.description, version: value.version, hash: value.hash, content: value.content };
  const digest = capabilityDigest(body);
  return { ...body, revisionId: `skill-${digest}`, digest };
}
export function expertRevision(value: ExpertDefinition): ExpertRevision {
  if (!idPattern.test(value.expertId) || !value.releaseVersion.trim() || !value.name.trim() || !value.description.trim()
    || typeof value.instructions !== 'string' || Buffer.byteLength(value.instructions) > 65536
    || !value.modes.length || value.modes.some(mode => !['interactive', 'delegated', 'background', 'trial'].includes(mode))
    || typeof value.selectable !== 'boolean' || typeof value.system !== 'boolean'
    || (value.allowedTools !== null && (!Array.isArray(value.allowedTools) || value.allowedTools.some(tool => !idPattern.test(tool))))) throw invalid();
  const skills = value.skills.map(skillRevision).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (new Set(skills.map(skill => skill.id)).size !== skills.length) throw invalid();
  const body = { schemaVersion: 1 as const, expertId: value.expertId, releaseVersion: value.releaseVersion,
    name: value.name, description: value.description, instructions: value.instructions,
    modes: [...new Set(value.modes)].sort(), selectable: value.selectable, system: value.system,
    allowedTools: value.allowedTools === null ? null : [...new Set(value.allowedTools)].sort(), skills };
  const digest = capabilityDigest(body);
  return { ...body, revisionId: `rev-${digest}`, digest };
}
function decodeExpert(value: unknown): ExpertRevision {
  if (!object(value) || !exactKeys(value, ['schemaVersion', 'expertId', 'revisionId', 'releaseVersion', 'digest', 'name', 'description', 'instructions', 'modes', 'selectable', 'system', 'allowedTools', 'skills'])
    || value.schemaVersion !== 1 || !Array.isArray(value.skills) || !Array.isArray(value.modes)
    || value.skills.some(skill => !object(skill) || !exactKeys(skill, ['id', 'name', 'description', 'version', 'hash', 'content', 'revisionId', 'digest']))) throw invalid();
  try {
    const decoded = expertRevision(value as unknown as ExpertDefinition);
    if (canonicalJson(value) !== canonicalJson(decoded)) throw invalid();
    return decoded;
  } catch { throw invalid(); }
}
function validRef(ref: ExpertRef) {
  if (!ref || !idPattern.test(ref.expertId) || !/^rev-[0-9a-f]{64}$/.test(ref.revisionId)) throw invalid();
}

/** No user context, credentials or authority is stored in this content cache. */
export class CapabilityService {
  readonly db: DatabaseSync;
  readonly directory: string;
  private readonly cache = new Map<string, { value: ExpertRevision; bytes: number }>();
  private cacheBytes = 0;
  private readonly lock = new Mutex();
  private readonly accepted = new Map<string, AcceptedRequest>();
  private closed = false;
  private readonly measurements = { hits: 0, misses: 0, loadMs: [] as number[] };
  private constructor(directory: string, db: DatabaseSync, private readonly maxCacheBytes: number, readonly createdNew = false) { this.directory = directory; this.db = db; }

  static async open(dataDir: string, options: { allowPrepared?: boolean; maxCacheBytes?: number } = {}): Promise<CapabilityService> {
    const directory = join(dataDir, 'capabilities');
    await mkdir(directory, { recursive: true, mode: 0o700 }); await checkDirectory(directory);
    await mkdir(join(directory, 'blobs'), { mode: 0o700, recursive: true }); await checkDirectory(join(directory, 'blobs'));
    const path = join(directory, 'capabilities.sqlite');
    const stat = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)) throw invalid();
    const db = new DatabaseSync(path);
    try {
      db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
      if (!stat) db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE experts (expert_id TEXT PRIMARY KEY, current_revision TEXT NOT NULL, selectable INTEGER NOT NULL, system INTEGER NOT NULL);
        CREATE TABLE revisions (revision_id TEXT PRIMARY KEY, expert_id TEXT NOT NULL, digest TEXT NOT NULL, UNIQUE(expert_id,digest));
        CREATE TABLE skills (revision_id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, digest TEXT NOT NULL);
        CREATE TABLE states (asset_id TEXT NOT NULL, revision_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('enabled','disabled','banned')), reason TEXT, PRIMARY KEY(asset_id,revision_id));
        CREATE TABLE access_rules (principal_id TEXT NOT NULL, expert_id TEXT NOT NULL, allowed INTEGER NOT NULL CHECK(allowed IN (0,1)), PRIMARY KEY(principal_id,expert_id));
        CREATE TABLE creation_intents (principal_id TEXT NOT NULL, action_id TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(principal_id,action_id));
        CREATE TABLE legacy_sessions (session_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, seat_id TEXT NOT NULL);
        CREATE TABLE migration (id INTEGER PRIMARY KEY CHECK(id=1), input_digest TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('prepared','completed')));
        PRAGMA user_version=1; COMMIT;`);
      if (![1, 2].includes(Number(db.prepare('PRAGMA user_version').get()?.user_version)) || db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw invalid();
      // Checking expected tables also detects an interrupted or forged schema without recreating it.
      for (const table of ['experts', 'revisions', 'skills', 'states', 'access_rules', 'creation_intents', 'legacy_sessions', 'migration']) db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
      await chmod(path, 0o600);
      const service = new CapabilityService(directory, db, options.maxCacheBytes ?? 4 * 1024 * 1024, !stat);
      if (!options.allowPrepared && service.migrationStatus().state === 'prepared') throw new RequestError('CAPABILITY_MIGRATION_REQUIRED', '能力迁移尚未完成，请停服后使用原参数继续迁移。', 409);
      return service;
    } catch (error) { db.close(); throw error instanceof RequestError ? error : invalid(); }
  }

  async registerBuiltins(input: { skills: ControlledSkill[]; roles: ControlledRole[] }): Promise<ExpertRevision[]> {
    const methods = ['synthesis', 'review'].map(id => { const skill = input.skills.find(item => item.id === id); if (!skill) throw invalid(); return skill; });
    const definitions: ExpertDefinition[] = [
      { expertId: GENERAL_EXPERT_ID, name: 'Axon 通用助手', description: '帮助处理通用任务，保留工作台现有能力。', releaseVersion: '1.0.0',
        instructions: '', modes: ['interactive'], selectable: false, system: true, allowedTools: null, skills: [] },
      { expertId: SYNTHESIS_EXPERT_ID, name: '资料综合专家（示范）', description: '读取资料、交叉核对来源，形成有依据的综合结论并复核缺口。', releaseVersion: '1.0.0',
        instructions: '你是资料综合专家。围绕用户目标综合资料，区分原始事实、推断与缺口；引用实际读取的来源，说明冲突和不确定性。按需使用资料综合写作与结果检查方法，交付结论前复核证据。只进行获准的读取和只读专家委派，不下发业务指令。',
        modes: ['interactive'], selectable: true, system: true,
        allowedTools: ['source_list', 'source_read', 'instructions_read', 'skill_read', 'read', 'ls', 'find', 'subagent', 'ask_user'], skills: methods },
    ];
    const result: ExpertRevision[] = [];
    for (const definition of definitions) {
      const prior = this.db.prepare('SELECT system FROM experts WHERE expert_id=?').get(definition.expertId);
      if (prior && !prior.system) throw invalid();
      result.push(await this.registerExpert(definition));
    }
    result.push(...await this.registerRoles(input.roles));
    return result;
  }

  async registerRoles(roles: ControlledRole[]): Promise<ExpertRevision[]> {
    const revisions: ExpertRevision[] = [];
    for (const role of roles) revisions.push(await this.registerExpert({ expertId: `role-${role.name}`, name: role.name,
      description: role.description, releaseVersion: '1.0.0', instructions: role.systemPrompt,
      modes: ['delegated'], selectable: false, system: true, allowedTools: [...role.tools], skills: [] }));
    return revisions;
  }

  async registerExpert(definition: ExpertDefinition, commit?: (revision: ExpertRevision) => void): Promise<ExpertRevision> {
    const revision = expertRevision(definition);
    return this.lock.run(async () => {
      // Content must be durable and verified before SQL references become visible.
      for (const skill of revision.skills) {
        const existing = this.db.prepare('SELECT skill_id,digest FROM skills WHERE revision_id=?').get(skill.revisionId);
        if (existing && (existing.skill_id !== skill.id || existing.digest !== skill.digest)) throw invalid();
        await this.writeBlob(skill.digest, skill, !!existing);
      }
      const existing = this.db.prepare('SELECT expert_id,digest FROM revisions WHERE revision_id=?').get(revision.revisionId);
      if (existing && (existing.expert_id !== revision.expertId || existing.digest !== revision.digest)) throw invalid();
      await this.writeBlob(revision.digest, revision, !!existing);
      this.db.exec('BEGIN IMMEDIATE');
      try {
        for (const skill of revision.skills) this.db.prepare('INSERT OR IGNORE INTO skills VALUES(?,?,?)').run(skill.revisionId, skill.id, skill.digest);
        this.db.prepare('INSERT OR IGNORE INTO revisions VALUES(?,?,?)').run(revision.revisionId, revision.expertId, revision.digest);
        this.db.prepare('INSERT INTO experts VALUES(?,?,?,?) ON CONFLICT(expert_id) DO UPDATE SET current_revision=excluded.current_revision,selectable=excluded.selectable,system=excluded.system')
          .run(revision.expertId, revision.revisionId, Number(revision.selectable), Number(revision.system));
        commit?.(revision);
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      return structuredClone(revision);
    });
  }
  private async writeBlob(digest: string, value: unknown, required: boolean) {
    const path = join(this.directory, 'blobs', digest);
    const existing = await readControlled(path, 1024 * 1024, true);
    const content = canonicalJson(value);
    if (existing === null && required) throw invalid();
    if (existing !== null && existing !== content) throw invalid();
    if (existing === null) { await atomicWrite(path, content); await chmod(path, 0o400); }
    if (await readControlled(path, 1024 * 1024) !== content) throw invalid();
  }
  async current(expertId = GENERAL_EXPERT_ID): Promise<ExpertRevision> {
    const row = this.db.prepare('SELECT current_revision FROM experts WHERE expert_id=?').get(expertId);
    if (!row) throw new RequestError('EXPERT_NOT_FOUND', '专家不存在或不可用。', 404);
    return this.resolve({ expertId, revisionId: String(row.current_revision) });
  }
  async resolve(ref: ExpertRef, expectedDigest?: string): Promise<ExpertRevision> {
    validRef(ref);
    const start = performance.now();
    const row = this.db.prepare('SELECT digest FROM revisions WHERE expert_id=? AND revision_id=?').get(ref.expertId, ref.revisionId);
    if (!row || !digestPattern.test(String(row.digest))) throw invalid();
    const digest = String(row.digest);
    if (expectedDigest !== undefined && expectedDigest !== digest) throw invalid();
    const key = `${ref.revisionId}:${digest}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key); this.cache.set(key, cached); this.measurements.hits++;
      this.recordLoad(performance.now() - start);
      return structuredClone(cached.value);
    }
    this.measurements.misses++;
    let revision: ExpertRevision;
    try {
      const path = join(this.directory, 'blobs', digest);
      if ((await lstat(path)).nlink !== 1) throw invalid();
      revision = decodeExpert(parseJsonStrict((await readControlled(path, 1024 * 1024))!));
      if (revision.expertId !== ref.expertId || revision.revisionId !== ref.revisionId || revision.digest !== digest) throw invalid();
      for (const skill of revision.skills) {
        const saved = this.db.prepare('SELECT skill_id,digest FROM skills WHERE revision_id=?').get(skill.revisionId);
        if (!saved || saved.skill_id !== skill.id || saved.digest !== skill.digest) throw invalid();
        const skillPath = join(this.directory, 'blobs', skill.digest);
        if ((await lstat(skillPath)).nlink !== 1 || await readControlled(skillPath, 32768) !== canonicalJson(skill)) throw invalid();
      }
    } catch { throw invalid(); }
    const bytes = Buffer.byteLength(canonicalJson(revision));
    if (bytes <= this.maxCacheBytes) {
      while (this.cacheBytes + bytes > this.maxCacheBytes && this.cache.size) {
        const oldest = this.cache.keys().next().value!; this.cacheBytes -= this.cache.get(oldest)!.bytes; this.cache.delete(oldest);
      }
      this.cache.set(key, { value: revision, bytes }); this.cacheBytes += bytes;
    }
    this.recordLoad(performance.now() - start);
    return structuredClone(revision);
  }
  private availabilityFor(assetId: string, revisionId: string, principalId?: string, seatId?: string): CapabilityAvailability {
    const states = this.db.prepare('SELECT state,reason FROM states WHERE asset_id=? AND (revision_id=\'\' OR revision_id=?)').all(assetId, revisionId);
    const state = states.find(row => row.state === 'banned') ?? states.find(row => row.state === 'disabled');
    const denied = principalId && this.db.prepare('SELECT allowed FROM access_rules WHERE principal_id=? AND expert_id=?').get(principalId, assetId)?.allowed === 0;
    if (denied) return { available: false, state: 'banned', reason: '当前账号的能力使用授权已撤销。' };
    if (!this.canUseSeat(assetId, seatId)) return { available: false, state: 'banned', reason: '当前席位未获准使用此专家。' };
    if (this.isArchived(assetId) && !state) return { available: false, state: 'disabled', reason: '此专家已归档，历史内容仍可查看。' };
    return state ? { available: false, state: state.state as CapabilityState, reason: String(state.reason || (state.state === 'banned' ? '此能力已紧急封禁。' : '此能力已停用。')) }
      : { available: true, state: 'enabled' };
  }
  availability(ref: ExpertRef, principalId?: string, seatId?: string): CapabilityAvailability {
    validRef(ref);
    if (!this.db.prepare('SELECT 1 FROM revisions WHERE expert_id=? AND revision_id=?').get(ref.expertId, ref.revisionId)) return { available: false, state: 'banned', reason: '绑定的专家修订已缺失，请联系管理员核对。' };
    return this.availabilityFor(ref.expertId, ref.revisionId, principalId, seatId);
  }
  private summary(revision: ExpertRevision, principalId?: string, seatId?: string): ExpertSummary {
    let availability = this.availability(revision, principalId, seatId);
    for (const skill of revision.skills) {
      const state = this.availabilityFor(skill.id, skill.revisionId, principalId);
      if (!state.available && (availability.available || state.state === 'banned')) availability = { ...state, reason: `依赖技能「${skill.name}」不可用：${state.reason}` };
    }
    return { expertId: revision.expertId, revisionId: revision.revisionId, name: revision.name, description: revision.description,
      releaseVersion: revision.releaseVersion, digest: revision.digest, modes: [...revision.modes],
      dependencies: revision.skills.map(skill => ({ id: skill.id, name: skill.name, revisionId: skill.revisionId, releaseVersion: skill.version, digest: skill.digest })), availability };
  }
  async list(principalId?: string, seatId?: string): Promise<ExpertSummary[]> {
    const rows = this.db.prepare('SELECT expert_id,current_revision FROM experts WHERE selectable=1 ORDER BY expert_id').all();
    return Promise.all(rows.filter(row => this.canUseSeat(String(row.expert_id), seatId) && !this.isArchived(String(row.expert_id))).map(async row => this.summary(await this.resolve({ expertId: String(row.expert_id), revisionId: String(row.current_revision) }), principalId, seatId)));
  }
  async detail(expertId: string, principalId?: string, seatId?: string): Promise<ExpertDetail> {
    const revision = await this.current(expertId);
    if (!revision.selectable || !this.canUseSeat(expertId, seatId) || this.isArchived(expertId)) throw new RequestError('EXPERT_NOT_FOUND', '专家不存在或不可用。', 404);
    return { ...this.summary(revision, principalId, seatId), instructions: revision.instructions, allowedTools: revision.allowedTools };
  }
  sessionExpert(revision: ExpertRevision, principalId?: string, seatId?: string): SessionExpert {
    const current = this.db.prepare('SELECT current_revision FROM experts WHERE expert_id=?').get(revision.expertId);
    const currentRevisionId = String(current?.current_revision ?? revision.revisionId);
    return { ...this.summary(revision, principalId, seatId), currentRevisionId, updateAvailable: currentRevisionId !== revision.revisionId };
  }
  assertAdmission(ref: ExpertRef, principalId?: string, seatId?: string): void {
    const availability = this.availability(ref, principalId, seatId);
    if (!availability.available) throw new RequestError('EXPERT_UNAVAILABLE', availability.reason!, 409);
  }
  acceptRequest(input: { requestId: string; ref: ExpertRef; principalId?: string; seatId?: string; cancel: () => void; skills?: SkillRevision[] }): () => void {
    if (this.accepted.has(input.requestId)) throw invalid();
    this.assertAdmission(input.ref, input.principalId, input.seatId);
    for (const skill of input.skills ?? []) {
      const state = this.availabilityFor(skill.id, skill.revisionId, input.principalId);
      if (!state.available) throw new RequestError('EXPERT_UNAVAILABLE', state.reason!, 409);
    }
    this.accepted.set(input.requestId, { ref: structuredClone(input.ref), principalId: input.principalId, seatId: input.seatId,
      cancel: input.cancel, skills: structuredClone(input.skills ?? []) });
    return () => { this.accepted.delete(input.requestId); };
  }
  attachRequestSkills(requestId: string, skills: SkillRevision[]): void {
    const request = this.accepted.get(requestId);
    if (!request) throw new RequestError('CAPABILITY_REQUEST_CLOSED', '该请求已结束或未获能力准入。', 409);
    this.assertCall(requestId);
    const additions: SkillRevision[] = [];
    for (const skill of skills) {
      const existing = request.skills.find(item => item.id === skill.id);
      if (existing && existing.revisionId !== skill.revisionId) throw new RequestError('SKILL_REVISION_CONFLICT', '所选技能与专家固定依赖的修订不同，请重新选择。', 409);
      if (existing) continue;
      const state = this.availabilityFor(skill.id, skill.revisionId, request.principalId);
      if (!state.available) throw new RequestError('EXPERT_UNAVAILABLE', state.reason!, 409);
      additions.push(skill);
    }
    request.skills = [...request.skills, ...structuredClone(additions)];
  }
  assertCall(requestId: string): void {
    const request = this.accepted.get(requestId);
    if (!request) throw new RequestError('CAPABILITY_REQUEST_CLOSED', '该请求已结束或未获能力准入。', 409);
    const states = [this.availability(request.ref, request.principalId, request.seatId), ...request.skills.map(skill => this.availabilityFor(skill.id, skill.revisionId, request.principalId))];
    const denied = states.find(state => state.state === 'banned');
    if (denied) throw new RequestError('EXPERT_UNAVAILABLE', denied.reason!, 409);
  }
  setState(ref: { expertId: string; revisionId?: string }, state: CapabilityState, reason?: string): void {
    if (!idPattern.test(ref.expertId) || !['enabled', 'disabled', 'banned'].includes(state)) throw invalid();
    if (ref.revisionId && !/^(rev|skill)-[0-9a-f]{64}$/.test(ref.revisionId)) throw invalid();
    this.db.prepare('INSERT INTO states VALUES(?,?,?,?) ON CONFLICT(asset_id,revision_id) DO UPDATE SET state=excluded.state,reason=excluded.reason')
      .run(ref.expertId, ref.revisionId ?? '', state, reason ?? null);
    if (state === 'banned') this.cancelDenied();
  }
  setAccess(principalId: string, expertId: string, allowed: boolean): void {
    if (!principalId || !idPattern.test(expertId)) throw invalid();
    this.db.prepare('INSERT INTO access_rules VALUES(?,?,?) ON CONFLICT(principal_id,expert_id) DO UPDATE SET allowed=excluded.allowed').run(principalId, expertId, Number(allowed));
    if (!allowed) this.cancelDenied();
  }
  canUseSeat(expertId: string, seatId?: string): boolean {
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='r2_experts'").get()) return true;
    const managed = this.db.prepare('SELECT archived FROM r2_experts WHERE expert_id=?').get(expertId);
    if (!managed) return true; // R1 assets retain their original use behavior.
    const row = this.db.prepare('SELECT data FROM r2_policies WHERE expert_id=?').get(expertId);
    if (!row || !seatId) return false;
    const policy = JSON.parse(String(row.data)) as { mode: string; seatIds: string[] };
    return policy.mode === 'all' || policy.mode === 'seats' && policy.seatIds.includes(seatId);
  }
  private isArchived(expertId: string): boolean {
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='r2_experts'").get()) return false;
    return !!this.db.prepare('SELECT archived FROM r2_experts WHERE expert_id=?').get(expertId)?.archived;
  }
  assetAvailability(assetId: string, revisionId: string, principalId?: string) { return this.availabilityFor(assetId, revisionId, principalId); }
  sourceForSession(sessionId: string): CreationIntent['selectionSource'] | undefined {
    const rows = this.db.prepare("SELECT data FROM creation_intents WHERE json_extract(data,'$.sessionId')=?").all(sessionId);
    if (rows.length > 1) throw invalid();
    if (!rows.length) return undefined;
    const value = JSON.parse(String(rows[0].data)) as CreationIntent;
    return value.selectionSource;
  }
  activeRequestCount(expertId: string): number { return [...this.accepted.values()].filter(item => item.ref.expertId === expertId).length; }
  refreshAccessGuards(): void { this.cancelDenied(); }
  private cancelDenied() {
    for (const [requestId, request] of this.accepted) {
      try { this.assertCall(requestId); } catch { request.cancel(); }
    }
  }
  findCreation(principalId: string, clientActionId: string, input?: unknown): CreationIntent | undefined {
    const row = this.db.prepare('SELECT data FROM creation_intents WHERE principal_id=? AND action_id=?').get(principalId, clientActionId);
    if (!row) return undefined;
    let intent: CreationIntent;
    try {
      const value = parseJsonStrict(String(row.data));
      if (!object(value) || !exactKeys(value, ['principalId', 'clientActionId', 'inputDigest', 'sessionId', 'expertRef', 'digest', 'selectionSource', 'state', 'createdAt'])
        || value.principalId !== principalId || value.clientActionId !== clientActionId || !uuidPattern.test(String(value.sessionId))
        || !digestPattern.test(String(value.inputDigest)) || !digestPattern.test(String(value.digest))
        || (value.selectionSource !== undefined && !['explicit','task','personal','seat','general'].includes(String(value.selectionSource)))
        || !['prepared', 'completed', 'blocked'].includes(String(value.state)) || typeof value.createdAt !== 'string'
        || !Number.isFinite(Date.parse(value.createdAt)) || !object(value.expertRef)
        || !exactKeys(value.expertRef, ['expertId', 'revisionId'])) throw invalid();
      validRef(value.expertRef as unknown as ExpertRef);
      intent = value as unknown as CreationIntent;
    } catch { throw invalid(); }
    if (input !== undefined && intent.inputDigest !== capabilityDigest(input)) throw new RequestError('SESSION_CREATION_CONFLICT', '此创建操作的参数已变化，请重新发起。', 409);
    return structuredClone(intent);
  }
  async reserveCreation(input: { principalId: string; clientActionId: string; input: unknown; expertRef?: ExpertRef; expectedDigest?: string; sessionId?: string; seatId?: string; allowUnselectable?: boolean; resolveDefault?: () => Promise<{ expertRef: ExpertRef; digest: string; source?: 'task'|'personal'|'seat'|'general' }> }): Promise<CreationIntent> {
    if (!input.principalId || !uuidPattern.test(input.clientActionId)) throw new RequestError('INVALID_INPUT', '创建操作标识无效。');
    if (input.sessionId !== undefined && !uuidPattern.test(input.sessionId)) throw new RequestError('INVALID_INPUT', '会话标识无效。');
    return this.lock.run(async () => {
      const existing = this.findCreation(input.principalId, input.clientActionId, input.input);
      if (existing) {
        if (input.sessionId !== undefined && existing.sessionId !== input.sessionId) throw new RequestError('SESSION_CREATION_CONFLICT', '此创建操作已固定其他会话标识。', 409);
        return existing;
      }
      let revision: ExpertRevision; let selectionSource: CreationIntent['selectionSource'] = 'explicit';
      if (input.expertRef) {
        revision = await this.current(input.expertRef.expertId);
        if ((!revision.selectable && !input.allowUnselectable) || revision.revisionId !== input.expertRef.revisionId || revision.digest !== input.expectedDigest) throw changed();
      } else {
        if (input.expectedDigest !== undefined) throw new RequestError('INVALID_INPUT', '内容摘要必须与所选专家一起提供。');
        const resolved = await input.resolveDefault?.(); selectionSource = resolved?.source ?? 'general';
        revision = resolved ? await this.resolve(resolved.expertRef, resolved.digest) : await this.current();
      }
      this.assertAdmission(revision, input.principalId, input.seatId);
      const intent: CreationIntent = { principalId: input.principalId, clientActionId: input.clientActionId, inputDigest: capabilityDigest(input.input),
        sessionId: input.sessionId ?? randomUUID(), expertRef: { expertId: revision.expertId, revisionId: revision.revisionId }, digest: revision.digest,
        selectionSource, state: 'prepared', createdAt: new Date().toISOString() };
      this.db.prepare('INSERT INTO creation_intents VALUES(?,?,?)').run(intent.principalId, intent.clientActionId, JSON.stringify(intent));
      return intent;
    });
  }
  completeCreation(principalId: string, clientActionId: string): void { this.updateCreation(principalId, clientActionId, 'completed'); }
  markCreationBlocked(principalId: string, clientActionId: string): void { this.updateCreation(principalId, clientActionId, 'blocked'); }
  private updateCreation(principalId: string, actionId: string, state: CreationIntent['state']) {
    const intent = this.findCreation(principalId, actionId); if (!intent) throw invalid();
    this.db.prepare('UPDATE creation_intents SET data=? WHERE principal_id=? AND action_id=?').run(JSON.stringify({ ...intent, state }), principalId, actionId);
  }
  registerLegacySessions(sessions: LegacySession[]): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const item of sessions) {
        if (!uuidPattern.test(item.sessionId) || !uuidPattern.test(item.workspaceId) || !item.seatId) throw invalid();
        const existing = this.db.prepare('SELECT workspace_id,seat_id FROM legacy_sessions WHERE session_id=?').get(item.sessionId);
        if (existing && (existing.workspace_id !== item.workspaceId || existing.seat_id !== item.seatId)) throw invalid();
        this.db.prepare('INSERT OR IGNORE INTO legacy_sessions VALUES(?,?,?)').run(item.sessionId, item.workspaceId, item.seatId);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  isLegacySession(sessionId: string, workspaceId: string, seatId: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM legacy_sessions WHERE session_id=? AND workspace_id=? AND seat_id=?').get(sessionId, workspaceId, seatId);
    return !!row;
  }
  migrationStatus(): CapabilityAdminSummary['migration'] {
    const row = this.db.prepare('SELECT input_digest,state FROM migration WHERE id=1').get();
    return row ? { state: row.state as 'prepared' | 'completed', inputDigest: String(row.input_digest) } : { state: 'none' };
  }
  beginMigration(inputDigest: string): void {
    if (!digestPattern.test(inputDigest)) throw invalid();
    const current = this.migrationStatus();
    if (current.inputDigest && current.inputDigest !== inputDigest) throw new RequestError('CAPABILITY_MIGRATION_CONFLICT', '迁移参数与准备记录不同，请核对原迁移。', 409);
    if (current.state === 'none') this.db.prepare('INSERT INTO migration VALUES(1,?,?)').run(inputDigest, 'prepared');
  }
  completeMigration(inputDigest: string): void {
    if (this.migrationStatus().inputDigest !== inputDigest) throw invalid();
    this.db.prepare('UPDATE migration SET state=\'completed\' WHERE id=1').run();
  }
  async adminSummary(): Promise<CapabilityAdminSummary> {
    const rows = this.db.prepare('SELECT expert_id,current_revision,selectable,system FROM experts ORDER BY expert_id').all();
    const experts = await Promise.all(rows.map(async row => ({ ...this.summary(await this.resolve({ expertId: String(row.expert_id), revisionId: String(row.current_revision) })), selectable: !!row.selectable, system: !!row.system })));
    return { experts, revisions: Number(this.db.prepare('SELECT count(*) n FROM revisions').get()!.n),
      skillRevisions: Number(this.db.prepare('SELECT count(*) n FROM skills').get()!.n), migration: this.migrationStatus() };
  }
  private recordLoad(ms: number) {
    this.measurements.loadMs.push(ms);
    if (this.measurements.loadMs.length > 1024) this.measurements.loadMs.shift();
  }
  metrics() { return { ...this.measurements, loadMs: [...this.measurements.loadMs], cacheEntries: this.cache.size, cacheBytes: this.cacheBytes }; }
  close(): void {
    if (this.closed) return;
    this.closed = true; this.cache.clear(); this.cacheBytes = 0; this.accepted.clear(); this.db.close();
  }
}
