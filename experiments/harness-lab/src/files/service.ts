import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { mkdir, open, readdir, unlink } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import type { FileList, FileOutput, FileRef, Upload } from '../contracts/files.js';
import { RequestError } from '../contracts/errors.js';
import { atomicWrite, checkDirectory, Mutex, parseJsonStrict, readControlled, stateError } from '../resources/files.js';
import { UUID, WorkspaceStore } from '../workspaces/store.js';

const helperPath = fileURLToPath(new URL('./safe-fs.py', import.meta.url));
const HASH = /^[0-9a-f]{64}$/;
const badCharacters = (value: string) => Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === '\\');
interface StoredUpload extends Upload { schemaVersion: 1; taskSpaceId: string; seatId: string; committing?: boolean }
interface StoredOutput extends FileOutput { schemaVersion: 1; taskSpaceId: string; seatId: string }
export interface FileServiceOptions { maxFileBytes?: number; maxAttachments?: number; python?: string }
export interface OpenFile { stream: Readable; size: number; name: string; contentType: string }
export function filePath(path: string, allowRoot = false): string {
  if (typeof path !== 'string' || path.length > 4096 || badCharacters(path)) throw new RequestError('INVALID_INPUT', '文件路径无效。');
  const value = path.startsWith('/workspace/') ? path.slice(11) : path;
  if ((!value && !allowRoot) || value.startsWith('/') || value.split('/').some(part => part === '.' || part === '..' || (!part && value))) throw new RequestError('INVALID_INPUT', '请选择当前工作区中的文件。');
  return value;
}
function safeName(name: string) {
  if (typeof name !== 'string' || !name.trim() || Buffer.byteLength(name) > 240 || name.includes('/') || badCharacters(name) || name === '.' || name === '..') throw new RequestError('INVALID_INPUT', '文件名无效，请移除路径或控制字符。');
  return name;
}
function id(value: string) { if (!UUID.test(value)) throw new RequestError('INVALID_INPUT', '文件标识无效。'); return value; }
/** Only the fixed Python helper receives host paths. No user code or shell runs here. */
export class FileService {
  readonly maxFileBytes: number;
  readonly maxAttachments: number;
  private readonly locks = new Map<string, Mutex>();
  private readonly cancellationRequests = new Set<string>();
  private readonly aborts = new Map<string, AbortController>();
  private readonly python: string;
  constructor(readonly workspaces: WorkspaceStore, options: FileServiceOptions = {}) {
    this.maxFileBytes = options.maxFileBytes ?? 100 * 1024 * 1024;
    this.maxAttachments = options.maxAttachments ?? 20;
    this.python = options.python ?? 'python3';
  }
  filesDirectory(workspaceId: string) { return this.workspaces.filesDirectory(workspaceId); }
  storageDirectory(workspaceId: string) { return join(this.workspaces.dataDir, 'file-storage', this.workspaces.get(workspaceId).id); }
  executionLogsDirectory(workspaceId: string) { return join(this.storageDirectory(workspaceId), 'executions'); }
  private lock(key: string) { let lock = this.locks.get(key); if (!lock) { lock = new Mutex(); this.locks.set(key, lock); } return lock; }
  async prepareWorkspace(workspaceId: string): Promise<void> { await this.directories(workspaceId); }
  private async directories(workspaceId: string) {
    await checkDirectory(this.workspaces.directory(workspaceId));
    await checkDirectory(this.filesDirectory(workspaceId));
    for (const directory of [ join(this.workspaces.dataDir, 'file-storage'), this.storageDirectory(workspaceId), ...['staging', 'uploads', 'downloads', 'executions', 'previews'].map(name => join(this.storageDirectory(workspaceId), name))]) {
      await mkdir(directory, { recursive: true, mode: 0o700 }); await checkDirectory(directory);
    }
  }
  private async helper<T>(workspaceId: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    await checkDirectory(this.filesDirectory(workspaceId));
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const child = spawn(this.python, [helperPath], { env: { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = ''; let settled = false;
      const abort = () => { child.kill('SIGKILL'); };
      signal?.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', chunk => { output += String(chunk); if (Buffer.byteLength(output) > 2 * 1024 * 1024) child.kill('SIGKILL'); });
      child.stderr.resume(); child.stdin.on('error', () => {});
      const fail = () => new RequestError('FILE_OPERATION_FAILED', '无法安全访问文件，请检查 Python 3 与文件权限后重试。', 503);
      child.on('error', () => { settled = true; signal?.removeEventListener('abort', abort); reject(fail()); });
      child.on('close', () => {
        signal?.removeEventListener('abort', abort); if (settled) return;
        if (signal?.aborted) { reject(signal.reason); return; }
        try {
          const result = JSON.parse(output) as T & { error?: string };
          if (result.error) {
            const message = result.error === 'EXISTS' ? '文件名已存在。' : result.error === 'TOO_LARGE' ? '文件超过当前传输大小限制。' : result.error === 'NOT_FOUND' ? '文件已不存在，请重新选择。' : '文件路径、类型或权限不允许访问。';
            reject(new RequestError(`FILE_${result.error}`, message, result.error === 'NOT_FOUND' ? 404 : result.error === 'TOO_LARGE' ? 413 : 409));
          } else resolve(result);
        } catch { reject(fail()); }
      });
      child.stdin.end(JSON.stringify({ ...args, root: this.filesDirectory(workspaceId), maxBytes: this.maxFileBytes }));
    });
  }
  private uploadPath(workspaceId: string, uploadId: string) { return join(this.storageDirectory(workspaceId), 'uploads', `${id(uploadId)}.json`); }
  private async saveUpload(upload: StoredUpload) { await atomicWrite(this.uploadPath(upload.workspaceId, upload.uploadId), JSON.stringify(upload)); }
  private publicUpload(upload: StoredUpload): Upload {
    return {uploadId: upload.uploadId, workspaceId: upload.workspaceId, originalName: upload.originalName, size: upload.size, status: upload.status,
      ...(upload.name ? {name: upload.name} : {}), ...(upload.path ? {path: upload.path} : {}), ...(upload.hash ? {hash: upload.hash} : {}), ...(upload.error ? {error: upload.error} : {})};
  }
  private async loadUpload(workspaceId: string, uploadId: string): Promise<StoredUpload> {
    const workspace = this.workspaces.get(workspaceId);
    await this.directories(workspaceId);
    const raw = await readControlled(this.uploadPath(workspaceId, uploadId), 16384, true);
    if (!raw) throw new RequestError('UPLOAD_NOT_FOUND', '上传记录不存在。', 404);
    const record = parseJsonStrict(raw) as StoredUpload;
    if (record.schemaVersion !== 1 || record.uploadId !== uploadId || record.workspaceId !== workspaceId || record.seatId !== workspace.seatId || record.taskSpaceId !== workspace.taskSpaceId || !['pending', 'uploading', 'completed', 'failed', 'cancelled'].includes(record.status) || !Number.isSafeInteger(record.size) || record.size < 0) throw stateError();
    safeName(record.originalName);
    if (record.path) filePath(record.path);
    if (record.status === 'completed' && (!record.path || !record.name || !record.hash || !HASH.test(record.hash))) throw stateError();
    return record;
  }
  async initialize() {
    for (const workspace of this.workspaces.list().workspaces) {
      await this.directories(workspace.id);
      for (const name of await readdir(join(this.storageDirectory(workspace.id), 'uploads'))) {
        if (!name.endsWith('.json') || !UUID.test(name.slice(0, -5))) throw stateError();
        const record = await this.loadUpload(workspace.id, name.slice(0, -5));
        if (record.status === 'uploading' || record.status === 'pending') {
          const staged = join(this.storageDirectory(workspace.id), 'staging', `${record.uploadId}.part`);
          // A committed hard link survives independently; remove the temporary name, never the workspace file.
          await unlink(staged).catch(error => { if (error.code !== 'ENOENT') throw error; });
          if (record.committing && record.path && record.hash) {
            try {
              const info = await this.helper<{size: number; hash: string}>(workspace.id, { verb: 'hash', path: record.path });
              if (info.hash === record.hash && info.size === record.size) { record.status = 'completed'; delete record.committing; await this.saveUpload(record); continue; }
            } catch { /* Report uncertain publication without deleting or replaying a file. */ }
          }
          record.status = 'failed'; record.error = '传输被中断，请核对工作区文件后重新选择上传。'; delete record.committing; await this.saveUpload(record);
        }
      }
      for (const name of await readdir(join(this.storageDirectory(workspace.id), 'previews'))) if (UUID.test(name)) await unlink(join(this.storageDirectory(workspace.id), 'previews', name));
    }
  }
  async createUpload(workspaceId: string, input: {name: string; size: number}): Promise<Upload> {
    const workspace = this.workspaces.get(workspaceId); safeName(input.name);
    if (!Number.isSafeInteger(input.size) || input.size < 0 || input.size > this.maxFileBytes) throw new RequestError('FILE_TOO_LARGE', '文件超过当前传输大小限制。', 413);
    await this.directories(workspaceId);
    const record: StoredUpload = { schemaVersion: 1, uploadId: randomUUID(), workspaceId, taskSpaceId: workspace.taskSpaceId, seatId: workspace.seatId, originalName: input.name, size: input.size, status: 'pending' };
    await this.saveUpload(record); return this.publicUpload(record);
  }
  async getUpload(workspaceId: string, uploadId: string): Promise<Upload> { return this.publicUpload(await this.loadUpload(workspaceId, uploadId)); }
  async cancelUpload(workspaceId: string, uploadId: string): Promise<Upload> {
    await this.loadUpload(workspaceId, uploadId); this.cancellationRequests.add(uploadId); this.aborts.get(uploadId)?.abort();
    try { return await this.lock(uploadId).run(async () => {
      const record = await this.loadUpload(workspaceId, uploadId);
      if (record.status !== 'completed') { record.status = 'cancelled'; delete record.error; await this.saveUpload(record); }
      return this.publicUpload(record);
    }); } finally { this.cancellationRequests.delete(uploadId); }
  }
  async receiveUpload(workspaceId: string, uploadId: string, chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<Upload> {
    return this.lock(id(uploadId)).run(async () => {
      const record = await this.loadUpload(workspaceId, uploadId);
      if (record.status === 'completed') return this.publicUpload(record);
      if (record.status !== 'pending') throw new RequestError('UPLOAD_NOT_PENDING', '本次上传已结束，请核对状态或重新选择文件。', 409);
      const controller = new AbortController(); this.aborts.set(uploadId, controller);
      if (this.cancellationRequests.has(uploadId)) controller.abort();
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      const abortStream = () => { if (chunks instanceof Readable) chunks.destroy(); };
      combined.addEventListener('abort', abortStream, {once: true});
      const staged = join(this.storageDirectory(workspaceId), 'staging', `${uploadId}.part`);
      let published = false;
      try {
        combined.throwIfAborted();
        record.status = 'uploading'; await this.saveUpload(record);
        const file = await open(staged, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        let size = 0; const digest = createHash('sha256');
        try {
          for await (const chunk of chunks) {
            combined.throwIfAborted();
            if (!(chunk instanceof Uint8Array)) throw new RequestError('INVALID_INPUT', '上传需要二进制字节流。');
            size += chunk.byteLength;
            if (size > this.maxFileBytes || size > record.size) throw new RequestError('FILE_TOO_LARGE', '实际文件大小超过声明或传输限制。', 413);
            digest.update(chunk); await file.writeFile(chunk);
          }
          combined.throwIfAborted();
          if (size !== record.size) throw new RequestError('UPLOAD_INCOMPLETE', '上传内容不完整，请重新选择文件。');
          await file.sync();
        } finally { await file.close(); }
        record.hash = digest.digest('hex');
        const ext = extname(record.originalName); const stem = record.originalName.slice(0, record.originalName.length - ext.length);
        for (let suffix = 0; suffix < 10000; suffix++) {
          combined.throwIfAborted();
          record.name = suffix ? `${stem} (${suffix})${ext}` : record.originalName; record.path = record.name; record.committing = true;
          await this.saveUpload(record);
          try { await this.helper(workspaceId, { verb: 'install', source: staged, path: record.path }); published = true; break; }
          catch (error) { if (!(error instanceof RequestError) || error.code !== 'FILE_EXISTS') throw error; }
        }
        if (!published) throw new RequestError('UPLOAD_NAMES_EXHAUSTED', '同名文件过多，请更换名称。', 409);
        await unlink(staged); record.status = 'completed'; delete record.committing; await this.saveUpload(record);
        return this.publicUpload(record);
      } catch (error) {
        if (!published) { record.status = combined.aborted ? 'cancelled' : 'failed'; record.error = '文件未完成上传，请重试。'; delete record.committing; await this.saveUpload(record); }
        throw error;
      } finally { combined.removeEventListener('abort', abortStream); this.aborts.delete(uploadId); await unlink(staged).catch(() => {}); }
    });
  }
  async list(workspaceId: string, options: { path?: string; search?: string; offset?: number; limit?: number } = {}): Promise<FileList> {
    await this.directories(workspaceId);
    const path = filePath(options.path ?? '', true); const offset = options.offset ?? 0; const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500 || (options.search?.length ?? 0) > 200) throw new RequestError('INVALID_INPUT', '文件列表参数无效。');
    return this.helper(workspaceId, { verb: 'list', path, search: options.search ?? '', offset, limit });
  }
  async resolveInputs(workspaceId: string, input: {uploadIds?: string[]; fileRefs?: Array<{path: string}>}): Promise<FileRef[]> {
    const paths: string[] = [];
    if ((input.uploadIds?.length ?? 0) + (input.fileRefs?.length ?? 0) > this.maxAttachments) throw new RequestError('INVALID_INPUT', '附件数量超过限制。');
    for (const uploadId of input.uploadIds ?? []) {
      const upload = await this.loadUpload(workspaceId, uploadId);
      if (upload.status !== 'completed' || !upload.path) throw new RequestError('UPLOAD_INCOMPLETE', '请等待上传完成或移除失败附件。', 409);
      paths.push(upload.path);
    }
    for (const reference of input.fileRefs ?? []) paths.push(filePath(reference.path));
    const result: FileRef[] = [];
    for (const path of new Set(paths)) result.push({ path, name: basename(path), ...await this.helper<{size: number; hash: string}>(workspaceId, { verb: 'hash', path }) });
    return result;
  }
  async openContent(workspaceId: string, inputPath: string): Promise<OpenFile> {
    await this.directories(workspaceId); const path = filePath(inputPath);
    const destination = join(this.storageDirectory(workspaceId), 'previews', randomUUID());
    try {
      const info = await this.helper<{size: number}>(workspaceId, { verb: 'copy', path, destination });
      const stream = createReadStream(destination); stream.once('close', () => { void unlink(destination).catch(() => {}); });
      return { stream, size: info.size, name: basename(path), contentType: 'application/octet-stream' };
    } catch (error) { await unlink(destination).catch(() => {}); throw error; }
  }
  private async outputRecord(workspaceId: string, downloadId: string): Promise<StoredOutput> {
    const workspace = this.workspaces.get(workspaceId);
    await this.directories(workspaceId);
    const directory = join(this.storageDirectory(workspaceId), 'downloads', id(downloadId));
    try { await checkDirectory(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new RequestError('DOWNLOAD_NOT_FOUND', '下载文件不存在。', 404); throw error; }
    const raw = await readControlled(join(directory, 'record.json'), 16384, true);
    if (!raw) throw new RequestError('DOWNLOAD_NOT_FOUND', '下载文件不存在。', 404);
    const record = parseJsonStrict(raw) as StoredOutput;
    if (record.schemaVersion !== 1 || record.downloadId !== downloadId || record.workspaceId !== workspaceId || record.taskSpaceId !== workspace.taskSpaceId || record.seatId !== workspace.seatId || !UUID.test(record.sessionId) || !UUID.test(record.requestId) || !record.toolCallId || !HASH.test(record.hash) || !Number.isSafeInteger(record.size) || record.size < 0) throw stateError();
    filePath(record.path);
    // Upload names reserve room for collision suffixes; generated files need no such restriction.
    if (record.name !== basename(record.path)) throw stateError();
    return record;
  }
  private publicOutput(record: StoredOutput): FileOutput { return {downloadId: record.downloadId, workspaceId: record.workspaceId, sessionId: record.sessionId, requestId: record.requestId, toolCallId: record.toolCallId, createdAt: record.createdAt, path: record.path, name: record.name, size: record.size, hash: record.hash}; }
  async publish(workspaceId: string, input: {sessionId: string; requestId: string; toolCallId: string; path: string}, signal?: AbortSignal): Promise<FileOutput> {
    const workspace = this.workspaces.get(workspaceId); id(input.sessionId); id(input.requestId);
    if (this.workspaces.binding(input.sessionId) !== workspaceId || !input.toolCallId || input.toolCallId.length > 256) throw new RequestError('INVALID_INPUT', '文件交付归属无效。');
    const path = filePath(input.path); await this.directories(workspaceId);
    const call = `${workspaceId}:${input.sessionId}:${input.requestId}:${input.toolCallId}`;
    return this.lock(call).run(async () => {
      const downloads = join(this.storageDirectory(workspaceId), 'downloads');
      for (const downloadId of await readdir(downloads)) {
        id(downloadId);
        const raw = await readControlled(join(downloads, downloadId, 'record.json'), 16384, true); if (!raw) continue;
        const prior = await this.outputRecord(workspaceId, downloadId);
        if (prior.sessionId === input.sessionId && prior.requestId === input.requestId && prior.toolCallId === input.toolCallId) return this.publicOutput(prior);
      }
      signal?.throwIfAborted();
      const downloadId = randomUUID(); const directory = join(downloads, downloadId); await mkdir(directory, { mode: 0o700 });
      const info = await this.helper<{size: number; hash: string}>(workspaceId, { verb: 'copy', path, destination: join(directory, 'content') }, signal);
      const record: StoredOutput = { schemaVersion: 1, ...input, path, name: basename(path), ...info, workspaceId, taskSpaceId: workspace.taskSpaceId, seatId: workspace.seatId, downloadId, createdAt: new Date().toISOString() };
      await atomicWrite(join(directory, 'record.json'), JSON.stringify(record)); return this.publicOutput(record);
    });
  }
  async openDownload(workspaceId: string, downloadId: string): Promise<OpenFile> {
    const record = await this.outputRecord(workspaceId, downloadId);
    const path = join(this.storageDirectory(workspaceId), 'downloads', downloadId, 'content'); await checkDirectory(join(this.storageDirectory(workspaceId), 'downloads', downloadId));
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat(); if (!stat.isFile() || stat.size !== record.size) { await file.close(); throw stateError(); }
    return { stream: file.createReadStream(), size: record.size, name: record.name, contentType: 'application/octet-stream' };
  }
}
