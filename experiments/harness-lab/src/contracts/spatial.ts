import type { AnnotationRef } from './annotations.js';
import type { ContextRef, ContextTimeRange, Position, SituationGeometry } from './context.js';

export type SpatialGeometry = SituationGeometry | {type:'MultiPolygon'; coordinates:Position[][][]};
export type SpatialInput =
  | {kind:'source'; systemId:string; objectRefs?:ContextRef[]; areaIds?:string[]; revisions?:Array<{ref:ContextRef; revision:number}>}
  | {kind:'annotation'; ref:AnnotationRef; layerIds?:string[]; objectIds?:string[]}
  | {kind:'result'; resultRef:string; itemIds?:string[]; geometry?:boolean};
export type SpatialRelation = 'contains' | 'intersects' | 'disjoint';
export type SpatialAttribute = {field:string; op:'eq'|'ne'|'gt'|'gte'|'lt'|'lte'; value:string|number|boolean|null};
export type SpatialRequest =
  | {operation:'read'; resultRef:string}
  | {operation:'measure'; metric:'distance'|'point_to_line'|'length'|'area'; input:SpatialInput; target?:SpatialInput}
  | {operation:'relate'; relation:SpatialRelation; input:SpatialInput; target:SpatialInput}
  | {operation:'classify_points'; input:SpatialInput; target:SpatialInput}
  | {operation:'buffer'; input:SpatialInput; distanceM:number}
  | {operation:'filter'; input:SpatialInput; spatial?:{target:SpatialInput; relation:SpatialRelation}|{target:SpatialInput; distanceM:number}; attributes?:SpatialAttribute[]}
  | {operation:'nearest'; input:SpatialInput; target:SpatialInput; count:number}
  | {operation:'summarize'; input:SpatialInput; field:string};
export interface SpatialItem {
  id:string; name:string; geometry:SpatialGeometry; properties:Record<string,unknown>;
  source?:{ref:ContextRef; revision:number; queriedAt:string; effectiveAt?:string|null; validTime?:ContextTimeRange|null};
  annotation?:{ref:AnnotationRef; objectId:string}; distanceM?:number;
}
export interface SpatialProvenance {input:SpatialInput; queriedAt:string; asOf:string; hash?:string; sourceRefs?:Array<ContextRef & {revision:number}>}
export type SpatialPointPosition = 'interior' | 'boundary' | 'exterior';
export interface SpatialPointClassification {itemId:string; position:SpatialPointPosition}
export interface SpatialClassificationCounts {total:number; interior:number; boundary:number; exterior:number}
export type SpatialValues = SpatialClassificationCounts | {value:number; unit:'m'|'m²'} | {relation:SpatialRelation; matches:boolean} | {total:number; groups:Array<{value:string|number|boolean|null; count:number}>};
export interface SpatialResult {
  schemaVersion:1|2; resultRef:string; requestId:string; toolCallId:string; operation:Exclude<SpatialRequest['operation'],'read'>;
  parameters:Exclude<SpatialRequest,{operation:"read"}>;
  delivery?:{requestId:string;toolCallId:string};
  createdAt:string; scope:SpatialInput[]; completeness:{status:'complete'; candidateCount:number};
  classifications?:SpatialPointClassification[];
  items:SpatialItem[]; referenceItems?:SpatialItem[]; geometry?:SpatialGeometry; values?:SpatialValues; method:string; limitations:string[]; provenance:SpatialProvenance[];
}
export const SPATIAL_MODEL_FORMAT = 'spatial.model-result.v1';
export const SPATIAL_CLASSIFICATION_MODEL_FORMAT = 'spatial.model-result.v2';
export const SPATIAL_EXPLAINED_MODEL_FORMAT = 'spatial.model-result.v3';
export const spatialModelFormat=(result:SpatialResult)=>result.schemaVersion===2?SPATIAL_CLASSIFICATION_MODEL_FORMAT:SPATIAL_MODEL_FORMAT;
/** Model projection retains identities/counts, but never asks the model to transcribe geometry. */
export function projectSpatialResult(result:SpatialResult) {
  const {geometry,...rest}=result; void geometry;
  return {...rest,items:result.items.map(({geometry,...item})=>({...item,geometryType:geometry.type})),...(result.referenceItems?{referenceItems:result.referenceItems.map(({geometry,...item})=>({...item,geometryType:geometry.type}))}:{}),...(result.geometry ? {geometryType:result.geometry.type} : {})};
}
const object=(v:unknown):v is Record<string,unknown>=>!!v && typeof v==='object' && !Array.isArray(v);
const keys=(v:Record<string,unknown>,allowed:string[])=>Object.keys(v).every(k=>allowed.includes(k));
const str=(v:unknown,max=1024):v is string=>typeof v==='string' && v.length>0 && v.length<=max;
const id=(v:unknown)=>str(v,128) && /^[A-Za-z0-9_.:-]+$/.test(v);
const uuid=(v:unknown)=>typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const integer=(v:unknown,min=0,max=500)=>typeof v==='number' && Number.isSafeInteger(v) && v>=min && v<=max;
const time=(v:unknown)=>typeof v==='string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const scalar=(v:unknown)=>v===null || typeof v==='boolean' || (typeof v==='number' && Number.isFinite(v)) || (typeof v==='string' && v.length<=4000);
const ids=(v:unknown,max=500)=>Array.isArray(v) && v.length>0 && v.length<=max && v.every(id) && new Set(v).size===v.length;
const sourceText=(v:unknown):v is string=>str(v,128) && Boolean(v.trim());
const contextRef=(v:unknown):boolean=>object(v) && keys(v,['systemId','objectType','objectId']) && sourceText(v.systemId) && sourceText(v.objectType) && sourceText(v.objectId);
const fixedRef=(v:unknown)=>object(v) && (keys(v,['publicationId']) && uuid(v.publicationId) || keys(v,['setId','revision']) && uuid(v.setId) && integer(v.revision,1,Number.MAX_SAFE_INTEGER));
function inputValid(v:unknown):v is SpatialInput {
  if(!object(v)) return false;
  if(v.kind==='source') return keys(v,['kind','systemId','objectRefs','areaIds','revisions']) && sourceText(v.systemId)
    && (v.objectRefs===undefined || Array.isArray(v.objectRefs) && v.objectRefs.length>0 && v.objectRefs.length<=20 && v.objectRefs.every(r=>contextRef(r) && (r as ContextRef).systemId===v.systemId))
    && (v.areaIds===undefined || Array.isArray(v.areaIds) && v.areaIds.length>0 && v.areaIds.length<=10 && v.areaIds.every(sourceText))
    && (v.revisions===undefined || Array.isArray(v.revisions) && v.revisions.length<=100 && new Set(v.revisions.map(r=>object(r) && object(r.ref)?JSON.stringify([r.ref.systemId,r.ref.objectType,r.ref.objectId]):null)).size===v.revisions.length && v.revisions.every(r=>object(r) && keys(r,['ref','revision']) && contextRef(r.ref) && (r.ref as ContextRef).systemId===v.systemId && integer(r.revision,1,Number.MAX_SAFE_INTEGER)));
  if(v.kind==='annotation') return keys(v,['kind','ref','layerIds','objectIds']) && fixedRef(v.ref) && (v.layerIds===undefined || ids(v.layerIds,32)) && (v.objectIds===undefined || ids(v.objectIds));
  if(v.kind==='result') return keys(v,['kind','resultRef','itemIds','geometry']) && str(v.resultRef) && v.resultRef.startsWith('spatial:') && (v.geometry===undefined || typeof v.geometry==='boolean') && !(v.geometry && v.itemIds)
    && (v.itemIds===undefined || Array.isArray(v.itemIds) && v.itemIds.length>0 && v.itemIds.length<=500 && v.itemIds.every(i=>str(i)) && new Set(v.itemIds).size===v.itemIds.length);
  return false;
}
const relationValid=(v:unknown)=>['contains','intersects','disjoint'].includes(String(v));
export function spatialRequestValid(v:unknown):v is SpatialRequest {
  if(!object(v)) return false;
  if(v.operation==='read') return keys(v,['operation','resultRef']) && str(v.resultRef) && v.resultRef.startsWith('spatial:');
  if(!inputValid(v.input)) return false;
  switch(v.operation) {
    case 'measure':return keys(v,['operation','metric','input','target']) && ['distance','point_to_line','length','area'].includes(String(v.metric)) && (['distance','point_to_line'].includes(String(v.metric))?inputValid(v.target):v.target===undefined);
    case 'relate':return keys(v,['operation','relation','input','target']) && relationValid(v.relation) && inputValid(v.target);
    case 'classify_points':return keys(v,['operation','input','target']) && inputValid(v.target);
    case 'buffer':return keys(v,['operation','input','distanceM']) && typeof v.distanceM==='number' && v.distanceM>0 && v.distanceM<=50000;
    case 'nearest':return keys(v,['operation','input','target','count']) && inputValid(v.target) && integer(v.count,1);
    case 'summarize':return keys(v,['operation','input','field']) && str(v.field,128);
    case 'filter':return keys(v,['operation','input','spatial','attributes'])
      && (v.spatial===undefined || object(v.spatial) && inputValid(v.spatial.target) && (keys(v.spatial,['target','relation']) && relationValid(v.spatial.relation) || keys(v.spatial,['target','distanceM']) && typeof v.spatial.distanceM==='number' && v.spatial.distanceM>=0 && v.spatial.distanceM<=50000))
      && (v.attributes===undefined || Array.isArray(v.attributes) && v.attributes.length>0 && v.attributes.length<=20 && v.attributes.every(a=>object(a) && keys(a,['field','op','value']) && str(a.field,128) && ['eq','ne','gt','gte','lt','lte'].includes(String(a.op)) && scalar(a.value)));
    default:return false;
  }
}
export function spatialGeometryValid(v:unknown):v is SpatialGeometry {
  if(!object(v) || !keys(v,['type','coordinates'])) return false;
  let count=0;
  const point=(p:unknown):p is Position=>Array.isArray(p) && p.length===2 && p.every(n=>typeof n==='number' && Number.isFinite(n)) && Math.abs(p[0])<=180 && Math.abs(p[1])<80 && ++count<=2000;
  const line=(a:unknown,min:number)=>Array.isArray(a) && a.length>=min && a.length<=2000 && a.every(point);
  const polygon=(a:unknown)=>Array.isArray(a) && a.length>0 && a.length<=500 && a.every(r=>line(r,4) && JSON.stringify(r[0])===JSON.stringify(r[r.length-1]));
  return v.type==='Point'?point(v.coordinates):v.type==='LineString'?line(v.coordinates,2):v.type==='Polygon'?polygon(v.coordinates):v.type==='MultiPolygon'?Array.isArray(v.coordinates) && v.coordinates.length>0 && v.coordinates.length<=500 && v.coordinates.every(polygon):false;
}
function itemValid(v:unknown):boolean {
  if(!object(v) || !keys(v,['id','name','geometry','properties','source','annotation','distanceM']) || !str(v.id) || !str(v.name,4000) || !spatialGeometryValid(v.geometry) || !object(v.properties)) return false;
  if(v.source!==undefined && (!object(v.source) || !keys(v.source,['ref','revision','queriedAt','effectiveAt','validTime']) || !contextRef(v.source.ref) || !integer(v.source.revision,1,Number.MAX_SAFE_INTEGER) || !time(v.source.queriedAt))) return false;
  if(object(v.source) && ((v.source.effectiveAt!==undefined && v.source.effectiveAt!==null && !time(v.source.effectiveAt)) || (v.source.validTime!==undefined && v.source.validTime!==null && (!object(v.source.validTime) || !keys(v.source.validTime,['from','to']) || (v.source.validTime.from!==null && !time(v.source.validTime.from)) || (v.source.validTime.to!==null && !time(v.source.validTime.to)) || (v.source.validTime.from!==null && v.source.validTime.to!==null && Date.parse(String(v.source.validTime.from))>=Date.parse(String(v.source.validTime.to))))))) return false;
  if(v.annotation!==undefined && (!object(v.annotation) || !keys(v.annotation,['ref','objectId']) || !fixedRef(v.annotation.ref) || !id(v.annotation.objectId))) return false;
  return v.distanceM===undefined || typeof v.distanceM==='number' && Number.isFinite(v.distanceM) && v.distanceM>=0;
}
function valuesValid(v:unknown,op:SpatialResult['operation']):boolean {
  if(op==='measure') return object(v) && keys(v,['value','unit']) && typeof v.value==='number' && Number.isFinite(v.value) && v.value>=0 && ['m','m²'].includes(String(v.unit));
  if(op==='classify_points') return object(v) && keys(v,['total','interior','boundary','exterior']) && integer(v.total) && integer(v.interior) && integer(v.boundary) && integer(v.exterior) && Number(v.interior)+Number(v.boundary)+Number(v.exterior)===v.total;
  if(op==='relate') return object(v) && keys(v,['relation','matches']) && relationValid(v.relation) && typeof v.matches==='boolean';
  if(op==='summarize') return object(v) && keys(v,['total','groups']) && integer(v.total) && Array.isArray(v.groups) && v.groups.length<=500 && v.groups.every(g=>object(g) && keys(g,['value','count']) && scalar(g.value) && integer(g.count,1)) && v.groups.reduce((n,g)=>n+g.count,0)===v.total;
  return v===undefined;
}
/** V2 is reserved for point classification; never synthesize classifications for v1 history. */
function classificationValid(result:SpatialResult):boolean {
  if(result.schemaVersion===1) return result.operation!=='classify_points' && result.classifications===undefined;
  if(result.schemaVersion!==2 || result.operation!=='classify_points' || result.geometry!==undefined
    || result.completeness.candidateCount!==result.items.length || result.items.some(item=>item.geometry.type!=='Point')
    || result.referenceItems?.length!==1 || result.referenceItems[0].geometry.type!=='Polygon'
    || !Array.isArray(result.classifications) || result.classifications.length!==result.items.length) return false;
  const counts={interior:0,boundary:0,exterior:0};
  for(const [index,entry] of result.classifications.entries()) {
    if(!object(entry) || !keys(entry,['itemId','position']) || entry.itemId!==result.items[index].id
      || !['interior','boundary','exterior'].includes(entry.position)) return false;
    counts[entry.position]++;
  }
  const values=result.values;
  return !!values && 'interior' in values && values.total===result.items.length
    && values.interior===counts.interior && values.boundary===counts.boundary && values.exterior===counts.exterior;
}
/** Strict shared decoder: absence is legacy; null rejects damaged new evidence without fallback. */
export function extractSpatialResult(details:unknown,toolName:string,isError=false,text?:string):SpatialResult|null|undefined {
  if(!object(details) || !Object.hasOwn(details,'spatialResult')) return;
  const v=details.spatialResult;
  if(isError || toolName!=='spatial_analyze' || !object(v) || !keys(v,['schemaVersion','resultRef','requestId','toolCallId','operation','parameters','delivery','createdAt','scope','completeness','items','referenceItems','geometry','values','method','limitations','provenance',...(v.schemaVersion===2?['classifications']:[])]) || (v.schemaVersion!==1 && v.schemaVersion!==2) || !uuid(v.requestId) || !str(v.toolCallId,256)
    || v.resultRef!==`spatial:${v.requestId}:${encodeURIComponent(v.toolCallId)}` || !spatialRequestValid(v.parameters) || v.parameters.operation==='read' || v.parameters.operation!==v.operation
    || !time(v.createdAt) || !object(v.completeness) || !keys(v.completeness,['status','candidateCount']) || v.completeness.status!=='complete' || !integer(v.completeness.candidateCount)
    || !Array.isArray(v.scope) || !v.scope.length || v.scope.length>2 || !v.scope.every(inputValid)
    || !Array.isArray(v.provenance) || !v.provenance.length || v.provenance.length>100 || !v.provenance.every(p=>object(p) && keys(p,['input','queriedAt','asOf','hash','sourceRefs']) && inputValid(p.input) && p.input.kind!=='result' && time(p.queriedAt) && time(p.asOf) && (p.hash===undefined || typeof p.hash==='string' && /^[0-9a-f]{64}$/.test(p.hash)) && (p.sourceRefs===undefined || Array.isArray(p.sourceRefs) && p.sourceRefs.length<=100 && p.sourceRefs.every(r=>object(r) && keys(r,['systemId','objectType','objectId','revision']) && contextRef({systemId:r.systemId,objectType:r.objectType,objectId:r.objectId}) && integer(r.revision,1,Number.MAX_SAFE_INTEGER))))
    || !Array.isArray(v.items) || v.items.length>500 || !v.items.every(itemValid) || new Set(v.items.map(i=>i.id)).size!==v.items.length
    || (v.referenceItems!==undefined && (!Array.isArray(v.referenceItems) || v.referenceItems.length>500 || !v.referenceItems.every(itemValid) || new Set(v.referenceItems.map(i=>i.id)).size!==v.referenceItems.length))
    || (v.geometry!==undefined && !spatialGeometryValid(v.geometry)) || (v.operation==='buffer' && v.geometry===undefined) || !valuesValid(v.values,v.operation as SpatialResult['operation']) || !str(v.method,4000) || !Array.isArray(v.limitations) || v.limitations.length>20 || !v.limitations.every(l=>str(l,4000))) return null;
  if(v.delivery!==undefined && (!object(v.delivery) || !keys(v.delivery,['requestId','toolCallId']) || !uuid(v.delivery.requestId) || !str(v.delivery.toolCallId,256))) return null;
  const result=v as unknown as SpatialResult;
  if(!classificationValid(result)) return null;
  const params=result.parameters,target='target' in params?params.target:params.operation==='filter'?params.spatial?.target:undefined;
  if(JSON.stringify(result.scope)!==JSON.stringify([params.input,...(target?[target]:[])])) return null;
  if(result.operation==='measure' && result.values && 'unit' in result.values && result.values.unit!==(result.parameters.operation==='measure' && result.parameters.metric==='area'?'m²':'m')) return null;
  try {
    if(new TextEncoder().encode(JSON.stringify(result)).length>1024*1024) return null;
    if(text!==undefined) {
      const model:unknown=JSON.parse(text);
      if(!object(model) || JSON.stringify(model.data)!==JSON.stringify(projectSpatialResult(result))) return null;
      if(model.format===spatialModelFormat(result)) {if(!keys(model,['format','data'])) return null;}
      else if(model.format!==SPATIAL_EXPLAINED_MODEL_FORMAT || !keys(model,['format','data','meaning']) || JSON.stringify(model.meaning)!==JSON.stringify(spatialResultMeaning(result))) return null;
    }
    return structuredClone(result);
  } catch {return null;}
}

/** Display-only interpretation. Never adds evidence or changes the stored result schema. */
export function spatialResultMeaning(result:SpatialResult) {
  const count=result.completeness.candidateCount;
  let counts:string;
  switch(result.operation) {
    case 'filter':counts=`筛选前输入${count}个对象，满足本次全部条件${result.items.length}个；items是命中对象。`;break;
    case 'nearest':counts=`输入候选${count}个，返回最近${result.items.length}个；items保持计算排序。`;break;
    case 'classify_points': {
      const values=result.values as SpatialClassificationCounts;
      counts=`输入${count}个点：内部${values.interior}、边界${values.boundary}、外部${values.exterior}；items包含全部候选，不能把items长度当范围命中数。`;break;
    }
    case 'buffer':counts=`本次缓冲输入${count}个对象；items是原输入，geometryType对应生成范围。`;break;
    case 'summarize':counts=`本次统计${count}个输入对象；values.groups按属性分组计对象数，不是属性数值求和。`;break;
    default:counts=`本次输入${count}个对象；items是计算输入，测量值或关系判断见values。`;
  }
  return {
    scope:'范围以parameters.input及参照对象target或spatial.target（如有）为准；局部输入数不代表整个图层或整个来源的对象总数，referenceItems仅是参照对象。',
    counts,
    effect:result.delivery ? '本次读取已有固定分析结果，没有重新计算，也没有写入草稿；其他保存动作须查看相应回执。'
      :'本次只读计算已形成固定分析结果resultRef，没有写入草稿；其他保存动作须查看相应回执。',
  };
}
