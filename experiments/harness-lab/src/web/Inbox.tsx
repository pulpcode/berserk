import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Inbox as InboxIcon, RefreshCw } from 'lucide-react';
import type { Identity, TaskSpace } from '../contracts/access';
import type { BackgroundAction, BackgroundPage, InboxDetail, InboxItem, InboxHandlingResult } from '../contracts/background';
import type { Workspace } from '../contracts/index';
import { ApiFailure, useApi } from './api';
import { ContextEvidence } from './ContextEvidence';
import { InformationContinuation } from './InformationContinuation';
import { TaskAssociations } from './TaskAssociations';
import { AnalysisHistory, InformationFiles, InformationPagination, InformationText, informationTime, useInformationQuery } from './information-ui';

export function Inbox({ visible, identity, tasks, workspaces, seats, prepared, openSession, savedTask, openTask, selectedId, selectItem, changed }: { selectedId?: string; selectItem?: (id: string) => void; changed?: () => void; visible: boolean; identity: Identity; tasks: TaskSpace[]; workspaces: Workspace[]; seats: Array<{ id: string; name: string }>; prepared: (action: BackgroundAction, current: () => boolean, sendNow?: boolean) => Promise<boolean>; openSession: (id: string) => void; savedTask: (task: TaskSpace) => void; openTask: (id: string) => void }) {
  const { domId } = useApi();
  const embedded = selectedId !== undefined;
  const [selected, setSelected] = useState(() => location.pathname === '/inbox' ? new URLSearchParams(location.search).get('id') || '' : '');
  const activeId = selectedId ?? selected;
  const [search, setSearch] = useState(''); const [offset, setOffset] = useState(0);
  const query = new URLSearchParams({ offset: String(offset), limit: '25', search });
  const list = useInformationQuery<BackgroundPage<InboxItem>>(`/api/inbox?${query}`, visible && !embedded);
  const detail = useInformationQuery<InboxDetail>(activeId ? `/api/inbox/${encodeURIComponent(activeId)}` : undefined, visible);
  const value = detail.data;
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const loadedId = value?.delivery.id;
  useEffect(() => { if (visible && loadedId) detailHeading.current?.focus(); }, [visible, loadedId]);
  useEffect(() => {
    if (!visible || embedded) return;
    const url = `/inbox${selected ? `?id=${encodeURIComponent(selected)}` : ''}`;
    if (location.pathname + location.search !== url) history.replaceState(null, '', url);
    const pop = () => { if (location.pathname === '/inbox') setSelected(new URLSearchParams(location.search).get('id') || ''); };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, [visible, selected, embedded]);
  function select(id: string) { if (selectItem) { selectItem(id); return; } setSelected(id); history.pushState(null, '', `/inbox${id ? `?id=${encodeURIComponent(id)}` : ''}`); }
  return <section id={domId('information-inbox')} tabIndex={-1} className={`information-inbox${embedded ? ' information-embedded' : ''}`} hidden={!visible} aria-label="收到的信息">
    {!embedded && <><header className="information-heading"><div><h1>收到的信息</h1><p>查看处理结果，围绕结论提问、核实或开展后续工作。</p></div><button onClick={() => { list.refresh(); detail.refresh(); }}><RefreshCw size={16} aria-hidden="true" />刷新收件</button></header>
    <div className="information-toolbar"><label>搜索信息<input type="search" placeholder="标题或来源" value={search} onChange={event => { setSearch(event.target.value); setOffset(0); }} /></label></div></>}
    {(list.error || detail.error) && <p className="resource-error" role="alert">{list.error || detail.error}</p>}
    <div className="information-split">{!embedded && <div className="information-list"><ul>{list.data?.items.map(item => <li key={item.delivery.id}><button aria-current={selected === item.delivery.id ? 'true' : undefined} onClick={() => select(item.delivery.id)}><strong>{item.event.title}</strong><span>{item.sourceName || item.event.sourceId} · 已送达</span><small>{informationTime(item.delivery.deliveredAt)}</small></button></li>)}</ul>{list.data && !list.data.items.length && <p className="information-empty"><InboxIcon size={24} aria-hidden="true" />暂时没有收到的信息。</p>}<InformationPagination page={list.data} change={setOffset} /></div>}
      <div className="information-detail">{!activeId ? <p className="information-empty">选择一条信息查看原文与结果。</p> : !value ? !detail.error && <p role="status">正在读取信息…</p> : <>
        <button className="information-back" onClick={() => select('')}><ArrowLeft size={15} aria-hidden="true" />返回列表</button><header><h2 ref={detailHeading} tabIndex={-1}>{value.event.title}</h2><p>{value.sourceName || value.event.sourceId} · {informationTime(value.delivery.deliveredAt)}</p></header>
        {value.deliveryReason && <details className="information-original"><summary>为何收到</summary>{value.deliveryReason.kind === 'fixed' ? <p>按来源规则固定投递给本席位。</p> : <><p>{seats.find(seat => seat.id === value.deliveryReason?.approvedBySeatId)?.name || '总体席'}批准补充投递。</p><p>{value.deliveryReason.reason}</p></>}</details>}
        <InboxHandlingControl key={activeId} id={activeId} initial={value.handling} changed={() => { detail.refresh(); list.refresh(); changed?.(); }} />
        <section><h3>系统分析结果</h3>{value.profileName && <p className="resource-help">处理方案：{value.profileName}</p>}<InformationText>{value.resultText || '此次处理没有文字答复。'}</InformationText><InformationFiles files={value.resultFiles} base={`/api/inbox/${encodeURIComponent(activeId)}/files`} /><ContextEvidence messages={value.queryMessages}/></section>
        <details className="information-original"><summary>查看原文与附件</summary><InformationText>{value.text}</InformationText><InformationFiles files={value.event.files} base={`/api/inbox/${encodeURIComponent(activeId)}/files`} /></details>
        <TaskAssociations key={`links:${activeId}`} eventId={value.event.id} jobId={value.job.id} visible={visible} identity={identity} tasks={tasks} savedTask={savedTask} openTask={openTask} changed={detail.refresh} />
        <InformationContinuation key={activeId} scope={`inbox:${activeId}`} visible={visible} base={`/api/inbox/${encodeURIComponent(activeId)}`} tasks={tasks} workspaces={workspaces} files={value.event.files} resultFiles={value.resultFiles} preferredTaskIds={value.taskLinks?.links.filter(link => link.mode !== 'exclude').map(link => link.task.id)} prepared={prepared} openSession={openSession} changed={() => { detail.refresh(); list.refresh(); }} />
        <AnalysisHistory items={value.analyses} seats={seats} openSession={openSession} />
      </>}</div></div>
  </section>;
}


export function InboxHandlingControl({ id, initial, changed }: { id: string; initial: InboxItem['handling']; changed: () => void }) {
  const { api, storageKey } = useApi();
  const key = storageKey(`axon.inbox-handling:${id}`);
  type Request = { state: 'pending' | 'completed'; revision: number; clientActionId: string };
  type Result = InboxHandlingResult;
  const [pending, setPending] = useState<Request | undefined>(() => { try { return JSON.parse(sessionStorage.getItem(key) || 'null') as Request | undefined; } catch { return undefined; } });
  const [confirmed, setCurrent] = useState(initial);
  const current = initial && (!confirmed || initial.revision > confirmed.revision) ? initial : confirmed;
  const [busy, setBusy] = useState(false); const [queried, setQueried] = useState(false); const [error, setError] = useState('');
  const lock = useRef(false); const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  function retain(value?: Request) { setPending(value); try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch { /* Retain uncertain actions in memory. */ } }
  async function query() {
    if (lock.current || !pending) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await api<Result>(`/api/inbox/${encodeURIComponent(id)}/handling?${new URLSearchParams({ clientActionId: pending.clientActionId })}`);
      if (!alive.current) return;
      setCurrent(result.handling); changed();
      if (result.receipt || result.handling.revision !== pending.revision) { retain(); setQueried(false); }
      else setQueried(true);
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : '查询未完成，请重试。'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function update(state: 'pending' | 'completed', retry?: Request) {
    if (lock.current || !current || (pending && !retry)) return;
    const request = retry || { state, revision: current.revision, clientActionId: crypto.randomUUID() };
    lock.current = true; retain(request); setBusy(true); setQueried(false); setError('');
    try {
      const result = await api<Result>(`/api/inbox/${encodeURIComponent(id)}/handling`, request, 'PUT');
      if (!alive.current) return;
      setCurrent(result.handling); retain(); changed();
    } catch (reason) {
      if (alive.current) {
        setError(reason instanceof ApiFailure && reason.status === 409 ? '处理状态已变化，请先查询最新状态。' : '结果尚未确认，请先查询结果。');
      }
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="inbox-handling" aria-label="本席位处理状态"><strong>{current?.state === 'completed' ? '已处理' : current?.state === 'pending' ? '待处理' : '历史未登记'}</strong><p>仅打开阅读不会改变处理状态；各席位分别确认。</p>{error && <p className="resource-error" role="alert">{error}</p>}{pending ? <><button disabled={busy} onClick={() => void query()}>查询处理结果</button>{queried && <button disabled={busy} onClick={() => void update(pending.state, pending)}>重试原操作</button>}</> : current && <>{current.state !== 'completed' && <button disabled={busy} onClick={() => void update('completed')}>标记已处理</button>}{current.state !== 'pending' && <button disabled={busy} onClick={() => void update('pending')}>{current.state === 'legacy' ? '列入待处理' : '重新列入待处理'}</button>}</>}</section>;
}
