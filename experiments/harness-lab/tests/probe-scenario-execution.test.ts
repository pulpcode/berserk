import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { DockerExecutionService, type DockerRunner } from '../src/execution/docker.js';
import { describe, expect, it, vi } from 'vitest';
import { runScenarioExecution, scenarioExecutionOptions } from '../scripts/probe-scenario-execution.js';

let toolSequence = 0;
function providerResponse(tool?: { name: string; arguments: object }) {
  const model = 'deterministic-model';
  const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: `synthetic-${tool.name}-${++toolSequence}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.arguments) } }] }
    : { role: 'assistant', content: '已核对提供的来源记录，本次仅验证程序链路。' };
  return new Response('data: ' + JSON.stringify({ id: 'v6-synthetic', object: 'chat.completion.chunk', created: 1, model,
    choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n'
    + 'data: ' + JSON.stringify({ id: 'v6-synthetic', object: 'chat.completion.chunk', created: 1, model,
      choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_tokens_details: { cached_tokens: 20 } } })
    + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}
function config() {
  for (const [key, value] of Object.entries({ LLM_PROVIDER: 'test-local', LLM_MODEL: 'deterministic-model', LLM_API_KEY: 'fake-v6-probe-credential',
    LLM_BASE_URL: 'https://no-network.invalid', LLM_CONTEXT_WINDOW: '131072', LLM_MAX_OUTPUT_TOKENS: '100', LLM_THINKING_MODE: 'off' })) vi.stubEnv(key, value);
}

describe('v6 execution probe', () => {
  it('defaults to a new isolated preparation and makes zero provider requests', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'axon-v6-prepare-'));
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

  it('runs the dynamic v6 source, human controls and all native notice analyses with synthetic SSE', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'axon-v6-full-'));
    let passed = false;
    const original = globalThis.fetch; let calls = 0;
    config();
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === 'https://no-network.invalid') {
        calls++;
        const body = JSON.parse(String(init?.body)), last = body.messages.at(-1);
        const required = body.tools?.some((item: { function: { name: string } }) => item.function.name === 'information_record_task_assessment');
        const tool = required && last.role === 'user' ? { name: 'task_search', arguments: {} }
          : required && last.role === 'tool' && (last.name === 'task_search' || last.tool_call_id?.startsWith('synthetic-task_search-'))
            ? { name: 'information_record_task_assessment', arguments: { decisions: JSON.parse(last.content).data.items.map((task: { id: string }) => ({
                taskId: task.id, verdict: 'insufficient', reason: '合成提供方仅验证处理链，未作语义判断。',
              })), emptyReason: '真实语义需要另行审阅。' } } : undefined;
        if (!required && body.tools?.some((item: { function: { name: string } }) => item.function.name === 'simulation_command_read')) {
          const prompt = body.messages.filter((m: { role: string }) => m.role === 'user').map((m: {content: string | Array<{text?: string}>}) => typeof m.content === 'string' ? m.content : m.content.map(x => x.text ?? '').join('\n')).findLast((text: string) => text.includes('交接文件：')) ?? '';
          const match = /交接文件：([^\n]+)\n指令编号：([^\n]+)\n/.exec(prompt);
          if (!match) throw new Error('Missing ordinary handoff document reference');
          const ids = match[2].split('、');
          const call = last.role === 'user' ? { name: 'read', arguments: { path: match[1] } }
            : last.tool_call_id?.startsWith('synthetic-read-') ? { name: 'simulation_command_read', arguments: { commandId: ids[0] } }
            : last.tool_call_id?.startsWith('synthetic-simulation_command_read-') && JSON.parse(last.content).id === ids[0]
              ? { name: 'simulation_command_read', arguments: { commandId: ids[1] } } : undefined;
          return Promise.resolve(providerResponse(call));
        }
        return Promise.resolve(providerResponse(tool));
      }
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Unexpected nonlocal request');
      return original(input, init);
    };
    try {
      const output = join(parent, 'evidence');
      const mounts = new Map<string, string>(); let documentReads = 0;
      const runner: DockerRunner = async args => {
        let stdout = Buffer.alloc(0);
        if (args[0] === 'info') stdout = Buffer.from('linux');
        if (args[0] === 'run') mounts.set(args[args.indexOf('--name') + 1], args.find(x => x.startsWith('type=bind,src=') && x.endsWith(',dst=/workspace'))!.slice('type=bind,src='.length, -',dst=/workspace'.length));
        if (args[0] === 'exec') {
          const base = mounts.get(args[2])!; const op = args[args.indexOf('/opt/berserk/files.py') + 1], path = args[args.indexOf('/opt/berserk/files.py') + 2];
          const target = resolve(base, path.replace(/^\/workspace\//, ''));
          expect(target.startsWith(base + sep)).toBe(true);
          if (op === 'image') stdout = Buffer.alloc(0);
          else if (op === 'stat') stdout = Buffer.from(JSON.stringify({directory:false}));
          else if (op === 'read') { stdout = await readFile(target); documentReads++; }
          else throw new Error('Unexpected writable file action');
        }
        return { code: 0, stdout, stderr: Buffer.alloc(0) };
      };
      const execution = new DockerExecutionService({ instanceId: parent }, runner);
      const result = await runScenarioExecution(scenarioExecutionOptions(['--output', output, '--live', '--usage-only',
        '--provider-input-limit-tokens', '131072', '--input-cny-per-million', '2', '--output-cny-per-million', '8']), execution);
      expect(result).toMatchObject({ preparationCompleted: true, protocolCompleted: true, semanticReviewPending: true, scriptedControl: true,
        final: { arrivedVehicles: 7 }, accounting: { stoppedReason: null, limits: null } });
      expect(calls).toBeGreaterThan(39);
      const evidence = JSON.parse(await readFile(join(output, 'validation.json'), 'utf8'));
      expect(evidence.steps.filter((step: { stepId: string }) => /^E\d+$/.test(step.stepId))).toHaveLength(12);
      expect(evidence.steps.some((step: { stepId: string }) => step.stepId.startsWith('exec-'))).toBe(true);
      expect(evidence.atClosure.cross.vehicles.every((vehicle: { state: string }) => vehicle.state === 'blocked')).toBe(true);
      const actions = await readFile(join(output, 'scripted-actions.jsonl'), 'utf8');
      expect(actions).toContain('human-source-task-create'); expect(actions).toContain('human-command-confirm');
      expect(await readFile(join(output, 'provider-input.jsonl'), 'utf8')).not.toContain('fake-v6-probe-credential');
      expect(evidence.accounting.apiRequests).toBe(calls);
      expect(documentReads).toBe(1);
      expect(evidence.deadlineReview.snapshot.lastResult.status).toBe('succeeded');
      expect(evidence.deadlineReview.snapshot.messages.filter((m: {toolName?: string}) => m.toolName === 'simulation_command_read')).toHaveLength(2);
      expect(evidence.historyChecks).toHaveLength(2);
      expect(evidence.historyChecks.every((h: {completed: boolean; pages: unknown[]}) => h.completed && h.pages.length > 0)).toBe(true);
      passed = true;
    } finally { globalThis.fetch = original; vi.unstubAllEnvs(); if (passed) await rm(parent, { recursive: true, force: true }); else console.info(`Synthetic failed evidence retained: ${parent}`); }
  // Full HTTP/SSE, file handoff and history evidence can exceed 90s on the shared two-core server.
  }, 300000);
});
