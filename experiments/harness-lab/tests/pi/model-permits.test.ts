import { describe, expect, it, vi } from 'vitest';
import { ModelPermits } from '../../src/background/model-permits.js';
import { controlledStream, emptyUsage } from '../../src/pi/controlled-stream.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';

describe('provider stream permits', () => {
  it('keeps FIFO order, removes cancelled waiters and releases each permit only once', async () => {
    const pool = new ModelPermits(1); const first = await pool.acquire(new AbortController().signal);
    const removed = new AbortController(); const second = pool.acquire(removed.signal);
    const rejected = expect(second).rejects.toThrow('cancelled');
    const order: number[] = [];
    const third = pool.acquire(new AbortController().signal).then(release => { order.push(3); return release; });
    const fourth = pool.acquire(new AbortController().signal).then(release => { order.push(4); return release; });
    removed.abort(new Error('cancelled')); await rejected;
    first(); first(); const finishThird = await third;
    expect(order).toEqual([3]); finishThird(); (await fourth)(); expect(order).toEqual([3, 4]);
  });

  it('does not count waiting or start the stream idle timeout before admission', async () => {
    const config = testConfig('/tmp/unused-model-permits', { httpIdleTimeoutMs: 20 });
    const fake = await fakeRuntime(config, () => ({ text: 'accepted' }));
    const pool = new ModelPermits(1); const release = await pool.acquire(new AbortController().signal);
    const usage = emptyUsage(); const started = vi.fn(); const controller = new AbortController();
    const stream = controlledStream(fake.runtime, config, fake.runtime.getModel(config.provider, config.model)!, { messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }] }, undefined,
      'reply', '', controller.signal, usage, { permits: pool, waiting: () => {}, started });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(fake.calls).toHaveLength(0); expect(usage.modelAttempts).toBe(0); expect(started).not.toHaveBeenCalled();
    release(); expect((await stream.result()).stopReason).toBe('stop');
    expect(usage.modelAttempts).toBe(1); expect(started).toHaveBeenCalledOnce();
  });

  it('cancels a queued summary without charging an unknown model attempt', async () => {
    const config = testConfig('/tmp/unused-model-permits'); const fake = await fakeRuntime(config, () => ({ text: 'never' }));
    const pool = new ModelPermits(1); const release = await pool.acquire(new AbortController().signal);
    const usage = emptyUsage(); const controller = new AbortController();
    const stream = controlledStream(fake.runtime, config, fake.runtime.getModel(config.provider, config.model)!, { messages: [] }, undefined, 'compaction', '', controller.signal, usage,
      { permits: pool, waiting: () => {}, started: () => {} });
    controller.abort(); expect((await stream.result()).stopReason).toBe('aborted');
    expect(usage).toEqual(emptyUsage()); expect(fake.calls).toEqual([]); release();
  });
});
