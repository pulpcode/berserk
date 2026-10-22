import { distance } from '@turf/distance';
import { length } from '@turf/length';
import { area } from '@turf/area';
import { pointToLineDistance } from '@turf/point-to-line-distance';
import { buffer } from '@turf/buffer';
import { booleanIntersects } from '@turf/boolean-intersects';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { difference } from '@turf/difference';
import type { SpatialGeometry, SpatialPointPosition, SpatialRelation, SpatialRequest } from '../contracts/spatial.js';
import { spatialError, validateGeometry, positions } from './validation.js';
import type { Position } from '../contracts/context.js';

/** Describes only a new calculation; historical reads keep their stored metadata. */
export function calculationDescription(request:Exclude<SpatialRequest,{operation:'read'}>):{method:string;limitations:string[]} {
  const sphere='Turf 7.2.0; sphere R=6371008.8m';
  const sphericalLimit='球面近似不是测绘级椭球测量；未提供逐结果误差界限。';
  const topology='Turf 7.2.0 + closed-region coverage; WGS84 planar topology';
  const topologyLimit='拓扑按经纬度线段；contains 包含边界，intersects 包括边界接触，不代表道路连通。';
  switch(request.operation) {
    case 'measure':return {method:`${sphere}; ${request.metric}; unit=${request.metric==='area'?'m²':'m'}`,limitations:[sphericalLimit,...(request.metric==='distance'||request.metric==='point_to_line'?['地理距离不代表路程、行程时间或可通行性。']:[])]};
    case 'classify_points':return {method:'Turf 7.2.0 booleanPointInPolygon; WGS84 planar topology; closed coverage vs strict interior',limitations:['按经纬度线段判断单个 Polygon（含孔）；外环和内环边界均为 boundary，孔内部为 exterior。','不增加隐含距离容差；边界附近不等于位于边界，不声称测绘级精度。']};
    case 'relate':return {method:`${topology}; input ${request.relation} target`,limitations:[topologyLimit]};
    case 'buffer':return {method:'Turf 7.2.0; buffer AEQD 32 segments per quadrant (point buffers usually 128 edges); radius in m',limitations:['缓冲圆弧每象限近似为 32 段；点缓冲通常为 128 边，线缓冲总边数随形状变化。近似边缘与精确距离阈值可能不同。']};
    case 'nearest':return {method:`${sphere}; point distance ascending, then full identity; first count items`,limitations:[sphericalLimit,'最近表示限定候选中的地理距离，不代表路程、时间、可通行或专业适用性；同距不扩大 count。']};
    case 'summarize':return {method:'Count unique complete object identities by scalar field; null is a separate group',limitations:['统计输入集合的对象数，不是属性数值之和或资源容量；缺字段不能视为零或空类别。']};
    case 'filter': {
      const method=['Filter input candidates'];
      const limitations=['仅表示明确输入范围内的匹配对象；candidateCount 是筛选前数量，items 是命中集合。'];
      if(request.spatial) {
        if('distanceM' in request.spatial) {method.push(`${sphere}; candidate point to target point/line distance <= distanceM (m)`);limitations.push(sphericalLimit,'距离阈值不增加隐式容差，不等同于近似缓冲多边形的包含判断。');}
        else {method.push(`${topology}; target ${request.spatial.relation} candidate`);limitations.push(topologyLimit);}
      }
      if(request.attributes?.length) {method.push('AND predicates on actual top-level scalar fields');limitations.push('全部候选的必需属性均须存在；缺失字段不是条件不匹配。');}
      return {method:method.join('; '),limitations};
    }
  }
}
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
function validateTopologyExtent(a:SpatialGeometry,b:SpatialGeometry):void {
  const all=[...positions(a.coordinates),...positions(b.coordinates)],xs=all.map(p=>p[0]),ys=all.map(p=>p[1]);
  if(Math.max(...xs)-Math.min(...xs)>10 || Math.max(...ys)-Math.min(...ys)>10) throw spatialError('UNSUPPORTED_REGION','拓扑分析组合范围跨度超过 10°，暂不支持。');
}
export function classifyPoint(point:SpatialGeometry,region:SpatialGeometry):SpatialPointPosition {
  if(point.type!=='Point' || region.type!=='Polygon') throw unsupported();
  validateTopologyExtent(point,region);
  if(!booleanPointInPolygon(point,region,{ignoreBoundary:false})) return 'exterior';
  return booleanPointInPolygon(point,region,{ignoreBoundary:true})?'interior':'boundary';
}
export function relate(relation:SpatialRelation,a:SpatialGeometry,b:SpatialGeometry):boolean {
  validateTopologyExtent(a,b);
  if(relation!=='contains') {const hit=booleanIntersects(a,b);return relation==='intersects'?hit:!hit;}
  if(a.type!=='Polygon' && a.type!=='MultiPolygon') throw unsupported();
  if(b.type==='Point') return booleanPointInPolygon(b,a,{ignoreBoundary:false});
  if(b.type==='LineString') return coversLine(a,b.coordinates);
  const result=difference({type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:b},{type:'Feature',properties:{},geometry:a}]});
  return result===null;
}
