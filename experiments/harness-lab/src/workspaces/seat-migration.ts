import { cp, lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite, checkDirectory, parseJsonStrict, readControlled, stateError } from '../resources/files.js';
import { validateIndex, type WorkspaceIndex } from './store.js';
interface Options { dataDir: string; backupDir: string; seatId?: string; apply: boolean; serviceStopped: boolean }
interface SeatMigration { schemaVersion: 1; stage: 'prepared' | 'completed'; sourceDir: string; backupDir: string; original: string; index: WorkspaceIndex }
/** Offline v1→v2 migration. Never rewrites native history or assigns new workspace IDs. */
export async function migrateSeats(options: Options): Promise<{stage: string; workspaces: number}> {
  const seatId = options.seatId ?? 'test-seat';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(seatId) || !isAbsolute(options.dataDir) || !isAbsolute(options.backupDir)) throw new Error('需要绝对目录与有效席位 ID。');
  if (options.apply && !options.serviceStopped) throw new Error('请先停止服务，并明确传入 --service-stopped。');
  await checkDirectory(options.dataDir); await checkDirectory(dirname(options.backupDir));
  const sourceDir = await realpath(options.dataDir); const backupDir = join(await realpath(dirname(options.backupDir)), resolve(options.backupDir).split('/').at(-1)!);
  for (const [from, to] of [[sourceDir, backupDir], [backupDir, sourceDir]]) { const rel = relative(from, to); if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error('备份需要独立目录。'); }
  await mkdir(join(sourceDir, 'migrations'), { recursive: true, mode: 0o700 }); await checkDirectory(join(sourceDir, 'migrations'));
  const reportPath = join(sourceDir, 'migrations', 'workspace-seats-v2.json');
  const prior = await readControlled(reportPath, 4 * 1024 * 1024, true);
  const raw = (await readControlled(join(sourceDir, 'workspace-index.json'), 2 * 1024 * 1024))!;
  const marker = await readControlled(join(sourceDir, '.workspace-initialized'), 1024);
  let report: SeatMigration;
  if (prior) {
    report = parseJsonStrict(prior) as SeatMigration;
    if (report.schemaVersion !== 1 || report.sourceDir !== sourceDir || report.backupDir !== backupDir || !['prepared', 'completed'].includes(report.stage)) throw stateError();
    validateIndex(report.index);
    if (report.index.workspaces.some(item => item.seatId !== seatId)) throw stateError();
    const backed = await readControlled(join(backupDir, 'workspace-index.json'), 2 * 1024 * 1024);
    if (backed !== report.original || (raw !== report.original && raw !== JSON.stringify(report.index, null, 2))) throw stateError();
    if (marker !== 'workspace-v1\n' && marker !== 'workspace-v2\n') throw stateError();
    if (report.stage === 'completed') { if (marker !== 'workspace-v2\n' || raw !== JSON.stringify(report.index, null, 2)) throw stateError(); return { stage: report.stage, workspaces: report.index.workspaces.length }; }
  } else {
    const legacy = parseJsonStrict(raw) as WorkspaceIndex;
    if ((legacy.schemaVersion as number) !== 1 || marker !== 'workspace-v1\n' || !Array.isArray(legacy.workspaces)) throw stateError();
    const index = validateIndex({ ...legacy, schemaVersion: 2, workspaces: legacy.workspaces.map(item => ({ ...item, taskSpaceId: randomUUID(), seatId })) });
    try { await lstat(backupDir); throw new Error('备份目录已存在，请选择新的独立目录。'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    report = {schemaVersion: 1, stage: 'prepared', sourceDir, backupDir, original: raw, index};
  }
  if (!options.apply) return { stage: 'dry-run', workspaces: report.index.workspaces.length };
  if (!prior) {
    await cp(sourceDir, backupDir, {recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true});
    if (await readControlled(join(backupDir, 'workspace-index.json'), 2 * 1024 * 1024) !== raw) throw stateError();
    await atomicWrite(reportPath, JSON.stringify(report));
  }
  for (const workspace of report.index.workspaces) {
    await checkDirectory(join(sourceDir, 'workspaces', workspace.id));
    await mkdir(join(sourceDir, 'workspaces', workspace.id, 'files'), {recursive: true, mode: 0o700});
    await checkDirectory(join(sourceDir, 'workspaces', workspace.id, 'files'));
  }
  await atomicWrite(join(sourceDir, 'workspace-index.json'), JSON.stringify(report.index, null, 2));
  await atomicWrite(join(sourceDir, '.workspace-initialized'), 'workspace-v2\n');
  report.stage = 'completed'; await atomicWrite(reportPath, JSON.stringify(report));
  return {stage: report.stage, workspaces: report.index.workspaces.length};
}
