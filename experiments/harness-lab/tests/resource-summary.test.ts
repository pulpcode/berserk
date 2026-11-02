import { describe, expect, it } from 'vitest';
import { summarizeResources } from '../src/contracts/resource-summary.js';
import { organizeResources } from '../src/context/task-resources.js';
import type { ResourceRecord } from '../src/contracts/resource-results.js';
const at='2026-11-02T05:00:00Z';
const evidence=[{kind:'declaration' as const,note:'构造边界数据，不是历史记录'}];
function row(id:string, memberIds?:string[], value:number|null=memberIds?.length??2):ResourceRecord {
 const resource={meaning:'actual_resource' as const,category:'vehicle' as const,granularity:'aggregate' as const,quantity:{value,unit:'辆' as const,meaning:'entities' as const,scope:'fleet',evidence}};
 return {id,name:id,resource,source:{ref:{systemId:'source',objectType:'resource',objectId:id},revision:1,asOf:at,queriedAt:at,data:{resource,...(memberIds?{coverage:{scope:'fleet',complete:true,memberEntityIds:memberIds}}:{})}},relationBasis:[]};
}
function individual(id:string):ResourceRecord {const r=row(id);r.resource.granularity='individual';r.resource.quantity!.value=1;r.source!.data!.entityId=id;return r;}
const summary=(rows:ResourceRecord[])=>summarizeResources(rows,organizeResources(rows,'task',at),at);
describe('T06—T12 independently specified quantity expectations',()=>{
 it.each([
  ['overlap',[['X','Y'],['Y','Z']],3],
  ['disjoint',[['X','Y'],['Z','W']],4],
  ['identical',[['X','Y'],['X','Y']],2],
 ] as const)('T06/T07 %s',(_name,sets,total)=>{expect(summary(sets.map((m,i)=>row(String(i),[...m]))).quantities).toEqual([expect.objectContaining({value:total,knownValue:total,unknownCount:0})]);});
 it('T08 complete plus unknown does not add overlapping declarations to knownValue',()=>{
  expect(summary([row('A',['X','Y']),row('B')]).quantities).toEqual([expect.objectContaining({value:null,knownValue:2,unknownCount:1})]);
 });
 it('T09 two unknown aggregates cannot claim a known additive contribution',()=>{
  expect(summary([row('A'),row('B')]).quantities).toEqual([expect.objectContaining({value:null,knownValue:0,unknownCount:2})]);
 });
 it('a single aggregate keeps its declared quantity without claiming a member list',()=>{
  expect(summary([row('A')]).quantities[0]).toMatchObject({value:2,knownValue:2});
  const available=row('available',undefined,3);available.resource.quantity!.meaning='available';
  expect(summary([available]).quantities[0]).toMatchObject({value:3,knownValue:3});
 });
 it('T10 multiple covering aggregates and controlled copies count each member once',()=>{
  const x=individual('X'),copy=structuredClone(x);copy.id='copy';delete copy.source;copy.annotation={ref:{setId:'set',revision:1},objectId:'copy',hash:'hash'};copy.association={source:{...x.source!.ref,objectType:'resource'},entityId:'X',sourceRevision:1};
  expect(summary([row('A',['X','Y']),row('B',['X','Z']),x,copy]).quantities[0]).toMatchObject({value:3,knownValue:3});
 });
 it('T11 same member ID in different source namespaces is not merged',()=>{
  const a=row('A',['X']),b=row('B',['X']);b.source!.ref.systemId='second';
  expect(summary([a,b]).quantities.map(q=>q.value)).toEqual([1,1]);
 });
 it.each(['scope','time','meaning','category','unit','conditions'] as const)('T11 incompatible %s stays separate',mode=>{
  const a=row('A',['X','Y']),b=row('B',['Y','Z']);
  if(mode==='scope')b.resource.quantity!.scope='other';
  if(mode==='time')b.resource.quantity!.effectiveAt='2026-11-02T04:00:00Z';
  if(mode==='meaning')b.resource.quantity!.meaning='available';
  if(mode==='category')b.resource.category='fire_engine';
  if(mode==='unit'){b.resource.category='rescue_boat';b.resource.quantity!.unit='艘';}
  if(mode==='conditions')b.resource.quantity!.conditions=['待核实'];
  expect(summary([a,b]).quantities).toHaveLength(2);
 });
 it('T11 declarations without a namespace never establish matching member identity',()=>{
  const a=row('A',['X']),b=row('B',['X']);for(const r of [a,b]){delete r.source;r.annotation={ref:{setId:'set',revision:1},objectId:r.id,hash:'hash'};}
  expect(summary([a,b]).quantities).toHaveLength(2);
 });
 it('T12 complete member count contradicting declared quantity remains unknown',()=>{
  expect(summary([row('A',['X','Y','Z'],4)]).quantities[0]).toMatchObject({value:null,knownValue:0,unknownCount:1});
 });
 it('T12 all-member coverage cannot identify the available subset',()=>{
  const a=row('A',['X','Y']),b=row('B',['Y','Z']);for(const r of [a,b])r.resource.quantity!.meaning='available';
  expect(summary([a,b]).quantities[0]).toMatchObject({value:null,knownValue:0,unknownCount:2});
 });
 it('duplicate entity category conflicts do not silently take the first record',()=>{
  const a=individual('X'),b=individual('X');b.id='other-report';b.resource.category='fire_engine';
  expect(summary([a,b]).quantities.every(q=>q.value===null&&q.knownValue===0)).toBe(true);
 });
 it('expired, conditional and missing counts do not become known contributions',()=>{
  const a=row('expired',['X']);a.resource.quantity!.validUntil='2026-11-02T04:00:00Z';
  const b=row('conditional',['Y']);b.resource.quantity!.conditions=['确认'];
  expect(summary([a,b,row('missing',undefined,null)]).quantities.every(q=>q.value===null&&q.knownValue===0)).toBe(true);
 });
});
