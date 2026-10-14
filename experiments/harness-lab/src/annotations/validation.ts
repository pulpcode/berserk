import type { AnnotationAction, AnnotationBaseInput, AnnotationCurrentInput, AnnotationDocument, AnnotationFeature, AnnotationFromSourceInput, AnnotationFromSourcesInput, AnnotationHostIntent, AnnotationLayer, AnnotationOperation, AnnotationReadInput, AnnotationRef, AnnotationSelection } from '../contracts/annotations.js';
import type { Position } from '../contracts/context.js';
import { RequestError } from '../contracts/errors.js';
import { UUID } from '../workspaces/store.js';

export const invalid = (message = '标注输入无效。') => new RequestError('INVALID_INPUT', message);
export const tooLarge = () => new RequestError('ANNOTATION_TOO_LARGE', '标注超出容量限制，请缩小范围。', 413);
export function record(value: unknown, allowed: string[], required: string[] = allowed): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw invalid();
  return value as Record<string, unknown>;
}
export function string(value: unknown, max = 120, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw invalid();
  return value.trim();
}
export function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) throw invalid('标识符无效。');
  return value;
}
export function uuid(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) throw invalid('动作或版本标识符无效。'); return value; }
export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw invalid(); return value; }
export function page(offset: unknown = 0, limit: unknown = 50) { return { offset: integer(offset, 0), limit: integer(limit, 1, 100) }; }
export function ref(value: unknown): AnnotationRef {
  const object = record(value, ['setId', 'revision', 'publicationId'], []);
  if (Object.hasOwn(object, 'publicationId')) { record(object, ['publicationId']); return {publicationId: uuid(object.publicationId)}; }
  record(object, ['setId', 'revision']); return {setId: uuid(object.setId), revision: integer(object.revision, 1)};
}
function ids(value: unknown) { if (!Array.isArray(value) || !value.length || value.length > 500 || new Set(value).size !== value.length) throw invalid(); return value.map(id); }
export function selection(value: unknown): AnnotationSelection {
  const object = record(value, ['setId','revision','publicationId','layerIds','objectIds'], []);
  const {layerIds, objectIds, ...reference} = object;
  if(layerIds !== undefined && objectIds !== undefined) throw invalid('引用时请选择图层或对象其中一种范围。');
  return {...ref(reference), ...(layerIds !== undefined ? {layerIds: ids(layerIds)} : {}), ...(objectIds !== undefined ? {objectIds: ids(objectIds)} : {})};
}
function position(value: unknown): Position {
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'number' || typeof value[1] !== 'number' || !Number.isFinite(value[0]) || !Number.isFinite(value[1]) || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) throw invalid('坐标必须是有效的 WGS84 经度、纬度。');
  return [value[0],value[1]];
}
function equal(a: Position,b: Position) { return a[0] === b[0] && a[1] === b[1]; }
function cross(a: Position,b: Position,c: Position) { return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]); }
function between(a: Position,b: Position,c: Position) { return cross(a,b,c) === 0 && c[0] >= Math.min(a[0],b[0]) && c[0] <= Math.max(a[0],b[0]) && c[1] >= Math.min(a[1],b[1]) && c[1] <= Math.max(a[1],b[1]); }
function intersects(a: Position,b: Position,c: Position,d: Position) { const x=cross(a,b,c),y=cross(a,b,d),z=cross(c,d,a),w=cross(c,d,b); return (x*y<0 && z*w<0) || between(a,b,c) || between(a,b,d) || between(c,d,a) || between(c,d,b); }
function geometry(value: unknown, kind: AnnotationFeature['kind']): AnnotationFeature['geometry'] {
  const object=record(value,['type','coordinates']);
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
function style(value: unknown): AnnotationFeature['style'] {
  const object=record(value,['color','fillColor','opacity','size','width','lineStyle','symbol','label'],[]);
  for(const name of ['color','fillColor']) if(object[name] !== undefined && (typeof object[name]!=='string' || !/^#[0-9a-fA-F]{6}$/.test(object[name]))) throw invalid('颜色使用六位十六进制值。');
  for(const [name,max] of [['opacity',1],['size',100],['width',30]] as const) if(object[name]!==undefined && (typeof object[name]!=='number' || !Number.isFinite(object[name]) || object[name]<0 || object[name]>max)) throw invalid('样式数值超限。');
  if(object.lineStyle!==undefined && !['solid','dashed','dotted'].includes(String(object.lineStyle))) throw invalid();
  if(object.symbol!==undefined && !['circle','square','triangle'].includes(String(object.symbol))) throw invalid();
  if(object.label!==undefined) object.label=string(object.label,500,true);
  return {...object};
}
export function feature(value: unknown): AnnotationFeature {
  const object=record(value,['objectId','kind','name','geometry','note','attributes','style','sourceRefs','originFeatureRef'],['objectId','kind','name','geometry']);
  if(!['point','line','polygon','text'].includes(String(object.kind))) throw invalid();
  const kind=object.kind as AnnotationFeature['kind'];
  const result: AnnotationFeature={objectId:id(object.objectId),kind,name:string(object.name),geometry:geometry(object.geometry,kind)};
  if(object.note!==undefined) result.note=string(object.note,8000,true);
  if(object.attributes!==undefined) {
    if(!object.attributes || typeof object.attributes!=='object' || Array.isArray(object.attributes) || Object.keys(object.attributes).length>50) throw invalid();
    result.attributes={};
    for(const [key,value] of Object.entries(object.attributes)) { id(key); if(['__proto__','constructor','prototype'].includes(key) || (value!==null && !['string','number','boolean'].includes(typeof value)) || (typeof value==='number' && !Number.isFinite(value)) || (typeof value==='string' && value.length>2000)) throw invalid(); result.attributes[key]=value; }
  }
  if(object.style!==undefined) result.style=style(object.style);
  if(object.sourceRefs!==undefined) {
    if(!Array.isArray(object.sourceRefs) || object.sourceRefs.length>20) throw invalid();
    result.sourceRefs=object.sourceRefs.map(value=>{const item=record(value,['systemId','objectType','objectId','revision','queriedAt'],['systemId','objectType','objectId']);
      if(item.revision===undefined && item.queriedAt===undefined) throw invalid('来源引用须有修订或查询时间。');
      if(item.queriedAt!==undefined && (typeof item.queriedAt!=='string' || !Number.isFinite(Date.parse(item.queriedAt)))) throw invalid();
      return {systemId:id(item.systemId),objectType:id(item.objectType),objectId:id(item.objectId),...(item.revision!==undefined ? {revision:integer(item.revision,1)} : {}),...(item.queriedAt!==undefined ? {queriedAt:String(item.queriedAt)} : {})};});
  }
  if(object.originFeatureRef!==undefined) {const origin=record(object.originFeatureRef,['ref','objectId']); result.originFeatureRef={ref:ref(origin.ref),objectId:id(origin.objectId)};}
  return result;
}
export function layer(value: unknown): AnnotationLayer {
  const object=record(value,['layerId','name','order','defaultVisible','features']);
  if(typeof object.defaultVisible!=='boolean' || !Array.isArray(object.features) || object.features.length>500) throw invalid();
  return {layerId:id(object.layerId),name:string(object.name),order:integer(object.order,0,100000),defaultVisible:object.defaultVisible,features:object.features.map(feature)};
}
export function document(value: unknown): AnnotationDocument {
  const object=record(value,['schemaVersion','title','layers']);
  if(object.schemaVersion!==1 || !Array.isArray(object.layers) || object.layers.length>32) throw invalid('最多支持 32 个图层。');
  const result: AnnotationDocument={schemaVersion:1,title:string(object.title),layers:object.layers.map(layer)};
  const layers=new Set<string>(),objects=new Set<string>(); let count=0;
  for(const item of result.layers) {if(layers.has(item.layerId)) throw invalid('图层标识重复。'); layers.add(item.layerId);
    for(const itemFeature of item.features) {if(objects.has(itemFeature.objectId)) throw invalid('对象标识重复。'); objects.add(itemFeature.objectId);
      const g=itemFeature.geometry; count+=g.type==='Point' ? 1 : g.type==='LineString' ? g.coordinates.length : g.coordinates[0].length;}}
  if(objects.size>500 || count>20000 || Buffer.byteLength(JSON.stringify(result))>2*1024*1024) throw tooLarge();
  return result;
}
function operations(value: unknown): AnnotationOperation[] {
  if(!Array.isArray(value) || value.length<1 || value.length>100) throw invalid('操作数量须为 1～100。');
  return value.map(value=>{
    const item=record(value,['op','title','layer','layerId','changes','feature','objectId','source','newObjectId'],['op']);
    switch(item.op) {
      case 'rename_set': record(item,['op','title']); return {op:item.op,title:string(item.title)};
      case 'add_layer': {record(item,['op','layer']); const normalized=layer(item.layer); if(normalized.features.some(f=>f.originFeatureRef)) throw invalid('通过 copy_object 复制已有对象。'); return {op:item.op,layer:normalized};}
      case 'update_layer': {record(item,['op','layerId','changes']); const change=record(item.changes,['name','order','defaultVisible'],[]); if(!Object.keys(change).length) throw invalid();
        if(change.name!==undefined) change.name=string(change.name); if(change.order!==undefined) change.order=integer(change.order,0,100000); if(change.defaultVisible!==undefined && typeof change.defaultVisible!=='boolean') throw invalid();
        return {op:item.op,layerId:id(item.layerId),changes:change};}
      case 'delete_layer': record(item,['op','layerId']); return {op:item.op,layerId:id(item.layerId)};
      case 'add_object': {record(item,['op','layerId','feature']); const normalized=feature(item.feature); if(normalized.originFeatureRef) throw invalid('通过 copy_object 复制已有对象。'); return {op:item.op,layerId:id(item.layerId),feature:normalized};}
      case 'update_object': {record(item,['op','objectId','changes','layerId'],['op','objectId','changes']); const change=record(item.changes,['kind','name','geometry','note','attributes','style','sourceRefs'],[]); if(!Object.keys(change).length && item.layerId===undefined) throw invalid(); return {op:item.op,objectId:id(item.objectId),changes:change,...(item.layerId!==undefined ? {layerId:id(item.layerId)} : {})} as AnnotationOperation;}
      case 'delete_object': record(item,['op','objectId']); return {op:item.op,objectId:id(item.objectId)};
      case 'copy_object': record(item,['op','source','objectId','newObjectId','layerId']); return {op:item.op,source:ref(item.source),objectId:id(item.objectId),newObjectId:id(item.newObjectId),layerId:id(item.layerId)};
      default: throw invalid('不支持的标注操作。');
    }
  });
}
export function action(value: unknown): AnnotationAction {
  if(Buffer.byteLength(JSON.stringify(value) ?? '')>256*1024) throw tooLarge();
  const object=record(value,['action','clientActionId','baseRef','title','operations','expectedRevision','revision','note'],['action','clientActionId']);
  const clientActionId=uuid(object.clientActionId);
  switch(object.action) {
    case 'create_draft': record(object,['action','clientActionId','baseRef','title','operations'],['action','clientActionId']); return {action:object.action,clientActionId,...(object.baseRef!==undefined ? {baseRef:object.baseRef===null ? null : ref(object.baseRef)} : {}),...(object.title!==undefined ? {title:string(object.title)} : {}),...(object.operations!==undefined ? {operations:operations(object.operations)} : {})};
    case 'apply': record(object,['action','clientActionId','expectedRevision','operations']); return {action:object.action,clientActionId,expectedRevision:integer(object.expectedRevision,1),operations:operations(object.operations)};
    case 'publish': record(object,['action','clientActionId','revision','title','note'],['action','clientActionId','revision','title']); return {action:object.action,clientActionId,revision:integer(object.revision,1),title:string(object.title),...(object.note!==undefined ? {note:string(object.note,4000,true)} : {})};
    default: throw invalid();
  }
}
export function base(value: unknown): AnnotationBaseInput {const object=record(value,['clientActionId','expectedBindingRevision','baseRef']); return {clientActionId:uuid(object.clientActionId),expectedBindingRevision:integer(object.expectedBindingRevision),baseRef:object.baseRef===null ? null : ref(object.baseRef)};}
export function fromSource(value: unknown): AnnotationFromSourceInput {
  const input=record(value,['clientActionId','mode','sourceRef','expectedSourceRevision','expectedRevision','layerId','objectId']);
  if(input.mode!=='add' && input.mode!=='refresh') throw invalid();
  const source=record(input.sourceRef,['systemId','objectType','objectId']);
  return {clientActionId:uuid(input.clientActionId),mode:input.mode,
    sourceRef:{systemId:id(source.systemId),objectType:id(source.objectType),objectId:id(source.objectId)},
    expectedSourceRevision:integer(input.expectedSourceRevision,1),expectedRevision:integer(input.expectedRevision,1),
    layerId:id(input.layerId),objectId:id(input.objectId)};
}
export function fromSources(value: unknown): AnnotationFromSourcesInput {
  const input=record(value,['clientActionId','expectedRevision','items']);
  const clientActionId=uuid(input.clientActionId),expectedRevision=integer(input.expectedRevision,1);
  if(!Array.isArray(input.items) || input.items.length<1 || input.items.length>20) throw invalid('来源对象数量须为 1～20。');
  const items=input.items.map(value=>{
    const item=record(value,['mode','sourceRef','expectedSourceRevision','layerId','objectId']);
    const {clientActionId: _action,expectedRevision: _revision,...normalized}=fromSource({...item,clientActionId,expectedRevision});
    void _action; void _revision; return normalized;
  });
  if(new Set(items.map(item=>item.objectId)).size!==items.length) throw invalid('同一批次不能重复操作同一标注 ID。');
  return {clientActionId,expectedRevision,items};
}
export function hostIntent(value: unknown): AnnotationHostIntent {
  const input=record(value,['action','clientActionId','baseRef','title','operations','revision','note','items','publicationId'],['action','clientActionId']);
  if(input.action==='from_source') {
    record(input,['action','clientActionId','items']);
    if(!Array.isArray(input.items)) throw invalid();
    const normalized=fromSources({clientActionId:input.clientActionId,expectedRevision:1,items:input.items.map(item=>({...record(item,['mode','sourceRef','layerId','objectId']),expectedSourceRevision:1}))});
    return {action:'from_source',clientActionId:normalized.clientActionId,items:normalized.items.map(({expectedSourceRevision,...item})=>{void expectedSourceRevision;return item;})};
  }
  if(input.action==='set_current') {record(input,['action','clientActionId','publicationId']);return {action:'set_current',clientActionId:uuid(input.clientActionId),publicationId:uuid(input.publicationId)};}
  const normalized=action(input.action==='apply' ? {...input,expectedRevision:1} : input);
  if(normalized.action!=='apply') return normalized;
  const {expectedRevision,...intent}=normalized;void expectedRevision;return intent;
}
export function current(value: unknown): AnnotationCurrentInput {const object=record(value,['clientActionId','publicationId','expectedCurrentSequence']); return {clientActionId:uuid(object.clientActionId),publicationId:uuid(object.publicationId),expectedCurrentSequence:integer(object.expectedCurrentSequence)};}
export function readInput(value: unknown): AnnotationReadInput {
  const object=record(value,['ref','layerIds','objectIds','fields','offset','limit'],['ref']);
  if(object.fields!==undefined && (!Array.isArray(object.fields) || object.fields.length>6 || new Set(object.fields).size!==object.fields.length || object.fields.some(f=>!['geometry','note','attributes','style','sourceRefs','originFeatureRef'].includes(String(f))))) throw invalid();
  return {ref:ref(object.ref),...(object.layerIds!==undefined ? {layerIds:ids(object.layerIds)} : {}),...(object.objectIds!==undefined ? {objectIds:ids(object.objectIds)} : {}),...(object.fields!==undefined ? {fields:object.fields as AnnotationReadInput['fields']} : {}),...page(object.offset,object.limit)};
}
/** Stable object-key order makes action retries independent of JSON serialization order. */
export function canonical(value: unknown): string {
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value && typeof value==='object') return `{${Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
