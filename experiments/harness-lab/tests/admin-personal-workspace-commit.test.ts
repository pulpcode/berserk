import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { openDatabase } from '../src/access/database.js';
import { migrateAdministratorAccounts } from '../src/access/administrator-schema.js';
import { AccessStore } from '../src/access/store.js';
import { SystemRoles } from '../src/access/system-roles.js';
import { WorkspaceStore } from '../src/workspaces/store.js';

const fault = vi.hoisted(() => ({ beforeRename: undefined as (() => void) | undefined }));
vi.mock('../src/resources/files.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/resources/files.js')>();
  return { ...original, atomicWrite: (...[path, content, signal, hooks = {}]: Parameters<typeof original.atomicWrite>) => original.atomicWrite(path, content, signal, {
    ...hooks,
    beforeRename: async () => {
      if (path.endsWith('/workspace-index.json')) fault.beforeRename?.();
      await hooks.beforeRename?.();
    },
  }) };
});

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { fault.beforeRename = undefined; for (const close of cleanup.splice(0).reverse()) await close(); });

test.each(['workspace', 'session'] as const)('role withdrawal before %s index rename prevents publishing ownership', async kind => {
  const dataDir = await mkdtemp(join(tmpdir(), 'axon-admin-personal-commit-'));
  cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
  const db = await openDatabase(dataDir); cleanup.push(async () => db.close());
  const access = new AccessStore(db); migrateAdministratorAccounts(db);
  const id = await access.saveAdministratorAccount({ username: 'admin', displayName: '管理员', password: 'test-password-123' });
  const actor = access.workspaceIdentity(id)!;
  const task = access.create(actor, { title: '个人空间', goal: '', visibility: 'private', clientActionId: randomUUID() });
  const workspaces = await WorkspaceStore.open(dataDir, 'test-seat', true); workspaces.access = access;
  const workspace = kind === 'session' ? await workspaces.ensureWorkspace(task.id, actor.seatId, task.title) : undefined;
  const indexBefore = await readFile(join(dataDir, 'workspace-index.json'), 'utf8');
  fault.beforeRename = () => new SystemRoles(db).revoke('admin');
  const pending = workspace ? workspaces.bind(randomUUID(), workspace.id, actor.seatId) : workspaces.ensureWorkspace(task.id, actor.seatId, task.title);
  await expect(pending).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await readFile(join(dataDir, 'workspace-index.json'), 'utf8')).toBe(indexBefore);
  expect(workspaces.allBindings()).toEqual({});
  expect(workspaces.listAll()).toHaveLength(workspace ? 1 : 0);
  expect(access.canUseWorkspace(actor.seatId)).toBe(false);
});
