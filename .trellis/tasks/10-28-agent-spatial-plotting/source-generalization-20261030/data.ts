import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {mapTrialRequest,type MapTrialManifest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import type {AnnotationLayer,AnnotationReceipt} from '../../../../experiments/harness-lab/src/contracts/annotations.js';
import type {SituationObject} from '../../../../experiments/harness-lab/src/contracts/context.js';
export const root=fileURLToPath(new URL('.',import.meta.url));
const read=<T>(path:string)=>JSON.parse(readFileSync(path,'utf8')) as T;
export type Axis='candidate'|'reference';
export type Source='draft'|'source';
export interface Fixture {case_id:string;logical_source_system_id:string;business_time:string;draftLayers:AnnotationLayer[];sourceScene:{objects:SituationObject[];reports:[];asOf:string}}
export interface Oracle {declared_scope:Record<Axis,Source|null>;initial_unknown_axes:Axis[];preferred_scope_if_asked:Record<Axis,Source>;clarification:{replies_by_axis:Record<Axis,string>;reply_both:string};combinations:Record<string,{candidate_ids:string[];target_id:string;interior_ids:string[];boundary_ids:string[];exterior_ids:string[];count:number}>}
export const cases=read<{cases:Array<{id:string;prompt:string;fixture:string}>}>(join(root,'input/review-copy/cases/main.json')).cases;
export const schedule=cases.map(c=>({id:c.id,caseId:c.id,group:'A' as const}));
export function fixture(id:string):Fixture {assert.ok(cases.some(c=>c.id===id));return read(join(root,'input/review-copy/fixtures/main',id+'.json'));}
/** Evaluation only: never import the oracle into product runtime or model input. */
export function oracle(id:string):Oracle {assert.ok(cases.some(c=>c.id===id));return read(join(root,'input/review-copy/oracles/main',id+'.json'));}
export function sourceScene(id:string){const f=fixture(id);return JSON.parse(JSON.stringify(f.sourceScene).split(f.logical_source_system_id).join('situation')) as Fixture['sourceScene'];}
export async function prepare(m:MapTrialManifest,id:string){
 const f=fixture(id),spec=cases.find(c=>c.id===id)!;
 const workspaceId=(await mapTrialRequest<{id:string}>(m,`/api/tasks/${m.tasks.supply}/workspace`,'planning','POST',{})).id;
 const sessionId=(await mapTrialRequest<{id:string}>(m,'/api/sessions','planning','POST',{workspaceId})).id;
 const receipt=await mapTrialRequest<AnnotationReceipt>(m,`/api/sessions/${sessionId}/annotation/actions`,'planning','POST',{action:'create_draft',clientActionId:randomUUID(),baseRef:null,title:'空间资料',operations:f.draftLayers.map(layer=>({op:'add_layer',layer}))});
 const sourceBefore=await mapTrialRequest(m,'/api/simulation','overall'),before=await mapState(m,sessionId);assert.deepEqual(before.version!.document.layers,f.draftLayers);
 return {caseId:id,workspaceId,sessionId,prompt:spec.prompt,before,sourceBefore,receipt,sourceMapping:{[f.logical_source_system_id]:'situation'}};
}
export type Prepared=Awaited<ReturnType<typeof prepare>>;
