import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runScenarioExecution, scenarioExecutionOptions } from '../scripts/probe-scenario-execution.js';

function providerResponse(tool?: { name: string; arguments: object }) {
  const model = 'deterministic-model';
  const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: `synthetic-${tool.name}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.arguments) } }] }
    : { role: 'assistant', content: '已核对提供的来源记录，本次仅验证程序链路。' };
  return new Response('data: ' + JSON.stringify({ id: 'v5-synthetic', object: 'chat.completion.chunk', created: 1, model,
    choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n'
    + 'data: ' + JSON.stringify({ id: 'v5-synthetic', object: 'chat.completion.chunk', created: 1, model,
      choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_tokens_details: { cached_tokens: 20 } } })
    + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}
function config() {
  for (const [key, value] of Object.entries({ LLM_PROVIDER: 'test-local', LLM_MODEL: 'deterministic-model', LLM_API_KEY: 'fake-v5-probe-credential',
    LLM_BASE_URL: 'https://no-network.invalid', LLM_CONTEXT_WINDOW: '8192', LLM_MAX_OUTPUT_TOKENS: '100', LLM_THINKING_MODE: 'off' })) vi.stubEnv(key, value);
}

describe('v5 execution probe', () => {
  it('defaults to a new isolated preparation and makes zero provider requests', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'axon-v5-prepare-'));
    const original = globalThis.fetch; let calls = 0;
    config();
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { calls++; throw new Error('Preparation cannot call a provider'); }
      return original(input, init);
    };
    try {
      const output = join(parent, 'evidence');
      const result = await runScenarioExecution(scenarioExecutionOptions(['--output', output]));
      expect(result).toMatchObject({ preparationCompleted: true, protocolCompleted: false, mode: 'prepare-only', accounting: { apiRequests: 0 } });
      expect(calls).toBe(0);
      await expect(runScenarioExecution(scenarioExecutionOptions(['--output', output]))).rejects.toThrow();
      expect(calls).toBe(0);
    } finally { globalThis.fetch = original; vi.unstubAllEnvs(); await rm(parent, { recursive: true, force: true }); }
  }, 30000);

  it('runs the dynamic v5 source, human controls and all native notice analyses with synthetic SSE', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'axon-v5-full-'));
    const original = globalThis.fetch; let calls = 0;
    config();
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === 'https://no-network.invalid') {
        calls++;
        const body = JSON.parse(String(init?.body)), last = body.messages.at(-1);
        const required = body.tools?.some((item: { function: { name: string } }) => item.function.name === 'information_record_task_assessment');
        const tool = required && last.role === 'user' ? { name: 'task_search', arguments: {} }
          : required && last.role === 'tool' && (last.name === 'task_search' || last.tool_call_id === 'synthetic-task_search')
            ? { name: 'information_record_task_assessment', arguments: { decisions: JSON.parse(last.content).data.items.map((task: { id: string }) => ({
                taskId: task.id, verdict: 'insufficient', reason: '合成提供方仅验证处理链，未作语义判断。',
              })), emptyReason: '真实语义需要另行审阅。' } } : undefined;
        return Promise.resolve(providerResponse(tool));
      }
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Unexpected nonlocal request');
      return original(input, init);
    };
    try {
      const output = join(parent, 'evidence');
      const result = await runScenarioExecution(scenarioExecutionOptions(['--output', output, '--live', '--usage-only',
        '--provider-input-limit-tokens', '1000', '--input-cny-per-million', '2', '--output-cny-per-million', '8']));
      expect(result).toMatchObject({ preparationCompleted: true, protocolCompleted: true, semanticReviewPending: true, scriptedControl: true,
        final: { arrivedVehicles: 7 }, accounting: { stoppedReason: null, limits: null } });
      expect(calls).toBeGreaterThan(39);
      const evidence = JSON.parse(await readFile(join(output, 'validation.json'), 'utf8'));
      expect(evidence.steps.filter((step: { stepId: string }) => /^E\d+$/.test(step.stepId))).toHaveLength(12);
      expect(evidence.steps.some((step: { stepId: string }) => step.stepId.startsWith('exec-'))).toBe(true);
      expect(evidence.atClosure.cross.vehicles.every((vehicle: { state: string }) => vehicle.state === 'blocked')).toBe(true);
      const actions = await readFile(join(output, 'scripted-actions.jsonl'), 'utf8');
      expect(actions).toContain('human-source-task-create'); expect(actions).toContain('human-command-confirm');
      expect(await readFile(join(output, 'provider-input.jsonl'), 'utf8')).not.toContain('fake-v5-probe-credential');
      expect(evidence.accounting.apiRequests).toBe(calls);
    } finally { globalThis.fetch = original; vi.unstubAllEnvs(); await rm(parent, { recursive: true, force: true }); }
  }, 90000);
});
