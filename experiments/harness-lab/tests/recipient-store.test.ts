import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { BackgroundStore, backgroundHash } from '../src/background/store.js';
import type { BackgroundEvent, BackgroundJob, BackgroundRuleSnapshot, DeliveryReviewDecisionInput, RecipientSuggestion } from '../src/contracts/background.js';

const dispose: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of dispose.splice(0).reverse()) await cleanup(); });
const seats = ['overall', 'intel', 'planning', 'situation'];
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'axon-recipient-store-')); let db = await openDatabase(dir);
  dispose.push(async () => { db.close(); await rm(dir, {recursive: true, force: true}); });
  new AccessStore(db);
  const actors = Object.fromEntries(seats.map(seatId => {
    const userId = randomUUID();
    db.prepare('INSERT INTO seats(id,name,create_public,manage_model) VALUES(?,?,?,?)').run(seatId, seatId, 0, 0);
    db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?)').run(userId, seatId, seatId, seatId, 'salt', 'hash', 1);
    return [seatId, {userId, seatId}];
  }));
  const store = new BackgroundStore(db);
  store.grant('seat', 'overall', 'source', 'manage'); store.grant('seat', 'planning', 'source', 'manage');
  return {store, actors, get db() { return db; }, reopen: async () => { db.close(); db = await openDatabase(dir); new AccessStore(db); return new BackgroundStore(db); }};
}
function running(store: BackgroundStore, supplementary = true) {
  let rule = store.enabledRule('source');
  rule ??= store.createRule('operator', randomUUID(), {name: '分析通知', sourceId: 'source', profileId: 'analysis', recipientSeatIds: ['intel'], enabled: true,
    ...(supplementary ? {supplementaryDelivery: {candidateSeatIds: ['planning', 'situation']}} : {})});
  const ruleSnapshot: BackgroundRuleSnapshot = {rule, profile: {id: 'analysis', name: '分析', goal: '分析变化', tools: ['information_suggest_recipients'], instructions: '', skillIds: [], agentIds: [], resources: []},
    ...(supplementary ? {supplementaryDelivery: {reviewerSeatId: 'overall', candidates: ['planning', 'situation'].map(id => ({id, name: id, responsibility: `${id}职责`, responsibilityRevision: 1}))}} : {})};
  const event: BackgroundEvent = {id: randomUUID(), sourceId: 'source', sourceMessageId: randomUUID(), title: '道路变化', payloadHash: backgroundHash('body'), receivedAt: new Date().toISOString(), revision: 1, files: [], ruleSnapshot};
  const job: BackgroundJob = {id: randomUUID(), eventId: event.id, sourceId: event.sourceId, kind: 'preprocess', status: 'queued', revision: 1, requestId: randomUUID(), ruleSnapshot, createdAt: new Date().toISOString()};
  store.acceptEvent(event, {initialJob: job, capacity: 100, expectedRule: rule});
  return store.claimJob(job.id, {sessionId: randomUUID()});
}
function suggestion(recipients = [{seatId: 'planning', reason: '影响任务方案'}]): RecipientSuggestion {
  return {recipients, ...(recipients.length ? {} : {noAdditionalReason: '固定接收席位足够'}), toolCallId: randomUUID(), recordedAt: new Date().toISOString()};
}
function finish(store: BackgroundStore, job: BackgroundJob, verified = true) {
  const current = store.getJob(job.id);
  return store.finishJob(job.id, current.revision, {status: 'succeeded', result: {sessionId: current.sessionId!, requestId: current.requestId, finalMessageId: 'final-message', files: []}}, {recipientSuggestionVerified: verified});
}
const approve = (revision = 1): Extract<DeliveryReviewDecisionInput, {decision: 'approve'}> => ({clientActionId: randomUUID(), revision, decision: 'approve', recipients: [{seatId: 'planning', reason: '批准方案席核对影响'}, {seatId: 'situation', reason: '同步更新态势'}]});

describe('supplementary delivery storage', () => {
  it('preserves fixed delivery, releases the job and persists a review without delivering suggested recipients', async () => {
    const context = await setup(); const {store} = context; const job = running(store);
    store.saveRecipientSuggestion(job.id, job.revision, suggestion()); finish(store, job);
    const review = store.reviewForJob(job.id)!;
    expect(review.status).toBe('pending'); expect(store.listDeliveries(job.id).map(item => item.recipientSeatId)).toEqual(['intel']);
    expect(store.sessionReservation(job.sessionId!)).toBeUndefined(); expect(store.getJob(job.id).status).toBe('succeeded');
    const reopened = await context.reopen(); expect(reopened.getDeliveryReview(review.id)).toEqual(review); expect(reopened.recoverRunning()).toEqual([]);
  });

  it('commits reviewed additions and action receipt atomically; a lost response can be retried without duplicate delivery', async () => {
    const context = await setup(); const {store, actors} = context; const job = running(store);
    store.saveRecipientSuggestion(job.id, job.revision, suggestion()); finish(store, job);
    const review = store.reviewForJob(job.id)!, input = approve();
    context.db.exec("CREATE TRIGGER fail_supplement BEFORE INSERT ON background_deliveries WHEN NEW.seat_id='situation' BEGIN SELECT RAISE(ABORT, 'write failed'); END;");
    expect(() => store.decideDeliveryReview(review.id, input, actors.overall)).toThrow('write failed');
    expect(store.getDeliveryReview(review.id).status).toBe('pending'); expect(store.listDeliveries(job.id)).toHaveLength(1);
    expect(store.findAction(actors.overall.userId, input.clientActionId)).toBeUndefined();
    context.db.exec('DROP TRIGGER fail_supplement');
    const approved = store.decideDeliveryReview(review.id, input, actors.overall);
    expect(approved.status).toBe('approved'); expect(store.listJobs()).toHaveLength(1);
    const reopened = await context.reopen(); expect(reopened.decideDeliveryReview(review.id, input, actors.overall)).toEqual(approved);
    expect(reopened.listDeliveries(job.id)).toHaveLength(3); expect(reopened.listDeliveries(job.id).filter(item => item.reviewId === review.id)).toHaveLength(2);
    expect(() => reopened.decideDeliveryReview(review.id, approve(), actors.overall)).toThrow('记录已变化');
    expect(() => reopened.decideDeliveryReview(review.id, {...input, recipients: [{seatId: 'planning', reason: 'changed'}]}, actors.overall)).toThrow('不同参数');
  });

  it('does not authorize a recipient or another source manager to approve; revoked reviewer permission also blocks retries', async () => {
    const {store, actors} = await setup(); const job = running(store); store.saveRecipientSuggestion(job.id, job.revision, suggestion()); finish(store, job);
    const review = store.reviewForJob(job.id)!;
    expect(() => store.decideDeliveryReview(review.id, approve(), actors.planning)).toThrow('指定总体席');
    expect(() => store.decideDeliveryReview(review.id, {...approve(), recipients: [{seatId: 'intel', reason: '原接收席位'}]}, actors.overall)).toThrow('候选');
    store.revoke('seat', 'overall', 'source');
    expect(() => store.decideDeliveryReview(review.id, approve(), actors.overall)).toThrow('指定总体席');
    expect(store.listDeliveries(job.id)).toHaveLength(1);
  });

  it('declining preserves base delivery and creates no supplementary visibility or follow-up execution', async () => {
    const context = await setup(); const {store, actors} = context; const job = running(store); store.saveRecipientSuggestion(job.id, job.revision, suggestion()); finish(store, job);
    const review = store.reviewForJob(job.id)!, input: DeliveryReviewDecisionInput = {clientActionId: randomUUID(), revision: 1, decision: 'decline', reason: '无需扩大通知'};
    const declined = store.decideDeliveryReview(review.id, input, actors.overall);
    expect(declined.status).toBe('declined'); expect(store.listDeliveries(job.id)).toHaveLength(1);
    const reopened = await context.reopen(); expect(reopened.decideDeliveryReview(review.id, input, actors.overall)).toEqual(declined);
    expect(reopened.listJobs()).toHaveLength(1);
  });

  it('retains the last valid suggestion, accepts explicit clearing, rejects duplicates/outside candidates and stale writes', async () => {
    const {store} = await setup(); const job = running(store); const valid = suggestion();
    const next = store.saveRecipientSuggestion(job.id, job.revision, valid);
    expect(() => store.saveRecipientSuggestion(job.id, job.revision, suggestion())).toThrow('记录已变化');
    expect(() => store.saveRecipientSuggestion(job.id, next.revision, suggestion([{seatId: 'intel', reason: 'already fixed'}]))).toThrow('候选');
    expect(() => store.saveRecipientSuggestion(job.id, next.revision, suggestion([{seatId: 'planning', reason: 'one'}, {seatId: 'planning', reason: 'two'}]))).toThrow('完整补充');
    expect(store.getJob(job.id).recipientSuggestion).toEqual(valid);
    store.saveRecipientSuggestion(job.id, next.revision, suggestion([])); finish(store, job);
    expect(store.reviewForJob(job.id)).toBeUndefined(); expect(store.listDeliveries(job.id)).toHaveLength(1);
  });

  it('does not publish unverified suggestions and rolls back review+base deliveries if the review write fails', async () => {
    const {store, db} = await setup(); const job = running(store); store.saveRecipientSuggestion(job.id, job.revision, suggestion()); finish(store, job, false);
    expect(store.reviewForJob(job.id)).toBeUndefined(); expect(store.getJob(job.id).recipientSuggestionError).toContain('未核实'); expect(store.listDeliveries(job.id)).toHaveLength(1);
    const second = running(store); store.saveRecipientSuggestion(second.id, second.revision, suggestion());
    db.exec("CREATE TRIGGER fail_review BEFORE INSERT ON background_delivery_reviews BEGIN SELECT RAISE(ABORT, 'review write failed'); END;");
    expect(() => finish(store, second)).toThrow('review write failed'); expect(store.getJob(second.id).status).toBe('running'); expect(store.listDeliveries(second.id)).toEqual([]);
    db.exec('DROP TRIGGER fail_review'); finish(store, second); expect(store.reviewForJob(second.id)?.status).toBe('pending');
  });

  it.each(['failed', 'cancelled', 'interrupted'] as const)('never creates deliveries or review for %s analysis', async status => {
    const {store} = await setup(); const job = running(store); const recorded = store.saveRecipientSuggestion(job.id, job.revision, suggestion());
    store.finishJob(job.id, recorded.revision, {status}, {recipientSuggestionVerified: true});
    expect(store.listDeliveries(job.id)).toEqual([]); expect(store.reviewForJob(job.id)).toBeUndefined();
    expect(() => store.saveRecipientSuggestion(job.id, store.getJob(job.id).revision, suggestion())).toThrow();
  });

  it('cancellation wins over verified successful completion', async () => {
    const {store} = await setup(); const job = running(store); const recorded = store.saveRecipientSuggestion(job.id, job.revision, suggestion());
    store.requestCancel(job.id, recorded.revision); expect(finish(store, job).status).toBe('cancelled'); expect(store.listDeliveryReviews()).toEqual([]);
  });

  it('migrates v3/v4 without inventing historic reviews and rejects missing v5 indexes and approvals', async () => {
    const {store, db} = await setup(); const old = running(store, false); finish(store, old);
    db.exec('DROP TABLE inbox_handling; DROP TABLE background_delivery_reviews; PRAGMA user_version=4;'); new BackgroundStore(db);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(8); expect(store.listDeliveries()).toHaveLength(1); expect(store.listDeliveryReviews()).toEqual([]);
    db.exec('DROP TABLE inbox_handling; DROP TABLE background_delivery_reviews; DROP TABLE information_task_overrides; PRAGMA user_version=3;'); new BackgroundStore(db);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(8); expect(store.listDeliveries()).toHaveLength(1);
    db.exec('DROP INDEX background_delivery_reviews_pending'); expect(() => new BackgroundStore(db)).toThrow();
  });

  it('rejects corrupted approved receipt relationships on reopen', async () => {
    const {store, db, actors} = await setup(); const job = running(store); store.saveRecipientSuggestion(job.id, job.revision, suggestion()); finish(store, job);
    const review = store.reviewForJob(job.id)!; store.decideDeliveryReview(review.id, approve(), actors.overall);
    const delivery = store.listDeliveries(job.id).find(item => item.reviewId)!;
    db.prepare("UPDATE background_deliveries SET data=json_remove(data,'$.reviewId') WHERE id=?").run(delivery.id);
    expect(() => new BackgroundStore(db)).toThrow();
    db.prepare('UPDATE background_deliveries SET data=? WHERE id=?').run(JSON.stringify(delivery), delivery.id); new BackgroundStore(db);
    db.prepare('DELETE FROM background_deliveries WHERE id=?').run(delivery.id); expect(() => new BackgroundStore(db)).toThrow();
  });

  it('detects missing durable review or decision action instead of silently losing pending/approved work', async () => {
    const {store, db, actors} = await setup(); const job = running(store); store.saveRecipientSuggestion(job.id, job.revision, suggestion()); finish(store, job);
    const review = store.reviewForJob(job.id)!;
    db.prepare('DELETE FROM background_delivery_reviews WHERE id=?').run(review.id); expect(() => new BackgroundStore(db)).toThrow();
    db.prepare('INSERT INTO background_delivery_reviews VALUES(?,?,?,?,?,?,?,?)').run(review.id, review.jobId, review.eventId, review.sourceId, review.reviewerSeatId, review.status, review.createdAt, JSON.stringify(review));
    new BackgroundStore(db); store.decideDeliveryReview(review.id, approve(), actors.overall);
    db.exec("DELETE FROM background_actions WHERE json_extract(data,'$.kind')='delivery_review'"); expect(() => new BackgroundStore(db)).toThrow();
  });

  it('clears optional candidate configuration instead of retaining an old enabled suggestion rule', async () => {
    const {store} = await setup(); const job = running(store); const rule = job.ruleSnapshot!.rule;
    const {supplementaryDelivery: _ignored, ...input} = rule; void _ignored;
    store.updateRule('operator', rule.id, rule.revision, input);
    expect(store.getRule(rule.id).supplementaryDelivery).toBeUndefined();
    expect(store.getJob(job.id).ruleSnapshot!.supplementaryDelivery!.candidates).toHaveLength(2);
  });
});

it('upgrades main v5 reviews without losing decisions and initializes only historical delivered handling', async () => {
  const {store,db,actors} = await setup(); const job = running(store); store.saveRecipientSuggestion(job.id,job.revision,suggestion()); finish(store,job);
  const review = store.reviewForJob(job.id)!; const input = approve(); store.decideDeliveryReview(review.id,input,actors.overall);
  const fixed = store.listDeliveries(job.id).find(item => !item.reviewId)!; store.updateDelivery(fixed.id,fixed.revision,'delivered');
  const before = store.getDeliveryReview(review.id);
  db.exec('DROP TABLE inbox_handling; ALTER TABLE seats DROP COLUMN view_work_overview; PRAGMA user_version=5;');
  new AccessStore(db); const reopened = new BackgroundStore(db);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(8);
  expect(reopened.getDeliveryReview(review.id)).toEqual(before);
  expect(reopened.decideDeliveryReview(review.id,input,actors.overall)).toEqual(before);
  expect(reopened.handling(fixed.id)).toMatchObject({state:'legacy',revision:1});
  const supplementary = reopened.listDeliveries(job.id).find(item => item.reviewId)!;
  reopened.updateDelivery(supplementary.id,supplementary.revision,'delivered');
  expect(reopened.handling(supplementary.id).state).toBe('pending');
});

it('upgrades branch v6 without resetting existing handling receipts or overview capability', async () => {
  const {store,db,actors} = await setup(); const job = running(store,false); finish(store,job);
  const delivery = store.listDeliveries(job.id)[0]; store.updateDelivery(delivery.id,delivery.revision,'delivered');
  db.prepare('UPDATE seats SET view_work_overview=1 WHERE id=?').run('intel');
  const actor = new AccessStore(db).identity(actors.intel.userId)!;
  const input = {state:'completed' as const,revision:1,clientActionId:randomUUID()};
  const receipt = store.handleInbox(actor,delivery.id,input);
  db.exec('DROP TABLE background_delivery_reviews; ALTER TABLE seats DROP COLUMN responsibility; ALTER TABLE seats DROP COLUMN responsibility_revision; PRAGMA user_version=6;');
  const access = new AccessStore(db), reopened = new BackgroundStore(db);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(8);
  expect(access.identity(actor.userId)?.viewWorkOverview).toBe(true);
  expect(reopened.handleInbox(actor,delivery.id,input)).toEqual(receipt);
  expect(reopened.listDeliveryReviews()).toEqual([]);
  expect(access.seats().find(seat => seat.id === 'intel')).toMatchObject({responsibility:'',responsibilityRevision:1});
});
