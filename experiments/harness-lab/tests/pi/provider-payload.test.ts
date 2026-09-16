import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { PiLab } from '../../src/pi/lab.js';
import { testConfig } from './fake-runtime.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.unstubAllGlobals(); });
interface WireMessage { role: string; content: string | Array<{ type: string; text: string }> | null }
const textOf = (message: WireMessage) => typeof message.content === 'string' ? message.content : message.content?.map(block => block.text).join('') || '';
it('inserts one fixed system snapshot immediately before the current user on the wire, without changing native history', async () => {
  const payloads: Array<{ messages: WireMessage[]; thinking: { type: string } }> = [];
  let oldHash = '';
  vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
    const body = init?.body ?? (input instanceof Request ? await input.text() : '');
    payloads.push(JSON.parse(String(body)));
    const update = payloads.length === 1;
    const delta = update ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call-update', type: 'function', function: { name: 'instructions_update', arguments: JSON.stringify({ fileId: 'workspace', content: 'WIRE_NEW_RULE', expectedHash: oldHash }) } }] } : { role: 'assistant', content: 'HTTP 完成' };
    const data = [
      { id: 'fake-completion', object: 'chat.completion.chunk', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta, finish_reason: null }] },
      { id: 'fake-completion', object: 'chat.completion.chunk', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta: {}, finish_reason: update ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } },
    ];
    return new Response(data.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  });
  const dir = await mkdtemp(join(tmpdir(), 'berserk-payload-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const config = testConfig(dir, { provider: 'deepseek', model: 'deepseek-flash' }); const lab = await PiLab.create(config); cleanup.push(() => lab.close());
  const session = await lab.createSession();
  const initial = await lab.resources.readInstruction(session.workspaceId, 'workspace');
  oldHash = (await lab.resources.updateInstruction(session.workspaceId, 'workspace', 'WIRE_OLD_RULE', initial.hash)).hash;
  const first = lab.start(session.id, '第一轮：修改约定'); await first.run(() => {});
  expect((await lab.resources.readInstruction(session.workspaceId, 'workspace')).content).toBe('WIRE_NEW_RULE');
  await lab.start(session.id, '第二轮').run(() => {});
  const latest = await lab.resources.readInstruction(session.workspaceId, 'workspace');
  await lab.resources.updateInstruction(session.workspaceId, 'workspace', '', latest.hash);
  await lab.start(session.id, '第三轮').run(() => {});
  expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
  expect(payloads).toHaveLength(4);
  const reminders = payloads.map(payload => {
    const userIndex = payload.messages.findLastIndex(message => message.role === 'user');
    expect(userIndex).toBeGreaterThan(0);
    expect(payload.messages[userIndex - 1].role).toBe('system');
    expect(payload.messages.filter(message => message.role === 'system')).toHaveLength(2);
    return textOf(payload.messages[userIndex - 1]);
  });
  const currentUsers = payloads.map(payload => textOf(payload.messages.filter(message => message.role === 'user').at(-1)!));
  expect(currentUsers).toEqual(['第一轮：修改约定', '第一轮：修改约定', '第二轮', '第三轮']);
  for (let index = 0; index < 2; index++) {
    expect(payloads[index].messages[0]).toMatchObject({ role: 'system', content: expect.stringContaining('WIRE_OLD_RULE') });
    expect(textOf(payloads[index].messages[0])).not.toContain('WIRE_NEW_RULE');
    expect(reminders[index]).toContain('WIRE_OLD_RULE');
    expect(reminders[index]).toContain(oldHash);
    expect(reminders[index]).not.toContain('WIRE_NEW_RULE');
  }
  expect(reminders[1]).toBe(reminders[0]);
  expect(textOf(payloads[2].messages[0])).toContain('WIRE_NEW_RULE');
  expect(reminders[2]).toContain('WIRE_NEW_RULE');
  expect(reminders[2]).not.toContain('WIRE_OLD_RULE');
  expect(reminders[3]).toContain('工作区正文为空');
  expect(reminders[3]).toContain('"fileId":"workspace"');
  expect(reminders[3]).toContain('"content":""');
  expect(reminders[3]).not.toContain('WIRE_OLD_RULE');
  expect(reminders[3]).not.toContain('WIRE_NEW_RULE');
  expect(textOf(payloads[3].messages[0])).not.toContain('WIRE_NEW_RULE');
  for (const current of reminders) expect(current.match(/<host_request_instructions>/g)).toHaveLength(1);
  const allUsers = payloads[3].messages.filter(message => message.role === 'user').map(textOf);
  expect(allUsers).toEqual(['第一轮：修改约定', '第二轮', '第三轮']);
  expect(allUsers).toHaveLength(3);
  expect(lab.get(session.id).messages.filter(message => message.role === 'user').map(message => message.text)).toEqual(['第一轮：修改约定', '第二轮', '第三轮']);
  expect(lab.getRequestResources(session.id, first.requestId)).toMatchObject({ status: 'available', instructions: [{ fileId: 'common' }, { fileId: 'workspace', content: 'WIRE_OLD_RULE' }] });
  for (const file of await readdir(join(dir, 'sessions'))) {
    const native = await readFile(join(dir, 'sessions', file), 'utf8');
    expect(native).not.toContain('host_request_instructions');
    const users = native.trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.type === 'message' && entry.message.role === 'user');
    expect(users).toHaveLength(3);
  }
  expect(payloads[3].thinking).toEqual({ type: 'disabled' });
  expect(JSON.stringify(payloads)).not.toContain(config.apiKey);
});
