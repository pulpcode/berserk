/** Frozen 12-entry smoke: evaluation fixtures never enter product methods. */
import {cases as prior, prepareCase as preparePrior} from '../r3-20261022/cases.js';
import type {Case, Prepared} from '../r3-20261022/cases.js';
export {introduceConflict} from '../r3-20261022/cases.js';
export type {Case, Prepared};
export type Group = 'A' | 'B';
export type Loading = 'native' | 'explicit';
export interface Entry {id:string;caseId:string;group:Group;loading:Loading;round:1;objective:Case['objective'];clarification:Case['clarification'];split:'development'}
const ids = ['D02','D05','D16','N01','D11','D17'];
export const cases:Case[] = ids.map(id => id === 'N01'
  ? {id,kind:'J01',targetSkill:'map-annotations',category:'no-method-needed',prompts:['只回复“收到”，不要查询地图或使用工具。'],clarification:'unnecessary',objective:'answer'}
  : structuredClone(prior.find(c=>c.id===id)!));
export const expectedMethods:Record<string,string[]> = {D02:['map-annotations'],D05:['map-annotations','spatial-analysis'],D16:['map-annotations','spatial-analysis'],N01:[],D11:['map-annotations'],D17:['spatial-analysis']};
export const schedule:Entry[] = cases.flatMap((c,i)=>(i%2?['B','A'] as const:['A','B'] as const).map(group=>({id:`${c.id}-${group}`,caseId:c.id,group,loading:['D11','D17'].includes(c.id)?'explicit':'native',round:1,objective:c.objective,clarification:c.clarification,split:'development'})));
export const prepareCase:typeof preparePrior = async (manifest,spec)=>{
 const result=await preparePrior(manifest,spec);
 if(spec.id==='N01')result.truth={...result.truth,exactReply:'收到',noTools:true,noWrites:true};
 return result;
};
