import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';
import { RequestError } from './errors.js';

const strict = {additionalProperties:false};
const text = Type.String({minLength:1,maxLength:128,pattern:'\\S'});
const revision = Type.Integer({minimum:1,maximum:Number.MAX_SAFE_INTEGER});
const count = Type.Union([Type.Integer({minimum:0,maximum:Number.MAX_SAFE_INTEGER}),Type.Null()]);
const choices = <T extends string>(values:T[]) => Type.Unsafe<T>(Type.Union(values.map(value=>Type.Literal(value))));
const sourceRef = Type.Object({systemId:text,objectType:text,objectId:text},strict);
const uuid = Type.String({pattern:'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'});
const annotationRef = Type.Union([Type.Object({setId:uuid,revision},strict),Type.Object({publicationId:uuid},strict)]);
const time = Type.String({maxLength:64,pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?(?:Z|[+-]\\d{2}:\\d{2})$'});
export const resourceEvidenceSchema = Type.Union([
  Type.Object({kind:Type.Literal('declaration'),note:Type.String({minLength:1,maxLength:1000,pattern:'\\S'})},strict),
  Type.Object({kind:Type.Literal('source'),ref:sourceRef,revision},strict),
  Type.Object({kind:Type.Literal('annotation'),ref:annotationRef,objectId:text},strict),
]);
const basis = {
  evidence:Type.Array(resourceEvidenceSchema,{minItems:1,maxItems:20}),
  reportedAt:Type.Optional(time), effectiveAt:Type.Optional(time),
  validUntil:Type.Optional(time), conditions:Type.Optional(Type.Array(Type.String({minLength:1,maxLength:500,pattern:'\\S'}),{maxItems:10})),
};
export const RESOURCE_CATEGORIES = ['vehicle','fire_engine','vessel','rescue_boat','facility','hydrant','unknown'] as const;
export const RESOURCE_RELATIONS = ['assigned','potential_support','related','unconfirmed'] as const;
export const resourceSchema = Type.Object({
  vehicle:Type.Optional(Type.Object({type:choices(['water_tanker','foam','ladder','rescue','communications','logistics']),homeStationRef:sourceRef},strict)),
  meaning:choices(['actual_resource','planned_location','annotation','unspecified']),
  category:Type.Optional(choices([...RESOURCE_CATEGORIES])), granularity:Type.Optional(choices(['individual','aggregate','unknown'])),
  quantity:Type.Optional(Type.Object({value:count,unit:choices(['辆','艘','处','个','条','unknown']),meaning:choices(['entities','available','records']),scope:text,...basis},strict)),
  taskRelations:Type.Optional(Type.Array(Type.Object({taskId:text,relation:choices([...RESOURCE_RELATIONS]),...basis},strict),{maxItems:20})),
  availability:Type.Optional(Type.Object({state:choices(['available','unavailable','unknown']),...basis},strict)),
  position:Type.Optional(Type.Object({meaning:choices(['actual','planned','estimated','unknown']),appliesTo:choices(['resource','site','unknown']),...basis},strict)),
  evidence:Type.Optional(Type.Array(resourceEvidenceSchema,{minItems:1,maxItems:20})),
}, {...strict,description:'资源声明，不认证现实存在、分配或可用。各事实分别保留依据和时间；未知数量用 null。'});
export type TaskResource = Static<typeof resourceSchema>;
export type ResourceEvidence = Static<typeof resourceEvidenceSchema>;
/** Host generated only after an authorized exact source import; never accepted from normal edits. */
export const resourceAssociationSchema = Type.Object({source:Type.Object({systemId:text,objectType:Type.Literal('resource'),objectId:text},strict),sourceRevision:revision,entityId:text},strict);
export type ResourceAssociation = Static<typeof resourceAssociationSchema>;
export const sourceResourceSchema = Type.Object({
  resource:resourceSchema,
  entityId:Type.Optional(text),
  coverage:Type.Optional(Type.Object({scope:text,memberEntityIds:Type.Optional(Type.Array(text,{maxItems:500,uniqueItems:true})),complete:Type.Boolean()},strict)),
},strict);
export type SourceResource = Static<typeof sourceResourceSchema>;

/** Use the caller's explicit fact time; this pure check never consults the wall clock. */
export const resourceFactActive = (fact:{effectiveAt?:string;validUntil?:string;conditions?:string[]}|undefined,at:string) => !!fact&&(!fact.effectiveAt||Date.parse(fact.effectiveAt)<=Date.parse(at))&&(!fact.validUntil||Date.parse(fact.validUntil)>Date.parse(at))&&!fact.conditions?.length;

const invalid = () => new RequestError('INVALID_INPUT','资源字段、事实依据或数量无效。');
/** Reject prototype-bearing input before schema checks, including inherited required keys. */
function plain(value:unknown):void {
  if(!value || typeof value!=='object') return;
  if(Array.isArray(value)) {value.forEach(plain);return;}
  if(Object.getPrototypeOf(value)!==Object.prototype && Object.getPrototypeOf(value)!==null) throw invalid();
  for(const [key,item] of Object.entries(value)) {if(['__proto__','constructor','prototype'].includes(key)) throw invalid();plain(item);}
}
function dates(value:unknown):void {
  if(!value || typeof value!=='object') return;
  const object=value as Record<string,unknown>;
  for(const key of ['reportedAt','effectiveAt','validUntil']) if(object[key]!==undefined) {
    const value=String(object[key]);
    if(!Number.isFinite(Date.parse(value)) || new Date(`${value.slice(0,10)}T00:00:00Z`).toISOString().slice(0,10)!==value.slice(0,10)) throw invalid();
  }
  if(object.effectiveAt && object.validUntil && Date.parse(String(object.effectiveAt))>=Date.parse(String(object.validUntil))) throw invalid();
  Object.values(object).forEach(dates);
}
export function decodeTaskResource(value:unknown):TaskResource {
  plain(value);if(!Check(resourceSchema,value)) throw invalid();dates(value);
  const q=value.quantity;
  if(value.vehicle && (value.granularity!=='individual' || !['vehicle','fire_engine'].includes(value.category??'') || value.vehicle.homeStationRef.objectType!=='resource')) throw invalid();
  if(q && q.meaning!=='records') {
    const units:Partial<Record<NonNullable<TaskResource['category']>,string>>={vehicle:'辆',fire_engine:'辆',vessel:'艘',rescue_boat:'艘',facility:'处',hydrant:'个'};
    if(value.category && units[value.category] && q.unit!==units[value.category]) throw invalid();
    if(value.granularity==='individual' && q.value!==null && q.value>1) throw invalid();
  }
  if(q?.meaning==='records' && q.unit!=='条') throw invalid();
  if(value.taskRelations && new Set(value.taskRelations.map(item=>item.taskId)).size!==value.taskRelations.length) throw invalid();
  return structuredClone(value);
}
export function decodeResourceAssociation(value:unknown):ResourceAssociation {
  plain(value);if(!Check(resourceAssociationSchema,value)) throw invalid();return structuredClone(value);
}
export function decodeSourceResource(value:unknown):SourceResource {
  plain(value);if(!Check(sourceResourceSchema,value)) throw invalid();
  decodeTaskResource(value.resource);
  if(value.entityId && (value.resource.granularity!=='individual' || value.resource.meaning!=='actual_resource')) throw invalid();
  // Source adapters cannot import private annotations or impersonate other systems' evidence.
  if(resourceEvidence(value.resource).some(item=>item.kind==='annotation')) throw invalid();
  return structuredClone(value);
}
export function resourceEvidence(resource?:TaskResource):ResourceEvidence[] {
  return resource ? [...resource.evidence??[],...resource.quantity?.evidence??[],...resource.availability?.evidence??[],...resource.position?.evidence??[],...(resource.taskRelations??[]).flatMap(item=>item.evidence)] : [];
}
/** Publishing shares the declared values, but never the private evidence locator. */
export function publicResource(resource:TaskResource):TaskResource {
  const copy=structuredClone(resource);
  const project=(items:ResourceEvidence[])=>items.map(item=>item.kind==='annotation' && 'setId' in item.ref
    ? {kind:'declaration' as const,note:'发布者共享的声明；私有依据未公开，未经来源认证。'} : item);
  if(copy.evidence) copy.evidence=project(copy.evidence);
  for(const key of ['quantity','availability','position'] as const) if(copy[key]) copy[key].evidence=project(copy[key].evidence);
  for(const relation of copy.taskRelations??[]) relation.evidence=project(relation.evidence);
  return copy;
}

/** Batch 2 adapter handoff only: no query implementation or whole-task completeness claim. */
export interface ResourceSourceCapability {
  systemId:string; categories:NonNullable<TaskResource['category']>[]; units:NonNullable<TaskResource['quantity']>['unit'][];
  relations:typeof RESOURCE_RELATIONS[number][]; taskIdMapping?:string;
  supportRule?:{id:string;description:string}; filters:Array<'category'|'task'|'relation'>;
  pagination:'cursor'; snapshot:'fixed_revision';
}
export interface ResourceQueryScope {taskId?:string;systemId:string;relation?:typeof RESOURCE_RELATIONS[number];category?:TaskResource['category'];cursor?:string}
export type ResourceCoverage = {systemId:string;scope:ResourceQueryScope;status:'complete'|'partial'|'unavailable'|'unsupported';asOf?:string;nextCursor?:string;reason?:string};
/** Native message resolution belongs to the Pi consumer, not a parallel transcript store. */
export const conversationResourceSupplementSchema = Type.Object({taskId:text,resourceRef:sourceRef,message:Type.Object({sessionId:uuid,entryId:text,role:Type.Literal('user')},strict),reportedAt:time,resource:resourceSchema},strict);
export type ConversationResourceSupplement = Static<typeof conversationResourceSupplementSchema>;
export function decodeConversationResourceSupplement(value:unknown):ConversationResourceSupplement {
  plain(value);if(!Check(conversationResourceSupplementSchema,value)) throw invalid();dates(value);decodeTaskResource(value.resource);return structuredClone(value);
}

const queryScopeSchema=Type.Object({taskId:Type.Optional(text),systemId:text,relation:Type.Optional(choices([...RESOURCE_RELATIONS])),category:Type.Optional(choices([...RESOURCE_CATEGORIES])),cursor:Type.Optional(text)},strict);
const capabilitySchema=Type.Object({systemId:text,categories:Type.Array(choices([...RESOURCE_CATEGORIES]),{uniqueItems:true}),units:Type.Array(choices(['辆','艘','处','个','条','unknown']),{uniqueItems:true}),relations:Type.Array(choices([...RESOURCE_RELATIONS]),{uniqueItems:true}),taskIdMapping:Type.Optional(text),supportRule:Type.Optional(Type.Object({id:text,description:Type.String({minLength:1,maxLength:1000})},strict)),filters:Type.Array(choices(['category','task','relation']),{uniqueItems:true}),pagination:Type.Literal('cursor'),snapshot:Type.Literal('fixed_revision')},strict);
const coverageSchema=Type.Object({systemId:text,scope:queryScopeSchema,status:choices(['complete','partial','unavailable','unsupported']),asOf:Type.Optional(time),nextCursor:Type.Optional(text),reason:Type.Optional(Type.String({minLength:1,maxLength:1000,pattern:'\\S'}))},strict);
export function decodeResourceCapability(value:unknown):ResourceSourceCapability {
  plain(value);if(!Check(capabilitySchema,value)) throw invalid();return structuredClone(value);
}
export function decodeResourceCoverage(value:unknown):ResourceCoverage {
  plain(value);if(!Check(coverageSchema,value) || value.systemId!==value.scope.systemId) throw invalid();
  if(value.status==='complete' && (!value.asOf || value.nextCursor) || value.status==='partial' && (!value.asOf || !value.nextCursor && !value.reason) || ['unavailable','unsupported'].includes(value.status) && (!value.reason || value.nextCursor)) throw invalid();
  if(value.asOf) dates({effectiveAt:value.asOf});return structuredClone(value);
}
