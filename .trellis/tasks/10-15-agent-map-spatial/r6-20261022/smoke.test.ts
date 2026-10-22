import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {canStartSlot,warnings} from './live-budget.js';
import {runLive,awaitClarificationReview,type ClarificationGate} from './live.js';
import {schedule,type Prepared} from './cases.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
import {offlineEnvironment,loopbackOnly,digest} from './runtime.js';
import type {Payload} from '../r3-20261022/audit.js';
const read=<T>(path:string):T=>JSON.parse(readFileSync(path,'utf8')) as T;
const sleep=()=>new Promise(resolve=>setTimeout(resolve,20));
function decide(directory:string,approve:boolean,extra:Record<string,unknown>={}){
 const gate=read<ClarificationGate&{gateHash:string}>(join(directory,'clarification-gate.json'));
 const decision={approve,evidence:approve?'Deterministic test reviewer: captured target-choice question, no calculation.':'Deterministic test reviewer: decline the captured premature selection or invalid question.',reviewer:'offline-test',entryId:gate.entryId,requestId:gate.requestId,gateHash:gate.gateHash,...extra};
 const temporary=join(directory,'decision.tmp');writeFileSync(temporary,JSON.stringify(decision));renameSync(temporary,join(directory,'decision.json'));return gate;
}
test('12 explicit slots and between-task budget reserve without hard numerical cutoff',()=>{
 assert.equal(schedule.length,12);assert.ok(schedule.every(e=>e.loading==='explicit'));
 for(const group of ['E0','E1','E2'])assert.equal(schedule.filter(e=>e.group===group).length,4);
 assert.equal(canStartSlot({requests:156,input:2_700_000,output:50_000,unknownUsage:0}),true);
 assert.equal(canStartSlot({requests:157,input:0,output:0,unknownUsage:0}),false);
 assert.equal(canStartSlot({requests:0,input:2_700_001,output:0,unknownUsage:0}),false);
 assert.equal(canStartSlot({requests:0,input:0,output:50_001,unknownUsage:0}),false);
 assert.deepEqual(warnings(25,65,610000),['requests','tools','elapsedMs']);
});
test('12 native HTTP/Pi slots preserve explicit treatment, API and ordinary review gates, denial and no-replay resume',{timeout:120000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r6-smoke-')),directory=join(parent,'batch'),original=globalThis.fetch;
 const counts=new Map<string,number>(),schemas=new Map<string,unknown>();let calls=0,finished=false;
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://api.deepseek.com')return loopbackOnly(original)(input,init);
  const payload=JSON.parse(String(init?.body)) as Payload;calls++;
  const row=read<Array<{id:string;caseId:string;group:string;status:string}>>(join(directory,'runs.json')).find(r=>r.status==='started')!;
  const count=(counts.get(row.id)??0)+1;counts.set(row.id,count);
  const tools=payload.tools! as Array<{function:{name:string;parameters:unknown}}>;
  const common=tools.filter(tool=>!['annotation_read','spatial_analyze'].includes(tool.function.name));
  if(!schemas.has('common'))schemas.set('common',common);assert.deepEqual(common,schemas.get('common'));
  if(row.group!=='E2'){if(!schemas.has('baseline'))schemas.set('baseline',tools);assert.deepEqual(tools,schemas.get('baseline'));}
  assert.equal(JSON.stringify(tools).includes('classify_points'),row.group==='E2');assert.equal(JSON.stringify(tools).includes('objectNames'),row.group==='E2');
  assert.ok(JSON.stringify(payload.messages).includes('所选 Skill 正文已经加载'));
  if(row.caseId==='D11'&&count===1){
   if(row.group==='E0')return fakeResponse(payload.model!,{name:'ask_user',arguments:{questions:[{id:'target',prompt:'选择哪一个集合点？',options:[{id:'a',label:'amb-a'},{id:'b',label:'amb-b'}]}]}});
   return fakeResponse(payload.model!,undefined,row.group==='E2'?'我已替你选择amb-a并完成了计算。':'请选择集合点amb-a还是amb-b；收到选择后再计算。');
  }
  return fakeResponse(payload.model!);
 };
 const reviewWork=(async()=>{
  for(const entry of schedule.filter(e=>e.caseId==='D11')){
   const slot=join(directory,entry.id);while(!existsSync(join(slot,'clarification-gate.json'))){assert.ok(!finished,'Gate was never reached');await sleep();}
   const gate=decide(slot,entry.group!=='E2');
   assert.equal(gate.channel,entry.group==='E0'?'interaction_api':'ordinary');assert.ok(gate.answer.includes('amb-b'));
  }
 })();
 let result:Awaited<ReturnType<typeof runLive>>;
 try{result=await runLive({directory,env:offlineEnvironment(),transport,port:4596});}finally{finished=true;await reviewWork;}
 assert.equal(result.stop,undefined);assert.equal(result.rows.length,12);assert.equal(calls,17);assert.equal(result.total.requests,17);
 for(const entry of schedule){
  assert.ok(existsSync(join(directory,entry.id,'native-sessions')));
  const review=read<{apiAnswered:boolean;clarification:{status:string;channel:string}|null;final:SessionSnapshot;executedPrompts:string[];interactions:unknown[]}>(join(directory,entry.id,'review.json'));
  if(entry.caseId==='D11'){
   assert.equal(review.clarification!.status,entry.group==='E2'?'rejected':'approved');
   assert.equal(review.apiAnswered,entry.group==='E0');assert.equal(review.interactions.length,entry.group==='E0'?1:0);
   assert.equal(review.final.messages.filter(m=>m.role==='user').length,entry.group==='E1'?2:1);
   assert.equal(review.executedPrompts.length,entry.group==='E1'?2:1);
   if(entry.group==='E2')assert.equal(result.rows.find(r=>r.id===entry.id)!.status,'incomplete');
  }else assert.equal(review.clarification,null);
 }
 const resumed=await runLive({directory,env:offlineEnvironment(),transport,port:4596,resume:true});assert.equal(resumed.total.requests,17);assert.equal(calls,17);
});
test('D16 E2 real conflict recovery preserves the first preview and external note',{timeout:60000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r6-conflict-')),directory=join(parent,'batch'),original=globalThis.fetch;
 const entry=schedule.find(e=>e.caseId==='D16'&&e.group==='E2')!;let calls=0,ref='',scriptError:unknown;
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://api.deepseek.com')return loopbackOnly(original)(input,init);
  const payload=JSON.parse(String(init?.body)) as Payload;calls++;
  try{
   const p=read<Prepared>(join(directory,entry.id,'fixture.json')),manifest=read<Parameters<typeof mapTrialRequest>[0]>(join(directory,entry.id,'manifest.json'));
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
 const result=await runLive({directory,entries:[entry],env:offlineEnvironment(),transport,port:4597});assert.equal(scriptError,undefined);assert.equal(result.stop,undefined);assert.equal(calls,7);
 const review=read<{conflictInjected:boolean;after:Prepared['fixture']['before'];final:SessionSnapshot}>(join(directory,entry.id,'review.json'));
 assert.equal(review.conflictInjected,true);const features=review.after.version!.document.layers.flatMap(l=>l.features);
 assert.equal(features.find(f=>f.objectId==='origin')?.note,'外部已核实，请保留');
 assert.deepEqual(features.find(f=>f.objectId==='saved-range')?.geometry,review.final.messages.find(m=>m.spatialResult?.operation==='buffer')?.spatialResult?.geometry);
});
for(const key of ['entryId','requestId','gateHash','answer'])test(`clarification refuses stale or injected ${key} approval`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'r6-gate-'));
 const gate:ClarificationGate={channel:'ordinary',entryId:'D11-E1',sessionId:'session',requestId:'request',snapshotHash:digest(JSON.stringify({messages:[]})),snapshot:{messages:[]} as unknown as SessionSnapshot,questionMessages:[],answer:'fixed answer',selection:{id:'map-annotations',hash:'hash'}};
 const work=awaitClarificationReview(directory,gate,()=>undefined);
 decide(directory,true,{[key]:'wrong'});await assert.rejects(work);
});

for(const mode of ['repeat-api','deny-api','provider-failure'] as const)test(`D11 ${mode} never fabricates an extra answer`,{timeout:60000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r6-answer-boundary-')),directory=join(parent,'batch'),original=globalThis.fetch;
 const entry=schedule.find(e=>e.caseId==='D11'&&e.group==='E0')!;let calls=0,finished=false;
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://api.deepseek.com')return loopbackOnly(original)(input,init);
  const payload=JSON.parse(String(init?.body)) as Payload;calls++;
  if(mode==='provider-failure')return new Response('offline provider failure',{status:503});
  return fakeResponse(payload.model!,{name:'ask_user',arguments:{questions:[{id:'target',prompt:'选择集合点amb-a还是amb-b？'}]}});
 };
 const reviewWork=mode==='provider-failure'?Promise.resolve():(async()=>{
  const slot=join(directory,entry.id);while(!existsSync(join(slot,'clarification-gate.json'))){assert.ok(!finished,'Gate was never reached');await sleep();}
  decide(slot,mode==='repeat-api');
 })();
 let result:Awaited<ReturnType<typeof runLive>>;
 try{result=await runLive({directory,entries:[entry],env:offlineEnvironment(),transport,port:4598});}finally{finished=true;await reviewWork;}
 const review=read<{apiAnswered:boolean;clarification:unknown;final:SessionSnapshot;interactions:Array<{resolved?:{status?:string}}>}>(join(directory,entry.id,'review.json'));
 assert.equal(calls,mode==='repeat-api'?2:1);assert.equal(review.final.messages.filter(m=>m.role==='user').length,1);
 assert.equal(review.interactions.filter(i=>i.resolved?.status==='answered').length,mode==='repeat-api'?1:0);
 assert.equal(review.apiAnswered,mode==='repeat-api');
 if(mode==='provider-failure'){assert.ok(result.stop);assert.equal(review.clarification,null);assert.ok(!existsSync(join(directory,entry.id,'clarification-gate.json')));}
 else{assert.equal(result.stop,undefined);assert.equal(result.rows[0].status,'interaction_recorded');}
});
