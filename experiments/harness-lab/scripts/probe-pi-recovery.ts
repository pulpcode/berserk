/** Isolated Pi 0.85.1 restart probe; optional --live checks existing provider credentials. No product/server changes. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, appendFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { Type } from 'typebox';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, defineTool } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai';
import { loadConfig } from '../src/server/config.js';

type Scenario = 'awaiting_model' | 'partial_text' | 'before_tool' | 'after_effect' | 'after_result' | 'waiting_question' | 'waiting_confirmation';
type WireMessage = { role: string; content?: unknown; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>; tool_call_id?: string };
type Payload = { messages: WireMessage[] };
const scenarios: Scenario[] = ['awaiting_model', 'partial_text', 'before_tool', 'after_effect', 'after_result', 'waiting_question', 'waiting_confirmation'];
const script = fileURLToPath(import.meta.url);
assert.equal(JSON.parse(await readFile(new URL('../node_modules/@earendil-works/pi-coding-agent/package.json', import.meta.url), 'utf8')).version, '0.85.1', 'Revalidate probe expectations when upgrading Pi');
const question = '恢复验证标记 789：请处理测试任务。';
const continuation = '上次请求中断了。请依据已有历史继续回答，不重复执行旧工具。';
async function effects(dir: string) { try { return (await readFile(join(dir, 'effects.txt'), 'utf8')).trim().split('\n').filter(Boolean).length; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw e; } }
function ready() { process.send?.({ type: 'ready' }); }
async function hold(): Promise<never> { ready(); return new Promise(() => {}); }

async function child(scenario: Scenario, mode: string, dir: string, endpoint: string) {
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const config = mode === 'live' ? loadConfig() : undefined;
  if (config) assert.ok(config.apiKey, 'Live probe requires configured API key');
  const provider = config?.provider ?? 'recovery-probe'; const modelId = config?.model ?? 'probe-model';
  runtime.registerProvider(provider, { api: 'openai-completions', baseUrl: config?.baseUrl ?? endpoint,
    models: [{ id: modelId, name: modelId, reasoning: false, input: ['text'], contextWindow: config?.contextWindow ?? 131072, maxTokens: config?.maxOutputTokens ?? 512,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens' } }] });
  await runtime.setRuntimeApiKey(provider, config?.apiKey ?? 'local-probe-not-a-real-key');
  const sessions = join(dir, 'sessions'); await mkdir(sessions, { recursive: true });
  const manager = mode === 'seed' ? SessionManager.create(dir, sessions) : SessionManager.open(join(sessions, 'history.jsonl'), sessions);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, enableAnalytics: false, enableInstallTelemetry: false });
  const payloads: unknown[] = [];
  const loader = new DefaultResourceLoader({ cwd: dir, agentDir: join(dir, 'agent'), settingsManager: settings,
    extensionFactories: mode === 'live' ? [pi => { pi.on('before_provider_request', event => { assert.ok(payloads.length < 6, 'Diagnostic call limit exceeded'); payloads.push(event.payload); }); }] : [],
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    systemPrompt: 'You are a local recovery probe. Do not infer a missing tool result means no file effect.' });
  await loader.reload();
  const tools = [defineTool({ name: 'probe_write', label: 'Probe write', description: 'Append one marker to the isolated probe file.', parameters: Type.Object({}),
    async execute() { await appendFile(join(dir, 'effects.txt'), 'effect\n'); if (mode === 'seed' && scenario === 'after_effect') return hold(); return { content: [{ type: 'text', text: 'Marker appended.' }], details: {} }; } }),
  defineTool({ name: 'probe_ask', label: 'Probe question', description: 'Wait for a human answer.', parameters: Type.Object({}),
    async execute() { if (mode === 'seed') { manager.appendCustomEntry('probe.question', { status: 'pending', prompt: '报告格式？' }); return hold(); } return { content: [{ type: 'text', text: 'New question only; no old answer restored.' }], details: {} }; } })];
  tools.push(defineTool({ name: 'probe_status', label: 'Probe status', description: 'Read the actual number of saved file markers without writing.', parameters: Type.Object({}),
    async execute() { return { content: [{ type: 'text', text: JSON.stringify({ savedMarkers: await effects(dir) }) }], details: {} }; } }));
  const { session } = await createAgentSession({ cwd: dir, agentDir: join(dir, 'agent'), modelRuntime: runtime,
    model: runtime.getModel(provider, modelId)!, thinkingLevel: 'off', sessionManager: manager,
    settingsManager: settings, resourceLoader: loader, noTools: 'builtin', tools: mode === 'live' ? ['probe_status'] : tools.map(t => t.name), customTools: tools });
  const before = session.agent.beforeToolCall;
  session.agent.beforeToolCall = async (context, signal) => {
    const original = await before?.(context, signal); if (original?.block) return original;
    if (mode === 'seed' && ['before_tool', 'waiting_confirmation'].includes(scenario)) {
      if (scenario === 'waiting_confirmation') manager.appendCustomEntry('probe.confirmation', { status: 'pending', toolCallId: context.toolCall.id });
      return hold();
    }
    return original;
  };
  let crashTurnStarted = false;
  session.subscribe(event => {
    if (crashTurnStarted && mode === 'seed' && scenario === 'partial_text' && event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') ready();
  });
  if (mode === 'seed') {
    // A real completed turn establishes the native file, then the actual next turn is killed.
    await session.prompt('请记住基线事实：编号 789。');
    await writeFile(join(dir, 'session-path.txt'), manager.getSessionFile()!);
    crashTurnStarted = true;
    await session.prompt(question);
    throw new Error('Seed reached completion instead of the requested crash boundary');
  }
  await writeFile(join(dir, 'loaded-context.json'), JSON.stringify(manager.buildSessionContext(), null, 2));
  if (mode === 'live') {
    const timer = setTimeout(() => { void session.abort(); }, 120_000); // Probe only, not a product limit.
    try { await session.prompt('服务曾异常中断。这次只核对，不重做旧操作。请调用 probe_status 查询实际已保存的标记次数，再用中文简短说明：次数是多少；旧工具调用是否已有真实成功结果；缺少结果能否证明没有执行。不要猜测旧问题答案或旧操作已获批准。'); }
    finally { clearTimeout(timer); }
    const last = session.messages.at(-1);
    assert.ok(last?.role === 'assistant' && last.stopReason === 'stop', 'Live response must complete normally');
    const toolResults = session.messages.filter(m => m.role === 'toolResult' && m.toolName === 'probe_status');
    assert.ok(toolResults.length > 0, 'Model must read actual probe status');
    await writeFile(join(dir, 'live-evidence.json'), JSON.stringify({ provider, model: modelId, attempts: payloads.length, payloads, last, toolResults }, null, 2));
  } else {
    const continueSignal = once(process, 'message'); process.send?.({ type: 'loaded' }); await continueSignal;
    await session.prompt(continuation);
  }
  await writeFile(join(dir, 'recovered-context.json'), JSON.stringify(manager.buildSessionContext(), null, 2));
  session.dispose(); process.disconnect?.();
}

function delta(response: ServerResponse, value: unknown, finish: string | null = null) {
  response.write(`data: ${JSON.stringify({ id: 'probe-completion', object: 'chat.completion.chunk', created: 1, model: 'probe-model', choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`);
}
function complete(response: ServerResponse, tool?: string, callId?: string) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  delta(response, { role: 'assistant', ...(tool ? { tool_calls: [{ index: 0, id: callId ?? `call-${tool}`, type: 'function', function: { name: tool, arguments: '{}' } }] } : { content: '已保留编号 789。' }) });
  delta(response, {}, tool ? 'tool_calls' : 'stop'); response.end('data: [DONE]\n\n');
}
async function main() {
  const root = await mkdtemp(join(tmpdir(), 'axon-pi-recovery-'));
  const results: unknown[] = [];
  console.info(`Evidence: ${root}`);
  for (const scenario of scenarios) {
    const seed = join(root, scenario, 'seed'); await mkdir(seed, { recursive: true });
    const wires: Record<string, Payload[]> = { seed: [], recover: [], reissue: [] };
    let boundary: (() => void) | undefined;
    const server = createServer(async (request, response) => {
      try {
        const mode = request.url!.split('/')[1]; assert.ok(mode in wires);
        let body = ''; for await (const chunk of request) body += chunk;
        const payload: Payload = JSON.parse(body); wires[mode].push(payload); const index = wires[mode].length - 1;
        if (mode !== 'seed') { complete(response, mode === 'reissue' && index === 0 ? 'probe_write' : undefined, `call-${mode}-${index}`); return; }
        if (index === 0) { complete(response); return; }
        if (scenario === 'awaiting_model' || (scenario === 'after_result' && index === 2)) { boundary?.(); return; }
        if (scenario === 'partial_text') { response.writeHead(200, { 'Content-Type': 'text/event-stream' }); delta(response, { role: 'assistant', content: '尚未完整结束的流式片段' }); return; }
        complete(response, scenario === 'waiting_question' ? 'probe_ask' : 'probe_write', `call-${mode}-${index}`);
      } catch (error) { response.destroy(error as Error); }
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const run = async (mode: string, dir: string) => {
      const p = spawn(process.execPath, ['--import', 'tsx', script, '--child', scenario, mode, dir, `http://127.0.0.1:${address.port}/${mode}/v1`], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      let stderr = ''; p.stderr!.on('data', bytes => { stderr += bytes; });
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => p.once('exit', (code, signal) => resolve({ code, signal })));
      let timer: NodeJS.Timeout | undefined;
      try {
        const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${scenario}/${mode}: deadline ${stderr}`)), 30_000); });
        await Promise.race([new Promise<void>((resolve, reject) => {
          boundary = resolve;
          p.on('message', (message: { type: string }) => { if (message.type === 'ready' || message.type === 'loaded') resolve(); });
          p.once('error', reject); p.once('exit', () => reject(new Error(`early exit ${stderr}`)));
        }), deadline]);
        if (mode === 'seed') {
          p.kill('SIGKILL'); const stopped = await exited; assert.equal(stopped.signal, 'SIGKILL');
        } else {
          // Opening the session must not contact the model or execute old tools.
          assert.equal(wires[mode].length, 0);
          p.send({ type: 'continue' });
          const stopped = await Promise.race([exited, deadline]); assert.equal(stopped.code, 0, stderr);
        }
      } finally { clearTimeout(timer); if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL'); }
    };
    try {
      await run('seed', seed);
      const nativeFile = (await readFile(join(seed, 'session-path.txt'), 'utf8')).trim();
      const original = await readFile(nativeFile, 'utf8'); const seedEffects = await effects(seed);
      const entries = original.trim().split('\n').map(line => JSON.parse(line));
      const messages = entries.filter(e => e.type === 'message').map(e => e.message);
      assert.ok(JSON.stringify(messages).includes('编号 789')); assert.ok(JSON.stringify(messages).includes(question));
      const callCount = messages.flatMap(m => Array.isArray(m.content) ? m.content : []).filter(b => b.type === 'toolCall').length;
      const resultCount = messages.filter(m => m.role === 'toolResult').length;
      const recover = join(root, scenario, 'recover'); await cp(seed, recover, { recursive: true });
      await writeFile(join(recover, 'sessions', 'history.jsonl'), original);
      await run('recover', recover);
      assert.equal(wires.recover.length, 1); assert.equal(await effects(recover), seedEffects);
      const wire = wires.recover[0].messages;
      assert.equal(wire.filter(m => m.role === 'user' && JSON.stringify(m.content).includes(question)).length, 1);
      const missing = wire.filter(m => m.role === 'tool' && JSON.stringify(m.content).includes('No result provided'));
      assert.equal(missing.length, callCount - resultCount);
      const after = await readFile(join(recover, 'sessions', 'history.jsonl'), 'utf8'); assert.ok(after.startsWith(original));
      assert.equal(after.includes('No result provided'), false, 'Transport placeholder must not rewrite native history');
      assert.equal(seedEffects, ['after_effect', 'after_result'].includes(scenario) ? 1 : 0);
      let reissueEffects: number | undefined;
      if (scenario === 'after_effect') {
        const reissue = join(root, scenario, 'reissue'); await cp(seed, reissue, { recursive: true });
        await writeFile(join(reissue, 'sessions', 'history.jsonl'), original); await run('reissue', reissue);
        reissueEffects = await effects(reissue); assert.equal(reissueEffects, 2); assert.equal(wires.reissue.length, 2);
      }
      const result = { scenario, seedEffects, nativeToolCalls: callCount, nativeToolResults: resultCount,
        partialTextPersisted: original.includes('尚未完整结束的流式片段'), automaticModelCallsOnOpen: 0,
        recoveryModelCalls: wires.recover.length, synthesizedMissingResults: missing.length, nativeHistoryPrefixPreserved: true,
        toolEffectsAfterRecovery: await effects(recover), ...(reissueEffects !== undefined ? { effectsWhenModelReissues: reissueEffects } : {}) };
      results.push(result); await writeFile(join(root, scenario, 'wire.json'), JSON.stringify(wires, null, 2)); console.info(JSON.stringify(result));
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
  await writeFile(join(root, 'results.json'), JSON.stringify({ piVersion: '0.85.1', transport: 'real OpenAI-compatible adapter + local deterministic SSE provider', crash: 'SIGKILL child process', results }, null, 2));
  console.info(`PASS ${results.length} crash boundaries; evidence ${join(root, 'results.json')}`);
}
async function live(root: string) {
  const evidence = JSON.parse(await readFile(join(root, 'results.json'), 'utf8'));
  assert.equal(evidence.piVersion, '0.85.1');
  for (const scenario of ['before_tool', 'after_effect', 'waiting_question'] as const) {
    const seed = join(root, scenario, 'seed'); const dir = await mkdtemp(join(tmpdir(), `axon-pi-live-${scenario}-`));
    await cp(seed, dir, { recursive: true });
    const original = await readFile((await readFile(join(seed, 'session-path.txt'), 'utf8')).trim());
    await writeFile(join(dir, 'sessions', 'history.jsonl'), original);
    const before = await effects(dir); await child(scenario, 'live', dir, ''); assert.equal(await effects(dir), before);
    console.info(JSON.stringify({ scenario, effects: before, evidence: join(dir, 'live-evidence.json') }));
  }
}
if (process.argv[2] === '--live') {
  await live(process.argv[3]);
} else if (process.argv[2] === '--child') {
  await child(process.argv[3] as Scenario, process.argv[4], process.argv[5], process.argv[6]);
} else { await main(); }
