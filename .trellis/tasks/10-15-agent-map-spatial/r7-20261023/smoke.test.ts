import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {canStartSlot,warnings} from './live-budget.js';
import {runLive} from './live.js';
import {schedule,type Prepared} from './cases.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
import {offlineEnvironment,loopbackOnly} from './runtime.js';
import {liveEnvironment} from './environment.js';
import type {Payload} from '../r3-20261022/audit.js';
const read=<T>(path:string):T=>JSON.parse(readFileSync(path,'utf8')) as T;
test('D16 B real conflict recovery preserves the first preview and external note',{timeout:60000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r6-conflict-')),directory=join(parent,'batch'),original=globalThis.fetch;
 const entry=schedule.find(e=>e.caseId==='D16'&&e.group==='B')!;let calls=0,ref='',scriptError:unknown;
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);
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
 const result=await runLive({directory,entries:[entry],env:offlineEnvironment(),transport,port:4599});assert.equal(scriptError,undefined);assert.equal(result.stop,undefined);assert.equal(calls,7);
 const review=read<{conflictInjected:boolean;after:Prepared['fixture']['before'];final:SessionSnapshot}>(join(directory,entry.id,'review.json'));
 assert.equal(review.conflictInjected,true);const features=review.after.version!.document.layers.flatMap(l=>l.features);
 assert.equal(features.find(f=>f.objectId==='origin')?.note,'外部已核实，请保留');
 assert.deepEqual(features.find(f=>f.objectId==='saved-range')?.geometry,review.final.messages.find(m=>m.spatialResult?.operation==='buffer')?.spatialResult?.geometry);
});

test('frozen 12 A/B entries and correct Ark endpoint required',()=>{
 assert.equal(schedule.length,12);for(const g of ['A','B'])assert.equal(schedule.filter(e=>e.group===g).length,6);
 assert.ok(schedule.every(e=>e.loading==='explicit'));
 assert.throws(()=>liveEnvironment({...offlineEnvironment(),LLM_BASE_URL:'https://api.deepseek.com'}));
 assert.throws(()=>liveEnvironment({...offlineEnvironment(),LLM_MODEL:'deepseek-v4-pro'}));
 assert.equal(canStartSlot({requests:156,input:1700000,output:90000,unknownUsage:0}),true);
 assert.equal(canStartSlot({requests:157,input:0,output:0,unknownUsage:0}),false);
 assert.deepEqual(warnings(25,65,610000),['requests','tools','elapsedMs']);
});
test('all 12 HTTP/Pi slots exact model and explicit body each turn; resume never replays',{timeout:120000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r7-all-')),directory=join(parent,'batch'),original=globalThis.fetch;let calls=0;
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);
  assert.equal(url.href,'https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions');
  assert.equal(init?.redirect,'error');const payload=JSON.parse(String(init?.body)) as Payload;
  assert.equal(payload.model,'deepseek-v4.1-flash');assert.equal(payload.max_tokens,8192);
  assert.ok(JSON.stringify(payload.messages).includes('所选 Skill 正文已经加载'));calls++;return fakeResponse(payload.model!);
 };
 const result=await runLive({directory,env:offlineEnvironment(),transport,port:4599});
 assert.equal(result.stop,undefined);assert.equal(calls,14);assert.equal(result.rows.length,12);
 for(const row of result.rows.filter(r=>r.caseId==='D21')){const p=read<Prepared>(join(directory,row.id,'fixture.json'));const fs=p.fixture.before.version!.document.layers.flatMap(l=>l.features);const edge=fs.find(f=>f.objectId==='region-south-edge')!;const region=fs.find(f=>f.objectId==='region')!;assert.equal(edge.geometry.type,'LineString');assert.equal(region.geometry.type,'Polygon');if(region.geometry.type==='Polygon')assert.deepEqual(edge.geometry.coordinates,region.geometry.coordinates[0].slice(0,2));assert.ok(Math.abs(Number(p.truth.expectedLengthM)-1846.731)<0.01);assert.equal(p.truth.documentTotal,fs.length);}
 const resumed=await runLive({directory,env:offlineEnvironment(),transport,port:4599,resume:true});assert.equal(resumed.total.requests,14);assert.equal(calls,14);
});
