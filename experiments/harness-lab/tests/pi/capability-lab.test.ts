import { migrateCapabilityManagement } from '../../src/capabilities/management-migration.js';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PiLab } from '../../src/pi/lab.js';
import { EXPERT_BINDING, EXECUTION_MANIFEST } from '../../src/pi/capability-history.js';
import { migrateCapabilities } from '../../src/pi/capability-migration.js';
import { GENERAL_EXPERT_ID, SYNTHESIS_EXPERT_ID, type ExpertDefinition } from '../../src/capabilities/service.js';
import type { ExpertRevision } from '../../src/contracts/capabilities.js';
import type { Interaction, SkillFile } from '../../src/contracts/index.js';
import { hashContent } from '../../src/resources/files.js';
import { WorkspaceStore } from '../../src/workspaces/store.js';
import { DockerExecutionService, type DockerRunner } from '../../src/execution/docker.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup(reply: Parameters<typeof fakeRuntime>[1] = () => ({ text: '已完成' }), docker = false) {
  const root = await mkdtemp(join(tmpdir(), 'axon-expert-lab-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const config = testConfig(join(root, 'data')); const fake = await fakeRuntime(config, reply);
  const commands: string[] = [];
  const runner: DockerRunner = async (args, options) => {
    if (args[0] === 'info') return { code: 0, stdout: Buffer.from('linux'), stderr: Buffer.alloc(0) };
    if (args[0] === 'exec' && args.includes('/opt/berserk/command.py')) commands.push(options?.input?.toString() ?? '');
    return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  };
  const lab = await PiLab.create(config, fake.runtime, docker ? new DockerExecutionService({ instanceId: config.dataDir }, runner) : undefined);
  cleanup.push(() => lab.close());
  return { root, config, fake, lab, commands };
}
function skill(marker: string): SkillFile {
  const content = `---\nname: synthesis\ndescription: 固定资料综合方法\n---\n${marker}\n`;
  return { id: 'synthesis', name: '资料综合写作', description: '固定资料综合方法', version: '1', hash: hashContent(content), content };
}
function definition(marker: string): ExpertDefinition {
  return { expertId: 'controlled-synthesis', releaseVersion: '1.0.0', name: '验收资料专家', description: '受控测试专家',
    instructions: marker, modes: ['interactive'], selectable: true, system: true,
    allowedTools: ['source_list', 'source_read', 'instructions_read', 'skill_read', 'ask_user'], skills: [skill(`SKILL-${marker}`)] };
}
function selection(expert: ExpertRevision, clientActionId = randomUUID()) {
  return { expertRef: { expertId: expert.expertId, revisionId: expert.revisionId }, expectedDigest: expert.digest, clientActionId };
}
async function native(dataDir: string, id: string) {
  const directory = join(dataDir, 'sessions'); const names = (await readdir(directory)).filter(name => name.endsWith(`_${id}.jsonl`));
  expect(names).toHaveLength(1); const path = join(directory, names[0]);
  return { path, manager: SessionManager.open(path, directory) };
}
const answer = (item: Interaction) => ({ requestId: item.requestId, kind: 'question', action: 'answer', answers: [{ questionId: 'format', text: '继续原任务' }] });

describe('expert capability integration through real Pi sessions', () => {
  it('lists only professional experts and creates an empty bound session without calling the model', async () => {
    const { lab, fake, config } = await setup();
    const catalog = await lab.capabilities.list();
    expect(catalog.map(expert => expert.expertId)).toEqual([SYNTHESIS_EXPERT_ID]);
    expect(catalog.some(expert => expert.expertId === GENERAL_EXPERT_ID || expert.modes.includes('delegated'))).toBe(false);
    const expert = await lab.capabilities.current(SYNTHESIS_EXPERT_ID);
    const selected = await lab.createSession(undefined, undefined, undefined, undefined, undefined, selection(expert));
    const general = await lab.createSession();
    expect(selected.expert?.expertId).toBe(SYNTHESIS_EXPERT_ID);
    expect(general.expert?.name).toBe('Axon 通用助手');
    expect(selected.messages).toEqual([]); expect(fake.calls).toEqual([]);
    const entries = (await native(config.dataDir, selected.id)).manager.getEntries();
    expect(entries.filter(entry => entry.type === 'custom' && entry.customType === EXPERT_BINDING)).toHaveLength(1);
    expect(entries.some(entry => entry.type === 'custom' && entry.customType === EXECUTION_MANIFEST)).toBe(false);
  });

  it('deduplicates concurrent and restarted retries before resolving the latest revision, and rejects changed parameters', async () => {
    const { lab, config, fake } = await setup(); const expert = await lab.capabilities.registerExpert(definition('EXPERT-R1'));
    const picked = selection(expert); const workspace = lab.workspaces.list().defaultWorkspaceId;
    const sessions = await Promise.all(Array.from({ length: 8 }, () => lab.createSession(workspace, undefined, undefined, undefined, undefined, picked)));
    expect(new Set(sessions.map(session => session.id)).size).toBe(1); expect(lab.list()).toHaveLength(1);
    const newer = await lab.capabilities.registerExpert(definition('EXPERT-R2'));
    expect(newer.revisionId).not.toBe(expert.revisionId);
    expect((await lab.createSession(workspace, undefined, undefined, undefined, undefined, picked)).id).toBe(sessions[0].id);
    await expect(lab.createSession(workspace, undefined, undefined, undefined, undefined, { ...selection(newer), clientActionId: picked.clientActionId })).rejects.toMatchObject({ code: 'SESSION_CREATION_CONFLICT', statusCode: 409 });
    await expect(lab.createSession(workspace, undefined, undefined, undefined, undefined, selection(expert))).rejects.toMatchObject({ code: 'EXPERT_CHANGED', statusCode: 409 });
    await lab.close(); const restored = await PiLab.create(config, fake.runtime); cleanup.push(() => restored.close());
    expect((await restored.createSession(workspace, undefined, undefined, undefined, undefined, picked)).id).toBe(sessions[0].id);
    expect(restored.list()).toHaveLength(1); expect(fake.calls).toEqual([]);
  });

  it('recovers an interrupted empty-session publication using its original intent and native ID without replaying work', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { lab, config, fake } = await setup(); const expert = await lab.capabilities.current(SYNTHESIS_EXPERT_ID);
    const picked = selection(expert); const workspace = lab.workspaces.list().defaultWorkspaceId;
    vi.spyOn(lab.workspaces, 'bind').mockRejectedValueOnce(new Error('injected publication interruption'));
    await expect(lab.createSession(workspace, undefined, undefined, undefined, undefined, picked)).rejects.toThrow('injected publication interruption');
    const intent = lab.capabilities.findCreation('seat:test-seat', picked.clientActionId)!;
    expect(intent.state).toBe('prepared'); expect(lab.list()).toEqual([]);
    const original = await native(config.dataDir, intent.sessionId);
    expect(original.manager.getEntries().filter(entry => entry.type === 'custom' && entry.customType === EXPERT_BINDING)).toHaveLength(1);
    await lab.close(); const restored = await PiLab.create(config, fake.runtime); cleanup.push(() => restored.close());
    const recovered = await restored.createSession(workspace, undefined, undefined, undefined, undefined, picked);
    expect(recovered.id).toBe(intent.sessionId); expect(recovered.messages).toEqual([]); expect(restored.list()).toHaveLength(1);
    expect((await native(config.dataDir, recovered.id)).manager.getEntries().filter(entry => entry.type === 'custom' && entry.customType === EXPERT_BINDING)).toHaveLength(1);
    expect(fake.calls).toEqual([]);
  });

  it('keeps actual instructions and skill bodies fixed across updates, multiple turns and restart while reading current workspace rules', async () => {
    const { lab, config, fake } = await setup(context => context.messages.at(-1)?.role === 'toolResult' ? { text: '已完成综合' } : { tools: [{ name: 'skill_read', arguments: { id: 'synthesis' } }] });
    const old = await lab.capabilities.registerExpert(definition('EXPERT-R1'));
    const session = await lab.createSession(undefined, undefined, undefined, undefined, undefined, selection(old));
    await lab.start(session.id, '第一轮资料综合').run(() => {});
    expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
    expect(fake.calls[0].context.systemPrompt?.match(/EXPERT-R1/g)).toHaveLength(1);
    expect(JSON.stringify(fake.calls[1].context.messages.filter(message => message.role === 'toolResult'))).toContain('SKILL-EXPERT-R1');
    expect(fake.calls[0].context.tools?.map(tool => tool.name)).not.toContain('instructions_update');
    const current = await lab.capabilities.registerExpert(definition('EXPERT-R2'));
    expect(current.releaseVersion).toBe(old.releaseVersion); expect(current.revisionId).not.toBe(old.revisionId);
    const rules = await lab.resources.readInstruction(session.workspaceId, 'workspace');
    await lab.resources.updateInstruction(session.workspaceId, 'workspace', 'CURRENT-WORKSPACE-RULE', rules.hash);
    await lab.close();
    const restored = await PiLab.create(config, fake.runtime); cleanup.push(() => restored.close());
    expect(restored.get(session.id).expert).toMatchObject({ revisionId: old.revisionId, updateAvailable: true });
    const oldOffset = fake.calls.length;
    await restored.start(session.id, '重启后第二轮').run(() => {});
    expect(restored.get(session.id).lastResult?.status).toBe('succeeded');
    expect(fake.calls[oldOffset].context.systemPrompt).toContain('EXPERT-R1');
    expect(fake.calls[oldOffset].context.systemPrompt).not.toContain('EXPERT-R2');
    expect(JSON.stringify(fake.calls[oldOffset].context)).toContain('CURRENT-WORKSPACE-RULE');
    expect(JSON.stringify(fake.calls.at(-1)!.context.messages.filter(message => message.role === 'toolResult').at(-1))).toContain('SKILL-EXPERT-R1');
    const fresh = await restored.createSession(undefined, undefined, undefined, undefined, undefined, selection(current)); const newOffset = fake.calls.length;
    await restored.start(fresh.id, '新修订第一轮').run(() => {});
    expect(fake.calls[newOffset].context.systemPrompt).toContain('EXPERT-R2');
    expect(JSON.stringify(fake.calls.at(-1)!.context.messages.filter(message => message.role === 'toolResult').at(-1))).toContain('SKILL-EXPERT-R2');
    const callsBeforeConflict = fake.calls.length;
    await restored.start(session.id, '显式选择不同修订', { skill: { id: 'synthesis', hash: skill('SKILL-EXPERT-R2').hash } }).run(() => {});
    expect(fake.calls).toHaveLength(callsBeforeConflict);
    expect(restored.get(session.id).lastResult).toMatchObject({ status: 'failed', message: expect.stringContaining('固定依赖') });
    const oldHistory = (await native(config.dataDir, session.id)).manager.getBranch();
    expect(oldHistory.filter(entry => entry.type === 'message' && entry.message.role === 'user')).toHaveLength(2);
  });

  it('lets an accepted request finish after ordinary disable while rejecting steering and all later work', async () => {
    const { lab, fake } = await setup((_context, index) => index === 0 ? { tools: [{ name: 'ask_user', arguments: { questions: [{ id: 'format', prompt: '请确认格式' }] } }] }
      : index === 1 ? { tools: [{ name: 'source_list', arguments: {} }] } : { text: '原请求已完成' });
    const session = await lab.createSession(); const running = lab.start(session.id, '先澄清再读取'); const done = running.run(() => {});
    await vi.waitFor(() => expect(lab.get(session.id).active?.phase).toBe('waiting_answer'));
    const interaction = lab.get(session.id).interactions!.find(item => item.status === 'pending')!;
    lab.capabilities.setState({ expertId: GENERAL_EXPERT_ID }, 'disabled', '部署维护');
    expect(() => lab.submitInput(session.id, { submissionId: randomUUID(), expectedRequestId: running.requestId, mode: 'steer', text: '追加扩大范围' })).toThrowError(expect.objectContaining({ code: 'EXPERT_UNAVAILABLE' }));
    lab.respondInteraction(session.id, interaction.interactionId, answer(interaction)); await done;
    expect(lab.get(session.id).lastResult?.status).toBe('succeeded'); expect(fake.calls).toHaveLength(3);
    expect(fake.calls[2].context.messages.some(message => message.role === 'toolResult' && message.toolName === 'source_list' && !message.isError)).toBe(true);
    expect(() => lab.start(session.id, '新工作')).toThrowError(expect.objectContaining({ code: 'EXPERT_UNAVAILABLE' }));
    await expect(lab.createSession()).rejects.toMatchObject({ code: 'EXPERT_UNAVAILABLE' });
    expect(lab.get(session.id).expert?.availability.available).toBe(false);
  });

  it('closes call admission before cancelling a pending confirmation and never executes an old approval after emergency ban', async () => {
    const { lab, fake, commands } = await setup((_context, index) => index === 0 ? { tools: [{ name: 'bash', arguments: { command: 'rm /workspace/test-file' } }] } : { text: '不得继续' }, true);
    const session = await lab.createSession(); const running = lab.start(session.id, '执行需确认命令'); const done = running.run(() => {});
    await vi.waitFor(() => expect(lab.get(session.id).active?.phase).toBe('waiting_confirmation'));
    const interaction = lab.get(session.id).interactions!.find(item => item.status === 'pending')!;
    expect(commands).toEqual([]);
    lab.capabilities.setState({ expertId: GENERAL_EXPERT_ID }, 'banned', '紧急维护');
    expect(() => lab.respondInteraction(session.id, interaction.interactionId, { requestId: running.requestId, kind: 'confirmation', decision: 'approve' })).toThrow();
    await done;
    expect(commands).toEqual([]); expect(fake.calls).toHaveLength(1);
    expect(lab.get(session.id).lastResult?.status).toBe('failed');
    expect(lab.get(session.id).interactions!.find(item => item.interactionId === interaction.interactionId)?.status).toBe('cancelled');
  });

  it('rechecks revocation after an approval was persisted and before the approved external tool begins', async () => {
    const { lab, fake, commands } = await setup((_context, index) => index === 0 ? { tools: [{ name: 'bash', arguments: { command: 'rm /workspace/test-file' } }] } : { text: '不得继续' }, true);
    const session = await lab.createSession(); const running = lab.start(session.id, '执行需确认命令');
    const done = running.run(event => {
      if (event.type === 'interaction.updated' && event.interaction.status === 'approved') lab.capabilities.setAccess('seat:test-seat', GENERAL_EXPERT_ID, false);
    });
    await vi.waitFor(() => expect(lab.get(session.id).active?.phase).toBe('waiting_confirmation'));
    const interaction = lab.get(session.id).interactions!.find(item => item.status === 'pending')!;
    expect(lab.respondInteraction(session.id, interaction.interactionId, { requestId: running.requestId, kind: 'confirmation', decision: 'approve' }).status).toBe('approved');
    await done;
    expect(commands).toEqual([]); expect(fake.calls).toHaveLength(1); expect(lab.get(session.id).lastResult?.status).toBe('failed');
    expect(lab.get(session.id).interactions!.find(item => item.interactionId === interaction.interactionId)).toMatchObject({ status: 'approved', execution: 'not_started' });
  });

  it.each(['missing-binding', 'forged-digest', 'missing-revision'] as const)('preserves %s evidence but refuses a new-format session on restart', async damage => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { lab, config, fake } = await setup(); const expert = await lab.capabilities.registerExpert(definition('EXPERT-R1'));
    const session = await lab.createSession(undefined, undefined, undefined, undefined, undefined, selection(expert));
    const file = (await native(config.dataDir, session.id)).path; await lab.close();
    if (damage === 'missing-revision') await rm(join(config.dataDir, 'capabilities', 'blobs', expert.digest));
    else {
      const lines = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      const changed = lines.filter(line => damage !== 'missing-binding' || line.customType !== EXPERT_BINDING);
      if (damage === 'forged-digest') changed.find(line => line.customType === EXPERT_BINDING).data.digest = '0'.repeat(64);
      await writeFile(file, changed.map(line => JSON.stringify(line)).join('\n') + '\n');
    }
    const before = await readFile(file, 'utf8'); const restored = await PiLab.create(config, fake.runtime); cleanup.push(() => restored.close());
    expect(() => restored.start(session.id, '不允许降级')).toThrow(); expect(fake.calls).toEqual([]);
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('reads migrated legacy history without writing or claiming a past revision, then binds only explicit future work', async () => {
    const root = await mkdtemp(join(tmpdir(), 'axon-expert-legacy-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
    const dataDir = join(root, 'data'); const workspaces = await WorkspaceStore.open(dataDir); const directory = join(dataDir, 'sessions');
    let manager = SessionManager.create(dataDir, directory); const file = manager.getSessionFile()!;
    await writeFile(file, `${JSON.stringify(manager.getHeader())}\n`); manager = SessionManager.open(file, directory);
    manager.appendMessage({ role: 'user', content: '历史用户消息', timestamp: Date.now() });
    manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: '历史回答' }], api: 'openai-completions', provider: 'test-local', model: 'deterministic-model', timestamp: Date.now(), stopReason: 'stop', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    await workspaces.bind(manager.getSessionId(), workspaces.list().defaultWorkspaceId);
    const before = await readFile(file, 'utf8'); const config = testConfig(dataDir); const fake = await fakeRuntime(config, () => ({ text: '未来明确请求完成' }));
    await expect(PiLab.create(config, fake.runtime)).rejects.toMatchObject({ code: 'CAPABILITY_MIGRATION_REQUIRED' });
    await migrateCapabilities({ dataDir, backupDir: join(root, 'backup'), apply: true, serviceStopped: true });
    await expect(PiLab.create(config, fake.runtime)).rejects.toMatchObject({code:'CAPABILITY_R2_MIGRATION_REQUIRED'});
    await migrateCapabilityManagement({dataDir,backupDir:join(root,'backup-r2'),apply:true,serviceStopped:true});
    const lab = await PiLab.create(config, fake.runtime); cleanup.push(() => lab.close());
    const snapshot = lab.get(manager.getSessionId()); expect(snapshot.expert?.legacy).toBe(true);
    expect(await readFile(file, 'utf8')).toBe(before); expect(fake.calls).toEqual([]);
    await lab.start(snapshot.id, '明确继续处理').run(() => {});
    expect(lab.get(snapshot.id).lastResult?.status).toBe('succeeded');
    expect(fake.calls).toHaveLength(1); expect(JSON.stringify(fake.calls[0].context.messages)).toContain('历史用户消息');
    const entries = (await native(dataDir, snapshot.id)).manager.getEntries();
    const bindingIndex = entries.findIndex(entry => entry.type === 'custom' && entry.customType === EXPERT_BINDING);
    expect(bindingIndex).toBeGreaterThan(entries.findIndex(entry => entry.type === 'message' && entry.message.role === 'assistant'));
    expect(entries.filter(entry => entry.type === 'custom' && entry.customType === EXPERT_BINDING)).toHaveLength(1);
    expect(lab.get(snapshot.id).messages.filter(message => message.text === '历史用户消息')).toHaveLength(1);
  });
});
