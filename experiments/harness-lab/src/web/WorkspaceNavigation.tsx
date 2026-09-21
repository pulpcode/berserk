import { useApi } from './api';
import { useState } from 'react';
import { Activity, ArrowUpRight, ChevronDown, CircleAlert, Folder, MessageSquare, Plus } from 'lucide-react';
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
  return Boolean(session.active?.phase === 'waiting_answer' || session.active?.phase === 'waiting_confirmation' || session.recoveryWarning || (!session.active && !session.backgroundJob && (session.lastResult?.status === 'failed' || session.lastResult?.status === 'interrupted')) || unread[session.id]);
}

function Status({ session, unread = false, id }: { session: SessionActivity; unread?: boolean; id?: string }) {
  const failed = !session.active && !session.backgroundJob && (session.recoveryWarning || (session.lastResult?.status === 'failed' || session.lastResult?.status === 'interrupted'));
  const label = activityStatus(session);
  if (!label) return unread ? <span id={id} className="unread-dot" role="img" aria-label="有新回复未读" title="有新回复未读" /> : null;
  return <span id={id} className={`activity-status${session.active || session.backgroundJob ? ' running' : failed ? ' attention' : ''}`}>
    {session.active || session.backgroundJob ? <span className="status-dot" /> : failed ? <CircleAlert size={12} aria-hidden="true" /> : null}
    <span>{label}</span>{unread && <span className="unread-dot" role="img" aria-label="有新回复未读" title="有新回复未读" />}
  </span>;
}

interface NavigationProps {
  taskMode?: boolean;
  taskMeta?: Record<string,{visibility:'public'|'private';state:'active'|'archived'}>;
  createTask?: (visibility:'public'|'private') => void;
  publicAllowed?: boolean;
  showTask?: (id:string) => void;
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
  showActivity: () => void;
}

export function WorkspaceNavigation({ taskMode,taskMeta,createTask,publicAllowed,showTask,workspaces, activities, unread, workspaceId, selected, activityView, loading, creating, createSession, enterWorkspace, selectSession, showActivity }: NavigationProps) {
  const { domId } = useApi();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const running = activities.filter(session => session.active || session.backgroundJob).length;
  const fresh = activities.filter(session => unread[session.id]).length;
  const errors = activities.filter(session => session.recoveryWarning || (!session.active && !session.backgroundJob && (session.lastResult?.status === 'failed' || session.lastResult?.status === 'interrupted'))).length;
  return <>
    <button className={`activity-entry${activityView ? ' selected' : ''}`} onClick={showActivity} aria-current={activityView ? 'page' : undefined} aria-label="全部动态" aria-describedby={domId('activity-counts')}>
      <Activity size={17} aria-hidden="true" /><span>全部动态</span><ArrowUpRight size={14} aria-hidden="true" />
    </button>
    <p id={domId('activity-counts')} className="activity-counts" role="status" aria-live="polite" aria-atomic="true">{running} 个处理中 · {fresh} 个新回复 · {errors} 个异常</p>
    {!taskMode && <div className="section-label">项目<span>{workspaces.length}</span></div>}
    <nav className="workspace-groups" aria-label="会话列表">
      {loading && !workspaces.length && <p className="sidebar-empty">正在加载项目…</p>}
      {(taskMode ? ['public','private'] as const : ['legacy'] as const).map(group=><div key={group}>{taskMode && <div className="section-label">{group==='public'?'公共任务':'席位私有'}{(group==='private' || publicAllowed) && <button className="icon-button" aria-label={group==='public'?'建立公共任务':'建立席位私有任务'} onClick={()=>createTask?.(group==='public'?'public':'private')}><Plus size={15}/></button>}</div>}
      {workspaces.filter(workspace=>group==='legacy' || taskMeta?.[workspace.id]?.visibility===group).map(workspace => {
        const sessions = activities.filter(session => session.workspaceId === workspace.id);
        const activeCount = sessions.filter(session => session.active || session.backgroundJob).length;
        const attentionCount = sessions.filter(session => needsAttention(session, unread)).length;
        return <section className={`workspace-group${workspaceId === workspace.id ? ' current' : ''}`} key={workspace.id} aria-label={workspace.name}>
          <div className="workspace-group-heading">
            <button className="group-toggle" aria-label={`${collapsed[workspace.id] ? '展开' : '折叠'}项目：${workspace.name}`} aria-expanded={!collapsed[workspace.id]} aria-controls={`workspace-sessions-${workspace.id}`} onClick={() => setCollapsed(previous => ({ ...previous, [workspace.id]: !previous[workspace.id] }))}><ChevronDown size={15} aria-hidden="true" /></button>
            <button className="workspace-entry" aria-label={`进入项目：${workspace.name}`} aria-current={!activityView && workspaceId === workspace.id ? 'true' : undefined} title={workspace.name} onClick={() => enterWorkspace(workspace.id)}><Folder size={14} aria-hidden="true" /><span>{workspace.name}</span></button>
            {activeCount > 0 && <span className="group-count running" aria-label={`${activeCount} 个处理中`} title={`${activeCount} 个处理中`}>{activeCount}</span>}
            {attentionCount > 0 && <span className="group-count attention" aria-label={`${attentionCount} 个需关注`} title={`${attentionCount} 个需关注`}>{attentionCount}</span>}
            <button className="project-new-chat" aria-label={`在项目 ${workspace.name} 中新建对话`} title="新建对话" disabled={creating || loading || taskMeta?.[workspace.id]?.state==='archived'} onClick={() => createSession(workspace.id)}><Plus size={16} aria-hidden="true" /></button>
            {taskMode && <button className="icon-button" aria-label={`任务说明：${workspace.name}`} onClick={()=>showTask?.(workspace.id)}><ArrowUpRight size={14}/></button>}
          </div>
          <div id={`workspace-sessions-${workspace.id}`} hidden={collapsed[workspace.id]} className="group-sessions">
            {sessions.length ? sessions.map(session => <button key={session.id} className={`session-item${!activityView && selected === session.id ? ' selected' : ''}`} aria-label={session.title} aria-describedby={activityStatus(session) || unread[session.id] ? `session-status-${session.id}` : undefined} aria-current={!activityView && selected === session.id ? 'page' : undefined} onClick={() => selectSession(session.id)}>
              <MessageSquare size={15} aria-hidden="true" /><span className="session-copy"><span className="session-title-row"><span className="session-title" title={session.title}>{session.title}</span>{!activityStatus(session) && <Status session={session} unread={unread[session.id]} id={`session-status-${session.id}`} />}</span>{activityStatus(session) && <Status session={session} unread={unread[session.id]} id={`session-status-${session.id}`} />}</span>
            </button>) : <p className="sidebar-empty">还没有对话</p>}
          </div>
        </section>;
      })}</div>)}
    </nav>
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
    {loading && !activities.length ? <p className="activity-empty">正在读取动态…</p> : !visible.length ? <div className="activity-empty"><Activity size={24} aria-hidden="true" /><p>{filter === 'running' ? '目前没有正在处理的会话。' : filter === 'attention' ? '目前没有需要关注的会话。' : '从项目中新建一个对话，进展会显示在这里。'}</p></div> : <ul className="activity-list">{visible.map(session => {
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
