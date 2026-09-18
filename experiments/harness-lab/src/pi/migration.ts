import { cp, lstat, mkdir, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { atomicWrite, checkDirectory, hashContent, missing, parseJsonStrict, readControlled, stateError } from '../resources/files.js';
import { newWorkspace, prepareWorkspace, UUID, validateIndex, type WorkspaceEntry, type WorkspaceIndex } from '../workspaces/store.js';

interface LegacyFile { name: string; hash: string | null; sessionId?: string; diagnostic?: string }
export interface MigrationReport {
  schemaVersion: 1; sourceDir: string; backupDir: string; workspace: WorkspaceEntry;
  files: LegacyFile[]; stage: 'prepared' | 'indexed' | 'completed';
}
export interface MigrationOptions {
  dataDir: string; backupDir: string; apply: boolean; serviceStopped: boolean;
  afterStage?: (stage: MigrationReport['stage']) => Promise<void>;
}
async function inventory(directory: string): Promise<LegacyFile[]> {
  const files: LegacyFile[] = [];
  const ids = new Set<string>();
  await checkDirectory(directory);
  for (const name of (await readdir(directory)).sort()) {
    const file: LegacyFile = { name, hash: null };
    try {
      const text = (await readControlled(join(directory, name), 64 * 1024 * 1024))!;
      file.hash = hashContent(text);
      if (!name.endsWith('.jsonl')) throw new Error('非原生会话文件');
      const lines = text.trim().split('\n').map(line => JSON.parse(line));
      const header = lines[0];
      if (!header || header.type !== 'session' || !UUID.test(header.id)) throw new Error('无效原生会话头');
      const manager = SessionManager.open(join(directory, name), directory);
      if (manager.getSessionId() !== header.id || ids.has(header.id)) throw new Error('重复或不一致会话 ID');
      file.sessionId = header.id;
      ids.add(header.id);
    } catch { file.diagnostic = '文件无法安全识别，保留原文件且不登记归属。'; }
    files.push(file);
  }
  return files;
}
async function exists(path: string): Promise<boolean> { try { await lstat(path); return true; } catch (error) { if (missing(error)) return false; throw error; } }
function indexFor(report: MigrationReport): WorkspaceIndex {
  return { schemaVersion: 2, defaultWorkspaceId: report.workspace.id, workspaces: [report.workspace],
    sessionBindings: Object.fromEntries(report.files.filter(file => file.sessionId).map(file => [file.sessionId!, report.workspace.id])) };
}
function parseReport(raw: string, sourceDir: string, backupDir: string): MigrationReport {
  let report: MigrationReport;
  try { report = parseJsonStrict(raw) as MigrationReport; } catch { throw stateError(); }
  if (report.schemaVersion !== 1 || report.sourceDir !== sourceDir || report.backupDir !== backupDir || !['prepared', 'indexed', 'completed'].includes(report.stage) || !Array.isArray(report.files)) throw stateError();
  validateIndex(indexFor(report));
  for (const file of report.files) if (!file || typeof file.name !== 'string' || file.name.includes('/') || file.name === '.' || file.name === '..' || (file.hash !== null && !/^[0-9a-f]{64}$/.test(file.hash))) throw stateError();
  return report;
}
/** Explicit offline migration only. Native interpretation stays inside src/pi. */
export async function migrateWorkspace(options: MigrationOptions): Promise<MigrationReport> {
  if (!isAbsolute(options.dataDir) || !isAbsolute(options.backupDir)) throw new Error('源目录和备份目录必须是绝对路径。');
  await checkDirectory(options.dataDir);
  const sourceDir = await realpath(options.dataDir);
  await checkDirectory(dirname(options.backupDir));
  const backupDir = join(await realpath(dirname(options.backupDir)), resolve(options.backupDir).split('/').at(-1)!);
  const relation = relative(sourceDir, backupDir);
  const reverse = relative(backupDir, sourceDir);
  if (!relation || (!relation.startsWith('..') && !isAbsolute(relation)) || (!reverse.startsWith('..') && !isAbsolute(reverse))) throw new Error('备份必须使用独立目录，不得位于源目录内或包含源目录。');
  if (options.apply && !options.serviceStopped) throw new Error('请先停止服务，并通过 --service-stopped 明确确认停服。');
  const reportPath = join(sourceDir, 'migrations/workspace-v1.json');
  const reportExists = await exists(reportPath);
  const raw = reportExists ? await readControlled(reportPath, 2 * 1024 * 1024) : null;
  const existingIndex = await readControlled(join(sourceDir, 'workspace-index.json'), 2 * 1024 * 1024, true);
  const marker = await readControlled(join(sourceDir, '.workspace-initialized'), 1024, true);
  let report: MigrationReport;
  if (raw) {
    report = parseReport(raw, sourceDir, backupDir);
    await checkDirectory(backupDir);
    const backup = await inventory(join(backupDir, 'sessions'));
    if (JSON.stringify(backup) !== JSON.stringify(report.files)) throw new Error('备份清单校验失败，不能继续升级。');
    const current = await inventory(join(sourceDir, 'sessions'));
    if (JSON.stringify(current) !== JSON.stringify(report.files)) throw new Error('原会话清单已变化，不能继续升级；请检查停服状态与备份。');
  } else {
    if (existingIndex !== null || marker !== null) throw new Error('目录已初始化或索引缺失，请恢复备份；不能重新扫描导入。');
    if (await exists(backupDir)) throw new Error('备份目录已存在。请选择新的独立备份目录，不能覆盖。');
    report = { schemaVersion: 1, sourceDir, backupDir, workspace: newWorkspace('默认工作区'), files: await inventory(join(sourceDir, 'sessions')), stage: 'prepared' };
  }
  const expectedIndex = JSON.stringify(indexFor(report), null, 2);
  if (report.stage !== 'prepared' && existingIndex === null) throw stateError();
  if (existingIndex !== null && existingIndex !== expectedIndex) throw stateError();
  if (marker !== null && marker !== 'workspace-v2\n') throw stateError();
  if (report.stage === 'completed') {
    if (existingIndex === null || marker === null) throw stateError();
    return report;
  }
  if (!options.apply) return report;
  if (!raw) {
    // Copy the whole stopped directory before any change. A failed copy never proceeds.
    await cp(sourceDir, backupDir, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    const copied = await inventory(join(backupDir, 'sessions'));
    if (JSON.stringify(copied) !== JSON.stringify(report.files)) throw new Error('备份校验失败，未执行升级。');
    await mkdir(join(sourceDir, 'migrations'), { recursive: true, mode: 0o700 });
    await atomicWrite(reportPath, JSON.stringify(report, null, 2));
    await options.afterStage?.('prepared');
  }
  await prepareWorkspace(sourceDir, report.workspace);
  if (existingIndex === null) await atomicWrite(join(sourceDir, 'workspace-index.json'), expectedIndex);
  report.stage = 'indexed';
  await atomicWrite(reportPath, JSON.stringify(report, null, 2));
  await options.afterStage?.('indexed');
  await atomicWrite(join(sourceDir, '.workspace-initialized'), 'workspace-v2\n');
  report.stage = 'completed';
  await atomicWrite(reportPath, JSON.stringify(report, null, 2));
  await options.afterStage?.('completed');
  return report;
}
