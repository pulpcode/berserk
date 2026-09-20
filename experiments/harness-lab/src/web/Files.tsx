import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, FileText, Folder, Paperclip, RefreshCw, Upload, X } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { FileEntry, FileList, FileOutput, FileRef, FileStatus } from '../contracts/files';
import { useApi, checkResponse } from './api';
import { Panel } from './Resources';
import type { DraftAttachment } from './useAttachments';

export function fileSize(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`; }
export const currentFileUrl = (workspaceId: string, path: string) => `/api/workspaces/${encodeURIComponent(workspaceId)}/files/content?path=${encodeURIComponent(path)}`;
export function HistoricalFile({ file, workspaceId }: { file: FileRef; workspaceId: string }) {
  const { url } = useApi();
  const [status, setStatus] = useState<FileStatus>();
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => request.current?.abort(), []);
  async function inspect() {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(''); setStatus(undefined);
    try {
      const response = await checkResponse(await fetch(url(`/api/workspaces/${encodeURIComponent(workspaceId)}/files/status?${new URLSearchParams({ path: file.path, hash: file.hash })}`), { cache: 'no-store', signal: controller.signal }));
      const result = await response.json() as FileStatus;
      if (!controller.signal.aborted) setStatus(result);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '文件状态读取失败，请重试。'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  return <li className="historical-file"><button onClick={() => void inspect()} disabled={loading} aria-label={`查看引用文件 ${file.name}`}><Paperclip size={14} aria-hidden="true" />{file.name}</button><small>引用路径：{file.path}</small>{loading && <small role="status">正在核对文件…</small>}{error && <small className="resource-error" role="alert">{error}</small>}{status && <><small role="status">{status.state === 'missing' ? '此路径的文件已不可用，请重新选择文件。' : status.state === 'changed' ? '文件已修改，下面链接为当前文件。' : '核对时文件与发送时一致。'}</small>{status.state !== 'missing' && <a href={url(currentFileUrl(workspaceId, file.path))} download={file.name}>下载当前文件</a>}</>}</li>;
}
export function FileOutputCard({ file }: { file: FileOutput }) {
  const { url } = useApi();
  return <div className="file-output" aria-label={`可下载文件：${file.name}`}><FileText size={22} aria-hidden="true" /><div><strong>{file.name}</strong><small>{fileSize(file.size)} · 本次交付的内容</small></div><a href={url(`/api/workspaces/${encodeURIComponent(file.workspaceId)}/downloads/${encodeURIComponent(file.downloadId)}`)} download={file.name} aria-label={`下载 ${file.name}`}><Download size={18} aria-hidden="true" />下载</a></div>;
}
export function Attachments({ items, remove, retry, notice }: { items: DraftAttachment[]; remove: (item: DraftAttachment) => void; retry: (item: DraftAttachment) => void; notice?: string }) {
  return <div className="attachments"><ul aria-label="消息附件">{items.map(item => <li key={item.id} className={`attachment ${item.status}`}><Paperclip size={16} aria-hidden="true" /><div className="attachment-detail"><strong>{item.name}</strong>{item.originalName && item.originalName !== item.name && <small>原文件名：{item.originalName}</small>}<small>{fileSize(item.size)} · {item.status === 'ready' ? item.uploadId ? '已保存到工作区' : '工作区文件' : item.status === 'failed' ? '未完成' : item.progress === 100 ? '正在保存…' : `上传中 ${item.progress}%`}</small>{item.path && item.path !== item.name && <small>{item.path}</small>}{item.status === 'uploading' && <progress aria-label={`${item.name} 上传进度`} value={item.progress} max={100} />}{item.error && <p className="resource-error" role="alert">{item.error}</p>}</div>{item.status === 'failed' && <button type="button" onClick={() => retry(item)} aria-label={`核对并重试 ${item.name}`}>核对并重试</button>}<button type="button" className="icon-button" onClick={() => remove(item)} aria-label={`${item.status === 'uploading' ? '取消上传' : '移除引用'} ${item.name}`} title={item.status === 'uploading' ? '取消未完成的上传' : '仅移除引用，文件仍保留在工作区'}><X size={16} /></button></li>)}</ul>{notice && <p className="attachment-notice" role="status">{notice}</p>}</div>;
}
function Preview({ workspaceId, entry }: { workspaceId: string; entry: FileEntry }) {
  const { url } = useApi();
  const [content, setContent] = useState<{ text?: string; image?: string }>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); let image: string | undefined;
    void (async () => {
      try {
        const response = await checkResponse(await fetch(url(`${currentFileUrl(workspaceId, entry.path)}&preview=1`), { signal: controller.signal, cache: 'no-store' }));
        const type = response.headers.get('content-type')?.split(';')[0];
        if (type === 'image/png' || type === 'image/jpeg') { image = URL.createObjectURL(await response.blob()); if (!controller.signal.aborted) setContent({ image }); else URL.revokeObjectURL(image); }
        else if (type === 'text/plain') { const text = await response.text(); if (!controller.signal.aborted) setContent({ text }); }
        else throw new Error('此格式暂不支持预览，请下载查看。');
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '读取失败，请下载查看。'); }
    })();
    return () => { controller.abort(); if (image) URL.revokeObjectURL(image); };
  }, [workspaceId, entry.path, url]);
  return <section className="file-preview" aria-label={`${entry.name} 预览`}><h3>{entry.name}</h3><p className="resource-help">工作区中的当前内容</p>{error ? <p role="status">{error}</p> : !content ? <p role="status">正在读取文件…</p> : content.image ? <img src={content.image} alt={entry.name} /> : /\.md$/i.test(entry.name) ? <div className="markdown-preview"><Markdown remarkPlugins={[remarkGfm]} components={{ img: ({ alt }) => <span>[图片：{alt || '未加载'}]</span>, a: ({ children }) => <span>{children}</span>, table: ({ children }) => <div className="markdown-table" role="region" tabIndex={0} aria-label="文件表格，可横向滚动"><table>{children}</table></div> }}>{content.text}</Markdown></div> : <pre tabIndex={0}>{content.text}</pre>}</section>;
}
export function FilesPanel({ workspaceId, name, close, upload, reference, attachments, refreshKey, executionAvailable }: {
  workspaceId: string; name: string; close: () => void; upload: (files: File[]) => void; reference: (file: FileEntry) => boolean; attachments: React.ReactNode; refreshKey: string; executionAvailable: boolean;
}) {
  const { api, url } = useApi();
  const [path, setPath] = useState(''); const [search, setSearch] = useState(''); const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0); const [listing, setListing] = useState<FileList>(); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<FileEntry>(); const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let current = true;
    void api<FileList>(`/api/workspaces/${encodeURIComponent(workspaceId)}/files?${new URLSearchParams({ path, search, offset: String(offset), limit: '50' })}`).then(result => { if (current) { setListing(result); setError(''); } }).catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : '文件列表读取失败。'); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [workspaceId, path, search, offset, reload, refreshKey, api]);
  const refresh = () => { setLoading(true); setReload(value => value + 1); };
  const navigate = (next: string) => { setPath(next); setOffset(0); setPreview(undefined); setListing(undefined); setLoading(true); };
  return <Panel title={`${name} · 文件`} close={close} className="files-panel"><div className="files-toolbar"><button onClick={() => input.current?.click()}><Upload size={16} aria-hidden="true" />上传文件</button><button onClick={refresh} disabled={loading} aria-label="刷新文件列表"><RefreshCw size={16} aria-hidden="true" />刷新</button><input ref={input} className="visually-hidden" tabIndex={-1} type="file" multiple aria-label="上传项目文件" onChange={event => { upload(Array.from(event.target.files || [])); event.target.value = ''; }} /></div><p className="resource-help">文件由当前席位的会话共用。上传后立即保存，可在对话中引用并继续处理。</p>{!executionAvailable && <p className="resource-help" role="status">可以上传和查看文件；处理环境尚未就绪。</p>}{attachments}<label className="file-search">搜索当前目录<input type="search" value={search} onChange={event => { setSearch(event.target.value); setOffset(0); setLoading(true); }} placeholder="按文件名搜索" /></label><div className="file-breadcrumb"><button disabled={!path} onClick={() => navigate(path.split('/').slice(0, -1).join('/'))} aria-label="上级目录"><ArrowLeft size={16} /></button><span>{path || '项目文件'}</span></div>{error && <p className="resource-error" role="alert">{error}</p>}{loading ? <p role="status">正在读取文件列表…</p> : <ul className="file-list" aria-label="项目文件列表">{listing?.entries.map(entry => <li key={entry.path}>{entry.kind === 'directory' ? <button className="file-name" onClick={() => navigate(entry.path)}><Folder size={18} aria-hidden="true" /><span>{entry.name}</span></button> : <><button className="file-name" onClick={() => setPreview(entry)} aria-label={`预览 ${entry.name}`}><FileText size={18} aria-hidden="true" /><span>{entry.name}<small>{fileSize(entry.size || 0)}</small></span></button><button className="icon-button" onClick={() => { if (reference(entry)) close(); }} aria-label={`引用 ${entry.name}`}><Paperclip size={17} /></button><a className="icon-button" href={url(currentFileUrl(workspaceId, entry.path))} download={entry.name} aria-label={`下载当前文件 ${entry.name}`}><Download size={17} /></a></>}</li>)}{listing?.entries.length === 0 && <li className="file-empty">{search ? '没有匹配的文件。' : '此目录还没有文件，可以先上传。'}</li>}</ul>}{listing && listing.total > listing.limit && <div className="file-pagination"><button disabled={offset === 0 || loading} onClick={() => { setLoading(true); setOffset(value => Math.max(0, value - 50)); }}>上一页</button><span>{offset + 1}–{Math.min(offset + listing.limit, listing.total)} / {listing.total}</span><button disabled={offset + listing.limit >= listing.total || loading} onClick={() => { setLoading(true); setOffset(value => value + 50); }}>下一页</button></div>}{preview && <Preview key={`${preview.path}:${reload}`} workspaceId={workspaceId} entry={preview} />}</Panel>;
}
