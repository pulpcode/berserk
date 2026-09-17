import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createAgentSession, DefaultResourceLoader, defineTool, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { fakeRuntime, testConfig } from './fake-runtime.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

it('P0: public SDK supports nested independent sessions, tool progress and explicit failed-tool results', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'berserk-sdk-subagent-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const config = testConfig(dir);
  const { runtime, calls } = await fakeRuntime(config, (_context, index) => index === 0 || index === 3
    ? { tools: [{ name: 'delegate', arguments: { task: 'CHILD_TASK_ONLY' } }] }
    : index === 1 ? { text: 'CHILD_PARTIAL', error: '401' } : index === 4 ? { waitForAbort: true } : { text: 'PARENT_HANDLED_FAILURE' });
  await runtime.setRuntimeApiKey(config.provider, config.apiKey);
  const model = runtime.getModel(config.provider, config.model)!;
  const open = async (systemPrompt: string, customTools: ReturnType<typeof defineTool>[]) => {
    const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: settings, systemPrompt,
      noContextFiles: true, noSkills: true, noExtensions: true, noPromptTemplates: true, noThemes: true });
    await loader.reload();
    const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model,
      sessionManager: SessionManager.inMemory(dir), settingsManager: settings, resourceLoader: loader, noTools: 'builtin', tools: customTools.map(tool => tool.name), customTools });
    cleanup.push(async () => { await session.abort(); session.dispose(); });
    return session;
  };
  const child = await open('CHILD_ROLE', []);
  const parent = await open('PARENT_ROLE', [defineTool({ name: 'delegate', label: '委派', description: '委派', parameters: Type.Object({ task: Type.String() }),
    execute: async (_id, params, signal, onUpdate) => {
      onUpdate?.({ content: [{ type: 'text', text: '子任务开始' }], details: { state: 'running' } });
      const stopChild = () => { void child.abort(); };
      signal?.addEventListener('abort', stopChild, { once: true });
      try { await child.prompt(params.task); } finally { signal?.removeEventListener('abort', stopChild); }
      return { content: [{ type: 'text', text: '子任务失败' }], details: { state: 'failed' } };
    } })]);
  parent.agent.afterToolCall = async () => ({ isError: true });
  let updated = false;
  parent.subscribe(event => { if (event.type === 'tool_execution_update') updated = true; });
  await parent.prompt('PARENT_PRIVATE_HISTORY');
  expect(updated).toBe(true);
  expect(JSON.stringify(calls[1].context)).toContain('CHILD_TASK_ONLY');
  expect(JSON.stringify(calls[1].context)).not.toContain('PARENT_PRIVATE_HISTORY');
  expect(calls[2].context.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'toolResult', isError: true })]));
  expect(parent.sessionId).not.toBe(child.sessionId);
  const work = parent.prompt('取消嵌套执行');
  await vi.waitFor(() => expect(calls).toHaveLength(5));
  await parent.abort(); await work;
  expect(calls[4].aborted).toBe(true);
  expect(parent.isStreaming).toBe(false); expect(child.isStreaming).toBe(false);
});
