/** Offline-only R11 replay. Does not import a live runner or contact a provider. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {join, resolve, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {toolArguments} from '../r11-20261023/evidence.js';
import {assessJudgment, exactSavedGeometry, fixedBufferFilterEvidence, summarizeTurns, type ObservedTurn, type PublicMessage} from './scoring.js';

const root = fileURLToPath(new URL('.', import.meta.url)), repo = resolve(root, '../../../..');
const read = <T>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T;
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
interface Review {turns: ObservedTurn[]; final: {messages: PublicMessage[]}}
export function verifyHistoricalEvidence() {
  const manifestPath = join(repo, '.local/spatial-r12/r11-evidence-before.json');
  const manifest = read<{baseline: string; files: Record<string, string>}>(manifestPath);
  for (const [path, expected] of Object.entries(manifest.files)) assert.equal(hash(join(repo, path)), expected, `Historical evidence changed: ${path}`);
  return {baseline: manifest.baseline, files: Object.keys(manifest.files).length, unchanged: true, manifestPath: relative(repo, manifestPath), manifestSha256: hash(manifestPath)};
}
export function buildOfflineAudit() {
  const preservationBefore = verifyHistoricalEvidence(), batch = join(repo, '.local/spatial-r11/batch-20261025');
  const q04 = read<Review>(join(batch, 'Q04-2-S1-N/review.json'));
  const q04Calls = toolArguments(join(batch, 'Q04-2-S1-N'));
  const q04Old = read<{knownResult: string}>(join(batch, 'Q04-2-S1-N/deterministic-evidence.json'));
  const fixedRange = fixedBufferFilterEvidence(q04Calls, q04.final.messages);
  assert.equal(fixedRange.status, 'matching');
  const saves = ['Q06-1-S1-P', 'Q06-2-S1-N'].map(id => {
    const review = read<Review>(join(batch, id, 'review.json'));
    const geometry = (review.final.messages.find(m => m.spatialResult)?.spatialResult as {geometry: unknown}).geometry;
    const indexed = summarizeTurns(review.turns);
    const save = exactSavedGeometry(review.turns[1], geometry, 'derived', '临时范围'); assert.equal(save.status, 'matching');
    return {id, turns: indexed.map(t => ({turn: t.turn, prompt: t.prompt, beforeRevision: t.beforeRevision, afterRevision: t.afterRevision,
      addedObjectIds: t.added.map(row => row.objectId), newMessageIds: t.newMessages.map(m => m.id), toolReceipts: t.toolReceipts,
      boundaryStateChanged: t.boundaryStateChanged, currentChanged: t.currentChanged, publicationsChanged: t.publicationsChanged})),
      exactSave: save.status, originalDocumentPreserved: save.originalDocumentPreserved,
      semantics: 'requires_separate_public_statement_review'};
  });
  const grading = join(repo, '.local/spatial-r11/grading-continuation-20261025-v5');
  const records = read<{records: Array<{id: string; outputPath: string; judgeError?: {validationErrors: string[]}}> }>(join(grading, 'results.json')).records;
  const historical = records.map(record => {
    const path = resolve(grading, record.outputPath), raw = read<unknown>(path);
    const score = assessJudgment(raw, {id: record.id, unit: 'task', origin: 'historical-r11'});
    assert.equal(score.status === 'judge_error', Boolean(record.judgeError), 'Historical error classification changed');
    return {id: record.id, path: relative(repo, path), sha256: hash(path), status: score.status,
      ...(score.status === 'judge_error' ? {originalErrors: record.judgeError!.validationErrors, adapterErrors: score.errors} : {})};
  });
  const preservationAfter = verifyHistoricalEvidence(); assert.deepEqual(preservationBefore, preservationAfter);
  return {schemaVersion: 1, kind: 'offline_structural_regression', newProviderRequests: 0,
    q04: {id: 'Q04-2-S1-N', oldKnownResult: q04Old.knownResult, correctedFactualCheck: fixedRange,
      semanticReview: 'Existing adjacent ranking error remains a separate strict-failure recommendation; no semantic pass inferred'},
    q06: saves, historicalJudgments: {total: historical.length, valid: historical.filter(r => r.status === 'valid').length,
      judgeErrors: historical.filter(r => r.status === 'judge_error'), originalScoresUnchanged: true}, preservation: preservationAfter};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, 'Usage: scoring-audit.ts NEW_OUTPUT_JSON');
  const result = buildOfflineAudit();
  writeFileSync(resolve(process.argv[2]), JSON.stringify(result, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  console.info(JSON.stringify({newProviderRequests: 0, historicalFilesUnchanged: result.preservation.files,
    q04: result.q04.correctedFactualCheck.status, q06: result.q06.map(r => r.exactSave),
    historicalValid: result.historicalJudgments.valid, historicalJudgeErrors: result.historicalJudgments.judgeErrors.length}));
}
