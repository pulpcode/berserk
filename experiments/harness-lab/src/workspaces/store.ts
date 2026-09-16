import { randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Workspace, WorkspaceList } from '../contracts/index.js';
import { RequestError } from '../contracts/errors.js';
import { atomicWrite, checkDirectory, Mutex, parseJsonStrict, readControlled, stateError } from '../resources/files.js';
import { fixtureDir, sourceDefinitions } from '../tools/sources.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export interface WorkspaceEntry extends Workspace { sourceIds: string[]; skillIds: string[] }
export interface WorkspaceIndex { schemaVersion: 1; defaultWorkspaceId: string; workspaces: WorkspaceEntry[]; sessionBindings: Record<string, string> }
export const newWorkspace = (name: string, id = randomUUID()): WorkspaceEntry => ({ id, name, createdAt: new Date().toISOString(), sourceIds: sourceDefinitions.map(source => source.id), skillIds: ['synthesis', 'review'] });
export function validateIndex(value: unknown): WorkspaceIndex {
  if (!value || typeof value !== 'object') throw stateError();
  const index = value as WorkspaceIndex;
  if (index.schemaVersion !== 1 || !Array.isArray(index.workspaces) || !index.workspaces.length || !index.sessionBindings || typeof index.sessionBindings !== 'object' || Array.isArray(index.sessionBindings)) throw stateError();
  const ids = new Set<string>();
  for (const item of index.workspaces) {
    if (!item || !UUID.test(item.id) || ids.has(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 60 || !Number.isFinite(Date.parse(item.createdAt)) || JSON.stringify(item.sourceIds) !== JSON.stringify(sourceDefinitions.map(s => s.id)) || JSON.stringify(item.skillIds) !== '["synthesis","review"]') throw stateError();
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
  private constructor(readonly dataDir: string, private index: WorkspaceIndex) {}
  static async open(dataDir: string): Promise<WorkspaceStore> {
    await mkdir(dataDir, { recursive: true, mode: 0o700 }); await checkDirectory(dataDir);
    const raw = await readControlled(join(dataDir, 'workspace-index.json'), 2 * 1024 * 1024, true);
    const marker = await readControlled(join(dataDir, '.workspace-initialized'), 1024, true);
    await mkdir(join(dataDir, 'migrations'), { recursive: true, mode: 0o700 });
    const report = await readControlled(join(dataDir, 'migrations/workspace-v1.json'), 2 * 1024 * 1024, true);
    if (report) {
      let complete = false;
      try { complete = JSON.parse(report).stage === 'completed'; } catch { throw stateError(); }
      if (!complete) throw new RequestError('RESOURCE_STATE_INVALID', '工作区升级尚未完成，请停服后按迁移报告继续。', 409);
    }
    if (raw !== null) {
      if (marker !== 'workspace-v1\n') throw stateError();
      let index: WorkspaceIndex;
      try { index = validateIndex(parseJsonStrict(raw)); } catch { throw stateError(); }
      for (const workspace of index.workspaces) await checkDirectory(join(dataDir, 'workspaces', workspace.id, 'sources'));
      return new WorkspaceStore(dataDir, index);
    }
    if (marker !== null || report) throw stateError();
    await mkdir(join(dataDir, 'sessions'), { recursive: true, mode: 0o700 }); await checkDirectory(join(dataDir, 'sessions'));
    if ((await readdir(join(dataDir, 'sessions'))).length) throw new RequestError('MIGRATION_REQUIRED', '检测到旧会话。请停止服务并执行工作区迁移（先备份），不会自动导入。', 409);
    const workspace = newWorkspace('默认工作区');
    await prepareWorkspace(dataDir, workspace);
    const index: WorkspaceIndex = { schemaVersion: 1, defaultWorkspaceId: workspace.id, workspaces: [workspace], sessionBindings: {} };
    await atomicWrite(join(dataDir, 'workspace-index.json'), JSON.stringify(index, null, 2));
    await atomicWrite(join(dataDir, '.workspace-initialized'), 'workspace-v1\n');
    return new WorkspaceStore(dataDir, index);
  }
  list(): WorkspaceList { return { defaultWorkspaceId: this.index.defaultWorkspaceId, workspaces: this.index.workspaces.map(({ id, name, createdAt }) => ({ id, name, createdAt })) }; }
  get(id = this.index.defaultWorkspaceId): WorkspaceEntry {
    const item = this.index.workspaces.find(item => item.id === id);
    if (!item) throw new RequestError('WORKSPACE_NOT_FOUND', '工作区不存在。', 404);
    return structuredClone(item);
  }
  directory(id: string) { return join(this.dataDir, 'workspaces', this.get(id).id); }
  binding(id: string) { return this.index.sessionBindings[id]; }
  bindings() { return { ...this.index.sessionBindings }; }
  private async commit(next: WorkspaceIndex) {
    // Revalidate disk before overwriting so corruption is never silently healed by a live process.
    const disk = await readControlled(join(this.dataDir, 'workspace-index.json'), 2 * 1024 * 1024);
    try { validateIndex(parseJsonStrict(disk!)); } catch { throw stateError(); }
    if (disk !== JSON.stringify(this.index, null, 2)) throw stateError();
    await atomicWrite(join(this.dataDir, 'workspace-index.json'), JSON.stringify(next, null, 2));
    this.index = next;
  }
  async create(name: string): Promise<Workspace> {
    name = name.trim();
    if (!name || name.length > 60) throw new RequestError('INVALID_INPUT', '工作区名称应为 1～60 个字符。');
    return this.lock.run(async () => {
      const workspace = newWorkspace(name);
      await prepareWorkspace(this.dataDir, workspace);
      await this.commit({ ...this.index, workspaces: [...this.index.workspaces, workspace] });
      const { id, createdAt } = workspace; return { id, name, createdAt };
    });
  }
  async bind(sessionId: string, workspaceId: string) {
    return this.lock.run(async () => {
      this.get(workspaceId);
      if (!UUID.test(sessionId) || this.index.sessionBindings[sessionId]) throw stateError();
      await this.commit({ ...this.index, sessionBindings: { ...this.index.sessionBindings, [sessionId]: workspaceId } });
    });
  }
}
