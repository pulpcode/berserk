import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {runLive} from './live.js';import {schedule,type Prepared} from './cases.js';
import {offlineEnvironment,loopbackOnly} from '../r8-20261023/runtime.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
import {mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import type {SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
import type {Payload} from '../r3-20261022/audit.js';
const read=<T>(path:string):T=>JSON.parse(readFileSync(path,'utf8')) as T;
test('24 fixed native B tasks with isolated true source/annotation/fault workflows',{timeout:600000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r10-24-')),directory=join(parent,'batch'),original=globalThis.fetch;
 const counts=new Map<string,number>();let calls=0,scriptError:unknown;
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);
  calls++;const payload=JSON.parse(String(init?.body)) as Payload;assert.equal(payload.model,'deepseek-v4.1-flash');assert.equal(payload.thinking?.type,'disabled');
  const row=read<Array<{id:string;caseId:string;status:string}>>(join(directory,'runs.json')).find(r=>r.status==='started')!;
  const stem=join(directory,row.id),p=read<Prepared>(join(stem,'fixture.json')),manifest=read<Parameters<typeof mapTrialRequest>[0]>(join(stem,'manifest.json'));
  const turn=read<Array<{turn:number}>>(join(directory,'attempts.json')).at(-1)!.turn;
  const key=`${row.id}:${turn}`,n=(counts.get(key)??0)+1;counts.set(key,n);
  const snapshot=await mapTrialRequest<SessionSnapshot>(manifest,`/api/sessions/${p.fixture.sessionId}`,'planning');
  const buffers=snapshot.messages.flatMap(m=>m.spatialResult?.operation==='buffer'?[m.spatialResult]:[]);
  const ref=p.fixture.before.version!.ref;
  const ann=(objectIds:string[])=>({kind:'annotation',ref,objectIds});
  const candidates={kind:'annotation',ref,layerIds:['resources']};
  const sourceResources=p.sourceBefore.objects.filter(o=>o.ref.objectType==='resource').map(o=>o.ref);
  const west=p.sourceBefore.objects.find(o=>o.ref.objectType==='area'&&o.ref.objectId.includes('-west'))!;
  const call=(name:string,args:unknown)=>fakeResponse(payload.model!,{name,arguments:args});
  const spatial=(args:unknown)=>call('spatial_analyze',args);
  try{
   if(row.caseId==='T03'&&n===1)return call('ask_user',{questions:[{id:'region',prompt:'有两个同名观察区，请选择region还是region-other。'}]});
   if(['T01','T04','T14'].includes(row.caseId)&&n===1)return spatial({operation:'filter',input:candidates,spatial:{relation:'contains',target:ann([row.caseId==='T14'?'empty':'region'])}});
   if(row.caseId==='T02'&&n===1)return spatial({operation:'filter',input:{kind:'source',systemId:'situation',objectRefs:sourceResources},spatial:{relation:'contains',target:{kind:'source',systemId:'situation',objectRefs:[west.ref]}}});
   if(row.caseId==='T05'&&n===1)return spatial({operation:'measure',metric:'distance',input:ann(['origin']),target:ann(['north'])});
   if(row.caseId==='T06'&&n===1)return spatial({operation:'measure',metric:'length',input:ann(['return-line'])});
   if(row.caseId==='T07'&&n===1)return spatial({operation:'measure',metric:'area',input:ann(['region'])});
   if(row.caseId==='T08'&&n===1)return spatial({operation:'measure',metric:'point_to_line',input:ann(['origin']),target:ann(['line'])});
   if(row.caseId==='T09'&&n===1)return spatial({operation:'classify_points',input:candidates,target:ann(['region'])});
   if(row.caseId==='T10'&&n===1)return spatial({operation:'nearest',input:candidates,target:ann(['origin']),count:2});
   if(row.caseId==='T11'){
    if(n===1)return spatial({operation:'buffer',input:ann(['origin']),distanceM:1500});
    if(n===2)return spatial({operation:'filter',input:candidates,spatial:{relation:'contains',target:{kind:'result',resultRef:buffers[0].resultRef,geometry:true}},attributes:[{field:'category',op:'eq',value:'boat'}]});
   }
   if(row.caseId==='T12'&&n===1)return spatial({operation:'relate',relation:'intersects',input:ann(['line']),target:ann(['excluded'])});
   if(row.caseId==='T13'&&n<=2)return call('annotation_read',{mode:'read',ref,layerNames:['应急补给'],offset:(n-1)*50,limit:50});
   if(row.caseId==='T15'&&n===1)return call('situation_query',{systemId:'situation',mode:'current',areaIds:west.areaIds});
   if(row.caseId==='T16'&&n===1)return spatial({operation:'nearest',input:{kind:'source',systemId:'situation',objectRefs:sourceResources},target:ann(['origin']),count:2});
   if(['T17','T20'].includes(row.caseId)&&n===1){
    if(turn===0||row.caseId==='T20'&&turn===1)return spatial({operation:'buffer',input:ann(['origin']),distanceM:row.caseId==='T20'&&turn===0?500:1500});
    return spatial({operation:'filter',input:candidates,spatial:{relation:'contains',target:{kind:'result',resultRef:buffers[0].resultRef,geometry:true}}});
   }
   if(row.caseId==='T18'&&n===1)return spatial({operation:'nearest',input:{kind:'annotation',ref:p.fixture.annotationRefs![0],layerIds:['resources']},target:{kind:'annotation',ref:p.fixture.annotationRefs![0],objectIds:['origin']},count:2});
   if(row.caseId==='T19'&&n===1)return spatial({operation:'filter',input:{kind:'source',systemId:'situation',objectRefs:[manifest.objects.resource]},attributes:[{field:'availableCount',op:'gte',value:3}]});
   if(['T21','T22','T23'].includes(row.caseId)){
    if(turn===0&&n===1)return spatial({operation:'buffer',input:ann(['origin']),distanceM:500});
    if(turn===1){
     if(n===1||row.caseId==='T22'&&n===3)return call('annotation_read',{mode:'draft'});
     if(n===2||row.caseId==='T22'&&n===4)return call('annotation_from_analysis',{resultRef:buffers[0].resultRef,layerId:'derived',objectId:'saved-range',name:'临时范围'});
     if(row.caseId==='T23'&&n===3){const injected=read<{actualCommittedReceipt:{clientActionId:string}}>(join(stem,'lost-receipt-injection.json'));return call('annotation_read',{mode:'receipt',clientActionId:injected.actualCommittedReceipt.clientActionId});}
    }
   }
   if(row.caseId==='T24'){
    if(n===1)return call('annotation_read',{mode:'draft'});
    if(n===2)return call('annotation_action',{action:'publish',revision:p.fixture.before.binding.draft!.headRevision,title:'核对发布版'});
   }
   return fakeResponse(payload.model!,undefined,'离线工具接线检查，不计模型语义通过。');
  }catch(error){scriptError=error;throw error;}
 };
 const result=await runLive({directory,env:offlineEnvironment(),transport,port:4605});assert.equal(scriptError,undefined);assert.equal(result.stop,undefined);assert.equal(result.rows.length,24);
 assert.equal(new Set(schedule.map(e=>read<Prepared>(join(directory,e.id,'fixture.json')).fixture.sessionId)).size,24);
 const reviews=Object.fromEntries(schedule.map(e=>[e.caseId,read<{final:SessionSnapshot;after:Prepared['fixture']['before'];fixture:Prepared['fixture'];truth:Prepared['truth'];publicationProvenance:Array<{revision:number}>;interactions:Array<{pendingVerified?:boolean}>}>(join(directory,e.id,'review.json'))]));
 for(const id of ['T05','T06','T07','T08','T09','T10','T11','T12','T14','T17','T18','T20'])assert.ok(reviews[id].final.messages.some(m=>!!m.spatialResult),`${id}: missing real spatial result`);
 assert.ok(reviews.T03.interactions[0].pendingVerified);
 assert.ok(reviews.T15.final.messages.some(m=>m.isError&&/CONTEXT|503|不可用|失败/.test(m.text)),'Source failure must reach actual native tool');
 assert.ok(reviews.T16.final.messages.some(m=>m.isError&&/GEOMETRY|几何/.test(m.text)),'Missing geometry must reach actual spatial resolver');
 assert.ok(existsSync(join(directory,'T16-B/source-fault.jsonl')));
 const historical=reviews.T18.truth.historicalDistancesM as Record<string,number>,latest=reviews.T18.truth.latestDistancesM as Record<string,number>;
 assert.ok(historical.r1<historical.r2&&latest.r1>latest.r3);
 const t19=reviews.T19.final.messages.flatMap(m=>m.spatialResult?[m.spatialResult]:[]);assert.deepEqual(t19.map(r=>r.items.length),[1,0]);
 for(const id of ['T21','T22','T23']){
  const features=reviews[id].after.version!.document.layers.flatMap(l=>l.features);assert.equal(features.filter(f=>f.objectId==='saved-range').length,1);
  assert.deepEqual(features.find(f=>f.objectId==='saved-range')!.geometry,reviews[id].final.messages.find(m=>m.spatialResult?.operation==='buffer')!.spatialResult!.geometry);
 }
 assert.ok(existsSync(join(directory,'T22-B/injected-conflict.json')));assert.ok(reviews.T22.final.messages.some(m=>m.isError&&/STALE|修订|变化/.test(m.text)));
 assert.ok(reviews.T23.final.messages.some(m=>m.isError&&/ANNOTATION_RESULT_UNCERTAIN/.test(m.text)));
 const receiptRead=reviews.T23.final.messages.find(m=>m.toolName==='annotation_read'&&m.annotationResult?.origin==='receipt_read');assert.ok(receiptRead?.annotationResult?.receipt.fromAnalysis);
 assert.equal(reviews.T24.after.publications.length,1);assert.deepEqual(reviews.T24.after.current,reviews.T24.fixture.before.current);assert.equal(reviews.T24.publicationProvenance[0].revision,reviews.T24.fixture.before.binding.draft!.headRevision);
 const beforeCalls=calls;await runLive({directory,env:offlineEnvironment(),transport,port:4605,resume:true});assert.equal(calls,beforeCalls);
});
