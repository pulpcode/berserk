/** Evaluator-only 24 task diagnostic; no oracle material is loaded into the model workspace. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mapTrialRequest,type MapTrialManifest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import {control} from '../../../../experiments/harness-lab/scripts/probe-task-plan.js';
import {rectangleArea,meridianDistance} from '../../../../experiments/harness-lab/scripts/probe-spatial-cases.js';
import type {SimulationState} from '../../../../experiments/harness-lab/src/contracts/simulation.js';
import type {AnnotationAction,AnnotationReceipt} from '../../../../experiments/harness-lab/src/contracts/annotations.js';
import {prepareFixture,distance,type Fixture,type Kind} from '../round1-20261017/cases.js';
import type {Case} from '../r3-20261022/cases.js';
export {introduceConflict} from '../r3-20261022/cases.js';
export type {Case};
const c=(id:string,category:string,prompts:string[],kind:Kind='J01',extra:Partial<Case>={}):Case=>({id,kind,targetSkill:'spatial-analysis',category,prompts,clarification:'unnecessary',objective:'answer',...extra});
export const cases:Case[]=[
 c('T01','explicit-draft-membership',['仅针对本会话地图草稿objectId=region的区域和layerId=resources资源图层：包含边界在内有哪些资源点，多少个？只分析，不修改。'],'J04'),
 c('T02','explicit-source-membership',['仅针对situation来源系统的西区区域及该来源车辆资源点：哪些车辆资源点在西区区域内（含边界），共多少个？不使用本会话草稿的观察区或资源点。只分析。']),
 c('T03','duplicate-regions',['本会话观察区内有哪些资源点，包含边界？只分析，不修改。'],'J04',{clarification:'conditional-allowed'}),
 c('T04','distracting-task-focus',['虽然任务关注西区车辆，但本次只问本会话草稿的观察区：resources图层哪些点在区域内（含边界），共多少个？不要将来源数据混入。只分析。'],'J04'),
 c('T05','point-distance',['仅针对本会话草稿：基点到北点的直线地理距离多少米？请计算，只分析。']),
 c('T06','whole-polyline',['仅针对本会话草稿：往返线沿全部折线段的总长多少米？请计算，只分析。']),
 c('T07','polygon-area',['仅针对本会话草稿：观察区面积多少平方米？请计算，只分析。']),
 c('T08','point-to-line',['仅针对本会话草稿：基点到巡查线的最短地理距离多少米？请计算，只分析。']),
 c('T09','classification',['仅针对本会话草稿：将resources资源点逐个分为观察区严格内部、边界、外部，列出名称和各类数量。只分析。'],'J04'),
 c('T10','candidate-nearest',['仅针对本会话草稿：候选仅限layerId=resources，找离基点最近的两个点及直线距离；其他图层可读取以定位基点，但不加入候选。只分析。'],'J09'),
 c('T11','buffer-attribute-count',['仅针对本会话草稿：生成基点周边1500米范围，在其中筛选resources图层category=boat的点，列出名称和数量，展示范围但不保存。']),
 c('T12','intersection',['仅针对本会话草稿：巡查线和禁入区是否相交（含边界接触）？请核对几何，只分析。']),
 c('T13','all-pages',['仅针对本会话草稿：请完整列出应急补给图层全部对象的名称，并给出该图层总数，不把全地图总数混入。只查询，不修改。'],'J02'),
 c('T14','genuine-empty',['仅针对本会话草稿：空区内是否有resources资源点（含边界），多少个？只分析。']),
 c('T15','source-unavailable',['仅针对situation来源系统：查询西区目前有哪些车辆资源点。只查询来源，不以草稿替代，也不修改。']),
 c('T16','missing-geometry',['将situation来源系统西区和东区的两个车辆资源点作为完整候选，按到本会话草稿基点的地理距离排序，列出两项距离。只分析，不修改。']),
 c('T17','reuse-fixed-range',['仅针对本会话草稿基点生成1500米范围，先展示，不保存。','沿用上一次已经生成的那个固定范围，筛选本会话resources资源点，列出名称和数量，不重新生成范围。']),
 c('T18','historical-reference',['只针对本条消息引用的固定历史版本：resources资源图层中离基点最近的两个点及距离是什么？说明所用版本，不用最新版本替换。只分析。'],'J10',{refs:true}),
 c('T19','source-update',['仅针对situation来源系统西区车辆资源，筛选availableCount至少3辆的资源对象，列出名称和对象数量；保留本次分析结果，仅分析，不写入标绘，不改来源。','来源已更新。请重新查询同一来源范围，按同一条件重新筛选，并比较上次结果与本次结果的对象数量、属性和版本。不要用新值覆盖旧结果。']),
 c('T20','choose-earlier-result',['以本会话草稿基点生成500米范围，不保存。','再以同一基点生成1500米范围，不保存。','沿用第一次生成的500米固定范围，筛选resources资源点并报名称和数量，不使用第二次范围，也不重新生成。']),
 c('T21','exact-preview-save',['以本会话草稿基点生成500米范围，先预览，不保存。','将刚才那次预览的固定范围保存到派生图层，命名临时范围，其他内容不变，不发布、不设为当前。'],'J07',{targetSkill:'map-annotations'}),
 c('T22','concurrent-save',['以本会话草稿基点生成500米范围，先预览，不保存。','将刚才那次预览的固定范围保存到派生图层，命名临时范围，保留他人修改；其他内容不变，不发布、不设为当前。'],'J07',{targetSkill:'map-annotations'}),
 c('T23','unknown-save-outcome',['以本会话草稿基点生成500米范围，先预览，不保存。','将刚才那次预览的固定范围保存到派生图层，命名临时范围，其他内容不变，不发布、不设为当前。'],'J07',{targetSkill:'map-annotations'}),
 c('T24','publish-not-adopt',['发布本会话草稿当前指定版本，标题为核对发布版；不要设为任务当前，不修改草稿对象。'], 'J01',{targetSkill:'map-annotations'}),
];
export const labels={B:'B'} as const;
export interface Entry {id:string;caseId:string;group:'B';loading:'native';round:1;objective:Case['objective'];clarification:Case['clarification'];split:'development'}
export const schedule:Entry[]=cases.map(c=>({id:`${c.id}-B`,caseId:c.id,group:'B',loading:'native',round:1,objective:c.objective,clarification:c.clarification,split:'development'}));
export const expectedMethods=Object.fromEntries(cases.map(c=>[c.id,{targetSkill:c.targetSkill,loading:'observed_not_required'}]));
export interface Prepared {spec:Case;fixture:Fixture;prompts:string[];truth:Record<string,unknown>;sourceOrigin:string;sourceBefore:SimulationState}
export async function prepareCase(m:MapTrialManifest,spec:Case):Promise<Prepared>{
 const fixture=await prepareFixture(m,spec.kind);
 const action=async(operations:Extract<AnnotationAction,{action:'apply'}>['operations'])=>{
  const receipt=await mapTrialRequest<AnnotationReceipt>(m,`/api/sessions/${fixture.sessionId}/annotation/actions`,'planning','POST',{action:'apply',clientActionId:randomUUID(),expectedRevision:fixture.before.binding.draft!.headRevision,operations});fixture.setupReceipts.push(receipt);fixture.before=await mapState(m,fixture.sessionId);
 };
 if(spec.id==='T03'){
  const empty=fixture.before.version!.document.layers.flatMap(l=>l.features).find(f=>f.objectId==='empty')!;
  await action([{op:'add_object',layerId:'reference',feature:{...structuredClone(empty),objectId:'region-other',name:'观察区'}}]);
 }
 if(spec.id==='T18')await action([{op:'update_object',objectId:'r1',changes:{geometry:{type:'Point',coordinates:[114.1,22.6]}}}]);
 const prompts=[...spec.prompts];if(spec.id==='T24')prompts[0]=`发布本会话草稿revision=${fixture.before.binding.draft!.headRevision}这个指定版本，标题为核对发布版；不要设为任务当前，不修改草稿对象。`;
 const sourceBefore=await mapTrialRequest<SimulationState>(m,'/api/simulation','overall');
 const sourceOrigin=new URL((await control(m.socket,['status']) as {url:string}).url).origin;
 const fs=fixture.before.version!.document.layers.flatMap(l=>l.features),origin=fs.find(f=>f.objectId==='origin');
 const pointDistances=origin?.geometry.type==='Point'?Object.fromEntries(fs.filter(f=>f.geometry.type==='Point').map(f=>[f.objectId,distance(origin.geometry.coordinates as number[],f.geometry.coordinates as number[])])):{};
 let historical:unknown;let historicalDistancesM:Record<string,number>|undefined;
 if(spec.id==='T18'){const ref=fixture.annotationRefs![0];assert.ok('setId' in ref);const version=await mapTrialRequest<NonNullable<Fixture['before']['version']>>(m,`/api/annotations/${ref.setId}/revisions/${ref.revision}`,'planning');const items=version.document.layers.flatMap(l=>l.features),base=items.find(f=>f.objectId==='origin')!;historical=version;historicalDistancesM=Object.fromEntries(items.filter(f=>f.geometry.type==='Point').map(f=>[f.objectId,distance(base.geometry.coordinates as number[],f.geometry.coordinates as number[])]));}
 const truth:Record<string,unknown>={caseId:spec.id,method:'Independent analytic sphere/haversine plus exact fixture identities; real source preparation snapshot',sourceBefore,documentTotal:fs.length,layerCounts:Object.fromEntries(fixture.before.version!.document.layers.map(l=>[l.layerId,l.features.length])),distancesM:spec.id==='T18'?historicalDistancesM:pointDistances,...(historical?{historical,historicalDistancesM,latestDistancesM:pointDistances}:{}),
  expected:({T01:{inside:['r1','r2','r3','edge'],count:4},T02:{sourceResourceIds:[m.objects.resource.objectId],count:1},T03:{choiceRequiredOrBoth:{region:['r1','r2','r3','edge'],'region-other':[]}},T04:{inside:['r1','r2','r3','edge'],count:4},T05:{valueM:meridianDistance(.01),toleranceM:2},T06:{valueM:meridianDistance(.04),toleranceM:2},T07:{valueM2:rectangleArea(22.5),toleranceM2:10},T08:{valueM:meridianDistance(.01),toleranceM:2},T09:{interior:['r2','r3'],boundary:['r1','edge'],exterior:['outside']},T10:{nearest:['r1','r2'],toleranceM:2},T11:{inside:['r1'],count:1,bufferM:1500},T12:{intersects:false},T13:{count:58,names:fs.filter(f=>fixture.before.version!.document.layers.find(l=>l.name==='应急补给')?.features.includes(f)).map(f=>f.name)},T14:{inside:[],count:0},T15:{sourceFailure:true,noEmptyClaim:true},T16:{missingGeometry:m.objects.resource,noCompleteRanking:true},T17:{inside:['r1','r2'],reuseFirst:true},T18:{nearest:['r1','r2'],ref:fixture.annotationRefs?.[0],latestNearest:['r2','r3']},T19:{beforeCount:1,afterCount:0,beforeAvailableCount:4,afterAvailableCount:1},T20:{inside:[],count:0,reuseFirst:true,rejectSecond:true},T21:{saveFirst:true},T22:{saveFirst:true,externalNote:'外部已核实，请保留'},T23:{saveFirst:true,unknownCommit:true,queryOriginal:true,noDuplicate:true},T24:{publishRef:fixture.before.version!.ref,title:'核对发布版',noAdopt:true}} as Record<string,unknown>)[spec.id]};
 fixture.truth=truth;
 if(spec.id==='T15')await control(m.socket,['unavailable','situation','on']);
 return {spec,fixture,prompts,truth,sourceOrigin,sourceBefore};
}
export async function updateSource(m:MapTrialManifest){
 const before=await mapTrialRequest<SimulationState>(m,'/api/simulation','overall');const resource=before.objects.find(o=>o.ref.objectId===m.objects.resource.objectId)!;
 assert.ok('availableCount' in resource.properties);assert.equal(resource.properties.availableCount,4);
 const receipt=await mapTrialRequest(m,'/api/simulation/object-updates','overall','POST',{clientActionId:randomUUID(),ref:resource.ref,expectedRevision:resource.revision,properties:{availableCount:1,unit:'辆'},effectiveAt:`${m.day}T09:30:00+08:00`,validTime:null});
 const after=await mapTrialRequest<SimulationState>(m,'/api/simulation','overall');return {before,receipt,after};
}
