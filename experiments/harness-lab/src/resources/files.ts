import { constants } from 'node:fs';
import { lstat, open, rename, unlink, realpath } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { RequestError } from '../contracts/errors.js';

export const hashContent = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');
export const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
export function stateError() { return new RequestError('RESOURCE_STATE_INVALID', '资源状态异常，请检查数据目录或恢复备份。', 409); }
export async function checkDirectory(path: string): Promise<void> {
  // macOS exposes its system temporary root through /var and /tmp aliases.
  let full = resolve(path);
  for (const alias of ['/var', '/tmp']) if (full === alias || full.startsWith(`${alias}/`)) {
    full = (await realpath(alias)) + full.slice(alias.length); break;
  }
  let current = parse(full).root;
  for (const part of full.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw stateError();
  }
}
export async function readControlled(path: string, maxBytes: number, optional = false): Promise<string | null> {
  try {
    await checkDirectory(dirname(path));
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink()) throw stateError();
    if (before.size > maxBytes) throw new RequestError('RESOURCE_TOO_LARGE', '资源内容超过允许大小。', 413);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev) throw stateError();
      if (stat.size > maxBytes) throw new RequestError('RESOURCE_TOO_LARGE', '资源内容超过允许大小。', 413);
      const bytes = await file.readFile();
      if (bytes.length > maxBytes) throw new RequestError('RESOURCE_TOO_LARGE', '资源内容超过允许大小。', 413);
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      return text;
    } finally { await file.close(); }
  } catch (error) {
    if (optional && missing(error)) {
      // Only a missing leaf is optional; a missing ancestor is invalid.
      await checkDirectory(dirname(path));
      return null;
    }
    if (error instanceof RequestError) throw error;
    throw new RequestError('RESOURCE_LOAD_FAILED', '无法读取已登记资源，请检查文件后重试。', 503);
  }
}
export interface WriteHooks { beforeRename?: () => Promise<void>; afterRename?: () => Promise<void> }
/** Settles the rename even after cancellation. Never races a write against a timer. */
export async function atomicWrite(path: string, content: string, signal?: AbortSignal, hooks: WriteHooks = {}): Promise<void> {
  await checkDirectory(dirname(path));
  signal?.throwIfAborted();
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  let committed = false;
  try {
    const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(content, 'utf8'); await file.sync(); } finally { await file.close(); }
    await hooks.beforeRename?.();
    signal?.throwIfAborted();
    await rename(temporary, path);
    committed = true;
    await hooks.afterRename?.();
  } finally { if (!committed) await unlink(temporary).catch(() => {}); }
}
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  async run<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  }
}

/** JSON.parse accepts duplicate keys, which could silently change session ownership. */
export function parseJsonStrict(text: string): unknown {
  const value: unknown = JSON.parse(text);
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}[\]:,]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) || [];
  const stack: Array<Set<string> | null> = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === '{') stack.push(new Set());
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token.startsWith('"') && tokens[index + 1] === ':') {
      const key = JSON.parse(token) as string;
      const keys = stack.at(-1);
      if (!keys || keys.has(key)) throw stateError();
      keys.add(key);
    }
  }
  return value;
}
