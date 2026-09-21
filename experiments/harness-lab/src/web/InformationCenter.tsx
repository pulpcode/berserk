import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RefreshCw, Workflow } from 'lucide-react';
import type { TaskSpace } from '../contracts/access';
import type { BackgroundEventDetail, BackgroundEventSummary, BackgroundPage, InformationCapabilities, InformationJobDetail, InformationJobSummary } from '../contracts/background';
import { useApi } from './api';
import { InformationRules } from './InformationRules';
import { Message } from './ChatMessage';
import type { ChatFocusTransfer } from './useChatItemFocus';
import { AnalysisHistory, deliveryLabels, InformationFiles, InformationPagination, InformationText, informationError, informationTime, jobLabels, useInformationQuery } from './information-ui';

type Tab = 'events' | 'jobs' | 'rules';
type Location = { tab: Tab; id: string; sourceId: string; status: string; search: string; offset: number };
function initialLocation(): Location {
  const params = new URLSearchParams(location.pathname === '/information' ? location.search : '');
  const tab = params.get('tab');
  return { tab: tab === 'jobs' || tab === 'rules' ? tab : 'events', id: params.get('id') || '', sourceId: params.get('sourceId') || '', status: params.get('status') || '', search: params.get('search') || '', offset: Math.max(0, Number(params.get('offset')) || 0) };
}
export function InformationCenter({ visible, capabilities, refreshAccess, tasks, back, openSession }: { visible: boolean; capabilities?: InformationCapabilities; refreshAccess: () => void; tasks: TaskSpace[]; back: () => void; openSession: (id: string) => void }) {
  const { api, domId } = useApi(); const [route, setRoute] = useState(initialLocation); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const lock = useRef(false); const actionIds = useRef(new Map<string, string>()); const [focusTransfers] = useState<ChatFocusTransfer>(() => new Map());
  const allowed = Boolean(capabilities?.sources.length);
  const query = new URLSearchParams({ offset: String(route.offset), limit: '25', ...(route.sourceId ? { sourceId: route.sourceId } : {}), ...(route.status ? { status: route.status } : {}), ...(route.search ? { search: route.search } : {}) });
  const events = useInformationQuery<BackgroundPage<BackgroundEventSummary>>(`/api/information/events?${query}`, visible && allowed && route.tab === 'events');
  const jobs = useInformationQuery<BackgroundPage<InformationJobSummary>>(`/api/information/jobs?${query}`, visible && allowed && route.tab === 'jobs');
  const event = useInformationQuery<BackgroundEventDetail>(route.id && route.tab === 'events' ? `/api/information/events/${encodeURIComponent(route.id)}` : undefined, visible && allowed);
  const job = useInformationQuery<InformationJobDetail>(route.id && route.tab === 'jobs' ? `/api/information/jobs/${encodeURIComponent(route.id)}` : undefined, visible && allowed);
  function refresh() { events.refresh(); jobs.refresh(); event.refresh(); job.refresh(); refreshAccess(); }
  function navigate(value: Partial<Location>, replace = false) {
    const next = { ...route, ...value }; setRoute(next); setError(''); setNotice('');
    const search = new URLSearchParams(Object.entries(next).filter(([, value]) => value !== '' && value !== 0).map(([key, value]) => [key, String(value)]));
    history[replace ? 'replaceState' : 'pushState'](null, '', `/information?${search}`);
  }
  useEffect(() => {
    if (!visible) return;
    const params = new URLSearchParams(Object.entries(route).filter(([, value]) => value !== '' && value !== 0).map(([key, value]) => [key, String(value)]));
    history.replaceState(null, '', `/information?${params}`);
    const pop = () => { if (location.pathname === '/information') setRoute(initialLocation()); };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, [visible, route]);
  async function mutate(path: string, body: object, method: 'POST' | 'PUT' = 'POST', dedup = false) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    const clientActionId = actionIds.current.get(path) || crypto.randomUUID(); if (dedup) actionIds.current.set(path, clientActionId);
    try { await api(path, dedup ? { ...body, clientActionId } : body, method); actionIds.current.delete(path); setNotice('操作已完成，已刷新当前记录。'); refresh(); }
    catch (reason) { setError(`${informationError(reason)} 请核对当前状态后重试。`); refresh(); }
    finally { lock.current = false; setBusy(false); }
  }
  const canManage = (sourceId: string) => capabilities?.sources.some(source => source.sourceId === sourceId && source.permission === 'manage');
  const sourceName = (sourceId: string) => capabilities?.sources.find(source => source.sourceId === sourceId)?.name || sourceId;
  const seatName = (seatId: string) => capabilities?.seats.find(seat => seat.id === seatId)?.name || seatId;
  const source = capabilities?.sources.find(source => source.sourceId === route.sourceId);
  const shownEvent = event.data; const shownJob = job.data;
  const detailError = route.tab === 'events' ? event.error : job.error;
  return <section id={domId('information-center')} tabIndex={-1} className="information-center" hidden={!visible} aria-label="信息处理中心">
    <header className="information-center-header"><div><Workflow size={24} aria-hidden="true" /><h1>信息处理中心</h1></div><button onClick={back}><ArrowLeft size={16} aria-hidden="true" />返回工作台</button></header>
    {!capabilities ? <p className="information-empty" role="status">正在核对访问权限…</p> : !allowed ? <div className="information-empty"><h2>没有信息处理中心的访问权限</h2><p>请在工作台查看投递给本席位的信息。</p><button onClick={back}>返回工作台</button></div> : <>
      <nav className="information-tabs" aria-label="信息中心栏目">{([['events', '信息记录'], ['jobs', '后台作业'], ['rules', '处理与投递规则']] as const).map(([id, label]) => <button key={id} aria-current={route.tab === id ? 'page' : undefined} onClick={() => navigate({ tab: id, id: '', offset: 0, status: '' })}>{label}</button>)}</nav>
      <div className="information-center-body">
        {capabilities.queue.blockedReason && <p className="information-queue-notice" role="status">{capabilities.queue.blockedReason}</p>}
        {route.tab !== 'rules' && <><div className="information-toolbar"><label>来源<select value={route.sourceId} onChange={e => navigate({ sourceId: e.target.value, offset: 0, id: '' }, true)}><option value="">全部获准来源</option>{capabilities.sources.map(item => <option key={item.sourceId} value={item.sourceId}>{item.name}</option>)}</select></label><label>处理状态<select value={route.status} onChange={e => navigate({ status: e.target.value, offset: 0, id: '' }, true)}><option value="">全部状态</option>{route.tab === 'events' && <option value="unmatched">未匹配规则</option>}{(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'] as const).map(id => <option key={id} value={id}>{jobLabels[id]}</option>)}</select></label><label className="information-search">搜索<input type="search" value={route.search} placeholder="标题或消息标识" onChange={e => navigate({ search: e.target.value, offset: 0, id: '' }, true)} /></label><button onClick={refresh}><RefreshCw size={16} aria-hidden="true" />刷新记录</button></div>
        <div className="information-controls">{source ? <><span>{source.name} · {source.accepting ? '接收中' : '已停止接收'} · {source.permission === 'manage' ? '可管理' : '只读'}</span>{source.permission === 'manage' && <button disabled={busy} onClick={() => void mutate(`/api/information/sources/${encodeURIComponent(source.sourceId)}`, { accepting: !source.accepting, revision: source.revision }, 'PUT')}>{source.accepting ? '停止此来源接收' : '恢复此来源接收'}</button>}</> : <span>仅展示当前获准来源。其他席位的分析只显示办理状态。</span>}{capabilities.canManageQueue && <button disabled={busy} onClick={() => void mutate('/api/information/queue', { enabled: !capabilities.queue.enabled, revision: capabilities.queue.revision }, 'PUT')}>{capabilities.queue.enabled ? '暂停领取后台作业' : '恢复领取后台作业'}</button>}</div>
        {(error || events.error || jobs.error || detailError) && <p className="resource-error" role="alert">{error || (route.tab === 'events' ? events.error : jobs.error) || detailError}</p>}{notice && <p className="resource-success" role="status">{notice}</p>}
        <div className={`information-records${route.id ? ' with-detail' : ''}`}>
          <div className="information-record-list"><div className="information-table-scroll"><table className="information-table"><thead><tr><th scope="col">{route.tab === 'events' ? '信息' : '作业'}</th><th scope="col">来源</th><th scope="col">时间</th><th scope="col">处理状态</th><th scope="col">{route.tab === 'events' ? '投递情况' : '类型'}</th></tr></thead><tbody>
            {route.tab === 'events' ? events.data?.items.map(item => <tr key={item.id} className={route.id === item.id ? 'selected' : ''}><td><button className="information-row-link" onClick={() => navigate({ id: item.id })}>{item.title}</button><small>{item.sourceMessageId}</small></td><td>{sourceName(item.sourceId)}</td><td>{informationTime(item.receivedAt)}</td><td><Status status={item.jobs[0]?.status} /></td><td>{!item.deliveries.length ? '—' : item.deliveries.map(delivery => <span className="delivery-line" key={delivery.id}>{seatName(delivery.recipientSeatId)} · {deliveryLabels[delivery.status]}</span>)}</td></tr>) : jobs.data?.items.map(item => <tr key={item.id} className={route.id === item.id ? 'selected' : ''}><td><button className="information-row-link" onClick={() => navigate({ id: item.id })}>{item.kind === 'preprocess' ? '自动预处理' : `${item.seatId ? seatName(item.seatId) : '席位'}分析`}</button><small>{item.id.slice(0, 8)}</small></td><td>{sourceName(item.sourceId)}</td><td>{informationTime(item.createdAt)}</td><td><Status status={item.status} /></td><td>{item.kind === 'preprocess' ? '自动预处理' : '人员提交分析'}</td></tr>)}
          </tbody></table></div>{(route.tab === 'events' ? events.data : jobs.data)?.items.length === 0 && <p className="information-empty">没有符合条件的记录。</p>}<InformationPagination page={route.tab === 'events' ? events.data : jobs.data} change={offset => navigate({ offset, id: '' })} /></div>
          {route.id && <aside className="information-detail information-record-detail" aria-label={route.tab === 'events' ? '信息详情' : '后台作业详情'}><button className="information-back" onClick={() => navigate({ id: '' })}><ArrowLeft size={15} aria-hidden="true" />返回记录</button>
            {route.tab === 'events' ? !shownEvent ? <p role="status">正在读取信息…</p> : <>
              <header><h2>{shownEvent.title}</h2><p>{sourceName(shownEvent.sourceId)} · {informationTime(shownEvent.receivedAt)}</p></header>
              <section><h3>原文</h3><InformationText>{shownEvent.text}</InformationText><InformationFiles files={shownEvent.files} base={`/api/information/events/${encodeURIComponent(shownEvent.id)}/files`} /></section>
              <section><h3>使用规则</h3>{shownEvent.ruleSnapshot ? <p>{shownEvent.ruleSnapshot.rule.name} · 版本 {shownEvent.ruleSnapshot.rule.revision} · {shownEvent.ruleSnapshot.profile.name}</p> : <><p>未匹配处理规则，尚未调用模型。</p>{canManage(shownEvent.sourceId) && <button disabled={busy} onClick={() => void mutate(`/api/information/events/${encodeURIComponent(shownEvent.id)}/process`, {}, 'POST', true)}>按当前规则处理</button>}</>}</section>
              <section><h3>预处理</h3>{shownEvent.jobs.filter(item => item.kind === 'preprocess').map(item => <div className="information-step" key={item.id}><span><Status status={item.status} /> · {informationTime(item.createdAt)}</span><button onClick={() => navigate({ tab: 'jobs', id: item.id, status: '', offset: 0 })}>查看作业<ArrowRight size={14} aria-hidden="true" /></button>{shownEvent.results.find(result => result.jobId === item.id) && <InformationText>{shownEvent.results.find(result => result.jobId === item.id)!.text}</InformationText>}</div>)}</section>
              <section><h3>分席位投递</h3>{!shownEvent.deliveries.length ? <p className="resource-help">预处理完成后生成投递记录。</p> : shownEvent.deliveries.map(delivery => <div className="information-step" key={delivery.id}><strong>{seatName(delivery.recipientSeatId)}</strong><span>{deliveryLabels[delivery.status]}</span><small>预处理 {delivery.jobId.slice(0, 8)} · {informationTime(delivery.updatedAt)}</small>{delivery.error && <p className="resource-error">{delivery.error.message}</p>}{delivery.status !== 'delivered' && canManage(shownEvent.sourceId) && <button disabled={busy} onClick={() => void mutate(`/api/information/deliveries/${encodeURIComponent(delivery.id)}/retry`, {}, 'POST', true)}>重试投递</button>}</div>)}</section>
              <AnalysisHistory items={shownEvent.analyses} seats={capabilities.seats} openSession={openSession} />
            </> : !shownJob ? <p role="status">正在读取作业…</p> : <>
              <header><h2>{shownJob.kind === 'preprocess' ? '自动预处理' : '席位后台分析'}</h2><Status status={shownJob.status} /><p>{sourceName(shownJob.sourceId)}{shownJob.seatId ? ` · ${seatName(shownJob.seatId)}` : ''}</p></header><dl className="information-metadata"><dt>排队时间</dt><dd>{informationTime(shownJob.createdAt)}</dd><dt>开始时间</dt><dd>{informationTime(shownJob.startedAt)}</dd><dt>结束时间</dt><dd>{informationTime(shownJob.endedAt)}</dd></dl>
              <button onClick={() => navigate({ tab: 'events', id: shownJob.eventId, status: '', offset: 0 })}>查看来源信息</button>
              {shownJob.error && <p className="resource-error" role="alert">{shownJob.error.message}</p>}
              {shownJob.kind === 'preprocess' && canManage(shownJob.sourceId) && <div className="information-actions">{['queued', 'running'].includes(shownJob.status) ? <button disabled={busy} onClick={() => void mutate(`/api/information/jobs/${encodeURIComponent(shownJob.id)}/cancel`, { revision: shownJob.revision })}>取消预处理</button> : <button disabled={busy} onClick={() => { if (window.confirm('重新处理会启动一项新作业；已有记录和文件保留。是否继续？')) void mutate(`/api/information/jobs/${encodeURIComponent(shownJob.id)}/reprocess`, {}, 'POST', true); }}>重新预处理</button>}</div>}
              {shownJob.sessionId && shownJob.kind === 'seat_analysis' && <button onClick={() => openSession(shownJob.sessionId!)}>进入关联对话</button>}
              {shownJob.text !== undefined && <section><h3>处理结果</h3><InformationText>{shownJob.text || '尚无最终答复。'}</InformationText></section>}
              {shownJob.files && (shownJob.kind === 'preprocess' || shownJob.snapshot) && <InformationFiles files={shownJob.files} base={shownJob.kind === 'preprocess' ? `/api/information/events/${encodeURIComponent(shownJob.eventId)}/files` : `/api/workspaces/${encodeURIComponent(shownJob.snapshot!.workspaceId)}/downloads`} />}
              {shownJob.snapshot && <details className="information-original"><summary>查看处理过程</summary>{shownJob.snapshot.messages.map(message => <Message key={message.id} message={{ ...message, attachments: undefined }} active={shownJob.status === 'running'} workspaceId={shownJob.snapshot!.workspaceId} focusKey={message.id} focusTransfers={focusTransfers} />)}</details>}
            </>}
          </aside>}
        </div></>}
        <InformationRules visible={visible && route.tab === 'rules'} capabilities={capabilities} tasks={tasks} selectedId={route.tab === 'rules' ? route.id : ''} select={id => navigate({ id })} />
      </div>
    </>}
  </section>;
}
function Status({ status }: { status?: InformationJobSummary['status'] }) { return <span className={`information-tag ${status || 'unmatched'}`}>{status ? jobLabels[status] : '未匹配规则'}</span>; }
