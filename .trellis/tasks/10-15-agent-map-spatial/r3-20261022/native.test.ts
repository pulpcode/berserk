/** Actual HTTP/Pi loop with synthetic provider SSE. All non-loopback network is intercepted. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {WorkspaceResources,InteractionResponse} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {mapTrialRequest,type startMapTrial} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import {cases,groups,loadings,prepareCase,introduceConflict} from './cases.js';
import {buildRuntime,hashes,loopbackOnly,offlineEnvironment,selectionFor} from './runtime.js';
import {auditPayload,type Payload} from './audit.js';
import {request,fakeResponse} from './http-probe.js';

test('six actual native loading paths keep catalog, expose intended bodies and preserve data',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'r3-native-')),original=globalThis.fetch;
 let trial:Awaited<ReturnType<typeof startMapTrial>>|undefined,calls=0,target='';
 let payloads:Payload[]=[];
 globalThis.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.origin!=='https://api.deepseek.com')return loopbackOnly(original)(input,init);
  const payload=JSON.parse(String(init?.body)) as Payload;payloads.push(payload);calls++;
  assert.equal(payload.model,'deepseek-v4-pro');assert.equal(payload.max_tokens,4096);assert.equal(payload.thinking?.type,'disabled');
  return fakeResponse(payload.model!,calls===1?{name:'skill_read',arguments:{id:target}}:undefined);
 };
 try{
  for(const group of groups){
   const runtime=await buildRuntime(dir,group);trial=await runtime.start(4518,offlineEnvironment(),false,{background:'neutral'});
   for(const loading of loadings)for(const spec of [cases[0],cases[1]]){
    calls=0;payloads=[];const p=await prepareCase(trial.manifest,spec);
    target=loading==='native'?spec.targetSkill:spec.targetSkill==='spatial-analysis'?'map-annotations':'spatial-analysis';
    const catalog=await mapTrialRequest<WorkspaceResources>(trial.manifest,`/api/workspaces/${p.fixture.workspaceId}/resources`,'planning');
    const selection=selectionFor(spec,loading,catalog);
    const result=await request(trial.manifest,p.fixture.sessionId,{text:spec.prompts[0],...(selection?{skill:selection}:{})});
    assert.equal(result.snapshot.lastResult?.status,'succeeded');assert.equal(calls,2);
    const first=auditPayload(payloads[0],runtime.skills,1,0),second=auditPayload(payloads[1],runtime.skills,2,0);
    assert.equal(first.skills[spec.targetSkill].bodyPresent,loading==='explicit');
    assert.ok(first.skills[spec.targetSkill].catalogPresent);assert.equal(second.skills[target].bodyPresent,true);
    assert.ok(!JSON.stringify(payloads).includes('nearestByLayer'));assert.ok(!JSON.stringify(payloads).includes('requiredEvidence'));assert.ok(!JSON.stringify(payloads).includes('semanticReview'));
    assert.deepEqual(await mapState(trial.manifest,p.fixture.sessionId),p.fixture.before);
   }
   assert.deepEqual(await hashes(runtime.root),runtime.hashes);await trial.stop();trial=undefined;
  }
 }finally{globalThis.fetch=original;await trial?.stop();}
});

test('real answer, skip, cancel and no reply preserve actual interaction history',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'r3-interaction-')),original=globalThis.fetch;
 let trial:Awaited<ReturnType<typeof startMapTrial>>|undefined,calls=0;
 const question={id:'target',prompt:'选择哪一个集合点？',options:[{id:'a',label:'amb-a'},{id:'b',label:'amb-b'}]};
 const inputs:Payload[]=[];
 globalThis.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://api.deepseek.com')return loopbackOnly(original)(input,init);
  const payload=JSON.parse(String(init?.body)) as Payload;inputs.push(payload);calls++;
  return fakeResponse(payload.model!,calls===1?{name:'ask_user',arguments:{questions:[question]}}:undefined);
 };
 try{
  const runtime=await buildRuntime(dir,'baseline');trial=await runtime.start(4519,offlineEnvironment(),false,{background:'neutral'});
  for(const id of ['D11','D12','D13','D14']){
   const spec=cases.find(c=>c.id===id)!,p=await prepareCase(trial.manifest,spec);calls=0;inputs.length=0;
   const result=await request(trial.manifest,p.fixture.sessionId,{text:spec.prompts[0]},item=>{
    assert.equal(item.kind,'question');assert.ok(item.kind==='question');assert.deepEqual(item.questions,[question]);
    if(spec.reply==='none'||spec.reply==='cancel')return spec.reply;
    const response:InteractionResponse=spec.reply==='skip'?{requestId:item.requestId,kind:'question',action:'skip'}:{requestId:item.requestId,kind:'question',action:'answer',answers:[{questionId:question.id,text:spec.answer!}]};return response;
   });
   assert.equal(result.interactions.length,1);
   const expected=spec.reply==='answer'?'answered':spec.reply==='skip'?'skipped':'cancelled';
   assert.equal(result.snapshot.interactions?.[0].status,expected);
   assert.equal(result.interactions[0].handling,spec.reply==='none'?'unanswered':expected);
   if(spec.reply==='answer'){assert.equal(calls,2);assert.ok(JSON.stringify(inputs[1]).includes(spec.answer!));assert.deepEqual(result.snapshot.interactions?.[0].kind==='question'?result.snapshot.interactions[0].answers:undefined,[{questionId:'target',text:spec.answer!}]);}
   else assert.ok(!result.snapshot.interactions?.some(i=>i.kind==='question'&&i.answers?.length));
   assert.deepEqual(await mapState(trial.manifest,p.fixture.sessionId),p.fixture.before);
  }
  // A new, unregistered question receives no synthetic/default answer.
  const p=await prepareCase(trial.manifest,cases[0]);calls=0;
  const unexpected=await request(trial.manifest,p.fixture.sessionId,{text:'直接完成，不必澄清。'});
  assert.equal(unexpected.interactions[0].handling,'unexpected');assert.equal(unexpected.snapshot.interactions?.[0].status,'cancelled');
 }finally{globalThis.fetch=original;await trial?.stop();}
});

test('API version conflict preserves external edit and permits explicit reread recovery',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'r3-conflict-')),original=globalThis.fetch;globalThis.fetch=loopbackOnly(original);
 let trial:Awaited<ReturnType<typeof startMapTrial>>|undefined;
 try{
  const runtime=await buildRuntime(dir,'baseline');trial=await runtime.start(4520,offlineEnvironment(),false,{background:'neutral'});
  const p=await prepareCase(trial.manifest,cases.find(c=>c.id==='D16')!);
  const external=await introduceConflict(trial.manifest,p.fixture);
  const action={action:'apply',clientActionId:randomUUID(),expectedRevision:external.before.binding.draft!.headRevision,operations:[{op:'update_object',objectId:'origin',changes:{name:'修订基点'}}]};
  await assert.rejects(()=>mapTrialRequest(trial!.manifest,`/api/sessions/${p.fixture.sessionId}/annotation/actions`,'planning','POST',action),/HTTP 409/);
  assert.deepEqual(await mapState(trial.manifest,p.fixture.sessionId),external.after);
  await mapTrialRequest(trial.manifest,`/api/sessions/${p.fixture.sessionId}/annotation/actions`,'planning','POST',{...action,clientActionId:randomUUID(),expectedRevision:external.after.binding.draft!.headRevision});
  const after=await mapState(trial.manifest,p.fixture.sessionId),origin=after.version!.document.layers.flatMap(l=>l.features).find(f=>f.objectId==='origin')!;
  assert.equal(origin.note,'外部已核实，请保留');assert.equal(origin.name,'修订基点');assert.deepEqual(after.publications,p.fixture.before.publications);assert.deepEqual(after.current,p.fixture.before.current);
 }finally{globalThis.fetch=original;await trial?.stop();}
});


test('native buffer fixed-result save survives a real intervening conflict and preserves exact geometry',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'r3-fixed-save-')),original=globalThis.fetch;
 let trial:Awaited<ReturnType<typeof startMapTrial>>|undefined,calls=0,bufferRef='';
 let providerFailure:unknown;
 let p:Awaited<ReturnType<typeof prepareCase>>;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://api.deepseek.com')return loopbackOnly(original)(input,init);
  const payload=JSON.parse(String(init?.body)) as Payload;calls++;
  try {
  const snapshot=await mapTrialRequest<import('../../../../experiments/harness-lab/src/contracts/index.js').SessionSnapshot>(trial!.manifest,`/api/sessions/${p.fixture.sessionId}`,'planning');
  if(calls===1)return fakeResponse(payload.model!,{name:'spatial_analyze',arguments:{operation:'buffer',input:{kind:'annotation',ref:p.fixture.before.version!.ref,objectIds:['origin']},distanceM:500}});
  if(calls===2){const result=snapshot.messages.findLast(m=>m.spatialResult)?.spatialResult;assert.ok(result);bufferRef=result.resultRef;return fakeResponse(payload.model!,{name:'annotation_read',arguments:{mode:'draft'}});}
  if(calls===3){await introduceConflict(trial!.manifest,p.fixture);return fakeResponse(payload.model!,{name:'annotation_from_analysis',arguments:{resultRef:bufferRef,layerId:'derived',objectId:'saved-range',name:'临时范围'}});}
  if(calls===4){const failed=snapshot.messages.findLast(m=>m.toolName==='annotation_from_analysis');assert.equal(failed?.isError,true);assert.ok(failed?.text.includes('CONFLICT'));return fakeResponse(payload.model!,{name:'annotation_read',arguments:{mode:'draft'}});}
  if(calls===5)return fakeResponse(payload.model!,{name:'annotation_from_analysis',arguments:{resultRef:bufferRef,layerId:'derived',objectId:'saved-range',name:'临时范围'}});
  return fakeResponse(payload.model!);
  } catch(error) {providerFailure??=error;throw error;}
 };
 try{
  const runtime=await buildRuntime(dir,'baseline');trial=await runtime.start(4521,offlineEnvironment(),false,{background:'neutral'});
  p=await prepareCase(trial.manifest,cases.find(c=>c.id==='D16')!);
  const result=await request(trial.manifest,p.fixture.sessionId,{text:'生成基点周边500米范围，保存到派生图层，命名临时范围；保留并发的其他修改，不发布、不采用。'});
  // Pi may retry transport exceptions; a failed deterministic script must still fail this test.
  assert.equal(providerFailure,undefined,'Fake-provider script failed; inspect its original error');
  assert.equal(result.snapshot.lastResult?.status,'succeeded');assert.equal(calls,6);
  const buffer=result.snapshot.messages.find(m=>m.spatialResult?.operation==='buffer')!.spatialResult!;
  const after=await mapState(trial.manifest,p.fixture.sessionId),saved=after.version!.document.layers.find(l=>l.layerId==='derived')!.features;
  assert.equal(saved.length,1);assert.deepEqual(saved[0].geometry,buffer.geometry);assert.equal(saved[0].name,'临时范围');
  assert.equal(after.version!.document.layers.flatMap(l=>l.features).find(f=>f.objectId==='origin')!.note,'外部已核实，请保留');
  assert.deepEqual(after.publications,p.fixture.before.publications);assert.deepEqual(after.current,p.fixture.before.current);
  const writes=result.snapshot.messages.filter(m=>m.toolName==='annotation_from_analysis');assert.equal(writes.length,2);assert.equal(writes[0].isError,true);assert.equal(writes[1].isError,false);
  // A real recoverable CAS rejection is retained; it is not a false block of a valid input.
 }finally{globalThis.fetch=original;await trial?.stop();}
});
