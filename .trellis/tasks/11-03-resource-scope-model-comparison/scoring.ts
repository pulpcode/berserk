import { toolRepairGate, type ToolCheck } from '../11-03-resource-independent-acceptance/scoring.js';
export { aggregateV2, scoreReviewV2, evaluationVersion, criticalKeys } from '../11-03-resource-independent-acceptance/scoring.js';
export type { ScoreV2 } from '../11-03-resource-independent-acceptance/scoring.js';

/** Reconcile historical coverage against its frozen required cases; preserve all verified regressions. */
export function historicalToolRepairGate(checks: ToolCheck[]) {
  const original = toolRepairGate(checks); // Validate all records, including excluded coverage.
  const required = new Map(original.rows.map(row => [row.gate, row.requiredCase]));
  return toolRepairGate(checks.filter(check => check.caseId === required.get(check.gate) || check.verdict === 'fail' || (check.coverage === 'exercised' && check.verdict === 'pending')));
}
