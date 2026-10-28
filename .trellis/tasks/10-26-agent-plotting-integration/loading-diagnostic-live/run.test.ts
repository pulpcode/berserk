import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Ledger,limits} from './budget.js';
import {run,validateAuthorization,createClaim} from './run.js';
import {scope,sourceFreeze} from './runtime.js';
import {summarize,type Review} from './scoring.js';
import {cases,schedule} from '../loading-diagnostic/cases.js';
import {endpoint,type Payload} from '../evaluation-v2/provider.js';
import {diagnosticEffect} from './effects.js';
import {initialLayers,type Prepared} from '../evaluation-v2/cases.js';
import type {SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {responseModel} from '../evaluation-v2/budget.js';
const temporary=()=>mkdtemp(join(tmpdir(),'plotting-loading-live-'));
let sequence=0;
function stream(content:string,tool?:{name:string;arguments:unknown}){return new Response(`data: ${JSON.stringify({id:'offline-'+(++sequence),model:responseModel,choices:[{index:0,delta:tool?{role:'assistant',tool_calls:[{index:0,id:'call-'+sequence,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.arguments)}}]}:{role:'assistant',content},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:1500,completion_tokens:100}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});}

test('authorization binds exact 24-slot scope, freeze and lower limits',async()=>{
 const auth={approvedByUser:true as const,providerAllowanceVerified:true as const,billingNote:'offline assertion only',freezeHash:'f',limits,scope};
 assert.doesNotThrow(()=>validateAuthorization(auth,'f'));
 assert.throws(()=>validateAuthorization({...auth,providerAllowanceVerified:false},'f'),/waiver/);
 assert.doesNotThrow(()=>validateAuthorization({...auth,providerAllowanceVerified:false,providerAllowanceCheckWaivedByUser:true,billingNote:'User explicitly requested no allowance check'},'f'));
 assert.throws(()=>validateAuthorization({...auth,providerAllowanceVerified:false,providerAllowanceCheckWaivedByUser:true,billingNote:''},'f'),/waiver/);
 assert.throws(()=>validateAuthorization(undefined,'f'),/approval/);
 assert.throws(()=>validateAuthorization({...auth,freezeHash:'old'},'f'),/frozen/);
 assert.throws(()=>validateAuthorization({...auth,scope:{...scope,slots:23}},'f'),/Scope/);
 assert.throws(()=>validateAuthorization({...auth,limits:{...limits,requests:121} as unknown as typeof limits},'f'),/Budget/);
 const directory=join(await temporary(),'unauthorized');await assert.rejects(run({directory,mode:'live'}));assert.equal(existsSync(directory),false);
 const claims=join(await temporary(),'claims');await createClaim(claims,'freeze','first-output');await assert.rejects(createClaim(claims,'freeze','other-output'),/EEXIST/);
 const frozen=await sourceFreeze();assert.ok(frozen.protocolHash);assert.ok(frozen.base.helpers.frozenV2);assert.ok(frozen.base.driver['interactions.ts']);
});
test('lower ledger cap enforces reserves, actual overrun and unknown usage',async()=>{
 const root=await temporary(),ledger=new Ledger(join(root,'ledger.json'),'f');assert.ok(ledger.canStartPair());
 assert.throws(()=>ledger.begin('slot',limits.input+1),/budget/);
 let id=ledger.begin('slot',5000);ledger.finish(id,{input:limits.input-999999,output:100});assert.equal(ledger.canStartPair(),false);assert.throws(()=>ledger.begin('slot',1_000_000),/diagnostic_budget/);
 const actual=new Ledger(join(root,'actual.json'),'f');id=actual.begin('slot',5000);actual.finish(id,{input:limits.input+1,output:100});assert.equal(actual.read().halted,'actual_usage_exceeded_diagnostic_budget');assert.throws(()=>actual.begin('next',5000),/halted/);
 const unknown=new Ledger(join(root,'unknown.json'),'f');id=unknown.begin('slot',5000);unknown.finish(id,undefined);assert.equal(unknown.totals().unknown,1);assert.equal(unknown.canStartPair(),false);
 const requests=new Ledger(join(root,'requests.json'),'f');for(let i=0;i<120;i++){const request=requests.begin('slot',1);requests.finish(request,{input:1,output:1});}assert.throws(()=>requests.begin('slot',1),/diagnostic_budget/);assert.equal(requests.totals().requests,120);
 const output=new Ledger(join(root,'output.json'),'f');id=output.begin('slot',5000);output.finish(id,{input:100,output:limits.output-32767});assert.throws(()=>output.begin('slot',5000),/diagnostic_budget/);
});
test('all 24 slots stay in denominator; protocol status is separate from semantic review',()=>{
 const review:Review={id:schedule[0].id,reviewer:'offline-test',evidence:['synthetic-test'],completed:true,coreCorrect:true,processFacts:true,finalFacts:true,effectsCorrect:true,withinScope:true,criticalErrors:[]};
 const result=summarize([{id:review.id,status:'needs_review'}],[review]);assert.equal(result.planned,24);assert.equal(result.rows[0].strict,true);assert.equal(result.unresolved.length,24);assert.deepEqual(result.groups.map(g=>g.planned),[12,12]);assert.throws(()=>summarize([], [review,review]),/Duplicate/);assert.throws(()=>summarize([], [review]),/actually executed/);for(const status of ['not_executed','prepared','started'])assert.throws(()=>summarize([{id:review.id,status}],[review]),/actually executed/);
});
test('full live path runs 24 native HTTP/Pi slots with writes, preview and actual clarification', {timeout:300000},async()=>{
 const directory=join(await temporary(),'batch'),original=globalThis.fetch;let calls=0;
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.href!==endpoint)return original(input,init);calls++;
  const payload=JSON.parse(String(init?.body)) as Payload,users=payload.messages.filter(m=>m.role==='user').map(m=>JSON.stringify(m.content)),spec=cases.find(c=>users.some(m=>m.includes(c.prompt)));assert.ok(spec,'Original diagnostic prompt must reach provider');
  const results=payload.messages.filter(m=>m.role==='tool').map(m=>{const value=JSON.parse(String(m.content)) as {data?:Record<string,unknown>};return value.data;});
  if(spec.id==='T1'&&!users.some(m=>m.includes('水罐消防车')))return stream('请选择具体车型。');
  if(!results.length)return stream('',{name:'annotation_read',arguments:{mode:'draft',...(spec.id==='R1'?{objectIds:['origin'],fields:['geometry']}: {})}});
  assert.ok(results.every(Boolean),'All synthetic tool calls must have real successful results');
  if(['T1','T2','S1'].includes(spec.id)&&!results.some(r=>r?.action==='apply')){
   const symbols=spec.id==='S1'?['xf3013-2020.6.2.30','app.rescue-inflatable-boat','xf3013-2020.6.2.37']:['xf3013-2020.6.2.1'];
   return stream('',{name:'annotation_action',arguments:{action:'apply',operations:symbols.map((symbolId,i)=>({op:'add_object',layerId:'deployment',feature:{objectId:`new-${i}`,name:spec.id==='S1'?['救护车','冲锋舟','消防艇'][i]:'水罐消防车',kind:'point',geometry:{type:'Point',coordinates:[114+i*.001,22.5]},informationRole:'plan',style:{symbolId}}}))}});
  }
  if(spec.id==='R1'&&!results.some(r=>r?.operation==='buffer'))return stream('',{name:'spatial_analyze',arguments:{operation:'buffer',input:{kind:'annotation',ref:results[0]!.ref,objectIds:['origin']},distanceM:500}});
  return stream(spec.id==='R1'?'已预览基点500米范围，未保存。':spec.id==='R2'?'完整草稿共有2个对象：冲锋舟 1、基点。':spec.id==='S2'?'当前系统目录将救护车、消防艇标为标准符号，冲锋舟标为应用扩展。':'已按要求保存标绘对象为方案。');
 };
 const result=await run({directory,mode:'live',port:5285,offline:{transport}});assert.equal(result.stop,undefined,JSON.stringify(result));assert.equal(result.rows.length,24);assert.ok(result.rows.every(r=>r.status==='recorded'));assert.equal(result.totals.requests,calls);assert.equal(result.totals.unknown,0);assert.equal(calls,68);
 const read=async(path:string)=>JSON.parse(await readFile(join(directory,path),'utf8'));
 const hashes=new Set<string>(),pairs=new Map<string,unknown>();
 for(const row of result.rows){
  const input=await read(`${row.id}/turn-1-input.json`),review=await read(`${row.id}/review.json`),pair=await read(`${row.id}/pairing.json`),loading=await read(`${row.id}/loading-check-1.json`);
  assert.equal(input.text,cases.find(c=>c.id===row.caseId)!.prompt);assert.equal(Boolean(input.skill),row.group==='B');assert.equal(loading.bodyPresent,row.group==='B');hashes.add(loading.toolsHash);
  if(pairs.has(pair.pairKey))assert.deepEqual(pair.normalizedDocument,pairs.get(pair.pairKey));else pairs.set(pair.pairKey,pair.normalizedDocument);
  assert.equal(review.semanticReview,'pending');assert.deepEqual(review.entry,await read(`${row.id}/result.json`));assert.deepEqual(row.accountingIssues,[]);
  const features=review.after.version.document.layers.flatMap((l:{features:unknown[]})=>l.features);
  if(row.caseId==='T1'||row.caseId==='T2'){assert.equal(features.length,1);assert.equal(features[0].style.symbolId,'xf3013-2020.6.2.1');assert.equal(features[0].informationRole,'plan');}
  if(row.caseId==='S1')assert.equal(features.length,3);
  if(['R1','R2','S2'].includes(row.caseId))assert.deepEqual(review.after,review.fixture.before);
  if(row.caseId==='R1')assert.ok(review.final.messages.some((m:{spatialResult?:{operation:string}})=>m.spatialResult?.operation==='buffer'));
  if(row.caseId==='T1'){assert.equal(row.sentTurns,2);assert.equal(row.successfulResponseTurns,2);assert.equal(row.respondedUserTurns,1);const answer=await read(`${row.id}/turn-2-input.json`);assert.equal(answer.text,'水罐消防车');assert.equal(Boolean(answer.skill),row.group==='B');}
  else assert.equal(row.sentTurns,1);
 }
 assert.equal(pairs.size,12);assert.equal(hashes.size,1);assert.equal(summarize(result.rows,[]).unresolved.length,24);console.info(JSON.stringify({liveReadinessEvidence:directory,slots:24,syntheticProviderRequests:calls,realProviderRequests:0}));
});

test('diagnostic effect guard distinguishes allowed additions from readonly and source changes',()=>{
 const p={caseId:'C02',before:{publications:[],current:null,binding:{draft:{setId:'draft',headRevision:1}},version:{document:{layers:initialLayers('C02')}}},sourceBefore:{objects:[]}} as unknown as Prepared,snapshot={messages:[]} as unknown as SessionSnapshot;
 const after=structuredClone(p.before);after.binding.draft!.headRevision=2;after.version!.document.layers[0].features.push({objectId:'new',name:'水罐消防车',kind:'point',geometry:{type:'Point',coordinates:[114,22.5]},style:{symbolId:'xf3013-2020.6.2.1'},informationRole:'plan'});
 assert.equal(diagnosticEffect('T2',p,snapshot,after,p.sourceBefore),undefined);
 assert.equal(diagnosticEffect('S2',p,snapshot,after,p.sourceBefore),'readonly_state_changed');
 const noop=structuredClone(p.before);noop.binding.draft!.headRevision=2;for(const id of ['R1','R2','S2'])assert.equal(diagnosticEffect(id,p,snapshot,noop,p.sourceBefore),'readonly_state_changed');
 assert.equal(diagnosticEffect('T2',p,snapshot,p.before,{objects:[{changed:true}]}),'source_state_changed');
 const preview={...p,caseId:'C10'};assert.equal(diagnosticEffect('R1',preview,snapshot,after,p.sourceBefore),'unexpected_or_duplicate_object');
});
test('critical unexpected effect stops first slot and preserves the other 23', {timeout:120000},async()=>{
 const directory=join(await temporary(),'batch'),original=globalThis.fetch;let calls=0;
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.href!==endpoint)return original(input,init);calls++;
  if(calls===1)return stream('',{name:'annotation_read',arguments:{mode:'draft'}});
  if(calls===2)return stream('',{name:'annotation_action',arguments:{action:'apply',operations:[0,1].map(i=>({op:'add_object',layerId:'deployment',feature:{objectId:`unexpected-${i}`,name:'未要求的点',kind:'point',geometry:{type:'Point',coordinates:[114,22.5]}}}))}});
  return stream('已保存。');
 };
 const result=await run({directory,mode:'live',port:5285,offline:{transport}});assert.equal(result.stop,'unexpected_or_duplicate_object');assert.equal(result.rows[0].status,'failed');assert.equal(result.rows[0].successfulResponseTurns,1);assert.ok(result.rows.slice(1).every(r=>r.status==='not_executed'));assert.equal(calls,3);console.info(JSON.stringify({liveCriticalStopEvidence:directory,syntheticProviderRequests:calls,realProviderRequests:0}));
});
