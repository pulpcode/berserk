/** R6 ordinary clarification adapter; old R3/R5 scoring and historical reviews stay frozen. */
import assert from 'node:assert/strict';
import {score,summarize} from '../r3-20261022/scoring.ts';
import {scoreClarification} from '../r5-20261022/clarification.ts';
export {summarize};
export function scoreExecution(spec,review,entry){
 if(spec.id!=='D11')return {...score(spec,review,entry),clarificationProtocol:'unnecessary',apiContract:'not_applicable'};
 const choice=review.choice;
 assert.ok(choice&&choice.protocol==='ordinary','D11 needs explicit ordinary choice evidence');
 assert.ok(['real_api_answer','real_user_message','absent','pending'].includes(choice.requiredChoice));
 assert.equal(typeof choice.fabricatedChoice,'boolean');
 if(['real_api_answer','real_user_message'].includes(choice.requiredChoice)){
  assert.ok(Array.isArray(choice.evidence)&&choice.evidence.length,'Actual answer requires evidence');
  assert.equal(choice.answer,spec.answer,'Only the frozen real answer is valid');
 }
 const decision=scoreClarification({...choice,task:review.core.verdict,claims:review.claims.verdict,effects:review.effects.verdict});
 // Disable only the older required-API assumption; keep the ordinary choice contract and other gates.
 const adaptedSpec={...spec,clarification:'conditional-allowed'};
 const adaptedEntry={...entry,clarification:'conditional-allowed'};
 const task=decision.task==='pass'&&(!review.clarification.asked||review.clarification.response!=='answered')?'fail':decision.task;
 const adaptedReview={...review,core:{...review.core,verdict:task}};
 return {...score(adaptedSpec,adaptedReview,adaptedEntry),clarificationProtocol:'ordinary',apiContract:decision.apiContract,choiceMechanism:choice.requiredChoice};
}
