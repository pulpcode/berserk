import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { projectTaskDiscovery, type TaskDiscovery, type AnalysisUpdate } from '../../src/contracts/continuous';
import type { PublicMessage } from '../../src/contracts';
import { projectSpatialResult, type SpatialResult } from '../../src/contracts/spatial';
import { ContinuousCoverage } from '../../src/web/ContinuousAssessments';
import { ContextEvidence, isContextEvidence } from '../../src/web/ContextEvidence';
import { contextDraft, TaskContextSummary, validateContext } from '../../src/web/TaskContextEditor';
import { spatialMapEntries } from '../../src/web/situation/evidence';

const requestId = '00000000-0000-4000-8000-000000000001';
const source = { kind: 'source' as const, systemId: 'situation' };
const result: SpatialResult = {
  schemaVersion: 1, resultRef: `spatial:${requestId}:relation`, requestId, toolCallId: 'relation',
  operation: 'relate', parameters: { operation: 'relate', relation: 'intersects', input: source, target: source },
  createdAt: '2026-10-27T01:00:00Z', scope: [source, source], completeness: { status: 'complete', candidateCount: 1 },
  items: [{ id: 'route', name: '配送路线', geometry: { type: 'LineString', coordinates: [[120, 36], [120.02, 36]] }, properties: {} }],
  referenceItems: [{ id: 'zone', name: '封控区域', geometry: { type: 'Polygon', coordinates: [[[120.005, 35.99], [120.015, 35.99], [120.015, 36.01], [120.005, 36.01], [120.005, 35.99]]] }, properties: {} }],
  values: { relation: 'intersects', matches: true }, method: '固定来源边界相交计算', limitations: ['相交包含边界接触'],
  provenance: [{ input: source, queriedAt: '2026-10-27T01:00:00Z', asOf: '2026-10-27T00:59:00Z', sourceRefs: [{ systemId: 'situation', objectType: 'area', objectId: 'zone', revision: 2 }] }],
};
const message: PublicMessage = { id: 'relation', role: 'tool', toolName: 'spatial_analyze', requestId, toolCallId: 'relation', spatialResult: result, text: JSON.stringify({ format: 'spatial.model-result.v1', data: projectSpatialResult(result) }) };
const update: AnalysisUpdate = { taskUpdates: [], unassigned: { significant: false, reason: '已核对' }, uncertainties: [], toolCallId: 'record', recordedAt: '2026-10-27T01:01:00Z' };

test('optional object roles survive task drafts without inventing roles for legacy references', () => {
  const context = { businessRefs: [{ systemId: 'situation', objectType: 'road', objectId: 'r1', label: '实际路线', role: 'route' as const }, { systemId: 'situation', objectType: 'area', objectId: 'z1' }] };
  const draft = contextDraft(context);
  expect(draft.refs.map(ref => ref.role)).toEqual(['route', '']);
  expect(validateContext(draft)).toEqual({ context, errors: {} });
  const html = renderToStaticMarkup(createElement(TaskContextSummary, { context }));
  expect(html).toContain('使用路线'); expect(html).toContain('用途未明确');
  const empty = contextDraft(); empty.refs.push({ systemId: '', objectType: '', objectId: '', label: '', role: '' });
  expect(validateContext(empty).context).toBeNull();
  empty.refs[0]!.role = 'work_area';
  expect(validateContext(empty).errors['context-objectId-0']).toBeTruthy();
});

test('coverage distinguishes assessed, unrelated and uncertain tasks without claiming old rounds were complete', () => {
  const taskCoverage: NonNullable<AnalysisUpdate['taskCoverage']> = [
    { taskId: 'a', taskTitle: '上午配送', taskRevision: 2, status: 'assessed', reason: '空间相交，继续核对执行时间' },
    { taskId: 'b', taskTitle: '区域外作业', taskRevision: 1, status: 'unrelated', reason: '实际范围不相交' },
    { taskId: 'c', taskTitle: '路线缺失任务', taskRevision: 3, status: 'uncertain', reason: '缺少实际路线，不能排除影响' },
  ];
  const html = renderToStaticMarkup(createElement(ContinuousCoverage, { update: { ...update, taskCoverage } }));
  for (const text of ['3 个任务', '1 个待核实', '已评估', '已核验无关联', '关联待核实', '缺少实际路线']) expect(html).toContain(text);
  const task = renderToStaticMarkup(createElement(ContinuousCoverage, { update: { ...update, taskCoverage }, taskId: 'c' }));
  expect(task).toContain('路线缺失任务'); expect(task).not.toContain('上午配送');
  const old = renderToStaticMarkup(createElement(ContinuousCoverage, { update }));
  expect(old).toContain('未记录任务覆盖清单'); expect(old).not.toContain('0 个任务');
});

test('continuous evidence opens only validated fixed spatial snapshots and retains their original source revision', () => {
  expect(isContextEvidence(message)).toBe(true);
  const html = renderToStaticMarkup(createElement(ContextEvidence, { messages: [message] }));
  for (const text of ['固定空间依据', '相交：是', '版本 2', '打开本次固定分析结果', '不重新查询当前位置']) expect(html).toContain(text);
  expect(html).not.toContain('打开当前来源态势');
  expect(spatialMapEntries([message])[0]?.referenceItems?.[0]?.geometry).toEqual(result.referenceItems![0]!.geometry);
  for (const extra of [{ spatialResult: null }, { requestId: 'another-request' }, { text: '已完成空间计算' }, { isError: true }, { resultMissing: true as const }]) {
    const altered = { ...message, ...extra };
    expect(isContextEvidence(altered)).toBe(false);
    expect(renderToStaticMarkup(createElement(ContextEvidence, { messages: [altered] }))).toBe('');
  }
});

test('task discovery maps retain verified nested results without treating a candidate as confirmed impact', () => {
  const toolCallId = 'discover';
  const nested: SpatialResult = { ...result, toolCallId: `${toolCallId}:spatial:0`, resultRef: `spatial:${requestId}:${encodeURIComponent(`${toolCallId}:spatial:0`)}` };
  const discovery: TaskDiscovery = { schemaVersion: 1, requestId, toolCallId, queriedAt: result.createdAt,
    inputs: [{ inputId: 'source-input', objectRefs: [], resolved: false, reason: '缺少明确对象编号' }],
    tasks: [{ task: { id: 'a', title: '配送任务', goal: '按计划配送', revision: 2 }, candidate: 'related', reason: '路线与区域相交，尚需核对时间', spatialResultRefs: [nested.resultRef] }], spatialResults: [nested], sourceQueries: [{ systemId: 'situation', query: { systemId: 'situation', mode: 'current', limit: 100 }, queriedAt: result.createdAt, data: { systemId: 'situation', asOf: result.createdAt, items: [{ ref: { systemId: 'situation', objectType: 'road', objectId: 'r1' }, name: '实际路线', revision: 2, areaIds: [], effectiveAt: null, validTime: null, properties: {}, geometry: { type: 'LineString', coordinates: [[120, 36], [120.02, 36]] } }], limit: 100, nextCursor: null, hasMore: false, timeUnknownCount: 0, unknownRefs: [], changeCursor: 'fixed' } }] };
  const entry: PublicMessage = { id: toolCallId, role: 'tool', requestId, toolCallId, toolName: 'analysis_task_candidates', taskDiscovery: discovery, text: JSON.stringify(projectTaskDiscovery(discovery)) };
  const html = renderToStaticMarkup(createElement(ContextEvidence, { messages: [entry] }));
  expect(html).toContain('来源查询快照'); expect(html).toContain('版本 2'); expect(html).toContain('实际查询条件与返回内容');
  expect(html).toContain('任务关联核对'); expect(html).toContain('关联候选'); expect(html).toContain('缺少明确对象编号');
  expect(html).toContain('打开本次固定分析结果'); expect(html).not.toContain('打开当前来源态势');
  expect(spatialMapEntries([entry])).toEqual([nested]);
  for (const invalid of [{ ...entry, requestId: 'copied' }, { ...entry, taskDiscovery: null }, { ...entry, text: '查询完成' }, { ...entry, taskDiscovery: { ...discovery, spatialResults: [{ ...nested, toolCallId: 'foreign' }] } }]) {
    expect(isContextEvidence(invalid)).toBe(false); expect(spatialMapEntries([invalid])).toEqual([]);
  }
});
