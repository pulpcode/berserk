import { mkdtemp, rm, readFile, readdir, writeFile, appendFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { PiLab } from '../../src/pi/lab.js';
import type { LabConfig } from '../../src/server/config.js';
import type { StreamEvent } from '../../src/contracts/index.js';
import { fakeRuntime, testConfig, type Reply } from './fake-runtime.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.restoreAllMocks(); });
async function setup(reply: Parameters<typeof fakeRuntime>[1] = () => ({ text: '你好' }), overrides: Partial<LabConfig> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'berserk-pi-test-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const config = testConfig(dir, overrides);
  const fake = await fakeRuntime(config, reply);
  const lab = await PiLab.create(config, fake.runtime);
  cleanup.push(() => lab.close());
  return { lab, config, ...fake };
}
async function ask(lab: PiLab, id: string, text: string) {
  const events: StreamEvent[] = [];
  const request = lab.start(id, text);
  await request.run(event => events.push(event));
  return { events, requestId: request.requestId };
}

describe('Pi native session integration', () => {
  it('executes source.read through the real Pi loop and retains its results in followup context', async () => {
    const { lab, calls } = await setup((context, index) => index === 0
      ? { toolIds: ['meeting-notes'] }
      : { text: JSON.stringify(context.messages).includes('12 名新成员') ? '依据纪要：12 名新成员，90 分钟。' : '没有读到资料' });
    const session = await lab.createSession();
    const first = await ask(lab, session.id, '请读取纪要');
    expect(first.events.some(event => event.type === 'tool.completed' && event.text.includes('12 名新成员') && !event.isError)).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1].context.messages.some(message => message.role === 'toolResult')).toBe(true);
    await ask(lab, session.id, '纪要里的人数是多少？');
    expect(calls).toHaveLength(3);
    expect(JSON.stringify(calls[2].context.messages)).toContain('12 名新成员');
    expect(lab.get(session.id).messages.at(-1)?.text).toContain('12 名新成员');
    expect(first.events.every(event => event.sessionId === session.id && event.requestId === first.requestId)).toBe(true);
  });

  it('isolates histories, rejects concurrent messages and stale cancellation, then accepts new work', async () => {
    const { lab, calls } = await setup(context => JSON.stringify(context.messages.filter(message => message.role === 'user').at(-1)).includes('暂停标记') ? { waitForAbort: true } : { text: '完成' });
    const a = await lab.createSession(); const b = await lab.createSession();
    await ask(lab, a.id, 'A 独有标记');
    await ask(lab, b.id, 'B 独有标记');
    expect(JSON.stringify(calls[1].context)).not.toContain('A 独有标记');
    const request = lab.start(b.id, '暂停标记');
    const events: StreamEvent[] = [];
    const work = request.run(event => events.push(event));
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(() => lab.start(b.id, '重复发送')).toThrow(/正在回复/);
    expect(() => lab.cancel(b.id, 'stale-id')).toThrow(/已结束/);
    expect(lab.cancel(b.id, request.requestId).active?.status).toBe('stopping');
    await work;
    expect(calls[2].aborted).toBe(true);
    expect(lab.get(b.id).active).toBeNull();
    expect(lab.get(b.id).lastResult?.status).toBe('cancelled');
    expect(events.at(-1)?.type).toBe('response.cancelled');
    const next = lab.start(b.id, '下一条');
    expect(() => lab.cancel(b.id, request.requestId)).toThrow(/已结束/);
    const nextEvents: StreamEvent[] = [];
    await next.run(event => nextEvents.push(event));
    expect(lab.get(b.id).lastResult?.status).toBe('succeeded');
    expect(nextEvents.every(event => event.requestId === next.requestId)).toBe(true);
    expect(events.every(event => event.requestId === request.requestId)).toBe(true);
    await ask(lab, a.id, 'A 继续');
    expect(lab.get(a.id).lastResult?.status).toBe('succeeded');
  });

  it('saves both empty sessions and completed native histories and reloads them for actual Pi followup', async () => {
    const { lab, config } = await setup((_context, index) => index === 0 ? { toolIds: ['resource-brief'] } : { text: '你好' });
    const empty = await lab.createSession(); const filled = await lab.createSession();
    await ask(lab, filled.id, '跨重启保留的事实：编号 789');
    await lab.close();
    const fake = await fakeRuntime(config, () => ({ text: '已恢复' }));
    const restored = await PiLab.create(config, fake.runtime); cleanup.push(() => restored.close());
    expect(restored.list().map(session => session.id)).toEqual(expect.arrayContaining([empty.id, filled.id]));
    expect(restored.get(empty.id).messages).toEqual([]);
    expect(restored.get(filled.id).recoveryWarning).toBeUndefined();
    await ask(restored, filled.id, '之前的编号呢？');
    expect(JSON.stringify(fake.calls[0].context.messages)).toContain('编号 789');
    expect(fake.calls[0].context.messages.some(message => message.role === 'toolResult' && JSON.stringify(message.content).includes('800 元'))).toBe(true);
    expect(restored.get(filled.id).messages.find(message => message.role === 'tool')?.toolName).toBe('source.read');
    const files = await readdir(join(config.dataDir, 'sessions'));
    expect(files).toHaveLength(2);
    const lines = (await readFile(join(config.dataDir, 'sessions', files[0]), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(lines[0].type).toBe('session');
  });

  it('blocks automatic continuation of incomplete native history and preserves malformed files', async () => {
    const { lab, config, runtime, calls } = await setup();
    const session = await lab.createSession();
    const dir = join(config.dataDir, 'sessions');
    const [name] = await readdir(dir);
    const manager = SessionManager.open(join(dir, name), dir);
    manager.appendMessage({ role: 'user', content: '未完成请求', timestamp: Date.now() });
    await lab.close();
    const corrupt = join(dir, 'corrupt.jsonl');
    await writeFile(corrupt, '{broken');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restored = await PiLab.create(config, runtime); cleanup.push(() => restored.close());
    expect(restored.get(session.id).recoveryWarning).toContain('不会自动重发');
    expect(() => restored.start(session.id, '继续')).toThrow(/未完整结束/);
    expect(calls).toHaveLength(0);
    expect(await readFile(corrupt, 'utf8')).toBe('{broken');
    expect(restored.list()).toHaveLength(1);
    await appendFile(join(dir, name), '\nmalformed');
    const rejected = await PiLab.create(config, runtime); cleanup.push(() => rejected.close());
    expect(rejected.list()).toEqual([]);
  });

  it('does not discover AGENTS.md, skills or built-in tools and rejects source traversal', async () => {
    const { lab, config, calls } = await setup((_context, index) => index === 0 ? { toolIds: ['../../.env.local'] } : { text: '读取被拒绝' });
    await writeFile(join(config.dataDir, 'AGENTS.md'), 'PRIVATE_MEMORY_MARKER');
    await mkdir(join(config.dataDir, '.pi', 'skills', 'secret'), { recursive: true });
    await writeFile(join(config.dataDir, '.pi', 'skills', 'secret', 'SKILL.md'), '---\nname: secret\ndescription: PRIVATE_SKILL_MARKER\n---\n私有内容');
    const session = await lab.createSession();
    const { events } = await ask(lab, session.id, '读取资料');
    expect(calls[0].context.tools?.map(tool => tool.name)).toEqual(['source_list', 'source_read', 'instructions_read', 'instructions_update', 'skill_read', 'subagent']);
    expect(calls[0].context.systemPrompt).not.toContain('PRIVATE_MEMORY_MARKER');
    expect(calls[0].context.systemPrompt).not.toContain('PRIVATE_SKILL_MARKER');
    expect(events.some(event => event.type === 'tool.completed' && event.isError && event.text.includes('资料 ID 不存在'))).toBe(true);
    expect(JSON.stringify(calls[1].context.messages)).not.toContain(config.apiKey);
    const outside = join(config.dataDir, 'outside.jsonl');
    await writeFile(outside, '{broken');
    await symlink(outside, join(config.dataDir, 'sessions', 'symlink.jsonl'));
    const next = await PiLab.create(config, (await fakeRuntime(config, () => ({ text: 'ok' }))).runtime);
    cleanup.push(() => next.close());
    expect(next.list()).toHaveLength(1);
  });

  it.each([
    ['timeout', { waitForAbort: true }, { agentRunTimeoutMs: 50 }, '超时'],
    ['output cap', { text: '截断', length: true }, {}, '输出上限'],
    ['provider error', { error: '401 api key fake-key-NEVER-LEAK-123' }, {}, '认证失败'],
  ] satisfies Array<[string, Reply, Partial<LabConfig>, string]>)('handles %s without leaked credentials or a stuck session', async (_name, plan, overrides, expected) => {
    const { lab, config, calls } = await setup(() => plan, overrides);
    const session = await lab.createSession();
    const { events } = await ask(lab, session.id, '测试');
    expect(lab.get(session.id).active).toBeNull();
    expect(lab.get(session.id).lastResult).toMatchObject({ status: 'failed', message: expect.stringContaining(expected) });
    expect(JSON.stringify(events)).not.toContain(config.apiKey);
    expect(calls[0]?.maxTokens).toBeUndefined();
    const dir = join(config.dataDir, 'sessions');
    for (const name of await readdir(dir)) expect(await readFile(join(dir, name), 'utf8')).not.toContain(config.apiKey);
  });

  it('continues past the previous eight tool and 32 model boundaries', async () => {
    const { lab, calls } = await setup((_context, index) => index < 35 ? { toolIds: ['meeting-notes'] } : { text: '持续任务完成' });
    const session = await lab.createSession();
    await ask(lab, session.id, '持续读取');
    expect(lab.get(session.id).lastResult).toMatchObject({ status: 'succeeded', usageSummary: { modelAttempts: 36, toolCalls: 35 } });
    expect(calls).toHaveLength(36);
    expect(lab.get(session.id).messages.filter(message => message.role === 'tool' && !message.isError)).toHaveLength(35);
  });

  it('cancels before Pi opens without calling the provider', async () => {
    const { lab, calls } = await setup(); const session = await lab.createSession();
    const request = lab.start(session.id, '还未执行');
    await request.run(event => {
      if (event.type === 'response.started') lab.cancel(session.id, request.requestId);
    });
    expect(calls).toHaveLength(0);
    expect(lab.get(session.id).lastResult?.status).toBe('cancelled');
    await ask(lab, session.id, '现在执行');
    expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
  });

  it('completes a multi-tool batch without the retired tool limit', async () => {
    const { lab, calls } = await setup((_context, index) => index === 0 ? { toolIds: Array.from({ length: 10 }, () => 'resource-brief') } : { text: '完成' });
    const session = await lab.createSession();
    await ask(lab, session.id, '同时读取多份');
    expect(calls).toHaveLength(2);
    expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
    expect(lab.get(session.id).messages.filter(message => message.role === 'tool' && !message.isError)).toHaveLength(10);
  });

  it('retains streamed partial text when the provider subsequently fails', async () => {
    const { lab } = await setup(() => ({ text: '已经生成的部分', error: 'unexpected provider failure' }));
    const session = await lab.createSession();
    const { events } = await ask(lab, session.id, '处理失败');
    expect(events.some(event => event.type === 'text.delta' && event.delta === '已经生成的部分')).toBe(true);
    expect(lab.get(session.id).messages.at(-1)?.text).toBe('已经生成的部分');
    expect(lab.get(session.id).lastResult?.status).toBe('failed');
  });

  it('sanitizes synchronous provider exceptions before native history is written', async () => {
    const { lab, config, runtime } = await setup();
    vi.spyOn(runtime, 'streamSimple').mockImplementation(() => { throw new Error(`401 api key ${config.apiKey}`); });
    const session = await lab.createSession();
    const { events } = await ask(lab, session.id, '同步异常');
    expect(lab.get(session.id).lastResult?.status).toBe('failed');
    expect(JSON.stringify(events)).not.toContain(config.apiKey);
    const dir = join(config.dataDir, 'sessions');
    for (const name of await readdir(dir)) expect(await readFile(join(dir, name), 'utf8')).not.toContain(config.apiKey);
  });

  it('keeps server work alive when the response listener disconnects', async () => {
    const { lab } = await setup(); const session = await lab.createSession();
    await lab.start(session.id, '独立完成').run(() => { throw new Error('client disconnected'); });
    expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
    expect(lab.get(session.id).messages.at(-1)?.text).toBe('你好');
  });
});

describe('per-request workspace resources through Pi', () => {
  it('loads independent current rules, fixes each request snapshot, records skill text and never duplicates history', async () => {
    let updateHash: string | null = null;
    const { lab, calls, config } = await setup((_context, index) => {
      if (index === 0) return { tools: [
        { name: 'skill_read', arguments: { id: 'synthesis' } },
        { name: 'instructions_update', arguments: { fileId: 'workspace', content: 'NEW_RULE', expectedHash: updateHash } },
      ] };
      return { text: '完成' };
    });
    const id = lab.workspaces.list().defaultWorkspaceId;
    updateHash = (await lab.resources.updateInstruction(id, 'workspace', 'OLD_RULE', (await lab.resources.readInstruction(id, 'workspace')).hash)).hash;
    const other = await lab.workspaces.create('隔离区');
    await lab.resources.updateInstruction(other.id, 'workspace', 'OTHER_RULE', (await lab.resources.readInstruction(other.id, 'workspace')).hash);
    const a = await lab.createSession(id); const b = await lab.createSession(id); const c = await lab.createSession(other.id);
    const first = await ask(lab, a.id, 'A_CHAT_MARKER');
    expect(calls).toHaveLength(2);
    expect(calls[0].context.systemPrompt).toContain('OLD_RULE');
    expect(calls[1].context.systemPrompt).toContain('OLD_RULE');
    expect(calls[1].context.systemPrompt).not.toContain('NEW_RULE');
    expect(JSON.stringify(calls[1].context.messages)).toContain('行动步骤');
    expect(first.events.some(event => event.type === 'instructions.updated')).toBe(true);
    const evidence = lab.getRequestResources(a.id, first.requestId);
    expect(evidence).toMatchObject({ status: 'available', readSkills: [{ id: 'synthesis', content: expect.stringContaining('行动步骤') }] });
    await ask(lab, a.id, '第二轮'); await ask(lab, b.id, 'B_CHAT_MARKER'); await ask(lab, c.id, 'C_CHAT_MARKER');
    expect(calls[2].context.systemPrompt).toContain('NEW_RULE'); expect(calls[2].context.systemPrompt).not.toContain('OLD_RULE');
    expect(calls[3].context.systemPrompt).toContain('NEW_RULE'); expect(JSON.stringify(calls[3].context.messages)).not.toContain('A_CHAT_MARKER');
    expect(calls[4].context.systemPrompt).toContain('OTHER_RULE'); expect(JSON.stringify(calls[4].context)).not.toContain('NEW_RULE');
    expect(lab.get(a.id).messages.filter(message => message.text === 'A_CHAT_MARKER')).toHaveLength(1);
    expect(lab.get(a.id).messages.filter(message => message.role === 'tool')).toHaveLength(2);
    expect(lab.getRequestResources(c.id, first.requestId)).toMatchObject({ status: 'unavailable' });
    await lab.close();
    const restored = await PiLab.create(config, (await fakeRuntime(config, () => ({ text: '恢复' }))).runtime); cleanup.push(() => restored.close());
    expect(restored.getRequestResources(a.id, first.requestId)).toEqual(evidence);
    expect(restored.get(a.id).messages.find(message => message.text === 'A_CHAT_MARKER')?.requestId).toBe(first.requestId);
  });
  it('uses fixed source snapshots while next request sees disk changes, and fails preparation without provider work', async () => {
    const { lab, calls } = await setup((_context, index) => index === 0 ? { toolIds: ['meeting-notes'] } : { text: '完成' });
    const session = await lab.createSession();
    const path = join(lab.workspaces.directory(session.workspaceId), 'sources/meeting-notes.md');
    await lab.start(session.id, '读取').run(event => { if (event.type === 'resources.loaded') { void writeFile(path, 'CHANGED_SOURCE'); } });
    expect(JSON.stringify(calls[1].context.messages)).toContain('12 名新成员');
    expect(JSON.stringify(calls[1].context.messages)).not.toContain('CHANGED_SOURCE');
    await writeFile(path, 'x'.repeat(32769));
    await ask(lab, session.id, '失败预检');
    expect(calls).toHaveLength(2);
    expect(lab.get(session.id).lastResult).toMatchObject({ status: 'failed', message: expect.stringContaining('超过') });
    expect(lab.get(session.id).messages.some(message => message.text === '失败预检')).toBe(false);
    expect(lab.get(session.id).active).toBeNull();
  });
  it('rejects unauthorized tools/extra scope, counts failures, and retains committed writes when cancelled', async () => {
    const { lab, calls } = await setup((_context, index) => index === 0 ? { tools: [
      { name: 'instructions_update', arguments: { fileId: 'common', content: 'illegal', expectedHash: null } },
      { name: 'skill_read', arguments: { id: 'unknown' } },
      { name: 'source_read', arguments: { id: 'meeting-notes', workspaceId: 'other' } },
    ] } : { text: '已拒绝' });
    const session = await lab.createSession();
    const { events } = await ask(lab, session.id, '工具边界');
    expect(events.filter(event => event.type === 'tool.completed' && event.isError)).toHaveLength(3);
    expect(lab.get(session.id).lastResult?.usageSummary?.toolCalls).toBe(3);
    expect(calls).toHaveLength(2);
    const config = lab.config;
    const updated = await PiLab.create(config, (await fakeRuntime(config, () => ({ tools: [{ name: 'instructions_update', arguments: { fileId: 'workspace', content: '已保存规则', expectedHash: (awaitHash) } }] }))).runtime);
    cleanup.push(() => updated.close());
    const awaitHash = (await updated.resources.readInstruction(session.workspaceId, 'workspace')).hash;
    const request = updated.start(session.id, '记住规则');
    await request.run(event => { if (event.type === 'instructions.updated') updated.cancel(session.id, request.requestId); });
    expect(updated.get(session.id).lastResult).toMatchObject({ status: 'cancelled', instructionChanges: [{ status: 'updated' }] });
    expect((await updated.resources.readInstruction(session.workspaceId, 'workspace')).content).toBe('已保存规则');
  });
});

describe('native evidence corruption', () => {
  it.each(['workspace', 'version', 'hash', 'extra', 'read-skill-version', 'late-skill', 'late-change', 'result-request'])('does not expose or resume %s-corrupt resource entries', async corruption => {
    const { lab, config } = await setup(); const session = await lab.createSession();
    const first = await ask(lab, session.id, '有效请求'); await lab.close();
    const directory = join(config.dataDir, 'sessions'); const [name] = await readdir(directory);
    const path = join(directory, name);
    const entries = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const entry = entries.find(entry => entry.type === 'custom' && entry.customType === 'berserk.request-resources.v1');
    if (corruption === 'workspace') entry.data.workspaceId = '11111111-1111-4111-8111-111111111111';
    if (corruption === 'version') entry.customType = 'berserk.request-resources.v99';
    if (corruption === 'hash') entry.data.instructions[1].content = 'UNVERIFIED_RULE';
    if (corruption === 'extra') entry.data.instructions[1].unregisteredPath = '/outside/AGENTS.md';
    const skill = await lab.resources.readSkill(session.workspaceId, 'synthesis');
    if (corruption === 'read-skill-version') entry.data.readSkills = [{ ...skill, version: 'unregistered' }];
    const result = entries.find(entry => entry.type === 'custom' && entry.customType === 'berserk.request-result.v1');
    if (corruption === 'late-skill') entries.push({ ...result, id: 'late-skill', parentId: result.id, customType: 'berserk.skill-read.v1', data: { requestId: first.requestId, skill } });
    if (corruption === 'late-change') {
      // A tool record cannot follow the terminal result even with a valid request ID.
      entries.push({ ...result, id: 'late-change', parentId: result.id, customType: 'berserk.instructions-updated.v1', data: { requestId: first.requestId, change: { fileId: 'workspace', status: 'updated', previousHash: null, hash: skill.hash, effectiveFrom: 'next_request' } } });
    }
    if (corruption === 'result-request') result.data.requestId = '11111111-1111-4111-8111-111111111111';
    const damaged = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n'; await writeFile(path, damaged);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = await fakeRuntime(config, () => ({ text: '不可运行' }));
    const restored = await PiLab.create(config, fake.runtime); cleanup.push(() => restored.close());
    expect(restored.list()).toEqual([]);
    expect(() => restored.getRequestResources(session.id, first.requestId)).toThrow(/不存在/);
    expect(() => restored.start(session.id, '拒绝')).toThrow(/不存在/);
    expect(fake.calls).toHaveLength(0); expect(await readFile(path, 'utf8')).toBe(damaged);
  });
});
