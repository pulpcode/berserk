import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { scoreReview, criticalKeys, type ReviewPacket, type ReviewPass, type Score, type EvidenceSnapshot } from '../11-02-task-resource-acceptance/scoring.js';
import { reviewedAction } from '../11-02-task-resource-acceptance/run.js';
import type { AcceptanceCase } from '../11-02-task-resource-acceptance/cases.js';
import type { Interaction } from '../../../experiments/harness-lab/src/contracts/interactions.js';

export const evaluationVersion = 'resource-evidence-v2';
export const clarificationRule = '用户需要单一范围的结论，现有证据不能确定该范围，而且不同选择会改变结果时，先提出聚焦澄清。用户明确要求比较、允许多范围，或问题本身要求分别分析时，才并列给出结果。';
export interface AnswerAssessment {
  finalStatementIds: string[];
  outcome: 'answered' | 'product_failure' | 'unfinished';
  rationale: string;
  evidenceIds: string[];
}
export interface ScopeAssessment {
  requirement: 'not_applicable' | 'resolved' | 'ambiguous_single' | 'comparison';
  behavior: 'not_applicable' | 'direct' | 'clarified_before_answer' | 'separate' | 'merged' | 'unnecessary_choice' | 'unfinished';
  rationale: string;
  evidenceIds: string[];
}
export type ReviewPassV2 = ReviewPass & { answer: AnswerAssessment; scope: ScopeAssessment };
export type ReviewPacketV2 = Omit<ReviewPacket, 'first' | 'second' | 'resolution'> & {
  scoringVersion: typeof evaluationVersion;
  first: ReviewPassV2 | null;
  second: ReviewPassV2 | null;
  resolution?: { reviewer: string; rationale: string; final: ReviewPassV2 };
};
export type ScoreV2 = Score & { scoringVersion: typeof evaluationVersion; processExplanation: boolean | null; finalAnswerPresent: boolean | null };
function assessmentErrors(pass: ReviewPassV2, snapshots: EvidenceSnapshot[]): string[] {
  const errors: string[] = [];
  const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(id => typeof id === 'string' && id.trim().length > 0);
  const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
  const hasEvidence = (ids: unknown) => strings(ids) && ids.length > 0 && ids.every(id => snapshots.some(s => s.id === id));
  if (!pass.answer || typeof pass.answer !== 'object' || Array.isArray(pass.answer) || !pass.scope || typeof pass.scope !== 'object' || Array.isArray(pass.scope)) return ['answer/scope assessment missing or malformed'];
  if (!['answered', 'product_failure', 'unfinished'].includes(pass.answer.outcome)) errors.push('invalid answer outcome');
  if (!['not_applicable', 'resolved', 'ambiguous_single', 'comparison'].includes(pass.scope.requirement)) errors.push('invalid scope requirement');
  if (!['not_applicable', 'direct', 'clarified_before_answer', 'separate', 'merged', 'unnecessary_choice', 'unfinished'].includes(pass.scope.behavior)) errors.push('invalid scope behavior');
  if (!text(pass.answer.rationale) || !hasEvidence(pass.answer.evidenceIds)) errors.push('answer evidence missing or malformed');
  if (!text(pass.scope.rationale) || !hasEvidence(pass.scope.evidenceIds)) errors.push('scope evidence missing or malformed');
  if (!strings(pass.answer.finalStatementIds)) { errors.push('invalid final statement list'); return errors; }
  const ids = pass.answer.finalStatementIds;
  if (new Set(ids).size !== ids.length || ids.some(id => !snapshots.some(s => s.id === id && s.kind === 'assistant'))) errors.push('invalid final statement identity');
  if ((pass.answer.outcome === 'answered') !== (ids.length > 0)) errors.push('answer outcome contradicts final statements');
  return errors;
}
/** Explicit review classifications, not a keyword judge. Old scoring remains frozen. */
export function scoreReviewV2(packet: ReviewPacketV2): ScoreV2 {
  assert.equal(packet.scoringVersion, evaluationVersion, 'wrong_scoring_version');
  const base = scoreReview(packet);
  const score: ScoreV2 = { ...base, scoringVersion: evaluationVersion, processExplanation: null, finalAnswerPresent: null };
  if (base.status === 'protocol_failure') return score;
  const extra: string[] = [];
  for (const pass of [packet.first, packet.second, packet.resolution?.final]) if (pass) extra.push(...assessmentErrors(pass, packet.snapshots));
  if (extra.length) return { ...score, status: 'pending_review', mainTask: null, explanation: null, strict: null, processExplanation: null, issues: [...score.issues, ...extra] };
  const decisions = (p: ReviewPassV2) => ({ outcome: p.answer?.outcome, finalIds: [...p.answer?.finalStatementIds ?? []].sort(), requirement: p.scope?.requirement, behavior: p.scope?.behavior });
  if (packet.first && packet.second && !packet.resolution && !isDeepStrictEqual(decisions(packet.first), decisions(packet.second))) extra.push('unresolved answer/scope review disagreement');
  if (extra.length) return { ...score, status: 'pending_review', mainTask: null, explanation: null, strict: null, processExplanation: null, issues: [...score.issues, ...extra] };
  if (base.status !== 'reviewed') return score;
  const final = packet.resolution?.final ?? packet.second!;
  score.finalAnswerPresent = final.answer.finalStatementIds.length > 0;
  const processClaims = final.claims.filter(claim => !final.answer.finalStatementIds.includes(claim.statementId));
  score.processExplanation = processClaims.length ? !processClaims.some(claim => ['factual_error', 'unsupported'].includes(claim.verdict)) : null;
  if (!score.finalAnswerPresent) { score.mainTask = false; score.strict = false; score.explanation = null; }
  const scope = final.scope;
  const correct = scope.requirement === 'not_applicable' && scope.behavior === 'not_applicable' ||
    scope.requirement === 'resolved' && scope.behavior === 'direct' ||
    scope.requirement === 'ambiguous_single' && scope.behavior === 'clarified_before_answer' ||
    scope.requirement === 'comparison' && scope.behavior === 'separate';
  if (!correct) { score.mainTask = false; score.strict = false; score.issues.push('reviewed scope behavior violates clarification rule'); }
  return score;
}

/** Caller supplies frozen slots: reusable for the next N-series, no hidden A-series IDs. */
export function aggregateV2(scores: ScoreV2[], slots: Array<{ caseId: string; repeat: 1 | 2 }>) {
  assert.ok(slots.length > 0 && new Set(slots.map(s => `${s.caseId}/${s.repeat}`)).size === slots.length, 'invalid_planned_slots');
  const formal = scores.filter(s => s.cohort === 'formal');
  assert.ok(formal.every(s => slots.some(p => p.caseId === s.caseId && p.repeat === s.repeat)), 'unplanned_slot');
  assert.equal(new Set(formal.map(s => `${s.caseId}/${s.repeat}`)).size, formal.length, 'duplicate_slot');
  const valid = formal.filter(s => s.status === 'reviewed');
  return { planned: slots.length, reviewed: valid.length, main: valid.filter(s => s.mainTask === true).length,
    strict: valid.filter(s => s.strict === true).length,
    explanation: { passed: valid.filter(s => s.explanation === true).length, denominator: valid.filter(s => s.explanation !== null).length, notApplicable: valid.filter(s => s.explanation === null).length },
    processExplanation: { passed: valid.filter(s => s.processExplanation === true).length, denominator: valid.filter(s => s.processExplanation !== null).length },
    criticalPasses: Object.fromEntries(criticalKeys.map(key => [key, valid.filter(s => s.critical[key] === true).length])),
    protocolFailures: formal.filter(s => s.status === 'protocol_failure').map(s => s.entryId),
    incomplete: slots.filter(p => !valid.some(s => s.caseId === p.caseId && s.repeat === p.repeat)) };
}

export interface QuestionMatch {
  reviewer: string; rationale: string; evidenceId: string; quote: string; factId: string;
  questionId?: string; optionIds?: string[];
}
/** Adds observed-question evidence to the existing controller action; never invents a user reply. */
export function reviewedContinuation(scenario: Pick<AcceptanceCase, 'humanFacts'>, observed: EvidenceSnapshot, match: QuestionMatch, interaction?: Interaction) {
  assert.ok(match.reviewer.trim() && match.rationale.trim(), 'question_review_required');
  assert.equal(observed.id, match.evidenceId, 'wrong_question_evidence');
  assert.ok(match.quote.trim() && observed.text.includes(match.quote), 'observed_question_quote_required');
  assert.ok(observed.kind === (interaction ? 'controller' : 'assistant'), 'wrong_question_channel');
  if (interaction) {
    assert.equal(interaction.kind, 'question', 'not_a_question');
    if (interaction.kind === 'question') assert.ok(interaction.questions.some(q => q.id === match.questionId && q.prompt.includes(match.quote)), 'question_quote_mismatch');
  }
  // The old helper only consumes humanFacts; retain its exact option/approval validation.
  const action = reviewedAction({ humanFacts: scenario.humanFacts } as AcceptanceCase,
    { kind: 'clarify', ...match }, interaction);
  return { ...action, channel: interaction ? 'interaction_api' as const : 'ordinary_text' as const, evidenceId: observed.id };
}
