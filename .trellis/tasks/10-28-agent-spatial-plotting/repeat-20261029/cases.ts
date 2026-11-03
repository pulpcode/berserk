import {specs as originalSpecs,type CaseId} from '../live-20261029/cases.js';
import type {Group} from './budget.js';
export {layers,repliesFor,prepare,injectConflict,type Prepared} from '../live-20261029/cases.js';
export const ordered:CaseId[]=['P02','S02','P05','P01','S01'];
export const specs=ordered.map(id=>originalSpecs.find(s=>s.id===id)!);
export const schedule=[1,2,3].flatMap(repeat=>ordered.flatMap((caseId,i)=>(((repeat-1)*ordered.length+i)%2?['B','A']:['A','B']).map(group=>({id:`${caseId}-R${repeat}-${group}`,caseId,repeat,group:group as Group}))));
