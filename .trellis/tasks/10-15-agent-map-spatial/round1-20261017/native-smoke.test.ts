/** Fake-provider transport tests only; zero external requests and no semantic model results. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Observer,ask,hashes,selectionFor} from './run.js';
import {schedule,prepareFixture,prompts} from './cases.js';
import {startMapTrial,mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {loadControlledSkills} from '../../../../experiments/harness-lab/src/resources/service.js';
import type {WorkspaceResources} from '../../../../experiments/harness-lab/src/contracts/index.js';

test('all four real Pi/HTTP paths preserve model parameters and explicit/native Skill delivery',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'round1-native-smoke-')),original=globalThis.fetch;
 let trial:Awaited<ReturnType<typeof startMapTrial>>|undefined,calls=0,native=false;
 const payloads:Array<{model:string;max_tokens:number;thinking:{type:string};messages:Array<{role:string;content:unknown}>;tools:Array<{function:{name:string;parameters:unknown}}>}> = [];
 const synthetic:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.origin!=='https://api.deepseek.com'){assert.ok(['127.0.0.1','localhost'].includes(url.hostname));return original(input,init);}
  const payload=JSON.parse(String(init?.body));payloads.push(payload);calls++;
  const call=native&&calls===1?{name:'skill_read',arguments:{id:'spatial-analysis'}}:undefined;
  const delta=call?{role:'assistant',tool_calls:[{index:0,id:'fake-skill',type:'function',function:{name:call.name,arguments:JSON.stringify(call.arguments)}}]}:{role:'assistant',content:'确定性接线检查；不代表模型语义成功。'};
  const common={id:'fake',object:'chat.completion.chunk',created:1,model:payload.model};
  const chunks=[{...common,choices:[{index:0,delta,finish_reason:null}]},{...common,choices:[{index:0,delta:{},finish_reason:call?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}}];
  return new Response(chunks.map(c=>`data: ${JSON.stringify(c)}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
 };
 const observer=new Observer(synthetic,directory,await hashes());globalThis.fetch=observer.fetch;observer.live=true;
 try{
  for(const entry of schedule.filter(e=>e.kind==='J01')){
   const dir=join(directory,entry.id);await mkdir(dir);calls=0;native=entry.condition==='C';const firstIndex=payloads.length;
   trial=await startMapTrial(4488,{...process.env,LLM_PROVIDER:'deepseek',LLM_MODEL:entry.model,LLM_API_KEY:'deterministic-test-only',LLM_BASE_URL:'https://api.deepseek.com',LLM_CONTEXT_WINDOW:'1000000',LLM_MAX_OUTPUT_TOKENS:'4096',LLM_REQUEST_TIMEOUT_MS:'60000',LAB_EXECUTION_ENABLED:'false',LAB_PUBLIC_ORIGIN:undefined},false);
   const fixture=await prepareFixture(trial.manifest,'J01');
   const catalog=await mapTrialRequest<WorkspaceResources>(trial.manifest,`/api/workspaces/${fixture.workspaceId}/resources`,'planning');
   const skill=(await loadControlledSkills(['spatial-analysis']))[0];assert.equal(skill.hash,catalog.skills.find(s=>s.id==='spatial-analysis')!.hash);
   observer.budget.begin();observer.active={entry,fixture,trial,directory:dir,turn:0,interaction:false,toolCount:0,knownResultRefs:new Set()};
   const result=await ask(observer,selectionFor(entry.condition,catalog),prompts.J01[0]);
   assert.equal(result.snapshot.lastResult?.status,'succeeded');assert.deepEqual(result.after,fixture.before);assert.equal(observer.budget.fatal,undefined);
   const visible=(p:typeof payloads[number])=>p.messages.map(m=>typeof m.content==='string'?m.content:Array.isArray(m.content)?m.content.map((v:{text?:string})=>v.text??'').join('\n'):'').join('\n');
   const first=payloads[firstIndex];assert.equal(first.model,entry.model);assert.equal(first.max_tokens,4096);assert.equal(first.thinking.type,'disabled');
   assert.ok(first.tools.some(t=>t.function.name==='spatial_analyze'));assert.ok(JSON.stringify(first).includes('spatial-analysis'));
   assert.equal(visible(first).includes(JSON.stringify(skill.content).slice(1,-1)),entry.condition==='B');
   assert.ok(!first.messages.some(m=>m.role==='assistant'||m.role==='tool'));
   assert.ok(!JSON.stringify(first).includes('distancesM'));assert.ok(!JSON.stringify(first).includes('semanticReview'));assert.ok(!JSON.stringify(first).includes('nearest":'));
   if(native){assert.equal(calls,2);assert.ok(visible(payloads[firstIndex+1]).includes(JSON.stringify(skill.content).slice(1,-1)));assert.ok(result.snapshot.messages.some(m=>m.toolName==='skill.read'||m.toolName==='skill_read'));}
   else assert.equal(calls,1);
   await trial.stop();trial=undefined;observer.active=undefined;
  }
  assert.equal(payloads.length,6);assert.equal(observer.budget.total,6);
 }finally{await observer.settle();globalThis.fetch=original;await trial?.stop();}
});

test('provider synchronously reserves tools across responses before dispatch and retains blocked usage',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'round1-budget-smoke-'));
 const synthetic:typeof fetch=async()=>{
  const common={id:'budget-fake',object:'chat.completion.chunk',created:1,model:'deepseek-flash'};
  const calls=Array.from({length:2},(_,index)=>({index,id:`tool-${index}`,type:'function',function:{name:'annotation_read',arguments:'{"mode":"draft"}'}}));
  return new Response([{...common,choices:[{index:0,delta:{role:'assistant',tool_calls:calls},finish_reason:null}]},{...common,choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:20,completion_tokens:10}}].map(c=>`data: ${JSON.stringify(c)}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
 };
 const observer=new Observer(synthetic,directory,await hashes());observer.live=true;observer.budget.begin();
 observer.active={entry:schedule[0],fixture:{} as Awaited<ReturnType<typeof prepareFixture>>,trial:undefined as unknown as Awaited<ReturnType<typeof startMapTrial>>,directory,turn:0,interaction:false,toolCount:0,reservedToolCalls:63,knownResultRefs:new Set()};
 const response=await observer.fetch('https://api.deepseek.com/chat/completions',{method:'POST',body:JSON.stringify({model:'deepseek-flash',max_tokens:4096,thinking:{type:'disabled'},tools:[{function:{name:'annotation_read'}}]})});
 await assert.rejects(()=>response.text(),/Tool budget before dispatch/);
 assert.equal(observer.active.stop,'tool_budget');assert.equal(observer.active.reservedToolCalls,63);assert.equal(observer.active.toolCount,0);
 assert.equal(observer.budget.total,1);assert.equal(observer.budget.input,20);assert.equal(observer.budget.output,10);assert.equal(observer.attempts[0].completed,true);
 assert.match(observer.attempts[0].error!,/Tool budget/);assert.equal(observer.budget.fatal,undefined);
});
