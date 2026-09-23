import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Check } from 'typebox/value';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { HandoffFiles } from '../../src/collaboration/files.js';
import { RequestError } from '../../src/contracts/errors.js';
import { workActionToolSchema } from '../../src/contracts/collaboration.js';
import { interactionHistory, COMMAND_POLICY, INTERACTION_REQUESTED, INTERACTION_RESOLVED } from '../../src/pi/interactions.js';
import type { Context } from '@earendil-works/pi-ai';
import { PiLab } from '../../src/pi/lab.js';
import { fakeRuntime, testConfig, type Reply } from './fake-runtime.js';
import type { WorkActionInput, WorkPrepareInput, ConfirmationInteraction, WorkReceipt } from '../../src/contracts/index.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });
const seats = [{ id: 'test-seat', name: '席位 A' }, { id: 'seat-b', name: '席位 B' }];
const actor = { seatId: 'test-seat' };
const other = { seatId: 'seat-b' };
function barrier() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function setup(reply: (context: Context, index: number) => Reply) {
  const dataDir = await mkdtemp(join(tmpdir(), 'axon-handoff-pi-'));
  cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
  const config = testConfig(dataDir, { seatId: actor.seatId, testSeats: seats });
  const fake = await fakeRuntime(config, reply);
  const lab = await PiLab.create(config, fake.runtime); cleanup.push(() => lab.close());
  return { dataDir, config, fake, lab };
}
async function wait(lab: PiLab, sessionId: string, seatId = actor.seatId) {
  await vi.waitFor(() => expect(lab.get(sessionId, seatId).interactions?.some(item => item.status === 'pending')).toBe(true));
  return lab.get(sessionId, seatId).interactions!.find(item => item.status === 'pending')! as ConfirmationInteraction;
}
const approve = (item: ConfirmationInteraction, decision = 'approve') => ({ requestId: item.requestId, kind: 'confirmation', decision });
async function page(lab: PiLab, seatId: string, input: WorkPrepareInput): Promise<WorkReceipt> {
  const action = await lab.collaboration!.prepare({ seatId }, input, { source: 'page', clientActionId: randomUUID() });
  return lab.collaboration!.commitPage({ seatId }, action.operationId);
}
async function bytes(lab: PiLab, seatId: string, fileId: string) {
  const file = await lab.collaboration!.openFile({ seatId }, fileId); const parts: Buffer[] = [];
  for await (const part of file.stream) parts.push(Buffer.from(part));
  return Buffer.concat(parts).toString();
}

describe('Pi collaboration tools and native HITL', () => {
  it('prepares fixed input bytes, authorizes one exact call, and restores scoped native history without replay', async () => {
    const { lab, fake, config } = await setup((_context, index) => index === 0 ? { tools: [{ name: 'work_item_action', arguments: { action: input } }] } : { text: '分派已完成' });
    const workspace = lab.workspaces.get();
    await writeFile(join(lab.files.filesDirectory(workspace.id), '任务书.txt'), '确认时的任务书');
    await writeFile(join(lab.files.filesDirectory(workspace.id), '要求.md'), '保留初稿');
    await writeFile(join(lab.files.filesDirectory(workspace.id), '私有.txt'), '无关文件');
    const input: WorkActionInput = { kind: 'assign', payload: { assigneeSeatId: other.seatId, title: '编制方案', goal: '结合任务书提出方案', inputPaths: ['/workspace/任务书.txt', '要求.md'] } };
    const session = await lab.createSession(); const request = lab.start(session.id, '将任务书分派给席位B'); const done = request.run(() => {});
    const item = await wait(lab, session.id); const fixed = item.action.handoff!;
    expect(fixed.files).toHaveLength(2); expect(item.action.parameters).toEqual({ action: input });
    expect(lab.collaboration!.list(other)).toEqual([]);
    await expect(lab.collaboration!.commitPage(actor, fixed.operationId)).rejects.toThrow(/原对话/);
    expect(() => lab.get(session.id, other.seatId)).toThrow(/不存在/);
    expect(() => lab.respondInteraction(session.id, item.interactionId, approve(item), other.seatId)).toThrow(/不存在/);
    await writeFile(join(lab.files.filesDirectory(workspace.id), '任务书.txt'), '之后修改的普通文件');
    lab.respondInteraction(session.id, item.interactionId, approve(item));
    lab.respondInteraction(session.id, item.interactionId, approve(item)); await done;
    expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
    expect(lab.get(session.id).interactions?.[0]).toMatchObject({ status: 'approved', execution: 'succeeded' });
    const work = lab.collaboration!.list(other)[0]; expect(work.state).toBe('assigned');
    expect(await bytes(lab, other.seatId, fixed.files[0].fileId)).toBe('确认时的任务书');
    expect(fake.calls).toHaveLength(2);
    const names = fake.calls[0].context.tools!.map(tool => tool.name);
    expect(names).toContain('work_item_action'); expect(names).not.toContain('work_item_prepare'); expect(names).not.toContain('work_item_commit');
    const schema = fake.calls[0].context.tools!.find(tool => tool.name === 'work_item_action')!.parameters;
    expect(JSON.stringify(schema)).not.toMatch(/workspaceId|taskSpaceId/);
    const target = lab.workspaces.list(other.seatId).workspaces.find(w => w.taskSpaceId === workspace.taskSpaceId)!;
    for (const file of fixed.files) {
      const imported = await lab.collaboration!.importFile(other, file.fileId, target.id);
      expect(await readFile(join(lab.files.filesDirectory(target.id, other.seatId), imported.path), 'utf8')).toBe(await bytes(lab, other.seatId, file.fileId));
    }
    expect(lab.collaboration!.list(other)).toHaveLength(1);
    const calls = fake.calls.length; await lab.close(); const restored = await PiLab.create(config, fake.runtime); cleanup.push(() => restored.close());
    expect(restored.get(session.id).interactions?.[0]).toMatchObject({ status: 'approved', execution: 'succeeded' });
    expect(restored.get(session.id).recoveryWarning).toBeUndefined();
    expect(restored.collaboration!.getAction(actor, fixed.operationId).receipt?.workItemId).toBe(work.id);
    expect(fake.calls).toHaveLength(calls);
  });

  it.each(['reject', 'cancel'])('%s does not hand off files and ends uncommitted preparations', async decision => {
    const { lab } = await setup((_context, index) => index === 0 ? { tools: [{ name: 'work_item_action', arguments: { action: input } }] } : { text: '未分派' });
    const input: WorkActionInput = { kind: 'assign', payload: { assigneeSeatId: other.seatId, title: '工作', goal: '不要产生效果' } };
    const session = await lab.createSession(); const run = lab.start(session.id, '分派'); const done = run.run(() => {}); const item = await wait(lab, session.id);
    if (decision === 'cancel') lab.cancel(session.id, run.requestId); else lab.respondInteraction(session.id, item.interactionId, approve(item, 'reject'));
    await done;
    expect(lab.collaboration!.list(actor)).toEqual([]);
    expect(lab.collaboration!.getAction(actor, item.action.handoff!.operationId).status).toBe('expired');
    expect(lab.get(session.id).interactions?.[0].status).toBe(decision === 'cancel' ? 'cancelled' : 'rejected');
  });

  it('assignee uses its own files and work context, and receipt queries do not re-execute a submission', async () => {
    let operationId = '';
    const { lab, fake } = await setup((_context, index) => {
      if (index === 0) return { tools: [{ name: 'work_item_action', arguments: { action: input } }] };
      if (index === 2) return { tools: [{ name: 'work_item_read', arguments: { operationId } }] };
      return { text: '已处理' };
    });
    const source = lab.workspaces.get();
    const assigned = await page(lab, actor.seatId, { kind: 'assign', taskSpaceId: source.taskSpaceId, payload: { workspaceId: source.id, assigneeSeatId: other.seatId, title: '检查数据', goal: '必须核对交通信息' } });
    await page(lab, other.seatId, { kind: 'claim', workItemId: assigned.workItemId, expectedRevision: assigned.revision, payload: {} });
    const target = lab.workspaces.list(other.seatId).workspaces.find(w => w.taskSpaceId === source.taskSpaceId)!;
    await writeFile(join(lab.files.filesDirectory(target.id, other.seatId), '方案.md'), 'B的方案');
    await writeFile(join(lab.files.filesDirectory(source.id), '方案.md'), 'A的私有方案');
    const work = lab.collaboration!.read(other, assigned.workItemId);
    const input: WorkActionInput = { kind: 'submit', workItemId: work.id, expectedRevision: work.revision, payload: { path: '/workspace/方案.md' } };
    const session = await lab.createSession(target.id, other.seatId, work.id);
    const done = lab.start(session.id, '上报方案', {}, other.seatId).run(() => {}); const item = await wait(lab, session.id, other.seatId); operationId = item.action.handoff!.operationId;
    expect(fake.calls[0].context.systemPrompt).toContain('必须核对交通信息');
    expect(fake.calls[0].context.systemPrompt).toContain(target.id);
    expect(fake.calls[0].context.systemPrompt).not.toContain('A的私有方案');
    expect(lab.get(session.id, other.seatId).workItemId).toBe(work.id);
    expect(() => lab.bindWorkItem(session.id, work.id, other.seatId)).toThrow(/结束/);
    lab.respondInteraction(session.id, item.interactionId, approve(item), other.seatId); await done;
    expect(lab.get(session.id, other.seatId).lastResult?.status).toBe('succeeded');
    expect(await bytes(lab, actor.seatId, item.action.handoff!.files[0].fileId)).toBe('B的方案');
    expect(lab.collaboration!.read(actor, work.id).sessionIds).toEqual([]);
    await lab.start(session.id, '核对刚才操作是否成功', {}, other.seatId).run(() => {});
    expect(lab.collaboration!.read(actor, work.id).submissions).toHaveLength(1);
    expect(lab.get(session.id, other.seatId).messages.some(message => message.role === 'tool' && message.text.includes(operationId) && message.text.includes('committed'))).toBe(true);
  });

  it('does not grant business tools to readonly child agents', async () => {
    const { lab, fake } = await setup((_context, index) => index === 0 ? { tools: [{ name: 'subagent', arguments: { agent: 'analyst', task: '只读核对' } }] } : { text: '只读结果' });
    const session = await lab.createSession(); await lab.start(session.id, '委派核对').run(() => {});
    expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
    expect(fake.calls[0].context.tools?.some(tool => tool.name === 'work_item_action')).toBe(true);
    expect(fake.calls[1].context.tools?.some(tool => tool.name.startsWith('work_item') || tool.name === 'handoff_import_file')).toBe(false);
    expect(lab.get(session.id).subagents?.[0].status).toBe('succeeded');
  });

  it('uses one confirmed action for claim, submit, return, resubmit and acceptance', async () => {
    let input: WorkActionInput;
    const { lab } = await setup((_context, index) => index % 2 === 0 ? { tools: [{ name: 'work_item_action', arguments: { action: input } }] } : { text: '已交接' });
    const source = lab.workspaces.get();
    const assigned = await page(lab, actor.seatId, { kind: 'assign', taskSpaceId: source.taskSpaceId, payload: { workspaceId: source.id, assigneeSeatId: other.seatId, title: '方案', goal: '完成方案' } });
    const target = lab.workspaces.list(other.seatId).workspaces.find(w => w.taskSpaceId === source.taskSpaceId)!;
    const a = await lab.createSession(source.id); const b = await lab.createSession(target.id, other.seatId, assigned.workItemId);
    await writeFile(join(lab.files.filesDirectory(target.id, other.seatId), '方案.md'), '# 方案');
    for (const kind of ['claim', 'submit', 'return', 'submit', 'accept'] as const) {
      const detail = lab.collaboration!.read(actor, assigned.workItemId);
      const review = kind === 'return' || kind === 'accept';
      input = review ? { kind: 'review', workItemId: detail.id, expectedRevision: detail.revision, payload: { submissionId: detail.latestSubmissionId!, decision: kind, reason: '已核对' } }
        : kind === 'claim' ? { kind, workItemId: detail.id, expectedRevision: detail.revision, payload: {} }
        : { kind, workItemId: detail.id, expectedRevision: detail.revision, payload: { path: '方案.md' } };
      const session = review ? a : b; const seatId = review ? actor.seatId : other.seatId;
      const done = lab.start(session.id, kind, {}, seatId).run(() => {}); const item = await wait(lab, session.id, seatId);
      expect(item.toolName).toBe('work_item_action'); expect(lab.collaboration!.read(actor, detail.id).revision).toBe(detail.revision);
      lab.respondInteraction(session.id, item.interactionId, approve(item), seatId); await done;
      expect(lab.get(session.id, seatId).lastResult?.status).toBe('succeeded');
      expect(lab.collaboration!.getAction({ seatId }, item.action.handoff!.operationId).receipt?.revision).toBe(detail.revision + 1);
    }
    expect(lab.collaboration!.read(actor, assigned.workItemId)).toMatchObject({ state: 'completed', revision: 6 });
    expect(lab.collaboration!.read(actor, assigned.workItemId).submissions).toHaveLength(2);
  });

  it('returns missing-file errors without a card and permits a corrected call in the same Pi request', async () => {
    const { lab, fake } = await setup((_context, index) => index < 2 ? { tools: [{ name: 'work_item_action', arguments: { action: { kind: 'assign', payload: { assigneeSeatId: other.seatId, title: '工作', goal: '处理', inputPaths: [index ? '原稿.md' : '不存在.md'] } } } }] } : { text: '完成' });
    const workspace = lab.workspaces.get(); await writeFile(join(lab.files.filesDirectory(workspace.id), '原稿.md'), '原稿');
    const session = await lab.createSession(); const done = lab.start(session.id, '分派').run(() => {}); const item = await wait(lab, session.id);
    expect(lab.get(session.id).interactions).toHaveLength(1);
    const error = fake.calls[1].context.messages.find(message => message.role === 'toolResult');
    expect(error).toMatchObject({ isError: true, content: [{ type: 'text', text: expect.stringContaining('FILE_NOT_FOUND') }] });
    lab.respondInteraction(session.id, item.interactionId, approve(item)); await done;
    expect(lab.get(session.id).lastResult?.status).toBe('succeeded'); expect(lab.collaboration!.list(other)).toHaveLength(1);
  });

  it.each(['recipient', 'missing', 'path', 'extra'])('rejects invalid %s input before displaying a card', async kind => {
    const input = { kind: 'assign', payload: { assigneeSeatId: kind === 'recipient' ? 'unknown-seat' : other.seatId, title: '工作', goal: '处理', ...(kind === 'missing' ? { inputPaths: ['不存在.md'] } : kind === 'path' ? { inputPaths: ['../private'] } : {}) }, ...(kind === 'extra' ? { taskSpaceId: randomUUID() } : {}) };
    const { lab, fake } = await setup((_context, index) => index === 0 ? { tools: [{ name: 'work_item_action', arguments: { action: input } }] } : { text: '请修正输入' });
    const session = await lab.createSession(); await lab.start(session.id, '分派').run(() => {});
    expect(lab.get(session.id).interactions).toEqual([]); expect(lab.collaboration!.list(other)).toEqual([]);
    expect(lab.get(session.id).lastResult?.status).toBe('succeeded'); expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1].context.messages.find(message => message.role === 'toolResult')).toMatchObject({ isError: true });
    expect(Check(workActionToolSchema, { action: input })).toBe(kind !== 'extra');
    expect(Check(workActionToolSchema, { action: { kind: 'assign', payload: { ...input.payload, workspaceId: randomUUID() } } })).toBe(false);
  });

  it.each(['actor', 'revision', 'project'])('rejects a mismatched %s before confirmation', async kind => {
    const { lab, fake } = await setup((_context, index) => index === 0 ? { tools: [{ name: 'work_item_action', arguments: { action: input } }] } : { text: '已说明冲突' });
    const workspace = lab.workspaces.get();
    const receipt = await page(lab, actor.seatId, { kind: 'assign', taskSpaceId: workspace.taskSpaceId, payload: { workspaceId: workspace.id, assigneeSeatId: other.seatId, title: '工作', goal: '处理' } });
    const seatId = kind === 'actor' ? actor.seatId : other.seatId;
    const target = kind === 'project' ? await lab.workspaces.create('其他项目', undefined, other.seatId) : lab.workspaces.list(seatId).workspaces.find(w => w.taskSpaceId === workspace.taskSpaceId)!;
    const input: WorkActionInput = { kind: 'claim', workItemId: receipt.workItemId, expectedRevision: kind === 'revision' ? 50 : receipt.revision, payload: {} };
    const session = await lab.createSession(target.id, seatId); await lab.start(session.id, '签收', {}, seatId).run(() => {});
    expect(lab.get(session.id, seatId).interactions).toEqual([]); expect(lab.get(session.id, seatId).lastResult?.status).toBe('succeeded');
    expect(fake.calls[1].context.messages.find(message => message.role === 'toolResult')).toMatchObject({ isError: true, content: [{ type: 'text', text: expect.stringMatching(/WORK_(CONFLICT|NOT_FOUND)/) }] });
    expect(lab.collaboration!.read(actor, receipt.workItemId).state).toBe('assigned');
  });

  it('does not present a preparation that expired before the card', async () => {
    const { lab, fake } = await setup((_context, index) => index === 0 ? { tools: [{ name: 'work_item_action', arguments: { action: { kind: 'assign', payload: { assigneeSeatId: other.seatId, title: '工作', goal: '处理' } } } }] } : { text: '原操作已失效' });
    const prepare = lab.collaboration!.prepare.bind(lab.collaboration!);
    vi.spyOn(lab.collaboration!, 'prepare').mockImplementation(async (...args) => {
      const result = await prepare(...args); const origin = args[2];
      if (origin.source === 'agent') lab.collaboration!.endRequest(origin.sessionId, origin.requestId);
      return result;
    });
    const session = await lab.createSession(); await lab.start(session.id, '分派').run(() => {});
    expect(lab.get(session.id).interactions).toEqual([]); expect(lab.collaboration!.list(actor)).toEqual([]);
    expect(fake.calls[1].context.messages.find(message => message.role === 'toolResult')).toMatchObject({ isError: true, content: [{ type: 'text', text: expect.stringMatching(/WORK_CONFLICT:.*operationId=/) }] });
  });

  it('rechecks work revision after approval and retains the operation ID on failure', async () => {
    const { lab } = await setup((_context, index) => index === 0 ? { tools: [{ name: 'work_item_action', arguments: { action: input } }] } : { text: '状态已经变化' });
    const source = lab.workspaces.get();
    const assigned = await page(lab, actor.seatId, { kind: 'assign', taskSpaceId: source.taskSpaceId, payload: { workspaceId: source.id, assigneeSeatId: other.seatId, title: '工作', goal: '处理' } });
    const target = lab.workspaces.list(other.seatId).workspaces.find(w => w.taskSpaceId === source.taskSpaceId)!;
    const input: WorkActionInput = { kind: 'claim', workItemId: assigned.workItemId, expectedRevision: assigned.revision, payload: {} };
    const session = await lab.createSession(target.id, other.seatId); const done = lab.start(session.id, '签收', {}, other.seatId).run(() => {}); const item = await wait(lab, session.id, other.seatId);
    await page(lab, other.seatId, input);
    lab.respondInteraction(session.id, item.interactionId, approve(item), other.seatId); await done;
    expect(lab.get(session.id, other.seatId).interactions?.[0]).toMatchObject({ status: 'approved', execution: 'failed' });
    expect(lab.get(session.id, other.seatId).messages.find(message => message.role === 'tool')?.text).toMatch(`WORK_CONFLICT:`);
    expect(lab.get(session.id, other.seatId).messages.find(message => message.role === 'tool')?.text).toContain(item.action.handoff!.operationId);
    expect(lab.collaboration!.getAction(other, item.action.handoff!.operationId).receipt).toBeUndefined();
    expect(lab.collaboration!.read(other, assigned.workItemId).revision).toBe(2);
  });

  it('cancels during file preparation without creating a late card', async () => {
    const entered = barrier(); const release = barrier();
    const freeze = HandoffFiles.prototype.freeze;
    vi.spyOn(HandoffFiles.prototype, 'freeze').mockImplementation(async function (this: HandoffFiles, ...args) {
      entered.resolve(); await release.promise; return freeze.apply(this, args);
    });
    const { lab, fake } = await setup((_context, index) => index === 0 ? { tools: [{ name: 'work_item_action', arguments: { action: { kind: 'assign', payload: { assigneeSeatId: other.seatId, title: '工作', goal: '处理', inputPaths: ['原稿.md'] } } } }] } : { text: '不应调用' });
    await writeFile(join(lab.files.filesDirectory(lab.workspaces.get().id), '原稿.md'), '原稿');
    const session = await lab.createSession(); const run = lab.start(session.id, '分派'); const events: string[] = [];
    const done = run.run(event => { events.push(event.type); }); await entered.promise;
    lab.cancel(session.id, run.requestId); release.resolve(); await done;
    expect(lab.get(session.id).lastResult?.status).toBe('cancelled'); expect(lab.get(session.id).interactions).toEqual([]);
    expect(events).not.toContain('interaction.updated'); expect(lab.collaboration!.list(other)).toEqual([]); expect(fake.calls).toHaveLength(1);
  });

  it('cancels in the approval callback before authorizing or executing', async () => {
    const { lab, fake } = await setup((_context, index) => index === 0 ? { tools: [{ name: 'work_item_action', arguments: { action: { kind: 'assign', payload: { assigneeSeatId: other.seatId, title: '工作', goal: '处理' } } } }] } : { text: '不应调用' });
    const commit = vi.spyOn(lab.collaboration!, 'commitAgent');
    const session = await lab.createSession(); const run = lab.start(session.id, '分派');
    const done = run.run(event => { if (event.type === 'interaction.updated' && event.interaction.status === 'approved') lab.cancel(session.id, run.requestId); });
    const item = await wait(lab, session.id); lab.respondInteraction(session.id, item.interactionId, approve(item)); await done;
    expect(lab.get(session.id).lastResult?.status).toBe('cancelled'); expect(commit).not.toHaveBeenCalled();
    expect(lab.collaboration!.list(other)).toEqual([]); expect(fake.calls).toHaveLength(1);
    expect(lab.get(session.id).interactions?.[0]).toMatchObject({ status: 'approved', execution: 'not_started' });
  });

  it.each(['RESOURCE_STATE_INVALID', 'FILE_OPERATION_FAILED', 'DATABASE_FAILURE'])('stops on %s infrastructure failures instead of letting the model continue', async code => {
    const { lab, fake } = await setup((_context, index) => index === 0 ? { tools: [{ name: 'work_item_action', arguments: { action: { kind: 'assign', payload: { assigneeSeatId: other.seatId, title: '工作', goal: '处理' } } } }] } : { text: '不应继续' });
    vi.spyOn(lab.collaboration!, 'prepare').mockRejectedValue(code === 'DATABASE_FAILURE' ? new Error('DB failed') : new RequestError(code, '内部故障', 409));
    const session = await lab.createSession(); await lab.start(session.id, '分派').run(() => {});
    expect(lab.get(session.id).lastResult?.status).toBe('failed'); expect(fake.calls).toHaveLength(1);
    expect(lab.get(session.id).interactions).toEqual([]); expect(lab.collaboration!.list(other)).toEqual([]);
  });

  it.each(['before', 'after'] as const)('stops on a commit failure %s the transaction and preserves the actual receipt', async boundary => {
    const { lab, fake, config } = await setup((_context, index) => index === 0 ? { tools: [{ name: 'work_item_action', arguments: { action: { kind: 'assign', payload: { assigneeSeatId: other.seatId, title: '工作', goal: '处理' } } } }] } : { text: '不应继续' });
    const commit = lab.collaboration!.commitAgent.bind(lab.collaboration!);
    vi.spyOn(lab.collaboration!, 'commitAgent').mockImplementation(async (...args) => {
      if (boundary === 'after') await commit(...args);
      throw new Error('commit response failed');
    });
    const session = await lab.createSession(); const done = lab.start(session.id, '分派').run(() => {}); const item = await wait(lab, session.id);
    lab.respondInteraction(session.id, item.interactionId, approve(item)); await done;
    const operationId = item.action.handoff!.operationId;
    expect(lab.get(session.id).lastResult?.status).toBe('failed'); expect(fake.calls).toHaveLength(1);
    expect(lab.get(session.id).messages.find(message => message.role === 'tool')).toMatchObject({ isError: true, text: expect.stringContaining(`operationId=${operationId}`) });
    expect(lab.get(session.id).interactions?.[0]).toMatchObject({ status: 'approved', execution: 'failed' });
    expect(lab.collaboration!.getAction(actor, operationId).receipt !== undefined).toBe(boundary === 'after');
    expect(lab.collaboration!.list(other)).toHaveLength(boundary === 'after' ? 1 : 0);
    await lab.close(); const restored = await PiLab.create(config, fake.runtime); cleanup.push(() => restored.close());
    expect(restored.get(session.id).recoveryWarning).toBeUndefined();
    expect(restored.collaboration!.getAction(actor, operationId).receipt !== undefined).toBe(boundary === 'after');
    expect(restored.collaboration!.list(other)).toHaveLength(boundary === 'after' ? 1 : 0);
  });

  it.each(['completed', 'waiting', 'approved'] as const)('reads old prepare/commit %s history and continues with only the new tool registered', async boundary => {
    const { lab, fake, config } = await setup((_context, index) => index === 0
      ? { tools: [{ name: 'work_item_commit', arguments: { operationId: 'ff47ee75-a455-4116-912f-e62eada6707a' } }] }
      : index === 1 ? { tools: [{ name: 'work_item_action', arguments: { action: { kind: 'assign', payload: { assigneeSeatId: other.seatId, title: '新交接', goal: '新授权' } } } }] } : { text: '完成' });
    const session = await lab.createSession(); const directory = join(config.dataDir, 'sessions');
    const path = join(directory, (await readdir(directory))[0]); await lab.close();
    // Captured from baseline 047ab63 using the real Pi loop and deterministic model.
    // Only the owning session/workspace and local cwd change when loading the fixture.
    let text = await readFile(fileURLToPath(new URL('./fixtures/legacy-handoff.jsonl', import.meta.url)), 'utf8');
    text = text.replaceAll('01a0c952-9a53-714a-b83f-d99546f49d93', session.id).replaceAll('4dbc26bc-be31-476a-afb4-38200c7419d5', session.workspaceId);
    const entries = text.trim().split('\n').map(line => JSON.parse(line));
    const cut = boundary === 'completed' ? entries.length : entries.findIndex(entry => entry.type === 'custom' && entry.customType === (boundary === 'waiting' ? INTERACTION_REQUESTED : INTERACTION_RESOLVED)) + 1;
    const original = entries.slice(0, cut).map(entry => JSON.stringify(entry)).join('\n') + '\n';
    await writeFile(path, original);
    const restored = await PiLab.create(config, fake.runtime); cleanup.push(() => restored.close());
    expect(restored.get(session.id).interactions?.[0]).toMatchObject(boundary === 'completed' ? { status: 'approved', execution: 'succeeded' } : boundary === 'waiting' ? { status: 'expired' } : { status: 'approved', execution: 'unknown' });
    expect(restored.get(session.id).recoveryWarning).toBeUndefined(); expect(await readFile(path, 'utf8')).toBe(original);
    const done = restored.start(session.id, '继续办理新交接').run(() => {}); const item = await wait(restored, session.id);
    const provided = fake.calls[0].context.tools!.map(tool => tool.name);
    expect(provided).toContain('work_item_action'); expect(provided).not.toContain('work_item_prepare'); expect(provided).not.toContain('work_item_commit');
    expect(fake.calls[0].context.messages.some(message => message.role === 'toolResult' && message.toolName === 'work_item_prepare')).toBe(true);
    expect(fake.calls[1].context.messages.findLast(message => message.role === 'toolResult')).toMatchObject({ isError: true, content: [{ type: 'text', text: expect.stringContaining('not found') }] });
    expect(restored.collaboration!.list(other)).toEqual([]);
    restored.respondInteraction(session.id, item.interactionId, approve(item)); await done;
    expect(restored.collaboration!.list(other)).toHaveLength(1); expect(restored.get(session.id).interactions).toHaveLength(2);
    await restored.close(); const reopened = await PiLab.create(config, fake.runtime); cleanup.push(() => reopened.close());
    expect(reopened.get(session.id).interactions?.[1]).toMatchObject({ status: 'approved', execution: 'succeeded' });
  });

  it('rejects altered new action parameters, policy and receipt linkage during replay', async () => {
    const { lab, config } = await setup((_context, index) => index === 0 ? { tools: [{ name: 'work_item_action', arguments: { action: { kind: 'assign', payload: { assigneeSeatId: other.seatId, title: '工作', goal: '处理' } } } }] } : { text: '完成' });
    const session = await lab.createSession(); const done = lab.start(session.id, '分派').run(() => {}); const item = await wait(lab, session.id);
    lab.respondInteraction(session.id, item.interactionId, approve(item)); await done;
    const directory = join(config.dataDir, 'sessions'); const entries = SessionManager.open(join(directory, (await readdir(directory))[0]), directory).getBranch();
    for (const change of ['kind', 'parameters', 'policy', 'receipt'] as const) {
      const altered = structuredClone(entries);
      if (change === 'receipt') {
        const result = altered.find(entry => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolCallId === item.toolCallId)!;
        if (result.type !== 'message' || result.message.role !== 'toolResult') throw Error('result');
        (result.message.details as {operationId: string}).operationId = randomUUID();
      } else {
        const entry = altered.find(entry => entry.type === 'custom' && entry.customType === (change === 'policy' ? COMMAND_POLICY : INTERACTION_REQUESTED))!;
        if (entry.type !== 'custom') throw Error('entry');
        const data = entry.data as { policy: { decision: string }; interaction: ConfirmationInteraction };
        if (change === 'policy') data.policy.decision = 'allow';
        else if (change === 'kind') data.interaction.action.handoff!.kind = 'claim';
        else data.interaction.action.parameters = { operationId: item.action.handoff!.operationId };
      }
      expect(() => interactionHistory(altered, session.workspaceId, session.id, undefined, actor.seatId)).toThrow();
    }
  });

  it.each(['waiting', 'before', 'after'])('SIGKILL %s business commit preserves native unknown effects and queryable business truth', async boundary => {
    const dataDir = await mkdtemp(join(tmpdir(), 'axon-handoff-kill-')); cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./fixtures/handoff-crash.ts', import.meta.url)), dataDir, boundary], { stdio: ['ignore', 'pipe', 'pipe'] });
    let diagnostic = ''; child.stderr.on('data', chunk => { diagnostic += String(chunk); }); child.stdout.resume();
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    const exit = await new Promise<{code: number|null; signal: NodeJS.Signals|null}>((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve({code, signal})); }); clearTimeout(timer);
    expect(exit, diagnostic).toEqual({ code: null, signal: 'SIGKILL' });
    const checkpoint = JSON.parse(await readFile(join(dataDir, 'probe.json'), 'utf8')) as {sessionId: string; operationId: string};
    const names = await readdir(join(dataDir, 'sessions')); const path = join(dataDir, 'sessions', names[0]); const original = await readFile(path, 'utf8');
    const config = testConfig(dataDir, { seatId: actor.seatId, testSeats: seats }); const fake = await fakeRuntime(config, () => ({ text: '继续' }));
    const lab = await PiLab.create(config, fake.runtime); cleanup.push(() => lab.close());
    expect(await readFile(path, 'utf8')).toBe(original); expect(fake.calls).toHaveLength(0);
    expect(lab.get(checkpoint.sessionId).lastResult?.status).toBe('interrupted');
    expect(lab.get(checkpoint.sessionId).recoveryWarning).toBeUndefined();
    expect(lab.get(checkpoint.sessionId).interactions?.[0]).toMatchObject(boundary === 'waiting' ? { status: 'expired' } : { status: 'approved', execution: 'unknown' });
    const action = lab.collaboration!.getAction(actor, checkpoint.operationId);
    expect(action.status).toBe(boundary === 'after' ? 'committed' : 'expired');
    expect(lab.collaboration!.list(other)).toHaveLength(boundary === 'after' ? 1 : 0);
    await lab.start(checkpoint.sessionId, '继续，但先核对已完成的交接').run(() => {});
    expect(lab.get(checkpoint.sessionId).lastResult?.status).toBe('succeeded');
    expect(lab.collaboration!.list(other)).toHaveLength(boundary === 'after' ? 1 : 0);
  }, 20000);
});
