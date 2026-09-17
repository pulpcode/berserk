import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { CompactionDetail, InstructionFile, SkillFile, WorkspaceResources } from '../contracts/index';
import { api } from './api';
import type { useInstructions } from './useInstructions';

export function Panel({ title, children, close, className = '' }: { title: string; children: ReactNode; close: () => void; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className={`resource-panel ${className}`} aria-label={title} onCancel={event => { event.preventDefault(); close(); }}>
    <header className="panel-header"><h2>{title}</h2><button className="icon-button" aria-label="关闭面板" onClick={close} autoFocus><X size={20} /></button></header>
    <div className="panel-body">{children}</div>
  </dialog>;
}

export function Resources({ workspaceId, name, resources, instructions, resourceError, reloadResources, close }: {
  workspaceId: string; name: string; resources?: WorkspaceResources;
  instructions: ReturnType<typeof useInstructions>; resourceError?: string; reloadResources: () => void; close: () => void;
}) {
  const [common, setCommon] = useState<InstructionFile>();
  const [skill, setSkill] = useState<SkillFile>();
  const [error, setError] = useState('');
  const [skillLoading, setSkillLoading] = useState(false);
  const skillToken = useRef({ value: 0 });
  const [commonReload, setCommonReload] = useState(0);
  const editor = instructions.editors[workspaceId];
  const saving = instructions.saving[workspaceId];
  const loading = instructions.loading[workspaceId];
  const readError = instructions.readErrors[workspaceId];
  const composing = useRef(false);
  const { read } = instructions;
  useEffect(() => {
    let current = true;
    const token = skillToken.current;
    void read(workspaceId);
    api<InstructionFile>(`/api/workspaces/${encodeURIComponent(workspaceId)}/instructions/common`).then(file => { if (current) { setCommon(file); setError(''); } }).catch((error: unknown) => { if (current) setError(error instanceof Error ? error.message : '通用指令读取失败。'); });
    return () => { current = false; token.value++; };
  }, [workspaceId, read, commonReload]);
  const review = Boolean(editor?.review);
  const changed = editor?.draft !== editor?.base.content;
  const save = () => { if (editor && !saving && (!review || editor.canMerge)) void instructions.save(workspaceId, review); };
  async function loadSkill(id: string) {
    const token = ++skillToken.current.value;
    setSkillLoading(true); setError(''); setSkill(undefined);
    try {
      const result = await api<SkillFile>(`/api/workspaces/${encodeURIComponent(workspaceId)}/skills/${encodeURIComponent(id)}`);
      if (token === skillToken.current.value) setSkill(result);
    } catch (error) { if (token === skillToken.current.value) setError(error instanceof Error ? error.message : 'Skill 读取失败。'); }
    finally { if (token === skillToken.current.value) setSkillLoading(false); }
  }
  return <Panel title={`${name} · 项目资料`} close={close}>
    <section className="resource-section">
      <h3>项目指令</h3><p className="resource-help">这些约定用于本项目的每个会话，保存后下次发送时生效。</p>
      {editor ? <>
        <div className={`instruction-comparison${editor.latest ? ' comparing' : ''}`}>
          <div><label htmlFor="instruction-draft">你的草稿{changed ? ' · 未保存' : ''}</label>
            <textarea id="instruction-draft" value={editor.draft} spellCheck={false} onChange={event => instructions.edit(workspaceId, event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => {
              if ((event.metaKey || event.ctrlKey) && event.key === 's' && !composing.current && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); save(); }
            }} />
          </div>
          {editor.latest && <div className="latest-instructions"><h4>最新内容</h4><pre aria-label="最新内容（只读）" tabIndex={0}>{editor.latest.content || '（空文件）'}</pre><small>已读取版本：{editor.latest.hash || '文件不存在'}</small></div>}
        </div>
        {editor.error && <p role="alert" className="resource-error">{editor.error}</p>}
        {editor.message && <p role="status" className="resource-success">{editor.message}</p>}
        <div className="resource-actions">
          {!review ? <button className="primary-action" disabled={saving} onClick={() => void instructions.save(workspaceId)}>{saving ? '保存中…' : '保存指令'}</button> : <button className="primary-action" disabled={saving || loading || !editor.latest || !editor.canMerge} onClick={() => void instructions.save(workspaceId, true)}>{saving ? '保存中…' : '合并后保存'}</button>}
          <button disabled={saving || loading} onClick={() => void read(workspaceId, true)}>{loading ? '读取中…' : '查看最新内容'}</button>
          <button disabled={saving} onClick={() => instructions.edit(workspaceId, '')}>清空草稿</button>
          <button disabled={saving || !editor.latest} onClick={() => instructions.discard(workspaceId)}>放弃草稿，使用最新内容</button>
        </div>
        <p className="resource-help">Ctrl / ⌘ + S 保存。查看与放弃草稿仅更新页面；请自行对照整理后保存。</p>
      </> : <p role="status">{loading ? '正在读取项目指令…' : '尚未读取项目指令。'}</p>}
      {readError && <div className="resource-error" role="alert">{readError}<button disabled={loading} onClick={() => void read(workspaceId, Boolean(editor))}>重试读取指令</button></div>}
    </section>
    <section className="resource-section"><h3>通用指令（只读）</h3>{common ? <pre className="resource-text" tabIndex={0}>{common.content || '（空文件）'}</pre> : <p>通用指令尚未读取。<button onClick={() => setCommonReload(value => value + 1)}>重新读取通用指令</button></p>}</section>
    <section className="resource-section"><h3>资料（只读）</h3>{resourceError && <div className="resource-error" role="alert">{resourceError}<button onClick={reloadResources}>重新读取资料</button></div>}{resources?.sources.map(source => <div className="resource-card" key={source.id}><strong>{source.title}</strong><p>{source.description}</p><small>引用 ID：{source.id}</small></div>)}</section>
    <section className="resource-section"><h3>Skill（只读）</h3><p className="resource-help">对话中可按需使用的工作方法。</p><div className="skill-list">{resources?.skills.map(item => <button key={item.id} onClick={() => void loadSkill(item.id)}><strong>{item.name}</strong><span>{item.description}</span><small>版本 {item.version}</small></button>)}</div>
      {skillLoading && <p role="status">正在读取 Skill…</p>}{skill && <div className="skill-detail"><h4>{skill.name} · {skill.version}</h4><pre className="resource-text" tabIndex={0}>{skill.content}</pre></div>}
    </section>
    {error && <p role="alert" className="resource-error">{error}</p>}
  </Panel>;
}

function CompactionContent({ sessionId, entryId }: { sessionId: string; entryId: string }) {
  const [detail, setDetail] = useState<CompactionDetail>();
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    api<CompactionDetail>(`/api/sessions/${encodeURIComponent(sessionId)}/compactions/${encodeURIComponent(entryId)}`)
      .then(result => { if (current) { setDetail(result); setError(''); } })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : '摘要详情读取失败。'); });
    return () => { current = false; };
  }, [sessionId, entryId, reload]);
  if (error) return <p className="resource-error" role="alert">{error}<button onClick={() => setReload(value => value + 1)}>重试读取摘要</button></p>;
  if (!detail) return <p role="status">正在读取摘要…</p>;
  return <div className="compaction-detail">
    <p className="resource-help">摘要用于后续上下文，原始消息和工具结果仍保留在对话中。</p>
    <dl className="compaction-metadata">
      <dt>生成时间</dt><dd>{new Date(detail.createdAt).toLocaleString('zh-CN')}</dd>
      <dt>触发原因</dt><dd>{detail.reason === 'threshold' ? '接近上下文容量' : detail.reason === 'overflow' ? '上下文超限恢复' : '未记录'}</dd>
      <dt>模型</dt><dd>{detail.model || '未记录'}</dd>
      <dt>压缩前估算</dt><dd>{detail.tokensBefore.toLocaleString()} token</dd>
      <dt>压缩后估算</dt><dd>{detail.tokensAfter === null ? '未记录' : `${detail.tokensAfter.toLocaleString()} token`}</dd>
      <dt>摘要实际用量</dt><dd>{detail.usage ? `${detail.usage.totalTokens.toLocaleString()} token` : '未知'}</dd>
      <dt>原文保留起点</dt><dd>{detail.firstKeptEntryId}</dd>
    </dl>
    <pre className="resource-text compaction-summary" aria-label="压缩摘要正文（只读）" tabIndex={0}>{detail.summary}</pre>
  </div>;
}
export function CompactionPanel({ sessionId, entryId, close }: { sessionId: string; entryId: string; close: () => void }) {
  return <Panel title="上下文压缩摘要" close={close}><CompactionContent key={entryId} sessionId={sessionId} entryId={entryId} /></Panel>;
}
