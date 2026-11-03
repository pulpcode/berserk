import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PiLab } from '../../src/pi/lab.js';
import { processingText } from '../../src/background/service.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup(reply: Parameters<typeof fakeRuntime>[1]) {
  const dataDir = await mkdtemp(join(tmpdir(), 'axon-continuous-p0-'));
  cleanup.push(() => rm(dataDir, {recursive: true, force: true}));
  const config = testConfig(dataDir); const fake = await fakeRuntime(config, reply);
  const lab = await PiLab.create(config, fake.runtime); cleanup.push(() => lab.close());
  return {lab, config, ...fake};
}

describe('Pi 0.85.1 continuous-session P0', () => {
  it('continues native history while exact request final and intermediate text stay fixed across restart', async () => {
    const env = await setup((_context, index) => index === 0 ? {text: 'INTERMEDIATE_UNCONFIRMED', toolIds: ['meeting-notes']}
      : {text: index === 1 ? 'PUBLISHED_V1' : 'UNPUBLISHED_V2'});
    const session = await env.lab.createSession();
    const first = env.lab.start(session.id, 'FIRST_ORIGINAL_INPUT'); await first.run(() => {});
    const before = await env.lab.readSavedSession(session.id);
    const finalId = before.turns?.find(turn => turn.requestId === first.requestId)?.finalMessageId;
    const second = env.lab.start(session.id, 'SECOND_ORIGINAL_INPUT'); await second.run(() => {});
    expect(JSON.stringify(env.calls.at(-1)?.context.messages)).toContain('FIRST_ORIGINAL_INPUT');
    expect(JSON.stringify(env.calls.at(-1)?.context.messages)).toContain('PUBLISHED_V1');
    await env.lab.close();
    const restored = await PiLab.create(env.config, env.runtime); cleanup.push(() => restored.close());
    const saved = await restored.readSavedSession(session.id);
    expect(saved.turns?.find(turn => turn.requestId === first.requestId)?.finalMessageId).toBe(finalId);
    expect(processingText(saved, first.requestId)).toBe('## 处理过程中的说明\n\nINTERMEDIATE_UNCONFIRMED\n\n## 最终答复\n\nPUBLISHED_V1');
    expect(processingText(saved, first.requestId)).not.toContain('UNPUBLISHED_V2');
    expect(saved.messages.filter(message => message.role === 'user')).toHaveLength(2);
    expect(env.calls).toHaveLength(3);
  });
  it.each(['failed', 'cancelled'] as const)('isolates %s history on explicit recovery without automatic replay', async status => {
    const env = await setup((_context, index) => index === 0 ? {text: 'AUTHORIZED_PUBLISHED_V1'}
      : index === 1 ? status === 'failed' ? {error: 'invalid request: fixture failure'} : {waitForAbort: true}
      : {text: 'RECOVERED_V2'});
    const session = await env.lab.createSession();
    const published = env.lab.start(session.id, 'PUBLISHED_INPUT'); await published.run(() => {});
    const bad = env.lab.start(session.id, 'UNPUBLISHED_ATTEMPT'); const pending = bad.run(() => {});
    if (status === 'cancelled') { await vi.waitFor(() => expect(env.calls).toHaveLength(2)); env.lab.cancel(session.id, bad.requestId); }
    await pending;
    expect(env.lab.get(session.id).lastResult?.status).toBe(status);
    await env.lab.close();
    const restored = await PiLab.create(env.config, env.runtime); cleanup.push(() => restored.close());
    const original = await restored.readSavedSession(session.id);
    expect(env.calls).toHaveLength(2);
    expect(processingText(original, published.requestId)).toBe('AUTHORIZED_PUBLISHED_V1');
    const fresh = await restored.createSession();
    await restored.start(fresh.id, 'EXPLICIT_RECOVERY_INPUT').run(() => {});
    expect(JSON.stringify(env.calls.at(-1)?.context.messages)).not.toContain('UNPUBLISHED_ATTEMPT');
    expect((await restored.readSavedSession(session.id)).messages).toEqual(original.messages);
  });
});
