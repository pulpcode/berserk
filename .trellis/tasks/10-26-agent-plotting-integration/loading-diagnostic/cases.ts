/** Development diagnostic inputs, never installed into a runtime workspace. */
import {cases as originalCases} from '../evaluation-v2/cases.js';
const original=(id:string)=>originalCases.find(c=>c.id===id)!.prompts[0];
export const cases=[
 {id:'T1',fixture:'C02',prompt:original('C02'),read:'all',kind:'ambiguous-type'},
 {id:'T2',fixture:'C02',prompt:'在本会话草稿部署图层(layerId=deployment)的[114,22.5]放置一个水罐消防车图标，作为方案保存，不发布、不采用。',read:'all',kind:'explicit-type'},
 {id:'R1',fixture:'C10',prompt:original('C10'),read:'origin',kind:'filtered-scope'},
 {id:'R2',fixture:'C10',prompt:'读取本会话完整草稿，报告全部标绘对象的总数和名称，只查询不修改。',read:'all',kind:'complete-scope'},
 {id:'S1',fixture:'C01',prompt:original('C01'),read:'all',kind:'catalog-extra-claims'},
 {id:'S2',fixture:'C01',prompt:'说明当前系统图标目录中救护车、冲锋舟、消防艇各自属于标准符号还是应用扩展，只查询不修改。',read:'all',kind:'catalog-explicit-scope'},
] as const;
export type Group='A'|'B';
export const schedule=cases.flatMap(c=>([1,2] as const).flatMap(round=>(round===1?['A','B'] as const:['B','A'] as const).map(group=>({id:`${c.id}-${group}-${round}`,caseId:c.id,group,round}))));
export const proposedLimits={requests:120,input:4_000_000,output:200_000} as const;
