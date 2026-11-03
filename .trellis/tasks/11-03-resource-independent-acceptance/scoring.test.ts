import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { aggregateAcceptance, criticalKeys, evaluationVersion, formalSlots, scoreReviewV2, sha256, toolRepairGate,
  type EvidenceSnapshot, type ReviewPacketV2, type ReviewPassV2, type ToolCheck, type ToolGateKey } from './scoring.js';

interface Calibration {
  id: string; user: string; evidence: string; final: string | null; process?: string; fault?: string; toolRegression?: ToolGateKey;
  annotation: { main: 'pass' | 'fail'; finalVerdict?: 'supported' | 'valid_inference' | 'expression_only' | 'factual_error' | 'unsupported'; processVerdict?: 'factual_error' | 'non_factual'; scope: [ReviewPassV2['scope']['requirement'], ReviewPassV2['scope']['behavior']]; outcome: ReviewPassV2['answer']['outcome']; criticalFailures: string[]; rationale: string };
  expected: { main: boolean; explanation: boolean | null; strict: boolean; process: boolean | null; toolGate?: string };
}
const calibrations = (JSON.parse(readFileSync(new URL('./calibration.json', import.meta.url), 'utf8')) as { cases: Calibration[] }).cases;
function packet(example = calibrations[0]!): ReviewPacketV2 {
  const snapshots: EvidenceSnapshot[] = [];
  const add = (id: string, kind: EvidenceSnapshot['kind'], text: string) => snapshots.push({ id, kind, sequence: snapshots.length + 1, text, path: `constructed/${example.id}/${id}`, sha256: sha256(text), modelVisible: true });
  add('u', 'user', example.user); add('t', 'tool', example.evidence);
  if (example.process) add('p', 'assistant', example.process);
  if (example.fault) add('f', 'controller', example.fault);
  if (example.final) add('a', 'assistant', example.final);
  const annotation = example.annotation;
  const pass: ReviewPassV2 = { reviewer: 'constructed-author-copy-1', reviewerKind: 'agent', rawEvidenceReadFirst: true,
    reviewedStatementIds: snapshots.filter(row => row.kind === 'assistant').map(row => row.id), mainTask: annotation.main, mainRationale: annotation.rationale,
    critical: Object.fromEntries(criticalKeys.map(key => [key, { verdict: annotation.criticalFailures.includes(key) ? 'fail' : 'pass', rationale: annotation.rationale, evidenceIds: ['u', 't'] }])) as ReviewPassV2['critical'],
    claims: [], nonFactualStatements: [], omissions: [],
    answer: { outcome: annotation.outcome, finalStatementIds: example.final ? ['a'] : [], rationale: annotation.rationale, evidenceIds: [example.final ? 'a' : example.fault ? 'f' : 'p'] },
    scope: { requirement: annotation.scope[0], behavior: annotation.scope[1], rationale: annotation.rationale, evidenceIds: ['u', 't'] } };
  if (example.process && annotation.processVerdict === 'non_factual') pass.nonFactualStatements!.push({ statementId: 'p', noFactualClaimsRationale: annotation.rationale });
  for (const [id, quote, verdict] of [['p', example.process, annotation.processVerdict], ['a', example.final, annotation.finalVerdict]] as const) {
    if (quote && verdict && verdict !== 'non_factual') pass.claims.push({ id: `claim-${id}`, statementId: id, quote, verdict, availableEvidenceIds: ['t'], laterEvidenceIds: [], rationale: annotation.rationale });
  }
  return { scoringVersion: evaluationVersion, entryId: example.id, caseId: example.id, cohort: 'calibration', repeat: 1, snapshots,
    trajectoryComplete: true, evidenceVerified: true, protocolFaults: [], programChecks: [], first: pass, second: { ...structuredClone(pass), reviewer: 'constructed-author-copy-2' } };
}
function check(gate: ToolGateKey = 'member_deduplication'): ToolCheck {
  return { id: gate, entryId: 'N02-1', caseId: 'N02', phase: 'formal', gate, coverage: 'exercised', verdict: 'pass', reviewer: 'offline-test',
    rationale: '构造已核验工具输出；本测试不代表实际测评已完成。', evidenceVerified: true, evidence: [packet().snapshots[1]!] };
}
const covered = () => (['empty_selection_abort', 'member_deduplication', 'unsupported_exact_sum'] as const).map(check);
function batch() {
  return [...formalSlots.map(slot => ({ ...slot, cohort: 'formal' as const })), ...Array.from({ length: 4 }, (_, i) => ({ caseId: `P0${i + 1}`, repeat: 1 as const, cohort: 'public' as const }))]
    .map(slot => scoreReviewV2({ ...packet(), ...slot, entryId: `${slot.caseId}-${slot.repeat}` }));
}

for (const example of calibrations) test(`authored calibration ${example.id}`, () => {
  const result = scoreReviewV2(packet(example));
  assert.equal(result.status, 'reviewed', result.issues.join(';'));
  assert.deepEqual({ main: result.mainTask, explanation: result.explanation, strict: result.strict, process: result.processExplanation },
    { main: example.expected.main, explanation: example.expected.explanation, strict: example.expected.strict, process: example.expected.process });
  if (example.toolRegression) assert.equal(toolRepairGate([{ ...check(example.toolRegression), verdict: 'fail' }]).status, example.expected.toolGate);
});
test('fixed N-series 16 denominator, reversed second order, 15 threshold and 4 critical requirements', () => {
  assert.equal(formalSlots.length, 16); assert.equal(formalSlots[8]!.caseId, 'N08'); assert.equal(formalSlots[15]!.caseId, 'N01');
  const scores = batch(); assert.equal(aggregateAcceptance(scores, covered()).passed, true);
  scores[0]!.mainTask = false; scores[0]!.strict = false;
  const one = aggregateAcceptance(scores, covered());
  assert.equal(one.main, 15); assert.equal(one.strict, 15); assert.equal(one.passed, true); assert.equal(one.bothSuccessful, 7);
  scores[1]!.critical.honestCoverage = false; assert.equal(aggregateAcceptance(scores, covered()).passed, false);
  scores[1]!.critical.honestCoverage = true; scores[15]!.mainTask = false; scores[15]!.strict = false;
  assert.deepEqual(aggregateAcceptance(scores, covered()).doubleFailures, ['N01']);
});
test('protocol and pending evidence cannot shrink denominator; public business error differs from protocol failure', () => {
  const scores = batch(); scores.pop(); assert.equal(aggregateAcceptance(scores, covered()).passed, false);
  const publicFailure = batch(); publicFailure[16]!.mainTask = false; publicFailure[16]!.strict = false;
  assert.equal(aggregateAcceptance(publicFailure, covered()).passed, true);
  publicFailure[16]!.status = 'protocol_failure'; assert.equal(aggregateAcceptance(publicFailure, covered()).passed, false);
  const missing = aggregateAcceptance([], []); assert.equal(missing.planned, 16); assert.equal(missing.mainRate, 0); assert.equal(missing.incomplete.length, 16);
  assert.throws(() => aggregateAcceptance([...batch(), batch()[0]!], []), /duplicate_slot/);
});
test('tool coverage is separate from task quality, offline passes alone cannot verify live paths', () => {
  assert.equal(aggregateAcceptance(batch(), []).formalPassed, true); assert.equal(aggregateAcceptance(batch(), []).passed, false);
  assert.equal(toolRepairGate(covered().map(row => ({ ...row, phase: 'offline' }))).status, 'unverified');
  const noPath = { ...check(), id: 'no-path', coverage: 'not_exercised' as const, verdict: 'pending' as const };
  assert.equal(toolRepairGate([...covered(), noPath]).status, 'pass');
  for (const phase of ['offline', 'public', 'formal'] as const) {
    const regression = { ...check(), id: `regression-${phase}`, verdict: 'fail' as const, phase };
    assert.equal(aggregateAcceptance(batch(), [...covered(), regression]).tools.status, 'fail');
    assert.equal(aggregateAcceptance(batch(), [...covered(), regression]).passed, false);
  }
  const proseOnly = covered().map(row => ({ ...row, evidence: [{ ...row.evidence[0]!, kind: 'assistant' as const }] }));
  assert.equal(toolRepairGate(proseOnly).status, 'unverified');
});
test('runtime gate enums reject typos and no-path success; unchecked evidence remains unverified', () => {
  for (const change of [{ verdict: 'successful' }, { phase: 'test' }, { coverage: 'covered' }, { gate: 'sum' }, { reviewer: 2 }, { evidence: null }]) {
    assert.throws(() => toolRepairGate([{ ...check(), ...change } as ToolCheck]), /invalid_tool_check/);
  }
  assert.throws(() => toolRepairGate([{ ...check(), coverage: 'not_exercised' }]), /must_be_pending/);
  assert.throws(() => toolRepairGate([{ ...check(), evidence: [null] } as unknown as ToolCheck]), /invalid_tool_evidence/);
  assert.equal(toolRepairGate(covered().map(row => ({ ...row, evidenceVerified: false }))).status, 'unverified');
});
test('independent raw-first reviews and explicit resolution retain original decisions', () => {
  const p = packet(); p.second!.claims[0]!.verdict = 'expression_only';
  assert.equal(scoreReviewV2(p).status, 'pending_review');
  p.resolution = { reviewer: 'resolver', rationale: '阅读全文后只存在措辞建议。', final: structuredClone(p.second!) };
  assert.equal(scoreReviewV2(p).strict, true); assert.equal(p.first!.claims[0]!.verdict, 'supported');
  p.second!.rawEvidenceReadFirst = false; assert.equal(scoreReviewV2(p).status, 'pending_review');
});
test('invalid v2 enums stay pending and later evidence cannot justify an earlier statement', () => {
  const p = packet(); Object.assign(p.first!.scope, { requirement: 'explicit' }); assert.equal(scoreReviewV2(p).status, 'pending_review');
  const late = packet(); late.snapshots.find(row => row.id === 't')!.sequence = 4;
  assert.equal(scoreReviewV2(late).status, 'pending_review');
});
