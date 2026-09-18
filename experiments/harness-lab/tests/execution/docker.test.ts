import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DockerExecutionService, runDocker, type DockerCommandOptions, type DockerCommandResult, type DockerRunner } from '../../src/execution/docker.js';

const ok = (text = ''): DockerCommandResult => ({ code: 0, stdout: Buffer.from(text), stderr: Buffer.alloc(0) });
const roots: string[] = [];
async function scope(requestId: string) {
  const root = await mkdtemp(join(tmpdir(), 'execution-test-'));
  roots.push(root);
  await Promise.all(['files', 'logs'].map(name => mkdir(join(root, name))));
  return { requestId, workspaceDir: join(root, 'files'), logsDir: join(root, 'logs') };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

function fakeDocker(exec?: DockerRunner) {
  const calls: { args: string[]; options?: DockerCommandOptions }[] = [];
  const runner: DockerRunner = async (args, options) => {
    calls.push({ args, options });
    if (args[0] === 'info') return ok('linux');
    if (args[0] === 'exec' && exec) return exec(args, options);
    return ok();
  };
  return { calls, runner };
}

describe('request Docker execution', () => {
  it('settles a real control-client process after stream overflow or output receiver failure', async () => {
    const bin = await mkdtemp(join(tmpdir(), 'execution-client-')); roots.push(bin);
    await writeFile(join(bin, 'docker'), '#!/usr/bin/env node\nprocess.stdout.write(Buffer.alloc(8192)); setInterval(() => {}, 1000);\n', { mode: 0o755 });
    const original = process.env.PATH;
    process.env.PATH = `${bin}${delimiter}${original}`;
    try {
      await expect(runDocker([], { maxBytes: 1024, onData() {} })).rejects.toThrow('超过读取上限');
      await expect(runDocker([], { onData() { throw new Error('receiver failed'); } })).rejects.toThrow('输出接收失败');
    } finally { process.env.PATH = original; }
  });

  it('does not start containers for ordinary chat and fails closed without a daemon', async () => {
    const { calls, runner } = fakeDocker();
    const service = new DockerExecutionService({ instanceId: 'test' }, runner);
    await service.initialize();
    const sandbox = service.create(await scope('request-a'));
    expect(calls.some(call => call.args[0] === 'run')).toBe(false);
    await sandbox.close();
    expect(calls.some(call => call.args[0] === 'rm')).toBe(false);

    const missing = new DockerExecutionService({ instanceId: 'test' }, async () => { throw new Error('offline'); });
    expect((await missing.initialize()).available).toBe(false);
    const denied = missing.create(await scope('request-b'));
    await expect(denied.readFile('/workspace/a.txt')).rejects.toThrow('执行环境不可用');
    await denied.close();
  });

  it('binds only workspace and readonly logs with Linux isolation controls, never forwarding Pi env', async () => {
    const { calls, runner } = fakeDocker(async () => ok('bytes'));
    const service = new DockerExecutionService({ instanceId: 'test', uid: 1234, gid: 2345 }, runner);
    await service.initialize();
    const request = await scope('request-a');
    const sandbox = service.create(request);
    expect(await sandbox.readFile('/workspace/input.txt')).toEqual(Buffer.from('bytes'));
    await sandbox.exec('echo safe', '/workspace', { onData() {}, env: { LLM_API_KEY: 'must-never-forward', PI_SESSION_FILE: '/secret/history' } });
    const run = calls.find(call => call.args[0] === 'run')!.args;
    expect(run).toEqual(expect.arrayContaining(['--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '1234:2345', '--pids-limit', '128']));
    expect(run.filter(value => value.startsWith('type=bind'))).toEqual([
      `type=bind,src=${request.workspaceDir.replace(/^\/var\//, '/private/var/')},dst=/workspace`,
      `type=bind,src=${request.logsDir.replace(/^\/var\//, '/private/var/')},dst=/logs,readonly`,
    ]);
    expect(JSON.stringify(calls)).not.toContain('must-never-forward');
    expect(JSON.stringify(calls)).not.toContain('/secret/history');
    await sandbox.close();
  });

  it('stops just the cancelled request, settling an in-flight command before close returns', async () => {
    let resolveExecution!: (value: DockerCommandResult) => void;
    let commandStarted!: () => void;
    const running = new Promise<void>(resolve => { commandStarted = resolve; });
    const calls: string[][] = [];
    const runner: DockerRunner = async args => {
      calls.push(args);
      if (args[0] === 'info') return ok('linux');
      if (args[0] === 'ps') return ok();
      if (args[0] === 'exec' && args.includes('/opt/berserk/command.py')) {
        commandStarted();
        return new Promise(resolve => { resolveExecution = resolve; });
      }
      if (args[0] === 'rm') resolveExecution?.({ ...ok(), code: 137 });
      return ok('file');
    };
    const service = new DockerExecutionService({ instanceId: 'test' }, runner);
    await service.initialize();
    const a = service.create(await scope('request-a'));
    const b = service.create({ ...a.scope, requestId: 'request-b' });
    await b.readFile('/workspace/shared.txt');
    const abort = new AbortController();
    const execution = a.exec('sleep 999', '/workspace', { onData() {}, signal: abort.signal });
    const rejected = expect(execution).rejects.toThrow('取消');
    await running;
    abort.abort();
    await a.close();
    await rejected;
    expect(calls.filter(args => args[0] === 'rm').map(args => args[2])).toEqual([a.name]);
    expect((await b.readFile('/workspace/shared.txt')).toString()).toBe('file');
    await b.close();
  });

  it('cancellation during container startup removes the container before releasing', async () => {
    let finishStart!: (value: DockerCommandResult) => void;
    let signalStart!: () => void;
    const started = new Promise<void>(resolve => { signalStart = resolve; });
    const calls: string[][] = [];
    const service = new DockerExecutionService({ instanceId: 'test' }, async args => {
      calls.push(args);
      if (args[0] === 'info') return ok('linux');
      if (args[0] === 'run') { signalStart(); return new Promise(resolve => { finishStart = resolve; }); }
      return ok();
    });
    await service.initialize();
    const sandbox = service.create(await scope('request-a'));
    const read = expect(sandbox.readFile('/workspace/a')).rejects.toThrow('停止');
    await started;
    let closed = false;
    const close = sandbox.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    finishStart(ok('container'));
    await Promise.all([close, read]);
    expect(calls.some(args => args[0] === 'exec')).toBe(false);
    expect(calls.filter(args => args[0] === 'rm').map(args => args[2])).toEqual([sandbox.name]);
  });

  it('destroys the scope on output/transport failures, but allows ordinary nonzero exit', async () => {
    let broken = false;
    const { calls, runner } = fakeDocker(async () => {
      if (broken) throw new Error('output sink failed');
      return { ...ok(), code: 2 };
    });
    const service = new DockerExecutionService({ instanceId: 'test' }, runner);
    await service.initialize();
    const sandbox = service.create(await scope('request-a'));
    expect(await sandbox.exec('exit 2', '/workspace', { onData() {} })).toEqual({ exitCode: 2 });
    broken = true;
    await expect(sandbox.exec('generate-output', '/workspace', { onData() {} })).rejects.toThrow('output sink');
    expect(calls.filter(call => call.args[0] === 'rm')).toHaveLength(1);
    await expect(sandbox.readFile('/workspace/a')).rejects.toThrow('停止');
  });

  it('cleans only labelled owned orphan containers, and disables execution on uncertain cleanup', async () => {
    const calls: string[][] = [];
    const service = new DockerExecutionService({ instanceId: 'test' }, async args => {
      calls.push(args);
      if (args[0] === 'info') return ok('linux');
      if (args[0] === 'ps') return ok('abcd1234abcd');
      if (args[0] === 'rm') return { ...ok(), code: 1 };
      return ok();
    });
    expect((await service.initialize()).available).toBe(false);
    expect(calls[1]).toEqual(['ps', '-aq', '--filter', `label=io.berserk.harness.instance=${service.owner}`]);
    expect(calls[3]).toEqual(['ps', '-aq', '--no-trunc', '--filter', 'id=abcd1234abcd']);
  });
});
