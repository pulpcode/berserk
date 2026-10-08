import type { PublicMessage } from '../contracts';
import { informationTime } from './information-ui';

const queries: Record<string, string> = { information_search: '报告检索', information_read: '报告正文', situation_query: '态势查询', task_search: '任务检索', task_read: '任务详情' };
export function isContextEvidence(message: PublicMessage) { return message.role === 'tool' && Boolean(message.toolName && Object.hasOwn(queries, message.toolName)) && !message.isError && !message.resultMissing; }
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
function QueryEvidence({ message }: { message: PublicMessage }) {
  let envelope: Record<string, unknown> | undefined;
  try { envelope = record(JSON.parse(message.text)); } catch { /* Older tool text remains readable without fabricated metadata. */ }
  const data = record(envelope?.data); const source = scalar(envelope?.systemId); const queriedAt = scalar(envelope?.queriedAt);
  const items = data && (Array.isArray(data.items) ? data.items : data.item ? [data.item] : []);
  return <details className="context-evidence-query">
    <summary>{queries[message.toolName!]}{source ? ` · ${source === 'axon' ? 'Axon 任务' : source}` : ''}{items ? ` · ${items.length} 条记录` : ''}</summary>
    <p className="resource-help">查询时间：{queriedAt ? informationTime(queriedAt) : '未提供'}</p>
    {items && <ul className="context-evidence-records">{items.map((item, index) => <li key={index}>{description(item)}</li>)}</ul>}
    {data?.hasMore === true && <p className="resource-help">本次仅返回一页，仍有后续记录。</p>}
    {Array.isArray(data?.unknownRefs) && data.unknownRefs.length > 0 && <p className="resource-help">未找到的对象：{data.unknownRefs.map(reference).join('；')}</p>}
    {typeof data?.timeUnknownCount === 'number' && data.timeUnknownCount > 0 && <p className="resource-help">另有 {data.timeUnknownCount} 条记录的业务时间未知。</p>}
    <details><summary>实际查询条件与返回内容</summary><pre>{envelope ? JSON.stringify(envelope, null, 2) : message.text}</pre></details>
  </details>;
}
/** Read the authorized, current-job tool projection, never infer evidence from final prose. */
export function ContextEvidence({ messages }: { messages?: PublicMessage[] }) {
  const evidence = messages?.filter(isContextEvidence) || [];
  if (!evidence.length) return null;
  return <details className="context-evidence"><summary>查询依据 · {evidence.length} 次查询</summary>{evidence.map(message => <QueryEvidence key={`${message.requestId || ''}:${message.toolCallId || message.id}`} message={message}/>)}</details>;
}
