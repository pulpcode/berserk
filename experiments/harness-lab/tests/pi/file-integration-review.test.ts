import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PiLab } from '../../src/pi/lab.js';
import { loadConfig } from '../../src/server/config.js';
import { DockerExecutionService, type DockerRunner } from '../../src/execution/docker.js';
import { fakeRuntime, testConfig, type Reply } from './fake-runtime.js';
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const fn of cleanup.splice(0).reverse()) await fn();vi.restoreAllMocks();});
async function setup(reply:(index:number)=>Reply, unavailable=false, cleanupFailure=false) {
  const dataDir=await mkdtemp(join(tmpdir(),'berserk-integration-review-'));cleanup.push(()=>rm(dataDir,{recursive:true,force:true}));
  const config=testConfig(dataDir);const fake=await fakeRuntime(config,(_context,index)=>reply(index));
  const calls:string[][]=[];
  const runner:DockerRunner=async args=>{
    calls.push(args);
    if(args[0]==='info') return {code:unavailable?1:0,stdout:Buffer.from(unavailable?'':'linux'),stderr:Buffer.alloc(0)};
    if(cleanupFailure && args[0]==='rm') return {code:1,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)};
    if(cleanupFailure && args[0]==='ps' && args.includes('--no-trunc')) return {code:0,stdout:Buffer.from('remaining-container'),stderr:Buffer.alloc(0)};
    if(args[0]==='exec') {
      const operation=args[args.indexOf('/opt/berserk/files.py')+1];
      return {code:0,stdout:Buffer.from(operation==='stat'?JSON.stringify({directory:false}):'文件内容'),stderr:Buffer.alloc(0)};
    }
    return {code:0,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)};
  };
  const execution=new DockerExecutionService({instanceId:dataDir},runner);
  vi.spyOn(console,'warn').mockImplementation(()=>{});
  const lab=await PiLab.create(config,fake.runtime,execution);
  cleanup.push(async()=>{try{await lab.close();}catch{if(!cleanupFailure)throw new Error('unexpected cleanup failure');}});
  return {lab,fake,calls};
}
async function waitFor(check:()=>boolean) {
  for(let i=0;i<200;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}
  throw new Error('condition did not settle');
}
describe('file execution integration review',()=>{
  it('keeps ordinary chat available and does not advertise tools when Docker is unavailable',async()=>{
    const {lab,fake,calls}=await setup(()=>({text:'普通回答'}),true);
    const session=await lab.createSession();await lab.start(session.id,'普通问答').run(()=>{});
    expect(lab.info().files?.executionAvailable).toBe(false);
    expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
    expect(fake.calls[0].context.tools?.map(tool=>tool.name)).not.toContain('bash');
    expect(fake.calls[0].context.systemPrompt).toContain('当前文件执行环境未启用');
    expect(calls.some(args=>args[0]==='run')).toBe(false);
  });
  it('initializes logs for the first file read in a fresh workspace without an upload or file-panel visit',async()=>{
    const {lab,calls}=await setup(index=>index===0?{tools:[{name:'read',arguments:{path:'hello.txt'}}]}:{text:'读取完成'});
    const workspace=await lab.workspaces.create('新项目');const session=await lab.createSession(workspace.id);
    await writeFile(join(lab.files.filesDirectory(workspace.id),'hello.txt'),'hello');
    await lab.start(session.id,'读取文件').run(()=>{});
    const snapshot=lab.get(session.id);
    expect(snapshot.messages.find(message=>message.role==='tool'&&message.toolName==='read')?.isError).toBe(false);
    expect(calls.filter(args=>args[0]==='run')).toHaveLength(1);
    expect(calls.filter(args=>args[0]==='rm')).toHaveLength(1);
  });
  it('shares request scope with readonly child tools and cleans it only when the parent settles',async()=>{
    const {lab,fake,calls}=await setup(index=>index===0?{tools:[{name:'subagent',arguments:{agent:'reviewer',task:'读取 hello.txt 检查'}}]}:index===1?{tools:[{name:'read',arguments:{path:'hello.txt'}}]}:{text:index===2?'子任务检查完成':'父任务完成'});
    const session=await lab.createSession();await writeFile(join(lab.files.filesDirectory(session.workspaceId),'hello.txt'),'hello');
    await lab.start(session.id,'委派检查文件').run(()=>{});
    const childTools=fake.calls[1].context.tools?.map(tool=>tool.name);
    expect(childTools).toContain('read');for(const name of ['write','edit','bash','file_output','subagent'])expect(childTools).not.toContain(name);
    expect(lab.get(session.id).subagents?.[0].status).toBe('succeeded');
    expect(calls.filter(args=>args[0]==='run')).toHaveLength(1);expect(calls.filter(args=>args[0]==='rm')).toHaveLength(1);
  });
  it('stops a delegated reader and its shared sandbox when the parent is cancelled',async()=>{
    const {lab,fake,calls}=await setup(index=>index===0?{tools:[{name:'subagent',arguments:{agent:'reviewer',task:'读取 hello.txt 然后分析'}}]}:index===1?{tools:[{name:'read',arguments:{path:'hello.txt'}}]}:{waitForAbort:true});
    const session=await lab.createSession();await writeFile(join(lab.files.filesDirectory(session.workspaceId),'hello.txt'),'hello');
    const run=lab.start(session.id,'委派检查');const done=run.run(()=>{});await waitFor(()=>fake.calls.length===3);
    lab.cancel(session.id,run.requestId);await done;
    const snapshot=lab.get(session.id);expect(snapshot.lastResult?.status).toBe('cancelled');
    expect(snapshot.subagents?.[0].status).toBe('cancelled');expect(snapshot.active).toBeNull();
    expect(calls.filter(args=>args[0]==='rm')).toHaveLength(1);
  });
  it('reports unconfirmed cleanup as failure and blocks continuation instead of claiming cancellation succeeded',async()=>{
    const {lab,fake}=await setup(index=>index===0?{tools:[{name:'read',arguments:{path:'hello.txt'}}]}:{waitForAbort:true},false,true);
    const session=await lab.createSession();await writeFile(join(lab.files.filesDirectory(session.workspaceId),'hello.txt'),'hello');
    const run=lab.start(session.id,'读取后继续');const done=run.run(()=>{});await waitFor(()=>fake.calls.length===2);
    lab.cancel(session.id,run.requestId);await done;
    const snapshot=lab.get(session.id);expect(snapshot.lastResult?.status).toBe('failed');expect(snapshot.lastResult?.message).toContain('无法确认');
    expect(snapshot.recoveryWarning).toBeTruthy();expect(()=>lab.start(session.id,'继续')).toThrow(/无法确认/);
    expect(lab.info().files?.executionAvailable).toBe(false);
  });
  it('rejects explicit empty or overlong seat IDs consistently with storage ownership',()=>{
    expect(()=>loadConfig({LAB_SEAT_ID:''})).toThrow(/LAB_SEAT_ID/);
    expect(()=>loadConfig({LAB_SEAT_ID:'s'.repeat(65)})).toThrow(/LAB_SEAT_ID/);
    expect(loadConfig({LAB_SEAT_ID:'s'.repeat(64)}).seatId).toHaveLength(64);
  });
});
