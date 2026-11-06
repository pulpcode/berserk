import { ArrowUpRight } from 'lucide-react';
import type { BackgroundEventDetail } from '../contracts/background';
import type { TaskLinksView } from '../contracts/task-information';
import { useInformationQuery } from './information-ui';

/** Only saved, authorized message/task relations become director navigation. */
export function DirectorEventTasks({eventId, shownTaskIds, openTask}: {eventId: string; shownTaskIds: string[]; openTask: (id: string) => void}) {
  const event = useInformationQuery<BackgroundEventDetail>(`/api/information/events/${encodeURIComponent(eventId)}`, true, 5000);
  // Jobs arrive in persisted creation order, newest first. An incomplete new
  // judgment does not replace an older complete one; manual decisions still apply.
  const successful = event.data?.jobs.filter(job => job.kind === 'preprocess' && job.status === 'succeeded');
  const job = successful?.find(item => item.taskAssessment) ?? successful?.[0];
  const links = useInformationQuery<TaskLinksView>(job ? `/api/information/events/${encodeURIComponent(eventId)}/task-links?jobId=${encodeURIComponent(job.id)}` : undefined, true, 5000);
  const tasks = links.data?.links.filter(link => link.mode !== 'exclude' && !shownTaskIds.includes(link.task.id)) ?? [];
  const error = event.error || links.error;
  if (error) return <small role="status" title={error}>任务关联暂不可用</small>;
  if (!tasks.length) return null;
  return <div className="director-event-tasks"><span>关联任务</span>{tasks.map(({task}) => <button key={task.id} onClick={() => openTask(task.id)}>{task.title}<ArrowUpRight size={13} aria-hidden="true"/></button>)}</div>;
}
