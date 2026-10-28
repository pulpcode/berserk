import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {SessionSnapshot,Interaction} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {cases,schedule,groups,expectedFor,analyticTruth,criticalEffect,fixedPreviewEvidence,clarificationResponse,plainClarificationKind,type Prepared} from './cases.js';
import {newLayers,sourceScene,Z} from './data.js';
const snapshot=(text:string)=>({messages:[{role:'assistant',text}]}) as SessionSnapshot;
const prepared=(caseId:string)=>({caseId,prompts:cases.find(c=>c.id===caseId)!.prompts,fixture:{before:{binding:{draft:{setId:'d',title:'核对',headRevision:1,hash:'h',updatedAt:'t'}},version:{ref:{setId:'d',revision:1},document:{title:'核对',layers:newLayers(caseId)}},current:null,publications:[]}}}) as unknown as Prepared;
const q=(text:string)=>({kind:'question',requestId:'r',questions:[{id:'q',prompt:text}]}) as Interaction;
const bufferMessage=(p:Prepared,ref:string,radius:number,geometry:unknown)=>({role:'tool',toolName:'spatial_analyze',requestId:ref,toolCallId:ref,spatialResult:{operation:'buffer',resultRef:ref,requestId:ref,toolCallId:ref,parameters:{operation:'buffer',distanceM:radius},items:[{geometry:{type:'Point',coordinates:[114,22.5]},annotation:{ref:p.fixture.before.version!.ref,objectId:'origin'}}],geometry}});
const buffers=(messages:ReturnType<typeof bufferMessage>[])=>({messages}) as unknown as SessionSnapshot;
test('12 cases, 48 unique slots, each group appears at each order three times',()=>{
 assert.equal(cases.length,12);assert.equal(schedule.length,48);assert.equal(new Set(schedule.map(e=>e.id)).size,48);
 for(const g of groups){assert.equal(schedule.filter(e=>e.group===g).length,12);for(let n=0;n<4;n++)assert.equal(schedule.filter((e,i)=>e.group===g&&i%4===n).length,3);}
 for(const c of cases){assert.equal(c.historical,false);assert.deepEqual(schedule.filter(e=>e.caseId===c.id).map(e=>e.group).sort(),[...groups].sort());assert.ok(expectedFor(c.id));}
 assert.deepEqual(newLayers('P01'),newLayers('P02'));assert.deepEqual(newLayers('P05'),newLayers('P06'));assert.deepEqual(newLayers('P04'),[]);
});
test('independent numeric and rectangular point oracles agree with frozen facts',()=>{
 const a=analyticTruth();assert.ok(Math.abs(a.northLengthM-1667.9262035)<.001);assert.ok(Math.abs(a.southLengthM-1667.9262035)<.001);assert.ok(Math.abs(a.newPointDistanceM-1111.9508023)<.001);
 const classes=newLayers('P11')[1].features.map(f=>{assert.equal(f.geometry.type,'Point');const [x,y]=f.geometry.coordinates;return x<114||x>114.02||y<22.5||y>22.52?'exterior':x===114||x===114.02||y===22.5||y===22.52?'boundary':'interior';});
 assert.deepEqual(classes,['interior','interior','boundary','boundary','exterior']);
 const base={objects:[{ref:{systemId:'situation',objectType:'area',objectId:'t-zone-west'},name:'西区',areaIds:['t-zone-west'],revision:1,geometry:Z,properties:{},effectiveAt:'2026-10-27T09:00:00+08:00',validTime:null}],reports:[],asOf:'2026-10-27T09:00:00+08:00'};
 for(const id of ['P01','P02','P03']){const s=sourceScene(base,'t','2026-10-27',id),inside=s.objects.filter(o=>o.ref.objectType==='resource'&&o.geometry?.type==='Point'&&o.geometry.coordinates[0]>=114&&o.geometry.coordinates[0]<=114.02);assert.equal(inside.length,id==='P03'?2:1);assert.equal(s.objects.find(o=>o.ref.objectType==='area')!.name,id==='P03'?'西区':'港区');}assert.equal(base.objects[0].name,'西区');
});
test('P01 source choice maps exactly, ordinary API clarification and optional invitations remain distinct',()=>{
 const p=prepared('P01'),reply=clarificationResponse(p,q('请选择草稿还是来源系统？'),false);assert.ok(reply?.kind==='question'&&reply.action==='answer');assert.ok('text'in reply.answers[0]);assert.equal(reply.answers[0].text,'按当前会话草稿中的港区和资源图层。');
 assert.equal(plainClarificationKind(p,snapshot('请选择草稿还是来源系统？')),'allowed');assert.equal(plainClarificationKind(p,snapshot('可以使用当前草稿，也可以使用来源系统。\n请选择哪套数据？')),'allowed');assert.equal(clarificationResponse(p,q('请选择草稿还是来源系统并提供坐标？'),false),undefined);assert.equal(clarificationResponse(p,q('请选择草稿还是来源系统？'),true),undefined);
 assert.equal(clarificationResponse(prepared('P02'),q('请选择草稿还是来源系统？'),false),undefined);
 assert.equal(plainClarificationKind(prepared('P02'),snapshot('请确认是否使用草稿？')),'unnecessary');
 for(const id of ['P07','P08','P12'])assert.equal(plainClarificationKind(prepared(id),snapshot('已完成。如需进一步分析，请告诉我。')),'none');
 assert.equal(plainClarificationKind(prepared('P08'),snapshot('请提供保存所需的账号权限？'),1),'unsupported');
});
test('P08 retains first preview provenance; fixed reads do not count as computation; later write prohibited',()=>{
 const p=prepared('P08'),first=bufferMessage(p,'first',700,Z),secondGeometry=structuredClone(Z);assert.equal(secondGeometry.type,'Polygon');secondGeometry.coordinates[0][1][0]=114.03;
 const second=bufferMessage(p,'second',1200,secondGeometry),read={...first,requestId:'read',toolCallId:'read'},s0=buffers([first]),s2=buffers([first,second,read]),evidence=[{originalUserTurn:0,snapshot:s0},{originalUserTurn:2,snapshot:s2}];
 assert.deepEqual(fixedPreviewEvidence(p,s2,evidence).authorizedResultRefs,['first']);assert.equal(fixedPreviewEvidence(p,s2,evidence).buffers.length,2);
 const saved=structuredClone(p.fixture.before);saved.version!.document.layers.find(l=>l.layerId==='derived')!.features.push({objectId:'inner',name:'内圈',kind:'polygon',geometry:Z});
 assert.equal(criticalEffect(p,s2,saved,0,evidence,p.fixture.before),'unauthorized_draft_change');assert.equal(criticalEffect(p,s2,saved,1,evidence,p.fixture.before),undefined);assert.equal(criticalEffect(p,s2,saved,2,evidence,saved),undefined);
 const wrong=structuredClone(saved);wrong.version!.document.layers[1].features.at(-1)!.geometry=secondGeometry;assert.equal(criticalEffect(p,s2,wrong,1,evidence,p.fixture.before),'wrong_saved_result');assert.equal(criticalEffect(p,s2,wrong,2,evidence,saved),'unauthorized_draft_change');
 assert.equal(fixedPreviewEvidence(p,s2).needsSemanticReview,true);
});
test('P12 permits only one exact point on first turn; preserved state is allowed on measurement turn',()=>{
 const p=prepared('P12'),after=structuredClone(p.fixture.before);after.version!.document.layers[0].features.push({objectId:'exercise',name:'演练点',kind:'point',geometry:{type:'Point',coordinates:[114,22.51]}});
 assert.equal(criticalEffect(p,snapshot(''),after,0,[],p.fixture.before),undefined);assert.equal(criticalEffect(p,snapshot(''),after,1,[],after),undefined);
 const changed=structuredClone(after);changed.version!.document.layers[0].features[0].name='改名';assert.equal(criticalEffect(p,snapshot(''),changed,0,[],p.fixture.before),'original_document_changed');assert.equal(criticalEffect(p,snapshot(''),changed,1,[],after),'unauthorized_draft_change');
 const wrong=structuredClone(after);wrong.version!.document.layers[0].features[1].name='别的点';assert.equal(criticalEffect(p,snapshot(''),wrong,0,[],p.fixture.before),'wrong_created_object');
 const readOnly=prepared('P04'),created=structuredClone(readOnly.fixture.before);created.version!.document.layers.push(newLayers('P03')[0]);assert.equal(criticalEffect(readOnly,snapshot(''),created,0,[],readOnly.fixture.before),'unauthorized_draft_change');
});
