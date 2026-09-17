import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { PiLab } from '../../src/pi/lab.js';
import { testConfig } from './fake-runtime.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { vi.useRealTimers(); for (const fn of cleanup.splice(0).reverse()) await fn(); vi.unstubAllGlobals(); });
const encoder = new TextEncoder();
const chunk = (value: unknown) => encoder.encode(`data: ${JSON.stringify(value)}\n\n`);

it.each([true, false])('uses actual HTTP byte progress for idle timeout (heartbeats=%s)', async heartbeats => {
  let calls = 0;
  vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
    calls++;
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let interval: ReturnType<typeof setInterval> | undefined;
        let terminal: ReturnType<typeof setTimeout> | undefined;
        const stop = () => { clearInterval(interval); clearTimeout(terminal); };
        signal?.addEventListener('abort', () => { stop(); controller.error(new Error('aborted')); }, { once: true });
        if (heartbeats) {
          interval = setInterval(() => controller.enqueue(encoder.encode(': heartbeat\n\n')), 20);
          terminal = setTimeout(() => {
            stop();
            controller.enqueue(chunk({ id: 'fake', object: 'chat.completion.chunk', created: 1, model: 'deterministic-model', choices: [{ index: 0, delta: { content: '持续处理完成' }, finish_reason: null }] }));
            controller.enqueue(chunk({ id: 'fake', object: 'chat.completion.chunk', created: 1, model: 'deterministic-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } }));
            controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close();
          }, 160);
        }
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const dir = await mkdtemp(join(tmpdir(), 'berserk-idle-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const lab = await PiLab.create(testConfig(dir, { httpIdleTimeoutMs: 50 })); cleanup.push(() => lab.close());
  const session = await lab.createSession();
  vi.useFakeTimers();
  const work = lab.start(session.id, '持续流或停滞').run(() => {});
  await vi.waitFor(() => expect(calls).toBe(1));
  for (let index = 0; index < 4; index++) await vi.advanceTimersByTimeAsync(8001);
  await work;
  expect(lab.get(session.id).lastResult?.status).toBe(heartbeats ? 'succeeded' : 'failed');
  expect(calls).toBe(heartbeats ? 1 : 4);
  if (!heartbeats) expect(lab.get(session.id).lastResult?.message).toContain('超时');
});

it('enforces the explicit provider request timeout while HTTP idle timing is disabled', async () => {
  let calls = 0;
  vi.stubGlobal('fetch', (input: Request | string | URL, init?: RequestInit) => {
    calls++;
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  });
  const dir = await mkdtemp(join(tmpdir(), 'berserk-request-timeout-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const lab = await PiLab.create(testConfig(dir, { httpIdleTimeoutMs: 0, llmRequestTimeoutMs: 50 })); cleanup.push(() => lab.close());
  const session = await lab.createSession();
  vi.useFakeTimers();
  const work = lab.start(session.id, '连接一直不返回响应头').run(() => {});
  await vi.waitFor(() => expect(calls).toBe(1));
  for (let index = 0; index < 4; index++) await vi.advanceTimersByTimeAsync(8001);
  await work;
  expect(calls).toBe(4);
  expect(lab.get(session.id).lastResult).toMatchObject({ status: 'failed', message: expect.stringContaining('超时') });
});
