import { useEffect } from 'react';
import { ClipboardList, MessageCircle, X } from 'lucide-react';
import type { TaskSpace } from '../contracts/access';
import type { WorkItem, WorkState } from '../contracts/collaboration';
import type { Workspace } from '../contracts';
import { useApi } from './api';
import { LoadingIndicator } from './LoadingIndicator';
import { useInformationQuery } from './information-ui';
import type { useWorkActivity } from './useWorkActivity';
import { groupWorkActivity, type WorkActivityGroup } from './work-activity-items';

const labels: Record<WorkState, string> = { assigned: '待接收', working: '办理中', returned: '退回修改', submitted: '已提交 · 待验收', completed: '已完成' };
type Activity = ReturnType<typeof useWorkActivity>;

export function WorkActivityPanel({ id, sessionId, seatId, visible, personalOnly, tasks, workspaces, seats, activity, enabled, close, openWork }: {
  id: string; sessionId: string; seatId?: string; visible: boolean; personalOnly: boolean; tasks: TaskSpace[]; workspaces: Workspace[];
  seats: Array<{ id: string; name: string }>; activity: Activity; enabled: boolean;
  close: () => void; openWork: (id: string) => void;
}) {
  const { domId } = useApi();
  const works = useInformationQuery<WorkItem[]>('/api/work-items', visible && !personalOnly && Boolean(seatId), 10000);
  const discard = works.discard;
  useEffect(() => { if (!visible) discard(); }, [visible, discard]);
  const available = works.error ? undefined : works.data;
  const mine = available?.filter(item => item.assigneeSeatId === seatId) || [];
  const waiting = mine.filter(item => item.state === 'assigned');
  const working = mine.filter(item => item.state === 'working' || item.state === 'returned');
  const submitted = mine.filter(item => item.state === 'submitted');
  const title = (taskId: string) => tasks.find(task => task.id === taskId)?.title || workspaces.find(workspace => workspace.taskSpaceId === taskId)?.name || '任务空间';
  const rows = (items: WorkItem[]) => <ul className="work-activity-list">{items.map(item => <li key={item.id}>
    <button type="button" className="work-activity-link" title={`${item.title}\n${labels[item.state]} · ${title(item.taskSpaceId)}\n来自 ${seats.find(seat => seat.id === item.creatorSeatId)?.name || item.creatorSeatId}`} onClick={() => openWork(item.id)}><ClipboardList size={17} strokeWidth={1.75} aria-hidden="true" /><span>{item.title}</span></button>
  </li>)}</ul>;
  const businessState = works.error ? <p className="work-activity-error" role="status">{works.error}<button type="button" onClick={works.refresh}>重新读取</button></p>
    : !works.data ? <LoadingIndicator label="正在读取工作" /> : null;
  const result = activity.response?.status === 'ready' ? activity.response : undefined;
  const reason = activity.view?.reason;
  const actionableReason = reason && !['对话处理结束后再识别工作。', '本对话尚无可分析的完整回复。'].includes(reason) ? reason : undefined;
  const emptyMessage = !enabled ? '识别已关闭' : actionableReason;
  const items = groupWorkActivity(activity.view?.facts || [], (result?.items || []).filter(item => !activity.ignored.has(item.id)));
  // Pending acceptance and submitted states stay in their authoritative business sections.
  const processing = items.filter(({ item }) => {
    const state = available?.find(work => work.id === item.workItemId)?.state || item.state;
    return item.relation === 'processing' && item.recency === 'current' && !['assigned', 'submitted', 'completed'].includes(state || '');
  });
  const processingIds = new Set(processing.map(group => group.item.workItemId).filter(Boolean));
  const todo = working.filter(item => !processingIds.has(item.id));
  const countReady = !activity.loading && !activity.analyzing && !activity.error && (result || !enabled || !sessionId);

  const earlier = items.filter(group => group.item.relation === 'processing' && group.item.recency === 'earlier');
  const others = items.filter(group => group.item.relation !== 'processing');
  const renderActivity = ({ item, fact, analysis }: WorkActivityGroup) => {
    const detail = [item.title, item.state && labels[item.state],
      item.relation === 'reference' ? '仅供参考' : item.relation === 'uncertain' ? '未能确认' : undefined,
      fact?.description, analysis?.description].filter(Boolean).join('\n');
    return <li key={item.workItemId || item.id} className="work-activity-item">
      {item.workItemId ? <button type="button" className="work-activity-link" title={detail} onClick={() => openWork(item.workItemId!)}><ClipboardList size={17} strokeWidth={1.75} aria-hidden="true" /><span>{item.title}</span></button>
        : <span className="work-activity-link" tabIndex={0} title={detail}><MessageCircle size={17} strokeWidth={1.75} aria-hidden="true" /><span>{item.title}</span></span>}
      {analysis && <button type="button" className="work-activity-ignore" title="忽略本次判断" aria-label={`忽略${item.title}的本次判断`} onClick={() => activity.ignore(analysis.id)}><X size={14} aria-hidden="true" /></button>}
    </li>;
  };
  return <aside id={id} className="work-activity-panel" aria-label="工作面板" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
    <button type="button" className="icon-button work-activity-close" onClick={close} aria-label="收起工作面板"><X size={17} aria-hidden="true" /></button>
    <div className="work-activity-content">
      {!personalOnly && <section aria-labelledby={domId('work-activity-waiting')}>
        <h3 id={domId('work-activity-waiting')}>待接收工作{available && <span>{waiting.length}</span>}</h3>
        {businessState || (waiting.length ? rows(waiting) : null)}
      </section>}
      <section aria-labelledby={domId('work-activity-processing')}>
        <h3 id={domId('work-activity-processing')}>本对话处理中{countReady && <span>{processing.length}</span>}</h3>
          {!sessionId ? null : activity.loading ? <LoadingIndicator label="正在读取会话工作" /> : <>
            {activity.analyzing && <LoadingIndicator label="正在识别工作" />}
            {activity.error && <p className="work-activity-error" role="status">{activity.error}<button type="button" disabled={activity.analyzing} onClick={activity.retry}>重新识别</button></p>}
            {processing.length > 0 && <ul className="work-activity-list">{processing.map(renderActivity)}</ul>}
            {earlier.length > 0 && <details className="work-activity-other"><summary>此前处理 {earlier.length}</summary><ul className="work-activity-list">{earlier.map(renderActivity)}</ul></details>}
            {others.length > 0 && <details className="work-activity-other"><summary>参考与待确认 {others.length}</summary><ul className="work-activity-list">{others.map(renderActivity)}</ul></details>}
            {!activity.analyzing && !activity.error && !items.length && emptyMessage && <p className="work-activity-empty">{emptyMessage}</p>}
            {result?.coverage === 'partial' && <p className="work-activity-caption" title="本次仅覆盖部分对话或工作，可能有遗漏。">部分结果</p>}
          </>}
      </section>
      {!personalOnly && <section aria-labelledby={domId('work-activity-todo')}>
        <h3 id={domId('work-activity-todo')}>席位待办{available && <span>{todo.length}</span>}</h3>
        {businessState || (todo.length ? rows(todo) : null)}
      </section>}
      {!personalOnly && submitted.length > 0 && <details className="work-activity-submitted"><summary>已提交 · 待验收 {submitted.length}</summary>{rows(submitted)}</details>}
    </div>
  </aside>;
}
