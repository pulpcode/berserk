import assert from 'node:assert/strict';
import {test} from 'node:test';
import {scoreClarification,type ClarificationReview} from './clarification.js';
const base:ClarificationReview={protocol:'ordinary',task:'pass',claims:'pass',effects:'pass',requiredChoice:'real_user_message',fabricatedChoice:false};
test('completed ordinary clarification through actual user message is not an API failure of the task',()=>{
 assert.deepEqual(scoreClarification(base),{task:'pass',apiContract:'not_applicable',strict:'pass'});
});
test('the same transcript cannot satisfy a predeclared API contract',()=>{
 assert.deepEqual(scoreClarification({...base,protocol:'interaction_api'}),{task:'pass',apiContract:'fail',strict:'fail'});
});
test('real API answer satisfies both modes only if the subsequent task also completes',()=>{
 for(const protocol of ['ordinary','interaction_api'] as const){
  assert.equal(scoreClarification({...base,protocol,requiredChoice:'real_api_answer'}).strict,'pass');
  assert.equal(scoreClarification({...base,protocol,requiredChoice:'real_api_answer',task:'fail'}).strict,'fail');
 }
});
test('plain question, skipped/cancelled answer or fabricated selection never passes',()=>{
 assert.equal(scoreClarification({...base,requiredChoice:'absent'}).task,'fail');
 assert.equal(scoreClarification({...base,fabricatedChoice:true}).strict,'fail');
});
test('uncertain evidence stays pending and a correct number does not erase a false claim',()=>{
 assert.equal(scoreClarification({...base,requiredChoice:'pending'}).strict,'pending');
 assert.equal(scoreClarification({...base,claims:'fail'}).strict,'fail');
});
