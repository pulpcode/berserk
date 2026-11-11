import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {classify,collectResponse} from './reasoning-live.js';
import {digest,endpoint,limits,maxTokens,read,repo,responseModel,type Payload} from './reasoning-prepare.js';
import {canStartCompletion,classifyCompletion,completionIds,inspectOriginal,liveClaimPath,observeThinking,originalTotals,prepareCompletion,runCompletion,type CompletionState} from './reasoning-completion.js';

function fixture(){const directory=mkdtempSync(join(repo,'.local/spatial-r12/offline-completion-'));return {directory,prepared:join(directory,'prepared'),output:join(directory,'output'),clean:()=>rmSync(directory,{recursive:true,force:true})};}
interface Reply {thinking?:boolean;usage?:boolean;finish?:string;tool?:boolean;malformed?:boolean;model?:string;input?:number;output?:number;empty?:boolean}
function reply(n:number,options:Reply={}){
 const model=options.model??responseModel,id=`offline-completion-${n}`,thinking=options.thinking??false;
 const events:unknown[]=[{id,model,choices:[{index:0,delta:{role:'assistant'}}]}];
 if(thinking)events.push({id,model,choices:[{index:0,delta:{reasoning_content:'offline reasoning fixture'}}]});
 events.push({id,model,choices:[{index:0,delta:options.tool?{tool_calls:[{index:0,id:'mock-call',function:{name:'annotation_read',arguments:'{"mode":"draft"}'}}]}:{content:options.empty?'':'完整离线模拟回答。'}}]});
 events.push({id,model,choices:[{index:0,delta:{},finish_reason:options.finish??(options.tool?'tool_calls':'stop')}],...(options.usage===false?{}:{usage:{prompt_tokens:options.input??22000,completion_tokens:options.output??80,completion_tokens_details:{reasoning_tokens:thinking?60:0}}})});
 const text=events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join('')+(options.malformed?'data: {broken}\n\n':'data: [DONE]\n\n');
 const bytes=new TextEncoder().encode(text);
 return new Response(new ReadableStream<Uint8Array>({start(controller){for(let i=0;i<bytes.length;i+=17)controller.enqueue(bytes.slice(i,i+17));controller.close();}}),{status:200});
}
function options(f:ReturnType<typeof fixture>,transport:typeof fetch){return {prepared:f.prepared,directory:f.output,offlineClaimDirectory:f.directory,transport};}
async function parsed(replyOptions:Reply={}){const {output,parser}=collectResponse();parser.push(new Uint8Array(await reply(1,replyOptions).arrayBuffer()));return output;}

test('original seven are independently reconciled; prepared five preserve exact bytes and prior budget',()=>{
 const f=fixture();try{
  const original=inspectOriginal();assert.deepEqual(original.totals,originalTotals);
  const frozen=prepareCompletion(f.prepared);assert.deepEqual(frozen.schedule.map(slot=>slot.id),completionIds);assert.equal(frozen.schedule.reduce((sum,slot)=>sum+slot.inputReservation,0),127938);
  assert.equal(frozen.plannedRequests,5);assert.equal(frozen.originalTotals.requests+frozen.plannedRequests,12);
  for(const slot of frozen.schedule){const bytes=readFileSync(join(f.prepared,slot.bodyPath));assert.deepEqual(bytes,readFileSync(join(frozen.originalPrepared,slot.bodyPath)));assert.equal(digest(JSON.stringify(JSON.parse(bytes.toString('utf8')))),slot.bodySha256);}
  assert.throws(()=>prepareCompletion(f.prepared),/overwriting prepared/);
 }finally{f.clean();}
});

test('five exact first attempts continue through C1 zero thinking; single marker survives new prepared/output paths',async()=>{
 const f=fixture();try{
  const freeze=prepareCompletion(f.prepared),other=join(f.directory,'another-prepared');prepareCompletion(other);let calls=0;
  const transport:typeof fetch=async(url,init)=>{
   const slot=freeze.schedule[calls++];assert.equal(url,endpoint+'/chat/completions');assert.equal(init?.redirect,'error');assert.equal(digest(String(init?.body)),slot.bodySha256);
   assert.deepEqual(JSON.parse(String(init?.body)),read(join(f.prepared,slot.bodyPath)));
   const state=read<CompletionState>(join(f.output,'progress.json'));assert.equal(state.totals.requests,calls);assert.equal(state.totals.unknown,1);assert.equal(state.records[calls-1].status,'started');assert.ok(existsSync(join(f.output,slot.id,'attempt.json')));
   return reply(calls);
  };
  const state=await runCompletion(options(f,transport));assert.equal(calls,5);assert.equal(state.halted,undefined);assert.equal(state.totals.unknown,0);assert.equal(state.records.filter(row=>row.status==='answer').length,5);assert.equal(state.offlineSimulation,true);
  assert.deepEqual(state.cumulativeTotals,{requests:12,input:146903+110000,output:2588+400,unknown:0});assert.equal(state.toolsExecuted,0);
  for(const row of state.records){assert.deepEqual(row.observedThinking,{signal:'not_observed',characters:0,tokens:0});assert.ok(row.requestSha256&&row.responseSha256);assert.equal(row.requestedThinking,row.group==='C0'?'disabled':'enabled');assert.equal(row.requestedEffort,row.group==='C0'?'absent':'high');}
  await assert.rejects(()=>runCompletion({...options(f,transport),prepared:other,directory:join(f.directory,'second-output')}),/already claimed/);assert.equal(calls,5);
  assert.equal(existsSync(liveClaimPath),false,'Offline transport must not consume the real execution claim');
 }finally{f.clean();}
});

test('C1 zero thinking tool calls and truncation remain recorded, never executed or filtered',async()=>{
 const f=fixture();try{prepareCompletion(f.prepared);let calls=0;
  const state=await runCompletion(options(f,async()=>{calls++;return reply(calls,{tool:calls===3,finish:calls===4?'length':undefined});}));
  assert.equal(calls,5);assert.equal(state.halted,undefined);assert.equal(state.records[2].status,'needs_evidence');assert.equal(state.records[3].status,'truncated');assert.equal(state.records[2].observedThinking?.signal,'not_observed');assert.equal(state.records[3].observedThinking?.signal,'not_observed');assert.equal(state.toolsExecuted,0);assert.equal(state.semanticReview,'pending_agent_review');
 }finally{f.clean();}
});

test('C0 positive thinking stops; C1 positive observation does not add reasoning tokens twice',async()=>{
 const f=fixture();try{prepareCompletion(f.prepared);let calls=0;const state=await runCompletion(options(f,async()=>reply(++calls,{thinking:true})));assert.equal(calls,1);assert.match(state.halted??'',/disabled_thinking_not_effective/);assert.equal(state.records[0].observedThinking?.signal,'observed');assert.equal(state.totals.output,80);assert.equal(state.totals.unknown,0);assert.equal(state.records.filter(row=>row.status==='planned').length,4);
  const output=await parsed({thinking:true});assert.equal(classifyCompletion(output,'C1'),'answer');assert.equal(observeThinking(output).tokens,60);
 }finally{f.clean();}
});

test('HTTP and thrown transport failures retain unknown attempt, halt and cannot be retried',async()=>{
 for(const failure of ['http','throw','stream']){const f=fixture();try{prepareCompletion(f.prepared);let calls=0;
  const transport:typeof fetch=async()=>{calls++;if(failure==='throw')throw new Error('offline transport failure');if(failure==='stream'){let started=false;return new Response(new ReadableStream<Uint8Array>({pull(controller){if(started){controller.error(new Error('offline reader failure'));return;}started=true;controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({id:'partial',model:responseModel,choices:[{index:0,delta:{content:'部分回答'}}]})+'\n\n'));}}));}return new Response('{"error":"balance"}',{status:402});};
  const state=await runCompletion(options(f,transport));assert.equal(calls,1);assert.equal(state.totals.requests,1);assert.equal(state.totals.unknown,1);assert.equal(state.cumulativeTotals.requests,8);assert.equal(state.records[0].status,'failed');assert.ok(existsSync(join(f.output,'C04-C0','failure.json')));
  await assert.rejects(()=>runCompletion({...options(f,transport),directory:join(f.directory,'other-output')}),/already claimed/);assert.equal(calls,1);
 }finally{f.clean();}}
});

test('unknown usage, model drift, malformed streams, empty answers and illegal finishes stop later requests',async()=>{
 for(const spec of [{usage:false},{model:'unapproved-model'},{malformed:true},{empty:true},{finish:'unexpected'}] as Reply[]){const f=fixture();try{prepareCompletion(f.prepared);let calls=0;const state=await runCompletion(options(f,async()=>reply(++calls,spec)));assert.equal(calls,1);assert.equal(state.records[0].status,'failed');assert.ok(state.halted);assert.equal(state.records.filter(row=>row.status==='planned').length,4);assert.ok(readFileSync(join(f.output,'C04-C0','response.sse')).length>0);assert.equal(state.totals.unknown,spec.usage===false?1:0);}finally{f.clean();}}
});

test('new classifier preserves every legacy transport check without manufacturing thinking evidence',async()=>{
 for(const thinking of [false,true])for(const spec of [{},{tool:true},{finish:'length'}]){const output=await parsed({...spec,thinking});const group=thinking?'C1':'C0';assert.equal(classifyCompletion(output,group),classify(output,group));}
 const baseline=await parsed();assert.equal(classifyCompletion(baseline,'C1'),'answer');assert.throws(()=>classify(baseline,'C1'),/thinking_effect_unverified/);
 const invalid:Array<(output:typeof baseline)=>void>=[out=>{out.ids=[];},out=>{out.usage=undefined;},out=>{out.usage!.input=0;},out=>{out.usage!.output=maxTokens+1;},out=>{out.reasoningTokens=81;},out=>{out.done=false;out.finishReason='';},out=>{out.models=['other'];},out=>{out.tools=[{index:0,id:'call',name:'tool',arguments:'{bad'}];out.finishReason='tool_calls';},out=>{out.tools=[{index:0,id:'',name:'tool',arguments:'{}'}];out.finishReason='tool_calls';}];
 for(const mutate of invalid){const output=structuredClone(baseline);mutate(output);assert.throws(()=>classifyCompletion(output,'C1'));assert.throws(()=>classify(output,'C1'));}
});

test('tampered schedule, old result identity, source hashes and request bytes prevent any request',async()=>{
 for(const tamper of ['schedule','originalResults','source','body']){const f=fixture();try{
  const frozen=prepareCompletion(f.prepared);if(tamper==='schedule'){frozen.schedule[0]={...frozen.schedule[0],id:'C04-C1'};}else if(tamper==='originalResults'){frozen.originalResultsSha256='modified';}else if(tamper==='source'){frozen.sourceCode['reasoning-completion.ts']='modified';}else{const path=join(f.prepared,frozen.schedule[0].bodyPath);writeFileSync(path,readFileSync(path,'utf8')+'\n');}
  if(tamper!=='body')writeFileSync(join(f.prepared,'freeze.json'),JSON.stringify(frozen));let calls=0;
  await assert.rejects(()=>runCompletion(options(f,async()=>reply(++calls))));assert.equal(calls,0);assert.equal(existsSync(join(f.directory,'completion-claim.json')),false);
 }finally{f.clean();}}
});

test('request drift between slots stops without rewriting original evidence or retrying',async()=>{
 const f=fixture();try{const frozen=prepareCompletion(f.prepared);let calls=0;const originalBytes=readFileSync(join(frozen.originalPrepared,frozen.schedule[1].bodyPath));
  const state=await runCompletion(options(f,async()=>{calls++;const path=join(f.prepared,frozen.schedule[1].bodyPath),body=read<Payload>(path);body.messages.push({role:'user',content:'unapproved fixture mutation'});writeFileSync(path,JSON.stringify(body));return reply(calls);}));
  assert.equal(calls,1);assert.ok(state.halted);assert.equal(state.records[1].status,'planned');assert.deepEqual(readFileSync(join(frozen.originalPrepared,frozen.schedule[1].bodyPath)),originalBytes);
 }finally{f.clean();}
});

test('combined original plus new usage controls each next request and stops actual overruns',async()=>{
 const f=fixture();try{const frozen=prepareCompletion(f.prepared),slot=frozen.schedule[0];
  const state={totals:{requests:0,input:0,output:0,unknown:0},halted:undefined as string|undefined};assert.equal(canStartCompletion(state,slot),true);
  for(const totals of [{requests:5,input:0,output:0,unknown:0},{requests:0,input:limits.input-originalTotals.input-slot.inputReservation+1,output:0,unknown:0},{requests:0,input:0,output:limits.output-originalTotals.output-maxTokens+1,unknown:0},{requests:0,input:0,output:0,unknown:1}])assert.equal(canStartCompletion({...state,totals},slot),false);
  assert.equal(canStartCompletion({...state,halted:'stopped'},slot),false);
  let calls=0;const result=await runCompletion(options(f,async()=>reply(++calls,{input:limits.input-originalTotals.input+1})));assert.equal(calls,1);assert.equal(result.halted,'actual_usage_exceeded_budget');assert.equal(result.cumulativeTotals.input,limits.input+1);assert.equal(result.records[0].status,'answer');assert.equal(result.records[1].status,'planned');
 }finally{f.clean();}
});
