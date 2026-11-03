import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acceptanceCases,acceptanceCase,schedule} from './cases.js';
import {buildFixture} from './fixtures.js';
import {reviewedAction} from './continuation.js';
import {Ledger,profile,models} from './budget.js';
import {Provider,digest} from './provider.js';
import {situationObject} from '../../../experiments/harness-lab/src/context/validation.js';
import {feature} from '../../../experiments/harness-lab/src/annotations/validation.js';
import type {Interaction} from '../../../experiments/harness-lab/src/contracts/interactions.js';
const dir=()=>mkdtempSync(join(tmpdir(),'scope-runner-'));
test('28 unique slots, per group 12 diagnostics, order balanced and all fixture contracts decode',()=>{
 assert.equal(schedule.length,28);assert.equal(new Set(schedule.map(s=>s.id)).size,28);
 for(const group of ['A','B'])assert.equal(schedule.filter(s=>s.group===group&&s.phase==='formal').length,12);
 for(const c of acceptanceCases){const f=buildFixture(c.id,'task','2030-01-02T00:00:00Z');for(const o of f.objects)situationObject(o,o.ref.systemId);for(const l of f.annotationLayers)for(const a of l.features)feature(a);}
 assert.equal(buildFixture('P01','task','2030-01-02T00:00:00Z').annotationLayers.find(l=>l.layerId==='n08-target')!.features.length,2);
 assert.equal(acceptanceCase('D06').turns.length,2);assert.equal(acceptanceCase('D06').turns[1].annotationSelections,undefined);
});
const interaction={kind:'question',status:'pending',requestId:'r',interactionId:'i',questions:[{id:'region',prompt:'哪个北区？'},{id:'boundary',prompt:'边界线单列吗？'}]} as Interaction;
const observed={id:'i',kind:'controller' as const,text:JSON.stringify(interaction),sequence:1,path:'fixture',sha256:digest(JSON.stringify(interaction)),modelVisible:true};
test('multi-question reverse-order mapping answers exact frozen facts; missing/new questions reject',()=>{
 const scenario=acceptanceCase('D03'),decision={kind:'clarify' as const,reviewer:'test',rationale:'构造语义匹配',evidenceId:'i',matches:[{factId:'boundary',quote:'边界线单列吗？',questionId:'boundary'},{factId:scenario.humanFacts[0].id,quote:'哪个北区？',questionId:'region'}]};
 const answer=reviewedAction(scenario,decision,observed,interaction);assert.equal(answer.kind,'clarify');if(answer.kind!=='clarify')throw Error();assert.ok(answer.response);assert.equal(answer.text.split('\n').length,2);
 assert.throws(()=>reviewedAction(scenario,{...decision,matches:decision.matches.slice(0,1)},observed,interaction),/all_questions/);
 assert.throws(()=>reviewedAction(scenario,{...decision,matches:[{factId:'unfrozen',quote:'哪个北区？',questionId:'region'}]},observed,interaction),/no_frozen/);
 const text={...observed,kind:'assistant' as const};assert.equal(reviewedAction(scenario,{...decision,matches:[{factId:'boundary',quote:'边界线单列吗？'}]},text).kind,'clarify');
 assert.throws(()=>reviewedAction(scenario,{...decision,evidenceId:'other'},observed,interaction));
});
for(const group of ['A','B'] as const)test(`${group}: actual transport preserves business inputs, uses fixed model, meters once and rejects retry after fault`,async()=>{
 const path=dir(),ledger=new Ledger(join(path,'ledger.json'),'freeze');let calls=0;let wire:Record<string,unknown>={};
 const native={model:profile.model,thinking:{type:'enabled'},reasoning_effort:'high',max_tokens:32768,messages:[{role:'user',content:'测试'},{role:'assistant',reasoning_content:'retained',tool_calls:[{id:'c'}]}],tools:[{type:'function',function:{name:'annotation_read'}}]};
 const provider=new Provider({group,secret:'secret-test',verify:async()=>{},original:async(_input,init)=>{calls++;wire=JSON.parse(String(init?.body));return new Response('data: '+JSON.stringify({model:models[group].responseModel,choices:[{finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:20}})+'\n\ndata: [DONE]\n\n');}},ledger);provider.active={id:'case',directory:path,startedAt:Date.now()};
 await(await provider.fetch(profile.baseUrl+'/chat/completions',{method:'POST',body:JSON.stringify(native)})).text();assert.equal(calls,1);assert.deepEqual(wire.messages,native.messages);assert.deepEqual(wire.tools,native.tools);assert.equal(wire.model,models[group].model);assert.equal(ledger.totals().output,20);
 assert.equal(JSON.parse(readFileSync(join(path,'provider-0001-request-audit.json'),'utf8')).group,group);
 ledger.halt('transport_failure');await assert.rejects(()=>provider.fetch(profile.baseUrl+'/chat/completions',{method:'POST',body:JSON.stringify(native)}));assert.equal(calls,1);
});
test('separate group budget cannot borrow capacity; unknown usage is never zero/retryable',()=>{
 const path=dir(),ledger=new Ledger(join(path,'ledger.json'),'f');assert.throws(()=>ledger.begin('t',4_000_001,1),/budget/);const id=ledger.begin('t',100,100);ledger.finish(id,undefined);assert.equal(ledger.totals().unknown,1);assert.throws(()=>ledger.begin('t',1,1),/halted/);
});
test('per-slot usage never includes another task; failed skill calls do not count as received bodies',async()=>{
 const path=dir(),ledger=new Ledger(join(path,'ledger.json'),'f');
 ledger.finish(ledger.begin('one',100,100),{input:10,output:20});ledger.finish(ledger.begin('two',100,100),{input:15,output:25});
 assert.equal(ledger.totals('one').requests,1);assert.equal(ledger.totals('one').output,20);assert.equal(ledger.totals().output,45);
 const {skillReadEvidence}=await import('./run.js');
 const messages=[{id:'ok',role:'tool' as const,toolName:'skill.read',text:JSON.stringify({id:'spatial-analysis',content:'actual body',hash:'h'})},{id:'fail',role:'tool' as const,toolName:'skill.read',text:'failed',isError:true},{id:'missing',role:'tool' as const,toolName:'skill.read',text:'{}',resultMissing:true as const}];
 const evidence=skillReadEvidence({id:'s',workspaceId:'w',title:'t',updatedAt:'',messages,active:null,lastResult:null});assert.deepEqual(evidence.map(e=>e.bodyReceived),[true,false,false]);assert.equal(evidence[0].skillId,'spatial-analysis');
});
test('provider 429 with reported usage halts next transport and missing SSE usage remains unknown',async()=>{
 for(const mode of ['429','missing-usage']){
  const path=dir(),ledger=new Ledger(join(path,'ledger.json'),'f');let calls=0;
  const provider=new Provider({group:'A',secret:'offline-key',verify:async()=>{},original:async()=>{calls++;return mode==='429'?new Response(JSON.stringify({error:'limited',usage:{prompt_tokens:1,completion_tokens:0}}),{status:429}):new Response('data: '+JSON.stringify({model:models.A.responseModel,choices:[{finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');}},ledger);provider.active={id:'t',directory:path,startedAt:Date.now()};
  const body=JSON.stringify({model:profile.model,thinking:{type:'enabled'},reasoning_effort:'high',max_tokens:100});await(await provider.fetch(profile.baseUrl+'/chat/completions',{method:'POST',body})).text();
  assert.ok(ledger.read().halted);assert.equal(ledger.totals().unknown,mode==='429'?0:1);await assert.rejects(()=>provider.fetch(profile.baseUrl+'/chat/completions',{method:'POST',body}));assert.equal(calls,1);
 }
});
