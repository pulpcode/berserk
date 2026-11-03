import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Ledger} from './comparison-budget.js';
import {Provider,historical,oldFixture,stripOldThinking} from './comparison-provider.js';

for(const fault of ['http_429','missing_usage','model_drift'] as const){
 test(`provider retains ${fault} and refuses a second transport dispatch`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'qwen-provider-fault-'));
  const ledger=new Ledger(join(directory,'ledger.json'),'offline-fixed');
  let dispatches=0;
  const endpoint='https://offline.invalid/chat/completions';
  const provider=new Provider({directory,endpoint,secret:'offline-test-key',verify:async()=>{},cancel:async()=>{},original:async()=>{
   dispatches++;
   if(fault==='http_429')return new Response('quota exceeded',{status:429});
   const event={id:'offline-response',model:fault==='model_drift'?'unexpected-model':'deepseek-v4-1-flash-261017',choices:[{index:0,delta:{role:'assistant',content:'完成'},finish_reason:'stop'}],...(fault==='missing_usage'?{}:{usage:{prompt_tokens:2000,completion_tokens:100}})};
   return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
  }},ledger);
  provider.active={id:'offline-only',group:'A',directory,turn:1,runtime:{root:'unused',hashes:{},skills:{},start:async()=>{throw new Error('not used by transport test');}},fixture:oldFixture,mapping:{},requests:0,warmup:2,restored:true};
  const init={method:'POST',body:JSON.stringify({...historical,messages:stripOldThinking(historical.messages)})};
  const response=await provider.fetch(endpoint,init);
  if(fault==='http_429'){assert.equal(response.status,429);await response.text();}
  else await assert.rejects(response.text());
  assert.equal(dispatches,1);
  assert.ok(provider.fatal);
  assert.equal(provider.attempts.length,1);
  assert.equal(provider.attempts[0].completed,true);
  assert.equal(ledger.read().requests[0].status,'failed');
  assert.equal(ledger.totals().unknown,fault==='model_drift'?0:1);
  await assert.rejects(provider.fetch(endpoint,init),/halted_no_retry/);
  assert.equal(dispatches,1);
 });
}
