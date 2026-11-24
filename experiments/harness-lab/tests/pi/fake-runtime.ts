import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, InMemoryCredentialStore, InMemoryModelsStore,
  type AssistantMessage, type Context, type SimpleStreamOptions } from '@earendil-works/pi-ai';
import type { LabConfig } from '../../src/server/config.js';

export type Reply = { blocks?: Array<{ type: 'text'; text: string } | { type: 'thinking'; thinking: string; redacted?: boolean; thinkingSignature?: string }>; text?: string; textChunks?: AsyncIterable<string>; toolIds?: string[]; tools?: Array<{ name: string; arguments: Record<string, unknown> }>; error?: string; length?: boolean; waitForAbort?: boolean; usageInput?: number; usageOutput?: number; delayMs?: number };
export interface CapturedCall { context: Context; maxTokens?: number; aborted: boolean }

/** Fake only the provider stream: Pi itself performs the real tool loop and persistence. */
export async function fakeRuntime(config: LabConfig, reply: (context: Context, index: number) => Reply) {
  const calls: CapturedCall[] = [];
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerProvider(config.provider, {
    api: 'openai-completions', baseUrl: config.baseUrl,
    models: [{ id: config.model, name: config.model, reasoning: false, input: ['text'],
      contextWindow: config.contextWindow ?? 131072, maxTokens: config.maxOutputTokens ?? 128,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context, options?: SimpleStreamOptions) {
      const call = { context: JSON.parse(JSON.stringify(context)) as Context, maxTokens: options?.maxTokens, aborted: false };
      calls.push(call);
      const plan = reply(context, calls.length - 1);
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = { role: 'assistant', content: [], api: model.api,
        provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: 'stop',
        usage: { input: plan.usageInput ?? 1, output: plan.usageOutput ?? (plan.length ? model.maxTokens : 1), cacheRead: 0, cacheWrite: 0, totalTokens: (plan.usageInput ?? 1) + (plan.usageOutput ?? (plan.length ? model.maxTokens : 1)),
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const emitReply = async () => {
        stream.push({ type: 'start', partial: message });
        if (plan.waitForAbort) {
          const abort = () => {
            call.aborted = true;
            message.stopReason = 'aborted';
            stream.push({ type: 'error', reason: 'aborted', error: message });
          };
          if (options?.signal?.aborted) abort();
          else options?.signal?.addEventListener('abort', abort, { once: true });
          return;
        }
        if (plan.text || plan.textChunks) {
          const block = { type: 'text' as const, text: '' };
          message.content.push(block);
          stream.push({ type: 'text_start', contentIndex: 0, partial: message });
          const append = (delta: string) => {
            block.text += delta;
            stream.push({ type: 'text_delta', contentIndex: 0, delta, partial: message });
          };
          if (plan.text) append(plan.text);
          if (plan.textChunks) for await (const chunk of plan.textChunks) append(chunk);
          stream.push({ type: 'text_end', contentIndex: 0, content: block.text, partial: message });
        }
        for (const original of plan.blocks ?? []) {
          const index = message.content.length;
          if (original.type === 'text') {
            const block = { ...original, text: '' }; message.content.push(block);
            stream.push({ type: 'text_start', contentIndex: index, partial: message });
            block.text = original.text;
            stream.push({ type: 'text_delta', contentIndex: index, delta: original.text, partial: message });
            stream.push({ type: 'text_end', contentIndex: index, content: original.text, partial: message });
          } else {
            const block = { ...original, thinking: '' }; message.content.push(block);
            stream.push({ type: 'thinking_start', contentIndex: index, partial: message });
            block.thinking = original.thinking;
            stream.push({ type: 'thinking_delta', contentIndex: index, delta: original.thinking, partial: message });
            stream.push({ type: 'thinking_end', contentIndex: index, content: original.thinking, partial: message });
          }
        }
        if (plan.error) {
          message.stopReason = 'error'; message.errorMessage = plan.error;
          stream.push({ type: 'error', reason: 'error', error: message });
          return;
        }
        for (const [index, tool] of (plan.tools || (plan.toolIds || []).map(id => ({ name: 'source_read', arguments: { id } }))).entries()) {
          const toolCall = { type: 'toolCall' as const, id: `call-${calls.length}-${index}`, ...tool };
          message.content.push(toolCall);
          stream.push({ type: 'toolcall_end', contentIndex: message.content.length - 1, toolCall, partial: message });
        }
        message.stopReason = plan.length ? 'length' : (plan.tools?.length || plan.toolIds?.length) ? 'toolUse' : 'stop';
        stream.push({ type: 'done', reason: message.stopReason, message });
      };
      const run = () => void emitReply().catch(error => {
        message.stopReason = 'error';
        message.errorMessage = String(error);
        stream.push({ type: 'error', reason: 'error', error: message });
      });
      if (plan.delayMs) setTimeout(run, plan.delayMs); else queueMicrotask(run);
      return stream;
    },
  });
  return { runtime, calls };
}

export function testConfig(dataDir: string, overrides: Partial<LabConfig> = {}): LabConfig {
  return { provider: 'test-local', model: 'deterministic-model', baseUrl: 'https://no-network.invalid',
    apiKey: 'fake-key-NEVER-LEAK-123', dataDir, port: 4310, agentRunTimeoutMs: 0, httpIdleTimeoutMs: 300000,
    contextWindow: 131072, maxOutputTokens: 128, compactionReserveTokens: 16384, compactionKeepRecentTokens: 20000,
    contextSource: 'explicit', outputSource: 'explicit', contextReady: true, ...overrides };
}
