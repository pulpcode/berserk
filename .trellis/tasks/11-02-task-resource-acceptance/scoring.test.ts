import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { aggregateFormal, criticalKeys, scoreReview, sha256, verifySnapshotFiles, type EvidenceSnapshot, type ReviewPacket, type ReviewPass } from './scoring.js';

interface Calibration {
  id: string;
  category: string;
  provenance: { kind: string; historicalQuote: boolean };
  snapshots: EvidenceSnapshot[];
  annotation: ReviewPass;
  expected: { mainTask: boolean; explanation: boolean; strict: boolean; criticalFailure: string | null; expressionIssues: number };
}
const calibration = JSON.parse(await readFile(new URL('./calibration.json', import.meta.url), 'utf8')) as { cases: Calibration[] };
function packet(example = calibration.cases[0]!): ReviewPacket {
  return structuredClone({
    entryId: example.id, caseId: example.id, cohort: 'calibration', repeat: 1,
    trajectoryComplete: true, evidenceVerified: true, snapshots: example.snapshots,
    protocolFaults: [], programChecks: [], first: example.annotation,
    // A deterministic second input exercises agreement gating, not an independent semantic review.
    second: { ...structuredClone(example.annotation), reviewer: 'offline-second-pass-input' },
  });
}

test('twelve explicitly constructed cases cover six classes twice against frozen outcomes', () => {
  assert.equal(calibration.cases.length, 12);
  const counts = new Map<string, number>();
  for (const example of calibration.cases) {
    counts.set(example.category, (counts.get(example.category) ?? 0) + 1);
    assert.deepEqual(example.provenance.kind, 'constructed');
    assert.equal(example.provenance.historicalQuote, false);
    const score = scoreReview(packet(example));
    assert.equal(score.status, 'reviewed', `${example.id}: ${score.issues.join(';')}`);
    assert.equal(score.mainTask, example.expected.mainTask, example.id);
    assert.equal(score.explanation, example.expected.explanation, example.id);
    assert.equal(score.strict, example.expected.strict, example.id);
    assert.equal(score.expressionIssues.length, example.expected.expressionIssues, example.id);
    for (const key of criticalKeys) assert.equal(score.critical[key], key !== example.expected.criticalFailure, `${example.id}/${key}`);
  }
  assert.deepEqual([...counts.values()], [2, 2, 2, 2, 2, 2]);
});

test('later confirmation cannot be relabeled evidence available at the original assertion', () => {
  const input = packet(calibration.cases[8]);
  for (const pass of [input.first!, input.second!]) {
    pass.claims[0]!.availableEvidenceIds.push('C09-e4');
    pass.claims[0]!.verdict = 'supported';
  }
  const score = scoreReview(input);
  assert.equal(score.status, 'pending_review');
  assert.equal(score.explanation, null);
  assert.match(score.issues.join(' '), /not available at assertion/);
});

test('final correction cannot erase early errors or silently omit early messages', () => {
  const input = packet(calibration.cases[8]);
  assert.equal(scoreReview(input).explanation, false);
  input.second!.reviewedStatementIds = ['C09-e5'];
  assert.match(scoreReview(input).issues.join(' '), /whole assistant trajectory/);
});

test('each assistant statement needs claims or an explicit nonfactual review', () => {
  const input = packet();
  for (const pass of [input.first!, input.second!]) pass.claims = [];
  assert.match(scoreReview(input).issues.join(' '), /statement claim coverage missing/);
  const statement = input.snapshots.find((item) => item.kind === 'assistant')!;
  statement.text = '您指东仓还是西仓？';
  statement.sha256 = sha256(statement.text);
  for (const pass of [input.first!, input.second!]) {
    pass.mainTask = 'fail';
    pass.mainRationale = '必要澄清仍未答复，任务未完成。';
    pass.nonFactualStatements = [{ statementId: statement.id, noFactualClaimsRationale: '完整句仅询问用户意图，未断言仓库名单或数量。' }];
  }
  assert.equal(scoreReview(input).status, 'reviewed');
  assert.equal(scoreReview(input).mainTask, false);
  input.second!.nonFactualStatements![0]!.noFactualClaimsRationale = '';
  assert.match(scoreReview(input).issues.join(' '), /invalid no-factual-claims review/);
});

test('the acceptance batch requires distinct review identities', () => {
  const input = packet();
  input.second!.reviewer = input.first!.reviewer;
  assert.match(scoreReview(input).issues.join(' '), /distinct reviewers/);
  assert.equal(scoreReview(input).strict, null);
});

test('protocol faults are separate, with original annotations retained', () => {
  const input = packet();
  input.protocolFaults.push({ stage: 'continuation', reason: '预设第二轮未被调度器发送' });
  const score = scoreReview(input);
  assert.equal(score.status, 'protocol_failure');
  assert.equal(score.mainTask, null);
  assert.equal(score.strict, null);
  assert.equal(score.review.first?.mainTask, 'pass');
});

test('complete recorded trajectory can contain an unfinished business task', () => {
  const input = packet();
  for (const pass of [input.first!, input.second!]) {
    pass.mainTask = 'fail';
    pass.mainRationale = 'Agent自行结束，说还需查询但没有继续；完整轨迹已记录。';
  }
  const score = scoreReview(input);
  assert.equal(score.status, 'reviewed');
  assert.equal(score.mainTask, false);
  assert.equal(score.explanation, true);
  assert.equal(score.strict, false);
});

test('review disagreement requires an explicit resolution preserving both passes', () => {
  const input = packet();
  input.second!.claims[0]!.verdict = 'expression_only';
  assert.equal(scoreReview(input).status, 'pending_review');
  input.resolution = { reviewer: 'adjudicating-agent', rationale: '回看原文限定清楚，采用初判。', final: structuredClone(input.first!) };
  const resolved = scoreReview(input);
  assert.equal(resolved.status, 'reviewed');
  assert.equal(resolved.review.second?.claims[0]?.verdict, 'expression_only');
  assert.equal(resolved.expressionIssues.length, 0);
});

test('program checks compare actual structured observations and cannot grant semantic success', () => {
  const input = packet();
  input.programChecks.push({ id: 'quantity', kind: 'counts', expected: 2, observed: 3, evidenceIds: ['C01-e2'], affects: 'main' });
  assert.equal(scoreReview(input).mainTask, false);
  input.programChecks[0]!.observed = 2;
  input.first = null;
  assert.equal(scoreReview(input).mainTask, null);
});

test('snapshots verify exact saved bytes and distinguish missing files', async () => {
  const snapshots = calibration.cases[0]!.snapshots;
  const read = async (path: string) => Buffer.from(snapshots.find((item) => item.path === path)!.text);
  assert.deepEqual(await verifySnapshotFiles(snapshots, read), []);
  assert.equal((await verifySnapshotFiles(snapshots, async () => Buffer.from('changed'))).length, snapshots.length);
  assert.match((await verifySnapshotFiles(snapshots, async () => { throw new Error('missing'); }))[0]!, /unreadable/);
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

function formalScores() {
  return Array.from({ length: 8 }, (_, i) => ([1, 2] as const).map((repeat) => {
    const input = packet();
    input.caseId = `A${String(i + 1).padStart(2, '0')}`;
    input.entryId = `${input.caseId}-r${repeat}`;
    input.repeat = repeat;
    input.cohort = 'formal';
    return scoreReview(input);
  })).flat();
}

test('fixed denominator excludes public successes and retains missing/protocol entries', () => {
  const scores = formalScores();
  const publicScore = scoreReview({ ...packet(), cohort: 'public' });
  const summary = aggregateFormal([...scores.slice(0, 15), publicScore]);
  assert.equal(summary.planned, 16);
  assert.equal(summary.mainRate, 15 / 16);
  assert.equal(summary.passed, false);
  assert.deepEqual(summary.incomplete, [{ caseId: 'A08', repeat: 2 }]);
  const broken = scores[15]!;
  broken.review.protocolFaults.push({ stage: 'recording', reason: '原生记录缺页' });
  scores[15] = scoreReview(broken.review);
  assert.equal(aggregateFormal(scores).protocolFailures.length, 1);
  assert.equal(aggregateFormal(scores).main, 15);
});

test('15/16 passes ordinary failures but one critical failure vetoes acceptance', () => {
  const scores = formalScores();
  assert.equal(aggregateFormal(scores).passed, true);
  scores[0]!.mainTask = false;
  scores[0]!.strict = false;
  assert.equal(aggregateFormal(scores).passed, true);
  scores[0]!.critical.honestCoverage = false;
  assert.equal(aggregateFormal(scores).passed, false);
});

test('reports repeat results, both-success counts, double failures and duplicate slots', () => {
  const scores = formalScores();
  scores[0]!.mainTask = false;
  scores[1]!.mainTask = false;
  const summary = aggregateFormal(scores);
  assert.deepEqual(summary.doubleFailures, ['A01']);
  assert.equal(summary.bothSuccessful, 7);
  assert.deepEqual(summary.repeats.map((r) => r.main), [7, 7]);
  assert.throws(() => aggregateFormal([...scores, scores[0]!]), /duplicate formal slot/);
});
