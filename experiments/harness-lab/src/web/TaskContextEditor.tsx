import { useEffect, useRef, useState } from 'react';
import type { TaskContext } from '../contracts/access';
import type { ContextCatalog } from '../contracts/context';
import { useApi } from './api';

export type ContextDraft = {
  refs: Array<{ systemId: string; objectType: string; objectId: string; label: string }>;
  areas: string; topics: string; from: string; to: string;
};
export function contextDraft(context?: TaskContext): ContextDraft {
  return { refs: (context?.businessRefs || []).map(ref => ({ ...ref, label: ref.label || '' })), areas: context?.focus?.areaIds?.join('\n') || '', topics: context?.focus?.topics?.join('\n') || '', from: context?.focus?.time?.from || '', to: context?.focus?.time?.to || '' };
}
const lines = (value: string) => [...new Set(value.split('\n').map(item => item.trim()).filter(Boolean))];
export function validateContext(draft: ContextDraft): { context: TaskContext | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const refs = draft.refs.map(ref => Object.fromEntries(Object.entries(ref).map(([key, value]) => [key, value.trim()])) as ContextDraft['refs'][number]);
  refs.forEach((ref, index) => {
    if (!Object.values(ref).some(Boolean)) return;
    for (const key of ['systemId', 'objectType', 'objectId'] as const) if (!ref[key]) errors[`context-${key}-${index}`] = '请填写完整的系统、对象类型和对象编号。';
  });
  const areas = lines(draft.areas); const topics = lines(draft.topics);
  if (areas.length > 10 || areas.some(value => value.length > 128)) errors['context-areas'] = '最多填写 10 个区域，每个编码不超过 128 个字符。';
  if (topics.length > 10 || topics.some(value => value.length > 200)) errors['context-topics'] = '最多填写 10 个主题，每项不超过 200 个字符。';
  const time: { from?: string; to?: string } = {};
  for (const key of ['from', 'to'] as const) {
    const value = draft[key].trim();
    if (!value) continue;
    const valid = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/i.test(value)
      && Number(value.slice(11, 13)) < 24 && Number.isFinite(Date.parse(value))
      && new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === value.slice(0, 10);
    if (!valid) errors[`context-${key}`] = '请填写有效且含时区的完整时间，例如 2026-10-01T09:00:00+08:00。';
    else time[key] = value;
  }
  if (time.from && time.to && Date.parse(time.from) >= Date.parse(time.to)) errors['context-to'] = '结束时间必须晚于开始时间。';
  const businessRefs = refs.filter(ref => Object.values(ref).some(Boolean)).map(({ label, ...ref }) => ({ ...ref, ...(label ? { label } : {}) }));
  const focus = { ...(areas.length ? { areaIds: areas } : {}), ...(topics.length ? { topics } : {}), ...(Object.keys(time).length ? { time } : {}) };
  const context = { ...(businessRefs.length ? { businessRefs } : {}), ...(Object.keys(focus).length ? { focus } : {}) };
  return { context: Object.keys(context).length ? context : null, errors };
}

export function useContextCatalog(enabled = true) {
  const { api } = useApi(); const [data, setData] = useState<ContextCatalog>(); const [error, setError] = useState(''); const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void api<ContextCatalog>('/api/context/catalog').then(result => { if (current) { setData(result); setError(''); } }).catch(() => { if (current) setError('业务系统列表暂不可用，已填写的内容仍保留。'); });
    return () => { current = false; };
  }, [api, enabled, revision]);
  return { data, error, refresh: () => setRevision(value => value + 1) };
}

export function TaskContextEditor({ draft, change, disabled, errors }: { draft: ContextDraft; change: (value: ContextDraft) => void; disabled: boolean; errors: Record<string, string> }) {
  const catalog = useContextCatalog(); const details = useRef<HTMLDetailsElement>(null); const feedback = useRef<HTMLDivElement>(null);
  const populated = draft.refs.length || draft.areas || draft.topics || draft.from || draft.to;
  const [expanded, setExpanded] = useState(Boolean(populated));
  useEffect(() => { if (Object.keys(errors).length) { if (details.current) details.current.open = true; feedback.current?.focus(); } }, [errors]);
  const systems = catalog.data?.systems || [];
  const areas = [...new Map(systems.flatMap(system => system.areas).map(area => [area.id, area])).values()];
  function setRef(index: number, patch: Partial<ContextDraft['refs'][number]>) { change({ ...draft, refs: draft.refs.map((ref, i) => index === i ? { ...ref, ...patch } : ref) }); }
  const fieldError = (id: string) => errors[id] ? <small id={`${id}-error`} className="resource-error">{errors[id]}</small> : null;
  return <details ref={details} className="task-context-editor" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>业务关联与关注范围（可选）<span>{populated ? '已填写关注条件' : '未设置，普通任务可留空'}</span></summary>
    <p className="resource-help">用于查找相关业务资料，不改变文件与会话权限。保存引用不会核验远端对象是否存在。</p>
    {catalog.error && <p className="resource-help" role="status">{catalog.error}<button type="button" onClick={catalog.refresh}>重试读取目录</button></p>}
    {Object.keys(errors).length > 0 && <div className="resource-error" role="alert" tabIndex={-1} ref={feedback}>请检查以下字段：<ul>{Object.entries(errors).map(([id, message]) => <li key={id}><a href={`#${id}`}>{message}</a></li>)}</ul></div>}
    <fieldset disabled={disabled}>
      <legend>业务对象引用</legend>
      {draft.refs.map((ref, index) => {
        const system = systems.find(item => item.id === ref.systemId);
        return <div className="task-context-reference" key={index}>
          <label htmlFor={`context-systemId-${index}`}>外部系统<select id={`context-systemId-${index}`} aria-label="外部系统" aria-describedby={errors[`context-systemId-${index}`] ? `context-systemId-${index}-error` : undefined} value={ref.systemId} aria-invalid={Boolean(errors[`context-systemId-${index}`])} onChange={event => setRef(index, { systemId: event.target.value, objectType: '' })}><option value="">选择系统</option>{!system && ref.systemId && <option value={ref.systemId}>{ref.systemId}（当前目录不可用）</option>}{systems.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{fieldError(`context-systemId-${index}`)}</label>
          <label htmlFor={`context-objectType-${index}`}>对象类型<select id={`context-objectType-${index}`} aria-label="对象类型" aria-describedby={errors[`context-objectType-${index}`] ? `context-objectType-${index}-error` : undefined} value={ref.objectType} aria-invalid={Boolean(errors[`context-objectType-${index}`])} onChange={event => setRef(index, { objectType: event.target.value })}><option value="">选择类型</option>{ref.objectType && !system?.objectTypes.includes(ref.objectType) && <option value={ref.objectType}>{ref.objectType}（当前目录不可用）</option>}{system?.objectTypes.map(type => <option key={type} value={type}>{type}</option>)}</select>{fieldError(`context-objectType-${index}`)}</label>
          <label htmlFor={`context-objectId-${index}`}>对象编号<input id={`context-objectId-${index}`} aria-label="对象编号" aria-describedby={errors[`context-objectId-${index}`] ? `context-objectId-${index}-error` : undefined} value={ref.objectId} maxLength={128} aria-invalid={Boolean(errors[`context-objectId-${index}`])} onChange={event => setRef(index, { objectId: event.target.value })}/>{fieldError(`context-objectId-${index}`)}</label>
          <label>显示名称（可选）<input value={ref.label} maxLength={200} onChange={event => setRef(index, { label: event.target.value })}/></label>
          <button type="button" aria-label={`移除第 ${index + 1} 项业务引用`} onClick={() => change({ ...draft, refs: draft.refs.filter((_, i) => i !== index) })}>移除</button>
        </div>;
      })}
      {!draft.refs.length && <p className="resource-help">尚无业务对象引用。</p>}
      {!disabled && <button type="button" disabled={draft.refs.length >= 20 || !systems.length} onClick={() => change({ ...draft, refs: [...draft.refs, { systemId: '', objectType: '', objectId: '', label: '' }] })}>添加业务引用</button>}
      <div className="task-context-fields">
        <label htmlFor="context-areas">关注区域编码<textarea id="context-areas" rows={2} value={draft.areas} aria-invalid={Boolean(errors['context-areas'])} onChange={event => change({ ...draft, areas: event.target.value })}/><small>每行一个编码，最多 10 个。{areas.map(area => `${area.name}：${area.id}`).join('；')}</small>{fieldError('context-areas')}</label>
        <label htmlFor="context-topics">关注主题<textarea id="context-topics" rows={2} value={draft.topics} aria-invalid={Boolean(errors['context-topics'])} onChange={event => change({ ...draft, topics: event.target.value })}/><small>每行一个主题，最多 10 项。</small>{fieldError('context-topics')}</label>
        <label htmlFor="context-from">开始时间（含时区）<input id="context-from" value={draft.from} placeholder="2026-10-01T09:00:00+08:00" maxLength={64} aria-invalid={Boolean(errors['context-from'])} onChange={event => change({ ...draft, from: event.target.value })}/>{fieldError('context-from')}</label>
        <label htmlFor="context-to">结束时间（含时区）<input id="context-to" value={draft.to} placeholder="2026-10-01T11:00:00+08:00" maxLength={64} aria-invalid={Boolean(errors['context-to'])} onChange={event => change({ ...draft, to: event.target.value })}/>{fieldError('context-to')}</label>
      </div>
      <p className="resource-help">时间可以只填一端。使用原文时区；范围包含开始时刻，不包含结束时刻。</p>
    </fieldset>
  </details>;
}

export function TaskContextSummary({ context }: { context?: TaskContext }) {
  return <div className="task-context-summary"><strong>业务关联与关注范围</strong>{!context ? <p>未设置</p> : <>
    {context.businessRefs?.map(ref => <p key={JSON.stringify([ref.systemId, ref.objectType, ref.objectId])}>{ref.label && `${ref.label} · `}{ref.systemId} / {ref.objectType} / {ref.objectId}</p>)}
    {context.focus?.areaIds?.length ? <p>区域：{context.focus.areaIds.join('、')}</p> : null}
    {context.focus?.time && <p>时间：{context.focus.time.from || '未限定开始'} ～ {context.focus.time.to || '未限定结束'}</p>}
    {context.focus?.topics?.length ? <p>主题：{context.focus.topics.join('、')}</p> : null}
  </>}</div>;
}
