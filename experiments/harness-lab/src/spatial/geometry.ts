import { distance } from '@turf/distance';
import { length } from '@turf/length';
import { area } from '@turf/area';
import { pointToLineDistance } from '@turf/point-to-line-distance';
import { buffer } from '@turf/buffer';
import { booleanIntersects } from '@turf/boolean-intersects';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { difference } from '@turf/difference';
import type { SpatialGeometry, SpatialRelation, SpatialRequest } from '../contracts/spatial.js';
import { spatialError, validateGeometry, positions } from './validation.js';
import type { Position } from '../contracts/context.js';

export const METHOD='Turf 7.2.0; sphere R=6371008.8m; WGS84 planar topology; buffer AEQD 32 segments per quadrant (point buffers usually 128 edges)';
export const LIMITATIONS=['球面距离/面积不是测绘级椭球测量；拓扑按经纬度线段。','缓冲圆弧每象限近似为 32 段；点缓冲通常为 128 边，线缓冲总边数随形状变化。近似边缘与精确距离阈值可能不同。','最近表示地理距离，不代表路程、时间、可通行或专业适用性。'];
const unsupported=()=>spatialError('UNSUPPORTED_GEOMETRY','该操作不支持这组几何类型；请核对对象与方法。');
export function measure(metric:Extract<SpatialRequest,{operation:'measure'}>['metric'],a:SpatialGeometry,b?:SpatialGeometry):number {
  if(metric==='distance' && a.type==='Point' && b?.type==='Point') return distance(a,b,{units:'meters'});
  if(metric==='point_to_line' && a.type==='Point' && b?.type==='LineString') return pointToLineDistance(a,b,{units:'meters',method:'geodesic'});
  if(metric==='length' && a.type==='LineString' && !b) return length({type:'Feature',properties:{},geometry:a},{units:'meters'});
  if(metric==='area' && ['Polygon','MultiPolygon'].includes(a.type) && !b) return area(a);
  throw unsupported();
}
export function makeBuffer(g:SpatialGeometry,distanceM:number):SpatialGeometry {
  if(!['Point','LineString'].includes(g.type)) throw unsupported();
  if(!Number.isFinite(distanceM) || distanceM<=0 || distanceM>50000) throw spatialError('LIMIT','缓冲距离须大于 0 且不超过 50,000 米。');
  const result=buffer(g,distanceM,{units:'meters',steps:32});
  if(!result) throw spatialError('CALCULATION_FAILED','未能生成有效缓冲。');
  const geometry=result.geometry as SpatialGeometry; validateGeometry(geometry);return geometry;
}
/** Split each segment at all region edges, testing each open subsegment as well as endpoints. */
function coversLine(region:Extract<SpatialGeometry,{type:'Polygon'|'MultiPolygon'}>,line:Position[]):boolean {
  const rings=region.type==='Polygon'?region.coordinates:region.coordinates.flat();
  const inside=(p:Position)=>booleanPointInPolygon(p,region,{ignoreBoundary:false});
  if(!line.every(inside)) return false;
  let comparisons=0;
  for(let i=1;i<line.length;i++) {
    const a=line[i-1],b=line[i],dx=b[0]-a[0],dy=b[1]-a[1],ts=[0,1];
    for(const ring of rings) for(let j=1;j<ring.length;j++) {
      if(++comparisons>500000) throw spatialError('LIMIT','包含关系边界比较超过 500,000 次，请简化或缩小几何。');
      const c=ring[j-1],d=ring[j],ex=d[0]-c[0],ey=d[1]-c[1],den=dx*ey-dy*ex;
      if(den===0) continue;
      const t=((c[0]-a[0])*ey-(c[1]-a[1])*ex)/den,u=((c[0]-a[0])*dy-(c[1]-a[1])*dx)/den;
      if(t>0 && t<1 && u>=0 && u<=1) ts.push(t);
    }
    ts.sort((x,y)=>x-y);
    for(let j=1;j<ts.length;j++) {const t=(ts[j-1]+ts[j])/2;if(!inside([a[0]+dx*t,a[1]+dy*t])) return false;}
  }
  return true;
}
export function relate(relation:SpatialRelation,a:SpatialGeometry,b:SpatialGeometry):boolean {
  const all=[...positions(a.coordinates),...positions(b.coordinates)],xs=all.map(p=>p[0]),ys=all.map(p=>p[1]);
  if(Math.max(...xs)-Math.min(...xs)>10 || Math.max(...ys)-Math.min(...ys)>10) throw spatialError('UNSUPPORTED_REGION','拓扑分析组合范围跨度超过 10°，暂不支持。');
  if(relation!=='contains') {const hit=booleanIntersects(a,b);return relation==='intersects'?hit:!hit;}
  if(a.type!=='Polygon' && a.type!=='MultiPolygon') throw unsupported();
  if(b.type==='Point') return booleanPointInPolygon(b,a,{ignoreBoundary:false});
  if(b.type==='LineString') return coversLine(a,b.coordinates);
  const result=difference({type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:b},{type:'Feature',properties:{},geometry:a}]});
  return result===null;
}
