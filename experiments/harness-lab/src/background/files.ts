import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { HandoffFile } from '../contracts/collaboration.js';
import { RequestError } from '../contracts/errors.js';
import { HandoffFiles } from '../collaboration/files.js';
import { atomicWrite, checkDirectory, Mutex, parseJsonStrict, readControlled, stateError } from '../resources/files.js';
import { UUID } from '../workspaces/store.js';

const validName = (name: unknown): name is string => typeof name === 'string' && !!name.trim() && Buffer.byteLength(name) <= 240 && !name.includes('/') && !name.includes('\\') && !Array.from(name).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) && !['.', '..'].includes(name);

export interface SourceUpload {
  uploadId: string; sourceId: string; name: string; size: number;
  state: 'pending' | 'uploading' | 'completed' | 'failed'; createdAt: string; file?: HandoffFile;
}
/** Source uploads are fixed private copies. Only explicit selection imports them into a workspace. */
export class BackgroundFiles {
  readonly copies: HandoffFiles;
  private active = new Set<string>();
  private lock = new Mutex();
  readonly root: string;
  constructor(dataDir: string, readonly maxBytes: number, readonly maxAttachments: number, python = 'python3', private readonly referencedIds: () => Set<string> = () => new Set()) {
    this.root = join(dataDir, 'background');
    this.copies = new HandoffFiles(join(this.root, 'files'), maxBytes, python);
  }
  private recordPath(id: string) {
    if (!UUID.test(id)) throw new RequestError('INVALID_INPUT', '上传标识无效。');
    return join(this.root, 'uploads', `${id}.json`);
  }
  async initialize() {
    for (const path of [this.root, join(this.root, 'uploads'), join(this.root, 'events'), join(this.root, 'jobs')]) {
      await mkdir(path, {recursive: true, mode: 0o700}); await checkDirectory(path);
    }
    await this.copies.initialize();
    for (const name of await readdir(join(this.root, 'uploads'))) {
      if (!name.endsWith('.json') || !UUID.test(name.slice(0, -5))) continue;
      const record = await this.load(name.slice(0, -5));
      if (record.state === 'uploading') { record.state = 'failed'; await this.save(record); }
      // Accepted event references retain their bytes even if the upload receipt is old.
      if (!this.referencedIds().has(record.uploadId) && Date.now() - Date.parse(record.createdAt) > 86400000) {
        await rm(this.copies.directory(record.uploadId), {recursive: true, force: true});
        await rm(this.recordPath(record.uploadId));
      }
    }
  }
  private async load(uploadId: string): Promise<SourceUpload> {
    const raw = await readControlled(this.recordPath(uploadId), 16384, true);
    if (!raw) throw new RequestError('UPLOAD_NOT_FOUND', '上传记录不存在。', 404);
    const value = parseJsonStrict(raw) as SourceUpload;
    if (!value || typeof value !== 'object' || value.uploadId !== uploadId || typeof value.sourceId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.sourceId) || !validName(value.name) || !['pending', 'uploading', 'completed', 'failed'].includes(value.state) || !Number.isSafeInteger(value.size) || value.size < 0 || value.size > this.maxBytes || !Number.isFinite(Date.parse(value.createdAt))) throw stateError();
    if (value.state === 'completed' && (!value.file || value.file.fileId !== uploadId || value.file.name !== value.name || value.file.size !== value.size || value.file.createdAt !== value.createdAt || typeof value.file.hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.file.hash))) throw stateError();
    return value;
  }
  private save(record: SourceUpload) { return atomicWrite(this.recordPath(record.uploadId), JSON.stringify(record)); }
  async get(sourceId: string, uploadId: string) {
    const record = await this.load(uploadId);
    if (record.sourceId !== sourceId) throw new RequestError('UPLOAD_NOT_FOUND', '上传记录不存在。', 404);
    return record;
  }
  async create(sourceId: string, name: string, size: number): Promise<SourceUpload> {
    if (!validName(name)) throw new RequestError('INVALID_INPUT', '文件名无效。');
    if (!Number.isSafeInteger(size) || size < 0 || size > this.maxBytes) throw new RequestError('FILE_TOO_LARGE', '文件超过传输限制。', 413);
    return this.lock.run(async () => {
      let pending = 0; const referenced = this.referencedIds();
      for (const item of await readdir(join(this.root, 'uploads'))) {
        if (!item.endsWith('.json') || !UUID.test(item.slice(0, -5))) continue;
        const upload = await this.load(item.slice(0, -5));
        if (upload.sourceId === sourceId && (['pending', 'uploading'].includes(upload.state) || (upload.state === 'completed' && !referenced.has(upload.uploadId)))) pending++;
      }
      if (pending >= 100) throw new RequestError('UPLOAD_CAPACITY', '待传输文件过多，请先完成已有上传。', 429);
      const record: SourceUpload = {uploadId: randomUUID(), sourceId, name, size, state: 'pending', createdAt: new Date().toISOString()};
      await this.save(record); return record;
    });
  }
  async receive(sourceId: string, uploadId: string, chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal) {
    if (this.active.has(uploadId)) throw new RequestError('UPLOAD_BUSY', '文件正在传输。', 409);
    if (this.active.size >= 8) throw new RequestError('UPLOAD_CAPACITY', '文件传输繁忙，请稍后重试。', 429);
    this.active.add(uploadId);
    let record: SourceUpload | undefined;
    const abortStream = () => { if (chunks instanceof Readable) chunks.destroy(); };
    signal?.addEventListener('abort', abortStream, {once: true});
    try {
      record = await this.get(sourceId, uploadId);
      if (record.state === 'completed') return record;
      if (record.state !== 'pending') throw new RequestError('UPLOAD_NOT_PENDING', '上传已结束，请重新创建上传。', 409);
      signal?.throwIfAborted(); record.state = 'uploading'; await this.save(record);
      const directory = this.copies.directory(uploadId); await mkdir(directory, {mode: 0o700}); await checkDirectory(directory);
      const file = await open(join(directory, 'content'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      const hash = createHash('sha256'); let size = 0;
      try {
        for await (const chunk of chunks) {
          signal?.throwIfAborted(); size += chunk.byteLength;
          if (size > record.size || size > this.maxBytes) throw new RequestError('FILE_TOO_LARGE', '上传超过声明大小。', 413);
          hash.update(chunk); await file.writeFile(chunk);
        }
        signal?.throwIfAborted();
        if (size !== record.size) throw new RequestError('UPLOAD_INCOMPLETE', '上传内容不完整。', 409);
        await file.sync();
      } finally { await file.close(); }
      record.file = {fileId: uploadId, name: record.name, size, hash: hash.digest('hex'), createdAt: record.createdAt};
      record.state = 'completed'; await this.save(record); return record;
    } catch (error) {
      if (record?.state === 'uploading') { record.state = 'failed'; await this.save(record); }
      throw error;
    } finally { signal?.removeEventListener('abort', abortStream); this.active.delete(uploadId); }
  }
  async resolve(sourceId: string, uploadIds: string[]): Promise<HandoffFile[]> {
    if (uploadIds.length > this.maxAttachments) throw new RequestError('INVALID_INPUT', '附件数量超过限制。');
    const files: HandoffFile[] = [];
    for (const id of new Set(uploadIds)) {
      const upload = await this.get(sourceId, id);
      if (upload.state !== 'completed' || !upload.file) throw new RequestError('UPLOAD_INCOMPLETE', '请先完成文件上传。', 409);
      await this.copies.assertValid(upload.file); files.push(upload.file);
    }
    return files;
  }
  async freeze(root: string, path: string, name: string): Promise<HandoffFile> {
    const fileId = randomUUID();
    const info = await this.copies.freeze(root, path, fileId);
    return {fileId, name, ...info, createdAt: new Date().toISOString()};
  }
}
