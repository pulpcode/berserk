import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {schedule,groups,type Prepared,clarificationResponse,isPlainClarification} from './cases.js';
import {openLedger,assertCalibrationAccounting,budgets} from './budget.js';
import {preload} from './provider.js';
import {runLive,sourceFreeze} from './live.js';
import {digest,type Runtime} from './runtime.js';
import {loopbackOnly} from '../r7-20261023/runtime.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
import type {Payload} from '../r3-20261022/audit.js';
import {mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import type {SessionSnapshot,Interaction} from '../../../../experiments/harness-lab/src/contracts/index.js';
const read=<T>(path:string)=>JSON.parse(readFileSync(path,'utf8')) as T;
test('64 unique slots, full factorial pairing, each group occupies each position four times',()=>{
 assert.equal(schedule.length,64);assert.equal(new Set(schedule.map(e=>e.id)).size,64);
 for(const group of groups){assert.equal(schedule.filter(e=>e.group===group).length,16);for(let pos=0;pos<4;pos++)assert.equal(schedule.filter((e,i)=>e.group===group&&i%4===pos).length,4);}
});
test('shared budget keeps failures and unknown usage; active task can finish beyond startup guard',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'r11-ledger-')),ledger=openLedger(join(dir,'ledger.json'),'freeze');
 assert.ok(ledger.canStartTrial());ledger.beginRequest({id:'one',role:'agent',trialId:'Q'});assert.equal(ledger.canStartTrial(),false);assert.throws(()=>ledger.beginRequest({id:'two',role:'judge',trialId:'C'}));
 ledger.finishRequest('one',{inputTokens:budgets.agent.input-499_999,outputTokens:1,responseModel:'deepseek-v4-1-flash-261017'});assert.equal(ledger.canStartTrial(),false);assert.ok(ledger.canStartJudge());
 ledger.beginRequest({id:'active-next',role:'agent',trialId:'Q'});ledger.finishRequest('active-next',{inputTokens:1_000_000,outputTokens:1,responseModel:'deepseek-v4-1-flash-261017'});assert.equal(ledger.canStartTrial(),false);
 ledger.beginRequest({id:'completed-judge',role:'judge',trialId:'duplicate'});ledger.finishRequest('completed-judge',{inputTokens:1,outputTokens:1,responseModel:'deepseek-v4-1-flash-261017'});assert.throws(()=>ledger.beginRequest({id:'retry-judge',role:'judge',trialId:'duplicate'}));
 ledger.beginRequest({id:'judge',role:'judge',trialId:'C'});ledger.failRequest('judge','provider_failure');assert.equal(ledger.canStartJudge(),false);assert.throws(()=>openLedger(ledger.path,'different'));assert.throws(()=>ledger.finishRequest('judge',{inputTokens:1,outputTokens:1,responseModel:'deepseek-v4-1-flash-261017'}));
});
test('calibration evidence must belong to the same completed shared ledger requests',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'r11-cal-ledger-')),ledger=openLedger(join(dir,'ledger.json'),'freeze');
 const records=Array.from({length:24},(_,i)=>({id:'C'+i,requestId:'provider-'+i,responseSha256:digest('response'+i),usage:{inputTokens:10,outputTokens:2}}));
 for(const r of records){ledger.beginRequest({id:'judge:'+r.id,role:'judge',trialId:r.id});ledger.finishRequest('judge:'+r.id,{...r.usage,responseModel:'deepseek-v4-1-flash-261017',providerRequestId:r.requestId,responseSha256:r.responseSha256});}
 assertCalibrationAccounting(ledger,records);assert.throws(()=>assertCalibrationAccounting(ledger,records.map((r,i)=>i? r:{...r,requestId:'elsewhere'})));assert.throws(()=>assertCalibrationAccounting(ledger,records.map((r,i)=>i? r:{...r,usage:{inputTokens:99,outputTokens:2}})));
});
test('preload only adds exact both bodies to existing same first system slot',()=>{
 const runtime={skills:{'map-annotations':{content:'MAP_BODY',hash:'a',description:'map'},'spatial-analysis':{content:'SPATIAL_BODY',hash:'b',description:'spatial'}}} as unknown as Runtime;
 const original:Payload={messages:[{role:'system',content:'EXISTING'},{role:'user',content:'你好'}],tools:[],model:'deepseek-v4.1-flash'};
 assert.deepEqual(preload(original,runtime,false),original);const p=preload(original,runtime,true);assert.deepEqual(p.messages!.slice(1),original.messages!.slice(1));assert.ok(String(p.messages![0].content).indexOf('MAP_BODY')<String(p.messages![0].content).indexOf('SPATIAL_BODY'));assert.equal(original.messages![0].content,'EXISTING');assert.throws(()=>preload({messages:[]},runtime,true));
});
test('no arbitrary approvals; ordinary clarifications distinguished from future offers',()=>{
 const p={caseId:'Q03',clarificationReply:'预定草稿选择'} as Prepared;
 const q={kind:'question',requestId:'r',questions:[{id:'scope',prompt:'请选择草稿还是来源系统？'}]} as Interaction;
 assert.equal(clarificationResponse(p,q,false)?.kind,'question');assert.equal(clarificationResponse(p,q,true),undefined);assert.equal(clarificationResponse(p,{...q,kind:'confirmation'} as Interaction,false),undefined);
 const snapshot=(text:string)=>({messages:[{role:'assistant',text}]}) as SessionSnapshot;
 assert.ok(isPlainClarification(p,snapshot('请确认，是草稿还是来源系统？')));assert.equal(isPlainClarification(p,snapshot('草稿4个，来源1个。是否需要继续分析？')),false);
});
test('live refuses missing gate before reading supplied secret or making request',async()=>{
 let reads=0;const env=new Proxy({},{get(){reads++;throw new Error('secret read');}}) as NodeJS.ProcessEnv;
 await assert.rejects(runLive({directory:'/tmp/r11-never-created',env}),/requires freeze/);assert.equal(reads,0);assert.equal(existsSync('/tmp/r11-never-created'),false);
});
test('isolated real HTTP/Pi slots exercise exact delivery, calculations, both clarification channels and writes',{timeout:600000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r11-64-')),directory=join(parent,'batch'),original=globalThis.fetch;const counts=new Map<string,number>();let scriptError:unknown,requests=0;
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);
  requests++;const payload=JSON.parse(String(init?.body)) as Payload;assert.equal(payload.thinking?.type,'disabled');
  const row=read<Array<{id:string;caseId:string;group:string;status:string}>>(join(directory,'runs.json')).find(r=>r.status==='started')!;
  const stem=join(directory,row.id),p=read<Prepared>(join(stem,'fixture.json')),m=read<Parameters<typeof mapTrialRequest>[0]>(join(stem,'manifest.json')),turn=read<Array<{turn:number}>>(join(directory,'attempts.json')).at(-1)!.turn;
  const key=row.id+':'+turn,n=(counts.get(key)??0)+1;counts.set(key,n);
  const native=row.group.endsWith('-N'),negative=['Q07','Q08'].includes(row.caseId),index=n-(native&&!negative&&turn===0?2:0);
  const call=(name:string,args:unknown)=>fakeResponse('deepseek-v4-1-flash-261017',{name,arguments:args});
  const snapshot=await mapTrialRequest<SessionSnapshot>(m,`/api/sessions/${p.fixture.sessionId}`,'planning'),buffers=snapshot.messages.flatMap(x=>x.spatialResult?.operation==='buffer'?[x.spatialResult]:[]),ref=p.fixture.before.version!.ref;
  const ann=(objectIds:string[])=>({kind:'annotation',ref,objectIds}),candidates={kind:'annotation',ref,layerIds:['resources']},filter=()=>call('spatial_analyze',{operation:'filter',input:candidates,spatial:{relation:'contains',target:ann(['region'])}});
  try{
   if(native&&!negative&&turn===0&&n<=2)return call('skill_read',{id:n===1?'map-annotations':'spatial-analysis'});
   if(row.caseId==='Q01'&&index===1)return filter();
   if(row.caseId==='Q02'&&index===1)return call('situation_query',{systemId:'situation',mode:'current',objectRefs:[m.objects.resource]});
   if(row.caseId==='Q03'){
    if(row.group==='S1-N'&&turn===0&&index===1)return fakeResponse('deepseek-v4-1-flash-261017',undefined,'请确认，您指的是草稿点，还是来源系统的资源点？');
    if(row.group==='S1-N'&&turn===1&&index===1)return filter();
    if(row.group==='S0-P'&&index===1)return filter();
    if(row.group==='S0-P'&&index===2)return call('spatial_analyze',{operation:'filter',input:{kind:'source',systemId:'situation',objectRefs:[m.objects.resource]},spatial:{relation:'contains',target:{kind:'source',systemId:'situation',objectRefs:[p.sourceBefore.objects.find(o=>o.ref.objectType==='area'&&o.ref.objectId.includes('-west'))!.ref]}}});
    if(['S0-N','S1-P'].includes(row.group)&&index===1)return call('ask_user',{questions:[{id:'source',prompt:'请确认使用本会话草稿还是来源系统的资源？'}]});
    if(['S0-N','S1-P'].includes(row.group)&&index===2)return filter();
   }
   if(row.caseId==='Q04'&&index===1){if(turn<2)return call('spatial_analyze',{operation:'buffer',input:ann(['origin']),distanceM:turn===0?500:1500});return call('spatial_analyze',{operation:'filter',input:candidates,spatial:{relation:'contains',target:{kind:'result',resultRef:buffers[0].resultRef,geometry:true}}});}
   if(row.caseId==='Q05'&&index===1)return call('spatial_analyze',{operation:'nearest',input:candidates,target:ann(['origin']),count:2});
   if(row.caseId==='Q06'){if(turn===0&&index===1)return call('spatial_analyze',{operation:'buffer',input:ann(['origin']),distanceM:500});if(turn===1&&index===1)return call('annotation_read',{mode:'draft'});if(turn===1&&index===2)return call('annotation_from_analysis',{resultRef:buffers[0].resultRef,layerId:'derived',objectId:'saved-range',name:'临时范围'});}
   return fakeResponse('deepseek-v4-1-flash-261017',undefined,'离线工具接线检查，不计模型语义通过。');
  }catch(error){scriptError=error;throw error;}
 };
 const entries=process.env.R11_OFFLINE_Q03_ONLY==='1'?schedule.filter(e=>e.caseId==='Q03'&&e.round===1):schedule;const result=await runLive({directory,port:4617,offline:{transport,entries}});assert.equal(scriptError,undefined);assert.equal(result.stop,undefined);assert.equal(result.rows.length,entries.length);assert.ok(result.rows.every(r=>r.status==='recorded'));
 const sessions=new Set<string>();for(const row of result.rows){
  assert.ok(row.startedAt&&row.endedAt&&row.elapsedMs!>=0);assert.equal(row.elapsedMs,Date.parse(row.endedAt)-Date.parse(row.startedAt));const stem=join(directory,row.id),review=read<{fixture:Prepared;final:SessionSnapshot;after:Prepared['fixture']['before'];clarification:{api:boolean;apiAttempted:boolean;plain:boolean}}>(join(stem,'review.json'));sessions.add(review.fixture.fixture.sessionId);
  const results=review.final.messages.flatMap(m=>m.spatialResult?[m.spatialResult]:[]);
  if(row.caseId==='Q01')assert.deepEqual(results.at(-1)!.items.map(i=>i.annotation!.objectId).sort(),['edge','r1','r2','r3']);
  if(row.caseId==='Q04'){assert.equal(results.at(-1)!.items.length,0);const param=results.at(-1)!.parameters;assert.ok(param.operation==='filter'&&param.spatial?.target.kind==='result');assert.equal(param.spatial.target.resultRef,results[0].resultRef);}
  if(row.caseId==='Q05'){const result=results.at(-1)!;assert.deepEqual(result.items.map(i=>i.annotation!.objectId),['r1','r2']);const expected=review.fixture.truth.distancesM as Record<string,number>;for(const i of result.items)assert.ok(Math.abs(i.distanceM!-expected[i.annotation!.objectId])<2);}
  if(row.caseId==='Q06')assert.deepEqual(review.after.version!.document.layers.find(l=>l.layerId==='derived')!.features[0].geometry,results[0].geometry);
  if(row.caseId==='Q03'&&row.group==='S1-N')assert.ok(review.clarification.plain&&!review.clarification.api);
  if(row.caseId==='Q03'&&row.group==='S0-N')assert.ok(review.clarification.api&&review.clarification.apiAttempted&&!review.clarification.plain);
  const blinded=JSON.stringify(read(join(stem,'judge-input.json')));assert.ok(!blinded.includes('S0-N')&&!blinded.includes('S1-P'));assert.ok(!blinded.includes('thinking_content'));
 }
 assert.equal(sessions.size,entries.length);assert.equal(openLedger(join(directory,'ledger.json'),digest(JSON.stringify(await sourceFreeze()))).totals().requests,requests);
 await assert.rejects(runLive({directory,port:4617,offline:{transport}}),/EEXIST/);
});
for(const fault of ['http_error','response_model_drift','missing_usage'] as const)test(`real HTTP loop preserves ${fault} and never retries a paid request`,{timeout:120000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r11-failure-')),directory=join(parent,'batch'),original=globalThis.fetch;let calls=0;
 const transport:typeof fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);calls++;
  if(fault==='http_error')return new Response('quota blocked',{status:429});
  if(fault==='response_model_drift')return fakeResponse('deepseek-v4.1-flash',undefined,'wrong exact response version');
  const response=fakeResponse('deepseek-v4-1-flash-261017');return new Response((await response.text()).replace(/,"usage":\{[^}]+\}/g,''),{headers:response.headers});
 };
 const entries=schedule.filter(e=>e.caseId==='Q07').slice(0,2),result=await runLive({directory,port:4617,offline:{entries,transport}});
 assert.equal(calls,1);assert.ok(result.stop);assert.equal(result.rows[1].status,'not_executed');const ledger=read<{requests:Array<{status:string}>;halted?:string}>(join(directory,'ledger.json'));assert.ok(ledger.halted);assert.equal(ledger.requests.length,1);assert.equal(ledger.requests[0].status,'failed');
});
