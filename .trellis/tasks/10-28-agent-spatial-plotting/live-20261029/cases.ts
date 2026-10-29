import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mapTrialRequest,type MapTrialManifest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import type {AnnotationFeature,AnnotationLayer,AnnotationReceipt} from '../../../../experiments/harness-lab/src/contracts/annotations.js';
import {newLayers,O,Z} from '../../10-15-agent-map-spatial/r15-20261027/data.js';
import {initialLayers} from '../../10-26-agent-plotting-integration/evaluation-v2/cases.js';
import type {Group} from './budget.js';
const point=(objectId:string,name:string,coordinates:[number,number]):AnnotationFeature=>({objectId,name,kind:'point',geometry:{type:'Point',coordinates}});
const layer=(layerId:string,name:string,features:AnnotationFeature[]):AnnotationLayer=>({layerId,name,features,order:0,defaultVisible:true});
const reference=()=>layer('reference','参照对象',[point('origin','基点',O)]);
export const specs=[
 {id:'S01',prompts:['以当前草稿reference层对象ID origin生成500米预览，不保存；说明输入点数量。'],expected:{inputCount:1,fullLayerCount:4,noWrite:true}},
 {id:'S02',prompts:['先列当前草稿reference层全部点名和总数，再以该层对象ID origin生成500米预览，不保存。'],expected:{names:['基点','参照甲','参照乙','参照丙'],total:4,inputCount:1,noWrite:true}},
 {id:'S03',prompts:['以当前草稿reference层对象ID origin为参照，在当前草稿resources层三个候选中找最近两个，列名单和距离，不修改。'],expected:{candidateCount:3,names:['候选甲','候选乙'],distancesM:[100.0755722101796,200.1511444203592],toleranceM:2,noWrite:true}},
 {id:'S04',prompts:['以当前草稿reference层对象ID origin为中心生成700米范围，只预览不保存。','仍以当前草稿reference层对象ID origin为中心，生成1200米范围，只预览不保存。','保存最初700米固定范围到当前草稿derived层，名为值守圈，不重新计算，不发布、不采用。'],expected:{previewDistances:[700,1200],saveOriginalRadius:700,name:'值守圈',layer:'derived',noRecomputeOnSave:true}},
 {id:'S05',prompts:['以当前草稿reference层的对象ID patrol-area为区域，筛选当前草稿resources层中位于该区域内的候选点，列名单数量，不修改。'],expected:{regionId:'patrol-area',regionName:'巡查区',names:['巡查甲','巡查乙'],count:2,noWrite:true}},
 {id:'S06',prompts:['本会话港区内几个资源点，只分析。'],reply:'按当前会话草稿的港区和资源层。',expected:{draftCount:4,draftNames:['岸边甲','栈桥乙','码头丙','港池丁'],sourceCount:1,sourceNames:['来源港车甲'],accepted:'clarify_then_draft_or_complete_labeled_conditionals',noWrite:true}},
 {id:'P01',prompts:['在当前草稿deployment层的[114,22.5]添加水罐消防车，名称消防车甲，信息性质为方案，保存草稿；不发布、不采用。'],expected:{name:'消防车甲',point:[114,22.5],symbolId:'xf3013-2020.6.2.1',informationRole:'plan',preserveOld:true}},
 {id:'P02',prompts:['在当前草稿deployment层的[114,22.5]添加消防车，名称消防车甲，信息性质为方案，保存草稿；不发布、不采用。'],reply:'水罐消防车',expected:{clarifyBeforeWrite:true,name:'消防车甲',point:[114,22.5],symbolId:'xf3013-2020.6.2.1',informationRole:'plan',preserveOld:true}},
 {id:'P03',prompts:['把当前草稿deployment层对象ID target的冲锋舟改成朝东，其他不变，保存草稿，不发布、不采用。'],expected:{heading:90,preserveOtherFields:true}},
 {id:'P04',prompts:['把当前草稿deployment层对象ID target的冲锋舟改成朝东，其他不变，保存草稿，不发布、不采用。'],expected:{heading:90,note:'人工补充：入口已核实，请保留',conflictRequired:true,preserveOtherFields:true}},
 {id:'P05',prompts:['以当前草稿reference层对象ID origin为中心生成700米范围，只预览不保存。','将刚才700米固定范围保存到当前草稿derived层，名称临时范围，信息性质设为方案，并加备注“待核实”，不发布、不采用。'],expected:{radius:700,name:'临时范围',informationRole:'plan',note:'待核实',browserSameObject:true}},
 {id:'P06',prompts:['系统当前目录中的水罐消防车、消防直升机、冲锋舟分别属于标准符号还是应用扩展？只查目录，不改地图。'],expected:{水罐消防车:'standard',消防直升机:'standard',冲锋舟:'extension',noWrite:true,noExternalStandardInference:true}}
] as const;
export type CaseId=typeof specs[number]['id'];
export const cases=specs;
export const ordered:CaseId[]=['S04','P02','S01','S02','S03','S05','S06','P01','P03','P04','P05','P06'];
export const schedule=ordered.flatMap((caseId,i)=>(i%2?['B','A']:['A','B']).map(g=>({id:caseId+'-'+g,caseId,group:g as Group})));
export function layers(id:CaseId):AnnotationLayer[]{
 let result:AnnotationLayer[];
 if(id==='S01'||id==='S02')result=newLayers('P05');
 else if(id==='S06')result=newLayers('P01');
 else if(id==='S03')result=[reference(),layer('resources','资源层',[point('r-a','候选甲',[114,22.5009]),point('r-b','候选乙',[114,22.5018]),point('r-c','候选丙',[114,22.5027])])];
 else if(id==='S05')result=[layer('reference','参照对象',[{objectId:'patrol-area',name:'巡查区',kind:'polygon',geometry:structuredClone(Z)}]),layer('resources','资源层',[point('r-a','巡查甲',[114.005,22.505]),point('r-b','巡查乙',[114.015,22.515]),point('r-c','外港丙',[114.03,22.51])])];
 else if(id==='P03'||id==='P04')result=initialLayers('C03');
 else if(id==='S04'||id==='P05')result=[reference(),layer('derived','派生层',[point('existing','既有记录',[114.04,22.54])])];
 else result=[layer('deployment','部署图层',[point('old','既有标注',[114.02,22.52])])];
 return structuredClone(result.map((v,order)=>({...v,order})));
}
export function repliesFor(id:CaseId){
 const choices:Record<string,Array<{id:string;userTurn:number;text:string;topic:string}>>={
 S01:[{id:'input',userTurn:0,text:'当前草稿reference层对象ID origin，500米，只预览不保存。',topic:'中心、半径或输入范围'}],
 S02:[{id:'scope',userTurn:0,text:'统计当前草稿reference全层；500米预览以同层origin为中心，不保存。',topic:'统计范围、中心或半径'}],
 S03:[{id:'scope',userTurn:0,text:'参照为当前草稿reference层origin，候选为当前草稿resources层三个点，取最近两个。',topic:'参照、候选范围或数量'}],
 S04:[{id:'first',userTurn:0,text:'当前草稿reference层origin，700米，只预览。',topic:'中心或半径'}, {id:'second',userTurn:1,text:'当前草稿reference层origin，1200米，只预览。',topic:'中心或半径'}, {id:'save',userTurn:2,text:'最初700米固定范围，保存到当前草稿derived层，名称值守圈，不重新计算，不发布、不采用。',topic:'保存哪次结果、目标层、名称或保存授权'}],
 S05:[{id:'scope',userTurn:0,text:'区域是当前草稿reference层对象ID patrol-area；候选是当前草稿resources层，不修改。',topic:'区域或候选范围'}],
 S06:[{id:'declared-choice',userTurn:0,text:'按当前会话草稿的港区和资源层。',topic:'草稿还是来源系统'}],
 P01:[{id:'details',userTurn:0,text:'水罐消防车；当前草稿deployment层；[114,22.5]；名称消防车甲；信息性质为方案，保存草稿，不发布、不采用。',topic:'题干已有车型、坐标、图层、名称或性质'}],
 P02:[{id:'declared-choice',userTurn:0,text:'水罐消防车',topic:'消防车具体类型'}, {id:'details',userTurn:0,text:'当前草稿deployment层；[114,22.5]；名称消防车甲；信息性质为方案，保存草稿，不发布、不采用。',topic:'已有坐标、图层、名称或性质，不用于回答车型'}],
 P03:[{id:'direction',userTurn:0,text:'当前草稿deployment层target改为朝东，其他不变；保存草稿，不发布、不采用。',topic:'对象、方向或保存要求'}],
 P04:[{id:'direction',userTurn:0,text:'仍将当前草稿deployment层target改为朝东，其他内容保留，保存草稿，不发布、不采用。',topic:'对象、方向或是否继续既定修改'}],
 P05:[{id:'preview',userTurn:0,text:'当前草稿reference层origin，700米，只预览不保存。',topic:'中心或半径'}, {id:'save',userTurn:1,text:'刚才700米固定范围；当前草稿derived层；名称临时范围；信息性质为方案；备注待核实；不发布、不采用。',topic:'固定结果、图层、名称、性质或备注'}],
 P06:[{id:'scope',userTurn:0,text:'只问系统当前目录中的水罐消防车、消防直升机、冲锋舟，属于标准符号还是应用扩展；不改地图。',topic:'目录范围或查询对象'}]
 };return choices[id];
}
export async function prepare(m:MapTrialManifest,caseId:CaseId){
 const spec=specs.find(s=>s.id===caseId)!;
 const workspaceId=(await mapTrialRequest<{id:string}>(m,`/api/tasks/${m.tasks.supply}/workspace`,'planning','POST',{})).id;
 const sessionId=(await mapTrialRequest<{id:string}>(m,'/api/sessions','planning','POST',{workspaceId})).id;
 const receipt=await mapTrialRequest<AnnotationReceipt>(m,`/api/sessions/${sessionId}/annotation/actions`,'planning','POST',{action:'create_draft',clientActionId:randomUUID(),baseRef:null,title:'空间标绘整合对照',operations:layers(caseId).map(l=>({op:'add_layer',layer:l}))});
 const sourceBefore=await mapTrialRequest(m,'/api/simulation','overall');const before=await mapState(m,sessionId);assert.deepEqual(before.version!.document.layers,layers(caseId));
 return {caseId,workspaceId,sessionId,sourceBefore,replies:repliesFor(caseId),prompts:[...spec.prompts],reply:'reply'in spec?spec.reply:undefined,expected:spec.expected,before,receipt};
}
export type Prepared=Awaited<ReturnType<typeof prepare>>;
export async function injectConflict(m:MapTrialManifest,p:Prepared){const before=await mapState(m,p.sessionId);return mapTrialRequest<AnnotationReceipt>(m,`/api/sessions/${p.sessionId}/annotation/actions`,'planning','POST',{action:'apply',clientActionId:randomUUID(),expectedRevision:before.binding.draft!.headRevision,operations:[{op:'update_object',objectId:'target',changes:{note:'人工补充：入口已核实，请保留'}}]});}
