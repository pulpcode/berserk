import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceStore } from '../src/workspaces/store.js';
import { CapabilityService } from '../src/capabilities/service.js';
import { CapabilityRoles } from '../src/access/capability-roles.js';
import { assertCapabilityMigrationReady, migrateCapabilities } from '../src/pi/capability-migration.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'axon-capability-migration-')); roots.push(root);
  const dataDir = join(root, 'data'), backupDir = join(root, 'backup');
  const workspaces = await WorkspaceStore.open(dataDir);
  const directory = join(dataDir, 'sessions');
  let manager = SessionManager.create(dataDir, directory);
  const path = manager.getSessionFile()!; await writeFile(path, `${JSON.stringify(manager.getHeader())}\n`);
  manager = SessionManager.open(path, directory);
  manager.appendMessage({ role: 'user', content: '必须保留的历史', timestamp: Date.now() });
  await workspaces.bind(manager.getSessionId(), workspaces.list().defaultWorkspaceId);
  await mkdir(join(dataDir, 'collaboration'));
  const authPath = join(dataDir, 'collaboration', 'collaboration.sqlite');
  const db = new DatabaseSync(authPath);
  db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY,username TEXT,display_name TEXT,enabled INTEGER); PRAGMA user_version=18'); db.close();
  return { root, dataDir, backupDir, path, sessionId: manager.getSessionId(), workspaceId: workspaces.list().defaultWorkspaceId, authPath };
}
async function tree(path: string, prefix = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, await tree(join(path, entry.name), name));
    else result[name] = (await readFile(join(path, entry.name))).toString('base64');
  }
  return result;
}

describe('capability stopped-root migration', () => {
  it('performs a write-free dry-run, full backup and repeatable apply without changing any history or schema family', async () => {
    const options = await setup(); const before = await tree(options.dataDir);
    await expect(assertCapabilityMigrationReady(options.dataDir)).rejects.toMatchObject({ code: 'CAPABILITY_MIGRATION_REQUIRED' });
    expect(await migrateCapabilities({ ...options, apply: false, serviceStopped: false })).toMatchObject({ stage: 'dry-run', sessions: 1, authSchemaVersion: 18 });
    expect(await tree(options.dataDir)).toEqual(before);
    await expect(migrateCapabilities({ ...options, apply: true, serviceStopped: false })).rejects.toThrow('停止服务');
    const applied = await migrateCapabilities({ ...options, apply: true, serviceStopped: true });
    expect(applied).toMatchObject({ stage: 'completed', sessions: 1 });
    expect(await tree(options.backupDir)).toEqual(before);
    expect(await readFile(options.path, 'base64')).toBe(before[`sessions/${options.path.split('/').at(-1)}`]);
    await expect(assertCapabilityMigrationReady(options.dataDir)).resolves.toBeUndefined();
    const capabilities = await CapabilityService.open(options.dataDir);
    try { expect(capabilities.isLegacySession(options.sessionId, options.workspaceId, 'test-seat')).toBe(true); }
    finally { capabilities.close(); }
    const db = new DatabaseSync(options.authPath);
    try {
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(18);
      expect(new CapabilityRoles(db).list()).toEqual([]);
      expect(db.prepare('SELECT state FROM capability_role_migrations').get()?.state).toBe('completed');
    } finally { db.close(); }
    expect(await migrateCapabilities({ ...options, apply: true, serviceStopped: true })).toMatchObject({ ...applied, resumed: true });
    expect((await WorkspaceStore.open(options.backupDir)).binding(options.sessionId)).toBe(options.workspaceId);
  });

  it.each(['afterPrepared', 'afterAuth'] as const)('blocks startup after %s and resumes using the original plan and session IDs', async stage => {
    const options = await setup();
    await expect(migrateCapabilities({ ...options, apply: true, serviceStopped: true, hooks: { [stage]: async () => { throw new Error('injected stop'); } } })).rejects.toThrow('injected stop');
    await expect(assertCapabilityMigrationReady(options.dataDir)).rejects.toMatchObject({ code: 'CAPABILITY_MIGRATION_INCOMPLETE' });
    expect(await migrateCapabilities({ ...options, apply: true, serviceStopped: true })).toMatchObject({ stage: 'completed', resumed: true, sessions: 1 });
    await expect(assertCapabilityMigrationReady(options.dataDir)).resolves.toBeUndefined();
  });

  it('rejects unbound/corrupt/new-format files and changed prepared history rather than guessing or replaying', async () => {
    const unbound = await setup();
    const indexPath = join(unbound.dataDir, 'workspace-index.json');
    const index = JSON.parse(await readFile(indexPath, 'utf8')); index.sessionBindings = {}; await writeFile(indexPath, JSON.stringify(index));
    await expect(migrateCapabilities({ ...unbound, apply: false, serviceStopped: false })).rejects.toMatchObject({ code: 'CAPABILITY_MIGRATION_CONFLICT' });
    const corrupt = await setup(); await writeFile(corrupt.path, '{invalid');
    await expect(migrateCapabilities({ ...corrupt, apply: false, serviceStopped: false })).rejects.toThrow();
    const fresh = await setup(); const manager = SessionManager.open(fresh.path);
    manager.appendCustomEntry('berserk.expert-binding.v1', {});
    await expect(migrateCapabilities({ ...fresh, apply: false, serviceStopped: false })).rejects.toMatchObject({ code: 'CAPABILITY_MIGRATION_CONFLICT' });
    const changed = await setup();
    await expect(migrateCapabilities({ ...changed, apply: true, serviceStopped: true, hooks: { afterPrepared: async () => { throw new Error('stop'); } } })).rejects.toThrow('stop');
    const original = await readFile(changed.path, 'utf8'); await writeFile(changed.path, original.replace('必须保留的历史', '被外部修改的历史'));
    await expect(migrateCapabilities({ ...changed, apply: true, serviceStopped: true })).rejects.toThrow('已变化');
  });
});
