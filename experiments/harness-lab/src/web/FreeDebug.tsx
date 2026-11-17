import { useRef, useState } from 'react';
import type { DebugState } from '../contracts/director';
import type { InformationReport, RoadProperties, SituationObject } from '../contracts/context';
import type { ScenarioAction, ScenarioMutationResult } from '../contracts/scenarios';
import type { SimulationObjectUpdate, SimulationReportUpdate } from '../contracts/simulation';
import { ApiFailure, useApi } from './api';
import { useInformationQuery } from './information-ui';
import { LoadingIndicator } from './LoadingIndicator';
import { randomUUID } from './random-uuid';
import { refKey } from './situation/evidence';
import { objectStatus } from './situation/map-data';

const localTime = (value?: string | null) => { if (!value) return ''; const d = new Date(value); if (!Number.isFinite(d.getTime())) return ''; return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19); };
const timestamp = (value: string) => { if (!value) return null; const d = new Date(value); if (!Number.isFinite(d.getTime())) throw Error('请输入有效时间。'); return d.toISOString(); };

function DebugEditor({state: initialState, object: initialObject, report: initialReport, saved}: {state: DebugState; object?: SituationObject; report?: InformationReport; saved: () => void}) {
  const {api} = useApi();
  const [state] = useState(initialState); const [object] = useState(initialObject); const [report] = useState(initialReport);
  const [count, setCount] = useState(String(object && 'availableCount' in object.properties ? object.properties.availableCount : 0));
  const [passability, setPassability] = useState<RoadProperties['passability']>(object && 'passability' in object.properties ? object.properties.passability as RoadProperties['passability'] : 'unknown');
  const [note, setNote] = useState(String(object && 'restrictionNote' in object.properties ? object.properties.restrictionNote || '' : ''));
  const [title, setTitle] = useState(report?.title || ''); const [summary, setSummary] = useState(report?.summary || ''); const [content, setContent] = useState(report?.content || '');
  const [refs, setRefs] = useState(report?.objectRefs || []); const [areas, setAreas] = useState(report?.areaIds || []);
  const [effective, setEffective] = useState(localTime(object?.effectiveAt || report?.observedAt));
  const [published, setPublished] = useState(localTime(report?.publishedAt));
  const [from, setFrom] = useState(localTime(object?.validTime?.from || report?.validTime?.from));
  const [to, setTo] = useState(localTime(object?.validTime?.to || report?.validTime?.to));
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [pending, setPending] = useState<(SimulationObjectUpdate | SimulationReportUpdate) & {expectedRunRevision: number}>();
  const [retryable, setRetryable] = useState(false); const [complete, setComplete] = useState(false);
  const regionOptions = [...new Set([...state.objects.flatMap(item => item.areaIds), ...areas])];
  function body() {
    const validTime = from || to ? {from: timestamp(from), to: timestamp(to)} : null;
    const shared = {clientActionId: randomUUID(), expectedRunRevision: state.instance.revision, validTime};
    if (object) {
      const effectiveAt = timestamp(effective); if (!effectiveAt) throw Error('请填写生效时间。');
      const availableCount = Number(count); if (object.ref.objectType === 'resource' && (!Number.isSafeInteger(availableCount) || availableCount < 0)) throw Error('车辆数量须为非负整数。');
      return {...shared, ref: object.ref, expectedRevision: object.revision, effectiveAt, properties: object.ref.objectType === 'resource' ? {availableCount, unit: '辆' as const} : {passability, ...(note ? {restrictionNote: note} : {})}};
    }
    if (!report) throw Error('请选择对象或报告。');
    return {clientActionId: shared.clientActionId, expectedRunRevision: shared.expectedRunRevision, reportId: report.reportId, expectedRevision: report.revision,
      report: {subjectId: report.subjectId, title, summary, content, objectRefs: refs, areaIds: areas, observedAt: timestamp(effective), publishedAt: timestamp(published), validTime}};
  }
  async function save() {
    if (busyRef.current || complete || pending && !retryable) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const payload = pending || body(); setPending(payload); setRetryable(false);
      await api<ScenarioMutationResult>(`/api/simulation/instances/${encodeURIComponent(state.instance.instanceId)}/debug/${object ? 'object-updates' : 'report-updates'}`, payload);
      setPending(undefined); setComplete(true); saved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存结果待核对。');
      if (reason instanceof ApiFailure && [400, 403, 404, 409].includes(reason.status)) { setPending(undefined); saved(); }
    } finally { busyRef.current = false; setBusy(false); }
  }
  async function reconcile() {
    if (!pending || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await api(`/api/simulation/actions/${encodeURIComponent(pending.clientActionId)}`); setPending(undefined); setComplete(true); saved(); }
    catch (reason) { if (reason instanceof ApiFailure && reason.status === 404) { setRetryable(true); setError('未找到保存回执，可重试原请求。'); } else setError(reason instanceof Error ? reason.message : '核对失败。'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <form className="simulation-editor" onSubmit={event => {event.preventDefault(); void save();}}><h2>{object?.name || report?.title}</h2>
    <fieldset disabled={busy || Boolean(pending) || complete || initialState.instance.status !== 'active'}>
      {object?.ref.objectType === 'resource' && <label>可用车辆数量<input type="number" min="0" step="1" value={count} onChange={e => setCount(e.target.value)}/></label>}
      {object?.ref.objectType === 'road' && <><label>道路状态<select value={passability} onChange={e => setPassability(e.target.value as RoadProperties['passability'])}><option value="open">可通行</option><option value="restricted">限制通行</option><option value="closed">封闭</option><option value="unknown">未知</option></select></label><label>限制说明<textarea value={note} onChange={e => setNote(e.target.value)}/></label></>}
      {report && <><label>标题<input value={title} onChange={e => setTitle(e.target.value)}/></label><label>摘要<textarea value={summary} onChange={e => setSummary(e.target.value)}/></label><label>报告正文<textarea rows={7} value={content} onChange={e => setContent(e.target.value)}/></label>
        <fieldset className="debug-reference-options"><legend>关联对象</legend>{state.objects.map(item => <label key={refKey(item.ref)}><input type="checkbox" checked={refs.some(ref => refKey(ref) === refKey(item.ref))} onChange={e => setRefs(current => e.target.checked ? [...current, item.ref] : current.filter(ref => refKey(ref) !== refKey(item.ref)))}/>{item.name}</label>)}</fieldset>
        <fieldset className="debug-reference-options"><legend>关联区域</legend>{regionOptions.map(area => <label key={area}><input type="checkbox" checked={areas.includes(area)} onChange={e => setAreas(current => e.target.checked ? [...current, area] : current.filter(value => value !== area))}/>{state.objects.find(item => item.ref.objectType === 'area' && item.ref.objectId === area)?.name || area}</label>)}</fieldset>
        <label>发布时间<input type="datetime-local" step="1" value={published} onChange={e => setPublished(e.target.value)}/></label></>}
      <label>{report ? '观测时间' : '生效时间'}<input type="datetime-local" step="1" value={effective} onChange={e => setEffective(e.target.value)}/></label>
      <div className="debug-time-range"><label>有效时间开始<input type="datetime-local" step="1" value={from} onChange={e => setFrom(e.target.value)}/></label><label>有效时间结束<input type="datetime-local" step="1" value={to} onChange={e => setTo(e.target.value)}/></label></div>
    </fieldset>
    {error && <p role="alert" className="director-warning">{error}</p>}{complete && <p role="status">修改已保存，尚未发送通知。可重新选择条目继续编辑。</p>}
    <button className="primary-action" disabled={busy || complete || Boolean(pending && !retryable) || initialState.instance.status !== 'active'}>{busy ? '保存中…' : pending ? '重试原保存请求' : '保存修改'}</button>
    {pending && <button type="button" disabled={busy} onClick={() => void reconcile()}>核对保存结果</button>}
  </form>;
}

function DebugNotification({action, state, refresh}: {action: ScenarioAction; state: DebugState; refresh: () => void}) {
  const {api} = useApi(); const [busy, setBusy] = useState(false); const busyRef = useRef(false); const [error, setError] = useState(''); const [uncertain, setUncertain] = useState(action.sendState === 'unconfirmed');
  async function execute(send: boolean) {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError('');
    try {
      await api(`/api/simulation/actions/${encodeURIComponent(action.id)}${send ? '/send' : ''}`, send ? {instanceId: state.instance.instanceId, expectedRevision: state.instance.revision} : undefined);
      setUncertain(false); refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '通知结果待核对。'); if (send) setUncertain(true); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <li><div className="director-notification-heading"><strong>{action.notification.title}</strong><span>{({unsent: '尚未发送', accepted: '接收已确认', unconfirmed: '接收待核对'} as const)[action.sendState]}</span></div>
    <details><summary>预览通知</summary><p>{action.notification.text}</p></details>
    {action.receipt ? <a href={`/overview?tab=events&id=${encodeURIComponent(action.receipt.eventId)}`} target="_blank" rel="noreferrer">查看接收与处理记录</a> : <div className="director-buttons"><button disabled={busy} onClick={() => void execute(false)}>核对接收回执</button><button disabled={busy || uncertain || state.instance.status !== 'active'} onClick={() => void execute(true)}>{action.sendState === 'unsent' ? '发送测试通知' : '重送同一通知'}</button></div>}
    {error && <p role="alert" className="director-warning">{error}</p>}
  </li>;
}

export function FreeDebug({instanceId, changed}: {instanceId: string; changed: () => void}) {
  const query = useInformationQuery<DebugState>(`/api/simulation/instances/${encodeURIComponent(instanceId)}/debug`, true, 5000);
  const [selected, setSelected] = useState(''); const [edition, setEdition] = useState(0);
  const object = query.data?.objects.find(item => refKey(item.ref) === selected); const report = query.data?.reports.find(item => `report:${item.reportId}` === selected);
  function refresh() { query.refresh(); changed(); }
  return <section className="director-debug" aria-label="自由调试"><div className="director-section-heading"><h2>自由调试</h2><button onClick={refresh}>刷新数据</button></div>
    {query.error && <p className="director-warning" role="alert">{query.error}</p>}{!query.data && !query.error && <LoadingIndicator label="正在读取调试数据…"/>}
    {query.data && <><p className="director-scene-meta">{query.data.instance.name}<span>{query.data.instance.status === 'active' ? '当前轮次' : '历史轮次 · 只读'}</span></p><div className="simulation-grid"><nav aria-label="调试对象"><h3>态势对象</h3>{query.data.objects.filter(item => ['road', 'resource'].includes(item.ref.objectType)).map(item => <button key={refKey(item.ref)} aria-pressed={selected === refKey(item.ref)} onClick={() => {setSelected(refKey(item.ref)); setEdition(v => v + 1);}}><strong>{item.name}</strong><span>{objectStatus(item)}</span></button>)}<h3>情报</h3>{query.data.reports.map(item => <button key={item.reportId} aria-pressed={selected === `report:${item.reportId}`} onClick={() => {setSelected(`report:${item.reportId}`); setEdition(v => v + 1);}}>{item.title}</button>)}</nav>
      {object || report ? <DebugEditor key={`${selected}:${edition}`} state={query.data} object={object} report={report} saved={refresh}/> : <div className="director-empty">选择对象或情报进行编辑</div>}
    </div><section className="director-card"><h2>修改与通知记录</h2>{query.data.actions.length ? <ul className="director-notifications">{query.data.actions.map(action => <DebugNotification key={action.id} action={action} state={query.data!} refresh={refresh}/>)}</ul> : <p className="director-scope">暂无修改记录</p>}</section></>}
  </section>;
}
