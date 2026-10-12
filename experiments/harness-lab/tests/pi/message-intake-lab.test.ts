import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PiLab } from '../../src/pi/lab.js';
import type { InputSubmission, StreamEvent } from '../../src/contracts/index.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
async function setup(reply: Parameters<typeof fakeRuntime>[1] = () => ({text: '回复'})) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-intake-lab-'));
  cleanups.push(() => rm(dir, {recursive: true, force: true}));
  const config = testConfig(dir); const fake = await fakeRuntime(config, reply);
  const lab = await PiLab.create(config, fake.runtime); cleanups.push(() => lab.close());
  return {lab, ...fake};
}

describe('request scoped Pi intake', () => {
  it('runs identical submissions once each in Pi priority order, saves history, and uses one request snapshot', async () => {
    const {lab, calls} = await setup(); const session = await lab.createSession();
    const request = lab.start(session.id, '初始'); const seen: StreamEvent[] = [];
    let sent = false; const a: InputSubmission = {submissionId: randomUUID(), expectedRequestId: request.requestId, text: '相同', mode: 'followUp'};
    const b = {...a, submissionId: randomUUID(), mode: 'steer' as const};
    await request.run(event => {
      seen.push(event);
      if (event.type === 'input.queue' && event.queue.available && !sent) {
        sent = true; lab.submitInput(session.id, a); lab.submitInput(session.id, a); lab.submitInput(session.id, b);
      }
    });
    expect(calls).toHaveLength(3);
    expect(calls.every(call => call.context.systemPrompt === calls[0].context.systemPrompt)).toBe(true);
    expect(seen.filter(event => event.type === 'input.consumed').map(event => event.submissionId)).toEqual([b.submissionId, a.submissionId]);
    expect(seen.every(event => event.requestId === request.requestId)).toBe(true);
    expect(lab.get(session.id).messages.filter(message => message.role === 'user').map(message => message.text)).toEqual(['初始', '相同', '相同']);
    expect(lab.get(session.id).lastResult?.usageSummary?.replyAttempts).toBe(3);
    expect(lab.getRequestResources(session.id, request.requestId).status).not.toBe('unavailable');
    expect(lab.submitInput(session.id, a).receipt?.status).toBe('consumed');
    expect(() => lab.submitInput(session.id, {...a, submissionId: randomUUID()})).toThrow(/结束/);
  });

  it('returns pending input on stop, preserves a consumed initial message and permits takeback after a new run', async () => {
    const {lab} = await setup(); const session = await lab.createSession();
    const request = lab.start(session.id, '初始'); const submissionId = randomUUID(); let sent = false;
    await request.run(event => {
      if (event.type === 'input.queue' && event.queue.available && !sent) {
        sent = true; lab.submitInput(session.id, {submissionId, expectedRequestId: request.requestId, text: '取回内容', mode: 'followUp'});
        lab.cancel(session.id, request.requestId);
      }
    });
    expect(lab.inputReceipt(session.id, submissionId).receipt?.status).toBe('returned');
    expect(lab.get(session.id).messages.filter(message => message.role === 'user')).toHaveLength(1);
    const next = lab.start(session.id, '新轮次'); await next.run(() => {});
    const queue = lab.get(session.id).inputQueue!;
    expect(lab.actOnInput(session.id, submissionId, {actionId: randomUUID(), expectedRequestId: request.requestId, pendingRevision: queue.revision, action: 'takeback'}).receipt?.status).toBe('takenBack');
  });

  it('retains accepted text when provider fails without inserting it into native history', async () => {
    const {lab} = await setup(() => ({error: '401 invalid key'})); const session = await lab.createSession();
    const request = lab.start(session.id, '初始'); const submissionId = randomUUID(); let sent = false;
    await request.run(event => {
      if (event.type === 'input.queue' && event.queue.available && !sent) {
        sent = true; lab.submitInput(session.id, {submissionId, expectedRequestId: request.requestId, text: '未执行内容', mode: 'followUp'});
      }
    });
    expect(lab.get(session.id).lastResult?.status).toBe('failed');
    expect(lab.inputReceipt(session.id, submissionId).receipt?.status).toBe('returned');
    expect(lab.get(session.id).messages.some(message => message.text === '未执行内容')).toBe(false);
  });

  it('keeps pending follow-up through native transient retry without retrying its submission', async () => {
    const {lab, calls} = await setup((_context, index) => index === 0 ? {error: '503 overloaded'} : {text: '恢复'});
    const session = await lab.createSession(); const request = lab.start(session.id, '初始'); let sent = false;
    const submissionId = randomUUID();
    await request.run(event => {
      if (event.type === 'input.queue' && event.queue.available && !sent) {
        sent = true; lab.submitInput(session.id, {submissionId, expectedRequestId: request.requestId, text: '后续', mode: 'followUp'});
      }
    });
    expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
    expect(calls).toHaveLength(3);
    expect(lab.get(session.id).messages.filter(message => message.role === 'user' && message.text === '后续')).toHaveLength(1);
    expect(lab.inputReceipt(session.id, submissionId).receipt?.status).toBe('consumed');
  });

  it('does not accept free-text input while waiting for an explicit human answer', async () => {
    const {lab} = await setup((_context, index) => index === 0 ? {tools: [{name: 'ask_user', arguments: {questions: [{id: 'q', prompt: '选哪项？', options: [{id: 'a', label: '甲'}, {id: 'b', label: '乙'}]}]}}]} : {text: '完成'});
    const session = await lab.createSession(); const request = lab.start(session.id, '询问'); let rejected = false;
    await request.run(event => {
      if (event.type === 'interaction.updated' && event.interaction.status === 'pending') {
        try { lab.submitInput(session.id, {submissionId: randomUUID(), expectedRequestId: request.requestId, text: '同意', mode: 'steer'}); }
        catch { rejected = true; }
        lab.cancel(session.id, request.requestId);
      }
    });
    expect(rejected).toBe(true);
  });
});
