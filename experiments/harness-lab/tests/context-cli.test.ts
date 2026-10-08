import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('runs independent HTTP and a local-only CLI control socket without auto-delivery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mc-'));
  const socketPath = join(directory, 'control.sock'), token = 'synthetic-cli-query-credential';
  const env = {...process.env, MOCK_CONTEXT_API_TOKEN: token, MOCK_CONTEXT_PORT: '0', MOCK_CONTEXT_CONTROL_SOCKET: socketPath};
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/mock-context/main.ts'], {env, stdio: ['ignore', 'pipe', 'pipe']});
  const exited = once(child, 'exit');
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      let output = '';
      child.stdout.on('data', chunk => {output += String(chunk); if (output.includes('模拟业务查询服务')) resolve(output);});
      child.on('error', reject); child.on('exit', code => reject(new Error(`模拟进程提前结束：${code}`)));
    });
    expect(stdout).not.toContain(token);
    expect((await stat(socketPath)).mode & 0o777).toBe(0o600);
    const control = async (...args: string[]) => JSON.parse((await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/mock-context/control.ts', ...args], {env})).stdout);
    const initial = await control('status'); expect(initial.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(await control('requests')).toEqual([]);
    await control('advance', 'situation'); const event = await control('event', 'E2');
    expect(event.text).toContain(initial.changeCursor);
    expect(await control('requests')).toEqual([]);
    const current = await fetch(`${initial.url}/situation/objects`, {headers: {Authorization: `Bearer ${token}`}});
    expect((await current.json()).changeCursor).not.toBe(initial.changeCursor);
    await control('unavailable', 'situation', 'on');
    expect((await fetch(`${initial.url}/situation/objects`, {headers: {Authorization: `Bearer ${token}`}})).status).toBe(503);
    await control('reset'); expect((await control('status')).changeCursor).not.toBe(initial.changeCursor);
    expect(JSON.stringify(await control('requests'))).not.toContain(token);
  } finally { child.kill('SIGTERM'); await exited; await rm(directory, {recursive: true, force: true}); }
});
