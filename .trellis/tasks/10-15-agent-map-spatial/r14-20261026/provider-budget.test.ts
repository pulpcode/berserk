import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Ledger,limits,maxTokens,modelConfiguration,offlineAccount,afp,validateAccount} from './budget.js';
import {actualPayload,validateResponse} from './provider.js';
import {collectResponse} from '../r12-20261025/reasoning-live.js';
import type {Payload} from '../r12-20261025/reasoning-prepare.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
test('triple admission is conservative; current triple may continue beyond reserve, no per-task cutoff',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'r14-offline-ledger-')),ledger=new Ledger(join(dir,'ledger.json'),'fixed',offlineAccount());
 assert.ok(ledger.canStartTriple());
 for(let i=0;i<1540;i++){const id=ledger.begin('same-task','A',1);assert.equal(ledger.canStartTriple(),false);assert.throws(()=>ledger.begin('pending','A',1));ledger.finish(id,{input:1,output:1});}
 assert.equal(ledger.canStartTriple(),true);ledger.assertRequest('A',1);
 for(let i=1540;i<1600;i++){const id=ledger.begin('same-task','A',1);ledger.finish(id,{input:1,output:1});}
 assert.throws(()=>ledger.begin('extra','A',1),/budget_exhausted/);assert.throws(()=>new Ledger(ledger.path,'fixed',offlineAccount()));
 const missing=new Ledger(join(dir,'missing.json'),'fixed',offlineAccount()),id=missing.begin('one','A',10);missing.finish(id,undefined,'transport_failure');assert.equal(missing.totals().unknown,1);assert.throws(()=>missing.begin('retry','A',1));
 const output=new Ledger(join(dir,'output.json'),'fixed',offlineAccount()),o=output.begin('one','A',10);output.finish(o,{input:1,output:limits.output-maxTokens});output.assertRequest('A',1);const o2=output.begin('two','A',1);output.finish(o2,{input:1,output:1});assert.throws(()=>output.assertRequest('A',1));
});
test('wire group configuration never edits native messages, tools, or private history',()=>{
 const native={model:'deepseek-v4.1-flash',stream:true,max_tokens:8192,temperature:0.2,messages:[{role:'assistant',content:'public',reasoning_content:'private',tool_calls:[{id:'x',function:{name:'read',arguments:'{}'}}]},{role:'tool',tool_call_id:'x',content:'receipt'}],tools:[{type:'function',function:{name:'read'}}]} as Payload;
 for(const group of ['A','B','C'] as const){const p=actualPayload({...native,model:modelConfiguration[group].requestModel},group);assert.deepEqual(p.messages,native.messages);assert.deepEqual(p.tools,native.tools);assert.equal(p.max_completion_tokens,32768);assert.equal('max_tokens'in p,false);assert.equal('top_p'in p,false);assert.equal('temperature'in p,false);assert.deepEqual(p.thinking,{type:group==='A'?'disabled':'enabled'});assert.equal(p.reasoning_effort,group==='A'?undefined:'high');}
 assert.equal(native.max_tokens,8192);
});
test('response contract permits E1 zero thinking and valid JSON wrong tool schema, rejects protocol errors',async()=>{
 const c=collectResponse();c.parser.push(new TextEncoder().encode(await fakeResponse(modelConfiguration.B.responseModel,{name:'spatial_analyze',arguments:{operation:'buffer',distanceM:'wrong'}}).text()));
 assert.equal(validateResponse(c.output,'B'),'tools');assert.equal(validateResponse(c.output,'A'),'tools');
 const positive={...c.output,reasoningCharacters:3,reasoningTokens:2};assert.equal(validateResponse(positive,'B'),'tools');assert.throws(()=>validateResponse(positive,'A'),/disabled_thinking/);
 assert.throws(()=>validateResponse({...c.output,models:['other']},'B'),/response_model_drift/);assert.throws(()=>validateResponse({...c.output,usage:undefined},'B'),/unknown_or_empty_usage/);
 assert.throws(()=>validateResponse({...c.output,tools:[{...c.output.tools[0],arguments:'{bad'}]},'B'));
 assert.equal(validateResponse({...c.output,finishReason:'length'},'B'),'truncated');
});
test('non-parent model requests use same group configuration and shared ledger',async()=>{
 const {Provider,endpoint}=await import('./provider.js'),dir=await mkdtemp(join(tmpdir(),'r14-offline-child-')),ledger=new Ledger(join(dir,'ledger.json'),'fixed',offlineAccount());let calls=0;
 const provider=new Provider({directory:dir,secret:'unused-secret',verify:async()=>{},cancel:async()=>{},original:async(_input,init)=>{calls++;const wire=JSON.parse(String(init?.body));assert.deepEqual(wire.thinking,{type:'enabled'});assert.equal(wire.reasoning_effort,'high');assert.equal(wire.max_completion_tokens,32768);assert.equal('max_tokens'in wire,false);assert.equal('top_p'in wire,false);assert.equal(wire.temperature,undefined);return fakeResponse(modelConfiguration.B.responseModel);}},ledger);
 provider.active={id:'D01-B',group:'B',turn:0,directory:dir,requests:0,runtime:{skills:{}} as import('./runtime.js').Runtime};
 for(const tools of [[],[{type:'function',function:{name:'read'}}]])await (await provider.fetch(endpoint,{method:'POST',body:JSON.stringify({model:'deepseek-v4.1-flash',stream:true,messages:[{role:'user',content:'mock child/summary input'}],tools})})).text();
 assert.equal(calls,2);assert.deepEqual(ledger.totals(),{requests:2,input:200,output:20,afp:0.0275,unknown:0});
});

test('AFP counts thinking once as output, Pro coefficient and account reserves are independent',async()=>{
 assert.equal(afp({input:1000,output:1000},'A'),0.25);assert.equal(afp({input:1000,output:1000},'C'),1.1);
 const dir=await mkdtemp(join(tmpdir(),'r14-offline-window-')),account={...offlineAccount(),remainingAfp:{fiveHour:1200,week:35000,month:100000},externalUseReserveAfp:100,sharedUsePolicy:'reserved_other_usage' as const};
 const ledger=new Ledger(join(dir,'ledger.json'),'f',account);assert.equal(ledger.canStartTriple(),true);
 const id=ledger.begin('a','C',1000);ledger.finish(id,{input:200000,output:1000});assert.equal(ledger.canStartTriple(),false);ledger.assertRequest('A',1);
 assert.throws(()=>ledger.assertRequest('C',2000000),/account_window/);assert.doesNotThrow(()=>validateAccount({...account,observedOverageEnabled:null}));assert.doesNotThrow(()=>validateAccount({...account,observedOverageEnabled:true}));assert.throws(()=>validateAccount({...account,remainingAfp:{...account.remainingAfp,fiveHour:10001}}));
});
