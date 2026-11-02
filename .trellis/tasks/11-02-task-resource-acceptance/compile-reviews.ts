import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { projectSnapshots, safeText } from './report-materials.js';
import { criticalKeys, scoreReview, sha256, type EvidenceSnapshot, type ProgramCheck, type ReviewPacket, type ReviewPass } from './scoring.js';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value : '';
function read(path: string) {
  const bytes = readFileSync(path);
  return { value: JSON.parse(bytes.toString('utf8')) as unknown, artifact: { path: resolve(path), sha256: sha256(bytes) } };
}
function strings(value: unknown, field: string): string[] {
  assert.ok(Array.isArray(value) && value.every((item) => typeof item === 'string'), `missing_or_invalid_${field}`);
  return value as string[];
}
function unwrap(value: unknown): ObjectValue {
  const wrapper = object(value);
  return wrapper.review === undefined ? wrapper : object(wrapper.review);
}
// The first actual request's system/user text only. No tool schemas, assistant
// content/reasoning, headers, error bodies or credentials are inspected/exported.
export function extractInitialPublicContext(value: unknown) {
  const sections: Array<{ fieldPath: string; role: 'system' | 'user'; text: string }> = [];
  for (const [index, raw] of array(object(value).messages).entries()) {
    const message = object(raw);
    if (message.role !== 'system' && message.role !== 'user') continue;
    if (typeof message.content === 'string') sections.push({ fieldPath: `messages[${index}].content`, role: message.role, text: safeText(message.content) });
    else for (const [partIndex, rawPart] of array(message.content).entries()) {
      const part = object(rawPart);
      if (part.type === 'text' && typeof part.text === 'string') sections.push({ fieldPath: `messages[${index}].content[${partIndex}].text`, role: message.role, text: safeText(part.text) });
    }
  }
  assert.ok(sections.length, 'initial_request_has_no_public_context');
  return { sections, publicText: sections.map((section) => `[${section.role} ${section.fieldPath}]\n${section.text}`).join('\n\n') };
}
export function mapReview(value: unknown, aliases: Map<string, string>): ReviewPass {
  const pass = unwrap(value);
  const map = (id: string) => {
    assert.ok(aliases.has(id), `unknown_evidence_alias:${id}`);
    return aliases.get(id)!;
  };
  const mapList = (value: unknown, field: string) => strings(value, field).map(map);
  assert.ok(typeof pass.reviewer === 'string' && (pass.reviewerKind === 'human' || pass.reviewerKind === 'agent'), 'missing_reviewer');
  assert.ok(typeof pass.rawEvidenceReadFirst === 'boolean', 'missing_raw_first_attestation');
  assert.ok(['pass', 'fail', 'pending'].includes(text(pass.mainTask)), 'invalid_main_verdict');
  assert.ok(typeof pass.mainRationale === 'string', 'missing_main_rationale');
  assert.ok(Array.isArray(pass.claims), 'missing_claims');
  const critical = Object.fromEntries(criticalKeys.map((key) => {
    const criterion = object(object(pass.critical)[key]);
    assert.ok(['pass', 'fail', 'pending'].includes(text(criterion.verdict)) && typeof criterion.rationale === 'string', `invalid_critical:${key}`);
    return [key, { verdict: criterion.verdict, rationale: criterion.rationale, evidenceIds: mapList(criterion.evidenceIds, `critical_${key}`) }];
  })) as ReviewPass['critical'];
  return {
    reviewer: pass.reviewer, reviewerKind: pass.reviewerKind, rawEvidenceReadFirst: pass.rawEvidenceReadFirst,
    reviewedStatementIds: mapList(pass.reviewedStatementIds, 'reviewed_statements'), mainTask: pass.mainTask as ReviewPass['mainTask'], mainRationale: pass.mainRationale,
    critical,
    claims: pass.claims.map((raw) => {
      const claim = object(raw);
      assert.ok(typeof claim.id === 'string' && typeof claim.statementId === 'string' && typeof claim.quote === 'string' && typeof claim.rationale === 'string', 'missing_claim_fields');
      assert.ok(['supported', 'valid_inference', 'expression_only', 'factual_error', 'unsupported', 'pending'].includes(text(claim.verdict)), 'invalid_claim_verdict');
      return { id: claim.id, statementId: map(claim.statementId), quote: claim.quote, rationale: claim.rationale,
        verdict: claim.verdict as ReviewPass['claims'][number]['verdict'], availableEvidenceIds: mapList(claim.availableEvidenceIds, 'claim_available'), laterEvidenceIds: mapList(claim.laterEvidenceIds, 'claim_later') };
    }),
    nonFactualStatements: array(pass.nonFactualStatements).map((raw) => {
      const item = object(raw);
      assert.ok(typeof item.statementId === 'string' && typeof item.noFactualClaimsRationale === 'string', 'invalid_nonfactual_statement');
      return { statementId: map(item.statementId), noFactualClaimsRationale: item.noFactualClaimsRationale };
    }),
    omissions: strings(pass.omissions, 'omissions'),
  };
}
function programChecks(values: unknown[], aliases: Map<string, string>) {
  const checks: ProgramCheck[] = [], issues: string[] = [];
  for (const [index, raw] of values.entries()) {
    const check = object(raw);
    if (typeof check.id !== 'string' || !['sets', 'counts', 'versions', 'geometry', 'state_diff'].includes(text(check.kind)) || !['main', 'explanation', ...criticalKeys].includes(text(check.affects)) || !Array.isArray(check.evidenceIds) || !('expected' in check) || !('observed' in check)) {
      issues.push(`programChecks[${index}] missing frozen id/kind/affects/evidenceIds/expected/observed fields`);
      continue;
    }
    const refs = check.evidenceIds;
    if (!refs.length || refs.some((id) => typeof id !== 'string' || !aliases.has(id))) { issues.push(`programChecks[${index}] unknown evidence aliases`); continue; }
    checks.push({ id: check.id, kind: check.kind as ProgramCheck['kind'], affects: check.affects as ProgramCheck['affects'], expected: check.expected, observed: check.observed, evidenceIds: (refs as string[]).map((id) => aliases.get(id)!) });
  }
  return { checks, issues };
}
function attestations(value: unknown) {
  const wrapper = object(value), evidenceFiles = object(wrapper.evidenceFiles), evidenceBasis = object(wrapper.evidenceBasis);
  const entries = Object.values(evidenceFiles).map(object).filter((item) => typeof item.path === 'string' && typeof item.sha256 === 'string').map((item) => ({ path: text(item.path), sha256: text(item.sha256) }));
  if (typeof evidenceBasis.snapshotPath === 'string' && typeof evidenceBasis.snapshotSha256 === 'string') entries.push({ path: evidenceBasis.snapshotPath, sha256: evidenceBasis.snapshotSha256 });
  return entries;
}
export function compileReviews(batchDirectory: string, recordsDirectory: string, entryId: string, outputDirectory: string) {
  assert.ok(/^(A0[1-8]|P0[1-4])-[12]$/.test(entryId), 'invalid_entry_id');
  const batch = resolve(batchDirectory), records = resolve(recordsDirectory), output = resolve(outputDirectory), trial = join(batch, entryId);
  assert.ok(!existsSync(output), 'refuse_overwriting_compiled_review');
  const schedule = array(read(join(batch, 'schedule.json')).value).map(object);
  const slot = schedule.find((row) => row.id === entryId);
  assert.ok(slot && typeof slot.caseId === 'string' && (slot.repeat === 1 || slot.repeat === 2) && (slot.phase === 'formal' || slot.phase === 'public'), 'entry_not_in_schedule');
  const first = read(join(records, `first-review-${entryId}.json`));
  const second = read(join(records, `second-review-${entryId}.json`));
  const names = readdirSync(trial);
  assert.ok(names.includes('final-snapshot.json') && names.includes('result.json'), 'entry_not_finalized');
  const snapshotNames = names.filter((name) => /^turn-\d+-snapshot\.json$/.test(name)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  snapshotNames.push('final-snapshot.json');
  const sources = snapshotNames.map((name) => read(join(trial, name)));
  const projection = projectSnapshots(sources);
  const aliases = new Map<string, string>();
  const issues = [...projection.issues];
  for (const row of projection.rows) {
    assert.ok(!aliases.has(row.messageId), 'changed_native_message_needs_manual_mapping');
    aliases.set(row.messageId, row.id);
    aliases.set(row.id, row.id);
  }
  const before = read(join(trial, 'state-before.json')), after = read(join(trial, 'state-after.json'));
  aliases.set('state-before', 'state-before'); aliases.set('state-after', 'state-after');
  const snapshots: EvidenceSnapshot[] = [{ id: 'state-before', sequence: 0, kind: 'state', ...before.artifact, text: '', modelVisible: false }];
  const requestName = names.filter((name) => /^provider-\d+-request\.json$/.test(name)).sort()[0];
  let context: ReturnType<typeof extractInitialPublicContext> | undefined;
  let contextSource: { path: string; sha256: string } | undefined;
  if (requestName) {
    const request = read(join(trial, requestName));
    context = extractInitialPublicContext(request.value); contextSource = request.artifact;
    aliases.set('host-context-turn1', 'host-context-turn1');
    aliases.set(`${requestName.replace('-request.json', '')}-context`, 'host-context-turn1');
  }
  // Public first-request context enters after the opening user input and before
  // any model response/tool. No later provider replay can backfill early claims.
  let insertedContext = false;
  const insertContext = () => {
    if (!context || insertedContext) return;
    snapshots.push({ id: 'host-context-turn1', sequence: snapshots.length, kind: 'provider', path: join(output, 'initial-public-context.txt'), sha256: sha256(context.publicText), text: context.publicText, modelVisible: true });
    insertedContext = true;
  };
  for (const row of projection.rows) {
    if (row.kind !== 'user') insertContext();
    snapshots.push({ id: row.id, sequence: snapshots.length, kind: row.kind, path: row.path, sha256: row.sha256, text: row.text, modelVisible: row.modelVisible });
  }
  insertContext();
  snapshots.push({ id: 'state-after', sequence: snapshots.length, kind: 'state', ...after.artifact, text: '', modelVisible: false });
  const inputReviews = [first, second];
  const verified = [];
  for (const review of inputReviews) {
    const refs = attestations(review.value);
    if (!refs.length) issues.push(`review lacks source hash attestation: ${review.artifact.path}`);
    for (const ref of refs) {
      const evidencePath = resolve(fileURLToPath(new URL('../../../', import.meta.url)), ref.path);
      assert.ok(evidencePath.startsWith(trial + '/') && /\/(?:final-snapshot|state-before|state-after|turn-\d+-snapshot|provider-\d+-request)\.json$/.test(evidencePath), 'unsupported_review_evidence_path');
      const actualHash = sha256(readFileSync(evidencePath));
      assert.equal(actualHash, ref.sha256, 'review_source_hash_mismatch');
      verified.push({ ...ref, verified: true });
    }
  }
  const sidecarPath = join(records, `program-checks-${entryId}.json`);
  const sidecar = existsSync(sidecarPath) ? read(sidecarPath) : undefined;
  const rawChecks = sidecar ? array(sidecar.value) : array(object(first.value).programChecks);
  const checks = programChecks(rawChecks, aliases);
  issues.push(...checks.issues);
  const packet: ReviewPacket = { entryId, caseId: slot.caseId, cohort: slot.phase, repeat: slot.repeat,
    trajectoryComplete: false, evidenceVerified: true, snapshots, protocolFaults: [], programChecks: checks.checks,
    first: mapReview(first.value, aliases), second: mapReview(second.value, aliases),
  };
  const resolutionPath = join(records, `root-resolution-${entryId}.json`);
  const resolutionSource = existsSync(resolutionPath) ? read(resolutionPath) : undefined;
  let explanationNotApplicable = false;
  let classificationRevision: ReturnType<typeof read> | undefined;
  if (resolutionSource) {
    const decision = object(resolutionSource.value);
    assert.equal(decision.entryId, entryId, 'resolution_entry_mismatch');
    assert.equal(decision.sourceSnapshotSha256, sources.at(-1)!.artifact.sha256, 'resolution_snapshot_hash_mismatch');
    assert.equal(decision.sourceSecondReviewSha256, second.artifact.sha256, 'resolution_review_hash_mismatch');
    if (decision.sourceFirstReviewSha256 !== undefined) assert.equal(decision.sourceFirstReviewSha256, first.artifact.sha256, 'resolution_first_review_hash_mismatch');
    assert.ok(typeof decision.reviewer === 'string' && decision.reviewer.trim() && typeof decision.rationale === 'string' && decision.rationale.trim(), 'resolution_identity_rationale_required');
    assert.equal(decision.trajectoryComplete, true, 'resolution_requires_explicit_trace_attestation');
    if (decision.explanationApplicability === 'not_applicable_no_assistant') {
      assert.equal(snapshots.filter((snapshot) => snapshot.kind === 'assistant').length, 0, 'not_applicable_requires_no_assistant_text');
      explanationNotApplicable = true;
    }
    if (decision.classificationRevision !== undefined) {
      const revision = object(decision.classificationRevision);
      assert.equal(revision.filename, `second-review-${entryId}-product-classification.json`, 'unexpected_classification_revision');
      classificationRevision = read(join(records, text(revision.filename)));
      assert.equal(revision.sha256, classificationRevision.artifact.sha256, 'classification_revision_hash_mismatch');
    }
    packet.trajectoryComplete = true;
    packet.resolution = { reviewer: decision.reviewer, rationale: decision.rationale, final: mapReview(decision.final, aliases) };
  }
  // Diagnostic only: temporarily inspect validator output with trace completeness
  // set true to separate schema/quote/time failures from required root attestation.
  const validation = scoreReview({ ...packet, trajectoryComplete: true });
  issues.push(...validation.issues);
  const conclusions = (pass: ReviewPass) => ({ mainTask: pass.mainTask, critical: Object.fromEntries(criticalKeys.map((key) => [key, pass.critical[key].verdict])), omissions: pass.omissions });
  const comparison = { finalConclusionsEqual: isDeepStrictEqual(conclusions(packet.first!), conclusions(packet.second!)),
    claimSegmentationEqual: isDeepStrictEqual(packet.first!.claims.map((claim) => [claim.statementId, claim.quote, claim.verdict]), packet.second!.claims.map((claim) => [claim.statementId, claim.quote, claim.verdict])),
    action: 'Root must explicitly resolve any differences; no automatic semantic adjudication.',
  };
  const report = { entryId, status: packet.trajectoryComplete && issues.length === 0 && validation.status === 'reviewed' ? 'reviewed' : 'pending_root_review', issues,
    requiresTrajectoryCompletenessAttestation: !packet.trajectoryComplete, comparison,
    resolutionSource: resolutionSource?.artifact, classificationRevisionSource: classificationRevision?.artifact,
    explanationApplicability: explanationNotApplicable ? 'not_applicable_no_assistant' : 'standard_review',
    sourceReviews: [first.artifact, second.artifact], sourceEvidenceHashChecks: verified,
    idMap: Object.fromEntries(aliases), originalProgramChecks: array(object(first.value).programChecks),
    programChecksSidecar: sidecar?.artifact,
    publicContext: context ? { source: contextSource, fieldPaths: context.sections.map((section) => section.fieldPath), excludes: ['assistant', 'reasoning', 'tools', 'headers'] } : null,
    postProcessingHashes: ['compile-reviews.ts', 'report-materials.ts', 'scoring.ts'].map((name) => { const path = fileURLToPath(new URL(name, import.meta.url)); return { path, sha256: sha256(readFileSync(path)) }; }),
  };
  // New destination only; source reviews/evidence and frozen code are never changed.
  mkdirSync(output, { recursive: true, mode: 0o700 });
  const save = (name: string, value: unknown) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  if (context) {
    writeFileSync(join(output, 'initial-public-context.txt'), context.publicText, { mode: 0o600 });
    save('initial-public-context-provenance.json', report.publicContext);
  }
  save('review-packet.json', packet);
  save('validation.json', report);
  if (report.status === 'reviewed') {
    const score = scoreReview(packet);
    save('score.json', score);
    if (explanationNotApplicable) save('report-interpretation.json', {
      entryId, mainTask: score.mainTask, strict: score.strict, critical: score.critical,
      explanation: null, explanationApplicability: 'not_applicable_no_assistant',
      frozenScorerExplanation: score.explanation, excludeFromAnsweredExplanationDenominator: true,
      excludeFromMainOrStrictDenominator: false,
      rationale: 'Frozen scorer true means no observed false assertion in an empty assistant corpus; it is not a successful explanation. Original score is preserved.',
    });
  }
  if (classificationRevision) writeFileSync(join(output, 'classification-revision-original.json'), readFileSync(classificationRevision.artifact.path), { mode: 0o600 });
  // Preserve exact original records, including reviewer-specific supplemental fields.
  writeFileSync(join(output, 'first-original.json'), readFileSync(first.artifact.path), { mode: 0o600 });
  writeFileSync(join(output, 'second-original.json'), readFileSync(second.artifact.path), { mode: 0o600 });
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [batch, records, entry, output] = process.argv.slice(2);
    assert.ok(batch && records && entry && output, 'Usage: compile-reviews.ts BATCH RECORDS ENTRY NEW_OUTPUT');
    const result = compileReviews(batch, records, entry, output);
    console.info(JSON.stringify({ entryId: result.entryId, status: result.status, issues: result.issues, output: resolve(output) }));
  } catch (error) {
    console.error(error instanceof assert.AssertionError ? error.message : 'Review compilation failed; inspect input schema privately.');
    process.exitCode = 1;
  }
}
