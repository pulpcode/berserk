import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HandoffFile } from '../contracts/collaboration.js';
import { RequestError } from '../contracts/errors.js';
import type { OpenFile } from '../files/service.js';
import { checkDirectory, stateError } from '../resources/files.js';

const copyHelper = fileURLToPath(new URL('../files/safe-fs.py', import.meta.url));
const importHelper = fileURLToPath(new URL('./safe-import.py', import.meta.url));
/** Copies use the existing anchored filesystem helper; the private root never enters a sandbox. */
export class HandoffFiles {
  constructor(readonly root: string, readonly maxBytes: number, private readonly python: string) {}
  directory(id: string) { return join(this.root, id); }
  async initialize() { await mkdir(this.root, { recursive: true, mode: 0o700 }); await checkDirectory(this.root); }
  private async helper<T>(script: string, args: Record<string, unknown>, signal?: AbortSignal, settleOnAbort = false): Promise<T> {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const process = spawn(this.python, [script], { env: { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = ''; let failed = false;
      // Import publication uses link/unlink; settle it before cancellation returns so a
      // cancelled caller cannot strand a second hard link in the workspace.
      const abort = () => { if (!settleOnAbort) process.kill('SIGKILL'); }; signal?.addEventListener('abort', abort, { once: true });
      process.stdout.on('data', chunk => { output += String(chunk); if (output.length > 32768) process.kill('SIGKILL'); });
      process.stderr.resume(); process.stdin.on('error', () => {});
      process.on('error', () => { failed = true; signal?.removeEventListener('abort', abort); reject(new RequestError('FILE_OPERATION_FAILED', '文件服务不可用，请检查 Python 3。', 503)); });
      process.on('close', () => {
        signal?.removeEventListener('abort', abort); if (failed) return;
        if (signal?.aborted) { reject(signal.reason); return; }
        try {
          const result = JSON.parse(output) as T & { error?: string };
          if (result.error) {
            const message = result.error === 'EXISTS' ? '目标文件已存在且内容不同，请另选位置。' : result.error === 'TOO_LARGE' ? '文件超过传输限制。' : result.error === 'NOT_FOUND' ? '文件不存在。' : '文件路径、类型或内容不允许访问。';
            reject(new RequestError(`FILE_${result.error}`, message, result.error === 'NOT_FOUND' ? 404 : result.error === 'TOO_LARGE' ? 413 : 409));
          } else resolve(result);
        } catch { reject(new RequestError('FILE_OPERATION_FAILED', '无法确认文件操作结果，请核对文件后重试。', 503)); }
      });
      process.stdin.end(JSON.stringify({ ...args, maxBytes: this.maxBytes }));
    });
  }
  async freeze(root: string, path: string, fileId: string, signal?: AbortSignal) {
    await checkDirectory(this.root); await checkDirectory(root);
    const directory = this.directory(fileId); await mkdir(directory, { mode: 0o700 }); await checkDirectory(directory);
    return this.helper<{size: number; hash: string}>(copyHelper, { verb: 'copy', root, path, destination: join(directory, 'content') }, signal);
  }
  async verify(record: HandoffFile) {
    await checkDirectory(this.root); await checkDirectory(this.directory(record.fileId));
    const file = await open(join(this.directory(record.fileId), 'content'), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size !== record.size || stat.size > this.maxBytes) throw stateError();
      const hash = createHash('sha256'); const bytes = Buffer.alloc(64 * 1024); let position = 0;
      while (true) { const {bytesRead} = await file.read(bytes, 0, bytes.length, position); if (!bytesRead) break; hash.update(bytes.subarray(0, bytesRead)); position += bytesRead; if (position > record.size) throw stateError(); }
      if (hash.digest('hex') !== record.hash || position !== record.size) throw stateError();
      return file;
    } catch (error) { await file.close(); throw error; }
  }
  async assertValid(record: HandoffFile) { const file = await this.verify(record); await file.close(); }
  async open(record: HandoffFile): Promise<OpenFile> {
    const file = await this.verify(record);
    return { stream: file.createReadStream({start: 0}), name: record.name, size: record.size, contentType: 'application/octet-stream' };
  }
  async import(record: HandoffFile, root: string, path: string, signal?: AbortSignal) {
    await this.assertValid(record); await checkDirectory(root);
    return this.helper<{size: number; hash: string}>(importHelper, { root, path, sourceRoot: this.directory(record.fileId), expectedHash: record.hash }, signal, true);
  }
}
