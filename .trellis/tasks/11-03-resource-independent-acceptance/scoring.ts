import assert from 'node:assert/strict';
import { aggregateV2, type ScoreV2 } from '../11-02-resource-rules-evidence/evaluation-v2.js';
import { criticalKeys, type EvidenceSnapshot } from '../11-02-task-resource-acceptance/scoring.js';

export { scoreReviewV2, aggregateV2, evaluationVersion } from '../11-02-resource-rules-evidence/evaluation-v2.js';
export type { ReviewPacketV2, ReviewPassV2, ScopeAssessment, AnswerAssessment, ScoreV2 } from '../11-02-resource-rules-evidence/evaluation-v2.js';
export { criticalKeys, sha256, verifySnapshotFiles } from '../11-02-task-resource-acceptance/scoring.js';
export type { EvidenceSnapshot, ClaimReview, ProgramCheck } from '../11-02-task-resource-acceptance/scoring.js';

export const formalCases = Array.from({ length: 8 }, (_, i) => `N0${i + 1}`);
export const formalSlots = ([1, 2] as const).flatMap(repeat =>
  (repeat === 1 ? formalCases : [...formalCases].reverse()).map(caseId => ({ caseId, repeat })));
export const toolGateKeys = ['empty_selection_abort', 'member_deduplication', 'unsupported_exact_sum'] as const;
export type ToolGateKey = typeof toolGateKeys[number];
export interface ToolCheck {
  id: string;
  entryId: string;
  caseId: string;
  phase: 'offline' | 'public' | 'formal';
  gate: ToolGateKey;
  // Explicit inspection of actual output/root cause, never inferred from assistant prose.
  coverage: 'exercised' | 'not_exercised';
  verdict: 'pass' | 'fail' | 'pending';
  reviewer: string;
  rationale: string;
  evidenceVerified: boolean;
  evidence: EvidenceSnapshot[];
}
export function toolRepairGate(checks: ToolCheck[]) {
  for (const check of checks) {
    assert.ok(check && ['offline', 'public', 'formal'].includes(check.phase) && toolGateKeys.includes(check.gate) &&
      ['exercised', 'not_exercised'].includes(check.coverage) && ['pass', 'fail', 'pending'].includes(check.verdict) &&
      ['id', 'entryId', 'caseId', 'reviewer', 'rationale'].every(key => typeof check[key as keyof ToolCheck] === 'string') &&
      typeof check.evidenceVerified === 'boolean' && Array.isArray(check.evidence), 'invalid_tool_check');
    assert.ok(check.evidence.every(item => item && typeof item === 'object' &&
      ['user', 'assistant', 'tool', 'state', 'provider', 'controller'].includes(item.kind) &&
      typeof item.path === 'string' && typeof item.sha256 === 'string'), 'invalid_tool_evidence');
    assert.ok(check.coverage !== 'not_exercised' || check.verdict === 'pending', 'unexercised_tool_check_must_be_pending');
  }
  assert.equal(new Set(checks.map(check => check.id)).size, checks.length, 'duplicate_tool_check');
  const requiredCase: Record<ToolGateKey, string> = { empty_selection_abort: 'P02', member_deduplication: 'N02', unsupported_exact_sum: 'N03' };
  const rows = toolGateKeys.map(gate => {
    const candidates = checks.filter(check => check.gate === gate);
    const verified = candidates.filter(check => check.evidenceVerified && check.reviewer.trim() && check.rationale.trim() && check.evidence.length > 0 &&
      check.evidence.every(item => item.path && /^[a-f0-9]{64}$/.test(item.sha256)) &&
      (check.coverage === 'not_exercised' || check.evidence.some(item => item.kind === 'tool' || item.kind === 'controller')));
    const failures = verified.filter(check => check.coverage === 'exercised' && check.verdict === 'fail');
    const covered = verified.some(check => check.phase !== 'offline' && check.coverage === 'exercised' && check.verdict === 'pass');
    const pending = candidates.length !== verified.length || verified.some(check => check.coverage === 'exercised' && check.verdict === 'pending');
    const status = failures.length ? 'fail' : covered && !pending ? 'pass' : 'unverified';
    return { gate, status, requiredCase: requiredCase[gate], failureIds: failures.map(check => check.id), checks: candidates };
  });
  assert.ok(checks.every(check => toolGateKeys.includes(check.gate)), 'unknown_tool_gate');
  return { status: rows.some(row => row.status === 'fail') ? 'fail' : rows.every(row => row.status === 'pass') ? 'pass' : 'unverified', rows,
    coverage: ['P02', 'N02', 'N03'].flatMap(caseId => (caseId === 'P02' ? [1] : [1, 2]).map(repeat => ({
      entryId: `${caseId}-${repeat}`, checks: checks.filter(check => check.entryId === `${caseId}-${repeat}`),
    }))) };
}
export function aggregateAcceptance(scores: ScoreV2[], toolChecks: ToolCheck[]) {
  const summary = aggregateV2(scores, formalSlots);
  const formal = scores.filter(score => score.cohort === 'formal');
  const bothSuccessful = formalCases.filter(caseId => formalSlots.filter(slot => slot.caseId === caseId)
    .every(slot => formal.some(score => score.caseId === caseId && score.repeat === slot.repeat && score.status === 'reviewed' && score.mainTask === true))).length;
  const doubleFailures = formalCases.filter(caseId => formalSlots.filter(slot => slot.caseId === caseId)
    .every(slot => formal.some(score => score.caseId === caseId && score.repeat === slot.repeat && score.status === 'reviewed' && score.mainTask === false)));
  const tools = toolRepairGate(toolChecks);
  const formalPassed = summary.reviewed === 16 && summary.main >= 15 && summary.strict >= 15 &&
    criticalKeys.every(key => summary.criticalPasses[key] === 16) && doubleFailures.length === 0;
  const publicScores = scores.filter(score => score.cohort === 'public');
  assert.ok(publicScores.every(score => /^P0[1-4]$/.test(score.caseId) && score.repeat === 1), 'unplanned_public_slot');
  assert.equal(new Set(publicScores.map(score => score.caseId)).size, publicScores.length, 'duplicate_public_slot');
  // Public business failures remain visible but do not veto a valid formal batch.
  const publicComplete = publicScores.length === 4 && publicScores.every(score => score.status === 'reviewed');
  return { ...summary, mainRate: summary.main / 16, strictRate: summary.strict / 16, bothSuccessful, doubleFailures,
    repeats: ([1, 2] as const).map(repeat => ({ repeat, planned: 8,
      main: formal.filter(score => score.repeat === repeat && score.status === 'reviewed' && score.mainTask === true).length,
      strict: formal.filter(score => score.repeat === repeat && score.status === 'reviewed' && score.strict === true).length })),
    tools, publicComplete, publicScores, formalPassed, passed: formalPassed && publicComplete && tools.status === 'pass' };
}
