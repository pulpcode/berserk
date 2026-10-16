import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { booleanIntersects } from '@turf/boolean-intersects';
import { intersect } from '@turf/intersect';
import { booleanValid } from '@turf/boolean-valid';
import { kinks } from '@turf/kinks';
import type { SpatialGeometry, SpatialItem } from '../contracts/spatial.js';
import { spatialGeometryValid } from '../contracts/spatial.js';
import { RequestError } from '../contracts/errors.js';
export const spatialError=(code:string,message:string)=>new RequestError(`SPATIAL_${code}`,message);
export const LIMITS={objects:500,vertices:10000,geometryVertices:2000,bytes:1024*1024,milliseconds:3000};
export function positions(value:unknown):number[][] {
  if(!Array.isArray(value)) throw spatialError('GEOMETRY_INVALID','几何坐标无效。');
  if(value.length===2 && value.every(n=>typeof n==='number')) return [value as number[]];
  return value.flatMap(positions);
}
export function validateGeometry(geometry:SpatialGeometry):number {
  if(!spatialGeometryValid(geometry)) throw spatialError('GEOMETRY_MISSING','对象缺少支持的几何，未将其计为不匹配。');
  const coords=positions(geometry.coordinates);
  if(!coords.length || coords.length>LIMITS.geometryVertices) throw spatialError('LIMIT','单几何最多 2,000 顶点。');
  if(coords.some(([x,y])=>!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x)>180 || Math.abs(y)>=80)) throw spatialError('UNSUPPORTED_REGION','仅支持有效 WGS84 坐标，暂不支持纬度绝对值 ≥80° 的区域。');
  const xs=coords.map(c=>c[0]),ys=coords.map(c=>c[1]);
  if(Math.max(...xs)-Math.min(...xs)>10 || Math.max(...ys)-Math.min(...ys)>10) throw spatialError('UNSUPPORTED_REGION','暂不支持跨反经线或单几何跨度超过 10° 的区域。');
  if(!booleanValid(geometry)) throw spatialError('GEOMETRY_INVALID','几何无效，不自动修复原始数据。');
  if(geometry.type==='Polygon' || geometry.type==='MultiPolygon') {
    const parts=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
    for(const rings of parts) {
      for(const ring of rings) {const [ox,oy]=ring[0];const signed=ring.slice(1).reduce((sum,p,i)=>sum+(ring[i][0]-ox)*(p[1]-oy)-(p[0]-ox)*(ring[i][1]-oy),0);if(signed===0) throw spatialError('GEOMETRY_INVALID','面环没有有效面积。');}
      if(kinks({type:'Polygon',coordinates:rings}).features.length) throw spatialError('GEOMETRY_INVALID','面存在自交或环相交。');
      const exterior={type:'Polygon' as const,coordinates:[rings[0]]};
      for(let i=1;i<rings.length;i++) {
        // All vertices strictly inside + no edge crossings excludes escaping concave holes and boundary contacts.
        if(!rings[i].every(p=>booleanPointInPolygon(p,exterior,{ignoreBoundary:true})) || booleanIntersects({type:'LineString',coordinates:rings[0]},{type:'LineString',coordinates:rings[i]})) throw spatialError('GEOMETRY_INVALID','内环必须完整位于外环内部，不能越界或接触外环。');
        for(let j=1;j<i;j++) if(booleanIntersects({type:'Polygon',coordinates:[rings[i]]},{type:'Polygon',coordinates:[rings[j]]})) throw spatialError('GEOMETRY_INVALID','内环不能重叠、嵌套或相互接触。');
      }
    }
    for(let i=0;i<parts.length;i++) for(let j=0;j<i;j++) {
      if(intersect({type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:parts[i]}},{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:parts[j]}}]})) throw spatialError('GEOMETRY_INVALID','MultiPolygon 的各部分内部不能重叠。');
    }
  }
  return coords.length;
}
export function validateItems(items:SpatialItem[]) {
  if(items.length>LIMITS.objects) throw spatialError('LIMIT','候选超过 500 个对象；请显式缩小分析范围。');
  if(items.some(item=>!spatialGeometryValid(item.geometry))) throw spatialError('GEOMETRY_INVALID','几何结构、坐标或顶点数量不支持。');
  if(items.reduce((n,item)=>n+positions(item.geometry?.coordinates).length,0)>LIMITS.vertices) throw spatialError('LIMIT','总顶点超过 10,000；请缩小范围。');
}
