import { useEffect, useState } from 'react';
import { ArrowLeft, Download, FileText, Folder, RefreshCw } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { HandoffFile, HandoffImportResult } from '../contracts/collaboration';
import type { FileList } from '../contracts/files';
import { checkResponse, useApi } from './api';
import { fileSize } from './Files';

export function HandoffFiles({ files, workspaceId }: { files: HandoffFile[]; workspaceId?: string }) {
  return <ul className="handoff-files">{files.map(file => <HandoffFileRow key={file.fileId} file={file} workspaceId={workspaceId} />)}</ul>;
}
function HandoffFileRow({ file, workspaceId }: { file: HandoffFile; workspaceId?: string }) {
  const { api, url } = useApi();
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savePath, setSavePath] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function importFile() {
    if (saving || !workspaceId) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const result = await api<HandoffImportResult>(`/api/handoff-files/${encodeURIComponent(file.fileId)}/import`, { workspaceId, ...(savePath.trim() ? { path: savePath.trim() } : {}) });
      setMessage(`已复制到项目文件：${result.path}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '复制未完成，请核对项目文件后重试。'); }
    finally { setSaving(false); }
  }
  return <li><div className="handoff-file-row"><FileText size={18} aria-hidden="true" /><span><strong>{file.name}</strong><small>{fileSize(file.size)} · 固定副本</small></span><button onClick={() => setPreview(value => !value)} aria-expanded={preview}>{preview ? '收起预览' : '查看'}</button><a href={url(`/api/handoff-files/${encodeURIComponent(file.fileId)}`)} download={file.name} aria-label={`下载交接文件 ${file.name}`}><Download size={16} aria-hidden="true" />下载</a></div>{preview && <FixedPreview file={file} />}{workspaceId && <details className="handoff-import"><summary>复制到我的项目文件</summary><label>另存路径（可选）<input value={savePath} placeholder="留空保存到收到资料目录" onChange={event => setSavePath(event.target.value)} /></label><button disabled={saving} onClick={() => void importFile()}>{saving ? '复制中…' : '确认复制'}</button><p className="resource-help">不会覆盖已有的不同内容；同名冲突时请填写其他路径。</p></details>}{message && <p role="status" className="resource-success">{message}</p>}{error && <p role="alert" className="resource-error">{error}</p>}</li>;
}
function FixedPreview({ file }: { file: HandoffFile }) {
  const { url } = useApi();
  const [content, setContent] = useState<{ text?: string; image?: string }>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); let image: string | undefined;
    void (async () => {
      try {
        const response = await checkResponse(await fetch(url(`/api/handoff-files/${encodeURIComponent(file.fileId)}?preview=1`), { signal: controller.signal, cache: 'no-store' }));
        const type = response.headers.get('content-type')?.split(';')[0];
        if (type === 'image/png' || type === 'image/jpeg') { image = URL.createObjectURL(await response.blob()); if (!controller.signal.aborted) setContent({ image }); else URL.revokeObjectURL(image); }
        else if (type === 'text/plain') { const text = await response.text(); if (!controller.signal.aborted) setContent({ text }); }
        else throw new Error('此格式请下载查看。');
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '预览读取失败，请下载查看。'); }
    })();
    return () => { controller.abort(); if (image) URL.revokeObjectURL(image); };
  }, [file.fileId, url]);
  return <section className="file-preview" aria-label={`${file.name} 固定副本预览`}>{error ? <p role="status">{error}</p> : !content ? <p role="status">正在读取副本…</p> : content.image ? <img src={content.image} alt={file.name} /> : /\.md$/i.test(file.name) ? <Markdown remarkPlugins={[remarkGfm]} components={{ img: ({ alt }) => <span>[图片：{alt || '未加载'}]</span>, a: ({ children }) => <span>{children}</span>, table: ({ children }) => <div className="markdown-table" role="region" tabIndex={0} aria-label="交接文件表格"><table>{children}</table></div> }}>{content.text}</Markdown> : <pre tabIndex={0}>{content.text}</pre>}</section>;
}

/** Select ordinary workspace paths. This does not upload/copy until preparation succeeds. */
export function WorkFilePicker({ workspaceId, selected, onChange, multiple = false, maxFiles = 1 }: { workspaceId: string; selected: string[]; onChange: (paths: string[]) => void; multiple?: boolean; maxFiles?: number }) {
  const { api } = useApi();
  const [path, setPath] = useState(''); const [search, setSearch] = useState(''); const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0); const [list, setList] = useState<FileList>(); const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    api<FileList>(`/api/workspaces/${encodeURIComponent(workspaceId)}/files?${new URLSearchParams({ path, search, offset: String(offset), limit: '50' })}`).then(result => { if (current) { setList(result); setError(''); } }).catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : '无法读取文件。'); });
    return () => { current = false; };
  }, [api, workspaceId, path, search, offset, reload]);
  const navigate = (value: string) => { setPath(value); setList(undefined); setOffset(0); };
  return <fieldset className="work-file-picker"><legend>{multiple ? '输入资料（可选，多选）' : '选择提交文件'}</legend><label>搜索当前目录<input type="search" value={search} onChange={event => { setSearch(event.target.value); setOffset(0); }} /></label><div className="file-breadcrumb"><button type="button" disabled={!path} onClick={() => navigate(path.split('/').slice(0, -1).join('/'))} aria-label="选择文件：上级目录"><ArrowLeft size={16} /></button><span>{path || '项目文件'}</span><button type="button" onClick={() => setReload(value => value + 1)} aria-label="刷新可选文件"><RefreshCw size={16} /></button></div>{error && <p role="alert" className="resource-error">{error}</p>}{!list ? <p role="status">正在读取文件…</p> : <ul className="work-file-options">{list.entries.map(file => <li key={file.path}>{file.kind === 'directory' ? <button type="button" onClick={() => navigate(file.path)}><Folder size={16} aria-hidden="true" />{file.name}</button> : <label><input type={multiple ? 'checkbox' : 'radio'} name={`work-file-${workspaceId}`} checked={selected.includes(file.path)} disabled={multiple && !selected.includes(file.path) && selected.length >= maxFiles} onChange={event => onChange(multiple ? event.target.checked ? [...selected, file.path] : selected.filter(value => value !== file.path) : [file.path])} /><span>{file.name}<small>{fileSize(file.size || 0)}</small></span></label>}</li>)}{!list.entries.length && <li>此目录没有可选文件。</li>}</ul>}{list && list.total > list.limit && <div className="file-pagination"><button type="button" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>上一页</button><button type="button" disabled={offset + list.limit >= list.total} onClick={() => setOffset(value => value + 50)}>下一页</button></div>}{selected.length > 0 && <ul className="selected-work-files" aria-label="已选文件">{selected.map(value => <li key={value}><span>{value}</span><button type="button" onClick={() => onChange(selected.filter(path => path !== value))} aria-label={`取消选择 ${value}`}>移除</button></li>)}</ul>}</fieldset>;
}
