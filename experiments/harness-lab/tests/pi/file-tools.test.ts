import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { DockerExecutionService, type DockerRunner } from '../../src/execution/docker.js';
import type { FileService } from '../../src/files/service.js';
import { mapBashLogText, workspaceFileTools, writableFileTools } from '../../src/pi/file-tools.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose(); });
const result = (text = '', code = 0) => ({ code, stdout: Buffer.from(text), stderr: Buffer.alloc(0) });
const longOutput = Buffer.from(Array.from({ length: 3000 }, (_, i) => `line ${i}: 一段需要保留的完整执行输出\n`).join(''));

async function setup(mode: 'success' | 'nonzero' | 'timeout' | 'cancel' = 'success') {
  const root = await mkdtemp(join(tmpdir(), 'pi-file-tools-'));
  disposers.push(() => rm(root, { recursive: true, force: true }));
  const logsDir = join(root, 'logs'), filesDir = join(root, 'files');
  await mkdir(logsDir); await mkdir(filesDir);
  const files = new Map<string, Buffer>();
  const paths: string[] = [];
  const controller = new AbortController();
  let finishCancelled!: (value: ReturnType<typeof result>) => void;
  const runner: DockerRunner = async (args, options) => {
    if (args[0] === 'info') return result('linux');
    if (args[0] === 'rm') { finishCancelled?.(result('', 137)); return result(); }
    if (args[0] !== 'exec') return result();
    if (args.includes('/opt/berserk/command.py')) {
      options!.onData!(longOutput);
      if (mode === 'cancel') {
        queueMicrotask(() => controller.abort());
        return new Promise(resolve => { finishCancelled = resolve; });
      }
      return result('', mode === 'nonzero' ? 7 : mode === 'timeout' ? 124 : 0);
    }
    const i = args.indexOf('/opt/berserk/files.py');
    const [operation, path] = args.slice(i + 1);
    paths.push(path);
    if (path.startsWith('/logs/') && operation === 'read') return { ...result(), stdout: await readFile(join(logsDir, path.slice('/logs/'.length))) };
    if (operation === 'read') {
      if (!files.has(path)) return { ...result('', 1), stderr: Buffer.from('文件不存在') };
      return { ...result(), stdout: files.get(path)! };
    }
    if (operation === 'write') { files.set(path, options!.input!); return result(); }
    if (operation === 'mkdir') return result();
    if (operation === 'exists') return result('true');
    if (operation === 'stat') return result(JSON.stringify({ directory: path === '/workspace' }));
    if (operation === 'ls') return result(JSON.stringify([...files.keys()].map(key => key.split('/').at(-1))));
    if (operation === 'find') return result(JSON.stringify([...files.keys()].map(key => key.slice('/workspace/'.length))));
    throw new Error(`Unexpected helper ${operation}`);
  };
  const execution = new DockerExecutionService({ instanceId: root }, runner);
  await execution.initialize();
  disposers.push(() => execution.close());
  const requestId = randomUUID();
  const scope = { requestId, workspaceDir: filesDir, logsDir, signal: controller.signal };
  const sandbox = execution.create(scope);
  const readonly = workspaceFileTools(sandbox);
  const writable = writableFileTools(sandbox, { logsDir, requestId, workspaceId: randomUUID(), sessionId: randomUUID(),
    manager: SessionManager.inMemory('/workspace'), files: {} as FileService, signal: controller.signal, output() {} });
  const tools = [...readonly, ...writable];
  const call = async (name: string, args: Record<string, unknown>, callId = randomUUID(), onUpdate?: (value: unknown) => void) => {
    const tool = tools.find(tool => tool.name === name)!;
    return tool.execute(callId, args, controller.signal, onUpdate, { cwd: '/workspace' } as Parameters<typeof tool.execute>[4]);
  };
  return { execution, sandbox, readonly, writable, call, requestId, logsDir, files, paths, scope };
}

describe('Pi public file factories', () => {
  it('routes read/write/edit/ls/find through virtual cwd and exposes only readonly tools to children', async () => {
    const env = await setup();
    expect(env.readonly.map(tool => tool.name)).toEqual(['read', 'ls', 'find']);
    expect(env.writable.map(tool => tool.name)).toEqual(['write', 'edit', 'bash', 'file_output']);
    await env.call('write', { path: 'report.md', content: '原始内容\n' });
    expect(env.files.get('/workspace/report.md')?.toString()).toBe('原始内容\n');
    await env.call('edit', { path: 'report.md', edits: [{ oldText: '原始', newText: '修订' }] });
    expect(env.files.get('/workspace/report.md')?.toString()).toBe('修订内容\n');
    expect(JSON.stringify(await env.call('read', { path: 'report.md' }))).toContain('修订内容');
    expect(JSON.stringify(await env.call('ls', { path: '.' }))).toContain('report.md');
    expect(JSON.stringify(await env.call('find', { pattern: '*.md', path: '.' }))).toContain('report.md');
    expect(env.paths.every(path => path === '/workspace' || path.startsWith('/workspace/'))).toBe(true);
  });

  it('rejects binary/image bytes instead of claiming a text model understood them', async () => {
    const env = await setup();
    env.files.set('/workspace/image.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    env.files.set('/workspace/document.docx', Buffer.from([80, 75, 0, 0]));
    await expect(env.call('read', { path: 'image.png' })).rejects.toThrow('不支持直接读取图像');
    await expect(env.call('read', { path: 'document.docx' })).rejects.toThrow('二进制');
  });

  it('can recover from a missing file without destroying the request container', async () => {
    const env = await setup();
    await expect(env.call('read', { path: 'missing.txt' })).rejects.toThrow('文件不存在');
    await env.call('write', { path: 'missing.txt', content: '已补建' });
    expect(JSON.stringify(await env.call('read', { path: 'missing.txt' }))).toContain('已补建');
  });

  for (const mode of ['success', 'nonzero', 'timeout', 'cancel'] as const) {
    it(`archives all ${mode} output and maps every native partial/result/error log path`, async () => {
      const env = await setup(mode);
      const callId = randomUUID();
      const filename = `${createHash('sha256').update(callId).digest('hex')}.log`;
      const virtual = `/logs/${env.requestId}/${filename}`;
      const updates: unknown[] = [];
      let actual: unknown;
      try { actual = await env.call('bash', { command: 'fixture', ...(mode === 'timeout' ? { timeout: 1 } : {}) }, callId, update => updates.push(update)); }
      catch (error) { actual = error instanceof Error ? error.message : error; }
      const projected = JSON.stringify({ updates, actual });
      expect(projected).not.toMatch(/\/[^\s"\]]*pi-bash-[a-f0-9]+\.log/);
      expect(projected).toContain(virtual);
      expect(updates.some(update => JSON.stringify(update).includes(virtual))).toBe(true);
      expect(await readFile(join(env.logsDir, env.requestId, filename))).toEqual(longOutput);
      if (mode === 'success') expect(typeof actual).toBe('object');
      else expect(typeof actual).toBe('string');
      if (mode === 'timeout' || mode === 'nonzero') {
        await env.call('write', { path: 'after-error.txt', content: 'can continue' });
        expect(JSON.stringify(await env.call('read', { path: 'after-error.txt' }))).toContain('can continue');
      }
      await env.sandbox.close();
      const next = env.execution.create({ ...env.scope, requestId: randomUUID(), signal: undefined });
      expect(await next.readFile(virtual)).toEqual(longOutput);
    });
  }

  it('does not leak a host storage path when the log cannot be created, and never executes bash', async () => {
    const env = await setup();
    await rm(env.logsDir, { recursive: true });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(env.logsDir, 'not a directory');
    await expect(env.call('bash', { command: 'should-not-run' })).rejects.toThrow('尚未启动命令');
  });

  it('maps native temporary paths with spaces in the configured temp directory', () => {
    const original = process.env.TMPDIR;
    process.env.TMPDIR = '/tmp/temp files';
    try { expect(mapBashLogText('[Full output: /tmp/temp files/pi-bash-0123456789abcdef.log]', '/logs/r/output.log')).toBe('[Full output: /logs/r/output.log]'); }
    finally { if (original === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = original; }
  });
});
