import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { InstructionFile, RequestResourcesRecord, SkillFile, WorkspaceResources } from '../contracts/index';
import { api } from './api';
import type { useInstructions } from './useInstructions';

export function Panel({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="resource-panel" aria-label={title} onCancel={event => { event.preventDefault(); close(); }}>
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
  return <Panel title={`${name} · 工作区资料`} close={close}>
    <section className="resource-section">
      <h3>工作区指令</h3><p className="resource-help">这些约定用于本工作区的每个会话，保存后下次发送时生效。</p>
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
      </> : <p role="status">{loading ? '正在读取工作区指令…' : '尚未读取工作区指令。'}</p>}
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

export function RequestResources({ sessionId, requestId, close }: { sessionId: string; requestId?: string; close: () => void }) {
  const [record, setRecord] = useState<RequestResourcesRecord>();
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!requestId) return;
    let current = true;
    api<RequestResourcesRecord>(`/api/sessions/${encodeURIComponent(sessionId)}/requests/${encodeURIComponent(requestId)}/resources`).then(result => { if (current) { setRecord(result); setError(''); } }).catch((error: unknown) => { if (current) setError(error instanceof Error ? error.message : '本轮资料读取失败。'); });
    return () => { current = false; };
  }, [requestId, sessionId, reload]);
  return <Panel title="本轮实际加载的资料" close={close}>
    <p className="resource-help">这是发送当时的只读记录，当前编辑不会改变这份记录。</p>
    {!requestId ? <p>该历史请求未记录指令。</p> : error ? <p role="alert" className="resource-error">{error}<button onClick={() => setReload(value => value + 1)}>重试读取</button></p> : !record ? <p role="status">正在读取本轮资料…</p> : record.status === 'unavailable' ? <p>{record.message}</p> : <>
      {record.instructions.map(file => <section className="resource-section" key={file.fileId}><h3>{file.name}</h3><pre className="resource-text" tabIndex={0}>{file.content || '（空文件）'}</pre><small className="resource-hash">内容 hash：{file.hash || '未记录'}</small></section>)}
      <section className="resource-section"><h3>本轮已读取的 Skill</h3>{record.readSkills.length ? record.readSkills.map(file => <details key={file.id}><summary>{file.name} · {file.version}</summary><pre className="resource-text" tabIndex={0}>{file.content}</pre><small className="resource-hash">内容 hash：{file.hash}</small></details>) : <p>本轮没有读取 Skill。</p>}</section>
    </>}
  </Panel>;
}
