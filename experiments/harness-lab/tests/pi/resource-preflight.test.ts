import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { fakeRuntime, testConfig } from './fake-runtime.js';

it('P0: recreates Pi with fresh explicit instructions while preserving native history and private resource entries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'berserk-resource-preflight-'));
  try {
    const sessionDir = join(dir, 'sessions');
    await mkdir(sessionDir);
    const config = testConfig(dir);
    const { runtime, calls } = await fakeRuntime(config, () => ({ text: '已处理本轮请求。' }));
    await runtime.setRuntimeApiKey(config.provider, config.apiKey);
    let manager = SessionManager.create(dir, sessionDir);
    const file = manager.getSessionFile()!;
    await writeFile(file, `${JSON.stringify(manager.getHeader())}\n`, { flag: 'wx' });
    manager = SessionManager.open(file, sessionDir);
    const sessionId = manager.getSessionId();
    const rules = ['P0_旧规则_紫杉', 'P0_新规则_白桦', ''];
    for (const [index, rule] of rules.entries()) {
      const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
      const loader = new DefaultResourceLoader({
        cwd: dir, agentDir: join(dir, 'agent'), settingsManager,
        noContextFiles: true, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
        systemPrompt: '执行用户要求。', appendSystemPrompt: [],
        agentsFilesOverride: () => ({ agentsFiles: [
          { path: 'common/AGENTS.md', content: 'P0_通用规则_中文' },
          { path: 'workspace/AGENTS.md', content: rule },
        ] }),
      });
      await loader.reload();
      manager.appendCustomEntry('berserk.request-resources.v1', { requestId: `p0-${index}`, privateMarker: 'P0_仅持久化_不进入聊天', rule });
      const { session } = await createAgentSession({
        cwd: dir, agentDir: join(dir, 'agent'), modelRuntime: runtime,
        model: runtime.getModel(config.provider, config.model)!, thinkingLevel: 'off',
        sessionManager: manager, settingsManager, resourceLoader: loader, noTools: 'builtin', tools: [],
      });
      session.agent.streamFunction = (model, context, options) => runtime.streamSimple(model, context, { ...options, apiKey: config.apiKey });
      try { await session.prompt(`第 ${index + 1} 轮消息`, { expandPromptTemplates: false }); }
      finally { session.dispose(); }
    }
    expect(calls).toHaveLength(3);
    expect(calls[0].context.systemPrompt).toContain(rules[0]);
    expect(calls[1].context.systemPrompt).toContain(rules[1]);
    expect(calls[1].context.systemPrompt).not.toContain(rules[0]);
    expect(calls[2].context.systemPrompt).not.toContain(rules[0]);
    expect(calls[2].context.systemPrompt).not.toContain(rules[1]);
    expect(calls.every(call => call.context.systemPrompt?.includes('P0_通用规则_中文'))).toBe(true);
    expect(JSON.stringify(calls)).not.toContain('P0_仅持久化_不进入聊天');
    expect(calls[2].context.messages.filter(message => message.role === 'user')).toHaveLength(3);
    const restored = SessionManager.open(file, sessionDir);
    expect(restored.getSessionId()).toBe(sessionId);
    expect(restored.buildSessionContext().messages).toHaveLength(6);
    expect(restored.getBranch().filter(entry => entry.type === 'custom')).toHaveLength(3);
    expect(await readFile(file, 'utf8')).toContain('P0_仅持久化_不进入聊天');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
