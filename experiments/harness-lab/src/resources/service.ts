import { join } from 'node:path';
import type { InstructionFile, InstructionUpdate, SkillFile, SourceInfo, WorkspaceResources } from '../contracts/index.js';
import { RequestError } from '../contracts/errors.js';
import { WorkspaceStore } from '../workspaces/store.js';
import { fixtureDir, sourceDefinitions } from '../tools/sources.js';
import { atomicWrite, hashContent, Mutex, readControlled, type WriteHooks } from './files.js';

const skills = [
  { id: 'synthesis', name: '资料综合写作', description: '综合多份资料形成有来源、可执行的方案。', version: '1' },
  { id: 'review', name: '结果检查', description: '根据资料检查草稿的事实、约束与可执行性。', version: '1' },
];
export interface ResourceSnapshot {
  task?: {id:string;title:string;goal:string;visibility:'public'|'private'};
  workspaceId: string; instructions: InstructionFile[];
  sources: Array<SourceInfo & { content: string }>; skills: SkillFile[];
}
export function resourceInfo(snapshot: ResourceSnapshot): WorkspaceResources {
  return { workspaceId: snapshot.workspaceId,
    instructions: snapshot.instructions.map(({ fileId, name, hash, editable }) => ({ fileId, name, hash, editable })),
    sources: snapshot.sources.map(({ id, title, description, hash }) => ({ id, title, description, hash })),
    skills: snapshot.skills.map(({ id, name, description, version, hash }) => ({ id, name, description, version, hash })) };
}
export class ResourceService {
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
  async readSkill(workspaceId: string, id: string, seatId?: string): Promise<SkillFile> {
    const workspace = this.workspaces.get(workspaceId, seatId);
    const skill = skills.find(skill => skill.id === id && workspace.skillIds.includes(id));
    if (!skill) throw new RequestError('RESOURCE_NOT_FOUND', 'Skill ID 不存在。', 404);
    const content = (await readControlled(join(fixtureDir, 'skills', skill.id, 'SKILL.md'), 16384))!;
    if (!content.startsWith(`---\nname: ${skill.id}\ndescription:`)) throw new RequestError('RESOURCE_STATE_INVALID', 'Skill 配置损坏。', 409);
    return { ...skill, hash: hashContent(content), content };
  }
  snapshot(workspaceId: string, signal?: AbortSignal, seatId?: string): Promise<ResourceSnapshot> {
    return this.lock(workspaceId, seatId).run(async () => {
      signal?.throwIfAborted();
      const workspace = this.workspaces.get(workspaceId, seatId);
      const instructions = await Promise.all(['common', 'workspace'].map(id => this.instruction(workspaceId, id, seatId)));
      const sources = await Promise.all(sourceDefinitions.filter(source => workspace.sourceIds.includes(source.id)).map(async source => {
        const content = (await readControlled(join(this.workspaces.directory(workspaceId, seatId), 'sources', `${source.id}.md`), 32768))!;
        return { ...source, content, hash: hashContent(content) };
      }));
      const loadedSkills = await Promise.all(workspace.skillIds.map(id => this.readSkill(workspaceId, id, seatId)));
      signal?.throwIfAborted();
      const task = this.workspaces.access?.get(workspace.taskSpaceId, workspace.seatId);
      return { workspaceId, instructions, sources, skills: loadedSkills, ...(task ? { task: { id:task.id,title:task.title,goal:task.goal,visibility:task.visibility } } : {}) };
    });
  }
  async info(workspaceId: string, seatId?: string): Promise<WorkspaceResources> { return resourceInfo(await this.snapshot(workspaceId, undefined, seatId)); }
}

/** Both explicit selection and skill_read use the same fixed request snapshot. */
export function snapshotSkill(snapshot: ResourceSnapshot, id: string): SkillFile {
  const skill = snapshot.skills.find(item => item.id === id);
  if (!skill) throw new RequestError('RESOURCE_NOT_FOUND', 'Skill 不存在或不可用，请重新选择。', 404);
  return structuredClone(skill);
}
