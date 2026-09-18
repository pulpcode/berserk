import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile, symlink, mkdir, unlink, rename, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceStore } from '../../src/workspaces/store.js';
import { FileService } from '../../src/files/service.js';
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, {recursive: true, force: true}); });
async function setup(maxFileBytes = 1024 * 1024) {
  const dir = await mkdtemp(join(tmpdir(), 'berserk-files-')); dirs.push(dir);
  const workspaces = await WorkspaceStore.open(dir); const workspaceId = workspaces.list().defaultWorkspaceId;
  const files = new FileService(workspaces, {maxFileBytes}); await files.initialize();
  return {dir, workspaces, workspaceId, files, root: files.filesDirectory(workspaceId)};
}
async function contents(stream: Readable) { let out = ''; for await (const chunk of stream) out += String(chunk); return out; }
describe('ordinary workspace file storage', () => {
  it('publishes simultaneous same-name uploads without overwrite, retains them after chip cancellation, resolves current contents', async () => {
    const {files, workspaceId, root} = await setup();
    const [a,b] = await Promise.all([files.createUpload(workspaceId, {name:'方案.md', size:3}), files.createUpload(workspaceId, {name:'方案.md', size:3})]);
    const saved = await Promise.all([files.receiveUpload(workspaceId,a.uploadId,Readable.from([Buffer.from('one')])),files.receiveUpload(workspaceId,b.uploadId,Readable.from([Buffer.from('two')]))]);
    expect(new Set(saved.map(item => item.path)).size).toBe(2);
    expect(await contents((await files.openContent(workspaceId,saved[0].path!)).stream)).toBe('one');
    expect((await files.cancelUpload(workspaceId,a.uploadId)).status).toBe('completed');
    await writeFile(join(root,saved[0].path!), 'modified');
    expect((await files.resolveInputs(workspaceId,{uploadIds:[a.uploadId]}))[0].size).toBe(8);
    await unlink(join(root,saved[0].path!));
    await expect(files.resolveInputs(workspaceId,{uploadIds:[a.uploadId]})).rejects.toMatchObject({code:'FILE_NOT_FOUND'});
  });
  it('rejects traversal, symlink ancestors/leaves and special files while listing ordinary files', async () => {
    const {files, workspaceId, dir,root} = await setup();
    await mkdir(join(root,'nested')); await writeFile(join(root,'nested','ok.txt'),'ok');
    await writeFile(join(dir,'secret'),'secret'); await symlink(join(dir,'secret'),join(root,'link')); await symlink(dir,join(root,'outside'));
    for (const path of ['../secret','/etc/passwd','link','outside/secret']) await expect(files.openContent(workspaceId,path)).rejects.toThrow();
    expect((await files.list(workspaceId)).entries.map(item=>item.name)).toEqual(['nested']);
    expect(await contents((await files.openContent(workspaceId,'nested/ok.txt')).stream)).toBe('ok');
    // Concurrent directory replacement never permits reading the external secret.
    await rename(join(root,'nested'),join(root,'old')); await symlink(dir,join(root,'nested'));
    await expect(files.openContent(workspaceId,'nested/secret')).rejects.toThrow();
  });
  it('does not leave oversized/partial upload files or repeat completed writes', async () => {
    const {files, workspaceId, root}= await setup(8);
    const upload= await files.createUpload(workspaceId,{name:'input.csv',size:3});
    await expect(files.receiveUpload(workspaceId,upload.uploadId,Readable.from([Buffer.from('oversized')]))).rejects.toMatchObject({code:'FILE_TOO_LARGE'});
    expect(await readdir(root)).toEqual([]); expect((await files.getUpload(workspaceId,upload.uploadId)).status).toBe('failed');
    const done= await files.createUpload(workspaceId,{name:'input.csv',size:3});
    await files.receiveUpload(workspaceId,done.uploadId,Readable.from([Buffer.from('abc')]));
    await files.receiveUpload(workspaceId,done.uploadId,Readable.from([Buffer.from('bad')]));
    expect(await readFile(join(root,'input.csv'),'utf8')).toBe('abc');
  });
  it('keeps immutable download bytes across edits, deletion and restart; scopes seat and call id', async () => {
    const {files, workspaceId, root,workspaces}= await setup();
    const sessionId=randomUUID(); await workspaces.bind(sessionId,workspaceId);
    await writeFile(join(root,'result.md'),'original');
    const input={sessionId,requestId:randomUUID(),toolCallId:'call-1',path:'result.md'};
    const output= await files.publish(workspaceId,input);
    await writeFile(join(root,'result.md'),'changed');
    expect((await files.publish(workspaceId,input)).downloadId).toBe(output.downloadId);
    await unlink(join(root,'result.md'));
    const next=new FileService(workspaces); await next.initialize();
    expect(await contents((await next.openDownload(workspaceId,output.downloadId)).stream)).toBe('original');
    const foreign=await WorkspaceStore.open(workspaces.dataDir,'seat-other');
    expect(foreign.list().workspaces).toHaveLength(0);
    expect(()=>foreign.get(workspaceId)).toThrow();
    expect(foreign.binding(sessionId)).toBeUndefined();
    await expect(new FileService(foreign).openDownload(workspaceId,output.downloadId)).rejects.toThrow();
  });
  it('marks interrupted transfer failed without deleting existing ordinary files', async () => {
    const {files,workspaceId,root,workspaces}=await setup();
    const upload=await files.createUpload(workspaceId,{name:'incomplete',size:4});
    await writeFile(join(root,'keep'),'keep');
    await new FileService(workspaces).initialize();
    expect((await files.getUpload(workspaceId,upload.uploadId)).status).toBe('failed');
    expect(await readFile(join(root,'keep'),'utf8')).toBe('keep');
  });
  it('downloads generated files whose valid names exceed the upload suffix reservation', async () => {
    const {files,workspaceId,root,workspaces}=await setup();
    const sessionId=randomUUID();await workspaces.bind(sessionId,workspaceId);
    const name=`${'a'.repeat(246)}.txt`;
    await writeFile(join(root,name),'generated');
    const output=await files.publish(workspaceId,{sessionId,requestId:randomUUID(),toolCallId:'long-name',path:name});
    const download=await files.openDownload(workspaceId,output.downloadId);
    expect(download.name).toBe(name);
    expect(await contents(download.stream)).toBe('generated');
  });
});
it('cancels a stalled byte stream and does not cancel a foreign upload by guessed id', async () => {
  const {files, workspaceId, root,workspaces}=await setup();
  const upload=await files.createUpload(workspaceId,{name:'slow.bin',size:3});
  const chunks=new Readable({read(){}}); const receiving=files.receiveUpload(workspaceId,upload.uploadId,chunks);
  const outcome=receiving.catch(error=>error);
  await new Promise<void>(resolve=>{ const check=async()=>{if((await files.getUpload(workspaceId,upload.uploadId)).status==='uploading') resolve();else setTimeout(()=>void check(),5);}; void check(); });
  const foreign=await workspaces.create('other');
  await expect(files.cancelUpload(foreign.id,upload.uploadId)).rejects.toThrow();
  expect((await files.getUpload(workspaceId,upload.uploadId)).status).toBe('uploading');
  expect((await files.cancelUpload(workspaceId,upload.uploadId)).status).toBe('cancelled');
  expect(await outcome).toBeInstanceOf(Error);expect(await readdir(root)).toEqual([]);
});
it('reconciles a committed upload after record interruption without duplicating the file',async()=>{
  const {files,workspaceId,workspaces,root}=await setup();
  const upload=await files.createUpload(workspaceId,{name:'saved.txt',size:3});
  const saved=await files.receiveUpload(workspaceId,upload.uploadId,Readable.from([Buffer.from('abc')]));
  const path=join(files.storageDirectory(workspaceId),'uploads',`${upload.uploadId}.json`);
  const record=JSON.parse(await readFile(path,'utf8'));record.status='uploading';record.committing=true;await writeFile(path,JSON.stringify(record));
  const next=new FileService(workspaces);await next.initialize();
  expect((await next.getUpload(workspaceId,upload.uploadId)).status).toBe('completed');
  expect(await readdir(root)).toEqual([saved.path]);
});
