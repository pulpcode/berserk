import { expect,it } from 'vitest';
import { validateGeometry } from '../src/spatial/validation.js';
import { relate,measure } from '../src/spatial/geometry.js';
import type { Position } from '../src/contracts/context.js';
const square=(x:number,y:number,w:number):Position[]=>[[x,y],[x+w,y],[x+w,y+w],[x,y+w],[x,y]];
it('rejects outside, nested, overlapping and boundary-touching holes instead of calculating false area',()=>{
  const outer=square(0,0,4);
  expect(()=>validateGeometry({type:'Polygon',coordinates:[[[0,0],[1,1],[2,2],[0,0]]]})).toThrow();
  for(const holes of [[square(5,5,1)],[square(1,1,2),square(1.5,1.5,.2)],[square(1,1,2),square(2,2,1.5)],[square(0,1,1)]]) {
    expect(()=>validateGeometry({type:'Polygon',coordinates:[outer,...holes]})).toThrow();
  }
});
it('keeps valid holes, disjoint multipolygons and an island inside a hole without flattening',()=>{
  const polygon={type:'Polygon' as const,coordinates:[square(0,0,4),square(1,1,2)]};
  expect(validateGeometry(polygon)).toBe(10);
  expect(validateGeometry({type:'MultiPolygon',coordinates:[polygon.coordinates,[square(1.5,1.5,.2)]]})).toBe(15);
  expect(validateGeometry({type:'MultiPolygon',coordinates:[[square(0,0,1)],[square(2,2,1)]]})).toBe(10);
  expect(()=>validateGeometry({type:'MultiPolygon',coordinates:[[square(0,0,2)],[square(1,1,2)]]})).toThrow();
});
it('rejects combined date-line topology while retaining correct cross-date-line geodesic distances',()=>{
  expect(()=>relate('intersects',{type:'LineString',coordinates:[[179,0],[180,0]]},{type:'LineString',coordinates:[[-180,0],[-179,0]]})).toThrow('跨度超过');
  expect(measure('distance',{type:'Point',coordinates:[179.9,0]},{type:'Point',coordinates:[-179.9,0]})).toBeCloseTo(22239.016,2);
});
