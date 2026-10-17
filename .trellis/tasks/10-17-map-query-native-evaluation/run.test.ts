import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Budget,Observer,SSELines,allowedTool,exclusiveDirectory,parseArgs,evaluationModel} from './run.js';
import {largeLayers,prompts,schedule} from './fixtures.js';
import {ask} from '../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import type {MapTrialManifest} from '../../../experiments/harness-lab/scripts/probe-situation-map.js';

test('model selection is bounded and Pro requests retain native payload and usage',async()=>{
  assert.equal(evaluationModel(''),'deepseek-flash');assert.equal(evaluationModel('deepseek-v4-pro'),'deepseek-v4-pro');assert.throws(()=>evaluationModel('typo'),/Unsupported/);
  const root=await mkdtemp(join(tmpdir(),'native-eval-pro-'));let sent:unknown;
  const raw='data: {"choices":[],"usage":{"prompt_tokens":13,"completion_tokens":2}}\n\ndata: [DONE]\n\n';
  const observer=new Observer(async(_input,init)=>{sent=init?.body;return new Response(raw);},root,'https://api.deepseek.com',evaluationModel('deepseek-v4-pro'));
  observer.mode='run';observer.active={id:'T01',directory:root,phase:'readonly',fixture:{},trial:{}} as NonNullable<Observer['active']>;observer.budget.begin();
  const body=JSON.stringify({model:'deepseek-v4-pro',max_tokens:2048,thinking:{type:'disabled'},messages:[{role:'user',content:'只读'}]});
  const response=await observer.fetch('https://api.deepseek.com/chat/completions',{method:'POST',body});assert.equal(sent,body);assert.equal(await response.text(),raw);assert.equal(observer.budget.input,13);
});

test('frozen schedule and large-page boundary',()=>{
  assert.equal(schedule.length,15);assert.deepEqual(schedule.slice(0,3).map(x=>x.kind),['F1','F2','F3']);
  const layers=largeLayers(),objects=layers.flatMap(l=>l.features);assert.equal(objects.length,64);assert.equal(layers[1].features.length,58);
  assert.deepEqual(layers[1].features.slice(50,52).map(x=>x.name),['松林补给点','湖湾补给点']);assert.ok(!objects.slice(0,50).some(x=>x.name==='松林补给点'));
  assert.ok(!Object.values(prompts).join('').includes('lyr-k72'));assert.ok(!Object.values(prompts).join('').includes('松林补给点'));
});
test('request budgets include all native attempts and reserve output',()=>{
  const budget=new Budget();budget.begin(100);for(let i=0;i<6;i++)budget.reserve(100);assert.throws(()=>budget.reserve(100),/trial_budget/);assert.equal(budget.total,6);
  budget.begin(200);budget.finish({prompt_tokens:50,completion_tokens:10,prompt_cache_hit_tokens:30});assert.equal(budget.input,50);
  budget.output=59_000;assert.throws(()=>budget.reserve(200),/batch_budget/);
});
test('unknown usage and cumulative clock fail closed',()=>{const budget=new Budget();budget.begin(0);assert.throws(()=>budget.reserve(360_000),/trial_budget/);budget.finish(undefined);assert.throws(()=>budget.reserve(1),/missing_provider_usage/);});
test('only authorized B note effects allowed, including redundant unchanged fields',()=>{
  const valid={action:'apply',operations:[{op:'update_object',objectId:'point-b',changes:{note:'B 保障讨论'}}]};
  assert.ok(allowedTool('annotation_action',valid,'prepare'));assert.ok(!allowedTool('annotation_action',valid,'readonly'));
  assert.ok(!allowedTool('annotation_action',{...valid,operations:[{...valid.operations[0],changes:{note:'B 保障讨论',name:'改名'}}]},'prepare'));
  const basis={feature:{objectId:'point-b',name:'集合点乙',note:'基线备注'},layerId:'discussion'};
  assert.ok(allowedTool('annotation_action',{...valid,operations:[{...valid.operations[0],layerId:'discussion',changes:{note:'B 保障讨论',name:'集合点乙'}}]},'prepare',basis));
  assert.ok(!allowedTool('annotation_action',{...valid,operations:[{...valid.operations[0],objectId:'point-a'}]},'prepare',basis));
  for(const name of ['write','edit','bash','annotation_from_source','instructions_update','instructions.update','work_item_action','file_output','information_record_task_assessment','unknown_tool'])assert.ok(!allowedTool(name,{},'readonly'));
  assert.ok(allowedTool('annotation_read',{},'readonly'));
});
test('SSE parser observes arbitrary chunks without requiring full text upfront',()=>{const events:unknown[]=[];const parser=new SSELines(e=>events.push(e));const bytes=new TextEncoder().encode('data: {"text":"松林"}\n\ndata: [DONE]\n');for(const b of bytes)parser.push(Uint8Array.of(b));assert.deepEqual(events,[{text:'松林'}]);});
test('exclusive evidence directories refuse reuse',async()=>{const root=await mkdtemp(join(tmpdir(),'native-eval-test-'));await exclusiveDirectory(join(root,'batch'));await assert.rejects(exclusiveDirectory(join(root,'batch')),/EEXIST/);});
test('prepare-only forbids provider before real network execution',async()=>{let calls=0;const root=await mkdtemp(join(tmpdir(),'native-eval-test-'));const observer=new Observer(async()=>{calls++;return new Response('');},root,'https://api.deepseek.com');await assert.rejects(observer.fetch('https://api.deepseek.com/chat/completions'),/forbidden/);assert.equal(calls,0);assert.equal(observer.budget.total,0);});
test('observer retains response bytes and settles usage before stream completes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'native-eval-test-'));const raw='data: {"choices":[],"usage":{"prompt_tokens":13,"completion_tokens":2}}\n\ndata: [DONE]\n\n';
  const observer=new Observer(async()=>new Response(raw),root,'https://api.deepseek.com');observer.mode='run';
  observer.active={id:'T01',directory:root,phase:'readonly',fixture:{},trial:{}} as NonNullable<Observer['active']>;observer.budget.begin();
  const body=JSON.stringify({model:'deepseek-flash',max_tokens:2048,thinking:{type:'disabled'},messages:[{role:'user',content:'请查'}]});
  const response=await observer.fetch('https://api.deepseek.com/chat/completions',{method:'POST',body});assert.equal(await response.text(),raw);
  assert.equal(observer.budget.input,13);assert.equal(observer.attempts[0].completed,true);assert.equal(await readFile(join(root,'provider-001-response.sse'),'utf8'),raw);
});
test('stream errors preserve attempted request evidence and stop further outbound requests',async()=>{
  const root=await mkdtemp(join(tmpdir(),'native-eval-failure-'));let calls=0;
  const observer=new Observer(async()=>{calls++;return new Response(new ReadableStream({pull(controller){controller.error(new Error('synthetic broken stream'));}}));},root,'https://api.deepseek.com');
  observer.mode='run';observer.active={id:'T01',directory:root,phase:'readonly',fixture:{},trial:{}} as NonNullable<Observer['active']>;observer.budget.begin();
  const init={method:'POST',body:JSON.stringify({model:'deepseek-flash',max_tokens:2048,thinking:{type:'disabled'}})};
  const response=await observer.fetch('https://api.deepseek.com/chat/completions',init);
  await assert.rejects(response.text(),/synthetic broken stream/);
  assert.equal(observer.attempts[0].completed,true);assert.equal(observer.budget.unknown,true);
  assert.match(await readFile(join(root,'provider-001-meta.json'),'utf8'),/synthetic broken stream/);
  await assert.rejects(observer.fetch('https://api.deepseek.com/chat/completions',init),/missing_provider_usage/);assert.equal(calls,1);
});
test('DONE settles before consumer cancellation without relying on network EOF',async()=>{
  const root=await mkdtemp(join(tmpdir(),'native-eval-done-'));
  const raw='data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":1}}\n\ndata: [DONE]\n\n';
  const observer=new Observer(async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(raw));}})),root,'https://api.deepseek.com');
  observer.mode='run';observer.active={id:'T01',directory:root,phase:'readonly',fixture:{},trial:{}} as NonNullable<Observer['active']>;observer.budget.begin();
  const response=await observer.fetch('https://api.deepseek.com/chat/completions',{method:'POST',body:JSON.stringify({model:'deepseek-flash',max_tokens:2048,thinking:{type:'disabled'}})});
  const reader=response.body!.getReader();await reader.read();assert.equal(observer.budget.input,9);await reader.cancel();assert.equal(observer.attempts[0].error,undefined);assert.equal(observer.budget.unknown,false);
});
test('unregistered tool names remain ordinary native errors rather than safety stops',async()=>{
  const root=await mkdtemp(join(tmpdir(),'native-eval-unknown-'));
  const chunk={choices:[{delta:{tool_calls:[{index:0,function:{name:'nonexistent_tool',arguments:'{}'}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:9,completion_tokens:1}};
  const observer=new Observer(async()=>new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`),root,'https://api.deepseek.com');
  observer.mode='run';observer.active={id:'T01',directory:root,phase:'readonly',fixture:{},trial:{}} as NonNullable<Observer['active']>;observer.budget.begin();
  const response=await observer.fetch('https://api.deepseek.com/chat/completions',{method:'POST',body:JSON.stringify({model:'deepseek-flash',max_tokens:2048,thinking:{type:'disabled'},tools:[{type:'function',function:{name:'annotation_read'}}]})});
  await response.text();assert.equal(observer.budget.fatal,undefined);assert.equal(observer.active.cancelled,undefined);assert.equal(observer.attempts[0].tools[0].name,'nonexistent_tool');
});
test('ask preserves default body bytes and forwards explicit fixed refs through existing API',async()=>{
  const root=await mkdtemp(join(tmpdir(),'native-eval-ask-'));await writeFile(join(root,'credentials.json'),JSON.stringify({sessions:{planning:{}}}));
  const m={url:'http://127.0.0.1:5555',dataDir:root,tasks:{supply:'task'}} as MapTrialManifest;
  const original=globalThis.fetch,bodies:string[]=[];
  globalThis.fetch=async(input,init)=>{const url=String(input);
    if(url.endsWith('/messages')){bodies.push(String(init?.body));return new Response('data: {"type":"request.finished","requestId":"r"}\n\n');}
    const payload=url.endsWith('/annotation')?{draft:null}:url.endsWith('/annotations')?{publications:{items:[]}}:url.endsWith('/current')?{sequence:0}:url.endsWith('/sessions/s')?{messages:[],lastResult:{requestId:'r',status:'succeeded'}}:{};
    return Response.json(payload);
  };
  try {await ask(m,root,'default','s','只读');const refs=[{setId:'a',revision:3,objectIds:['point-a']}];await ask(m,root,'refs','s','比较',refs);assert.equal(bodies[0],'{"text":"只读"}');assert.deepEqual(JSON.parse(bodies[1]),{text:'比较',annotationRefs:refs});}
  finally {globalThis.fetch=original;}
});
test('CLI never silently switches a typo to paid mode',()=>{assert.equal(parseArgs(['help']).mode,'help');assert.throws(()=>parseArgs(['start','x']));assert.throws(()=>parseArgs(['run','../x']));assert.equal(parseArgs(['prepare-only','batch']).mode,'prepare-only');});
