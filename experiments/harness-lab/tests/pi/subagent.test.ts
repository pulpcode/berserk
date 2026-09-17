import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { PiLab } from '../../src/pi/lab.js';
import { SUBAGENT_START, SUBAGENT_RESULT, CHILD_ORIGIN } from '../../src/pi/subagent-history.js';
import type { StreamEvent } from '../../src/contracts/index.js';
import type { LabConfig } from '../../src/server/config.js';
import { fakeRuntime, testConfig, type Reply } from './fake-runtime.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup(reply: Parameters<typeof fakeRuntime>[1], overrides: Partial<LabConfig> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'berserk-subagent-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const config = testConfig(dir, overrides); const fake = await fakeRuntime(config, reply);
  const lab = await PiLab.create(config, fake.runtime); cleanup.push(() => lab.close());
  return { lab, config, ...fake };
}
const delegate = (agent = 'analyst', task = 'EXPLICIT_CHILD_TASK'): Reply => ({ tools: [{ name: 'subagent', arguments: { agent, task } }] });
const childContext = (prompt = '') => prompt.includes('你是子 Agent');
async function ask(lab: PiLab, id: string, text = 'PARENT_PRIVATE_HISTORY') {
  const events: StreamEvent[] = []; const request = lab.start(id, text);
  await request.run(event => events.push(event)); return { events, requestId: request.requestId };
}
async function parentFile(config: LabConfig) { return join(config.dataDir, 'sessions', (await readdir(join(config.dataDir, 'sessions')))[0]); }

describe('independent read-only subagents through Pi', () => {
  it('delegates, reads allowed resources, returns final text, separates history/usage and restores persisted cards', async () => {
    const { lab, config, calls } = await setup((_context, index) => index === 0 ? delegate() : index === 1 ? { toolIds: ['meeting-notes'] } : { text: index === 2 ? 'CHILD_FINAL' : 'PARENT_SYNTHESIS' });
    const session = await lab.createSession(); const { events, requestId } = await ask(lab, session.id);
    const snapshot = lab.get(session.id);
    expect(snapshot.lastResult?.status).toBe('succeeded');
    expect(snapshot.subagents).toEqual([expect.objectContaining({ role: 'analyst', task: 'EXPLICIT_CHILD_TASK', status: 'succeeded', result: 'CHILD_FINAL', parentRequestId: requestId })]);
    expect(calls).toHaveLength(4);
    expect(calls[1].context.tools?.map(tool => tool.name)).toEqual(['source_list', 'source_read', 'instructions_read']);
    expect(JSON.stringify(calls[1].context)).toContain('EXPLICIT_CHILD_TASK');
    expect(JSON.stringify(calls[1].context)).not.toContain('PARENT_PRIVATE_HISTORY');
    expect(JSON.stringify(calls[3].context)).toContain('CHILD_FINAL');
    expect(JSON.stringify(calls[3].context)).not.toContain('12 名新成员');
    expect(snapshot.lastResult?.usageSummary).toMatchObject({ modelAttempts: 2, toolCalls: 1, actual: { totalTokens: 4 } });
    expect(snapshot.lastResult?.subagentUsage).toMatchObject({ modelAttempts: 2, toolCalls: 1, actual: { totalTokens: 4 } });
    const updates = events.filter(event => event.type === 'subagent.updated');
    expect(updates.some(event => event.type === 'subagent.updated' && event.subagent.toolName === 'source.read')).toBe(true);
    expect(updates.every(event => event.type === 'subagent.updated' && event.requestId === event.subagent.parentRequestId)).toBe(true);
    expect(snapshot.messages.find(message => message.toolName === 'subagent')?.toolCallId).toBe(snapshot.subagents![0].toolCallId);
    expect(lab.list()).toHaveLength(1);
    const childDir = join(config.dataDir, 'subagents', session.id, snapshot.subagents![0].subagentId);
    const raw = await readFile(join(childDir, (await readdir(childDir))[0]), 'utf8');
    expect(raw).toContain(CHILD_ORIGIN); expect(raw).toContain('EXPLICIT_CHILD_TASK'); expect(raw).not.toContain('PARENT_PRIVATE_HISTORY');
    const entries = raw.trim().split('\n').map(line => JSON.parse(line));
    const resources = entries.find(entry => entry.customType === 'berserk.request-resources.v1').data;
    expect(resources.editableFileIds).toEqual([]); expect(resources.instructions.every((file: { editable: boolean }) => !file.editable)).toBe(true);
    await lab.close();
    const restored = await PiLab.create(config, (await fakeRuntime(config, () => ({ text: '继续' }))).runtime); cleanup.push(() => restored.close());
    expect(restored.get(session.id).subagents).toEqual(snapshot.subagents);
    expect(restored.get(session.id).lastResult?.subagentUsage).toEqual(snapshot.lastResult?.subagentUsage);
  });

  it.each([
    ['authentication', { error: '401 fake-key-NEVER-LEAK-123' }], ['empty', {}], ['truncated', { text: '部分检查', length: true }],
  ] satisfies Array<[string, Reply]>)('returns %s child failures as native tool errors while the parent can explain', async (_label, failed) => {
    const { lab, config, calls } = await setup((_context, index) => index === 0 ? delegate('reviewer') : index === 1 ? failed : { text: '未完成检查，说明局限。' });
    const session = await lab.createSession(); await ask(lab, session.id);
    expect(lab.get(session.id).subagents?.[0]).toMatchObject({ status: 'failed', error: expect.any(String) });
    expect(lab.get(session.id).subagents?.[0]).not.toHaveProperty('result');
    expect(calls[2].context.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'toolResult', toolName: 'subagent', isError: true })]));
    expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
    expect(await readFile(await parentFile(config), 'utf8')).not.toContain(config.apiKey);
  });

  it('cancels nested model work and blocks a queued second delegation without self-deadlock', async () => {
    const { lab, calls } = await setup((_context, index) => index === 0
      ? { tools: [...delegate().tools!, ...delegate('reviewer').tools!] } : { waitForAbort: true });
    const session = await lab.createSession(); const request = lab.start(session.id, '停止整个处理');
    const work = request.run(() => {});
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(lab.get(session.id).active?.phase).toBe('subagent');
    const stopped = lab.cancel(session.id, request.requestId);
    expect(stopped.active?.status).toBe('stopping'); expect(stopped.subagents?.[0].status).toBe('stopping');
    await work;
    expect(calls[1].aborted).toBe(true); expect(calls).toHaveLength(2);
    expect(lab.get(session.id).subagents?.[0].status).toBe('cancelled');
    expect(lab.get(session.id).lastResult?.status).toBe('cancelled');
  });

  it('uses explicit parent deadlines for children without creating a fresh time budget', async () => {
    const { lab, calls } = await setup((_context, index) => index === 0 ? delegate() : { waitForAbort: true }, { agentRunTimeoutMs: 100 });
    const session = await lab.createSession(); await ask(lab, session.id);
    expect(lab.get(session.id).lastResult).toMatchObject({ status: 'failed', message: expect.stringContaining('超时') });
    expect(calls.length).toBeLessThanOrEqual(2);
    if (calls.length === 2) expect(calls[1].aborted).toBe(true);
  });

  it('closes child tool admission when cancellation arrives in its public tool-start update', async () => {
    const { lab, calls } = await setup((_context, index) => index === 0 ? delegate() : { toolIds: ['meeting-notes'] });
    const session = await lab.createSession(); const request = lab.start(session.id, '读取时停止');
    await request.run(event => {
      if (event.type === 'subagent.updated' && event.subagent.phase === 'tool' && event.subagent.status === 'running') lab.cancel(session.id, request.requestId);
    });
    expect(calls).toHaveLength(2); expect(lab.get(session.id).lastResult?.status).toBe('cancelled');
    expect(lab.get(session.id).subagents?.[0].status).toBe('cancelled');
  });

  it('keeps per-request role/configuration snapshots, supports new tool-free roles, and rejects unknown/extra authority', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'berserk-test-roles-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
    await writeFile(join(directory, 'observer.md'), '---\nname: observer\ndescription: 观察\ntools: []\n---\nOLD_ROLE_MARKER');
    const { lab, calls } = await setup(context => childContext(context.systemPrompt) ? { text: '子完成' } : context.messages.some(message => message.role === 'toolResult') ? { text: '完成' } : delegate('observer'), { agentRolesDir: directory });
    const session = await lab.createSession();
    let changed: Promise<void> | undefined;
    await lab.start(session.id, '委派观察').run(event => {
      if (event.type === 'resources.loaded') changed = writeFile(join(directory, 'observer.md'), '---\nname: observer\ndescription: 新观察\ntools: []\n---\nNEW_ROLE_MARKER');
    });
    await changed;
    expect(calls[1].context.tools ?? []).toEqual([]); expect(calls[1].context.systemPrompt).toContain('OLD_ROLE_MARKER');
    const second = await lab.createSession(); await ask(lab, second.id);
    expect(calls.find(call => call.context.systemPrompt?.includes('NEW_ROLE_MARKER'))).toBeDefined();
  });

  it('restores incomplete starts as interrupted, never replays them, and rejects tampered linkage', async () => {
    const { lab, config, runtime } = await setup((_context, index) => index === 0 ? delegate() : { text: '完成' });
    const session = await lab.createSession(); await ask(lab, session.id); await lab.close();
    const file = await parentFile(config); const entries = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const startIndex = entries.findIndex(entry => entry.customType === SUBAGENT_START);
    await writeFile(file, entries.slice(0, startIndex + 1).map(entry => JSON.stringify(entry)).join('\n') + '\n');
    const restored = await PiLab.create(config, runtime); cleanup.push(() => restored.close());
    expect(restored.get(session.id).subagents?.[0]).toMatchObject({ status: 'interrupted', error: expect.stringContaining('不会自动') });
    expect(restored.get(session.id).recoveryWarning).toBeTruthy(); expect(() => restored.start(session.id, '继续')).toThrow(/未完整/);
    entries[startIndex].data.workspaceId = '11111111-1111-4111-8111-111111111111';
    await writeFile(file, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rejected = await PiLab.create(config, runtime); cleanup.push(() => rejected.close()); expect(rejected.list()).toEqual([]);
  });

  it('stops the whole parent on a failed end-link commit without claiming child success', async () => {
    const append = SessionManager.prototype.appendCustomEntry;
    vi.spyOn(SessionManager.prototype, 'appendCustomEntry').mockImplementation(function (this: SessionManager, type, data) {
      if (type === SUBAGENT_RESULT) throw new Error('disk full');
      return append.call(this, type, data);
    });
    const { lab, calls } = await setup((_context, index) => index === 0 ? delegate() : { text: '子完成' });
    const session = await lab.createSession(); await ask(lab, session.id);
    expect(calls).toHaveLength(2);
    expect(lab.get(session.id).lastResult?.status).toBe('failed');
    expect(lab.get(session.id).subagents?.[0].status).toBe('interrupted');
    expect(lab.get(session.id).recoveryWarning).toBeTruthy();
  });

  it('stops parent admission when child native persistence fails before its model work', async () => {
    const append = SessionManager.prototype.appendMessage;
    vi.spyOn(SessionManager.prototype, 'appendMessage').mockImplementation(function (this: SessionManager, message) {
      if (this.getSessionFile()?.includes('/subagents/')) throw new Error('child disk failure');
      return append.call(this, message);
    });
    const { lab, calls } = await setup((_context, index) => index === 0 ? delegate() : { text: '不得继续' });
    const session = await lab.createSession(); await ask(lab, session.id);
    expect(calls).toHaveLength(1); expect(lab.get(session.id).lastResult?.status).toBe('failed');
    expect(lab.get(session.id).subagents?.[0].status).toBe('interrupted');
    expect(lab.get(session.id).recoveryWarning).toBeTruthy();
    expect(() => lab.start(session.id, '不可继续')).toThrow(/记录|保存失败/);
  });

  it.each(['truncated', 'missing', 'body-mismatch'])('preserves a readable parent while blocking %s child history after restart', async corruption => {
    const { lab, config, runtime } = await setup((_context, index) => index === 0 ? delegate() : { text: 'CHILD_FINAL' });
    const session = await lab.createSession(); await ask(lab, session.id);
    const childId = lab.get(session.id).subagents![0].subagentId; await lab.close();
    const directory = join(config.dataDir, 'subagents', session.id, childId);
    const file = join(directory, (await readdir(directory))[0]);
    const originalParent = await readFile(await parentFile(config), 'utf8');
    if (corruption === 'missing') await rm(file);
    else if (corruption === 'truncated') await writeFile(file, (await readFile(file, 'utf8')) + '{broken');
    else await writeFile(file, (await readFile(file, 'utf8')).replaceAll('CHILD_FINAL', 'MISMATCHED_FINAL'));
    const restored = await PiLab.create(config, runtime); cleanup.push(() => restored.close());
    const snapshot = restored.get(session.id);
    expect(snapshot.messages).not.toEqual([]); expect(snapshot.recoveryWarning).toBeTruthy();
    expect(snapshot.subagents![0]).toMatchObject({ status: 'interrupted', error: expect.stringContaining('无法核实') });
    expect(snapshot.subagents![0]).not.toHaveProperty('result');
    expect(() => restored.start(session.id, '不能续跑')).toThrow(/禁止/);
    expect(await readFile(await parentFile(config), 'utf8')).toBe(originalParent);
  });

  it.each(['parent-result', 'parent-error-flag', 'parent-tool-text'])('rejects inconsistent %s native evidence', async corruption => {
    const { lab, config, runtime } = await setup((_context, index) => index === 0 ? delegate() : { text: 'CHILD_FINAL' });
    const session = await lab.createSession(); await ask(lab, session.id); await lab.close();
    const file = await parentFile(config); const entries = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    if (corruption === 'parent-result') entries.find(entry => entry.customType === SUBAGENT_RESULT).data.summary.result = 'TAMPERED';
    else {
      const tool = entries.find(entry => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === 'subagent').message;
      if (corruption === 'parent-error-flag') tool.isError = true;
      else tool.content = [{ type: 'text', text: 'TAMPERED' }];
    }
    await writeFile(file, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restored = await PiLab.create(config, runtime); cleanup.push(() => restored.close());
    expect(restored.list()).toEqual([]);
  });

  it.each(['retry', 'compaction'])('cancels a child during native %s and accounts its own attempts', async phase => {
    const { lab, calls } = await setup((context, index) => {
      if (index === 0) return delegate();
      if (phase === 'retry') return { error: '503 overloaded' };
      if (context.tools?.length) return { toolIds: ['meeting-notes'], usageInput: 7800 };
      return { waitForAbort: true };
    }, { contextWindow: 8192, maxOutputTokens: 6000, compactionReserveTokens: 1024, compactionKeepRecentTokens: 128 });
    const session = await lab.createSession(); const request = lab.start(session.id, '检查并取消'); const work = request.run(() => {});
    await vi.waitFor(() => expect(lab.get(session.id).subagents?.[0].phase).toBe(phase === 'retry' ? 'retrying' : 'compacting'));
    const attemptsBeforeCancel = calls.length;
    lab.cancel(session.id, request.requestId); await work;
    expect(lab.get(session.id).lastResult?.status).toBe('cancelled');
    expect(lab.get(session.id).subagents?.[0].status).toBe('cancelled');
    expect(lab.get(session.id).lastResult?.usageSummary?.compactionAttempts).toBe(0);
    expect(lab.get(session.id).lastResult?.subagentUsage?.compactionAttempts).toBe(phase === 'compaction' ? 1 : 0);
    expect(calls.length).toBe(attemptsBeforeCancel);
    expect(lab.get(session.id).lastResult?.subagentUsage?.modelAttempts).toBe(calls.length - 1);
  });

  it('completes native child compaction separately and returns to the same parent tool loop', async () => {
    let summarized = false;
    const { lab, calls, config } = await setup((context, index) => {
      if (index === 0) return delegate();
      if (!context.tools?.length) { summarized = true; return { text: '## Goal\n核对资料。\n## Progress\n资料已读取。\n## Next Steps\n形成结论。' }; }
      if (childContext(context.systemPrompt)) return summarized ? { text: '完整子结论' } : { toolIds: ['meeting-notes'], usageInput: 7800 };
      return { text: '主 Agent 综合' };
    }, { contextWindow: 8192, maxOutputTokens: 6000, compactionReserveTokens: 1024, compactionKeepRecentTokens: 128 });
    const session = await lab.createSession(); const { events } = await ask(lab, session.id);
    const snapshot = lab.get(session.id);
    expect(snapshot.lastResult?.status).toBe('succeeded'); expect(snapshot.subagents?.[0].result).toBe('完整子结论');
    expect(snapshot.lastResult?.subagentUsage?.compactionAttempts).toBeGreaterThan(0); expect(snapshot.lastResult?.usageSummary?.compactionAttempts).toBe(0);
    expect(snapshot.latestCompaction).toBeUndefined(); expect(events.some(event => event.type === 'context.compaction_completed')).toBe(false);
    expect(snapshot.lastResult!.usageSummary!.modelAttempts + snapshot.lastResult!.subagentUsage!.modelAttempts).toBe(calls.length);
    await lab.close(); const restored = await PiLab.create(config, (await fakeRuntime(config, () => ({ text: '继续' }))).runtime); cleanup.push(() => restored.close());
    expect(restored.get(session.id).subagents).toEqual(snapshot.subagents);
  });

  it('runs analyst then reviewer with role-specific tools and the original readonly instruction snapshot after a parent write', async () => {
    let expectedHash: string | null = null;
    const { lab, calls, config } = await setup((_context, index) => {
      if (index === 0) return { tools: [
        { name: 'instructions_update', arguments: { fileId: 'workspace', content: 'NEW_INSTRUCTION', expectedHash } },
        ...delegate('analyst', '分析资料').tools!, ...delegate('reviewer', '检查内容').tools!,
      ] };
      if (index === 1) return { tools: [{ name: 'instructions_read', arguments: { fileId: 'workspace' } }] };
      if (index === 3) return { tools: [{ name: 'skill_read', arguments: { id: 'review' } }] };
      return { text: '完成' };
    });
    const session = await lab.createSession();
    expectedHash = (await lab.resources.updateInstruction(session.workspaceId, 'workspace', 'OLD_INSTRUCTION', (await lab.resources.readInstruction(session.workspaceId, 'workspace')).hash)).hash;
    await ask(lab, session.id, '更新指令并委派');
    const snapshot = lab.get(session.id);
    expect(snapshot.subagents?.map(child => child.role)).toEqual(['analyst', 'reviewer']);
    expect(snapshot.subagents?.every(child => child.status === 'succeeded')).toBe(true);
    expect(calls[1].context.tools?.map(tool => tool.name)).not.toContain('skill_read');
    expect(calls[3].context.tools?.map(tool => tool.name)).toContain('skill_read');
    expect(calls[1].context.systemPrompt).toContain('OLD_INSTRUCTION'); expect(calls[3].context.systemPrompt).toContain('OLD_INSTRUCTION');
    expect(JSON.stringify(calls[2].context)).not.toContain('NEW_INSTRUCTION');
    expect(JSON.stringify(calls[2].context)).toContain('"editable":false');
    expect((await lab.resources.readInstruction(session.workspaceId, 'workspace')).content).toBe('NEW_INSTRUCTION');
    expect(snapshot.lastResult?.usageSummary?.toolCalls).toBe(3); expect(snapshot.lastResult?.subagentUsage?.toolCalls).toBe(2);
    await lab.close(); const restored = await PiLab.create(config, (await fakeRuntime(config, () => ({ text: '继续' }))).runtime); cleanup.push(() => restored.close());
    expect(restored.get(session.id).subagents).toEqual(snapshot.subagents);
  });

  it('does not register child writes, recursion, shell or role-undeclared tools', async () => {
    const { lab, calls } = await setup((_context, index) => index === 0 ? delegate('analyst') : index === 1 ? { tools: [
      { name: 'instructions_update', arguments: { fileId: 'workspace', content: 'UNAUTHORIZED', expectedHash: null } },
      { name: 'subagent', arguments: { agent: 'reviewer', task: 'recursive' } },
      { name: 'bash', arguments: { command: 'echo nope' } },
      { name: 'skill_read', arguments: { id: 'review' } },
    ] } : { text: '能力受限，说明未执行内容。' });
    const session = await lab.createSession(); await ask(lab, session.id);
    expect(lab.get(session.id).subagents).toHaveLength(1);
    expect((await lab.resources.readInstruction(session.workspaceId, 'workspace')).content).toBe('');
    expect(calls[2].context.messages.filter(message => message.role === 'toolResult').every(message => message.role === 'toolResult' && message.isError)).toBe(true);
    expect(calls).toHaveLength(4);
  });

  it.each([
    { agent: 'missing', task: 'test' }, { agent: 'analyst', task: 'test', cwd: '/outside' }, { agent: 'analyst', task: ' ' },
  ])('rejects unregistered or invalid delegation arguments: %j', async args => {
    const { lab, calls } = await setup((_context, index) => index === 0 ? { tools: [{ name: 'subagent', arguments: args }] } : { text: '参数错误，未执行。' });
    const session = await lab.createSession(); await ask(lab, session.id);
    expect(calls).toHaveLength(2); expect(lab.get(session.id).subagents).toBeUndefined();
    expect(calls[1].context.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'toolResult', isError: true })]));
  });

  it('keeps two workspaces independently active and stopping one parent leaves the other child running', async () => {
    const { lab, calls } = await setup(context => childContext(context.systemPrompt) ? { waitForAbort: true }
      : delegate('analyst', JSON.stringify(context.messages).includes('WORKSPACE_A') ? 'TASK_A' : 'TASK_B'));
    const a = await lab.createSession(); const b = await lab.createSession((await lab.workspaces.create('另一区')).id);
    const first = lab.start(a.id, 'WORKSPACE_A'); const second = lab.start(b.id, 'WORKSPACE_B');
    const wa = first.run(() => {}); const wb = second.run(() => {});
    await vi.waitFor(() => expect(calls).toHaveLength(4));
    lab.cancel(a.id, first.requestId); await wa;
    expect(lab.get(a.id).subagents?.[0].status).toBe('cancelled');
    expect(lab.get(b.id).subagents?.[0].status).toBe('running');
    expect(lab.get(b.id).active?.status).toBe('responding');
    const childCalls = calls.filter(call => childContext(call.context.systemPrompt));
    expect(childCalls.map(call => JSON.stringify(call.context.messages)).some(text => text.includes('TASK_A') && !text.includes('TASK_B'))).toBe(true);
    expect(childCalls.map(call => JSON.stringify(call.context.messages)).some(text => text.includes('TASK_B') && !text.includes('TASK_A'))).toBe(true);
    lab.cancel(b.id, second.requestId); await wb;
  });

  it('keeps missing child usage unknown rather than folding zero tokens into parent usage', async () => {
    const { lab, config } = await setup((_context, index) => index === 0 ? delegate() : index === 1 ? { text: '子结论', usageInput: 0, usageOutput: 0 } : { text: '主结论' });
    const session = await lab.createSession(); await ask(lab, session.id);
    expect(lab.get(session.id).lastResult?.usageSummary).toMatchObject({ modelAttempts: 2, unknownUsageAttempts: 0, actual: { totalTokens: 4 } });
    expect(lab.get(session.id).lastResult?.subagentUsage).toMatchObject({ modelAttempts: 1, unknownUsageAttempts: 1, actual: null });
    await lab.close(); const restored = await PiLab.create(config, (await fakeRuntime(config, () => ({ text: '继续' }))).runtime); cleanup.push(() => restored.close());
    expect(restored.get(session.id).lastResult?.subagentUsage).toMatchObject({ unknownUsageAttempts: 1, actual: null });
  });

  it('preserves a long child result verbatim while native parent overflow recovery compacts before continuing', async () => {
    let overflowed = false; let summarized = false; const longResult = '完整子结论。'.repeat(3000);
    const { lab, calls } = await setup((context, index) => {
      if (index === 0) return delegate();
      if (!context.tools?.length) { summarized = true; return { text: '## Goal\n处理子任务结果。\n## Progress\n子任务已完成。\n## Next Steps\n继续综合。' }; }
      if (childContext(context.systemPrompt)) return { text: longResult };
      if (!summarized && !overflowed) { overflowed = true; return { error: 'context_length_exceeded' }; }
      return { text: '压缩后综合完成。' };
    }, { contextWindow: 8192, maxOutputTokens: 6000, compactionReserveTokens: 1024, compactionKeepRecentTokens: 128 });
    const session = await lab.createSession(); await ask(lab, session.id);
    const snapshot = lab.get(session.id);
    expect(snapshot.subagents?.[0].result).toBe(longResult);
    expect(snapshot.messages.find(message => message.toolName === 'subagent')?.text).toContain(longResult);
    expect(snapshot.lastResult?.status).toBe('succeeded');
    expect(snapshot.lastResult?.usageSummary?.compactionAttempts).toBeGreaterThan(0);
    expect(calls.filter(call => !call.context.tools?.length)).not.toEqual([]);
  });
});
