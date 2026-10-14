import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ContextService } from '../../src/context/service.js';
import type { AnnotationReceipt } from '../../src/contracts/annotations.js';
import type { SituationCurrent, SituationObject } from '../../src/contracts/context.js';
import { PiLab } from '../../src/pi/lab.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';

const clean: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of clean.splice(0).reverse()) await close(); });

it('runs source import through native Pi, reopens its exact history and recovers the fixed receipt without querying changed sources', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'axon-source-native-')); clean.push(() => rm(dir, {recursive: true, force: true}));
  const config = testConfig(dir, {seatId: 'alpha', testSeats: [{id: 'alpha', name: '甲'}, {id: 'bravo', name: '乙'}]});
  const sourceRef = {systemId: 'situation', objectType: 'area', objectId: 'west'};
  const original: SituationObject = {ref: sourceRef, name: '西区', revision: 2, areaIds: ['west'], effectiveAt: '2026-10-01T09:20:00+08:00',
    validTime: null, properties: {memberRefs: []}, geometry: {type: 'Polygon', coordinates: [[[103,1],[104,1],[104,2],[103,2],[103,1]]]}};
  let current = original;
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    const body: SituationCurrent = {systemId: 'situation', asOf: '2026-10-01T09:20:00+08:00', items: [current], limit: 20,
      nextCursor: null, hasMore: false, timeUnknownCount: 0, unknownRefs: [], changeCursor: `c-${current.revision}`};
    return new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}});
  });
  const context = new ContextService({systems: [{id: 'situation', name: '态势', adapter: 'mock-situation-http', baseUrl: 'http://127.0.0.1:4401', tokenEnv: 'TEST_QUERY_TOKEN'}],
    scopes: [{id: 'visible', name: '测试范围', systemIds: ['situation'], seatIds: ['alpha']}]}, {TEST_QUERY_TOKEN: 'synthetic-query-token'}, {fetch});
  const runtime = await fakeRuntime(config, (_context, index) => index === 0 ? {tools: [
    {name: 'annotation_read', arguments: {mode: 'draft'}},
    {name: 'situation_query', arguments: {systemId: 'situation', mode: 'current', objectRefs: [sourceRef]}},
  ]} : index === 1 ? {tools: [{name: 'annotation_from_source', arguments: {
    items: [{mode: 'add', sourceRef, layerId: 'areas', objectId: 'west-note'}],
  }}]} : {text: '已按来源保存。'});
  const lab = await PiLab.create(config, runtime.runtime); clean.push(() => lab.close());
  lab.context = context; lab.annotations!.context = context;
  const session = await lab.createSession(undefined, 'alpha'), actor = lab.annotations!.actorForSeat('alpha');
  lab.annotations!.action(actor, session.id, {action: 'create_draft', clientActionId: randomUUID(), baseRef: null,
    operations: [{op: 'add_layer', layer: {layerId: 'areas', name: '区域', order: 0, defaultVisible: true, features: []}}]});
  await lab.start(session.id, '采用来源中的西区边界。', {}, 'alpha').run(() => {});
  const snapshot = lab.get(session.id, 'alpha'); expect(snapshot.lastResult?.status).toBe('succeeded');
  const message = snapshot.messages.find(item => item.role === 'tool' && item.toolName === 'annotation_from_source')!;
  expect(message.isError).not.toBe(true);
  const receipt = JSON.parse(message.text) as AnnotationReceipt;
  expect(receipt).toMatchObject({action: 'from_source', sessionId: session.id, fromSources: [{sourceRef, sourceRevision: 2}]});
  expect(receipt.fromSources![0].queriedAt).toMatch(/Z$/);
  expect(message.text).not.toContain('coordinates');
  expect(lab.annotations!.version(actor, receipt.taskId, receipt.ref!).document.layers[0].features[0]).toMatchObject({
    objectId: 'west-note', geometry: original.geometry, sourceRefs: [{...sourceRef, revision: 2, queriedAt: receipt.fromSources![0].queriedAt}],
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  current = {...original, revision: 3, geometry: {type: 'Polygon', coordinates: [[[103,1],[105,1],[105,2],[103,2],[103,1]]]}};
  await lab.close();
  const reopenedRuntime = await fakeRuntime(config, (_context, index) => index === 0 ? {tools: [{name: 'annotation_read', arguments: {
    mode: 'receipt', requestId: message.requestId, toolCallId: message.toolCallId,
  }}]} : {text: '已读取原操作回执。'});
  const reopened = await PiLab.create(config, reopenedRuntime.runtime); clean.push(() => reopened.close());
  reopened.context = context; reopened.annotations!.context = context;
  expect(reopened.get(session.id, 'alpha').messages).toEqual(snapshot.messages);
  expect(reopened.get(session.id, 'alpha').recoveryWarning).toBeUndefined();
  await reopened.start(session.id, '核对刚才实际保存的版本。', {}, 'alpha').run(() => {});
  const after = reopened.get(session.id, 'alpha'); expect(after.lastResult?.status).toBe('succeeded');
  const recovered = after.messages.findLast(item => item.role === 'tool' && item.toolName === 'annotation_read')!;
  expect(recovered.isError).not.toBe(true); expect(JSON.parse(recovered.text)).toEqual(receipt);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(reopened.annotations!.binding(actor, session.id).draft?.headRevision).toBe(2);
  expect(reopened.annotations!.version(actor, receipt.taskId, receipt.ref!).document.layers[0].features[0].geometry).toEqual(original.geometry);
});
