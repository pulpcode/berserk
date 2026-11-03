import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildReportMaterials, projectNativeCalls, projectReferences, projectSnapshots } from './report-materials.js';
import { formalSlots, sha256 } from './scoring.js';
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
const artifact = { path: '/offline/public.json', sha256: sha256('test') };

test('whole process, actual fixed refs and structured tool result survive compact export', () => {
  const value = { messages: [
    { id: 'u', role: 'user', text: '仅此固定图层。', selections: { annotationRefs: [{ ref: { setId: 'fixed', revision: 2 }, layerId: 'one' }], skill: { content: 'not-a-reference' } } },
    { id: 'p', role: 'assistant', text: '先前错误断言。', reasoning_content: 'PRIVATE_REASONING' },
    { id: 't', role: 'tool', text: '{"quantity":3}', toolCallId: 'tc', resourceResult: { resultRef: 'resource:r:c' } },
    { id: 'a', role: 'assistant', text: '更正为3。' },
  ], apiKey: 'PRIVATE_KEY' };
  const projected = projectSnapshots([{ value, artifact }]), refs = projectReferences([{ value, artifact }]);
  assert.deepEqual(projected.rows.map(row => row.text), ['仅此固定图层。', '先前错误断言。', '{"quantity":3}', '更正为3。']);
  assert.equal(refs.length, 2); assert.ok(JSON.stringify(refs).includes('resource:r:c')); assert.ok(JSON.stringify(refs).includes('"revision":2'));
  assert.ok(!JSON.stringify([projected, refs]).includes('PRIVATE_'));
  assert.throws(() => projectReferences([{ artifact, value: { messages: [{ id: 'u', selections: { context: { authorization: 'secret' } } }] } }]), /sensitive_public_text/);
});
test('native calls expose exact arguments and locators without private thought/signatures', () => {
  const temp = mkdtempSync(join(tmpdir(), 'resource-native-export-'));
  try {
    const path = join(temp, 'native.jsonl');
    writeFileSync(path, JSON.stringify({ type: 'message', message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'PRIVATE_REASONING', thinkingSignature: 'PRIVATE_SIGNATURE' },
      { type: 'toolCall', id: 'c1', name: 'task_resource_query', arguments: { operation: 'read', resultRef: 'resource:r:c', offset: 2 } },
    ] } }) + '\n');
    const calls = projectNativeCalls(path);
    assert.equal(calls.length, 1); assert.equal(calls[0]!.line, 1);
    assert.deepEqual(calls[0]!.arguments, { operation: 'read', resultRef: 'resource:r:c', offset: 2 });
    assert.ok(!JSON.stringify(calls).includes('PRIVATE_'));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
test('20 slots remain pending with no pre-judgment; missing source evidence and private files never become success', () => {
  const temp = mkdtempSync(join(tmpdir(), 'resource-review-export-'));
  try {
    const batch = join(temp, 'batch'), output = join(temp, 'review'); mkdirSync(batch);
    const schedule = [...Array.from({ length: 4 }, (_, i) => ({ id: `P0${i + 1}-1`, caseId: `P0${i + 1}`, repeat: 1, phase: 'public' })),
      ...formalSlots.map(slot => ({ ...slot, id: `${slot.caseId}-${slot.repeat}`, phase: 'formal' }))];
    write(join(batch, 'schedule.json'), schedule); write(join(batch, 'ledger.json'), { attempts: [] });
    const slot = join(batch, 'N01-1'); mkdirSync(slot);
    write(join(slot, 'final-snapshot.json'), { messages: [{ id: 'a', role: 'assistant', text: '有限结论。' }] });
    writeFileSync(join(slot, 'credentials.json'), 'INVALID_PRIVATE_FILE'); writeFileSync(join(slot, 'provider-1-request.json'), 'INVALID_PRIVATE_FILE');
    const index = buildReportMaterials(batch, output);
    assert.equal(index.planned, 20); assert.equal(index.formalPlanned, 16); assert.equal(index.entries.length, 20);
    const packet = JSON.parse(readFileSync(join(output, 'N01-1', 'review-packet.json'), 'utf8'));
    assert.equal(packet.scoringVersion, 'resource-evidence-v2'); assert.equal(packet.first, null); assert.equal(packet.second, null);
    assert.equal(packet.evidenceVerified, false); assert.equal(packet.trajectoryComplete, false);
    const input = readFileSync(join(output, 'N01-1', 'review-input.json'), 'utf8');
    assert.ok(!input.includes('PRIVATE')); assert.equal(input.split('\n').length, 2);
    assert.throws(() => buildReportMaterials(batch, output), /refuse_overwriting/);
    write(join(slot, 'final-snapshot.json'), { messages: [{ id: 'a', role: 'assistant', text: 'Bearer abcdefghijklmnop' }] });
    const unsafe = join(temp, 'unsafe'); assert.throws(() => buildReportMaterials(batch, unsafe), /sensitive_public_text/); assert.equal(existsSync(unsafe), false);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
