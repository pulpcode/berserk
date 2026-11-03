import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { organizeResources } from '../src/context/task-resources.js';
import { resourceItemExplanation, resourceRecordTimes } from '../src/contracts/resource-explanations.js';
import { extractResourceResult, projectResourceResult, resourceResultValid, type ResourceRecord, type ResourceResult } from '../src/contracts/resource-results.js';
import { summarizeResources } from '../src/contracts/resource-summary.js';
import { ResourceResultCard } from '../src/web/ResourceResultCard.js';
import legacy from './pi/fixtures/resource-result-v1-overlap.json';
const at = '2026-11-02T05:00:00Z';
const evidence = [{ kind: 'declaration' as const, note: '构造边界样例，非历史原句' }];
function row(id: string): ResourceRecord {
  const resource = { meaning: 'actual_resource' as const, category: 'vehicle' as const, granularity: 'individual' as const, quantity: { value: 1, unit: '辆' as const, meaning: 'entities' as const, scope: 'fleet', evidence } };
  return { id, name: id, resource, source: { ref: { systemId: 'source', objectType: 'resource', objectId: id }, revision: 1, asOf: '2026-11-01T00:00:00Z', queriedAt: at, data: { entityId: 'X', resource } }, relationBasis: ['平台任务业务引用'] };
}
function result(rows: ResourceRecord[]): ResourceResult {
  const items = organizeResources(rows, 'task', at);
  return { schemaVersion: 3, resultRef: 'resource:q:c', requestId: 'q', toolCallId: 'c', createdAt: at, owner: { userId: 'u', seatId: 's', taskId: 'task', sessionId: 'session' }, statisticsScope: { at, relation: 'all', availability: 'all' }, parameters: { operation: 'query', purpose: 'data', sources: [{ systemId: 'source' }] }, records: rows, items, coverage: [{ source: 'source', status: 'complete', asOf: '2026-11-01T00:00:00Z' }], relationshipCoverage: { status: 'partial', reason: '非全量任务关系' }, dependencies: { systemIds: ['source'], annotations: [] }, messages: [], exclusions: [], summary: summarizeResources(rows, items, at) };
}
function projected(r: ResourceResult) {
  const p = projectResourceResult(r);
  if (!('resultMeaning' in p)) throw Error('expected v3');
  return p;
}
describe('E01–E06 v3 evidence presentation, constructed boundary fixtures', () => {
  it('E01 separates source snapshot, query, annotation version and fact times', () => {
    const source = row('source'); source.resource.availability = { state: 'available', evidence, reportedAt: '2026-11-02T03:00:00Z', effectiveAt: '2026-11-02T04:00:00Z' };
    const annotation = row('annotation'); delete annotation.source; annotation.annotation = { ref: { setId: 'set', revision: 3 }, objectId: 'point', hash: 'fixed' };
    const r = result([source, annotation]); r.coverage.push({ source: JSON.stringify(annotation.annotation.ref), status: 'complete', asOf: '2026-10-31T00:00:00Z' });
    const sourceTime = resourceRecordTimes(r, source), annotationTime = resourceRecordTimes(r, annotation);
    expect(sourceTime.sourceSnapshotAt?.value).toBe('2026-11-01T00:00:00Z'); expect(sourceTime.sourceQueriedAt?.value).toBe(at);
    expect(annotationTime.annotationVersion?.createdAt).toBe('2026-10-31T00:00:00Z');
    expect(sourceTime.facts).toContainEqual({ field: 'availability', reportedAt: '2026-11-02T03:00:00Z', effectiveAt: '2026-11-02T04:00:00Z' });
    r.coverage.pop(); expect(resourceRecordTimes(r, annotation).annotationVersion).not.toHaveProperty('createdAt');
  });
  it.each(['missing', 'unavailable', 'expired', 'conflict', 'conditions'] as const)('E02 explains %s without changing the stored state', mode => {
    const a = row('a'), b = row('b');
    if (mode !== 'missing') a.resource.availability = { state: mode === 'unavailable' ? 'unavailable' : 'available', evidence };
    if (mode === 'expired') a.resource.availability!.validUntil = '2026-11-02T04:00:00Z';
    if (mode === 'conditions') a.resource.availability!.conditions = ['放行回执待确认'];
    if (mode === 'conflict') b.resource.availability = { state: 'unavailable', evidence };
    const r = result(mode === 'conflict' ? [a,b] : [a]); const bytes = JSON.stringify(r);
    const state = mode === 'unavailable' ? 'unavailable' : mode === 'conflict' ? 'conflict' : 'unknown';
    expect(r.items[0].availability).toBe(state); const explanation = projected(r).items[0].explanation;
    expect(explanation.availability).toMatchObject({ state, evaluatedAt: at });
    expect(explanation.availability.reasons.map(x => x.code)).toContain({ missing: 'missing_evidence', unavailable: 'current_evidence', expired: 'expired', conflict: 'conflict', conditions: 'conditions_unconfirmed' }[mode]);
    if (mode === 'conflict') expect(explanation.availability.reasons.filter(x => x.code === 'current_evidence').map(x => x.recordId)).toEqual(['a','b']);
    expect(JSON.stringify(r)).toBe(bytes); expect(resourceResultValid(r)).toBe(true);
  });
  it('E02 retains simultaneous expired and unconfirmed conditions and uses actual message evidence', () => {
    const a = row('a'); a.resource.availability = { state: 'available', evidence, validUntil: '2026-11-02T04:00:00Z', conditions: ['批准待确认'] };
    const r = result([a]); r.messages = [{ entryId: 'native-user', resourceRef: a.source!.ref, quote: '需要核实', interpretation: 'unverified_user_report' }];
    expect(resourceItemExplanation(r,r.items[0]).availability.reasons.map(x => x.code)).toEqual(['expired','conditions_unconfirmed','unverified_user_report']);
  });
  it('E03 complete overlapping members have explicit overlap evidence, not a blanket entity warning', () => {
    const r = structuredClone(legacy) as ResourceResult; r.schemaVersion = 3; r.summary = summarizeResources(r.records,r.items,r.statisticsScope.at);
    const p = projected(r);
    expect(p.items[0].explanation.identity[0]).toMatchObject({ kind: 'complete_members', overlaps: [{ recordId: r.records[1].id, memberEntityIds: ['Y'] }] });
    expect(p.items[0].limitations).not.toContain('没有可靠实体关联，是否重复未确认。');
    expect(p.summary.limitations).not.toContain('存在实体身份未确认记录；记录数不能作为确定实体总数。');
    expect(p.items[0].explanation.position.message).toContain('位置');
    const html = renderToStaticMarkup(createElement(ResourceResultCard, { result: r }));
    expect(html).toContain('成员身份清单完整'); expect(html).toContain('已知重叠成员：Y'); expect(html).not.toContain('尚未确认实体身份，不能仅按名称合并');
  });
  it('E04/E06 keeps each quantity scope and distinguishes candidates from selected statistics', () => {
    const a = row('a'), b = row('b'); b.source!.data!.entityId = 'Y'; b.resource.quantity!.scope = 'other-fleet';
    const r = result([a,b]), p = projected(r);
    expect(p.summary.quantities.map(q => [q.scope,q.unit,q.value])).toEqual([['fleet','辆',1],['other-fleet','辆',1]]);
    expect(p.resultMeaning.quantityScope).toContain('同单位不表示同一筛选集合');
    r.parameters = { operation:'query',purpose:'task',sources:[{systemId:'source'}] }; r.statisticsScope.relation = 'related'; r.items[1].relation = 'unconfirmed'; r.summary = summarizeResources(r.records,[r.items[0]],at);
    expect(projected(r).resultMeaning).toMatchObject({ candidateItemCount: 2, statisticsItemCount: 1, statisticsRecordCount: 1 });
  });
  it('E05 separates platform linkage, assignment and support and keeps original fact evidence', () => {
    const a = row('a'); const r = result([a]);
    expect(projected(r).items[0].explanation.relation).toMatchObject({ state:'related', basis:['平台任务业务引用'] });
    expect(projected(r).items[0].explanation.relation.message).toContain('不证明已分配或可用');
    for (const relation of ['assigned','potential_support'] as const) {
      a.relationBasis = ['来源任务映射已核实','来源支援规则已核实']; a.resource.taskRelations = [{taskId:'task',relation,evidence}];
      const next = result([a]); expect(projected(next).items[0].explanation.relation.state).toBe(relation); expect(next.records[0].resource.taskRelations![0].evidence).toEqual(evidence);
    }
  });
  it('preserves v1/v2 projection bytes and rejects altered v3 explanatory text', () => {
    for (const version of [1,2] as const) {
      const old = structuredClone(legacy) as ResourceResult; old.schemaVersion = version; if(version === 2) old.summary = summarizeResources(old.records,old.items,old.statisticsScope.at);
      const expected = {...old, records:old.records, items:old.items, page:{offset:0,limit:100,total:old.items.length,hasMore:false}};
      expect(JSON.stringify(projectResourceResult(old))).toBe(JSON.stringify(expected));
    }
    const r = result([row('a')]); const p = projected(r);
    const content = JSON.stringify({format:'resource.model-result.v1',data:p}); expect(extractResourceResult({resourceResult:r},'task_resource_query',false,content)).toEqual(r);
    p.items[0].explanation.availability.state = 'available'; expect(extractResourceResult({resourceResult:r},'task_resource_query',false,JSON.stringify({format:'resource.model-result.v1',data:p}))).toBeNull();
  });
});

it('bounds overlap explanations for 100 legal aggregates with 500 members without truncating data or counts', () => {
  // Review counterexample before repair: raw437929B -> projected34504798B (~13s).
  // Count/size assertions are deterministic; duration is diagnostic only.
  const r = structuredClone(legacy) as ResourceResult; r.schemaVersion = 3;
  const template = r.records[0], itemTemplate = r.items[0];
  const members = Array.from({length:500},(_,i)=>`m${i}`);
  r.records = Array.from({length:100},(_,i)=>{
    const row = structuredClone(template); row.id = row.name = row.source!.ref.objectId = `r${i}`;
    row.resource.quantity!.value = row.source!.data!.resource.quantity!.value = 500;
    row.source!.data!.coverage!.memberEntityIds = [...members]; return row;
  });
  r.items = r.records.map(row=>({...structuredClone(itemTemplate),id:row.id,name:row.name,recordIds:[row.id]}));
  r.summary = summarizeResources(r.records,r.items,r.statisticsScope.at);
  expect(resourceResultValid(r)).toBe(true);
  const rawBytes=Buffer.byteLength(JSON.stringify(r)); expect(rawBytes).toBeLessThan(1024*1024);
  const began=performance.now(),p=projected(r),elapsed=performance.now()-began;
  const projectedBytes=Buffer.byteLength(JSON.stringify(p));
  expect(projectedBytes).toBeLessThan(1024*1024);
  expect(p.summary.quantities[0]).toMatchObject({value:500,knownValue:500});
  for(const item of p.items){
    const identity=item.explanation.identity[0];
    expect(identity).toMatchObject({overlapRecordCount:99,overlapExamplesComplete:false});
    if(!('overlaps' in identity))throw Error('missing aggregate explanation');
    expect(identity.overlaps).toHaveLength(3);
    for(const example of identity.overlaps!){expect(example).toMatchObject({sharedMemberCount:500,memberIdsComplete:false});expect(example.memberEntityIds).toHaveLength(5);}
  }
  expect(p.records[0].source!.data!.coverage!.memberEntityIds).toEqual(members);
  const page=projectedPage(r,0,1);
  expect(page.records).toHaveLength(1); expect(page.records[0].source!.data!.coverage!.memberEntityIds).toEqual(members);
  expect(JSON.stringify(page)).not.toContain('"recordId":"r99"');
  const html=renderToStaticMarkup(createElement(ResourceResultCard,{result:r}));
  expect(html).toContain('仅列示例');expect(html).toContain('共与99条记录存在已知重叠');expect(html).toContain('此处仅列3条');
  console.info(JSON.stringify({fixture:'100x500-aggregate-overlap',rawBytes,projectedBytes,elapsedMs:Math.round(elapsed)}));
});
function projectedPage(r:ResourceResult,offset:number,limit:number){const p=projectResourceResult(r,offset,limit);if(!('resultMeaning' in p))throw Error('expected v3');return p;}

it.each([undefined,'interior','boundary','exterior'] as const)('labels the actual spatial summary selection: %s',position=>{
 const r=result([row('a')]);r.parameters={operation:'summarize',resultRef:'parent',spatialResultRef:'spatial:fixed',...(position?{position}:{})};
 const html=renderToStaticMarkup(createElement(ResourceResultCard,{result:r}));
 expect(html).toContain(position?{interior:'范围内部',boundary:'范围边界',exterior:'范围外部'}[position]:'按所选空间结果集合统计');
 if(!position)expect(html).not.toContain('空间位置：范围内部');
});
