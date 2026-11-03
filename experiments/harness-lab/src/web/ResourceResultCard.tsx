import { resourceItemExplanation, resourceItemLimitations, resourceOverlapIndex, resourceRecordTimes, resourceSummaryLimitations } from '../contracts/resource-explanations';
import { useEffect, useRef, useState } from 'react';
import type { PublicMessage, SessionSnapshot } from '../contracts/index';
import { resourceResultValid, type ResourceResult } from '../contracts/resource-results';
import { useApi } from './api';
import { availabilityLabels, resourceCategoryLabels, resourceRelationLabels } from './annotations/ResourceFields';
import './resource-result.css';
import { ResourceFacts } from './annotations/ResourceFacts';
import { annotationLabel } from './annotations/helpers';

const statusLabels:Record<string,string>={complete:'完整',partial:'部分',unavailable:'不可用',unsupported:'不支持'};
const meaningLabels:Record<string,string>={entities:'实体数量',available:'可用量',records:'记录条数'};
function locatorLabel(value:string,result:ResourceResult):string {
 const known=result.items.find(item=>item.id===value)?.name||result.records.find(row=>row.id===value)?.name;if(known)return known;
 try {const ref=JSON.parse(value);if(ref&&typeof ref==='object'&&!Array.isArray(ref)&&('setId' in ref||'publicationId' in ref))return `标注 ${annotationLabel(ref)}`;
 if(Array.isArray(ref)&&ref[0]==='annotation'&&typeof ref[2]==='string')return `标注对象 ${ref[2]} · ${annotationLabel(ref[1])}`;
 if(Array.isArray(ref)&&ref[0]==='source')return `来源对象 ${typeof ref[1]==='object'?ref[1].objectId:ref.slice(1).join(' / ')}`;
 }catch{/* Ordinary source names need no parsing. */}return value;
}
function readableText(text:string,result:ResourceResult):string {
 for(const id of new Set([...result.records.map(row=>row.id),...result.items.map(item=>item.id),...(result.spatialCoverage?.unclassified?.map(row=>row.id)||[]),...result.exclusions.map(row=>row.id)]))text=text.replaceAll(id,locatorLabel(id,result));
 return text;
}
export function authorizedResourceResult(messages:PublicMessage[], original:ResourceResult) {
  return messages.find(m=>m.role==='tool'&&!m.isError&&!m.resultMissing&&m.toolName==='task_resource_query'&&m.resourceResult?.resultRef===original.resultRef&&resourceResultValid(m.resourceResult))?.resourceResult;
}
export function ResourceResultCard({result}:{result:ResourceResult}) {
  const {api}=useApi();const request=useRef(0);
  const [view,setView]=useState<{origin:ResourceResult;result?:ResourceResult;page:number;busy:boolean;error?:string}>({origin:result,result,page:0,busy:false});
  useEffect(()=>()=>{request.current++;},[]);
  const shown=view.origin===result?view:{origin:result,result,page:0,busy:false};
  const data=shown.result;
  const overlapIndex=data?.schemaVersion===3?resourceOverlapIndex(data):undefined;
  async function readPage(page:number) {
    const generation=++request.current;
    // No cached fallback: every page action rechecks current session authorization.
    setView({origin:result,page,busy:true});
    try {
      const snapshot=await api<SessionSnapshot>(`/api/sessions/${encodeURIComponent(result.owner.sessionId)}`);
      const current=authorizedResourceResult(snapshot.messages,result);
      if(!current)throw new Error('此结果已不可读取或不再获准展示。');
      if(generation===request.current)setView({origin:result,result:current,page:Math.min(page,Math.max(0,Math.ceil(current.items.length/10)-1)),busy:false});
    }catch(error){if(generation===request.current)setView({origin:result,page:0,busy:false,error:error instanceof Error?error.message:'无法读取结果。'});}
  }
  return <section className="resource-result-card" aria-label="资源查询结果">
    <header><strong>{result.delivery?'读取已有资源结果':result.parameters.operation==='summarize'?'资源统计结果':'资源查询结果'}</strong><button type="button" disabled={shown.busy} onClick={()=>void readPage(shown.page)}>重新读取此结果</button></header>
    {shown.busy&&<p role="status">正在核对结果访问权限…</p>}{shown.error&&<p role="alert">{shown.error}</p>}
    {data&&<><p className="resource-help">固定结果 · 统计时间 {data.statisticsScope.at}。重新读取不会刷新来源或生成新结果。</p>
    <dl className="resource-statistics"><dt>统计范围内记录</dt><dd>{data.summary.recordCount} 条</dd><dt>统计范围内条目</dt><dd>{data.summary.itemCount} 项</dd><dt>实体数量</dt><dd>{data.summary.entityCount===null?`未知（已识别 ${data.summary.knownEntityCount} 个实体）`:`${data.summary.entityCount} 个`}</dd><dt>统计范围</dt><dd>{resourceRelationLabels[data.statisticsScope.relation]} · {availabilityLabels[data.statisticsScope.availability]}{data.parameters.operation==='summarize'&&data.parameters.spatialResultRef?` · 空间位置：${{interior:'范围内部',boundary:'范围边界',exterior:'范围外部'}[data.parameters.position??'interior']}`:''}</dd></dl>
    {!!data.summary.quantities.length&&<ul aria-label="按口径分别统计的数量">{data.summary.quantities.map((q,i)=><li key={i}>{resourceCategoryLabels[q.category]||q.category} · {q.scope} · {meaningLabels[q.meaning]||q.meaning}：{q.value===null?`未知（已知部分 ${q.knownValue}，${q.unknownCount} 项未知）`:q.value} {q.unit==='unknown'?'单位未知':q.unit}{q.limitations.length>0&&<p>{readableText(q.limitations.join('；'),data)}</p>}</li>)}</ul>}
    <details><summary>数据与任务关系覆盖情况</summary><p>来源范围：{data.dependencies.systemIds.join('、')||'未包含来源系统'}</p><p>固定标注版本：{data.dependencies.annotations.map(annotationLabel).join('、')||'未包含标注版本'}</p>{data.parameters.operation==='query'&&<><p>来源选择：{data.parameters.sources?.map(source=>`${source.systemId} · ${source.objectRefs?.map(ref=>ref.objectId).join('、')||source.areaIds?.join('、')||source.query||'所请求来源范围'}`).join('；')||'按任务发现的来源'}</p><p>标注选择：{data.parameters.annotations?.map(ref=>`${annotationLabel(ref.ref)} · ${ref.objectIds?.join('、')||ref.layerIds?.join('、')||'整个版本'}`).join('；')||'按任务发现的标注'}</p></>}<ul>{data.coverage.map((c,i)=><li key={i}>{locatorLabel(c.source,data)}：{statusLabels[c.status]}{c.reason?` · ${c.reason}`:''}{c.asOf?` · 数据时间 ${c.asOf}`:''}</li>)}</ul><p>任务关系：{statusLabels[data.relationshipCoverage.status]} · {readableText(data.relationshipCoverage.reason,data)}</p>{data.relationshipCoverage.sources?.map((c,i)=><p key={i}>{locatorLabel(c.source,data)}：{statusLabels[c.status]} · {c.reason}</p>)}{data.spatialCoverage&&<p>空间筛选：{statusLabels[data.spatialCoverage.status]}，可判断 {data.spatialCoverage.candidateCount} 项；位置无法判断 {data.spatialCoverage.unclassified?.length??0} 项。</p>}{data.spatialCoverage?.unclassified?.map(row=><p key={row.id}>{locatorLabel(row.id,data)}：{readableText(row.reason,data)}</p>)}{resourceSummaryLimitations(data).map((text,i)=><p key={i}>{readableText(text,data)}</p>)}{data.exclusions.map((row,i)=><p key={i}>未纳入 {locatorLabel(row.id,data)}：{readableText(row.reason,data)}</p>)}</details>
    <p>{data.parameters.operation==='query'&&data.parameters.purpose==='task'?'下方列出完整候选，包含任务关系未确认的条目；未确认条目不计入上方任务统计。':'下方为本次固定结果名单。'}</p><p>条目 {data.items.length?shown.page*10+1:0}–{Math.min((shown.page+1)*10,data.items.length)} / {data.items.length}（上方统计涵盖完整固定结果）</p>
    <ul className="resource-result-items">{data.items.slice(shown.page*10,(shown.page+1)*10).map(item=>{const explanation=data.schemaVersion===3?resourceItemExplanation(data,item,overlapIndex):undefined;return <li key={item.id}><strong>{item.name}</strong><p>{resourceCategoryLabels[item.category]||item.category} · {resourceRelationLabels[item.relation]} · {availabilityLabels[item.availability]}</p><details><summary>查看依据与限制</summary>{explanation?<><p>{explanation.relation.message}</p>{explanation.identity.map((reason,i)=><p key={`identity-${i}`}>{reason.message}{'overlaps' in reason&&<>{reason.overlaps?.map(overlap=><span key={overlap.recordId}> 与{readableText(overlap.recordId,data)}有{overlap.sharedMemberCount}个已知重叠成员{overlap.memberIdsComplete?'：':'，仅列示例：'}{overlap.memberEntityIds.join('、')}。{!overlap.memberIdsComplete&&'完整成员依据保留在固定结果中，可继续读取。'}</span>)}{reason.overlapExamplesComplete===false&&<span> 共与{reason.overlapRecordCount}条记录存在已知重叠，此处仅列{reason.overlaps?.length}条；完整成员依据保留在固定结果中，可继续读取。</span>}</>}</p>)}{explanation.availability.reasons.map((reason,i)=><p key={`availability-${i}`}>{reason.message}</p>)}</>:<p>{item.entityKey?'有可靠实体关联':'尚未确认实体身份，不能仅按名称合并'}</p>}{item.relationBasis.map((text,i)=><p key={i}>{readableText(text,data)}</p>)}{resourceItemLimitations(data,item).map((text,i)=><p key={i}>{readableText(text,data)}</p>)}<p>空间位置：{item.positionReason||(item.geometry?'有可用位置；是否命中范围以空间筛选结果为准':'无法判断，缺少可用位置')}</p>{data.records.filter(row=>item.recordIds.includes(row.id)).map(row=><div key={row.id}><p>{row.name} · {row.source?`来源 ${row.source.ref.systemId} / ${row.source.ref.objectId} · r${row.source.revision} · 查询于 ${row.source.queriedAt}`:`固定标注 ${row.annotation?annotationLabel(row.annotation.ref):''} / ${row.annotation?.objectId}`} </p>{data.schemaVersion===3&&<><p>{row.source?`来源快照时间 ${row.source.asOf}（不是本次查询时间）`:`固定标注版本时间 ${resourceRecordTimes(data,row).annotationVersion?.createdAt??'未提供'}（不是事实发生时间）`}</p></>}<ResourceFacts resource={row.resource}/></div>)}</details></li>;})}</ul>
    <nav aria-label="资源结果分页"><button type="button" disabled={shown.busy||shown.page===0} onClick={()=>void readPage(shown.page-1)}>上一页</button><button type="button" disabled={shown.busy||(shown.page+1)*10>=data.items.length} onClick={()=>void readPage(shown.page+1)}>下一页</button></nav>
    </>}
  </section>;
}
