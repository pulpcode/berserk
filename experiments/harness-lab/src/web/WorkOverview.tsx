import { useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import type { TaskSpace } from '../contracts/access';
import type { WorkOverviewItem, WorkOverviewPage } from '../contracts/workbench';
import { InformationPagination, informationTime, useInformationQuery } from './information-ui';
import { workStateLabel } from './WorkInbox';
import { WorkOverviewSwimlane } from './WorkOverviewSwimlane';
import { workFlowLimit, workFlowProblem, type WorkOverviewView } from './work-overview-layout';

type Route = { id: string; taskId: string; seatId: string; status: string; search: string; offset: number; workView: WorkOverviewView };
export function WorkOverview({ visible, allowed, route, navigate, tasks, seats, openWork }: { visible: boolean; allowed: boolean; route: Route; navigate: (change: Partial<Route>, replace?: boolean) => void; tasks: TaskSpace[]; seats: Array<{id: string; name: string}>; openWork: (id: string) => void }) {
  const filters = new URLSearchParams({ ...(route.taskId ? { taskId: route.taskId } : {}), ...(route.seatId ? { seatId: route.seatId } : {}), ...(route.status ? { status: route.status } : {}), ...(route.search ? { search: route.search } : {}) });
  const scope = filters.toString();
  const list = useInformationQuery<WorkOverviewPage>(`/api/work-overview/items?offset=${route.offset}&limit=25&${filters}`, visible && allowed && route.workView === 'list', 10000);
  const flow = useInformationQuery<WorkOverviewPage>(`/api/work-overview/items?offset=0&limit=${workFlowLimit}&${filters}`, visible && allowed && route.workView === 'flow', 10000);
  const detail = useInformationQuery<WorkOverviewItem>(route.id ? `/api/work-overview/items/${encodeURIComponent(route.id)}` : undefined, visible && allowed, 10000);
  const active = route.workView === 'flow' ? flow : list;
  const blocked = active.denied || detail.denied;
  const heading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement | undefined>(undefined);
  const previousId = useRef(route.id);
  const detailId = detail.data?.id;
  useEffect(() => { if (route.id && detailId) heading.current?.focus(); }, [route.id, detailId]);
  useEffect(() => {
    if (!route.id && previousId.current) (trigger.current?.isConnected ? trigger.current : returnFocus.current)?.focus();
    previousId.current = route.id;
  }, [route.id]);
  // A rejected summary must not reveal an older cached list/diagram when returning.
  const { discard: discardList } = list, { discard: discardFlow } = flow, { discard: discardDetail } = detail;
  useEffect(() => { if (blocked) { discardList(); discardFlow(); discardDetail(); } }, [blocked, discardList, discardFlow, discardDetail]);
  if (!allowed) return <p className="information-empty">当前席位没有跨席位工作摘要查看权限。</p>;
  const next = (item: WorkOverviewItem) => item.state === 'completed' ? '已完成' : item.state === 'submitted' ? `${item.creatorSeatName} 验收` : `${item.assigneeSeatName} ${item.state === 'assigned' ? '签收' : item.state === 'returned' ? '修改' : '办理'}`;
  const select = (item: WorkOverviewItem, button: HTMLButtonElement) => { trigger.current = button; navigate({ id: item.id }); };
  const refresh = () => { active.refresh(); detail.refresh(); };
  const problem = flow.data && workFlowProblem(flow.data);
  const error = detail.denied ? detail.error : active.denied ? active.error : detail.error || active.error;
  return <div className="work-overview">
    <div className="information-toolbar work-overview-toolbar">
      <label>工作任务<select value={route.taskId} onChange={event => navigate({ taskId: event.target.value, offset: 0, id: '' }, true)}><option value="">全部公共任务</option>{tasks.filter(task => task.visibility === 'public').map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
      <label>相关席位<select value={route.seatId} onChange={event => navigate({ seatId: event.target.value, offset: 0, id: '' }, true)}><option value="">全部席位</option>{seats.map(seat => <option key={seat.id} value={seat.id}>{seat.name}</option>)}</select></label>
      <label>工作状态<select value={route.status} onChange={event => navigate({ status: event.target.value, offset: 0, id: '' }, true)}><option value="">全部状态</option>{Object.entries(workStateLabel).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>搜索工作<input type="search" value={route.search} onChange={event => navigate({ search: event.target.value, offset: 0, id: '' }, true)} /></label>
      <div className="work-overview-actions"><button className="icon-button" title="刷新工作" aria-label="刷新工作" onClick={refresh}><RefreshCw size={17} aria-hidden="true" /></button><div className="information-view-toggle" role="group" aria-label="席位工作展示方式"><button ref={returnFocus} aria-pressed={route.workView === 'list'} onClick={() => navigate({ workView: 'list', id: '' })}>列表</button><button aria-pressed={route.workView === 'flow'} onClick={() => navigate({ workView: 'flow', id: '' })}>泳道图</button></div></div>
    </div>
    {error && <p className="resource-error" role="alert">{!blocked && (active.data || detail.data) ? '刷新失败，当前显示上次结果。' : ''}{error}<button onClick={refresh}>重试</button></p>}
    {route.id && <section className="work-overview-summary"><button onClick={() => navigate({ id: '' })}>{route.workView === 'flow' ? '返回泳道图' : '返回工作列表'}</button>{!blocked && detail.data ? <><h2 ref={heading} tabIndex={-1}>{detail.data.title}</h2><p>{detail.data.taskTitle} · {workStateLabel[detail.data.state]}</p><dl className="information-metadata"><dt>发起席位</dt><dd>{detail.data.creatorSeatName}</dd><dt>承办席位</dt><dd>{detail.data.assigneeSeatName}</dd><dt>下一步</dt><dd>{next(detail.data)}</dd><dt>提交次数</dt><dd>{detail.data.submissionCount}</dd><dt>最近提交</dt><dd>{informationTime(detail.data.latestSubmittedAt)}</dd></dl>{detail.data.participant ? <button onClick={() => openWork(detail.data!.id)}>进入工作详情</button> : <p className="resource-help">仅展示工作摘要；正文、文件和办理操作由参与席位查看。</p>}</> : !error && <p role="status">正在读取工作摘要…</p>}</section>}
    <div hidden={Boolean(route.id) || route.workView !== 'list'}>
      {!blocked && list.data && <><div className="information-table-scroll"><table className="information-table"><thead><tr><th>工作</th><th>分派双方</th><th>当前状态</th><th>下一步</th><th>更新时间</th></tr></thead><tbody>{list.data.items.map(item => <tr key={item.id}><td><button className="information-row-link" onClick={event => select(item, event.currentTarget)}>{item.title}</button><small>{item.taskTitle}</small></td><td>{item.creatorSeatName} → {item.assigneeSeatName}</td><td>{workStateLabel[item.state]}</td><td>{next(item)}</td><td>{informationTime(item.updatedAt)}</td></tr>)}</tbody></table></div>{list.data.items.length === 0 && <p className="information-empty">暂无符合条件的工作。</p>}<InformationPagination page={list.data} change={offset => navigate({ offset })} /></>}
    </div>
    {!blocked && flow.data && !problem && flow.data.items.length > 0 && <WorkOverviewSwimlane key={scope} items={flow.data.items} hidden={Boolean(route.id) || route.workView !== 'flow'} showTask={!route.taskId} select={select} />}
    {!route.id && route.workView === 'flow' && !blocked && <>
      {problem === 'overflow' && <p className="information-empty">工作较多，请缩小筛选范围，或切换列表查看全部。<button onClick={() => navigate({ workView: 'list' })}>切换列表</button></p>}
      {problem === 'incomplete' && <p className="resource-error" role="alert">工作数据不完整，请重新读取。<button onClick={refresh}>重试</button></p>}
      {flow.data?.items.length === 0 && !problem && <p className="information-empty">暂无符合条件的工作。</p>}
    </>}
    {!route.id && !active.data && !error && <p className="information-empty" role="status">正在读取工作…</p>}
  </div>;
}
