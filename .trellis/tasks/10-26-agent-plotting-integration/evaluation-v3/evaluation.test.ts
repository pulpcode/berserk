import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Ledger,limits,maxTokens,responseModel} from '../evaluation-v2/budget.js';
import {cases,schedule,initialLayers,criticalEffect,extraSingleFieldWrite,type Prepared} from '../evaluation-v2/cases.js';
import {actualPayload,collectResponse,validateResponse,Provider,endpoint,type Payload} from '../evaluation-v2/provider.js';
import {assessEnding,replyFor} from './interactions.js';
import {run,validateAuthorization} from './run.js';
import type {Runtime} from './runtime.js';
import type {PublicMessage} from '../../../../experiments/harness-lab/src/contracts/index.js';
import type {AnnotationReceipt} from '../../../../experiments/harness-lab/src/contracts/annotations.js';
const temporary=()=>mkdtemp(join(tmpdir(),'plotting-integration-eval-'));
const encoder=new TextEncoder();
/** Read persisted evidence, rather than comparing the in-memory row with itself. */
async function assertFinalAccounting(directory:string){
 const read=async(path:string)=>JSON.parse(await readFile(join(directory,path),'utf8'));
 const rows=await read('runs.json'),attempts=await read('attempts.json'),ledger=await read('ledger.json');
 const batch=await read('batch-state.json');assert.deepEqual(batch.rows,rows);
 for(const row of rows){
  if(row.status==='not_executed')continue;
  assert.deepEqual(await read(`${row.id}/result.json`),row);
  if(existsSync(join(directory,row.id,'review.json')))assert.deepEqual((await read(`${row.id}/review.json`)).entry,row);
  const requests=ledger.requests.filter((r:{trialId:string})=>r.trialId===row.id),sent=attempts.filter((r:{slot:string})=>r.slot===row.id);
  assert.equal(row.requests,requests.length);assert.equal(row.requests,sent.length);assert.deepEqual(row.accountingIssues,[]);
  assert.deepEqual(row.providerRequestIds,requests.map((r:{id:number})=>r.id));
  const known=requests as Array<{usage?:{input:number;output:number}}>;
  assert.deepEqual(row.usage,{input:known.reduce((n,r)=>n+(r.usage?.input??0),0),output:known.reduce((n,r)=>n+(r.usage?.output??0),0),unknown:known.filter(r=>!r.usage).length});
  for(const request of requests)assert.deepEqual(sent.find((a:{id:number})=>a.id===request.id).output.usage,request.usage);
 }
 assert.equal(rows.reduce((n:number,r:{requests:number})=>n+r.requests,0),batch.totals.requests);
}

function stream(content:string,tool?:{name:string;arguments:unknown},model=responseModel){const id='offline-response';return new Response(`data: ${JSON.stringify({id,model,choices:[{index:0,delta:tool?{role:'assistant',tool_calls:[{index:0,id:'call-'+Date.now(),type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.arguments)}}]}:{role:'assistant',content},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:1500,completion_tokens:100}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});}
function requestPayload():Payload{return {model:'deepseek-v4.1-flash',stream:true,messages:[{role:'user',content:'合成测试'}],max_tokens:12,temperature:.2,thinking:{type:'enabled'},reasoning_effort:'high'};}
test('freezes 15 named scenarios twice, preserving R13 prompts and method requirement',()=>{
 assert.equal(cases.length,15);assert.equal(schedule.length,30);assert.equal(new Set(schedule.map(s=>s.id)).size,30);
 for(const c of cases)assert.deepEqual(schedule.filter(s=>s.caseId===c.id).map(s=>s.round),[1,2]);
 assert.ok(cases.find(c=>c.id==='F05')!.prompts[0].endsWith('请同时说明你采用的判断方法和依据。'));
 const legacy=initialLayers('C04')[0].features[0];assert.equal(Object.hasOwn(legacy,'style'),false);assert.equal(Object.hasOwn(legacy,'informationRole'),false);
 assert.equal(initialLayers('C06')[0].features[0].attributes!.unknown,null);
});
test('budget counts actual requests, blocks unknown usage/reuse and reserves complete pairs',async()=>{
 const dir=await temporary(),ledger=new Ledger(join(dir,'ledger.json'),'freeze');assert.ok(ledger.canStartPair());
 for(let i=0;i<14;i++){const id=ledger.begin('case',5000);ledger.finish(id,{input:1000,output:100});}assert.equal(ledger.totals().requests,14);
 const pending=ledger.begin('case',5000);assert.throws(()=>ledger.begin('case',5000),/unknown/);ledger.finish(pending,undefined);assert.equal(ledger.canStartPair(),false);assert.throws(()=>new Ledger(join(dir,'ledger.json'),'freeze'),/reusing/);
 const capped=new Ledger(join(dir,'capped.json'),'freeze');const id=capped.begin('one',5000);capped.finish(id,{input:limits.input-999999,output:100});assert.equal(capped.canStartPair(),false);assert.throws(()=>capped.begin('two',1000000),/budget_exhausted/);
});
test('transport changes only fixed model parameters, rejects drift and truncation',async()=>{
 const native=requestPayload(),wire=actualPayload(native);assert.deepEqual(wire.messages,native.messages);assert.equal(wire.max_tokens,maxTokens);assert.equal(wire.top_p,1);assert.equal(wire.thinking!.type,'disabled');assert.equal(wire.temperature,undefined);assert.equal(wire.reasoning_effort,undefined);
 const {output,parser}=collectResponse();parser.push(encoder.encode(await stream('核对结束。').text()));validateResponse(output);
 assert.throws(()=>validateResponse({...output,models:['other']}),/response_model_drift/);assert.throws(()=>validateResponse({...output,finishReason:'length'}),/truncated/);assert.throws(()=>validateResponse({...output,reasoningCharacters:1}),/thinking/);
});
test('provider retains failed/unknown usage evidence and never retries after a transport failure',async()=>{
 const directory=await temporary(),ledger=new Ledger(join(directory,'ledger.json'),'fixed');let sends=0,cancels=0;
 const provider=new Provider({directory,secret:'offline-placeholder',original:async()=>{sends++;throw new Error('synthetic failure');},verify:async()=>{},beforeProvider:async()=>{},cancel:async()=>{cancels++;}},ledger);
 provider.active={id:'slot',directory,turn:1,runtime:{skills:{}} as Runtime,requests:0};
 await assert.rejects(provider.fetch(endpoint,{method:'POST',body:JSON.stringify(requestPayload())}),/synthetic failure/);await assert.rejects(provider.fetch(endpoint,{method:'POST',body:JSON.stringify(requestPayload())}),/halted/);
 assert.equal(sends,1);assert.equal(cancels,1);assert.equal(ledger.totals().unknown,1);assert.equal(provider.attempts.length,1);assert.equal(provider.attempts[0].completed,true);
});
test('clarification excludes optional invitations and never approves publishing or supplies new facts',()=>{
 assert.equal(assessEnding('已保存。如果需要进一步修改，请告诉我。').kind,'finished');assert.equal(assessEnding('该符号固定直立，无法旋转。').kind,'finished');
 assert.equal(assessEnding('请确认当前方向是否仍改为90°？如果需要进一步操作，请告诉我。').kind,'needs_reply');
 const p={caseId:'C02',prompts:['原始要求']} as Prepared;assert.equal(replyFor(p,'请选择具体车型',0),'水罐消防车');assert.equal(replyFor(p,'请批准发布',0),undefined);
 assert.equal(replyFor({...p,caseId:'C08'},'方向已变为180°，是否仍为90°？',0),'方向仍改90°，保留最新备注');
 assert.equal(replyFor({...p,caseId:'C08'},'方向已由45°变180°，是否覆盖为90°并保留最新备注？',0),'方向仍改90°，保留最新备注');
 assert.equal(replyFor({...p,caseId:'C08'},'是否覆盖整个对象并将方向改为90°？',0),undefined);
 assert.throws(()=>validateAuthorization(undefined,'fixed'),/approval/);
 assert.throws(()=>validateAuthorization({approvedByUser:true,providerAllowanceVerified:true,billingNote:'已核对',limits,freezeHash:'other'},'fixed'),/another frozen/);
});
test('prepares all 30 fresh HTTP fixtures without any model request', {timeout:240000},async()=>{
 const root=await temporary(),directory=join(root,'batch');const result=await run({directory,port:5279});
 await assertFinalAccounting(directory);
 assert.equal(result.stop,undefined);assert.equal(result.rows.length,30);assert.ok(result.rows.every(r=>r.status==='prepared'));assert.equal(result.totals.requests,0);
 const sessions=new Set<string>();for(const entry of schedule){const p=JSON.parse(await readFile(join(directory,entry.id,'fixture.json'),'utf8')) as Prepared;sessions.add(p.sessionId);assert.equal(p.before.binding.writable,true);assert.equal(p.before.version!.document.layers.length>0,true);}
 assert.equal(sessions.size,30);
 const c07=JSON.parse(await readFile(join(directory,'C07-1/fixture.json'),'utf8')) as Prepared;assert.notEqual(c07.before.binding.draft!.setId,c07.otherBefore!.binding.draft!.setId);assert.deepEqual(c07.annotationRefs?.[0],{...c07.before.version!.ref,objectIds:['target']});
 const c09=JSON.parse(await readFile(join(directory,'C09-1/fixture.json'),'utf8')) as Prepared;assert.equal(c09.before.version!.document.layers[0].features.length,3);assert.ok(c09.before.version!.document.layers[0].features.find(f=>f.objectId==='source-copy')?.sourceRefs?.length);
 await assert.rejects(run({directory}),/overwriting/);console.info(JSON.stringify({prepareEvidence:directory,slots:30,actualProviderRequests:0}));
});
test('controlled native HTTP/Pi runs preserve fields and handle a real service CAS conflict', {timeout:240000},async()=>{
 const root=await temporary(),directory=join(root,'batch'),original=globalThis.fetch;let providerCalls=0;
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.href!==endpoint)return original(input,init);providerCalls++;
  const p=JSON.parse(String(init?.body)) as Payload,messages=p.messages as Array<{role:string;name?:string;content:unknown}>;
  const tools=messages.filter(m=>m.role==='tool'),last=tools.at(-1),content=String(last?.content??'');
  if(content.includes('ANNOTATION_CONFLICT'))return stream('',{name:'annotation_read',arguments:{mode:'draft',objectIds:['target'],fields:['style','note','attributes','sourceRefs','geometry','informationRole']}});
  if(!tools.length)return stream('',{name:'annotation_read',arguments:{mode:'draft',objectIds:['target'],fields:['style','note','attributes','sourceRefs','geometry','informationRole']}});
  let data:{objects?:{items:Array<{style:Record<string,unknown>}>};action?:string};try{data=JSON.parse(content).data;}catch{return stream('无法核对工具结果。');}
  if(data?.objects)return stream('',{name:'annotation_action',arguments:{action:'apply',operations:[{op:'update_object',objectId:'target',changes:{style:{...data.objects.items[0].style,heading:90}}}]}});
  return stream('已将方向改为90°并保存草稿，其他内容保留。');
 };
 const entries=schedule.filter(e=>e.caseId==='C03'||e.caseId==='C08');await mkdir(root,{recursive:true});const result=await run({directory,mode:'live',port:5279,offline:{transport,entries}});
 await assertFinalAccounting(directory);
 assert.equal(result.stop,undefined);assert.ok(result.rows.every(r=>r.status==='recorded'),JSON.stringify(result.rows));assert.equal(result.rows.length,4);assert.ok(providerCalls>=12);
 for(const entry of entries){const review=JSON.parse(await readFile(join(directory,entry.id,'review.json'),'utf8'));const old=review.fixture.before.version.document.layers[0].features[0],now=review.after.version.document.layers[0].features[0];assert.equal(now.style.heading,90);assert.deepEqual(now.attributes,old.attributes);assert.deepEqual(now.sourceRefs,old.sourceRefs);assert.equal(now.style.iconSize,48);if(entry.caseId==='C03'){const reordered=structuredClone(review.after);const feature=reordered.version.document.layers[0].features[0];feature.style=Object.fromEntries(Object.entries(feature.style).reverse());feature.attributes=Object.fromEntries(Object.entries(feature.attributes).reverse());assert.equal(criticalEffect(review.fixture,review.final,reordered,0,false),undefined);feature.attributes.unknown=0;assert.equal(criticalEffect(review.fixture,review.final,reordered,0,false),'unrequested_existing_field_change');}if(entry.caseId==='C08'){assert.equal(review.conflictInjected,true);assert.equal(now.note,'外部已核实，请保留');assert.ok(review.final.messages.some((m:{text:string})=>m.text.includes('ANNOTATION_CONFLICT')));}}
 console.info(JSON.stringify({controlledEvidence:directory,slots:4,syntheticProviderCalls:providerCalls,realProviderRequests:0}));
});

test('scoring retains all 30 slots and requires actual attributed review and no critical effects',async()=>{
 const {summarize}=await import('../evaluation-v2/scoring.js'),outcomes=schedule.map(e=>({id:e.id,status:'recorded'})),reviews=schedule.map(e=>({id:e.id,reviewer:'agent-evidence-review',evidence:[`${e.id}/review.json`],completed:true,coreCorrect:true,processFacts:true,finalFacts:true,effectsCorrect:true,withinScope:true,criticalErrors:[] as string[]}));
 assert.equal(summarize(outcomes,[],true).recommendIntegration,false);assert.equal(summarize(outcomes,reviews,true).recommendIntegration,true);
 const missing=summarize(outcomes.slice(1),reviews,true);assert.deepEqual(missing.unresolved,['C01-1']);assert.equal(missing.planned,30);assert.equal(missing.recommendIntegration,false);
 reviews[0].criticalErrors=['unrequested_publish'];assert.equal(summarize(outcomes,reviews,true).recommendIntegration,false);assert.throws(()=>summarize(outcomes,[...reviews,reviews[0]],true),/Duplicate/);
});

test('HTTP provider error body is retained with secrets redacted and no new request is sent',async()=>{
 const directory=await temporary(),ledger=new Ledger(join(directory,'ledger.json'),'fixed');let sends=0;
 const provider=new Provider({directory,secret:'offline-placeholder',original:async()=>{sends++;return new Response('unavailable offline-placeholder',{status:503});},verify:async()=>{},beforeProvider:async()=>{},cancel:async()=>{}},ledger);provider.active={id:'slot',directory,turn:1,runtime:{skills:{}} as Runtime,requests:0};
 await assert.rejects(provider.fetch(endpoint,{method:'POST',body:JSON.stringify(requestPayload())}),/503/);await assert.rejects(provider.fetch(endpoint,{method:'POST',body:JSON.stringify(requestPayload())}),/halted/);
 assert.equal(sends,1);assert.equal(await readFile(join(directory,'provider-0001-http-error.txt'),'utf8'),'unavailable [REDACTED]');assert.equal(ledger.totals().unknown,1);
});

test('single-field write guard counts actual new revisions, not CAS failures, replay or receipt lookup',()=>{
 const setId='00000000-0000-4000-8000-000000000001',sessionId='session',base={caseId:'C03',sessionId,setId,beforeRevision:1,afterRevision:2,conflictInjected:false};
 const receipt=(revision:number,clientActionId='action-1'):AnnotationReceipt=>({clientActionId,sessionId,taskId:'task',action:'apply',committedAt:'2026-10-26T10:00:00Z',ref:{setId,revision},beforeRef:{setId,revision:revision-1},afterRef:{setId,revision},objectIds:['target']});
 const message=(r:AnnotationReceipt,origin:'write'|'replay'|'receipt_read'='write',isError=false):PublicMessage=>({id:origin+r.clientActionId,role:'tool',toolName:origin==='receipt_read'?'annotation_read':'annotation_action',text:'actual-receipt-fixture',isError,annotationResult:{schemaVersion:1,origin,receipt:{...r,...(origin==='replay'?{replayed:true}:{})}}});
 const original=message(receipt(2)),replay=message(receipt(2),'replay'),lookup=message(receipt(2),'receipt_read'),failed={...message(receipt(3,'failed')),isError:true};
 assert.equal(extraSingleFieldWrite({...base,messages:[original,replay,lookup,failed]}),undefined);
 assert.equal(extraSingleFieldWrite({...base,messages:[lookup]}),undefined);
 assert.equal(extraSingleFieldWrite({...base,afterRevision:3,messages:[original,message(receipt(3,'action-2'))]}),'duplicate_or_extra_single_field_write');
 assert.equal(extraSingleFieldWrite({...base,afterRevision:3,messages:[original]}),'duplicate_or_extra_single_field_write');
 assert.equal(extraSingleFieldWrite({...base,caseId:'C08',conflictInjected:true,afterRevision:3,messages:[failed,message(receipt(3,'after-conflict'))]}),undefined);
 assert.equal(extraSingleFieldWrite({...base,caseId:'C08',conflictInjected:true,afterRevision:4,messages:[message(receipt(3,'first')),message(receipt(4,'duplicate'))]}),'duplicate_or_extra_single_field_write');
 assert.equal(extraSingleFieldWrite({...base,caseId:'C01',afterRevision:4,messages:[message(receipt(2,'a')),message(receipt(3,'b')),message(receipt(4,'c'))]}),undefined);
 assert.equal(extraSingleFieldWrite({...base,caseId:'C10',afterRevision:3,messages:[original,message(receipt(3,'role-update'))]}),undefined);
});

test('native duplicate same-value write stops the batch with the next slot unexecuted', {timeout:120000},async()=>{
 const root=await temporary(),directory=join(root,'batch'),original=globalThis.fetch;let calls=0;
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.href!==endpoint)return original(input,init);calls++;
  const payload=JSON.parse(String(init?.body)) as Payload,toolResults=payload.messages.filter(m=>m.role==='tool').map(m=>{try{return JSON.parse(String(m.content)).data as {objects?:{items:Array<{style:Record<string,unknown>}>};action?:string};}catch{return undefined;}});
  const read=toolResults.find(r=>r?.objects),writes=toolResults.filter(r=>r?.action==='apply');
  if(!read)return stream('',{name:'annotation_read',arguments:{mode:'draft',objectIds:['target'],fields:['style']}});
  if(writes.length<2)return stream('',{name:'annotation_action',arguments:{action:'apply',operations:[{op:'update_object',objectId:'target',changes:{style:{...read.objects!.items[0].style,heading:90}}}]}});
  return stream('已保存方向。');
 };
 const result=await run({directory,mode:'live',port:5279,offline:{transport,entries:schedule.filter(e=>e.caseId==='C03')}});
 await assertFinalAccounting(directory);
 assert.equal(result.stop,'duplicate_or_extra_single_field_write');assert.equal(result.rows[0].status,'failed');assert.equal(result.rows[1].status,'not_executed');assert.equal(calls,4);assert.equal(result.rows[0].sentTurns,1);assert.equal(result.rows[0].successfulResponseTurns,1);assert.equal(result.rows[0].respondedUserTurns,1);assert.equal(result.rows[0].completedTurns,0);
 const turn=JSON.parse(await readFile(join(directory,'C03-1/turn-1-result.json'),'utf8')) as {snapshot:{messages:PublicMessage[]};after:Prepared['before']};
 const receipts=turn.snapshot.messages.filter(m=>!m.isError&&m.annotationResult?.origin==='write').map(m=>m.annotationResult!.receipt);
 assert.equal(receipts.length,2);assert.notEqual(receipts[0].clientActionId,receipts[1].clientActionId);assert.deepEqual(receipts.map(r=>r.afterRef?.revision),[2,3]);assert.equal(turn.after.version!.document.layers[0].features[0].style!.heading,90);
 console.info(JSON.stringify({duplicateWriteEvidence:directory,syntheticProviderCalls:calls,realProviderRequests:0}));
});

test('uncertain explanation has one actual sent response and no scripted echo', {timeout:120000},async()=>{
 const directory=join(await temporary(),'batch'),original=globalThis.fetch;let calls=0;
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.href!==endpoint)return original(input,init);calls++;
  return stream('判断是否已到场还需要来源信息，目前没有相应数据。');
 };
 const result=await run({directory,mode:'live',port:5279,offline:{transport,entries:schedule.filter(e=>e.caseId==='C09')}});
 await assertFinalAccounting(directory);assert.equal(result.stop,undefined);assert.equal(calls,2);
 for(const row of result.rows){assert.equal(row.status,'needs_review');assert.equal(row.sentTurns,1);assert.equal(row.successfulResponseTurns,1);assert.equal(row.respondedUserTurns,1);assert.equal(row.completedTurns,0);assert.equal(existsSync(join(directory,row.id,'turn-2-input.json')),false);}
 console.info(JSON.stringify({noEchoEvidence:directory,syntheticProviderCalls:calls,realProviderRequests:0}));
});
