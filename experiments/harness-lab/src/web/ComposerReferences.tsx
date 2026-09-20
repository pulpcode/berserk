import { useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref, type RefObject } from 'react';
import { ArrowLeft, BookOpen, Bot, ChevronRight, FileText, Folder, Upload, X } from 'lucide-react';
import type { AgentInfo, LoadedComposerSelection, SkillFile, SkillInfo, WorkspaceResources } from '../contracts/index';
import type { FileEntry, FileList } from '../contracts/files';
import type { DraftSelection } from './useComposerSelections';
import { useApi } from './api';
import { Panel } from './Resources';

type Mode = 'categories' | 'files' | 'skills' | 'agents' | 'menu';
type Picker = { scope: string; mode: Mode; query: string; directory: string; offset: number; index: number; fragment?: { start: number; end: number; text: string } };
type Option = { kind: 'category'; mode: 'files' | 'agents'; name: string; description: string } | { kind: 'file'; file: FileEntry } | { kind: 'skill'; skill: SkillInfo } | { kind: 'agent'; agent: AgentInfo };
export interface ComposerReferenceHandle {
  open: (mode?: Mode) => void;
  input: (text: string, caret: number, allowTrigger: boolean) => void;
  keyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  close: () => void;
  caret: (start: number, end: number) => void;
}
function trigger(text: string, caret: number) {
  const match = /(?:^|\s)([@/])([^\s@]*)$/.exec(text.slice(0, caret));
  if (!match) return;
  const start = caret - match[2]!.length - 1;
  return { mode: match[1] === '@' ? 'categories' as const : 'skills' as const, query: match[2]!, fragment: { start, end: caret, text: text.slice(start, caret) } };
}
function splitPath(query: string, directory: string) {
  const slash = query.lastIndexOf('/');
  return slash < 0 ? { path: directory, search: query } : { path: query.slice(0, slash), search: query.slice(slash + 1) };
}
const failure = (error: unknown) => error instanceof Error ? error.message : '列表读取失败，请重试。';

export function SelectionHistory({ selections }: { selections?: LoadedComposerSelection }) {
  const [open, setOpen] = useState(false);
  if (!selections?.skill && !selections?.agent) return null;
  return <><div className="selection-chips" aria-label="本条消息使用的能力">
    {selections.skill && <button type="button" className="selection-chip" aria-label={`Skill · ${selections.skill.name}`} onClick={() => setOpen(true)}><BookOpen size={15} aria-hidden="true" />{selections.skill.name}</button>}
    {selections.agent && <span className="selection-chip" aria-label={`Agents：${selections.agent.name}`}><Bot size={15} aria-hidden="true" />{selections.agent.name}</span>}
  </div>{open && selections.skill && <Panel title={`本次使用的 Skill · ${selections.skill.name}`} close={() => setOpen(false)}><p>{selections.skill.description}</p><pre className="skill-content">{selections.skill.content}</pre></Panel>}</>;
}

export function ComposerReferences({ control, scope, workspaceId, enabled, fileEnabled, text, textarea, selection, setText, select, reference, upload }: {
  control: Ref<ComposerReferenceHandle>; scope: string; workspaceId: string; enabled: boolean; fileEnabled: boolean;
  text: string; textarea: RefObject<HTMLTextAreaElement | null>; selection: DraftSelection;
  setText: (value: string) => void; select: (kind: 'skill' | 'agent', value?: SkillInfo | AgentInfo) => void;
  reference: (file: FileEntry) => boolean; upload: () => void;
}) {
  const { api, domId } = useApi();
  const [state, setState] = useState<Picker>();
  const picker = enabled && state?.scope === scope ? state : undefined;
  const root = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<{ key: string; options: Option[]; files?: FileList; error?: string }>();
  const [retry, setRetry] = useState(0);
  const [detail, setDetail] = useState<{ scope: string; file: SkillFile }>();
  const [detailError, setDetailError] = useState<{ scope: string; message: string }>();
  const detailRequest = useRef({ value: 0 });
  useEffect(() => { const request = detailRequest.current; request.value++; return () => { request.value++; }; }, [scope, enabled]);
  const pathQuery = splitPath(picker?.query || '', picker?.directory || '');
  const queryKey = picker && picker.mode !== 'menu' && picker.mode !== 'categories' ? JSON.stringify([scope, workspaceId, picker.mode, pathQuery.path, pathQuery.search, picker.query, picker.offset, retry]) : '';
  const options: Option[] = picker?.mode === 'categories' ? [
    ...(fileEnabled ? [{ kind: 'category' as const, mode: 'files' as const, name: '项目文件或文件夹', description: '浏览当前项目，选择要引用的文件' }] : []),
    { kind: 'category', mode: 'agents', name: 'Agents', description: '选择参与本轮任务的只读角色' },
  ] : result?.key === queryKey ? result.options : [];
  const loading = Boolean(queryKey && result?.key !== queryKey);
  const index = Math.min(picker?.index || 0, Math.max(0, options.length - 1));
  const listId = domId('composer-references');
  useEffect(() => {
    if (!queryKey) return;
    const [, , mode, path, search, rawQuery, offset] = JSON.parse(queryKey) as [string, string, Mode, string, string, string, number, number];
    let live = true;
    const base = `/api/workspaces/${encodeURIComponent(workspaceId)}`;
    const query = rawQuery.toLocaleLowerCase();
    const files = fileEnabled && mode === 'files';
    void Promise.all([
      files ? api<FileList>(`${base}/files?${new URLSearchParams({ path, search, offset: String(offset), limit: '20' })}`) : undefined,
      mode === 'agents' ? api<AgentInfo[]>(`${base}/agents`) : undefined,
      mode === 'skills' ? api<WorkspaceResources>(`${base}/resources`) : undefined,
    ]).then(([fileList, agents, resources]) => {
      if (!live) return;
      const items: Option[] = [
        ...(fileList?.entries || []).map(file => ({ kind: 'file' as const, file })),
        ...(agents || []).filter(agent => `${agent.name} ${agent.description}`.toLocaleLowerCase().includes(query)).map(agent => ({ kind: 'agent' as const, agent })),
        ...(resources?.skills || []).filter(skill => `${skill.id} ${skill.name} ${skill.description}`.toLocaleLowerCase().includes(query)).map(skill => ({ kind: 'skill' as const, skill })),
      ];
      setResult({ key: queryKey, options: items, files: fileList });
    }).catch((error: unknown) => { if (live) setResult({ key: queryKey, options: [], error: failure(error) }); });
    return () => { live = false; };
  }, [api, fileEnabled, queryKey, workspaceId]);
  // Close on outside pointer/focus without changing the unselected trigger text.
  useEffect(() => {
    if (!picker) return;
    const outside = (event: Event) => { if (event.target !== textarea.current && !root.current?.contains(event.target as Node)) setState(undefined); };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, [picker, textarea]);
  useEffect(() => { if (picker) root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [index, options.length, picker]);
  useEffect(() => {
    const input = textarea.current;
    if (!input) return;
    if (picker && picker.mode !== 'menu') {
      input.setAttribute('aria-controls', listId); input.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-haspopup', 'listbox');
      if (options.length) input.setAttribute('aria-activedescendant', `${listId}-${index}`); else input.removeAttribute('aria-activedescendant');
    } else for (const attr of ['aria-controls', 'aria-expanded', 'aria-haspopup', 'aria-activedescendant']) input.removeAttribute(attr);
  }, [picker, textarea, listId, index, options.length]);
  function finish() {
    const fragment = picker?.fragment;
    let caret = textarea.current?.selectionStart ?? text.length;
    if (fragment && text.slice(fragment.start, fragment.end) === fragment.text) {
      setText(text.slice(0, fragment.start) + text.slice(fragment.end)); caret = fragment.start;
    }
    setState(undefined);
    requestAnimationFrame(() => { const input = textarea.current; if (input?.isConnected) { input.focus(); input.setSelectionRange(caret, caret); } });
  }
  function navigate(directory: string) {
    if (!picker) return;
    if (picker.fragment) {
      const fragmentText = `@${directory ? `${directory}/` : ''}`;
      const start = picker.fragment.start, end = start + fragmentText.length;
      setText(text.slice(0, start) + fragmentText + text.slice(picker.fragment.end));
      setState({ ...picker, directory: '', query: fragmentText.slice(1), offset: 0, index: 0, fragment: { start, end, text: fragmentText } });
      requestAnimationFrame(() => { const input = textarea.current; if (input?.isConnected) { input.focus(); input.setSelectionRange(end, end); } });
    } else setState({ ...picker, directory, query: '', offset: 0, index: 0 });
  }
  function backToCategories() {
    if (!picker) return;
    const fragment = picker.fragment;
    if (fragment) {
      setText(text.slice(0, fragment.start) + '@' + text.slice(fragment.end));
      const end = fragment.start + 1;
      setState({ ...picker, mode: 'categories', query: '', directory: '', offset: 0, index: 0, fragment: { start: fragment.start, end, text: '@' } });
      requestAnimationFrame(() => { const input = textarea.current; if (input?.isConnected) { input.focus(); input.setSelectionRange(end, end); } });
    } else setState({ ...picker, mode: 'categories', query: '', directory: '', offset: 0, index: 0 });
  }
  function choose(option: Option) {
    if (!picker) return;
    if (option.kind === 'category') { setState({ ...picker, mode: option.mode, offset: 0, index: 0 }); textarea.current?.focus(); return; }
    if (option.kind === 'file') {
      if (option.file.kind === 'directory') { navigate(option.file.path); return; }
      if (!reference(option.file)) return;
    } else if (option.kind === 'skill') select('skill', option.skill);
    else select('agent', option.agent);
    finish();
  }
  function open(mode: Mode = 'menu') { setState({ scope, mode, query: '', directory: '', offset: 0, index: 0 }); }
  useImperativeHandle(control, () => ({
    open,
    close: () => setState(undefined),
    caret: (start, end) => { if (picker?.fragment && (start !== end || start !== picker.fragment.end)) setState(undefined); },
    input: (value, caret, allowed) => {
      const candidate = allowed ? trigger(value, caret) : undefined;
      const found = candidate && (candidate.fragment.text.length === 1 || picker?.fragment?.start === candidate.fragment.start) ? candidate : undefined;
      setState(found ? { scope, ...found, mode: found.mode === 'categories' && picker?.fragment?.start === found.fragment.start && (picker.mode === 'files' || picker.mode === 'agents') ? picker.mode : found.mode, directory: picker?.fragment?.start === found.fragment.start ? picker.directory : '', offset: 0, index: 0 } : undefined);
    },
    keyDown: event => {
      if (!picker) return false;
      if (picker.fragment && (['Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(event.key) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a'))) { setState(undefined); return false; }
      if (event.key === 'Escape') { event.preventDefault(); setState(undefined); return true; }
      if (event.key === 'Enter') { event.preventDefault(); if (options[index]) choose(options[index]); return true; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); setState({ ...picker, index: options.length ? (index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length : 0 }); return true;
      }
      return false;
    },
  }));
  async function viewSkill(skill: SkillInfo) {
    const token = ++detailRequest.current.value;
    try {
      const file = await api<SkillFile>(`/api/workspaces/${encodeURIComponent(workspaceId)}/skills/${encodeURIComponent(skill.id)}`);
      if (token !== detailRequest.current.value) return;
      if (file.hash !== skill.hash) throw new Error('Skill 已更新，请重新选择后查看。');
      setDetail({ scope, file }); setDetailError(undefined);
    } catch (error) { if (token === detailRequest.current.value) setDetailError({ scope, message: failure(error) }); }
  }
  return <div ref={root} className="composer-references">
    {(selection.skill || selection.agent) && <div className="selection-chips" aria-label="本轮选择">
      {selection.skill && <span className="selection-chip"><button type="button" title="查看 Skill 内容" aria-label={`查看 Skill：${selection.skill.name}`} onClick={() => void viewSkill(selection.skill!)}><BookOpen size={15} aria-hidden="true" />{selection.skill.name}</button><button type="button" aria-label="移除 Skill" onClick={() => select('skill')}><X size={14} /></button></span>}
      {selection.agent && <span className="selection-chip" aria-label={`Agents：${selection.agent.name}`} title={selection.agent.description}><Bot size={15} aria-hidden="true" />{selection.agent.name}<button type="button" aria-label="移除 Agents" onClick={() => select('agent')}><X size={14} /></button></span>}
    </div>}
    {detailError?.scope === scope && <p className="attachment-notice" role="alert">{detailError.message}</p>}
    {picker && <div className={`reference-popover${picker.mode === 'categories' ? ' reference-categories' : ''}`} aria-label="选择引用" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setState(undefined); textarea.current?.focus(); } }}>
      {picker.mode === 'menu' ? <div className="reference-menu">
        {fileEnabled && <><button type="button" onClick={() => { setState(undefined); upload(); }}><Upload size={16} aria-hidden="true" />上传文件</button><button type="button" onClick={() => open('files')}><Folder size={16} aria-hidden="true" />引用文件</button></>}
        <button type="button" onClick={() => open('skills')}><BookOpen size={16} aria-hidden="true" />使用 Skill</button><button type="button" onClick={() => open('agents')}><Bot size={16} aria-hidden="true" />Agents</button>
      </div> : <>
        {picker.mode !== 'categories' && <div className="reference-heading">
          <div className="reference-title">{picker.fragment?.text.startsWith('@') && <button type="button" className="icon-button" aria-label="返回类别" title="返回类别" onClick={backToCategories}><ArrowLeft size={16} /></button>}<strong>{picker.mode === 'skills' ? 'Skill' : picker.mode === 'agents' ? 'Agents' : '项目文件'}</strong>{picker.mode === 'agents' && <span className="reference-readonly">只读</span>}</div>
          <button type="button" className="icon-button" aria-label="关闭选择" onClick={() => { setState(undefined); textarea.current?.focus(); }}><X size={16} /></button>
        </div>}
        {!picker.fragment && <input autoFocus aria-label="筛选引用" value={picker.query} placeholder={picker.mode === 'files' ? '文件名或目录/文件名' : '按名称或说明筛选'} onChange={event => setState({ ...picker, query: event.target.value, offset: 0, index: 0 })} onKeyDown={event => { if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return; if (event.key === 'Enter') { event.preventDefault(); if (options[index]) choose(options[index]); } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setState({ ...picker, index: options.length ? (index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length : 0 }); } }} />}
        {picker.mode === 'files' && <div className="reference-directory"><button type="button" disabled={!pathQuery.path} onClick={() => navigate(pathQuery.path.split('/').slice(0, -1).join('/'))}><ArrowLeft size={14} />上一级</button><span title={pathQuery.path || '项目根目录'}>{pathQuery.path ? `/ ${pathQuery.path}` : '根目录'}</span></div>}
        {loading ? <p role="status">正在读取…</p> : result?.key === queryKey && result.error ? <p role="alert">{result.error}<button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></p> : <div role="listbox" id={listId} aria-label="可选引用" className="reference-options">
          {options.map((option, position) => <div key={option.kind === 'category' ? `category:${option.mode}` : option.kind === 'file' ? `file:${option.file.path}` : option.kind === 'skill' ? `skill:${option.skill.id}` : `agent:${option.agent.name}`}>
            <button type="button" role="option" title={option.kind === 'file' ? option.file.path : option.kind === 'category' ? undefined : option.kind === 'skill' ? option.skill.description : option.agent.description} id={`${listId}-${position}`} aria-selected={position === index} onPointerDown={event => event.preventDefault()} onClick={() => choose(option)}>
              {option.kind === 'category' ? option.mode === 'files' ? <Folder size={17} /> : <Bot size={17} /> : option.kind === 'file' ? option.file.kind === 'directory' ? <Folder size={17} /> : <FileText size={17} /> : option.kind === 'skill' ? <BookOpen size={17} /> : <Bot size={17} />}
              <span><strong>{option.kind === 'category' ? option.name : option.kind === 'file' ? option.file.name : option.kind === 'skill' ? option.skill.name : option.agent.name}</strong>{option.kind !== 'category' && <small>{option.kind === 'file' ? option.file.path : option.kind === 'skill' ? option.skill.description : option.agent.description}</small>}</span>{(option.kind === 'category' || (option.kind === 'file' && option.file.kind === 'directory')) && <ChevronRight className="reference-next" size={15} aria-hidden="true" />}
            </button>
          </div>)}
          {!options.length && <p>没有匹配项</p>}
        </div>}
        {result?.key === queryKey && result.files && result.files.total > result.files.limit && <div className="reference-pagination"><button type="button" disabled={!picker.offset} onClick={() => setState({ ...picker, offset: Math.max(0, picker.offset - 20), index: 0 })}>上一页</button><span>{picker.offset + 1}–{Math.min(picker.offset + 20, result.files.total)} / {result.files.total}</span><button type="button" disabled={picker.offset + 20 >= result.files.total} onClick={() => setState({ ...picker, offset: picker.offset + 20, index: 0 })}>下一页</button></div>}
      </>}
    </div>}
    {detail?.scope === scope && enabled && <Panel title={`Skill · ${detail.file.name}`} close={() => setDetail(undefined)}><p>{detail.file.description}</p><pre className="skill-content">{detail.file.content}</pre></Panel>}
  </div>;
}
