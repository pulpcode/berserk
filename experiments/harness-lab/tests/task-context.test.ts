import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccessStore } from '../src/access/store.js';
import { openDatabase } from '../src/access/database.js';
import type { AuthSession, Identity, TaskContext, TaskInput, TaskSpace } from '../src/contracts/access.js';
import type { ContextPrincipal } from '../src/contracts/context.js';
import { TaskQueryService } from '../src/context/task-query.js';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';

const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
const road = {systemId: 'situation', objectType: 'road', objectId: 'road-west-01'};
const service: ContextPrincipal = {kind: 'service', profileId: 'test-profile', jobId: randomUUID(), scope: {scopeId: 'demo-context', systemIds: ['intel', 'situation']}};
const context: TaskContext = {businessRefs: [road], focus: {areaIds: ['zone-west'], time: {from: '2026-10-01T09:00:00+08:00', to: '2026-10-01T11:00:00+08:00'}, topics: ['物资运输']}};
const input = (context?: TaskContext, visibility: TaskInput['visibility'] = 'public'): TaskInput => ({title: '补给任务', goal: '09:40 出发，至少需要 3 辆车', visibility, clientActionId: randomUUID(), ...(context ? {context} : {})});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'axon-task-context-'));
  cleanups.push(() => rm(dir, {recursive: true, force: true}));
  const db = await openDatabase(dir);
  cleanups.push(() => db.close());
  const access = new AccessStore(db);
  const actors = {} as Record<'a' | 'b' | 'c', Identity>;
  for (const name of ['a', 'b', 'c'] as const) {
    const id = randomUUID();
    db.prepare('INSERT INTO seats VALUES(?,?,?,?)').run(name, `席位 ${name}`, name === 'c' ? 0 : 1, 0);
    db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,1)').run(id, name, name, name, 'unused-test-salt', 'unused-test-hash');
    actors[name] = access.identity(id)!;
  }
  return {dir, db, access, ...actors, query: new TaskQueryService(access)};
}

describe('task context persistence and access', () => {
  it('normalizes create idempotency, retains old receipts and reopens optional JSON without migration', async () => {
    const {access, db, a} = await setup();
    const legacy = input();
    const old = access.create(a, legacy);
    expect(access.create(a, {...legacy, context: {businessRefs: [], focus: {topics: []}}}).id).toBe(old.id);
    expect(JSON.parse(String(db.prepare('SELECT input FROM task_actions WHERE action_id=?').get(legacy.clientActionId)!.input))).toHaveLength(3);
    const request = input({...context, businessRefs: [{...road, label: ' 西区通道 '}, {...road, label: '西区通道'}], focus: {...context.focus, areaIds: ['zone-west', ' zone-west '], topics: ['运输', '物资', '运输']}});
    const task = access.create(a, request);
    expect(task.context).toEqual({businessRefs: [{...road, label: '西区通道'}], focus: {areaIds: ['zone-west'], time: {from: '2026-10-01T01:00:00.000Z', to: '2026-10-01T03:00:00.000Z'}, topics: ['物资', '运输']}});
    expect(access.create(a, {...request, context: {focus: {topics: ['运输', '物资'], time: {to: '2026-10-01T03:00:00Z', from: '2026-10-01T01:00:00Z'}, areaIds: ['zone-west']}, businessRefs: [{...road, label: '西区通道'}]}}).id).toBe(task.id);
    expect(() => access.create(a, {...request, context: {businessRefs: [{...road, objectId: 'another-road'}]}})).toThrow(expect.objectContaining({code: 'TASK_CONFLICT'}));
    expect(Number(db.prepare('PRAGMA user_version').get()!.user_version)).toBe(2);
    expect(new AccessStore(db).get(task.id, a.seatId)).toEqual(task);
    expect(new AccessStore(db).get(old.id, a.seatId).context).toBeUndefined();
  });

  it('preserves context on old updates, replaces or clears it under one revision and public management capability', async () => {
    const {access, a, b, c} = await setup();
    const task = access.create(a, input(context));
    const edited = access.update(b, task.id, 1, {title: '任务名称更新'});
    expect(edited).toMatchObject({revision: 2, context: task.context, updatedByUserId: b.userId});
    expect(() => access.update(a, task.id, 1, {context: null})).toThrow(expect.objectContaining({code: 'TASK_CONFLICT'}));
    expect(() => access.update(c, task.id, 2, {context: null})).toThrow(expect.objectContaining({code: 'FORBIDDEN'}));
    const replacement = access.update(b, task.id, 2, {context: {focus: {topics: ['设备']}}});
    expect(replacement.context).toEqual({focus: {topics: ['设备']}});
    expect(access.update(a, task.id, 3, {context: null}).context).toBeUndefined();
    const privateTask = access.create(a, input(context, 'private'));
    expect(() => access.update(b, privateTask.id, 1, {context: null})).toThrow(expect.objectContaining({code: 'TASK_NOT_FOUND'}));
    expect(access.update(a, privateTask.id, 1, {context: {}}).context).toBeUndefined();
  });

  it('rejects malformed context, unsupported fields, invalid dates and oversized inputs before writing', async () => {
    const {access, a} = await setup();
    const malformed = [
      null, [], {extra: true}, {businessRefs: [{systemId: 'situation', objectId: 'x'}]},
      {businessRefs: [{...road, objectId: ' '}]}, {businessRefs: [{...road, verified: true}]},
      {businessRefs: [{...road, objectId: 'x'.repeat(129)}]}, {businessRefs: Array.from({length: 21}, () => road)},
      {focus: {areaIds: Array.from({length: 11}, () => 'west')}}, {focus: {topics: ['x'.repeat(201)]}},
      {focus: {permission: 'all'}}, {focus: {time: {from: '2026-10-01T09:00:00'}}},
      {focus: {time: {from: '2026-02-30T09:00:00Z'}}}, {focus: {time: {from: '2026-10-01T25:00:00Z'}}},
      {focus: {time: {from: '2026-10-01T09:00:00Z', to: '2026-10-01T09:00:00Z'}}},
      {focus: {time: {from: '2026-10-02T09:00:00Z', to: '2026-10-01T09:00:00Z'}}},
    ];
    for (const value of malformed) expect(() => access.create(a, {...input(), context: value as TaskContext})).toThrow(expect.objectContaining({code: 'INVALID_INPUT'}));
    expect(access.list(a.seatId)).toEqual([]);
    expect(access.create(a, input({focus: {time: {to: '2028-02-29T09:00:00Z'}}})).context?.focus?.time).toEqual({to: '2028-02-29T09:00:00.000Z'});
    expect(access.create(a, input({businessRefs: [{...road, objectId: 'not-present-in-remote'}]})).context?.businessRefs?.[0].objectId).toBe('not-present-in-remote');
  });

  it('rejects malformed persisted context instead of silently removing it', async () => {
    const {access, a, db} = await setup();
    const task = access.create(a, input(context));
    db.prepare('UPDATE task_spaces SET data=? WHERE id=?').run(JSON.stringify({...task, context: {focus: {time: {from: 'yesterday'}}}}), task.id);
    expect(() => access.get(task.id, a.seatId)).toThrow(expect.objectContaining({code: 'RESOURCE_STATE_INVALID'}));
  });
});

describe('task query metadata projection', () => {
  it('unions exact references, regions and text matches without silently filtering unknown or old task times', async () => {
    const {access, a, b, query, dir} = await setup();
    const referenceTask = access.create(a, {...input({businessRefs: [{...road, label: 'not-a-search-key'}]}), title: '引用任务', goal: '引用'});
    const areaTask = access.create(a, {...input({focus: {areaIds: ['zone-west'], time: {to: '2020-01-01T00:00:00Z'}}}), title: '区域任务', goal: '区域'});
    const textTask = access.create(a, {...input({focus: {topics: ['Urgent Transport']}}), title: '主题任务', goal: '文本'});
    const privateTask = access.create(b, input(context, 'private'));
    access.create(a, {...input(), title: '无关任务', goal: '其他'});
    const result = query.search({businessRefs: [road], areaIds: ['zone-west'], query: ' TRANSPORT '}, service);
    expect(result.data.items.map(item => item.id).sort()).toEqual([referenceTask.id, areaTask.id, textTask.id].sort());
    expect(result.data.items.find(item => item.id === referenceTask.id)?.matches.businessRefs).toEqual([road]);
    expect(result.data.items.find(item => item.id === areaTask.id)?.matches.areaIds).toEqual(['zone-west']);
    expect(result.data.items.find(item => item.id === textTask.id)?.matches.textFields).toEqual(['topics']);
    expect(result.query.query).toBe('transport');
    expect(result.data).toMatchObject({limit: 20, nextCursor: null, hasMore: false});
    expect(result.queriedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    for (const hidden of ['createdByUserId', 'updatedByUserId', 'ownerSeatId', privateTask.id]) expect(JSON.stringify(result)).not.toContain(hidden);
    expect(query.search({businessRefs: [{...road, systemId: 'other'}]}, service).data.items).toEqual([]);
    expect(query.search({query: 'not-a-search-key'}, service).data.items).toEqual([]);
    expect(await readdir(dir)).toEqual(['collaboration']);
  });

  it('keeps service reads active/public, seat reads visible/history and invalid seats unauthorized', async () => {
    const {access, a, b, query} = await setup();
    const pub = access.create(a, input(context));
    const own = access.create(a, input(context, 'private'));
    const foreign = access.create(b, input(context, 'private'));
    const archived = access.create(a, input(context));
    access.update(a, archived.id, 1, {state: 'archived'});
    expect(query.search({}, service).data.items.map(item => item.id)).toEqual([pub.id]);
    expect(query.search({}, {kind: 'seat', seatId: 'a'}).data.items.map(item => item.id).sort()).toEqual([pub.id, own.id].sort());
    for (const id of [own.id, foreign.id, archived.id, randomUUID()]) expect(() => query.read(id, service)).toThrow(expect.objectContaining({code: 'TASK_NOT_FOUND'}));
    expect(query.read(archived.id, {kind: 'seat', seatId: 'a'}).data.item).toMatchObject({state: 'archived', revision: 2});
    expect(() => query.read(foreign.id, {kind: 'seat', seatId: 'a'})).toThrow(expect.objectContaining({code: 'TASK_NOT_FOUND'}));
    expect(() => query.read('task-west-supply', service)).toThrow(expect.objectContaining({code: 'INVALID_ARGUMENT'}));
    access.disable('a');
    expect(() => query.search({}, {kind: 'seat', seatId: 'a'})).toThrow(expect.objectContaining({code: 'FORBIDDEN'}));
    expect(() => query.read(pub.id, {kind: 'seat', seatId: 'a'})).toThrow(expect.objectContaining({code: 'FORBIDDEN'}));
  });

  it('uses stable bound cursors, signals visible task changes and does not reveal foreign private edits', async () => {
    const {access, a, b, query} = await setup();
    const tasks = Array.from({length: 4}, () => access.create(a, input(context)));
    const foreign = access.create(b, input(context, 'private'));
    const first = query.search({limit: 1}, {kind: 'seat', seatId: 'a'});
    const cursor = first.data.nextCursor!;
    expect(first.data.hasMore).toBe(true);
    expect(query.search({limit: 1, cursor}, {kind: 'seat', seatId: 'a'}).data).toEqual(query.search({limit: 1, cursor}, {kind: 'seat', seatId: 'a'}).data);
    const ids = first.data.items.map(item => item.id);
    let next = cursor;
    while (next) {
      const page = query.search({limit: 1, cursor: next}, {kind: 'seat', seatId: 'a'}).data;
      ids.push(...page.items.map(item => item.id)); next = page.nextCursor!;
    }
    expect(ids).toEqual(tasks.map(task => task.id).sort());
    for (const condition of [{limit: 2, cursor}, {limit: 1, query: 'other', cursor}, {limit: 1, cursor: 'invalid'}]) expect(() => query.search(condition, {kind: 'seat', seatId: 'a'})).toThrow(expect.objectContaining({code: 'INVALID_CURSOR'}));
    expect(() => query.search({limit: 1, cursor}, {kind: 'seat', seatId: 'b'})).toThrow(expect.objectContaining({code: 'INVALID_CURSOR'}));
    access.update(b, foreign.id, 1, {goal: '不应影响 A 的分页'});
    expect(query.search({limit: 1, cursor}, {kind: 'seat', seatId: 'a'}).data.items).toHaveLength(1);
    access.update(a, tasks[0].id, 1, {context: null});
    expect(() => query.search({limit: 1, cursor}, {kind: 'seat', seatId: 'a'})).toThrow(expect.objectContaining({code: 'CURSOR_STALE', statusCode: 409}));
    expect(query.read(tasks[0].id, service).data.item).toMatchObject({revision: 2});
    expect(first.data.items[0].context).toEqual(tasks[0].context);
  });

  it('rejects unsupported conditions and preserves cancellation instead of turning it into an empty result', async () => {
    const {query} = await setup();
    for (const params of [{limit: 0}, {limit: null}, {limit: 101}, {limit: 1.5}, {query: 'x'.repeat(201)}, {seatId: 'a'}, {from: '2026-10-01T00:00:00Z'}, {businessRefs: [{...road, label: 'ignored?'}]}, {businessRefs: 'invalid'}, {areaIds: [null]}]) expect(() => query.search(params as never, service)).toThrow(expect.objectContaining({code: 'INVALID_ARGUMENT'}));
    const cancel = new AbortController(); cancel.abort(new Error('test cancellation'));
    expect(() => query.search({}, service, cancel.signal)).toThrow('test cancellation');
    expect(() => query.read(randomUUID(), service, cancel.signal)).toThrow('test cancellation');
  });
});

it('accepts context via authenticated routes and validates replacement/null/omission without creating a workspace', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'axon-task-context-api-'));
  cleanups.push(() => rm(dir, {recursive: true, force: true}));
  const db = await openDatabase(dir); const store = new AccessStore(db);
  await store.saveAccount({username: 'a', displayName: 'A', seatId: 'a', seatName: '席位 A', password: 'test-password-123', createPublicTask: true, manageModelSettings: false});
  db.close();
  const config = testConfig(dir, {seatId: 'a', auth: {secret: 'task-context-test-at-least-32-characters', sessionMs: 28800000}});
  const fake = await fakeRuntime(config, () => ({text: 'unused'})); const lab = await PiLab.create(config, fake.runtime);
  const app = await createApp(lab); cleanups.push(() => app.close());
  const boot = await app.inject('/api/auth/session');
  const auth = await app.inject({method: 'POST', url: '/api/auth/login', headers: {cookie: boot.cookies.map(c => `${c.name}=${c.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': boot.json<AuthSession>().csrf!}, payload: {username: 'a', password: 'test-password-123'}});
  expect(auth.statusCode).toBe(200);
  const headers = {cookie: auth.cookies.map(c => `${c.name}=${c.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': auth.json<AuthSession>().csrf!, 'x-axon-view': auth.json<AuthSession>().viewId!};
  const created = await app.inject({method: 'POST', url: '/api/tasks', headers, payload: input(context)});
  expect(created.statusCode, created.body).toBe(200); const task = created.json<TaskSpace>();
  expect(task.context?.businessRefs).toEqual([road]);
  for (const bad of [null, {extra: true}, {businessRefs: [{...road, extra: true}]}, {focus: {time: {from: '2026-10-01T09:00:00'}}}]) expect((await app.inject({method: 'POST', url: '/api/tasks', headers, payload: {...input(), context: bad}})).statusCode).toBe(400);
  const update = (revision: number, change: object = {}) => app.inject({method: 'PUT', url: `/api/tasks/${task.id}`, headers, payload: {title: task.title, goal: task.goal, revision, ...change}});
  expect((await update(1)).json().context).toEqual(task.context);
  expect((await update(2, {context: {focus: {topics: ['new']}}})).json().context).toEqual({focus: {topics: ['new']}});
  expect((await update(3, {context: null})).json().context).toBeUndefined();
  expect((await update(3, {context})).statusCode).toBe(409);
  expect(lab.workspaces.listAll()).toEqual([]);
  expect(fake.calls).toEqual([]);
});
