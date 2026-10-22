import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Interaction,SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {addUsage,canStartSlot,warnings,type Totals} from './live-budget.js';
import {LiveProvider} from './live-provider.js';
import {runLive,interactionDecision,isTargetDraftRead} from './live.js';
import {cases,schedule,type Prepared} from './cases.js';
import {fakeResponse} from './http-probe.js';
import {offlineEnvironment,loopbackOnly,type Runtime} from './runtime.js';
import type {Payload} from './audit.js';
const read=<T>(path:string):T=>JSON.parse(readFileSync(path,'utf8')) as T;

test('budget is checked before next slot; warnings do not stop; cached tokens not double-counted',()=>{
 const total:Totals={requests:0,input:0,output:0,unknownUsage:0};
 assert.ok(addUsage(total,{prompt_tokens:100,completion_tokens:10,prompt_cache_hit_tokens:80,prompt_cache_miss_tokens:20}));assert.equal(total.input,100);
 assert.ok(addUsage(total,{prompt_cache_hit_tokens:80,prompt_cache_miss_tokens:20,completion_tokens:10}));assert.equal(total.input,200);
 assert.ok(canStartSlot(total));assert.deepEqual(warnings(25,65,610000),['requests','tools','elapsedMs']);
 assert.equal(canStartSlot({...total,input:14_500_001}),false);assert.equal(canStartSlot({...total,requests:853}),false);assert.equal(canStartSlot({...total,output:180_001}),false);
 assert.equal(addUsage(total,{prompt_cache_hit_tokens:-5,prompt_cache_miss_tokens:20,completion_tokens:1}),false);assert.equal(total.unknownUsage,1);assert.equal(canStartSlot(total),false);
});

test('scripted question matching never invents another answer; fixed draft read differs from history',()=>{
 const q={schemaVersion:1,interactionId:'q',workspaceId:'w',sessionId:'s',requestId:'r',toolCallId:'t',toolName:'ask_user',createdAt:'now',status:'pending',kind:'question',questions:[{id:'target',prompt:'选择哪一个集合点？'}]} as Extract<Interaction,{kind:'question'}>;
 const spec=cases.find(c=>c.id==='D11')!;
 assert.deepEqual(interactionDecision(spec,q,false),{requestId:'r',kind:'question',action:'answer',answers:[{questionId:'target',text:spec.answer}]});
 assert.equal(interactionDecision(spec,q,true),undefined);
 assert.equal(interactionDecision(spec,{...q,kind:'question',questions:[{id:'x',prompt:'要发布吗？'}]},false),undefined);
 assert.equal(interactionDecision(cases.find(c=>c.id==='D04')!,q,false),'none');
 assert.ok(isTargetDraftRead(JSON.stringify({format:'annotation.model-result.v1',data:{status:'draft',ref:{setId:'a',revision:1}}}),'a'));
 assert.equal(isTargetDraftRead(JSON.stringify({format:'annotation.model-result.v1',data:{ref:{setId:'a',revision:1}}}),'a'),false);
});

test('provider captures usage beyond warning line and blocks paid retries after failure',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'r3-live-provider-'));await mkdir(join(dir,'slot'));
 let calls=0,cancelled='';
 const observer=new LiveProvider({directory:dir,original:async()=>{calls++;return calls===27?new Response('service unavailable',{status:503}):fakeResponse('deepseek-v4-pro');},secret:'test-secret',totals:{requests:0,input:0,output:0,unknownUsage:0},attempts:[],verify:async()=>{},beforeProvider:async()=>{},cancel:async reason=>{cancelled=reason;}});
 observer.active={id:'slot',directory:join(dir,'slot'),turn:0,requests:0,runtime:{skills:{}} as Runtime};
 const init={method:'POST',body:JSON.stringify({model:'deepseek-v4-pro',max_tokens:4096,thinking:{type:'disabled'},messages:[],tools:[]})};
 for(let i=0;i<26;i++)await (await observer.fetch('https://api.deepseek.com/chat/completions',init)).text();
 assert.equal(observer.options.totals.requests,26);assert.equal(observer.options.totals.input,2600);assert.equal(observer.fatal,undefined);
 await (await observer.fetch('https://api.deepseek.com/chat/completions',init)).text();
 await assert.rejects(()=>observer.fetch('https://api.deepseek.com/chat/completions',init),/automatic paid retry/);
 assert.equal(calls,27);assert.equal(cancelled,'provider_http_503');assert.equal(observer.options.totals.unknownUsage,1);
 assert.ok(observer.options.attempts.every(a=>a.completed));
});

test('real HTTP/Pi batch captures final evidence, scripted answer and resume without repeats',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r3-live-basic-')),directory=join(parent,'batch'),original=globalThis.fetch;
 const entries=[schedule.find(e=>e.caseId==='D01'&&e.group==='baseline'&&e.loading==='explicit')!,...['D11','D12','D13','D14','D04'].map(id=>schedule.find(e=>e.caseId===id&&e.group==='baseline'&&e.loading==='native')!)];let calls=0;const perSlot=new Map<string,number>();
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://api.deepseek.com')return loopbackOnly(original)(input,init);
  const payload=JSON.parse(String(init?.body)) as Payload;assert.equal(payload.model,'deepseek-v4-pro');assert.equal(payload.thinking?.type,'disabled');calls++;
  const row=read<Array<{id:string;caseId:string;status:string}>>(join(directory,'runs.json')).find(r=>r.status==='started')!;const count=(perSlot.get(row.id)??0)+1;perSlot.set(row.id,count);
  return fakeResponse(payload.model!,row.caseId!=='D01'&&count===1?{name:'ask_user',arguments:{questions:[{id:'target',prompt:'选择哪一个集合点？'}]}}:undefined);
 };
 const result=await runLive({directory,entries,env:offlineEnvironment(),transport,port:4540});
 assert.equal(result.stop,undefined);assert.equal(calls,8);assert.equal(result.total.requests,8);assert.equal(result.total.input,800);assert.ok(result.rows.every(r=>['recorded','interaction_recorded'].includes(r.status)));
 for(const id of ['D12','D13','D14','D04']){const entry=entries.find(e=>e.caseId===id)!;const evidence=read<{interactions:Array<{response?:{action?:string};pendingVerified?:boolean}>;final:SessionSnapshot}>(join(directory,entry.id,'review.json'));assert.ok(!evidence.final.interactions?.some(i=>i.kind==='question'&&i.answers?.length));if(id==='D12')assert.equal(evidence.interactions[0].response?.action,'skip');if(id==='D14'||id==='D04')assert.equal(evidence.interactions[0].pendingVerified,true);}
 const review=read<{interactions:Array<{response:{answers:Array<{text:string}>}}> }>(join(directory,entries[1].id,'review.json'));
 assert.equal(review.interactions[0].response.answers[0].text,cases.find(c=>c.id==='D11')!.answer);
 assert.ok(existsSync(join(directory,entries[0].id,'native-sessions')));assert.ok(existsSync(join(directory,entries[0].id,'evidence-hashes.json')));
 const resumed=await runLive({directory,entries,env:offlineEnvironment(),transport,port:4540,resume:true});assert.equal(calls,8);assert.equal(resumed.total.requests,8);
});

test('two-turn D16 injects after actual draft read; native recovery saves original preview',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r3-live-conflict-')),directory=join(parent,'batch'),original=globalThis.fetch;
 const entry=schedule.find(e=>e.caseId==='D16'&&e.group==='baseline'&&e.loading==='explicit')!;let calls=0,ref='',scriptError:unknown;
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://api.deepseek.com')return loopbackOnly(original)(input,init);
  const payload=JSON.parse(String(init?.body)) as Payload;calls++;
  try{
   const p=read<Prepared>(join(directory,entry.id,'fixture.json'));
   const manifest=read<Parameters<typeof mapTrialRequest>[0]>(join(directory,entry.id,'manifest.json'));
   const snapshot=await mapTrialRequest<SessionSnapshot>(manifest,`/api/sessions/${p.fixture.sessionId}`,'planning');
   if(calls===1)return fakeResponse(payload.model!,{name:'spatial_analyze',arguments:{operation:'buffer',input:{kind:'annotation',ref:p.fixture.before.version!.ref,objectIds:['origin']},distanceM:500}});
   if(calls===2){ref=snapshot.messages.find(m=>m.spatialResult)?.spatialResult?.resultRef??'';assert.ok(ref);return fakeResponse(payload.model!);}
   if(calls===3)return fakeResponse(payload.model!,{name:'annotation_read',arguments:{mode:'draft'}});
   if(calls===4){assert.ok(existsSync(join(directory,entry.id,'injected-conflict.json')));return fakeResponse(payload.model!,{name:'annotation_from_analysis',arguments:{resultRef:ref,layerId:'derived',objectId:'saved-range',name:'临时范围'}});}
   if(calls===5){assert.ok(snapshot.messages.findLast(m=>m.toolName==='annotation_from_analysis')?.isError);return fakeResponse(payload.model!,{name:'annotation_read',arguments:{mode:'draft'}});}
   if(calls===6)return fakeResponse(payload.model!,{name:'annotation_from_analysis',arguments:{resultRef:ref,layerId:'derived',objectId:'saved-range',name:'临时范围'}});
   return fakeResponse(payload.model!);
  }catch(error){scriptError=error;throw error;}
 };
 const result=await runLive({directory,entries:[entry],env:offlineEnvironment(),transport,port:4541});
 assert.equal(scriptError,undefined);assert.equal(result.stop,undefined);assert.equal(calls,7);assert.equal(result.rows[0].status,'recorded');
 const review=read<{conflictInjected:boolean;after:Prepared['fixture']['before'];final:SessionSnapshot}>(join(directory,entry.id,'review.json'));
 assert.equal(review.conflictInjected,true);const features=review.after.version!.document.layers.flatMap(l=>l.features);
 assert.equal(features.find(f=>f.objectId==='origin')?.note,'外部已核实，请保留');assert.equal(features.find(f=>f.objectId==='saved-range')?.name,'临时范围');
 assert.deepEqual(features.find(f=>f.objectId==='saved-range')?.geometry,review.final.messages.find(m=>m.spatialResult?.operation==='buffer')?.spatialResult?.geometry);
});


test('invalid provider model is retained as protocol failure before any paid transport',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'r3-live-invalid-'));let calls=0,cancelled='';
 const observer=new LiveProvider({directory:dir,original:async()=>{calls++;return fakeResponse('invalid');},secret:'secret',totals:{requests:0,input:0,output:0,unknownUsage:0},attempts:[],verify:async()=>{},beforeProvider:async()=>{},cancel:async reason=>{cancelled=reason;}});
 observer.active={id:'invalid',directory:dir,turn:0,requests:0,runtime:{skills:{}} as Runtime};
 await assert.rejects(()=>observer.fetch('https://api.deepseek.com/chat/completions',{body:JSON.stringify({model:'wrong',max_tokens:4096,thinking:{type:'disabled'}})}));
 assert.equal(calls,0);assert.equal(cancelled,'provider_input_protocol_failure');assert.equal(observer.fatal,'provider_input_protocol_failure');
});
