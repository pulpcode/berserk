import { mkdtemp, rm, readFile, writeFile, symlink, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { ResourceService } from '../src/resources/service.js';
import { hashContent, parseJsonStrict, type WriteHooks } from '../src/resources/files.js';
import { WorkspaceStore } from '../src/workspaces/store.js';
const cleanup: string[] = [];
afterEach(async () => { for (const dir of cleanup.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function setup(hooks: WriteHooks = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'berserk-resources-')); cleanup.push(dir);
  const store = await WorkspaceStore.open(dir);
  const id = store.list().defaultWorkspaceId;
  return { dir, store, id, resources: new ResourceService(store, hooks), file: join(store.directory(id), 'AGENTS.md') };
}
describe('workspace storage and controlled resources', () => {
  it('rejects duplicate ownership keys including escaped equivalents', () => {
    expect(() => parseJsonStrict('{"sessionBindings":{"id":"first","id":"second"}}')).toThrow();
    expect(() => parseJsonStrict('{"id":1,"\\u0069d":2}')).toThrow();
    expect(parseJsonStrict('{"a":{"id":1},"b":{"id":2}}')).toEqual({ a: { id: 1 }, b: { id: 2 } });
  });
  it('persists named workspaces and fixed bindings; corrupt/missing indexes never recreate', async () => {
    const { dir, store } = await setup();
    const workspace = await store.create('  验证空间  ');
    expect(workspace.name).toBe('验证空间');
    await store.bind('12345678-1234-1234-1234-123456789abc', workspace.id);
    await expect(store.bind('12345678-1234-1234-1234-123456789abc', workspace.id)).rejects.toMatchObject({ code: 'RESOURCE_STATE_INVALID' });
    const reopened = await WorkspaceStore.open(dir);
    expect(reopened.list().workspaces).toContainEqual(workspace);
    expect(reopened.binding('12345678-1234-1234-1234-123456789abc')).toBe(workspace.id);
    await expect(store.create(' '.repeat(3))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await writeFile(join(dir, 'workspace-index.json'), '{broken');
    await expect(store.create('拒绝')).rejects.toMatchObject({ code: 'RESOURCE_STATE_INVALID' });
    await expect(WorkspaceStore.open(dir)).rejects.toMatchObject({ code: 'RESOURCE_STATE_INVALID' });
    await unlink(join(dir, 'workspace-index.json'));
    await expect(WorkspaceStore.open(dir)).rejects.toMatchObject({ code: 'RESOURCE_STATE_INVALID' });
  });
  it('serializes CAS writers, preserves UTF-8 BOM bytes, and distinguishes missing and empty', async () => {
    const { id, file, resources } = await setup();
    const original = '\ufeff使用中文\r\n'; await writeFile(file, original);
    const initial = await resources.readInstruction(id, 'workspace');
    expect(initial.content).toBe(original); expect(initial.hash).toBe(hashContent(original));
    const results = await Promise.allSettled(['甲', '乙'].map(content => resources.updateInstruction(id, 'workspace', content, initial.hash)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const current = await resources.readInstruction(id, 'workspace');
    expect(await resources.updateInstruction(id, 'workspace', current.content, initial.hash)).toMatchObject({ status: 'unchanged' });
    await expect(resources.updateInstruction(id, 'common', '', null)).rejects.toMatchObject({ code: 'RESOURCE_READ_ONLY' });
    await unlink(file);
    expect(await resources.readInstruction(id, 'workspace')).toMatchObject({ content: '', hash: null });
    expect(await resources.updateInstruction(id, 'workspace', '', null)).toMatchObject({ status: 'updated', previousHash: null, hash: hashContent('') });
    expect(await readFile(file, 'utf8')).toBe('');
  });
  it('does not commit cancellation before rename and settles committed writes after cancellation', async () => {
    const before = new AbortController();
    const first = await setup({ beforeRename: async () => before.abort() });
    const initial = await first.resources.readInstruction(first.id, 'workspace');
    await expect(first.resources.updateInstruction(first.id, 'workspace', '不能写入', initial.hash, before.signal)).rejects.toThrow();
    expect(await readFile(first.file, 'utf8')).toBe('');
    const after = new AbortController();
    const second = await setup({ afterRename: async () => { after.abort(); throw new Error('rename acknowledgement lost'); } });
    const result = await second.resources.updateInstruction(second.id, 'workspace', '已经提交', hashContent(''), after.signal);
    expect(result).toMatchObject({ status: 'updated', hash: hashContent('已经提交') });
    expect(await readFile(second.file, 'utf8')).toBe('已经提交');
    expect(await second.resources.updateInstruction(second.id, 'workspace', '已经提交', hashContent(''))).toMatchObject({ status: 'unchanged' });
  });
  it('does not alter originals on write faults and reports uncertain outcomes when readback fails', async () => {
    const first = await setup({ beforeRename: async () => { throw new Error('disk failure'); } });
    await expect(first.resources.updateInstruction(first.id, 'workspace', '目标', hashContent(''))).rejects.toMatchObject({ code: 'RESOURCE_LOAD_FAILED' });
    expect(await readFile(first.file, 'utf8')).toBe('');
    const second = await setup({ afterRename: async () => { await unlink(second.file); await mkdir(second.file); throw new Error('unknown state'); } });
    await expect(second.resources.updateInstruction(second.id, 'workspace', '目标', hashContent(''))).rejects.toMatchObject({ code: 'INSTRUCTION_OUTCOME_UNCERTAIN' });
  });
  it('rejects traversals, symlinks at leaf and directory, oversized UTF-8 and malformed UTF-8', async () => {
    const { dir, id, file, store, resources } = await setup();
    await expect(resources.readInstruction(id, '../../AGENTS.md')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(resources.readSkill(id, '../review')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(resources.updateInstruction(id, 'workspace', '界'.repeat(6000), hashContent(''))).rejects.toMatchObject({ code: 'RESOURCE_TOO_LARGE' });
    const outside = join(dir, 'secret'); await writeFile(outside, 'SECRET');
    await unlink(file); await symlink(outside, file);
    await expect(resources.snapshot(id)).rejects.toMatchObject({ code: 'RESOURCE_STATE_INVALID' });
    await expect(resources.updateInstruction(id, 'workspace', 'SECRET', null)).rejects.toMatchObject({ code: 'RESOURCE_STATE_INVALID' });
    await unlink(file); await writeFile(file, Buffer.from([0xff]));
    await expect(resources.snapshot(id)).rejects.toMatchObject({ code: 'RESOURCE_LOAD_FAILED' });
    await writeFile(file, 'x'.repeat(16385));
    await expect(resources.snapshot(id)).rejects.toMatchObject({ code: 'RESOURCE_TOO_LARGE' });
    await writeFile(file, '');
    const sources = join(store.directory(id), 'sources'); await rm(sources, { recursive: true }); await symlink(dir, sources);
    await expect(resources.snapshot(id)).rejects.toMatchObject({ code: 'RESOURCE_STATE_INVALID' });
  });
});
