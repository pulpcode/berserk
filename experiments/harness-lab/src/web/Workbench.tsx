import { useEffect, useImperativeHandle, useRef, useState, type ComponentProps } from 'react';
import { Inbox as InboxIcon, RefreshCw } from 'lucide-react';
import type { Identity, TaskSpace } from '../contracts/access';
import type { Workspace } from '../contracts/index';
import type { WorkItem } from '../contracts/collaboration';
import { workPerspective, type WorkbenchItem, type WorkbenchPage } from '../contracts/workbench';
import { WorkInbox, type WorkInboxHandle } from './WorkInbox';
import { Inbox } from './Inbox';
import { activityStatus } from './WorkspaceNavigation';
import { InformationPagination, informationTime, useInformationQuery } from './information-ui';
import { useApi } from './api';

type Route = { bucket: 'actionable' | 'following' | 'done' | 'all'; kind: '' | 'work' | 'information'; id: string; taskId: string; search: string; offset: number };
function readRoute(): Route {
  const query = new URLSearchParams(location.pathname === '/work' ? location.search : '');
  const bucket = query.get('bucket'); const kind = query.get('kind');
  return { bucket: bucket === 'following' || bucket === 'done' || bucket === 'all' ? bucket : 'actionable', kind: kind === 'work' || kind === 'information' ? kind : '', id: query.get('id') || '', taskId: query.get('taskId') || '', search: query.get('search') || '', offset: Math.max(0, Number(query.get('offset')) || 0) };
}
function routeUrl(route: Route) { return `/work?${new URLSearchParams(Object.entries(route).filter(([, value]) => value !== '' && value !== 0).map(([key, value]) => [key, String(value)]))}`; }
type Props = ComponentProps<typeof WorkInbox> & { identity?: Identity; activityWorkspaces: Workspace[]; tasks: TaskSpace[]; information: Omit<ComponentProps<typeof Inbox>, 'visible' | 'identity' | 'selectedId' | 'selectItem' | 'changed'> };
export function Workbench({ identity, tasks, activityWorkspaces, information, ...work }: Props) {
  const { domId } = useApi();
  const [route, setRoute] = useState(readRoute);
  const [informationId, setInformationId] = useState(route.kind === 'information' ? route.id : '');
  if (route.kind === 'information' && route.id && informationId !== route.id) setInformationId(route.id);
  const workControl = useRef<WorkInboxHandle>(null);
  const listElement = useRef<HTMLDivElement>(null);
  const listPosition = useRef(0);
  const selectionOrigin = useRef<string>('');
  const query = new URLSearchParams({ bucket: route.bucket, offset: String(route.offset), limit: '25', ...(route.kind ? { kind: route.kind } : {}), ...(route.taskId ? { taskId: route.taskId } : {}), ...(route.search ? { search: route.search } : {}) });
  const list = useInformationQuery<WorkbenchPage>(`/api/workbench/items?${query}`, work.visible && !!identity, 10000);
  const legacy = useInformationQuery<WorkItem[]>('/api/work-items', work.visible && !identity, 10000);
  const [retained, setRetained] = useState<{ scope: string; items: WorkbenchItem[] }>();
  const scope = query.toString();
  const [lastData, setLastData] = useState<WorkbenchPage>();
  if (list.data && list.data !== lastData) {
    const data = list.data; setLastData(data);
    setRetained(previous => ({ scope, items: [...data.items, ...(previous?.scope === scope ? previous.items.filter(item => data.sections[item.kind] === 'error' && !data.items.some(next => next.key === item.key)) : [])] }));
  }
  useEffect(() => { const pop = () => { if (location.pathname === '/work') setRoute(readRoute()); }; window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);
  function navigate(change: Partial<Route>, replace = false) {
    const next = { ...route, ...change };
    if (listElement.current) listPosition.current = listElement.current.scrollTop;
    setRoute(next); history[replace ? 'replaceState' : 'pushState'](null, '', routeUrl(next));
    if (!next.id) requestAnimationFrame(() => { if (listElement.current) listElement.current.scrollTop = listPosition.current; document.getElementById(domId(`work-row-${selectionOrigin.current}`))?.focus(); });
  }
  useImperativeHandle(work.control, () => ({ open: (id, owner) => {
    const next: Route = { ...readRoute(), kind: id || owner ? 'work' : '', id: id || '' };
    setRoute(next); history.pushState(null, '', routeUrl(next)); workControl.current?.open(id, owner);
  } }));
  function changed() { window.dispatchEvent(new Event('focus')); }
  const legacyItems: WorkbenchItem[] = (legacy.data || []).map(item => ({ key: `work:${item.id}`, id: item.id, kind: 'work' as const, title: item.title, state: item.state, ...workPerspective(item, work.seatId), source: `${work.seats.find(seat => seat.id === item.creatorSeatId)?.name || item.creatorSeatId} → ${work.seats.find(seat => seat.id === item.assigneeSeatId)?.name || item.assigneeSeatId}`, tasks: [{ id: item.taskSpaceId, title: work.workspaces.find(workspace => workspace.taskSpaceId === item.taskSpaceId)?.name || '项目' }], updatedAt: item.updatedAt })).filter(item => (!route.taskId || item.tasks.some(task => task.id === route.taskId)) && (!route.search || item.title.includes(route.search)));
  const counts = identity ? list.data?.counts : { actionable: legacyItems.filter(item => item.bucket === 'actionable').length, following: legacyItems.filter(item => item.bucket === 'following').length, done: legacyItems.filter(item => item.bucket === 'done').length, all: legacyItems.length };
  const items = identity ? list.denied ? [] : retained?.scope === scope ? retained.items : list.data?.items || [] : legacyItems.filter(item => route.bucket === 'all' || item.bucket === route.bucket);
  const partial = Boolean(list.data && Object.values(list.data.sections).includes('error'));
  const reminders = work.activities.filter(session => {
    const taskId = activityWorkspaces.find(workspace => workspace.id === session.workspaceId)?.taskSpaceId;
    return (!route.taskId || route.taskId === taskId) && ((session.active?.status !== 'stopping' && (session.active?.phase === 'waiting_answer' || session.active?.phase === 'waiting_confirmation')) || (!session.active && !session.backgroundJob && (session.recoveryWarning || session.lastResult?.status === 'failed' || session.lastResult?.status === 'interrupted')));
  });
  const waiting = reminders.filter(session => session.active).length;
  return <section id={domId('workbench')} className="workbench" hidden={!work.visible} tabIndex={-1} aria-label="工作待办">
    <header className="work-inbox-header"><div><h1>工作待办</h1><p>处理席位交接与外部信息，继续需要回应的对话。</p></div><button onClick={changed}><RefreshCw size={16} aria-hidden="true" />刷新待办</button></header>
    <div className="work-filters" aria-label="待办分类">{([['actionable', '待我处理'], ['following', '跟进中'], ['done', '已办'], ['all', '全部']] as const).map(([id, label]) => <button key={id} aria-pressed={route.bucket === id} onClick={() => navigate({ bucket: id, offset: 0, id: '' })}>{label}<span>{counts?.[id] ?? '—'}</span></button>)}</div>
    <div className="information-toolbar">{identity && <label>事项类型<select value={route.kind} onChange={event => navigate({ kind: event.target.value as Route['kind'], offset: 0, id: '' }, true)}><option value="">全部类型</option><option value="work">工作交接</option><option value="information">外部信息</option></select></label>}<label>关联任务<select value={route.taskId} onChange={event => navigate({ taskId: event.target.value, offset: 0, id: '' }, true)}><option value="">全部任务</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label><label>搜索事项<input type="search" value={route.search} onChange={event => navigate({ search: event.target.value, offset: 0, id: '' }, true)} /></label></div>
    {reminders.length > 0 && <details className="workbench-reminders" open><summary>对话提醒：待回应 {waiting} 个 · 异常 {reminders.length - waiting} 个</summary><ul>{reminders.map(session => <li key={session.id}><button onClick={() => work.openSession(session.id)}><span>{session.title}</span><span>{activityStatus(session)} · {session.active ? '去回应' : '查看对话'}</span></button></li>)}</ul></details>}
    {(list.error || legacy.error || partial) && <p className="resource-error" role="alert">{list.error || legacy.error || `${Object.entries(list.data?.sections || {}).filter(([, status]) => status === 'error').map(([kind]) => kind === 'work' ? '工作交接' : kind === 'information' ? '外部信息' : '投递审批').join('、')}读取失败，已保留上次结果，数量暂不完整。`}<button onClick={changed}>重新读取</button></p>}
    <div className={`workbench-columns${route.id ? ' has-selection' : ''}`}><div className="workbench-list" ref={listElement}><ul className="work-list">{items.map(item => <li key={item.key}><button id={domId(`work-row-${item.key}`)} aria-current={route.id === item.id && route.kind === item.kind ? 'true' : undefined} onClick={() => { selectionOrigin.current = item.key; navigate({ kind: item.kind, id: item.id }); }}><strong>{item.title}</strong><span>{item.kind === 'work' ? '工作交接' : '外部信息'} · {item.label}</span><small>{item.source}</small>{item.kind === 'information' && <small>分析于 {informationTime(item.analysisAt)}{item.jobId ? ` · 版本 ${item.jobId.slice(0, 8)}` : ''}</small>}<small>{item.tasks.map(task => task.title).join('、') || '尚未关联任务'} · {informationTime(item.updatedAt)}</small></button></li>)}</ul>{!items.length && <p className="work-empty"><InboxIcon size={24} aria-hidden="true" />{!list.data && !legacy.data && !list.error && !legacy.error ? '正在读取事项…' : '暂无符合条件的事项。'}</p>}{!partial && !list.error && <InformationPagination page={list.data} change={offset => navigate({ offset, id: '' })} />}</div>
    <div className="workbench-detail"><WorkInbox {...work} refreshKey={list.data?.generatedAt} control={workControl} embedded visible={work.visible && route.kind !== 'information'} selectedId={route.kind === 'work' ? route.id : ''} select={id => navigate({ kind: 'work', id })} changed={changed} />{identity && <Inbox {...information} identity={identity} visible={work.visible && route.kind === 'information' && !!route.id && route.id === informationId} selectedId={informationId} selectItem={id => navigate({ id })} changed={changed} />}</div></div>
  </section>;
}
