import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDown, ArrowUp, ArrowUpRight, BookOpen, Check, CircleAlert, FileText, FolderOpen, Menu, MessageSquare, Plus, Settings, Square, X } from 'lucide-react';
import type { WorkspaceResources } from '../contracts/index';
import { useChat } from './useChat';
import { useApi } from './api';
import { useInstructions } from './useInstructions';
import { Panel, Resources, CompactionPanel } from './Resources';
import { ActivityOverview, WorkspaceNavigation } from './WorkspaceNavigation';
import { NewSession } from './NewSession';
import { ModelSettings } from './ModelSettings';
import { subagentStatus } from './SubagentCard';
import { Attachments, FilesPanel } from './Files';
import { WorkInbox, LinkedWork, type WorkInboxHandle } from './WorkInbox';
import { TaskPanel, useTasks } from './Tasks';
import type { TaskSpace } from '../contracts/access';
import type { Workspace } from '../contracts/index';
import { Seats, type SeatView } from './Seats';
import { ComposerReferences, type ComposerReferenceHandle } from './ComposerReferences';
import { ChatPresentation, type ProcessChoices } from './ChatPresentation';
import './styles.css';

function BrandMark({ small = false }: { small?: boolean }) {
  return <img className={`brand-mark${small ? ' small' : ''}`} src="/brand/axon-app-icon.svg" width={small ? 27 : 38} height={small ? 27 : 38} alt="" aria-hidden="true" />;
}

function App({ active: seatActive, seatId, seats, switchSeat, identity, logout }: SeatView) {
  const { api, domId } = useApi();
  const chat = useChat();
  const directory=useTasks(!!identity);
  const [taskPanel,setTaskPanel]=useState<{task?:TaskSpace;visibility:'public'|'private'}>();
  const [taskSearch,setTaskSearch]=useState(''); const [archived,setArchived]=useState(false);
  const navigationWorkspaces:Workspace[]=identity ? directory.tasks.filter(task=>(archived || task.state==='active') && task.title.toLowerCase().includes(taskSearch.toLowerCase())).map(task=>({id:chat.workspaces.find(w=>w.taskSpaceId===task.id)?.id || `task:${task.id}`,name:task.title,createdAt:task.createdAt,taskSpaceId:task.id,seatId})) : chat.workspaces;
  const taskFor=(id:string)=>directory.tasks.find(task=>task.id===(id.startsWith('task:') ? id.slice(5) : chat.workspaces.find(w=>w.id===id)?.taskSpaceId));
  const currentTask=taskFor(chat.workspaceId);
  const taskMeta=identity ? Object.fromEntries(navigationWorkspaces.map(w=>[w.id,{visibility:taskFor(w.id)!.visibility,state:taskFor(w.id)!.state}])) : undefined;
  const showTask=(id:string)=>{const task=taskFor(id);if(task)setTaskPanel({task,visibility:task.visibility});};
  const refreshModelInfo = chat.refreshInfo;
  useEffect(() => { if (seatActive) void refreshModelInfo().catch(() => {}); }, [seatActive, refreshModelInfo]);
  const [view, setView] = useState<'chat' | 'activity' | 'work'>('chat');
  const instructions = useInstructions();
  const workControl = useRef<WorkInboxHandle>(null);
  const [resources, setResources] = useState<Record<string, WorkspaceResources>>({});
  const [resourceErrors, setResourceErrors] = useState<Record<string, string>>({});
  const [resourceReload, setResourceReload] = useState(0);
  const [resourceOpen, setResourceOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const fileLimits = chat.info?.files;
  const composerReady = !chat.loading && Boolean(chat.workspaceId) && currentTask?.state!=='archived';
  const attachmentItems = chat.attachments.all[chat.draftKey] || [];
  const blockedAttachments = attachmentItems.some(item => item.status !== 'ready');
  const uploadFiles = (files: File[]) => { if (composerReady && fileLimits?.enabled && chat.workspaceId) chat.attachments.add(chat.resolveDraftOwner(), chat.workspaceId, files, fileLimits); };
  const attachmentList = <Attachments items={attachmentItems} notice={chat.attachments.notice[chat.draftKey]} remove={item => { void chat.attachments.remove(chat.draftKey, item); }} retry={item => { void chat.attachments.retry(item); }} />;
  const [compactionDetail, setCompactionDetail] = useState<{ sessionId: string; entryId: string }>();
  const [workspaceForm, setWorkspaceForm] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creationError, setCreationError] = useState('');
  const navigationRequest = useRef(0);
  const focusAfterCreation = useRef<{ id: string; navigation: number } | undefined>(undefined);
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceCreating, setWorkspaceCreating] = useState(false);
  const workspaceCreatingRef = useRef(false);
  const currentResources = resources[chat.workspaceId];
  useEffect(() => {
    if (!chat.workspaceId) return;
    let current = true;
    const id = chat.workspaceId;
    api<WorkspaceResources>(`/api/workspaces/${encodeURIComponent(id)}/resources`).then(result => {
      if (current) { setResources(previous => ({ ...previous, [id]: result })); setResourceErrors(previous => ({ ...previous, [id]: '' })); }
    }).catch((error: unknown) => { if (current) setResourceErrors(previous => ({ ...previous, [id]: error instanceof Error ? error.message : '项目资料读取失败。' })); });
    return () => { current = false; };
  }, [api, chat.workspaceId, resourceReload]);
  async function createWorkspace() {
    if (workspaceCreatingRef.current || !workspaceName.trim()) return;
    workspaceCreatingRef.current = true; setWorkspaceCreating(true); setWorkspaceError('');
    try { await chat.createWorkspace(workspaceName.trim()); setWorkspaceForm(false); setWorkspaceName(''); setSidebarOpen(false); setView('chat'); }
    catch (error) { setWorkspaceError(error instanceof Error ? error.message : '项目创建失败，请核对列表后重试。'); }
    finally { workspaceCreatingRef.current = false; setWorkspaceCreating(false); }
  }
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [newContent, setNewContent] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const follow = useRef(true);
  const [processChoices] = useState<ProcessChoices>(() => new Map());
  const positions = useRef<Record<string, { top: number; follow: boolean }>>({});
  const renderedScrollKey = useRef('');
  const scrollKey = chat.selected || `workspace:${chat.workspaceId}`;
  const composing = useRef(false);
  const referenceControl = useRef<ComposerReferenceHandle>(null);
  useEffect(() => {
    if (newSessionOpen) return;
    const pending = focusAfterCreation.current;
    focusAfterCreation.current = undefined;
    // A native dialog restores its opener during unmount. Focus the new chat only afterward.
    if (pending && seatActive && pending.navigation === navigationRequest.current && pending.id === chat.selected && !document.querySelector('dialog[open]')) textarea.current?.focus();
  }, [newSessionOpen, seatActive, chat.selected]);
  const snapshot = chat.snapshots[chat.selected];
  const selectedActivity = chat.activities.find(session => session.id === chat.selected);
  const active = selectedActivity?.active || snapshot?.active;
  const busy = Boolean(active || chat.pending || chat.creating);
  const loadingSession = Boolean(chat.selected && !snapshot);
  const activeChild = snapshot?.subagents?.find(child => child.parentRequestId === active?.requestId && (child.status === 'running' || child.status === 'stopping'));
  const waiting = active?.phase === 'waiting_answer' || active?.phase === 'waiting_confirmation';
  const status = loadingSession || chat.loading ? '正在读取会话' : active?.status === 'stopping' ? '正在停止' : active?.phase === 'waiting_answer' ? '待回答' : active?.phase === 'waiting_confirmation' ? '待确认' : active?.phase === 'compacting' ? '正在压缩上下文' : active?.phase === 'subagent' ? activeChild ? `${activeChild.role} · ${subagentStatus(activeChild)}` : 'Agent 处理中' : busy ? '回复中' : snapshot?.lastResult?.status === 'interrupted' ? '已中断' : snapshot?.lastResult?.status === 'cancelled' ? '已停止' : snapshot?.lastResult?.status === 'succeeded' ? '' : snapshot?.lastResult?.status === 'failed' ? '回复未完成' : '';
  const messages = snapshot?.messages || [];
  const lastMessage = messages.at(-1);
  const error = chat.error || (snapshot?.lastResult?.status === 'failed' ? snapshot.lastResult.message || '本次回复未完成，请调整后重试。' : '');
  const canSend = composerReady && !busy && !loadingSession && !chat.loading && Boolean(chat.info?.configured && chat.info.contextReady) && !snapshot?.recoveryWarning && Boolean(chat.draft.trim()) && !blockedAttachments;

  useEffect(() => {
    const input = textarea.current;
    if (input) { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 180)}px`; }
  }, [chat.draft]);
  const markRead = chat.markRead;
  const selectedId = chat.selected;
  const loading = chat.loading;
  const markVisibleRead = useCallback(() => {
    const element = scroll.current;
    const result = snapshot?.lastResult;
    if (!seatActive || view !== 'chat' || sidebarOpen || resourceOpen || filesOpen || workspaceForm || newSessionOpen || settingsOpen || compactionDetail || loading || loadingSession || !element || document.visibilityState !== 'visible' || !document.hasFocus()) return;
    if (snapshot?.active || selectedActivity?.active || result?.status !== 'succeeded' || selectedActivity?.lastResult?.requestId !== result.requestId || selectedActivity.lastResult.status !== 'succeeded') return;
    if (element.scrollHeight - element.scrollTop - element.clientHeight <= 32) markRead(selectedId, result.requestId);
  }, [seatActive, view, sidebarOpen, resourceOpen, filesOpen, workspaceForm, newSessionOpen, settingsOpen, compactionDetail, loading, selectedId, markRead, loadingSession, snapshot, selectedActivity]);
  useLayoutEffect(() => {
    if (!seatActive) return;
    if (view !== 'chat') { renderedScrollKey.current = ''; return; }
    const element = scroll.current;
    if (!element || loadingSession || chat.loading) return;
    const returning = renderedScrollKey.current !== scrollKey;
    if (returning) {
      const position = positions.current[scrollKey];
      follow.current = position?.follow ?? true;
      element.scrollTop = follow.current ? element.scrollHeight : (position?.top ?? 0);
      renderedScrollKey.current = scrollKey;
    } else if (follow.current) element.scrollTop = element.scrollHeight;
    positions.current[scrollKey] = { top: element.scrollTop, follow: follow.current };
    const frame = requestAnimationFrame(() => {
      if (returning || follow.current) setNewContent(false);
      else if (busy) setNewContent(true);
      markVisibleRead();
    });
    return () => cancelAnimationFrame(frame);
  }, [seatActive, scrollKey, view, loadingSession, chat.loading, messages.length, lastMessage?.text, busy, markVisibleRead]);
  useEffect(() => {
    window.addEventListener('focus', markVisibleRead);
    document.addEventListener('visibilitychange', markVisibleRead);
    return () => { window.removeEventListener('focus', markVisibleRead); document.removeEventListener('visibilitychange', markVisibleRead); };
  }, [markVisibleRead]);
  useEffect(() => {
    const desktop = matchMedia('(min-width: 768px)');
    const resize = () => { if (desktop.matches) setSidebarOpen(false); };
    desktop.addEventListener('change', resize);
    return () => desktop.removeEventListener('change', resize);
  }, []);
  useEffect(() => { if (sidebarOpen) closeButton.current?.focus(); }, [sidebarOpen]);
  useEffect(() => {
    if (!sidebarOpen || resourceOpen || filesOpen || workspaceForm || newSessionOpen || settingsOpen || compactionDetail) return;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setSidebarOpen(false); requestAnimationFrame(() => menuButton.current?.focus()); }
      if (event.key !== 'Tab') return;
      const items = Array.from(sidebar.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary, select, input') || []).filter(item => item.getClientRects().length > 0);
      if (!items?.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, [sidebarOpen, resourceOpen, filesOpen, workspaceForm, newSessionOpen, settingsOpen, compactionDetail]);

  function closeSidebar() { setSidebarOpen(false); requestAnimationFrame(() => menuButton.current?.focus()); }
  function suggest(text: string) { chat.setDraft(text); textarea.current?.focus(); }
  function rememberPosition() {
    if (view === 'chat' && scroll.current && !loadingSession) positions.current[scrollKey] = { top: scroll.current.scrollTop, follow: follow.current };
  }
  function enterWorkspace(id: string) { if(id.startsWith('task:')){showTask(id);return;} navigationRequest.current++; rememberPosition(); chat.selectWorkspace(id); setView('chat'); setSidebarOpen(false); if (sidebarOpen || view === 'activity') requestAnimationFrame(() => textarea.current?.focus()); }
  function showActivity() { navigationRequest.current++; chat.noteNavigation(); rememberPosition(); setView('activity'); setSidebarOpen(false); requestAnimationFrame(() => document.getElementById(domId('activity-overview'))?.focus()); }
  function selectSession(id: string) {
    navigationRequest.current++;
    rememberPosition(); setView('chat'); chat.select(id); setSidebarOpen(false);
    if (sidebarOpen || view === 'activity') requestAnimationFrame(() => textarea.current?.focus());
  }
  function showWork(id?: string, assignWorkspaceId?: string) {
    navigationRequest.current++; chat.noteNavigation(); rememberPosition(); setView('work'); setSidebarOpen(false);
    workControl.current?.open(id, assignWorkspaceId);
  }
  function newChat() { rememberPosition(); setNewSessionOpen(true); }
  async function createChat(workspaceId: string) {
    const navigation = ++navigationRequest.current;
    rememberPosition(); setView('chat'); setSidebarOpen(false); setCreationError('');
    if (workspaceId.startsWith('task:')) {
      try {const workspace=await api<Workspace>(`/api/tasks/${workspaceId.slice(5)}/workspace`,{});await chat.refreshActivity();workspaceId=workspace.id;}
      catch(error){setCreationError(error instanceof Error?error.message:'工作区准备失败，请重试。');return null;}
      if(navigation!==navigationRequest.current)return null;
    }
    const id = await chat.create(workspaceId);
    if (!id) setCreationError(`在「${chat.workspaces.find(workspace => workspace.id === workspaceId)?.name || '所选项目'}」中创建对话未完成，请核对会话列表后重试。`);
    else if (newSessionOpen) focusAfterCreation.current = { id, navigation };
    else requestAnimationFrame(() => {
      if (navigation === navigationRequest.current && !document.querySelector('dialog[open]')) textarea.current?.focus();
    });
    return id;
  }

  return <div className="app-shell">
    <a className="skip-link" href={`#${domId(view === 'chat' ? 'conversation' : view === 'work' ? 'work-inbox' : 'activity-overview')}`}>{view === 'chat' ? '跳至对话' : view === 'work' ? '跳至工作待办' : '跳至全部动态'}</a>
    {sidebarOpen && <button className="sidebar-scrim" aria-label="关闭会话列表" onClick={closeSidebar} tabIndex={-1} />}
    <aside ref={sidebar} className={`sidebar${sidebarOpen ? ' open' : ''}`} aria-label="会话与资料">
      <div className="sidebar-brand"><BrandMark /><span><img className="brand-wordmark" src="/brand/axon-wordmark.svg" width="81" height="27" alt="Axon" /><span className="brand-subtitle">对话工作台</span></span><button ref={closeButton} className="icon-button mobile-only" onClick={closeSidebar} aria-label="关闭会话列表"><X size={20} /></button></div>
      {!identity && seats.length > 0 && <label className="test-seat-selector">测试席位<select aria-label="测试席位" value={seatId} onChange={event => { chat.noteNavigation(); switchSeat(event.target.value); }}>{seats.map(seat => <option key={seat.id} value={seat.id}>{seat.name}</option>)}</select></label>}
      <div className="navigation-actions">
        <button className="new-chat" aria-label="新建对话" aria-haspopup="dialog" onClick={() => void newChat()} disabled={chat.creating || chat.loading || !navigationWorkspaces.length}><Plus size={18} aria-hidden="true" /><span>新建对话</span></button>
        {!identity && <button className="create-workspace" onClick={() => { rememberPosition(); setWorkspaceForm(true); setWorkspaceError(''); }} aria-label="新建项目"><Plus size={15} aria-hidden="true" />新建项目</button>}
      </div>
      {seats.length > 0 && <button className="work-inbox-trigger" aria-pressed={view === 'work'} onClick={() => showWork()}><FileText size={17} aria-hidden="true" />工作待办</button>}
      {identity && <div className="task-filters"><input aria-label="搜索任务" placeholder="搜索任务" value={taskSearch} onChange={e=>setTaskSearch(e.target.value)}/><label><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>含已归档</label>{directory.error && <p role="alert">{directory.error}<button onClick={directory.refresh}>重试</button></p>}</div>}
      <WorkspaceNavigation taskMode={!!identity} taskMeta={taskMeta} publicAllowed={identity?.createPublicTask} createTask={visibility=>setTaskPanel({visibility})} showTask={showTask} workspaces={navigationWorkspaces} activities={chat.activities} unread={chat.unread} workspaceId={chat.workspaceId} selected={chat.selected} activityView={view === 'activity'} loading={chat.loading} creating={chat.creating} createSession={id => { void createChat(id); }} enterWorkspace={enterWorkspace} selectSession={selectSession} showActivity={showActivity} />
      <div className="sources"><button className="resources-trigger" onClick={() => setResourceOpen(true)} disabled={!chat.workspaceId}><BookOpen size={16} aria-hidden="true" />项目资料<ArrowUpRight size={14} aria-hidden="true" /></button><p>查看指令、资料与 Skill。</p></div>
      <div className="sidebar-footer">{identity && <div className="account-footer"><span>{identity.displayName}<small>{identity.seatName}</small></span><button onClick={logout}>退出</button></div>}{(!identity || identity.manageModelSettings) && <button className="settings-trigger" aria-label="设置" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog" aria-expanded={settingsOpen}><Settings size={18} aria-hidden="true" /><span>设置</span><span className="settings-trigger-model" title={chat.info?.model}>{chat.info?.model || '模型配置'}</span></button>}</div>
    </aside>

    <main className="workspace" inert={sidebarOpen || undefined}>
      <header className="workspace-header">
        <div className="header-title"><button ref={menuButton} className="icon-button mobile-only" onClick={() => setSidebarOpen(true)} aria-label="打开会话列表" aria-expanded={sidebarOpen}><Menu size={20} /></button><span>{view === 'activity' ? '全部动态' : view === 'work' ? '工作待办' : snapshot?.title || '新对话'}</span></div>
        <span className="workspace-name" title={view === 'chat' ? chat.workspace?.name : undefined}>{view === 'chat' ? chat.workspace?.name : '所有项目'}</span>
        {seats.length > 0 && view === 'chat' && (!identity || currentTask?.visibility==='public') && <button className="files-trigger" disabled={!composerReady} onClick={() => showWork(undefined, chat.workspaceId)}>分派工作</button>}
        {fileLimits?.enabled && view === 'chat' && <button className="files-trigger" onClick={() => setFilesOpen(true)} disabled={!chat.workspaceId} aria-haspopup="dialog"><FolderOpen size={16} aria-hidden="true" />文件</button>}
      </header>

      {identity && currentTask && <button className="task-detail-link" onClick={()=>showTask(chat.workspaceId)}>{currentTask.visibility==='public'?'公共任务':'席位私有'} · {currentTask.state==='archived'?'已归档 · ':''}任务说明</button>}
      {creationError && <div className="notice error-notice activity-error" role="alert"><CircleAlert size={16} aria-hidden="true" /><span>{creationError}</span><button onClick={() => setCreationError('')}>关闭提示</button></div>}
      {chat.activityError && <div className="notice error-notice activity-error" role="status"><CircleAlert size={16} aria-hidden="true" /><span>{chat.activityError}</span><button onClick={() => void chat.refreshActivity().catch(() => {})}>重新获取动态</button></div>}
      {seats.length > 0 && <WorkInbox visible={seatActive && view === 'work'} control={workControl} seatId={seatId!} seats={seats} workspaces={identity ? chat.workspaces.filter(w=>directory.tasks.some(t=>t.id===w.taskSpaceId && t.visibility==='public' && t.state==='active')) : chat.workspaces} activities={chat.activities} maxFiles={fileLimits?.maxAttachments || 20} createSession={chat.create} openSession={selectSession} refreshActivity={chat.refreshActivity} adoptSession={chat.adopt} />}
      {view === 'work' ? null : view === 'activity' ? <ActivityOverview workspaces={chat.workspaces} activities={chat.activities} unread={chat.unread} selectSession={selectSession} loading={chat.loading} /> : <>
      {snapshot?.workItemId && seats.length > 0 && <LinkedWork key={snapshot.workItemId} id={snapshot.workItemId} open={() => showWork(snapshot.workItemId)} />}
      <div id={domId('conversation')} className="conversation-scroll" ref={scroll} tabIndex={0} aria-label="对话内容" onScroll={() => {
        const element = scroll.current;
        if (!element) return;
        follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
        positions.current[scrollKey] = { top: element.scrollTop, follow: follow.current };
        if (follow.current) setNewContent(false);
        markVisibleRead();
      }}>
        {loadingSession || chat.loading ? <div className="loading-conversation" role="status"><span className="loading-dot" />正在读取会话…</div> : messages.length === 0 && !snapshot?.interactions?.length ? <div className="empty-state">
          <div className="welcome-symbol"><BrandMark /></div>
          <p className="eyebrow">想法，从这里展开</p>
          <h1>今天，我们一起处理什么？</h1>
          <p className="welcome-copy">说出你的目标，随时追问、补充或调整。<br />从梳理信息，到形成清晰的思路。</p>
          <div className="suggestions">
            <button onClick={() => suggest('我想梳理一个问题，请先帮我明确目标和需要补充的信息。')}><MessageSquare size={19} aria-hidden="true" /><strong>一起梳理思路</strong><span>从一个问题开始讨论</span><ArrowUpRight size={15} aria-hidden="true" /></button>
            {currentResources?.sources[0] && <button onClick={() => suggest(`请读取《${currentResources?.sources[0]?.title}》，提炼要点，并说明信息依据。`)}><BookOpen size={19} aria-hidden="true" /><strong>从资料中找线索</strong><span>读取资料，提炼关键信息</span><ArrowUpRight size={15} aria-hidden="true" /></button>}
          </div>
        </div> : <div className="message-list">{snapshot && <ChatPresentation snapshot={snapshot} active={active} busy={busy} choices={processChoices} canAutoCollapse={() => seatActive && view === 'chat' && (renderedScrollKey.current === scrollKey ? follow.current : (positions.current[scrollKey]?.follow ?? true)) && !document.querySelector('dialog[open]')} submissions={chat.interactionSubmissions} respond={chat.respondInteraction} query={chat.queryInteraction} />}{busy && !waiting && (lastMessage?.role !== 'assistant' || active?.phase === 'compacting') && <div className="thinking"><span>{active?.status === 'stopping' ? '正在停止本次回复…' : active?.phase === 'compacting' ? '正在压缩上下文…' : '正在思考…'}</span><span className="loading-dot" /></div>}</div>}
      </div>

      <div className="composer-dock">
        {newContent && <button className="new-content" onClick={() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; follow.current = true; setNewContent(false); markVisibleRead(); }}><ArrowDown size={15} aria-hidden="true" />有新内容</button>}
        <div className="composer-container">
          {!chat.loading && !chat.info?.configured && <div className="notice configuration-notice"><CircleAlert size={16} aria-hidden="true" /><span>模型尚未配置，请在侧栏左下角的“设置”中完成配置后开始对话。</span></div>}
          {!chat.loading && chat.info?.configured && !chat.info.contextReady && <div className="notice configuration-notice" role="status"><CircleAlert size={16} aria-hidden="true" /><span>请在侧栏左下角的“设置”中补齐模型的上下文容量与输出能力，草稿会保留。</span></div>}
          {!snapshot?.active && !snapshot?.recoveryWarning && snapshot?.lastResult?.status === 'interrupted' && <div className="notice" role="status"><CircleAlert size={17} aria-hidden="true" /><span>{snapshot.lastResult.message || '上次处理已中断，已保存内容保留，可继续发送消息。'}</span></div>}
          {snapshot?.recoveryWarning && <div className="notice error-notice" role="alert"><CircleAlert size={17} aria-hidden="true" /><span>{snapshot.recoveryWarning}</span><button onClick={() => void newChat()}>新建对话</button></div>}
          {chat.instructionChanges.length > 0 && <div className="notice instruction-notice" role="status"><Check size={16} aria-hidden="true" /><span>{chat.instructionChanges.some(change => change.status === 'updated') ? '项目指令已保存，下次发送时生效。' : '项目指令已核对，内容未变化。'}</span><button onClick={() => setResourceOpen(true)}>查看指令</button></div>}
          {snapshot?.lastResult?.instructionOutcomeUncertain && <div className="notice error-notice" role="alert"><span>指令更新结果尚未确认，请查看最新内容核对；停止回复不会撤销已经保存的文件。</span><button onClick={() => setResourceOpen(true)}>核对指令</button></div>}
          {error && <div className="notice error-notice" role="alert"><CircleAlert size={17} aria-hidden="true" /><span>{error}</span><button onClick={() => void (chat.selected ? chat.refresh(chat.selected) : chat.bootstrap())}>查询状态</button></div>}
          {snapshot?.latestCompaction && <button className="request-resources" onClick={() => setCompactionDetail({ sessionId: chat.selected, entryId: snapshot.latestCompaction!.id })}>查看最近压缩摘要</button>}
          {(error || snapshot?.lastResult?.status === 'interrupted') && chat.submitted && (chat.draft !== chat.submitted || chat.recoverableSelectionDiffers) && <button className="restore-draft" onClick={chat.restoreSubmitted}>恢复刚才发送的内容</button>}
          <form className={`composer${draggingFiles ? ' file-dragging' : ''}`} onDragOver={event => { if (fileLimits?.enabled && event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDraggingFiles(true); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFiles(false); }} onDrop={event => { if (fileLimits?.enabled && event.dataTransfer.files.length) { event.preventDefault(); setDraggingFiles(false); uploadFiles(Array.from(event.dataTransfer.files)); } }} onSubmit={event => { event.preventDefault(); if (canSend) void chat.send(); }}>
            <ComposerReferences key={`${chat.draftKey}:${seatActive}:${view}`} control={referenceControl} scope={chat.draftKey} workspaceId={chat.workspaceId} enabled={seatActive && view === 'chat' && composerReady} fileEnabled={Boolean(fileLimits?.enabled)} text={chat.draft} textarea={textarea} selection={chat.composerSelections.all[chat.draftKey] || {}} setText={chat.setDraft} select={chat.setComposerSelection} reference={file => chat.attachments.reference(chat.resolveDraftOwner(), chat.workspaceId, file, fileLimits?.maxAttachments || 0)} upload={() => attachmentInput.current?.click()} />
            {attachmentList}
            {draggingFiles && <p className="attachment-notice">松开文件，上传到当前项目</p>}
            <textarea id={domId('message-input')} aria-label="发送消息" ref={textarea} disabled={!composerReady} rows={1} value={chat.draft} placeholder="描述你的问题，或继续补充想法…" aria-describedby={domId('input-hint')} onChange={event => { chat.setDraft(event.target.value); const input = event.nativeEvent as InputEvent; if (composing.current || input.isComposing) return; referenceControl.current?.input(event.target.value, event.target.selectionStart, !composing.current && !input.isComposing && input.inputType !== 'insertFromPaste'); }} onPaste={() => referenceControl.current?.close()} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={event => { composing.current = false; referenceControl.current?.input(event.currentTarget.value, event.currentTarget.selectionStart, true); }} onClick={event => referenceControl.current?.caret(event.currentTarget.selectionStart, event.currentTarget.selectionEnd)} onKeyDown={event => {
              if (!composing.current && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && referenceControl.current?.keyDown(event)) return;
              if (event.key === 'Enter' && !event.shiftKey && !composing.current && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                event.preventDefault();
                if (canSend) void chat.send();
              }
            }} />
            <div className="composer-toolbar">{fileLimits?.enabled && <><input ref={attachmentInput} className="visually-hidden" tabIndex={-1} type="file" multiple aria-label="选择附件" disabled={!composerReady} onChange={event => { uploadFiles(Array.from(event.target.files || [])); event.target.value = ''; }} /></> }<button type="button" className="icon-button attach-button" aria-label="添加附件" title="添加文件、Skill 或 Agents" disabled={!composerReady} onClick={() => referenceControl.current?.open()}><Plus size={19} /></button>{busy ? <button type="button" className="stop-button" disabled={!active || snapshot?.active?.requestId !== active.requestId || active.status === 'stopping'} onClick={() => void chat.cancel()}><Square size={13} fill="currentColor" aria-hidden="true" />{active?.status === 'stopping' ? '正在停止' : '停止回复'}</button> : <button type="submit" className="send-button" aria-label="发送消息" disabled={!canSend}><ArrowUp size={20} aria-hidden="true" /></button>}</div>
          </form>
          {blockedAttachments && <p className="attachment-notice" role="status">请等待上传完成，或重试／移除未完成的附件后发送。</p>}
          {fileLimits?.enabled && !fileLimits.executionAvailable && attachmentItems.length > 0 && <p className="attachment-notice" role="status">处理环境尚未就绪，Agent 暂时无法读取、修改或执行工作区文件。</p>}
          {(attachmentItems.length > 0 || chat.composerSelections.all[chat.draftKey]?.skill || chat.composerSelections.all[chat.draftKey]?.agent) && !chat.draft.trim() && <p className="attachment-notice">请描述本次希望完成的目标。</p>}
          <div className="composer-footnote"><span className={`request-status${busy ? ' active' : ''}`} role="status" aria-live="polite">{status && (busy && !waiting ? <span className="loading-dot" /> : <span className="status-dot" />)}{status}</span><span id={domId('input-hint')}>Enter 发送<span className="shortcut-divider"> · </span>Shift + Enter 换行</span></div>
        </div>
      </div>
      </>}
    </main>
    {filesOpen && <FilesPanel key={chat.workspaceId} workspaceId={chat.workspaceId} name={chat.workspace?.name || '项目'} close={() => setFilesOpen(false)} upload={uploadFiles} executionAvailable={Boolean(fileLimits?.executionAvailable)} attachments={attachmentList} refreshKey={attachmentItems.filter(item => item.status === 'ready').map(item => item.id).join(',')} reference={file => chat.attachments.reference(chat.resolveDraftOwner(), chat.workspaceId, file, fileLimits?.maxAttachments || 20)} />}
    {newSessionOpen && <NewSession workspaces={navigationWorkspaces.filter(w=>taskMeta?.[w.id]?.state!=='archived')} workspaceId={chat.workspaceId} create={createChat} close={() => setNewSessionOpen(false)} />}
    {settingsOpen && <ModelSettings close={() => setSettingsOpen(false)} saved={chat.refreshInfo} />}
    {resourceOpen && <Resources key={chat.workspaceId} workspaceId={chat.workspaceId} name={chat.workspace?.name || '项目'} resources={currentResources} resourceError={resourceErrors[chat.workspaceId]} reloadResources={() => setResourceReload(value => value + 1)} instructions={instructions} close={() => setResourceOpen(false)} />}
    {compactionDetail && <CompactionPanel key={`${compactionDetail.sessionId}:${compactionDetail.entryId}`} {...compactionDetail} close={() => setCompactionDetail(undefined)} />}
    {taskPanel && identity && <TaskPanel key={taskPanel.task?.id || taskPanel.visibility} identity={identity} {...taskPanel} close={()=>setTaskPanel(undefined)} saved={task=>{directory.saved(task);void chat.refreshActivity();}}/>}
    {workspaceForm && <Panel title="新建项目" close={() => setWorkspaceForm(false)}><form className="workspace-form" onSubmit={event => { event.preventDefault(); void createWorkspace(); }}><label htmlFor="workspace-name">项目名称</label><input id="workspace-name" value={workspaceName} maxLength={60} required onChange={event => setWorkspaceName(event.target.value)} placeholder="例如：方案讨论" /><p className="resource-help">每个项目拥有独立的指令、资料和会话。</p>{workspaceError && <p className="resource-error" role="alert">{workspaceError}</p>}<button className="primary-action" disabled={workspaceCreating || !workspaceName.trim()} type="submit">{workspaceCreating ? '创建中…' : '创建项目'}</button></form></Panel>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<Seats>{view => <App {...view} />}</Seats>);
