import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {Ledger,limits,profile} from './budget.js';
import {Provider} from './provider.js';

const requestBody=JSON.stringify({model:profile.model,thinking:{type:'enabled'},reasoning_effort:'high',max_tokens:32768,messages:[{role:'user',content:'核对本次清单。'}]});
const wire=(model='response-v1',usage:unknown={prompt_tokens:123,completion_tokens:45})=>'data: '+JSON.stringify({model,choices:[{delta:{content:'完成'},finish_reason:'stop'}],...(usage?{usage}:{})})+'\n\ndata: [DONE]\n\n';
async function setup(run:(directory:string,ledger:Ledger)=>Promise<void>){const directory=await mkdtemp(join(tmpdir(),'acceptance-provider-review-'));try{await run(directory,new Ledger(join(directory,'ledger.json'),'review-fixture'));}finally{await rm(directory,{recursive:true,force:true});}}
function provider(directory:string,ledger:Ledger,original:typeof fetch){const value=new Provider({original,secret:'private-fixture-secret',verify:async()=>{}},ledger);value.active={id:'P02-1',directory,startedAt:Date.now()};return value;}
const invoke=(value:Provider)=>value.fetch(profile.baseUrl+'/chat/completions',{method:'POST',body:requestBody,headers:{'x-test':'identity'},signal:new AbortController().signal});

test('observer forwards the original body, headers, signal and complete response bytes',async()=>setup(async(directory,ledger)=>{
 const payload=wire();let captured:RequestInit|undefined;
 const value=provider(directory,ledger,async(_input,init)=>{captured=init;return new Response(payload);});
 const init={method:'POST',body:requestBody,headers:{'x-test':'identity'},signal:new AbortController().signal};
 const response=await value.fetch(profile.baseUrl+'/chat/completions',init);
 assert.strictEqual(captured,init);assert.equal(await response.text(),payload);
 assert.equal(await readFile(join(directory,'provider-0001-request.json'),'utf8'),requestBody);
 assert.equal(ledger.totals().input,123);assert.equal(ledger.totals().output,45);
 assert.equal(ledger.read().attempts[0].reserve.input,Buffer.byteLength(requestBody)+4096);
 assert.equal(ledger.read().attempts[0].reserve.output,32768);
}));

test('unmetered HTTP or successful SSE blocks the next actual outbound attempt',async()=>{
 for(const response of [()=>new Response('{"error":"temporary"}',{status:503}),()=>new Response(wire('response-v1',null))])await setup(async(directory,ledger)=>{
  let calls=0;const value=provider(directory,ledger,async()=>{calls++;return response();});
  await (await invoke(value)).text();assert.ok(ledger.read().halted);assert.equal(ledger.totals().unknown,1);
  await assert.rejects(invoke(value),/ledger_halted/);assert.equal(calls,1);assert.equal(ledger.totals().requests,1);
 });
});

test('stream truncation and cancellation preserve failed attempts and prohibit further requests',async()=>{
 await setup(async(directory,ledger)=>{
  let calls=0;const value=provider(directory,ledger,async()=>{calls++;return new Response(wire().replace('data: [DONE]\n\n',''));});
  await (await invoke(value)).text();assert.equal(ledger.read().attempts[0].status,'failed');assert.equal(ledger.read().halted,'incomplete_or_unknown_usage');await assert.rejects(invoke(value),/ledger_halted/);assert.equal(calls,1);
 });
 await setup(async(directory,ledger)=>{
  const value=provider(directory,ledger,async()=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));}})));
  const response=await invoke(value);const reader=response.body!.getReader();await reader.read();await reader.cancel();
  assert.equal(ledger.read().attempts[0].status,'failed');assert.ok(ledger.read().halted);await assert.rejects(invoke(value),/ledger_halted/);
 });
});

test('a metered transient error can be retried, while auth/quota failure cannot',async()=>{
 for(const status of [503,401,429])await setup(async(directory,ledger)=>{
  let calls=0;const value=provider(directory,ledger,async()=>++calls===1?new Response(JSON.stringify({error:'failed',usage:{prompt_tokens:5,completion_tokens:0}}),{status}):new Response(wire()));
  await (await invoke(value)).text();assert.equal(ledger.read().attempts[0].status,'failed');assert.equal(ledger.totals().input,5);
  if(status===503){await (await invoke(value)).text();assert.equal(calls,2);assert.equal(ledger.totals().input,128);}
  else{await assert.rejects(invoke(value),/ledger_halted/);assert.equal(calls,1);}
 });
});

test('response model drift remains a batch stop after recreating the provider',async()=>setup(async(directory,ledger)=>{
 await (await invoke(provider(directory,ledger,async()=>new Response(wire('v1'))))).text();
 const second=provider(directory,new Ledger(ledger.path,'review-fixture',true),async()=>new Response(wire('v2')));
 await (await invoke(second)).text();assert.equal(ledger.read().halted,'response_model_drift');await assert.rejects(invoke(second),/ledger_halted/);
}));

test('reservation gates cover request cap, input and output without adding an attempt',async()=>setup(async(directory)=>{
 const full=new Ledger(join(directory,'request-limit.json'),'cap');
 for(let i=0;i<limits.requests;i++)full.finish(full.begin('metered',1,1),{input:1,output:1});
 assert.throws(()=>full.begin('next',1,1),/budget_exhausted/);assert.equal(full.totals().requests,240);
 const input=new Ledger(join(directory,'input-limit.json'),'cap');input.finish(input.begin('metered',limits.input,1),{input:limits.input,output:1});assert.throws(()=>input.begin('next',1,1),/budget_exhausted/);assert.equal(input.totals().requests,1);
 const output=new Ledger(join(directory,'output-limit.json'),'cap');let remaining=limits.output;
 while(remaining){const amount=Math.min(remaining,profile.maxOutputTokens);output.finish(output.begin('metered',1,amount),{input:1,output:amount});remaining-=amount;}
 const attempts=output.totals().requests;assert.throws(()=>output.begin('next',1,1),/budget_exhausted/);assert.equal(output.totals().requests,attempts);
}));
