import assert from 'node:assert/strict';
import type {Interaction,InteractionResponse} from '../../../experiments/harness-lab/src/contracts/interactions.js';
import type {EvidenceSnapshot} from '../11-02-task-resource-acceptance/scoring.js';
import type {AcceptanceCase} from './cases.js';
export interface Match {factId:string;quote:string;questionId?:string;optionIds?:string[]}
export interface Decision {kind:'final'|'clarify'|'incomplete'|'fixture_gap'|'continue';reviewer:string;rationale:string;evidenceId?:string;matches?:Match[]}
export function reviewedAction(scenario:AcceptanceCase,decision:Decision,observed:EvidenceSnapshot,interaction?:Interaction):{kind:Exclude<Decision['kind'],'clarify'>}|{kind:'clarify';text:string;response?:InteractionResponse}{
 assert.ok(decision.reviewer.trim()&&decision.rationale.trim(),'review_identity_required');
 if(decision.kind!=='clarify'){assert.ok(!interaction||['fixture_gap','incomplete'].includes(decision.kind),'pending_question');return {kind:decision.kind};}
 assert.equal(decision.evidenceId,observed.id,'question_evidence_mismatch');
 const matches=decision.matches;assert.ok(matches?.length,'question_matches_required');
 assert.equal(observed.kind,interaction?'controller':'assistant');
 if(interaction){assert.equal(interaction.kind,'question','confirmation_not_authorized');assert.equal(interaction.status,'pending');}
 if(interaction&&interaction.kind!=='question')throw Error('confirmation_not_authorized');
 const texts:string[]=[];const answers:Extract<InteractionResponse,{kind:'question';action:'answer'}>['answers']=[];
 for(const match of matches){
  assert.ok(match.quote.trim()&&observed.text.includes(match.quote),'question_quote_missing');
  const fact=scenario.humanFacts.find(f=>f.id===match.factId);assert.ok(fact,'no_frozen_fact');texts.push(fact.value);
  if(interaction){const q=interaction.questions.find(q=>q.id===match.questionId);assert.ok(q&&q.prompt.includes(match.quote),'question_mapping_invalid');
   if(match.optionIds){assert.ok(match.optionIds.length&&new Set(match.optionIds).size===match.optionIds.length&&match.optionIds.every(id=>q.options?.some(o=>o.id===id)),'invalid_options');answers.push({questionId:q.id,optionIds:match.optionIds});}
   else answers.push({questionId:q.id,text:fact.value});
  }else assert.ok(!match.questionId&&!match.optionIds,'text_question_has_api_fields');
 }
 if(interaction)assert.deepEqual([...answers.map(a=>a.questionId)].sort(),interaction.questions.map(q=>q.id).sort(),'all_questions_must_be_answered_once');
 return {kind:'clarify',text:texts.join('\n'),...(interaction?{response:{requestId:interaction.requestId,kind:'question' as const,action:'answer' as const,answers}}:{})};
}
