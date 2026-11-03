import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildRuntime,startTrial,selection,hashes,type Runtime} from './runtime.js';
import {schedule,acceptanceCase} from './cases.js';
import {send,observedEvidence} from './run.js';
import {Provider} from './provider.js';
import {Ledger,models} from './budget.js';
const directory=mkdtempSync(join(tmpdir(),'scope-native-offline-')),original=globalThis.fetch;let runtime:Runtime;
before(async()=>{runtime=await buildRuntime(directory);runtime.verify=async()=>assert.deepEqual(hashes(runtime.root),runtime.integrity);});
after(()=>{globalThis.fetch=original;console.info('Retained deterministic evidence:',directory);});
function stream(group:'A'|'B',tool?:{name:string;arguments:unknown},thought='offline-thought'){
 const delta=tool?{reasoning_content:thought,tool_calls:[{index:0,id:'call_offline',type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.arguments)}}]}:{content:'确定性离线流程完成。'};
 return new Response([{model:models[group].responseModel,choices:[{index:0,delta:{role:'assistant',...delta},finish_reason:null}]},{model:models[group].responseModel,choices:[{index:0,delta:{},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:20}}].map(x=>'data: '+JSON.stringify({id:'offline',object:'chat.completion.chunk',...x})+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
for(const slot of schedule)test('real HTTP/Pi frozen slot '+slot.id,async()=>{
 const folder=join(directory,slot.id);mkdirSync(folder);const ledger=new Ledger(join(folder,'ledger.json'),'offline');let calls=0;
 const provider=new Provider({group:slot.group,secret:'offline-key',verify:async()=>{},original:async(input,init)=>{
  if(String(input).startsWith('http://127.0.0.1'))return original(input,init);
  assert.equal(String(input),models[slot.group].baseUrl+'/chat/completions');calls++;const payload=JSON.parse(String(init?.body));writeFileSync(join(folder,`wire-${calls}.json`),JSON.stringify(payload));
  if(calls===1)return stream(slot.group,{name:'annotation_read',arguments:{mode:'draft',fields:['geometry','resource'],limit:100}});
  const assistant=payload.messages.findLast((m:{role:string;tool_calls?:unknown[]})=>m.role==='assistant'&&m.tool_calls?.length);assert.equal(assistant.reasoning_content,'offline-thought','native SDK must replay new tool-call reasoning');
  return stream(slot.group);
 }},ledger);globalThis.fetch=provider.fetch;
 const trial=await startTrial(runtime,folder,slot.id,slot.caseId,'offline-key',4359);provider.active={id:slot.id,directory:folder,startedAt:Date.now()};
 try{let turn=0;for(const item of acceptanceCase(slot.caseId).turns){const snapshot=await send(trial,item.text,selection(trial,item),++turn,async()=>{throw Error('unexpected question');});assert.equal(snapshot.lastResult?.status,'succeeded');assert.ok(!snapshot.messages.some(m=>m.role==='tool'&&m.isError));}assert.equal(ledger.totals().unknown,0);}finally{await trial.close();globalThis.fetch=original;}
});
test('native two-question ask_user answered once through actual API',async()=>{
 const folder=join(directory,'multi');mkdirSync(folder);let calls=0;
 globalThis.fetch=async(input,init)=>{if(String(input).startsWith('http://127.0.0.1'))return original(input,init);return ++calls===1?stream('A',{name:'ask_user',arguments:{questions:[{id:'region',prompt:'哪个北区？'},{id:'boundary',prompt:'边界线单列吗？'}]}}):stream('A');};
 const trial=await startTrial(runtime,folder,'multi','D03','offline-key',4359);
 try{const scenario=acceptanceCase('D03');const snapshot=await send(trial,scenario.turns[0].text,selection(trial,scenario.turns[0]),1,async(_name,evidence)=>{const {observed}=evidence as {observed:ReturnType<typeof observedEvidence>};return {kind:'clarify',reviewer:'offline-author',rationale:'两个实际问题分别对应冻结事实',evidenceId:observed.id,matches:[{factId:scenario.humanFacts[0].id,questionId:'region',quote:'哪个北区？'},{factId:'boundary',questionId:'boundary',quote:'边界线单列吗？'}]};});assert.equal(snapshot.lastResult?.status,'succeeded');assert.equal(snapshot.interactions?.[0].status,'answered');assert.equal(calls,2);}finally{await trial.close();globalThis.fetch=original;}
});
