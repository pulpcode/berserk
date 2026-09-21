import { fork } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import type { BackgroundConfig } from '../../src/background/config.js';
import { BackgroundService } from '../../src/background/service.js';
import { PiLab } from '../../src/pi/lab.js';
import { createBackgroundExecutor } from '../../src/pi/background-runner.js';
import { fakeRuntime, testConfig } from '../pi/fake-runtime.js';

type Boundary = 'before_commit' | 'queued' | 'claimed' | 'native_finished' | 'succeeded_pending';
interface CrashRecord {boundary: Boundary; eventId: string; jobId: string; sessionId?: string; acknowledged?: boolean; pending?: number}
const countCalls = async (dir: string) => (await readFile(join(dir, 'model-calls.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean).length;
async function within<T>(pending: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([pending, new Promise<never>((_resolve, reject) => {timer = setTimeout(() => reject(new Error('Child did not stop after SIGKILL')), ms);})]); }
  finally {clearTimeout(timer);}
}

it.each<Boundary>(['before_commit', 'queued', 'claimed', 'native_finished', 'succeeded_pending'])('SIGKILL at %s retains the real database/native-history boundary without replay', async boundary => {
  const dir = await mkdtemp(join(tmpdir(), 'axon-background-kill-'));
  const child = fork(fileURLToPath(new URL('./fixtures/background-crash.ts', import.meta.url)), [dir, boundary], {execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
  let stderr = ''; child.stderr!.on('data', chunk => { stderr += String(chunk); });
  let lab: PiLab | undefined, service: BackgroundService | undefined;
  const exited = new Promise<{code: number | null; signal: NodeJS.Signals | null}>(resolve => child.once('exit', (code, signal) => resolve({code, signal})));
  try {
    const record = await new Promise<CrashRecord>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Crash boundary timeout (${boundary}): ${stderr}`)), 10_000);
      child.once('message', message => {clearTimeout(timer); resolve(message as CrashRecord);});
      child.once('error', error => {clearTimeout(timer); reject(error);});
      child.once('exit', (code, signal) => {clearTimeout(timer); reject(new Error(`Unexpected child exit ${code}/${signal}: ${stderr}`));});
    });
    expect(record.boundary).toBe(boundary);
    expect(child.kill('SIGKILL')).toBe(true);
    const exit = await within(exited, 3000);
    expect(exit.signal).toBe('SIGKILL');

    const expectedCalls = ['native_finished', 'succeeded_pending'].includes(boundary) ? 1 : 0;
    expect(await countCalls(dir)).toBe(expectedCalls);
    const config = testConfig(dir, {seatId: 'a', auth: {secret: 'test-crash-signing-key-at-least-32-characters', sessionMs: 28800000}});
    const fake = await fakeRuntime(config, () => {appendFileSync(join(dir, 'model-calls.log'), 'UNEXPECTED_REPLAY\n'); return {text: 'UNEXPECTED_REPLAY'};});
    lab = await PiLab.create(config, fake.runtime);
    const background = JSON.parse(await readFile(join(dir, 'fixture-config.json'), 'utf8')) as BackgroundConfig;
    service = new BackgroundService(lab, background);
    await service.initialize();
    const store = service.store;
    if (boundary === 'before_commit') {
      expect(record.acknowledged).toBe(false);
      expect(await stat(join(dir, 'accepted.json')).catch(() => null)).toBeNull();
      expect(store.listEvents()).toEqual([]); expect(store.listJobs()).toEqual([]); expect(store.listDeliveries()).toEqual([]);
      const receipt = await service.accept('crash-source', {sourceMessageId: 'stable-message', title: '崩溃边界', text: '需要分析的原始输入'});
      expect(receipt.eventId).not.toBe(record.eventId); expect(store.listEvents()).toHaveLength(1); expect(store.listJobs()[0].status).toBe('queued');
    } else {
      expect(store.getEvent(record.eventId).initialJobId).toBe(record.jobId);
      expect(JSON.parse(await readFile(join(dir, 'accepted.json'), 'utf8')).eventId).toBe(record.eventId);
      const job = store.getJob(record.jobId);
      expect(job.status).toBe(boundary === 'queued' ? 'queued' : boundary === 'succeeded_pending' ? 'succeeded' : 'interrupted');
      if (boundary === 'queued') expect(store.sessionReservation(job.sessionId!)?.id).toBe(job.id);
      if (boundary === 'claimed' || boundary === 'native_finished') expect(job.error?.code).toBe('SERVICE_RESTARTED');
      if (expectedCalls) {
        expect(await readFile(join(dir, 'background', 'jobs', job.id, 'files', 'effect.txt'), 'utf8')).toBe('effect\n');
        const native = await createBackgroundExecutor(lab).read(job);
        expect(native?.messages.some(message => message.text === 'PERSISTED_NATIVE_ANSWER')).toBe(true);
        expect(native?.lastResult?.status).toBe('succeeded');
        if (boundary === 'native_finished') {expect(job.result).toBeUndefined(); expect(store.listDeliveries()).toEqual([]);}
      }
    }
    if (boundary === 'succeeded_pending') {
      expect(record.pending).toBe(1); expect(store.listDeliveries().map(delivery => delivery.status)).toEqual(['pending']);
    }
    await service.start();
    if (boundary === 'succeeded_pending') {
      await vi.waitFor(() => expect(store.listDeliveries().map(delivery => delivery.status)).toEqual(['delivered']));
      const actor = lab.access!.identity(String(lab.access!.db.prepare('SELECT id FROM accounts WHERE username=?').get('a')!.id))!;
      const inbox = service.inbox(actor, {}); expect(inbox.items).toHaveLength(1);
      expect((await service.inboxDetail(actor, inbox.items[0].delivery.id)).resultText).toBe('PERSISTED_NATIVE_ANSWER');
      // Starting delivery again must not create another receipt or execute Pi.
      await service.pump(); expect(store.listDeliveries()).toHaveLength(1);
    }
    // Explicitly exercise the periodic worker too, not only initialization.
    await service.pump();
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(fake.calls).toEqual([]); expect(await countCalls(dir)).toBe(expectedCalls);
    if (expectedCalls) expect(await readFile(join(dir, 'background', 'jobs', record.jobId, 'files', 'effect.txt'), 'utf8')).toBe('effect\n');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await within(exited, 3000);
    await service?.close(); await lab?.close(); await rm(dir, {recursive: true, force: true});
  }
}, 20_000);
