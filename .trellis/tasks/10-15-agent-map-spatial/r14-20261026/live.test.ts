import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readdir} from 'node:fs/promises';
import {readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runLive,liveClaim,availableBufferResults,assertExecutionGate,frozenSyntheticDay,generatedBuffersInUserTurn} from './live.js';
import {schedule,type Prepared} from './cases.js';
import {loopbackOnly} from './runtime.js';
import {modelConfiguration,type Group} from './budget.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
import type {Payload} from '../r12-20261025/reasoning-prepare.js';
import {mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import type {SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
const read=<T>(p:string)=>JSON.parse(readFileSync(p,'utf8')) as T;
async function response(group:Group,call?:{name:string;arguments:unknown},text?:string){const r=fakeResponse(modelConfiguration[group].responseModel,call,text),raw=await r.text();return new Response(raw.replace('"delta":{','"delta":{'+(group!=='A'?'"reasoning_content":"PRIVATE_REASONING_TRACE",':'')),{headers:r.headers});}
test('live missing freeze refuses before secret access, mock claim cannot consume live entry',async()=>{
 let reads=0;const env=new Proxy({},{get(){reads++;throw new Error('secret read');}}) as NodeJS.ProcessEnv;
 await assert.rejects(runLive({directory:'/tmp/r14-no-entry',env}),/requires frozen source/);assert.equal(reads,0);assert.equal(existsSync('/tmp/r14-no-entry'),false);
});
test('fifteen real native SDK trials execute tools, replay private reasoning, correct parameters, and finish dependent turns',{timeout:600000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r14-offline-complete-')),directory=join(parent,'batch'),claimPath=join(parent,'claim.json'),original=globalThis.fetch,hadLiveClaim=existsSync(liveClaim);let calls=0,scriptError:unknown,sameTurnReplay=0,newTurnReplay=0;const counts=new Map<string,number>();
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);calls++;
  const payload=JSON.parse(String(init?.body)) as Payload,row=read<Array<{id:string;caseId:string;group:Group;status:string}>>(join(directory,'runs.json')).find(r=>r.status==='started')!,dir=join(directory,row.id),p=read<Prepared>(join(dir,'fixture.json')),m=read<Parameters<typeof mapTrialRequest>[0]>(join(dir,'manifest.json')),turn=read<Array<{turn:number}>>(join(directory,'attempts.json')).at(-1)!.turn;
  const n=(counts.get(row.id+':'+turn)??0)+1;counts.set(row.id+':'+turn,n);
  try{
   assert.equal(payload.max_completion_tokens,32768);assert.equal('max_tokens'in payload,false);assert.equal('top_p'in payload,false);assert.equal(payload.model,modelConfiguration[row.group].requestModel);assert.equal('temperature'in payload,false);assert.deepEqual(payload.thinking,{type:row.group==='A'?'disabled':'enabled'});assert.equal(payload.reasoning_effort,row.group==='A'?undefined:'high');
   const currentUser=payload.messages.findLastIndex(x=>x.role==='user');
   for(const [i,msg] of payload.messages.entries())if(msg.role==='assistant'&&msg.reasoning_content){assert.notEqual(row.group,'A');assert.equal(msg.reasoning_content,'PRIVATE_REASONING_TRACE');assert.ok(!String(msg.content).includes('PRIVATE_REASONING_TRACE'));if(i>currentUser)sameTurnReplay++;else newTurnReplay++;}
   if(turn===0&&n===1){for(const id of ['map-annotations','spatial-analysis'])assert.ok(!payload.messages.map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n').includes(readFileSync(join(directory,'runtime-builds/runtimes',row.group,'fixtures/skills',id,'SKILL.md'),'utf8')));assert.ok(existsSync(join(directory,row.caseId+'-r1-triple.json')));}
   const call=(name:string,args:unknown)=>response(row.group,{name,arguments:args});
   const snapshot=await mapTrialRequest<SessionSnapshot>(m,`/api/sessions/${p.fixture.sessionId}`,'planning'),buffers=snapshot.messages.flatMap(x=>x.spatialResult?.operation==='buffer'?[x.spatialResult]:[]),ref=p.fixture.before.version!.ref;
   const ann=(objectIds:string[])=>({kind:'annotation',ref,objectIds}),candidates={kind:'annotation',ref,layerIds:['resources']},index=n-(turn===0?2:0);
   if(turn===0&&n<=2)return call('skill_read',{id:n===1?'map-annotations':'spatial-analysis'});
   if(row.caseId==='D01'&&index===1)return call('situation_query',{systemId:'situation',mode:'current',objectRefs:[m.objects.resource]});
   if(row.caseId==='D09'&&index===1){if(turn<2)return call('spatial_analyze',{operation:'buffer',input:ann(['origin']),distanceM:turn===0?500:1500});return call('spatial_analyze',{operation:'filter',input:candidates,spatial:{relation:'contains',target:{kind:'result',resultRef:buffers[0].resultRef,geometry:true}}});}
   if(row.caseId==='D13'&&index===1)return call('spatial_analyze',{operation:'nearest',input:candidates,target:ann(['origin']),count:'invalid-number'});
   if(row.caseId==='D13'&&index===2){assert.ok(snapshot.messages.some(x=>x.toolName==='spatial_analyze'&&x.isError));return call('spatial_analyze',{operation:'nearest',input:candidates,target:ann(['origin']),count:2});}
   if(row.caseId==='D17'){if(turn===0&&index===1)return call('spatial_analyze',{operation:'buffer',input:ann(['origin']),distanceM:500});if(turn===1&&index===1)return call('annotation_read',{mode:'draft'});if(turn===1&&index===2)return call('annotation_from_analysis',{resultRef:buffers[0].resultRef,layerId:'derived',objectId:'saved-range',name:'临时范围'});}
   if(row.caseId==='D21'&&index===1)return call('spatial_analyze',{operation:'filter',input:candidates,spatial:{relation:'contains',target:ann(['region'])}});
   return response(row.group,undefined,'离线真实工具接线检查；不计模型正确率。');
  }catch(e){scriptError=e;throw e;}
 };
 const result=await runLive({directory,port:4697,offline:{entries:schedule.filter(e=>e.round===1&&['D01','D09','D13','D17','D21'].includes(e.caseId)),claimPath,transport}});assert.equal(scriptError,undefined);assert.equal(result.stop,undefined,JSON.stringify(result));assert.ok(result.rows.every(r=>r.status==='recorded'),JSON.stringify(result));assert.equal(result.total.requests,calls);assert.equal(existsSync(liveClaim),hadLiveClaim);assert.ok(sameTurnReplay>0);assert.ok(newTurnReplay>0);
 const sessions=new Set<string>();for(const row of result.rows){const dir=join(directory,row.id),review=read<{fixture:Prepared;final:SessionSnapshot;after:Prepared['fixture']['before']}>(join(dir,'review.json'));sessions.add(review.fixture.fixture.sessionId);assert.equal(row.completedUserTurns,row.plannedUserTurns);assert.ok(!JSON.stringify(read(join(dir,'judge-input.json'))).includes('PRIVATE_REASONING_TRACE'));assert.ok(!review.final.messages.some(x=>x.text?.includes('PRIVATE_REASONING_TRACE')));
  const results=review.final.messages.flatMap(m=>m.spatialResult?[m.spatialResult]:[]);
  if(row.caseId==='D09'){assert.equal(results.at(-1)!.items.length,0);assert.equal(results.filter(r=>r.operation==='buffer').length,2);}
  if(row.caseId==='D13')assert.deepEqual(results.at(-1)!.items.map(i=>i.annotation!.objectId),['r1','r2']);
  if(row.caseId==='D17')assert.deepEqual(review.after.version!.document.layers.find(l=>l.layerId==='derived')!.features[0].geometry,results[0].geometry);
  if(row.caseId==='D21')assert.equal(results.at(-1)!.items.length,4);
  const files=await readdir(dir);assert.ok(files.some(f=>f.endsWith('-loading.json')));assert.ok(files.includes('native-sessions'));const loading=files.filter(f=>f.endsWith('-loading.json')).sort().map(f=>read<{skills:Record<string,{catalogPresent:boolean;bodyPresent:boolean}>}>(join(dir,f)));for(const id of ['map-annotations','spatial-analysis']){assert.equal(loading[0].skills[id].catalogPresent,true);assert.equal(loading[0].skills[id].bodyPresent,false);assert.ok(loading.some(l=>l.skills[id].bodyPresent));}
 }
 assert.equal(sessions.size,15);await assert.rejects(runLive({directory:join(parent,'another'),port:4697,offline:{entries:schedule.filter(e=>e.round===1&&['D01','D09','D13','D17','D21'].includes(e.caseId)),claimPath,transport}}),/already claimed/);assert.equal(result.total.unknown,0);
});

for(const fault of ['http_error','response_model_drift','missing_usage','truncated'] as const)test(`provider ${fault} preserves first failure and refuses automatic retry`,{timeout:120000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r14-offline-failure-')),directory=join(parent,'batch'),original=globalThis.fetch;let calls=0;
 const transport:typeof fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);calls++;if(fault==='http_error')return new Response('quota blocked',{status:429});const r=fakeResponse(fault==='response_model_drift'?'other':modelConfiguration.A.responseModel),raw=await r.text();return new Response(fault==='missing_usage'?raw.replace(/,"usage":\{[^}]+\}/g,''):fault==='truncated'?raw.replace('"finish_reason":"stop"','"finish_reason":"length"'):raw,{headers:r.headers});};
 const result=await runLive({directory,port:4697,offline:{entries:schedule.slice(0,3),transport,claimPath:join(parent,'claim.json')}});assert.equal(calls,1);assert.ok(result.stop);assert.equal(result.rows[1].status,'not_executed');assert.equal(result.rows[2].status,'not_executed');const ledger=read<{requests:Array<{status:string;reason?:string}>;halted:string}>(join(directory,'ledger.json'));assert.equal(ledger.requests.length,1);assert.equal(ledger.requests[0].status,'failed');assert.ok(ledger.halted);
});
for(const scenario of ['unnecessary','unknown','missing_result','data_gap','optional_invitation'] as const)test(`task boundary ${scenario} follows the frozen continuation rule`,{timeout:120000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r14-offline-boundary-')),directory=join(parent,'batch'),original=globalThis.fetch;let calls=0;
 const caseId=scenario==='data_gap'?'D04':scenario==='missing_result'?'D17':'D01';
 const transport:typeof fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);calls++;const row=read<Array<{group:Group;status:string}>>(join(directory,'runs.json')).find(r=>r.status==='started')!;return response(row.group,undefined,scenario==='unnecessary'?'请确认使用本会话草稿还是来源系统？':scenario==='unknown'?'请提供尚未授权的账号和权限。':scenario==='data_gap'?'车场乙的车辆数量字段缺失，无法确定完整总数；请补充车场乙的车辆数量。':scenario==='optional_invitation'?'查询已结束。若需要后续分析，请告知。':'可以生成范围。');};
 const result=await runLive({directory,port:4697,offline:{entries:schedule.filter(e=>e.round===1&&e.caseId===caseId),transport,claimPath:join(parent,'claim.json')}});
 if(scenario==='unknown'){assert.ok(result.stop);assert.equal(calls,1);assert.equal(result.rows[1].status,'not_executed');}
 else{assert.equal(result.stop,undefined);assert.equal(calls,3);assert.ok(result.rows.every(r=>r.status===(['unnecessary','missing_result'].includes(scenario)?'incomplete':'recorded')));}
});
test('D06 ordinary/API questions receive only the frozen choice and continue native tools',{timeout:120000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r14-offline-clarification-')),directory=join(parent,'batch'),original=globalThis.fetch,counts=new Map<string,number>();
 const transport:typeof fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);
  const row=read<Array<{id:string;group:Group;status:string}>>(join(directory,'runs.json')).find(r=>r.status==='started')!,n=(counts.get(row.id)??0)+1;counts.set(row.id,n);
  if(n===1)return row.group==='A'?response(row.group,undefined,'存在两个同名救援资源图层，请选择 rescue-coast 还是 rescue-inland？'):response(row.group,{name:'ask_user',arguments:{questions:[{id:'scope',prompt:'存在同名救援资源图层，请选择 rescue-coast 还是 rescue-inland？'}]}});
  const payload=JSON.parse(String(init?.body)) as Payload;assert.ok(JSON.stringify(payload.messages).includes('选择 layerId=rescue-coast'));
  if(n===2)return response(row.group,{name:'annotation_read',arguments:{mode:'draft'}});
  return response(row.group,undefined,'岸边甲、岸边乙，共2个。');
 };
 const result=await runLive({directory,port:4697,offline:{entries:schedule.filter(e=>e.round===1&&e.caseId==='D06'),transport,claimPath:join(parent,'claim.json')}});assert.equal(result.stop,undefined,JSON.stringify(result));assert.ok(result.rows.every(r=>r.status==='recorded'));assert.equal(result.total.requests,9);
});
test('D12 actual source update preserves old analysis while next native turn reads new version',{timeout:120000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r14-offline-update-')),directory=join(parent,'batch'),original=globalThis.fetch,counts=new Map<string,number>();
 const transport:typeof fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);
  const row=read<Array<{id:string;group:Group;status:string}>>(join(directory,'runs.json')).find(r=>r.status==='started')!,dir=join(directory,row.id),p=read<Prepared>(join(dir,'fixture.json')),turn=read<Array<{turn:number}>>(join(directory,'attempts.json')).at(-1)!.turn,n=(counts.get(row.id+':'+turn)??0)+1;counts.set(row.id+':'+turn,n);
  const candidate=p.sourceBefore.objects.find(o=>o.name==='北港车场')!;
  if(n===1)return response(row.group,{name:'spatial_analyze',arguments:{operation:'filter',input:{kind:'source',systemId:'situation',objectRefs:[candidate.ref]},attributes:[{field:'availableCount',op:'gte',value:3}]}});
  return response(row.group,undefined,'离线更新接线完成。');
 };
 const result=await runLive({directory,port:4697,offline:{entries:schedule.filter(e=>e.round===1&&e.caseId==='D12'),transport,claimPath:join(parent,'claim.json')}});assert.equal(result.stop,undefined,JSON.stringify(result));assert.ok(result.rows.every(r=>r.status==='recorded'));
 for(const row of result.rows){const review=read<{final:SessionSnapshot;fixture:Prepared}>(join(directory,row.id,'review.json')),results=review.final.messages.flatMap(m=>m.spatialResult?[m.spatialResult]:[]);assert.equal(results.length,2);assert.equal(results[0].items.length,1);assert.equal(results[1].items.length,0);assert.equal(review.fixture.sourceUpdates?.length,1);}
});
test('only distinct successful generated buffers satisfy dependent user turns',()=>{
 const original={id:'a',role:'tool',toolName:'spatial_analyze',spatialResult:{operation:'buffer',resultRef:'first',geometry:{type:'Polygon'}}};
 assert.equal(availableBufferResults([original,{...original,id:'read-back'}]),1);
 assert.equal(availableBufferResults([original,{...original,id:'b',spatialResult:{...original.spatialResult,resultRef:'second'}}]),2);
 assert.equal(availableBufferResults([{...original,isError:true}]),0);
});

test('execution gate rejects blocked, unreviewed or drifted code before live claim',()=>{
 assert.throws(()=>assertExecutionGate({status:'blocked',freezeHash:'f',evidence:['D04']},'f'),/offline_gate_not_passed/);
 assert.throws(()=>assertExecutionGate({status:'passed',freezeHash:'old',evidence:['check.md']},'new'),/offline_gate_source_drift/);
 assert.throws(()=>assertExecutionGate({status:'passed',freezeHash:'f',evidence:[]},'f'),/offline_gate_evidence_missing/);
 assert.doesNotThrow(()=>assertExecutionGate({status:'passed',freezeHash:'f',evidence:['check.md']},'f'));
});
test('repeated D06 question is not answered twice and does not stop unrelated scheduled tasks',{timeout:120000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r14-offline-repeat-choice-')),directory=join(parent,'batch'),original=globalThis.fetch,counts=new Map<string,number>();
 const transport:typeof fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);
  const row=read<Array<{id:string;group:Group;status:string}>>(join(directory,'runs.json')).find(r=>r.status==='started')!,n=(counts.get(row.id)??0)+1;counts.set(row.id,n);assert.ok(n<=2,'No third paid/mock request after repeated choice');
  return row.group==='A'?response(row.group,undefined,'请明确救援资源选择哪个图层：rescue-coast还是rescue-inland？'):response(row.group,{name:'ask_user',arguments:{questions:[{id:'scope',prompt:'请明确救援资源选择哪个图层：rescue-coast还是rescue-inland？'}]}});
 };
 const result=await runLive({directory,port:4697,offline:{entries:schedule.filter(e=>e.round===1&&e.caseId==='D06'),transport,claimPath:join(parent,'claim.json')}});assert.equal(result.stop,undefined,JSON.stringify(result));assert.ok(result.rows.every(r=>r.status==='incomplete'));assert.equal(result.total.requests,6);
});

test('synthetic date comes from the frozen case manifest, never the execution day',()=>{
 assert.equal(frozenSyntheticDay(),JSON.parse(readFileSync(new URL('./cases.json',import.meta.url),'utf8')).syntheticDay);
 assert.equal(frozenSyntheticDay({syntheticDay:'2001-01-01'}),'2001-01-01');
 assert.throws(()=>frozenSyntheticDay({syntheticDay:'2026-02-30'}));assert.throws(()=>frozenSyntheticDay({syntheticDay:'2026-1-1'}));assert.throws(()=>frozenSyntheticDay({}));
});

test('two buffers in first preview cannot substitute for missing second preview',()=>{
 const result=(id:string,delivery?:unknown)=>({id,role:'tool',toolName:'spatial_analyze',spatialResult:{operation:'buffer',resultRef:id,geometry:{type:'Polygon'},...(delivery?{delivery}:{})}});
 const first={originalUserTurn:0,snapshot:{messages:[result('first-wrong'),result('first-correct')]}} as unknown as {originalUserTurn:number;snapshot:SessionSnapshot};
 const second={originalUserTurn:1,snapshot:{messages:[...first.snapshot.messages,result('first-correct',{requestId:'read',toolCallId:'read'})]}} as unknown as typeof first;
 assert.equal(generatedBuffersInUserTurn(0,[first]),2);assert.equal(generatedBuffersInUserTurn(1,[first,second]),0);
 second.snapshot.messages.push(result('second-correct') as unknown as SessionSnapshot['messages'][number]);assert.equal(generatedBuffersInUserTurn(1,[first,second]),1);
});
test('D18 native preview correction saves the second user-turn range rather than the global second buffer',{timeout:120000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r14-offline-preview-turn-')),directory=join(parent,'batch'),original=globalThis.fetch,counts=new Map<string,number>();
 const transport:typeof fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);
  const row=read<Array<{id:string;group:Group;status:string}>>(join(directory,'runs.json')).find(r=>r.status==='started')!,dir=join(directory,row.id),p=read<Prepared>(join(dir,'fixture.json')),m=read<Parameters<typeof mapTrialRequest>[0]>(join(dir,'manifest.json')),turn=read<Array<{turn:number}>>(join(directory,'attempts.json')).at(-1)!.turn,n=(counts.get(row.id+':'+turn)??0)+1;counts.set(row.id+':'+turn,n);
  const ref=p.fixture.before.version!.ref;
  if((turn===0&&n===1)||(turn===1&&n<=2))return response(row.group,{name:'spatial_analyze',arguments:{operation:'buffer',input:{kind:'annotation',ref,objectIds:['origin']},distanceM:turn===0?800:n===1?900:1200}});
  if(turn===2&&n===1)return response(row.group,{name:'annotation_read',arguments:{mode:'draft'}});
  if(turn===2&&n===2){const snapshot=await mapTrialRequest<SessionSnapshot>(m,`/api/sessions/${p.fixture.sessionId}`,'planning'),preview=snapshot.messages.flatMap(x=>x.spatialResult?.parameters.operation==='buffer'&&x.spatialResult.parameters.distanceM===1200?[x.spatialResult]:[])[0];assert.ok(preview);return response(row.group,{name:'annotation_from_analysis',arguments:{resultRef:preview.resultRef,layerId:'derived',objectId:'outer-range',name:'外圈参考'}});}
  return response(row.group,undefined,'离线原用户轮引用检查完成。');
 };
 const result=await runLive({directory,port:4697,offline:{entries:schedule.filter(e=>e.round===1&&e.caseId==='D18'),transport,claimPath:join(parent,'claim.json')}});assert.equal(result.stop,undefined,JSON.stringify(result));assert.ok(result.rows.every(r=>r.status==='recorded'));
 for(const row of result.rows){const evidence=read<{fixedPreviewEvidence:{buffers:Array<{originalUserTurn:number;distanceM:number}>;authorizedResultRefs:string[];needsSemanticReview:boolean};saveReferences:Array<{arguments:{resultRef:string}}> }>(join(directory,row.id,'deterministic-evidence.json'));assert.deepEqual(evidence.fixedPreviewEvidence.buffers.map(b=>[b.originalUserTurn,b.distanceM]),[[0,800],[1,900],[1,1200]]);assert.equal(evidence.fixedPreviewEvidence.needsSemanticReview,false);assert.deepEqual(evidence.fixedPreviewEvidence.authorizedResultRefs,[evidence.saveReferences[0].arguments.resultRef]);}
});
