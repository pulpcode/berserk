import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {WorkspaceResources} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {ask,hashes as originalHashes,limits,Budget} from '../round1-20261017/run.js';
import {schedule,cases,groups,promptsFor,prepareFixture} from './cases.js';
import {R2Observer,sourceHashes,buildRuntime,selectionFor} from './run.js';

test('48 immutable single-body trials preserve one explicit selection and balanced groups',()=>{
 assert.equal(schedule.length,48);assert.equal(new Set(schedule.map(e=>e.id)).size,48);
 for(const c of cases){const entries=schedule.filter(e=>e.caseId===c);assert.equal(entries.length,3);assert.equal(new Set(entries.map(e=>e.group)).size,3);assert.equal(new Set(entries.map(e=>e.selectedSkill)).size,1);assert.equal(new Set(entries.map(e=>JSON.stringify(promptsFor(e)))).size,1);}
 for(const g of groups)assert.equal(schedule.filter(e=>e.group===g).length,16);
 assert.ok(schedule.every(e=>e.model==='deepseek-v4-pro'&&e.condition==='B'&&e.round===1));
 assert.equal(limits.input,6000000);const b=new Budget();b.begin();b.input=6000000;assert.throws(()=>b.reserve(),/batch_budget/);
});

test('real native HTTP delivery verifies both explicit selections and native other Skill reads in all three byte-isolated runtimes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'r2-smoke-')),original=globalThis.fetch;
 let calls=0,otherSkill='',otherContent='';
 const synthetic:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://api.deepseek.com')return original(input,init);
  calls++;const payload=JSON.parse(String(init?.body));assert.equal(payload.model,'deepseek-v4-pro');
  if(calls===2){const text=payload.messages.map((m:{content:unknown})=>typeof m.content==='string'?m.content:Array.isArray(m.content)?m.content.map((b:{text?:string})=>b.text??'').join('\n'):'').join('\n');assert.ok(text.includes(otherContent)||text.includes(JSON.stringify(otherContent).slice(1,-1)),'Native other Skill body not delivered exactly');}
  const call=calls===1?{name:'skill_read',arguments:{id:otherSkill}}:undefined;
  const delta=call?{role:'assistant',tool_calls:[{index:0,id:'fake-other',type:'function',function:{name:call.name,arguments:JSON.stringify(call.arguments)}}]}:{role:'assistant',content:'仅确定性接线检查，不是模型语义测评。'};
  const common={id:'fake',object:'chat.completion.chunk',created:1,model:payload.model};
  return new Response([{...common,choices:[{index:0,delta,finish_reason:null}]},{...common,choices:[{index:0,delta:{},finish_reason:call?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:10}}].map(c=>`data: ${JSON.stringify(c)}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
 };
 const frozen=await sourceHashes(),observer=new R2Observer(synthetic,directory,await originalHashes(),frozen);observer.live=true;globalThis.fetch=observer.fetch;
 let trial:Awaited<ReturnType<Awaited<ReturnType<typeof buildRuntime>>['start']>>|undefined;
 try{
  for(const group of groups){
   const runtime=await buildRuntime(directory,group);
   for(const kind of ['J01','J02'] as const){
    const entry=schedule.find(e=>e.kind===kind&&e.group===group)!;const dir=join(directory,entry.id);await mkdir(dir);calls=0;otherSkill=entry.selectedSkill==='spatial-analysis'?'map-annotations':'spatial-analysis';otherContent=runtime.skills[otherSkill].content;
    trial=await runtime.start(4498,{...process.env,LLM_PROVIDER:'deepseek',LLM_MODEL:entry.model,LLM_API_KEY:'fake-only',LLM_BASE_URL:'https://api.deepseek.com',LLM_CONTEXT_WINDOW:'1000000',LLM_MAX_OUTPUT_TOKENS:'4096',LLM_REQUEST_TIMEOUT_MS:'60000',LAB_EXECUTION_ENABLED:'false',LAB_PUBLIC_ORIGIN:undefined},false);
    const fixture=await prepareFixture(trial.manifest,entry);const catalog=await mapTrialRequest<WorkspaceResources>(trial.manifest,`/api/workspaces/${fixture.workspaceId}/resources`,'planning');
    for(const id of ['map-annotations','spatial-analysis'])assert.equal(catalog.skills.find(s=>s.id===id)!.hash,runtime.skills[id].hash);
    observer.begin(runtime,entry);observer.active={entry,fixture,trial,directory:dir,turn:0,interaction:false,toolCount:0,knownResultRefs:new Set()};
    const result=await ask(observer,selectionFor(entry,catalog),promptsFor(entry)[0]);assert.equal(result.snapshot.lastResult?.status,'succeeded');assert.deepEqual(result.after,fixture.before);assert.equal(calls,2);assert.equal(observer.budget.fatal,undefined);
    const selected=result.snapshot.messages.find(m=>m.selections?.skill)?.selections?.skill;assert.equal(selected?.content,runtime.skills[entry.selectedSkill].content);
    assert.ok(result.snapshot.messages.some(m=>m.toolName==='skill_read'||m.toolName==='skill.read'));
    await trial.stop();trial=undefined;observer.active=undefined;
   }
  }
  assert.equal(observer.budget.total,12);
 }finally{await observer.settle();globalThis.fetch=original;await trial?.stop();}
});
