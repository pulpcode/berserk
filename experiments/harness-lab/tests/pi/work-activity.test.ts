import { expect, it } from 'vitest';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { WorkItem } from '../../src/contracts/collaboration.js';
import type { WorkActivityView } from '../../src/contracts/work-activity.js';
import { buildWorkActivityContext, decodeWorkActivity, generateWorkActivity } from '../../src/pi/work-activity.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';

const config = testConfig('/unused', { maxOutputTokens: 4096 });
const view: WorkActivityView = { version: 'a'.repeat(64), source: { sourceRequestId: 'turn', finalMessageId: 'final' }, canAnalyze: true, facts: [], evidence: [
  { id: 'old', messageId: 'old', requestId: 'previous', kind: 'user', text: '先准备旧工作' },
  { id: 'user', messageId: 'user', requestId: 'turn', kind: 'user', text: '分别编制设备采购建议和人员培训计划，参考旧工作格式。' },
  { id: 'final', messageId: 'final', requestId: 'turn', kind: 'assistant', text: '已完成并提交。' },
] };
const work = (id: string, title = id): WorkItem => ({ id, title, goal: `分别办理${title}`, taskSpaceId: 'task', creatorSeatId: 'a', assigneeSeatId: 'b', state: 'working', revision: 1, inputFileIds: [], createdAt: '', updatedAt: '' });
const works = [work('w1', '设备采购建议'), work('w2', '人员培训计划'), work('w3', '旧工作')];
const row = (workItemId: string | null, evidenceIds = ['user']) => ({ workItemId, title: '模型给出的名称', description: '正在编制文件', relation: 'processing', evidenceIds });
const message = (items: unknown): AssistantMessage => ({ stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify({ items }) }] }) as AssistantMessage;

it('grounds multiple work items in provided evidence and uses authoritative titles/state', async () => {
  const fake = await fakeRuntime(config, () => ({ text: JSON.stringify({ items: [row('w1'), row('w2'), { ...row('w3'), relation: 'reference' }] }) }));
  const result = await generateWorkActivity(fake.runtime, config, view, works, new AbortController().signal);
  expect(result?.items.map(item => [item.workItemId, item.title, item.state])).toEqual([
    ['w1', '设备采购建议', 'working'], ['w2', '人员培训计划', 'working'], ['w3', '旧工作', 'working'],
  ]);
  expect(result?.items[0]).toMatchObject({ origin: 'analysis', recency: 'current' });
  expect(fake.calls).toHaveLength(1); expect(fake.calls[0].context.tools).toBeUndefined(); expect(fake.calls[0].maxTokens).toBe(2048);
  expect(JSON.stringify(fake.calls[0].context)).not.toContain('host_request_instructions');
});

it('supports unmatched activities, uncertainty and genuinely empty results without inventing work states', () => {
  const input = buildWorkActivityContext(view, works, config)!;
  expect(decodeWorkActivity(message([row(null)]), view, input)?.[0]).toMatchObject({ workItemId: null, origin: 'analysis', title: '模型给出的名称' });
  expect(decodeWorkActivity(message([{ ...row(null), relation: 'uncertain' }]), view, input)?.[0].state).toBeUndefined();
  expect(decodeWorkActivity(message([]), view, input)).toEqual([]);
});

it('rejects guessed IDs, fabricated evidence, duplicate work and assistant-only processing', () => {
  const input = buildWorkActivityContext(view, works, config)!;
  for (const items of [[row('foreign')], [row('w1', ['invented'])], [row('w1'), row('w1')], [row('w1', ['final'])], [row('w1', ['user', 'user'])],
    [{ ...row('w1'), state: 'submitted' }], [{ ...row(null), title: '   ' }], [{ ...row('w1'), description: '   ' }]]) {
    expect(decodeWorkActivity(message(items), view, input)).toBeNull();
  }
  expect(decodeWorkActivity(message([row('w1', ['old', 'final'])]), view, input)?.[0].recency).toBe('earlier');
});

it('bounds context, prioritizes explicit title references and marks incomplete coverage', () => {
  const lots = Array.from({ length: 40 }, (_, i) => work(`other-${i}`));
  const input = buildWorkActivityContext(view, [...lots, ...works], config)!;
  expect(input.coverage).toBe('partial'); expect(input.candidates).toHaveLength(24);
  expect(input.candidates.slice(0, 3).map(item => item.id)).toEqual(['w1', 'w2', 'w3']);
  const long = buildWorkActivityContext(view, [{ ...work('w1'), goal: '长'.repeat(12000) }], config)!;
  expect(long.coverage).toBe('partial'); expect(JSON.stringify(long.context)).toContain('[节选]');
  expect(buildWorkActivityContext(view, works, { contextWindow: 10, maxOutputTokens: 1 })).toBeNull();
});

it('rejects invalid JSON, truncation, thinking-only and tool-bearing results', async () => {
  for (const reply of [{ text: 'not json' }, { text: '{"items":[]}', length: true },
    { blocks: [{ type: 'thinking' as const, thinking: 'private' }] }, { text: '{"items":[]}', tools: [{ name: 'write', arguments: {} }] }]) {
    const fake = await fakeRuntime(config, () => reply);
    expect(await generateWorkActivity(fake.runtime, config, view, works, new AbortController().signal)).toBeNull();
  }
});
