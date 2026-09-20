import { randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Workspace, WorkspaceList } from '../contracts/index.js';
import { RequestError } from '../contracts/errors.js';
import { atomicWrite, checkDirectory, Mutex, parseJsonStrict, readControlled, stateError } from '../resources/files.js';
import { fixtureDir, sourceDefinitions } from '../tools/sources.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export interface WorkspaceEntry extends Workspace { taskSpaceId: string; seatId: string; sourceIds: string[]; skillIds: string[] }
export interface WorkspaceIndex { schemaVersion: 2; defaultWorkspaceId: string; workspaces: WorkspaceEntry[]; sessionBindings: Record<string, string> }
export const newWorkspace = (name: string, id = randomUUID(), seatId = 'test-seat', taskSpaceId: string = randomUUID()): WorkspaceEntry => ({ id, name, taskSpaceId, seatId, createdAt: new Date().toISOString(), sourceIds: sourceDefinitions.map(source => source.id), skillIds: ['synthesis', 'review'] });
export function validateIndex(value: unknown): WorkspaceIndex {
  if (!value || typeof value !== 'object') throw stateError();
  const index = value as WorkspaceIndex;
  if (Object.keys(index).some(key => !['schemaVersion', 'defaultWorkspaceId', 'workspaces', 'sessionBindings'].includes(key))) throw stateError();
  if (index.schemaVersion !== 2 || !Array.isArray(index.workspaces) || !index.workspaces.length || !index.sessionBindings || typeof index.sessionBindings !== 'object' || Array.isArray(index.sessionBindings)) throw stateError();
  const ids = new Set<string>();
  const owners = new Set<string>();
  for (const item of index.workspaces) {
    if (!item || Object.keys(item).some(key => !['id', 'name', 'createdAt', 'taskSpaceId', 'seatId', 'sourceIds', 'skillIds'].includes(key)) || !UUID.test(item.id) || ids.has(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 60 || !Number.isFinite(Date.parse(item.createdAt)) || JSON.stringify(item.sourceIds) !== JSON.stringify(sourceDefinitions.map(s => s.id)) || JSON.stringify(item.skillIds) !== '["synthesis","review"]') throw stateError();
    if (!UUID.test(item.taskSpaceId) || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.seatId) || owners.has(`${item.taskSpaceId}:${item.seatId}`)) throw stateError();
    owners.add(`${item.taskSpaceId}:${item.seatId}`);
    ids.add(item.id);
  }
  if (!ids.has(index.defaultWorkspaceId)) throw stateError();
  for (const [id, workspace] of Object.entries(index.sessionBindings)) if (!UUID.test(id) || !ids.has(workspace)) throw stateError();
  return index;
}
export async function prepareWorkspace(dataDir: string, workspace: WorkspaceEntry): Promise<void> {
  await checkDirectory(dataDir);
  const root = join(dataDir, 'workspaces');
  await mkdir(root, { recursive: true, mode: 0o700 }); await checkDirectory(root);
  const directory = join(root, workspace.id);
  await mkdir(directory, { recursive: true, mode: 0o700 }); await checkDirectory(directory);
  await mkdir(join(directory, 'files'), { recursive: true, mode: 0o700 }); await checkDirectory(join(directory, 'files'));
  const sourceDir = join(directory, 'sources');
  await mkdir(sourceDir, { recursive: true, mode: 0o700 }); await checkDirectory(sourceDir);
  if (await readControlled(join(directory, 'AGENTS.md'), 16384, true) === null) await atomicWrite(join(directory, 'AGENTS.md'), '');
  for (const source of sourceDefinitions) {
    const path = join(sourceDir, `${source.id}.md`);
    const template = (await readControlled(join(fixtureDir, `${source.id}.md`), 32768))!;
    const existing = await readControlled(path, 32768, true);
    if (existing === null) await atomicWrite(path, template);
  }
}
export class WorkspaceStore {
  private readonly lock = new Mutex();
  private constructor(readonly dataDir: string, private index: WorkspaceIndex, readonly seatId: string) {}
  static async open(dataDir: string, seatId = 'test-seat'): Promise<WorkspaceStore> {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(seatId)) throw stateError();
    await mkdir(dataDir, { recursive: true, mode: 0o700 }); await checkDirectory(dataDir);
    const raw = await readControlled(join(dataDir, 'workspace-index.json'), 2 * 1024 * 1024, true);
    const marker = await readControlled(join(dataDir, '.workspace-initialized'), 1024, true);
    await mkdir(join(dataDir, 'migrations'), { recursive: true, mode: 0o700 });
    const seatReport = await readControlled(join(dataDir, 'migrations/workspace-seats-v2.json'), 4 * 1024 * 1024, true);
    if (seatReport && (parseJsonStrict(seatReport) as {stage?: string}).stage !== 'completed') throw new RequestError('RESOURCE_STATE_INVALID', '席位工作区升级尚未完成，请停服后继续迁移。', 409);
    const report = await readControlled(join(dataDir, 'migrations/workspace-v1.json'), 2 * 1024 * 1024, true);
    if (report) {
      let complete = false;
      try { complete = JSON.parse(report).stage === 'completed'; } catch { throw stateError(); }
      if (!complete) throw new RequestError('RESOURCE_STATE_INVALID', '工作区升级尚未完成，请停服后按迁移报告继续。', 409);
    }
    if (raw !== null) {
      let decoded: {schemaVersion?: number};
      try { decoded = parseJsonStrict(raw) as {schemaVersion?: number}; if (!decoded || typeof decoded !== 'object') throw stateError(); } catch { throw stateError(); }
      if (decoded.schemaVersion === 1 && marker === 'workspace-v1\n') throw new RequestError('MIGRATION_REQUIRED', '请停服备份后执行席位工作区迁移。', 409);
      if (marker !== 'workspace-v2\n') throw stateError();
      let index: WorkspaceIndex;
      try { index = validateIndex(parseJsonStrict(raw)); } catch { throw stateError(); }
      for (const workspace of index.workspaces) {
        await checkDirectory(join(dataDir, 'workspaces', workspace.id, 'sources'));
        await checkDirectory(join(dataDir, 'workspaces', workspace.id, 'files'));
      }
      return new WorkspaceStore(dataDir, index, seatId);
    }
    if (marker !== null || report) throw stateError();
    await mkdir(join(dataDir, 'sessions'), { recursive: true, mode: 0o700 }); await checkDirectory(join(dataDir, 'sessions'));
    if ((await readdir(join(dataDir, 'sessions'))).length) throw new RequestError('MIGRATION_REQUIRED', '检测到旧会话。请停止服务并执行工作区迁移（先备份），不会自动导入。', 409);
    const workspace = newWorkspace('默认工作区', undefined, seatId);
    await prepareWorkspace(dataDir, workspace);
    const index: WorkspaceIndex = { schemaVersion: 2, defaultWorkspaceId: workspace.id, workspaces: [workspace], sessionBindings: {} };
    await atomicWrite(join(dataDir, 'workspace-index.json'), JSON.stringify(index, null, 2));
    await atomicWrite(join(dataDir, '.workspace-initialized'), 'workspace-v2\n');
    return new WorkspaceStore(dataDir, index, seatId);
  }
  list(seatId = this.seatId): WorkspaceList {
    const workspaces = this.index.workspaces.filter(item => item.seatId === seatId).map(({ id, name, createdAt, taskSpaceId, seatId }) => ({ id, name, createdAt, taskSpaceId, seatId }));
    return { defaultWorkspaceId: workspaces.some(item => item.id === this.index.defaultWorkspaceId) ? this.index.defaultWorkspaceId : workspaces[0]?.id || '', workspaces };
  }
  get(id: string | undefined = undefined, seatId = this.seatId): WorkspaceEntry {
    const item = this.index.workspaces.find(item => item.id === (id ?? this.list(seatId).defaultWorkspaceId) && item.seatId === seatId);
    if (!item) throw new RequestError('WORKSPACE_NOT_FOUND', '工作区不存在。', 404);
    return structuredClone(item);
  }
  directory(id: string, seatId = this.seatId) { return join(this.dataDir, 'workspaces', this.get(id, seatId).id); }
  filesDirectory(id: string, seatId = this.seatId) { return join(this.directory(id, seatId), 'files'); }
  binding(id: string, seatId = this.seatId) { const workspaceId = this.index.sessionBindings[id]; return this.index.workspaces.some(item => item.id === workspaceId && item.seatId === seatId) ? workspaceId : undefined; }
  bindings(seatId = this.seatId) { return Object.fromEntries(Object.entries(this.index.sessionBindings).filter(([, id]) => this.index.workspaces.some(item => item.id === id && item.seatId === seatId))); }
  /** Trusted startup lookup only; public access must use get(id, actor.seatId). */
  getAny(id: string): WorkspaceEntry {
    const item = this.index.workspaces.find(item => item.id === id);
    if (!item) throw new RequestError('WORKSPACE_NOT_FOUND', '工作区不存在。', 404);
    return structuredClone(item);
  }
  listAll() { return structuredClone(this.index.workspaces); }
  allBindings() { return { ...this.index.sessionBindings }; }
  async ensureWorkspace(taskSpaceId: string, seatId: string, name: string): Promise<Workspace> {
    return this.lock.run(async () => {
      const existing = this.index.workspaces.find(item => item.taskSpaceId === taskSpaceId && item.seatId === seatId);
      if (existing) return this.get(existing.id, seatId);
      if (!UUID.test(taskSpaceId) || !this.index.workspaces.some(item => item.taskSpaceId === taskSpaceId)) throw stateError();
      return this.createUnlocked(name, taskSpaceId, seatId);
    });
  }
  private async commit(next: WorkspaceIndex) {
    // Revalidate disk before overwriting so corruption is never silently healed by a live process.
    const disk = await readControlled(join(this.dataDir, 'workspace-index.json'), 2 * 1024 * 1024);
    try { validateIndex(parseJsonStrict(disk!)); } catch { throw stateError(); }
    if (disk !== JSON.stringify(this.index, null, 2)) throw stateError();
    await atomicWrite(join(this.dataDir, 'workspace-index.json'), JSON.stringify(next, null, 2));
    this.index = next;
  }
  async create(name: string, taskSpaceId?: string, seatId = this.seatId): Promise<Workspace> {
    return this.lock.run(() => this.createUnlocked(name, taskSpaceId, seatId));
  }
  private async createUnlocked(name: string, taskSpaceId: string | undefined, seatId: string): Promise<Workspace> {
    name = name.trim();
    if (!name || name.length > 60 || !/^[a-zA-Z0-9_-]{1,64}$/.test(seatId)) throw new RequestError('INVALID_INPUT', '工作区名称或席位无效。');
    if (taskSpaceId && (!UUID.test(taskSpaceId) || this.index.workspaces.some(item => item.taskSpaceId === taskSpaceId && item.seatId === seatId))) throw stateError();
    const workspace = newWorkspace(name, undefined, seatId, taskSpaceId);
    await prepareWorkspace(this.dataDir, workspace);
    await this.commit({ ...this.index, workspaces: [...this.index.workspaces, workspace] });
    const { id, createdAt } = workspace;
    return { id, name, createdAt, taskSpaceId: workspace.taskSpaceId, seatId: workspace.seatId };
  }
  async bind(sessionId: string, workspaceId: string, seatId = this.seatId) {
    return this.lock.run(async () => {
      this.get(workspaceId, seatId);
      if (!UUID.test(sessionId) || this.index.sessionBindings[sessionId]) throw stateError();
      await this.commit({ ...this.index, sessionBindings: { ...this.index.sessionBindings, [sessionId]: workspaceId } });
    });
  }
}
