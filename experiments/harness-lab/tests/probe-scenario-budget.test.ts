import type { AssistantMessage } from '@earendil-works/pi-ai';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { guardScenarioRuntime, ScenarioBudgetGuard, type ScenarioProbeBudget } from '../scripts/probe-scenario-budget.js';
import { runScenarioBusiness, scenarioBusinessOptions } from '../scripts/probe-scenario-business.js';
import { configuredRuntime } from '../src/pi/model-runtime.js';
import { testConfig } from './pi/fake-runtime.js';

const limits: ScenarioProbeBudget = { maxApiRequests: 2, maxInputTokens: 1200, maxOutputTokens: 200, maxSeconds: 60,
  maxCostCny: 1, inputCnyPerMillion: 2, outputCnyPerMillion: 8, providerInputLimitTokens: 1000 };
function message(input = 100, output = 10): AssistantMessage {
  return { role: 'assistant', api: 'openai-completions', provider: 'test-local', model: 'deterministic-model',
    content: [{ type: 'text', text: '实际输出' }], timestamp: 1, stopReason: 'stop',
    usage: { input: input - 20, cacheRead: 20, cacheWrite: 0, output, totalTokens: input + output,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
function providerResponse(model: string) {
  return new Response('data: ' + JSON.stringify({ id: 'synthetic-sdk', object: 'chat.completion.chunk', created: 1, model,
    choices: [{ index: 0, delta: { role: 'assistant', content: '实际输出' }, finish_reason: null }] }) + '\n\n'
    + 'data: ' + JSON.stringify({ id: 'synthetic-sdk', object: 'chat.completion.chunk', created: 1, model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_tokens_details: { cached_tokens: 20 } } })
    + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}

describe('scenario probe dispatch budget', () => {
  it('refuses an existing evidence directory before touching its contents or starting services', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'axon-existing-probe-')), marker = join(directory, 'preserved.txt');
    try {
      await writeFile(marker, 'original evidence');
      await expect(runScenarioBusiness(scenarioBusinessOptions(['--output', directory]))).rejects.toThrow(/EEXIST/);
      expect(await readFile(marker, 'utf8')).toBe('original evidence');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('defaults to preparation and rejects implicit live execution or incomplete/invalid budgets', () => {
    expect(scenarioBusinessOptions(['--output', '/tmp/new-evidence']).live).toBe(false);
    expect(() => scenarioBusinessOptions(['--output', '/tmp/new-evidence', '--live'])).toThrow(/requires all/);
    expect(() => scenarioBusinessOptions(['--output', '/tmp/new-evidence', '--max-api-requests', '80'])).toThrow(/explicit --live/);
    expect(() => scenarioBusinessOptions(['--output', '/tmp/new-evidence', '--live', '--max-seconds', 'Infinity'])).toThrow(/Finite/);
    expect(() => scenarioBusinessOptions(['--output', '/tmp/new-evidence', '--prepare-only', '--live'])).toThrow(/mutually exclusive/);
    expect(() => new ScenarioBudgetGuard().begin(1000, 100)).toThrow(/prepare-only/);
  });
  it('reserves provider bounds, settles actual cached tokens at full rates and blocks the next dispatch before overspend', () => {
    const guard = new ScenarioBudgetGuard(limits), first = guard.begin(1000, 100);
    guard.sent(first); guard.finish(first, message());
    expect(guard.snapshot()).toMatchObject({ apiRequests: 1, inputTokensCharged: 100, outputTokensCharged: 10 });
    expect(guard.snapshot().conservativeCostCny).toBeCloseTo(0.00028);
    const second = guard.begin(1000, 100); guard.sent(second); guard.finish(second, message());
    expect(() => guard.begin(1000, 100)).toThrow(/request_reservation/);
    expect(guard.snapshot().apiRequests).toBe(2);
  });
  it.each(['input', 'output', 'cost'] as const)('blocks an insufficient %s reservation before sending', kind => {
    const guard = new ScenarioBudgetGuard({ ...limits, ...(kind === 'input' ? { maxInputTokens: 999 } : kind === 'output' ? { maxOutputTokens: 99 } : { maxCostCny: 0.0001 }) });
    expect(() => guard.begin(1000, 100)).toThrow(/reservation/); expect(guard.snapshot().apiRequests).toBe(0);
  });
  it('retains the full reservation on unknown usage, blocks retries and stops on provider-limit drift', () => {
    const unknown = new ScenarioBudgetGuard(limits), one = unknown.begin(1000, 100); unknown.sent(one); unknown.finish(one);
    expect(unknown.snapshot()).toMatchObject({ inputTokensCharged: 1000, outputTokensCharged: 100, stoppedReason: 'provider_usage_unknown_reservation_retained' });
    expect(() => unknown.begin(1000, 100)).toThrow();
    const retry = new ScenarioBudgetGuard(limits), two = retry.begin(1000, 100); retry.sent(two);
    expect(() => retry.sent(two)).toThrow(/automatic_http_retry_blocked/); expect(retry.snapshot().apiRequests).toBe(1);
    const drift = new ScenarioBudgetGuard({ ...limits, maxInputTokens: 2000 }), three = drift.begin(1000, 100); drift.sent(three); drift.finish(three, message(1001));
    expect(drift.snapshot().stoppedReason).toBe('provider_usage_exceeded_verified_limits');
  });
  it('expires the wall budget before a new dispatch', () => {
    const guard = new ScenarioBudgetGuard(limits), now = vi.spyOn(Date, 'now').mockReturnValue(guard.startedAt + 60001);
    try { expect(() => guard.begin(1000, 100)).toThrow(/wall_time_budget/); expect(guard.snapshot().apiRequests).toBe(0); }
    finally { now.mockRestore(); }
  });
  it('wraps the actual SDK fetch/payload path without networking and preserves final text and actual accounting', async () => {
    const config = testConfig('/tmp/unused-scenario-budget-sdk', { contextWindow: 8192, maxOutputTokens: 100 });
    const runtime = await configuredRuntime(config), guard = new ScenarioBudgetGuard(limits), records: Array<{ kind: string; value: unknown }> = [];
    guardScenarioRuntime(runtime, guard, new URL(config.baseUrl).origin, async (kind, value) => { records.push({ kind, value }); });
    const fetches: RequestInit[] = [], context = { messages: [{ role: 'user' as const, content: '读取当前事实。', timestamp: 1 }] };
    const stream = runtime.streamSimple(runtime.getModel(config.provider, config.model)!, context, {
      apiKey: config.apiKey, maxTokens: 100, onPayload: payload => ({ ...payload as object, user: 'preserved-transform' }),
      fetch: async (_input, init) => {
        fetches.push(init!);
        return providerResponse(config.model);
      },
    });
    const final = await stream.result();
    expect(final.stopReason).toBe('stop'); expect(final.content).toEqual([expect.objectContaining({ type: 'text', text: '实际输出' })]);
    expect(fetches).toHaveLength(1); expect(fetches[0].redirect).toBe('error');
    expect(JSON.parse(String(fetches[0].body))).toMatchObject({ max_tokens: 100, user: 'preserved-transform' });
    expect(guard.snapshot()).toMatchObject({ apiRequests: 1, inputTokensCharged: 100, outputTokensCharged: 10, stoppedReason: null });
    expect(records.find(record => record.kind === 'provider-accounting')?.value).toMatchObject({ reservation: { input: 1000, output: 100 } });
  });
  it('keeps a failed actual SDK response and forbids a second transport attempt', async () => {
    const config = testConfig('/tmp/unused-scenario-budget-failure', { maxOutputTokens: 100 }), runtime = await configuredRuntime(config);
    const guard = new ScenarioBudgetGuard(limits), records: unknown[] = [], transport = vi.fn(async () => new Response('{"error":{"message":"synthetic failure"}}', { status: 503 }));
    guardScenarioRuntime(runtime, guard, new URL(config.baseUrl).origin, async (_kind, value) => { records.push(value); });
    const model = runtime.getModel(config.provider, config.model)!, context = { messages: [{ role: 'user' as const, content: '来报核对', timestamp: 1 }] };
    expect((await runtime.streamSimple(model, context, { apiKey: config.apiKey, fetch: transport }).result()).stopReason).toBe('error');
    expect(transport).toHaveBeenCalledTimes(1); expect(records).not.toEqual([]);
    expect(() => runtime.streamSimple(model, context, { apiKey: config.apiKey, fetch: transport })).toThrow(/stopped/);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('runs the driver over all real source/host notices with synthetic provider SSE, preserving pending semantic review', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'axon-scenario-probe-driver-')), output = join(parent, 'new-evidence');
    const originalFetch = globalThis.fetch; let providerCalls = 0;
    for (const [name, value] of Object.entries({ LLM_PROVIDER: 'test-local', LLM_MODEL: 'deterministic-model', LLM_API_KEY: 'fake-probe-only-credential',
      LLM_BASE_URL: 'https://no-network.invalid', LLM_CONTEXT_WINDOW: '8192', LLM_MAX_OUTPUT_TOKENS: '100', LLM_THINKING_MODE: 'off' })) vi.stubEnv(name, value);
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === 'https://no-network.invalid') { providerCalls++; return providerResponse('deterministic-model'); }
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Unexpected external request in offline driver test');
      return originalFetch(input, init);
    };
    try {
      const result = await runScenarioBusiness({ output, live: true, scriptedHandoff: true,
        budget: { ...limits, maxApiRequests: 20, maxInputTokens: 10000, maxOutputTokens: 2000 } });
      expect(result).toMatchObject({ preparationCompleted: true, protocolCompleted: true, semanticReviewPending: true,
        scriptedHandoffReceipt: { state: 'completed' }, accounting: { apiRequests: 13, stoppedReason: null } });
      expect(providerCalls).toBe(13);
      expect(JSON.parse(await readFile(join(output, 'validation.json'), 'utf8')).steps).toHaveLength(12);
      expect(await readFile(join(output, 'provider-input.jsonl'), 'utf8')).not.toContain('fake-probe-only-credential');
      expect(await readFile(join(output, 'scripted-actions.jsonl'), 'utf8')).toContain('human-source-task-create');
    } finally { globalThis.fetch = originalFetch; vi.unstubAllEnvs(); await rm(parent, { recursive: true, force: true }); }
  }, 30000);
});
