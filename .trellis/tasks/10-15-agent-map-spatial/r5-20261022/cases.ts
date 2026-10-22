/** Eight discovery trials. Reworded labels remain public development cases, not holdouts. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {cases as prior,prepareCase as preparePrior} from '../r3-20261022/cases.js';
import {mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import type {AnnotationAction} from '../../../../experiments/harness-lab/src/contracts/annotations.js';
import type {Case,Prepared} from '../r3-20261022/cases.js';
export {introduceConflict} from '../r3-20261022/cases.js';
export type {Case,Prepared};
export type Group='A'|'B';
export type Loading='native'|'explicit';
export const labels={A:'L0',B:'L1'} as const;
export interface Entry {id:string;caseId:string;group:Group;loading:Loading;round:1;objective:Case['objective'];clarification:Case['clarification'];split:'development'}
const ids=['D02','D05','D16','N01'];
export const cases:Case[]=ids.map(id=>id==='N01'
 ?{id,kind:'J01',targetSkill:'map-annotations',category:'no-method-needed',prompts:['只回复“收到”，不要查询地图或使用工具。'],clarification:'unnecessary',objective:'answer'}
 :structuredClone(prior.find(c=>c.id===id)!));
/** Staged diagnostic: any accepted method before the actual related decision; no compulsory loading gate. */
export const expectedMethods={
 D02:[{stage:'before_nearest_or_unnecessary_clarification',anyOf:['spatial-analysis','map-annotations']}],
 D05:[{stage:'before_buffer_or_filter',anyOf:['spatial-analysis']}],
 D16:[{stage:'before_first_buffer',anyOf:['spatial-analysis']},{stage:'before_save_decision',anyOf:['map-annotations']}],
 N01:[],
};
export const schedule:Entry[]=cases.flatMap((c,i)=>(i%2?['B','A'] as const:['A','B'] as const).map(group=>({id:`${c.id}-${labels[group]}`,caseId:c.id,group,loading:'native',round:1,objective:c.objective,clarification:c.clarification,split:'development'})));
export const prepareCase:typeof preparePrior=async(manifest,spec)=>{
 const result=await preparePrior(manifest,spec);
 if(spec.id==='N01'){result.truth={...result.truth,exactReply:'收到',noTools:true,noWrites:true};return result;}
 const names:Record<string,string>={r1:'海岬支援点',r2:'白沙支援点',r3:'南堤支援点'};
 const features=result.fixture.before.version!.document.layers.flatMap(l=>l.features),oldGeometry=features.map(f=>f.geometry);
 const input:AnnotationAction={action:'apply',clientActionId:randomUUID(),expectedRevision:result.fixture.before.binding.draft!.headRevision,operations:features.filter(f=>names[f.objectId]).map(f=>({op:'update_object' as const,objectId:f.objectId,changes:{name:names[f.objectId]}}))};
 await mapTrialRequest(manifest,`/api/sessions/${result.fixture.sessionId}/annotation/actions`,'planning','POST',input);
 result.fixture.before=await mapState(manifest,result.fixture.sessionId);
 assert.deepEqual(result.fixture.before.version!.document.layers.flatMap(l=>l.features).map(f=>f.geometry),oldGeometry);
 result.truth={...result.truth,fixtureVariant:'r5-development-renamed-resource-points',objectNames:names};result.fixture.truth=result.truth;
 return result;
};
