import assert from 'node:assert/strict';
import {test} from 'node:test';
import {writeFileSync} from 'node:fs';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Ledger,limits,modelConfiguration,offlineAccount,afp,validateAccount} from './budget.js';
import {actualPayload,validateResponse,normalizedToolSchema,repeatedToolEvidence} from './provider.js';
import {collectResponse} from '../r12-20261025/reasoning-live.js';
import type {Payload} from '../r12-20261025/reasoning-prepare.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
test('explicit user approval removes artificial ceilings while incomplete usage and failures still halt',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'r16-offline-ledger-')),ledger=new Ledger(join(dir,'ledger.json'),'fixed',offlineAccount());
 for(let i=0;i<30;i++){const id=ledger.begin('same-task','G0',1);assert.equal(ledger.canStartQuartet(),false);assert.throws(()=>ledger.begin('pending','G0',1));ledger.finish(id,{input:1,output:1});}
 const seed=ledger.read();seed.requests=Array.from({length:3001},(_,i)=>({...seed.requests[i%30],id:i+1,usage:{input:30000,output:2000},afp:4}));writeFileSync(ledger.path,JSON.stringify(seed));assert.ok(ledger.canStartQuartet());assert.doesNotThrow(()=>ledger.assertRequest('G0',limits.input+1));
 assert.throws(()=>new Ledger(ledger.path,'fixed',offlineAccount()));
 const missing=new Ledger(join(dir,'missing.json'),'fixed',offlineAccount()),id=missing.begin('one','G0',10);missing.finish(id,undefined,'transport_failure');assert.equal(missing.totals().unknown,1);assert.throws(()=>missing.begin('retry','G0',1));
});
test('wire group configuration never edits native messages, tools, or private history',()=>{
 const native={model:'deepseek-v4.1-flash',stream:true,max_tokens:8192,temperature:0.2,messages:[{role:'assistant',content:'public',reasoning_content:'private',tool_calls:[{id:'x',function:{name:'read',arguments:'{}'}}]},{role:'tool',tool_call_id:'x',content:'receipt'}],tools:[{type:'function',function:{name:'read'}}]} as Payload;
 for(const group of ['G0','GS','GT','GST'] as const){const p=actualPayload({...native,model:modelConfiguration[group].requestModel},group);assert.deepEqual(p.messages,native.messages);assert.deepEqual(p.tools,native.tools);assert.equal(p.max_completion_tokens,32768);assert.equal('max_tokens'in p,false);assert.equal('top_p'in p,false);assert.equal('temperature'in p,false);assert.deepEqual(p.thinking,{type:'enabled'});assert.equal(p.reasoning_effort,'high');}
 assert.equal(native.max_tokens,8192);
});
test('response contract permits E1 zero thinking and valid JSON wrong tool schema, rejects protocol errors',async()=>{
 const c=collectResponse();c.parser.push(new TextEncoder().encode(await fakeResponse(modelConfiguration.GS.responseModel,{name:'spatial_analyze',arguments:{operation:'buffer',distanceM:'wrong'}}).text()));
 assert.equal(validateResponse(c.output,'GS'),'tools');assert.equal(validateResponse(c.output,'G0'),'tools');
 const positive={...c.output,reasoningCharacters:3,reasoningTokens:2};assert.equal(validateResponse(positive,'GS'),'tools');assert.equal(validateResponse(positive,'G0'),'tools');
 assert.throws(()=>validateResponse({...c.output,models:['other']},'GS'),/response_model_drift/);assert.throws(()=>validateResponse({...c.output,usage:undefined},'GS'),/unknown_or_empty_usage/);
 assert.throws(()=>validateResponse({...c.output,tools:[{...c.output.tools[0],arguments:'{bad'}]},'GS'));
 assert.equal(validateResponse({...c.output,finishReason:'length'},'GS'),'truncated');
});
test('non-parent model requests use same group configuration and shared ledger',async()=>{
 const {Provider,endpoint}=await import('./provider.js'),dir=await mkdtemp(join(tmpdir(),'r16-offline-child-')),ledger=new Ledger(join(dir,'ledger.json'),'fixed',offlineAccount());let calls=0;
 const provider=new Provider({directory:dir,secret:'unused-secret',verify:async()=>{},cancel:async()=>{},original:async(_input,init)=>{calls++;const wire=JSON.parse(String(init?.body));assert.deepEqual(wire.thinking,{type:'enabled'});assert.equal(wire.reasoning_effort,'high');assert.equal(wire.max_completion_tokens,32768);assert.equal('max_tokens'in wire,false);assert.equal('top_p'in wire,false);assert.equal(wire.temperature,undefined);return fakeResponse(modelConfiguration.GS.responseModel);}},ledger);
 provider.active={id:'D01-B',group:'GS',turn:0,directory:dir,requests:0,runtime:{skills:{}} as import('./runtime.js').Runtime};
 for(const tools of [[],[{type:'function',function:{name:'read'}}]])await (await provider.fetch(endpoint,{method:'POST',body:JSON.stringify({model:'deepseek-v4.1-flash',stream:true,messages:[{role:'user',content:'mock child/summary input'}],tools})})).text();
 assert.equal(calls,2);assert.deepEqual(ledger.totals(),{requests:2,input:200,output:20,afp:0.0275,unknown:0});
});

test('AFP counts thinking once as output, same Flash coefficient and account reserves are independent',async()=>{
 assert.equal(afp({input:1000,output:1000},'G0'),0.25);assert.equal(afp({input:1000,output:1000},'GT'),0.25);
 const dir=await mkdtemp(join(tmpdir(),'r16-offline-window-')),account={...offlineAccount(),remainingAfp:{fiveHour:320,week:35000,month:100000},externalUseReserveAfp:100,sharedUsePolicy:'reserved_other_usage' as const};
 const ledger=new Ledger(join(dir,'ledger.json'),'f',account);assert.equal(ledger.canStartQuartet(),true);
 const id=ledger.begin('a','GT',1000);ledger.finish(id,{input:200000,output:1000});assert.equal(ledger.canStartQuartet(),true);ledger.assertRequest('G0',1);
 assert.doesNotThrow(()=>ledger.assertRequest('GT',2000000));assert.doesNotThrow(()=>validateAccount({...account,observedOverageEnabled:null}));assert.doesNotThrow(()=>validateAccount({...account,observedOverageEnabled:true}));assert.throws(()=>validateAccount({...account,remainingAfp:{...account.remainingAfp,fiveHour:10001}}));
});

test('only exact loaded Skill catalogue descriptions are normalized; extra schema differences remain visible',()=>{
 const skills=(label:string)=>Object.fromEntries(['map-annotations','spatial-analysis'].map(id=>[id,{name:id,content:'',hash:'h',description:label+id}]));
 const tools=(label:string)=>[{type:'function',function:{name:'skill_read',parameters:{properties:{id:{anyOf:['map-annotations','spatial-analysis'].map(id=>({const:id,description:`${id}：${label}${id}`}))}}}}},{type:'function',function:{name:'spatial_analyze',description:'fixed',parameters:{type:'object'}}}];
 assert.deepEqual(normalizedToolSchema(tools('old'),skills('old')),normalizedToolSchema(tools('new'),skills('new')));
 assert.throws(()=>normalizedToolSchema(tools('wrong'),skills('old')),/skill_schema_metadata_drift/);
 const changed=tools('new');changed[1].function.description='unauthorized';assert.notDeepEqual(normalizedToolSchema(changed,skills('new')),normalizedToolSchema(tools('old'),skills('old')));
});

test('three identical tool results stop, changed arguments/evidence or a new user turn reset progress',()=>{
 const turn=(i:number,args='{}',value='same')=>[{role:'assistant',tool_calls:[{id:String(i),function:{name:'annotation_read',arguments:args}}]},{role:'tool',tool_call_id:String(i),content:value}];
 const history=[{role:'user',content:'read'},...turn(1),...turn(2),...turn(3)] as Payload['messages'];assert.equal(repeatedToolEvidence(history),true);assert.equal(repeatedToolEvidence([{role:'user',content:'read'},...turn(1,'{}','{"requestId":"r1","total":1}'),...turn(2,'{}','{"requestId":"r2","total":1}'),...turn(3,'{}','{"requestId":"r3","total":1}')] as Payload['messages']),true);assert.equal(repeatedToolEvidence(history.slice(0,-2)),false);assert.equal(repeatedToolEvidence([...history,{role:'user',content:'again'}]),false);assert.equal(repeatedToolEvidence([...history.slice(0,-2),...turn(3,'{"offset":2}') ] as Payload['messages']),false);assert.equal(repeatedToolEvidence([...history.slice(0,-2),...turn(3,'{}','new evidence')] as Payload['messages']),false);
});
