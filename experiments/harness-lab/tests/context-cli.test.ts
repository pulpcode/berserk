import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { control as socketControl } from '../scripts/probe-task-plan.js';

it('keeps CLI and director socket read-only, rejects retired writes without changing source facts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mc-'));
  const socketPath = join(directory, 'control.sock'), token = 'synthetic-cli-query-credential';
  const env = {...process.env, MOCK_CONTEXT_API_TOKEN: token, MOCK_CONTEXT_PORT: '0', MOCK_CONTEXT_CONTROL_SOCKET: socketPath,MOCK_CONTEXT_SCENARIOS_ENABLED:'true',MOCK_CONTEXT_CONTROL_TOKEN:'synthetic-cli-control-credential',MOCK_CONTEXT_NOTIFICATION_CONFIG:undefined,MOCK_CONTEXT_DATA_DIR:undefined,MOCK_CONTEXT_INSTANCE_ID:undefined};
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/mock-context/main.ts'], {env, stdio: ['ignore', 'pipe', 'pipe']});
  const exited = once(child, 'exit');
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      let output = '';
      child.stdout.on('data', chunk => {output += String(chunk); if (output.includes('模拟业务查询服务')) resolve(output);});
      child.on('error', reject); child.on('exit', code => reject(new Error(`模拟进程提前结束：${code}`)));
    });
    expect(stdout).not.toContain(token);expect(stdout).not.toContain(env.MOCK_CONTEXT_CONTROL_TOKEN);
    expect((await stat(socketPath)).mode & 0o777).toBe(0o600);
    const control = async (...args: string[]) => JSON.parse((await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/mock-context/control.ts', ...args], {env})).stdout);
    const initial = await control('status'); expect(initial.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(await control('requests')).toEqual([]);
    const read=async()=>{
      const response=await fetch(`${initial.url}/situation/objects`,{headers:{Authorization:`Bearer ${token}`}});
      expect(response.status).toBe(200);return response.json();
    };
    const before=await read();
    for(const args of [['reset'],['advance','situation'],['advance','recovery'],['event','E2'],['event','E4'],['unavailable','situation','on']]){
      await expect(control(...args)).rejects.toMatchObject({code:1,stderr:expect.stringContaining('旧 reset/advance/event/unavailable 控制入口已停用')});
      // A caller bypassing the CLI still cannot perform an unscoped write through the socket.
      await expect(socketControl(socketPath,args)).rejects.toThrow();
    }
    expect(await control('status')).toEqual(initial);
    expect(await read()).toEqual(before);
    const reports=await fetch(`${initial.url}/intel/reports?reportId=report-west-01`,{headers:{Authorization:`Bearer ${token}`}});
    expect((await reports.json()).items.map((report:{revision:number})=>report.revision)).toEqual([1]);
    const requests=await control('requests') as Array<{method:string;path:string}>;
    expect(requests.every(request=>request.method==='GET')).toBe(true);
    expect(requests.some(request=>request.path.includes('/events'))).toBe(false);
    expect(JSON.stringify(await control('requests'))).not.toContain(token);expect(JSON.stringify(await control('requests'))).not.toContain(env.MOCK_CONTEXT_CONTROL_TOKEN);
  } finally { child.kill('SIGTERM'); await exited; await rm(directory, {recursive: true, force: true}); }
});
