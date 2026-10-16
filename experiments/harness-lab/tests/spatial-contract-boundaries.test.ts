import { describe, expect, it } from 'vitest';
import { extractSpatialResult, projectSpatialResult, SPATIAL_MODEL_FORMAT, type SpatialResult } from '../src/contracts/spatial.js';

function result(): SpatialResult {
  const requestId = '00000000-0000-4000-8000-000000000001';
  const toolCallId = 'analysis-1';
  const input = { kind: 'source' as const, systemId: 'fixture', objectRefs: [{ systemId: 'fixture', objectType: 'resource', objectId: 'one' }] };
  return {
    schemaVersion: 1, resultRef: `spatial:${requestId}:${toolCallId}`, requestId, toolCallId,
    delivery: { requestId, toolCallId }, parameters: { operation: 'measure', metric: 'distance', input, target: input }, operation: 'measure', createdAt: '2026-10-16T00:00:00.000Z', scope: [input, input],
    completeness: { status: 'complete', candidateCount: 1 },
    items: [{ id: 'fixture:resource:one', name: '位置', geometry: { type: 'Point', coordinates: [120, 30] }, properties: { category: 'known' }, source: { ref: input.objectRefs[0], revision: 1, queriedAt: '2026-10-16T00:00:00.000Z' } }],
    values: { value: 0, unit: 'm' }, method: 'spherical', limitations: ['球面近似'],
    provenance: [{ input, queriedAt: '2026-10-16T00:00:00.000Z', asOf: '2026-10-16T00:00:00.000Z' }],
  };
}
const text = (value: SpatialResult) => JSON.stringify({ format: SPATIAL_MODEL_FORMAT, data: projectSpatialResult(value) });

describe('spatial evidence boundary independent of the calculator', () => {
  it('clones valid evidence and retains historical coordinates outside model text', () => {
    const value = result();
    const decoded = extractSpatialResult({ spatialResult: value }, 'spatial_analyze', false, text(value));
    expect(decoded).toEqual(value);
    expect(decoded).not.toBe(value);
    expect(text(value)).not.toContain('coordinates');
    value.items[0].geometry = { type: 'Point', coordinates: [121, 31] };
    expect(decoded?.items[0].geometry).toEqual({ type: 'Point', coordinates: [120, 30] });
  });

  it('distinguishes absent legacy data from invalid new data and refuses wrong-tool/error results', () => {
    const value = result();
    expect(extractSpatialResult({}, 'spatial_analyze')).toBeUndefined();
    expect(extractSpatialResult({ spatialResult: null }, 'spatial_analyze')).toBeNull();
    expect(extractSpatialResult({ spatialResult: value }, 'situation_query', false, text(value))).toBeNull();
    expect(extractSpatialResult({ spatialResult: value }, 'spatial_analyze', true, text(value))).toBeNull();
    expect(extractSpatialResult({ spatialResult: value }, 'spatial_analyze', false, '{}')).toBeNull();
    const changed = result(); changed.values = { value: 9, unit: 'm' };
    expect(extractSpatialResult({ spatialResult: value }, 'spatial_analyze', false, text(changed))).toBeNull();
  });

  it.each([
    ['missing coordinate', { type: 'Point', coordinates: [120] }],
    ['nonfinite coordinate', { type: 'Point', coordinates: [120, Number.NaN] }],
    ['longitude outside range', { type: 'Point', coordinates: [181, 0] }],
    ['latitude outside range', { type: 'Point', coordinates: [120, 91] }],
    ['short line', { type: 'LineString', coordinates: [[120, 30]] }],
    ['unclosed polygon', { type: 'Polygon', coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31]]] }],
    ['empty multipolygon', { type: 'MultiPolygon', coordinates: [] }],
    ['invalid nested type', { type: 'Polygon', coordinates: ['invalid'] }],
  ])('rejects %s before it can reach the renderer', (_label, geometry) => {
    const value = result();
    const bad = { ...value, items: [{ ...value.items[0], geometry }] };
    expect(extractSpatialResult({ spatialResult: bad }, 'spatial_analyze')).toBeNull();
  });

  it.each([
    ['nonfinite result', { values: { value: Number.POSITIVE_INFINITY, unit: 'm' } }],
    ['unknown unit', { values: { value: 1, unit: 'degrees' } }],
    ['invalid scope', { scope: [{ kind: 'source', systemId: 42 }] }],
    ['invalid provenance time', { provenance: [{ input: { kind: 'source', systemId: 'fixture' }, queriedAt: 'yesterday', asOf: 'yesterday' }] }],
    ['nontext limitations', { limitations: [true] }],
    ['empty identity', { requestId: '' }],
    ['partial success', { completeness: { status: 'partial', candidateCount: 1 } }],
  ])('refuses self-described success with %s', (_label, patch) => {
    expect(extractSpatialResult({ spatialResult: { ...result(), ...patch } }, 'spatial_analyze')).toBeNull();
  });
});
