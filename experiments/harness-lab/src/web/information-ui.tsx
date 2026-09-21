import { useCallback, useEffect, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { BackgroundAnalysisSummary, BackgroundFile, BackgroundJobStatus, BackgroundPage } from '../contracts/background';
import { checkResponse, useApi } from './api';
import { fileSize } from './Files';

export const jobLabels: Record<BackgroundJobStatus | 'preparing' | 'conversation_ready', string> = {
  queued: '排队中', running: '执行中', succeeded: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断',
  preparing: '正在准备', conversation_ready: '已创建对话',
};
export const deliveryLabels = { pending: '待投递', delivered: '已送达', failed: '投递失败' };
export function informationError(error: unknown) { return error instanceof Error ? error.message : '操作未完成，请重试。'; }
export function informationTime(value?: string) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'; }

/** Poll only visible pages; old requests cannot populate a new selection or identity. */
export function useInformationQuery<T>(path: string | undefined, visible: boolean, interval = 4000) {
  const { api } = useApi();
  const [result, setResult] = useState<{ path: string; data: T }>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!path || !visible) return;
    let current = true; let pending = false;
    const load = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try { const data = await api<T>(path); if (current) { setResult({ path, data }); setError(''); } }
      catch (reason) { if (current) setError(informationError(reason)); }
      finally { pending = false; }
    };
    void load();
    const timer = window.setInterval(() => void load(), interval);
    const focus = () => { void load(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    return () => { current = false; clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [api, path, visible, interval, revision]);
  return { data: result && result.path === path ? result.data : undefined, error, refresh };
}
export function InformationText({ children }: { children: string }) {
  return <div className="information-text"><Markdown remarkPlugins={[remarkGfm]} components={{
    img: ({ alt }) => <span>[图片：{alt || '未加载'}]</span>,
    a: ({ children }) => <span>{children}</span>,
    table: ({ children }) => <div className="markdown-table" role="region" aria-label="信息表格" tabIndex={0}><table>{children}</table></div>,
  }}>{children}</Markdown></div>;
}
export function InformationFiles({ files, base }: { files: BackgroundFile[]; base: string }) {
  const { request, url } = useApi(); const [error, setError] = useState(''); const [busy, setBusy] = useState('');
  async function download(file: BackgroundFile) {
    if (busy) return; setBusy(file.id); setError('');
    try {
      const response = await checkResponse(await request(url(`${base}/${encodeURIComponent(file.id)}`), { cache: 'no-store' }));
      const blob = URL.createObjectURL(await response.blob()); const link = document.createElement('a');
      link.href = blob; link.download = file.name; link.click(); window.setTimeout(() => URL.revokeObjectURL(blob), 1000);
    } catch (reason) { setError(informationError(reason)); } finally { setBusy(''); }
  }
  return <><ul className="information-files">{files.map(file => <li key={file.id}><FileText size={17} aria-hidden="true" /><span>{file.name}<small>{fileSize(file.size)}</small></span><button disabled={Boolean(busy)} onClick={() => void download(file)} aria-label={`下载 ${file.name}`}><Download size={15} aria-hidden="true" />{busy === file.id ? '下载中' : '下载'}</button></li>)}</ul>{error && <p className="resource-error" role="alert">{error}</p>}</>;
}
export function InformationPagination({ page, change }: { page?: BackgroundPage<unknown>; change: (offset: number) => void }) {
  if (!page || page.total <= page.limit) return null;
  return <nav className="information-pagination" aria-label="列表分页"><span>共 {page.total} 项 · 第 {Math.floor(page.offset / page.limit) + 1} 页</span><button disabled={page.offset === 0} onClick={() => change(Math.max(0, page.offset - page.limit))}>上一页</button><button disabled={page.offset + page.limit >= page.total} onClick={() => change(page.offset + page.limit)}>下一页</button></nav>;
}
export function AnalysisHistory({ items, seats, openSession }: { items: BackgroundAnalysisSummary[]; seats: Array<{ id: string; name: string }>; openSession: (id: string) => void }) {
  return <section><h3>人员后续分析</h3>{!items.length ? <p className="resource-help">尚未发起分析。</p> : <ul className="information-timeline">{items.map(item => <li key={item.id}><div><strong>{seats.find(seat => seat.id === item.seatId)?.name || item.seatId}</strong><span>{item.mode === 'background' ? '后台分析' : '对话分析'} · {jobLabels[item.status]}</span></div><small>{informationTime(item.createdAt)}</small>{item.sessionId && <button onClick={() => openSession(item.sessionId!)}>进入关联对话</button>}</li>)}</ul>}</section>;
}
