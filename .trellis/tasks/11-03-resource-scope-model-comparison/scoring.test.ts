import assert from 'node:assert/strict';
import { test } from 'node:test';
import { historicalToolRepairGate } from './scoring.js';
import type { ToolCheck } from '../11-03-resource-independent-acceptance/scoring.js';
const check = (caseId: string, gate: ToolCheck['gate'], overrides: Partial<ToolCheck> = {}): ToolCheck => ({
  id: `${caseId}-${gate}`, entryId: `${caseId}-1`, caseId, phase: caseId.startsWith('P') ? 'public' : 'formal', gate,
  coverage: 'exercised', verdict: 'pass', reviewer: 'constructed-test', rationale: '构造工具覆盖反例，不是真实模型测评。',
  evidenceVerified: true, evidence: [{ id: 'tool', kind: 'tool', path: 'constructed/tool.json', sha256: 'a'.repeat(64), sequence: 1, text: '{}', modelVisible: true }], ...overrides,
});
const controls = () => [check('P02', 'empty_selection_abort'), check('N03', 'unsupported_exact_sum')];
test('N05 member coverage cannot stand in for missing N02', () => {
  const result = historicalToolRepairGate([...controls(), check('N05', 'member_deduplication')]);
  assert.equal(result.status, 'unverified');
  assert.equal(result.rows.find(row => row.gate === 'member_deduplication')!.status, 'unverified');
});
test('required case must have verified live tool evidence, not an offline pass or prose', () => {
  assert.equal(historicalToolRepairGate([...controls(), check('N02', 'member_deduplication')]).status, 'pass');
  for (const overrides of [{ phase: 'offline' }, { evidenceVerified: false }, { coverage: 'not_exercised', verdict: 'pending' }] as Partial<ToolCheck>[]) {
    assert.equal(historicalToolRepairGate([...controls(), check('N02', 'member_deduplication', overrides)]).status, 'unverified');
  }
});
test('a verified regression in any case or phase overrides required-case passes', () => {
  for (const phase of ['offline', 'public', 'formal'] as const) {
    const checks = [...controls(), check('N02', 'member_deduplication'), check('N05', 'member_deduplication', { phase, verdict: 'fail' })];
    assert.equal(historicalToolRepairGate(checks).status, 'fail');
  }
});
test('non-required records are still validated and input remains unchanged', () => {
  const checks = [...controls(), check('N05', 'member_deduplication')]; const before = structuredClone(checks);
  historicalToolRepairGate(checks); assert.deepEqual(checks, before);
  assert.throws(() => historicalToolRepairGate([...checks, checks[2]!]), /duplicate/);
});
test('unresolved exercised evidence outside required case still blocks a pass', () => {
  const checks = [...controls(), check('N02', 'member_deduplication'), check('N05', 'member_deduplication', { verdict: 'pending' })];
  assert.equal(historicalToolRepairGate(checks).status, 'unverified');
});
