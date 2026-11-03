import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSnapshots, safeText, trialAccounting } from '../11-02-task-resource-acceptance/report-materials.js';
import { evaluationVersion, formalSlots, sha256, type ReviewPacketV2 } from './scoring.js';

// Offline only. Never load credentials, provider request/response bodies, or oracle.
export { projectSnapshots, trialAccounting };
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
function read(path: string) {
  const bytes = readFileSync(path);
  return { value: JSON.parse(bytes.toString('utf8')) as unknown, artifact: { path: resolve(path), sha256: sha256(bytes) } };
}
function publicValue(value: unknown): unknown {
  // Reject rather than silently alter any selected evidentiary field.
  if (value === undefined) return undefined;
  safeText(JSON.stringify(value));
  return value;
}
export function projectReferences(inputs: ReturnType<typeof read>[]) {
  return inputs.flatMap(({ value, artifact }) => array(object(value).messages).flatMap(raw => {
    const message = object(raw), selections = object(message.selections);
    if (typeof message.id !== 'string') return [];
    const fields = Object.fromEntries(['annotationResult', 'spatialResult', 'resourceResult', 'attachments'].filter(key => message[key] !== undefined).map(key => [key, publicValue(message[key])]));
    const refs = Object.fromEntries(['annotationContext', 'annotationRefs', 'context'].filter(key => selections[key] !== undefined).map(key => [key, publicValue(selections[key])]));
    if (!Object.keys(fields).length && !Object.keys(refs).length) return [];
    return [{ messageId: safeText(message.id), artifact, selections: refs, ...fields }];
  }));
}
export function projectNativeCalls(path: string) {
  const bytes = readFileSync(path), artifact = { path: resolve(path), sha256: sha256(bytes) };
  return bytes.toString('utf8').split('\n').flatMap((line, index) => {
    if (!line.trim()) return [];
    const entry = object(JSON.parse(line)), message = object(entry.message);
    // Private thinking blocks, signatures and provider envelopes are never copied.
    return array(message.content).filter(raw => object(raw).type === 'toolCall').map(raw => {
      const call = object(raw);
      assert.ok(typeof call.id === 'string' && typeof call.name === 'string', 'invalid_native_tool_call');
      return { artifact, line: index + 1, toolCallId: safeText(call.id), toolName: safeText(call.name), arguments: publicValue(call.arguments) };
    });
  });
}
function nativeFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? nativeFiles(join(directory, entry.name)) : entry.isFile() && entry.name.endsWith('.jsonl') ? [join(directory, entry.name)] : []);
}
export function buildReportMaterials(batchDirectory: string, outputDirectory: string) {
  const batch = resolve(batchDirectory), output = resolve(outputDirectory);
  assert.ok(!existsSync(output), 'refuse_overwriting_report_materials');
  const expected = [...Array.from({ length: 4 }, (_, i) => ({ id: `P0${i + 1}-1`, caseId: `P0${i + 1}`, repeat: 1 as const, phase: 'public' as const })),
    ...formalSlots.map(slot => ({ ...slot, id: `${slot.caseId}-${slot.repeat}`, phase: 'formal' as const }))];
  const schedule = array(read(join(batch, 'schedule.json')).value).map(raw => {
    const row = object(raw);
    return { id: row.id, caseId: row.caseId, repeat: row.repeat, phase: row.phase };
  });
  assert.deepEqual(schedule, expected, 'frozen_20_slot_order_required');
  const ledger = read(join(batch, 'ledger.json'));
  assert.ok(Array.isArray(object(ledger.value).attempts), 'missing_ledger_attempts');
  const materials = expected.map(slot => {
    const directory = join(batch, slot.id), names = existsSync(directory) ? readdirSync(directory) : [];
    const snapshotNames = names.filter(name => /^turn-\d+-snapshot\.json$/.test(name)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    if (names.includes('final-snapshot.json')) snapshotNames.push('final-snapshot.json');
    const inputs = snapshotNames.map(name => read(join(directory, name))), projection = projectSnapshots(inputs);
    const accounting = trialAccounting(slot.id, ledger.value, names.filter(name => /^provider-\d+-response-meta\.json$/.test(name)).map(name => read(join(directory, name))));
    const result = names.includes('result.json') ? read(join(directory, 'result.json')) : undefined;
    const stateArtifacts = ['state-before.json', 'state-after.json'].filter(name => names.includes(name)).map(name => read(join(directory, name)).artifact);
    const toolCalls = nativeFiles(join(directory, 'native-history')).flatMap(projectNativeCalls);
    const evidenceIssues = [...projection.issues, ...accounting.issues];
    if (!result) evidenceIssues.push('no final result recorded');
    if (!names.includes('final-snapshot.json')) evidenceIssues.push('no final snapshot recorded');
    if (stateArtifacts.length !== 2) evidenceIssues.push('state evidence incomplete');
    const status = object(result?.value).status;
    const reviewPacket: ReviewPacketV2 = { scoringVersion: evaluationVersion, entryId: slot.id, caseId: slot.caseId, cohort: slot.phase, repeat: slot.repeat,
      trajectoryComplete: false, evidenceVerified: false, snapshots: projection.rows, protocolFaults: [], programChecks: [], first: null, second: null };
    return { slot, recordedStatus: typeof status === 'string' ? safeText(status) : names.length ? 'not_finalized' : 'not_started', semanticReview: 'pending_review',
      trajectory: projection.rows, references: projectReferences(inputs), toolCalls, selectedSkills: projection.selectedSkills, accounting, evidenceIssues, stateArtifacts,
      // Raw artifacts remain authoritative, especially controller/source events and compacted history.
      rawDirectory: directory, reviewPacket };
  });
  // Validate the entire export first; secrets or invalid JSON leave no partial output.
  mkdirSync(output, { recursive: true, mode: 0o700 });
  for (const { reviewPacket, ...material } of materials) {
    const directory = join(output, material.slot.id); mkdirSync(directory, { mode: 0o700 });
    writeFileSync(join(directory, 'review-input.json'), JSON.stringify(material) + '\n', { mode: 0o600 });
    writeFileSync(join(directory, 'review-packet.json'), JSON.stringify(reviewPacket, null, 2) + '\n', { mode: 0o600 });
  }
  const index = { scoringVersion: evaluationVersion, planned: 20, formalPlanned: 16, semanticReview: 'pending_review', ledger: ledger.artifact,
    entries: materials.map(item => ({ ...item.slot, status: item.recordedStatus, evidenceIssues: item.evidenceIssues, requests: item.accounting.actualRequests })) };
  writeFileSync(join(output, 'index.json'), JSON.stringify(index, null, 2) + '\n', { mode: 0o600 });
  return index;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [batch, output] = process.argv.slice(2);
    assert.ok(batch && output, 'Usage: report-materials.ts BATCH_DIRECTORY NEW_OUTPUT_DIRECTORY');
    const index = buildReportMaterials(batch, output);
    console.info(JSON.stringify({ planned: index.planned, output: resolve(output) }));
  } catch { console.error('Offline export failed; inspect local artifacts privately.'); process.exitCode = 1; }
}
