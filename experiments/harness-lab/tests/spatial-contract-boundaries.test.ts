import { describe, expect, it } from 'vitest';
import { spatialToolResult } from '../src/pi/spatial-results.js';
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

it('strictly pairs explained v3 text with untouched native v1 data and accepts old v1 text',()=>{
 const original=result(),before=JSON.stringify(original),oldText=text(original),tool=spatialToolResult(original),model=JSON.parse(tool.content[0].text);
 expect(model.format).toBe('spatial.model-result.v3');expect(model.data).toEqual(projectSpatialResult(original));
 expect(model.meaning.effect).toContain('没有重新计算');
 expect(extractSpatialResult(tool.details,'spatial_analyze',false,tool.content[0].text)).toEqual(original);
 expect(extractSpatialResult(tool.details,'spatial_analyze',false,oldText)).toEqual(original);
 for(const bad of [{...model,meaning:{...model.meaning,effect:'刚刚保存'}},{...model,extra:true},{...model,meaning:undefined},{...model,data:{...model.data,createdAt:'2026-01-01T00:00:00Z'}}]) {
  expect(extractSpatialResult(tool.details,'spatial_analyze',false,JSON.stringify(bad))).toBeNull();
 }
 expect(JSON.stringify(original)).toBe(before);expect(text(original)).toBe(oldText);
});
it('describes buffer inputs, filtered matches and grouped objects as different counts',()=>{
 const base=result();delete base.delivery;
 const explained=(r:SpatialResult)=>JSON.parse(spatialToolResult(r).content[0].text).meaning;
 const buffer={...base,operation:'buffer' as const,parameters:{operation:'buffer' as const,input:base.scope[0],distanceM:500}};
 expect(explained(buffer).counts).toContain('缓冲输入1个对象');expect(explained(buffer).counts).toContain('items是原输入');
 expect(explained(buffer).effect).toContain('已形成固定分析结果');expect(explained(buffer).scope).toContain('不代表整个图层');
 const filtered={...base,operation:'filter' as const,parameters:{operation:'filter' as const,input:base.scope[0]},completeness:{status:'complete' as const,candidateCount:5},items:[]};
 expect(explained(filtered).counts).toContain('输入5个对象，满足本次全部条件0个');
 expect(explained({...filtered,operation:'summarize',parameters:{operation:'summarize',input:base.scope[0],field:'capacity'}}).counts).toContain('不是属性数值求和');
});
