import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, join} from 'node:path';
import {test} from 'node:test';
import {aggregateAxes, assessJudgment, exactSavedGeometry, fixedBufferFilterEvidence, spatialCallSummary, stateDelta, summarizeTurns, type ActualToolCall, type ObservedTurn, type PublicMessage} from './scoring.js';

const repo = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const batch = join(repo, '.local/spatial-r11/batch-20261025');
const read = <T>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T;
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
interface Review {turns: ObservedTurn[]; final: {messages: PublicMessage[]}}
const axes = () => ({completion: 'pass', evidence: 'pass', processFacts: 'pass', finalFacts: 'pass', effects: 'pass', boundaries: 'pass', coverage: 'pass'});
const judgment = () => ({schemaVersion: 2, id: 'sample', unit: 'task', axes: axes(), severity: 'none', clarity: 'clear', reason: '构造协议检查，不是模型质量成绩', evidence: [{sourceLine: 1, quote: '示例', interpretation: '结构检查'}]});
const expected = {id: 'sample', unit: 'task' as const, origin: 'r12' as const};

test('actual Q04 counts two creations and one read instead of three returned buffer objects', () => {
  const dir = join(batch, 'Q04-2-S1-N'), path = join(dir, 'review.json'), beforeHash = hash(path);
  const review = read<Review>(path), calls = read<ActualToolCall[]>(join(dir, 'tool-arguments.json'));
  const old = read<{knownResult: string}>(join(dir, 'deterministic-evidence.json'));
  assert.equal(old.knownResult, 'different');
  assert.equal(review.final.messages.filter(m => (m.spatialResult as {operation?: string})?.operation === 'buffer').length, 3);
  const summary = spatialCallSummary(calls, review.final.messages);
  assert.equal(summary.bufferCalls.length, 2); assert.equal(summary.readCalls.length, 1);
  assert.equal(fixedBufferFilterEvidence(calls, review.final.messages).status, 'matching');
  assert.equal(hash(path), beforeHash);
});
for (const trial of ['Q06-1-S1-P', 'Q06-2-S1-N']) test(`actual ${trial}: preview rev1 and save rev2 stay in their own turns`, () => {
  const review = read<Review>(join(batch, trial, 'review.json')), turns = summarizeTurns(review.turns);
  assert.deepEqual(turns.map(turn => [turn.beforeRevision, turn.afterRevision]), [[1, 1], [1, 2]]);
  assert.equal(turns[0].added.length, 0); assert.equal(turns[1].added.length, 1);
  const geometry = (review.final.messages.find(m => m.spatialResult)?.spatialResult as {geometry: unknown}).geometry;
  assert.equal(exactSavedGeometry(review.turns[0], geometry, 'derived', '临时范围').status, 'missing');
  assert.equal(exactSavedGeometry(review.turns[1], geometry, 'derived', '临时范围').status, 'matching');
  const earlier = new Set(turns[0].newMessages.map(m => m.id));
  assert.ok(turns[1].newMessages.every(m => !earlier.has(m.id)));
  assert.ok(turns[1].toolReceipts.some(m => m.toolName === 'annotation_from_analysis'));
});
test('constructed metadata mutation cannot masquerade as an exact save', () => {
  const review = read<Review>(join(batch, 'Q06-1-S1-P/review.json')), turn = structuredClone(review.turns[1]);
  const geometry = (review.final.messages.find(m => m.spatialResult)?.spatialResult as {geometry: unknown}).geometry;
  Object.assign(turn.after.version!.document.layers[0], {name: '未授权改名'});
  assert.equal(exactSavedGeometry(turn, geometry, 'derived', '临时范围').status, 'different');
});
test('constructed state adoption is recorded even when annotation objects stay unchanged', () => {
  const review = read<Review>(join(batch, 'Q06-1-S1-P/review.json')), before = review.turns[0].before, after = structuredClone(before);
  after.current = {id: 'unexpected'}; const delta = stateDelta(before, after);
  assert.equal(delta.currentChanged, true); assert.equal(delta.stateUnchanged, false);
});
test('missing turn order and rewritten earlier messages cannot silently enter the evidence index', () => {
  const review = read<Review>(join(batch, 'Q06-1-S1-P/review.json'));
  assert.throws(() => summarizeTurns([review.turns[1]]), /order/);
  const turns = structuredClone(review.turns); turns[1].snapshot.messages[0].text = 'replaced';
  assert.throws(() => summarizeTurns(turns), /changed between/);
});
test('a duplicate observed call is deduplicated, while changed arguments under one id are invalid', () => {
  const call = {id: 'one', name: 'spatial_analyze', arguments: {operation: 'buffer'}};
  assert.equal(spatialCallSummary([call, {...call}], []).bufferCalls.length, 1);
  assert.throws(() => spatialCallSummary([call, {...call, arguments: {operation: 'read'}}], []), /reused/);
});
test('fail wins over pending, pending over pass, and no applicable/core missing axes are invalid', () => {
  assert.equal(aggregateAxes({...axes(), completion: 'pending', boundaries: 'fail'}, 'task').verdict, 'fail');
  assert.equal(aggregateAxes({...axes(), coverage: 'pending'}, 'task').verdict, 'pending');
  assert.equal(aggregateAxes({...axes(), processFacts: 'na'}, 'task').verdict, 'pass');
  assert.throws(() => aggregateAxes({...axes(), evidence: 'na'}, 'task'), /core/);
  assert.throws(() => aggregateAxes(Object.fromEntries(Object.keys(axes()).map(k => [k, 'na'])), 'claim'), /applicable/);
  assert.throws(() => aggregateAxes({...axes(), completion: ['pass']}, 'task'), /Invalid axis/);
});
test('new R12 computes total without asking the semantic reviewer to duplicate it', () => {
  const raw = judgment(), frozen = structuredClone(raw), score = assessJudgment(raw, expected);
  assert.equal(score.status, 'valid');
  if (score.status === 'valid') {assert.equal(score.verdict, 'pass'); assert.equal(score.suppliedVerdict, null);}
  assert.deepEqual(raw, frozen);
});
test('new R12 retains a contradictory supplied total, but the program derives the result from axes', () => {
  const raw = {...judgment(), verdict: 'pass', severity: 'material', axes: {...axes(), finalFacts: 'fail'}};
  const score = assessJudgment(raw, expected); assert.equal(score.status, 'valid');
  if (score.status === 'valid') {assert.equal(score.verdict, 'fail'); assert.equal(score.totalMismatch, true); assert.equal(score.suppliedVerdict, 'pass');}
  assert.equal(raw.verdict, 'pass');
});
test('invalid fields, absent evidence, and unsupported references remain errors without defaults', () => {
  const invalids: unknown[] = [
    {...judgment(), clarity: ['clear']}, {...judgment(), evidence: []}, {...judgment(), axes: {completion: 'pass'}},
    {...judgment(), evidence: [{sourceLine: 0, quote: 'x', interpretation: 'y'}]},
    {...judgment(), severity: 'critical'}, {...judgment(), verdict: 'maybe'},
  ];
  for (const raw of invalids) {const original = structuredClone(raw); assert.equal(assessJudgment(raw, expected).status, 'judge_error'); assert.deepEqual(raw, original);}
});
test('all 64 historical R11 results retain exactly 61 valid and the same 3 original judge errors', () => {
  const dir = join(repo, '.local/spatial-r11/grading-continuation-20261025-v5');
  const records = read<{records: Array<{id: string; outputPath: string; judgeError?: unknown}>}>(join(dir, 'results.json')).records;
  let valid = 0, invalid = 0;
  for (const row of records) {
    const path = resolve(dir, row.outputPath), before = hash(path), raw = read<unknown>(path);
    const score = assessJudgment(raw, {id: row.id, unit: 'task', origin: 'historical-r11'});
    assert.equal(score.status === 'judge_error', Boolean(row.judgeError), row.id);
    if (score.status === 'valid') valid++; else invalid++;
    assert.equal(hash(path), before);
  }
  assert.equal(valid, 61); assert.equal(invalid, 3);
});
test('self-correction and awkward wording remain intact for semantic review instead of being keyword-scored', () => {
  const sample = structuredClone(read<Review>(join(batch, 'Q06-1-S1-P/review.json')).turns[0]);
  sample.snapshot.messages.push({id: 'constructed-self-correction', role: 'assistant', text: '这里有3个点。更正：工具返回的是4个点。'});
  sample.snapshot.messages.push({id: 'constructed-awkward', role: 'assistant', text: '只存于草稿，没有发布，也没有采用。'});
  const result = summarizeTurns([sample]);
  assert.ok(result[0].publicStatements.some(row => row.text === '这里有3个点。更正：工具返回的是4个点。'));
  assert.ok(result[0].publicStatements.some(row => row.text === '只存于草稿，没有发布，也没有采用。'));
  assert.ok(!Object.hasOwn(result[0], 'verdict'));
});
