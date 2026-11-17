import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { openDatabase } from '../../src/access/database.js';
import { AccessStore } from '../../src/access/store.js';
import { migrateAdministratorAccounts } from '../../src/access/administrator-schema.js';
import { SystemRoles } from '../../src/access/system-roles.js';
import { PiLab } from '../../src/pi/lab.js';
import * as methods from '../../src/authoring/management-skills.js';
import { COMPOSER_INPUT, COMPOSER_INPUT_V2, COMPOSER_INPUT_V3, COMPOSER_INPUT_V4, COMPOSER_INPUT_V5, COMPOSER_INPUT_V6, COMPOSER_INPUT_V7, COMPOSER_INPUT_V8, decodeComposerInput } from '../../src/pi/composer-input.js';
import { decodeResourceRecord } from '../../src/pi/history-evidence.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';

test('management catalog rechecks a revoked administrator after its asynchronous file read', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'axon-management-review-'));
  let lab: PiLab | undefined;
  let release: (() => void) | undefined;
  try {
    const db = await openDatabase(dir), access = new AccessStore(db);
    migrateAdministratorAccounts(db);
    const adminId = await access.saveAdministratorAccount({ username: 'review-admin', displayName: '合成管理员', password: 'test-password-123' });
    db.close();
    const config = testConfig(dir, { auth: { secret: 'review-only-session-signing-secret-at-least-32', sessionMs: 28800000 } });
    const fake = await fakeRuntime(config, () => ({ text: '不应调用模型。' }));
    lab = await PiLab.create(config, fake.runtime);
    const who = lab.access!.workspaceIdentity(adminId)!;
    const task = lab.access!.create(who, { title: '本人私有空间', goal: '', visibility: 'private', clientActionId: randomUUID() });
    const workspace = await lab.workspaces.create(task.title, task.id, who.seatId);
    const original = methods.loadManagementSkills;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const paused = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(methods, 'loadManagementSkills').mockImplementation(async ids => {
      const files = await original(ids);
      entered(); await paused;
      return files;
    });
    const pending = lab.managementSkills(adminId, workspace.id, who.seatId);
    await started;
    new SystemRoles(lab.access!.db).revoke('review-admin');
    if (!release) throw new Error('管理方法读取未进入暂停点。');
    release();
    await expect(pending).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(fake.calls).toHaveLength(0);
  } finally {
    release?.(); vi.restoreAllMocks(); await lab?.close(); await rm(dir, { recursive: true, force: true });
  }
});

test('new method history rejects downgraded, cross-catalog and tampered bodies without weakening legacy versions', async () => {
  const [method, other] = await methods.loadManagementSkills();
  const workspaceId = randomUUID(), sessionId = randomUUID(), requestId = randomUUID();
  const input = { workspaceId, sessionId, requestId, skill: method };
  expect(decodeComposerInput(input, workspaceId, sessionId, COMPOSER_INPUT_V8)).toEqual(input);
  for (const version of [COMPOSER_INPUT, COMPOSER_INPUT_V2, COMPOSER_INPUT_V3, COMPOSER_INPUT_V4, COMPOSER_INPUT_V5, COMPOSER_INPUT_V6, COMPOSER_INPUT_V7]) {
    expect(() => decodeComposerInput(input, workspaceId, sessionId, version)).toThrow();
  }
  expect(() => decodeComposerInput({ ...input, skill: { ...method, content: method.content + '\n被替换的正文' } }, workspaceId, sessionId, COMPOSER_INPUT_V8)).toThrow();
  expect(() => decodeComposerInput({ ...input, skill: { ...method, revisionId: 'uploaded-revision' } }, workspaceId, sessionId, COMPOSER_INPUT_V8)).toThrow();
  const { content: _body, ...metadata } = method; void _body;
  const resource = { schemaVersion: 3, status: 'available', workspaceId, requestId,
    instructions: [{ fileId: 'common', name: '通用', hash: null, content: '', editable: false }, { fileId: 'workspace', name: '项目', hash: null, content: '', editable: true }],
    skills: [metadata], readSkills: [method], editableFileIds: ['workspace'] };
  expect(decodeResourceRecord(resource, workspaceId)).toMatchObject({ schemaVersion: 3 });
  expect(() => decodeResourceRecord({ ...resource, readSkills: [other] }, workspaceId)).toThrow();
  expect(() => decodeResourceRecord(resource, workspaceId, true)).toThrow();
});
