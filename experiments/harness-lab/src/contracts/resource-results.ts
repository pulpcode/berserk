import { summarizeResources } from './resource-summary.js';
import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';
import { resourceSchema, decodeTaskResource, sourceResourceSchema, decodeSourceResource, resourceAssociationSchema, decodeResourceAssociation, resourceEvidence } from './task-resources.js';
import { spatialGeometryValid, type SpatialGeometry } from './spatial.js';

const strict={additionalProperties:false};
const choices=<T extends string>(values:T[])=>Type.Unsafe<T>(Type.Union(values.map(value=>Type.Literal(value))));
const text=Type.String({minLength:1,maxLength:1024});
const id=Type.String({minLength:1,maxLength:128});
const integer=Type.Integer({minimum:0,maximum:Number.MAX_SAFE_INTEGER});
const ref=Type.Object({systemId:id,objectType:id,objectId:id},strict);
const fixed=Type.Union([Type.Object({setId:id,revision:Type.Integer({minimum:1})},strict),Type.Object({publicationId:id},strict)]);
export const resourceSourceSelectionSchema=Type.Object({systemId:id,objectRefs:Type.Optional(Type.Array(ref,{minItems:1,maxItems:20})),areaIds:Type.Optional(Type.Array(id,{minItems:1,maxItems:10})),query:Type.Optional(Type.String({maxLength:200}))},strict);
const selection=Type.Object({ref:fixed,layerIds:Type.Optional(Type.Array(id,{minItems:1,maxItems:32})),objectIds:Type.Optional(Type.Array(id,{minItems:1,maxItems:500}))},strict);
export const resourceQuerySchema=Type.Object({operation:Type.Literal('query'),purpose:Type.Union([Type.Literal('task'),Type.Literal('data')]),sources:Type.Optional(Type.Array(resourceSourceSelectionSchema,{maxItems:20})),annotations:Type.Optional(Type.Array(selection,{maxItems:20})),category:Type.Optional(Type.String({enum:['vehicle','fire_engine','vessel','rescue_boat','facility','hydrant','unknown']})),messages:Type.Optional(Type.Array(Type.Object({entryId:id,resourceRef:ref,quote:Type.String({minLength:1,maxLength:4000})},strict),{maxItems:20}))},strict);
export const resourceRequestSchema=Type.Union([
 resourceQuerySchema,
 Type.Object({operation:Type.Literal('read'),resultRef:text,offset:Type.Optional(integer),limit:Type.Optional(Type.Integer({minimum:1,maximum:100}))},strict),
 Type.Object({operation:Type.Literal('summarize'),resultRef:text,relation:Type.Optional(choices(['all','related','assigned','potential_support','unconfirmed'])),availability:Type.Optional(choices(['all','available','unavailable','unknown','conflict'])),spatialResultRef:Type.Optional(text),position:Type.Optional(choices(['interior','boundary','exterior']))},strict),
],{type:'object'});
export type ResourceRequest=Static<typeof resourceRequestSchema>;
export type ResourceQuery=Static<typeof resourceQuerySchema>;
export type ResourceSourceSelection=Static<typeof resourceSourceSelectionSchema>;
export type ResourceRelation='assigned'|'potential_support'|'related'|'unconfirmed';
export interface ResourceRecord {
 id:string;name:string;resource:Static<typeof resourceSchema>;geometry?:SpatialGeometry;
 source?:{ref:Static<typeof ref>;revision:number;asOf:string;queriedAt:string;data?:Static<typeof sourceResourceSchema>};
 annotation?:{ref:Static<typeof fixed>;objectId:string;hash:string};association?:Static<typeof resourceAssociationSchema>;
 relationBasis:string[];
}
export interface ResourceItem {
 id:string;name:string;recordIds:string[];entityKey?:string;category:string;
 relation:ResourceRelation;relationBasis:string[];availability:'available'|'unavailable'|'unknown'|'conflict';
 geometry?:SpatialGeometry;positionReason?:string;limitations:string[];
}
export interface ResourceCoverageItem {source:string;status:'complete'|'partial'|'unavailable'|'unsupported';reason?:string;asOf?:string}
export interface ResourceSummary {recordCount:number;itemCount:number;knownEntityCount:number;entityCount:number|null;quantities:Array<{category:string;unit:string;meaning:string;scope:string;value:number|null;knownValue:number;unknownCount:number;recordIds:string[];limitations:string[]}>;limitations:string[]}
export interface ResourceResult {
 schemaVersion:1;resultRef:string;requestId:string;toolCallId:string;createdAt:string;
 statisticsScope:{at:string;relation:'all'|ResourceRelation;availability:'all'|ResourceItem['availability']};
 owner:{userId:string;seatId:string;taskId:string;sessionId:string};parameters:Exclude<ResourceRequest,{operation:'read'}>;
 delivery?:{requestId:string;toolCallId:string};records:ResourceRecord[];items:ResourceItem[];
 coverage:ResourceCoverageItem[];relationshipCoverage:{status:'partial'|'complete';reason:string;sources?:ResourceCoverageItem[]};
 dependencies:{systemIds:string[];annotations:Array<Static<typeof fixed>>};
 messages:Array<{entryId:string;resourceRef:Static<typeof ref>;quote:string;interpretation:'unverified_user_report'}>;
 exclusions:Array<{id:string;reason:string}>;summary:ResourceSummary;
 messageCandidates?:Array<{entryId:string;text:string;resourceRefs:Array<Static<typeof ref>>}>;
 spatialCoverage?:{status:'complete'|'partial';candidateCount:number;totalCandidateCount?:number;unclassified?:Array<{id:string;reason:string}>};
 parentResultRef?:string;spatialResultRef?:string;
}
const geometry=Type.Unsafe<SpatialGeometry>({});
const strings=Type.Array(text,{maxItems:500});
const recordSchema=Type.Object({id:text,name:text,resource:resourceSchema,geometry:Type.Optional(geometry),source:Type.Optional(Type.Object({ref,revision:Type.Integer({minimum:1}),asOf:text,queriedAt:text,data:Type.Optional(sourceResourceSchema)},strict)),annotation:Type.Optional(Type.Object({ref:fixed,objectId:id,hash:text},strict)),association:Type.Optional(resourceAssociationSchema),relationBasis:strings},strict);
const itemSchema=Type.Object({id:text,name:text,recordIds:strings,entityKey:Type.Optional(text),category:text,relation:Type.Union(['assigned','potential_support','related','unconfirmed'].map(v=>Type.Literal(v))),relationBasis:strings,availability:Type.Union(['available','unavailable','unknown','conflict'].map(v=>Type.Literal(v))),geometry:Type.Optional(geometry),positionReason:Type.Optional(text),limitations:strings},strict);
const summarySchema=Type.Object({recordCount:integer,itemCount:integer,knownEntityCount:integer,entityCount:Type.Union([integer,Type.Null()]),quantities:Type.Array(Type.Object({category:text,unit:text,meaning:text,scope:text,value:Type.Union([integer,Type.Null()]),knownValue:integer,unknownCount:integer,recordIds:strings,limitations:strings},strict),{maxItems:500}),limitations:strings},strict);
const resultSchema=Type.Object({schemaVersion:Type.Literal(1),resultRef:text,requestId:id,toolCallId:text,createdAt:text,owner:Type.Object({userId:id,seatId:id,taskId:id,sessionId:id},strict),statisticsScope:Type.Object({at:text,relation:choices(['all','related','assigned','potential_support','unconfirmed']),availability:choices(['all','available','unavailable','unknown','conflict'])},strict),parameters:Type.Union([resourceQuerySchema,resourceRequestSchema.anyOf![2]]),delivery:Type.Optional(Type.Object({requestId:id,toolCallId:text},strict)),records:Type.Array(recordSchema,{maxItems:500}),items:Type.Array(itemSchema,{maxItems:500}),coverage:Type.Array(Type.Object({source:text,status:Type.Union(['complete','partial','unavailable','unsupported'].map(v=>Type.Literal(v))),reason:Type.Optional(text),asOf:Type.Optional(text)},strict),{maxItems:100}),relationshipCoverage:Type.Object({status:Type.Union([Type.Literal('partial'),Type.Literal('complete')]),reason:text,sources:Type.Optional(Type.Array(Type.Object({source:text,status:choices(['complete','partial','unavailable','unsupported']),reason:Type.Optional(text),asOf:Type.Optional(text)},strict),{maxItems:100}))},strict),dependencies:Type.Object({systemIds:strings,annotations:Type.Array(fixed,{maxItems:100})},strict),messages:Type.Array(Type.Object({entryId:id,resourceRef:ref,quote:Type.String({minLength:1,maxLength:4000}),interpretation:Type.Literal('unverified_user_report')},strict),{maxItems:20}),exclusions:Type.Array(Type.Object({id:text,reason:text},strict),{maxItems:500}),summary:summarySchema,messageCandidates:Type.Optional(Type.Array(Type.Object({entryId:id,text:Type.String({minLength:1,maxLength:4000}),resourceRefs:Type.Array(ref,{minItems:1,maxItems:100})},strict),{maxItems:20})),spatialCoverage:Type.Optional(Type.Object({status:choices(['complete','partial']),candidateCount:integer,totalCandidateCount:Type.Optional(integer),unclassified:Type.Optional(Type.Array(Type.Object({id:text,reason:text},strict),{maxItems:500}))},strict)),parentResultRef:Type.Optional(text),spatialResultRef:Type.Optional(text)},strict);
export function resourceRequestValid(value:unknown):value is ResourceRequest {return Check(resourceRequestSchema,value);}
export function resourceResultValid(value:unknown):value is ResourceResult {
 try {
  if(!Check(resultSchema,value))return false;
  const r=value as ResourceResult;
  if(r.resultRef!==`resource:${r.requestId}:${encodeURIComponent(r.toolCallId)}` || !Number.isFinite(Date.parse(r.createdAt)))return false;
  if(new Set(r.records.map(x=>x.id)).size!==r.records.length || new Set(r.items.map(x=>x.id)).size!==r.items.length)return false;
  for(const row of r.records){decodeTaskResource(row.resource);if(row.source?.data)decodeSourceResource(row.source.data);if(row.association)decodeResourceAssociation(row.association);if(row.geometry&&!spatialGeometryValid(row.geometry))return false;if(!row.source&&!row.annotation)return false;}
  const included=new Set<string>();
  for(const item of r.items){for(const id of item.recordIds){if(included.has(id))return false;included.add(id);}}
  if(included.size!==r.records.length)return false;
  for(const row of r.records){
   const refs=[...(row.annotation?[row.annotation.ref]:[]),...resourceEvidence(row.resource).filter(e=>e.kind==='annotation').map(e=>e.ref)];
   const systems=[...(row.source?[row.source.ref.systemId]:[]),...(row.association?[row.association.source.systemId]:[]),...resourceEvidence(row.resource).filter(e=>e.kind==='source').map(e=>e.ref.systemId)];
   if(systems.some(id=>!r.dependencies.systemIds.includes(id))||refs.some(ref=>!r.dependencies.annotations.some(a=>JSON.stringify(a)===JSON.stringify(ref))))return false;
  }
  if(!Number.isFinite(Date.parse(r.statisticsScope.at)))return false;
  if(r.parameters.operation==='query'&&(r.statisticsScope.at!==r.createdAt||r.statisticsScope.relation!==(r.parameters.purpose==='task'?'related':'all')||r.statisticsScope.availability!=='all'))return false;
  if(r.parameters.operation==='summarize'&&(r.parameters.relation!==undefined&&r.statisticsScope.relation!==r.parameters.relation||r.statisticsScope.availability!==(r.parameters.availability??'all')))return false;
  const selected=r.parameters.operation==='query'&&r.parameters.purpose==='task'?r.items.filter(i=>i.relation!=='unconfirmed'):r.items;
  if(r.spatialCoverage&&(r.spatialCoverage.totalCandidateCount===undefined||!r.spatialCoverage.unclassified||r.spatialCoverage.totalCandidateCount!==r.spatialCoverage.candidateCount+r.spatialCoverage.unclassified.length||r.spatialCoverage.status!==(r.spatialCoverage.unclassified.length?'partial':'complete')))return false;
  const incompleteEmpty=!selected.length&&(r.coverage.some(c=>c.status!=='complete')||r.relationshipCoverage.status==='partial'&&r.statisticsScope.relation!=='all');
  if(r.summary.itemCount!==selected.length||r.summary.recordCount!==selected.reduce((n,i)=>n+i.recordIds.length,0)||r.summary.knownEntityCount!==selected.filter(i=>i.entityKey).length||r.summary.entityCount!==(incompleteEmpty||r.spatialCoverage?.status==='partial'||selected.some(i=>!i.entityKey)||new Set(selected.filter(i=>i.entityKey).map(i=>JSON.parse(i.entityKey!)[0])).size>1?null:selected.length))return false;
  if(JSON.stringify(r.summary.quantities)!==JSON.stringify(summarizeResources(r.records,selected,r.statisticsScope.at).quantities))return false;
  if(r.summary.quantities.some(q=>q.recordIds.some(id=>!r.records.some(row=>row.id===id))||new Set(q.recordIds).size!==q.recordIds.length))return false;
  if(r.messages.some(m=>!r.dependencies.systemIds.includes(m.resourceRef.systemId)))return false;
  for(const item of r.items)if(!item.recordIds.length || item.recordIds.some(id=>!r.records.some(row=>row.id===id)) || item.geometry&&!spatialGeometryValid(item.geometry))return false;
  return true;
 }catch{return false;}
}
export function projectResourceResult(result:ResourceResult,offset=0,limit=100) {
 const items=result.items.slice(offset,offset+limit),ids=new Set(items.flatMap(i=>i.recordIds));
 return {...result,records:result.records.filter(r=>ids.has(r.id)).map(({geometry,...row})=>({...row,...(geometry?{geometryType:geometry.type}:{})})),items:items.map(({geometry,...item})=>({...item,...(geometry?{geometryType:geometry.type}:{})})),page:{offset,limit,total:result.items.length,hasMore:offset+limit<result.items.length}};
}
export function extractResourceResult(details:unknown,toolName:string,isError?:boolean,content?:string):ResourceResult|null|undefined {
 if(!details||typeof details!=='object'||!Object.hasOwn(details,'resourceResult'))return;
 try {if(toolName!=='task_resource_query'||isError||!details||typeof details!=='object')return null;const r=(details as {resourceResult?:unknown}).resourceResult;if(!resourceResultValid(r))return null;
 if(content!==undefined){const model=JSON.parse(content);if(model.format!=='resource.model-result.v1'||Object.keys(model).some(k=>!['format','data'].includes(k)))return null;const page=model.data?.page;if(!page||!Number.isInteger(page.offset)||page.offset<0||!Number.isInteger(page.limit)||page.limit<1||page.limit>100||JSON.stringify(model.data)!==JSON.stringify(projectResourceResult(r,page.offset,page.limit)))return null;}
 return structuredClone(r);}catch{return null;}
}
