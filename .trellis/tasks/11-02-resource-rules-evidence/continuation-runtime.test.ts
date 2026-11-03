import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRuntime, startTrial } from '../11-02-task-resource-acceptance/runtime.js';
import { send } from '../11-02-task-resource-acceptance/run.js';
import { acceptanceCase } from '../11-02-task-resource-acceptance/cases.js';
import { profile } from '../11-02-task-resource-acceptance/budget.js';
import { sha256, type EvidenceSnapshot } from '../11-02-task-resource-acceptance/scoring.js';
import { reviewedContinuation } from './evaluation-v2.js';
import type { Interaction } from '../../../experiments/harness-lab/src/contracts/interactions.js';
function stream(index:number,mode:'ordinary'|'api') {
 const tool=index===1?{name:'task_resource_query',arguments:{operation:'query',purpose:'task'}}:index===0&&mode==='api'?{name:'ask_user',arguments:{questions:[{id:'region',prompt:'请选择北区：堤岸侧还是坡地侧',options:[{id:'bank',label:'北区（堤岸侧）'},{id:'hill',label:'北区（坡地侧）'}]}]}}:undefined;
 const delta=tool?{tool_calls:[{index:0,id:`call_${index}`,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.arguments)}}]}:{content:index===0?'请选择北区：堤岸侧还是坡地侧':'已查询任务资源，按堤岸侧继续处理完成。'};
 return new Response([JSON.stringify({id:`response_${index}`,model:'offline-fixture',choices:[{index:0,delta:{role:'assistant',...delta},finish_reason:null}]}),JSON.stringify({id:`response_${index}`,model:'offline-fixture',choices:[{index:0,delta:{},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:20}})].map(s=>'data: '+s+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
for(const mode of ['ordinary','api'] as const)test(`E07 ${mode} adapter sends real frozen answer into same Pi session and continues a real tool`,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rules-continuation-'));const original=globalThis.fetch;let trial:Awaited<ReturnType<typeof startTrial>>|undefined;let calls=0;
 const payloads:Array<{messages:Array<{role:string;content:string}>}>=[];
 try{
  const runtime=await buildRuntime(dir);const trialDir=join(dir,mode);mkdirSync(trialDir);
  globalThis.fetch=async(input,init)=>{const url=String(input);if(url.startsWith(profile.baseUrl)){payloads.push(JSON.parse(String(init?.body)));return stream(calls++,mode);}assert.match(url,/^http:\/\/(127\.0\.0\.1|localhost)(:|\/)/,'only local HTTP or deterministic provider fixture allowed');return original(input,init);};
  trial=await startTrial(runtime,trialDir,mode,'P03','offline-no-real-key');
  const scenario=acceptanceCase('P03'),quote='请选择北区：堤岸侧还是坡地侧';
  const match={reviewer:'offline deterministic review fixture',rationale:'原句确实询问区域，冻结堤岸侧事实可回答；测试不是模型语义审查。',factId:'p03-region',evidenceId:'question',quote};
  const observed=(kind:EvidenceSnapshot['kind'],text:string):EvidenceSnapshot=>({id:'question',sequence:1,kind,text,modelVisible:true,path:'constructed/runtime',sha256:sha256(text)});
  if(mode==='ordinary'){
   const first=await send(trial,'查北区资源。',{},1,async()=>{throw Error('unexpected interaction');});const actual=first.messages.findLast(m=>m.role==='assistant')!.text;assert.equal(actual,quote);
   const action=reviewedContinuation(scenario,observed('assistant',actual),match);assert.equal(action.kind,'clarify');if(action.kind!=='clarify')throw Error();
   const final=await send(trial,action.text,{},2,async()=>{throw Error('unexpected interaction');});assert.equal(final.lastResult!.status,'succeeded');assert.equal(final.messages.filter(m=>m.role==='user').length,2);assert.equal(final.messages.filter(m=>m.role==='user')[1]!.text,scenario.humanFacts[0]!.value);
  }else{
   const response=await fetch(`${trial.url}/api/sessions/${trial.sessionId}/messages`,{method:'POST',headers:{...trial.headers,'content-type':'application/json'},body:JSON.stringify({text:'查北区资源。'})});assert.ok(response.ok&&response.body);const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',answered=false;
   for(;;){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop()!;for(const line of lines){if(!line.startsWith('data:'))continue;const event=JSON.parse(line.slice(5)) as {type:string;interaction?:Interaction};if(event.type!=='interaction.updated'||event.interaction?.status!=='pending')continue;assert.equal(answered,false);const interaction=event.interaction;const action=reviewedContinuation(scenario,observed('controller',JSON.stringify(interaction)),{...match,questionId:'region',optionIds:['bank']},interaction);assert.ok('response'in action&&action.response);await trial.request(`/api/sessions/${trial.sessionId}/interactions/${interaction.interactionId}/response`,'POST',action.response);answered=true;}}
   assert.equal(answered,true);assert.equal(trial.lab.get(trial.sessionId,'acceptance').interactions![0]!.status,'answered');
  }
  const final=trial.lab.get(trial.sessionId,'acceptance');assert.equal(final.lastResult!.status,'succeeded');assert.ok(final.messages.some(m=>m.toolName==='task_resource_query'&&!m.isError));assert.equal(calls,3);assert.ok(payloads[1]!.messages.some(m=>JSON.stringify(m.content).includes(mode==='ordinary'?scenario.humanFacts[0]!.value:'bank')));assert.match(final.messages.findLast(m=>m.role==='assistant')!.text,/处理完成/);
 }finally{await trial?.close();globalThis.fetch=original;await rm(dir,{recursive:true,force:true});}
});
