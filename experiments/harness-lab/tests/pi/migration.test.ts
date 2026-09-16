import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { migrateWorkspace } from '../../src/pi/migration.js';
import { PiLab } from '../../src/pi/lab.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';
import { WorkspaceStore } from '../../src/workspaces/store.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.restoreAllMocks(); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'berserk-migration-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const dataDir = join(root, 'data'); const backupDir = join(root, 'backup'); const sessionDir = join(dataDir, 'sessions');
  await mkdir(sessionDir, { recursive: true });
  const sessions = [];
  for (const kind of ['empty', 'completed', 'incomplete']) {
    let manager = SessionManager.create(dataDir, sessionDir); const path = manager.getSessionFile()!;
    await writeFile(path, `${JSON.stringify(manager.getHeader())}\n`); manager = SessionManager.open(path, sessionDir);
    if (kind !== 'empty') manager.appendMessage({ role: 'user', content: '旧会话标记', timestamp: Date.now() });
    if (kind === 'completed') manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: '旧回答' }], api: 'openai-completions', provider: 'test-local', model: 'deterministic-model', timestamp: Date.now(), stopReason: 'stop', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    sessions.push({ kind, id: manager.getSessionId(), path, before: await readFile(path, 'utf8') });
  }
  await writeFile(join(sessionDir, 'corrupt.jsonl'), '{broken');
  return { root, dataDir, backupDir, sessions };
}
describe('explicit stopped-service migration', () => {
  it('requires migration and backup, preserves native IDs/files, resumes history and ignores unbound files', async () => {
    const { dataDir, backupDir, sessions } = await setup();
    await expect(WorkspaceStore.open(dataDir)).rejects.toMatchObject({ code: 'MIGRATION_REQUIRED' });
    const dry = await migrateWorkspace({ dataDir, backupDir, apply: false, serviceStopped: false });
    expect(dry.files.filter(file => file.sessionId)).toHaveLength(3);
    expect(await readdir(dataDir)).not.toContain('workspace-index.json');
    await expect(migrateWorkspace({ dataDir, backupDir, apply: true, serviceStopped: false })).rejects.toThrow(/停止服务/);
    const completed = await migrateWorkspace({ dataDir, backupDir, apply: true, serviceStopped: true });
    expect(completed.stage).toBe('completed');
    const repeat = await migrateWorkspace({ dataDir, backupDir, apply: true, serviceStopped: true });
    expect(repeat.workspace.id).toBe(completed.workspace.id);
    for (const session of sessions) expect(await readFile(session.path, 'utf8')).toBe(session.before);
    expect(await readFile(join(backupDir, 'sessions/corrupt.jsonl'), 'utf8')).toBe('{broken');
    const config = testConfig(dataDir); const fake = await fakeRuntime(config, () => ({ text: '继续完成' }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lab = await PiLab.create(config, fake.runtime); cleanup.push(() => lab.close());
    expect(lab.list()).toHaveLength(3);
    expect(lab.get(sessions.find(item => item.kind === 'incomplete')!.id).recoveryWarning).toBeTruthy();
    const done = sessions.find(item => item.kind === 'completed')!;
    await lab.start(done.id, '继续').run(() => {});
    expect(JSON.stringify(fake.calls[0].context.messages)).toContain('旧会话标记');
    expect(lab.get(done.id).messages.filter(message => message.text === '旧会话标记')).toHaveLength(1);
    const file = join(dataDir, 'sessions/unbound.jsonl'); const extra = SessionManager.create(dataDir, join(dataDir, 'sessions'));
    await writeFile(file, JSON.stringify(extra.getHeader()) + '\n');
    const restored = await PiLab.create(config, fake.runtime); cleanup.push(() => restored.close());
    expect(restored.list()).toHaveLength(3);
  });
  it.each(['prepared', 'indexed'] as const)('resumes after %s without rescanning or new workspace IDs', async stage => {
    const { dataDir, backupDir } = await setup();
    await expect(migrateWorkspace({ dataDir, backupDir, apply: true, serviceStopped: true, afterStage: async current => { if (current === stage) throw new Error('injected interruption'); } })).rejects.toThrow('injected interruption');
    const report = JSON.parse(await readFile(join(dataDir, 'migrations/workspace-v1.json'), 'utf8'));
    await expect(WorkspaceStore.open(dataDir)).rejects.toMatchObject({ code: 'RESOURCE_STATE_INVALID' });
    const resumed = await migrateWorkspace({ dataDir, backupDir, apply: true, serviceStopped: true });
    expect(resumed.workspace.id).toBe(report.workspace.id);
    expect((await WorkspaceStore.open(dataDir)).list().workspaces).toHaveLength(1);
  });
  it('does not migrate after backup conflicts, changed legacy files, or damaged index', async () => {
    const first = await setup(); await mkdir(first.backupDir);
    await expect(migrateWorkspace({ ...first, apply: true, serviceStopped: true })).rejects.toThrow(/备份目录已存在/);
    expect(await readdir(first.dataDir)).not.toContain('workspace-index.json');
    const second = await setup();
    await expect(migrateWorkspace({ ...second, apply: true, serviceStopped: true, afterStage: async () => { throw new Error('stop'); } })).rejects.toThrow();
    await writeFile(second.sessions[0].path, '{}');
    await expect(migrateWorkspace({ ...second, apply: true, serviceStopped: true })).rejects.toThrow(/已变化/);
    const third = await setup(); await migrateWorkspace({ ...third, apply: true, serviceStopped: true });
    await writeFile(join(third.dataDir, 'workspace-index.json'), '{}');
    await expect(migrateWorkspace({ ...third, apply: true, serviceStopped: true })).rejects.toMatchObject({ code: 'RESOURCE_STATE_INVALID' });
  });
});
