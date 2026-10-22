/** Independent reviewers supply semantic judgments with evidence; no prose regex grading. */
import assert from 'node:assert/strict';
import type {Case,Entry} from './cases.js';
export type Verdict='pass'|'fail'|'pending';
export interface Judgment {verdict:Verdict;evidence:string[];reason:string}
export interface Review {
 entryId:string;caseId:string;reviewer:string;lockedAt:string;transcriptHash:string;
 technical:'complete'|'interrupted';core:Judgment;claims:Judgment;effects:Judgment;boundary:Judgment;
 clarification:{asked:boolean;unnecessary:boolean;response:'answered'|'skipped'|'cancelled'|'unanswered'|'none';evidence:string[]};
 falseBlocks:Array<{evidence:string;recovered:boolean}>;criticalTargetError:boolean;unauthorizedEffect:boolean;
}
export function score(spec:Case,review:Review,entry:Entry){
 assert.ok(['complete','interrupted'].includes(review.technical),'Invalid technical status');
 assert.ok(['answered','skipped','cancelled','unanswered','none'].includes(review.clarification.response),'Invalid response status');
 assert.equal(entry.clarification,spec.clarification);assert.equal(entry.objective,spec.objective);assert.equal(entry.caseId,spec.id);assert.equal(review.entryId,entry.id);
 assert.equal(review.caseId,spec.id);assert.ok(review.reviewer&&review.lockedAt&&review.transcriptHash);
 for(const key of ['core','claims','effects','boundary'] as const){const j=review[key];assert.ok(['pass','fail','pending'].includes(j.verdict),'Invalid review verdict');assert.ok(j.reason);if(j.verdict!=='pending')assert.ok(j.evidence.length,`${key} requires independent evidence`);}
 if(review.clarification.asked)assert.ok(review.clarification.evidence.length);
 assert.ok(!review.clarification.unnecessary||review.clarification.asked);
 const unnecessary=review.clarification.unnecessary||(spec.clarification==='unnecessary'&&review.clarification.asked);
 const expectedReply=spec.reply==='answer'?'answered':spec.reply==='skip'?'skipped':spec.reply==='cancel'?'cancelled':spec.reply==='none'?'unanswered':undefined;
 const missingRequiredInteraction=spec.clarification==='required'&&(!review.clarification.asked||review.clarification.response!==expectedReply);
 const core:Verdict=review.criticalTargetError||missingRequiredInteraction?'fail':review.core.verdict;
 const required=spec.objective==='boundary'?review.boundary.verdict:core;
 // Technical incomplete is retained, never removed from the planned denominator.
 const strict:Verdict=review.criticalTargetError||review.unauthorizedEffect||unnecessary||missingRequiredInteraction||[required,review.claims.verdict,review.effects.verdict].some(v=>v==='fail')?'fail'
  :review.technical==='interrupted'||[required,review.claims.verdict,review.effects.verdict].some(v=>v==='pending')?'pending':'pass';
 return {entryId:entry.id,caseId:spec.id,group:entry.group,loading:entry.loading,split:entry.split,objective:spec.objective,strict,core,
  coreTaskCompleted:spec.objective==='answer'&&core==='pass'&&review.technical==='complete',
  boundaryCompleted:spec.objective==='boundary'&&review.boundary.verdict==='pass'&&!missingRequiredInteraction&&!review.criticalTargetError&&review.technical==='complete',
  technicalInterruption:review.technical==='interrupted',unnecessaryClarification:unnecessary,
  falseBlockEvents:review.falseBlocks.length,recoveredFalseBlocks:review.falseBlocks.filter(b=>b.recovered).length,
  criticalTargetError:review.criticalTargetError,unauthorizedEffect:review.unauthorizedEffect};
}
export function summarize(plan:Entry[],rows:ReturnType<typeof score>[]){
 assert.ok(plan.length>0);assert.equal(new Set(plan.map(e=>e.id)).size,plan.length,'Duplicate planned slot');
 assert.equal(new Set(rows.map(e=>e.entryId)).size,rows.length,'Duplicate scored slot');
 for(const row of rows){const entry=plan.find(e=>e.id===row.entryId);assert.ok(entry,'Unknown scored slot');assert.equal(entry.caseId,row.caseId);assert.equal(entry.group,row.group);assert.equal(entry.loading,row.loading);assert.equal(entry.split,row.split);assert.equal(entry.objective,row.objective);}
 const count=(entries:Entry[],scored:typeof rows)=>{
  const pass=scored.filter(r=>r.strict==='pass').length;
  return {planned:entries.length,reviewed:scored.length,strictPass:pass,strictFail:scored.filter(r=>r.strict==='fail').length,pending:scored.filter(r=>r.strict==='pending').length,missing:entries.length-scored.length,strictRate:pass/entries.length,
   answerTasks:entries.filter(e=>e.objective==='answer').length,
   unnecessaryClarificationReviewed:scored.filter(r=>entries.some(e=>e.id===r.entryId&&e.clarification==='unnecessary')).length,
   unnecessaryClarificationEligible:entries.filter(e=>e.clarification==='unnecessary').length,
   unnecessaryClarificationRate:entries.some(e=>e.clarification==='unnecessary')?scored.filter(r=>r.unnecessaryClarification&&entries.some(e=>e.id===r.entryId&&e.clarification==='unnecessary')).length/entries.filter(e=>e.clarification==='unnecessary').length:null,
   coreCompleted:scored.filter(r=>r.coreTaskCompleted).length,boundaryCompleted:scored.filter(r=>r.boundaryCompleted).length,
   technicalInterruptions:scored.filter(r=>r.technicalInterruption).length,unnecessaryClarifications:scored.filter(r=>r.unnecessaryClarification).length,
   falseBlockEvents:scored.reduce((n,r)=>n+r.falseBlockEvents,0),recoveredFalseBlocks:scored.reduce((n,r)=>n+r.recoveredFalseBlocks,0)};
 };
 const groups=Object.fromEntries([...new Set(plan.map(e=>`${e.group}/${e.loading}`))].map(key=>{
  const entries=plan.filter(e=>`${e.group}/${e.loading}`===key),ids=new Set(entries.map(e=>e.id)),scored=rows.filter(r=>ids.has(r.entryId));
  const splits=Object.fromEntries([...new Set(entries.map(e=>e.split))].map(split=>[split,count(entries.filter(e=>e.split===split),scored.filter(r=>r.split===split))]));
  return [key,{...count(entries,scored),splits}];
 }));
 const splits=Object.fromEntries([...new Set(plan.map(e=>e.split))].map(split=>[split,count(plan.filter(e=>e.split===split),rows.filter(r=>r.split===split))]));
 return {...count(plan,rows),groups,splits};
}

/** Reviewers extract the stated precision; this helper does not infer it from prose.
 * oracleErrorM must be independently established, never a post-hoc percentage allowance. */
export function reportedDistanceVerdict(expectedM:number,reportedM:number,displayStepM:number|null,oracleErrorM=0):Verdict{
 for(const value of [expectedM,reportedM,oracleErrorM])assert.ok(Number.isFinite(value)&&value>=0,'Invalid distance evidence');
 if(displayStepM===null)return 'pending';
 assert.ok(Number.isFinite(displayStepM)&&displayStepM>0,'Invalid stated precision');
 const floatingSlack=Number.EPSILON*Math.max(1,expectedM,reportedM)*8;
 return Math.abs(reportedM-expectedM)<=displayStepM/2+oracleErrorM+floatingSlack?'pass':'fail';
}
