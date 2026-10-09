import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/access/database.js';
import { AccessStore } from '../../src/access/store.js';
import { BackgroundStore, backgroundHash } from '../../src/background/store.js';
import { TaskLinkService } from '../../src/background/task-links.js';
import type { Identity, TaskSpace } from '../../src/contracts/access.js';
import type { BackgroundEvent, BackgroundJob, BackgroundProfileSnapshot } from '../../src/contracts/background.js';
import type { TaskAssessmentInput } from '../../src/contracts/task-information.js';

const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const profile: BackgroundProfileSnapshot = {id: 'analysis', name: '综合分析', goal: '分析输入及相关任务', tools: ['information_record_task_assessment'], skillIds: [], agentIds: [], instructions: 'PRIVATE SERVICE INSTRUCTIONS', resources: []};
const draft = {title: '编制新说明', goal: '按来文要求形成工作说明', reason: '具有独立目标，没有现有任务可承接'};
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'axon-task-link-'));
  cleanups.push(() => rm(dir, {recursive: true, force: true}));
  const db = await openDatabase(dir); cleanups.push(() => db.close());
  const access = new AccessStore(db), store = new BackgroundStore(db);
  const actors = {} as Record<'a' | 'b' | 'c', Identity>;
  for (const name of ['a', 'b', 'c'] as const) {
    const id = randomUUID(); db.prepare('INSERT INTO seats VALUES(?,?,?,?)').run(name, `席位 ${name}`, name === 'c' ? 0 : 1, 0);
    db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,1)').run(id, name, name, name, 'test-only', 'test-only'); actors[name] = access.identity(id)!;
  }
  store.grant('seat', 'a', 'intel', 'manage'); store.grant('seat', 'b', 'intel', 'view');
  const rule = store.createRule(actors.a.userId, randomUUID(), {name: '接入', sourceId: 'intel', profileId: profile.id, recipientSeatIds: ['a', 'b', 'c'], enabled: true});
  const scopeDenied = new Set<string>();
  const links = new TaskLinkService(access, store, {
    canRead: (actor, _event, job) => !scopeDenied.has(`${actor.seatId}:${job.id}`) && (!!store.effectivePermission(actor, job.sourceId)
      || store.listDeliveries(job.id).some(delivery => delivery.recipientSeatId === actor.seatId && delivery.status === 'delivered')),
    sourceName: id => `来源 ${id}`,
    readContent: async (_actor, event, job) => ({text: `original:${event.id}`, resultText: `result:${job.id}`, resultFiles: [], queryMessages: []}),
  });
  const task = (name = '任务', visibility: 'public' | 'private' = 'public', actor = actors.a) => access.create(actor, {title: name, goal: '处理工作', visibility, clientActionId: randomUUID()});
  function queued(event?: BackgroundEvent, sourceId = 'intel') {
    const first = !event;
    const sourceRule = sourceId === 'intel' ? rule : store.listRules().find(item => item.sourceId === sourceId) || store.createRule(actors.a.userId, randomUUID(), {name: rule.name, sourceId, profileId: rule.profileId, recipientSeatIds: rule.recipientSeatIds, enabled: true});
    event ??= {id: randomUUID(), sourceId, sourceMessageId: randomUUID(), title: '信息', receivedAt: new Date().toISOString(), payloadHash: backgroundHash('input'), files: [], revision: 1, ruleSnapshot: {rule: sourceRule, profile}};
    const job: BackgroundJob = {id: randomUUID(), eventId: event.id, sourceId: event.sourceId, kind: 'preprocess', status: 'queued', revision: 1, requestId: randomUUID(), createdAt: new Date().toISOString(), ruleSnapshot: {rule: event.ruleSnapshot?.rule || sourceRule, profile}};
    if (first) store.acceptEvent(event, {initialJob: job, capacity: 100, expectedRule: sourceRule}); else store.enqueueJob(job, 100);
    return {event, job};
  }
  function running(event?: BackgroundEvent, sourceId?: string) { const record = queued(event, sourceId); return {...record, job: store.claimJob(record.job.id, {sessionId: randomUUID()})}; }
  const record = (job: BackgroundJob, input: TaskAssessmentInput, tasks: TaskSpace[] = []) => links.recordAssessment(job.id, input, {queried: true, tasks: new Map(tasks.map(task => [task.id, task.revision]))}, randomUUID());
  const finish = (job: BackgroundJob, status: 'succeeded' | 'failed' | 'interrupted' = 'succeeded') => {
    const current = store.getJob(job.id);
    return store.finishJob(job.id, current.revision, {status, ...(status === 'succeeded' ? {result: {sessionId: current.sessionId!, requestId: current.requestId, files: []}} : {error: {code: 'TEST_FAILURE', message: '测试中断'}})});
  };
  return {dir, db, access, store, links, task, queued, running, record, finish, scopeDenied, ...actors};
}
const relations = (...tasks: TaskSpace[]): TaskAssessmentInput => ({relations: tasks.map(task => ({taskId: task.id, reason: `与 ${task.title} 相关`}))});

describe('task assessment storage and effective relationships', () => {
  it('records one complete multi-task assessment, validates observed versions and never publishes unfinished results', async () => {
    const s = await setup(), a = s.task('补给'), b = s.task('转移'), foreign = s.task('个人', 'private');
    const {event, job} = s.running();
    const saved = s.record(job, relations(a, b), [a, b]);
    expect(saved.status).toBe('recorded'); expect(saved.published).toBe(false);
    expect(s.links.list(s.a, a.id).total).toBe(0);
    const revision = s.store.getJob(job.id).revision;
    expect(s.record(job, relations(a, b), [a, b]).status).toBe('unchanged');
    expect(s.store.getJob(job.id).revision).toBe(revision);
    expect(() => s.record(job, relations(a, foreign), [a, foreign])).toThrow(expect.objectContaining({code: 'TASK_NOT_FOUND'}));
    expect(() => s.record(job, relations(a, b), [a])).toThrow(expect.objectContaining({code: 'TASK_NOT_QUERIED'}));
    s.access.update(s.a, b.id, b.revision, {title: '新转移说明'});
    expect(() => s.record(job, relations(a, b), [a, b])).toThrow(expect.objectContaining({code: 'INFORMATION_LINK_CONFLICT'}));
    expect(s.store.getJob(job.id).taskAssessment).toEqual(saved.assessment);
    s.finish(job);
    expect(s.links.list(s.a, a.id).items).toMatchObject([{eventId: event.id, jobId: job.id, mode: 'auto'}]);
    expect(s.links.list(s.a, b.id).items[0].taskChanged).toBe(true);
    expect(s.store.listEvents()).toHaveLength(1);
    expect(() => s.record(job, relations(a), [a])).toThrow(expect.objectContaining({code: 'TASK_ASSESSMENT_UNAVAILABLE'}));
  });

  it('lists all authorized associated sources before pagination and filters, without leaking other sources', async () => {
    const s = await setup(), task = s.task();
    s.store.grant('seat', 'a', 'situation', 'view');
    s.store.grant('seat', 'a', 'restricted', 'view');
    s.store.grant('seat', 'a', 'unrelated', 'view');
    const situation = s.running(undefined, 'situation'); s.record(situation.job, relations(task), [task]); s.finish(situation.job);
    const older = {...s.store.getEvent(situation.event.id), receivedAt: '2020-01-01T00:00:00.000Z'};
    s.db.prepare('UPDATE background_events SET received_at=?,data=? WHERE id=?').run(older.receivedAt, JSON.stringify(older), older.id);
    for (let index = 0; index < 26; index++) { const item = s.running(); s.record(item.job, relations(task), [task]); s.finish(item.job); }
    const hidden = s.running(undefined, 'restricted'); s.record(hidden.job, relations(task), [task]); s.finish(hidden.job); s.scopeDenied.add(`a:${hidden.job.id}`);
    const unrelated = s.running(undefined, 'unrelated'); s.record(unrelated.job, {relations: [], emptyReason: '无关信息'}); s.finish(unrelated.job);
    const expected = [{id: 'intel', name: '来源 intel'}, {id: 'situation', name: '来源 situation'}];
    const first = s.links.list(s.a, task.id, {limit: 25});
    expect(first.items).toHaveLength(25); expect(first.items.every(item => item.sourceId === 'intel')).toBe(true);
    expect(first.total).toBe(27); expect(first.sources.sort((a,b)=>a.id.localeCompare(b.id))).toEqual(expected);
    const filtered = s.links.list(s.a, task.id, {sourceId: 'situation', query: 'no-match'});
    expect(filtered.total).toBe(0); expect(filtered.sources.sort((a,b)=>a.id.localeCompare(b.id))).toEqual(expected);
    expect(s.links.list(s.a, task.id, {offset: 25}).sources.sort((a,b)=>a.id.localeCompare(b.id))).toEqual(expected);
    expect(s.links.list(s.b, task.id).sources).toEqual([{id: 'intel', name: '来源 intel'}]);
    expect(s.links.list(s.c, task.id).sources).toEqual([]);
  });

  it('keeps new suggestions, no-association and missing judgment distinct without auto-creating anything', async () => {
    const s = await setup(), task = s.task();
    const first = s.running();
    expect(() => s.links.recordAssessment(first.job.id, {relations: [], newTaskSuggestion: draft}, {queried: false, tasks: new Map()}, 'call')).toThrow(expect.objectContaining({code: 'TASK_NOT_QUERIED'}));
    for (const input of [{relations: []}, {...relations(task), newTaskSuggestion: draft}, {relations: [], newTaskSuggestion: draft, emptyReason: '无任务'}, {relations: [], emptyReason: ''}]) {
      expect(() => s.record(first.job, input, [task])).toThrow(expect.objectContaining({code: 'INVALID_INPUT'}));
    }
    s.record(first.job, {relations: [], newTaskSuggestion: draft}); s.finish(first.job);
    expect(s.links.links(s.a, first.event.id, first.job.id)).toMatchObject({assessment: {newTaskSuggestion: draft}, canCreateTask: true});
    const second = s.running(); s.record(second.job, {relations: [], emptyReason: '仅供参考，不需要独立办理'}); s.finish(second.job);
    expect(s.links.links(s.a, second.event.id, second.job.id)).toMatchObject({assessment: {emptyReason: '仅供参考，不需要独立办理'}, canCreateTask: false});
    const third = s.running(); s.finish(third.job);
    expect(s.links.links(s.a, third.event.id, third.job.id).assessment).toBeUndefined();
    expect(s.access.list(s.a.seatId)).toHaveLength(1);
  });

  it('chooses the latest inserted readable whole batch, ignoring completion order, failure and missing judgment', async () => {
    const s = await setup(), a = s.task('一'), b = s.task('二');
    const old = s.running(); s.record(old.job, relations(a, b), [a, b]);
    const newer = s.running(old.event); s.record(newer.job, relations(b), [b]); s.finish(newer.job); s.finish(old.job);
    expect(s.links.list(s.a, a.id).items).toEqual([]);
    expect(s.links.list(s.a, b.id).items[0].jobId).toBe(newer.job.id);
    const failed = s.running(old.event); s.record(failed.job, relations(a), [a]); s.finish(failed.job, 'failed');
    const interrupted = s.running(old.event); s.record(interrupted.job, relations(a), [a]); s.finish(interrupted.job, 'interrupted');
    const missing = s.running(old.event); s.finish(missing.job);
    expect(s.links.list(s.a, b.id).items[0].jobId).toBe(newer.job.id);
    s.scopeDenied.add(`b:${newer.job.id}`);
    expect(s.links.list(s.b, a.id).items[0].jobId).toBe(old.job.id);
    const empty = s.running(old.event); s.record(empty.job, {relations: [], emptyReason: '任务条件已改变，不再相关'}); s.finish(empty.job);
    expect(s.links.list(s.a, b.id).items).toEqual([]);
    expect(s.links.links(s.a, old.event.id, old.job.id).assessment?.items).toHaveLength(2);
  });

  it('exposes editable decision versions after reset without inventing an effective association', async () => {
    const s = await setup(), task = s.task(), personal = s.task('个人', 'private');
    const {event, job} = s.running(); s.record(job, {relations: [], emptyReason: '暂不归口'}); s.finish(job);
    const included = s.links.update(s.a, event.id, task.id, {mode: 'include', revision: 0, jobId: job.id, reason: '人工补充'});
    const reset = s.links.update(s.a, event.id, task.id, {mode: 'auto', revision: included.revision, jobId: job.id});
    s.links.update(s.a, event.id, personal.id, {mode: 'include', revision: 0, jobId: job.id, reason: '私有办理'});
    const latest = s.links.links(s.a, event.id, job.id);
    expect(latest.links.some(item => item.task.id === task.id)).toBe(false);
    expect(latest.revisions?.[task.id]).toBe(reset.revision);
    expect(s.links.list(s.a, task.id).total).toBe(0);
    expect(s.links.links(s.b, event.id, job.id).revisions?.[personal.id]).toBeUndefined();
    const delivery = s.store.listDeliveries(job.id).find(item => item.recipientSeatId === s.c.seatId)!;
    s.store.updateDelivery(delivery.id, delivery.revision, 'delivered');
    expect(s.links.links(s.c, event.id, job.id).revisions).toEqual({});
    s.links.update(s.a, event.id, task.id, {mode: 'include', revision: latest.revisions![task.id], jobId: job.id, reason: '再次补充'});
    expect(s.links.list(s.a, task.id).items[0].reason).toBe('再次补充');
  });

  it('retains pinned manual versions and exclusions across analysis, with per-pair CAS and reset', async () => {
    const s = await setup(), a = s.task('一'), b = s.task('二');
    const first = s.running(); s.record(first.job, relations(a, b), [a, b]); s.finish(first.job);
    const pin = s.links.update(s.a, first.event.id, a.id, {mode: 'include', revision: 0, jobId: first.job.id, reason: '人工核实保留'});
    const exclude = s.links.update(s.a, first.event.id, b.id, {mode: 'exclude', revision: 0, jobId: first.job.id});
    expect(s.links.update(s.a, first.event.id, a.id, {mode: 'include', revision: 0, jobId: first.job.id, reason: '人工核实保留'})).toEqual(pin);
    expect(() => s.links.update(s.b, first.event.id, a.id, {mode: 'exclude', revision: 0, jobId: first.job.id})).toThrow(expect.objectContaining({code: 'INFORMATION_LINK_CONFLICT'}));
    const second = s.running(first.event); s.record(second.job, relations(a, b), [a, b]); s.finish(second.job);
    expect(s.links.list(s.a, a.id).items[0]).toMatchObject({jobId: first.job.id, reason: '人工核实保留', mode: 'include'});
    expect(s.links.list(s.a, b.id).items).toEqual([]);
    s.links.update(s.b, first.event.id, b.id, {mode: 'auto', revision: exclude.revision, jobId: second.job.id});
    expect(s.links.list(s.a, b.id).items[0]).toMatchObject({jobId: second.job.id, mode: 'auto'});
    expect(() => s.links.resolve(s.a, b.id, first.event.id, first.job.id)).toThrow(expect.objectContaining({code: 'INFORMATION_LINK_CONFLICT'}));
    s.links.update(s.a, first.event.id, a.id, {mode: 'exclude', revision: pin.revision, jobId: second.job.id});
    expect(s.links.links(s.b, first.event.id, second.job.id).links.find(link => link.task.id === a.id)?.mode).toBe('exclude');
  });

  it('requires live read and task permissions before list counts, search, correction and details', async () => {
    const s = await setup(), task = s.task(), privateTask = s.task('私有', 'private');
    const {event, job} = s.running(); s.record(job, relations(task), [task]); s.finish(job);
    expect(s.links.list(s.c, task.id).total).toBe(0);
    expect(s.links.list(s.c, task.id, {query: '信息'}).total).toBe(0);
    expect(() => s.links.links(s.c, event.id, job.id)).toThrow(expect.objectContaining({statusCode: 404}));
    const delivery = s.store.listDeliveries(job.id).find(delivery => delivery.recipientSeatId === s.c.seatId)!;
    s.store.updateDelivery(delivery.id, delivery.revision, 'delivered');
    expect(s.links.list(s.c, task.id).total).toBe(1);
    expect(() => s.links.update(s.c, event.id, task.id, {mode: 'include', revision: 0, jobId: job.id, reason: '保留'})).toThrow(expect.objectContaining({code: 'FORBIDDEN'}));
    s.links.update(s.a, event.id, privateTask.id, {mode: 'include', revision: 0, jobId: job.id, reason: '私有办理'});
    expect(s.links.links(s.b, event.id, job.id).links.some(link => link.task.id === privateTask.id)).toBe(false);
    expect(() => s.links.list(s.b, privateTask.id)).toThrow(expect.objectContaining({code: 'TASK_NOT_FOUND'}));
    s.scopeDenied.add(`c:${job.id}`);
    expect(s.links.list(s.c, task.id).total).toBe(0);
    s.db.prepare('UPDATE accounts SET enabled=0 WHERE id=?').run(s.b.userId);
    expect(() => s.links.list(s.b, task.id)).toThrow(expect.objectContaining({statusCode: 404}));
    s.db.prepare('UPDATE seats SET create_public=0 WHERE id=?').run(s.a.seatId);
    expect(() => s.links.update(s.a, event.id, task.id, {mode: 'include', revision: 0, jobId: job.id, reason: '保留'})).toThrow(expect.objectContaining({code: 'FORBIDDEN'}));
  });

  it('atomically creates one public task from one suggestion, pins analysis, and reuses the receipt across people', async () => {
    const s = await setup(), {event, job} = s.running(); s.record(job, {relations: [], newTaskSuggestion: draft}); s.finish(job);
    const input = {...draft, jobId: job.id, clientActionId: randomUUID()};
    const created = s.links.createFromSuggestion(s.a, event.id, input);
    expect(created.task.visibility).toBe('public'); expect(created.link).toMatchObject({jobId: job.id, mode: 'include'});
    expect(s.links.createFromSuggestion(s.a, event.id, input)).toEqual(created);
    expect(() => s.links.createFromSuggestion(s.a, event.id, {...input, title: '不同内容'})).toThrow(expect.objectContaining({code: 'TASK_CONFLICT'}));
    const other = s.links.createFromSuggestion(s.b, event.id, {...input, clientActionId: randomUUID(), title: '另一名称'});
    expect(other.task.id).toBe(created.task.id); expect(s.access.list(s.a.seatId)).toHaveLength(1);
    expect(s.links.links(s.a, event.id, job.id)).toMatchObject({creation: created.creation, canCreateTask: false});
    expect(s.links.list(s.b, created.task.id).items[0]).toMatchObject({jobId: job.id, mode: 'include'});
    s.access.update(s.a, created.task.id, created.task.revision, {state: 'archived'});
    expect(s.links.createFromSuggestion(s.a, event.id, input).task.state).toBe('archived');
    expect(() => s.links.resolve(s.a, created.task.id, event.id, job.id, true)).toThrow(expect.objectContaining({code: 'TASK_ARCHIVED'}));
    expect(() => new BackgroundStore(s.db)).not.toThrow();
    expect((await readdir(s.dir)).sort()).toEqual(['collaboration']);
  });

  it('rolls back task and task_actions if the association commit fails, then allows the same action to retry', async () => {
    const s = await setup(), {event, job} = s.running(); s.record(job, {relations: [], newTaskSuggestion: draft}); s.finish(job);
    const input = {...draft, jobId: job.id, clientActionId: randomUUID()};
    s.db.exec("CREATE TRIGGER reject_test_link BEFORE INSERT ON information_task_overrides BEGIN SELECT RAISE(ABORT,'test interrupted commit'); END;");
    expect(() => s.links.createFromSuggestion(s.a, event.id, input)).toThrow('test interrupted commit');
    expect(s.access.list(s.a.seatId)).toEqual([]); expect(s.access.findCreation(s.a, input.clientActionId)).toEqual([]);
    expect(s.store.getJob(job.id).taskSuggestionCreation).toBeUndefined();
    s.db.exec('DROP TRIGGER reject_test_link');
    expect(s.links.createFromSuggestion(s.a, event.id, input).task.title).toBe(draft.title);
  });

  it('does not create from failed/no-suggestion jobs or grant public-create permission through source access', async () => {
    const s = await setup(), {event, job} = s.running(); s.record(job, {relations: [], newTaskSuggestion: draft});
    const input = {...draft, jobId: job.id, clientActionId: randomUUID()};
    expect(() => s.links.createFromSuggestion(s.a, event.id, input)).toThrow(expect.objectContaining({statusCode: 404}));
    s.finish(job, 'failed'); expect(() => s.links.createFromSuggestion(s.a, event.id, input)).toThrow(expect.objectContaining({statusCode: 404}));
    const other = s.running(event); s.finish(other.job);
    expect(() => s.links.createFromSuggestion(s.a, event.id, {...input, jobId: other.job.id})).toThrow(expect.objectContaining({code: 'INFORMATION_LINK_CONFLICT'}));
    const suggested = s.running(event); s.record(suggested.job, {relations: [], newTaskSuggestion: draft}); s.finish(suggested.job);
    s.store.grant('seat', 'c', 'intel', 'manage');
    expect(() => s.links.createFromSuggestion(s.c, event.id, {...input, jobId: suggested.job.id})).toThrow(expect.objectContaining({code: 'FORBIDDEN'}));
    expect(s.access.list(s.a.seatId)).toEqual([]);
  });

  it('rechecks the exact relationship after asynchronous content reads and strips service configuration', async () => {
    const s = await setup(), task = s.task(), {event, job} = s.running(); s.record(job, relations(task), [task]); s.finish(job);
    const detail = await s.links.detail(s.a, task.id, event.id, job.id);
    expect(detail.text).toBe(`original:${event.id}`); expect(detail.resultText).toBe(`result:${job.id}`);
    expect(JSON.stringify(detail)).not.toContain('PRIVATE SERVICE INSTRUCTIONS');
    const pending = s.links.detail(s.a, task.id, event.id, job.id);
    s.links.update(s.a, event.id, task.id, {mode: 'exclude', revision: 0, jobId: job.id});
    await expect(pending).rejects.toMatchObject({code: 'INFORMATION_LINK_CONFLICT'});
    expect((await readdir(s.dir)).sort()).toEqual(['collaboration']);
  });

  it('migrates v3 additively and validates persisted judgments, overrides, indexes and creation receipts', async () => {
    const s = await setup(), task = s.task(), {event, job} = s.running(); s.finish(job);
    s.db.exec('DROP TABLE information_task_overrides; PRAGMA user_version=3;');
    new BackgroundStore(s.db);
    expect(s.db.prepare('PRAGMA user_version').get()?.user_version).toBe(4);
    expect(s.access.get(task.id, s.a.seatId).title).toBe(task.title); expect(s.store.getEvent(event.id).id).toBe(event.id);
    s.links.update(s.a, event.id, task.id, {mode: 'include', revision: 0, jobId: job.id, reason: '旧消息人工收录'});
    expect(() => new BackgroundStore(s.db)).not.toThrow();
    s.db.exec("UPDATE information_task_overrides SET data=json_set(data,'$.jobId','invalid');");
    expect(() => new BackgroundStore(s.db)).toThrow(expect.objectContaining({code: 'RESOURCE_STATE_INVALID'}));
  });

  it('cancellation and aborted signals prevent new records and restart never publishes a running assessment', async () => {
    const s = await setup(), task = s.task(), {event, job} = s.running(); s.record(job, relations(task), [task]);
    const controller = new AbortController(); controller.abort();
    expect(() => s.links.recordAssessment(job.id, relations(task), {queried: true, tasks: new Map([[task.id, 1]])}, 'call', controller.signal)).toThrow();
    s.store.recoverRunning();
    expect(s.links.list(s.a, task.id).total).toBe(0); expect(() => s.links.links(s.a, event.id, job.id)).toThrow();
    const second = s.running(event); s.store.requestCancel(second.job.id, second.job.revision);
    expect(() => s.record(second.job, relations(task), [task])).toThrow(expect.objectContaining({code: 'TASK_ASSESSMENT_UNAVAILABLE'}));
  });

  it('rejects corrupt new judgment shapes and missing v4 indexes instead of silently repairing persisted state', async () => {
    const s = await setup(), task = s.task(), {job} = s.running(); s.record(job, relations(task), [task]); s.finish(job);
    const original = s.store.getJob(job.id);
    s.db.prepare('UPDATE background_jobs SET data=? WHERE id=?').run(JSON.stringify({...original, taskAssessment: {...original.taskAssessment, emptyReason: '互斥字段'}}), job.id);
    expect(() => new BackgroundStore(s.db)).toThrow(expect.objectContaining({code: 'RESOURCE_STATE_INVALID'}));
    s.db.prepare('UPDATE background_jobs SET data=? WHERE id=?').run(JSON.stringify(original), job.id);
    expect(() => new BackgroundStore(s.db)).not.toThrow();
    s.db.exec('DROP INDEX information_task_overrides_task');
    expect(() => new BackgroundStore(s.db)).toThrow(expect.objectContaining({code: 'RESOURCE_STATE_INVALID'}));
  });
});
