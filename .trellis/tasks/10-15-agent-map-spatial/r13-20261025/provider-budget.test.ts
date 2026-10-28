import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Ledger,limits,maxTokens,responseModel} from './budget.js';
import {actualPayload,validateResponse} from './provider.js';
import {collectResponse} from '../r12-20261025/reasoning-live.js';
import type {Payload} from '../r12-20261025/reasoning-prepare.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
test('pair admission is conservative; current pair may continue beyond reserve, no per-task cutoff',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'r13-offline-ledger-')),ledger=new Ledger(join(dir,'ledger.json'),'fixed');
 assert.ok(ledger.canStartPair());
 for(let i=0;i<72;i++){const id=ledger.begin('same-task',1);assert.equal(ledger.canStartPair(),false);assert.throws(()=>ledger.begin('pending',1));ledger.finish(id,{input:1,output:1});}
 assert.equal(ledger.canStartPair(),false);ledger.assertRequest(1);
 for(let i=72;i<96;i++){const id=ledger.begin('same-task',1);ledger.finish(id,{input:1,output:1});}
 assert.throws(()=>ledger.begin('extra',1),/budget_exhausted/);assert.throws(()=>new Ledger(ledger.path,'fixed'));
 const missing=new Ledger(join(dir,'missing.json'),'fixed'),id=missing.begin('one',10);missing.finish(id,undefined,'transport_failure');assert.equal(missing.totals().unknown,1);assert.throws(()=>missing.begin('retry',1));
 const output=new Ledger(join(dir,'output.json'),'fixed'),o=output.begin('one',10);output.finish(o,{input:1,output:limits.output-maxTokens});output.assertRequest(1);const o2=output.begin('two',1);output.finish(o2,{input:1,output:1});assert.throws(()=>output.assertRequest(1));
});
test('wire group configuration never edits native messages, tools, or private history',()=>{
 const native={model:'deepseek-v4.1-flash',stream:true,max_tokens:8192,temperature:0.2,messages:[{role:'assistant',content:'public',reasoning_content:'private',tool_calls:[{id:'x',function:{name:'read',arguments:'{}'}}]},{role:'tool',tool_call_id:'x',content:'receipt'}],tools:[{type:'function',function:{name:'read'}}]} as Payload;
 for(const group of ['E0','E1'] as const){const p=actualPayload(native,group);assert.deepEqual(p.messages,native.messages);assert.deepEqual(p.tools,native.tools);assert.equal(p.max_tokens,32768);assert.equal(p.top_p,1);assert.equal('temperature'in p,false);assert.deepEqual(p.thinking,{type:group==='E0'?'disabled':'enabled'});assert.equal(p.reasoning_effort,group==='E0'?undefined:'high');}
 assert.equal(native.max_tokens,8192);
});
test('response contract permits E1 zero thinking and valid JSON wrong tool schema, rejects protocol errors',async()=>{
 const c=collectResponse();c.parser.push(new TextEncoder().encode(await fakeResponse(responseModel,{name:'spatial_analyze',arguments:{operation:'buffer',distanceM:'wrong'}}).text()));
 assert.equal(validateResponse(c.output,'E1'),'tools');assert.equal(validateResponse(c.output,'E0'),'tools');
 const positive={...c.output,reasoningCharacters:3,reasoningTokens:2};assert.equal(validateResponse(positive,'E1'),'tools');assert.throws(()=>validateResponse(positive,'E0'),/disabled_thinking/);
 assert.throws(()=>validateResponse({...c.output,models:['other']},'E1'),/response_model_drift/);assert.throws(()=>validateResponse({...c.output,usage:undefined},'E1'),/unknown_or_empty_usage/);
 assert.throws(()=>validateResponse({...c.output,tools:[{...c.output.tools[0],arguments:'{bad'}]},'E1'));
 assert.equal(validateResponse({...c.output,finishReason:'length'},'E1'),'truncated');
});
test('non-parent model requests use same group configuration and shared ledger',async()=>{
 const {Provider,endpoint}=await import('./provider.js'),dir=await mkdtemp(join(tmpdir(),'r13-offline-child-')),ledger=new Ledger(join(dir,'ledger.json'),'fixed');let calls=0;
 const provider=new Provider({directory:dir,secret:'unused-secret',verify:async()=>{},cancel:async()=>{},original:async(_input,init)=>{calls++;const wire=JSON.parse(String(init?.body));assert.deepEqual(wire.thinking,{type:'enabled'});assert.equal(wire.reasoning_effort,'high');assert.equal(wire.max_tokens,32768);assert.equal(wire.top_p,1);assert.equal(wire.temperature,undefined);return fakeResponse(responseModel);}},ledger);
 provider.active={id:'F01-E1',group:'E1',turn:0,directory:dir,requests:0,runtime:{skills:{}} as import('./runtime.js').Runtime};
 for(const tools of [[],[{type:'function',function:{name:'read'}}]])await (await provider.fetch(endpoint,{method:'POST',body:JSON.stringify({model:'deepseek-v4.1-flash',stream:true,messages:[{role:'user',content:'mock child/summary input'}],tools})})).text();
 assert.equal(calls,2);assert.deepEqual(ledger.totals(),{requests:2,input:200,output:20,unknown:0});
});
