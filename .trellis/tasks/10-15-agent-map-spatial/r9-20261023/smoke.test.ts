import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {runLive} from './live.js';import {schedule,cases} from './cases.js';
import {cases as originals} from '../r8-20261023/cases.js';
import {offlineEnvironment,loopbackOnly} from '../r8-20261023/runtime.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
import type {Payload} from '../r3-20261022/audit.js';
const read=<T>(path:string):T=>JSON.parse(readFileSync(path,'utf8')) as T;
test('exact nine native B trials, unique IDs, interleaved rounds and byte-identical prompts',()=>{
 assert.equal(schedule.length,9);assert.equal(new Set(schedule.map(e=>e.id)).size,9);
 assert.deepEqual(schedule.map(e=>e.caseId),['D17','D02','D23','D17','D02','D23','D17','D02','D23']);
 assert.deepEqual(schedule.map(e=>e.round),[1,1,1,2,2,2,3,3,3]);
 assert.ok(schedule.every(e=>e.group==='B'&&e.loading==='native'));
 for(const c of cases)assert.deepEqual(c,originals.find(o=>o.id===c.id));
});
test('native nine independent sessions, no explicit bodies, actual Flash parameters and resume skips all',{timeout:120000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r9-nine-')),directory=join(parent,'batch'),original=globalThis.fetch;let calls=0;
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);
  const payload=JSON.parse(String(init?.body)) as Payload;calls++;assert.equal(payload.model,'deepseek-v4.1-flash');assert.equal(payload.max_tokens,8192);assert.equal(payload.thinking?.type,'disabled');
  assert.ok(!JSON.stringify(payload.messages).includes('所选 Skill 正文已经加载'));return fakeResponse(payload.model!);
 };
 const result=await runLive({directory,env:offlineEnvironment(),transport,port:4603});assert.equal(result.stop,undefined);assert.equal(calls,9);
 const sessions=schedule.map(e=>read<{fixture:{sessionId:string}}>(join(directory,e.id,'fixture.json')).fixture.sessionId);assert.equal(new Set(sessions).size,9);
 for(const e of schedule)assert.equal(read<{selection:unknown}>(join(directory,e.id,'resources.json')).selection,null);
 const again=await runLive({directory,env:offlineEnvironment(),transport,port:4603,resume:true});assert.equal(again.total.requests,9);assert.equal(calls,9);
});
test('R9 protocol drift halts before second external request and retains original evidence',{timeout:60000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r9-drift-')),directory=join(parent,'batch'),original=globalThis.fetch;let calls=0;
 const marker=fileURLToPath(new URL('./.offline-drift-marker',import.meta.url));
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);
  calls++;writeFileSync(marker,'offline injected protocol drift');const payload=JSON.parse(String(init?.body)) as Payload;return fakeResponse(payload.model!,{name:'skill_read',arguments:{id:'spatial-analysis'}});
 };
 try{const result=await runLive({directory,entries:[schedule[0]],env:offlineEnvironment(),transport,port:4603});assert.equal(calls,1);assert.equal(result.stop,'freeze_or_injection_failure');assert.equal(result.total.requests,1);assert.equal(read<unknown[]>(join(directory,'attempts.json')).length,1);assert.ok(read<{source:{r9:unknown}}>(join(directory,'protocol.json')).source.r9);}
 finally{try{unlinkSync(marker);}catch{ /* No marker if preparation failed before simulated transport. */ }}
});
