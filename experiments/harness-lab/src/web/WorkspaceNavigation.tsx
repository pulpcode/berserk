import { RiFolderCloudLine } from '@remixicon/react';
import { LoadingIndicator } from './LoadingIndicator';
import { useApi } from './api';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, ArrowUpRight, ChevronDown, Folder, FolderPlus, LoaderCircle, MessageSquare, Plus } from 'lucide-react';
import type { SessionActivity, Workspace } from '../contracts/index';

export function activityStatus(session: SessionActivity) {
  if (session.active?.status === 'stopping') return '正在停止';
  if (session.active) {
    if (session.active.phase === 'waiting_answer') return '待回答';
    if (session.active.phase === 'waiting_confirmation') return '待确认';
    if (session.active.phase === 'subagent') return '子任务处理中';
    if (session.active.phase === 'compacting') return '正在压缩上下文';
    if (session.active.phase === 'preparing') return '准备资料';
    if (session.active.phase === 'generating') return '生成回复';
    if (session.active.phase === 'tool') {
      const tool = session.active.toolName?.replaceAll('_', '.');
      if (tool === 'instructions.update') return '更新指令';
      if (tool === 'instructions.read') return '读取指令';
      if (tool === 'skill.read') return '读取 Skill';
      if (tool === 'source.list' || tool === 'source.read') return '读取资料';
      return '使用工具';
    }
    return '处理中';
  }
  if (session.backgroundJob) return session.backgroundJob.status === 'queued' ? '后台分析排队中' : '后台分析中';
  if (session.recoveryWarning) return '需要恢复';
  if (session.lastResult?.status === 'failed') return '回复未完成';
  if (session.lastResult?.status === 'cancelled') return '已停止';
  if (session.lastResult?.status === 'interrupted') return '已中断';
  return '';
}

function needsAttention(session: SessionActivity, unread: Record<string, boolean>) {
  return Boolean((session.active?.status !== 'stopping' && (session.active?.phase === 'waiting_answer' || session.active?.phase === 'waiting_confirmation')) || session.recoveryWarning || (!session.active && !session.backgroundJob && (session.lastResult?.status === 'failed' || session.lastResult?.status === 'interrupted')) || unread[session.id]);
}

function Status({ session, unread = false, id }: { session: SessionActivity; unread?: boolean; id?: string }) {
  const waiting = session.active?.status !== 'stopping' && (session.active?.phase === 'waiting_answer' || session.active?.phase === 'waiting_confirmation');
  const failed = !session.active && !session.backgroundJob && (session.recoveryWarning || session.lastResult?.status === 'failed' || session.lastResult?.status === 'interrupted');
  const running = Boolean(session.active || session.backgroundJob);
  const label = waiting || failed || running ? activityStatus(session) : unread ? '有新回复未读' : '';
  if (!label) return null;
  return <span id={id} className={`conversation-indicator${waiting ? ' waiting' : failed ? ' failed' : running ? ' running' : ' unread'}`} role="img" aria-label={label} title={label}>{running && !waiting ? <LoaderCircle size={14} aria-hidden="true" /> : <span />}</span>;
}

function shortUpdateTime(value: string) {
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  if (!Number.isFinite(elapsed)) return '时间未知';
  if (elapsed < 60_000) return '刚刚';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}分钟`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}小时`;
  return `${Math.floor(elapsed / 86_400_000)}天`;
}

/** One hover owner for the whole list; moving between rows keeps the card immediate. */
function useSessionHover() {
  const [target, setTarget] = useState<{ id: string; anchor: HTMLButtonElement } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const warm = useRef(false);
  const pendingAnchor = useRef<HTMLButtonElement | null>(null);
  const keep = useCallback(() => { clearTimeout(timer.current); }, []);
  const hide = useCallback(() => { clearTimeout(timer.current); pendingAnchor.current = null; warm.current = false; setTarget(null); }, []);
  const show = (id: string, anchor: HTMLButtonElement) => {
    keep();
    pendingAnchor.current = anchor;
    const open = () => { if (anchor.isConnected && anchor.getClientRects().length && anchor.matches(':hover, :focus-visible')) { warm.current = true; setTarget({ id, anchor }); } };
    if (warm.current) open(); else timer.current = setTimeout(open, 800);
  };
  const leave = () => {
    keep();
    if (document.activeElement === target?.anchor && target.anchor.matches(':focus-visible')) return;
    timer.current = setTimeout(hide, 120);
  };
  useEffect(() => {
    if (!target) return;
    const observer = new ResizeObserver(() => {
      if (!target.anchor.isConnected || !target.anchor.getClientRects().length) hide();
    });
    observer.observe(target.anchor);
    return () => observer.disconnect();
  }, [target, hide]);
  useEffect(() => {
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('.session-hover-card')) return;
      // Tab may scroll the newly focused row into view before its delayed card opens.
      if (event.type === 'scroll' && !warm.current && pendingAnchor.current?.matches(':focus-visible')) return;
      hide();
    };
    const dismissKey = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    // Closing rather than repositioning also covers navigation and hidden sidebar panes.
    window.addEventListener('resize', hide);
    window.addEventListener('blur', hide);
    document.addEventListener('scroll', dismissOutside, true);
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissKey);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('resize', hide);
      window.removeEventListener('blur', hide);
      document.removeEventListener('scroll', dismissOutside, true);
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissKey);
    };
  }, [hide]);
  return { target, show, keep, leave, hide };
}

function SessionHoverCard({ id, session, workspace, unread, anchor, keep, leave }: {
  id: string; session: SessionActivity; workspace: string; unread: boolean; anchor: HTMLButtonElement; keep: () => void; leave: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    const rect = anchor.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(rect.right + 8, window.innerWidth - bounds.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - bounds.height - 8))}px`;
  }, [anchor, session, workspace, unread]);
  const status = activityStatus(session);
  return createPortal(<div ref={card} id={id} role="tooltip" className="session-hover-card" onPointerEnter={keep} onPointerLeave={leave}>
    <strong>{session.title}</strong><span className="session-hover-workspace">{workspace}</span>
    <time dateTime={session.updatedAt}>更新于 {new Date(session.updatedAt).toLocaleString('zh-CN')}</time>
    <span className="session-hover-status">{status || (unread ? '有新回复未读' : '空闲')}</span>
    {session.recoveryWarning && <span>{session.recoveryWarning}</span>}
  </div>, document.body);
}

interface NavigationProps {
  taskMode?: boolean;
  personalOnly?: boolean;
  readOnly?: boolean;
  taskMeta?: Record<string,{visibility:'public'|'private';state:'active'|'archived'}>;
  createTask?: (visibility:'public'|'private') => void;
  createWorkspace?: () => void;
  publicAllowed?: boolean;
  informationTaskId?: string;
  workspaces: Workspace[];
  activities: SessionActivity[];
  unread: Record<string, boolean>;
  workspaceId: string;
  selected: string;
  activityView: boolean;
  loading: boolean;
  creating: boolean;
  createSession: (workspaceId: string) => void;
  enterWorkspace: (id: string) => void;
  selectSession: (id: string) => void;
  showActivity?: () => void;
}

export function WorkspaceNavigation({ readOnly=false,taskMode,personalOnly=false,taskMeta,createTask,createWorkspace,publicAllowed,informationTaskId,workspaces, activities, unread, workspaceId, selected, activityView, loading, creating, createSession, enterWorkspace, selectSession }: NavigationProps) {
  const { domId } = useApi();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [catalogCollapsed, setCatalogCollapsed] = useState<Record<string, boolean>>({});
  const hover = useSessionHover();
  const hovered = hover.target && activities.find(session => session.id === hover.target!.id);
  return <>
    <nav className="workspace-groups" aria-label="会话列表">
      {loading && !workspaces.length && <LoadingIndicator label="正在加载项目…" />}
      {(taskMode ? personalOnly ? ['private'] as const : ['public','private'] as const : ['legacy'] as const).map(group=>{
        const label=group==='public'?'任务空间':group==='private'?'个人空间':'项目';
        const folded=!!catalogCollapsed[group];
        const WorkspaceIcon=group==='public'?RiFolderCloudLine:Folder;
        return <div key={group}>
        <div className="section-label catalog-heading">
          <button className="catalog-toggle" aria-label={`${folded?'展开':'折叠'}${label}`} aria-expanded={!folded} aria-controls={domId(`catalog-${group}`)} onClick={()=>setCatalogCollapsed(previous=>({...previous,[group]:!previous[group]}))}>
            <span>{label}</span><ChevronDown size={14} aria-hidden="true"/>
          </button>
          {!readOnly && (group!=='public' || publicAllowed) && <button className="icon-button catalog-create" aria-label={group==='public'?'新建任务空间':group==='private'?'新建个人空间':'新建项目'} title={group==='public'?'新建任务空间':group==='private'?'新建个人空间':'新建项目'} onClick={()=>group==='legacy'?createWorkspace?.():createTask?.(group)}>
            <Plus className="catalog-plus" size={16} aria-hidden="true"/>{group==='public'?<RiFolderCloudLine className="catalog-rail-icon" size={20} aria-hidden="true"/>:<FolderPlus className="catalog-rail-icon" size={20} aria-hidden="true"/>}
          </button>}
        </div>
        <div id={domId(`catalog-${group}`)} className={`catalog-items${folded?' is-collapsed':''}`}>
      {workspaces.filter(workspace=>group==='legacy' || taskMeta?.[workspace.id]?.visibility===group).map(workspace => {
        const sessions = activities.filter(session => session.workspaceId === workspace.id);
        return <section className={`workspace-group${(informationTaskId ? informationTaskId === workspace.taskSpaceId : workspaceId === workspace.id) ? ' current' : ''}`} key={workspace.id} aria-label={workspace.name}>
          <div className="workspace-group-heading">
            <button className="group-toggle" aria-label={`${collapsed[workspace.id] ? '展开' : '折叠'}项目：${workspace.name}`} aria-expanded={!collapsed[workspace.id]} aria-controls={`workspace-sessions-${workspace.id}`} onClick={() => setCollapsed(previous => ({ ...previous, [workspace.id]: !previous[workspace.id] }))}><WorkspaceIcon className="workspace-folder-icon" size={16} aria-hidden="true" /><ChevronDown className="workspace-disclosure-icon" size={16} aria-hidden="true" /></button>
            <button className="workspace-entry" aria-label={`进入项目：${workspace.name}`} aria-current={(taskMode && !personalOnly ? informationTaskId === workspace.taskSpaceId : !activityView && workspaceId === workspace.id) ? 'page' : undefined} title={workspace.name} onClick={() => enterWorkspace(workspace.id)}><WorkspaceIcon className="workspace-rail-icon" size={20} aria-hidden="true" /><span>{workspace.name}</span></button>
            {!readOnly&&<button className="project-new-chat" aria-label={`在项目 ${workspace.name} 中新建对话`} title="新建对话" disabled={creating || loading || taskMeta?.[workspace.id]?.state==='archived'} onClick={() => createSession(workspace.id)}><Plus size={16} aria-hidden="true" /></button>}
          </div>
          <div id={`workspace-sessions-${workspace.id}`} hidden={collapsed[workspace.id]} className="group-sessions">
            {readOnly?<p className="sidebar-empty">任务说明 · 只读核对</p>:sessions.length ? sessions.map(session => <button key={session.id} className={`session-item${!activityView && selected === session.id ? ' selected' : ''}`} aria-label={session.title} aria-describedby={[activityStatus(session) || unread[session.id] ? `session-status-${session.id}` : '', hover.target?.id === session.id ? domId('session-hover') : ''].filter(Boolean).join(' ') || undefined} aria-current={!activityView && selected === session.id ? 'page' : undefined}
              onPointerEnter={event => { if (event.pointerType !== 'touch') hover.show(session.id, event.currentTarget); }} onPointerLeave={hover.leave}
              onFocus={event => { if (event.currentTarget.matches(':focus-visible')) hover.show(session.id, event.currentTarget); }} onBlur={hover.leave}
              onClick={() => { hover.hide(); selectSession(session.id); }}>
              <span className="session-status-slot"><Status session={session} unread={unread[session.id]} id={`session-status-${session.id}`} /></span>
              <span className="session-title">{session.title}</span>
              {session.active?.status !== 'stopping' && (session.active?.phase === 'waiting_answer' || session.active?.phase === 'waiting_confirmation')
                ? <span className="session-pending-label">{activityStatus(session)}</span>
                : <time className="session-update-time" dateTime={session.updatedAt} title={`更新于 ${new Date(session.updatedAt).toLocaleString('zh-CN')}`}>{shortUpdateTime(session.updatedAt)}</time>}
            </button>) : <p className="sidebar-empty">还没有对话</p>}
          </div>
        </section>;
      })}</div></div>;})}
    </nav>
    {hover.target && hovered && <SessionHoverCard id={domId('session-hover')} session={hovered} workspace={workspaces.find(workspace => workspace.id === hovered.workspaceId)?.name || '项目'} unread={Boolean(unread[hovered.id])} anchor={hover.target.anchor} keep={hover.keep} leave={hover.leave} />}
  </>;
}

export function ActivityOverview({ workspaces, activities, unread, selectSession, loading }: Pick<NavigationProps, 'workspaces' | 'activities' | 'unread' | 'selectSession' | 'loading'>) {
  const { domId } = useApi();
  const [filter, setFilter] = useState<'all' | 'running' | 'attention'>('all');
  const visible = activities.filter(session => filter === 'all' || (filter === 'running' ? Boolean(session.active || session.backgroundJob) : needsAttention(session, unread)));
  const choices = [{ id: 'all', label: '全部' }, { id: 'running', label: '处理中' }, { id: 'attention', label: '需关注' }] as const;
  return <div className="activity-overview" id={domId('activity-overview')} tabIndex={0} aria-label="全部动态列表">
    <div className="activity-heading"><p className="eyebrow">项目概览</p><h1>全部动态</h1><p>查看各项目的处理进展，继续需要你关注的对话。</p></div>
    <div className="activity-filters" role="group" aria-label="动态筛选">{choices.map(choice => <button key={choice.id} aria-pressed={filter === choice.id} onClick={() => setFilter(choice.id)}>{choice.label}</button>)}<span>{visible.length} 个会话</span></div>
    {loading && !activities.length ? <LoadingIndicator label="正在读取动态…" /> : !visible.length ? <div className="activity-empty"><Activity size={24} aria-hidden="true" /><p>{filter === 'running' ? '目前没有正在处理的会话。' : filter === 'attention' ? '目前没有需要关注的会话。' : '从项目中新建一个对话，进展会显示在这里。'}</p></div> : <ul className="activity-list">{visible.map(session => {
      const workspace = workspaces.find(item => item.id === session.workspaceId);
      const date = new Date(session.statusUpdatedAt);
      const time = Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      return <li key={session.id}><button className="activity-row" aria-label={`打开会话：${session.title}`} aria-describedby={activityStatus(session) || unread[session.id] ? `overview-status-${session.id}` : undefined} onClick={() => selectSession(session.id)}>
        <span className="activity-row-icon"><MessageSquare size={19} aria-hidden="true" /></span>
        <span className="activity-row-content"><span className="activity-workspace"><Folder size={12} aria-hidden="true" />{workspace?.name || '项目'}</span><span className="activity-title-row"><strong>{session.title}</strong>{!activityStatus(session) && <Status session={session} unread={unread[session.id]} id={`overview-status-${session.id}`} />}</span>{activityStatus(session) && <Status session={session} unread={unread[session.id]} id={`overview-status-${session.id}`} />}</span>
        <span className="activity-row-end"><time dateTime={session.statusUpdatedAt} title={`更新于 ${date.toLocaleString('zh-CN')}`}>{time}</time><ArrowUpRight size={17} aria-hidden="true" /></span>
      </button></li>;
    })}</ul>}
  </div>;
}
