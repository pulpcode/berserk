import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../src/access/database.js';
import { AccessStore } from '../../src/access/store.js';
import { BackgroundService } from '../../src/background/service.js';
import { verifiedTaskAssessment } from '../../src/background/task-assessment-evidence.js';
import { BackgroundStore } from '../../src/background/store.js';
import { ContextService } from '../../src/context/service.js';
import { RequestError } from '../../src/contracts/errors.js';
import { PiLab } from '../../src/pi/lab.js';
import { createBackgroundExecutor } from '../../src/pi/background-runner.js';
import type { BackgroundJob } from '../../src/contracts/background.js';
import { fakeRuntime, testConfig, type Reply } from '../pi/fake-runtime.js';

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn(); });
const recordName = 'information_record_task_assessment';
const search: Reply = {tools: [{name: 'task_search', arguments: {}}]};
const final: Reply = {text: '判断已记录。'};
const empty: Reply = {tools: [{name: recordName, arguments: {relations: [], emptyReason: '已核对活动任务，此条资料与目标无关。'}}]};
async function setup(reply: (context: Context, index: number) => Reply, options: {required?: boolean; timeoutMs?: number; verificationOutput?: boolean} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-task-assessment-completion-'));
  cleanup.push(() => rm(dir, {recursive: true, force: true}));
  const db = await openDatabase(dir), access = new AccessStore(db);
  const userId = await access.saveAccount({username: 'a', displayName: 'A', seatId: 'a', seatName: 'A',
    password: 'test-password-123', createPublicTask: true, manageModelSettings: false});
  const actor = access.identity(userId)!; db.close();
  const config = testConfig(dir, {seatId: 'a', auth: {secret: 'assessment-test-auth-secret-32-chars', sessionMs: 100000},
    ...(options.timeoutMs ? {agentRunTimeoutMs: options.timeoutMs} : {})});
  const fake = await fakeRuntime(config, reply), lab = await PiLab.create(config, fake.runtime);
  cleanup.push(() => lab.close());
  lab.context = new ContextService({systems: [{id: 'intel', name: '资料', adapter: 'mock-information-http', baseUrl: 'http://127.0.0.1:1', tokenEnv: 'TOKEN'}],
    scopes: [{id: 'scope', name: '共同范围', systemIds: ['intel'], seatIds: ['a']}]}, {TOKEN: 'test-only'});
  const executor = createBackgroundExecutor(lab);
  if (options.verificationOutput) {
    const execute = executor.execute;
    // An adapter output fixture reaches the real service's asynchronous verification boundary.
    executor.execute = async (job, input) => {
      const result = await execute(job, input);
      result.snapshot.fileOutputs = [{workspaceId: job.id, sessionId: job.sessionId!, requestId: job.requestId!,
        toolCallId: 'output-fixture', path: 'result.md', downloadId: randomUUID(), name: 'result.md', size: 1,
        hash: 'a'.repeat(64), createdAt: new Date().toISOString()}];
      return result;
    };
  }
  const host = new BackgroundService(lab, {enabled: true, concurrency: 1, modelConcurrency: 1, backlogLimit: 100,
    sources: [{sourceId: 'input', name: '来报系统', credentialRef: 'TOKEN', allowedProfileIds: ['review'], allowedRecipientSeatIds: ['a']}],
    profiles: [{id: 'review', name: '初析', goal: '判断信息对任务的影响', requireTaskAssessment: options.required ?? true,
      tools: ['task_search', 'task_read', recordName], contextScopeId: 'scope', skillIds: [], agentIds: [], instructions: '', resources: []}]}, executor);
  await host.initialize(); cleanup.push(() => host.close()); host.store.grant('seat', 'a', 'input', 'manage');
  host.store.createRule(actor.userId, randomUUID(), {name: '初析规则', sourceId: 'input', profileId: 'review', recipientSeatIds: ['a'], enabled: true});
  const task = lab.access!.create(actor, {clientActionId: randomUUID(), title: '公共业务', goal: '核对道路资料和不确定事项', visibility: 'public'});
  const relation = (): Reply => ({tools: [{name: recordName, arguments: {relations: [{taskId: task.id, reason: '资料确认任务关注的道路事实。'}]}}]});
  const accept = () => host.accept('input', {sourceMessageId: randomUUID(), title: '道路通知', text: '当前道路通行状态正常。'});
  const settled = async (id?: string) => {
    await vi.waitFor(() => expect(host.store.listJobs().filter(j => !id || j.id === id).some(j => ['queued', 'running'].includes(j.status))).toBe(false), {timeout: 10000, interval: 20});
    return id ? host.store.getJob(id) : host.store.listJobs()[0];
  };
  const snapshot = (job: BackgroundJob) => createBackgroundExecutor(lab).read(job);
  return {dir, lab, host, actor, task, relation, accept, settled, snapshot, ...fake};
}
function repairs(snapshot: Awaited<ReturnType<ReturnType<typeof createBackgroundExecutor>['read']>>) {
  return snapshot!.messages.filter(m => m.role === 'user' && m.text.startsWith('[系统补做提示'));
}

describe('required ordinary preprocess judgment in the original native request', () => {
  it('finishes the normal path without a repair or an extra request', async () => {
    const s = await setup((_c, i) => [search, s.relation(), final][i]);
    await s.accept(); const job = await s.settled(), snapshot = await s.snapshot(job);
    expect(job.status, JSON.stringify(job.error)).toBe('succeeded'); expect(s.calls).toHaveLength(3);
    expect(repairs(snapshot)).toHaveLength(0); expect(job.taskAssessment?.items[0].taskSpaceId).toBe(s.task.id);
    expect(s.host.store.listDeliveries(job.id)).toHaveLength(1);
  });
  it('requires matching current-request native receipt and query versions, never a historical or fabricated proof', async () => {
    const s = await setup((_c, i) => [search, s.relation(), final][i]);
    await s.accept(); const job = await s.settled(), snapshot = (await s.snapshot(job))!;
    expect(verifiedTaskAssessment(job, snapshot)).toBe(true);
    for (const field of ['receipt-request', 'query-request', 'query-error', 'query-version', 'result-missing', 'assessment-content', 'old-save', 'recovery'] as const) {
      const changed = structuredClone(snapshot), savedJob = structuredClone(job);
      const receipt = changed.messages.find(m => m.toolName === recordName)!, query = changed.messages.find(m => m.toolName === 'task_search')!;
      if (field === 'receipt-request') receipt.requestId = randomUUID();
      if (field === 'query-request') query.requestId = randomUUID();
      if (field === 'query-error') query.isError = true;
      if (field === 'query-version') { const value = JSON.parse(query.text); value.data.items[0].revision++; query.text = JSON.stringify(value); }
      if (field === 'result-missing') receipt.resultMissing = true;
      if (field === 'assessment-content') savedJob.taskAssessment!.items[0].reason = '无对应保存回执的内容';
      if (field === 'old-save') { const value = JSON.parse(receipt.text); value.status = 'unchanged'; value.assessment.toolCallId = 'old-save'; savedJob.taskAssessment!.toolCallId = 'old-save'; receipt.text = JSON.stringify(value); }
      if (field === 'recovery') changed.recoveryWarning = '原始记录不完整';
      expect(verifiedTaskAssessment(savedJob, changed), field).toBe(false);
    }
  });
  it.each(['omitted', 'failed-record'] as const)('repairs %s with one native follow-up and keeps the failed evidence', async mode => {
    const wrong: Reply = {tools: [{name: recordName, arguments: {relations: []}}]};
    const s = await setup((_c, i) => mode === 'omitted'
      ? [search, final, s.relation(), final][i] : [search, wrong, final, s.relation(), final][i]);
    await s.accept(); const job = await s.settled(), snapshot = await s.snapshot(job);
    expect(job.status, JSON.stringify(job.error)).toBe('succeeded'); expect(repairs(snapshot)).toHaveLength(1);
    expect(new Set(snapshot!.messages.map(m => m.requestId))).toEqual(new Set([job.requestId]));
    if (mode === 'failed-record') expect(snapshot!.messages.some(m => m.toolName === recordName && m.isError)).toBe(true);
    expect(s.host.store.listDeliveries(job.id)).toHaveLength(1);
  });
  it('fails after two ignored reminders without successful delivery or effective associations', async () => {
    const s = await setup((_c, i) => i === 0 ? search : final);
    await s.accept(); const job = await s.settled(), snapshot = await s.snapshot(job);
    expect(job.status).toBe('failed'); expect(job.error).toEqual({code: 'TASK_ASSESSMENT_INCOMPLETE', message: '任务判断未完成。'});
    expect(s.calls).toHaveLength(4); expect(repairs(snapshot)).toHaveLength(2);
    expect(snapshot!.messages.filter(m => m.role === 'assistant')).toHaveLength(3);
    expect(job.taskAssessment).toBeUndefined(); expect(s.host.store.listDeliveries(job.id)).toEqual([]);
    expect(s.host.taskLinks.list(s.actor, s.task.id).items).toEqual([]);
  });
  it('does not accept a later failed submit as an updated successful judgment', async () => {
    const wrong: Reply = {tools: [{name: recordName, arguments: {relations: []}}]};
    const s = await setup((_c, i) => [search, s.relation(), wrong][i] ?? final);
    await s.accept(); const job = await s.settled(), snapshot = await s.snapshot(job);
    expect(job.status).toBe('failed'); expect(job.taskAssessment?.items).toHaveLength(1);
    expect(repairs(snapshot)).toHaveLength(2); expect(s.host.store.listDeliveries(job.id)).toEqual([]);
    expect(s.host.taskLinks.list(s.actor, s.task.id).items).toEqual([]);
    expect(snapshot!.messages.filter(m => m.toolName === recordName)).toHaveLength(2);
  });
  it('accepts an unchanged receipt from a real earlier save in the same request', async () => {
    const s = await setup((_c, i) => [search, s.relation(), s.relation(), final][i]);
    await s.accept(); const job = await s.settled(), snapshot = await s.snapshot(job);
    expect(job.status, JSON.stringify(job.error)).toBe('succeeded'); expect(repairs(snapshot)).toHaveLength(0);
    const receipts = snapshot!.messages.filter(m => m.toolName === recordName).map(m => JSON.parse(m.text));
    expect(receipts.map(r => r.status)).toEqual(['recorded', 'unchanged']);
    expect(receipts[0].assessment).toEqual(receipts[1].assessment);
  });
  it.each(['absent', 'failed'] as const)('requires a successful current-request task search when it is %s', async mode => {
    const s = await setup((_c, i) => i === 0 && mode === 'failed'
      ? {tools: [{name: 'task_search', arguments: {cursor: 'invalid-cursor'}}]} : i === (mode === 'failed' ? 1 : 0) ? empty : final);
    await s.accept(); const job = await s.settled(), snapshot = await s.snapshot(job);
    expect(job.status).toBe('failed'); expect(job.taskAssessment).toBeUndefined();
    expect(snapshot!.messages.find(m => m.toolName === recordName)).toMatchObject({isError: true});
    expect(repairs(snapshot)).toHaveLength(2);
  });
  it('can requery and replace a saved judgment after the task version changes before completion', async () => {
    let changed = false;
    const s = await setup((_c, i) => {
      if (i === 2 && !changed) { changed = true; s.lab.access!.update(s.actor, s.task.id, 1, {goal: '新的完整任务目标'}); }
      return [search, s.relation(), final, search, s.relation(), final][i];
    });
    await s.accept(); const job = await s.settled(), snapshot = await s.snapshot(job);
    expect(job.status, JSON.stringify(job.error)).toBe('succeeded'); expect(repairs(snapshot)).toHaveLength(1);
    expect(job.taskAssessment?.items[0].taskRevision).toBe(2);
  });
  it.each(['task-version', 'scope-revocation', 'closed-run-gate'] as const)('rechecks %s after asynchronous output verification before publishing', async change => {
    const s = await setup((_c, i) => [search, s.relation(), final][i], {verificationOutput: true});
    let reach!: () => void, release!: () => void;
    const reached = new Promise<void>(resolve => { reach = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
    const gate = vi.spyOn(s.host.files.copies, 'assertValid').mockImplementation(async () => {
      reach(); await released;
    });
    try {
      await s.accept(); await reached;
      if (change === 'task-version') s.lab.access!.update(s.actor, s.task.id, 1, {goal: '验证期间已更改的任务目标'});
      if (change === 'scope-revocation') s.lab.context!.config.scopes[0].systemIds = [];
      if (change === 'closed-run-gate') vi.spyOn(s.host, 'assertRun').mockImplementation(() => { throw new RequestError('SCENARIO_READ_ONLY', '资料已只读。', 409); });
      release();
      const job = await s.settled();
      expect(job.status).toBe('failed');
      expect(s.calls).toHaveLength(3);
      expect(job.taskAssessment?.items[0].taskRevision).toBe(1);
      expect(s.host.store.listDeliveries(job.id)).toEqual([]);
      expect(s.host.taskLinks.list(s.actor, s.task.id).items).toEqual([]);
      expect((await s.snapshot(job))!.messages.some(message => message.toolName === recordName && !message.isError)).toBe(true);
    } finally { release(); gate.mockRestore(); }
  });
  it('preserves optional-profile behavior and freezes the required flag on acceptance', async () => {
    const optional = await setup(() => final, {required: false});
    await optional.accept(); const first = await optional.settled(); expect(first.status).toBe('succeeded');
    expect(optional.calls).toHaveLength(1); expect(first.taskAssessment).toBeUndefined();
    const required = await setup((_c, i) => [search, empty, final][i]);
    await required.accept(); const job = await required.settled();
    required.host.config.profiles[0].requireTaskAssessment = false;
    expect(required.host.store.getJob(job.id).ruleSnapshot?.profile.requireTaskAssessment).toBe(true);
    const reopened = new BackgroundStore(required.lab.access!.db);
    expect(reopened.getJob(job.id).ruleSnapshot?.profile.requireTaskAssessment).toBe(true);
  });
  it('reopens a failed required job with its original native history and no automatic replay', async () => {
    const s = await setup((_c, i) => i === 0 ? search : final);
    await s.accept(); const job = await s.settled(), original = await s.snapshot(job);
    await s.host.close();
    const reopened = new BackgroundService(s.lab, s.host.config); await reopened.initialize(); cleanup.push(() => reopened.close());
    expect(reopened.store.getJob(job.id)).toMatchObject({status: 'failed', ruleSnapshot: {profile: {requireTaskAssessment: true}}});
    expect((await s.snapshot(job))!.messages).toEqual(original!.messages);
    expect(reopened.taskLinks.list(s.actor, s.task.id).items).toEqual([]);
    await reopened.pump(); expect(s.calls).toHaveLength(4); expect(reopened.store.listDeliveries(job.id)).toEqual([]);
  });
  it('does not enqueue another repair after cancellation during the first repair', async () => {
    const s = await setup((_c, i) => i === 0 ? search : i === 1 ? final : {waitForAbort: true});
    const receipt = await s.accept();
    await vi.waitFor(() => expect(s.calls).toHaveLength(3));
    const running = s.host.store.listJobs().find(j => j.eventId === receipt.eventId)!;
    await s.host.cancel(s.actor, running.id, running.revision);
    const job = await s.settled(running.id), snapshot = await s.snapshot(job);
    expect(job.status).toBe('cancelled'); expect(repairs(snapshot)).toHaveLength(1);
    expect(s.calls).toHaveLength(3); expect(s.host.store.listDeliveries(job.id)).toEqual([]);
  });
  it('preserves timeout and revoked service-scope authority during repair', async () => {
    const timed = await setup((_c, i) => i === 0 ? search : i === 1 ? final : {waitForAbort: true}, {timeoutMs: 300});
    await timed.accept(); const timeout = await timed.settled(); expect(timeout.status).toBe('failed');
    expect((await timed.snapshot(timeout))!.lastResult?.message).toContain('超时');
    expect(timed.host.store.listDeliveries(timeout.id)).toEqual([]);
    const revoked = await setup((_c, i) => {
      if (i === 2) revoked.lab.context!.config.scopes[0].systemIds = [];
      return [search, final, empty, final][i];
    });
    await revoked.accept(); const job = await revoked.settled();
    expect(job.status).toBe('failed'); expect(revoked.host.store.listDeliveries(job.id)).toEqual([]);
  });
});
