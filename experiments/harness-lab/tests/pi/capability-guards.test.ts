import { randomUUID } from 'node:crypto';
import { AccessStore } from '../../src/access/store.js';
import { openDatabase } from '../../src/access/database.js';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PiLab } from '../../src/pi/lab.js';
import { EXPERT_BINDING, EXECUTION_MANIFEST } from '../../src/pi/capability-history.js';
import { validateHistoryEvidence } from '../../src/pi/history-evidence.js';
import { SKILL_ENTRY } from '../../src/pi/resource-tools.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup(reply: Parameters<typeof fakeRuntime>[1], roles = false, authenticated = false) {
  const dataDir = await mkdtemp(join(tmpdir(), 'axon-capability-guards-'));
  cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
  const agentRolesDir = join(dataDir, 'controlled-roles');
  if (roles) { await mkdir(agentRolesDir); await writeFile(join(agentRolesDir, 'reviewer.md'), roleContent('ROLE-OLD')); }
  if (authenticated) {
    const db = await openDatabase(dataDir); const store = new AccessStore(db);
    try { await store.saveAccount({ username: 'guard-user', displayName: 'Guard user', seatId: 'guard-seat', seatName: 'Guard seat', password: 'test-password-123', createPublicTask: false, manageModelSettings: false }); }
    finally { db.close(); }
  }
  const config = testConfig(dataDir, { ...(roles ? { agentRolesDir } : {}), ...(authenticated ? { seatId: 'guard-seat', auth: { secret: 'guard-test-only-secret-at-least-32-characters', sessionMs: 28800000 } } : {}) });
  const fake = await fakeRuntime(config, reply); const lab = await PiLab.create(config, fake.runtime);
  cleanup.push(() => lab.close());
  let userId: string | undefined, workspaceId: string | undefined;
  if (authenticated) {
    const identity = lab.access!.identityForSeat('guard-seat')!; userId = identity.userId;
    const task = lab.access!.create(identity, { title: 'Guard private space', goal: '', visibility: 'private', clientActionId: randomUUID() });
    workspaceId = (await lab.workspaces.ensureWorkspace(task.id, identity.seatId, task.title)).id;
  }
  return { lab, fake, config, agentRolesDir, userId, workspaceId };
}
function roleContent(marker: string) {
  return `---\nname: reviewer\ndescription: 受控只读检查\ntools: source_list, source_read, instructions_read, skill_read\n---\n${marker}\n`;
}
async function native(lab: PiLab, sessionId: string) {
  const dir = join(lab.config.dataDir, 'sessions');
  const name = (await readdir(dir)).find(name => name.endsWith(`_${sessionId}.jsonl`))!;
  return { file: join(dir, name), manager: SessionManager.open(join(dir, name), dir) };
}

describe('independent capability guard regressions through actual Pi loops', () => {
  it.each(['disabled', 'banned', 'revoked'] as const)('refuses autonomous skill_read when its method is %s', async state => {
    const { lab, fake, userId, workspaceId } = await setup((_context, index) => index === 0
      ? { tools: [{ name: 'skill_read', arguments: { id: 'review' } }] } : { text: '不应调用此模型步骤' }, false, true);
    const session = await lab.createSession(workspaceId, undefined, undefined, undefined, undefined, { userId });
    if (state === 'revoked') lab.capabilities.setAccess(userId!, 'review', false);
    else lab.capabilities.setState({ expertId: 'review' }, state);
    await lab.start(session.id, '自主选择方法', {}, undefined, undefined, userId).run(() => {});
    expect(fake.calls, JSON.stringify(lab.get(session.id).lastResult)).toHaveLength(1);
    expect(lab.get(session.id).lastResult?.status).toBe('failed');
    const entries = (await native(lab, session.id)).manager.getEntries();
    expect(entries.some(entry => entry.type === 'custom' && entry.customType === SKILL_ENTRY)).toBe(false);
    expect(lab.get(session.id).messages.some(message => message.toolName === 'skill.read' && !message.isError)).toBe(false);
  });

  it('does not call a banned delegated specialist even when the parent assistant is enabled', async () => {
    const { lab, fake } = await setup((_context, index) => index === 0
      ? { tools: [{ name: 'subagent', arguments: { agent: 'reviewer', task: '检查固定目标' } }] } : { text: '不应执行子专家' }, true);
    const session = await lab.createSession();
    lab.capabilities.setState({ expertId: 'role-reviewer' }, 'banned');
    await lab.start(session.id, '委派检查').run(() => {});
    expect(fake.calls).toHaveLength(1);
    expect(lab.get(session.id).lastResult?.status).toBe('failed');
    expect(lab.get(session.id).subagents?.some(child => child.status === 'succeeded')).not.toBe(true);
  });

  it('binds a delegated manifest to the parent-fixed role when another request updates the same role', async () => {
    const { lab, fake, agentRolesDir, config } = await setup(context => {
      const last = context.messages.at(-1);
      const text = JSON.stringify(last);
      return last?.role === 'user' && text.includes('old-parent')
        ? { tools: [{ name: 'subagent', arguments: { agent: 'reviewer', task: 'fixed-child-task' } }] }
        : { text: '已完成固定范围' };
    }, true);
    const oldSession = await lab.createSession(); const newSession = await lab.createSession();
    const originalPrompt = AgentSession.prototype.prompt;
    let release!: () => void, ready!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const prepared = new Promise<void>(resolve => { ready = resolve; });
    vi.spyOn(AgentSession.prototype, 'prompt').mockImplementation(async function (this: AgentSession, ...args) {
      if (args[0] === 'old-parent') { ready(); await gate; }
      return originalPrompt.apply(this, args);
    });
    const oldWork = lab.start(oldSession.id, 'old-parent').run(() => {});
    await prepared;
    const oldRevision = await lab.capabilities.current('role-reviewer');
    await writeFile(join(agentRolesDir, 'reviewer.md'), roleContent('ROLE-NEW'));
    await lab.start(newSession.id, 'new-parent').run(() => {});
    expect((await lab.capabilities.current('role-reviewer')).revisionId).not.toBe(oldRevision.revisionId);
    release(); await oldWork;
    expect(lab.get(oldSession.id).lastResult?.status).toBe('succeeded');
    const childCall = fake.calls.find(call => JSON.stringify(call.context.messages.at(-1)).includes('fixed-child-task'))!;
    expect(childCall.context.systemPrompt).toContain('ROLE-OLD');
    expect(childCall.context.systemPrompt).not.toContain('ROLE-NEW');
    const child = lab.get(oldSession.id).subagents![0];
    const childDir = join(lab.config.dataDir, 'subagents', oldSession.id, child.subagentId);
    const childName = (await readdir(childDir)).find(name => name.endsWith('.jsonl'))!;
    const manifest = SessionManager.open(join(childDir, childName), childDir).getEntries().find(entry => entry.type === 'custom' && entry.customType === EXECUTION_MANIFEST);
    expect(manifest?.type === 'custom' && manifest.data).toMatchObject({ expertRef: { expertId: 'role-reviewer', revisionId: oldRevision.revisionId }, digest: oldRevision.digest });
    await lab.close(); const restored = await PiLab.create(config, fake.runtime); cleanup.push(() => restored.close());
    expect(restored.get(oldSession.id).subagents?.[0].status).toBe('succeeded');
    expect(restored.get(oldSession.id).recoveryWarning).toBeUndefined();
  });

  it('checks fixed revision metadata on a hot multiround request before calling the provider', async () => {
    const { lab, fake } = await setup(() => ({ text: '首次正常回答' }));
    const session = await lab.createSession();
    await lab.start(session.id, '首次请求').run(() => {});
    expect(fake.calls).toHaveLength(1);
    lab.capabilities.db.prepare('UPDATE revisions SET digest=? WHERE revision_id=?').run('0'.repeat(64), session.expert!.revisionId);
    await lab.start(session.id, '摘要损坏后不允许继续').run(() => {});
    expect(fake.calls).toHaveLength(1);
    expect(lab.get(session.id).lastResult?.status).toBe('failed');
  });

  it('rejects a nonlegacy binding moved behind work and refuses a forged legacy flag on restart', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { lab, fake, config } = await setup(() => ({ text: '已保存历史' }));
    const session = await lab.createSession();
    await lab.start(session.id, '真实工作').run(() => {});
    const { file, manager } = await native(lab, session.id); const entries = manager.getBranch();
    const binding = entries.find(entry => entry.type === 'custom' && entry.customType === EXPERT_BINDING)!;
    expect(() => validateHistoryEvidence([...entries.filter(entry => entry !== binding), binding], session.workspaceId, session.id)).toThrow();
    await lab.close();
    const lines = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    lines.find(line => line.customType === EXPERT_BINDING).data.legacy = true;
    await writeFile(file, lines.map(line => JSON.stringify(line)).join('\n') + '\n');
    const before = await readFile(file, 'utf8');
    const restored = await PiLab.create(config, fake.runtime); cleanup.push(() => restored.close());
    expect(() => restored.start(session.id, '禁止降级')).toThrow();
    expect(fake.calls).toHaveLength(1);
    expect(await readFile(file, 'utf8')).toBe(before);
  });
});
