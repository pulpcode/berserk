/** Live provider + Docker, new independent data root, no production listener. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { PiLab } from '../src/pi/lab.js';
import type { SessionSnapshot } from '../src/contracts/index.js';

const config=loadConfig({...process.env,LAB_AUTH_MODE:'test'});
assert.ok(config.apiKey,'请配置可用 API Key。');
config.dataDir=await mkdtemp(join(tmpdir(),'axon-access-live-'));config.testSeats=undefined;config.seatId='a';
config.auth={secret:randomBytes(48).toString('hex'),sessionMs:3600000};config.agentRunTimeoutMs=600000;
const db=await openDatabase(config.dataDir);const access=new AccessStore(db);
for(const name of ['a','b'])await access.saveAccount({username:name,seatId:name,seatName:name,displayName:name,password:randomBytes(24).toString('hex'),createPublicTask:name==='a',manageModelSettings:name==='a'});
const actorId=String(db.prepare("SELECT id FROM accounts WHERE username='a'").get()!.id);const actor=access.identity(actorId)!;
const task=access.create(actor,{title:'真实验收任务',goal:'校验标记 AXON-TASK-0921；分别生成各席位报告，不共享工作目录。',visibility:'public',clientActionId:randomUUID()});db.close();
let lab=await PiLab.create(config);const evidence:object[]=[];
async function ask(id:string,seat:string,text:string):Promise<SessionSnapshot> {
  const request=lab.start(id,text,{},seat);
  await request.run(event=>{if(event.type==='interaction.updated' && event.interaction.status==='pending')lab.cancel(id,request.requestId,seat);});
  const snapshot=lab.get(id,seat);evidence.push({seat,sessionId:id,requestId:request.requestId,result:snapshot.lastResult,tools:snapshot.messages.filter(m=>m.requestId===request.requestId && m.role==='tool').map(m=>m.toolName)});
  assert.equal(snapshot.lastResult?.status,'succeeded',snapshot.lastResult?.message);return snapshot;
}
try {
  assert.equal(lab.info().files?.executionAvailable,true,'需要可用 Docker。');
  const a=await lab.workspaces.ensureWorkspace(task.id,'a',task.title),b=await lab.workspaces.ensureWorkspace(task.id,'b',task.title);
  const sa=await lab.createSession(a.id,'a'),sb=await lab.createSession(b.id,'b');
  await ask(sa.id,'a','先从当前任务说明读取校验标记；使用 write 工具写入 report-a.txt，内容为该标记和“席位A报告”，用 read 工具核验，然后用 file_output 提供下载。不要使用 bash，无需提问。');
  const body=await readFile(join(config.dataDir,'workspaces',a.id,'files','report-a.txt'),'utf8');assert.ok(body.includes('AXON-TASK-0921'));
  await ask(sb.id,'b','用 ls 工具查看当前目录，确认没有 report-a.txt。使用 write 工具创建 report-b.txt，写入“席位B独立报告”，用 file_output 提供下载。无需提问，不使用 bash。');
  assert.equal(await readFile(join(config.dataDir,'workspaces',b.id,'files','report-a.txt')).then(()=>true,()=>false),false);
  assert.ok((await readFile(join(config.dataDir,'workspaces',b.id,'files','report-b.txt'),'utf8')).includes('席位B'));
  await lab.close();lab=await PiLab.create(config);
  await ask(sa.id,'a','继续上一轮：只读取 report-a.txt 并告诉我它包含的校验标记，不修改文件。');
  assert.ok(lab.get(sa.id,'a').messages.at(-1)?.text.includes('AXON-TASK-0921'));
  await writeFile(join(config.dataDir,'validation.json'),JSON.stringify({passed:true,taskId:task.id,evidence},null,2));
  console.info(JSON.stringify({passed:true,dataDir:config.dataDir,requests:evidence.length}));
} finally {await lab.close();}
