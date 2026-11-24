import { createContext, lazy, Suspense, useContext, useMemo, useRef, useState } from 'react';
import type { Spec } from '@json-render/core';
import { JSONUIProvider, Renderer, type ComponentRegistry } from '@json-render/react';
import type { PublicMessage } from '../../contracts/index';
import type { ResultDatasetV1 } from '../../contracts/result-dataset';
import { resourceResultValid, type ResourceResult, type ResourceSummary } from '../../contracts/resource-results';
import { datasetUiCatalog } from '../../presentation/dataset-ui';
import { resourceUiComponents } from '../../presentation/resource-ui';
import { resourceResultCandidate, useAuthorizedResourceResult } from '../ResourceResultCard';
import { ResourceResultDetails, ResourceResultSources } from '../ResourceResultDetails';
import { availabilityLabels, resourceRelationLabels } from '../annotations/ResourceFields';
import { datasetChartConfig } from './dataset-chart';
import { datasetFromEvidence } from './dataset-evidence';
import { ResultDatasetTable } from './ResultDatasetTable';
import { readResultUiSnapshot, type ResultUiSnapshot } from './spec-stream';
import './result-ui.css';

const ResultContext = createContext<ReturnType<typeof useAuthorizedResourceResult> | null>(null);
const DatasetContext = createContext<ResultDatasetV1 | null>(null);
const ResourceBar = lazy(() => import('./ResourceBar').then(({ ResourceBar }) => ({ default: ResourceBar })));
const ResultDatasetChart = lazy(() => import('./ResultDatasetChart').then(({ ResultDatasetChart }) => ({ default: ResultDatasetChart })));

function ResourceMetrics({ summary }: { summary: ResourceSummary }) {
  return <dl className="chat-result-ui-metrics">
    <div><dt>记录数</dt><dd>{summary.recordCount}<span> 条</span></dd></div>
    <div><dt>条目数</dt><dd>{summary.itemCount}<span> 项</span></dd></div>
    <div><dt>实体数量</dt><dd>{summary.entityCount === null ? '未知' : <>{summary.entityCount}<span> 个</span></>}
      {summary.entityCount === null && <small>已识别 {summary.knownEntityCount} 个</small>}
    </dd></div>
  </dl>;
}

function ResourceResultView({ section }: { section: 'sources' | 'details' }) {
  const read = useContext(ResultContext);
  const [visibility, setVisibility] = useState<'closed' | 'checking' | 'open'>('closed');
  const opening = useRef(0);
  if (!read) return null;
  const { busy, error, page, readPage, result } = read;

  return <details className="chat-result-ui-disclosure" data-resource-section={section}
    onToggle={event => {
      if (event.target !== event.currentTarget) return;
      const expanded = event.currentTarget.open;
      const current = ++opening.current;
      setVisibility(expanded ? 'checking' : 'closed');
      if (expanded) void readPage(page).then(() => {
        if (opening.current === current) setVisibility('open');
      });
    }}>
    <summary>{section === 'sources' ? '查看来源与覆盖' : '查看资源明细与依据'}</summary>
    {visibility !== 'closed' && busy && <p className="chat-result-ui-notice" role="status">正在读取结果…</p>}
    {visibility === 'open' && error && <div className="chat-result-ui-read-error">
      <p className="chat-result-ui-notice" role="alert">{error}</p>
      <button type="button" onClick={() => void readPage(page)}>重新读取</button>
    </div>}
    {visibility === 'open' && result && (section === 'sources'
      ? <ResourceResultSources result={result} compact />
      : <ResourceResultDetails result={result} page={page} busy={busy} onPage={readPage} compact />)}
  </details>;
}

const registry = {
  [resourceUiComponents.stack]: ({ children }) => <div className="chat-result-ui-stack">{children}</div>,
  [resourceUiComponents.metrics]: function MetricsNode() {
    const result = useContext(ResultContext)?.result;
    return result && <ResourceMetrics summary={result.summary} />;
  },
  [resourceUiComponents.bar]: function BarNode() {
    const result = useContext(ResultContext)?.result;
    return result && <Suspense fallback={<p className="chat-result-ui-notice" role="status">正在绘制柱状图…</p>}>
      <ResourceBar result={result} />
    </Suspense>;
  },
  [resourceUiComponents.view]: function ViewNode({ element }) {
    return <ResourceResultView section={element.props.section === 'sources' ? 'sources' : 'details'} />;
  },
  ResultTable: function TableNode() {
    const dataset = useContext(DatasetContext);
    return dataset && <ResultDatasetTable columns={dataset.columns} rows={dataset.rows} />;
  },
  ChartView: function ChartNode({ element }) {
    const dataset = useContext(DatasetContext);
    const config = useMemo(() => datasetChartConfig(element.props), [element.props]);
    return dataset && config && <Suspense fallback={<p className="chat-result-ui-notice" role="status">正在绘制图表…</p>}>
      <ResultDatasetChart dataset={dataset} config={config} />
    </Suspense>;
  },
} satisfies ComponentRegistry;

function ResourceResultScope({ result, compact }: { result: ResourceResult; compact: boolean }) {
  const { relation, availability, at } = result.statisticsScope;
  const incompleteSources = result.coverage.filter(source => source.status !== 'complete').length;
  const spatial = result.parameters.operation === 'summarize' && result.parameters.spatialResultRef
    ? (result.parameters.position ? { interior: '范围内部', boundary: '范围边界', exterior: '范围外部' }[result.parameters.position] : '所选空间结果集合')
    : null;
  const coverage = [
    incompleteSources > 0 && `来源覆盖不完整（${incompleteSources}/${result.coverage.length}）`,
    relation !== 'all' && result.relationshipCoverage.status === 'partial' && '任务关系仅部分覆盖',
    result.spatialCoverage?.status === 'partial' && `${result.spatialCoverage.unclassified?.length ?? 0} 项位置无法判断`,
  ].filter(Boolean).join(' · ');
  const timeLabel = result.schemaVersion === 4 ? '场景判断时间' : '统计时间';

  if (compact) {
    const scope = [
      relation !== 'all' && resourceRelationLabels[relation],
      availability !== 'all' && `可用性 ${availabilityLabels[availability]}`,
      spatial,
    ].filter(Boolean).join(' · ');
    const excluded = result.items.length - result.summary.itemCount;
    const warnings = [
      excluded > 0 && `${excluded} 项候选未计入统计`,
      coverage,
    ].filter(Boolean).join(' · ');
    return <header className="chat-result-ui-heading">
      <p>{timeLabel} <time dateTime={at}>{at}</time>{scope && ` · ${scope}`}</p>
      {warnings && <p className="chat-result-ui-coverage">{warnings}</p>}
    </header>;
  }

  return <header className="chat-result-ui-heading">
    <h3>资源统计</h3>
    <p>{timeLabel} <time dateTime={at}>{at}</time></p>
    <p>任务关系 {resourceRelationLabels[relation]} · 可用性 {availabilityLabels[availability]}{spatial && ` · 空间范围 ${spatial}`}</p>
    {coverage && <p className="chat-result-ui-coverage">{coverage}</p>}
  </header>;
}

function ResourceResultBlock({ origin, spec }: { origin: ResourceResult; spec: Spec }) {
  const read = useAuthorizedResourceResult(origin);
  const compact = Object.values(spec.elements).some(element => element.type === resourceUiComponents.view);
  return <ResultContext.Provider value={read}>
    {read.result && <ResourceResultScope result={read.result} compact={compact} />}
    <JSONUIProvider registry={registry}><Renderer spec={spec} registry={registry} /></JSONUIProvider>
  </ResultContext.Provider>;
}

function DatasetScope({ dataset }: { dataset: ResultDatasetV1 }) {
  const { source, scope, method } = dataset.provenance;
  return <header className="chat-result-ui-heading">
    <h3>计算结果</h3>
    <p>来源 {source}</p>
    <p>范围 {scope}</p>
    <p>方法 {method}</p>
  </header>;
}

export default function ResultUiBlock({ lines, closed, evidence, sessionId, requestId, active }: {
  lines: string;
  closed: boolean;
  evidence: PublicMessage[];
  sessionId: string;
  requestId?: string;
  active: boolean;
}) {
  const [previous, setPrevious] = useState<ResultUiSnapshot>();
  const snapshot = readResultUiSnapshot(previous, lines, closed);
  if (snapshot !== previous) setPrevious(snapshot);

  const datasetBlock = snapshot.block?.catalog === datasetUiCatalog;
  const candidate = snapshot.block && !datasetBlock && resourceResultCandidate(evidence, snapshot.block.resultRef, sessionId, requestId);
  const result = useMemo(() => resourceResultValid(candidate) ? candidate : undefined, [candidate]);
  const ref = snapshot.block?.resultRef;
  const dataset = useMemo(() => datasetBlock && ref ? datasetFromEvidence(evidence, ref, sessionId, requestId) : undefined,
    [datasetBlock, evidence, ref, sessionId, requestId]);
  const dataAvailable = Boolean(result || dataset);
  const { spec } = snapshot;
  const display = spec && dataAvailable;
  const label = datasetBlock ? '计算结果展示' : '资源展示';
  let notice: string | undefined;
  if (snapshot.status === 'invalid') notice = `${label}格式有误。`;
  else if (snapshot.block && !dataAvailable && (!active || closed)) notice = datasetBlock ? '原计算结果不可用。' : '原资源结果不可用。';
  else if (!closed && !active) notice = `${label}未完成。`;
  else if (!display) notice = `正在生成${snapshot.block ? label : '结果展示'}…`;

  return <section className="chat-result-ui" aria-label={label} data-result-ui-block={snapshot.block?.id}>
    {spec && result && <ResourceResultBlock key={`${sessionId}:${result.resultRef}`} origin={result} spec={spec} />}
    {spec && dataset && <DatasetContext.Provider value={dataset}>
      <DatasetScope dataset={dataset} />
      <JSONUIProvider registry={registry}><Renderer spec={spec} registry={registry} /></JSONUIProvider>
    </DatasetContext.Provider>}
    {notice && <p className="chat-result-ui-notice" role={active && snapshot.status === 'pending' ? 'status' : undefined}>{notice}</p>}
  </section>;
}
