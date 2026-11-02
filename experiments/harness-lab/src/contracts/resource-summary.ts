import type { ResourceRecord, ResourceItem, ResourceSummary } from './resource-results.js';
import { RequestError } from './errors.js';
const entity=(r:ResourceRecord)=>r.association?JSON.stringify([r.association.source.systemId,r.association.entityId]):r.source?.data?.entityId?JSON.stringify([r.source.ref.systemId,r.source.data.entityId]):undefined;
export function summarizeResources(records:ResourceRecord[],items:ResourceItem[],at=new Date().toISOString()):ResourceSummary {
 const selected=new Set(items.flatMap(i=>i.recordIds)),rows=records.filter(r=>selected.has(r.id));
 const limitations:string[]=[];
 const unknown=items.filter(i=>!i.entityKey);
 const quantities:ResourceSummary['quantities']=[],groups=new Map<string,ResourceSummary['quantities'][number]>();
 const counted=new Set<string>();
 const comparable=(a:ResourceRecord,b:ResourceRecord)=>{const x=a.resource.quantity,y=b.resource.quantity;return !!x&&!!y&&a.resource.category===b.resource.category&&JSON.stringify([x.unit,x.meaning,x.scope,x.effectiveAt??null,x.validUntil??null,x.conditions??[]])===JSON.stringify([y.unit,y.meaning,y.scope,y.effectiveAt??null,y.validUntil??null,y.conditions??[]]);};
 const current=(r:ResourceRecord)=>{const q=r.resource.quantity;return !!q&&!q.conditions?.length&&(!q.effectiveAt||Date.parse(q.effectiveAt)<=Date.parse(at))&&(!q.validUntil||Date.parse(q.validUntil)>Date.parse(at));};
 for(const r of rows){
  const q=r.resource.quantity;if(!q){limitations.push(`记录 ${r.id} 数量未注明。`);continue;}
  const e=entity(r);
  if(e&&counted.has(e))continue;
  const entityConflict=e&&rows.some(other=>entity(other)===e&&JSON.stringify(other.resource.quantity&&[other.resource.quantity.value,other.resource.quantity.unit,other.resource.quantity.meaning,other.resource.quantity.scope,other.resource.quantity.effectiveAt,other.resource.quantity.validUntil,other.resource.quantity.conditions])!==JSON.stringify([q.value,q.unit,q.meaning,q.scope,q.effectiveAt,q.validUntil,q.conditions]));
  if(e)counted.add(e);
  const covering=rows.filter(a=>a!==r&&comparable(a,r)&&current(a)&&current(r)&&a.source?.ref.systemId===r.source?.ref.systemId&&a.source?.data?.coverage?.complete&&r.source?.data?.entityId&&a.source.data.coverage.memberEntityIds?.includes(r.source.data.entityId));
  if(covering.length===1)continue;
  const overlap=rows.some(a=>a!==r&&comparable(a,r)&&(a.resource.granularity==='aggregate'||r.resource.granularity==='aggregate')&&!a.source?.data?.coverage?.complete&&!r.source?.data?.coverage?.complete);
  const groupKey=JSON.stringify([r.resource.category??'unknown',q.unit,q.meaning,q.scope,q.effectiveAt??null,q.validUntil??null,r.source?.ref.systemId??r.association?.source.systemId??'declaration',r.resource.granularity==='individual'&&!e?r.id:null]);
  let group=groups.get(groupKey);
  if(!group){group={category:r.resource.category??'unknown',unit:q.unit,meaning:q.meaning,scope:q.scope,value:0,knownValue:0,unknownCount:0,recordIds:[],limitations:[]};groups.set(groupKey,group);quantities.push(group);}
  group.recordIds.push(r.id);
  if(overlap||q.value===null||covering.length>1||entityConflict||q.conditions?.length||q.validUntil&&Date.parse(q.validUntil)<=Date.parse(at)||q.effectiveAt&&Date.parse(q.effectiveAt)>Date.parse(at)){group.value=null;group.unknownCount++;group.limitations.push(overlap?'汇总与明细缺覆盖依据，不合计。':'数量、有效时间、条件、重复实体或覆盖关系未确定。');}
  else {group.knownValue+=q.value;if(group.value!==null)group.value+=q.value;if(!Number.isSafeInteger(group.knownValue))throw new RequestError('RESOURCE_LIMIT','资源数量合计超过安全整数范围。');}
 }
 if(new Set(items.filter(i=>i.entityKey).map(i=>JSON.parse(i.entityKey!)[0])).size>1)limitations.push('多个来源实体身份没有跨系统映射，不能确定跨系统去重后的实体总数。');
 if(unknown.length)limitations.push('存在实体身份未确认记录；记录数不能作为确定实体总数。');
 return {recordCount:rows.length,itemCount:items.length,knownEntityCount:items.length-unknown.length,entityCount:unknown.length||new Set(items.filter(i=>i.entityKey).map(i=>JSON.parse(i.entityKey!)[0])).size>1?null:items.length,quantities,limitations};
}
