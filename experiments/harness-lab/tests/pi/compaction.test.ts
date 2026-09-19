import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import type { Context } from '@earendil-works/pi-ai';
import { PiLab } from '../../src/pi/lab.js';
import { openStrictSession } from '../../src/pi/compaction-history.js';
import { fakeRuntime, testConfig, type Reply } from './fake-runtime.js';
import type { LabConfig } from '../../src/server/config.js';
import type { StreamEvent } from '../../src/contracts/index.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); for (const fn of cleanups.splice(0).reverse()) await fn(); });
const isSummary = (context: Context) => !context.tools?.length;
const summary = '## Goal\n完成计划，人数已改为37。\n## Progress\n资料已读，待形成方案。\n## Next Steps\n继续核对。';
const usage = (input: number) => ({ input, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: input + 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
async function setup(reply: (context: Context, index: number) => Reply = context => ({ text: isSummary(context) ? summary : '继续完成' }), seed = true, overrides: Partial<LabConfig> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'berserk-compaction-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const config = testConfig(dir, { contextWindow: 8192, maxOutputTokens: 6000, compactionReserveTokens: 7000, compactionKeepRecentTokens: 128, ...overrides });
  const fake = await fakeRuntime(config, reply);
  let lab = await PiLab.create(config, fake.runtime);
  const session = await lab.createSession();
  const [filename] = await readdir(join(dir, 'sessions')); const file = join(dir, 'sessions', filename);
  if (seed) {
    const manager = SessionManager.open(file);
    for (let index = 0; index < 4; index++) {
      manager.appendMessage({ role: 'user', content: `原文${index}：` + '资料内容'.repeat(200), timestamp: Date.now() - 10000 + index * 2 });
      manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: `原始回答${index}：` + '说明'.repeat(200) }],
        api: 'openai-completions', provider: config.provider, model: config.model, timestamp: Date.now() - 9999 + index * 2,
        stopReason: 'stop', usage: usage(index === 3 ? 1800 : 100) });
    }
    await lab.close(); lab = await PiLab.create(config, fake.runtime);
  }
  cleanups.push(() => lab.close());
  return { lab, config, session, file, ...fake };
}
async function ask(lab: PiLab, id: string, text = '按最新要求继续') {
  const events: StreamEvent[] = []; const request = lab.start(id, text);
  await request.run(event => events.push(event)); return { events, requestId: request.requestId };
}

describe('native default compaction', () => {
  it('compacts before a new prompt with native output allowance, retains raw history and keeps instructions separate', async () => {
    const { lab, session, calls, file } = await setup();
    await lab.resources.updateInstruction(session.workspaceId, 'workspace', 'CURRENT_AGENTS_MARKER', (await lab.resources.readInstruction(session.workspaceId, 'workspace')).hash);
    const before = lab.get(session.id).messages;
    const { events, requestId } = await ask(lab, session.id);
    expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
    const summaries = calls.filter(call => isSummary(call.context));
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries[0].maxTokens).toBe(5600);
    expect(JSON.stringify(summaries.map(call => call.context))).not.toContain('CURRENT_AGENTS_MARKER');
    const reply = calls.find(call => !isSummary(call.context))!;
    expect(reply.context.systemPrompt).toContain('CURRENT_AGENTS_MARKER');
    expect(JSON.stringify(reply.context)).toContain('人数已改为37');
    expect(lab.get(session.id).messages.slice(0, before.length)).toEqual(before);
    const records = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(records.filter(entry => entry.type === 'compaction')).toHaveLength(1);
    const result = lab.get(session.id).lastResult!;
    expect(result.compactionIds).toHaveLength(1);
    expect(result.usageSummary).toMatchObject({ modelAttempts: calls.length, replyAttempts: 1, compactionAttempts: summaries.length, unknownUsageAttempts: 0 });
    const detail = lab.getCompaction(session.id, result.compactionIds![0]);
    expect(detail).toMatchObject({ requestId, reason: 'threshold', summary: expect.stringContaining('人数已改为37') });
    expect(detail.firstKeptEntryId).toBeTruthy();
    expect(lab.getRequestResources(session.id, requestId).compactions).toHaveLength(1);
    expect(events.filter(event => event.type === 'context.compaction_started')).toHaveLength(1);
    expect(events.at(-1)?.type).toBe('response.completed');
    const other = await lab.createSession((await lab.workspaces.create('另一个项目')).id);
    expect(() => lab.getCompaction(other.id, detail.id)).toThrow(/不存在/);
  });

  it.each([
    ['empty', {}], ['tool call', { toolIds: ['meeting-notes'] }], ['length', { text: '不完整摘要', length: true }],
    ['authentication', { error: '401 api key secret-content' }],
  ] satisfies Array<[string, Reply]>)('fails %s summary without saving or continuing the user request', async (_name, failure) => {
    const { lab, session, calls, file } = await setup(context => isSummary(context) ? failure : { text: '不应回答' });
    const { events } = await ask(lab, session.id);
    expect(lab.get(session.id).lastResult?.status).toBe('failed');
    expect(calls.every(call => isSummary(call.context))).toBe(true);
    expect(events.filter(event => event.type === 'response.failed')).toHaveLength(1);
    expect(lab.get(session.id).latestCompaction).toBeUndefined();
    expect(await readFile(file, 'utf8')).not.toContain('secret-content');
  });

  it('cancels an in-flight summary through AgentSession.abort then permits a new request', async () => {
    let wait = true;
    const { lab, session, calls } = await setup(context => isSummary(context) ? wait ? { waitForAbort: true } : { text: summary } : { text: '继续' });
    const request = lab.start(session.id, '停止测试'); const events: StreamEvent[] = [];
    const work = request.run(event => events.push(event));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(lab.get(session.id).active?.phase).toBe('compacting');
    lab.cancel(session.id, request.requestId); await work;
    expect(calls[0].aborted).toBe(true);
    expect(lab.get(session.id).lastResult?.status).toBe('cancelled');
    expect(lab.get(session.id).latestCompaction).toBeUndefined();
    wait = false; await ask(lab, session.id, '现在继续');
    expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
  });

  it('retains saved summaries and resumes from disk without replaying raw tools', async () => {
    const { lab, session, config, file } = await setup();
    await ask(lab, session.id); const snapshot = lab.get(session.id); await lab.close();
    const fake = await fakeRuntime(config, () => ({ text: '重启后续聊' }));
    const restored = await PiLab.create(config, fake.runtime); cleanups.push(() => restored.close());
    expect(restored.get(session.id).recoveryWarning).toBeUndefined();
    expect(restored.get(session.id).messages).toEqual(snapshot.messages);
    expect(restored.getCompaction(session.id, snapshot.latestCompaction!.id)).toEqual(lab.getCompaction(session.id, snapshot.latestCompaction!.id));
    await ask(restored, session.id); expect(fake.calls).toHaveLength(1);
    expect(JSON.stringify(fake.calls[0].context)).toContain('人数已改为37');
    expect((await openStrictSession(file, join(config.dataDir, 'sessions'))).getEntries().filter(entry => entry.type === 'compaction')).toHaveLength(1);
  });

  it('rejects malformed native summaries and boundaries without changing the file', async () => {
    const { lab, session, config, file } = await setup(); await ask(lab, session.id); await lab.close();
    const entries = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    entries.find(entry => entry.type === 'compaction').firstKeptEntryId = 'not-in-this-session';
    const bad = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n'; await writeFile(file, bad);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restored = await PiLab.create(config, (await fakeRuntime(config, () => ({ text: '不会调用' }))).runtime); cleanups.push(() => restored.close());
    expect(restored.list()).toEqual([]); expect(await readFile(file, 'utf8')).toBe(bad);
  });

  it('retains the saved summary and continues an interrupted raw request only on new input', async () => {
    const { lab, session, config, file } = await setup(); await ask(lab, session.id); await lab.close();
    const entries = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const resultIndex = entries.findIndex(entry => entry.type === 'custom' && entry.customType === 'berserk.request-result.v1');
    entries.splice(resultIndex); await writeFile(file, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
    const fake = await fakeRuntime(config, () => ({ text: '继续完成' }));
    const restored = await PiLab.create(config, fake.runtime); cleanups.push(() => restored.close());
    expect(restored.get(session.id).latestCompaction).toBeDefined();
    expect(restored.get(session.id).recoveryWarning).toBeUndefined();
    expect(restored.get(session.id).lastResult?.status).toBe('interrupted');
    expect(fake.calls).toHaveLength(0);
    await restored.start(session.id, '继续').run(() => {});
    expect(restored.get(session.id).lastResult?.status).toBe('succeeded');
  });
});


describe('native recovery and sustained work', () => {
  it.each([false, true])('performs one native overflow recovery (second failure=%s) without replaying the user', async secondFailure => {
    let answers = 0;
    const { lab, session, calls } = await setup(context => {
      if (isSummary(context)) return { text: summary };
      answers++;
      return answers === 1 || secondFailure ? { error: 'context_length_exceeded sensitive-raw-body' } : { text: '恢复完成' };
    }, true, { contextWindow: 131072, compactionReserveTokens: 16384 });
    const { events } = await ask(lab, session.id, '恢复唯一输入');
    expect(answers).toBe(2);
    expect(lab.get(session.id).lastResult?.status).toBe(secondFailure ? 'failed' : 'succeeded');
    expect(lab.get(session.id).lastResult?.compactionIds).toHaveLength(1);
    expect(events.filter(event => event.type.startsWith('response.') && event.type !== 'response.started')).toHaveLength(1);
    expect(lab.get(session.id).messages.filter(message => message.role === 'user' && message.text === '恢复唯一输入')).toHaveLength(1);
    expect(calls.filter(call => isSummary(call.context)).length).toBeGreaterThan(0);
  });

  it('compacts a long tool turn repeatedly with dual native summaries, preserves original tool text and never replays tools', async () => {
    let answers = 0;
    const { lab, session, calls, file } = await setup(context => {
      if (isSummary(context)) return { text: summary };
      return ++answers <= 3 ? { toolIds: ['meeting-notes'], usageInput: 2000 } : { text: '长任务结束' };
    }, true, { compactionReserveTokens: 5000, compactionKeepRecentTokens: 2000 });
    const longSource = 'TOOL_HEAD_' + '详细资料'.repeat(1600) + '_UNIQUE_TOOL_TAIL';
    await writeFile(join(lab.workspaces.directory(session.workspaceId), 'sources/meeting-notes.md'), longSource);
    await ask(lab, session.id);
    const result = lab.get(session.id).lastResult!;
    expect(result.status).toBe('succeeded');
    expect(result.compactionIds!.length).toBeGreaterThan(1);
    expect(new Set(result.compactionIds).size).toBe(result.compactionIds!.length);
    expect(result.usageSummary!.compactionAttempts).toBeGreaterThan(result.compactionIds!.length);
    expect(result.usageSummary!.toolCalls).toBe(3);
    const serializedSummaries = calls.filter(call => isSummary(call.context)).map(call => JSON.stringify(call.context));
    expect(serializedSummaries.some(text => text.includes('TOOL_HEAD_'))).toBe(true);
    expect(serializedSummaries.some(text => text.includes('truncated'))).toBe(true);
    expect(serializedSummaries.every(text => !text.includes('_UNIQUE_TOOL_TAIL'))).toBe(true);
    expect(lab.get(session.id).messages.filter(message => message.role === 'tool' && message.text.includes('_UNIQUE_TOOL_TAIL'))).toHaveLength(3);
    const rows = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(rows.filter(row => row.type === 'compaction')).toHaveLength(result.compactionIds!.length);
    expect(rows.filter(row => row.type === 'message' && row.message.role === 'toolResult')).toHaveLength(3);
  });

  it.each(['reply', 'compaction'])('bounds transient %s retries at three extra attempts', async purpose => {
    const { lab, session, calls } = await setup(context => isSummary(context) === (purpose === 'compaction')
      ? { error: '503 overloaded secret-server-text' } : { text: summary }, purpose === 'compaction');
    vi.useFakeTimers();
    const work = ask(lab, session.id);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    for (let index = 0; index < 4; index++) await vi.advanceTimersByTimeAsync(8001);
    await work;
    expect(calls).toHaveLength(4);
    expect(lab.get(session.id).lastResult?.status).toBe('failed');
    expect(lab.get(session.id).lastResult?.usageSummary?.modelAttempts).toBe(4);
  });

  it('cancels retry backoff without allowing another attempt', async () => {
    const { lab, session, calls } = await setup(() => ({ error: '503 overloaded' }), false);
    const request = lab.start(session.id, '重试停止'); const work = request.run(() => {});
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    lab.cancel(session.id, request.requestId); await work;
    expect(calls).toHaveLength(1); expect(lab.get(session.id).lastResult?.status).toBe('cancelled');
  });

  it('continues beyond 120 seconds by default and still responds to user cancellation', async () => {
    const { lab, session, calls } = await setup(() => ({ waitForAbort: true }), false);
    vi.useFakeTimers();
    const request = lab.start(session.id, '长任务'); const work = request.run(() => {});
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(120001);
    expect(lab.get(session.id).active?.status).toBe('responding');
    expect(calls[0].aborted).toBe(false);
    lab.cancel(session.id, request.requestId); await work;
    expect(lab.get(session.id).lastResult?.status).toBe('cancelled');
  });

  it('stops a summary at an explicit whole-request deadline', async () => {
    const { lab, session, calls } = await setup(() => ({ waitForAbort: true }), true, { agentRunTimeoutMs: 50 });
    await ask(lab, session.id);
    expect(calls).toHaveLength(1);
    expect(lab.get(session.id).lastResult).toMatchObject({ status: 'failed', message: expect.stringContaining('超时') });
  });
});


it('poisons the manager after a native compaction append failure and never appends a terminal result', async () => {
  const { lab, session, file, calls } = await setup();
  const persist = SessionManager.prototype._persist;
  let writesAfterFailure = 0; let failed = false;
  vi.spyOn(SessionManager.prototype, '_persist').mockImplementation(function (this: SessionManager, entry) {
    if (failed) writesAfterFailure++;
    if (entry.type === 'compaction') { failed = true; throw new Error('ENOSPC private-path'); }
    return persist.call(this, entry);
  });
  await ask(lab, session.id);
  expect(failed).toBe(true); expect(writesAfterFailure).toBe(0);
  expect(lab.get(session.id).lastResult?.status).toBe('failed');
  expect(lab.get(session.id).recoveryWarning).toContain('保存失败');
  expect(lab.get(session.id).latestCompaction).toBeUndefined();
  expect(calls.every(call => isSummary(call.context))).toBe(true);
  expect(() => lab.start(session.id, '不能继续')).toThrow(/保存失败/);
  const rows = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  expect(rows.some(row => row.type === 'compaction')).toBe(false);
  expect(rows.some(row => row.customType === 'berserk.request-result.v1')).toBe(false);
});


it('rejects forged compaction ownership attached to a later request', async () => {
  const { lab, session, config, file } = await setup();
  await ask(lab, session.id, '第一次压缩'); await ask(lab, session.id, '下一轮普通问题'); await lab.close();
  const rows = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const results = rows.filter(row => row.customType === 'berserk.request-result.v1');
  expect(results[0].data.compactionIds).toHaveLength(1); expect(results[1].data.compactionIds).toHaveLength(0);
  results[1].data.compactionIds = results[0].data.compactionIds;
  results[1].data.compactions = results[0].data.compactions.map((item: object) => ({ ...item, requestId: results[1].data.requestId }));
  const bad = rows.map(row => JSON.stringify(row)).join('\n') + '\n'; await writeFile(file, bad);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const restored = await PiLab.create(config, (await fakeRuntime(config, () => ({ text: '不会调用' }))).runtime); cleanups.push(() => restored.close());
  expect(restored.list()).toHaveLength(0); expect(await readFile(file, 'utf8')).toBe(bad);
});


it('keeps the committed summary when cancelled between native append and the completion event', async () => {
  const { lab, session } = await setup();
  const persist = SessionManager.prototype._persist;
  const request = lab.start(session.id, '保存后立即取消');
  vi.spyOn(SessionManager.prototype, '_persist').mockImplementation(function (this: SessionManager, entry) {
    persist.call(this, entry);
    if (entry.type === 'compaction') lab.cancel(session.id, request.requestId);
  });
  await request.run(() => {});
  const result = lab.get(session.id);
  expect(result.lastResult?.status).toBe('cancelled');
  expect(result.lastResult?.compactionIds).toHaveLength(1);
  expect(result.latestCompaction).toMatchObject({ requestId: request.requestId, reason: 'unknown', tokensAfter: null });
  expect(lab.getCompaction(session.id, result.latestCompaction!.id).summary).toContain('人数已改为37');
});

it('keeps recent raw content out of the first summary and includes it when a later compaction ages it out', async () => {
  let replies = 0;
  const { lab, session, calls } = await setup(context => isSummary(context)
    ? { text: summary } : { text: '正常续作', usageInput: ++replies === 1 ? 10 : 1800 });
  const original = lab.get(session.id).messages;
  await ask(lab, session.id, '第一轮续作');
  const first = lab.get(session.id).latestCompaction!;
  const kept = original.find(message => message.id === lab.getCompaction(session.id, first.id).firstKeptEntryId)!;
  expect(kept).toBeDefined();
  const marker = kept.text.slice(0, 7);
  const firstSummaryCalls = calls.filter(call => isSummary(call.context));
  expect(firstSummaryCalls.length).toBeGreaterThan(0);
  expect(JSON.stringify(firstSummaryCalls.map(call => call.context))).not.toContain(marker);
  expect(JSON.stringify(calls.find(call => !isSummary(call.context))!.context)).toContain(marker);
  const callBoundary = calls.length;
  await ask(lab, session.id, '新的长轮次：' + '新增讨论内容'.repeat(300));
  expect(lab.get(session.id).latestCompaction!.id).not.toBe(first.id);
  expect(calls.slice(callBoundary).filter(call => isSummary(call.context)).some(call => JSON.stringify(call.context).includes(marker))).toBe(true);
  for (const message of original) expect(lab.get(session.id).messages.find(item => item.id === message.id)).toEqual(message);
});
