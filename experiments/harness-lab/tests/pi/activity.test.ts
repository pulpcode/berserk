import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { PiLab } from '../../src/pi/lab.js';
import type { SessionActivity } from '../../src/contracts/index.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.restoreAllMocks(); });
async function setup(reply: Parameters<typeof fakeRuntime>[1] = () => ({ text: '完成' })) {
  const dir = await mkdtemp(join(tmpdir(), 'berserk-activity-test-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const config = testConfig(dir);
  const fake = await fakeRuntime(config, reply);
  const lab = await PiLab.create(config, fake.runtime);
  cleanup.push(() => lab.close());
  return { lab, config, ...fake };
}
const activity = (lab: PiLab, id: string) => lab.activity().sessions.find(session => session.id === id)!;

describe('global session activity', () => {
  it('projects preparation, actual model/tool work, stopping and cancellation across workspaces', async () => {
    const { lab, calls } = await setup((_context, index) => index === 0 ? { toolIds: ['meeting-notes'] } : { waitForAbort: true });
    const idle = await lab.createSession();
    const workspace = await lab.workspaces.create('后台区');
    const session = await lab.createSession(workspace.id);
    const request = lab.start(session.id, '读取资料');
    expect(activity(lab, session.id).active).toEqual({ requestId: request.requestId, status: 'responding', phase: 'preparing' });
    const phases: SessionActivity[] = [];
    const work = request.run(event => {
      if (event.type === 'tool.started' || event.type === 'tool.completed') phases.push(activity(lab, session.id));
    });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(phases[0].active).toMatchObject({ phase: 'tool', toolName: 'source.read' });
    expect(phases[1].active).toMatchObject({ phase: 'preparing' });
    expect(phases[1].active).not.toHaveProperty('toolName');
    const generating = activity(lab, session.id);
    expect(generating.active).toMatchObject({ phase: 'generating', status: 'responding' });
    expect(lab.get(session.id).active).toEqual(generating.active);
    expect(activity(lab, idle.id).active).toBeNull();
    expect(activity(lab, session.id).statusUpdatedAt).toBe(generating.statusUpdatedAt);
    expect(lab.cancel(session.id, request.requestId).active?.status).toBe('stopping');
    expect(activity(lab, session.id).active?.status).toBe('stopping');
    await work;
    expect(activity(lab, session.id)).toMatchObject({ active: null, lastResult: { requestId: request.requestId, status: 'cancelled' } });
  });

  it('reloads terminal results and recovery warnings without inventing running work', async () => {
    const { lab, config } = await setup((_context, index) => index === 0 ? { text: '完成' } : { error: 'provider failed' });
    const completed = await lab.createSession(); const failed = await lab.createSession(); const interrupted = await lab.createSession();
    const success = lab.start(completed.id, '已结束'); await success.run(() => {});
    const failure = lab.start(failed.id, '失败'); await failure.run(() => {});
    await lab.close();
    const directory = join(config.dataDir, 'sessions');
    for (const filename of await readdir(directory)) {
      const manager = SessionManager.open(join(directory, filename), directory);
      if (manager.getSessionId() === interrupted.id) manager.appendMessage({ role: 'user', content: '未完成', timestamp: Date.now() });
    }
    const fake = await fakeRuntime(config, () => ({ text: '不应执行' }));
    const restored = await PiLab.create(config, fake.runtime); cleanup.push(() => restored.close());
    expect(activity(restored, completed.id)).toMatchObject({ active: null, lastResult: { requestId: success.requestId, status: 'succeeded' } });
    expect(activity(restored, failed.id)).toMatchObject({ active: null, lastResult: { requestId: failure.requestId, status: 'failed' } });
    expect(activity(restored, failed.id).lastResult).not.toHaveProperty('message');
    expect(activity(restored, interrupted.id)).toMatchObject({ active: null, recoveryWarning: expect.stringContaining('不会自动重发') });
    expect(restored.activity().sessions.every(session => session.statusUpdatedAt === session.updatedAt)).toBe(true);
    expect(fake.calls).toHaveLength(0);
  });

  it('polls unchanged summaries without traversing native histories and refreshes after new messages', async () => {
    const { lab } = await setup(); const session = await lab.createSession();
    const empty = activity(lab, session.id);
    const branch = vi.spyOn(SessionManager.prototype, 'getBranch');
    for (let i = 0; i < 5; i++) expect(activity(lab, session.id)).toEqual(empty);
    expect(branch).not.toHaveBeenCalled();
    const request = lab.start(session.id, '首条消息作为标题'); await request.run(() => {});
    const completed = activity(lab, session.id);
    expect(completed.title).toBe('首条消息作为标题');
    expect(completed.updatedAt).toBe(lab.get(session.id).updatedAt);
    branch.mockClear();
    for (let i = 0; i < 5; i++) expect(activity(lab, session.id)).toEqual(completed);
    expect(branch).not.toHaveBeenCalled();
  });
});
