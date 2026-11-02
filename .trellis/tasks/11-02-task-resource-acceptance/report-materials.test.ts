import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildReportMaterials, projectSnapshots, trialAccounting } from './report-materials.js';
import { sha256 } from './scoring.js';

const artifact = { path: '/offline/snapshot.json', sha256: sha256('offline') };
const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));

test('public projection retains whole process and exact sentence offsets without private fields', () => {
  const value = { messages: [
    { id: 'u', role: 'user', text: '按指定范围查询。', credential: 'DO_NOT_EXPORT_PASSWORD' },
    { id: 'a1', role: 'assistant', text: '先前有两项。后来需要核对。', reasoning_content: 'DO_NOT_EXPORT_REASONING' },
    { id: 't', role: 'tool', text: '实际有三项。', toolName: 'task_resource_query', isError: false },
    { id: 'a2', role: 'assistant', text: '更正为三项。', thinking: 'DO_NOT_EXPORT_THINKING' },
  ], apiKey: 'DO_NOT_EXPORT_KEY' };
  const result = projectSnapshots([{ value, artifact }, { value, artifact: { ...artifact, path: '/offline/final.json' } }]);
  assert.equal(result.rows.length, 4);
  assert.deepEqual(result.rows[1]!.sentences.map((sentence) => sentence.text), ['先前有两项。', '后来需要核对。']);
  for (const row of result.rows) for (const sentence of row.sentences) assert.equal(row.text.slice(sentence.start, sentence.end), sentence.text);
  assert.ok(!JSON.stringify(result).includes('DO_NOT_EXPORT'));
});

test('changed snapshots retain both original statements and flag revision for review', () => {
  const first = { messages: [{ id: 'same', role: 'assistant', text: '早期断言。' }] };
  const later = { messages: [{ id: 'same', role: 'assistant', text: '后来更正。' }] };
  const result = projectSnapshots([{ value: first, artifact }, { value: later, artifact }]);
  assert.equal(result.rows.length, 2);
  assert.match(result.issues[0]!, /changed across snapshots/);
});

test('known secret/private-reasoning payload embedded in public text fails closed', () => {
  for (const text of ['Bearer abcdefghijklmnop', '{"password":"secret"}', '{"reasoning_content":"private"}']) {
    assert.throws(() => projectSnapshots([{ value: { messages: [{ id: 'a', role: 'assistant', text }] }, artifact }]), /sensitive_public_text/);
  }
});

test('per-trial accounting includes failed native retries and retains missing usage', () => {
  const ledger = { attempts: [
    { id: 1, trialId: 'A01-1', status: 'failed' },
    { id: 2, trialId: 'A01-1', status: 'finished', usage: { input: 10, output: 3 } },
    { id: 3, trialId: 'A02-1', status: 'finished', usage: { input: 900, output: 700 } },
  ] };
  const result = trialAccounting('A01-1', ledger, [
    { value: { id: 1, done: false, authorization: 'DO_NOT_EXPORT' }, artifact },
    { value: { id: 2, done: true, usage: { input: 10, output: 3 } }, artifact },
  ]);
  assert.equal(result.actualRequests, 2);
  assert.equal(result.knownInput, 10);
  assert.equal(result.knownOutput, 3);
  assert.equal(result.unknownUsageAttempts, 1);
  assert.equal(result.usageComplete, false);
  assert.ok(!JSON.stringify(result).includes('DO_NOT_EXPORT'));
});

test('ledger/metadata disagreement and orphan metadata remain visible', () => {
  const result = trialAccounting('A01-1', { attempts: [{ id: 1, trialId: 'A01-1', status: 'pending', usage: { input: 4, output: 2 } }] }, [
    { value: { id: 1, usage: { input: 5, output: 2 } }, artifact },
    { value: { id: 2, usage: { input: 9, output: 9 } }, artifact },
  ]);
  assert.equal(result.usageComplete, false);
  assert.match(result.issues.join(' '), /usage mismatch.*unsettled attempt.*no matching/);
});

test('batch export retains 20 planned slots, writes pending review templates and ignores private files', () => {
  const temp = mkdtempSync(join(tmpdir(), 'resource-report-'));
  try {
    const batch = join(temp, 'batch'), output = join(temp, 'output');
    mkdirSync(batch);
    const schedule = [
      ...Array.from({ length: 4 }, (_, index) => ({ id: `P0${index + 1}-1`, caseId: `P0${index + 1}`, repeat: 1, phase: 'public' })),
      ...[1, 2].flatMap((repeat) => Array.from({ length: 8 }, (_, index) => ({ id: `A0${index + 1}-${repeat}`, caseId: `A0${index + 1}`, repeat, phase: 'formal' }))),
    ];
    json(join(batch, 'schedule.json'), schedule);
    json(join(batch, 'ledger.json'), { attempts: [{ id: 1, trialId: 'A01-1', status: 'finished', usage: { input: 13, output: 5 } }] });
    const trial = join(batch, 'A01-1');
    mkdirSync(trial);
    json(join(trial, 'result.json'), { status: 'trajectory_recorded', usage: { requests: 99, input: 999999 }, error: 'DO_NOT_EXPORT_ERROR' });
    const snapshot = { messages: [
      { id: 'u', role: 'user', text: '查询。' },
      { id: 't', role: 'tool', text: JSON.stringify({ id: 'spatial-analysis', name: '空间分析', content: '规则正文。' }), toolName: 'skill.read', isError: false },
      { id: 't2', role: 'tool', text: JSON.stringify({ id: 'map-annotations', name: '态势标绘', content: '另一规则正文。' }), toolName: 'skill_read', isError: false },
      { id: 'a', role: 'assistant', text: '结果待核对。', reasoning_content: 'DO_NOT_EXPORT_REASONING' },
    ] };
    json(join(trial, 'turn-1-snapshot.json'), snapshot);
    json(join(trial, 'final-snapshot.json'), snapshot);
    json(join(trial, 'provider-0001-response-meta.json'), { id: 1, done: true, usage: { input: 13, output: 5 }, apiKey: 'DO_NOT_EXPORT_KEY' });
    json(join(trial, 'state-before.json'), { binding: { revision: 1 }, secret: 'DO_NOT_EXPORT_STATE' });
    json(join(trial, 'state-after.json'), { binding: { revision: 2 }, secret: 'DO_NOT_EXPORT_STATE' });
    writeFileSync(join(trial, 'credentials.json'), 'INVALID_JSON_DO_NOT_READ');
    writeFileSync(join(trial, 'provider-0001-request.json'), 'INVALID_JSON_DO_NOT_READ');
    writeFileSync(join(trial, 'provider-0001-response.sse'), 'DO_NOT_EXPORT_PRIVATE_THINKING');
    writeFileSync(join(trial, 'turn-1-events.sse'), [
      'data: {"type":"resources.loaded","resources":{"skills":[{"id":"spatial-analysis","hash":"hash","content":"DO_NOT_EXPORT_BODY"}]}}',
      'data: {"type":"text.delta","delta":"DO_NOT_EXPORT_DELTA"}',
      'data: {"type":"reasoning.delta","delta":"DO_NOT_EXPORT_REASONING"}',
    ].join('\n'));
    const index = buildReportMaterials(batch, output);
    assert.equal(index.planned, 20);
    assert.equal(index.formalPlanned, 16);
    assert.equal(index.entries.filter((entry) => entry.status === 'not_started').length, 19);
    assert.equal(index.entries.find((entry) => entry.id === 'A01-1')?.requests, 1);
    assert.equal(index.entries.find((entry) => entry.id === 'A01-1')?.knownInput, 13);
    const published = readFileSync(join(output, 'A01-1', 'public.json'), 'utf8');
    assert.ok(!published.includes('DO_NOT_EXPORT'));
    const result = JSON.parse(published);
    assert.equal(result.state.fields.find((field: { field: string }) => field.field === 'binding').changed, true);
    assert.equal(result.skillEvidence.reads.length, 2);
    assert.deepEqual(result.skillEvidence.reads.map((read: { skillId: string }) => read.skillId), ['spatial-analysis', 'map-annotations']);
    assert.equal(result.skillEvidence.catalogInModelInput, 'unknown_requires_provider_input_review');
    const packet = JSON.parse(readFileSync(join(output, 'A01-1', 'review-packet.json'), 'utf8'));
    assert.equal(packet.evidenceVerified, false);
    assert.equal(packet.trajectoryComplete, false);
    assert.equal(packet.first, null);
    assert.equal(packet.second, null);
    assert.equal(packet.programChecks.length, 0);
    assert.equal(packet.snapshots.length, 4);
    assert.throws(() => buildReportMaterials(batch, output), /refuse_overwriting/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
