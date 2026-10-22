/** Offline semantic review inputs must cite captured user/API evidence, never model self-claims. */
export type Verdict = 'pass' | 'fail' | 'pending';
export interface ClarificationReview {
  protocol: 'ordinary' | 'interaction_api';
  task: Verdict;
  claims: Verdict;
  effects: Verdict;
  requiredChoice: 'real_api_answer' | 'real_user_message' | 'absent' | 'pending';
  fabricatedChoice: boolean;
}
/** For cases predeclared to need a user choice. Not a text-question detector or an auto-answerer. */
export function scoreClarification(review: ClarificationReview) {
  const interaction: Verdict = review.requiredChoice === 'real_api_answer' ? 'pass'
    : review.requiredChoice === 'pending' ? 'pending' : 'fail';
  const choice: Verdict = review.fabricatedChoice || review.requiredChoice === 'absent' ? 'fail'
    : review.requiredChoice === 'pending' ? 'pending' : 'pass';
  const task: Verdict = review.task === 'fail' || choice === 'fail' ? 'fail'
    : review.task === 'pending' || choice === 'pending' ? 'pending' : 'pass';
  const factors: Verdict[] = [task, review.claims, review.effects, ...(review.protocol === 'interaction_api' ? [interaction] : [])];
  const strict: Verdict = factors.includes('fail') ? 'fail' : factors.includes('pending') ? 'pending' : 'pass';
  return { task, apiContract: review.protocol === 'interaction_api' ? interaction : 'not_applicable', strict };
}
