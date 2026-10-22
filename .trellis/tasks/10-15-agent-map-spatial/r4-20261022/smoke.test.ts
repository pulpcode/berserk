import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {canStartSlot,warnings} from './live-budget.js';
import {runLive,criticalEffect} from './live.js';
import {schedule,type Prepared} from './cases.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
import {offlineEnvironment,loopbackOnly} from './runtime.js';
import type {Payload} from '../r3-20261022/audit.js';
const read=<T>(path:string):T=>JSON.parse(readFileSync(path,'utf8')) as T;

test('fixed smoke budget checks next task and never treats warning lines as failure',()=>{
 assert.equal(schedule.length,12);assert.equal(schedule.filter(e=>e.loading==='native').length,8);
 assert.equal(schedule.filter(e=>e.loading==='explicit').length,4);
 assert.equal(canStartSlot({requests:96,input:1_700_000,output:30_000,unknownUsage:0}),true);
 assert.equal(canStartSlot({requests:97,input:0,output:0,unknownUsage:0}),false);
 assert.equal(canStartSlot({requests:0,input:1_700_001,output:0,unknownUsage:0}),false);
 assert.equal(canStartSlot({requests:0,input:0,output:30_001,unknownUsage:0}),false);
 assert.deepEqual(warnings(25,65,610000),['requests','tools','elapsedMs']);
});

test('all 12 native HTTP/Pi entries preserve A/B separation, both loading paths and evidence',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r4-smoke-')),directory=join(parent,'batch'),original=globalThis.fetch;
 const counts=new Map<string,number>();let calls=0;
 const transport:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://api.deepseek.com')return loopbackOnly(original)(input,init);
  const payload=JSON.parse(String(init?.body)) as Payload;calls++;
  const row=read<Array<{id:string;caseId:string;group:string;loading:string;status:string}>>(join(directory,'runs.json')).find(r=>r.status==='started')!;
  const count=(counts.get(row.id)??0)+1;counts.set(row.id,count);
  const system=payload.messages!.filter(m=>m.role==='system').map(m=>m.content).join('\n');
  assert.equal(system.includes('Skill 使用约定：'),row.group==='B');
  if(count===1){
   const resources=read<{selection:{id:string}|null}>(join(directory,row.id,'resources.json'));
   assert.equal(resources.selection!==null,row.loading==='explicit');
   assert.equal(JSON.stringify(payload.messages).includes('所选 Skill 正文已经加载'),row.loading==='explicit');
  }
  if(row.caseId==='D11'&&count===1)return fakeResponse(payload.model!,{name:'ask_user',arguments:{questions:[{id:'target',prompt:'选择哪一个集合点？'}]}});
  if(['D02','D05'].includes(row.caseId)&&count===1)return fakeResponse(payload.model!,{name:'skill_read',arguments:{id:'map-annotations'}});
  if(row.caseId==='D05'&&count===2)return fakeResponse(payload.model!,{name:'skill_read',arguments:{id:'spatial-analysis'}});
  return fakeResponse(payload.model!);
 };
 const result=await runLive({directory,env:offlineEnvironment(),transport,port:4546});
 assert.equal(result.stop,undefined);assert.equal(result.rows.length,12);assert.ok(result.rows.every(r=>r.status==='recorded'));
 assert.equal(calls,22);assert.equal(result.total.requests,22);
 for(const entry of schedule){
  assert.ok(existsSync(join(directory,entry.id,'native-sessions')));
  const review=read<{final:SessionSnapshot;fixture:Prepared['fixture'];after:Prepared['fixture']['before'];interactions:unknown[]}>(join(directory,entry.id,'review.json'));
  if(entry.caseId==='D11')assert.equal(review.interactions.length,1);
  if(entry.caseId==='D05')assert.deepEqual(review.final.messages.filter(m=>m.toolName==='skill.read').length,2);
  if(entry.caseId==='D02'){
   const p=read<Prepared>(join(directory,entry.id,'fixture.json'));
   const after=structuredClone(review.after);after.version!.document.layers[0].name='unexpected mutation';
   assert.equal(criticalEffect(p,review.final,after,false),'unauthorized_draft_change');
  }
 }
 const resumed=await runLive({directory,env:offlineEnvironment(),transport,port:4546,resume:true});
 assert.equal(resumed.total.requests,22);assert.equal(calls,22);
});
test('two-turn D16 injects after actual draft read; native recovery saves original preview',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'r3-live-conflict-')),directory=join(parent,'batch'),original=globalThis.fetch;
 const entry=schedule.find(e=>e.caseId==='D16'&&e.group==='B'&&e.loading==='native')!;let calls=0,ref='',scriptError:unknown;
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
 const result=await runLive({directory,entries:[entry],env:offlineEnvironment(),transport,port:4547});
 assert.equal(scriptError,undefined);assert.equal(result.stop,undefined);assert.equal(calls,7);assert.equal(result.rows[0].status,'recorded');
 const review=read<{conflictInjected:boolean;after:Prepared['fixture']['before'];final:SessionSnapshot}>(join(directory,entry.id,'review.json'));
 assert.equal(review.conflictInjected,true);const features=review.after.version!.document.layers.flatMap(l=>l.features);
 assert.equal(features.find(f=>f.objectId==='origin')?.note,'外部已核实，请保留');assert.equal(features.find(f=>f.objectId==='saved-range')?.name,'临时范围');
 assert.deepEqual(features.find(f=>f.objectId==='saved-range')?.geometry,review.final.messages.find(m=>m.spatialResult?.operation==='buffer')?.spatialResult?.geometry);
});