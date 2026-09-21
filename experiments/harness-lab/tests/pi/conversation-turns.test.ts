import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { PiLab } from '../../src/pi/lab.js';
import { conversationTurns } from '../../src/pi/history-evidence.js';
import { RESOURCE_ENTRY, RESULT_ENTRY } from '../../src/pi/resource-tools.js';
import { fakeRuntime, testConfig, type Reply } from './fake-runtime.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn(); });

async function setup(reply: Parameters<typeof fakeRuntime>[1]) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-turns-'));
  cleanup.push(() => rm(dir, { force: true, recursive: true }));
  const config = testConfig(dir);
  const fake = await fakeRuntime(config, reply);
  const lab = await PiLab.create(config, fake.runtime);
  cleanup.push(() => lab.close());
  const session = await lab.createSession();
  const sessionDir = join(dir, 'sessions');
  const path = join(sessionDir, (await readdir(sessionDir))[0]!);
  return { config, fake, lab, session, path, sessionDir };
}

it('projects every successful request and only its actual final answer, consistently after restart', async () => {
  const { config, fake, lab, session, path } = await setup((_context, index) => index === 0
    ? { text: '先核对资料', toolIds: ['meeting-notes'] } : { text: `答复 ${index}` });
  const first = lab.start(session.id, '读取资料'); await first.run(() => {});
  const second = lab.start(session.id, '下一轮'); await second.run(() => {});
  const snapshot = lab.get(session.id);
  expect(snapshot.turns).toEqual([first, second].map((request, index) => ({
    requestId: request.requestId, status: 'succeeded',
    finalMessageId: snapshot.messages.find(message => message.text === `答复 ${index + 1}`)!.id,
  })));
  expect(snapshot.turns?.map(turn => turn.finalMessageId)).not.toContain(snapshot.messages.find(message => message.text === '先核对资料')!.id);
  await lab.close();
  const bytes = await readFile(path, 'utf8'); const calls = fake.calls.length;
  const restored = await PiLab.create(config, fake.runtime); cleanup.push(() => restored.close());
  expect(restored.get(session.id).turns).toEqual(snapshot.turns);
  expect(restored.get(session.id).turns).toEqual(snapshot.turns);
  expect(await readFile(path, 'utf8')).toBe(bytes); expect(fake.calls).toHaveLength(calls);
  expect(bytes).not.toContain('finalMessageId');
});

it.each([
  ['empty tail', {}, 'succeeded'],
  ['whitespace tail', { text: '   ' }, 'succeeded'],
  ['truncated tail', { text: '未完整结束', length: true }, 'failed'],
  ['failed tail', { text: '出错前的文字', error: 'invalid model input' }, 'failed'],
] as const)('does not promote tool-preface text when the %s has no reliable final answer', async (_name, tail, status) => {
  const { lab, session } = await setup((_context, index): Reply => index === 0
    ? { text: '下面开始处理', toolIds: ['meeting-notes'] } : tail);
  const request = lab.start(session.id, '请处理'); await request.run(() => {});
  const snapshot = lab.get(session.id);
  expect(snapshot.messages.some(message => message.text === '下面开始处理')).toBe(true);
  expect(snapshot.lastResult?.status).toBe(status);
  expect(snapshot.turns).toEqual([{ requestId: request.requestId, status }]);
});

it('omits the active request until cancellation actually settles', async () => {
  const { lab, session, fake } = await setup(() => ({ waitForAbort: true }));
  const request = lab.start(session.id, '等待取消');
  expect(lab.get(session.id).turns).toEqual([]);
  const running = request.run(() => {});
  await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
  expect(lab.get(session.id).messages.some(message => message.requestId === request.requestId)).toBe(true);
  expect(lab.get(session.id).turns).toEqual([]);
  expect(lab.cancel(session.id, request.requestId).turns).toEqual([]);
  await running;
  expect(lab.get(session.id).turns).toEqual([{ requestId: request.requestId, status: 'cancelled' }]);
});

it('retains interrupted history beside later preparation failure and success without inventing a final', async () => {
  const { config, fake, lab, session, path } = await setup((_context, index) => index === 0
    ? { text: '即将读取', toolIds: ['meeting-notes'] } : { text: '处理完成' });
  const first = lab.start(session.id, '首次任务'); await first.run(() => {}); await lab.close();
  const lines = (await readFile(path, 'utf8')).trim().split('\n');
  const cutoff = lines.findIndex(line => JSON.parse(line).message?.role === 'assistant');
  const prefix = lines.slice(0, cutoff + 1).join('\n') + '\n'; await writeFile(path, prefix);
  const restored = await PiLab.create(config, fake.runtime); cleanup.push(() => restored.close());
  expect(restored.get(session.id).turns).toEqual([{ requestId: first.requestId, status: 'interrupted' }]);
  expect(await readFile(path, 'utf8')).toBe(prefix);
  vi.spyOn(restored.resources, 'snapshot').mockRejectedValueOnce(new Error('preparation failed'));
  const failed = restored.start(session.id, '未写用户正文'); await failed.run(() => {});
  const next = restored.start(session.id, '继续'); await next.run(() => {});
  const snapshot = restored.get(session.id);
  expect(snapshot.messages.some(message => message.requestId === failed.requestId)).toBe(false);
  expect(snapshot.turns).toEqual([
    { requestId: first.requestId, status: 'interrupted' },
    { requestId: failed.requestId, status: 'failed' },
    { requestId: next.requestId, status: 'succeeded', finalMessageId: snapshot.messages.at(-1)!.id },
  ]);
});

it('requires explicit native stop, no tool calls and a matching public message; legacy messages stay unscoped', async () => {
  const { lab, session, path, sessionDir } = await setup(() => ({ text: '正常答复' }));
  const request = lab.start(session.id, '目标'); await request.run(() => {});
  const snapshot = lab.get(session.id); await lab.close();
  const entries = SessionManager.open(path, sessionDir).getBranch();
  expect(conversationTurns(entries, [], undefined)).toEqual([{ requestId: request.requestId, status: 'succeeded' }]);
  const legacy = entries.filter(entry => entry.type !== 'custom' || ![RESOURCE_ENTRY, RESULT_ENTRY].includes(entry.customType));
  expect(conversationTurns(legacy, snapshot.messages)).toEqual([]);
  for (const mutation of ['missing-stop', 'tool-call', 'last-user'] as const) {
    const modified = structuredClone(entries);
    const last = modified.findLast(entry => entry.type === 'message');
    if (last?.type !== 'message' || last.message.role !== 'assistant') throw new Error('native assistant missing');
    if (mutation === 'missing-stop') Reflect.deleteProperty(last.message, 'stopReason');
    if (mutation === 'tool-call') last.message.content.push({ type: 'toolCall', id: 'pending-call', name: 'source_list', arguments: {} });
    if (mutation === 'last-user') last.message = { role: 'user', content: '不是助手最终答复', timestamp: Date.now() };
    expect(conversationTurns(modified, snapshot.messages)).toEqual([{ requestId: request.requestId, status: 'succeeded' }]);
  }
});
