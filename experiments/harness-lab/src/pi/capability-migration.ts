import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CapabilityRoles } from '../access/capability-roles.js';
import { CapabilityService } from '../capabilities/service.js';
import { RequestError } from '../contracts/errors.js';
import { atomicWrite, checkDirectory, hashContent, parseJsonStrict, readControlled, stateError } from '../resources/files.js';
import { controlledSkillIds, loadControlledSkills } from '../resources/service.js';
import { validateIndex } from '../workspaces/store.js';
import { openStrictSession } from './compaction-history.js';
import { validateHistoryEvidence } from './history-evidence.js';
import { loadAgentRoles } from './roles.js';

const markerName = 'capabilities-r1.json';
interface LegacySession { sessionId: string; workspaceId: string; seatId: string }
interface FileDigest { path: string; size: number; digest: string }
interface MigrationRecord {
  schemaVersion: 1; stage: 'prepared' | 'completed'; sourceDir: string; backupDir: string;
  inputDigest: string; backupDigest: string; legacySessions: LegacySession[];
  sourceFiles: FileDigest[]; authSchemaVersion: number | null;
  definitionDigest: string;
}
export interface CapabilityMigrationOptions {
  dataDir: string; backupDir: string; apply: boolean; serviceStopped: boolean; rolesDir?: string;
  /** Fault injection for migration/recovery tests, never a CLI option. */
  hooks?: { afterPrepared?: () => Promise<void>; afterAuth?: () => Promise<void> };
}
const required = () => new RequestError('CAPABILITY_MIGRATION_REQUIRED', '检测到旧会话，请停服备份后执行能力中心迁移；不会自动登记旧会话。', 409);

async function statOptional(path: string) {
  try { return await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
async function optionalText(path: string, limit: number): Promise<string | null> {
  if (!await statOptional(path)) return null;
  return readControlled(path, limit);
}
function decodeRecord(raw: string): MigrationRecord {
  const value = parseJsonStrict(raw) as MigrationRecord;
  if (!value || value.schemaVersion !== 1 || !['prepared', 'completed'].includes(value.stage)
    || !isAbsolute(value.sourceDir) || !isAbsolute(value.backupDir)
    || ![value.inputDigest, value.backupDigest, value.definitionDigest].every(digest => typeof digest === 'string' && /^[0-9a-f]{64}$/.test(digest))
    || !Array.isArray(value.legacySessions) || !Array.isArray(value.sourceFiles)
    || value.authSchemaVersion !== null && !Number.isInteger(value.authSchemaVersion)) throw stateError();
  return value;
}

/** No writes: a legacy root cannot be silently reclassified at ordinary startup. */
export async function assertCapabilityMigrationReady(dataDir: string): Promise<void> {
  if (!await statOptional(dataDir)) return;
  await checkDirectory(dataDir);
  const marker = await optionalText(join(dataDir, 'migrations', markerName), 16 * 1024 * 1024);
  if (marker && decodeRecord(marker).stage !== 'completed') throw new RequestError('CAPABILITY_MIGRATION_INCOMPLETE', '能力中心迁移尚未完成，请停服后以原参数继续迁移。', 409);
  const capabilityDatabase = await statOptional(join(dataDir, 'capabilities', 'capabilities.sqlite'));
  if (capabilityDatabase) return; // CapabilityService owns its integrity and internal stage checks.
  if (marker) throw stateError(); // Never bootstrap over a lost post-upgrade database.
  const raw = await optionalText(join(dataDir, 'workspace-index.json'), 2 * 1024 * 1024);
  if (raw && Object.keys(validateIndex(parseJsonStrict(raw)).sessionBindings).length) throw required();
  const directory = join(dataDir, 'sessions');
  if (await statOptional(directory)) {
    await checkDirectory(directory);
    if ((await readdir(directory)).some(name => name.endsWith('.jsonl'))) throw required();
  }
}

async function inventory(dataDir: string): Promise<{ sessions: LegacySession[]; authSchemaVersion: number | null }> {
  const raw = await optionalText(join(dataDir, 'workspace-index.json'), 2 * 1024 * 1024);
  const index = raw ? validateIndex(parseJsonStrict(raw)) : undefined;
  const sessions: LegacySession[] = [];
  const directory = join(dataDir, 'sessions');
  const names = await statOptional(directory) ? await readdir(directory) : [];
  const seen = new Set<string>();
  for (const name of names.filter(value => value.endsWith('.jsonl')).sort()) {
    const path = join(directory, name); const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw stateError();
    const manager = await openStrictSession(path, directory); const id = manager.getSessionId();
    if (seen.has(id)) throw stateError(); seen.add(id);
    const workspaceId = index?.sessionBindings[id];
    if (!workspaceId) throw new RequestError('CAPABILITY_MIGRATION_CONFLICT', '发现未登记原生会话，必须先核对其归属；迁移不会猜测工作区。', 409);
    const workspace = index!.workspaces.find(item => item.id === workspaceId)!;
    const entries = manager.getEntries();
    if (entries.some(entry => entry.type === 'custom' && /^berserk\.(expert-binding|execution-manifest)\./.test(entry.customType))) throw new RequestError('CAPABILITY_MIGRATION_CONFLICT', '发现新专家格式会话，不能重新登记为旧会话；请恢复匹配的能力数据库。', 409);
    validateHistoryEvidence(entries, workspaceId, id);
    sessions.push({ sessionId: id, workspaceId, seatId: workspace.seatId });
  }
  if (index && Object.keys(index.sessionBindings).some(id => !seen.has(id))) throw new RequestError('CAPABILITY_MIGRATION_CONFLICT', '已登记会话文件缺失，迁移未开始。', 409);
  const authPath = join(dataDir, 'collaboration', 'collaboration.sqlite');
  const authStat = await statOptional(authPath); let authSchemaVersion: number | null = null;
  if (authStat) {
    if (!authStat.isFile() || authStat.isSymbolicLink() || authStat.nlink !== 1) throw stateError();
    const db = new DatabaseSync(authPath, { readOnly: true });
    try {
      if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw stateError();
      authSchemaVersion = Number(db.prepare('PRAGMA user_version').get()?.user_version);
    } finally { db.close(); }
  }
  return { sessions, authSchemaVersion };
}

/** Full stopped-root backup verification includes binary databases, not just the workspace index. */
async function fileInventory(directory: string, prefix = ''): Promise<FileDigest[]> {
  await checkDirectory(directory);
  const result: FileDigest[] = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name); const child = prefix ? `${prefix}/${entry.name}` : entry.name;
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory() || stat.isFile() && stat.nlink !== 1) throw stateError();
    if (stat.isDirectory()) result.push(...await fileInventory(path, child));
    else result.push({ path: child, size: stat.size, digest: createHash('sha256').update(await readFile(path)).digest('hex') });
  }
  return result;
}

function authStage(db: DatabaseSync, digest: string, stage: 'prepared' | 'completed') {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts'").get()) return;
  db.exec(`CREATE TABLE IF NOT EXISTS capability_role_migrations(name TEXT PRIMARY KEY,input_digest TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('prepared','completed')))`);
  const prior = db.prepare("SELECT input_digest FROM capability_role_migrations WHERE name='r1'").get();
  if (prior && prior.input_digest !== digest) throw stateError();
  db.prepare("INSERT INTO capability_role_migrations VALUES('r1',?,?) ON CONFLICT(name) DO UPDATE SET state=excluded.state").run(digest, stage);
}

export async function migrateCapabilities(options: CapabilityMigrationOptions) {
  if (!isAbsolute(options.dataDir) || !isAbsolute(options.backupDir) || resolve(options.dataDir) === '/') throw new Error('迁移需要有效的绝对数据目录和备份目录。');
  if (options.apply && !options.serviceStopped) throw new Error('请先停止服务，并明确传入 --service-stopped。');
  await checkDirectory(options.dataDir); await checkDirectory(dirname(options.backupDir));
  const sourceDir = await realpath(options.dataDir);
  const backupDir = join(await realpath(dirname(options.backupDir)), resolve(options.backupDir).split('/').at(-1)!);
  for (const [from, to] of [[sourceDir, backupDir], [backupDir, sourceDir]]) {
    const path = relative(from, to); if (!path || !path.startsWith('..') && !isAbsolute(path)) throw new Error('备份目录必须独立于数据目录。');
  }
  const markerPath = join(sourceDir, 'migrations', markerName);
  const priorRaw = await optionalText(markerPath, 16 * 1024 * 1024);
  let report = priorRaw ? decodeRecord(priorRaw) : undefined;
  if (report && (report.sourceDir !== sourceDir || report.backupDir !== backupDir)) throw new Error('请使用原迁移的数据目录和备份目录继续。');
  if (report?.stage === 'completed') return { stage: options.apply ? 'completed' : 'dry-run', sessions: report.legacySessions.length, backupDigest: report.backupDigest, resumed: true };
  if (!report && await statOptional(join(sourceDir, 'capabilities', 'capabilities.sqlite'))) throw new RequestError('CAPABILITY_MIGRATION_CONFLICT', '数据目录已使用新能力库，不能重新划定旧会话边界；登记配置请使用受控同步命令。', 409);
  const skills = await loadControlledSkills(controlledSkillIds);
  const roles = await loadAgentRoles(options.rolesDir);
  const definitionDigest = hashContent(JSON.stringify({ skills: skills.map(({ id, hash }) => ({ id, hash })), roles: roles.map(({ name, hash }) => ({ name, hash })) }));
  if (report && report.definitionDigest !== definitionDigest) throw new RequestError('CAPABILITY_MIGRATION_CONFLICT', '迁移期间受控配置发生变化，请恢复原配置后继续。', 409);
  if (!report) {
    const inspected = await inventory(sourceDir); const sourceFiles = await fileInventory(sourceDir);
    const backupDigest = hashContent(JSON.stringify(sourceFiles));
    const inputDigest = hashContent(JSON.stringify({ sourceDir, backupDir, backupDigest, sessions: inspected.sessions, definitionDigest }));
    report = { schemaVersion: 1, stage: 'prepared', sourceDir, backupDir, inputDigest, backupDigest, legacySessions: inspected.sessions, sourceFiles, authSchemaVersion: inspected.authSchemaVersion, definitionDigest };
  }
  if (!options.apply) return { stage: 'dry-run', sessions: report.legacySessions.length, authSchemaVersion: report.authSchemaVersion, roles: roles.map(role => role.name), skills: skills.map(skill => skill.id), backupDigest: report.backupDigest };
  if (priorRaw) {
    const current = await inventory(sourceDir);
    if (JSON.stringify(current.sessions) !== JSON.stringify(report.legacySessions)) throw new Error('迁移准备后的会话归属已变化，保留现场并停止恢复。');
    for (const file of report.sourceFiles.filter(file => file.path === 'workspace-index.json' || file.path.startsWith('sessions/'))) {
      const content = await readFile(join(sourceDir, file.path));
      if (content.length !== file.size || createHash('sha256').update(content).digest('hex') !== file.digest) throw new Error('迁移准备后的历史或工作区索引已变化，保留现场并停止恢复。');
    }
  }
  if (!await statOptional(backupDir)) await cp(sourceDir, backupDir, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
  if (hashContent(JSON.stringify(await fileInventory(backupDir))) !== report.backupDigest) throw new Error('完整备份校验失败；未覆盖备份，也不会重新执行用户工作。');
  if (!priorRaw) {
    await mkdir(dirname(markerPath), { recursive: true, mode: 0o700 }); await checkDirectory(dirname(markerPath));
    await atomicWrite(markerPath, JSON.stringify(report));
  }
  await options.hooks?.afterPrepared?.();
  const capabilities = await CapabilityService.open(sourceDir, { allowPrepared: true });
  try {
    capabilities.beginMigration(report.inputDigest);
    const authPath = join(sourceDir, 'collaboration', 'collaboration.sqlite');
    if (await statOptional(authPath)) {
      const db = new DatabaseSync(authPath);
      try {
        db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL');
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts'").get()) {
          authStage(db, report.inputDigest, 'prepared');
          CapabilityRoles.migrate(db);
        }
      } finally { db.close(); }
    }
    await options.hooks?.afterAuth?.();
    await capabilities.registerBuiltins({ skills, roles });
    capabilities.registerLegacySessions(report.legacySessions);
    if (await statOptional(authPath)) {
      const db = new DatabaseSync(authPath);
      try { db.exec('PRAGMA synchronous=FULL'); authStage(db, report.inputDigest, 'completed'); }
      finally { db.close(); }
    }
    capabilities.completeMigration(report.inputDigest);
    report.stage = 'completed'; await atomicWrite(markerPath, JSON.stringify(report));
  } finally { capabilities.close(); }
  return { stage: 'completed', sessions: report.legacySessions.length, backupDigest: report.backupDigest, resumed: Boolean(priorRaw) };
}
