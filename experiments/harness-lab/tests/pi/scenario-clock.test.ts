import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createMockContextServer } from '../../scripts/mock-context/server.js';
import { ContextService } from '../../src/context/service.js';
import type { ResourceRecord, ResourceResult } from '../../src/contracts/resource-results.js';
import type { ScenarioDefinitions, ScenarioMutationResult } from '../../src/contracts/scenarios.js';
import { PiLab } from '../../src/pi/lab.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';

const clean: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  try { for (const close of clean.splice(0).reverse()) await close(); }
  finally { vi.useRealTimers(); }
});

type ProviderContext = Parameters<Parameters<typeof fakeRuntime>[1]>[0];
type VisibleResult = Omit<ResourceResult, 'records'> & {
  resultMeaning: { createdAt: string; statisticsAt: string; statisticsAtMeaning: string };
  records: Array<ResourceRecord & { timeMeaning: {
    sourceSnapshotAt: { value: string; meaning: string };
    sourceQueriedAt: { value: string; meaning: string };
    factTimeMeanings: { reportedAt: string; effectiveAt: string; validUntil: string };
  } }>;
};

/** Inspect text actually delivered to the provider, never the tool's private details. */
function visibleResult(context: ProviderContext): VisibleResult {
  const message = context.messages.findLast(m => m.role === 'toolResult' && m.toolName === 'task_resource_query');
  if (!message || message.role !== 'toolResult') throw Error('Missing native resource tool result');
  expect(message.isError).toBe(false);
  const body = JSON.parse(message.content.filter(c => c.type === 'text').map(c => c.text).join('\n')) as { format: string; data: VisibleResult };
  expect(body.format).toBe('resource.model-result.v1');
  return body.data;
}

it('uses scene time in actual native query → summarize → read input and retains fixed evidence after advancement/restart', async () => {
  // Pin only the host calendar to the next day. HTTP, SQLite, Pi and timers stay real;
  // fakeRuntime replaces only the provider and explicitly forbids model network access.
  const queriedAt = '2026-11-04T06:00:00.000Z', laterCreatedAt = '2026-11-04T06:05:00.000Z';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(queriedAt));
  const dir = await mkdtemp(join(tmpdir(), 'scenario-clock-native-'));
  clean.push(() => rm(dir, { recursive: true, force: true }));
  const source = createMockContextServer({ token: 'synthetic-query', controlToken: 'synthetic-control', scenariosEnabled: true, databasePath: join(dir, 'scenario.sqlite') });
  clean.push(() => source.close());
  const origin = await source.listen();
  async function control<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${origin}/control/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer synthetic-control', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    return result as T;
  }
  const definition = (await control<ScenarioDefinitions>('scenarios')).items[0];
  const actor = { userId: 'test-director', seatId: 'director' };
  const created = await control<ScenarioMutationResult>('instances', { definitionId: definition.id, version: definition.version, mode: 'source_replay', clientActionId: randomUUID(), actor });
  const active = await control<ScenarioMutationResult>(`instances/${created.instance.instanceId}/activate`, { clientActionId: randomUUID(), expectedRevision: created.instance.revision, expectedActiveRevision: 0, actor });
  const clock = { instanceId: active.instance.instanceId, businessNow: '2026-11-03T09:10:00+08:00', revision: active.instance.revision };
  expect(active.instance).toMatchObject(clock);
  const context = new ContextService({ systems: [{ id: 'situation', name: '场景态势来源', adapter: 'mock-situation-http', baseUrl: `${origin}/situation`, tokenEnv: 'QUERY_TOKEN', scenarioClock: true }], scopes: [{ id: 'scene', name: '场景来源', systemIds: ['situation'], seatIds: ['alpha'] }] }, { QUERY_TOKEN: 'synthetic-query' });
  const config = testConfig(join(dir, 'lab'), { seatId: 'alpha', testSeats: [{ id: 'alpha', name: '甲' }] });
  let resourceRef = '', summaryRef = '';
  const fake = await fakeRuntime(config, (input, index) => {
    if (index === 0) return { tools: [{ name: 'task_resource_query', arguments: { operation: 'query', purpose: 'data', sources: [{ systemId: 'situation', objectRefs: [{ systemId: 'situation', objectType: 'resource', objectId: `${clock.instanceId}-V12` }] }] } }] };
    if (index === 1) { resourceRef = visibleResult(input).resultRef; return { tools: [{ name: 'task_resource_query', arguments: { operation: 'summarize', resultRef: resourceRef, relation: 'all', availability: 'unavailable' } }] }; }
    if (index === 2) { summaryRef = visibleResult(input).resultRef; return { tools: [{ name: 'task_resource_query', arguments: { operation: 'read', resultRef: summaryRef } }] }; }
    if (index === 4) return { tools: [{ name: 'task_resource_query', arguments: { operation: 'summarize', resultRef: resourceRef, relation: 'all', availability: 'unavailable' } }] };
    if (index === 5) return { tools: [{ name: 'task_resource_query', arguments: { operation: 'read', resultRef: summaryRef } }] };
    return { text: '按原场景时点读取固定证据。' };
  });
  let lab = await PiLab.create(config, fake.runtime);
  clean.push(() => lab.close());
  lab.context = context; lab.annotations!.context = context;
  const session = await lab.createSession(undefined, 'alpha');
  const sourceReads = () => source.requests.filter(request => request.path.startsWith('/situation/')).length;

  function assertModelTime(result: VisibleResult, createdAt: string) {
    expect(result).toMatchObject({ schemaVersion: 4, timeBasis: 'scenario', snapshotClock: clock, createdAt, statisticsScope: { at: clock.businessNow } });
    expect(Date.parse(result.createdAt)).toBeGreaterThan(Date.parse(clock.businessNow));
    expect(result.items).toEqual([expect.objectContaining({ name: 'V12 水罐车', availability: 'unavailable' })]);
    expect(result.summary).toMatchObject({ itemCount: 1, entityCount: 1 });
    expect(result.records[0].source).toMatchObject({ asOf: clock.businessNow, queriedAt, snapshotClock: clock });
    expect(result.records[0].resource.availability).toMatchObject({ state: 'unavailable', validUntil: '2026-11-03T09:40:00+08:00' });
    expect(result.resultMeaning.createdAt).toContain('读取不代表重新查询');
    expect(result.resultMeaning.statisticsAt).toBe(clock.businessNow);
    expect(result.resultMeaning.statisticsAtMeaning).toContain('场景业务判断时点');
    expect(result.resultMeaning.statisticsAtMeaning).toContain('createdAt/queriedAt为真实处理时间');
    expect(result.records[0].timeMeaning).toMatchObject({
      sourceSnapshotAt: { value: clock.businessNow, meaning: expect.stringContaining('不是本次查询时间') },
      sourceQueriedAt: { value: queriedAt, meaning: expect.stringContaining('不是业务事实发生时间') },
      factTimeMeanings: { validUntil: expect.stringContaining('有效截止时间') },
    });
  }

  await lab.start(session.id, '读取 V12 并统计当前不可用车辆，再读取固定统计结果。', {}, 'alpha').run(() => {});
  expect(fake.calls).toHaveLength(4);
  for (const call of fake.calls.slice(1)) assertModelTime(visibleResult(call.context), queriedAt);
  expect(sourceReads()).toBe(1);
  const original = lab.get(session.id, 'alpha').messages.find(message => message.role === 'tool')!.resourceResult!;
  expect(original).toMatchObject({ resultRef: resourceRef, snapshotClock: clock, schemaVersion: 4 });
  const fixedBytes = JSON.stringify(original);

  const advanced = await control<ScenarioMutationResult>(`instances/${clock.instanceId}/steps/E01`, { clientActionId: randomUUID(), expectedRevision: clock.revision, actor });
  expect(advanced.instance).toMatchObject({ businessNow: '2026-11-03T09:12:00+08:00', revision: clock.revision + 1 });
  vi.setSystemTime(new Date(laterCreatedAt));
  await lab.start(session.id, '剧情已推进，只沿用原结果重新统计并读原固定统计。', {}, 'alpha').run(() => {});
  expect(fake.calls).toHaveLength(7);
  assertModelTime(visibleResult(fake.calls[5].context), laterCreatedAt);
  assertModelTime(visibleResult(fake.calls[6].context), queriedAt);
  expect(sourceReads()).toBe(1);
  const beforeRestart = lab.get(session.id, 'alpha');
  expect(beforeRestart.messages.filter(message => message.role === 'tool').every(message => message.isError === false)).toBe(true);
  await lab.close();

  const reopenedFake = await fakeRuntime(config, (_input, index) => {
    if (index === 0) return { tools: [{ name: 'task_resource_query', arguments: { operation: 'read', resultRef: resourceRef } }] };
    if (index === 1) return { tools: [{ name: 'task_resource_query', arguments: { operation: 'read', resultRef: summaryRef } }] };
    if (index === 2) return { tools: [{ name: 'task_resource_query', arguments: { operation: 'summarize', resultRef: resourceRef, relation: 'all', availability: 'unavailable' } }] };
    return { text: '重启后仍沿用原场景时点。' };
  });
  lab = await PiLab.create(config, reopenedFake.runtime);
  lab.context = context; lab.annotations!.context = context;
  expect(lab.get(session.id, 'alpha').messages).toEqual(beforeRestart.messages);
  await lab.start(session.id, '重启后读取原查询、原统计，并以原证据重新统计。', {}, 'alpha').run(() => {});
  expect(reopenedFake.calls).toHaveLength(4);
  assertModelTime(visibleResult(reopenedFake.calls[1].context), queriedAt);
  assertModelTime(visibleResult(reopenedFake.calls[2].context), queriedAt);
  assertModelTime(visibleResult(reopenedFake.calls[3].context), laterCreatedAt);
  const reloadedQuery = lab.get(session.id, 'alpha').messages.filter(message => message.role === 'tool').findLast(message => message.resourceResult?.resultRef === resourceRef)!.resourceResult!;
  const { delivery, ...fixedQuery } = reloadedQuery;
  expect(delivery).toBeDefined();
  expect(JSON.stringify(fixedQuery)).toBe(fixedBytes);
  expect(sourceReads()).toBe(1);
}, 30000);
