/** R12 evidence adapters. Structural checks never infer task meaning from prose. */
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {normalizeJudgment} from '../r11-20261023/judge-format.js';

export const axisNames = ['completion', 'evidence', 'processFacts', 'finalFacts', 'effects', 'boundaries', 'coverage'] as const;
export type AxisName = typeof axisNames[number];
export type AxisValue = 'pass' | 'fail' | 'pending' | 'na';
export type Verdict = Exclude<AxisValue, 'na'>;
export type Axes = Record<AxisName, AxisValue>;
export interface ActualToolCall {id: string; name: string; arguments: unknown}
export interface PublicMessage {
  id: string; role: string; text?: string; toolName?: string; toolCallId?: string;
  isError?: boolean; spatialResult?: unknown;
}
export interface MapStateEvidence {
  binding: {draft?: {headRevision: number} | null};
  version: {document: {layers: Array<{layerId: string; features: unknown[]}>}} | null;
  current: unknown;
  publications: unknown;
}
export interface ObservedTurn {
  turn: number; prompt: string; before: MapStateEvidence; after: MapStateEvidence;
  snapshot: {messages: PublicMessage[]}; criticalEffect?: string | null;
}
function object(value: unknown, name: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${name}: expected object`);
  return value as Record<string, unknown>;
}
function nonblank(value: unknown, name: string): asserts value is string {
  assert.ok(typeof value === 'string' && value.trim(), `${name}: expected nonempty string`);
}
function features(state: MapStateEvidence) {
  assert.ok(state.version === null || typeof state.version === 'object', 'Missing recorded version');
  const rows = new Map<string, {layerId: string; objectId: string; feature: Record<string, unknown>}>();
  for (const layer of state.version?.document.layers ?? []) {
    for (const value of layer.features) {
      const feature = object(value, 'feature'); nonblank(feature.objectId, 'objectId');
      const key = JSON.stringify([layer.layerId, feature.objectId]);
      assert.ok(!rows.has(key), 'Duplicate feature identity in recorded state');
      rows.set(key, {layerId: layer.layerId, objectId: feature.objectId, feature});
    }
  }
  return rows;
}
/** Public state changes are observed facts; authorization must be assessed separately. */
export function stateDelta(before: MapStateEvidence, after: MapStateEvidence) {
  const previous = features(before), current = features(after);
  return {
    beforeRevision: before.binding.draft?.headRevision ?? null,
    afterRevision: after.binding.draft?.headRevision ?? null,
    beforeObjectCount: previous.size, afterObjectCount: current.size,
    added: [...current].filter(([key]) => !previous.has(key)).map(([, row]) => row),
    removed: [...previous].filter(([key]) => !current.has(key)).map(([, row]) => row),
    changed: [...current].filter(([key, row]) => previous.has(key) && !isDeepStrictEqual(previous.get(key), row)).map(([, row]) => row),
    currentChanged: !isDeepStrictEqual(before.current, after.current),
    publicationsChanged: !isDeepStrictEqual(before.publications, after.publications),
    stateUnchanged: isDeepStrictEqual(before, after),
  };
}
/** Keep each turn's own states and new public messages; snapshots are cumulative. */
export function summarizeTurns(turns: readonly ObservedTurn[]) {
  const seenMessages = new Map<string, PublicMessage>();
  return turns.map((turn, index) => {
    assert.equal(turn.turn, index, 'Recorded turn order is not contiguous from zero');
    nonblank(turn.prompt, 'turn prompt');
    const newMessages: PublicMessage[] = [];
    for (const message of turn.snapshot.messages) {
      nonblank(message.id, 'message id');
      const previous = seenMessages.get(message.id);
      if (previous) assert.deepEqual(message, previous, 'Earlier public message changed between turn snapshots');
      else { newMessages.push(message); seenMessages.set(message.id, message); }
    }
    return {
      turn: turn.turn, prompt: turn.prompt,
      ...stateDelta(turn.before, turn.after),
      boundaryStateChanged: index > 0 && !isDeepStrictEqual(turns[index - 1].after, turn.before),
      recordedCriticalEffect: turn.criticalEffect ?? null,
      newMessages,
      publicStatements: newMessages.filter(m => m.role === 'assistant' && typeof m.text === 'string').map(m => ({id: m.id, text: m.text!})),
      toolReceipts: newMessages.filter(m => m.toolCallId).map(m => ({messageId: m.id, toolCallId: m.toolCallId!, toolName: m.toolName, isError: m.isError === true})),
    };
  });
}
/** Count requested operations by call id, not the original operation on a returned historical result. */
export function spatialCallSummary(calls: readonly ActualToolCall[], messages: readonly PublicMessage[]) {
  const unique = new Map<string, ActualToolCall>();
  for (const call of calls) {
    const old = unique.get(call.id);
    if (old) assert.deepEqual(old, call, 'Tool call id reused with different arguments');
    else unique.set(call.id, call);
  }
  const operations = [...unique.values()].filter(call => call.name === 'spatial_analyze').map(call => {
    const args = object(call.arguments, 'spatial call arguments'); nonblank(args.operation, 'operation');
    const receipts = messages.filter(message => message.toolCallId === call.id);
    const matching = receipts.find(message => message.isError !== true && message.spatialResult);
    return {toolCallId: call.id, operation: args.operation, arguments: args,
      success: Boolean(matching), result: matching?.spatialResult ?? null,
      receiptMessageIds: receipts.map(message => message.id)};
  });
  return {
    operations,
    generationCalls: operations.filter(call => call.operation !== 'read'),
    readCalls: operations.filter(call => call.operation === 'read'),
    bufferCalls: operations.filter(call => call.operation === 'buffer'),
  };
}
/** Q04's factual check is independent of any adjacent ranking sentence. */
export function fixedBufferFilterEvidence(calls: readonly ActualToolCall[], messages: readonly PublicMessage[], candidateCount = 5) {
  const summary = spatialCallSummary(calls, messages), first = summary.bufferCalls[0];
  const firstResult = first?.result ? object(first.result, 'first buffer result') : undefined;
  const last = summary.operations.filter(call => call.operation === 'filter').at(-1);
  if (!last?.result || !firstResult) return {status: 'insufficient_evidence' as const, bufferCalls: summary.bufferCalls.length};
  const result = object(last.result, 'filter result'), spatial = object(last.arguments.spatial, 'filter spatial');
  const target = object(spatial.target, 'filter target'), completeness = object(result.completeness, 'completeness');
  const matching = summary.bufferCalls.length === 2 && summary.bufferCalls.every(call => call.success)
    && first.arguments.distanceM === 500 && summary.bufferCalls[1].arguments.distanceM === 1500
    && target.kind === 'result' && target.resultRef === firstResult.resultRef
    && Array.isArray(result.items) && result.items.length === 0 && completeness.candidateCount === candidateCount;
  return {status: matching ? 'matching' as const : 'different' as const, bufferCalls: summary.bufferCalls.length,
    readCalls: summary.readCalls.length, firstResultRef: firstResult.resultRef, usedResultRef: target.resultRef};
}
export function exactSavedGeometry(turn: ObservedTurn, expectedGeometry: unknown, layerId: string, name: string) {
  const delta = stateDelta(turn.before, turn.after);
  const restored = structuredClone(turn.after.version?.document);
  if (restored) for (const layer of restored.layers) layer.features = layer.features.filter(feature => !delta.added.some(row => row.layerId === layer.layerId && row.objectId === object(feature, 'feature').objectId));
  const originalDocumentPreserved = isDeepStrictEqual(restored, turn.before.version?.document);
  const matching = originalDocumentPreserved && delta.added.length === 1 && delta.added[0].layerId === layerId && delta.added[0].feature.name === name
    && isDeepStrictEqual(delta.added[0].feature.geometry, expectedGeometry)
    && delta.removed.length === 0 && delta.changed.length === 0 && !delta.currentChanged && !delta.publicationsChanged;
  return {status: matching ? 'matching' as const : delta.added.length === 0 ? 'missing' as const : 'different' as const, originalDocumentPreserved, ...delta};
}

export function aggregateAxes(raw: unknown, unit: 'claim' | 'task'): {axes: Axes; verdict: Verdict} {
  const value = object(raw, 'axes');
  assert.deepEqual(Object.keys(value).sort(), [...axisNames].sort(), 'Missing or extra axes');
  for (const name of axisNames) {
    assert.ok(typeof value[name] === 'string' && ['pass', 'fail', 'pending', 'na'].includes(value[name]), `Invalid axis ${name}`);
    if (unit === 'task' && name !== 'processFacts') assert.notEqual(value[name], 'na', 'Task core axis cannot be na');
  }
  const active = axisNames.map(name => value[name]).filter(value => value !== 'na');
  assert.ok(active.length, 'No applicable axes');
  const verdict = active.includes('fail') ? 'fail' : active.includes('pending') ? 'pending' : 'pass';
  return {axes: value as Axes, verdict};
}
/** R12 has no required model total. Historical R11 contradictions remain invalid under their original contract. */
export function assessJudgment(raw: unknown, expected: {id: string; unit: 'claim' | 'task'; origin: 'historical-r11' | 'r12'}) {
  try {
    const value = object(raw, 'judgment');
    const historical = expected.origin === 'historical-r11';
    const normalized = historical ? normalizeJudgment(value) : {canonical: value, extensions: {}};
    const fields = normalized.canonical;
    assert.equal(fields.schemaVersion, historical ? 1 : 2, 'Unexpected schema version');
    assert.equal(fields.id, expected.id, 'Judgment id mismatch'); assert.equal(fields.unit, expected.unit, 'Judgment unit mismatch');
    const {axes, verdict} = aggregateAxes(fields.axes, expected.unit);
    assert.ok(typeof fields.clarity === 'string' && ['clear', 'awkward', 'ambiguous', 'pending'].includes(fields.clarity), 'Invalid clarity enum');
    assert.ok(typeof fields.severity === 'string' && ['none', 'material', 'critical'].includes(fields.severity), 'Invalid severity enum');
    nonblank(fields.reason, 'reason');
    assert.ok(Array.isArray(fields.evidence) && fields.evidence.length > 0, 'Evidence is required');
    for (const item of fields.evidence) {
      const evidence = object(item, 'evidence');
      assert.deepEqual(Object.keys(evidence).sort(), ['interpretation', 'quote', 'sourceLine'], 'Invalid evidence keys');
      assert.ok(evidence.sourceLine === null || (Number.isSafeInteger(evidence.sourceLine) && Number(evidence.sourceLine) >= 1), 'Invalid sourceLine');
      nonblank(evidence.quote, 'quote'); nonblank(evidence.interpretation, 'interpretation');
    }
    if (Object.hasOwn(fields, 'verdict')) assert.ok(typeof fields.verdict === 'string' && ['pass', 'fail', 'pending'].includes(fields.verdict), 'Invalid supplied verdict');
    const suppliedVerdict = fields.verdict ?? null, totalMismatch = suppliedVerdict !== null && suppliedVerdict !== verdict;
    if (historical) assert.ok(!totalMismatch, 'Historical verdict contradicts axes');
    assert.equal(fields.severity === 'none', verdict !== 'fail', 'Severity contradicts computed verdict');
    return {status: 'valid' as const, raw, verdict, axes, suppliedVerdict, totalMismatch, extensions: normalized.extensions};
  } catch (error) {
    return {status: 'judge_error' as const, raw, errors: [error instanceof Error ? error.message : 'Invalid judgment']};
  }
}
