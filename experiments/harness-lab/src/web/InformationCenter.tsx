import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Columns3, List, RefreshCw, Workflow } from 'lucide-react';
import type { TaskSpace } from '../contracts/access';
import type { BackgroundDelivery, BackgroundEventDetail, BackgroundEventSummary, BackgroundPage, InformationCapabilities, InformationJobDetail, InformationJobSummary } from '../contracts/background';
import { useApi } from './api';
import { InformationRules } from './InformationRules';
import { Message } from './ChatMessage';
import type { ChatFocusTransfer } from './useChatItemFocus';
import { AnalysisHistory, deliveryLabels, InformationFiles, InformationPagination, InformationText, informationError, informationTime, jobLabels, useInformationQuery } from './information-ui';
import { InformationDrawer, InformationJobColumn, JobDeliverySummary, JobStatus, jobColumns, jobPhases, jobTitle } from './InformationJobs';

type Tab = 'events' | 'jobs' | 'rules';
type Location = { tab: Tab; id: string; sourceId: string; status: string; search: string; offset: number; view: 'board' | 'list'; queued: number; running: number; succeeded: number; stopped: number };
const firstPages = { offset: 0, queued: 0, running: 0, succeeded: 0, stopped: 0 };
function initialLocation(): Location {
  const params = new URLSearchParams(location.pathname === '/information' ? location.search : '');
  const tab = params.get('tab');
  const offset = (key: string) => Math.max(0, Math.floor(Number(params.get(key)) || 0));
  return { tab: tab === 'events' || tab === 'rules' ? tab : !tab && params.has('id') ? 'events' : 'jobs', id: params.get('id') || '', sourceId: params.get('sourceId') || '', status: params.get('status') || '', search: params.get('search') || '', offset: offset('offset'), view: params.get('view') === 'list' || params.get('status') ? 'list' : 'board', queued: offset('queued'), running: offset('running'), succeeded: offset('succeeded'), stopped: offset('stopped') };
}
function locationUrl(route: Location) {
  const params = new URLSearchParams(Object.entries(route).filter(([, value]) => value !== '' && value !== 0).map(([key, value]) => [key, String(value)]));
  return `/information?${params}`;
}
export function InformationCenter({ visible, capabilities, refreshAccess, tasks, openSession, navigationError, clearNavigationError }: { visible: boolean; capabilities?: InformationCapabilities; refreshAccess: () => void; tasks: TaskSpace[]; openSession: (id: string) => void; navigationError?: { url: string; message: string }; clearNavigationError: () => void }) {
  const { api, domId } = useApi();
  const [route, setRoute] = useState(initialLocation);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false); const [refreshKey, setRefreshKey] = useState(0);
  const lock = useRef(false); const actionIds = useRef(new Map<string, string>()); const [focusTransfers] = useState<ChatFocusTransfer>(() => new Map());
  const allowed = Boolean(capabilities?.sources.length);
  const query = new URLSearchParams({ offset: String(route.offset), limit: '25', ...(route.sourceId ? { sourceId: route.sourceId } : {}), ...(route.status ? { status: route.status } : {}), ...(route.search ? { search: route.search } : {}) });
  const events = useInformationQuery<BackgroundPage<BackgroundEventSummary>>(`/api/information/events?${query}`, visible && allowed && route.tab === 'events');
  const jobs = useInformationQuery<BackgroundPage<InformationJobSummary>>(`/api/information/jobs?${query}`, visible && allowed && route.tab === 'jobs' && route.view === 'list');
  const event = useInformationQuery<BackgroundEventDetail>(route.id && route.tab === 'events' ? `/api/information/events/${encodeURIComponent(route.id)}` : undefined, visible && allowed);
  const job = useInformationQuery<InformationJobDetail>(route.id && route.tab === 'jobs' ? `/api/information/jobs/${encodeURIComponent(route.id)}` : undefined, visible && allowed);
  function refresh() { events.refresh(); jobs.refresh(); event.refresh(); job.refresh(); setRefreshKey(value => value + 1); refreshAccess(); }
  function navigate(value: Partial<Location>, replace = false) {
    const next = { ...route, ...value }; setRoute(next); setError(''); setNotice('');
    history[replace ? 'replaceState' : 'pushState'](null, '', locationUrl(next));
  }
  useEffect(() => {
    const pop = () => { if (location.pathname === '/information') { setRoute(initialLocation()); setError(''); setNotice(''); } };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => { if (visible) history.replaceState(null, '', locationUrl(route)); }, [visible, route]);
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
  const listError = route.tab === 'events' ? events.error : route.view === 'list' ? jobs.error : '';
  const closeDetail = () => navigate({ id: '' });
  const detailOpen = visible && Boolean(route.id) && route.tab !== 'rules';
  function deliveries(items: BackgroundDelivery[], sourceId: string) {
    return !items.length ? <p className="resource-help">本次执行尚无投递记录。</p> : items.map(delivery => <div className="information-step" key={delivery.id}>
      <strong>{seatName(delivery.recipientSeatId)}</strong><span>{deliveryLabels[delivery.status]}</span><small>{informationTime(delivery.updatedAt)}</small>
      {delivery.error && <p className="resource-error">{delivery.error.message}</p>}
      {delivery.status !== 'delivered' && canManage(sourceId) && <button disabled={busy} onClick={() => void mutate(`/api/information/deliveries/${encodeURIComponent(delivery.id)}/retry`, {}, 'POST', true)}>重试投递</button>}
    </div>);
  }
  const feedback = <>{error && <p className="resource-error" role="alert">{error}</p>}{navigationError?.url === location.pathname + location.search && <p className="resource-error" role="alert">{navigationError.message}<button onClick={clearNavigationError}>关闭提示</button></p>}{notice && <p className="resource-success" role="status">{notice}</p>}</>;
  return <section id={domId('information-center')} tabIndex={-1} className="information-center" hidden={!visible} aria-label="信息处理中心">
    <header className="information-center-header" inert={detailOpen || undefined}><div><Workflow size={22} aria-hidden="true" /><h1>信息处理中心</h1></div></header>
    {!capabilities ? <p className="information-empty" role="status">正在核对访问权限…</p> : !allowed ? <div className="information-empty"><h2>没有信息处理中心的访问权限</h2><p>可从左侧查看投递给本席位的信息。</p></div> : <>
      <nav className="information-tabs" aria-label="信息中心栏目" inert={detailOpen || undefined}>{([['events', '信息记录'], ['jobs', '后台作业'], ['rules', '处理与投递规则']] as const).map(([id, label]) => <button key={id} aria-current={route.tab === id ? 'page' : undefined} onClick={() => navigate({ tab: id, id: '', offset: 0, status: '' })}>{label}</button>)}</nav>
      <div className="information-center-body" inert={detailOpen || undefined}>
        {capabilities.queue.blockedReason && <p className="information-queue-notice" role="status">{capabilities.queue.blockedReason}</p>}
        {route.tab !== 'rules' && <>
          <div className="information-toolbar">
            <label>来源<select value={route.sourceId} onChange={e => navigate({ sourceId: e.target.value, ...firstPages, id: '' }, true)}><option value="">全部获准来源</option>{capabilities.sources.map(item => <option key={item.sourceId} value={item.sourceId}>{item.name}</option>)}</select></label>
            {(route.tab === 'events' || route.view === 'list') && <label>处理状态<select value={route.status} onChange={e => navigate({ status: e.target.value, ...firstPages, id: '' }, true)}><option value="">全部状态</option>{route.tab === 'events' && <option value="unmatched">未匹配规则</option>}{(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'] as const).map(id => <option key={id} value={id}>{jobLabels[id]}</option>)}</select></label>}
            <label className="information-search">搜索<input type="search" value={route.search} placeholder="标题或消息标识" onChange={e => navigate({ search: e.target.value, ...firstPages, id: '' }, true)} /></label>
            {route.tab === 'jobs' && <div className="information-view-toggle" role="group" aria-label="作业展示方式"><button aria-pressed={route.view === 'board'} onClick={() => navigate({ view: 'board', status: '', id: '' })}><Columns3 size={16} aria-hidden="true" />看板</button><button aria-pressed={route.view === 'list'} onClick={() => navigate({ view: 'list', id: '' })}><List size={16} aria-hidden="true" />列表</button></div>}
            <button onClick={refresh}><RefreshCw size={16} aria-hidden="true" />刷新记录</button>
          </div>
          <div className="information-controls">{source ? <><span>{source.name} · {source.accepting ? '接收中' : '已停止接收'} · {source.permission === 'manage' ? '可管理' : '只读'}</span>{source.permission === 'manage' && <button disabled={busy} onClick={() => void mutate(`/api/information/sources/${encodeURIComponent(source.sourceId)}`, { accepting: !source.accepting, revision: source.revision }, 'PUT')}>{source.accepting ? '停止此来源接收' : '恢复此来源接收'}</button>}</> : <span>其他席位的分析仅显示办理状态。</span>}{capabilities.canManageQueue && <button disabled={busy} onClick={() => void mutate('/api/information/queue', { enabled: !capabilities.queue.enabled, revision: capabilities.queue.revision }, 'PUT')}>{capabilities.queue.enabled ? '暂停领取后台作业' : '恢复领取后台作业'}</button>}</div>
          {listError && <p className="resource-error" role="alert">{listError}</p>}{!route.id && feedback}
          {route.tab === 'jobs' && route.view === 'board' ? <div className="information-board" aria-label="后台作业看板">{jobColumns.map(column => <InformationJobColumn key={column.id} column={column} query={query.toString()} offset={route[column.id]} visible={visible && allowed} refreshKey={refreshKey} selectedId={route.id} sourceName={sourceName} seatName={seatName} select={id => navigate({ id })} page={offset => navigate({ [column.id]: offset, id: '' })} />)}</div> : <div className="information-record-list">
            <div className="information-table-scroll"><table className="information-table"><thead><tr><th scope="col">{route.tab === 'events' ? '信息' : '作业'}</th><th scope="col">来源</th><th scope="col">时间</th><th scope="col">{route.tab === 'events' ? '最近一次执行' : '执行状态'}</th><th scope="col">{route.tab === 'events' ? '该次投递' : '类型／本次投递'}</th></tr></thead><tbody>
              {route.tab === 'events' ? events.data?.items.map(item => {
                const latest = item.jobs[0]; const currentDeliveries = item.deliveries.filter(delivery => delivery.jobId === latest?.id);
                return <tr key={item.id} className={route.id === item.id ? 'selected' : ''}><td><button className="information-row-link" data-information-id={item.id} onClick={() => navigate({ id: item.id })}>{item.title}</button><small>{item.sourceMessageId}</small></td><td>{sourceName(item.sourceId)}</td><td>{informationTime(item.receivedAt)}</td><td><JobStatus status={latest?.status} /></td><td>{currentDeliveries.length ? currentDeliveries.map(delivery => <span className="delivery-line" key={delivery.id}>{seatName(delivery.recipientSeatId)} · {deliveryLabels[delivery.status]}</span>) : '尚无投递'}{item.jobs.length > 1 && <small>共 {item.jobs.length} 次执行，查看详情</small>}</td></tr>;
              }) : jobs.data?.items.map(item => <tr key={item.id} className={route.id === item.id ? 'selected' : ''}><td><button className="information-row-link" data-information-id={item.id} onClick={() => navigate({ id: item.id })}>{jobTitle(item, seatName)}</button><small>{item.id.slice(0, 8)}</small></td><td>{sourceName(item.sourceId)}</td><td>{informationTime(item.createdAt)}</td><td><JobStatus status={item.status} /></td><td>{item.kind === 'preprocess' ? '自动预处理' : '人员提交分析'}<JobDeliverySummary job={item} seatName={seatName} /></td></tr>)}
            </tbody></table></div>
            {(route.tab === 'events' ? events.data : jobs.data)?.items.length === 0 && <p className="information-empty">没有符合条件的记录。</p>}
            <InformationPagination page={route.tab === 'events' ? events.data : jobs.data} change={offset => navigate({ offset, id: '' })} />
          </div>}
        </>}
        <InformationRules visible={visible && route.tab === 'rules'} capabilities={capabilities} tasks={tasks} selectedId={route.tab === 'rules' ? route.id : ''} select={id => navigate({ id })} />
      </div>
      {visible && route.id && route.tab !== 'rules' && <InformationDrawer key={`${route.tab}:${route.id}`} title={route.tab === 'events' ? '信息详情' : '后台作业详情'} selectedId={route.id} close={closeDetail}>
        {feedback}{detailError && <p className="resource-error" role="alert">{detailError}<button onClick={refresh}>重新读取详情</button></p>}
        {route.tab === 'events' ? !shownEvent ? !detailError && <p role="status">正在读取信息…</p> : <>
          <header><h2>{shownEvent.title}</h2><p>{sourceName(shownEvent.sourceId)} · {informationTime(shownEvent.receivedAt)}</p></header>
          <section><h3>原文与附件</h3><InformationText>{shownEvent.text}</InformationText><InformationFiles files={shownEvent.files} base={`/api/information/events/${encodeURIComponent(shownEvent.id)}/files`} /></section>
          <section><h3>使用规则</h3>{shownEvent.ruleSnapshot ? <p>{shownEvent.ruleSnapshot.rule.name} · 版本 {shownEvent.ruleSnapshot.rule.revision} · {shownEvent.ruleSnapshot.profile.name}</p> : <><p>未匹配处理规则，尚未调用模型。</p>{canManage(shownEvent.sourceId) && <button disabled={busy} onClick={() => void mutate(`/api/information/events/${encodeURIComponent(shownEvent.id)}/process`, {}, 'POST', true)}>按当前规则处理</button>}</>}</section>
          <section><h3>各次执行与投递</h3>{shownEvent.jobs.filter(item => item.kind === 'preprocess').map(item => <div className="information-job-history" key={item.id} data-job-id={item.id}>
            <div className="information-step"><JobStatus status={item.status} /><time>{informationTime(item.createdAt)}</time><small>{item.id.slice(0, 8)}</small><button onClick={() => navigate({ tab: 'jobs', id: item.id, status: '', offset: 0 })}>查看作业<ArrowRight size={14} aria-hidden="true" /></button></div>
            {item.error && <p className="resource-error">{item.error.message}</p>}
            {shownEvent.results.find(result => result.jobId === item.id) && <details><summary>处理答复</summary><InformationText>{shownEvent.results.find(result => result.jobId === item.id)!.text}</InformationText></details>}
            {deliveries(shownEvent.deliveries.filter(delivery => delivery.jobId === item.id), shownEvent.sourceId)}
          </div>)}</section>
          <AnalysisHistory items={shownEvent.analyses} seats={capabilities.seats} openSession={openSession} />
        </> : !shownJob ? !detailError && <p role="status">正在读取作业…</p> : <>
          <header><h2>{jobTitle(shownJob, seatName)}</h2><JobStatus status={shownJob.status} /><p>{sourceName(shownJob.sourceId)} · {shownJob.kind === 'preprocess' ? '自动预处理' : '席位后台分析'}{shownJob.seatId ? ` · ${seatName(shownJob.seatId)}` : ''}</p></header>
          <dl className="information-metadata"><dt>排队时间</dt><dd>{informationTime(shownJob.createdAt)}</dd><dt>开始时间</dt><dd>{informationTime(shownJob.startedAt)}</dd><dt>结束时间</dt><dd>{informationTime(shownJob.endedAt)}</dd>{shownJob.status === 'running' && shownJob.phase && <><dt>当前阶段</dt><dd>{jobPhases[shownJob.phase]}</dd></>}</dl>
          <div className="information-actions">
            {(shownJob.kind === 'preprocess' ? canManage(shownJob.sourceId) : shownJob.sessionId) && ['queued', 'running'].includes(shownJob.status) && <button disabled={busy} onClick={() => void mutate(`/api/${shownJob.kind === 'preprocess' ? 'information' : 'background'}/jobs/${encodeURIComponent(shownJob.id)}/cancel`, { revision: shownJob.revision })}>取消{shownJob.kind === 'preprocess' ? '预处理' : '后台分析'}</button>}
            {shownJob.kind === 'preprocess' && canManage(shownJob.sourceId) && !['queued', 'running'].includes(shownJob.status) && <button disabled={busy} onClick={() => { if (window.confirm('沿用原输入和规则快照，启动新的预处理作业；已有记录保留。是否继续？')) void mutate(`/api/information/jobs/${encodeURIComponent(shownJob.id)}/reprocess`, {}, 'POST', true); }}>重新预处理</button>}
            {shownJob.sessionId && shownJob.kind === 'seat_analysis' && <button onClick={() => openSession(shownJob.sessionId!)}>进入关联对话</button>}
            {shownJob.retryOfJobId && <button onClick={() => navigate({ id: shownJob.retryOfJobId! })}>查看上次执行</button>}
          </div>
          {shownJob.input && <section><h3>原始输入与附件</h3><InformationText>{shownJob.input.text}</InformationText><InformationFiles files={shownJob.input.files} base={`/api/information/events/${encodeURIComponent(shownJob.eventId)}/files`} /><button onClick={() => navigate({ tab: 'events', id: shownJob.eventId, status: '', offset: 0 })}>查看来源信息</button></section>}
          {shownJob.error && <section><h3>执行错误</h3><p className="resource-error">{shownJob.error.message}</p></section>}
          {shownJob.text !== undefined && <section><h3>处理答复</h3><InformationText>{shownJob.text || '尚无最终答复。'}</InformationText>{shownJob.files && (shownJob.kind === 'preprocess' || shownJob.snapshot) && <InformationFiles files={shownJob.files} base={shownJob.kind === 'preprocess' ? `/api/information/events/${encodeURIComponent(shownJob.eventId)}/files` : `/api/workspaces/${encodeURIComponent(shownJob.snapshot!.workspaceId)}/downloads`} />}</section>}
          {shownJob.kind === 'preprocess' && <section><h3>本次投递</h3>{deliveries(shownJob.deliveries || [], shownJob.sourceId)}</section>}
          {shownJob.snapshot && <details className="information-original"><summary>查看执行过程</summary>
            {shownJob.snapshot.commandPolicies?.map((record, index) => <div className="information-command-policy" key={`${record.requestId}:${record.toolCallId}:${index}`}>
              <strong>{record.execution === 'not_started' ? '未执行' : record.execution === 'succeeded' ? '执行成功' : record.execution === 'failed' ? '执行失败' : '执行结果未知'}</strong>
              <pre>{record.command}</pre><p>工作目录：<code>{record.cwd}</code></p><p>{record.policy.reason}</p>
            </div>)}
            {shownJob.snapshot.messages.map(message => <Message key={message.id} message={{ ...message, attachments: undefined }} active={shownJob.status === 'running'} workspaceId={shownJob.snapshot!.workspaceId} focusKey={message.id} focusTransfers={focusTransfers} />)}
          </details>}
        </>}
      </InformationDrawer>}
    </>}
  </section>;
}
