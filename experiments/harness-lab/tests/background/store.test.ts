import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/access/database.js';
import { AccessStore } from '../../src/access/store.js';
import { BackgroundStore, backgroundHash } from '../../src/background/store.js';
import type { BackgroundEvent, BackgroundJob, BackgroundProfileSnapshot, BackgroundRuleSnapshot, InformationRuleInput } from '../../src/contracts/background.js';

const disposers: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose(); });
const profile: BackgroundProfileSnapshot = {id: 'material', name: '资料预处理', goal: '生成材料要点', tools: ['read', 'write'], skillIds: [], agentIds: [], instructions: '', resources: []};
const ruleInput = (sourceId = 'special', enabled = true): InformationRuleInput => ({name: '资料接收', sourceId, profileId: profile.id, recipientSeatIds: ['a', 'b'], enabled});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'axon-background-store-')); let db = await openDatabase(dir);
  disposers.push(async () => { db.close(); await rm(dir, {recursive: true, force: true}); });
  new AccessStore(db);
  const store = new BackgroundStore(db);
  return {dir, db, store, reopen: async () => { db.close(); db = await openDatabase(dir); new AccessStore(db); return new BackgroundStore(db); }};
}
function event(sourceMessageId: string = randomUUID(), sourceId = 'special'): BackgroundEvent {
  return {id: randomUUID(), sourceId, sourceMessageId, title: '新的材料', payloadHash: backgroundHash({text: 'payload'}), receivedAt: new Date().toISOString(), files: [], revision: 1};
}
function job(e: BackgroundEvent, snapshot?: BackgroundRuleSnapshot): BackgroundJob {
  return {id: randomUUID(), eventId: e.id, sourceId: e.sourceId, kind: 'preprocess', status: 'queued', revision: 1, requestId: randomUUID(), createdAt: new Date().toISOString(), ruleSnapshot: snapshot};
}
function accept(store: BackgroundStore) {
  const rule = store.createRule('operator', randomUUID(), ruleInput()); const snapshot = {rule, profile};
  const e = {...event(), ruleSnapshot: snapshot}; const j = job(e, snapshot);
  return {e: store.acceptEvent(e, {initialJob: j, capacity: 100, expectedRule: rule}), j, rule, snapshot};
}
function success(store: BackgroundStore, queued: BackgroundJob) {
  const running = store.claimJob(queued.id, {sessionId: randomUUID(), model: 'test'});
  return store.finishJob(running.id, running.revision, {status: 'succeeded', result: {sessionId: running.sessionId!, requestId: running.requestId, finalMessageId: 'native-message', files: []}});
}

describe('durable background metadata', () => {
  it('upgrades v2 additively, reopens v3, and rejects missing registered tables', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'axon-v3-migration-')); let db: DatabaseSync | undefined = await openDatabase(dir);
    disposers.push(async () => { db?.close(); await rm(dir, {recursive: true, force: true}); });
    new AccessStore(db); db.prepare('INSERT INTO works VALUES(?,?)').run('existing', '{"existing":true}');
    db.prepare('INSERT INTO seats VALUES(?,?,?,?)').run('a', '席位 A', 1, 1);
    new BackgroundStore(db); expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(3);
    expect(db.prepare('SELECT data FROM works WHERE id=?').get('existing')?.data).toBe('{"existing":true}');
    db.close(); db = await openDatabase(dir); const access = new AccessStore(db); new BackgroundStore(db);
    expect(access.allSeatIds()).toEqual(['a']);
    db.exec('DROP TABLE background_controls'); expect(() => new BackgroundStore(db!)).toThrow();
  });

  it.each([
    ['status', "UPDATE background_jobs SET data=json_set(data,'$.status','succeeded') WHERE id=?"],
    ['source', "UPDATE background_jobs SET data=json_set(data,'$.sourceId','other') WHERE id=?"],
    ['session', "UPDATE background_jobs SET data=json_set(data,'$.sessionId','00000000-0000-4000-8000-000000000001') WHERE id=?"],
  ])('rejects divergent persisted %s before it can change queue or permission semantics', async (_field, sql) => {
    const {store,db} = await setup(); const {j} = accept(store);
    db.prepare(sql).run(j.id);
    expect(() => store.getJob(j.id)).toThrow();
    expect(() => store.queuedJobs()).toThrow();
    expect(() => new BackgroundStore(db)).toThrow();
    expect(db.prepare('SELECT status FROM background_jobs WHERE id=?').get(j.id)?.status).toBe('queued');
  });

  it('rejects lost reservation indexes and cross-source delivery ownership on startup', async () => {
    const {store,db} = await setup(); const {j} = accept(store); success(store,j);
    const delivery = store.listDeliveries()[0];
    db.prepare("UPDATE background_deliveries SET source_id='other',data=json_set(data,'$.sourceId','other') WHERE id=?").run(delivery.id);
    expect(() => new BackgroundStore(db)).toThrow();
    db.prepare("UPDATE background_deliveries SET source_id='special',data=json_set(data,'$.sourceId','special') WHERE id=?").run(delivery.id);
    new BackgroundStore(db);
    db.exec('DROP INDEX background_jobs_reserved_session');
    expect(() => new BackgroundStore(db)).toThrow();
  });

  it('deduplicates source keys before capacity/rule checks and rejects changed semantic input', async () => {
    const {store} = await setup(); const e = event('1001');
    store.acceptEvent(e, {capacity: 1}); expect(store.backlogSize()).toBe(1);
    store.createRule('operator', randomUUID(), ruleInput());
    expect(store.acceptEvent({...e, id: randomUUID()}, {capacity: 1}).id).toBe(e.id);
    expect(() => store.acceptEvent({...e, payloadHash: backgroundHash('changed')}, {capacity: 1})).toThrow('不同内容');
    expect(() => store.acceptEvent(event('1002'), {capacity: 1})).toThrow('容量');
    const other = event('1001', 'other'); store.acceptEvent(other, {capacity: 2});
    expect(store.listEvents()).toHaveLength(2);
    expect(store.findEvent('special', '1001')?.id).toBe(e.id);
    expect(store.findEvent('other', '1001')?.id).toBe(other.id);
  });

  it('freezes rules, detects rule changes during preparation, and atomically registers only one initial job', async () => {
    const {store} = await setup(); const {e, j, rule} = accept(store);
    expect(store.acceptEvent({...e, id: randomUUID()}, {initialJob: {...j, id: randomUUID()}, capacity: 1, expectedRule: rule}).initialJobId).toBe(j.id);
    expect(store.listJobs()).toHaveLength(1); expect(store.backlogSize()).toBe(1);
    store.updateRule('operator', rule.id, rule.revision, {...rule, recipientSeatIds: ['a']});
    const newEvent = event();
    expect(() => store.acceptEvent(newEvent, {capacity: 100, expectedRule: rule})).toThrow('规则已变化');
    expect(store.findEvent(newEvent.sourceId, newEvent.sourceMessageId)).toBeUndefined();
    expect(store.getJob(j.id).ruleSnapshot?.rule.recipientSeatIds).toEqual(['a', 'b']);
    expect(store.pageEvents({sourceIds: []}).items).toEqual([]);
    expect(store.pageEvents({search: '材料'}).total).toBe(1);
  });

  it('leaves unmatched messages inert until explicit processing; repeated completion never adds an initial run', async () => {
    const {store} = await setup(); const e = event(); store.acceptEvent(e, {capacity: 1});
    const rule = store.createRule('operator', randomUUID(), ruleInput()); const snapshot = {rule, profile};
    expect(store.listJobs()).toEqual([]);
    const initial = job(e, snapshot); store.processEvent(e.id, initial, snapshot);
    expect(store.backlogSize()).toBe(1);
    expect(store.processEvent(e.id, job(e, snapshot), snapshot).id).toBe(initial.id);
    expect(store.listJobs()).toHaveLength(1); expect(store.getEvent(e.id).revision).toBe(2);
  });

  it('commits success and per-seat delivery together, rolling back all effects on transaction failure', async () => {
    const {store, db} = await setup(); const {j} = accept(store);
    const running = store.claimJob(j.id, {sessionId: randomUUID()});
    db.exec("CREATE TRIGGER fail_second_delivery BEFORE INSERT ON background_deliveries WHEN NEW.seat_id='b' BEGIN SELECT RAISE(ABORT, 'injected crash'); END;");
    const result = {sessionId: running.sessionId!, requestId: running.requestId, files: []};
    expect(() => store.finishJob(j.id, running.revision, {status: 'succeeded', result})).toThrow('injected crash');
    expect(store.getJob(j.id).status).toBe('running'); expect(store.listDeliveries()).toHaveLength(0);
    db.exec('DROP TRIGGER fail_second_delivery'); store.finishJob(j.id, running.revision, {status: 'succeeded', result});
    expect(store.listDeliveries().map(item => item.recipientSeatId).sort()).toEqual(['a', 'b']);
    expect(() => store.finishJob(j.id, running.revision, {status: 'succeeded', result})).toThrow('记录已变化');
    expect(store.listDeliveries()).toHaveLength(2);
    expect(store.listJobs()).toHaveLength(1);
  });

  it('retries only failed delivery and keeps already delivered receipts immutable across restart', async () => {
    const context = await setup(); const {j} = accept(context.store); success(context.store, j);
    const [a, b] = context.store.listDeliveries();
    const delivered = context.store.updateDelivery(a.id, a.revision, 'delivered');
    const failed = context.store.updateDelivery(b.id, b.revision, 'failed', {code: 'SEAT_DISABLED', message: '席位已停用'});
    const store = await context.reopen();
    expect(store.updateDelivery(delivered.id, 0, 'pending')).toEqual(delivered);
    const pending = store.updateDelivery(failed.id, failed.revision, 'pending');
    store.updateDelivery(pending.id, pending.revision, 'delivered');
    expect(store.pageDeliveries({status: 'delivered'}).total).toBe(2); expect(store.listJobs()).toHaveLength(1);
  });

  it('serializes cancel vs finish and recovers interrupted work without replaying queued or completed jobs', async () => {
    const context = await setup(); const {store} = context; const {e, j, snapshot} = accept(store);
    const running = store.claimJob(j.id, {sessionId: randomUUID()});
    const cancelled = store.requestCancel(j.id, running.revision);
    expect(() => store.finishJob(j.id, running.revision, {status: 'succeeded'})).toThrow();
    expect(store.finishJob(j.id, cancelled.revision, {status: 'succeeded'}).status).toBe('cancelled');
    expect(store.listDeliveries()).toEqual([]);
    const interrupted = job(e, snapshot); store.enqueueJob(interrupted, 100); store.claimJob(interrupted.id, {sessionId: randomUUID()});
    const cancelling = job(e, snapshot); store.enqueueJob(cancelling, 100); const r = store.claimJob(cancelling.id, {sessionId: randomUUID()}); store.requestCancel(r.id, r.revision);
    const queued = job(e, snapshot); store.enqueueJob(queued, 100);
    const reopened = await context.reopen(); const recovered = reopened.recoverRunning();
    expect(recovered.map(item => item.status).sort()).toEqual(['cancelled', 'interrupted']);
    expect(reopened.getJob(queued.id).status).toBe('queued'); expect(reopened.recoverRunning()).toEqual([]);
    expect(reopened.getJob(interrupted.id).error?.code).toBe('SERVICE_RESTARTED');
  });

  it('reserves prepared imports and queued sessions durably, preserving receipts through a capacity rejection', async () => {
    const context = await setup(); const {store} = context; const {e} = accept(store);
    const input = {id: randomUUID(), userId: 'user', seatId: 'a', clientActionId: randomUUID(), kind: 'analysis' as const, inputHash: 'fixed', eventId: e.id, taskSpaceId: randomUUID(), workspaceId: randomUUID(), sessionId: randomUUID(), requestId: randomUUID()};
    const action = store.beginAction(input); expect(store.hasTaskReservations(input.taskSpaceId)).toBe(true);
    expect(store.beginAction(input)).toEqual(action);
    expect(() => store.beginAction({...input, inputHash: 'changed'})).toThrow('不同参数');
    const updated = store.updateAction(action.id, action.revision, {imports: [{fileId: 'f1', path: '材料.txt', completed: true}], draft: '分析材料'});
    const analysis: BackgroundJob = {...job(e), kind: 'seat_analysis', userId: input.userId, seatId: input.seatId, taskSpaceId: input.taskSpaceId, workspaceId: input.workspaceId, sessionId: input.sessionId, requestId: input.requestId, actionId: action.id};
    expect(() => store.enqueueAnalysis(action.id, updated.revision, analysis, 1)).toThrow('容量');
    expect(store.getAction(action.id).imports?.[0].completed).toBe(true);
    store.enqueueAnalysis(action.id, updated.revision, analysis, 100);
    const reopened = await context.reopen(); expect(reopened.sessionReservation(input.sessionId)?.id).toBe(analysis.id);
    expect(reopened.hasTaskReservations(input.taskSpaceId)).toBe(true);
    expect(reopened.enqueueAnalysis(action.id, 0, {...analysis, id: randomUUID()}, 1).jobId).toBe(analysis.id);
    reopened.requestCancel(analysis.id, analysis.revision);
    expect(reopened.sessionReservation(input.sessionId)).toBeUndefined(); expect(reopened.hasTaskReservations(input.taskSpaceId)).toBe(false);
  });

  it('checks rule revisions, one active rule per source, durable controls and creation dedup', async () => {
    const context = await setup(); const {store} = context; const actionId = randomUUID();
    const rule = store.createRule('operator', actionId, ruleInput());
    expect(store.createRule('operator', actionId, ruleInput()).id).toBe(rule.id);
    expect(() => store.createRule('operator', actionId, {...ruleInput(), name: 'changed'})).toThrow();
    expect(() => store.createRule('operator', randomUUID(), ruleInput())).toThrow('启用规则');
    const disabled = store.updateRule('operator', rule.id, rule.revision, {...rule, enabled: false});
    expect(() => store.updateRule('operator', rule.id, rule.revision, ruleInput())).toThrow();
    expect(disabled.revision).toBe(2); expect(store.enabledRule('special')).toBeUndefined();
    expect(store.getControl('queue', false).enabled).toBe(false);
    const control = store.setControl('queue', 0, true, 'operator');
    expect(() => store.setControl('queue', 0, false)).toThrow();
    const reopened = await context.reopen(); expect(reopened.getControl('queue')).toEqual(control);
    expect(reopened.getRule(rule.id).enabled).toBe(false);
  });

  it('counts and pages merged job states in one stable order under the same source and public search filters', async () => {
    const {store} = await setup(); const {e,j,snapshot} = accept(store);
    const failed: BackgroundJob[] = [];
    for (const status of ['failed','cancelled','interrupted','failed','cancelled'] as const) {
      const next = {...job(e,snapshot),createdAt:j.createdAt}; store.enqueueJob(next,100);
      failed.push(store.finishJob(next.id,next.revision,{status,error:{code:'TEST',message:'PRIVATE_ERROR'}}));
    }
    const foreign = {...event('foreign-message','other'),title:'OTHER_SOURCE'};
    store.acceptEvent(foreign,{capacity:100});
    const foreignJob = job(foreign); store.enqueueJob(foreignJob,100); store.finishJob(foreignJob.id,1,{status:'failed'});
    const filter = {sourceIds:['special'],statuses:['failed','cancelled','interrupted'] as const,search:e.title,limit:2};
    const pages = [0,2,4].map(offset => store.pageJobs({...filter,statuses:[...filter.statuses],offset}));
    expect(pages.map(page => page.total)).toEqual([5,5,5]);
    expect(pages.flatMap(page => page.items.map(item => item.id))).toEqual(failed.toReversed().map(item => item.id));
    expect(store.pageJobs({sourceIds:['special'],status:'queued'}).items.map(item => item.id)).toEqual([j.id]);
    expect(store.pageJobs({sourceIds:['special'],search:e.sourceMessageId}).total).toBe(6);
    expect(store.pageJobs({sourceIds:['special'],search:failed[0].id}).total).toBe(1);
    expect(store.pageJobs({sourceIds:['special'],search:'PRIVATE_ERROR'}).total).toBe(0);
    expect(store.pageJobs({sourceIds:[],statuses:['failed']}).total).toBe(0);
    expect(store.pageJobs({sourceIds:['special'],sourceId:'other'}).total).toBe(0);
    expect(() => store.pageJobs({limit:201})).toThrow('分页参数');
  });

  it('queries deliveries for the exact successful job after a later retry fails', async () => {
    const {store} = await setup(); const {e,j,snapshot} = accept(store); success(store,j);
    const retry = {...job(e,snapshot),retryOfJobId:j.id}; store.enqueueJob(retry,100);
    store.finishJob(retry.id,retry.revision,{status:'failed'});
    expect(store.listDeliveries(j.id)).toHaveLength(2);
    expect(store.listDeliveries(retry.id)).toEqual([]);
    expect(store.pageDeliveries({jobId:j.id}).total).toBe(2);
    expect(store.pageDeliveries({jobId:retry.id}).total).toBe(0);
  });

  it('removes an optional public task label when a rule edit clears the selection', async () => {
    const {store} = await setup(); const input = {...ruleInput(),publicTaskId:randomUUID()};
    const original = store.createRule('operator',randomUUID(),input);
    const cleared = store.updateRule('operator',original.id,original.revision,ruleInput());
    expect(cleared.publicTaskId).toBeUndefined(); expect(store.getRule(original.id).publicTaskId).toBeUndefined();
  });

  it('combines account/seat grants only for an enabled current identity', async () => {
    const {store, db} = await setup(); const id = randomUUID();
    db.prepare('INSERT INTO seats VALUES(?,?,?,?)').run('a', 'A', 0, 0);
    db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?)').run(id, 'a', 'A', 'a', 'salt', 'hash', 1);
    const actor = {userId: id, seatId: 'a'};
    store.grant('seat', 'a', 'special', 'view'); store.grant('account', id, 'special', 'manage');
    store.grant('account', id, 'other', 'view');
    expect(store.effectivePermission(actor, 'special')).toBe('manage');
    store.revoke('account', id, 'special'); expect(store.effectivePermission(actor, 'special')).toBe('view');
    expect(store.effectivePermission({...actor, seatId: 'b'}, 'special')).toBeUndefined();
    db.prepare('UPDATE accounts SET enabled=0 WHERE id=?').run(id);
    expect(store.permissions(actor).size).toBe(0);
  });
});
