import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import { PiLab } from '../../src/pi/lab.js';
import { createApp } from '../../src/server/app.js';
import { COMPOSER_INPUT, composerInputText } from '../../src/pi/composer-input.js';
import { FILE_INPUT } from '../../src/pi/file-history.js';
import { CHILD_ORIGIN, SUBAGENT_START } from '../../src/pi/subagent-history.js';
import { validateHistoryEvidence } from '../../src/pi/history-evidence.js';
import { RESOURCE_ENTRY, SKILL_ENTRY } from '../../src/pi/resource-tools.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';
import type { ComposerSelection } from '../../src/contracts/index.js';
import type { LabConfig } from '../../src/server/config.js';
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup(reply: Parameters<typeof fakeRuntime>[1] = () => ({ text: '已完成' }), overrides: Partial<LabConfig> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-composer-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const config = testConfig(dir, overrides); const fake = await fakeRuntime(config, reply);
  const lab = await PiLab.create(config, fake.runtime); cleanup.push(() => lab.close());
  const session = await lab.createSession(); const skill = await lab.resources.readSkill(session.workspaceId, 'review');
  const agents = await lab.agents(session.workspaceId);
  return { config, lab, session, skill, agents, ...fake };
}
async function ask(lab: PiLab, id: string, input: ComposerSelection & { fileRefs?: {path: string}[] } = {}) {
  const request = lab.start(id, '请检查指定方案的事实和遗漏', input); await request.run(() => {}); return lab.get(id);
}
async function parentFile(config: LabConfig) { const dir = join(config.dataDir, 'sessions'); return join(dir, (await readdir(dir))[0]); }
async function restart(config: LabConfig) { const next = await PiLab.create(config, (await fakeRuntime(config, () => ({ text: '继续' }))).runtime); cleanup.push(() => next.close()); return next; }

describe('controlled composer inputs through native Pi sessions', () => {
  it('loads explicit Skill once without a synthetic tool call and retains its exact version after restart', async () => {
    const { lab, config, calls, session, skill } = await setup();
    const snapshot = await ask(lab, session.id, { skill });
    expect(snapshot.lastResult?.status).toBe('succeeded');
    expect(snapshot.messages[0]).toMatchObject({ text: '请检查指定方案的事实和遗漏', selections: { skill } });
    expect(calls).toHaveLength(1); expect(calls[0].context.messages[0]).toMatchObject({ role: 'user', content: [{ type: 'text', text: composerInputText({ skill }) }] });
    expect(calls[0].context.messages.at(-1)).toMatchObject({ role: 'user', content: [{ type: 'text', text: '请检查指定方案的事实和遗漏' }] });
    expect(snapshot.messages.some(message => message.role === 'tool')).toBe(false);
    const raw = await readFile(await parentFile(config), 'utf8'); expect(raw).toContain(COMPOSER_INPUT); expect(raw).not.toContain(SKILL_ENTRY);
    expect(lab.getRequestResources(session.id, snapshot.messages[0].requestId!)).toMatchObject({ readSkills: [] });
    await lab.close(); const next = await restart(config);
    expect(next.get(session.id).messages).toEqual(snapshot.messages);
    const continued = await ask(next, session.id);
    expect(continued.messages.filter(message => message.role === 'user').at(-1)?.selections).toBeUndefined();
  });

  it.each(['skill', 'agent'] as const)('rejects stale %s before model work and releases the session', async kind => {
    const { lab, session, calls, skill, agents } = await setup();
    const input = kind === 'skill' ? { skill: { id: skill.id, hash: '0'.repeat(64) } } : { agent: { name: agents[0].name, hash: '0'.repeat(64) } };
    const snapshot = await ask(lab, session.id, input);
    expect(snapshot.lastResult).toMatchObject({ status: 'failed', message: expect.stringContaining('重新选择') });
    expect(snapshot.active).toBeNull(); expect(snapshot.messages).toHaveLength(0); expect(calls).toHaveLength(0);
    expect((await ask(lab, session.id)).lastResult?.status).toBe('succeeded');
  });

  it('keeps autonomous skill_read and unselected text behavior unchanged', async () => {
    const { lab, session, calls, skill } = await setup((_context, index) => index === 0 ? { tools: [{ name: 'skill_read', arguments: { id: 'review' } }] } : { text: '已检查' });
    const snapshot = await ask(lab, session.id);
    expect(snapshot.messages[0].selections).toBeUndefined();
    expect(JSON.stringify(calls[0].context.messages)).not.toContain(skill.content);
    expect(snapshot.messages.some(message => message.toolName === 'skill.read')).toBe(true);
    expect(lab.getRequestResources(session.id, snapshot.messages[0].requestId!)).toMatchObject({ readSkills: [skill] });
  });

  it.each(['analyst', 'reviewer'])('passes Skill and file references to selected %s without expanding tool permissions', async roleName => {
    const { lab, config, session, calls, skill, agents } = await setup((_context, index) => index === 0
      ? { tools: [{ name: 'subagent', arguments: { agent: roleName, task: '仅检查附件，返回问题' } }] }
      : { text: index === 1 ? '子任务检查结果' : '主会话汇总' });
    await lab.files.prepareWorkspace(session.workspaceId); await writeFile(join(lab.files.filesDirectory(session.workspaceId), '方案.md'), '方案原文');
    const agent = agents.find(role => role.name === roleName)!;
    const snapshot = await ask(lab, session.id, { skill, agent, fileRefs: [{ path: '方案.md' }] });
    expect(snapshot.lastResult?.status).toBe('succeeded'); expect(snapshot.subagents?.[0].status).toBe('succeeded');
    expect(calls).toHaveLength(3); // Parent delegation, child reply, parent synthesis; no corrective request.
    const parentInput = JSON.stringify(calls[0].context.messages);
    expect(parentInput).toContain('所选 Skill 也用于本次子任务');
    expect(parentInput).toContain('保留其检查步骤与输出要求');
    expect(parentInput).toContain('不另行规定与之冲突的输出格式');
    const child = calls[1].context;
    // The child's loaded method must not instruct it to recursively delegate.
    expect(JSON.stringify(child.messages)).not.toContain('委派 task 时');
    expect(JSON.stringify(child.messages)).toContain('方案.md'); expect(JSON.stringify(child.messages)).toContain('所选 Skill 正文已经加载');
    expect(JSON.stringify(child.messages)).not.toContain('请检查指定方案的事实和遗漏');
    const names = child.tools?.map(tool => tool.name) ?? [];
    expect(names).toEqual(roleName === 'analyst' ? ['source_list', 'source_read', 'instructions_read'] : ['source_list', 'source_read', 'instructions_read', 'skill_read']);
    expect(child.messages.at(-1)).toMatchObject({ role: 'user', content: [{ type: 'text', text: '仅检查附件，返回问题' }] });
    expect(names.includes('skill_read')).toBe(roleName === 'reviewer');
    expect(snapshot.messages[0].selections).toEqual({ skill, agent });
    await lab.close(); const next = await restart(config);
    expect(next.get(session.id).recoveryWarning).toBeUndefined();
    expect(next.get(session.id).subagents).toEqual(snapshot.subagents);
  });

  it('does not copy selected inputs to a different autonomous child and does not manufacture delegation on clarification', async () => {
    const { lab, session, calls, skill, agents } = await setup((_context, index) => index === 0
      ? { tools: [{ name: 'subagent', arguments: { agent: 'reviewer', task: '独立检查' } }] }
      : { text: '请补充目标' });
    await ask(lab, session.id, { skill, agent: agents.find(role => role.name === 'analyst')! });
    expect(JSON.stringify(calls[1].context.messages)).not.toContain('所选 Skill 正文已经加载');
    const next = await lab.createSession(); const snapshot = await ask(lab, next.id, { agent: agents[0] });
    expect(snapshot.messages[0].selections?.agent).toEqual(agents[0]); expect(snapshot.subagents).toBeUndefined();
  });

  it('preserves stopped preparation evidence without replaying a selection on the next request', async () => {
    const { lab, session, calls, skill, agents } = await setup();
    const original = AgentSession.prototype.sendCustomMessage;
    const request = lab.start(session.id, '检查', { skill, agent: agents[0] });
    const spy = vi.spyOn(AgentSession.prototype, 'sendCustomMessage').mockImplementation(async function (this: AgentSession, message, options) {
      await original.call(this, message, options);
      if (message.customType === COMPOSER_INPUT) lab.cancel(session.id, request.requestId);
    });
    await request.run(() => {}); spy.mockRestore();
    expect(lab.get(session.id).lastResult?.status).toBe('cancelled'); expect(calls).toHaveLength(0);
    expect(lab.get(session.id).messages).toHaveLength(0);
    const next = await ask(lab, session.id);
    expect(next.messages[0].selections).toBeUndefined(); expect(next.subagents).toBeUndefined();
    expect(calls).toHaveLength(1);
    // Native historical input remains (as designed), with its scope explicit and no host replay.
    expect(JSON.stringify(calls[0].context.messages)).toContain('不执行该选择');
  });

  it('cancels selected child work without re-delegating after restart', async () => {
    const { lab, session, calls, skill, agents, config } = await setup((_context, index) => index === 0
      ? { tools: [{ name: 'subagent', arguments: { agent: 'analyst', task: '检查' } }] } : { waitForAbort: true });
    const request = lab.start(session.id, '检查', { skill, agent: agents.find(agent => agent.name === 'analyst') }); const work = request.run(() => {});
    await vi.waitFor(() => expect(calls).toHaveLength(2)); lab.cancel(session.id, request.requestId); await work;
    expect(lab.get(session.id).subagents?.[0].status).toBe('cancelled');
    await lab.close(); const next = await restart(config);
    expect(next.get(session.id).recoveryWarning).toBeUndefined(); expect(next.get(session.id).subagents?.[0].status).toBe('cancelled');
  });

  it.each(['foreign', 'duplicate', 'body', 'late', 'unknown-key'])('rejects %s composer evidence without rewriting files', async mode => {
    const { lab, config, session, skill } = await setup(); await ask(lab, session.id, { skill }); await lab.close();
    const file = await parentFile(config); const lines = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const entry = lines.find(line => line.customType === COMPOSER_INPUT);
    if (mode === 'foreign') entry.details.sessionId = '00000000-0000-4000-8000-000000000000';
    if (mode === 'body') entry.content += 'other';
    if (mode === 'unknown-key') entry.details.permissions = ['bash'];
    if (mode === 'duplicate' || mode === 'late') {
      const manager = SessionManager.open(file);
      manager.appendCustomMessageEntry(COMPOSER_INPUT, entry.content, false, entry.details);
    } else await writeFile(file, lines.map(line => JSON.stringify(line)).join('\n') + '\n');
    const before = await readFile(file, 'utf8');
    const next = await restart(config); expect(() => next.get(session.id)).toThrow(); expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('rejects duplicate input before the user message and a late input within the active request', async () => {
    const { lab, config, session, skill } = await setup(); await ask(lab, session.id, { skill });
    const entries = SessionManager.open(await parentFile(config)).getBranch();
    const index = entries.findIndex(entry => entry.type === 'custom_message' && entry.customType === COMPOSER_INPUT);
    expect(index).toBeGreaterThanOrEqual(0);
    const duplicate = [...entries.slice(0, index), entries[index], ...entries.slice(index)];
    expect(() => validateHistoryEvidence(duplicate, session.workspaceId, session.id)).toThrow();
    const late = [...entries.slice(0, index), entries[index + 1], entries[index], ...entries.slice(index + 2)];
    expect(() => validateHistoryEvidence(late, session.workspaceId, session.id)).toThrow();
  });

  it('retains original selected Skill and role history through native automatic compaction and restart', async () => {
    const { lab, config, session, skill, agents, calls } = await setup(context => ({ text: context.tools?.length ? '长回复'.repeat(500) : '摘要：已检查方案，继续回答用户。', usageInput: context.tools?.length ? 1800 : 50 }),
      { contextWindow: 8192, maxOutputTokens: 6000, compactionReserveTokens: 7000, compactionKeepRecentTokens: 128 });
    await ask(lab, session.id, { skill, agent: agents[0] });
    const snapshot = await ask(lab, session.id);
    expect(snapshot.lastResult?.status).toBe('succeeded'); expect(snapshot.latestCompaction).toBeDefined();
    expect(calls.some(call => !call.context.tools?.length)).toBe(true);
    expect(snapshot.messages.find(message => message.role === 'user')?.selections).toEqual({ skill, agent: agents[0] });
    await lab.close(); const next = await restart(config);
    expect(next.get(session.id).messages).toEqual(snapshot.messages);
    expect(next.get(session.id).latestCompaction).toEqual(snapshot.latestCompaction);
  });

  it('blocks altered child inputs even when their standalone hash and native body remain valid', async () => {
    const { lab, config, session, skill, agents } = await setup((_context, index) => index === 0
      ? { tools: [{ name: 'subagent', arguments: { agent: 'analyst', task: '检查' } }] } : { text: '完成' });
    const snapshot = await ask(lab, session.id, { skill, agent: agents.find(agent => agent.name === 'analyst') }); await lab.close();
    const dir = join(config.dataDir, 'subagents', session.id, snapshot.subagents![0].subagentId); const file = join(dir, (await readdir(dir))[0]);
    const lines = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const entry = lines.find(line => line.customType === COMPOSER_INPUT); entry.details.skill.name = '伪造方法'; entry.content = composerInputText(entry.details);
    // Also update local catalogue to demonstrate parent/origin consistency checks are required.
    lines.find(line => line.customType === RESOURCE_ENTRY).data.skills.find((item: {id: string}) => item.id === 'review').name = '伪造方法';
    await writeFile(file, lines.map(line => JSON.stringify(line)).join('\n') + '\n');
    const next = await restart(config); expect(next.get(session.id).recoveryWarning).toContain('不一致');
    expect(next.get(session.id).subagents![0].status).toBe('interrupted');
  });

  it('retains selected input agreement in both parent start and child origin', async () => {
    const { lab, config, session, skill, agents } = await setup((_context, index) => index === 0
      ? { tools: [{ name: 'subagent', arguments: { agent: 'analyst', task: '检查' } }] } : { text: '完成' });
    const snapshot = await ask(lab, session.id, { skill, agent: agents.find(agent => agent.name === 'analyst') }); await lab.close();
    const parent = (await readFile(await parentFile(config), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const start = parent.find(line => line.customType === SUBAGENT_START).data;
    const dir = join(config.dataDir, 'subagents', session.id, snapshot.subagents![0].subagentId);
    const child = (await readFile(join(dir, (await readdir(dir))[0]), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(child.find(line => line.customType === CHILD_ORIGIN).data).toEqual(start);
    expect(start.input).toEqual({ skill, files: [] }); expect(child.some(line => line.customType === FILE_INPUT)).toBe(false);
  });
});

describe('composer HTTP scope and ordinary file input limits', () => {
  it('returns only role metadata and rejects foreign scope or extra selection authority', async () => {
    const { lab, session, agents, skill } = await setup(undefined, { seatId: 'seat-a', testSeats: [{id:'seat-a',name:'A'}, {id:'seat-b',name:'B'}] });
    const app = await createApp(lab); cleanup.push(() => app.close());
    const base = '/api/test-seats/seat-a'; const url = `${base}/workspaces/${session.workspaceId}/agents`;
    expect((await app.inject(url)).json()).toEqual(agents);
    expect((await app.inject(url.replace('seat-a', 'seat-b'))).statusCode).toBe(404);
    expect((await app.inject(`${url}?seatId=seat-b`)).statusCode).toBe(400);
    for (const payload of [{ skill: { id: skill.id, hash: skill.hash, content: 'override' } }, { agent: { ...agents[0], tools: ['bash'] } }]) {
      expect((await app.inject({ method: 'POST', url: `${base}/sessions/${session.id}/messages`, payload: { text: '检查', ...payload } })).statusCode).toBe(400);
    }
    const response = await app.inject({ method: 'POST', url: `${base}/sessions/${session.id}/messages`, payload: { text: '检查', skill: { id: skill.id, hash: skill.hash } } });
    expect(response.statusCode).toBe(200); expect(response.body).toContain('response.completed');
  });

  it('deduplicates completed uploads and path references before enforcing the combined cap', async () => {
    const { lab, session } = await setup(undefined, { fileLimits: { maxAttachments: 1, maxFileBytes: 1024 } });
    const upload = await lab.files.createUpload(session.workspaceId, {name:'方案.md',size:3});
    const saved = await lab.files.receiveUpload(session.workspaceId, upload.uploadId, Readable.from([Buffer.from('abc')]));
    const input = { uploadIds: [upload.uploadId], fileRefs: [{path:saved.path!}] };
    expect(await lab.files.resolveInputs(session.workspaceId, input)).toHaveLength(1);
    const app = await createApp(lab); cleanup.push(() => app.close());
    const response = await app.inject({method:'POST',url:`/api/sessions/${session.id}/messages`,payload:{text:'检查',...input}});
    expect(response.body).toContain('response.completed'); expect(lab.get(session.id).messages[0].attachments).toHaveLength(1);
    const repeated = await app.inject({method:'POST',url:`/api/sessions/${session.id}/messages`,payload:{text:'检查',fileRefs:[{path:saved.path!},{path:saved.path!}]}});
    expect(repeated.body).toContain('response.completed');
    await writeFile(join(lab.files.filesDirectory(session.workspaceId), 'other.md'), 'different');
    await expect(lab.files.resolveInputs(session.workspaceId, { ...input, fileRefs: [{path:'other.md'}] })).rejects.toMatchObject({code:'INVALID_INPUT'});
  });
});
