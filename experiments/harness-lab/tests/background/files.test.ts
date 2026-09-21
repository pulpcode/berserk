import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { BackgroundFiles } from '../../src/background/files.js';
const dirs: string[] = [];
afterEach(async () => { for (const path of dirs.splice(0)) await rm(path, {recursive: true, force: true}); });
async function fixture() { const dir = await mkdtemp(join(tmpdir(), 'axon-background-files-')); dirs.push(dir); const files = new BackgroundFiles(dir, 64, 2); await files.initialize(); return {dir, files}; }
describe('background fixed inputs', () => {
  it('isolates source upload IDs, checks actual bytes and imports without replacing existing files', async () => {
    const {dir, files} = await fixture();
    const upload = await files.create('source-a', '资料.txt', 3);
    await expect(files.receive('source-b', upload.uploadId, Readable.from(['abc']))).rejects.toMatchObject({code: 'UPLOAD_NOT_FOUND'});
    await expect(files.resolve('source-a', [upload.uploadId])).rejects.toMatchObject({code: 'UPLOAD_INCOMPLETE'});
    await files.receive('source-a', upload.uploadId, Readable.from([Buffer.from('abc')]));
    const [copy] = await files.resolve('source-a', [upload.uploadId]);
    const root = join(dir, 'workspace'); await mkdir(root);
    await files.copies.import(copy, root, '资料.txt');
    await files.copies.import(copy, root, '资料.txt');
    await writeFile(join(root, '资料.txt'), 'changed');
    await expect(files.copies.import(copy, root, '资料.txt')).rejects.toMatchObject({code: 'FILE_EXISTS'});
    expect(await readFile(join(root, '资料.txt'), 'utf8')).toBe('changed');
    const stream = await files.copies.open(copy); let text = ''; for await (const chunk of stream.stream) text += chunk;
    expect(text).toBe('abc');
  });
  it('rejects a completed upload receipt redirected to another fixed file', async () => {
    const {files} = await fixture();
    const first = await files.create('a','first.txt',3), second = await files.create('b','second.txt',3);
    await files.receive('a',first.uploadId,Readable.from([Buffer.from('aaa')]));
    await files.receive('b',second.uploadId,Readable.from([Buffer.from('bbb')]));
    const original = await files.get('a',first.uploadId), foreign = await files.get('b',second.uploadId);
    await writeFile(join(files.root,'uploads',`${first.uploadId}.json`),JSON.stringify({...original,file:foreign.file}));
    await expect(files.resolve('a',[first.uploadId])).rejects.toThrow();
    await expect(files.initialize()).rejects.toThrow();
  });
  it('rejects overlong/incomplete uploads and symlink imports', async () => {
    const {dir, files} = await fixture();
    for (const name of ['../x', 'a/b', 'a\\b']) await expect(files.create('a', name, 1)).rejects.toMatchObject({code: 'INVALID_INPUT'});
    const upload = await files.create('a', 'x', 1);
    await expect(files.receive('a', upload.uploadId, Readable.from([Buffer.from('xx')]))).rejects.toMatchObject({code: 'FILE_TOO_LARGE'});
    expect((await files.get('a', upload.uploadId)).state).toBe('failed');
    const empty = await files.create('a', 'empty', 0); await files.receive('a', empty.uploadId, Readable.from([]));
    const [copy] = await files.resolve('a', [empty.uploadId]);
    const root = join(dir, 'workspace'); await mkdir(root); await symlink(tmpdir(), join(root, 'escape'));
    await expect(files.copies.import(copy, root, 'escape/x')).rejects.toMatchObject({code: 'FILE_UNSAFE_FILE'});
  });
});
