import { describe,it,expect } from 'vitest';
import type { AnnotationFeature } from '../src/contracts/annotations';
import { compareFeatureEdits,featureUpdate,mergeFeatureEdits,preserveUntouchedFields,sameValue } from '../src/web/annotations/edit-changes';
const feature:AnnotationFeature={objectId:'boat',kind:'point',name:'冲锋舟1',geometry:{type:'Point',coordinates:[116,39]},style:{symbolId:'app.rescue-inflatable-boat',heading:45,iconSize:48},attributes:{count:4,unknown:null},sourceRefs:[{systemId:'s',objectType:'boat',objectId:'1'}]};
const at=(value:AnnotationFeature,layerId='rescue')=>({feature:value,layerId});
describe('minimal annotation edit and three-way comparison',()=>{
 it('preserves absent fields and untouched display defaults while changing a name',()=>{
  const raw:AnnotationFeature={objectId:'legacy',kind:'point',name:'原名',geometry:feature.geometry};
  const initial={...raw,note:'',attributes:{},style:{color:'#416858',size:7}};
  const edited=preserveUntouchedFields(raw,initial,{...initial,name:'新名称'});
  expect(edited).toEqual({...raw,name:'新名称'});expect(featureUpdate(at(raw),at(edited))).toEqual({op:'update_object',objectId:'legacy',changes:{name:'新名称'}});
 });
 it('preserves hidden styles, null attributes and source identity for a heading-only edit',()=>{
  const initial={...feature,style:{...feature.style,color:'#416858',size:7}};
  const next=preserveUntouchedFields(feature,initial,{...initial,style:{...initial.style,heading:90}});
  expect(next).toEqual({...feature,style:{...feature.style,heading:90}});
  expect(featureUpdate(at(feature),at(next))).toEqual({op:'update_object',objectId:'boat',changes:{style:{...feature.style,heading:90}}});
 });
 it('keeps explicit removal of heading and final attribute distinct from untouched absence',()=>{
  const next=preserveUntouchedFields(feature,feature,{...feature,style:{symbolId:feature.style!.symbolId,iconSize:48},attributes:{}});
  expect(next.style).not.toHaveProperty('heading');expect(next.attributes).toEqual({});
  expect(featureUpdate(at(feature),at(next))!.changes).toEqual({style:{symbolId:feature.style!.symbolId,iconSize:48},attributes:{}});
 });
 it('merges different fields into latest, including separate attribute keys',()=>{
  const local={...feature,style:{...feature.style,heading:90},attributes:{...feature.attributes,contact:'李队'}};
  const latest={...feature,name:'救援一队',attributes:{...feature.attributes,count:5}};
  const differences=compareFeatureEdits(at(feature),at(local),at(latest));expect(differences.every(d=>!d.conflict)).toBe(true);
  const merged=mergeFeatureEdits(at(latest),differences,{})!;
  expect(merged.feature).toEqual({...latest,style:{...feature.style,heading:90},attributes:{...latest.attributes,contact:'李队'}});
  expect(featureUpdate(at(latest),merged)!.changes).not.toHaveProperty('name');
 });
 it('requires an explicit choice for every divergent field, including null versus deletion',()=>{
  const local={...feature,style:{...feature.style,heading:90},attributes:{count:4}};
  const latest={...feature,style:{...feature.style,heading:180},attributes:{count:4,unknown:'确认'}};
  const differences=compareFeatureEdits(at(feature),at(local),at(latest));const conflicts=differences.filter(d=>d.conflict);expect(conflicts).toHaveLength(2);
  expect(mergeFeatureEdits(at(latest),differences,{})).toBeUndefined();
  const choices=Object.fromEntries(conflicts.map(d=>[d.id,d.field==='heading'?'latest' as const:'local' as const]));const result=mergeFeatureEdits(at(latest),differences,choices)!;
  expect(result.feature.style?.heading).toBe(180);expect(result.feature.attributes).toEqual({count:4});
 });
 it('treats equal concurrent changes as resolved, without an empty update',()=>{
  const next={...feature,name:'一致'};const d=compareFeatureEdits(at(feature),at(next),at(next));expect(d[0]!.conflict).toBe(false);expect(featureUpdate(at(next),mergeFeatureEdits(at(next),d,{})!)).toBeUndefined();
 });
 it('treats geometry and source arrays as whole values and arbitrary attribute names safely',()=>{
  const local={...feature,geometry:{type:'Point' as const,coordinates:[117,39] as [number,number]},attributes:{'a.b':null}};
  const latest={...feature,geometry:{type:'Point' as const,coordinates:[118,39] as [number,number]}};
  const d=compareFeatureEdits(at(feature),at(local,'moved'),at(latest));expect(d.find(v=>v.field==='geometry')!.conflict).toBe(true);
  const choices=Object.fromEntries(d.filter(v=>v.conflict).map(v=>[v.id,'local' as const]));const merged=mergeFeatureEdits(at(latest),d,choices)!;
  expect(merged.feature.geometry).toEqual(local.geometry);expect(merged.layerId).toBe('moved');expect(merged.feature.attributes).toEqual({'a.b':null});expect(merged.feature.sourceRefs).toEqual(feature.sourceRefs);
 });
 it('compares records independent of property order, but distinguishes null, missing and empty',()=>{expect(sameValue({a:1,b:2},{b:2,a:1})).toBe(true);expect(sameValue(null,undefined)).toBe(false);expect(sameValue('',undefined)).toBe(false);});
});

it('preserves ordinary Object prototype key deletions and does not swallow forbidden keys before validation',()=>{
 const base={...feature,attributes:{toString:'原始值',count:4}};const local={...base,attributes:{count:4}};
 const next=preserveUntouchedFields(base,base,local);expect(Object.hasOwn(next.attributes!,'toString')).toBe(false);
 const d=compareFeatureEdits(at(base),at(local),at(base));expect(d.find(item=>item.field==='toString')!.local).toBeUndefined();expect(mergeFeatureEdits(at(base),d,{})!.feature.attributes).toEqual({count:4});
 const unsafe={...feature,attributes:JSON.parse('{"__proto__":null}')};const preserved=preserveUntouchedFields(feature,feature,unsafe);expect(Object.hasOwn(preserved.attributes!,'__proto__')).toBe(true);expect(JSON.stringify(preserved.attributes)).toBe('{"__proto__":null}');
});
