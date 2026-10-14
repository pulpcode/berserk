import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createMockContextServer } from '../scripts/mock-context/server.js';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { AnnotationService } from '../src/annotations/service.js';
import type { AnnotationRef } from '../src/contracts/annotations.js';
import type { SituationCurrent } from '../src/contracts/context.js';
import { ContextService } from '../src/context/service.js';
import { WorkspaceStore } from '../src/workspaces/store.js';

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

it('keeps same-account conversation branches and fixed references stable across live source refresh and task adoption, while files remain task-seat shared', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'axon-agent-framework-boundaries-'));
  cleanup.push(() => rm(dir, {recursive: true, force: true}));
  const db = await openDatabase(dir);
  cleanup.push(() => db.close());
  const access = new AccessStore(db);
  const userId = await access.saveAccount({username: 'planner', displayName: '合成验证用户', seatId: 'planning',
    seatName: '筹划席', password: 'synthetic-boundary-password', createPublicTask: true, manageModelSettings: false});
  const identity = access.identity(userId)!;
  const task = access.create(identity, {clientActionId: randomUUID(), title: '西区补给边界验证', goal: '比较同一用户的会话草稿', visibility: 'public'});
  const workspaces = await WorkspaceStore.open(dir, identity.seatId, true);
  workspaces.access = access;
  const workspace = await workspaces.ensureWorkspace(task.id, identity.seatId, task.title);
  const [seed, sessionA, sessionB] = [randomUUID(), randomUUID(), randomUUID()];
  for (const session of [seed, sessionA, sessionB]) await workspaces.bind(session, workspace.id, identity.seatId);

  const source = createMockContextServer({token: 'synthetic-query', controlToken: 'synthetic-control',
    instanceId: 'boundary', day: '2026-10-13', targets: [{systemId: 'situation', sourceId: 'unused',
      url: 'http://127.0.0.1:1', token: 'synthetic-unused-ingress'}]});
  const baseUrl = await source.listen();
  cleanup.push(() => source.close());
  const context = new ContextService({systems: [{id: 'situation', name: '合成态势', adapter: 'mock-situation-http',
    baseUrl: `${baseUrl}/situation`, tokenEnv: 'QUERY'}], scopes: [{id: 'validation', name: '验证范围',
    systemIds: ['situation'], seatIds: [identity.seatId]}]}, {QUERY: 'synthetic-query'});
  const annotations = new AnnotationService(db, workspaces, access, context);
  // Both conversations use this one captured formal identity, not two users sharing a seat.
  const actor = annotations.actorForSeat(identity.seatId, userId);
  const sourceRef = {systemId: 'situation', objectType: 'resource', objectId: 'boundary-vehicles-west-01'};
  const query = async () => {
    const result = await context.query('situation_query', {systemId: 'situation', mode: 'current', objectRefs: [sourceRef]},
      {kind: 'seat', seatId: identity.seatId});
    const item = (result.data as SituationCurrent).items[0];
    if (!('availableCount' in item.properties) || typeof item.properties.availableCount !== 'number') {
      throw new Error('Expected a resource fact with an available vehicle count');
    }
    return {...item, properties: {availableCount: item.properties.availableCount, unit: '辆' as const}};
  };
  const originalSource = await query();
  expect(originalSource.geometry?.type).toBe('Point');
  annotations.action(actor, seed, {action: 'create_draft', clientActionId: randomUUID(), baseRef: null,
    title: '共同基线', operations: [{op: 'add_layer', layer: {layerId: 'resources', name: '车辆关注点', order: 0,
      defaultVisible: true, features: [{objectId: 'vehicles', kind: 'point', name: originalSource.name,
        geometry: originalSource.geometry!, attributes: originalSource.properties,
        sourceRefs: [{...sourceRef, revision: originalSource.revision}]}]}}]});
  const publication = annotations.action(actor, seed, {action: 'publish', clientActionId: randomUUID(), revision: 1, title: '共同基线发布版'}).publication!;
  const baseRef: AnnotationRef = {publicationId: publication.publicationId};
  const fixed = annotations.version(actor, task.id, baseRef);
  for (const session of [sessionA, sessionB]) annotations.action(actor, session, {
    action: 'create_draft', clientActionId: randomUUID(), baseRef, title: session === sessionA ? '会话 A' : '会话 B',
  });
  const draftA = annotations.binding(actor, sessionA).draft!;
  const bindingB = annotations.binding(actor, sessionB);
  const draftB = bindingB.draft!;
  expect(draftA.setId).not.toBe(draftB.setId);
  const fixedB: AnnotationRef = {setId: draftB.setId, revision: draftB.headRevision};
  const versionB = annotations.version(actor, task.id, fixedB);
  const selectedB = annotations.resolveSelections(actor, task.id, [{...fixedB, objectIds: ['vehicles']}]);

  // Change a real isolated HTTP source, without sending a notification or calling a model.
  const changed = await fetch(`${baseUrl}/control/object-updates`, {method: 'POST',
    headers: {Authorization: 'Bearer synthetic-control', 'Content-Type': 'application/json'},
    body: JSON.stringify({clientActionId: randomUUID(), ref: sourceRef, expectedRevision: originalSource.revision,
      properties: {...originalSource.properties, availableCount: 2}, effectiveAt: '2026-10-13T09:30:00+08:00',
      validTime: originalSource.validTime})});
  expect(changed.status, await changed.text()).toBe(200);
  const latestSource = await query();
  expect(latestSource.revision).toBe(originalSource.revision + 1);
  expect(latestSource.properties.availableCount).toBe(2);
  expect(originalSource.properties.availableCount).toBe(4);
  annotations.action(actor, sessionA, {action: 'apply', clientActionId: randomUUID(), expectedRevision: 1,
    operations: [{op: 'update_object', objectId: 'vehicles', changes: {name: 'A 核对后的车辆',
      attributes: latestSource.properties, sourceRefs: [{...sourceRef, revision: latestSource.revision}]}}]});
  const next = annotations.action(actor, sessionA, {action: 'publish', clientActionId: randomUUID(), revision: 2, title: '会话 A 更新发布版'}).publication!;
  expect(annotations.current(actor, task.id).publication).toBeNull();
  annotations.setCurrent(actor, task.id, {clientActionId: randomUUID(), publicationId: next.publicationId, expectedCurrentSequence: 0});
  expect(annotations.current(actor, task.id).publication?.publicationId).toBe(next.publicationId);
  expect(annotations.binding(actor, sessionB)).toEqual(bindingB);
  expect(annotations.version(actor, task.id, fixedB)).toEqual(versionB);
  expect(annotations.resolveSelections(actor, task.id, [{...fixedB, objectIds: ['vehicles']}])).toEqual(selectedB);
  expect(annotations.version(actor, task.id, baseRef)).toEqual(fixed);

  // Viewing/reference resolution must not rebind B's subsequent edit to A or task-current.
  annotations.resolveSelections(actor, task.id, [{publicationId: next.publicationId, objectIds: ['vehicles']}]);
  annotations.read(actor, task.id, {ref: {setId: draftA.setId, revision: 2}, fields: ['geometry', 'attributes']});
  expect(annotations.automaticContext(actor, sessionB)?.draft).toEqual(fixedB);
  const aBefore = annotations.version(actor, task.id, {setId: draftA.setId, revision: 2});
  annotations.action(actor, sessionB, {action: 'apply', clientActionId: randomUUID(), expectedRevision: 1,
    operations: [{op: 'update_object', objectId: 'vehicles', changes: {name: 'B 独立讨论的车辆'}}]});
  expect(annotations.version(actor, task.id, {setId: draftA.setId, revision: 2})).toEqual(aBefore);
  expect(annotations.version(actor, task.id, {setId: draftB.setId, revision: 2}).document.layers[0].features[0])
    .toMatchObject({name: 'B 独立讨论的车辆', attributes: {availableCount: 4}, sourceRefs: [{...sourceRef, revision: 1}]});
  expect(annotations.version(actor, task.id, fixedB)).toEqual(versionB);

  // Ordinary files deliberately have a different boundary from conversation drafts.
  const filesA = workspaces.filesDirectory(workspaces.binding(sessionA, identity.seatId)!, identity.seatId);
  const filesB = workspaces.filesDirectory(workspaces.binding(sessionB, identity.seatId)!, identity.seatId);
  expect(filesA).toBe(filesB);
  await writeFile(join(filesA, '会话A_说明_v1.md'), 'A 的独立说明文件');
  expect(await readFile(join(filesB, '会话A_说明_v1.md'), 'utf8')).toBe('A 的独立说明文件');
  await writeFile(join(filesB, '会话B_说明_v1.md'), 'B 的独立说明文件');
  expect(await readFile(join(filesA, '会话A_说明_v1.md'), 'utf8')).toBe('A 的独立说明文件');
  expect(await readFile(join(filesA, '会话B_说明_v1.md'), 'utf8')).toBe('B 的独立说明文件');
});
