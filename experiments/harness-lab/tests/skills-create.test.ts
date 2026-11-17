import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { migrateAdministratorAccounts } from '../src/access/administrator-schema.js';
import type { AuthSession } from '../src/contracts/access.js';
import type { ManagedSkillDetail, SkillFileInput } from '../src/contracts/skills.js';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';

const file = (path: string, text: string): SkillFileInput => ({ path, contentBase64: Buffer.from(text).toString('base64') });
test('authenticated atomic creation preserves content, rejects invalid writes and replays the original receipt after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'axon-skill-create-'));
  const db = await openDatabase(dir), access = new AccessStore(db);
  await access.saveAccount({ username: 'business', displayName: '业务', seatId: 'business', seatName: '业务', password: 'test-password-123', createPublicTask: false, manageModelSettings: false });
  migrateAdministratorAccounts(db); await access.saveAdministratorAccount({ username: 'admin', displayName: '管理员', password: 'test-password-123' }); db.close();
  const config = testConfig(dir, { auth: { secret: 'test-only-signing-key-at-least-32-characters', sessionMs: 28800000 } });
  const fake = await fakeRuntime(config, () => ({ text: 'must not run' }));
  let lab = await PiLab.create(config, fake.runtime), app = await createApp(lab);
  async function login(username: string) {
    const first = await app.inject('/api/auth/session'), anonymous = first.json<AuthSession>();
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { cookie: first.cookies.map(c => `${c.name}=${c.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': anonymous.csrf! }, payload: { username, password: 'test-password-123' } });
    expect(response.statusCode, response.body).toBe(200); const session = response.json<AuthSession>();
    return { cookie: response.cookies.map(c => `${c.name}=${c.value}`).join('; '), origin: 'http://localhost:4310', 'x-csrf-token': session.csrf!, 'x-axon-view': session.viewId! };
  }
  const root = '/api/admin/capabilities/skills';
  try {
    let admin = await login('admin'); const business = await login('business');
    const files = [file('SKILL.md', '---\nname: atomic-method\ndescription: 完整内容创建\ncustom: retained\n---\n原始使用说明。\n'), file('assets/example.txt', '保留资源')];
    const input = { clientActionId: randomUUID(), files };
    const post = (headers: typeof admin, payload: object) => app.inject({ method: 'POST', url: root, headers, payload });
    const before = lab.skills.list().length;
    expect((await post(business, input)).statusCode).toBe(403);
    expect((await post(admin, { ...input, role: 'administrator' })).statusCode).toBe(400);
    expect(lab.skills.list()).toHaveLength(before);
    const responses = await Promise.all([post(admin, input), post(admin, input)]);
    for (const response of responses) expect(response.statusCode, response.body).toBe(200);
    const created = responses[0].json<ManagedSkillDetail>();
    expect(responses[1].json()).toEqual(created); expect(lab.skills.list()).toHaveLength(before + 1);
    expect(created.skill.name).toBe('atomic-method'); expect(created.draft!.files).toEqual(files);
    expect(created.audit.map(event => event.action)).toEqual(['created']); expect(created.publications).toEqual([]);
    expect(fake.calls).toHaveLength(0);
    await lab.skills.saveDraft({ userId: created.audit[0].userId, assertAdministrator: () => {} }, created.skill.skillId, { expectedDraftRevision: 1, files: [file('SKILL.md', '---\nname: later-draft\ndescription: changed\n---\n')] });
    expect((await post(admin, input)).json()).toEqual(created);
    expect((await post(admin, { ...input, files: [file('SKILL.md', '---\nname: changed\ndescription: different\n---\n')] })).statusCode).toBe(409);
    const bad = await post(admin, { clientActionId: randomUUID(), files: [file('SKILL.md', '---\nname: invalid name\ndescription: ""\n---\n')] });
    expect(bad.statusCode).toBe(400); expect(lab.skills.list()).toHaveLength(before + 1);
    expect((await post(admin, { clientActionId: randomUUID(), sourceSkillId: created.skill.skillId, files })).statusCode).toBe(400);
    const emptyBody = await post(admin, { clientActionId: randomUUID(), files: [file('SKILL.md', '---\nname: empty-instructions\ndescription: fill later\n---\n')] });
    expect(emptyBody.statusCode, emptyBody.body).toBe(200);
    const legacy = await post(admin, { clientActionId: randomUUID() }); expect(legacy.statusCode).toBe(200);
    const copy = await post(admin, { clientActionId: randomUUID(), sourceSkillId: created.skill.skillId }); expect(copy.statusCode, copy.body).toBe(200); expect(copy.json<ManagedSkillDetail>().skill.name).toBe('later-draft');
    const builtinCopy = await post(admin, { clientActionId: randomUUID(), sourceSkillId: 'review' }); expect(builtinCopy.statusCode, builtinCopy.body).toBe(200); const copied = builtinCopy.json<ManagedSkillDetail>();
    expect(copied.draft!.files.every(f => Object.keys(f).sort().join(',') === 'contentBase64,path')).toBe(true);
    const copiedFiles = copied.draft!.files.map(f => ({ ...f, contentBase64: f.path === 'SKILL.md' ? Buffer.from(Buffer.from(f.contentBase64, 'base64').toString() + '\n补充步骤').toString('base64') : f.contentBase64 }));
    const savedCopy = await app.inject({ method: 'PUT', url: root + '/' + copied.skill.skillId + '/draft', headers: admin, payload: { expectedDraftRevision: 1, files: copiedFiles } }); expect(savedCopy.statusCode, savedCopy.body).toBe(200);
    await app.close(); lab = await PiLab.create(config, fake.runtime); app = await createApp(lab); admin = await login('admin');
    expect((await post(admin, input)).json()).toEqual(created); expect(lab.skills.list()).toHaveLength(before + 5);
    expect(fake.calls).toHaveLength(0);
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
}, 30000);
