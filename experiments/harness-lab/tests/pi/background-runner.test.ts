import { randomUUID } from 'node:crypto';
import { appendFileSync, readdirSync, unlinkSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundJob, BackgroundProfileSnapshot } from '../../src/contracts/background.js';
import type { BackgroundExecutionInput } from '../../src/background/executor.js';
import { PiLab } from '../../src/pi/lab.js';
import { createBackgroundExecutor, snapshotBackgroundProfile } from '../../src/pi/background-runner.js';
import { DockerExecutionService, type DockerRunner } from '../../src/execution/docker.js';
import * as policy from '../../src/execution/command-policy.js';
import type { LabConfig } from '../../src/server/config.js';
import { testConfig, fakeRuntime } from './fake-runtime.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn(); });
const profile: BackgroundProfileSnapshot = { id: 'preprocess', name: '预处理', goal: '整理资料', tools: ['source_list', 'source_read', 'skill_read', 'subagent'],
  skillIds: [], agentIds: [], instructions: 'SERVICE_INSTRUCTIONS', resources: [{ id: 'incoming', title: '输入', content: 'ONLY_SERVICE_SOURCE' }] };

async function setup(reply: Parameters<typeof fakeRuntime>[1], docker = false, overrides: Partial<LabConfig> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'axon-background-pi-')); cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
  const config = testConfig(dataDir, overrides); const fake = await fakeRuntime(config, reply);
  const commands: string[] = [];
  const runner: DockerRunner = async (args, options) => {
    if (args[0] === 'info') return { code: 0, stdout: Buffer.from('linux'), stderr: Buffer.alloc(0) };
    if (args[0] === 'exec' && args.includes('/opt/berserk/command.py')) { commands.push(options?.input?.toString() ?? ''); options?.onData?.(Buffer.from('OK')); }
    return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  };
  const lab = await PiLab.create(config, fake.runtime, docker ? new DockerExecutionService({ instanceId: dataDir }, runner) : undefined);
  cleanup.push(() => lab.close()); lab.setModelConcurrency(1);
  const executor = createBackgroundExecutor(lab);
  const job: BackgroundJob = { id: randomUUID(), kind: 'preprocess', eventId: randomUUID(), sourceId: 'test', status: 'running', revision: 1,
    createdAt: new Date().toISOString(), sessionId: randomUUID(), requestId: randomUUID() };
  const input: BackgroundExecutionInput = { text: 'INCOMING_TASK', files: [], directory: join(dataDir, 'background', 'jobs', job.id),
    profile: await snapshotBackgroundProfile(lab, profile), onEvent: () => {}, publish: async () => { throw new Error('no output'); } };
  return { lab, config, executor, job, input, ...fake, commands };
}

describe('native Pi background adapter', () => {
  it('isolates service resources and history, reads saved results after restart without registering a seat', async () => {
    const env = await setup((_context, index) => index === 0 ? { tools: [{ name: 'source_read', arguments: { id: 'incoming' } }] } : { text: 'SERVICE_FINAL' });
    const workspace = env.lab.workspaces.list().workspaces[0];
    await writeFile(join(env.lab.workspaces.directory(workspace.id), 'AGENTS.md'), 'PRIVATE_SEAT_INSTRUCTIONS');
    const beforeBindings = env.lab.workspaces.allBindings();
    const result = await env.executor.execute(env.job, env.input);
    expect(result.snapshot.lastResult).toMatchObject({ requestId: env.job.requestId, status: 'succeeded' });
    expect(result.snapshot.turns).toEqual([expect.objectContaining({ requestId: env.job.requestId, finalMessageId: expect.any(String) })]);
    expect(env.calls).toHaveLength(2);
    expect(JSON.stringify(env.calls)).toContain('ONLY_SERVICE_SOURCE');
    expect(JSON.stringify(env.calls)).not.toContain('PRIVATE_SEAT_INSTRUCTIONS');
    expect(JSON.stringify(env.calls)).not.toContain('meeting-notes');
    for (const tool of ['ask_user', 'instructions_update', 'work_item_prepare', 'work_item_commit', 'work_item_action']) expect(env.calls[0].context.tools?.map(item => item.name)).not.toContain(tool);
    expect(env.lab.workspaces.allBindings()).toEqual(beforeBindings);
    expect(env.lab.activity().sessions).toEqual([]);
    await env.lab.close();
    const restored = await PiLab.create(env.config, env.runtime); cleanup.push(() => restored.close());
    const read = await createBackgroundExecutor(restored).read(env.job);
    expect(read?.messages).toEqual(result.snapshot.messages);
    expect(read?.turns).toEqual(result.snapshot.turns);
    expect(env.calls).toHaveLength(2);
  });

  it('uses frozen allowed Agents with one model slot; children have separate histories under the job', async () => {
    const env = await setup((_context, index) => index === 0 ? { tools: [{ name: 'subagent', arguments: { agent: 'analyst', task: 'EXPLICIT_CHILD_ONLY' } }] }
      : index === 1 ? { text: 'CHILD_FINAL' } : { text: 'PARENT_FINAL' });
    env.input.profile = await snapshotBackgroundProfile(env.lab, { ...profile, agentIds: ['analyst'] });
    const result = await env.executor.execute(env.job, env.input);
    expect(result.snapshot.lastResult?.status).toBe('succeeded');
    expect(result.snapshot.subagents?.[0]).toMatchObject({ status: 'succeeded', role: 'analyst', result: 'CHILD_FINAL' });
    expect(env.calls).toHaveLength(3);
    expect(JSON.stringify(env.calls[1].context)).not.toContain('INCOMING_TASK');
    expect(JSON.stringify(env.calls[1].context)).toContain('EXPLICIT_CHILD_ONLY');
    expect(result.snapshot.lastResult?.usageSummary?.modelAttempts).toBe(2);
    expect(result.snapshot.lastResult?.subagentUsage?.modelAttempts).toBe(1);
    const childDir = join(env.input.directory, 'subagents', env.job.sessionId!, result.snapshot.subagents![0].subagentId);
    expect((await readdir(childDir)).filter(name => name.endsWith('.jsonl'))).toHaveLength(1);
    await env.lab.close();
    const restored = await PiLab.create(env.config, env.runtime); cleanup.push(() => restored.close());
    expect((await createBackgroundExecutor(restored).read(env.job))?.subagents).toEqual(result.snapshot.subagents);
  });

  it.each(['preprocess', 'seat_analysis'] as const)('returns an ask-policy tool error and lets %s continue with an allowed read', async kind => {
    const env = await setup((_context, index) => index === 0 ? { tools: [{ name: 'bash', arguments: { command: 'rm -rf /workspace/old' } }] }
      : index === 1 ? { tools: [{ name: 'source_read', arguments: { id: kind === 'preprocess' ? 'incoming' : 'meeting-notes' } }] }
      : { text: '已读取资料，原删除命令未执行。' }, true);
    env.input.profile = await snapshotBackgroundProfile(env.lab, { ...profile, tools: ['bash', 'source_read'] });
    if (kind === 'seat_analysis') {
      const session = await env.lab.createSession();
      Object.assign(env.job, { kind, sessionId: session.id, workspaceId: session.workspaceId, seatId: 'test-seat' });
    }
    const result = await env.executor.execute(env.job, env.input);
    expect(result.snapshot.lastResult?.status).toBe('succeeded');
    expect(result.snapshot.interactions).toEqual([]);
    expect(env.calls).toHaveLength(3); expect(env.commands).toEqual([]);
    const bashDescription = env.calls[0].context.tools?.find(tool => tool.name === 'bash')?.description;
    expect(bashDescription).toContain('后台不能等待人工确认');
    expect(bashDescription).not.toContain('网页展示完整命令');
    expect(env.calls[0].context.systemPrompt).not.toContain('由人员在普通对话接手');
    const blocked = env.calls[1].context.messages.find(message => message.role === 'toolResult' && message.toolName === 'bash');
    expect(blocked).toMatchObject({ isError: true, content: [{ type: 'text', text: expect.stringContaining('后台无法审批，本次命令未执行') }] });
    expect(JSON.stringify(blocked)).toContain('rm 可能删除');
    expect(env.calls[2].context.messages.find(message => message.role === 'toolResult' && message.toolName === 'source_read')).toMatchObject({ isError: false });
    expect(result.snapshot.commandPolicies).toEqual([expect.objectContaining({ requestId: env.job.requestId, command: 'rm -rf /workspace/old', cwd: '/workspace',
      policy: expect.objectContaining({ decision: 'ask', ruleId: 'shell.modify' }), execution: 'not_started' })]);
    await env.lab.close();
    const restored = await PiLab.create(env.config, env.runtime); cleanup.push(() => restored.close());
    const read = await createBackgroundExecutor(restored).read(env.job);
    expect(read?.lastResult?.status).toBe('succeeded');
    expect(read?.commandPolicies).toEqual(result.snapshot.commandPolicies);
    expect(read?.messages).toEqual(result.snapshot.messages);
  });

  it('keeps a normal inability reply as an execution result instead of classifying business completion', async () => {
    const env = await setup((_context, index) => index === 0 ? { tools: [{ name: 'bash', arguments: { command: 'ls "$FILES"' } }] }
      : { text: '无法完成本次检查：所需命令未执行。' }, true);
    env.input.profile = await snapshotBackgroundProfile(env.lab, { ...profile, tools: ['bash'] });
    const { snapshot } = await env.executor.execute(env.job, env.input);
    expect(snapshot.lastResult?.status).toBe('succeeded');
    expect(snapshot.messages.at(-1)?.text).toBe('无法完成本次检查：所需命令未执行。');
    expect(snapshot.turns?.[0].finalMessageId).toBe(snapshot.messages.at(-1)?.id);
    expect(snapshot.commandPolicies?.[0]).toMatchObject({ execution: 'not_started', policy: { ruleId: 'shell.review', reason: expect.stringContaining('无法可靠分析') } });
    expect(snapshot.interactions).toEqual([]);
    expect(env.commands).toEqual([]); expect(env.calls).toHaveLength(2);
  });

  it.each(['preprocess', 'seat_analysis'] as const)('runs ordinary inspection chains and file scripts in %s but never executes a denied command', async kind => {
    const allowed = ['cd /workspace && ls -la',
      'cd /workspace && ls -la && echo "---HASH---" && md5sum *.md && sha256sum *.md && echo "---WC---" && wc -l -c *.md',
      'python /workspace/analyze.py', 'node /workspace/check.js'];
    const env = await setup((_context, index) => index === 0 ? { tools: [{ name: 'bash', arguments: { command: 'sudo ls' } },
      ...allowed.map(command => ({ name: 'bash', arguments: { command } }))] } : { text: '文件检查完成' }, true);
    env.input.profile = await snapshotBackgroundProfile(env.lab, { ...profile, tools: ['bash'] });
    if (kind === 'seat_analysis') {
      const session = await env.lab.createSession();
      Object.assign(env.job, { kind, sessionId: session.id, workspaceId: session.workspaceId, seatId: 'test-seat' });
    }
    const { snapshot } = await env.executor.execute(env.job, env.input);
    expect(snapshot.lastResult?.status).toBe('succeeded');
    expect(snapshot.interactions).toEqual([]);
    expect(env.commands).toEqual(allowed);
    expect(snapshot.commandPolicies?.map(item => [item.policy.decision, item.execution])).toEqual([
      ['deny', 'not_started'], ...allowed.map(() => ['allow', 'succeeded']),
    ]);
    expect(env.calls).toHaveLength(2);
  });

  it('terminates background work on policy infrastructure failure rather than returning a recoverable block', async () => {
    vi.spyOn(policy, 'evaluateCommand').mockImplementation(() => { throw new Error('parser unavailable'); });
    const env = await setup((_context, index) => index === 0 ? { tools: [{ name: 'bash', arguments: { command: 'ls' } },
      { name: 'bash', arguments: { command: 'echo next' } }] } : { text: '不得调用' }, true);
    env.input.profile = await snapshotBackgroundProfile(env.lab, { ...profile, tools: ['bash'] });
    const { snapshot } = await env.executor.execute(env.job, env.input);
    expect(snapshot.lastResult?.status).toBe('failed');
    expect(snapshot.lastResult?.message).toContain('操作规则或交互记录不可用');
    expect(snapshot.interactions).toEqual([]);
    expect(env.commands).toEqual([]); expect(env.calls).toHaveLength(1);
  });

  it('uses existing native file tools and records a fixed output result', async () => {
    const env = await setup((_context, index) => index === 0 ? { tools: [{ name: 'bash', arguments: { command: 'python analyze.py' } }] }
      : index === 1 ? { tools: [{ name: 'file_output', arguments: { path: 'report.md' } }] } : { text: '成果已生成。' }, true);
    env.input.profile = await snapshotBackgroundProfile(env.lab, { ...profile, tools: ['bash', 'file_output'] });
    env.input.publish = async input => ({ ...input, workspaceId: env.job.id, downloadId: randomUUID(), name: 'report.md', size: 1, hash: 'a'.repeat(64), createdAt: new Date().toISOString() });
    const result = await env.executor.execute(env.job, env.input);
    expect(result.snapshot.lastResult?.status).toBe('succeeded');
    expect(env.commands).toHaveLength(1);
    expect(result.snapshot.fileOutputs).toEqual([expect.objectContaining({ workspaceId: env.job.id, sessionId: env.job.sessionId, path: 'report.md' })]);
    const logs = join(env.input.directory, 'logs', env.job.requestId);
    expect(await readFile(join(logs, (await readdir(logs))[0]), 'utf8')).toBe('OK');
    await env.lab.close();
    const restored = await PiLab.create(env.config, env.runtime); cleanup.push(() => restored.close());
    expect((await createBackgroundExecutor(restored).read(env.job))?.fileOutputs).toEqual(result.snapshot.fileOutputs);
  });

  it('honors a durable reservation, uses predefined IDs and continues the same seat session later', async () => {
    const env = await setup(() => ({ text: 'SEAT_DONE' }));
    const workspace = env.lab.workspaces.list().workspaces[0];
    const id = randomUUID();
    const one = await env.lab.createSession(workspace.id, undefined, undefined, id);
    expect((await env.lab.createSession(workspace.id, undefined, undefined, id)).id).toBe(one.id);
    expect(env.lab.list(workspace.id)).toHaveLength(1);
    env.job.kind = 'seat_analysis'; env.job.sessionId = id; env.job.seatId = workspace.seatId; env.job.workspaceId = workspace.id;
    let reserved = true;
    env.lab.backgroundHooks = { isSessionReserved: (sessionId, jobId) => reserved && sessionId === id && jobId !== env.job.id, isActive: () => reserved,
      getReservation: sessionId => reserved && sessionId === id ? { id: env.job.id, status: 'queued', revision: 1 } : undefined };
    expect(() => env.lab.start(id, '不能抢占')).toThrow('排队');
    expect(env.lab.get(id).backgroundJob).toMatchObject({ id: env.job.id, status: 'queued' });
    expect(env.lab.activity().sessions.find(session => session.id === id)?.backgroundJob).toMatchObject({ id: env.job.id, status: 'queued' });
    const result = await env.executor.execute(env.job, env.input);
    expect(result.snapshot.lastResult).toMatchObject({ requestId: env.job.requestId, status: 'succeeded' });
    expect(env.calls[0].context.tools?.map(tool => tool.name)).not.toEqual(expect.arrayContaining(['ask_user', 'instructions_update']));
    await expect(env.executor.execute(env.job, env.input)).rejects.toThrow('已有执行记录');
    reserved = false;
    expect(env.lab.get(id).backgroundJob).toBeUndefined();
    await env.lab.start(id, '继续').run(() => {});
    expect(env.lab.get(id).messages.filter(message => message.role === 'user')).toHaveLength(2);
    expect(env.calls[1].context.tools?.map(tool => tool.name)).toContain('ask_user');
  });

  it('recovers an empty preallocated native session after binding failed, without duplicates', async () => {
    const env = await setup(() => ({ text: 'done' }));
    const workspace = env.lab.workspaces.list().workspaces[0]; const sessionId = randomUUID();
    vi.spyOn(env.lab.workspaces, 'bind').mockRejectedValueOnce(new Error('disk interrupted'));
    await expect(env.lab.createSession(workspace.id, undefined, undefined, sessionId)).rejects.toThrow('disk interrupted');
    expect((await env.lab.createSession(workspace.id, undefined, undefined, sessionId)).id).toBe(sessionId);
    expect((await readdir(join(env.config.dataDir, 'sessions'))).filter(name => name.endsWith(`_${sessionId}.jsonl`))).toHaveLength(1);
  });

  it('cancels active service model work and does not accept an automatic replay', async () => {
    const env = await setup(() => ({ waitForAbort: true }));
    const pending = env.executor.execute(env.job, env.input);
    await vi.waitFor(() => expect(env.calls).toHaveLength(1));
    await env.executor.cancel(env.job);
    expect((await pending).snapshot.lastResult?.status).toBe('cancelled');
    await expect(env.executor.execute(env.job, env.input)).rejects.toThrow('已有历史');
    expect(env.calls).toHaveLength(1);
  });

  it('honors cancellation while the native session is still being prepared', async () => {
    const env = await setup(() => ({ text: 'never' }));
    const pending = env.executor.execute(env.job, env.input);
    await env.executor.cancel(env.job);
    expect((await pending).snapshot.lastResult?.status).toBe('cancelled');
    expect(env.calls).toHaveLength(0);
  });

  it('acknowledges cancellation after native completion while the queue is verifying the saved result', async () => {
    const env = await setup(() => ({ text: 'done' }));
    const session = await env.lab.createSession();
    env.job.kind = 'seat_analysis'; env.job.sessionId = session.id; env.job.seatId = 'test-seat'; env.job.workspaceId = session.workspaceId;
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const original = env.lab.readSavedSession.bind(env.lab);
    const verify = vi.spyOn(env.lab, 'readSavedSession').mockImplementation(async (...args) => { await gate; return original(...args); });
    const pending = env.executor.execute(env.job, env.input);
    await vi.waitFor(() => expect(verify).toHaveBeenCalledOnce());
    await expect(env.executor.cancel(env.job)).resolves.toBeUndefined();
    finish(); await pending;
    expect(env.calls).toHaveLength(1);
  });

  it('releases the model slot while a foreground session waits for a person', async () => {
    const env = await setup((_context, index) => index === 0 ? { tools: [{ name: 'ask_user', arguments: { questions: [
      { id: 'format', prompt: '格式？', options: [{ id: 'md', label: 'Markdown' }, { id: 'txt', label: '文本' }] },
    ] } }] } : { text: 'BACKGROUND_DONE' });
    const session = await env.lab.createSession(); const request = env.lab.start(session.id, '前台提问');
    const foreground = request.run(() => {});
    await vi.waitFor(() => expect(env.lab.get(session.id).active?.phase).toBe('waiting_answer'));
    expect((await env.executor.execute(env.job, env.input)).snapshot.lastResult?.status).toBe('succeeded');
    expect(env.calls).toHaveLength(2);
    env.lab.cancel(session.id, request.requestId); await foreground;
  });

  it('rejects unfrozen resource snapshots before model work', async () => {
    const env = await setup(() => ({ text: 'never' })); env.input.profile = { ...profile, skillIds: ['review'] };
    await expect(env.executor.execute(env.job, env.input)).rejects.toThrow('快照');
    expect(env.calls).toEqual([]);
  });

  it('does not return a successful result when the saved native evidence cannot be verified', async () => {
    const env = await setup(() => ({ text: '已回复，但持久结果还需核验' }));
    env.input.onEvent = event => {
      if (event.type !== 'response.completed') return;
      const directory = join(env.input.directory, 'sessions');
      const file = readdirSync(directory).find(name => name.endsWith('.jsonl'))!;
      appendFileSync(join(directory, file), '{damaged\n');
    };
    await expect(env.executor.execute(env.job, env.input)).rejects.toThrow();
    expect(env.calls).toHaveLength(1);
  });

  it('rejects a seat result whose saved native header belongs to another session', async () => {
    const env = await setup(() => ({ text: 'DONE' }));
    const session = await env.lab.createSession();
    await env.lab.start(session.id, '完成后核验').run(() => {});
    const directory = join(env.config.dataDir, 'sessions');
    const path = join(directory, (await readdir(directory)).find(name => name.endsWith(`_${session.id}.jsonl`))!);
    const lines = (await readFile(path, 'utf8')).split('\n');
    lines[0] = JSON.stringify({ ...JSON.parse(lines[0]), id: randomUUID() });
    const changed = lines.join('\n'); await writeFile(path, changed);
    await expect(env.lab.readSavedSession(session.id)).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe(changed);
  });

  it('reuses native overflow compaction inside service work and preserves originals on restart', async () => {
    let answers = 0;
    const env = await setup(context => !context.tools?.length ? { text: '## Goal\n保留原任务，继续处理资料。\n## Progress\n资料已读。' }
      : ++answers <= 3 ? { tools: [{ name: 'source_read', arguments: { id: 'incoming' } }], usageInput: 2000 } : answers === 4 ? { error: 'context length exceeded' } : { text: 'COMPACTED_FINAL' }, false,
    { contextWindow: 8192, maxOutputTokens: 6000, compactionReserveTokens: 5000, compactionKeepRecentTokens: 2000 });
    env.input.profile = await snapshotBackgroundProfile(env.lab, { ...profile, resources: [{ id: 'incoming', title: '原始长资料', content: 'ORIGINAL_LONG_SOURCE ' + '资料内容'.repeat(2500) }] });
    expect(env.runtime.getModel(env.config.provider, env.config.model)?.contextWindow).toBe(8192);
    const result = await env.executor.execute(env.job, env.input);
    expect(result.snapshot.lastResult?.status).toBe('succeeded');
    expect(result.snapshot.latestCompaction).toBeDefined();
    expect(result.snapshot.lastResult?.usageSummary?.compactionAttempts).toBeGreaterThan(0);
    const summaries = env.calls.filter(call => !call.context.tools?.length);
    expect(JSON.stringify(summaries)).not.toContain('SERVICE_INSTRUCTIONS');
    const directory = join(env.input.directory, 'sessions'); const path = join(directory, (await readdir(directory))[0]);
    const before = await readFile(path, 'utf8'); expect(before).toContain('ORIGINAL_LONG_SOURCE');
    await env.lab.close();
    const restored = await PiLab.create(env.config, env.runtime); cleanup.push(() => restored.close());
    const snapshot = await createBackgroundExecutor(restored).read(env.job);
    expect(snapshot?.messages).toEqual(result.snapshot.messages);
    expect(snapshot?.latestCompaction).toEqual(result.snapshot.latestCompaction);
    expect(await readFile(path, 'utf8')).toBe(before);
  });

  it('fails closed on a damaged native compaction without rewriting or dropping the original history', async () => {
    const env = await setup((_context, index) => index === 0 ? { tools: [{ name: 'source_read', arguments: { id: 'incoming' } }] } : { text: 'DONE' });
    await env.executor.execute(env.job, env.input); await env.lab.close();
    const directory = join(env.input.directory, 'sessions'); const path = join(directory, (await readdir(directory))[0]);
    const original = await readFile(path, 'utf8'); const lines = original.trim().split('\n').map(line => JSON.parse(line));
    appendFileSync(path, JSON.stringify({ type: 'compaction', id: 'damaged-summary', parentId: lines.at(-1).id, timestamp: new Date().toISOString(), summary: 'broken', firstKeptEntryId: 'missing-entry', tokensBefore: 100 }) + '\n');
    const damaged = await readFile(path, 'utf8');
    const restored = await PiLab.create(env.config, env.runtime); cleanup.push(() => restored.close());
    await expect(createBackgroundExecutor(restored).read(env.job)).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe(damaged);
    expect(damaged.startsWith(original)).toBe(true);
  });

  it('rejects completed parent output when the child evidence disappears before verification', async () => {
    const env = await setup((_context, index) => index === 0 ? { tools: [{ name: 'subagent', arguments: { agent: 'analyst', task: '只读分析' } }] }
      : { text: index === 1 ? 'CHILD' : 'PARENT' });
    env.input.profile = await snapshotBackgroundProfile(env.lab, { ...profile, agentIds: ['analyst'] });
    env.input.onEvent = event => {
      if (event.type !== 'response.completed') return;
      const childId = event.snapshot.subagents![0].subagentId;
      const directory = join(env.input.directory, 'subagents', env.job.sessionId!, childId);
      unlinkSync(join(directory, readdirSync(directory)[0]));
    };
    await expect(env.executor.execute(env.job, env.input)).rejects.toThrow('证据不完整');
    expect(env.calls).toHaveLength(3);
  });
});
