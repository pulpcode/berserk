import { useState } from 'react';
import { ArrowUpRight, ChevronRight, RefreshCw } from 'lucide-react';
import type { Identity, TaskSpace } from '../contracts/access';
import type { TaskExecutionSummary, VehicleExecutionState } from '../contracts/commands';
import type { WorkDetail, WorkItem } from '../contracts/collaboration';
import type { WorkOverviewItem, WorkOverviewPage } from '../contracts/workbench';
import { workPerspective } from '../contracts/workbench';
import type { TaskInformationDetail, TaskInformationPage } from '../contracts/task-information';
import { LoadingIndicator } from './LoadingIndicator';
import { Panel } from './Resources';
import { HandoffFiles } from './HandoffFiles';
import { InformationPagination, InformationText, informationTime, useInformationQuery } from './information-ui';
import { workStateLabel } from './WorkInbox';

export function TaskRecentAnalysis({ taskId, visible, openInformation }: { taskId: string; visible: boolean; openInformation: (eventId: string, jobId: string) => void }) {
  const base = `/api/tasks/${encodeURIComponent(taskId)}/information`;
  const list = useInformationQuery<TaskInformationPage>(`${base}?offset=0&limit=1`, visible, 10000);
  const item = list.data?.items[0];
  const detail = useInformationQuery<TaskInformationDetail>(item ? `${base}/${encodeURIComponent(item.eventId)}?jobId=${encodeURIComponent(item.jobId)}` : undefined, visible, 10000);
  const denied = list.denied || detail.denied;
  const value = !denied && item && detail.data?.eventId === item.eventId && detail.data?.jobId === item.jobId ? detail.data : undefined;
  const [expanded, setExpanded] = useState(false);
  const text = value?.resultText || '';
  return <section className="task-home-analysis" aria-label="最近来报分析">
    <header className="task-progress-heading"><h2>最近来报分析</h2><button className="icon-button" aria-label="刷新来报分析" onClick={() => { list.refresh(); detail.refresh(); }}><RefreshCw size={15} aria-hidden="true" /></button></header>
    {(list.error || detail.error) && <p className="resource-error" role="alert">{list.error || detail.error}</p>}
    {!list.data && !list.error && <LoadingIndicator label="正在读取来报分析…" />}
    {!denied && list.data?.items.length === 0 && <p className="resource-help">暂无获准的关联分析。</p>}
    {!denied && item && <><p className="task-progress-meta">{item.title} · {item.sourceName || item.sourceId}</p><p className="task-progress-meta">接收 {informationTime(item.receivedAt)} · 分析 {informationTime(item.analysisAt)}</p>{item.taskChanged && <p className="resource-help">任务说明已更新，关联依据为旧版本。</p>}
      {value ? <><InformationText evidence={value.queryMessages}>{text ? expanded || text.length <= 320 ? text : `${text.slice(0, 320)}…` : '此次处理没有文字答复。'}</InformationText><div className="task-progress-actions">{text.length > 320 && <button onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>{expanded ? '收起分析' : '展开分析'}</button>}<button onClick={() => openInformation(item.eventId, item.jobId)}>查看来报与依据<ArrowUpRight size={14} aria-hidden="true" /></button></div></> : !detail.error && <LoadingIndicator label="正在读取分析正文…" />}
    </>}
  </section>;
}

type WorkRow = { id: string; title: string; state: WorkItem['state']; updatedAt: string; creatorSeatId: string; assigneeSeatId: string; creatorSeatName: string; assigneeSeatName: string; participant: boolean };
function WorkAttachments({ detail }: { detail: WorkDetail }) {
  const submitted = detail.submissions.find(item => item.id === detail.latestSubmissionId);
  return <>{submitted ? <div className="task-work-file"><p className="task-progress-meta">第 {submitted.attempt} 次提交 · {submitted.review ? submitted.review.decision === 'accept' ? '验收通过' : '已退回' : '待验收'}</p><HandoffFiles files={[submitted.file]} /></div> : detail.inputFiles.length > 0 ? <div className="task-work-file"><p className="task-progress-meta">分派附件</p><HandoffFiles files={detail.inputFiles} /></div> : null}</>;
}
function TaskWorkRow({ item, visible, open }: { item: WorkRow; visible: boolean; open: () => void }) {
  // Observers never request the participant detail or receive its files and private goal.
  const detail = useInformationQuery<WorkDetail>(item.participant ? `/api/work-items/${encodeURIComponent(item.id)}` : undefined, visible, 10000);
  return <li className="task-work-row"><div className="task-work-row-heading"><div><button className="task-progress-title" onClick={open}>{item.title}<ChevronRight size={14} aria-hidden="true" /></button><p className="task-progress-meta">{item.creatorSeatName} → {item.assigneeSeatName} · {informationTime(item.updatedAt)}</p></div><span className="task-work-state">{workStateLabel[item.state]}</span></div>{detail.error && <p className="resource-error" role="alert">{detail.error}</p>}{!detail.denied && detail.data && <WorkAttachments detail={detail.data} />}</li>;
}
export function TaskWorkProgress({ task, identity, visible, seats, openWork }: { task: TaskSpace; identity: Identity; visible: boolean; seats: Array<{ id: string; name: string }>; openWork: (id: string) => void }) {
  const own = useInformationQuery<WorkItem[]>('/api/work-items', visible, 10000);
  const [all, setAll] = useState(false);
  const [offset, setOffset] = useState(0);
  const canOverview = Boolean(identity.viewWorkOverview && task.visibility === 'public');
  const overview = useInformationQuery<WorkOverviewPage>(canOverview ? `/api/work-overview/items?taskId=${encodeURIComponent(task.id)}&offset=${all ? offset : 0}&limit=${all ? 25 : 3}` : undefined, visible, 10000);
  const [selected, setSelected] = useState<WorkRow>();
  const selectedDetail = useInformationQuery<WorkDetail>(selected?.participant ? `/api/work-items/${encodeURIComponent(selected.id)}` : undefined, visible && Boolean(selected) && !own.denied, 10000);
  const selectedSummary = useInformationQuery<WorkOverviewItem>(selected && !selected.participant ? `/api/work-overview/items/${encodeURIComponent(selected.id)}` : undefined, visible && Boolean(selected) && !overview.denied, 10000);
  const name = (id: string) => seats.find(item => item.id === id)?.name || id;
  const ownItems = (own.denied ? [] : own.data || []).filter(item => item.taskSpaceId === task.id).sort((a, b) => Number(workPerspective(b, identity.seatId).bucket === 'actionable') - Number(workPerspective(a, identity.seatId).bucket === 'actionable') || b.updatedAt.localeCompare(a.updatedAt));
  const ownRows: WorkRow[] = ownItems.map(item => ({ ...item, creatorSeatName: name(item.creatorSeatId), assigneeSeatName: name(item.assigneeSeatId), participant: true }));
  const ownIds = new Set(ownRows.map(item => item.id));
  const others = overview.denied ? [] : (overview.data?.items || []).filter(item => !ownIds.has(item.id)).map(item => ({ ...item, participant: false }));
  const rows = [...ownRows, ...others].slice(0, 3);
  const failed = own.error || overview.error;
  const detail = !own.denied && !selectedDetail.denied ? selectedDetail.data : undefined;
  const summary = !overview.denied && !selectedSummary.denied ? selectedSummary.data : undefined;
  const close = () => { setSelected(undefined); own.refresh(); overview.refresh(); };
  return <section className="task-home-work" aria-label="工作进展"><header className="task-progress-heading"><h2>工作进展</h2><button onClick={() => setAll(true)}>全部工作<ArrowUpRight size={14} aria-hidden="true" /></button></header>
    {failed && <p className="resource-error" role="alert">{failed}<button onClick={() => { own.refresh(); overview.refresh(); }}>重试</button></p>}
    {!own.data && !own.error && <LoadingIndicator label="正在读取工作进展…" />}
    {own.data && !failed && !rows.length && <p className="resource-help">暂无获准的工作记录。</p>}
    <ul className="task-work-rows">{rows.map(item => <TaskWorkRow key={item.id} item={item} visible={visible && !all} open={() => setSelected(item)} />)}</ul>
    {visible && all && <Panel title="任务工作" close={() => setAll(false)} dismissOnBackdrop><ul className="task-work-rows">{(canOverview ? overview.denied ? [] : (overview.data?.items || []).map(item => ({ ...item, participant: ownIds.has(item.id) })) : ownRows).map(item => <li className="task-work-row" key={item.id}><button className="task-progress-title" onClick={() => { setAll(false); setSelected(item); }}>{item.title}<ChevronRight size={14} aria-hidden="true" /></button><p className="task-progress-meta">{item.creatorSeatName} → {item.assigneeSeatName} · {workStateLabel[item.state]}</p></li>)}</ul>{overview.error && <p className="resource-error" role="alert">{overview.error}</p>}{canOverview && <InformationPagination page={overview.data} change={setOffset} />}</Panel>}
    {visible && selected && <Panel title={selected.title} close={close} dismissOnBackdrop>{(selected.participant ? own.error || selectedDetail.error : overview.error || selectedSummary.error) && <p className="resource-error" role="alert">{selected.participant ? own.error || selectedDetail.error : overview.error || selectedSummary.error}</p>}{selected.participant ? detail?.id === selected.id ? <><p className="task-progress-meta">{name(detail.creatorSeatId)} → {name(detail.assigneeSeatId)} · {workStateLabel[detail.state]}</p><InformationText>{detail.goal}</InformationText><WorkAttachments detail={detail} />{detail.submissions.length > 1 && <details><summary>提交记录</summary>{detail.submissions.map(item => <div className="task-work-file" key={item.id}><p>第 {item.attempt} 次提交 · {informationTime(item.createdAt)}</p><HandoffFiles files={[item.file]} />{item.review && <p>{item.review.decision === 'accept' ? '验收通过' : '已退回'}{item.review.reason ? ` · ${item.review.reason}` : ''}</p>}</div>)}</details>}<button onClick={() => { close(); openWork(selected.id); }}>进入原工作<ArrowUpRight size={14} aria-hidden="true" /></button></> : !own.denied && !selectedDetail.error && <LoadingIndicator label="正在读取工作…" /> : summary?.id === selected.id ? <><p>{summary.creatorSeatName} → {summary.assigneeSeatName}</p><p>{workStateLabel[summary.state]} · {informationTime(summary.updatedAt)}</p><p className="resource-help">提交 {summary.submissionCount} 次</p></> : !overview.denied && !selectedSummary.error && <LoadingIndicator label="正在读取工作摘要…" />}</Panel>}
  </section>;
}
const executionLabels: Record<VehicleExecutionState, string> = { waiting: '待出发', en_route: '途中', blocked: '受阻', arrived: '已到场', cancelled: '已取消' };
export function TaskExecutionProgress({ taskId, visible, openCommand }: { taskId: string; visible: boolean; openCommand: (id: string) => void }) {
  const query = useInformationQuery<TaskExecutionSummary>(`/api/tasks/${encodeURIComponent(taskId)}/execution-summary`, visible, 10000);
  if (!query.error && (!query.data || !query.data.available)) return null;
  const value = query.denied ? undefined : query.data;
  return <section className="task-home-execution" aria-label="执行进展"><header className="task-progress-heading"><h2>执行进展</h2><button className="icon-button" aria-label="刷新执行进展" onClick={query.refresh}><RefreshCw size={15} aria-hidden="true" /></button></header>{query.error && <p className="resource-error" role="alert">{query.error}</p>}{value && <>
    {value.businessNow && <p className="task-progress-meta">业务时点 {informationTime(value.businessNow)}</p>}
    {value.counts && <div className="task-execution-counts">{(Object.keys(executionLabels) as VehicleExecutionState[]).filter(state => value.counts![state] > 0).map(state => <span key={state} className={`execution-${state}`}>{value.counts![state]} 辆{executionLabels[state]}</span>)}</div>}
    {!value.complete && <p className="resource-help">执行资料未查全，暂不汇总。</p>}
    {!value.groups.length && <p className="resource-help">暂无执行记录。</p>}
    <details><summary>车辆明细</summary>{value.groups.map(group => <div className="task-execution-group" key={group.id}><div className="task-progress-heading"><p>{group.destination.name}{group.status === 'saved' ? ' · 已保存记录' : group.status === 'unsupported' ? ' · 仅接收记录' : ''}</p>{group.commandId && <button onClick={() => openCommand(group.commandId!)}>指令详情<ArrowUpRight size={14} aria-hidden="true" /></button>}</div>{group.businessNow && <p className="task-progress-meta">业务时点 {informationTime(group.businessNow)}</p>}{group.reason && <p className="resource-help">{group.reason}</p>}<ul>{group.vehicles.map(vehicle => <li key={`${vehicle.ref.systemId}:${vehicle.ref.objectId}`}><span>{vehicle.name}</span><span>{executionLabels[vehicle.state]}{vehicle.blockedReason ? ` · ${vehicle.blockedReason}` : ''}</span></li>)}</ul></div>)}</details>
  </>}</section>;
}
