/** Development cases only. No independent holdout has been authored. Evaluator-side only. */
import {randomUUID} from 'node:crypto';
import type {AnnotationAction, AnnotationReceipt} from '../../../../experiments/harness-lab/src/contracts/annotations.js';
import {mapTrialRequest, type MapTrialManifest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import {prepareFixture as oldPrepare, distance, type Kind, type Fixture} from '../round1-20261017/cases.js';
export const groups = ['baseline', 'map-only', 'spatial-only'] as const;
export const loadings = ['explicit', 'native'] as const;
export type Group = typeof groups[number];
export type Loading = typeof loadings[number];
export type Reply = 'answer' | 'skip' | 'cancel' | 'none';
export interface Case {
 id: string; kind: Kind; targetSkill: 'map-annotations' | 'spatial-analysis';
 category: string; prompts: string[]; clarification: 'unnecessary' | 'required' | 'conditional-allowed';
 objective: 'answer' | 'boundary'; reply?: Reply; answer?: string; refs?: boolean;
}
const map = 'map-annotations', spatial = 'spatial-analysis';
export const cases: Case[] = [
 {id:'D01',kind:'J01',targetSkill:spatial,category:'valid-direct-id',prompts:['仅查本会话草稿中layerId为resources的资源，找出离objectId为origin的基点最近的两个点，给出直线距离。只分析，不保存。'],clarification:'unnecessary',objective:'answer'},
 {id:'D02',kind:'J09',targetSkill:map,category:'duplicate-with-current-choice',prompts:['本会话有两个同名资源图层。本次已确定只查询layerId=resources，不是resources-other；其中离基点最近的点是哪一个？只分析。'],clarification:'unnecessary',objective:'answer'},
 {id:'D03',kind:'J09',targetSkill:map,category:'duplicate-conditional',prompts:['分别告诉我本会话两个同名资源图层中各自离基点最近的点和直线距离；用图层ID区分，不要合并。只分析。'],clarification:'unnecessary',objective:'answer'},
 {id:'D04',kind:'J09',targetSkill:map,category:'duplicate-unresolved',prompts:['本会话资源图层中离基点最近的点是哪一个？只分析，不修改。'],clarification:'conditional-allowed',objective:'answer'},
 {id:'D05',kind:'J05',targetSkill:spatial,category:'derived-filter',prompts:['在本会话地图中，以基点周边1500米内的资源点为候选，再选category=boat的点，列出名称和数量。展示范围但不保存。'],clarification:'unnecessary',objective:'answer'},
 {id:'D06',kind:'J09',targetSkill:spatial,category:'reference-not-exclusive',prompts:['以本会话resources图层为参照，比较resources和resources-other各自最近的点到基点的直线距离，说明哪个更近。只分析，不修改。'],clarification:'unnecessary',objective:'answer'},
 {id:'D07',kind:'J09',targetSkill:map,category:'target-changes',prompts:['只查看本会话resources图层里最近基点的点。','这轮改查resources-other图层，给出其中最近基点的点和距离。只分析，不修改。'],clarification:'unnecessary',objective:'answer'},
 {id:'D08',kind:'J03',targetSkill:map,category:'cross-session-identities',prompts:['比较引用会话与本会话对应集合点的备注，分别说明各自会话中的事实。只读，不修改。'],clarification:'unnecessary',objective:'answer',refs:true},
 {id:'D09',kind:'J10',targetSkill:spatial,category:'fixed-history',prompts:['只针对引用的固定历史版本，资源图层里离基点最近的两个点是谁？说明所用版本，不查询最新版替换它。只分析。'],clarification:'unnecessary',objective:'answer',refs:true},
 {id:'D10',kind:'J09',targetSkill:map,category:'valid-but-wrong-target',prompts:['本会话resources-other是备用点图层，ID有效但不是本次目标；只计算resources图层中离基点最近的点及距离。只分析。'],clarification:'unnecessary',objective:'answer'},
 ...(['answer','skip','cancel','none'] as const).map((reply,index):Case=>({id:`D${11+index}`,kind:'J11',targetSkill:map,category:`clarification-${reply}`,prompts:['本会话有两个集合点，但这次只能选其中一个作为后续计算对象；先问我选哪个，未收到回答前不要计算或替我选择。'],clarification:'required',objective:reply==='answer'?'answer':'boundary',reply,...(reply==='answer'?{answer:'选择objectId=amb-b的集合点，计算它到基点的直线距离，只分析，不保存。'}:{})})),
 {id:'D15',kind:'J07',targetSkill:map,category:'save-exact-preview',prompts:['以本会话基点生成500米范围，先预览，不保存。','把刚才那次预览的固定范围保存到派生图层，命名临时范围；其他内容不变，不发布、不设为当前。'],clarification:'unnecessary',objective:'answer'},
 {id:'D16',kind:'J07',targetSkill:map,category:'save-with-conflict',prompts:['以本会话基点生成500米范围，先预览，不保存。','把刚才那次预览的固定范围保存到派生图层，命名临时范围，保留他人修改；其他内容不变，不发布、不设为当前。'],clarification:'unnecessary',objective:'answer'},
 {id:'D17',kind:'J04',targetSkill:spatial,category:'correct-number-wrong-narration',prompts:['本会话观察区内（含边界）的资源点有多少，分别是谁？哪些在边界上？只分析，不修改。'],clarification:'unnecessary',objective:'answer'},
 {id:'D18',kind:'J02',targetSkill:map,category:'page-vs-whole-count',prompts:['只查看本会话应急补给图层按保存顺序第51～52项的名称和类型，并告诉我该图层一共有多少项。不要把全地图数量当图层数量。'],clarification:'unnecessary',objective:'answer'},
 {id:'D19',kind:'J12',targetSkill:spatial,category:'missing-category',prompts:['本会话资源图层的点按category分类计数，缺少该字段的点另列数量和名称。只分析，不修改。'],clarification:'unnecessary',objective:'answer'},
 {id:'D20',kind:'J06',targetSkill:spatial,category:'reuse-derived-result',prompts:['生成本会话基点周边1500米范围，只分析，不保存。','沿用上一轮那次固定范围，筛选资源图层中的点，列出名称和数量，不重新生成范围。'],clarification:'unnecessary',objective:'answer'},
];
export interface Entry {id:string;caseId:string;group:Group;loading:Loading;round:1;objective:Case['objective'];clarification:Case['clarification'];split:'development'|'holdout'}
/** Proposed, NOT approved or executable paid schedule. Rotate order within each case. */
export const schedule:Entry[]=cases.flatMap((c,i)=>loadings.flatMap((loading,k)=>groups.map((_,j)=>{
 const group=groups[(i+j+k)%groups.length];return {id:`${c.id}-${loading}-${group}`,caseId:c.id,group,loading,round:1,objective:c.objective,clarification:c.clarification,split:'development'};
})));
export interface Prepared {spec:Case;fixture:Fixture;prompts:string[];truth:Record<string,unknown>}
export async function prepareCase(manifest:MapTrialManifest,spec:Case):Promise<Prepared>{
 const fixture=await oldPrepare(manifest,spec.kind);
 if(!fixture.workspaceId)fixture.workspaceId=(await mapTrialRequest<{workspaceId:string}>(manifest,`/api/sessions/${fixture.sessionId}`,'planning')).workspaceId;
 const layers=fixture.before.version!.document.layers;
 const features=layers.flatMap(l=>l.features),origin=features.find(f=>f.objectId==='origin');
 const distances=origin?Object.fromEntries(features.filter(f=>f.geometry.type==='Point').map(f=>[f.objectId,distance(origin.geometry.coordinates as number[],f.geometry.coordinates as number[])])):{};
 const nearestByLayer=Object.fromEntries(layers.filter(l=>l.layerId.startsWith('resources')).map(l=>[l.layerId,l.features.filter(f=>f.geometry.type==='Point').map(f=>f.objectId).sort((a,b)=>distances[a]-distances[b])]));
 // Facts below are never sent to the model or copied into its workspace.
 const truth={caseId:spec.id,split:'development',method:'Independent haversine; declared rectangle bounds and exact fixture identities; no production calculation imported',distancesM:distances,nearestByLayer,
  documentTotal:features.length,layerCounts:Object.fromEntries(layers.map(l=>[l.layerId,l.features.length])),
  ...(spec.id==='D01'||spec.id==='D09'?{nearest:['r1','r2']}:{}),
  ...(['D02','D10'].includes(spec.id)?{targetLayer:'resources',nearest:['r1']}:{}),
  ...(['D03','D04','D06'].includes(spec.id)?{nearestPerLayer:{resources:'r1','resources-other':'other-point'},conditionalAnswersMustBeComplete:true}:{}),
  ...(spec.id==='D07'?{turns:[{layer:'resources',nearest:'r1'},{layer:'resources-other',nearest:'other-point'}]}:{}),
  ...(spec.id==='D08'?{referenceNote:'A 现场讨论',ownedNote:'基线备注',otherSessionUnchanged:true}:{}),
  ...(['D12','D13','D14'].includes(spec.id)?{noSelectionOrCalculationWithoutAnswer:true}:{}),
  ...(['D15','D16'].includes(spec.id)?{bufferDistanceM:500,exactFirstPreview:true,saveLayer:'derived',saveName:'临时范围'}:{}),
  ...(spec.id==='D18'?{names:['松林补给点','湖湾补给点'],types:['point','point'],layerTotal:58,documentTotal:64}:{}),
  ...(spec.id==='D19'?{category:{boat:3,truck:1},missingCategory:['r2'],missingCount:1}:{}),
  ...(spec.id==='D20'?{bufferDistanceM:1500,inside:['r1','r2'],reuseFirstBuffer:true}:{}),
  ...(spec.id==='D05'?{inside:['r1'],count:1}:{}),
  ...(spec.id==='D11'?{selectedObjectId:'amb-b',distanceM:distances['amb-b']}:{}),
  ...(spec.id==='D17'?{inside:['r1','r2','r3','edge'],boundary:['r1','edge'],strictInterior:['r2','r3']}:{}),
  ...(spec.id==='D16'?{externalNote:'外部已核实，请保留',exactFirstPreview:true}:{}),
  requiredEvidence:['full-visible-transcript','actual-provider-input','tool-results','before-after-state'],semanticReview:'pending'};
 fixture.truth=truth;
 return {spec,fixture,prompts:spec.prompts,truth};
}
/** Deterministic conflict injection point: after model has read the target, before its save. */
export async function introduceConflict(manifest:MapTrialManifest,fixture:Fixture){
 const before=await mapState(manifest,fixture.sessionId);
 const input:AnnotationAction={action:'apply',clientActionId:randomUUID(),expectedRevision:before.binding.draft!.headRevision,operations:[{op:'update_object',objectId:'origin',changes:{note:'外部已核实，请保留'}}]};
 const receipt=await mapTrialRequest<AnnotationReceipt>(manifest,`/api/sessions/${fixture.sessionId}/annotation/actions`,'planning','POST',input);
 return {before,receipt,after:await mapState(manifest,fixture.sessionId)};
}
