import http from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PiLab } from '../../src/pi/lab.js';
import { configuredRuntime, providerPayload } from '../../src/pi/model-runtime.js';
import { controlledStream, emptyUsage } from '../../src/pi/controlled-stream.js';
import type { LabConfig } from '../../src/server/config.js';
import { testConfig } from './fake-runtime.js';
import {
  SYNTHETIC_RULES,
  assertClearedNoDecoration,
  assertClearedRuleExplanation,
  assertStrictLeadingPrefix,
  assertWorkspaceMinimalEdit,
} from '../../scripts/context-eval/assertions.js';
import { inspectWirePayload, type WirePayloadAudit } from '../../scripts/context-eval/wire-capture.js';
import { startRedactedProxy } from '../../scripts/context-eval/proxy.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const FINGERPRINTS = [
  SYNTHETIC_RULES.R1_PREFIX,
  SYNTHETIC_RULES.R2_PREFIX,
  SYNTHETIC_RULES.R4_PREFIX,
  '<host_request_instructions>',
  '<system-reminder>',
];

function openAiSse(reply: { text?: string; toolCall?: { id: string; name: string; args: Record<string, unknown> } }) {
  const delta = reply.toolCall
    ? { role: 'assistant', tool_calls: [{ index: 0, id: reply.toolCall.id, type: 'function', function: { name: reply.toolCall.name, arguments: JSON.stringify(reply.toolCall.args) } }] }
    : { role: 'assistant', content: reply.text ?? '离线回复' };
  const chunks = [
    { id: 'eval-oai', object: 'chat.completion.chunk', created: 1, model: 'deepseek-v4.1-flash', choices: [{ index: 0, delta, finish_reason: null }] },
    { id: 'eval-oai', object: 'chat.completion.chunk', created: 1, model: 'deepseek-v4.1-flash', choices: [{ index: 0, delta: {}, finish_reason: reply.toolCall ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 12, total_tokens: 112, prompt_tokens_details: { cached_tokens: 64 } } },
  ];
  return new Response(chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function anthropicSse(reply: { text?: string; toolCall?: { id: string; name: string; args: Record<string, unknown> } }) {
  const events: Array<[string, unknown]> = [
    ['message_start', { type: 'message_start', message: { id: 'msg_eval', type: 'message', role: 'assistant', content: [], model: 'kimi-for-coding', stop_reason: null, stop_sequence: null, usage: { input_tokens: 80, cache_read_input_tokens: 40, output_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: reply.toolCall ? { type: 'tool_use', id: reply.toolCall.id, name: reply.toolCall.name, input: {} } : { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: reply.toolCall ? { type: 'input_json_delta', partial_json: JSON.stringify(reply.toolCall.args) } : { type: 'text_delta', text: reply.text ?? '离线回复' } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: reply.toolCall ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  return new Response(events.map(([name, val]) => `event: ${name}\ndata: ${JSON.stringify(val)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function makeConfig(overrides: Partial<LabConfig> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'berserk-ctx-eval-test-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return testConfig(dir, {
    provider: 'deepseek',
    model: 'deepseek-v4.1-flash',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
    api: 'openai-completions',
    ...overrides,
  });
}

async function assertCleanNativeHistory(dataDir: string, expectedUsers: string[]) {
  const files = await readdir(join(dataDir, 'sessions'));
  const combined = (await Promise.all(files.map(f => readFile(join(dataDir, 'sessions', f), 'utf8')))).join('\n');
  expect(combined).not.toContain('<host_request_instructions>');
  expect(combined).not.toContain('<system-reminder>');
  const persistedUsers = combined.trim().split('\n').filter(Boolean)
    .map(line => JSON.parse(line) as { type: string; message?: { role: string; content: string | Array<{ text?: string }> } })
    .filter(entry => entry.type === 'message' && entry.message?.role === 'user')
    .map(entry => typeof entry.message!.content === 'string'
      ? entry.message!.content
      : entry.message!.content.map(b => b.text ?? '').join(''));
  expect(persistedUsers).toEqual(expectedUsers);
}

describe('Issue #4 offline protocol gate (A/B/C/D1/D2)', () => {
  it('Strategy A (native) emits zero tail reminders for both OpenAI and Anthropic', async () => {
    const audits: WirePayloadAudit[] = [];
    vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const body = JSON.parse(await req.text()) as Record<string, unknown>;
      audits.push(inspectWirePayload(audits.length, req.url, body, FINGERPRINTS, ['fake-key-NEVER-LEAK-123']));
      return req.url.includes('/messages') ? anthropicSse({ text: 'ok' }) : openAiSse({ text: 'ok' });
    });

    for (const cfg of [
      await makeConfig(),
      await makeConfig({ provider: 'kimi-coding', model: 'kimi-for-coding', baseUrl: 'https://ark.cn-beijing.volces.com/api/coding', api: 'anthropic-messages' }),
    ]) {
      const before = audits.length;
      const lab = await PiLab.create(cfg); cleanup.push(() => lab.close());
      lab.contextEvalStrategy = 'A';
      const session = await lab.createSession();
      const ws = await lab.resources.readInstruction(session.workspaceId, 'workspace');
      await lab.resources.updateInstruction(session.workspaceId, 'workspace', SYNTHETIC_RULES.R1_CONTENT, ws.hash);
      await lab.start(session.id, '首轮提问').run(() => {});
      const cur = audits[before];
      expect(cur.systemFingerprints).toContain(SYNTHETIC_RULES.R1_PREFIX);
      expect(cur.hostReminderCount).toBe(0);
      expect(cur.systemReminderCount).toBe(0);
      expect(cur.containsSecret).toBe(false);
    }
  });

  it('Strategy B preserves legacy wire system insertion on OpenAI and explicitly rejects Anthropic', async () => {
    const audits: WirePayloadAudit[] = [];
    vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const body = JSON.parse(await req.text()) as Record<string, unknown>;
      audits.push(inspectWirePayload(audits.length, req.url, body, FINGERPRINTS));
      return openAiSse({ text: 'ok' });
    });

    const oaiCfg = await makeConfig();
    const oaiLab = await PiLab.create(oaiCfg); cleanup.push(() => oaiLab.close());
    oaiLab.contextEvalStrategy = 'B';
    const session = await oaiLab.createSession();
    const ws = await oaiLab.resources.readInstruction(session.workspaceId, 'workspace');
    await oaiLab.resources.updateInstruction(session.workspaceId, 'workspace', SYNTHETIC_RULES.R1_CONTENT, ws.hash);
    await oaiLab.start(session.id, '测试B组').run(() => {});
    expect(audits[0].systemMessageCount).toBe(2);
    expect(audits[0].hostReminderCount).toBe(1);
    expect(audits[0].messageRoles).toEqual(['system', 'system', 'user']);

    // Anthropic must refuse strategy B rather than emitting illegal mid-stream system.
    const anthCfg = await makeConfig({ provider: 'kimi-coding', model: 'kimi-for-coding', baseUrl: 'https://ark.cn-beijing.volces.com/api/coding', api: 'anthropic-messages' });
    const anthLab = await PiLab.create(anthCfg); cleanup.push(() => anthLab.close());
    anthLab.contextEvalStrategy = 'B';
    const anthSession = await anthLab.createSession();
    await anthLab.start(anthSession.id, '非法协议').run(() => {});
    expect(anthLab.get(anthSession.id).lastResult?.status).toBe('failed');
  });

  it('Strategy C attaches transient <system-reminder> on both OpenAI & Anthropic without mutating persisted user text or tool_result', async () => {
    const audits: WirePayloadAudit[] = [];
    const rawBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const body = JSON.parse(await req.text()) as Record<string, unknown>;
      rawBodies.push(body);
      audits.push(inspectWirePayload(audits.length, req.url, body, FINGERPRINTS));
      const isToolTurn = audits.length === 1 || audits.length === 3;
      const toolCall = isToolTurn ? { id: `call_${audits.length}`, name: 'source_read', args: { id: 'meeting-notes' } } : undefined;
      return req.url.includes('/messages') ? anthropicSse({ toolCall, text: '【赤松】完成' }) : openAiSse({ toolCall, text: '【赤松】完成' });
    });

    for (const cfg of [
      await makeConfig(),
      await makeConfig({ provider: 'kimi-coding', model: 'kimi-for-coding', baseUrl: 'https://ark.cn-beijing.volces.com/api/coding', api: 'anthropic-messages' }),
    ]) {
      const before = audits.length;
      const lab = await PiLab.create(cfg); cleanup.push(() => lab.close());
      lab.contextEvalStrategy = 'C';
      const session = await lab.createSession();
      const ws = await lab.resources.readInstruction(session.workspaceId, 'workspace');
      await lab.resources.updateInstruction(session.workspaceId, 'workspace', SYNTHETIC_RULES.R1_CONTENT, ws.hash);
      await lab.start(session.id, '读取资料并总结').run(() => {});
      expect(lab.get(session.id).lastResult?.status).toBe('succeeded');

      const pair = audits.slice(before);
      expect(pair).toHaveLength(2);
      for (const audit of pair) {
        expect(audit.hostReminderCount).toBe(0);
        expect(audit.systemReminderCount).toBe(1);
        expect(audit.tailUserContainsReminder).toBe(true);
        expect(audit.toolResultContainsReminder).toBe(false);
        if (audit.api === 'anthropic-messages') {
          expect(audit.messageRoles.every(role => role.startsWith('user') || role.startsWith('assistant'))).toBe(true);
        } else {
          expect(audit.systemMessageCount).toBe(1);
        }
      }
      await assertCleanNativeHistory(cfg.dataDir, ['读取资料并总结']);
    }

    // Compaction stream must never receive the reply reminder.
    const anthCfg = await makeConfig({ provider: 'kimi-coding', model: 'kimi-for-coding', baseUrl: 'https://ark.cn-beijing.volces.com/api/coding', api: 'anthropic-messages' });
    const runtime = await configuredRuntime(anthCfg);
    const beforeComp = rawBodies.length;
    const compStream = controlledStream(
      runtime, anthCfg, runtime.getModel(anthCfg.provider, anthCfg.model)!,
      { systemPrompt: 'NATIVE_COMPACTION', messages: [{ role: 'user', content: '摘要', timestamp: 1 }] },
      { maxTokens: 512 }, 'compaction', '<system-reminder>FORBIDDEN</system-reminder>', new AbortController().signal, emptyUsage(),
      undefined, 'disable',
    );
    expect((await compStream.result()).stopReason).toBe('stop');
    expect(JSON.stringify(rawBodies[beforeComp])).not.toContain('FORBIDDEN');
  });

  it('Strategy D1 injects zero tail reminder on initial/unchanged turns, fires once on update/clear, and locks snapshot across tool continuation', async () => {
    const audits: WirePayloadAudit[] = [];
    const bodies: Array<Record<string, unknown>> = [];
    let currentHash = '';
    vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const body = JSON.parse(await req.text()) as Record<string, unknown>;
      bodies.push(body);
      audits.push(inspectWirePayload(audits.length, req.url, body, FINGERPRINTS));
      // Turn 3 triggers instructions_update mid-request; continuation must retain unchanged snapshot.
      const doUpdate = audits.length === 3;
      return anthropicSse(doUpdate
        ? { toolCall: { id: 'call_upd', name: 'instructions_update', args: { fileId: 'workspace', content: SYNTHETIC_RULES.R2_CONTENT, expectedHash: currentHash } } }
        : { text: 'ok' });
    });

    const cfg = await makeConfig({ provider: 'kimi-coding', model: 'kimi-for-coding', baseUrl: 'https://ark.cn-beijing.volces.com/api/coding', api: 'anthropic-messages' });
    const lab = await PiLab.create(cfg); cleanup.push(() => lab.close());
    lab.contextEvalStrategy = 'D1';
    const session = await lab.createSession();
    const ws0 = await lab.resources.readInstruction(session.workspaceId, 'workspace');
    currentHash = (await lab.resources.updateInstruction(session.workspaceId, 'workspace', SYNTHETIC_RULES.R1_CONTENT, ws0.hash)).hash;

    // Turn 1: initial -> zero tail reminder
    await lab.start(session.id, '第一轮').run(() => {});
    // Turn 2: unchanged -> zero tail reminder
    await lab.start(session.id, '第二轮未改规则').run(() => {});
    // Turn 3: unchanged at request start, writes R2 during tool call -> still zero tail reminder across both calls
    await lab.start(session.id, '第三轮调用工具改规则').run(() => {});
    // Turn 4: changed from R1 -> R2 -> fires delta once
    await lab.start(session.id, '第四轮新规则首轮').run(() => {});
    // Turn 5: unchanged (still R2) -> back to zero tail reminder
    await lab.start(session.id, '第五轮保持新规则').run(() => {});
    // Turn 6: cleared R2 -> "" -> fires cleared delta once
    const latest = await lab.resources.readInstruction(session.workspaceId, 'workspace');
    await lab.resources.updateInstruction(session.workspaceId, 'workspace', '', latest.hash);
    await lab.start(session.id, '第六轮清空后').run(() => {});

    expect(audits).toHaveLength(7); // turn 3 takes 2 calls
    expect(audits[0].systemReminderCount).toBe(0);
    expect(audits[1].systemReminderCount).toBe(0);
    expect(audits[2].systemReminderCount).toBe(0);
    expect(audits[3].systemReminderCount).toBe(0);
    expect(audits[3].systemFingerprints).toContain(SYNTHETIC_RULES.R1_PREFIX);
    expect(audits[3].systemFingerprints).not.toContain(SYNTHETIC_RULES.R2_PREFIX);

    expect(audits[4].systemReminderCount).toBe(1);
    expect(audits[4].systemFingerprints).toContain(SYNTHETIC_RULES.R2_PREFIX);
    expect(JSON.stringify(bodies[4])).toContain('工作区规则变更声明：已更新');

    expect(audits[5].systemReminderCount).toBe(0);

    expect(audits[6].systemReminderCount).toBe(1);
    expect(audits[6].systemFingerprints).not.toContain(SYNTHETIC_RULES.R2_PREFIX);
    expect(JSON.stringify(bodies[6])).toContain('工作区规则变更声明：已清空');

    await assertCleanNativeHistory(cfg.dataDir, ['第一轮', '第二轮未改规则', '第三轮调用工具改规则', '第四轮新规则首轮', '第五轮保持新规则', '第六轮清空后']);
  });

  it('Strategy D2 freezes the initial top snapshot while emitting tail override declarations on change', async () => {
    const audits: WirePayloadAudit[] = [];
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const body = JSON.parse(await req.text()) as Record<string, unknown>;
      bodies.push(body);
      audits.push(inspectWirePayload(audits.length, req.url, body, FINGERPRINTS));
      return openAiSse({ text: 'ok' });
    });

    const cfg = await makeConfig();
    const lab = await PiLab.create(cfg); cleanup.push(() => lab.close());
    lab.contextEvalStrategy = 'D2';
    const session = await lab.createSession();
    const ws0 = await lab.resources.readInstruction(session.workspaceId, 'workspace');
    const ws1 = await lab.resources.updateInstruction(session.workspaceId, 'workspace', SYNTHETIC_RULES.R1_CONTENT, ws0.hash);
    await lab.start(session.id, '首轮R1').run(() => {});

    await lab.resources.updateInstruction(session.workspaceId, 'workspace', SYNTHETIC_RULES.R2_CONTENT, ws1.hash);
    await lab.start(session.id, '次轮切R2').run(() => {});
    await lab.start(session.id, '第三轮仍R2').run(() => {});

    expect(audits).toHaveLength(3);
    // Top system stays frozen at R1 across all three turns (KV-cache preservation design)
    expect(audits[0].systemFingerprints).toContain(SYNTHETIC_RULES.R1_PREFIX);
    expect(audits[1].systemFingerprints).toContain(SYNTHETIC_RULES.R1_PREFIX);
    expect(audits[1].systemFingerprints).not.toContain(SYNTHETIC_RULES.R2_PREFIX);
    expect(audits[1].systemReminderCount).toBe(1);
    expect(JSON.stringify(bodies[1])).toContain('完全覆盖顶部旧工作区规则');
    expect(audits[2].systemFingerprints).toContain(SYNTHETIC_RULES.R1_PREFIX);
    expect(audits[2].systemReminderCount).toBe(0);
  });

  it('Strategy D1 handles cross-model DeepSeek -> Kimi -> DeepSeek with valid wire structures and clean native history', async () => {
    const audits: WirePayloadAudit[] = [];
    vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const body = JSON.parse(await req.text()) as Record<string, unknown>;
      audits.push(inspectWirePayload(audits.length, req.url, body, FINGERPRINTS));
      return req.url.includes('/messages') ? anthropicSse({ text: '【青竹】收到' }) : openAiSse({ text: '【赤松】收到' });
    });

    const cfg = await makeConfig();
    const lab = await PiLab.create(cfg); cleanup.push(() => lab.close());
    lab.contextEvalStrategy = 'D1';
    const platform = await lab.updateModelPlatform({
      name: 'Ark Kimi',
      provider: 'kimi-coding',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
      api: 'anthropic-messages',
      apiKey: 'offline-kimi-key',
      enabled: true,
      expectedVersion: lab.modelCatalog().version,
    }, 'default', true);
    const kimi = await lab.updateModelProfile({
      platformId: platform.id,
      model: 'kimi-k2.5',
      displayName: 'Ark Kimi',
      enabled: true,
      usageConfirmed: true,
      contextWindow: 131072,
      maxOutputTokens: 1024,
      expectedVersion: lab.modelCatalog().version,
    }, 'default', true);

    const session = await lab.createSession();
    const ws0 = await lab.resources.readInstruction(session.workspaceId, 'workspace');
    const ws1 = await lab.resources.updateInstruction(session.workspaceId, 'workspace', SYNTHETIC_RULES.R1_CONTENT, ws0.hash);
    await lab.start(session.id, 'DS首轮').run(() => {});

    const ws2 = await lab.resources.updateInstruction(session.workspaceId, 'workspace', SYNTHETIC_RULES.R2_CONTENT, ws1.hash);
    lab.selectModel(session.id, kimi.id);
    await lab.start(session.id, '切Kimi改R2').run(() => {});

    await lab.resources.updateInstruction(session.workspaceId, 'workspace', '', ws2.hash);
    lab.selectModel(session.id, 'default');
    await lab.start(session.id, '切回DS清空').run(() => {});

    expect(audits).toHaveLength(3);
    expect(audits[0]).toMatchObject({ api: 'openai-completions', systemReminderCount: 0, hostReminderCount: 0 });
    expect(audits[1]).toMatchObject({ api: 'anthropic-messages', systemReminderCount: 1, hostReminderCount: 0 });
    expect(audits[2]).toMatchObject({ api: 'openai-completions', systemReminderCount: 1, hostReminderCount: 0 });
    await assertCleanNativeHistory(cfg.dataDir, ['DS首轮', '切Kimi改R2', '切回DS清空']);
  });

  it('Documents the legacy providerPayload provider-alias thinking fallback discrepancy', async () => {
    const unverifiedDeepSeekAlias = await makeConfig({
      provider: 'deepseek',
      model: 'third-party-model',
      baseUrl: 'https://third-party-gateway.invalid/v1',
      api: 'openai-completions',
      thinkingMode: undefined,
      thinkingLevels: undefined,
      defaultThinkingLevel: undefined,
      thinkingLevelMap: undefined,
    });
    const out = providerPayload(unverifiedDeepSeekAlias, { model: 'third-party-model', messages: [] });
    // Confirms the known discrepancy audited for Issue #4: provider alias alone triggers thinking:disabled.
    expect(out).toMatchObject({ thinking: { type: 'disabled' } });
  });

  it('Redacted local proxy strips secrets, streams SSE, captures usage and detects rule fingerprints', async () => {
    const upstream = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ id: 'p1', choices: [{ index: 0, delta: { content: '【青竹】代理透传成功' }, finish_reason: 'stop' }], usage: { prompt_tokens: 55, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 20 } } })}\n\ndata: [DONE]\n\n`);
      void req;
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', () => resolve()));
    cleanup.push(() => new Promise<void>(resolve => upstream.close(() => resolve())));
    const addr = upstream.address();
    expect(addr && typeof addr !== 'string').toBe(true);
    const upstreamUrl = `http://127.0.0.1:${(addr as { port: number }).port}`;

    const proxy = await startRedactedProxy({
      upstreamBaseUrl: upstreamUrl,
      fingerprints: [SYNTHETIC_RULES.R1_PREFIX, SYNTHETIC_RULES.R2_PREFIX],
      secretValues: ['super-secret-ark-key-999'],
    });
    cleanup.push(() => proxy.close());

    const res = await fetch(`${proxy.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer super-secret-ark-key-999', 'x-api-key': 'super-secret-ark-key-999' },
      body: JSON.stringify({ model: 'deepseek-v4.1-flash', messages: [{ role: 'system', content: SYNTHETIC_RULES.R2_CONTENT }, { role: 'user', content: 'hello' }] }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('代理透传成功');
    expect(proxy.records).toHaveLength(1);
    expect(proxy.records[0].requestHeaders.authorization).toBe('[REDACTED]');
    expect(proxy.records[0].requestHeaders['x-api-key']).toBe('[REDACTED]');
    expect(proxy.records[0].fingerprintsInEntirePayload).toEqual([SYNTHETIC_RULES.R2_PREFIX]);
    expect(proxy.records[0].usage).toEqual({ input: 55, output: 8, cacheRead: 20, cacheWrite: 0 });
  });

  it('Strict assertions reject trailing false positives, fabricated brackets, internal leaks and copied common rules', () => {
    expect(assertStrictLeadingPrefix('【青竹】火星呈红色是因为表面富含氧化铁。', '【青竹】', ['【赤松】']).passed).toBe(true);
    expect(assertStrictLeadingPrefix('火星呈红色是因为表面富含氧化铁。【青竹】', '【青竹】', ['【赤松】']).passed).toBe(false);
    expect(assertStrictLeadingPrefix('【青竹】顺便提一下【赤松】已失效。', '【青竹】', ['【赤松】']).passed).toBe(false);
    expect(assertStrictLeadingPrefix('【青竹】根据<system-reminder>回答。', '【青竹】', ['【赤松】']).passed).toBe(false);

    expect(assertClearedNoDecoration('地球自转带来昼夜交替，公转带来四季更替。').passed).toBe(true);
    expect(assertClearedNoDecoration('【默认】地球自转带来昼夜交替。').passed).toBe(false);
    expect(assertClearedNoDecoration('[回答] 地球自转带来昼夜交替。').passed).toBe(false);

    expect(assertClearedRuleExplanation('当前工作区没有设置任何格式前缀约定。').passed).toBe(true);
    expect(assertClearedRuleExplanation('当前仍然需要使用【青竹】前缀。').passed).toBe(false);

    expect(assertWorkspaceMinimalEdit('请以【雪松】开头。', '这是只读通用指令长段落内容不应被复制进工作区文件。', '【雪松】', ['【赤松】']).passed).toBe(true);
    expect(assertWorkspaceMinimalEdit('这是只读通用指令长段落内容不应被复制进工作区文件。\n请以【雪松】开头。', '这是只读通用指令长段落内容不应被复制进工作区文件。', '【雪松】').passed).toBe(false);
  });
});
