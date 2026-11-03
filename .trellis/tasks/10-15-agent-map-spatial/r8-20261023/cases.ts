/** Identical six R7 development cases, only loading condition changes. */
import {schedule as explicitSchedule,cases} from '../r7-20261023/cases.js';
export {cases,prepareCase,introduceConflict,labels} from '../r7-20261023/cases.js';
export type {Case,Prepared,Group} from '../r7-20261023/cases.js';
export type Loading='native';
export type Entry=Omit<typeof explicitSchedule[number],'loading'>&{loading:Loading};
export const schedule:Entry[]=explicitSchedule.map(e=>({...e,loading:'native'}));
export const expectedMethods=Object.fromEntries(cases.map(c=>[c.id,{targetSkill:c.targetSkill,loading:'on_demand_not_required_for_score'}]));
