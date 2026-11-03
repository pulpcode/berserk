import type { AnnotationFeature } from './annotations.js';
import type { Position } from './context.js';
import { RequestError } from './errors.js';

const invalid = (message = '标注输入无效。') => new RequestError('INVALID_INPUT', message);

/** Shared saved/preview geometry validation. Does not close rings or rewrite user coordinates. */
function position(value: unknown): Position {
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'number' || typeof value[1] !== 'number' || !Number.isFinite(value[0]) || !Number.isFinite(value[1]) || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) throw invalid('坐标必须是有效的 WGS84 经度、纬度。');
  return [value[0],value[1]];
}
function equal(a: Position,b: Position) { return a[0] === b[0] && a[1] === b[1]; }
function cross(a: Position,b: Position,c: Position) { return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]); }
function between(a: Position,b: Position,c: Position) { return cross(a,b,c) === 0 && c[0] >= Math.min(a[0],b[0]) && c[0] <= Math.max(a[0],b[0]) && c[1] >= Math.min(a[1],b[1]) && c[1] <= Math.max(a[1],b[1]); }
function intersects(a: Position,b: Position,c: Position,d: Position) { const x=cross(a,b,c),y=cross(a,b,d),z=cross(c,d,a),w=cross(c,d,b); return (x*y<0 && z*w<0) || between(a,b,c) || between(a,b,d) || between(c,d,a) || between(c,d,b); }
export function validateAnnotationGeometry(value: unknown, kind: AnnotationFeature['kind']): AnnotationFeature['geometry'] {
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!['type','coordinates'].includes(key)) || !Object.hasOwn(value,'type') || !Object.hasOwn(value,'coordinates')) throw invalid();
  const object=value as Record<string,unknown>;
  const expected=kind==='line' ? 'LineString' : kind==='polygon' ? 'Polygon' : 'Point';
  if (object.type !== expected) throw invalid('对象类型与几何不匹配。');
  if (expected==='Point') return {type:'Point',coordinates:position(object.coordinates)};
  const raw=expected==='Polygon' ? object.coordinates : [object.coordinates];
  if (!Array.isArray(raw) || raw.length!==1 || !Array.isArray(raw[0]) || raw[0].length > 20000) throw invalid('仅支持单环面或有界线段。');
  const points=raw[0].map(position);
  if (points.length < (expected==='Polygon' ? 4 : 2) || points.some((point,index)=>index>0 && equal(point,points[index-1]))) throw invalid('几何顶点数量不足或连续重复。');
  if (expected==='LineString') return {type:'LineString',coordinates:points};
  if (!equal(points[0],points.at(-1)!)) throw invalid('多边形必须闭合。');
  let area=0;
  const segments=points.slice(0,-1).map((a,i)=>{const b=points[i+1]; area+=a[0]*b[1]-b[0]*a[1];return {i,a,b,minX:Math.min(a[0],b[0]),maxX:Math.max(a[0],b[0]),minY:Math.min(a[1],b[1]),maxY:Math.max(a[1],b[1])};}).sort((a,b)=>a.minX-b.minX);
  // X sweep and Y bounds avoid a quadratic all-pairs scan for ordinary large rings.
  for(let i=0;i<segments.length;i++) for(let j=i+1;j<segments.length && segments[j].minX<=segments[i].maxX;j++) {
    const a=segments[i],b=segments[j],distance=Math.abs(a.i-b.i);
    if(distance===1 || distance===segments.length-1 || a.maxY<b.minY || b.maxY<a.minY) continue;
    if(intersects(a.a,a.b,b.a,b.b)) throw invalid('多边形不能自交。');
  }
  if (Math.abs(area)<1e-14) throw invalid('多边形面积必须大于零。');
  return {type:'Polygon',coordinates:[points]};
}
