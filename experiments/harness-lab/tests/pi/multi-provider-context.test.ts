import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { PiLab } from '../../src/pi/lab.js';
import { configuredRuntime } from '../../src/pi/model-runtime.js';
import { controlledStream, emptyUsage } from '../../src/pi/controlled-stream.js';
import { testConfig } from './fake-runtime.js';
import type { LabConfig } from '../../src/server/config.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function config(overrides: Partial<LabConfig> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'berserk-native-kimi-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return testConfig(dir, { provider: 'kimi-coding', model: 'k3.1-pro', baseUrl: 'https://api.kimi.com/coding/',
    api: 'anthropic-messages', thinkingLevels: ['low', 'high', 'max'], thinkingLevelMap: { off: null },
    compat: { allowEmptySignature: true, supportsEagerToolInputStreaming: false, supportsCacheControlOnTools: false }, ...overrides });
}
interface Block { type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string }
interface Payload { model: string; system?: Array<{text: string}>; messages: Array<{role: string; content: Block[] | string}>; tools?: Array<{name: string; input_schema: unknown}>; thinking?: unknown; max_tokens: number }
function anthropicResponse(tool?: {name: string; input: object}) {
  const events = [
    ['message_start', { type: 'message_start', message: {id: 'msg_offline', type: 'message', role: 'assistant', content: [], model: 'k3.1-pro', stop_reason: null, stop_sequence: null, usage: {input_tokens: 12, output_tokens: 0}} }],
    ['content_block_start', {type: 'content_block_start', index: 0, content_block: tool ? {type: 'tool_use', id: 'call_offline', name: tool.name, input: {}} : {type: 'text', text: ''}}],
    ['content_block_delta', {type: 'content_block_delta', index: 0, delta: tool ? {type: 'input_json_delta', partial_json: JSON.stringify(tool.input)} : {type: 'text_delta', text: '离线回复'}}],
    ['content_block_stop', {type: 'content_block_stop', index: 0}],
    ['message_delta', {type: 'message_delta', delta: {stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null}, usage: {output_tokens: 4}}],
    ['message_stop', {type: 'message_stop'}],
  ];
  return new Response(events.map(([name, value]) => `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`).join(''), {headers: {'content-type': 'text/event-stream'}});
}
function capture(reply: (index: number) => {name: string; input: object} | undefined = () => undefined) {
  const calls: Payload[] = [];
  vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    expect(url.origin + url.pathname).toBe('https://api.kimi.com/coding/v1/messages');
    expect(request.headers.get('x-api-key') ?? request.headers.get('authorization')).toContain('fake-key-NEVER-LEAK-123');
    calls.push(JSON.parse(await request.text()) as Payload);
    return anthropicResponse(reply(calls.length - 1));
  });
  return calls;
}
const system = (payload: Payload) => payload.system?.map(block => block.text).join('') ?? '';

it('keeps the fixed instruction snapshot in native Anthropic system through tool continuation and refreshes only the next request', async () => {
  const cfg = await config(); let oldHash = '';
  const calls = capture(index => index === 0 ? {name: 'instructions_update', input: {fileId: 'workspace', content: 'KIMI_NEW_RULE', expectedHash: oldHash}} : undefined);
  const lab = await PiLab.create(cfg); cleanup.push(() => lab.close());
  const session = await lab.createSession();
  const initial = await lab.resources.readInstruction(session.workspaceId, 'workspace');
  oldHash = (await lab.resources.updateInstruction(session.workspaceId, 'workspace', 'KIMI_OLD_RULE', initial.hash)).hash;
  const first = lab.start(session.id, '修改约定'); await first.run(() => {});
  expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
  expect(calls).toHaveLength(2);
  for (const payload of calls) {
    expect(system(payload)).toContain('KIMI_OLD_RULE');
    expect(system(payload)).not.toContain('KIMI_NEW_RULE');
  }
  const toolResult = calls[1].messages.flatMap(message => Array.isArray(message.content) ? message.content : []).find(block => block.type === 'tool_result');
  expect(toolResult?.tool_use_id).toBe('call_offline');
  expect(calls[0].tools?.some(tool => tool.name === 'instructions_update' && tool.input_schema)).toBe(true);
  await lab.start(session.id, '下一请求').run(() => {});
  expect(system(calls[2])).toContain('KIMI_NEW_RULE');
  expect(system(calls[2])).not.toContain('KIMI_OLD_RULE');
  const latest = await lab.resources.readInstruction(session.workspaceId, 'workspace');
  await lab.resources.updateInstruction(session.workspaceId, 'workspace', '', latest.hash);
  await lab.start(session.id, '清空后继续').run(() => {});
  expect(system(calls[3])).not.toContain('KIMI_NEW_RULE');
  expect(system(calls[3])).toContain('空工作区文件表示没有工作区约定');
  for (const payload of calls) {
    expect(payload.model).toBe('k3.1-pro');
    expect(payload.messages.every(message => message.role === 'user' || message.role === 'assistant')).toBe(true);
    expect(payload.thinking).not.toEqual({type: 'disabled'});
    expect(JSON.stringify(payload)).not.toContain('host_request_instructions');
    expect(system(payload)).not.toContain('当前用户消息之前');
    expect(JSON.stringify(payload)).not.toContain(cfg.apiKey);
  }
  expect(lab.getRequestResources(session.id, first.requestId)).toMatchObject({status: 'available', instructions: [{fileId: 'common'}, {fileId: 'workspace', content: 'KIMI_OLD_RULE'}]});
  for (const file of await readdir(join(cfg.dataDir, 'sessions'))) expect(await readFile(join(cfg.dataDir, 'sessions', file), 'utf8')).not.toContain('host_request_instructions');
});

it('retains native Anthropic compaction prompts and allowance without a reply reminder or disabled thinking', async () => {
  const cfg = await config(); const calls = capture(); const runtime = await configuredRuntime(cfg);
  const stream = controlledStream(runtime, cfg, runtime.getModel(cfg.provider, cfg.model)!,
    {systemPrompt: 'NATIVE_COMPACTION_ONLY', messages: [{role: 'user', content: '总结历史', timestamp: 1}]},
    {maxTokens: 700}, 'compaction', 'FORBIDDEN_HOST_REMINDER', new AbortController().signal, emptyUsage());
  expect((await stream.result()).stopReason).toBe('stop');
  expect(system(calls[0])).toBe('NATIVE_COMPACTION_ONLY');
  expect(calls[0].max_tokens).toBe(700);
  expect(calls[0].thinking).not.toEqual({type: 'disabled'});
  expect(JSON.stringify(calls)).not.toContain('FORBIDDEN_HOST_REMINDER');
});

it.each([
  {provider: 'deepseek', model: 'deepseek-flash', baseUrl: 'https://other.invalid/v1'},
  {provider: 'deepseek', model: 'unverified-model', baseUrl: 'https://api.deepseek.com'},
  {provider: 'custom-alias', model: 'same-id', baseUrl: 'https://api.deepseek.com'},
])('does not apply the DeepSeek reminder to unverified configuration $provider/$model/$baseUrl', async identity => {
  const cfg = await config({...identity, api: 'openai-completions', thinkingLevels: undefined, thinkingLevelMap: undefined, compat: undefined});
  const payloads: Array<{messages: Array<{role: string; content: string}>}> = [];
  vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
    const request = new Request(input, init); payloads.push(JSON.parse(await request.text()));
    return new Response('data: '+JSON.stringify({id: 'test', object: 'chat.completion.chunk', created: 1, model: cfg.model, choices: [{index: 0, delta: {role: 'assistant', content: '完成'}, finish_reason: 'stop'}]})+'\n\ndata: [DONE]\n\n', {headers: {'content-type': 'text/event-stream'}});
  });
  const lab = await PiLab.create(cfg); cleanup.push(() => lab.close()); const session = await lab.createSession();
  await lab.start(session.id, '回复').run(() => {});
  expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
  expect(payloads).toHaveLength(1);
  expect(payloads[0].messages.filter(message => message.role === 'system')).toHaveLength(1);
  expect(JSON.stringify(payloads)).not.toContain('host_request_instructions');
});


it('switches one native history DeepSeek → Kimi → DeepSeek without inheriting default-model thinking, and recovers after disabling Kimi', async () => {
  const cfg = await config({provider: 'deepseek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', api: 'openai-completions',
    thinkingLevels: ['off', 'high'], thinkingLevelMap: undefined, defaultThinkingLevel: 'high', compat: undefined});
  const calls: Array<{url: string; body: Payload}> = [];
  vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
    const request = new Request(input, init), body = JSON.parse(await request.text()) as Payload;
    calls.push({url: request.url, body});
    if (request.url.includes('/coding/')) {
      expect(request.headers.get('x-api-key') ?? request.headers.get('authorization')).toContain('kimi-offline-key');
      return anthropicResponse(calls.filter(call => call.url.includes('/coding/')).length === 1 ? {name: 'source_read', input: {id: 'meeting-notes'}} : undefined);
    }
    return new Response('data: '+JSON.stringify({id: 'offline', object: 'chat.completion.chunk', created: 1, model: cfg.model, choices: [{index: 0, delta: {role: 'assistant', content: 'DeepSeek离线回复'}, finish_reason: 'stop'}]})+'\n\ndata: [DONE]\n\n', {headers: {'content-type': 'text/event-stream'}});
  });
  const lab = await PiLab.create(cfg); cleanup.push(() => lab.close());
  const platform = await lab.updateModelPlatform({name: 'Kimi Code', provider: 'kimi-coding', baseUrl: 'https://api.kimi.com/coding/', api: 'anthropic-messages',
    apiKey: 'kimi-offline-key', enabled: true, expectedVersion: lab.modelCatalog().version}, 'default', true);
  const model = await lab.updateModelProfile({platformId: platform.id, model: 'k3.1-pro', displayName: 'Kimi K3.1 Pro', enabled: true, usageConfirmed: true,
    thinkingLevelMap: {off: null}, contextWindow: 131072, maxOutputTokens: 128, expectedVersion: lab.modelCatalog().version}, 'default', true);
  const session = await lab.createSession();
  await lab.start(session.id, '先用默认模型').run(() => {});
  lab.selectModel(session.id, model.id);
  await lab.start(session.id, '换个模型读资料').run(() => {});
  expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
  const kimi = calls.filter(call => call.url.includes('/coding/'));
  expect(kimi).toHaveLength(2);
  for (const call of kimi) {
    expect(call.body.thinking).toBeUndefined();
    expect(JSON.stringify(call.body)).not.toContain('host_request_instructions');
  }
  expect(JSON.stringify(kimi[0].body.messages)).toContain('DeepSeek离线回复');
  await lab.updateModelPlatform({name: platform.name, provider: platform.provider, baseUrl: platform.baseUrl, api: platform.api, enabled: false, expectedVersion: lab.modelCatalog().version}, platform.id);
  expect(lab.get(session.id).modelId).toBe(model.id);
  expect(() => lab.start(session.id, '停用时不能调用')).toThrow(/尚未开放/);
  lab.selectModel(session.id, 'default');
  await lab.start(session.id, '切回默认模型').run(() => {});
  expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
  expect(lab.get(session.id).messages.filter(message => message.role === 'user')).toHaveLength(3);
  expect(calls.filter(call => !call.url.includes('/coding/'))).toHaveLength(2);
});
