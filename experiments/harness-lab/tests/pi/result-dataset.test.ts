import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { openDatabase } from '../../src/access/database.js';
import { AccessStore } from '../../src/access/store.js';
import type { AuthSession } from '../../src/contracts/access.js';
import type { SessionSnapshot, StreamEvent } from '../../src/contracts/index.js';
import { resultDatasetMaxBytes, type ResultDatasetV1 } from '../../src/contracts/result-dataset.js';
import { DockerExecutionService, type DockerRunner } from '../../src/execution/docker.js';
import { createApp } from '../../src/server/app.js';
import { PiLab } from '../../src/pi/lab.js';
import { fakeRuntime, testConfig, type Reply } from './fake-runtime.js';

const dataset: ResultDatasetV1 = {
  format: 'result-dataset.v1',
  columns: [{ id: 'team', label: '班组', type: 'string' }, { id: 'orders', label: '工单数', type: 'number', unit: '件' }],
  rows: [{ id: 'team-a', values: { team: '甲班', orders: 12 } }, { id: 'team-b', values: { team: '乙班', orders: 8 } }],
  provenance: { source: 'orders.csv', scope: '测试工单', method: '按班组计数' },
};
const output = Buffer.from(JSON.stringify(dataset) + '\n');
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.unstubAllGlobals(); });

function fakeExecution(dataDir: string, outputs: Map<string, { bytes: Buffer; code?: number }>) {
  const runner: DockerRunner = async (args, options) => {
    if (args.includes('/opt/berserk/command.py')) {
      const result = outputs.get(options?.input?.toString() ?? '');
      if (!result) throw new Error('Unexpected fixture command');
      const firstChineseByte = result.bytes.indexOf(Buffer.from('班')) + 1;
      options!.onData!(result.bytes.subarray(0, firstChineseByte));
      options!.onData!(result.bytes.subarray(firstChineseByte));
      return { code: result.code ?? 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    }
    return { code: 0, stdout: Buffer.from(args[0] === 'info' ? 'linux' : ''), stderr: Buffer.alloc(0) };
  };
  return new DockerExecutionService({ instanceId: dataDir }, runner);
}

async function setup(outputs: Map<string, { bytes: Buffer; code?: number }>, reply: (index: number) => Reply, enabled = true) {
  const dataDir = await mkdtemp(join(tmpdir(), 'berserk-r12-native-'));
  cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
  const config = testConfig(dataDir, { resultUiEnabled: enabled });
  const fake = await fakeRuntime(config, (_context, index) => reply(index));
  let activeLab = await PiLab.create(config, fake.runtime, fakeExecution(dataDir, outputs));
  cleanup.push(() => activeLab.close());
  return { lab: activeLab, fake, dataDir, async restart(beforeOpen?: () => Promise<void>) {
    await activeLab.close();
    await beforeOpen?.();
    activeLab = await PiLab.create({ ...config, resultUiEnabled: false }, fake.runtime);
    return activeLab;
  } };
}

it('projects the completed native result before continuing the reply and restores exactly that result after restart', async () => {
  const command = 'cat orders.result.json';
  const env = await setup(new Map([[command, { bytes: output }]]), index => index === 0
    ? { tools: [{ name: 'bash', arguments: { command } }] } : { text: '汇总完成' });
  const session = await env.lab.createSession();
  const other = await env.lab.createSession(session.workspaceId);
  const events: StreamEvent[] = [];
  await env.lab.start(session.id, '汇总工单').run(event => events.push(event));
  const completedAt = events.findIndex(event => event.type === 'tool.completed' && event.resultDataset?.sessionId === session.id);
  expect(completedAt).toBeGreaterThan(0);
  expect(events.findIndex(event => event.type === 'text.delta' && event.delta === '汇总完成')).toBeGreaterThan(completedAt);
  const event = events[completedAt];
  if (event.type !== 'tool.completed' || !event.resultDataset) throw new Error('Missing tool result');
  expect(event.resultDataset.dataset).toEqual(dataset);
  expect(events.some(event => event.type === 'files.output')).toBe(false);
  const modelTool = env.fake.calls.at(-1)?.context.messages.find(message => message.role === 'toolResult');
  expect(modelTool?.content).toEqual([{ type: 'text', text: event.text }]);
  expect(event.text).not.toContain('甲班');
  expect(JSON.parse(event.text)).toEqual({
    format: 'result-dataset.receipt.v1', resultRef: event.resultDataset.resultRef, columns: dataset.columns, rowCount: 2,
  });
  expect(env.lab.get(other.id).messages.some(message => message.resultDataset)).toBe(false);

  const restored = await env.restart();
  expect(restored.get(session.id).messages.find(message => message.toolName === 'bash')?.resultDataset).toEqual(event.resultDataset);
  expect(restored.get(other.id).messages.some(message => message.resultDataset)).toBe(false);
});

it('drops damaged datasets while retaining the original native conversation for review', async () => {
  const command = 'cat orders.result.json';
  const env = await setup(new Map([[command, { bytes: output }]]), index => index === 0
    ? { tools: [{ name: 'bash', arguments: { command } }] } : { text: '汇总完成' });
  const session = await env.lab.createSession();
  await env.lab.start(session.id, '汇总工单').run(() => {});
  expect(env.lab.get(session.id).messages.find(message => message.resultDataset)?.resultDataset?.dataset).toEqual(dataset);
  const restored = await env.restart(async () => {
    const directory = join(env.dataDir, 'sessions');
    const file = (await readdir(directory)).find(name => name.endsWith(`_${session.id}.jsonl`));
    if (!file) throw new Error('Missing native session');
    const path = join(directory, file);
    const native = await readFile(path, 'utf8');
    expect(native).toContain('"orders":12');
    await writeFile(path, native.replace('"orders":12', '"orders":99'));
  });
  expect(restored.get(session.id).messages.some(message => message.resultDataset)).toBe(false);
  expect(restored.get(session.id).messages.at(-1)?.text).toBe('汇总完成');
});

it('keeps a stored result behind session authorization for other seats and revoked accounts', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'berserk-r12-auth-'));
  cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
  const db = await openDatabase(dataDir);
  const access = new AccessStore(db);
  const password = 'fixture-dataset-password';
  try {
    for (const seatId of ['author', 'reader']) await access.saveAccount({
      username: seatId, displayName: seatId, seatId, seatName: seatId, password, createPublicTask: true, manageModelSettings: false,
    });
  } finally { db.close(); }
  const config = testConfig(dataDir, {
    seatId: 'author', resultUiEnabled: true,
    auth: { secret: 'test-dataset-signing-secret-32-characters', sessionMs: 28_800_000 },
  });
  const command = 'cat orders.result.json';
  const fake = await fakeRuntime(config, (_context, index) => index === 0
    ? { tools: [{ name: 'bash', arguments: { command } }] } : { text: '汇总完成' });
  const lab = await PiLab.create(config, fake.runtime, fakeExecution(dataDir, new Map([[command, { bytes: output }]])));
  const app = await createApp(lab);
  cleanup.push(() => app.close());
  const author = lab.access!.identityForSeat('author')!;
  const task = lab.access!.create(author, { title: '数据权限验证', goal: '核对权限', visibility: 'public', clientActionId: randomUUID() });
  const workspace = await lab.workspaces.ensureWorkspace(task.id, 'author', task.title);
  const session = await lab.createSession(workspace.id, 'author');
  await lab.start(session.id, '展示已算工单。', {}, 'author', undefined, author.userId).run(() => {});

  const origin = `http://localhost:${config.port}`;
  const login = async (seatId: string) => {
    const boot = await app.inject('/api/auth/session');
    const result = await app.inject({ method: 'POST', url: '/api/auth/login', headers: {
      origin, cookie: boot.cookies.map(item => `${item.name}=${item.value}`).join('; '),
      'x-csrf-token': boot.json<AuthSession>().csrf!,
    }, payload: { seatId, password } });
    expect(result.statusCode, result.body).toBe(200);
    return { origin, cookie: result.cookies.map(item => `${item.name}=${item.value}`).join('; '),
      'x-axon-view': result.json<AuthSession>().viewId! };
  };
  const authorHeaders = await login('author');
  const url = `/api/sessions/${session.id}`;
  const allowed = await app.inject({ url, headers: authorHeaders });
  expect(allowed.statusCode, allowed.body).toBe(200);
  expect(allowed.json<SessionSnapshot>().messages.find(message => message.resultDataset)?.resultDataset?.dataset).toEqual(dataset);
  const foreign = await app.inject({ url, headers: await login('reader') });
  expect(foreign.statusCode).toBe(404);
  expect(foreign.body).not.toContain('甲班');
  lab.access!.disable('author');
  const revoked = await app.inject({ url, headers: authorHeaders });
  expect(revoked.statusCode).toBe(401);
  expect(revoked.body).not.toContain('甲班');
});

it('leaves ordinary, malformed, truncated, disabled and failed command output on the native bash path', async () => {
  const cases = new Map([
    ['cat ordinary.txt', { bytes: Buffer.from('普通命令输出\n') }],
    ['cat mixed.txt', { bytes: Buffer.concat([Buffer.from('说明：\n'), output]) }],
    ['cat invalid.txt', { bytes: Buffer.from(output.toString().replace('"orders":12', '"orders":7,"orders":12')) }],
    ['cat broken-utf8.txt', { bytes: Buffer.concat([output.subarray(0, output.length - 2), Buffer.from([0xff]), output.subarray(-2)]) }],
    ['cat beyond-cap.txt', { bytes: Buffer.concat([Buffer.alloc(resultDatasetMaxBytes, 32), output]) }],
    ['cat truncated.txt', { bytes: Buffer.concat([Buffer.from('\n'.repeat(2100)), output]) }],
    ['python3 failed.py', { bytes: output, code: 7 }],
  ]);
  const env = await setup(cases, index => index === 0 ? {
    tools: Array.from(cases.keys(), command => ({ name: 'bash', arguments: { command } })),
  } : { text: '已处理' });
  const session = await env.lab.createSession();
  const events: StreamEvent[] = [];
  await env.lab.start(session.id, '执行命令').run(event => events.push(event));
  const completed = events.filter((event): event is Extract<StreamEvent, { type: 'tool.completed' }> => event.type === 'tool.completed');
  expect(completed).toHaveLength(cases.size);
  expect(completed.every(event => !event.resultDataset)).toBe(true);
  expect(completed.find(event => event.toolInput?.command === 'cat ordinary.txt')?.text).toContain('普通命令输出');
  expect(completed.find(event => event.toolInput?.command === 'cat truncated.txt')?.toolDetails?.truncated).toBe(true);
  expect(completed.find(event => event.toolInput?.command === 'python3 failed.py')?.isError).toBe(true);

  const command = 'cat disabled.txt';
  const disabled = await setup(new Map([[command, { bytes: output }]]), index => index === 0
    ? { tools: [{ name: 'bash', arguments: { command } }] } : { text: '已处理' }, false);
  const disabledSession = await disabled.lab.createSession();
  await disabled.lab.start(disabledSession.id, '执行命令').run(() => {});
  const toolResult = disabled.lab.get(disabledSession.id).messages.find(message => message.toolName === 'bash');
  expect(toolResult?.resultDataset).toBeUndefined();
  expect(toolResult?.text).toContain('甲班');
});

function openAiReply(model: string, command?: string) {
  const base = { id: 'dataset-completion', object: 'chat.completion.chunk', created: 1, model };
  const delta = command ? { role: 'assistant', tool_calls: [{ index: 0, id: 'dataset-tool', type: 'function',
    function: { name: 'bash', arguments: JSON.stringify({ command }) } }] } : { role: 'assistant', content: '完成' };
  const parts = [
    { ...base, choices: [{ index: 0, delta, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: command ? 'tool_calls' : 'stop' }] },
  ];
  return parts.map(value => `data: ${JSON.stringify(value)}\n\n`).join('') + 'data: [DONE]\n\n';
}

function anthropicReply(model: string, command?: string) {
  const parts = [
    { type: 'message_start', message: { id: 'dataset-completion', type: 'message', role: 'assistant', content: [], model,
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 2, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: command ? { type: 'tool_use', id: 'dataset-tool', name: 'bash', input: {} } : { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: command ? { type: 'input_json_delta', partial_json: JSON.stringify({ command }) } : { type: 'text_delta', text: '完成' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: command ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
  ];
  return parts.map(value => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`).join('');
}

type WireBlock = { type: string; text?: string; content?: WireBlock[] | string; tool_use_id?: string };
type WireMessage = { role: string; content: WireBlock[] | string; tool_call_id?: string };

it.each(['openai-completions', 'anthropic-messages'] as const)('sends only the compact dataset receipt through %s', async api => {
  const dataDir = await mkdtemp(join(tmpdir(), 'berserk-r12-wire-'));
  cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
  const command = 'cat orders.result.json';
  const config = testConfig(dataDir, { resultUiEnabled: true, api });
  const payloads: string[] = [];
  vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    expect(new URL(request.url).pathname).toMatch(api === 'anthropic-messages' ? /\/messages$/ : /\/chat\/completions$/);
    payloads.push(await request.text());
    const body = (api === 'anthropic-messages' ? anthropicReply : openAiReply)(config.model, payloads.length === 1 ? command : undefined);
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  });
  const lab = await PiLab.create(config, undefined, fakeExecution(dataDir, new Map([[command, { bytes: output }]])));
  cleanup.push(() => lab.close());
  const session = await lab.createSession();
  await lab.start(session.id, '汇总工单').run(() => {});
  const snapshot = lab.get(session.id);
  expect(snapshot.lastResult?.status).toBe('succeeded');
  expect(payloads).toHaveLength(2);
  const receipt = snapshot.messages.find(message => message.toolName === 'bash')?.resultDataset;
  expect(receipt?.dataset).toEqual(dataset);
  expect(receipt?.toolCallId).toBe('dataset-tool');
  const { messages } = JSON.parse(payloads[1]) as { messages: WireMessage[] };
  const delivered = api === 'anthropic-messages'
    ? messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
      .filter(block => block.type === 'tool_result' && block.tool_use_id === receipt?.toolCallId)
    : messages.filter(message => message.role === 'tool' && message.tool_call_id === receipt?.toolCallId);
  expect(delivered).toHaveLength(1);
  const content = delivered[0]?.content;
  const receiptText = typeof content === 'string' ? content : content?.map(block => block.text).join('');
  expect(JSON.parse(receiptText ?? '')).toEqual({
    format: 'result-dataset.receipt.v1', resultRef: receipt!.resultRef, columns: dataset.columns, rowCount: 2,
  });
  expect(payloads[1]).not.toContain('乙班');
  expect(payloads[1]).not.toContain('resultDatasetDigest');
  const directory = join(dataDir, 'sessions');
  const file = (await readdir(directory)).find(name => name.endsWith(`_${session.id}.jsonl`));
  if (!file) throw new Error('Missing native session');
  const persisted = await readFile(join(directory, file), 'utf8');
  expect(persisted).toContain('"orders":8');
  expect(persisted).toContain('"resultDatasetDigest"');
});
