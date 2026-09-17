import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { PiLab } from '../../src/pi/lab.js';
import { resourceTools } from '../../src/pi/resource-tools.js';
import { testConfig, fakeRuntime } from './fake-runtime.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn(); });

it.each(['instructions_read', 'instructions_update'] as const)('waits for %s to settle after timeout and preserves known file effects', async name => {
  const dir = await mkdtemp(join(tmpdir(), 'berserk-tool-timeout-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const config = testConfig(dir); const lab = await PiLab.create(config, (await fakeRuntime(config, () => ({ text: 'ok' }))).runtime); cleanup.push(() => lab.close());
  const workspace = lab.workspaces.list().defaultWorkspaceId;
  const snapshot = await lab.resources.snapshot(workspace);
  const current = await lab.resources.readInstruction(workspace, 'workspace');
  const update = { fileId: 'workspace' as const, status: 'updated' as const, previousHash: current.hash, hash: 'a'.repeat(64), effectiveFrom: 'next_request' as const };
  let settle!: () => void;
  const pending = new Promise<void>(resolve => { settle = resolve; });
  if (name === 'instructions_read') vi.spyOn(lab.resources, 'readInstruction').mockImplementation(async () => { await pending; return current; });
  else vi.spyOn(lab.resources, 'updateInstruction').mockImplementation(async () => { await pending; return update; });
  const manager = SessionManager.inMemory(dir); const changed = vi.fn();
  const tool = resourceTools(snapshot, lab.resources, manager, 'request-id', new AbortController(), changed, vi.fn(), () => {}, { [name]: 10 }).find(tool => tool.name === name)!;
  vi.useFakeTimers();
  let finished = false;
  const work = tool.execute('tool-id', { fileId: 'workspace', content: '新指令', expectedHash: current.hash }, undefined, undefined, {} as Parameters<typeof tool.execute>[4]).then(
    () => { finished = true; return ''; }, error => { finished = true; return String(error); });
  await vi.advanceTimersByTimeAsync(11);
  expect(finished).toBe(false);
  settle();
  expect(await work).toContain('TOOL_TIMEOUT');
  if (name === 'instructions_update') {
    expect(changed).toHaveBeenCalledWith(update);
    expect(manager.getEntries().some(entry => entry.type === 'custom' && entry.customType === 'berserk.instructions-updated.v1')).toBe(true);
  }
});
