import {
  resourceItemExplanation, resourceItemLimitations, resourceOverlapIndex, resourceRecordTimes, resourceSummaryLimitations,
} from '../contracts/resource-explanations';
import type { ResourceItem, ResourceResult } from '../contracts/resource-results';
import { resourceStatisticsItems } from '../contracts/resource-summary';
import { ResourceFacts } from './annotations/ResourceFacts';
import { availabilityLabels, resourceCategoryLabels, resourceRelationLabels } from './annotations/ResourceFields';
import { annotationLabel } from './annotations/helpers';

const statusLabels = { complete: '完整', partial: '部分', unavailable: '不可用', unsupported: '不支持' };
const meaningLabels: Record<string, string> = { entities: '实体数量', available: '可用量', records: '记录条数' };
export const resourceResultPageSize = 10;

function labelFrom(labels: Record<string, string>, value: string) {
  return Object.hasOwn(labels, value) ? labels[value] : value;
}

function locatorLabel(value: string, result: ResourceResult): string {
  const known = result.items.find(item => item.id === value)?.name || result.records.find(row => row.id === value)?.name;
  if (known) return known;
  try {
    const ref = JSON.parse(value);
    if (ref && typeof ref === 'object' && !Array.isArray(ref) && ('setId' in ref || 'publicationId' in ref)) {
      return `标注 ${annotationLabel(ref)}`;
    }
    if (Array.isArray(ref) && ref[0] === 'annotation' && typeof ref[2] === 'string') {
      return `标注对象 ${ref[2]} · ${annotationLabel(ref[1])}`;
    }
    if (Array.isArray(ref) && ref[0] === 'source') {
      return `来源对象 ${typeof ref[1] === 'object' ? ref[1].objectId : ref.slice(1).join(' / ')}`;
    }
  } catch { /* Ordinary source names need no parsing. */ }
  return value;
}

function readableText(text: string, result: ResourceResult): string {
  const ids = new Set([
    ...result.records.map(row => row.id), ...result.items.map(item => item.id),
    ...(result.spatialCoverage?.unclassified?.map(row => row.id) ?? []), ...result.exclusions.map(row => row.id),
  ]);
  for (const id of ids) text = text.replaceAll(id, locatorLabel(id, result));
  return text;
}

export function ResourceResultSources({ result, compact = false }: { result: ResourceResult; compact?: boolean }) {
  const { parameters, coverage, relationshipCoverage, spatialCoverage } = result;
  const { systemIds, annotations } = result.dependencies;
  return <div className="resource-result-sources">
    {(!compact || systemIds.length > 0) && <p>来源范围：{systemIds.join('、') || '未包含来源系统'}</p>}
    {(!compact || annotations.length > 0) && <p>固定标注版本：{annotations.map(annotationLabel).join('、') || '未包含标注版本'}</p>}
    {parameters.operation === 'query' && <>
      {(!compact || Boolean(parameters.sources?.length)) && <p>来源选择：{parameters.sources?.map(source => {
        const selection = source.objectRefs?.map(ref => ref.objectId).join('、') || source.areaIds?.join('、') || source.query;
        return `${source.systemId} · ${selection || '所请求来源范围'}`;
      }).join('；') || '按任务发现的来源'}</p>}
      {(!compact || Boolean(parameters.annotations?.length)) && <p>标注选择：{parameters.annotations?.map(annotation => (
        `${annotationLabel(annotation.ref)} · ${annotation.objectIds?.join('、') || annotation.layerIds?.join('、') || '整个版本'}`
      )).join('；') || '按任务发现的标注'}</p>}
    </>}
    {coverage.length > 0 && <ul>{coverage.map((entry, index) => <li key={index}>
      {locatorLabel(entry.source, result)}：{statusLabels[entry.status]}{entry.reason ? ` · ${entry.reason}` : ''}
      {entry.asOf ? ` · 数据时间 ${entry.asOf}` : ''}
    </li>)}</ul>}
    <p>任务关系：{statusLabels[relationshipCoverage.status]} · {readableText(relationshipCoverage.reason, result)}</p>
    {relationshipCoverage.sources?.map((entry, index) => <p key={index}>
      {locatorLabel(entry.source, result)}：{statusLabels[entry.status]} · {entry.reason}
    </p>)}
    {spatialCoverage && <p>
      空间筛选：{statusLabels[spatialCoverage.status]}，可判断 {spatialCoverage.candidateCount} 项；位置无法判断 {spatialCoverage.unclassified?.length ?? 0} 项。
    </p>}
    {spatialCoverage?.unclassified?.map(row => <p key={row.id}>{locatorLabel(row.id, result)}：{readableText(row.reason, result)}</p>)}
    {resourceSummaryLimitations(result).map((text, index) => <p key={index}>{readableText(text, result)}</p>)}
    {result.exclusions.map((row, index) => <p key={index}>未纳入 {locatorLabel(row.id, result)}：{readableText(row.reason, result)}</p>)}
  </div>;
}

function ResourceQuantities({ result }: { result: ResourceResult }) {
  if (!result.summary.quantities.length) return null;
  return <ul aria-label="按口径分别统计的数量">{result.summary.quantities.map((quantity, index) => <li key={index}>
    {labelFrom(resourceCategoryLabels, quantity.category)} · {quantity.scope} · {labelFrom(meaningLabels, quantity.meaning)}：
    {quantity.value === null ? `未知（已知部分 ${quantity.knownValue}，${quantity.unknownCount} 项未知）` : quantity.value}
    {' '}{quantity.unit === 'unknown' ? '单位未知' : quantity.unit}
    {quantity.limitations.length > 0 && <p>{readableText(quantity.limitations.join('；'), result)}</p>}
  </li>)}</ul>;
}

function ResourceItemEvidence({ result, item, overlapIndex }: {
  result: ResourceResult;
  item: ResourceItem;
  overlapIndex: ReturnType<typeof resourceOverlapIndex> | undefined;
}) {
  const explanation = result.schemaVersion === 3 ? resourceItemExplanation(result, item, overlapIndex) : undefined;
  return <details>
    <summary>查看依据与限制</summary>
    {explanation ? <>
      <p>{explanation.relation.message}</p>
      {explanation.identity.map((reason, index) => <p key={index}>
        {reason.message}
        {'overlaps' in reason && <>
          {reason.overlaps?.map(overlap => <span key={overlap.recordId}>
            {' 与'}{readableText(overlap.recordId, result)}有{overlap.sharedMemberCount}个已知重叠成员
            {overlap.memberIdsComplete ? '：' : '，仅列示例：'}{overlap.memberEntityIds.join('、')}。
            {!overlap.memberIdsComplete && '完整成员依据保留在固定结果中，可继续读取。'}
          </span>)}
          {reason.overlapExamplesComplete === false && <span>
            {' 共与'}{reason.overlapRecordCount}条记录存在已知重叠，此处仅列{reason.overlaps?.length}条；完整成员依据保留在固定结果中，可继续读取。
          </span>}
        </>}
      </p>)}
      {explanation.availability.reasons.map((reason, index) => <p key={index}>{reason.message}</p>)}
    </> : <p>{item.entityKey ? '有可靠实体关联' : '尚未确认实体身份，不能仅按名称合并'}</p>}
    {item.relationBasis.map((text, index) => <p key={index}>{readableText(text, result)}</p>)}
    {resourceItemLimitations(result, item).map((text, index) => <p key={index}>{readableText(text, result)}</p>)}
    <p>空间位置：{item.positionReason || (item.geometry ? '有可用位置；是否命中范围以空间筛选结果为准' : '无法判断，缺少可用位置')}</p>
    {result.records.filter(row => item.recordIds.includes(row.id)).map(row => <div key={row.id}>
      <p>{row.name} · {row.source
        ? `来源 ${row.source.ref.systemId} / ${row.source.ref.objectId} · r${row.source.revision} · 查询于 ${row.source.queriedAt}`
        : `固定标注 ${row.annotation ? annotationLabel(row.annotation.ref) : ''} / ${row.annotation?.objectId}`}</p>
      {result.schemaVersion === 3 && <p>{row.source ? `来源快照时间 ${row.source.asOf}（不是本次查询时间）`
        : `固定标注版本时间 ${resourceRecordTimes(result, row).annotationVersion?.createdAt ?? '未提供'}（不是事实发生时间）`}</p>}
      <ResourceFacts resource={row.resource} />
    </div>)}
  </details>;
}

export function ResourceResultDetails({ result, page, busy, onPage, compact = false }: {
  result: ResourceResult;
  page: number;
  busy: boolean;
  onPage: (page: number) => void;
  compact?: boolean;
}) {
  const offset = page * resourceResultPageSize;
  const count = result.items.length;
  const range = `${count ? offset + 1 : 0}–${Math.min(offset + resourceResultPageSize, count)} / ${count}`;
  const candidateList = result.parameters.operation === 'query' && result.parameters.purpose === 'task';
  const included = compact ? new Set(resourceStatisticsItems(result).map(item => item.id)) : undefined;
  const overlapIndex = result.schemaVersion === 3 ? resourceOverlapIndex(result) : undefined;
  const previousDisabled = busy || page === 0;
  const nextDisabled = busy || offset + resourceResultPageSize >= count;
  return <>
    <ResourceQuantities result={result} />
    <details>
      <summary>{compact ? '查看来源与覆盖' : '数据与任务关系覆盖情况'}</summary>
      <ResourceResultSources result={result} compact={compact} />
    </details>
    {!compact && <p>{candidateList ? '下方列出完整候选，包含任务关系未确认的条目；未确认条目不计入上方任务统计。' : '下方为本次固定结果名单。'}</p>}
    {compact && !count ? <p>暂无资源条目。</p> : <p>
      {compact && candidateList ? '候选' : '条目'} {range}{!compact && '（上方统计涵盖完整固定结果）'}
    </p>}
    <ul className="resource-result-items">
      {result.items.slice(offset, offset + resourceResultPageSize).map(item => <li key={item.id}>
        <strong>{item.name}</strong>
        <p>{labelFrom(resourceCategoryLabels, item.category)} · {resourceRelationLabels[item.relation]} · {availabilityLabels[item.availability]}
          {included && !included.has(item.id) && ' · 未纳入统计'}</p>
        <ResourceItemEvidence result={result} item={item} overlapIndex={overlapIndex} />
      </li>)}
    </ul>
    {(!compact || count > resourceResultPageSize) && <nav className={compact ? 'resource-result-pages' : undefined} aria-label="资源结果分页">
      <button type="button" disabled={!compact && previousDisabled} aria-disabled={compact && previousDisabled || undefined}
        onClick={() => { if (!previousDisabled) onPage(page - 1); }}>上一页</button>
      <button type="button" disabled={!compact && nextDisabled} aria-disabled={compact && nextDisabled || undefined}
        onClick={() => { if (!nextDisabled) onPage(page + 1); }}>下一页</button>
    </nav>}
  </>;
}
