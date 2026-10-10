import type { AccessStore } from '../access/store.js';
import type { BackgroundService } from '../background/service.js';
import type { CollaborationService } from '../collaboration/service.js';
import type { Identity } from '../contracts/access.js';
import type { WorkbenchItem, WorkbenchPage, WorkOverviewItem, WorkOverviewPage } from '../contracts/workbench.js';
import { workPerspective } from '../contracts/workbench.js';
import { RequestError } from '../contracts/errors.js';

export interface WorkbenchFilter { bucket?: 'actionable'|'following'|'done'|'all'; kind?: 'work'|'information'|'delivery_review'; taskId?:string; search?:string; offset?:number; limit?:number }
export interface OverviewFilter { taskId?:string; seatId?:string; status?:string; search?:string; offset?:number; limit?:number }
function paginate<T>(items:T[], filter:{offset?:number;limit?:number}) {
  const offset = filter.offset ?? 0, limit = filter.limit ?? 25;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new RequestError('INVALID_INPUT','分页参数无效。');
  return {items:items.slice(offset,offset+limit),total:items.length,offset,limit};
}
/** Query projection only: authorization precedes search, counts and paging. */
export class WorkbenchService {
  constructor(private readonly access:AccessStore, private readonly collaboration?:CollaborationService, private readonly background?:BackgroundService) {}
  private current(actor:Identity) {
    const identity = this.access.identity(actor.userId);
    if (!identity || identity.seatId !== actor.seatId) throw new RequestError('AUTH_REQUIRED','请重新登录。',401);
    return identity;
  }
  items(identity:Identity, filter:WorkbenchFilter = {}): WorkbenchPage {
    const actor = this.current(identity);
    const sections:WorkbenchPage['sections'] = {work:this.collaboration?'available':'unavailable',information:this.background?'available':'unavailable',delivery_review:'unavailable'};
    let items:WorkbenchItem[] = [];
    const tasks = new Map(this.access.list(actor.seatId).map(task => [task.id,task]));
    if (this.collaboration) try {
      items = this.collaboration.list(actor).filter(work => tasks.has(work.taskSpaceId)).map(work => ({key:`work:${work.id}`,id:work.id,kind:'work',title:work.title,state:work.state,...workPerspective(work,actor.seatId),source:`${this.access.seatName(work.creatorSeatId)} → ${this.access.seatName(work.assigneeSeatId)}`,tasks:[{id:work.taskSpaceId,title:tasks.get(work.taskSpaceId)!.title}],updatedAt:work.updatedAt}));
    } catch { sections.work = 'error'; }
    if (this.background) try {
      const background = this.background;
      const information:WorkbenchItem[] = background.inboxItems(actor).map(item => {
        const linkedTasks = background.taskLinks.effectiveTasks(actor,item.event.id,item.job.id);
        const handling = item.handling;
        return {key:`information:${item.delivery.id}`,id:item.delivery.id,kind:'information',title:item.event.title,state:handling.state,bucket:handling.state === 'pending' ? 'actionable' : handling.state === 'completed' ? 'done' : 'legacy',label:handling.state === 'pending' ? '待处理' : handling.state === 'completed' ? '已处理' : '历史未登记',source:item.sourceName ?? item.event.sourceId,tasks:linkedTasks,updatedAt:handling.updatedAt,jobId:item.job.id,analysisAt:item.job.createdAt};
      });
      items.push(...information);
    } catch { sections.information = 'error'; }
    if (this.background) try {
      const background = this.background, reviews = background.workbenchReviews(actor);
      sections.delivery_review = reviews.available ? 'available' : 'unavailable';
      items.push(...reviews.items.map((review):WorkbenchItem => ({key:`delivery_review:${review.id}`,id:review.id,kind:'delivery_review',title:review.title,state:review.status,bucket:review.status === 'pending' ? 'actionable' : 'done',label:review.status === 'pending' ? '待我批准' : review.status === 'approved' ? '已批准' : '不予补充',source:review.sourceName,updatedAt:review.updatedAt,tasks:background.taskLinks.effectiveTasks(actor,review.eventId,review.jobId),jobId:review.jobId,analysisAt:background.store.getJob(review.jobId).createdAt})));
    } catch { sections.delivery_review = 'error'; }
    items = items.filter(item => (!filter.kind || item.kind === filter.kind) && (!filter.taskId || item.tasks.some(task => task.id === filter.taskId)) && (!filter.search || item.title.toLocaleLowerCase().includes(filter.search.toLocaleLowerCase())));
    items.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || a.key.localeCompare(b.key));
    const incomplete = filter.kind ? sections[filter.kind] === 'error' : Object.values(sections).includes('error');
    const counts:WorkbenchPage['counts'] = {actionable:null,following:null,done:null,all:null};
    if (!incomplete) {
      counts.all = items.length;
      for (const bucket of ['actionable','following','done'] as const) counts[bucket] = items.filter(item => item.bucket === bucket).length;
    }
    const bucket = filter.bucket ?? 'actionable';
    return {...paginate(items.filter(item => bucket === 'all' || item.bucket === bucket),filter),counts,sections,generatedAt:new Date().toISOString()};
  }
  private overviewItems(identity:Identity): WorkOverviewItem[] {
    const actor = this.current(identity);
    if (!actor.viewWorkOverview) throw new RequestError('FORBIDDEN','当前席位没有工作总览权限。',403);
    return this.collaboration?.overview(actor) ?? [];
  }
  overview(identity:Identity, filter:OverviewFilter = {}): WorkOverviewPage {
    const items = this.overviewItems(identity).filter(item => (!filter.taskId || item.taskSpaceId === filter.taskId) && (!filter.seatId || item.creatorSeatId === filter.seatId || item.assigneeSeatId === filter.seatId) && (!filter.status || item.state === filter.status) && (!filter.search || item.title.toLocaleLowerCase().includes(filter.search.toLocaleLowerCase())));
    items.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    return paginate(items,filter);
  }
  overviewItem(identity:Identity, id:string): WorkOverviewItem {
    const item = this.overviewItems(identity).find(item => item.id === id);
    if (!item) throw new RequestError('WORK_NOT_FOUND','工作不存在或无权访问。',404);
    return item;
  }
}
