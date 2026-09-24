import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { BackgroundJobStatus, BackgroundPage, InformationJobSummary } from '../contracts/background';
import { deliveryLabels, InformationPagination, informationTime, jobLabels, useInformationQuery } from './information-ui';

export const jobColumns = [
  { id: 'queued', title: '排队中', statuses: 'queued' },
  { id: 'running', title: '执行中', statuses: 'running' },
  { id: 'succeeded', title: '执行完成', statuses: 'succeeded' },
  { id: 'stopped', title: '异常／已停止', statuses: 'failed,interrupted,cancelled' },
] as const;
export type JobColumn = typeof jobColumns[number]['id'];
export const jobPhases = { preparing: '准备资料', waiting_model: '等待模型', generating: '生成答复', tool: '调用工具', compacting: '压缩上下文', subagent: '委派 Agent' };
export function JobStatus({ status }: { status?: BackgroundJobStatus }) {
  return <span className={`information-tag ${status || 'unmatched'}`}>{status ? jobLabels[status] : '未匹配规则'}</span>;
}
export function jobTitle(job: InformationJobSummary, seatName: (id: string) => string) {
  return job.title || (job.kind === 'preprocess' ? '自动预处理' : `${job.seatId ? seatName(job.seatId) : '席位'}分析`);
}
export function JobDeliverySummary({ job, seatName }: { job: InformationJobSummary; seatName: (id: string) => string }) {
  if (job.kind !== 'preprocess') return null;
  return <span className="information-delivery-summary">{job.deliveries?.length ? job.deliveries.map(delivery => <span className="delivery-line" key={delivery.id}>{seatName(delivery.recipientSeatId)} · {deliveryLabels[delivery.status]}</span>) : '尚无投递'}</span>;
}
export function InformationJobColumn({ column, query, offset, refreshKey, visible, selectedId, sourceName, seatName, select, page }: {
  column: typeof jobColumns[number]; query: string; offset: number; refreshKey: number; visible: boolean; selectedId: string;
  sourceName: (id: string) => string; seatName: (id: string) => string; select: (id: string) => void; page: (offset: number) => void;
}) {
  const params = new URLSearchParams(query); params.delete('status'); params.set('statuses', column.statuses); params.set('offset', String(offset)); params.set('limit', '10');
  const result = useInformationQuery<BackgroundPage<InformationJobSummary>>(`/api/information/jobs?${params}`, visible);
  const refresh = result.refresh;
  useEffect(() => { if (refreshKey) refresh(); }, [refreshKey, refresh]);
  return <section className={`information-job-column ${column.id}`} aria-label={`${column.title}作业`}>
    <header><h2>{column.title}</h2><span aria-label={`${column.title}共 ${result.data?.total ?? '…'} 项`}>{result.data?.total ?? '…'}</span></header>
    {result.error && <p className="resource-error" role="alert">{result.error}<button onClick={refresh}>重试</button></p>}
    {!result.data && !result.error && <p className="information-column-empty" role="status">正在读取…</p>}
    {result.data?.items.length === 0 && <p className="information-column-empty">暂无作业</p>}
    <div className="information-job-cards">{result.data?.items.map(job => <button key={job.id} type="button" className="information-job-card" data-information-id={job.id} aria-current={selectedId === job.id ? 'true' : undefined} onClick={() => select(job.id)}>
      <span className="information-card-heading"><JobStatus status={job.status} /><small>{job.kind === 'preprocess' ? '自动预处理' : '席位分析'}</small></span>
      <strong>{jobTitle(job, seatName)}</strong>
      <span>{sourceName(job.sourceId)}{job.seatId ? ` · ${seatName(job.seatId)}` : ''}</span>
      <time dateTime={job.createdAt}>{informationTime(job.createdAt)}</time>
      {job.status === 'running' && job.phase && <span className="information-card-phase">{jobPhases[job.phase]}</span>}
      {job.error && <span className="information-card-error">{job.error.message}</span>}
      <JobDeliverySummary job={job} seatName={seatName} />
    </button>)}</div>
    <InformationPagination label={`${column.title}分页`} page={result.data} change={page} />
  </section>;
}

/** A non-modal side panel keeps navigation usable; closing restores its originating card. */
export function InformationDrawer({ title, selectedId, close, children }: { title: string; selectedId: string; close: () => void; children: ReactNode }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const center = panel.current?.closest('.information-center');
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      if (!center || center.hasAttribute('hidden')) return;
      const card = Array.from(center.querySelectorAll<HTMLElement>('[data-information-id]')).find(item => item.dataset.informationId === selectedId);
      const target = card || (previous instanceof HTMLElement && previous.isConnected && previous.getClientRects().length ? previous : center.querySelector<HTMLElement>('.information-tabs [aria-current]'));
      target?.focus({ preventScroll: true });
    };
  }, [selectedId]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { event.preventDefault(); close(); } };
    document.addEventListener('keydown', keydown); return () => document.removeEventListener('keydown', keydown);
  }, [close]);
  return <aside ref={panel} className="information-detail information-drawer" aria-label={title}>
    <div className="information-drawer-heading"><h2>{title}</h2><button className="icon-button" ref={closeButton} onClick={close} aria-label={`关闭${title}`}><X size={18} aria-hidden="true" /></button></div>
    <div className="information-drawer-body">{children}</div>
  </aside>;
}
