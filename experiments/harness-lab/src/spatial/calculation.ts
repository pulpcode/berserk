import type { SpatialAttribute, SpatialItem, SpatialRequest, SpatialResult } from '../contracts/spatial.js';
import { LIMITS, spatialError, validateGeometry } from './validation.js';
import { classifyPoint, makeBuffer, measure, relate } from './geometry.js';
import type { SpatialDataset } from './inputs.js';
const one=(items:SpatialItem[])=>{if(items.length!==1) throw spatialError('AMBIGUOUS','该位置必须解析为恰好一个对象；请明确对象范围。');return items[0];};
function property(item:SpatialItem,field:string) {if(!Object.hasOwn(item.properties,field)) throw spatialError('ATTRIBUTE_MISSING',`对象 ${item.name} 没有字段 ${field}，不能当作不匹配。`);const value=item.properties[field];if(value!==null && !['string','number','boolean'].includes(typeof value)) throw spatialError('ATTRIBUTE_TYPE','分类/过滤仅支持实际标量字段。');return value as string|number|boolean|null;}
function matches(item:SpatialItem,filter:SpatialAttribute) {
  const value=property(item,filter.field);
  if(filter.op==='eq') return value===filter.value;if(filter.op==='ne') return value!==filter.value;
  if(typeof value!=='number' || typeof filter.value!=='number') throw spatialError('ATTRIBUTE_TYPE','大小比较要求数值字段和数值条件。');
  return filter.op==='gt'?value>filter.value:filter.op==='gte'?value>=filter.value:filter.op==='lt'?value<filter.value:value<=filter.value;
}
export interface Calculation {request:Exclude<SpatialRequest,{operation:'read'}>; data:SpatialDataset; target?:SpatialDataset; result:SpatialResult}
export async function run({request,data,target,result}:Calculation):Promise<SpatialResult> {
  for(const item of [...data.items,...(target?.items??[])]) validateGeometry(item.geometry);
    const start=performance.now();
    const tick=async()=>{await new Promise<void>(resolve=>setImmediate(resolve));if(performance.now()-start>LIMITS.milliseconds) throw spatialError('LIMIT','计算超过 3 秒预算，未输出部分结论。');};
    switch(request.operation) {
      case 'measure':result.values={value:measure(request.metric,one(data.items).geometry,target?one(target.items).geometry:undefined),unit:request.metric==='area'?'m²':'m'};break;
      case 'relate':result.values={relation:request.relation,matches:relate(request.relation,one(data.items).geometry,one(target!.items).geometry)};break;
      case 'classify_points': {
        const region=one(target!.items).geometry,counts={total:data.items.length,interior:0,boundary:0,exterior:0};
        result.classifications=[];
        for(const item of data.items) {
          await tick();const position=classifyPoint(item.geometry,region);
          result.classifications.push({itemId:item.id,position});counts[position]++;
        }
        result.values=counts;break;
      }
      case 'buffer':result.geometry=makeBuffer(one(data.items).geometry,request.distanceM);break;
      case 'filter': {
        const picked:SpatialItem[]=[];
        // Validate every required field even if an earlier predicate excludes an item.
        for(const item of data.items) {
          await tick();const attributes=(request.attributes??[]).map(f=>matches(item,f));let spatial=true;
          if(request.spatial) {
            const g=one(target!.items).geometry;
            if('distanceM' in request.spatial) {
              if(item.geometry.type!=='Point') throw spatialError('UNSUPPORTED_GEOMETRY','距离范围筛选候选须为点，参考对象须为点或线。');
              spatial=measure(g.type==='Point'?'distance':'point_to_line',item.geometry,g)<=request.spatial.distanceM;
            } else spatial=relate(request.spatial.relation,g,item.geometry);
          }
          if(attributes.every(Boolean)&&spatial) picked.push(item);
        }
        result.items=picked;break;
      }
      case 'nearest': {
        const point=one(target!.items).geometry;
        for(const item of result.items) {await tick();item.distanceM=measure('distance',point,item.geometry);}
        result.items.sort((a,b)=>a.distanceM!-b.distanceM! || (a.id<b.id?-1:a.id>b.id?1:0));result.items=result.items.slice(0,request.count);break;
      }
      case 'summarize': {
        const groups=new Map<string,{value:string|number|boolean|null;count:number}>();
        for(const item of data.items) {await tick();const value=property(item,request.field),key=JSON.stringify([typeof value,value]);const group=groups.get(key)??{value,count:0};group.count++;groups.set(key,group);}
        result.values={total:data.items.length,groups:[...groups.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,v])=>v)};break;
      }
    }

    await tick();return result;
}
