import type { SituationObject } from '../../contracts/context';
import type { ResourceEvidence } from '../../contracts/task-resources';
import { refKey } from './evidence';
import { positionNote, resourceTypeLabel } from './map-data';

const evidenceText=(evidence:ResourceEvidence)=>evidence.kind==='declaration'?`来源声明：${evidence.note}`:evidence.kind==='source'?`来源依据：${evidence.ref.systemId}/${evidence.ref.objectType}/${evidence.ref.objectId} · 修订${evidence.revision}`:`标注依据：${evidence.objectId}`;
type Fact={reportedAt?:string;effectiveAt?:string;validUntil?:string;conditions?:string[];evidence:ResourceEvidence[]};
function FactDetails({name,fact}:{name:string;fact:Fact}) {
  return <section className="source-resource-fact"><h3>{name}</h3><dl><dt>报告时间</dt><dd>{fact.reportedAt || '未提供'}</dd><dt>生效时间</dt><dd>{fact.effectiveAt || '未提供'}</dd><dt>有效至</dt><dd>{fact.validUntil || '来源未限定'}</dd></dl>{fact.conditions?.length?<p>前置条件：{fact.conditions.join('；')}</p>:null}<ul>{fact.evidence.map((item,index)=><li key={index}>{evidenceText(item)}</li>)}</ul></section>;
}
export function SourceResourceSummary({item,objects,at}:{item:SituationObject;objects:SituationObject[];at?:string}) {
  const resource=item.resourceData?.resource;if(!resource)return null;
  const station=resource.vehicle?.homeStationRef;
  return <div className="source-resource-summary"><p>{resourceTypeLabel(item)}{station?` · 归属站：${objects.find(object=>refKey(object.ref)===refKey(station))?.name || station.objectId}`:''}</p>{positionNote(item,at)&&<p className="source-position-note">{positionNote(item,at)}</p>}<p className="resource-help">来源声明不表示已分配到当前任务。</p></div>;
}
export function SourceResourceDetails({item}:{item:SituationObject}) {
  const resource=item.resourceData?.resource;if(!resource)return null;
  return <>{resource.availability&&<FactDetails name="可用状态依据" fact={resource.availability}/>} {resource.position&&<><FactDetails name="位置依据" fact={resource.position}/><p>位置含义：{{actual:'来源记录位置',planned:'计划位置',estimated:'估计位置',unknown:'位置含义待确认'}[resource.position.meaning]} · {{resource:'资源自身',site:'站点或地点',unknown:'所指对象待确认'}[resource.position.appliesTo]}</p></>}{resource.evidence?.length?<ul>{resource.evidence.map((item,index)=><li key={index}>{evidenceText(item)}</li>)}</ul>:null}</>;
}
