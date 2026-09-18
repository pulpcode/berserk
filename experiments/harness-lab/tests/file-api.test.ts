import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';
import { DockerExecutionService, type DockerRunner } from '../src/execution/docker.js';
import { previewType } from '../src/server/file-preview.js';
import type { Upload, SessionSnapshot } from '../src/contracts/index.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup(output = false) {
  const dir = await mkdtemp(join(tmpdir(), 'berserk-file-api-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const config = testConfig(dir);
  const fake = await fakeRuntime(config, (_context, index) => output && index === 0 ? { tools: [{ name: 'file_output', arguments: { path: 'result.md' } }] } : { text: '已处理' });
  // Only Docker control is faked; Pi and file publication use their real implementations.
  const runner: DockerRunner = async args => ({ code: 0, stdout: Buffer.from(args[0] === 'info' ? 'linux' : args[0] === 'image' ? 'sha256:test' : ''), stderr: Buffer.alloc(0) });
  const lab = await PiLab.create(config, fake.runtime, output ? new DockerExecutionService({ instanceId: dir }, runner) : undefined);
  const app = await createApp(lab); cleanup.push(() => app.close());
  const session = await lab.createSession();
  return { dir, config, fake, lab, app, session, url: `/api/workspaces/${session.workspaceId}` };
}
describe('file HTTP and Pi history integration', () => {
  it('streams ordinary uploads above JSON limit, preserves on chip cancellation, scopes ownership and previews inert text', async () => {
    const { app, lab, url } = await setup();
    const bytes = Buffer.alloc(256 * 1024, 'a');
    const create = await app.inject({ method: 'POST', url: `${url}/uploads`, payload: { name: '资料.txt', size: bytes.length } });
    expect(create.statusCode).toBe(201);
    const upload = create.json<Upload>();
    const result = await app.inject({ method: 'PUT', url: `${url}/uploads/${upload.uploadId}/content`, headers: { 'content-type': 'application/octet-stream' }, payload: bytes });
    expect(result.statusCode).toBe(200); expect(result.json().status).toBe('completed');
    expect((await app.inject({ method: 'DELETE', url: `${url}/uploads/${upload.uploadId}` })).json().status).toBe('completed');
    expect((await app.inject(`${url}/files`)).json().entries).toMatchObject([{ name: '资料.txt', kind: 'file' }]);
    const preview = await app.inject(`${url}/files/content?path=${encodeURIComponent('资料.txt')}&preview=1`);
    expect(preview.statusCode).toBe(200); expect(preview.rawPayload).toEqual(bytes); expect(preview.headers['content-type']).toContain('text/plain');
    const download = await app.inject(`${url}/files/content?path=${encodeURIComponent('资料.txt')}`);
    expect(download.headers['content-disposition']).toContain('attachment;');
    expect((await app.inject(`${url}/files/content?path=../AGENTS.md`)).statusCode).toBe(400);
    const foreign = await lab.workspaces.create('另一项目');
    expect((await app.inject(`/api/workspaces/${foreign.id}/uploads/${upload.uploadId}`)).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/workspaces', payload: { name: 'x'.repeat(256 * 1024) } })).statusCode).toBe(413);
  });
  it('sends only file metadata into Pi context, keeps original user text and restores references without replay', async () => {
    const { app, lab, fake, config, session, url } = await setup();
    const content = 'PRIVATE_FILE_BODY_NOT_AUTOMATICALLY_IN_CONTEXT';
    const upload = await lab.files.createUpload(session.workspaceId, { name: 'report.md', size: Buffer.byteLength(content) });
    await lab.files.receiveUpload(session.workspaceId, upload.uploadId, (async function* () { yield Buffer.from(content); })());
    const response = await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, payload: { text: '请分析附件', uploadIds: [upload.uploadId] } });
    expect(response.statusCode).toBe(200);
    expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
    const input = lab.get(session.id).messages.find(message => message.role === 'user')!;
    expect(input.text).toBe('请分析附件'); expect(input.attachments?.[0].path).toBe('report.md');
    expect(JSON.stringify(fake.calls[0].context.messages)).toContain('report.md');
    expect(JSON.stringify(fake.calls[0].context)).not.toContain(content);
    await lab.close();
    const restored = await PiLab.create(config, fake.runtime); cleanup.push(() => restored.close());
    expect(restored.get(session.id).messages.find(message => message.role === 'user')).toEqual(input);
    expect(fake.calls).toHaveLength(1);
    const missing = await app.inject(`${url}/files/content?path=missing.md`); expect(missing.statusCode).toBe(404);
  });
  it('persists real download cards before tool success, retains bytes after source changes and reopens history', async () => {
    const { app, lab, session, config, fake, url } = await setup(true);
    await writeFile(join(lab.files.filesDirectory(session.workspaceId), 'result.md'), '# 固定成果');
    const response = await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, payload: { text: '交付 result.md' } });
    expect(response.payload).toContain('files.output');
    const snapshot = lab.get(session.id); expect(snapshot.lastResult?.status).toBe('succeeded');
    const file = snapshot.fileOutputs![0]; expect(file.name).toBe('result.md');
    await writeFile(join(lab.files.filesDirectory(session.workspaceId), 'result.md'), 'later');
    expect((await app.inject(`${url}/downloads/${file.downloadId}`)).payload).toBe('# 固定成果');
    await lab.close(); const restored = await PiLab.create(config, fake.runtime); cleanup.push(() => restored.close());
    expect(restored.get(session.id).fileOutputs).toEqual(snapshot.fileOutputs);
    expect(restored.get(session.id).recoveryWarning).toBeUndefined();
    expect((await app.inject(`/api/sessions/${session.id}`)).json<SessionSnapshot>().fileOutputs).toHaveLength(1);
  });
  it('rejects unsupported images and oversized decoded dimensions; HTML stays text', () => {
    expect(previewType('page.html', Buffer.from('<script>alert(1)</script>'))).toBe('text/plain; charset=utf-8');
    expect(() => previewType('file.png', Buffer.from('fake'))).toThrow();
    const png = Buffer.alloc(33); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.write('IHDR', 12); png.writeUInt32BE(100000, 16); png.writeUInt32BE(100000, 20);
    expect(() => previewType('file.png', png)).toThrow();
  });
});
