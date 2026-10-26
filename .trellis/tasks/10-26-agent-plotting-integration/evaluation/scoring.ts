/** Summarizes independently reviewed evidence; never turns a successful request into a semantic pass. */
import assert from 'node:assert/strict';
import {schedule} from './cases.js';
export interface Review {id:string;reviewer:string;evidence:string[];completed:boolean;coreCorrect:boolean;processFacts:boolean;finalFacts:boolean;effectsCorrect:boolean;withinScope:boolean;criticalErrors:string[]}
export interface Outcome {id:string;status:string}
export const strict=(r:Review)=>r.completed&&r.coreCorrect&&r.processFacts&&r.finalFacts&&r.effectsCorrect&&r.withinScope&&r.criticalErrors.length===0;
export function summarize(outcomes:Outcome[],reviews:Review[],engineeringPassed:boolean){
 assert.equal(new Set(outcomes.map(o=>o.id)).size,outcomes.length,'Duplicate outcomes');assert.equal(new Set(reviews.map(r=>r.id)).size,reviews.length,'Duplicate reviews');
 const ids=new Set(schedule.map(e=>e.id));for(const r of reviews){assert.ok(ids.has(r.id),'Unscheduled review');assert.ok(r.reviewer.trim()&&r.evidence.length,'Review requires attribution and actual evidence');}
 for(const o of outcomes)assert.ok(ids.has(o.id),'Unscheduled outcome');
 const rows=schedule.map(entry=>{const outcome=outcomes.find(o=>o.id===entry.id),review=reviews.find(r=>r.id===entry.id);return {...entry,status:outcome?.status??'not_executed',reviewed:!!review,strict:!!review&&strict(review),criticalErrors:review?.criticalErrors??[]};});
 const unresolved=rows.filter(r=>r.status!=='recorded'||!r.reviewed).map(r=>r.id),newRows=rows.filter(r=>r.caseId.startsWith('C')),newStrict=newRows.filter(r=>r.strict).length,totalStrict=rows.filter(r=>r.strict).length;
 const everyNewCasePassed=Array.from(new Set(newRows.map(r=>r.caseId))).every(id=>newRows.some(r=>r.caseId===id&&r.strict));
 const criticalErrors=rows.flatMap(r=>r.criticalErrors.map(error=>({id:r.id,error})));
 return {planned:30,newPlanned:20,totalStrict,newStrict,unresolved,criticalErrors,everyNewCasePassed,engineeringPassed,recommendIntegration:engineeringPassed&&!unresolved.length&&!criticalErrors.length&&everyNewCasePassed&&newStrict>=18&&totalStrict>=27,claim:'Development acceptance only; not an independent 90% holdout reliability claim',rows};
}
