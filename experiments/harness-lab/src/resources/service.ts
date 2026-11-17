import { join } from 'node:path';
import { controlledSkillDescription } from '../pi/skill-metadata.js';
import type { InstructionFile, InstructionUpdate, SkillFile, SourceInfo, WorkspaceResources } from '../contracts/index.js';
import { RequestError } from '../contracts/errors.js';
import { WorkspaceStore } from '../workspaces/store.js';
import { fixtureDir, sourceDefinitions } from '../tools/sources.js';
import { atomicWrite, hashContent, Mutex, readControlled, type WriteHooks } from './files.js';

const skills = [
  { id: 'synthesis', name: '资料综合写作', version: '1' },
  { id: 'review', name: '结果检查', version: '1' },
  { id: 'spatial-analysis', name: '空间分析', version: '3' },
  { id: 'map-annotations', name: '态势标绘', version: '3' },
];
export const controlledSkillIds: readonly string[] = skills.map(skill => skill.id);
/** Add deployed map methods without migrating the strict legacy workspace index. */
export function effectiveSkillIds(workspaceSkillIds: readonly string[]): string[] {
  return [...new Set([...workspaceSkillIds, 'map-annotations', 'spatial-analysis'])];
}
/** Deployment-owned fixed Skills, independent of any seat workspace. */
export async function loadControlledSkills(ids: readonly string[], signal?: AbortSignal): Promise<SkillFile[]> {
  return Promise.all(ids.map(async id => {
    signal?.throwIfAborted();
    const skill = skills.find(item => item.id === id);
    if (!skill) throw new RequestError('RESOURCE_NOT_FOUND', 'Skill ID 不存在。', 404);
    const content = (await readControlled(join(fixtureDir, 'skills', skill.id, 'SKILL.md'), 16384))!;
    const description = controlledSkillDescription(content, skill.id);
    signal?.throwIfAborted();
    return { id: skill.id, name: skill.name, description, version: skill.version, hash: hashContent(content), content };
  }));
}
export interface DynamicSkillProvider {
  catalog(seatId: string, userId?: string): Promise<SkillFile[]>;
  resolve(skill: SkillFile, seatId: string, userId?: string): Promise<SkillFile>;
}
export interface ResourceSnapshot {
  /** Request-scoped resolver; never serialized into native history or model context. */
  loadSkill?: (id:string) => Promise<SkillFile>;
  task?: {id:string;title:string;goal:string;visibility:'public'|'private'};
  workspaceId: string; instructions: InstructionFile[];
  sources: Array<SourceInfo & { content: string }>; skills: SkillFile[];
}
export function resourceInfo(snapshot: ResourceSnapshot): WorkspaceResources {
  return { workspaceId: snapshot.workspaceId,
    instructions: snapshot.instructions.map(({ fileId, name, hash, editable }) => ({ fileId, name, hash, editable })),
    sources: snapshot.sources.map(({ id, title, description, hash }) => ({ id, title, description, hash })),
    skills: snapshot.skills.map(({content: _content, ...info}) => { void _content; return info; }) };
}
export class ResourceService {
  dynamicSkills?: DynamicSkillProvider;
  private locks = new Map<string, Mutex>();
  constructor(private readonly workspaces: WorkspaceStore, private readonly hooks: WriteHooks = {}) {}
  private lock(id: string, seatId?: string) { this.workspaces.get(id, seatId); if (!this.locks.has(id)) this.locks.set(id, new Mutex()); return this.locks.get(id)!; }
  private async instruction(workspaceId: string, fileId: string, seatId?: string): Promise<InstructionFile> {
    this.workspaces.get(workspaceId, seatId);
    if (fileId !== 'common' && fileId !== 'workspace') throw new RequestError('RESOURCE_NOT_FOUND', '指令文件不存在。', 404);
    const path = fileId === 'common' ? join(fixtureDir, 'common/AGENTS.md') : join(this.workspaces.directory(workspaceId, seatId), 'AGENTS.md');
    const content = await readControlled(path, fileId === 'common' ? 4096 : 16384, true);
    return { fileId, name: fileId === 'common' ? '通用指令（AGENTS.md）' : '工作区指令（AGENTS.md）', content: content ?? '', hash: content === null ? null : hashContent(content), editable: fileId === 'workspace' && (!this.workspaces.access || this.workspaces.access.get(this.workspaces.get(workspaceId,seatId).taskSpaceId,seatId ?? this.workspaces.seatId).state === 'active') };
  }
  readInstruction(workspaceId: string, fileId: string, seatId?: string) { return this.lock(workspaceId, seatId).run(() => this.instruction(workspaceId, fileId, seatId)); }
  async updateInstruction(workspaceId: string, fileId: string, content: string, expectedHash: string | null, signal?: AbortSignal, seatId?: string): Promise<InstructionUpdate> {
    const release = this.workspaces.acquireWrite(workspaceId, seatId);
    try { return await this.updateInstructionInternal(workspaceId,fileId,content,expectedHash,signal,seatId); } finally { release(); }
  }
  private async updateInstructionInternal(workspaceId: string, fileId: string, content: string, expectedHash: string | null, signal?: AbortSignal, seatId?: string): Promise<InstructionUpdate> {
    return this.lock(workspaceId, seatId).run(async () => {
      signal?.throwIfAborted();
      if (fileId !== 'workspace') throw new RequestError('RESOURCE_READ_ONLY', '只能修改当前工作区指令。', 403);
      if (Buffer.byteLength(content, 'utf8') > 16384) throw new RequestError('RESOURCE_TOO_LARGE', '工作区指令不能超过 16 KiB。', 413);
      const current = await this.instruction(workspaceId, fileId, seatId);
      signal?.throwIfAborted();
      const hash = hashContent(content);
      if (current.hash === hash) return { fileId, status: 'unchanged', previousHash: current.hash, hash, effectiveFrom: 'next_request' };
      if (expectedHash !== current.hash) throw new RequestError('INSTRUCTION_CONFLICT', '工作区指令已更新，本次保存未完成，你的修改已保留。', 409);
      const path = join(this.workspaces.directory(workspaceId, seatId), 'AGENTS.md');
      try { await atomicWrite(path, content, signal, this.hooks); }
      catch (error) {
        // Rename may already have committed; inspect before reporting an outcome.
        const actual = await this.instruction(workspaceId, fileId, seatId).catch(() => null);
        if (actual?.hash === hash) return { fileId, status: 'updated', previousHash: current.hash, hash, effectiveFrom: 'next_request' };
        if (signal?.aborted && actual?.hash === current.hash) throw signal.reason;
        if (actual?.hash !== current.hash) throw new RequestError('INSTRUCTION_OUTCOME_UNCERTAIN', '指令保存结果未确认，请读取当前文件核对；不会自动重试。', 503);
        if (error instanceof RequestError) throw error;
        throw new RequestError('RESOURCE_LOAD_FAILED', '指令未保存，请检查文件后重试。', 503);
      }
      return { fileId, status: 'updated', previousHash: current.hash, hash, effectiveFrom: 'next_request' };
    });
  }
  async readSkill(workspaceId: string, id: string, seatId?: string, userId?: string): Promise<SkillFile> {
    const workspace = this.workspaces.get(workspaceId, seatId);
    if (this.dynamicSkills && !effectiveSkillIds(workspace.skillIds).includes(id)) {
      const skill = (await this.dynamicSkills.catalog(workspace.seatId,userId)).find(item => item.id === id);
      if (skill) return this.dynamicSkills.resolve(skill, workspace.seatId,userId);
    }
    if (!effectiveSkillIds(workspace.skillIds).includes(id)) throw new RequestError('RESOURCE_NOT_FOUND', 'Skill ID 不存在。', 404);
    return (await loadControlledSkills([id]))[0];
  }
  snapshot(workspaceId: string, signal?: AbortSignal, seatId?: string, fixedSkills: readonly SkillFile[] = [], userId?: string, includeDynamic = true): Promise<ResourceSnapshot> {
    return this.lock(workspaceId, seatId).run(async () => {
      signal?.throwIfAborted();
      if(!includeDynamic && fixedSkills.some(skill=>skill.schemaVersion===2))throw new RequestError('SKILL_BACKGROUND_UNSUPPORTED','后台仍仅支持既有受控技能；组织技能固定依赖需待后续后台迁移。',409);
      const workspace = this.workspaces.get(workspaceId, seatId);
      const instructions = await Promise.all(['common', 'workspace'].map(id => this.instruction(workspaceId, id, seatId)));
      const sources = await Promise.all(sourceDefinitions.filter(source => workspace.sourceIds.includes(source.id)).map(async source => {
        const content = (await readControlled(join(this.workspaces.directory(workspaceId, seatId), 'sources', `${source.id}.md`), 32768))!;
        return { ...source, content, hash: hashContent(content) };
      }));
      const ids = effectiveSkillIds(workspace.skillIds);
      const loadedSkills = await loadControlledSkills(ids.filter(id => !fixedSkills.some(skill => skill.id === id)), signal);
      if (includeDynamic && this.dynamicSkills) {
        const dynamic = await this.dynamicSkills.catalog(workspace.seatId,userId);
        for (const item of dynamic) if (!fixedSkills.some(fixed => fixed.id === item.id)) loadedSkills.push(item);
      }
      for (const fixed of fixedSkills) loadedSkills.push(fixed.schemaVersion === 2 && includeDynamic && this.dynamicSkills
        ? await this.dynamicSkills.resolve(fixed, workspace.seatId,userId) : structuredClone(fixed));
      loadedSkills.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      signal?.throwIfAborted();
      const task = this.workspaces.access?.get(workspace.taskSpaceId, workspace.seatId);
      const snapshot:ResourceSnapshot = { workspaceId, instructions, sources, skills: loadedSkills, ...(task ? { task: { id:task.id,title:task.title,goal:task.goal,visibility:task.visibility } } : {}) };
      if(includeDynamic && this.dynamicSkills)snapshot.loadSkill=async id=>{
        const selected=snapshotSkill(snapshot,id);
        if(selected.schemaVersion!==2 || selected.content)return selected;
        signal?.throwIfAborted();
        const resolved=await this.dynamicSkills!.resolve(selected,workspace.seatId,userId);
        if(resolved.hash!==selected.hash || resolved.packageDigest!==selected.packageDigest || resolved.revisionId!==selected.revisionId)throw new RequestError('SELECTION_CHANGED','技能包固定内容不一致。',409);
        signal?.throwIfAborted();snapshot.skills[snapshot.skills.findIndex(item=>item.id===id)]=resolved;
        return structuredClone(resolved);
      };
      return snapshot;
    });
  }
  async info(workspaceId: string, seatId?: string,userId?:string): Promise<WorkspaceResources> { return resourceInfo(await this.snapshot(workspaceId, undefined, seatId,[],userId)); }
}

/** Both explicit selection and skill_read use the same fixed request snapshot. */
export function snapshotSkill(snapshot: ResourceSnapshot, id: string): SkillFile {
  const skill = snapshot.skills.find(item => item.id === id);
  if (!skill) throw new RequestError('RESOURCE_NOT_FOUND', 'Skill 不存在或不可用，请重新选择。', 404);
  return structuredClone(skill);
}

/** Only actual method reads or explicit selections resolve a package body. */
export async function resolveSnapshotSkill(snapshot:ResourceSnapshot,id:string):Promise<SkillFile>{
  // A narrowed parent/child snapshot must not inherit the broader loader's catalog.
  const captured=snapshotSkill(snapshot,id);
  const loaded=snapshot.loadSkill?await snapshot.loadSkill(id):captured;
  if(loaded.id!==captured.id||loaded.hash!==captured.hash||loaded.revisionId!==captured.revisionId||loaded.packageDigest!==captured.packageDigest)throw new RequestError('RESOURCE_STATE_INVALID','请求技能快照不一致。',409);
  return loaded;
}
