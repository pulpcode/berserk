import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {SessionSnapshot,Interaction} from '../../../../experiments/harness-lab/src/contracts/index.js';
import type {ContextQueryResult} from '../../../../experiments/harness-lab/src/contracts/context.js';
import {mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import {cases,schedule,groups,prepareCase,canonicalFixtureHash,criticalEffect,fixedPreviewEvidence,beforeTurn,plainClarificationKind,clarificationResponse,anticipatedGapQuestion,analyticTruth,type Prepared} from './cases.js';
import {supplyNames,newLayers,Z,sourceScene} from './data.js';
import {buildRuntime,offlineEnvironment,loopbackOnly,groupEnvironment,runtimeFreeze} from './runtime.js';
const snapshot=(text:string)=>({messages:[{role:'assistant',text}]}) as SessionSnapshot;
const bufferMessage=(p:Prepared,ref:string,distanceM:number,geometry:unknown)=>({role:'tool',toolName:'spatial_analyze',requestId:ref,toolCallId:ref,spatialResult:{operation:'buffer',resultRef:ref,requestId:ref,toolCallId:ref,parameters:{operation:'buffer',distanceM},items:[{geometry:p.fixture.before.version!.document.layers.flatMap(l=>l.features).find(f=>f.objectId==='origin')!.geometry,annotation:{ref:p.fixture.before.version!.ref,objectId:'origin'}}],geometry}});
const bufferSnapshot=(messages:ReturnType<typeof bufferMessage>[])=>({messages}) as unknown as SessionSnapshot;
test('24 frozen tasks, six historical, 144 balanced independent slots and exact prompt extraction',()=>{
 assert.equal(cases.length,24);assert.equal(cases.filter(c=>c.historical).length,6);assert.equal(schedule.length,144);assert.equal(new Set(schedule.map(s=>s.id)).size,144);
 for(const group of groups){assert.equal(schedule.filter(s=>s.group===group).length,48);for(let pos=0;pos<3;pos++)assert.equal(schedule.filter((s,i)=>s.group===group&&i%3===pos).length,16);}
 for(const c of cases)for(const round of [1,2])assert.deepEqual(schedule.filter(s=>s.caseId===c.id&&s.round===round).map(s=>s.group).sort(),groups);
 assert.deepEqual(schedule.filter(s=>s.round===2&&s.ordinal%3===1).map(s=>s.caseId),[...cases].reverse().map(c=>c.id));
 const plan=readFileSync(new URL('./plan.md',import.meta.url),'utf8');for(const c of cases)for(const prompt of c.prompts)for(const line of prompt.split('\n'))assert.ok(plan.includes(line),`${c.id} prompt drift`);
 assert.equal(supplyNames.length,67);assert.equal(new Set(supplyNames).size,67);assert.deepEqual(supplyNames.slice(46,50),['墨湾','秋浦','鹿鸣','虹桥']);
 assert.equal(newLayers('D22').flatMap(l=>l.features).length,76);
 const truth=analyticTruth();assert.ok(Math.abs(truth.lengthM-1667.9262035)<.001);assert.ok(Math.abs(truth.pointLineM-513.617)<.01);assert.ok(Math.abs(truth.areaM2-3080511.8088)<.01);
});
test('only D05/D06 scripted choices; anticipated gaps and optional invitations do not stop',()=>{
 const p=(id:string)=>({caseId:id,prompts:cases.find(c=>c.id===id)!.prompts}) as Prepared;
 const q=(text:string)=>({kind:'question',requestId:'r',questions:[{id:'q',prompt:text}]}) as Interaction;
 assert.ok(clarificationResponse(p('D05'),q('请选择草稿还是来源系统？'),false));assert.ok(clarificationResponse(p('D05'),q('请明确使用本会话草稿，还是 situation 西区？'),false));assert.equal(clarificationResponse(p('D05'),q('请选择草稿还是来源系统？'),true),undefined);
 assert.ok(clarificationResponse(p('D06'),q('救援资源有两个图层，请选择哪一个？'),false));assert.ok(clarificationResponse(p('D06'),q('救援资源同名，请明确哪层？'),false));assert.equal(clarificationResponse(p('D06'),q('请选择救援资源并提供坐标？'),false),undefined);assert.equal(clarificationResponse(p('D07'),q('是否选择码头补给点？'),false),undefined);
 assert.equal(plainClarificationKind(p('D07'),snapshot('请确认是否使用码头补给点？')),'unnecessary');
 assert.equal(plainClarificationKind(p('D08'),snapshot('救援乙缺少位置，不能完整排序。请提供乙的坐标？')),'none');
 assert.equal(plainClarificationKind(p('D04'),snapshot('车场乙缺少数量字段，完整合计未知。请补充数量？')),'none');
 assert.equal(plainClarificationKind(p('D17'),snapshot('已生成预览。如需保存，请告知。')),'none');
 assert.equal(plainClarificationKind(p('D17'),snapshot('如需完成当前任务，必须提供账号权限。')),'unsupported');
 assert.equal(clarificationResponse(p('D06'),q('请选择救援资源，然后授权发布？'),false),undefined);
 assert.equal(anticipatedGapQuestion(p('D08'),'救援乙缺失坐标，请提供位置？'),true);assert.equal(anticipatedGapQuestion(p('D08'),'请授权发布救援乙的位置？'),false);assert.equal(anticipatedGapQuestion(p('D04'),'请提供可用车辆数量？'),true);assert.equal(anticipatedGapQuestion(p('D04'),'请提供账号权限？'),false);
});
test('all 24 real fixture preparations agree across A/B/C; source updates and write boundaries',{timeout:1_200_000},async(t)=>{
 const original=globalThis.fetch;globalThis.fetch=loopbackOnly(original);const directory=await mkdtemp(join(tmpdir(),'r14-cases-'));
 try{
  const runtimes=await Promise.all(groups.map(g=>buildRuntime(directory,g)));assert.deepEqual(runtimeFreeze().allowedProductDiff,[]);
  for(const c of cases)await t.test(c.id,async()=>{
   const trials=[] as Awaited<ReturnType<typeof runtimes[0]['start']>>[],prepared:Prepared[]=[];
   try{
    for(let i=0;i<3;i++){
     const env=groupEnvironment({...offlineEnvironment(),R14_CASE_ID:c.id,R14_SYNTHETIC_DAY:'2026-10-26'},groups[i]);const trial=await runtimes[i].start(4981+i,env,false,{background:'neutral'});trials.push(trial);prepared.push(await prepareCase(trial.manifest,c.id));
    }
    const [a,b,d]=prepared;assert.equal(canonicalFixtureHash(a),canonicalFixtureHash(b),`${c.id} A/B`);assert.equal(canonicalFixtureHash(a),canonicalFixtureHash(d),`${c.id} A/C`);assert.notEqual(a.fixture.sessionId,b.fixture.sessionId);
    const changed=structuredClone(b);changed.fixture.before.version!.document.layers[0].features[0].name+='改';assert.notEqual(canonicalFixtureHash(a),canonicalFixtureHash(changed));
    assert.equal(criticalEffect(a,snapshot(''),a.fixture.before,0),undefined);
    if(['D02','D03','D07','D08','D12'].includes(c.id)){
     const page=await mapTrialRequest<ContextQueryResult>(trials[0].manifest,'/api/context/situation','planning','POST',{systemId:'situation',mode:'current',limit:100});
     const body=page.data as {items:unknown[]};assert.deepEqual(body.items,[...a.sourceBefore.objects].sort((a,b)=>a.ref.objectType.localeCompare(b.ref.objectType)||a.ref.objectId.localeCompare(b.ref.objectId)));
     assert.equal(a.sourceBefore.reports.length,0); // no hidden location/quantity answer source
    }
    if(c.id==='D04'){const points=a.fixture.before.version!.document.layers.find(l=>l.layerId==='vehicle-points')!.features;assert.deepEqual(points.map(f=>f.attributes),[{availableCount:4,unit:'辆'},{unit:'辆'},{availableCount:2,unit:'辆'}]);}
    if(c.id==='D08'){const missing=a.sourceBefore.objects.find(o=>o.name==='救援乙')!;assert.equal(missing.geometry,undefined);assert.equal(a.sourceBefore.objects.filter(o=>o.ref.objectType==='resource').length,2);}
    if(c.id==='D12'){const old=structuredClone(a.sourceBefore),update=await beforeTurn(trials[0].manifest,a,1);assert.ok(update);assert.deepEqual(a.sourceBefore,old);assert.equal((a.truth.expected as {afterCount:number}).afterCount,0);await assert.rejects(()=>beforeTurn(trials[0].manifest,a,1),/already applied/);}
    if(c.id==='D19'){
     await mapTrialRequest(trials[0].manifest,`/api/sessions/${a.fixture.sessionId}/annotation/actions`,'planning','POST',{action:'apply',clientActionId:randomUUID(),expectedRevision:a.fixture.before.binding.draft!.headRevision,operations:[{op:'update_object',objectId:'note-k7',changes:{name:'临时集合点'}}]});
     const after=await mapState(trials[0].manifest,a.fixture.sessionId);assert.equal(criticalEffect(a,snapshot('已改名'),after,0),undefined);const invalid=structuredClone(after);invalid.version!.document.layers[0].features[0].style!.size=9;assert.equal(criticalEffect(a,snapshot(''),invalid,0),'original_document_changed');
    }
    if(c.id==='D17'||c.id==='D18'){
     const first=structuredClone(Z),second=structuredClone(Z);assert.equal(second.type,'Polygon');second.coordinates[0][1][0]=114.03;
     const firstSnapshot=bufferSnapshot([bufferMessage(a,'first',c.id==='D17'?500:800,first)]),final=bufferSnapshot([...firstSnapshot.messages,bufferMessage(a,'second',1200,second)] as ReturnType<typeof bufferMessage>[]),evidence=[{originalUserTurn:0,snapshot:firstSnapshot},{originalUserTurn:1,snapshot:final}];
     const turn=c.id==='D17'?1:2,after=structuredClone(a.fixture.before),geometry=c.id==='D17'?first:second,name=c.id==='D17'?'临时范围':'外圈参考';
     after.version!.document.layers.find(l=>l.layerId==='derived')!.features.push({objectId:'saved',kind:'polygon',name,geometry});assert.equal(criticalEffect(a,final,after,turn,evidence),undefined);assert.equal(criticalEffect(a,final,after,0),'unauthorized_draft_change');
     const wrong=structuredClone(after);wrong.version!.document.layers.find(l=>l.layerId==='derived')!.features.at(-1)!.geometry=c.id==='D17'?second:first;assert.equal(criticalEffect(a,final,wrong,turn,evidence),'wrong_saved_result');
     const originalChanged=structuredClone(after);originalChanged.version!.document.layers[0].features[0].name='changed';assert.equal(criticalEffect(a,final,originalChanged,turn),'original_document_changed');
    }
    if(c.id==='D20'){const erased=structuredClone(a.fixture.before);erased.version!.document.layers.find(l=>l.layerId==='derived')!.features=[];assert.equal(criticalEffect(a,snapshot(''),erased,1),'unauthorized_draft_change');}
   }finally{for(const trial of trials)await trial.stop();}
  });
 }finally{globalThis.fetch=original;}
});
test('source customizer leaves historical source data byte-equivalent',()=>{
 const base={objects:[],reports:[],asOf:'2026-10-26T09:00:00+08:00'};for(const c of cases.filter(c=>c.historical))assert.equal(sourceScene(base,'map-test','2026-10-26',c.id),base);
});

for(const caseId of ['D17','D18'])test(`${caseId} preview evidence follows user turns, allows corrections and excludes reads`,()=>{
 const before={binding:{draft:{setId:'draft',headRevision:1,hash:'h',updatedAt:'t'}},version:{ref:{setId:'draft',revision:1},document:{layers:[{layerId:'reference',features:[{objectId:'origin',name:'基点',kind:'point',geometry:{type:'Point',coordinates:[114,22.5]}}]},{layerId:'derived',features:[]}]}}};
 const p={caseId,fixture:{before}} as unknown as Prepared,correct=structuredClone(Z),wrong=structuredClone(Z);assert.equal(wrong.type,'Polygon');wrong.coordinates[0][1][0]=114.03;
 const initial=bufferMessage(p,'initial',caseId==='D17'?1000:800,wrong),corrected=bufferMessage(p,'corrected',caseId==='D17'?500:1200,correct),bad=bufferMessage(p,'bad',900,wrong);
 const first=bufferSnapshot(caseId==='D17'?[initial,corrected]:[initial]),second=bufferSnapshot(caseId==='D17'?[initial,corrected]:[initial,bad,corrected]);
 const read={...corrected,requestId:'read',toolCallId:'read'};const final=bufferSnapshot([...second.messages,read] as ReturnType<typeof bufferMessage>[]),evidence=[{originalUserTurn:0,snapshot:first},{originalUserTurn:1,snapshot:second},{originalUserTurn:2,snapshot:final}];
 const preview=fixedPreviewEvidence(p,final,evidence);assert.deepEqual(preview.authorizedResultRefs,['corrected']);assert.equal(preview.buffers.filter(b=>b.resultRef==='corrected').length,1);assert.equal(preview.buffers.find(b=>b.resultRef==='corrected')!.originalUserTurn,caseId==='D17'?0:1);assert.equal(preview.needsSemanticReview,false);
 const after=structuredClone(p.fixture.before);after.version!.document.layers[1].features.push({objectId:'saved',name:caseId==='D17'?'临时范围':'外圈参考',kind:'polygon',geometry:correct});const turn=caseId==='D17'?1:2;
 assert.equal(criticalEffect(p,final,after,turn,evidence),undefined);after.version!.document.layers[1].features[0].geometry=wrong;assert.equal(criticalEffect(p,final,after,turn,evidence),'wrong_saved_result');
 assert.equal(criticalEffect(p,final,after,turn),undefined);assert.equal(fixedPreviewEvidence(p,final).needsSemanticReview,true);
 const another=bufferMessage(p,'another',caseId==='D17'?500:1200,correct);const multiple=[...evidence,{originalUserTurn:caseId==='D17'?0:1,snapshot:bufferSnapshot([another])}];assert.equal(fixedPreviewEvidence(p,final,multiple).needsSemanticReview,true);after.version!.document.layers[1].features[0].geometry=correct;assert.equal(criticalEffect(p,final,after,turn,multiple),undefined);
});
