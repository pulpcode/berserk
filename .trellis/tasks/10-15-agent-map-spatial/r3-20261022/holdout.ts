/** Authored after frozen candidate hashes were delivered. Skill writer did not see these cases.
 * Four small new compositions, not a formal acceptance set. This module is evaluator-only. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {AnnotationLayer,AnnotationFeature,AnnotationReceipt} from '../../../../experiments/harness-lab/src/contracts/annotations.js';
import {mapTrialRequest,type MapTrialManifest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import {distance,type Fixture} from '../round1-20261017/cases.js';
import {digest,root} from './runtime.js';
import {groups,loadings,type Case,type Prepared,type Entry} from './cases.js';
export const frozenCandidates={
 'map-only/map-annotations':'cb93a478a1523c9a75a8fcc110f5d0c068e07e862c8b4487409f42307f33eb46',
 'spatial-only/spatial-analysis':'1067b8a59d8ee792bec57cb8f50515f4d79e450cb7af14a902c1c3a146bcfbcd',
};
export function verifyHoldoutFreeze(){for(const [path,hash] of Object.entries(frozenCandidates))assert.equal(digest(readFileSync(join(root,'skills',path,'SKILL.md'))),hash,'Candidate changed after holdout authorship: this holdout is contaminated for further tuning');}
export const holdoutCases:Case[]=[
 {id:'H01',kind:'J01',targetSkill:'spatial-analysis',category:'overlap-capacity-vs-count',prompts:['只查询本会话地图。西区或东区任一区域内（含边界）的ready设备有几台、总capacity是多少？重叠部分的同一设备只计一次。列出纳入的设备并分别说明数量和容量，不保存。'],clarification:'unnecessary',objective:'answer'},
 {id:'H02',kind:'J10',targetSkill:'spatial-analysis',category:'historical-entry-exit-with-attribute-change',prompts:['比较引用的同一草稿固定第1版和第2版：仅按位置判断，哪些设备进入西区、哪些离开、哪些两版一直在区内？然后分别说明两版区内ready设备数量。不要用状态变化代替位置变化，含边界，只读。'],clarification:'unnecessary',objective:'answer',refs:true},
 {id:'H03',kind:'J01',targetSkill:'map-annotations',category:'equal-counts-different-identities-reference-not-exclusive',prompts:['本轮以甲组为参照比较乙组；比较并不限制只读甲组。分别列出西区内ready设备的完整对象标识，并判断两组数量和成员是否都相同。显示名称相同也不能当成同一设备。只分析，不修改。'],clarification:'unnecessary',objective:'answer'},
 {id:'H04',kind:'J07',targetSkill:'map-annotations',category:'move-origin-then-save-earlier-preview',prompts:['围绕本会话origin生成400米范围，先预览，不保存。','把origin移动到东侧备用点backup的真实位置，保留其名称和其他属性；然后将上一轮移动前预览的那个固定范围保存到派生图层，名称为原位置范围。不要重新计算范围，不发布、不设为当前。'],clarification:'unnecessary',objective:'answer'},
];
export const holdoutSchedule:Entry[]=holdoutCases.flatMap((c,i)=>loadings.flatMap((loading,k)=>groups.map((_,j)=>({id:`${c.id}-${loading}-${groups[(i+j+k)%3]}`,caseId:c.id,group:groups[(i+j+k)%3],loading,round:1,objective:c.objective,clarification:c.clarification,split:'holdout'}))));
export function holdoutLayers(id:string):AnnotationLayer[]{
 const point=(objectId:string,x:number,y:number,attributes?:AnnotationFeature['attributes'],name=objectId):AnnotationFeature=>({objectId,name,kind:'point',geometry:{type:'Point',coordinates:[130+x,-12+y]},...(attributes?{attributes}:{})});
 const area=(objectId:string,left:number,right:number):AnnotationFeature=>({objectId,name:objectId==='west'?'西区':'东区',kind:'polygon',geometry:{type:'Polygon',coordinates:[[[130+left,-12],[130+right,-12],[130+right,-11.98],[130+left,-11.98],[130+left,-12]]]}});
 const layer=(layerId:string,name:string,order:number,features:AnnotationFeature[]):AnnotationLayer=>({layerId,name,order,defaultVisible:true,features});
 const data=[point('a',.005,.01,{status:'ready',capacity:10}),point('b',.015,.01,{status:'ready',capacity:20}),point('c',.025,.01,{status:'ready',capacity:30}),point('d',.015,.015,{status:'busy',capacity:40}),point('e',.04,.01,{status:'ready',capacity:50})];
 return [layer('reference','参照',0,[point('origin',0,0),point('backup',.04,0),area('west',0,.02),area('east',.01,.03)]),
  layer('alpha','甲组',1,id==='H03'?[point('a',.005,.01,{status:'ready'},'重名点'),point('b',.015,.01,{status:'ready'},'另一点')]:data),
  layer('beta','乙组',2,id==='H03'?[point('u',.006,.011,{status:'ready'},'重名点'),point('v',.016,.011,{status:'ready'},'另一点')]:[]),layer('derived','派生',3,[])];
}
export async function prepareHoldout(m:MapTrialManifest,spec:Case):Promise<Prepared>{
 verifyHoldoutFreeze();
 const workspace=await mapTrialRequest<{id:string}>(m,`/api/tasks/${m.tasks.supply}/workspace`,'planning','POST',{});
 const sessionId=(await mapTrialRequest<{id:string}>(m,'/api/sessions','planning','POST',{workspaceId:workspace.id})).id;
 const receipt=await mapTrialRequest<AnnotationReceipt>(m,`/api/sessions/${sessionId}/annotation/actions`,'planning','POST',{action:'create_draft',clientActionId:randomUUID(),baseRef:null,title:'组合资料核对',operations:holdoutLayers(spec.id).map(layer=>({op:'add_layer',layer}))});
 const initial=await mapState(m,sessionId),receipts:unknown[]=[receipt];
 if(spec.id==='H02')receipts.push(await mapTrialRequest(m,`/api/sessions/${sessionId}/annotation/actions`,'planning','POST',{action:'apply',clientActionId:randomUUID(),expectedRevision:initial.binding.draft!.headRevision,operations:[
  {op:'update_object',objectId:'a',changes:{geometry:{type:'Point',coordinates:[130.025,-11.99]}}},
  {op:'update_object',objectId:'c',changes:{geometry:{type:'Point',coordinates:[130.01,-11.99]}}},
  {op:'update_object',objectId:'b',changes:{attributes:{status:'busy',capacity:20}}},
 ]}));
 const before=await mapState(m,sessionId);
 const truth:Record<string,unknown>={split:'holdout',caseId:spec.id,method:'Declared point identities, independent rectangle inequalities, integer attribute sums; exact generated geometry compared to actual prior result, not recomputed with production library',
  ...(spec.id==='H01'?{members:['a','b','c'],count:3,totalCapacity:60,overlap:['b'],excludedBusy:['d']}:{}),
  ...(spec.id==='H02'?{entered:['c'],left:['a'],stayed:['b','d'],readyCounts:{revision1:2,revision2:1}}:{}),
  ...(spec.id==='H03'?{alpha:['a','b'],beta:['u','v'],counts:{alpha:2,beta:2},sameCount:true,sameMembers:false}:{}),
  ...(spec.id==='H04'?{bufferDistanceM:400,saveLayer:'derived',saveName:'原位置范围',exactFirstPreview:true,originAfter:[130.04,-12],distanceMovedM:distance([130,-12],[130.04,-12]),retainOriginName:true}:{}),semanticReview:'pending'};
 const fixture:Fixture={kind:spec.kind,sessionId,workspaceId:workspace.id,before,setupReceipts:receipts,truth,...(spec.refs?{annotationRefs:[initial.version!.ref,before.version!.ref]}:{})};
 return {spec,fixture,prompts:spec.prompts,truth:{...truth,initialVersion:initial.version}};
}
