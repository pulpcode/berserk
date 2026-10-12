import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { MessageIntake } from '../../src/pi/message-intake.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
async function setup(reply: Parameters<typeof fakeRuntime>[1] = () => ({text: '完成'})) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-intake-'));
  cleanups.push(() => rm(dir, {recursive: true, force: true}));
  const config = testConfig(dir);
  const fake = await fakeRuntime(config, reply);
  await fake.runtime.setRuntimeApiKey(config.provider, config.apiKey!);
  const settings = SettingsManager.inMemory({compaction: {enabled: false}, retry: {enabled: false}, enableAnalytics: false});
  const loader = new DefaultResourceLoader({cwd: dir, agentDir: dir, settingsManager: settings,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: '测试'});
  await loader.reload();
  const {session} = await createAgentSession({cwd: dir, agentDir: dir, modelRuntime: fake.runtime,
    model: fake.runtime.getModel(config.provider, config.model)!, thinkingLevel: 'off', noTools: 'all',
    settingsManager: settings, resourceLoader: loader, sessionManager: SessionManager.inMemory(dir)});
  cleanups.push(async () => { await session.abort(); session.dispose(); });
  return {...fake, session};
}
const input = (timestamp: number) => ({role: 'user' as const, content: [{type: 'text' as const, text: '相同文字'}], timestamp});

describe('native queue public API boundary spike', () => {
  it('preserves identical submissions by message identity and keeps native persistence', async () => {
    const {session, calls} = await setup(); const consumed: number[] = [];
    session.subscribe(event => {
      if (event.type === 'message_start' && event.message.role === 'assistant' && calls.length === 1) {
        session.agent.followUp(input(101)); session.agent.steer(input(102));
      }
      if (event.type === 'message_end' && event.message.role === 'user') consumed.push(event.message.timestamp);
    });
    await session.prompt('开始');
    expect(consumed.slice(1)).toEqual([102, 101]);
    expect(calls).toHaveLength(3);
    expect(session.sessionManager.getBranch().filter(e => e.type === 'message' && e.message.role === 'user')).toHaveLength(3);
  });

  it('demonstrates clearAllQueues cannot delete a follow-up already claimed before preparation', async () => {
    const {session, calls} = await setup(); let queued = false;
    session.subscribe(event => {
      if (event.type === 'message_start' && event.message.role === 'assistant' && !queued) {
        queued = true; session.agent.followUp(input(101));
      }
    });
    const prepare = session.agent.prepareNextTurnWithContext;
    session.agent.prepareNextTurnWithContext = async (context, signal) => {
      expect(session.agent.hasQueuedMessages()).toBe(false);
      session.agent.clearAllQueues();
      return prepare?.(context, signal);
    };
    await session.prompt('开始');
    expect(calls).toHaveLength(2);
    expect(calls[1].context.messages.some(m => m.role === 'user' && m.timestamp === 101)).toBe(true);
  });

  it('seals at turn_end before dequeue and opens only after user delivery, allowing safe clear/requeue during model work', async () => {
    const {session, calls} = await setup(); let writable = false; let mutated = false; const delivered: number[] = [];
    session.subscribe(event => {
      if (event.type === 'turn_end' || event.type === 'agent_end') writable = false;
      if (event.type === 'message_start' && event.message.role === 'user') {
        expect(writable).toBe(false); delivered.push(event.message.timestamp);
      }
      if (event.type === 'message_start' && event.message.role === 'assistant') {
        writable = true;
        if (!mutated) {
          mutated = true; session.agent.followUp(input(101)); session.agent.followUp(input(102));
          session.agent.clearAllQueues(); session.agent.steer(input(102));
        }
      }
    });
    const prepare = session.agent.prepareNextTurnWithContext;
    session.agent.prepareNextTurnWithContext = async (context, signal) => {
      expect(writable).toBe(false);
      await new Promise(resolve => setTimeout(resolve, 5));
      expect(writable).toBe(false);
      return prepare?.(context, signal);
    };
    await session.prompt('开始');
    expect(delivered.slice(1)).toEqual([102]); expect(calls).toHaveLength(2); expect(writable).toBe(false);
  });
});


describe('MessageIntake with real Pi', () => {
  it('mutates independent identical submissions, deduplicates retries and consumes only remaining native messages', async () => {
    const {session, calls} = await setup(); const intake = new MessageIntake();
    const consumed: string[] = [];
    intake.bind('run', session, () => undefined, () => {}, receipt => consumed.push(receipt.submissionId));
    let submitted = false;
    session.agent.subscribe(event => {
      if (event.type !== 'message_start' || event.message.role !== 'assistant' || submitted) return;
      submitted = true;
      const a = {submissionId: 'a', expectedRequestId: 'run', mode: 'followUp' as const, text: '同文'};
      intake.submit(a); intake.submit(a);
      intake.submit({...a, submissionId: 'b'}); intake.submit({...a, submissionId: 'c'});
      const act = (id: string, action: 'steer' | 'delete' | 'undo' | 'takeback', actionId = action + id) => intake.act(id, {actionId, expectedRequestId: 'run', pendingRevision: intake.state().revision, action});
      act('b', 'steer'); act('a', 'delete'); act('c', 'takeback');
      expect(() => intake.submit({...a, text: '不同内容'})).toThrow(/不同内容/);
      expect(intake.state().items.map(item => item.submissionId)).toEqual(['b']);
    });
    await session.prompt('开始'); intake.finish();
    expect(consumed).toEqual(['b']); expect(calls).toHaveLength(2);
    expect(intake.lookup('a').receipt?.status).toBe('deleted');
    expect(intake.lookup('b').receipt?.status).toBe('consumed');
    expect(intake.lookup('c').receipt?.status).toBe('takenBack');
    expect(intake.submit({submissionId: 'b', expectedRequestId: 'run', mode: 'followUp', text: '同文'}).receipt?.status).toBe('consumed');
  });

  it('conversion and undo join the channel tail without reordering already queued guidance', async () => {
    const {session} = await setup(); const intake = new MessageIntake(); const consumed: string[] = [];
    intake.bind('run', session, () => undefined, () => {}, receipt => consumed.push(receipt.submissionId));
    let sent = false;
    session.agent.subscribe(event => {
      if (event.type !== 'message_start' || event.message.role !== 'assistant' || sent) return;
      sent = true;
      for (const [submissionId, mode] of [['old', 'followUp'], ['guidance', 'steer'], ['later', 'followUp']] as const) intake.submit({submissionId, expectedRequestId: 'run', mode, text: submissionId});
      const act = (id: string, action: 'steer' | 'delete' | 'undo') => intake.act(id, {actionId: action + id, expectedRequestId: 'run', pendingRevision: intake.state().revision, action});
      act('old', 'steer'); act('guidance', 'delete'); act('guidance', 'undo');
    });
    await session.prompt('开始'); intake.finish();
    expect(consumed).toEqual(['old', 'guidance', 'later']);
  });

  it('restores parked input when Pi continues a truncated tool turn in the same native run', async () => {
    const {session, calls} = await setup((_context, index) => index === 0
      ? {length: true, tools: [{name: 'source_read', arguments: {id: 'a'}}]} : {text: '完成'});
    const intake = new MessageIntake(); const consumed: string[] = []; let queued = false; let starts = 0;
    intake.bind('run', session, () => undefined, () => {}, receipt => consumed.push(receipt.submissionId));
    session.agent.subscribe(event => {
      if (event.type === 'agent_start') starts++;
      if (event.type === 'message_start' && event.message.role === 'assistant' && !queued) {
        queued = true; intake.submit({submissionId: 'a', expectedRequestId: 'run', mode: 'followUp', text: '后续'});
      }
    });
    await session.prompt('开始'); intake.finish();
    expect(starts).toBe(1);
    expect(calls).toHaveLength(3);
    expect(consumed).toEqual(['a']);
    expect(intake.lookup('a').receipt?.status).toBe('consumed');
  });

  it('rejects delete while a message is claimed for preparation instead of returning a message that still executes', async () => {
    const {session, calls} = await setup(); const intake = new MessageIntake();
    intake.bind('run', session, () => undefined, () => {}, () => {});
    let queued = false;
    session.agent.subscribe(event => {
      if (event.type === 'message_start' && event.message.role === 'assistant' && !queued) {
        queued = true; intake.submit({submissionId: 'a', expectedRequestId: 'run', mode: 'followUp', text: '后续'});
      }
    });
    const prepare = session.agent.prepareNextTurnWithContext;
    session.agent.prepareNextTurnWithContext = async (context, signal) => {
      expect(intake.state().available).toBe(false);
      expect(() => intake.act('a', {actionId: 'delete', expectedRequestId: 'run', pendingRevision: intake.state().revision, action: 'delete'})).toThrow(/准备/);
      return prepare?.(context, signal);
    };
    await session.prompt('开始'); intake.finish();
    expect(calls).toHaveLength(2); expect(intake.lookup('a').receipt?.status).toBe('consumed');
  });

  it('stops after dequeue, lets native claimed delivery settle, and returns only unconsumed messages', async () => {
    const {session} = await setup(); const intake = new MessageIntake();
    intake.bind('run', session, () => undefined, () => {}, () => {});
    let queued = false;
    session.agent.subscribe(event => {
      if (event.type === 'message_start' && event.message.role === 'assistant' && !queued) {
        queued = true;
        intake.submit({submissionId: 'a', expectedRequestId: 'run', mode: 'followUp', text: '已取出'});
        intake.submit({submissionId: 'b', expectedRequestId: 'run', mode: 'followUp', text: '尚未取出'});
      }
    });
    session.agent.prepareNextTurnWithContext = async () => { intake.stop(); session.agent.abort(); return undefined; };
    await session.prompt('开始'); intake.finish();
    expect(intake.lookup('a').receipt?.status).toBe('consumed');
    expect(intake.lookup('b').receipt?.status).toBe('returned');
    expect(intake.state().items.map(item => item.submissionId)).toEqual(['b']);
    intake.act('b', {actionId: 'take', expectedRequestId: 'run', pendingRevision: intake.state().revision, action: 'takeback'});
    expect(intake.state().items).toEqual([]);
  });

  it('retains input accepted before provider failure and makes receipt/action retries queryable', async () => {
    const {session} = await setup(); const intake = new MessageIntake();
    intake.bind('run', session, () => undefined, () => {}, () => {});
    session.agent.subscribe(event => {
      if (event.type === 'message_start' && event.message.role === 'assistant') {
        intake.submit({submissionId: 'a', expectedRequestId: 'run', mode: 'followUp', text: '待恢复'});
        const action = {actionId: 'delete', expectedRequestId: 'run', pendingRevision: intake.state().revision, action: 'delete' as const};
        intake.act('a', action); expect(intake.act('a', action).receipt?.status).toBe('deleted');
        intake.stop(); session.agent.abort();
      }
    });
    await session.prompt('开始'); intake.finish();
    const result = intake.act('a', {actionId: 'undo', expectedRequestId: 'run', pendingRevision: intake.state().revision, action: 'undo'});
    expect(result.receipt?.status).toBe('returned');
    expect(() => intake.submit({submissionId: 'new', expectedRequestId: 'run', mode: 'steer', text: '过期'})).toThrow(/结束/);
  });
});
