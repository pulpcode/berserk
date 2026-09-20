import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Context } from '@earendil-works/pi-ai';
import { PiLab } from '../../src/pi/lab.js';
import { fakeRuntime, testConfig, type Reply } from './fake-runtime.js';
import type { WorkAction, WorkPrepareInput, ConfirmationInteraction, WorkReceipt } from '../../src/contracts/index.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const seats = [{ id: 'test-seat', name: '席位 A' }, { id: 'seat-b', name: '席位 B' }];
const actor = { seatId: 'test-seat' };
const other = { seatId: 'seat-b' };
function lastAction(context: Context): WorkAction {
  const message = context.messages.findLast(message => message.role === 'toolResult' && message.toolName === 'work_item_prepare');
  if (!message || message.role !== 'toolResult' || message.isError) throw new Error('Missing prepared action');
  return message.details as WorkAction;
}
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
    const { lab, fake, config } = await setup((context, index) => index === 0 ? { tools: [{ name: 'work_item_prepare', arguments: { action: input } }] }
      : index === 1 ? { tools: [{ name: 'work_item_commit', arguments: { operationId: lastAction(context).operationId } }] } : { text: '分派已完成' });
    const workspace = lab.workspaces.get();
    await writeFile(join(lab.files.filesDirectory(workspace.id), '任务书.txt'), '确认时的任务书');
    const input: WorkPrepareInput = { kind: 'assign', taskSpaceId: workspace.taskSpaceId, payload: { workspaceId: workspace.id, assigneeSeatId: other.seatId, title: '编制方案', goal: '结合任务书提出方案', inputPaths: ['任务书.txt'] } };
    const session = await lab.createSession(); const request = lab.start(session.id, '将任务书分派给席位B'); const done = request.run(() => {});
    const item = await wait(lab, session.id); const fixed = item.action.handoff!;
    expect(fixed.files).toHaveLength(1); expect(item.action.parameters).toEqual({ operationId: fixed.operationId });
    expect(lab.collaboration!.list(other)).toEqual([]);
    await expect(lab.collaboration!.commitPage(actor, fixed.operationId)).rejects.toThrow(/原对话/);
    expect(() => lab.get(session.id, other.seatId)).toThrow(/不存在/);
    expect(() => lab.respondInteraction(session.id, item.interactionId, approve(item), other.seatId)).toThrow(/不存在/);
    await writeFile(join(lab.files.filesDirectory(workspace.id), '任务书.txt'), '之后修改的普通文件');
    lab.respondInteraction(session.id, item.interactionId, approve(item)); await done;
    expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
    expect(lab.get(session.id).interactions?.[0]).toMatchObject({ status: 'approved', execution: 'succeeded' });
    const work = lab.collaboration!.list(other)[0]; expect(work.state).toBe('assigned');
    expect(await bytes(lab, other.seatId, fixed.files[0].fileId)).toBe('确认时的任务书');
    expect(fake.calls).toHaveLength(3);
    const calls = fake.calls.length; await lab.close(); const restored = await PiLab.create(config, fake.runtime); cleanup.push(() => restored.close());
    expect(restored.get(session.id).interactions?.[0]).toMatchObject({ status: 'approved', execution: 'succeeded' });
    expect(restored.get(session.id).recoveryWarning).toBeUndefined();
    expect(restored.collaboration!.getAction(actor, fixed.operationId).receipt?.workItemId).toBe(work.id);
    expect(fake.calls).toHaveLength(calls);
  });

  it.each(['reject', 'cancel'])('%s does not hand off files and ends uncommitted preparations', async decision => {
    const { lab } = await setup((context, index) => index === 0 ? { tools: [{ name: 'work_item_prepare', arguments: { action: input } }] }
      : index === 1 ? { tools: [{ name: 'work_item_commit', arguments: { operationId: lastAction(context).operationId } }] } : { text: '未分派' });
    const workspace = lab.workspaces.get(); const input: WorkPrepareInput = { kind: 'assign', taskSpaceId: workspace.taskSpaceId, payload: { workspaceId: workspace.id, assigneeSeatId: other.seatId, title: '工作', goal: '不要产生效果' } };
    const session = await lab.createSession(); const run = lab.start(session.id, '分派'); const done = run.run(() => {}); const item = await wait(lab, session.id);
    if (decision === 'cancel') lab.cancel(session.id, run.requestId); else lab.respondInteraction(session.id, item.interactionId, approve(item, 'reject'));
    await done;
    expect(lab.collaboration!.list(actor)).toEqual([]);
    expect(lab.collaboration!.getAction(actor, item.action.handoff!.operationId).status).toBe('expired');
    expect(lab.get(session.id).interactions?.[0].status).toBe(decision === 'cancel' ? 'cancelled' : 'rejected');
  });

  it('assignee uses its own files and work context, and receipt queries do not re-execute a submission', async () => {
    let operationId = '';
    const { lab, fake } = await setup((context, index) => {
      if (index === 0) return { tools: [{ name: 'work_item_prepare', arguments: { action: input } }] };
      if (index === 1) { operationId = lastAction(context).operationId; return { tools: [{ name: 'work_item_commit', arguments: { operationId } }] }; }
      if (index === 3) return { tools: [{ name: 'work_item_read', arguments: { operationId } }] };
      return { text: '已处理' };
    });
    const source = lab.workspaces.get();
    const assigned = await page(lab, actor.seatId, { kind: 'assign', taskSpaceId: source.taskSpaceId, payload: { workspaceId: source.id, assigneeSeatId: other.seatId, title: '检查数据', goal: '必须核对交通信息' } });
    await page(lab, other.seatId, { kind: 'claim', workItemId: assigned.workItemId, expectedRevision: assigned.revision, payload: {} });
    const target = lab.workspaces.list(other.seatId).workspaces.find(w => w.taskSpaceId === source.taskSpaceId)!;
    await writeFile(join(lab.files.filesDirectory(target.id, other.seatId), '方案.md'), 'B的方案');
    await writeFile(join(lab.files.filesDirectory(source.id), '方案.md'), 'A的私有方案');
    const work = lab.collaboration!.read(other, assigned.workItemId);
    const input: WorkPrepareInput = { kind: 'submit', workItemId: work.id, expectedRevision: work.revision, payload: { workspaceId: target.id, path: '/workspace/方案.md' } };
    const session = await lab.createSession(target.id, other.seatId, work.id);
    const done = lab.start(session.id, '上报方案', {}, other.seatId).run(() => {}); const item = await wait(lab, session.id, other.seatId);
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
    expect(fake.calls[0].context.tools?.some(tool => tool.name === 'work_item_commit')).toBe(true);
    expect(fake.calls[1].context.tools?.some(tool => tool.name.startsWith('work_item') || tool.name === 'handoff_import_file')).toBe(false);
    expect(lab.get(session.id).subagents?.[0].status).toBe('succeeded');
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
