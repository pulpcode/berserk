/** Exactly three frozen R7/R8 cases, B/native, three independent repetitions. */
import {cases as prior} from '../r8-20261023/cases.js';
import type {Entry as PriorEntry} from '../r8-20261023/cases.js';
export {prepareCase,introduceConflict,labels} from '../r8-20261023/cases.js';
export type {Case,Prepared} from '../r8-20261023/cases.js';
export const cases=['D17','D02','D23'].map(id=>prior.find(c=>c.id===id)!);
export type Entry=Omit<PriorEntry,'round'|'group'>&{round:1|2|3;group:'B'};
export const schedule:Entry[]=([1,2,3] as const).flatMap(round=>cases.map(c=>({id:`${c.id}-R${round}-B`,caseId:c.id,group:'B',loading:'native',round,objective:c.objective,clarification:c.clarification,split:'development'})));
export const expectedMethods=Object.fromEntries(cases.map(c=>[c.id,{targetSkill:c.targetSkill,loading:'on_demand_not_required_for_score'}]));
