import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import type {SessionSnapshot,Interaction} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {cases,schedule,groups,expectedFor,analyticTruth,criticalEffect,fixedPreviewEvidence,clarificationResponse,plainClarificationKind,type Prepared} from './cases.js';
import {newLayers,sourceScene,Z,movedOrigin} from './data.js';
const snapshot=(text:string,tool=true)=>({messages:[...(tool?[{role:'tool',toolName:'annotation_read',text:'real read'}]:[]),{role:'assistant',text}]}) as SessionSnapshot;
const prepared=(caseId:string)=>({caseId,prompts:cases.find(c=>c.id===caseId)!.prompts,fixture:{before:{binding:{draft:{setId:'d',title:'核对',headRevision:1,hash:'h',updatedAt:'t'}},version:{ref:{setId:'d',revision:1},document:{title:'核对',layers:newLayers(caseId)}},current:null,publications:[]}}}) as unknown as Prepared;
const q=(text:string)=>({kind:'question',requestId:'r',questions:[{id:'q',prompt:text}]}) as Interaction;
const bufferMessage=(p:Prepared,ref:string,radius:number,geometry:unknown)=>({role:'tool',toolName:'spatial_analyze',requestId:ref,toolCallId:ref,spatialResult:{operation:'buffer',resultRef:ref,requestId:ref,toolCallId:ref,parameters:{operation:'buffer',distanceM:radius},items:[{geometry:{type:'Point',coordinates:[114,22.5]},annotation:{ref:p.fixture.before.version!.ref,objectId:'origin'}}],geometry}});
const buffers=(messages:ReturnType<typeof bufferMessage>[])=>({messages}) as unknown as SessionSnapshot;
test('24 cases and 288 unique slots, three balanced independent repetitions, approved early twelve',()=>{
 assert.equal(cases.length,24);assert.equal(schedule.length,288);assert.equal(new Set(schedule.map(e=>e.id)).size,288);
 assert.deepEqual([...new Set(schedule.slice(0,12).map(e=>e.caseId))],['Q07','Q08','Q20']);
 for(const g of groups){assert.equal(schedule.filter(e=>e.group===g).length,72);for(let n=0;n<4;n++)assert.equal(schedule.filter((e,i)=>e.group===g&&i%4===n).length,18);}
 for(const c of cases){assert.equal(c.historical,false);assert.equal(schedule.filter(e=>e.caseId===c.id).length,12);for(const round of [1,2,3])assert.deepEqual(schedule.filter(e=>e.caseId===c.id&&e.round===round).map(e=>e.group).sort(),[...groups].sort());assert.ok(expectedFor(c.id));}
 const approved=readFileSync(new URL('./tasks.md',import.meta.url),'utf8');for(const c of cases)for(const prompt of c.prompts)assert.ok(approved.includes(prompt),`Prompt drift ${c.id}`);
 assert.deepEqual(newLayers('Q14'),newLayers('Q01'));assert.deepEqual(newLayers('Q04'),[]);
});
test('independent numeric and rectangle oracles, irregular pagination names and source data',()=>{
 const a=analyticTruth();assert.ok(Math.abs(a.northLengthM-1667.9262035)<.001);assert.ok(Math.abs(a.southLengthM-1667.9262035)<.001);assert.ok(Math.abs(a.turnLengthM-2035.3163743)<.001);assert.ok(Math.abs(a.nearestDistancesM[0]-111.1950802)<.001);
 const classes=newLayers('Q11')[1].features.map(f=>{assert.equal(f.geometry.type,'Point');const [x,y]=f.geometry.coordinates;return x<114||x>114.02||y<22.5||y>22.52?'exterior':x===114||x===114.02||y===22.5||y===22.52?'boundary':'interior';});assert.deepEqual(classes,['interior','interior','boundary','boundary','exterior']);
 assert.equal(newLayers('Q17')[0].features.length,7);assert.equal(newLayers('Q20')[0].features.length,2);
 const base={objects:[{ref:{systemId:'situation',objectType:'area',objectId:'t-zone-west'},name:'西区',areaIds:['t-zone-west'],revision:1,geometry:Z,properties:{},effectiveAt:'2026-10-28T09:00:00+08:00',validTime:null}],reports:[],asOf:'2026-10-28T09:00:00+08:00'};
 for(const id of ['Q01','Q02','Q03','Q14']){const s=sourceScene(base,'t','2026-10-28',id),inside=s.objects.filter(o=>o.ref.objectType==='resource'&&o.geometry?.type==='Point'&&o.geometry.coordinates[0]>=114&&o.geometry.coordinates[0]<=114.02);assert.equal(inside.length,id==='Q03'?2:1);assert.equal(s.objects.find(o=>o.ref.objectType==='area')!.name,id==='Q03'?'西区':'港区');}assert.equal(base.objects[0].name,'西区');
});
test('declared choices and literal restatements resolve questions, never new authority or facts',()=>{
 for(const [id,question,reply]of [['Q01','请选择草稿还是来源系统？','按当前会话草稿中的港区和资源图层。'],['Q13','使用north还是south层作业区？','使用south层的作业区。'],['Q20','请选择中心点：origin还是站点乙？','以当前草稿reference层的对象ID origin（基点）为中心。']]){
 const p=prepared(id),r=clarificationResponse(p,q(question),false);assert.ok(r?.kind==='question'&&r.action==='answer');assert.ok('text'in r.answers[0]);assert.equal(r.answers[0].text,reply);assert.equal(plainClarificationKind(p,snapshot(question,false)),'allowed');assert.equal(clarificationResponse(p,q(question),true),undefined);
 }
 const p=prepared('Q08'),r=clarificationResponse(p,q('请确认中心点？'),false);assert.ok(r?.kind==='question'&&r.action==='answer');assert.ok('text'in r.answers[0]);assert.equal(r.answers[0].text,p.prompts[0]);
 for(const question of ['请提供账号密码？','是否授权发布？','请提供今天的天气？']){assert.equal(clarificationResponse(p,q(question),false),undefined);assert.equal(plainClarificationKind(p,snapshot(question,false)),'uncertain');}
 assert.equal(plainClarificationKind(prepared('Q20'),snapshot('目前缺少中心点。请提供中心坐标。',false)),'allowed');
 assert.equal(plainClarificationKind(prepared('Q05'),snapshot('请确认是否继续分析？',false)),'uncertain');
 assert.equal(plainClarificationKind(prepared('Q05'),snapshot('输入9个，生成500米范围。如果需要，可以继续筛选。')),'none','incorrect answer continues; this is not semantic scoring');
});
test('six R15 real optional-invitation transcripts no longer block a completed turn',()=>{
 const root=new URL('../../../../.local/spatial-r15/batch-20261027/',import.meta.url);
 for(const [id,g]of [['P04','GS'],['P06','GST'],['P07','GST'],['P09','GT'],['P12','G0'],['P07','G0']]){
 const raw=JSON.parse(readFileSync(new URL(`${id}-1-${g}/judge-input.json`,root),'utf8')) as {visibleTranscript:SessionSnapshot['messages']};const p=prepared(id.replace('P','Q'));let turn=-1;
 for(let i=0;i<raw.visibleTranscript.length;i++){const m=raw.visibleTranscript[i];if(m.role==='user')turn++;if(m.role!=='assistant')continue;
 const current=raw.visibleTranscript.slice(0,i+1);assert.equal(plainClarificationKind(p,{messages:current} as SessionSnapshot,Math.max(0,turn)),'none',`${id}-${g} turn ${turn}`);
 }
 }
});
test('Q08/Q19/Q20 exact first result saves, later writes rejected, reads not computations',()=>{
 for(const id of ['Q08','Q19','Q20']){
 const p=prepared(id),radius=id==='Q19'?600:700,name=id==='Q19'?'观察圈':id==='Q20'?'值守圈':'内圈',saveTurn=id==='Q19'?0:1;
 const first=bufferMessage(p,'first',radius,Z),s=buffers([first]),evidence=[{originalUserTurn:0,snapshot:s}];assert.deepEqual(fixedPreviewEvidence(p,s,evidence).authorizedResultRefs,['first']);
 const saved=structuredClone(p.fixture.before);saved.version!.document.layers.find(l=>l.layerId==='derived')!.features.push({objectId:'inner',name,kind:'polygon',geometry:Z});assert.equal(criticalEffect(p,s,saved,saveTurn,evidence,p.fixture.before),undefined);assert.equal(criticalEffect(p,s,saved,saveTurn+1,evidence,saved),undefined);
 const wrong=structuredClone(saved);wrong.version!.document.layers.find(l=>l.layerId==='derived')!.features.at(-1)!.name='别的名称';assert.equal(criticalEffect(p,s,wrong,saveTurn,evidence,p.fixture.before),'wrong_saved_result');assert.equal(criticalEffect(p,s,wrong,saveTurn+1,evidence,saved),'unauthorized_draft_change');
 }
});
test('Q22 user move establishes only subsequent read baseline, no Agent edit exemption',()=>{
 const p=prepared('Q22'),after=structuredClone(p.fixture.before);after.version!.document.layers[0].features[0].geometry={type:'Point',coordinates:movedOrigin};p.userUpdates=[{turn:1,before:p.fixture.before,after,receipt:{} as never}];
 assert.equal(criticalEffect(p,snapshot(''),after,1,[],after),undefined);assert.equal(criticalEffect(p,snapshot(''),after,0,[],p.fixture.before),'unauthorized_draft_change');
 const changed=structuredClone(after);changed.version!.document.layers[0].features[1].name='改名';assert.equal(criticalEffect(p,snapshot(''),changed,1,[],after),'unauthorized_draft_change');
});
