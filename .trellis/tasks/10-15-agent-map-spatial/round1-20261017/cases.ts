/** Evaluator-only fixtures. Never install this module or oracle into a model workspace. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {AnnotationAction,AnnotationLayer,AnnotationReceipt,AnnotationSelection} from '../../../../experiments/harness-lab/src/contracts/annotations.js';
import {mapTrialRequest,type MapTrialManifest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import {spatialCaseLayers,spatialCases,meridianDistance} from '../../../../experiments/harness-lab/scripts/probe-spatial-cases.js';
import {largeLayers,prepareFixture as prepareComparison,preparationState} from '../../10-17-map-query-native-evaluation/fixtures.js';
export {preparationState};
export type Kind=`J${'01'|'02'|'03'|'04'|'05'|'06'|'07'|'08'|'09'|'10'|'11'|'12'}`;
export type Model='deepseek-flash'|'deepseek-v4-pro';
export interface Entry {id:string;kind:Kind;model:Model;condition:'B'|'C';round:1}
export const kinds=Array.from({length:12},(_,i)=>`J${String(i+1).padStart(2,'0')}` as Kind);
const conditions=[['deepseek-flash','B'],['deepseek-flash','C'],['deepseek-v4-pro','B'],['deepseek-v4-pro','C']] as const;
export const schedule:Entry[]=kinds.flatMap((kind,i)=>Array.from({length:4},(_,j)=>{const [model,condition]=conditions[(j+i)%4];return {id:`${kind}-1-${model==='deepseek-flash'?'F':'P'}${condition}`,kind,model,condition,round:1};}));
export const prompts:Record<Kind,string[]>={
 J01:['仅针对本会话地图草稿：资源图层里离基点最近的两个点是哪两个？给出直线距离，只分析，不保存。'],
 J02:['请查看本会话地图“应急补给”图层按保存顺序的第51～52项名称和类型，并说明这个图层一共有多少项。只查看，不修改。'],
 J03:['把本会话集合点乙备注改为“B 保障讨论”，保留其余内容。','比较引用对象与本会话对应对象的备注，只说明差异，不修改。'],
 J04:['仅针对本会话地图草稿：资源图层一共有多少个对象，其中有多少点在观察区内（包含边界），分别叫什么？只分析，不修改。'],
 J05:['仅针对本会话地图草稿：生成基点周边1500米范围，筛选资源图层的点并按类别计数；展示范围，不保存。'],
 J06:['仅针对本会话地图草稿：先生成基点周边1500米的范围，只分析，不保存。','把基点改名为出发点，其他内容不变，不发布。','沿用第一轮那次分析的固定范围，筛选资源图层中的点，不要重新生成范围或保存。'],
 J07:['仅针对本会话地图草稿：生成基点周边500米范围，先预览，不保存。','将刚才预览的那个范围保存到派生图层，命名为临时范围。其他内容不变，不发布、不设为当前。'],
 J08:['仅针对本会话地图草稿：基点与北点相距多少米？只分析，不保存、不发布、不设为当前。'],
 J09:['仅针对本会话地图草稿：资源图层中离基点最近的点是哪一个？只分析，不修改。'],
 J10:['仅针对引用的这个固定历史版本：资源图层里离基点最近的两个点是哪两个？只分析，不修改。'],
 J11:['仅针对本会话地图草稿：测量集合点到基点的距离，只提供信息，不修改。'],
 J12:['仅针对本会话地图草稿：资源图层的点按设备类别（category）分类计数。只分析，不修改。'],
};
export interface Fixture {kind:Kind;sessionId:string;workspaceId?:string;before:Awaited<ReturnType<typeof mapState>>;otherSessionId?:string;otherBefore?:Awaited<ReturnType<typeof mapState>>;annotationRefs?:AnnotationSelection[];setupReceipts:unknown[];truth:Record<string,unknown>}
export function layersFor(kind:Kind):AnnotationLayer[]{
 if(kind==='J02')return largeLayers().map(layer=>({...layer,features:layer.features.map((f,i)=>({...f,geometry:{type:'Point',coordinates:[151.2+i*.00001,-33.86]}}))}));
 const spec={...spatialCases[0],region:kind==='J04'||kind==='J11'?'australia' as const:'china' as const};
 const layers=spatialCaseLayers(spec);
 // Keep task wording identical across regions; geometry is the only regional difference.
 const names:Record<string,string>={origin:'基点',north:'北点',region:'观察区',excluded:'禁入区',edge:'边界点'};
 for(const layer of layers)for(const f of layer.features)if(names[f.objectId])f.name=names[f.objectId];
 if(kind==='J09')layers.push({layerId:'resources-other',name:'资源',order:4,defaultVisible:true,features:[{objectId:'other-point',name:'备用资源',kind:'point',geometry:{type:'Point',coordinates:[114,22.501]}}]});
 if(kind==='J12')delete layers.find(l=>l.layerId==='resources')!.features[1].attributes!.category;
 return layers;
}
/** Independent haversine reference, not a product/Turf import. */
export function distance(a:number[],b:number[]){const rad=Math.PI/180;const dlat=(b[1]-a[1])*rad,dlon=(b[0]-a[0])*rad;return 6371008.8*2*Math.asin(Math.min(1,Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dlon/2)**2)));}
export function oracle(kind:Kind,layers=layersFor(kind)):Record<string,unknown>{
 const fs=layers.flatMap(l=>l.features),origin=fs.find(f=>f.objectId==='origin');
 const distances=origin?Object.fromEntries(fs.filter(f=>f.geometry.type==='Point').map(f=>[f.objectId,distance(origin.geometry.coordinates as number[],f.geometry.coordinates as number[])])):{};
 return {method:'Independent spherical haversine R=6371008.8; declared fixture identities and polygon bounds; no production calculation import',kind,
  documentTotal:fs.length,layerCounts:Object.fromEntries(layers.map(l=>[l.layerId,l.features.length])),distancesM:distances,
  ...(kind==='J01'||kind==='J10'?{nearest:['r1','r2']}:{}),...(kind==='J02'?{names:['松林补给点','湖湾补给点'],types:['point','point'],layerTotal:58,documentTotal:64}:{}),
  ...(kind==='J04'?{inside:['r1','r2','r3','edge'],layerTotal:5,insideCount:4}:{}),
  ...(kind==='J05'||kind==='J06'?{bufferDistanceM:1500,inside:['r1','r2'],category:{boat:1,truck:1},reuseFirstBuffer:kind==='J06'}:{}),
  ...(kind==='J07'?{bufferDistanceM:500,exactFirstPreview:true,saveLayer:'derived',saveName:'临时范围'}:{}),
  ...(kind==='J08'?{distanceM:meridianDistance(.01),publishedAndAdoptedBefore:true}:{}),
  ...(kind==='J09'?{behavior:'clarify-same-layer-name',candidates:['resources','resources-other']}:{}),
  ...(kind==='J11'?{completeConditionalAnswer:['amb-a','amb-b']}:{}),
  ...(kind==='J12'?{category:{boat:3,truck:1},missingCategory:['r2'],missingCount:1}:{}),
  requiresSkill:['J04','J05','J06','J07','J11'].includes(kind),semanticReview:'pending_review'};
}
export async function prepareFixture(m:MapTrialManifest,kind:Kind):Promise<Fixture>{
 if(kind==='J03'){const f=await prepareComparison(m,'F2');return {...f,kind,truth:f.truth as Record<string,unknown>};}
 const workspace=await mapTrialRequest<{id:string}>(m,`/api/tasks/${m.tasks.supply}/workspace`,'planning','POST',{});
 const sessionId=(await mapTrialRequest<{id:string}>(m,'/api/sessions','planning','POST',{workspaceId:workspace.id})).id;
 const receipts:unknown[]=[];
 const action=async(input:AnnotationAction)=>{const receipt=await mapTrialRequest<AnnotationReceipt>(m,`/api/sessions/${sessionId}/annotation/actions`,'planning','POST',input);receipts.push(receipt);return receipt;};
 const layers=layersFor(kind);await action({action:'create_draft',clientActionId:randomUUID(),baseRef:null,title:'空间与标绘核对',operations:layers.map(layer=>({op:'add_layer',layer}))});
 let annotationRefs:AnnotationSelection[]|undefined;
 if(kind==='J10'){
  const historical=await mapState(m,sessionId);assert.ok(historical.version);annotationRefs=[historical.version.ref];
  await action({action:'apply',clientActionId:randomUUID(),expectedRevision:historical.binding.draft!.headRevision,operations:[{op:'update_layer',layerId:'resources',changes:{name:'更新后的资源'}}]});
 }
 if(kind==='J08'){
  const before=await mapState(m,sessionId);const pub=await action({action:'publish',clientActionId:randomUUID(),revision:before.binding.draft!.headRevision,title:'既往发布范围'});assert.ok(pub.publication);
  const current=(await mapState(m,sessionId)).current;
  receipts.push(await mapTrialRequest(m,`/api/tasks/${m.tasks.supply}/annotations/current`,'overall','POST',{clientActionId:randomUUID(),publicationId:pub.publication.publicationId,expectedCurrentSequence:current.sequence}));
 }
 return {kind,sessionId,workspaceId:workspace.id,before:await mapState(m,sessionId),annotationRefs,setupReceipts:receipts,truth:oracle(kind,layers)};
}
