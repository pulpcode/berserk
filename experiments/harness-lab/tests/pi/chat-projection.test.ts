import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { assistantProjection, publicToolDetails, publicToolInput, publicResultText } from '../../src/pi/chat-projection.js';
import { conversationTurns } from '../../src/pi/history-evidence.js';
import { PiLab } from '../../src/pi/lab.js';
import { DockerExecutionService, type DockerRunner } from '../../src/execution/docker.js';
import type { StreamEvent } from '../../src/contracts/index.js';
import { RESOURCE_ENTRY, RESULT_ENTRY } from '../../src/pi/resource-tools.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

it('publishes only visible text in native order and never exports reasoning signatures or redacted blocks', () => {
  const result = assistantProjection([
    { type: 'thinking', thinking: '核对证据', thinkingSignature: 'private-signature' },
    { type: 'text', text: '进度说明' },
    { type: 'thinking', thinking: '不得公开', redacted: true, thinkingSignature: 'opaque' },
    { type: 'toolCall', name: 'hidden', arguments: { key: 'secret' } },
    { type: 'thinking', thinking: '  ' },
    { type: 'text', text: '最后一段' },
  ], 'r:assistant:0');
  expect(result.text).toBe('进度说明\n最后一段');
  expect(result.content?.map(block => [block.type, block.text, block.id])).toEqual([
    ['thinking', '核对证据', 'r:assistant:0:content:0'],
    ['text', '进度说明', 'r:assistant:0:content:1'],
    ['text', '最后一段', 'r:assistant:0:content:5'],
  ]);
  expect(JSON.stringify(result)).not.toMatch(/private-signature|不得公开|opaque|secret/);
  expect(assistantProjection(null, 'old').content).toEqual([]);
});

it('allowlists public tool inputs and accepts native edit evidence without inventing write diffs', () => {
  expect(publicToolInput('bash', { command: 'python analyze.py', apiKey: 'secret', env: { TOKEN: 'secret' } })).toEqual({ command: 'python analyze.py' });
  expect(publicToolInput('read', { path: '/workspace/a.txt', offset: 2, limit: -1, content: 'secret' })).toEqual({ path: '/workspace/a.txt', offset: 2 });
  expect(publicToolInput('find', { path: '/workspace', pattern: '*.csv' })).toEqual({ path: '/workspace', pattern: '*.csv' });
  expect(publicToolInput('private_tool', { command: 'secret' })).toBeUndefined();
  expect(publicToolDetails('edit', { diff: '+new', patch: '@@ patch', firstChangedLine: 2, secret: true })).toEqual({ diff: '+new', patch: '@@ patch', firstChangedLine: 2 });
  expect(publicToolDetails('edit', { diff: '+new' }, true)).toBeUndefined();
  expect(publicToolDetails('write', { diff: '+new' })).toBeUndefined();
  expect(publicToolDetails('bash', { fullOutputPath: '/tmp/pi-bash-private.log' })).toBeUndefined();
  expect(publicToolDetails('bash', { fullOutputPath: '/logs/request-1/abcdef.log', truncation: { truncated: true } })).toEqual({ fullOutputPath: '/logs/request-1/abcdef.log', truncated: true });
  expect(publicResultText({ content: [{ type: 'text', text: 'line 1' }, { type: 'image', data: 'private' }, { type: 'text', text: 'line 2' }] })).toBe('line 1\nline 2');
});

it('keeps SDK live blocks, persisted history and restored snapshots consistent, including timing boundaries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'axon-projection-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const config = testConfig(dir);
  const fake = await fakeRuntime(config, () => ({ blocks: [
    { type: 'thinking', thinking: '核对第一份资料', thinkingSignature: 'signature-private' },
    { type: 'text', text: '我正在核对。' },
    { type: 'thinking', thinking: 'HIDDEN-REDACTED', redacted: true, thinkingSignature: 'opaque-private' },
    { type: 'thinking', thinking: '验证结论' },
    { type: 'text', text: '已完成核对。' },
  ] }));
  const lab = await PiLab.create(config, fake.runtime); cleanup.push(() => lab.close());
  const session = await lab.createSession();
  const events: StreamEvent[] = []; const run = lab.start(session.id, '核对资料'); await run.run(event => events.push(event));
  const live = events.filter(event => event.type === 'assistant.updated').at(-1);
  if (live?.type !== 'assistant.updated') throw new Error('missing live content');
  const snapshot = lab.get(session.id); const answer = snapshot.messages.at(-1)!;
  expect(answer.content).toEqual(live.message.content);
  expect(answer.presentationId).toBe(live.message.id);
  expect(answer.content?.map(block => block.type)).toEqual(['thinking', 'text', 'thinking', 'text']);
  expect(JSON.stringify(events)).not.toMatch(/signature-private|HIDDEN-REDACTED|opaque-private/);
  const path = join(dir, 'sessions', (await readdir(join(dir, 'sessions')))[0]!);
  const bytes = await readFile(path, 'utf8');
  const entries = SessionManager.open(path, join(dir, 'sessions')).getBranch();
  const start = entries.find(entry => entry.type === 'custom' && entry.customType === RESOURCE_ENTRY)!;
  const end = entries.find(entry => entry.type === 'custom' && entry.customType === RESULT_ENTRY)!;
  expect(snapshot.turns?.[0]).toMatchObject({ startedAt: start.timestamp, completedAt: end.timestamp, finalMessageId: answer.id });
  const withoutStart = entries.filter(entry => entry !== start);
  expect(conversationTurns(withoutStart, snapshot.messages)[0]?.startedAt).toBeUndefined();
  expect(conversationTurns(withoutStart, snapshot.messages)[0]?.completedAt).toBeUndefined();
  const inverted = structuredClone(entries);
  const badEnd = inverted.find(entry => entry.type === 'custom' && entry.customType === RESULT_ENTRY)!;
  badEnd.timestamp = '1970-01-01T00:00:00.000Z';
  expect(conversationTurns(inverted, snapshot.messages)[0]?.completedAt).toBeUndefined();
  await lab.close();
  const restored = await PiLab.create(config, fake.runtime); cleanup.push(() => restored.close());
  expect(restored.get(session.id).messages).toEqual(snapshot.messages);
  expect(restored.get(session.id).turns).toEqual(snapshot.turns);
  expect(await readFile(path, 'utf8')).toBe(bytes);
});

it('forwards native bash snapshots and edit evidence through the real tool loop and history projector', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'axon-tool-projection-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const config = testConfig(dir);
  const fake = await fakeRuntime(config, (_context, index) => index === 0
    ? { blocks: [{ type: 'thinking', thinking: '先验证命令' }, { type: 'text', text: '开始处理' }], tools: [{ name: 'bash', arguments: { command: 'echo hello' } }] }
    : index === 1 ? { blocks: [{ type: 'thinking', thinking: '再核对编辑' }], tools: [{ name: 'edit', arguments: { path: 'test.txt', edits: [{ oldText: 'old', newText: 'new' }] } }] }
      : { text: '处理完成' });
  let file: Buffer = Buffer.from('old\n');
  const result = (text = '') => ({ code: 0, stdout: Buffer.from(text), stderr: Buffer.alloc(0) });
  const runner: DockerRunner = async (args, options) => {
    if (args[0] === 'info') return result('linux');
    if (args[0] !== 'exec') return result();
    if (args.includes('/opt/berserk/command.py')) {
      options!.onData!(Buffer.from(Array.from({ length: 3000 }, (_, index) => `line ${index}\n`).join('')));
      await new Promise(resolve => setTimeout(resolve, 250));
      options!.onData!(Buffer.from('TAIL\n'));
      return result();
    }
    const operation = args[args.indexOf('/opt/berserk/files.py') + 1];
    if (operation === 'read') return { ...result(), stdout: file };
    if (operation === 'write') { file = options!.input!; return result(); }
    if (operation === 'exists') return result('true');
    if (operation === 'stat') return result(JSON.stringify({ directory: false }));
    return result();
  };
  const execution = () => new DockerExecutionService({ instanceId: dir }, runner);
  const lab = await PiLab.create(config, fake.runtime, execution()); cleanup.push(() => lab.close());
  const session = await lab.createSession(); const events: StreamEvent[] = [];
  const request = lab.start(session.id, '运行命令并修改文件'); await request.run(event => events.push(event));
  const started = events.find(event => event.type === 'tool.started' && event.toolName === 'bash');
  expect(started).toMatchObject({ toolInput: { command: 'echo hello' } });
  const updates = events.filter(event => event.type === 'tool.updated' && event.text);
  expect(updates.length).toBeGreaterThanOrEqual(2);
  const lastUpdate = updates.at(-1);
  if (lastUpdate?.type !== 'tool.updated') throw new Error('missing cumulative update');
  expect(lastUpdate.text).toContain('TAIL');
  expect(lastUpdate.toolDetails?.truncated).toBe(true);
  expect(lastUpdate.toolDetails?.fullOutputPath).toMatch(/^\/logs\//);
  expect(JSON.stringify(events)).not.toMatch(/\/pi-bash-[a-f0-9]+\.log/);
  const completed = events.find(event => event.type === 'tool.completed' && event.toolName === 'edit');
  if (completed?.type !== 'tool.completed') throw new Error('missing edit completion');
  expect(completed.isError).toBe(false);
  expect(completed.toolDetails?.diff).toContain('new');
  expect(completed.toolInput).toEqual({ path: 'test.txt' });
  const snapshot = lab.get(session.id);
  const edit = snapshot.messages.find(message => message.role === 'tool' && message.toolName === 'edit')!;
  expect(edit.toolDetails).toEqual(completed.toolDetails);
  expect(edit.toolInput).toEqual(completed.toolInput);
  expect(snapshot.messages.filter(message => message.role === 'tool')).toHaveLength(2);
  for (const message of snapshot.messages.filter(message => message.role === 'assistant')) {
    const live = events.filter(event => event.type === 'assistant.updated' && event.message.presentationId === message.presentationId).at(-1);
    if (live?.type !== 'assistant.updated') throw new Error('missing matching live assistant');
    expect(message.content).toEqual(live.message.content);
  }
  expect(snapshot.messages.some(message => message.toolStatus === 'running')).toBe(false);
  await lab.close();
  const restored = await PiLab.create(config, fake.runtime, execution()); cleanup.push(() => restored.close());
  expect(restored.get(session.id).messages).toEqual(snapshot.messages);
});
