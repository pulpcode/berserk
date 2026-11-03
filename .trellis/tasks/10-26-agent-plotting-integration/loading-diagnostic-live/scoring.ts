import assert from 'node:assert/strict';
import {schedule} from '../loading-diagnostic/cases.js';
import {strict,type Review,type Outcome} from '../evaluation-v2/scoring.js';
export type {Review};
/** Diagnostic comparison only, no integration pass threshold or causal claim. */
export function summarize(outcomes:Outcome[],reviews:Review[]){
 assert.equal(new Set(outcomes.map(o=>o.id)).size,outcomes.length,'Duplicate outcomes');assert.equal(new Set(reviews.map(r=>r.id)).size,reviews.length,'Duplicate reviews');
 const ids=new Set<string>(schedule.map(e=>e.id));for(const o of outcomes)assert.ok(ids.has(o.id),'Unscheduled outcome');for(const r of reviews){assert.ok(ids.has(r.id)&&r.reviewer.trim()&&r.evidence.length,'Review requires scheduled ID, attribution and evidence');assert.ok(outcomes.some(o=>o.id===r.id&&['recorded','waiting_user','needs_review','incomplete','failed'].includes(o.status)),'Review requires an actually executed outcome');}
 const rows=schedule.map(entry=>{const o=outcomes.find(o=>o.id===entry.id),r=reviews.find(r=>r.id===entry.id);return {...entry,status:o?.status??'not_executed',reviewed:!!r,strict:!!r&&strict(r),criticalErrors:r?.criticalErrors??[]};});
 return {planned:24,groups: (['A','B'] as const).map(group=>({group,planned:12,strict:rows.filter(r=>r.group===group&&r.strict).length})),unresolved:rows.filter(r=>r.status!=='recorded'||!r.reviewed).map(r=>r.id),rows,claim:'Development diagnostic; no automatic causal attribution, integration approval or reliability estimate'};
}
