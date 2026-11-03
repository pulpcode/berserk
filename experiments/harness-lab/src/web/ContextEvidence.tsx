import type { PublicMessage } from '../contracts';
import { EvidenceMapLinks } from './situation/MapContext';
import { spatialMapEntries, taskDiscoveryEntry } from './situation/evidence';
import { analysisLabels, analysisValue } from './situation/AnalysisPanel';
import { informationTime } from './information-ui';

const queries: Record<string, string> = { information_search: '报告检索', information_read: '报告正文', situation_query: '态势查询', task_search: '任务检索', task_read: '任务详情' };
export function isContextEvidence(message: PublicMessage) { return message.role === 'tool' && !message.isError && !message.resultMissing && (message.toolName === 'analysis_task_candidates' ? Boolean(taskDiscoveryEntry(message)) : message.toolName === 'spatial_analyze' ? spatialMapEntries([message]).length > 0 : Boolean(message.toolName && Object.hasOwn(queries, message.toolName))); }
function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function scalar(value: unknown) { return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined; }
function reference(value: unknown) {
  const item = record(value); if (!item) return '';
  return [item.systemId, item.objectType, item.objectId].map(scalar).filter(Boolean).join(' / ');
}
function description(value: unknown) {
  const item = record(value); if (!item) return '记录';
  const after = record(item.after); const object = after || item;
  const id = scalar(object.reportId) || reference(object.ref) || scalar(object.id) || '记录';
  const revision = scalar(object.revision);
  const time = scalar(item.effectiveAt) || scalar(object.observedAt) || scalar(object.effectiveAt) || scalar(object.updatedAt);
  const valid = record(object.validTime);
  return <><strong>{id}</strong><span>{revision ? `版本 ${revision}` : '来源未提供版本'} · {time ? `业务／更新时间 ${time}` : '来源未提供业务时间'}</span>{valid && <span>有效时间：{scalar(valid.from) || '未限定开始'} ～ {scalar(valid.to) || '未限定结束'}</span>}</>;
}
function QueryEvidence({ message, onOpenMap }: { message: PublicMessage; onOpenMap?: () => void }) {
  let envelope: Record<string, unknown> | undefined;
  try { envelope = record(JSON.parse(message.text)); } catch { /* Older tool text remains readable without fabricated metadata. */ }
  const data = record(envelope?.data); const source = scalar(envelope?.systemId); const queriedAt = scalar(envelope?.queriedAt);
  const items = data && (Array.isArray(data.items) ? data.items : data.item ? [data.item] : []);
  return <details className="context-evidence-query">
    <summary>{queries[message.toolName!]}{source ? ` · ${source === 'axon' ? 'Axon 任务' : source}` : ''}{items ? ` · ${items.length} 条记录` : ''}</summary>
    <EvidenceMapLinks messages={[message]} onOpenMap={onOpenMap}/><p className="resource-help">查询时间：{queriedAt ? informationTime(queriedAt) : '未提供'}</p>
    {items && <ul className="context-evidence-records">{items.map((item, index) => <li key={index}>{description(item)}</li>)}</ul>}
    {data?.hasMore === true && <p className="resource-help">本次仅返回一页，仍有后续记录。</p>}
    {Array.isArray(data?.unknownRefs) && data.unknownRefs.length > 0 && <p className="resource-help">未找到的对象：{data.unknownRefs.map(reference).join('；')}</p>}
    {typeof data?.timeUnknownCount === 'number' && data.timeUnknownCount > 0 && <p className="resource-help">另有 {data.timeUnknownCount} 条记录的业务时间未知。</p>}
    <details><summary>实际查询条件与返回内容</summary><pre>{envelope ? JSON.stringify(envelope, null, 2) : message.text}</pre></details>
  </details>;
}
function SpatialEvidence({ message, onOpenMap }: { message: PublicMessage; onOpenMap?: () => void }) {
  const result = spatialMapEntries([message])[0];
  if (!result) return null;
  return <details className="context-evidence-query">
    <summary>{analysisLabels[result.operation]} · {analysisValue(result)}</summary>
    <p className="resource-help">固定空间依据 · 计算于 {informationTime(result.createdAt)}。打开地图显示当时的对象，不重新查询当前位置。</p>
    <EvidenceMapLinks messages={[message]} onOpenMap={onOpenMap} />
    <p>已读取候选 {result.completeness.candidateCount} 个，结果 {result.items.length} 个；空间关系需结合任务时间和业务限制判断影响。</p>
    <ul className="context-evidence-records">{result.provenance.map((entry, index) => <li key={index}><span>读取于 {informationTime(entry.queriedAt)} · 来源时间 {informationTime(entry.asOf)}</span>{entry.sourceRefs?.map(ref => <span key={JSON.stringify([ref.systemId, ref.objectType, ref.objectId])}>{ref.systemId} / {ref.objectType} / {ref.objectId} · 版本 {ref.revision}</span>)}</li>)}</ul>
    <p>{result.method}</p>{result.limitations.map((item, index) => <p className="resource-help" key={index}>{item}</p>)}
  </details>;
}
function TaskDiscoveryEvidence({ message, onOpenMap }: { message: PublicMessage; onOpenMap?: () => void }) {
  const discovery = taskDiscoveryEntry(message);
  if (!discovery) return null;
  const labels = { related: '关联候选', unrelated: '已核验无关联', uncertain: '关联待核实' };
  return <details className="context-evidence-query">
    <summary>任务关联核对 · {discovery.tasks.length} 个任务</summary>
    <p className="resource-help">核对时间：{informationTime(discovery.queriedAt)}。候选关系供本轮研判使用，实际影响需结合执行时间与业务限制。</p>
    <EvidenceMapLinks messages={[message]} onOpenMap={onOpenMap} />
    {!!discovery.spatialResults.length && <p className="resource-help">地图入口显示本轮固定对象与空间计算结果。</p>}
    <ul className="context-evidence-records">{discovery.tasks.map(item => <li key={item.task.id}><strong>{item.task.title} · {labels[item.candidate]}</strong><span>任务版本 {item.task.revision} · {item.reason}</span></li>)}</ul>
    {discovery.inputs.filter(input => !input.resolved).map(input => <p className="resource-help" key={input.inputId}>来源对象待核实：{input.reason}</p>)}
    {!!discovery.sourceQueries?.length && <details><summary>来源查询快照 · {discovery.sourceQueries.length} 次读取</summary><p className="resource-help">关联核对时读取并保存的来源资料，保留当时的版本与正文。</p>{discovery.sourceQueries.map((query, index) => { const data = record(query.data); const items = Array.isArray(data?.items) ? data.items : data?.item ? [data.item] : []; return <details className="context-evidence-query" key={index}><summary>{query.systemId} · 读取于 {informationTime(query.queriedAt)}</summary><p className="resource-help">来源时间：{scalar(data?.asOf) ? informationTime(scalar(data?.asOf)) : '未提供'}</p><ul className="context-evidence-records">{items.map((item, itemIndex) => <li key={itemIndex}>{description(item)}</li>)}</ul><details><summary>实际查询条件与返回内容</summary><pre>{JSON.stringify(query, null, 2)}</pre></details></details>; })}</details>}
  </details>;
}
/** Read the authorized, current-job tool projection, never infer evidence from final prose. */
export function ContextEvidence({ messages, onOpenMap }: { messages?: PublicMessage[]; onOpenMap?: () => void }) {
  const evidence = messages?.filter(isContextEvidence) || [];
  if (!evidence.length) return null;
  return <details className="context-evidence"><summary>查询依据 · {evidence.length} 次查询</summary>{evidence.map(message => message.toolName === 'analysis_task_candidates' ? <TaskDiscoveryEvidence key={`${message.requestId || ''}:${message.toolCallId || message.id}`} message={message} onOpenMap={onOpenMap}/> : message.toolName === 'spatial_analyze' ? <SpatialEvidence key={`${message.requestId || ''}:${message.toolCallId || message.id}`} message={message} onOpenMap={onOpenMap}/> : <QueryEvidence key={`${message.requestId || ''}:${message.toolCallId || message.id}`} message={message} onOpenMap={onOpenMap}/>)}</details>;
}
