import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { compileReviews, extractInitialPublicContext, mapReview } from './compile-reviews.js';
import { criticalKeys, sha256, type ReviewPass } from './scoring.js';
function review(reviewer: string): ReviewPass {
  return { reviewer, reviewerKind: 'agent', rawEvidenceReadFirst: true, reviewedStatementIds: ['assistant-raw'], mainTask: 'pass', mainRationale: 'Explicit reviewer conclusion.',
    critical: Object.fromEntries(criticalKeys.map((key) => [key, { verdict: 'pass', rationale: 'Explicit reviewer evidence.', evidenceIds: ['tool-raw', 'state-before', 'state-after'] }])) as ReviewPass['critical'],
    claims: [{ id: 'c1', statementId: 'assistant-raw', quote: '有两项。', availableEvidenceIds: ['tool-raw'], laterEvidenceIds: [], verdict: 'supported', rationale: 'Quoted source evidence.' }], omissions: [], nonFactualStatements: [] };
}
test('initial context projects system/user text only with exact paths and rejects secrets', () => {
  const context = extractInitialPublicContext({ headers: { authorization: 'EXCLUDE_CREDENTIAL' }, tools: [{ description: 'EXCLUDE_SCHEMA' }], messages: [
    { role: 'system', content: '公开规则。' }, { role: 'user', content: [{ type: 'text', text: '已选对象可用。' }, { type: 'image_url', image_url: 'EXCLUDE_BINARY' }] },
    { role: 'assistant', content: 'EXCLUDE_ASSISTANT', reasoning_content: 'EXCLUDE_REASONING' }] });
  assert.deepEqual(context.sections.map((section) => section.fieldPath), ['messages[0].content', 'messages[1].content[0].text']);
  assert.ok(!JSON.stringify(context).includes('EXCLUDE'));
  assert.throws(() => extractInitialPublicContext({ messages: [{ role: 'user', content: '{"password":"private"}' }] }), /sensitive_public_text/);
});
test('mapping accepts wrappers without normalizing independent labels or quotes', () => {
  const first = review('first'), second = review('second'); second.claims[0]!.id = 'independent'; second.claims[0]!.verdict = 'valid_inference';
  const aliases = new Map([['assistant-raw', 'message-3'], ['tool-raw', 'message-2'], ['state-before', 'state-before'], ['state-after', 'state-after']]);
  assert.equal(mapReview(first, aliases).claims[0]!.statementId, 'message-3');
  const mapped = mapReview({ review: second }, aliases); assert.equal(mapped.claims[0]!.id, 'independent'); assert.equal(mapped.claims[0]!.verdict, 'valid_inference');
  assert.equal(first.claims[0]!.statementId, 'assistant-raw'); assert.throws(() => mapReview(first, new Map()), /unknown_evidence_alias/);
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'compile-review-')), batch = join(root, 'batch'), records = join(root, 'records'), trial = join(batch, 'A01-1');
  mkdirSync(trial, { recursive: true }); mkdirSync(records);
  const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
  save(join(batch, 'schedule.json'), [{ id: 'A01-1', caseId: 'A01', repeat: 1, phase: 'formal' }]);
  save(join(trial, 'result.json'), { status: 'trajectory_recorded' }); save(join(trial, 'state-before.json'), { binding: 1 }); save(join(trial, 'state-after.json'), { binding: 1 });
  save(join(trial, 'final-snapshot.json'), { messages: [{ id: 'user-raw', role: 'user', text: '查询。' }, { id: 'tool-raw', role: 'tool', text: '有两项。', toolName: 'task_resource_query', isError: false }, { id: 'assistant-raw', role: 'assistant', text: '有两项。' }] });
  save(join(trial, 'provider-0005-request.json'), { messages: [{ role: 'system', content: '公开规则。' }, { role: 'user', content: '查询。' }, { role: 'assistant', reasoning_content: 'EXCLUDE_PRIVATE' }] });
  const sourcePath = join(trial, 'final-snapshot.json'), sourceHash = sha256(readFileSync(sourcePath));
  const first = { ...review('first'), evidenceFiles: { snapshot: { path: sourcePath, sha256: sourceHash } }, programChecks: [{ kind: 'counts', expected: 2, observed: 2 }] };
  const second = { review: review('second'), evidenceBasis: { snapshotPath: sourcePath, snapshotSha256: sourceHash } }; second.review.claims[0]!.verdict = 'valid_inference';
  save(join(records, 'first-review-A01-1.json'), first); save(join(records, 'second-review-A01-1.json'), second);
  return { root, batch, records, trial, save, first };
}
test('compiler checks evidence while preserving originals and pending differences', () => {
  const env = fixture(); try {
    const output = join(env.root, 'compiled'), original = readFileSync(join(env.records, 'first-review-A01-1.json'), 'utf8');
    const result = compileReviews(env.batch, env.records, 'A01-1', output);
    assert.ok(result.issues.some((issue) => issue.includes('missing frozen'))); assert.ok(result.issues.includes('unresolved review disagreement'));
    assert.ok(!result.issues.some((issue) => /quote missing|coverage missing|not available/.test(issue)));
    const packet = JSON.parse(readFileSync(join(output, 'review-packet.json'), 'utf8'));
    assert.equal(packet.trajectoryComplete, false); assert.equal(packet.evidenceVerified, true); assert.equal(packet.resolution, undefined);
    assert.equal(packet.snapshots[0].id, 'state-before'); assert.equal(packet.snapshots[0].modelVisible, false); assert.equal(packet.snapshots[2].id, 'host-context-turn1');
    assert.equal(packet.snapshots.at(-1).id, 'state-after'); assert.equal(packet.snapshots.at(-1).modelVisible, false);
    assert.equal(readFileSync(join(output, 'first-original.json'), 'utf8'), original); assert.equal(readFileSync(join(env.records, 'first-review-A01-1.json'), 'utf8'), original);
    assert.ok(!readFileSync(join(output, 'initial-public-context.txt'), 'utf8').includes('EXCLUDE_PRIVATE'));
    assert.throws(() => compileReviews(env.batch, env.records, 'A01-1', output), /refuse_overwriting/);
  } finally { rmSync(env.root, { recursive: true, force: true }); }
});
test('wrong quote and later-state backfill remain validation errors', () => {
  const env = fixture(); try {
    env.first.claims[0]!.quote = '捏造引文。'; env.first.claims[0]!.availableEvidenceIds = ['state-after']; env.save(join(env.records, 'first-review-A01-1.json'), env.first);
    const result = compileReviews(env.batch, env.records, 'A01-1', join(env.root, 'compiled')); assert.match(result.issues.join('\n'), /claim quote missing/); assert.match(result.issues.join('\n'), /evidence not available at assertion/);
  } finally { rmSync(env.root, { recursive: true, force: true }); }
});
test('source hash drift stops before creating an output directory', () => {
  const env = fixture(); try {
    env.save(join(env.trial, 'final-snapshot.json'), { messages: [] }); const output = join(env.root, 'compiled');
    assert.throws(() => compileReviews(env.batch, env.records, 'A01-1', output), /review_source_hash_mismatch/); assert.equal(existsSync(output), false);
  } finally { rmSync(env.root, { recursive: true, force: true }); }
});
test('explicit root resolution is hash-bound and produces a score without changing either review', () => {
  const env = fixture(); try {
    env.save(join(env.records, 'program-checks-A01-1.json'), [{ id: 'count', kind: 'counts', expected: 2, observed: 2, affects: 'main', evidenceIds: ['tool-raw'] }]);
    const secondPath = join(env.records, 'second-review-A01-1.json'), second = JSON.parse(readFileSync(secondPath, 'utf8'));
    const decision = { entryId: 'A01-1', reviewer: '/root', rationale: 'Explicit root review resolves segmentation.', trajectoryComplete: true,
      sourceSnapshotSha256: sha256(readFileSync(join(env.trial, 'final-snapshot.json'))), sourceSecondReviewSha256: sha256(readFileSync(secondPath)), final: second.review };
    env.save(join(env.records, 'root-resolution-A01-1.json'), decision);
    const output = join(env.root, 'resolved'), result = compileReviews(env.batch, env.records, 'A01-1', output);
    assert.equal(result.status, 'reviewed'); assert.deepEqual(result.issues, []);
    const score = JSON.parse(readFileSync(join(output, 'score.json'), 'utf8')); assert.equal(score.strict, true);
    assert.equal(score.review.first.claims[0].verdict, 'supported'); assert.equal(score.review.second.claims[0].verdict, 'valid_inference');
    decision.sourceSecondReviewSha256 = '0'.repeat(64); env.save(join(env.records, 'root-resolution-A01-1.json'), decision);
    assert.throws(() => compileReviews(env.batch, env.records, 'A01-1', join(env.root, 'invalid-resolution')), /resolution_review_hash_mismatch/);
  } finally { rmSync(env.root, { recursive: true, force: true }); }
});
test('no-answer product failure keeps frozen score and reports explanation N/A separately', () => {
  const env = fixture(); try {
    const snapshotPath = join(env.trial, 'final-snapshot.json');
    env.save(snapshotPath, { messages: [{ id: 'user-raw', role: 'user', text: '查询。' }, { id: 'tool-raw', role: 'tool', text: '校验失败。', isError: true }] });
    const sourceHash = sha256(readFileSync(snapshotPath));
    const final = review('second'); final.reviewedStatementIds = []; final.claims = []; final.mainTask = 'fail'; final.omissions = ['没有公开助手答复'];
    env.save(join(env.records, 'first-review-A01-1.json'), { ...final, reviewer: 'first', evidenceFiles: { snapshot: { path: snapshotPath, sha256: sourceHash } } });
    env.save(join(env.records, 'second-review-A01-1.json'), { review: { ...final, mainTask: 'pending' }, evidenceBasis: { snapshotPath, snapshotSha256: sourceHash } });
    const revisionName = 'second-review-A01-1-product-classification.json';
    env.save(join(env.records, revisionName), { review: final });
    env.save(join(env.records, 'root-resolution-A01-1.json'), { entryId: 'A01-1', reviewer: '/root', rationale: 'Product fault, no answer; preserve original classification.', trajectoryComplete: true,
      sourceSnapshotSha256: sourceHash, sourceSecondReviewSha256: sha256(readFileSync(join(env.records, 'second-review-A01-1.json'))),
      explanationApplicability: 'not_applicable_no_assistant', classificationRevision: { filename: revisionName, sha256: sha256(readFileSync(join(env.records, revisionName))) }, final });
    const output = join(env.root, 'no-answer'), result = compileReviews(env.batch, env.records, 'A01-1', output);
    assert.equal(result.status, 'reviewed');
    const score = JSON.parse(readFileSync(join(output, 'score.json'), 'utf8'));
    assert.equal(score.mainTask, false); assert.equal(score.strict, false); assert.equal(score.explanation, true); assert.deepEqual(score.review.protocolFaults, []);
    const interpretation = JSON.parse(readFileSync(join(output, 'report-interpretation.json'), 'utf8'));
    assert.equal(interpretation.explanation, null); assert.equal(interpretation.excludeFromMainOrStrictDenominator, false);
    assert.equal(interpretation.excludeFromAnsweredExplanationDenominator, true);
    assert.ok(result.classificationRevisionSource?.sha256);
    assert.equal(readFileSync(join(output, 'classification-revision-original.json'), 'utf8'), readFileSync(join(env.records, revisionName), 'utf8'));
  } finally { rmSync(env.root, { recursive: true, force: true }); }
});
