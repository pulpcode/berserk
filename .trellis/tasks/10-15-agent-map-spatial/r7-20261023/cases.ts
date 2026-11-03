/** Frozen development probes. Oracle stays outside model workspace. */
import {cases as prior,prepareCase as preparePrior,introduceConflict} from '../r3-20261022/cases.js';
import type {Case,Prepared} from '../r3-20261022/cases.js';
import {randomUUID} from 'node:crypto';
import {mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import {distance} from '../round1-20261017/cases.js';
export {introduceConflict};export type {Case,Prepared};
export const groups=['A','B'] as const;export type Group=typeof groups[number];
export type Loading='explicit';
export const labels={A:'A',B:'B'} as const;
const from=(id:string)=>structuredClone(prior.find(c=>c.id===id)!);
export const cases:Case[]=[
 from('D17'),
 {id:'D21',kind:'J04',targetSkill:'spatial-analysis',category:'requested-edge-length',prompts:['本会话观察区西南顶点到东南顶点这条南侧边（已有线对象“观察区南边”）有多长？请计算并用米回答。只分析，不修改。'],clarification:'unnecessary',objective:'answer'},
 {id:'D22',kind:'J07',targetSkill:'spatial-analysis',category:'generate-without-save',prompts:['以本会话基点生成500米范围并展示，告诉我本次做了什么。不要添加为草稿对象，不发布。'],clarification:'unnecessary',objective:'answer'},
 from('D16'),
 {...from('D02'),prompts:['本会话有两个同名资源图层。本次候选仅限layerId=resources，不包括resources-other；可以读取其他图层来定位基点，但不把那些对象加入候选。找出候选中离基点最近的点及直线距离。只分析，不修改。']},
 {id:'D23',kind:'J01',targetSkill:'map-annotations',category:'simple-layer-count',prompts:['本会话草稿的layerId=resources图层共有多少个对象？只查询，不修改。'],clarification:'unnecessary',objective:'answer'},
];
export interface Entry {id:string;caseId:string;group:Group;loading:Loading;round:1;objective:Case['objective'];clarification:Case['clarification'];split:'development'}
export const schedule:Entry[]=cases.flatMap((c,i)=>(i%2?['B','A'] as const:['A','B'] as const).map(group=>({id:`${c.id}-${group}`,caseId:c.id,group,loading:'explicit',round:1,objective:c.objective,clarification:c.clarification,split:'development'})));
export const expectedMethods=Object.fromEntries(cases.map(c=>[c.id,[{stage:'first_request_each_user_turn',anyOf:[c.targetSkill]}]]));
export const prepareCase:typeof preparePrior=async(manifest,spec)=>{
 const p=await preparePrior(manifest,spec);
 if(spec.id==='D21'){
  const region=p.fixture.before.version!.document.layers.flatMap(l=>l.features).find(f=>f.objectId==='region')!;
  if(region.geometry.type!=='Polygon')throw new Error('Expected polygon fixture');
  const [a,b]=region.geometry.coordinates[0];
  const receipt=await mapTrialRequest(manifest,`/api/sessions/${p.fixture.sessionId}/annotation/actions`,'planning','POST',{action:'apply',clientActionId:randomUUID(),expectedRevision:p.fixture.before.binding.draft!.headRevision,operations:[{op:'add_layer',layer:{layerId:'measurement-reference',name:'测量参考',order:8,defaultVisible:true,features:[{objectId:'region-south-edge',name:'观察区南边',kind:'line',geometry:{type:'LineString',coordinates:[a,b]}}]}}]});
  p.fixture.setupReceipts.push(receipt);
  p.fixture.before=await mapState(manifest,p.fixture.sessionId);
  p.truth={...p.truth,documentTotal:p.fixture.before.version!.document.layers.reduce((n,l)=>n+l.features.length,0),layerCounts:Object.fromEntries(p.fixture.before.version!.document.layers.map(l=>[l.layerId,l.features.length])),edgeEndpoints:[a,b],expectedLengthM:distance(a,b),toleranceM:2};
 }
 if(spec.id==='D22')p.truth={...p.truth,bufferDistanceM:500,noDraftWrite:true};
 if(spec.id==='D23')p.truth={...p.truth,expectedCount:5,targetLayer:'resources'};
 p.fixture.truth=p.truth;return p;
};
