import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { loadAgentRoles } from '../../src/pi/roles.js';
import { hashContent } from '../../src/resources/files.js';

const dirs: string[] = [];
async function directory() { const dir = await mkdtemp(join(tmpdir(), 'berserk-roles-')); dirs.push(dir); return dir; }
function role(name = 'analyst', tools = 'source_read', extra = '') {
  return `---\nname: ${name}\ndescription: 检查资料\ntools: ${tools}\n${extra}---\n只读取资料并返回事实。\n`;
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe('controlled multi-role configuration', () => {
  it('loads shipped roles with different tool sets and unchanged byte hashes', async () => {
    const roles = await loadAgentRoles();
    expect(roles.map(item => item.name).sort()).toEqual(['analyst', 'reviewer']);
    expect(roles.find(item => item.name === 'analyst')?.tools).not.toContain('skill_read');
    expect(roles.find(item => item.name === 'reviewer')?.tools).toContain('skill_read');
    expect(roles.every(item => Object.isFrozen(item) && Object.isFrozen(item.tools))).toBe(true);
  });
  it('loads added roles without code changes, accepts tools=[] and keeps captured versions', async () => {
    const dir = await directory(); const original = role();
    await writeFile(join(dir, 'one.md'), original);
    const before = await loadAgentRoles(dir);
    await writeFile(join(dir, 'one.md'), role('analyst', 'instructions_read'));
    await writeFile(join(dir, 'two.md'), role('formatter', '[]'));
    const after = await loadAgentRoles(dir);
    expect(before[0].tools).toEqual(['source_read']);
    expect(before[0].hash).toBe(hashContent(original));
    expect(after[0].hash).not.toBe(before[0].hash);
    expect(after.find(item => item.name === 'formatter')?.tools).toEqual([]);
    await rm(join(dir, 'one.md'));
    expect((await loadAgentRoles(dir)).map(item => item.name)).toEqual(['formatter']);
    expect(before[0].systemPrompt).toContain('只读取');
  });
  it.each([
    role('reviewer', 'instructions_update'), role('reviewer', 'bash'), role('reviewer', 'subagent'),
    role('reviewer', '[source_read, unknown]'), role('reviewer', 'source_read, source_read'),
    role('reviewer', ''), role().replace('tools: source_read\n', ''),
    role('../escape'), role('reviewer', 'source_read', 'model: another-model\n'),
    role('reviewer', 'source_read', 'name: duplicate\n'), role().replace('检查资料', ''),
    '---\n- invalid\n---\ntext', role().replace('只读取资料并返回事实。', ''),
  ])('rejects malformed or authority-expanding definitions (%#)', async content => {
    const dir = await directory(); await writeFile(join(dir, 'role.md'), content);
    await expect(loadAgentRoles(dir)).rejects.toMatchObject({ code: 'ROLE_CONFIG_INVALID' });
  });
  it('rejects duplicate names and an empty directory', async () => {
    const dir = await directory(); await expect(loadAgentRoles(dir)).rejects.toMatchObject({ code: 'ROLE_CONFIG_INVALID' });
    await writeFile(join(dir, 'a.md'), role()); await writeFile(join(dir, 'b.md'), role());
    await expect(loadAgentRoles(dir)).rejects.toMatchObject({ code: 'ROLE_CONFIG_INVALID' });
  });
  it('rejects symlinks, invalid UTF-8 and oversized files without exposing paths', async () => {
    const dir = await directory(); const outside = await directory();
    await writeFile(join(outside, 'real.md'), role()); await symlink(join(outside, 'real.md'), join(dir, 'alias.md'));
    await expect(loadAgentRoles(dir)).rejects.toMatchObject({ code: 'ROLE_CONFIG_INVALID' });
    await rm(join(dir, 'alias.md')); await writeFile(join(dir, 'role.md'), Buffer.from([0xff, 0xfe]));
    await expect(loadAgentRoles(dir)).rejects.toMatchObject({ code: 'ROLE_CONFIG_INVALID' });
    await writeFile(join(dir, 'role.md'), role() + 'x'.repeat(65536));
    await expect(loadAgentRoles(dir)).rejects.toMatchObject({ code: 'ROLE_CONFIG_INVALID' });
    await expect(loadAgentRoles('/missing/private-role-directory')).rejects.not.toThrow('/missing/private-role-directory');
  });
  it('observes cancellation before role preparation', async () => {
    const controller = new AbortController(); controller.abort(new Error('stopped'));
    await expect(loadAgentRoles(undefined, controller.signal)).rejects.toThrow('stopped');
  });
});
