import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { CapabilityService } from '../src/capabilities/service.js';
import { CapabilityManagement } from '../src/capabilities/management.js';
import { SkillService } from '../src/skills/service.js';
import { AuthoringService, type AuthoringContext } from '../src/authoring/service.js';
import { proposalDigest } from '../src/authoring/integrity.js';
import { loadControlledSkills } from '../src/resources/service.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); });
const file = (path: string, text: string) => ({ path, contentBase64: Buffer.from(text).toString('base64') });
const method = (text = '原文') => file('SKILL.md', `---\nname: authoring-method\ndescription: 测试方法\nmetadata:\n  retained: yes\n# kept comment\n---\n${text}\n`);
const content = { name: '资料核对专家', description: '依据事实核对结果', instructions: '只根据已有事实说明。', skillIds: ['review'], allowedTools: ['read'] };
const grant = () => ({ interactionId: randomUUID(), toolCallId: randomUUID() });
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'axon-authoring-storage-'));
  const cap = await CapabilityService.open(dir); const controlled = await loadControlledSkills(['synthesis', 'review']); await cap.registerBuiltins({ skills: controlled, roles: [] });
  let authorized = true, active = true;
  const management = await CapabilityManagement.open(cap, { skills: () => controlled, tools: () => [{ id: 'read', name: '读取', group: 'read' }], seats: () => [], reauthorize: () => { if (!authorized) throw Error('revoked'); } });
  const skills = await SkillService.open(dir, { createdNew: true, scanner: async (_content, report) => ({ ...report, state: 'completed', completedAt: new Date().toISOString() }) });
  cleanup.push(async () => { skills.close(); cap.close(); await rm(dir, { recursive: true, force: true }); });
  const service = new AuthoringService(management, skills);
  const context: AuthoringContext = { actor: { userId: 'admin', assertAdministrator: () => { if (!authorized) throw Error('revoked'); } }, sessionId: 'session-a', requestId: 'request-a', assertActive: () => { if (!active) throw Error('stopped'); } };
  return { dir, cap, skills, management, service, context, revoke: () => { authorized = false; }, stop: () => { active = false; } };
}
async function skillProposal(env: Awaited<ReturnType<typeof setup>>) { return env.service.propose(env.context, { kind: 'skill', files: [method(), file('references/facts.txt', '保留\n')], summary: '创建方法' }); }

test('complete expert/skill creation persists original-service receipts and replay has one unpublished effect', async () => {
  const env = await setup();
  const expert = await env.service.propose(env.context, { kind: 'expert', content, summary: '创建专家' });
  expect(env.cap.db.prepare('SELECT count(*) n FROM r2_experts').get()?.n).toBe(0);
  const a = await env.service.commit(env.context, expert.proposalId, grant());
  expect(a).toMatchObject({ created: true, draftRevision: 1, proposalId: expert.proposalId });
  const detail = await env.management.get(a.targetId); expect(detail.draft?.content).toEqual(content); expect(detail.current).toBeNull(); expect(detail.expert.policy.mode).toBe('none');
  expect(await env.management.saveAuthoring(env.context.actor, expert, grant())).toEqual(a);
  const proposal = await skillProposal(env); const b = await env.service.commit(env.context, proposal.proposalId, grant());
  expect(env.skills.detail(b.targetId).draft?.files).toEqual(proposal.candidate.kind === 'skill' ? proposal.candidate.files : []);
  expect(env.skills.detail(b.targetId).publications).toEqual([]); expect(env.skills.detail(b.targetId).policy.revision).toBe(0);
  expect(await env.skills.saveAuthoring(env.context.actor, proposal, grant())).toEqual(b); expect(env.skills.list()).toHaveLength(1);
  const changed = structuredClone(proposal); changed.summary = '同一候选ID异参数'; const { proposalDigest: _old, ...body } = changed; void _old; changed.proposalDigest = proposalDigest(body);
  await expect(env.skills.saveAuthoring(env.context.actor, changed, grant())).rejects.toMatchObject({ statusCode: 409 });
  const restarted = new AuthoringService(env.management, env.skills);
  expect(restarted.receipt({ ...env.context, requestId: 'next' }, { kind: 'skill', proposalId: proposal.proposalId })).toEqual(b);
  expect(() => restarted.getProposal(env.context, proposal.proposalId)).toThrow('候选');
  expect(() => restarted.receipt({ ...env.context, sessionId: 'foreign' }, { kind: 'skill', proposalId: proposal.proposalId })).toThrow('当前对话');
  expect(restarted.receipt({ ...env.context, actor: { ...env.context.actor, userId: 'other' } }, { kind: 'skill', proposalId: proposal.proposalId })).toBeUndefined();
});

test('receipt insertion failure rolls back complete asset, draft and audit for both services', async () => {
  const env = await setup();
  const expert = await env.service.propose(env.context, { kind: 'expert', content, summary: '创建' });
  env.cap.db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON r2_actions BEGIN SELECT RAISE(ABORT,'receipt failure'); END;");
  await expect(env.service.commit(env.context, expert.proposalId, grant())).rejects.toThrow('receipt failure');
  expect(env.cap.db.prepare('SELECT count(*) n FROM r2_experts').get()?.n).toBe(0); expect(env.cap.db.prepare('SELECT count(*) n FROM r2_audit').get()?.n).toBe(0);
  env.cap.db.exec('DROP TRIGGER fail_receipt');
  const skill = await skillProposal(env);
  env.skills.db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON r3_skill_actions BEGIN SELECT RAISE(ABORT,'receipt failure'); END;");
  await expect(env.service.commit(env.context, skill.proposalId, grant())).rejects.toThrow('receipt failure');
  expect(env.skills.list()).toHaveLength(0); expect(env.skills.db.prepare('SELECT count(*) n FROM r3_skill_drafts').get()?.n).toBe(0); expect(env.skills.db.prepare('SELECT count(*) n FROM r3_skill_audit').get()?.n).toBe(0);
  env.skills.db.exec('DROP TRIGGER fail_receipt'); expect((await env.service.commit(env.context, skill.proposalId, grant())).created).toBe(true);
});

test('patch preserves other files and concurrent changes conflict without a receipt', async () => {
  const env = await setup(); const p = await skillProposal(env); const created = await env.service.commit(env.context, p.proposalId, grant());
  const read = await env.service.read(env.context, { kind: 'skill', targetId: created.targetId });
  const patch = await env.service.propose(env.context, { kind: 'skill', targetId: created.targetId, baseline: read.baseline!, files: [method('只改正文')], summary: '仅正文' });
  const result = await env.service.commit(env.context, patch.proposalId, grant());
  expect(result.draftRevision).toBe(2); expect(env.skills.detail(created.targetId).draft?.files[1]).toEqual(file('references/facts.txt', '保留\n'));
  const latest = await env.service.read(env.context, { kind: 'skill', targetId: created.targetId });
  const stale = await env.service.propose(env.context, { kind: 'skill', targetId: created.targetId, baseline: latest.baseline!, files: [method('候选')], summary: '候选' });
  await env.skills.saveDraft(env.context.actor, created.targetId, { expectedDraftRevision: 2, files: [method('他人')] });
  await expect(env.service.commit(env.context, stale.proposalId, grant())).rejects.toMatchObject({ statusCode: 409 });
  expect(env.service.receipt(env.context, { kind: 'skill', proposalId: stale.proposalId })).toBeUndefined(); expect(env.skills.detail(created.targetId).draft?.files).toEqual([method('他人')]);
});

test('unknown references, forged fields, scripts and superseded candidates cannot save', async () => {
  const env = await setup();
  await expect(env.service.propose(env.context, { kind: 'expert', content: { ...content, allowedTools: ['unknown'] }, summary: 'bad' })).rejects.toThrow('真实目录');
  await expect(env.service.propose(env.context, { kind: 'expert', content, summary: 'bad', approved: true } as never)).rejects.toThrow('参数');
  await expect(env.service.propose(env.context, { kind: 'skill', files: [method(), file('scripts/run.py', 'print(1)')], summary: 'script' })).rejects.toMatchObject({ code: 'AUTHORING_METHOD_ONLY' });
  const old = await env.service.propose(env.context, { kind: 'expert', content, summary: '专家候选' }); const next = await skillProposal(env);
  expect(() => env.service.getProposal(env.context, old.proposalId)).toThrow('切换');
  const tampered = structuredClone(next); tampered.summary = 'tampered'; await expect(env.skills.saveAuthoring(env.context.actor, tampered, grant())).rejects.toThrow('候选');
  expect(env.skills.list()).toHaveLength(0);
});

test('stop and revocation block current proposals while immutable receipt queries never replay', async () => {
  const env = await setup(); const proposal = await skillProposal(env); env.stop();
  await expect(env.service.commit(env.context, proposal.proposalId, grant())).rejects.toThrow('stopped'); expect(env.skills.list()).toHaveLength(0);
  const revoked = await setup(); const candidate = await skillProposal(revoked); revoked.revoke();
  await expect(revoked.service.commit(revoked.context, candidate.proposalId, grant())).rejects.toThrow('revoked'); expect(revoked.skills.list()).toHaveLength(0);
});

test('expert field patch keeps instructions and references; stale revision/digest never overwrite', async () => {
  const env = await setup();
  const proposal = await env.service.propose(env.context, { kind: 'expert', content, summary: '初稿' }); const created = await env.service.commit(env.context, proposal.proposalId, grant());
  const before = await env.service.read(env.context, { kind: 'expert', targetId: created.targetId });
  const update = await env.service.propose(env.context, { kind: 'expert', targetId: created.targetId, baseline: before.baseline!, content: { description: '只修改简介' }, summary: '仅简介' });
  const saved = await env.service.commit(env.context, update.proposalId, grant());
  expect((await env.management.get(created.targetId)).draft?.content).toEqual({ ...content, description: '只修改简介' });
  expect(saved.draftRevision).toBe(2);
  const current = await env.service.read(env.context, { kind: 'expert', targetId: created.targetId });
  const pending = await env.service.propose(env.context, { kind: 'expert', targetId: created.targetId, baseline: current.baseline!, content: { name: '候选名字' }, summary: '待确认' });
  await env.management.save(env.context.actor, created.targetId, { expectedDraftRevision: 2, content: { ...content, name: '另一位的名字' } });
  await expect(env.service.commit(env.context, pending.proposalId, grant())).rejects.toMatchObject({ statusCode: 409 });
  expect(env.service.receipt(env.context, { kind: 'expert', proposalId: pending.proposalId })).toBeUndefined();
  expect((await env.management.get(created.targetId)).draft?.content.name).toBe('另一位的名字');
});

test('cannot erase executable files to disguise an existing package as method-only', async () => {
  const env = await setup(); const created = await env.skills.create(env.context.actor, { clientActionId: randomUUID(), files: [method(), file('scripts/run.py', 'print(1)')] });
  const read = await env.service.read(env.context, { kind: 'skill', targetId: created.skill.skillId });
  await expect(env.service.propose(env.context, { kind: 'skill', targetId: created.skill.skillId, baseline: read.baseline!, files: [method('方法')], removePaths: ['scripts/run.py'], summary: '删脚本' })).rejects.toMatchObject({ code: 'AUTHORING_METHOD_ONLY' });
  expect(env.skills.detail(created.skill.skillId).draft?.files).toEqual(created.draft?.files);
});

test('dependency manifests remain manual-only while ordinary references are allowed', async () => {
  const env = await setup();
  for (const path of ['environment.yml', 'environment.dev.yaml', 'conda-lock.yml', 'pnpm-workspace.yaml', 'composer.json', 'npm-shrinkwrap.json', 'bower.json', 'deno.json', 'jsr.json', 'references/package.json', '.npmrc', 'Pipfile', 'unknown', 'settings.toml']) {
    await expect(env.service.propose(env.context, { kind: 'skill', files: [method(), file(path, '{}')], summary: '安装配置' }), path).rejects.toMatchObject({ code: 'AUTHORING_METHOD_ONLY' });
  }
  expect(env.skills.list()).toHaveLength(0);
  const proposal = await env.service.propose(env.context, { kind: 'skill', files: [method(), file('references/setup.md', '说明 package.json，不执行安装。')], summary: '普通参考文本' });
  expect(proposal.candidate.kind).toBe('skill');
});

test('a fresh service can query a committed receipt after database reopen without restoring a proposal', async () => {
  const env = await setup(); const p = await skillProposal(env); const saved = await env.service.commit(env.context, p.proposalId, grant());
  env.skills.close();
  const reopened = await SkillService.open(env.dir); const service = new AuthoringService(env.management, reopened);
  try {
    expect(service.receipt({ ...env.context, requestId: 'new-request' }, { kind: 'skill', proposalId: p.proposalId })).toEqual(saved);
    expect(reopened.detail(saved.targetId).draft?.draftRevision).toBe(1);
    expect(() => service.getProposal(env.context, p.proposalId)).toThrow('候选');
    expect(reopened.list()).toHaveLength(1);
  } finally { reopened.close(); }
});

test('methodBody preserves frontmatter comments, extensions, CRLF and other file bytes', async () => {
  const env=await setup();
  const prefix='---\r\nname: authoring-method\r\ndescription: 保真方法\r\nlicense: Apache-2.0\r\nmetadata:\r\n  owner: "原作者"\r\n# retained comment\r\nx-custom: unchanged\r\n---\r\n';
  const body='原正文\r\n';
  const created=await env.skills.create(env.context.actor,{clientActionId:randomUUID(),files:[file('SKILL.md',prefix+body),file('references/facts.txt','保留字节\r\n')]});
  let read=await env.service.read(env.context,{kind:'skill',targetId:created.skill.skillId});
  const unchanged=await env.service.propose(env.context,{kind:'skill',targetId:created.skill.skillId,baseline:read.baseline!,methodBody:body,summary:'未修改'});
  expect(unchanged.candidate.kind==='skill'&&unchanged.candidate.files).toEqual(created.draft?.files);
  await expect(env.service.propose(env.context,{kind:'skill',methodBody:'新建不能只给正文',summary:'bad'})).rejects.toMatchObject({code:'INVALID_INPUT'});
  for(const extra of [{files:[method()]},{removePaths:['SKILL.md']}]) await expect(env.service.propose(env.context,{kind:'skill',targetId:created.skill.skillId,baseline:read.baseline!,methodBody:'新正文',summary:'冲突',...extra})).rejects.toMatchObject({code:'INVALID_INPUT'});
  const proposal=await env.service.propose(env.context,{kind:'skill',targetId:created.skill.skillId,baseline:read.baseline!,methodBody:'新正文\n',summary:'仅正文'});
  const result=await env.service.commit(env.context,proposal.proposalId,grant());
  expect(result.draftRevision).toBe(2);
  const current=env.skills.detail(created.skill.skillId).draft!;
  expect(Buffer.from(current.files[0].contentBase64,'base64').toString()).toBe(prefix+'新正文\n');
  expect(current.files[1]).toEqual(created.draft?.files[1]);
  read=await env.service.read(env.context,{kind:'skill',targetId:created.skill.skillId});
  const noop=await env.service.propose(env.context,{kind:'skill',targetId:created.skill.skillId,baseline:read.baseline!,methodBody:'新正文\n',summary:'无变更'});
  expect((await env.service.commit(env.context,noop.proposalId,grant())).draftRevision).toBe(2);
});
