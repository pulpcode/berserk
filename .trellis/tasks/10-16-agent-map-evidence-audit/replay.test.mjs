import test from 'node:test';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ROOT,pair,assertPair,schedule,limits,checkBudget,prepare,verify,runEntry} from './replay.mjs';
import {parseSSE,classify} from '../10-15-map-query-scope/model-comparison/replay.mjs';

test('fixed alternation and bounds: 30 samples, five per case/condition',()=>{
 for(const stage of ['S1','S2']){
  const list=schedule(stage);assert.equal(list.length,30);
  for(const c of new Set(list.map(e=>e.caseId)))for(const condition of ['A','B'])assert.equal(list.filter(e=>e.caseId===c&&e.condition===condition).length,5);
  assert.deepEqual(list.slice(6,8).map(e=>e.condition),['B','A']);
 }
 assert.throws(()=>checkBudget([{usage:null}]));
 assert.throws(()=>checkBudget([{usage:{prompt_tokens:2000000,completion_tokens:1}}]));
 assert.throws(()=>checkBudget([{usage:{prompt_tokens:1,completion_tokens:60000-2048+1}}]));
 assert.throws(()=>checkBudget(Array.from({length:96},()=>({usage:{prompt_tokens:1,completion_tokens:1}}))));
 assert.deepEqual(checkBudget([]),{input:0,output:0,calls:0});
});
test('A/B changes only final read summaries, leaves asymmetric conditions and full history intact',async()=>{
 for(const c of ['C1','C2','C4']){
  const original=JSON.parse(await readFile(join(ROOT,`.local/map-model-comparison/inputs/${c}.captured.json`),'utf8'));
  const {A,B}=pair(original);assert.deepEqual(A,{...original,max_tokens:2048});assertPair(A,B);
  assert.deepEqual(A.tools,B.tools);assert.deepEqual(A.messages[0],B.messages[0]);
  const changed=B.messages.map((m,i)=>!isDeepStrictEqual(m.content,A.messages[i].content)?i:-1).filter(i=>i>=0);
  assert.equal(changed.length,c==='C1'?2:1);
  const malformed=structuredClone(B);malformed.max_tokens=4096;assert.throws(()=>assertPair(A,malformed));
  const wrongQuery=structuredClone(original);const last=JSON.parse(wrongQuery.messages.at(-1).content);last.data.query.objectIds=['forged'];wrongQuery.messages.at(-1).content=JSON.stringify(last);assert.throws(()=>pair(wrongQuery));
 }
});
test('truncation, missing output and HTTP failure are never completed',()=>{
 for(const [raw,http,expected] of [['data: [DONE]\n\n',200,'missing_finish'],['',200,'truncated_stream'],['',500,'http_error']])assert.equal(classify(parseSSE(raw).result,null,http),expected);
 assert.equal(classify({finish_reason:'length'},null,200),'length_truncated');
 assert.equal(limits.timeoutMs,60000);
});
test('prepare is offline, authentic new fixtures, freeze protects inputs and duplicate runs',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'map-evidence-driver-')),output=join(temp,'batch');
 const oldFetch=globalThis.fetch;globalThis.fetch=()=>{throw new Error('network forbidden in test');};
 try{
  await prepare(output);await verify(output);await assert.rejects(()=>prepare(output));
  for(const c of ['N1','N2','N3']){
   const evaluator=JSON.parse(await readFile(join(output,`inputs/${c}.evaluator.json`),'utf8'));
   const A=JSON.parse(await readFile(join(output,`inputs/${c}.A.json`),'utf8'));
   const B=JSON.parse(await readFile(join(output,`inputs/${c}.B.json`),'utf8'));assertPair(A,B);
   assert.equal(A.tools.length,22);assert.ok(evaluator.receipt.ref);assert.ok(evaluator.document.layers.length);
   if(c==='N2'){assert.equal(evaluator.actual.objects.total,8);assert.deepEqual(evaluator.actual.objects.items,[]);}
   if(c==='N3')assert.ok(!JSON.stringify(A).includes(evaluator.truth.note));
  }
  const raw='data: '+JSON.stringify({choices:[{index:0,delta:{content:'synthetic test'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:2}})+'\n\ndata: [DONE]\n\n';
  let calls=0;const options={env:{LLM_API_KEY:'synthetic-secret'},fetchImpl:async()=>{calls++;return new Response(raw,{status:200});}};
  const record=await runEntry(output,'S1',1,options);assert.equal(record.status,'completed');assert.equal(calls,1);
  await assert.rejects(()=>runEntry(output,'S1',1,options));await assert.rejects(()=>runEntry(output,'S2',1,options));assert.equal(calls,1);
  const frozen=join(output,'inputs/C1.A.json');await writeFile(frozen,'{}');await assert.rejects(()=>verify(output));
 }finally{globalThis.fetch=oldFetch;await rm(temp,{recursive:true,force:true});}
});
