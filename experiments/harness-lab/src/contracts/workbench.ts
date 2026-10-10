import type { WorkItem, WorkState } from './collaboration.js';
import type { BackgroundPage } from './background.js';

export type WorkbenchBucket = 'actionable' | 'following' | 'done' | 'legacy';
export interface WorkbenchItem {
  key: string; id: string; kind: 'work' | 'information' | 'delivery_review'; title: string;
  state: string; bucket: WorkbenchBucket; label: string; source: string;
  tasks: Array<{id:string;title:string}>; updatedAt: string;
  /** Information versions remain distinct even when titles and tasks match. */
  jobId?: string; analysisAt?: string;
}
export interface WorkbenchPage extends BackgroundPage<WorkbenchItem> {
  /** Null means some sections failed; never report incomplete totals as zero. */
  counts: Record<'actionable'|'following'|'done'|'all',number|null>;
  sections: Record<'work'|'information'|'delivery_review','available'|'unavailable'|'error'>;
  generatedAt: string;
}
export interface WorkOverviewItem {
  id: string; title: string; taskSpaceId: string; taskTitle: string;
  creatorSeatId: string; assigneeSeatId: string; creatorSeatName: string; assigneeSeatName: string;
  state: WorkState; createdAt: string; updatedAt: string;
  submissionCount: number; latestSubmittedAt?: string; participant: boolean;
}
export type WorkOverviewPage = BackgroundPage<WorkOverviewItem>;
/** Both formal workbench and scoped test UI share this responsibility mapping. */
export function workPerspective(work: Pick<WorkItem,'state'|'creatorSeatId'|'assigneeSeatId'>, seatId: string): {bucket:WorkbenchBucket;label:string} {
  if (work.state === 'completed') return {bucket:'done',label:'已完成'};
  const assignee = work.assigneeSeatId === seatId;
  if (work.state === 'submitted') return assignee ? {bucket:'following',label:'等待验收'} : {bucket:'actionable',label:'待我验收'};
  if (assignee) return {bucket:'actionable',label:work.state === 'assigned' ? '待签收' : work.state === 'returned' ? '待修改' : '办理中'};
  return {bucket:'following',label:work.state === 'assigned' ? '待对方签收' : work.state === 'returned' ? '等待重新提交' : '对方办理中'};
}
