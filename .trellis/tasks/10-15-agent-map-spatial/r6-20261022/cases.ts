/** Fixed execution smoke: one explicitly selected method, 4 development cases x 3 groups. */
import {cases as prior} from '../r3-20261022/cases.js';
export {prepareCase,introduceConflict} from '../r5-20261022/cases.js';
export type {Case,Prepared} from '../r3-20261022/cases.js';
import type {Case} from '../r3-20261022/cases.js';
export const groups=['E0','E1','E2'] as const;
export type Group=typeof groups[number];
export type Loading='explicit';
export interface Entry {id:string;caseId:string;group:Group;loading:Loading;round:1;objective:Case['objective'];clarification:Case['clarification'];split:'development'}
export const labels={E0:'E0',E1:'E1',E2:'E2'} as const;
export const cases:Case[]=['D02','D11','D17','D16'].map(id=>structuredClone(prior.find(c=>c.id===id)!));
export const schedule:Entry[]=cases.flatMap((c,i)=>groups.map((_,j)=>{const group=groups[(i+j)%groups.length];return {id:`${c.id}-${group}`,caseId:c.id,group,loading:'explicit',round:1,objective:c.objective,clarification:c.clarification,split:'development'};}));
export const expectedMethods=Object.fromEntries(cases.map(c=>[c.id,[{stage:'first_request_each_user_turn',anyOf:[c.targetSkill]}]]));
export const clarificationProtocol={caseId:'D11',kind:'ordinary' as const,answer:cases.find(c=>c.id==='D11')!.answer!,apiContract:'not_applicable' as const};
