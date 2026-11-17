import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapabilityService, GENERAL_EXPERT_ID, SYNTHESIS_EXPERT_ID, canonicalJson, capabilityDigest, skillRevision, type ControlledSkill, type ExpertDefinition } from '../src/capabilities/service.js';
import { hashContent } from '../src/resources/files.js';

const directories: string[] = [];
const services = new Set<CapabilityService>();
afterEach(async () => {
  for (const service of services) service.close(); services.clear();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
const skill = (id: string, content = `# ${id}\n固定的方法正文。`): ControlledSkill => ({ id, name: id, description: `${id} 方法`, version: '1', content, hash: hashContent(content) });
const definition = (instructions = '固定专家指令', skills: ControlledSkill[] = []): ExpertDefinition => ({
  expertId: 'test-expert', releaseVersion: '1.0.0', name: '测试专家', description: '用于独立数据验证', instructions,
  modes: ['interactive'], selectable: true, system: true, allowedTools: ['source_read', 'skill_read'], skills,
});
async function open(directory?: string, maxCacheBytes?: number) {
  directory ??= await mkdtemp(join(tmpdir(), 'axon-capabilities-')); if (!directories.includes(directory)) directories.push(directory);
  const service = await CapabilityService.open(directory, { maxCacheBytes }); services.add(service);
  return { service, directory };
}
function close(service: CapabilityService) { service.close(); services.delete(service); }

describe('immutable capability registrations and snapshots', () => {
  it('uses deterministic key normalization without silently converting unsupported JSON', () => {
    expect(canonicalJson({ z: 2, a: { y: true, x: ['b', 'a'] } })).toBe('{"a":{"x":["b","a"],"y":true},"z":2}');
    expect(capabilityDigest({ a: 1, b: 2 })).toBe(capabilityDigest({ b: 2, a: 1 }));
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson(Number.NaN)).toThrow();
  });
  it('is idempotent by actual content, preserves prior revisions and locks skill metadata/body', async () => {
    const { service, directory } = await open();
    const first = await service.registerExpert(definition('第一版', [skill('synthesis')]));
    const same = await service.registerExpert({ ...definition('第一版', [skill('synthesis')]), allowedTools: ['skill_read', 'source_read'] });
    expect(same).toEqual(first);
    const next = await service.registerExpert(definition('第二版', [skill('synthesis', '# synthesis\n更新的方法。')]));
    expect(next.releaseVersion).toBe(first.releaseVersion);
    expect(next.revisionId).not.toBe(first.revisionId);
    expect(next.skills[0].revisionId).not.toBe(first.skills[0].revisionId);
    expect(await service.current('test-expert')).toEqual(next);
    close(service);
    const reopened = (await open(directory)).service;
    expect(await reopened.resolve(first, first.digest)).toEqual(first);
    expect(await reopened.resolve(next, next.digest)).toEqual(next);
    expect(reopened.sessionExpert(first)).toMatchObject({ updateAvailable: true, currentRevisionId: next.revisionId });
    expect((await reopened.adminSummary()).revisions).toBe(2);
  });
  it('exposes only the professional example, preserving general and delegated tool scopes', async () => {
    const { service } = await open();
    await service.registerBuiltins({ skills: [skill('synthesis'), skill('review')], roles: [
      { name: 'analyst', description: '分析', tools: ['source_read'], systemPrompt: '只读分析', hash: hashContent('只读分析') },
      { name: 'reviewer', description: '检查', tools: [], systemPrompt: '只读检查', hash: hashContent('只读检查') },
    ] });
    expect((await service.list()).map(item => item.expertId)).toEqual([SYNTHESIS_EXPERT_ID]);
    expect((await service.current()).expertId).toBe(GENERAL_EXPERT_ID);
    expect((await service.current()).allowedTools).toBeNull();
    expect((await service.current('role-analyst')).allowedTools).toEqual(['source_read']);
    expect((await service.current('role-reviewer')).modes).toEqual(['delegated']);
    await expect(service.detail(GENERAL_EXPERT_ID)).rejects.toMatchObject({ code: 'EXPERT_NOT_FOUND' });
    await expect(service.detail('role-analyst')).rejects.toMatchObject({ code: 'EXPERT_NOT_FOUND' });
    expect((await service.detail(SYNTHESIS_EXPERT_ID)).dependencies.map(item => item.id)).toEqual(['review', 'synthesis']);
  });
  it('fails closed for corrupt expert content, missing dependency blob, wrong digest and missing revision', async () => {
    const { service, directory } = await open();
    const first = await service.registerExpert(definition('正文', [skill('synthesis')]));
    await expect(service.resolve(first, '0'.repeat(64))).rejects.toMatchObject({ code: 'CAPABILITY_STATE_INVALID' });
    await expect(service.resolve({ expertId: first.expertId, revisionId: `rev-${'0'.repeat(64)}` })).rejects.toMatchObject({ code: 'CAPABILITY_STATE_INVALID' });
    const expertPath = join(directory, 'capabilities', 'blobs', first.digest);
    const original = await readFile(expertPath, 'utf8');
    await chmod(expertPath, 0o600); await writeFile(expertPath, original.replace('正文', '篡改'));
    await expect(service.resolve(first)).rejects.toMatchObject({ code: 'CAPABILITY_STATE_INVALID' });
    await writeFile(expertPath, original);
    await unlink(join(directory, 'capabilities', 'blobs', first.skills[0].digest));
    await expect(service.resolve(first)).rejects.toMatchObject({ code: 'CAPABILITY_STATE_INVALID' });
    await expect(service.registerExpert(definition('正文', [skill('synthesis')]))).rejects.toMatchObject({ code: 'CAPABILITY_STATE_INVALID' });
  });
  it('uses a byte-bounded LRU and returns copies without sharing a caller mutation', async () => {
    const { service } = await open(undefined, 1800);
    const first = await service.registerExpert(definition('a'.repeat(400)));
    const second = await service.registerExpert(definition('b'.repeat(400)));
    const loaded = await service.resolve(first);
    loaded.instructions = 'caller-private';
    expect((await service.resolve(first)).instructions).toBe('a'.repeat(400));
    await service.resolve(second);
    expect(service.metrics().cacheBytes).toBeLessThanOrEqual(1800);
    expect(service.metrics().cacheEntries).toBeLessThan(3);
    expect(service.metrics().hits).toBeGreaterThan(0);
    expect(service.metrics().misses).toBeGreaterThan(0);
  });
});

describe('current capability authority and admitted requests', () => {
  it('allows ordinary-disabled admitted work to finish but rejects new work and cancels after a ban', async () => {
    const { service } = await open();
    const revision = await service.registerExpert(definition());
    const cancel = vi.fn();
    const release = service.acceptRequest({ requestId: 'accepted', ref: revision, principalId: 'user-a', cancel });
    await service.resolve(revision); // Warm content cache must never retain authority.
    service.setState(revision, 'disabled', '维护');
    expect(() => service.assertAdmission(revision, 'user-a')).toThrow();
    expect(() => service.assertCall('accepted')).not.toThrow();
    expect(service.sessionExpert(revision).availability).toEqual({ available: false, state: 'disabled', reason: '维护' });
    service.setState(revision, 'banned', '紧急封禁');
    expect(cancel).toHaveBeenCalledOnce();
    expect(() => service.assertCall('accepted')).toThrow();
    release(); expect(() => service.assertCall('accepted')).toThrow();
  });
  it('revokes one principal without changing immutable content or other users', async () => {
    const { service } = await open();
    const revision = await service.registerExpert(definition());
    const cancelA = vi.fn(), cancelB = vi.fn();
    service.acceptRequest({ requestId: 'a', ref: revision, principalId: 'user-a', cancel: cancelA });
    service.acceptRequest({ requestId: 'b', ref: revision, principalId: 'user-b', cancel: cancelB });
    service.setAccess('user-a', revision.expertId, false);
    expect(cancelA).toHaveBeenCalledOnce(); expect(cancelB).not.toHaveBeenCalled();
    expect(() => service.assertCall('a')).toThrow(); expect(() => service.assertCall('b')).not.toThrow();
    expect((await service.resolve(revision)).digest).toBe(revision.digest);
    expect(service.sessionExpert(revision, 'user-a').availability.available).toBe(false);
  });
  it('guards dependency changes and rejects a conflicting optional skill revision', async () => {
    const { service } = await open();
    const revision = await service.registerExpert(definition('', [skill('synthesis')]));
    const cancel = vi.fn();
    service.acceptRequest({ requestId: 'a', ref: revision, skills: revision.skills, cancel });
    service.setState({ expertId: 'synthesis', revisionId: revision.skills[0].revisionId }, 'disabled');
    expect(() => service.assertCall('a')).not.toThrow();
    expect(() => service.attachRequestSkills('a', [revision.skills[0]])).not.toThrow();
    expect(() => service.attachRequestSkills('a', [skillRevision(skill('synthesis', '新正文'))])).toThrow();
    service.setState({ expertId: 'review' }, 'disabled');
    expect(() => service.attachRequestSkills('a', [skillRevision(skill('review'))])).toThrow();
    service.setState({ expertId: 'synthesis' }, 'banned');
    expect(cancel).toHaveBeenCalledOnce(); expect(() => service.assertCall('a')).toThrow();
    expect(service.sessionExpert(revision).availability.available).toBe(false);
  });
});

describe('durable creation intents and explicit legacy migration', () => {
  it('serializes same-action concurrency, conflicts on changed input and retries the original revision after restart', async () => {
    const { service, directory } = await open();
    const first = await service.registerExpert(definition('v1'));
    const action = { principalId: 'user-a', clientActionId: randomUUID(), input: { workspaceId: randomUUID() }, expertRef: { expertId: first.expertId, revisionId: first.revisionId }, expectedDigest: first.digest };
    const [a, b] = await Promise.all([service.reserveCreation(action), service.reserveCreation(action)]);
    expect(a).toEqual(b);
    await service.registerExpert(definition('v2'));
    service.completeCreation(action.principalId, action.clientActionId);
    close(service);
    const reopened = (await open(directory)).service;
    const retry = await reopened.reserveCreation(action);
    expect(retry).toMatchObject({ sessionId: a.sessionId, expertRef: a.expertRef, state: 'completed' });
    await expect(reopened.reserveCreation({ ...action, input: { workspaceId: randomUUID() } })).rejects.toMatchObject({ code: 'SESSION_CREATION_CONFLICT', statusCode: 409 });
    await expect(reopened.reserveCreation({ ...action, principalId: 'user-b' })).rejects.toMatchObject({ code: 'EXPERT_CHANGED' });
    await expect(reopened.reserveCreation({ ...action, clientActionId: randomUUID() })).rejects.toMatchObject({ code: 'EXPERT_CHANGED' });
  });
  it('resolves general only on the first action and preserves blocked outcomes', async () => {
    const { service } = await open();
    await service.registerBuiltins({ skills: [skill('synthesis'), skill('review')], roles: [] });
    const input = { principalId: 'user-a', clientActionId: randomUUID(), input: {} };
    const original = await service.reserveCreation(input);
    expect(original.expertRef.expertId).toBe(GENERAL_EXPERT_ID);
    service.markCreationBlocked(input.principalId, input.clientActionId);
    expect(await service.reserveCreation(input)).toMatchObject({ sessionId: original.sessionId, state: 'blocked' });
  });
  it('honors a host-preallocated session ID and rejects a changed retry ID or malformed durable intent', async () => {
    const { service } = await open();
    await service.registerBuiltins({ skills: [skill('synthesis'), skill('review')], roles: [] });
    const action = { principalId: 'user-a', clientActionId: randomUUID(), input: {}, sessionId: randomUUID() };
    expect((await service.reserveCreation(action)).sessionId).toBe(action.sessionId);
    expect((await service.reserveCreation(action)).sessionId).toBe(action.sessionId);
    await expect(service.reserveCreation({ ...action, sessionId: randomUUID() })).rejects.toMatchObject({ code: 'SESSION_CREATION_CONFLICT' });
    service.db.prepare('UPDATE creation_intents SET data=?').run(JSON.stringify({ ...service.findCreation(action.principalId, action.clientActionId), state: 'forged' }));
    expect(() => service.findCreation(action.principalId, action.clientActionId)).toThrow();
  });
  it('never guesses legacy ownership and blocks prepared migration until resumed with matching input', async () => {
    const { service, directory } = await open();
    const legacy = { sessionId: randomUUID(), workspaceId: randomUUID(), seatId: 'seat-a' };
    expect(service.isLegacySession(legacy.sessionId, legacy.workspaceId, legacy.seatId)).toBe(false);
    const digest = capabilityDigest([legacy]);
    service.beginMigration(digest); service.registerLegacySessions([legacy]); service.registerLegacySessions([legacy]);
    expect(service.isLegacySession(legacy.sessionId, legacy.workspaceId, 'seat-b')).toBe(false);
    expect(() => service.registerLegacySessions([{ ...legacy, seatId: 'seat-b' }])).toThrow();
    close(service);
    await expect(CapabilityService.open(directory)).rejects.toMatchObject({ code: 'CAPABILITY_MIGRATION_REQUIRED' });
    const resume = await CapabilityService.open(directory, { allowPrepared: true }); services.add(resume);
    expect(() => resume.beginMigration('0'.repeat(64))).toThrow();
    resume.beginMigration(digest); resume.completeMigration(digest); close(resume);
    const reopened = (await open(directory)).service;
    expect(reopened.isLegacySession(legacy.sessionId, legacy.workspaceId, legacy.seatId)).toBe(true);
    expect(reopened.migrationStatus()).toEqual({ state: 'completed', inputDigest: digest });
  });
});
