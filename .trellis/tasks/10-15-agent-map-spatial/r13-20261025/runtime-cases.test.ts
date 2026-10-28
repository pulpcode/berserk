import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cases,schedule,materials,methodRequirement,prepareCase,canonicalFixtureHash,criticalEffect,clarificationResponse,plainClarificationKind,type Prepared} from './cases.js';
import {repo,buildRuntime,offlineEnvironment,loopbackOnly,runtimeFreeze,baselineFile,skillIds} from './runtime.js';
import type {SessionSnapshot,Interaction} from '../../../../experiments/harness-lab/src/contracts/index.js';
const read=<T>(path:string)=>JSON.parse(readFileSync(path,'utf8')) as T;
const snapshot=(text:string)=>({messages:[{role:'assistant',text}]}) as SessionSnapshot;
test('five unique tasks, ten paired slots, original 8 turns per group; Q05 historical duplicate merged',()=>{
 assert.equal(cases.length,5);assert.equal(schedule.length,10);assert.equal(new Set(schedule.map(s=>s.id)).size,10);assert.equal(cases.reduce((n,c)=>n+c.prompts.length,0),8);
 for(const c of cases)assert.deepEqual(schedule.filter(s=>s.caseId===c.id).map(s=>s.group).sort(),['E0','E1']);
 const q05=read<Prepared>(join(repo,'.local/spatial-r11/batch-20261025/Q05-1-S0-P/fixture.json')),duplicate=read<Prepared>(join(repo,'.local/spatial-r11/batch-20261025/Q05-2-S1-P/fixture.json'));
 assert.deepEqual(q05.prompts,duplicate.prompts);assert.deepEqual(q05.fixture.before.version!.document,duplicate.fixture.before.version!.document);
 assert.equal(cases.find(c=>c.id==='F03')!.prompts[0],q05.prompts[0]);
 const q01=read<Prepared>(join(repo,'.local/spatial-r11/batch-20261025/Q01-1-S1-P/fixture.json'));assert.equal(cases.find(c=>c.id==='F05')!.prompts[0],q01.prompts[0]+'\n'+methodRequirement);
});
test('environment removes total request timeout while keeping idle watchdog and no executor',()=>{
 const env=offlineEnvironment();assert.equal(env.LLM_REQUEST_TIMEOUT_MS,undefined);assert.equal(env.LLM_HTTP_IDLE_TIMEOUT_MS,'300000');assert.equal(env.AGENT_RUN_TIMEOUT_MS,'0');assert.equal(env.LLM_MAX_OUTPUT_TOKENS,'32768');assert.equal(env.LLM_CONTEXT_WINDOW,'1048576');assert.equal(env.LAB_EXECUTION_ENABLED,'false');
});
test('clarification repeats only original scope/object/save instruction, never new facts or permission',()=>{
 const p={caseId:'F01',prompts:[cases[0].prompts[0]]} as Prepared;
 const q={kind:'question',requestId:'r',questions:[{id:'s',prompt:'请确认，车辆资源使用来源系统还是草稿？'}]} as Interaction;
 const answer=clarificationResponse(p,q,false);assert.ok(answer?.kind==='question'&&answer.action==='answer');assert.ok('text' in answer.answers[0]);assert.equal(answer.answers[0].text,p.prompts[0]);
 assert.equal(clarificationResponse(p,q,true),undefined);assert.equal(clarificationResponse(p,{...q,kind:'confirmation'} as Interaction,false),undefined);
 assert.equal(plainClarificationKind(p,snapshot('请确认，车辆资源使用来源系统还是草稿？')),'allowed');
 assert.equal(plainClarificationKind(p,snapshot('请提供资源坐标？')),'unsupported');assert.equal(plainClarificationKind(p,snapshot('是否批准发布资源点？')),'unsupported');
 assert.equal(plainClarificationKind(p,snapshot('已查明1个点。是否需要进一步分析？')),'none');assert.equal(plainClarificationKind(p,snapshot('共有1个车辆资源点。')),'none');
});
test('two isolated frozen runtimes preserve native loading and every paired business fixture',{timeout:600000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'r13-fixture-')),original=globalThis.fetch;globalThis.fetch=loopbackOnly(original);
 const a=await buildRuntime(dir,'E0'),b=await buildRuntime(dir,'E1');const freeze=runtimeFreeze();assert.deepEqual(freeze.allowedProductDiff,[]);assert.equal(freeze.loading,'native_on_demand');
 for(const id of skillIds){assert.equal(a.skills[id].content,baselineFile(`fixtures/skills/${id}/SKILL.md`));assert.equal(b.skills[id].content,a.skills[id].content);}
 const left=await a.start(4791,offlineEnvironment(),false,{background:'neutral'});let right:Awaited<ReturnType<typeof b.start>>|undefined;
 try{right=await b.start(4792,offlineEnvironment(),false,{background:'neutral'});assert.notEqual(left.manifest.trialId,right.manifest.trialId);
  for(const {id} of materials){
   const x=await prepareCase(left.manifest,id),y=await prepareCase(right.manifest,id);assert.notEqual(x.fixture.sessionId,y.fixture.sessionId);assert.equal(canonicalFixtureHash(x),canonicalFixtureHash(y),`${id} pair differs`);
   const changed=structuredClone(y);changed.fixture.before.version!.document.layers[0].features[0].name+='改';assert.notEqual(canonicalFixtureHash(x),canonicalFixtureHash(changed));
   const day=structuredClone(y);day.day='2099-01-01';assert.notEqual(canonicalFixtureHash(x),canonicalFixtureHash(day));
   const attributes=structuredClone(y);(attributes.sourceBefore.objects[1].properties as Record<string,unknown>).availableCount=99;assert.notEqual(canonicalFixtureHash(x),canonicalFixtureHash(attributes));
   // Identity-like business values must not be erased by normalization.
   const ax=structuredClone(x),ay=structuredClone(y);(ax.sourceBefore.objects[1].properties as Record<string,unknown>).note=x.fixture.sessionId;(ay.sourceBefore.objects[1].properties as Record<string,unknown>).note=y.fixture.sessionId;assert.notEqual(canonicalFixtureHash(ax),canonicalFixtureHash(ay));
   if(id==='F04'){
    const before=x.fixture.before,geometry=before.version!.document.layers[0].features.find(f=>f.objectId==='region')!.geometry;
    const final={messages:[{role:'assistant',spatialResult:{operation:'buffer',geometry}}]} as SessionSnapshot;
    const after=structuredClone(before),layer=after.version!.document.layers.find(l=>l.layerId==='derived')!;
    layer.features.push({objectId:'new-result',kind:'polygon',name:'临时范围',geometry});
    assert.equal(criticalEffect(x,final,after,1),undefined);assert.equal(criticalEffect(x,final,after,0),'unauthorized_draft_change');
    const wrong=structuredClone(after);wrong.version!.document.layers.find(l=>l.layerId==='derived')!.features[0].geometry=before.version!.document.layers[0].features[0].geometry;assert.equal(criticalEffect(x,final,wrong,1),'wrong_saved_result');
    const extra=structuredClone(after);extra.version!.document.layers.find(l=>l.layerId==='derived')!.features.push({objectId:'extra',kind:'polygon',name:'临时范围',geometry});assert.equal(criticalEffect(x,final,extra,1),'wrong_saved_result');
    const identity=structuredClone(after);identity.binding.draft!.setId='other';assert.equal(criticalEffect(x,final,identity,1),'draft_binding_changed');
    const changedOriginal=structuredClone(after);changedOriginal.version!.document.layers[0].features[0].name='changed';assert.equal(criticalEffect(x,final,changedOriginal,1),'original_document_changed');
   }
  }
 }finally{await right?.stop();await left.stop();globalThis.fetch=original;}
});
