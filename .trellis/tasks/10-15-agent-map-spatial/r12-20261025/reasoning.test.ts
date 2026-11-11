import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {offlineEnvironment} from '../r7-20261023/environment.js';
import {additions,assertPair,bodyFor,limits,prepare,prepareBase,read,repo,responseModel,verifyFrozen,type Payload} from './reasoning-prepare.js';
import {canStart,runComparison,type BatchState} from './reasoning-live.js';
function fixture(){const base=join(repo,'.local/spatial-r12');mkdirSync(base,{recursive:true});const directory=mkdtempSync(join(base,'offline-reasoning-'));return {directory,prepared:join(directory,'prepared'),output:join(directory,'output'),clean:()=>rmSync(directory,{recursive:true,force:true})};}
interface Reply {thinking?:boolean;usage?:boolean;finish?:string;tool?:boolean;malformed?:boolean;model?:string}
function reply(n:number,options:Reply={}){
 const model=options.model??responseModel,id=`offline-${n}`,thinking=options.thinking??false;
 const events:unknown[]=[{id,model,choices:[{index:0,delta:{role:'assistant'}}]}];
 if(thinking)events.push({id,model,choices:[{index:0,delta:{reasoning_content:'offline mock reasoning'}}]});
 events.push({id,model,choices:[{index:0,delta:options.tool?{tool_calls:[{index:0,id:'mock-call',function:{name:'annotation_read',arguments:'{"mode":"draft"}'}}]}:{content:'仅作为离线模拟的完整回答。'}}]});
 events.push({id,model,choices:[{index:0,delta:{},finish_reason:options.finish??(options.tool?'tool_calls':'stop')}],...(options.usage===false?{}:{usage:{prompt_tokens:22000,completion_tokens:thinking?80:20,completion_tokens_details:{reasoning_tokens:thinking?60:0}}})});
 const text=events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')+(options.malformed?'data: {broken}\n\n':'data: [DONE]\n\n');const bytes=new TextEncoder().encode(text);
 return new Response(new ReadableStream<Uint8Array>({start(controller){for(let i=0;i<bytes.length;i+=17)controller.enqueue(bytes.slice(i,i+17));controller.close();}}),{status:200});
}
function payload(init?:RequestInit){return JSON.parse(String(init?.body)) as Payload;}

test('six snapshots preserve real messages; only C05 appends declared text to existing user turn',()=>{
 const f=fixture();try{const freeze=prepare(f.prepared);assert.equal(freeze.schedule.length,12);assert.deepEqual(freeze.materials.map(m=>m.kind),['historical','historical','historical','historical','constructed','historical']);verifyFrozen(f.prepared,freeze);
  for(const m of freeze.materials){const source=read<Payload>(join(repo,m.sourcePath)),base=read<Payload>(join(f.prepared,m.basePath));assert.equal(base.messages.length,source.messages.length);assert.equal(base.messages.at(-1)?.role,'tool');assert.deepEqual(base.tools,source.tools);if(m.id!=='C05')assert.deepEqual(base,source);else{
   const expected=prepareBase(source,'C05').base;assert.deepEqual(base,expected);assert.deepEqual((JSON.parse(String(base.messages.at(-1)!.content)) as {data:{values:unknown}}).data.values,{total:5,interior:2,boundary:2,exterior:1});for(let i=0;i<source.messages.length;i++)if(i!==m.userMessageIndex)assert.deepEqual(base.messages[i],source.messages[i]);assert.ok(JSON.stringify(base.messages[m.userMessageIndex]).includes(additions.C05));
  }const a=bodyFor(base,'C0'),b=bodyFor(base,'C1');assertPair(a,b);assert.equal(a.reasoning_effort,undefined);assert.equal(b.reasoning_effort,'high');}
  assert.ok(freeze.schedule.reduce((n,s)=>n+s.inputReservation,0)<limits.input);assert.throws(()=>prepare(f.prepared),/overwrite/);
 }finally{f.clean();}
});

test('all 12 frozen slots run exactly once with alternating order, preserved SSE and no tool execution',async()=>{
 const f=fixture();try{const freeze=prepare(f.prepared);let calls=0;const transport:typeof fetch=async(_url,init)=>{const body=payload(init),slot=freeze.schedule[calls++];assert.equal(body.thinking?.type,slot.group==='C0'?'disabled':'enabled');assert.deepEqual(body,read(join(f.prepared,slot.bodyPath)));return reply(calls,{thinking:slot.group==='C1',tool:slot.id==='C06-C0'});};
  const state=await runComparison({prepared:f.prepared,directory:f.output,env:offlineEnvironment(),transport});assert.equal(calls,12);assert.equal(state.halted,undefined);assert.equal(state.totals.unknown,0);assert.equal(state.toolsExecuted,0);assert.equal(state.records.filter(r=>r.status==='answer').length,11);assert.equal(state.records.find(r=>r.id==='C06-C0')?.status,'needs_evidence');assert.equal(state.totals.output,6*80+6*20,'Reasoning tokens already in completion total; do not add twice');
  for(const row of state.records){assert.ok(row.requestSha256&&row.responseSha256);assert.ok(readFileSync(join(f.output,row.id,'response.sse'),'utf8').includes('data:'));assert.ok(row.output?.usage);}
  await assert.rejects(()=>runComparison({prepared:f.prepared,directory:join(f.directory,'second-output'),env:offlineEnvironment(),transport}),/already claimed/);assert.equal(calls,12);
 }finally{f.clean();}
});

test('missing thinking evidence in first enabled request stops C after exactly two requests',async()=>{
 const f=fixture();try{prepare(f.prepared);let calls=0;const state=await runComparison({prepared:f.prepared,directory:f.output,env:offlineEnvironment(),transport:async()=>reply(++calls)});assert.equal(calls,2);assert.match(state.halted??'',/thinking_effect_unverified/);assert.equal(state.records[0].status,'answer');assert.equal(state.records[1].status,'failed');assert.equal(state.records.filter(r=>r.status==='planned').length,10);assert.equal(state.totals.unknown,0);
 }finally{f.clean();}
});

test('HTTP failure is preserved, counted as attempted and never retried',async()=>{
 const f=fixture();try{prepare(f.prepared);let calls=0;const transport:typeof fetch=async()=>++calls===1?reply(calls):new Response('{"error":"balance"}',{status:402});const state=await runComparison({prepared:f.prepared,directory:f.output,env:offlineEnvironment(),transport});assert.equal(calls,2);assert.equal(state.totals.requests,2);assert.equal(state.totals.unknown,1);assert.equal(state.halted,'provider_http_402');assert.ok(readFileSync(join(f.output,'C01-C1','response-error.txt'),'utf8').includes('balance'));await assert.rejects(()=>runComparison({prepared:f.prepared,directory:f.output,env:offlineEnvironment(),transport}),/overwriting/);assert.equal(calls,2);
 }finally{f.clean();}
});

test('unknown usage, model drift and malformed streams stop further paid requests',async()=>{
 for(const opts of [{usage:false},{model:'unexpected-model'},{malformed:true}] as Reply[]){const f=fixture();try{prepare(f.prepared);let calls=0;const state=await runComparison({prepared:f.prepared,directory:f.output,env:offlineEnvironment(),transport:async()=>reply(++calls,opts)});assert.equal(calls,1);assert.equal(state.records[0].status,'failed');assert.ok(state.halted);assert.equal(state.records.filter(r=>r.status==='planned').length,11);assert.ok(readFileSync(join(f.output,'C01-C0','response.sse')).length>0);}finally{f.clean();}}
});

test('source input drift prevents the next request without modifying original evidence',async()=>{
 const f=fixture();try{const frozen=prepare(f.prepared);let calls=0;const state=await runComparison({prepared:f.prepared,directory:f.output,env:offlineEnvironment(),transport:async()=>{calls++;const target=join(f.prepared,frozen.schedule[1].bodyPath);const body=read<Payload>(target);body.messages.push({role:'user',content:'unapproved change'});writeFileSync(target,JSON.stringify(body));return reply(calls);}});assert.equal(calls,1);assert.ok(state.halted);assert.equal(state.records[1].status,'planned');
 }finally{f.clean();}
});

test('length output remains truncated rather than pass; pre-request budget protects next slot',async()=>{
 const f=fixture();try{const frozen=prepare(f.prepared);let calls=0;const state=await runComparison({prepared:f.prepared,directory:f.output,env:offlineEnvironment(),transport:async(_url,init)=>{calls++;return reply(calls,{thinking:payload(init).thinking?.type==='enabled',finish:calls===1?'length':undefined});}});assert.equal(calls,12);assert.equal(state.records[0].status,'truncated');assert.equal(state.halted,undefined);
  const fake:BatchState={...state,halted:undefined,totals:{requests:11,input:399999,output:0,unknown:0}};assert.equal(canStart(fake,frozen.schedule[0]),false);fake.totals={requests:11,input:0,output:399999,unknown:0};assert.equal(canStart(fake,frozen.schedule[0]),false);fake.totals={requests:12,input:0,output:0,unknown:0};assert.equal(canStart(fake,frozen.schedule[0]),false);
 }finally{f.clean();}
});
