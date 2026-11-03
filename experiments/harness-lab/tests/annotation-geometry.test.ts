import { expect, it } from 'vitest';
import type { AnnotationFeature } from '../src/contracts/annotations.js';
import { validateAnnotationGeometry } from '../src/contracts/annotation-geometry.js';
import { feature } from '../src/annotations/validation.js';

it.each([
  {kind:'point',geometry:{type:'Point',coordinates:[103,1]}},
  {kind:'text',geometry:{type:'Point',coordinates:[-180,90]}},
  {kind:'line',geometry:{type:'LineString',coordinates:[[103,1],[104,2]]}},
  {kind:'polygon',geometry:{type:'Polygon',coordinates:[[[103,1],[104,1],[104,2],[103,1]]]}},
] as Array<Pick<AnnotationFeature,'kind'|'geometry'>>)('uses identical saved and preview geometry for $kind',({kind,geometry})=>{
  const before=structuredClone(geometry);
  const parsed=validateAnnotationGeometry(geometry,kind);
  expect(parsed).toEqual(geometry);expect(parsed).not.toBe(geometry);
  expect(feature({objectId:'test',name:'测试',kind,geometry}).geometry).toEqual(parsed);
  expect(geometry).toEqual(before);
});

it.each([
  {kind:'point',geometry:{type:'Point',coordinates:[0,91]}},
  {kind:'point',geometry:{type:'Point',coordinates:[Infinity,0]}},
  {kind:'point',geometry:{type:'Point',coordinates:[0,0],extra:true}},
  {kind:'line',geometry:{type:'LineString',coordinates:[[0,0]]}},
  {kind:'line',geometry:{type:'LineString',coordinates:[[0,0],[0,0]]}},
  {kind:'polygon',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1]]]}},
  {kind:'polygon',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,2]]]}},
  {kind:'polygon',geometry:{type:'Polygon',coordinates:[[[0,0],[1,1],[1,0],[0,1],[0,0]]]}},
  {kind:'polygon',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[2,0],[0,0]]]}},
  {kind:'polygon',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]],[[0,0],[1,0],[1,1],[0,0]]]}},
  {kind:'text',geometry:{type:'LineString',coordinates:[[0,0],[1,1]]}},
] as Array<{kind:AnnotationFeature['kind'];geometry:unknown}>)('rejects invalid preview geometry with the saved validation error: %j',({kind,geometry})=>{
  expect(()=>validateAnnotationGeometry(geometry,kind)).toThrow(expect.objectContaining({code:'INVALID_INPUT'}));
  expect(()=>feature({objectId:'test',name:'测试',kind,geometry})).toThrow(expect.objectContaining({code:'INVALID_INPUT'}));
});
