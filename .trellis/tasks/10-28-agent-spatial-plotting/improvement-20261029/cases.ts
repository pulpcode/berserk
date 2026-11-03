import {specs as originals,layers as originalLayers,repliesFor as originalReplies,prepare as originalPrepare,type CaseId as OriginalCase} from '../live-20261029/cases.js';
import type {Group} from './budget.js';
export const inheritance={T01:'P02',T02:'P01',T03:'S06',T04:'S06',T05:'P01',T06:'S02',T07:'P05',T08:'P06'} as const;
export type CaseId=keyof typeof inheritance;
export const ordered:CaseId[]=['T01','T07','T02','T03','T04','T05','T06','T08'];
const inherited=(id:CaseId)=>originals.find(s=>s.id===inheritance[id])!;
export const specs=ordered.map(id=>{
 const original=inherited(id);
 if(id==='T04')return {id,origin:'new_constructed',dataFrom:'S06',prompts:['只使用当前会话草稿reference层的港区和resources资源层，统计该港区内的点，列出名单和总数；不要查询来源系统，不修改地图。'],expected:{names:['岸边甲','栈桥乙','码头丙','港池丁'],count:4,sourceQueriesAllowed:false,noWrite:true,noUnnecessaryClarification:true}};
 if(id==='T05')return {id,origin:'new_constructed',dataFrom:'P01',prompts:['在当前草稿deployment层的[114,22.5]，只用普通圆点标记消防车甲的位置，不用专业符号；名称消防车甲，信息性质为方案，保存草稿，不发布、不采用。'],expected:{name:'消防车甲',point:[114,22.5],symbol:'circle',noSymbolId:true,informationRole:'plan',preserveOld:true,noUnnecessaryClarification:true}};
 return {...original,id,origin:'inherited',inheritedFrom:original.id,prompts:[...original.prompts]};
});
export function layers(id:CaseId){return originalLayers(inheritance[id]);}
export function runtimeCase(id:CaseId):OriginalCase{return inheritance[id];}
export function repliesFor(id:CaseId){
 if(id==='T04')return [{id:'scope',userTurn:0,text:'只用当前会话草稿reference层的港区和resources资源层，列出港区内点的名单总数；不查来源、不修改。',topic:'仅重述已明确的来源、图层、输出或操作要求，不用于引入新选择'}];
 if(id==='T05')return [{id:'details',userTurn:0,text:'普通圆点，不用专业符号；当前草稿deployment层；[114,22.5]；名称消防车甲；信息性质为方案，保存草稿，不发布、不采用。',topic:'仅重述题干明确的普通点、坐标、图层、名称或性质，不选择任何专业车型'}];
 return originalReplies(inheritance[id]);
}
export const schedule=[1,2].flatMap(repeat=>ordered.flatMap((caseId,i)=>{
 const groups:Group[]=['G0','G1','G2'],offset=(i+repeat-1)%3;
 return [...groups.slice(offset),...groups.slice(0,offset)].map(group=>({id:`${caseId}-R${repeat}-${group}`,caseId,repeat,group}));
}));
export async function prepare(...args:[Parameters<typeof originalPrepare>[0],CaseId]){
 const [manifest,caseId]=args,original=await originalPrepare(manifest,inheritance[caseId]);const spec=specs.find(s=>s.id===caseId)!;
 return {...original,caseId,sourceCase:inheritance[caseId],prompts:spec.prompts,replies:repliesFor(caseId),expected:spec.expected};
}
export type Prepared=Awaited<ReturnType<typeof prepare>>;
