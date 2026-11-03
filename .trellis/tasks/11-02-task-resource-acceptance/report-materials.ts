import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { sha256, type EvidenceSnapshot, type ReviewPacket } from './scoring.js';

// Post-processing only: no runner, fixture, oracle, provider transport or credentials import.
type RecordValue = Record<string, unknown>;
interface Slot { id: string; caseId: string; repeat: 1 | 2; phase: 'public' | 'formal' }
interface Artifact { path: string; sha256: string }
interface PublicRow extends EvidenceSnapshot {
  messageId: string;
  requestId?: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  resultMissing?: boolean;
  sentences: Array<{ index: number; start: number; end: number; text: string }>;
}
const object = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
const count = (value: unknown): number | undefined => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
function read(path: string): { value: unknown; artifact: Artifact } {
  const bytes = readFileSync(path);
  return { value: JSON.parse(bytes.toString('utf8')) as unknown, artifact: { path: resolve(path), sha256: sha256(bytes) } };
}
export function safeText(text: string): string {
  // PublicMessage is the product's public projection. Refuse recognizable secrets
  // or private reasoning payloads instead of silently changing evidentiary quotes.
  assert.ok(!/\bBearer\s+[A-Za-z0-9._~+/-]{8,}|\bsk-[A-Za-z0-9_-]{16,}|["'](?:api[_-]?key|password|authorization|reasoning_content|reasoning_text)["']\s*:/i.test(text), 'sensitive_public_text_requires_manual_redaction');
  return text;
}
function optionalText(value: unknown): string | undefined {
  const text = string(value);
  return text === undefined ? undefined : safeText(text);
}
function sentences(text: string) {
  return [...new Intl.Segmenter('zh', { granularity: 'sentence' }).segment(text)]
    .map((part, index) => ({ index, start: part.index, end: part.index + part.segment.length, text: part.segment }));
}
export function projectSnapshots(inputs: Array<{ value: unknown; artifact: Artifact }>) {
  const rows: PublicRow[] = [];
  const versions = new Map<string, string[]>();
  const issues: string[] = [];
  const selectedSkills: Array<{ statementId: string; id?: string; hash?: string; contentHash?: string }> = [];
  for (const { value, artifact } of inputs) {
    for (const [index, raw] of array(object(value).messages).entries()) {
      const message = object(raw);
      if (!['user', 'assistant', 'tool'].includes(String(message.role)) || typeof message.text !== 'string' || typeof message.id !== 'string') {
        issues.push(`unprojectable message: ${basename(artifact.path)}[${index}]`);
        continue;
      }
      const text = safeText(message.text);
      const identity = sha256(JSON.stringify([message.role, text, message.toolName, message.toolCallId, message.isError, message.resultMissing]));
      const seen = versions.get(message.id) ?? [];
      if (seen.includes(identity)) continue;
      if (seen.length) issues.push(`message changed across snapshots: ${safeText(message.id)}`);
      seen.push(identity);
      versions.set(message.id, seen);
      const id = `message-${rows.length + 1}`;
      rows.push({
        id, sequence: rows.length + 1, kind: message.role as PublicRow['kind'],
        path: artifact.path, sha256: artifact.sha256, text, modelVisible: true,
        messageId: safeText(message.id), requestId: optionalText(message.requestId),
        toolName: optionalText(message.toolName), toolCallId: optionalText(message.toolCallId),
        isError: typeof message.isError === 'boolean' ? message.isError : undefined,
        resultMissing: typeof message.resultMissing === 'boolean' ? message.resultMissing : undefined,
        sentences: message.role === 'assistant' ? sentences(text) : [],
      });
      const skill = object(object(message.selections).skill);
      if (Object.keys(skill).length) selectedSkills.push({ statementId: id, id: optionalText(skill.id), hash: optionalText(skill.hash), contentHash: typeof skill.content === 'string' ? sha256(skill.content) : undefined });
    }
  }
  return { rows, issues, selectedSkills };
}
function projectEvents(path: string) {
  const bytes = readFileSync(path);
  const events: Array<{ line: number; type: string; requestId?: string; toolName?: string; toolCallId?: string; isError?: boolean; catalog?: Array<{ id?: string; hash?: string }> }> = [];
  const issues: string[] = [];
  const allowed = new Set(['response.started', 'response.completed', 'response.failed', 'response.cancelled', 'tool.started', 'tool.completed', 'resources.loaded', 'interaction.updated', 'context.compaction_started', 'context.compaction_completed', 'text.delta', 'input.consumed']);
  for (const [index, line] of bytes.toString('utf8').split('\n').entries()) {
    if (!line.startsWith('data:') || line.slice(5).trim() === '[DONE]') continue;
    let event: RecordValue;
    try { event = object(JSON.parse(line.slice(5))); } catch { issues.push(`invalid event JSON: ${basename(path)}:${index + 1}`); continue; }
    if (typeof event.type !== 'string' || !allowed.has(event.type)) continue;
    // Never export delta bodies, raw interactions, compaction summaries or nested snapshots.
    events.push({ line: index + 1, type: event.type, requestId: optionalText(event.requestId), toolName: optionalText(event.toolName), toolCallId: optionalText(event.toolCallId), isError: typeof event.isError === 'boolean' ? event.isError : undefined,
      ...(event.type === 'resources.loaded' ? { catalog: array(object(event.resources).skills).map((item) => ({ id: optionalText(object(item).id), hash: optionalText(object(item).hash) })) } : {}),
    });
  }
  return { artifact: { path: resolve(path), sha256: sha256(bytes) }, events, issues };
}
function usage(value: unknown): { input: number; output: number } | undefined {
  const record = object(value), input = count(record.input), output = count(record.output);
  return input === undefined || output === undefined ? undefined : { input, output };
}
export function trialAccounting(entryId: string, ledger: unknown, metadata: Array<{ value: unknown; artifact: Artifact }>) {
  const attempts = array(object(ledger).attempts).map(object).filter((attempt) => attempt.trialId === entryId);
  const issues: string[] = [];
  const seen = new Set<number>();
  const rows = attempts.map((attempt) => {
    const id = count(attempt.id);
    if (id === undefined || seen.has(id)) issues.push('invalid/duplicate ledger attempt ID');
    if (id !== undefined) seen.add(id);
    const matching = metadata.filter((item) => object(item.value).id === id);
    if (matching.length !== 1) issues.push(`provider metadata missing/duplicate: ${id}`);
    const meta = object(matching[0]?.value), ledgerUsage = usage(attempt.usage), metaUsage = usage(meta.usage);
    if (!isDeepStrictEqual(ledgerUsage, metaUsage)) issues.push(`usage mismatch: ${id}`);
    if (attempt.status === 'pending') issues.push(`unsettled attempt: ${id}`);
    return { id, status: optionalText(attempt.status), usage: ledgerUsage ?? null, providerUsage: metaUsage ?? null,
      providerComplete: meta.done === true, finishReason: optionalText(meta.finishReason),
      models: array(meta.models).map(optionalText).filter((item): item is string => item !== undefined),
      artifact: matching[0]?.artifact,
    };
  });
  for (const item of metadata) if (!attempts.some((attempt) => attempt.id === object(item.value).id)) issues.push('provider metadata has no matching trial ledger row');
  const unknownUsageAttempts = rows.filter((row) => !row.usage).length;
  return { actualRequests: attempts.length, unknownUsageAttempts,
    knownInput: rows.reduce((n, row) => n + (row.usage?.input ?? 0), 0), knownOutput: rows.reduce((n, row) => n + (row.usage?.output ?? 0), 0),
    usageComplete: unknownUsageAttempts === 0 && issues.length === 0, rows, issues };
}
function projectState(before: ReturnType<typeof read> | undefined, after: ReturnType<typeof read> | undefined) {
  if (!before || !after) return { complete: false, changed: null, fields: [], before: before?.artifact, after: after?.artifact };
  // Hash-only differences keep private/credential-bearing nested values out of public reports.
  const fields = ['task', 'binding', 'listing', 'current', 'draftDocument', 'workspaceFiles'].map((key) => {
    const left = object(before.value)[key], right = object(after.value)[key];
    return { field: key, changed: !isDeepStrictEqual(left, right), beforeHash: sha256(JSON.stringify(left) ?? 'undefined'), afterHash: sha256(JSON.stringify(right) ?? 'undefined') };
  });
  return { complete: true, changed: !isDeepStrictEqual(before.value, after.value), fields, before: before.artifact, after: after.artifact, interpretation: 'pending_review' };
}
function loadSlot(batch: string, slot: Slot, ledger: unknown) {
  const directory = join(batch, slot.id), present = existsSync(directory);
  const names = present ? readdirSync(directory) : [];
  const snapshotNames = names.filter((name) => /^turn-\d+-snapshot\.json$/.test(name)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (names.includes('final-snapshot.json')) snapshotNames.push('final-snapshot.json');
  const snapshots = snapshotNames.map((name) => read(join(directory, name)));
  const projection = projectSnapshots(snapshots);
  const events = names.filter((name) => /^turn-\d+-events\.sse$/.test(name)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0])).map((name) => projectEvents(join(directory, name)));
  const metadata = names.filter((name) => /^provider-\d+-response-meta\.json$/.test(name)).map((name) => read(join(directory, name)));
  const accounting = trialAccounting(slot.id, ledger, metadata);
  const resultFile = names.includes('result.json') ? read(join(directory, 'result.json')) : undefined;
  const result = object(resultFile?.value);
  const before = names.includes('state-before.json') ? read(join(directory, 'state-before.json')) : undefined;
  const after = names.includes('state-after.json') ? read(join(directory, 'state-after.json')) : undefined;
  const state = projectState(before, after);
  const issues = [...projection.issues, ...events.flatMap((event) => event.issues), ...accounting.issues];
  if (!resultFile) issues.push('no final result recorded');
  if (!names.includes('final-snapshot.json')) issues.push('no final snapshot recorded');
  if (!state.complete) issues.push('state evidence incomplete');
  const packet: ReviewPacket = {
    entryId: slot.id, caseId: slot.caseId, cohort: slot.phase, repeat: slot.repeat,
    // Final record status alone is not proof of whole-history coverage. A reviewer
    // must inspect native history/compaction and turn snapshots before setting true.
    trajectoryComplete: false, evidenceVerified: false,
    snapshots: projection.rows.map(({ id, sequence, kind, path, sha256: hash, text, modelVisible }) => ({ id, sequence, kind, path, sha256: hash, text, modelVisible })),
    protocolFaults: [], programChecks: [], first: null, second: null,
  };
  return {
    slot, recordedStatus: optionalText(result.status) ?? (present ? 'not_finalized' : 'not_started'),
    semanticReview: 'pending_review', evidenceIssues: issues,
    accounting, state, trajectory: projection.rows,
    skillEvidence: {
      catalogInModelInput: 'unknown_requires_provider_input_review',
      catalogsObservedInEvents: events.flatMap((file) => file.events.filter((event) => event.catalog).map((event) => ({ path: file.artifact.path, ...event }))),
      selected: projection.selectedSkills,
      reads: projection.rows.filter((row) => row.kind === 'tool' && ['skill_read', 'skill.read'].includes(row.toolName ?? '')).map((row) => {
        let skill: RecordValue = {};
        try { skill = object(JSON.parse(row.text)); } catch { /* Non-JSON errors retain an unknown Skill identity. */ }
        return { statementId: row.id, sequence: row.sequence, toolCallId: row.toolCallId,
          skillId: optionalText(skill.id), skillName: optionalText(skill.name), skillVersion: optionalText(skill.version), skillHash: optionalText(skill.hash),
          successfulResult: row.isError === false && !row.resultMissing, resultStatusKnown: typeof row.isError === 'boolean' && !row.resultMissing };
      }),
      interpretation: 'observed_loading_only_not_semantic_success',
    },
    events,
    artifacts: [...snapshots.map((item) => item.artifact), ...metadata.map((item) => item.artifact), ...(resultFile ? [resultFile.artifact] : [])],
    reviewPacket: packet,
  };
}
export function buildReportMaterials(batchDirectory: string, outputDirectory: string) {
  const batch = resolve(batchDirectory), output = resolve(outputDirectory);
  assert.ok(!existsSync(output), 'refuse_overwriting_report_materials');
  const schedule = array(read(join(batch, 'schedule.json')).value).map((raw): Slot => {
    const row = object(raw);
    assert.ok(typeof row.id === 'string' && /^(P0[1-4]|A0[1-8])-[12]$/.test(row.id), 'invalid_schedule_id');
    assert.ok(typeof row.caseId === 'string' && /^(P0[1-4]|A0[1-8])$/.test(row.caseId));
    assert.ok((row.repeat === 1 || row.repeat === 2) && (row.phase === 'public' || row.phase === 'formal'));
    assert.equal(row.id, `${row.caseId}-${row.repeat}`);
    return { id: row.id, caseId: row.caseId, repeat: row.repeat, phase: row.phase };
  });
  assert.equal(new Set(schedule.map((slot) => slot.id)).size, schedule.length, 'duplicate_schedule_slot');
  const required = [
    ...Array.from({ length: 4 }, (_, index) => `P0${index + 1}-1`),
    ...[1, 2].flatMap((repeat) => Array.from({ length: 8 }, (_, index) => `A0${index + 1}-${repeat}`)),
  ];
  assert.deepEqual(schedule.map((slot) => slot.id).sort(), required.sort(), 'frozen_20_slot_denominator_required');
  assert.ok(schedule.every((slot) => slot.phase === (slot.caseId.startsWith('P') ? 'public' : 'formal')), 'cohort_mismatch');
  const ledgerFile = read(join(batch, 'ledger.json'));
  assert.ok(Array.isArray(object(ledgerFile.value).attempts), 'missing_ledger_attempts');
  // Build before writing: malformed/sensitive input leaves no partially published report.
  const materials = schedule.map((slot) => loadSlot(batch, slot, ledgerFile.value));
  mkdirSync(output, { recursive: true, mode: 0o700 });
  for (const material of materials) {
    const destination = join(output, material.slot.id);
    mkdirSync(destination, { mode: 0o700 });
    const { reviewPacket, ...publicMaterial } = material;
    writeFileSync(join(destination, 'public.json'), JSON.stringify(publicMaterial, null, 2) + '\n', { mode: 0o600 });
    writeFileSync(join(destination, 'review-packet.json'), JSON.stringify(reviewPacket, null, 2) + '\n', { mode: 0o600 });
  }
  const postProcessingFiles = ['report-materials.ts', 'scoring.ts'].map((name) => {
    const path = fileURLToPath(new URL(name, import.meta.url));
    return { path, sha256: sha256(readFileSync(path)) };
  });
  const index = { schemaVersion: 1, label: 'Offline evidence preparation, no semantic grading',
    postProcessingFiles, executionFreezeModified: false, ledger: ledgerFile.artifact,
    unmappedLedgerAttempts: array(object(ledgerFile.value).attempts).map(object).filter((attempt) => !schedule.some((slot) => slot.id === attempt.trialId)).map((attempt) => ({ id: count(attempt.id), trialId: optionalText(attempt.trialId), usage: usage(attempt.usage) ?? null })),
    planned: schedule.length, formalPlanned: schedule.filter((slot) => slot.phase === 'formal').length,
    entries: materials.map((material) => ({ ...material.slot, status: material.recordedStatus, semanticReview: material.semanticReview, requests: material.accounting.actualRequests, knownInput: material.accounting.knownInput, knownOutput: material.accounting.knownOutput, unknownUsageAttempts: material.accounting.unknownUsageAttempts, usageComplete: material.accounting.usageComplete, evidenceIssues: material.evidenceIssues })),
  };
  writeFileSync(join(output, 'index.json'), JSON.stringify(index, null, 2) + '\n', { mode: 0o600 });
  return index;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [batch, output] = process.argv.slice(2);
    assert.ok(batch && output, 'Usage: report-materials.ts BATCH_DIRECTORY NEW_OUTPUT_DIRECTORY');
    const result = buildReportMaterials(batch, output);
    console.info(JSON.stringify({ planned: result.planned, output: resolve(output) }));
  } catch (error) {
    // Do not print parsing errors containing a fragment of private source bytes.
    console.error(error instanceof assert.AssertionError ? error.message : 'Report material preparation failed; inspect local artifacts privately.');
    process.exitCode = 1;
  }
}
