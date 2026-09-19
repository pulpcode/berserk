import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { PiLab } from '../../src/pi/lab.js';
import { RESOURCE_ENTRY, RESULT_ENTRY } from '../../src/pi/resource-tools.js';
import { validateHistoryEvidence, unfinishedRequests } from '../../src/pi/history-evidence.js';
import { DockerExecutionService, type DockerRunner } from '../../src/execution/docker.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn(); });
const runner: DockerRunner = async args => ({ code: 0, stdout: Buffer.from(args[0] === 'info' ? 'linux' : ''), stderr: Buffer.alloc(0) });

// These fixtures are byte prefixes of actual Axon/Pi output. SIGKILL coverage lives in
// probe-session-recovery.ts; these tests isolate strict parsing and continued requests.
async function seed(boundary: 'resources' | 'user' | 'tool-call' | 'tool-result' | 'terminal', sandbox = false, child = false) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-recovery-test-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const config = testConfig(dir);
  const fake = await fakeRuntime(config, (_context, index) => child && index === 0
    ? { tools: [{ name: 'subagent', arguments: { agent: 'analyst', task: '查看工作目录' } }] }
    : child && index === 1 ? { tools: [{ name: 'ls', arguments: {} }] }
    : index === 0
    ? { tools: [{ name: sandbox ? 'bash' : 'source_read', arguments: sandbox ? { command: 'ls' } : { id: 'meeting-notes' } }] }
    : { text: '首次已完成' });
  const lab = await PiLab.create(config, fake.runtime, sandbox ? new DockerExecutionService({ instanceId: dir }, runner) : undefined);
  const session = await lab.createSession();
  const request = lab.start(session.id, '首次用户输入'); await request.run(() => {}); await lab.close();
  const sessionDir = join(dir, 'sessions'); const [name] = await readdir(sessionDir); const path = join(sessionDir, name);
  const lines = (await readFile(path, 'utf8')).trim().split('\n');
  const index = lines.findIndex(line => {
    const entry = JSON.parse(line);
    return boundary === 'resources' ? entry.customType === RESOURCE_ENTRY
      : boundary === 'terminal' ? entry.customType === RESULT_ENTRY
      : entry.type === 'message' && entry.message.role === (boundary === 'user' ? 'user' : boundary === 'tool-call' ? 'assistant' : 'toolResult');
  });
  expect(index).toBeGreaterThan(0);
  const bytes = lines.slice(0, index + 1).join('\n') + '\n'; await writeFile(path, bytes);
  return { config, session, path, sessionDir, bytes, requestId: request.requestId };
}

it.each(['resources', 'user', 'tool-call', 'tool-result', 'terminal'] as const)('reads the first request at %s without mutation or replay, then starts a new request', async boundary => {
  const { config, session, path, bytes, requestId } = await seed(boundary);
  const fake = await fakeRuntime(config, () => ({ text: '新请求完成' }));
  const lab = await PiLab.create(config, fake.runtime); cleanup.push(() => lab.close());
  for (let index = 0; index < 3; index++) {
    const snapshot = lab.get(session.id);
    expect(snapshot.recoveryWarning).toBeUndefined();
    expect(snapshot.lastResult).toMatchObject({ requestId, status: boundary === 'terminal' ? 'succeeded' : 'interrupted' });
    expect(lab.activity().sessions[0].lastResult?.status).toBe(snapshot.lastResult?.status);
  }
  const missing = lab.get(session.id).messages.filter(message => message.resultMissing);
  expect(missing).toHaveLength(boundary === 'tool-call' ? 1 : 0);
  if (missing.length) {
    expect(missing[0]).toMatchObject({ role: 'tool', toolName: 'source.read', requestId });
    expect(missing[0]).not.toHaveProperty('isError');
  }
  expect(fake.calls).toHaveLength(0); expect(await readFile(path, 'utf8')).toBe(bytes);
  const next = lab.start(session.id, '显式继续'); expect(next.requestId).not.toBe(requestId); await next.run(() => {});
  expect(lab.get(session.id).lastResult).toMatchObject({ requestId: next.requestId, status: 'succeeded' });
  expect(lab.get(session.id).messages.filter(message => message.resultMissing)).toEqual(missing);
  expect(lab.get(session.id).messages.filter(message => message.role === 'user').map(message => message.text))
    .toEqual(boundary === 'resources' ? ['显式继续'] : ['首次用户输入', '显式继续']);
  const continued = await readFile(path, 'utf8'); expect(continued.startsWith(bytes)).toBe(true);
  expect(continued).not.toContain('resultMissing'); expect(continued).not.toContain('No result provided');
  expect(JSON.stringify(fake.calls[0].context)).not.toContain('未收到执行结果，无法确认是否已执行。');
  await lab.close();
  const restored = await PiLab.create(config, fake.runtime); cleanup.push(() => restored.close());
  expect(restored.get(session.id).lastResult?.status).toBe('succeeded');
  expect(restored.get(session.id).recoveryWarning).toBeUndefined();
  expect(restored.get(session.id).messages.filter(message => message.resultMissing)).toEqual(missing);
  expect(await readFile(path, 'utf8')).toBe(continued);
});

it('keeps two interrupted request boundaries and does not confuse reused tool call IDs across requests', async () => {
  const { config, session, path, sessionDir, requestId } = await seed('tool-call');
  const fake = await fakeRuntime(config, (_context, index) => index === 0 ? { toolIds: ['meeting-notes'] } : { text: '完成' });
  const lab = await PiLab.create(config, fake.runtime); const next = lab.start(session.id, '第二次输入'); await next.run(() => {}); await lab.close();
  const lines = (await readFile(path, 'utf8')).trim().split('\n');
  const secondStart = lines.findIndex(line => JSON.parse(line).data?.requestId === next.requestId);
  const nextCall = lines.findIndex((line, index) => index > secondStart && JSON.parse(line).message?.role === 'assistant');
  const bytes = lines.slice(0, nextCall + 1).join('\n') + '\n'; await writeFile(path, bytes);
  const manager = SessionManager.open(path, sessionDir);
  expect(unfinishedRequests(manager.getBranch()).map(request => request.requestId)).toEqual([requestId, next.requestId]);
  const restored = await PiLab.create(config, fake.runtime); cleanup.push(() => restored.close());
  expect(restored.get(session.id).lastResult).toMatchObject({ requestId: next.requestId, status: 'interrupted' });
  const missing = restored.get(session.id).messages.filter(message => message.resultMissing);
  expect(missing.map(message => message.requestId)).toEqual([requestId, next.requestId]);
  expect(missing[0].toolCallId).toBe(missing[1].toolCallId);
  await restored.start(session.id, '第三次输入').run(() => {});
  expect(restored.get(session.id).lastResult?.status).toBe('succeeded');
});

it('accepts preparation failure of a new request after an interrupted request without assigning it to the old one', async () => {
  const { config, session, path, sessionDir, requestId } = await seed('user');
  const fake = await fakeRuntime(config, () => ({ text: '不应调用' }));
  const lab = await PiLab.create(config, fake.runtime); cleanup.push(() => lab.close());
  vi.spyOn(lab.resources, 'snapshot').mockRejectedValueOnce(new Error('preparation failed'));
  const next = lab.start(session.id, '准备失败'); await next.run(() => {});
  expect(lab.get(session.id).lastResult).toMatchObject({ requestId: next.requestId, status: 'failed' });
  const entries = SessionManager.open(path, sessionDir).getBranch();
  expect(validateHistoryEvidence(entries, session.workspaceId, session.id)?.requestId).toBe(next.requestId);
  expect(unfinishedRequests(entries).map(request => request.requestId)).toEqual([requestId]);
  expect(fake.calls).toHaveLength(0);
});

it('rejects a persisted interrupted terminal and a late terminal from an earlier request', async () => {
  const { session, path, sessionDir, requestId } = await seed('user');
  const manager = SessionManager.open(path, sessionDir);
  manager.appendCustomEntry(RESULT_ENTRY, { requestId, status: 'interrupted' });
  expect(() => validateHistoryEvidence(manager.getBranch(), session.workspaceId, session.id)).toThrow();
  const entries = manager.getBranch().slice(0, -1);
  const resource = entries.find(entry => entry.type === 'custom' && entry.customType === RESOURCE_ENTRY)!;
  if (resource.type !== 'custom') throw new Error('resource missing');
  const next = structuredClone(resource); next.id = 'next-resource'; next.data = { ...(next.data as object), requestId: randomUUID() };
  const terminal = manager.getBranch().at(-1)!;
  if (terminal.type !== 'custom') throw new Error('terminal missing');
  terminal.data = { requestId, status: 'failed' };
  expect(() => validateHistoryEvidence([...entries, next, terminal], session.workspaceId, session.id)).toThrow();
});

it('rejects messages after a terminal without a new request boundary instead of assigning them to old work', async () => {
  const { session, path, sessionDir } = await seed('terminal');
  const manager = SessionManager.open(path, sessionDir);
  manager.appendMessage({ role: 'user', content: '缺少请求归属', timestamp: Date.now() });
  expect(() => validateHistoryEvidence(manager.getBranch(), session.workspaceId, session.id)).toThrow();
});

it.each([false, true])('requires successful sandbox initialization for interrupted sandbox calls (available=%s)', async available => {
  const { config, session, path, bytes } = await seed('tool-call', true);
  const fake = await fakeRuntime(config, () => ({ text: '继续' }));
  const execution = new DockerExecutionService({ instanceId: config.dataDir }, available ? runner : async () => { throw new Error('Docker unavailable'); });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const lab = await PiLab.create(config, fake.runtime, execution); cleanup.push(() => lab.close());
  expect(lab.get(session.id).lastResult?.status).toBe('interrupted');
  expect(Boolean(lab.get(session.id).recoveryWarning)).toBe(!available);
  if (!available) expect(() => lab.start(session.id, '继续')).toThrow(/旧执行环境/);
  expect(await readFile(path, 'utf8')).toBe(bytes); expect(fake.calls).toHaveLength(0);
});

it('retains the sandbox guard when only the completed child used the parent request container', async () => {
  const { config, session } = await seed('tool-result', true, true);
  const fake = await fakeRuntime(config, () => ({ text: '不会调用' }));
  const lab = await PiLab.create(config, fake.runtime); cleanup.push(() => lab.close());
  expect(lab.get(session.id).subagents?.[0].status).toBe('succeeded');
  expect(lab.get(session.id).lastResult?.status).toBe('interrupted');
  expect(() => lab.start(session.id, '继续')).toThrow(/旧执行环境/);
  expect(fake.calls).toHaveLength(0);
});
