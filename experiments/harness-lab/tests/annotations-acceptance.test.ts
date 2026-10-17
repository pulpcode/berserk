import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, expect, it } from 'vitest';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import type { AuthSession, TaskSpace } from '../src/contracts/access.js';
import type { AnnotationAction, AnnotationBinding, AnnotationCurrent, AnnotationFeature, AnnotationListing, AnnotationReadResult, AnnotationReceipt, AnnotationVersion } from '../src/contracts/annotations.js';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function login(app: FastifyInstance, seatId: string) {
  const boot = await app.inject('/api/auth/session');
  const logged = await app.inject({method: 'POST', url: '/api/auth/login', headers: {
    cookie: boot.cookies.map(c => `${c.name}=${c.value}`).join('; '), origin: 'http://localhost:4310',
    'x-csrf-token': boot.json<AuthSession>().csrf!,
  }, payload: {seatId, password: 'annotations-test-password'}});
  expect(logged.statusCode, logged.body).toBe(200);
  const auth = logged.json<AuthSession>();
  const headers = {cookie: logged.cookies.map(c => `${c.name}=${c.value}`).join('; '), origin: 'http://localhost:4310',
    'x-csrf-token': auth.csrf!, 'x-axon-view': auth.viewId!};
  const call = (url: string, payload?: object, method: 'POST' | 'PUT' = 'POST') => app.inject({url,
    method: payload === undefined ? 'GET' : method, headers, ...(payload === undefined ? {} : {payload})});
  const read = async <T>(url: string, payload?: object, method: 'POST' | 'PUT' = 'POST') => {
    const result = await call(url, payload, method); expect(result.statusCode, result.body).toBeLessThan(300);
    expect(result.statusCode, result.body).toBeGreaterThanOrEqual(200); return result.json<T>();
  };
  return {call, read};
}
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'axon-annotations-http-'));
  cleanup.push(() => rm(dir, {recursive: true, force: true}));
  const db = await openDatabase(dir), access = new AccessStore(db);
  try {
    for (const seatId of ['author', 'reader', 'manager']) await access.saveAccount({username: seatId, displayName: seatId,
      seatId, seatName: seatId, password: 'annotations-test-password', createPublicTask: seatId !== 'reader', manageModelSettings: false});
  } finally { db.close(); }
  const config = testConfig(dir, {seatId: 'author', auth: {secret: 'annotations-test-signing-secret-32-characters', sessionMs: 28_800_000}});
  const fake = await fakeRuntime(config, () => ({text: '测试回复'}));
  let app = await createApp(await PiLab.create(config, fake.runtime));
  cleanup.push(() => app.close());
  const restart = async () => { await app.close(); app = await createApp(await PiLab.create(config, fake.runtime)); return app; };
  return {app, restart};
}
const point = (objectId: string): AnnotationFeature => ({objectId, kind: 'point', name: '集合点 A',
  geometry: {type: 'Point', coordinates: [103.85, 1.29]}, style: {color: '#ff0000', symbol: 'square'}});
const taskInput = () => ({clientActionId: randomUUID(), title: '标注隔离验收', goal: '比较各会话的独立地图标注', visibility: 'public'});

it('isolates conversation drafts, freezes publication content, and gates whole-version adoption without approval', async () => {
  const {app, restart} = await setup();
  const a = await login(app, 'author'), b = await login(app, 'reader'), manager = await login(app, 'manager');
  const task = await a.read<TaskSpace>('/api/tasks', taskInput());
  const other = await a.read<TaskSpace>('/api/tasks', taskInput());
  const wa = await a.read<{id: string}>(`/api/tasks/${task.id}/workspace`, {});
  const wb = await b.read<{id: string}>(`/api/tasks/${task.id}/workspace`, {});
  const sa = await a.read<{id: string}>('/api/sessions', {workspaceId: wa.id});
  const sa2 = await a.read<{id: string}>('/api/sessions', {workspaceId: wa.id});
  const sb = await b.read<{id: string}>('/api/sessions', {workspaceId: wb.id});
  const action = (id: string) => `/api/sessions/${id}/annotation/actions`;
  const binding = (id: string) => `/api/sessions/${id}/annotation`;
  const current = `/api/tasks/${task.id}/annotations/current`;
  const layerId = randomUUID(), objectId = randomUUID();
  const create: AnnotationAction = {action: 'create_draft', clientActionId: randomUUID(), baseRef: null, title: '我的地图', operations: [
    {op: 'add_layer', layer: {layerId, name: '集合点', order: 0, defaultVisible: true, features: [point(objectId)]}},
  ]};
  const created = await a.read<AnnotationReceipt>(action(sa.id), create);
  expect(await a.read<AnnotationReceipt>(action(sa.id), create)).toEqual(created);
  const draft = (await a.read<AnnotationBinding>(binding(sa.id))).draft!;
  const beforeRejected = await a.read<AnnotationBinding>(binding(sa.id));
  const invalidBatch = await a.call(action(sa.id), {action: 'apply', clientActionId: randomUUID(), expectedRevision: draft.headRevision,
    operations: [{op: 'add_object', layerId, feature: point(randomUUID())}, {op: 'delete_object', objectId: randomUUID()}]});
  expect(invalidBatch.statusCode).toBeGreaterThanOrEqual(400);
  expect(await a.read<AnnotationBinding>(binding(sa.id))).toEqual(beforeRejected);
  expect((await a.call(action(sa2.id), {...create, ownerSessionId: sa.id})).statusCode).toBe(400);
  const revisionUrl = `/api/annotations/${draft.setId}/revisions/${draft.headRevision}`;
  expect((await b.call(revisionUrl)).statusCode).toBe(404);
  expect((await manager.call(revisionUrl)).statusCode).toBe(404);
  expect((await b.call(action(sa.id), create)).statusCode).toBe(404);
  expect((await a.read<AnnotationBinding>(binding(sa2.id))).draft).toBeNull();
  expect((await a.read<AnnotationVersion>(revisionUrl)).document.layers[0].features).toEqual([point(objectId)]);
  const readUrl=`/api/tasks/${task.id}/annotations/read`,namedRead={ref:created.ref,layerNames:['集合点']};
  expect((await a.read<AnnotationReadResult>(readUrl,namedRead)).objects.items).toEqual([{objectId,kind:'point',name:'集合点 A',layerId}]);
  for(const client of [b,manager])expect((await client.call(readUrl,namedRead)).statusCode).toBe(404);
  expect((await a.call(readUrl,{...namedRead,layerIds:[layerId]})).statusCode).toBe(400);
  expect((await a.call(readUrl,{...namedRead,layerNames:['不存在']})).json()).toMatchObject({error:{code:'ANNOTATION_LAYER_NAME_NOT_FOUND'}});
  const published = await a.read<AnnotationReceipt>(action(sa.id), {action: 'publish', clientActionId: randomUUID(), revision: draft.headRevision, title: '基线版本'});
  const p1 = published.publication!;
  expect((await b.read<AnnotationReadResult>(readUrl,{...namedRead,ref:{publicationId:p1.publicationId}})).layers).toMatchObject([{layerId,name:'集合点'}]);
  expect((await b.read<AnnotationVersion>(`/api/annotation-publications/${p1.publicationId}`)).document.layers[0].features[0]).toEqual(point(objectId));
  expect((await a.read<AnnotationCurrent>(current)).publication).toBeNull();
  for (const [client, id] of [[a, sa2.id], [b, sb.id]] as const) await client.read(action(id), {
    action: 'create_draft', clientActionId: randomUUID(), baseRef: {publicationId: p1.publicationId}, title: '独立分支',
  });
  const bBefore = await b.read<AnnotationBinding>(binding(sb.id));
  expect(bBefore.draft!.setId).not.toBe(draft.setId);
  const edit: AnnotationAction = {action: 'apply', clientActionId: randomUUID(), expectedRevision: draft.headRevision,
    operations: [{op: 'update_object', objectId, changes: {geometry: {type: 'Point', coordinates: [103.86, 1.3]}}}]};
  const edited = await a.read<AnnotationReceipt>(action(sa.id), edit);
  expect(await a.read<AnnotationReceipt>(action(sa.id), edit)).toEqual(edited);
  expect((await a.call(action(sa.id), {...edit, clientActionId: randomUUID()})).statusCode).toBe(409);
  expect((await a.call(action(sa.id), {...edit, operations: [{op: 'delete_object', objectId}]})).statusCode).toBe(409);
  const p2 = (await a.read<AnnotationReceipt>(action(sa.id), {action: 'publish', clientActionId: randomUUID(), revision: draft.headRevision + 1, title: '调整版本'})).publication!;
  const select = {clientActionId: randomUUID(), publicationId: p1.publicationId, expectedCurrentSequence: 0};
  expect((await b.call(current, select)).statusCode).toBe(403);
  expect((await a.call(`/api/tasks/${other.id}/annotations/current`, select)).statusCode).toBe(404);
  await manager.read(current, select);
  expect((await a.read<AnnotationCurrent>(current)).sequence).toBe(1);
  expect((await a.call(current, {...select, clientActionId: randomUUID(), publicationId: p2.publicationId})).statusCode).toBe(409);
  await a.read(current, {clientActionId: randomUUID(), publicationId: p2.publicationId, expectedCurrentSequence: 1});
  expect((await b.read<AnnotationCurrent>(current)).publication?.publicationId).toBe(p2.publicationId);
  expect(await b.read<AnnotationBinding>(binding(sb.id))).toEqual(bBefore);
  expect((await a.read<AnnotationVersion>(revisionUrl)).document.layers[0].features[0].geometry).toEqual(point(objectId).geometry);
  expect((await b.read<AnnotationVersion>(`/api/annotation-publications/${p1.publicationId}`)).document.layers[0].features[0].geometry).toEqual(point(objectId).geometry);
  const listing = await manager.read<AnnotationListing>(`/api/tasks/${task.id}/annotations`);
  expect(listing.drafts.total).toBe(0); expect(listing.publications.total).toBe(2);
  await a.read(`/api/tasks/${task.id}/archive`, {revision: task.revision});
  expect((await a.call(action(sa.id), {...edit, clientActionId: randomUUID(), expectedRevision: draft.headRevision + 1})).statusCode).toBe(409);
  expect((await a.call(current, {clientActionId: randomUUID(), publicationId: p1.publicationId, expectedCurrentSequence: 2})).statusCode).toBe(409);
  const afterRestart = await restart(), restored = await login(afterRestart, 'author');
  expect((await restored.read<AnnotationCurrent>(current)).sequence).toBe(2);
  expect((await restored.read<AnnotationVersion>(revisionUrl)).document.layers[0].features[0].style).toEqual(point(objectId).style);
  expect((await restored.read<AnnotationBinding>(binding(sa.id))).draft?.headRevision).toBe(draft.headRevision + 1);
}, 30_000);

it('allows a private-space owner to adopt a publication without public management rights', async () => {
  const {app} = await setup();
  const owner = await login(app, 'reader'), manager = await login(app, 'manager');
  const task = await owner.read<TaskSpace>('/api/tasks', {...taskInput(), visibility: 'private'});
  const workspace = await owner.read<{id: string}>(`/api/tasks/${task.id}/workspace`, {});
  const session = await owner.read<{id: string}>('/api/sessions', {workspaceId: workspace.id});
  const url = `/api/sessions/${session.id}/annotation/actions`;
  await owner.read(url, {action: 'create_draft', clientActionId: randomUUID(), baseRef: null, title: '个人标注'});
  const binding = await owner.read<AnnotationBinding>(`/api/sessions/${session.id}/annotation`);
  const receipt = await owner.read<AnnotationReceipt>(url, {action: 'publish', clientActionId: randomUUID(), revision: binding.draft!.headRevision, title: '个人发布'});
  const publicationId = receipt.publication!.publicationId;
  await owner.read(`/api/tasks/${task.id}/annotations/current`, {clientActionId: randomUUID(), publicationId, expectedCurrentSequence: 0});
  for (const path of [`/api/tasks/${task.id}/annotations`, `/api/tasks/${task.id}/annotations/current`, `/api/annotation-publications/${publicationId}`]) {
    expect((await manager.call(path)).statusCode).toBe(404);
  }
  expect((await owner.read<AnnotationCurrent>(`/api/tasks/${task.id}/annotations/current`)).publication?.publicationId).toBe(publicationId);
}, 30_000);
