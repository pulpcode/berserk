import {acceptanceCase as oldCase,type CaseId as OldId,type AcceptanceTurn} from '../11-03-resource-independent-acceptance/cases.js';
export type CaseId='P01'|'P02'|'D01'|'D02'|'D03'|'D04'|'D05'|'D06';
export type Group='A'|'B';
export type {AcceptanceTurn};
export interface HumanFact {id:string;topic:'region'|'boundary';value:string;objectId?:string;acceptableForms:string[];rule:string}
export interface AcceptanceCase {id:CaseId;phase:'public'|'formal';title:string;taskTitle:string;taskGoal:string;turns:AcceptanceTurn[];humanFacts:HumanFact[]}
export const fixtureCase:Record<CaseId,OldId>={P01:'N08',P02:'N06',D01:'N02',D02:'N05',D03:'N06',D04:'N07',D05:'N08',D06:'N08'};
export function acceptanceCase(id:CaseId):AcceptanceCase {
 const old=oldCase(fixtureCase[id]);const c:AcceptanceCase={...old,id,phase:id.startsWith('P')?'public':'formal',taskTitle:'范围与模型对照·'+id,humanFacts:old.humanFacts};
 if(id==='P01')c.turns=[{text:'只看我引用的测试图层，列出其中所有点的名称和坐标。',annotationSelections:[{layerIds:['n08-target']}]},{text:'沿用刚才的固定图层再列一次。'}];
 if(id==='D06')c.turns=[{...old.turns[0],text:'只看我引用的“沚灯现场图层”中的实际资源，列出名称和位置。'},{text:'这次改看“榆岚外部台账”的资源，列出名称和实际位置；不要沿用刚才的标绘图层。'}];
 if(id==='P02'||id==='D03')c.humanFacts.push({id:'boundary',topic:'boundary',value:'是，指区域边界线上的资源，与严格内部的资源分开列出。',acceptableForms:['确认边界单列的含义'],rule:'仅实际询问题干已有边界口径时确认，不附送区域偏好。'});
 return c;
}
export const acceptanceCases=(Object.keys(fixtureCase) as CaseId[]).map(acceptanceCase);
export const schedule=[...(['P01','P02'] as CaseId[]).flatMap(caseId=>(['A','B'] as Group[]).map(group=>({id:`${caseId}-${group}-1`,caseId,group,repeat:1 as const,phase:'public' as const}))),...([1,2] as const).flatMap(repeat=>{const cases=acceptanceCases.filter(c=>c.phase==='formal').map(c=>c.id);return (repeat===1?cases:cases.reverse()).flatMap(caseId=>(repeat===1?['A','B']:['B','A']).map(group=>({id:`${caseId}-${group}-${repeat}`,caseId,group:group as Group,repeat,phase:'formal' as const})));})];
