import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CircleAlert, Layers, Link, Plus, RefreshCw, Search, Settings2, Sparkles } from 'lucide-react';
import type { CapabilityLibrary, ExpertDetail, ExpertSummary, SessionExpert, ExpertSessionSelection } from '../contracts/capabilities';
import type { Workspace } from '../contracts/index';
import { useApi } from './api';
import { LoadingIndicator } from './LoadingIndicator';
import { Panel } from './Resources';
import './capabilities.css';
import { CapabilityManagement } from './CapabilityManagement';
import type { ManagedExpertDetail, ManagedExpertSummary } from '../contracts/capability-management';
import { sessionAction } from './session-action';

const errorMessage = (error: unknown) => error instanceof Error ? error.message : '能力信息暂时无法读取，请重试。';

export function SessionExpertIdentity({ expert, source }: { expert: SessionExpert; source?: 'explicit' | 'task' | 'personal' | 'seat' | 'general' }) {
  const origin = source === 'task' ? '任务默认' : source === 'personal' ? '个人默认' : source === 'seat' ? '席位默认' : '';
  return <div className="session-expert-identity" aria-label="当前专家" title={`${expert.name}${origin ? ` · ${origin}` : ''}`}><Layers size={15} aria-hidden="true" /><span>{expert.name}</span>{origin && <small className="expert-default-origin">{origin}</small>}</div>;
}

export function SessionExpertNotice({ expert, openCurrent }: { expert: SessionExpert; openCurrent: () => void }) {
  if (expert.availability.available && !expert.updateAvailable) return null;
  return <div className="session-expert-notice">
    {!expert.availability.available && <p role="status" className="expert-unavailable"><CircleAlert size={15} aria-hidden="true" />{expert.availability.reason || '当前专家不可用，历史内容仍可查看。'}</p>}
    {expert.updateAvailable && <div className="expert-update"><span>专家已更新，此对话保持原有配置。</span><button type="button" onClick={openCurrent}>与更新后的专家协作</button></div>}
  </div>;
}

type LibraryTab = 'experts' | 'skills' | 'connectors';
const libraryTabs = [{ id: 'experts', name: '专家', icon: Layers }, { id: 'skills', name: '技能', icon: Sparkles }, { id: 'connectors', name: '连接器', icon: Link }] as const;
const managedState = (expert: ManagedExpertSummary) => expert.archived ? '已归档' : expert.state === 'disabled' ? '已停用' : expert.state === 'banned' ? '受限制' : expert.currentRevisionId ? '已发布' : '草稿';

export function CapabilityCenter({ workspaces, fixedWorkspaceId, initialExpertId, create, domId, canCollaborate = true, administration = false }: {
  workspaces: Workspace[]; fixedWorkspaceId?: string; initialExpertId?: string;
  create: (workspaceId: string, selection: Required<Pick<ExpertSessionSelection, 'expertRef' | 'expectedDigest'>>) => Promise<void>;
  domId: (id: string) => string; canCollaborate?: boolean; administration?: boolean;
}) {
  const { api, storageKey } = useApi();
  const [tab, setTab] = useState<LibraryTab>('experts');
  const [query, setQuery] = useState('');
  const [experts, setExperts] = useState<ExpertSummary[]>();
  const [managed, setManaged] = useState<ManagedExpertSummary[]>();
  const [library, setLibrary] = useState<CapabilityLibrary>();
  const [selectedSkill, setSelectedSkill] = useState<CapabilityLibrary['skills'][number]>();
  const [selected, setSelected] = useState(initialExpertId || '');
  const [loadedDetail, setLoadedDetail] = useState<{ id: string; reload: number; value?: ExpertDetail; error?: string }>();
  const [error, setError] = useState('');
  const [libraryError, setLibraryError] = useState('');
  const [reload, setReload] = useState(0);
  const [collaborating, setCollaborating] = useState(false);
  const [administrator, setAdministrator] = useState(administration);
  const [adminOpen, setAdminOpen] = useState<{ id?: string }>();
  const [creating, setCreating] = useState(false);
  const pending = useRef(false);
  const detail = loadedDetail?.id === selected && loadedDetail.reload === reload ? loadedDetail.value : undefined;
  const detailError = loadedDetail?.id === selected && loadedDetail.reload === reload ? loadedDetail.error : undefined;
  useEffect(() => {
    let current = true;
    const request = administration ? api<ManagedExpertSummary[]>('/api/admin/capabilities/experts').then(value => { if (current) setManaged(value.filter(expert => expert.expertId !== 'axon-general' && !expert.expertId.startsWith('role-'))); })
      : api<ExpertSummary[]>('/api/capabilities/experts').then(value => { if (current) setExperts(value); });
    request.then(() => { if (current) setError(''); }).catch(error => { if (current) setError(errorMessage(error)); });
    return () => { current = false; };
  }, [api, reload, administration]);
  useEffect(() => {
    let current = true;
    api<{administrator: boolean}>(administration ? '/api/admin/access' : '/api/capabilities/access').then(value => { if (current) setAdministrator(value.administrator); }).catch(() => { if (current) setAdministrator(false); });
    return () => { current = false; };
  }, [api, reload, administration]);
  useEffect(() => {
    if (tab !== 'skills') return;
    let current = true;
    api<CapabilityLibrary>('/api/capabilities/library').then(value => { if (current) { setLibrary(value); setLibraryError(''); } }).catch(error => { if (current) setLibraryError(errorMessage(error)); });
    return () => { current = false; };
  }, [api, reload, tab]);
  useEffect(() => {
    if (!selected || administration) return;
    let current = true;
    api<ExpertDetail>(`/api/capabilities/experts/${encodeURIComponent(selected)}`).then(value => { if (current) setLoadedDetail({ id: selected, reload, value }); }).catch(error => { if (current) setLoadedDetail({ id: selected, reload, error: errorMessage(error) }); });
    return () => { current = false; };
  }, [api, selected, reload, administration]);
  async function createExpert() {
    if (pending.current) return;
    pending.current = true; setCreating(true); setError('');
    const action = sessionAction(storageKey('expert-management:create'), {});
    try {
      const value = await api<ManagedExpertDetail>('/api/admin/capabilities/experts', { clientActionId: action.id });
      action.complete(); setAdminOpen({ id: value.expert.expertId }); setReload(value => value + 1);
    } catch (error) { setError(errorMessage(error)); }
    finally { pending.current = false; setCreating(false); }
  }
  function chooseTab(next: LibraryTab) { setTab(next); setQuery(''); }
  const search = query.trim().toLocaleLowerCase();
  const matches = (name: string, description = '') => `${name} ${description}`.toLocaleLowerCase().includes(search);
  const visibleExperts = experts?.filter(expert => matches(expert.name, expert.description));
  const visibleManaged = managed?.filter(expert => matches(expert.name, expert.description));
  const visibleSkills = library?.skills.filter(skill => matches(skill.name, skill.description));
  const count = tab === 'experts' ? (administration ? visibleManaged?.length : visibleExperts?.length) : tab === 'skills' ? visibleSkills?.length : 0;
  return <section id={domId('capability-center')} className="capability-center" tabIndex={-1} aria-labelledby={domId('capability-title')}>
    <header className="capability-heading"><div><h1 id={domId('capability-title')}>能力中心</h1><p>找到适合当前工作的专家与技能。</p></div></header>
    <div className="capability-toolbar">
      <div className="capability-tabs" role="tablist" aria-label="能力分类">{libraryTabs.map(({id,name,icon: Icon}, index) => <button key={id} id={domId(`capability-tab-${id}`)} type="button" role="tab" aria-selected={tab === id} aria-controls={domId('capability-tabpanel')} tabIndex={tab === id ? 0 : -1} onClick={() => chooseTab(id)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % libraryTabs.length : event.key === 'ArrowLeft' ? (index + libraryTabs.length - 1) % libraryTabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? libraryTabs.length - 1 : -1;
        if (next < 0) return; event.preventDefault(); chooseTab(libraryTabs[next].id); document.getElementById(domId(`capability-tab-${libraryTabs[next].id}`))?.focus();
      }}><Icon size={18} aria-hidden="true" />{name}</button>)}</div>
      <div className="capability-toolbar-actions"><label className="capability-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label={`搜索${libraryTabs.find(item => item.id === tab)!.name}`} placeholder={`搜索${libraryTabs.find(item => item.id === tab)!.name}名称或描述`} value={query} onChange={event => setQuery(event.target.value)} /></label>
        {tab === 'experts' && administrator && <><button type="button" onClick={() => setAdminOpen({})}><Settings2 size={16} aria-hidden="true" />专家管理</button><button type="button" className="primary-action" disabled={creating} onClick={() => void createExpert()}><Plus size={17} aria-hidden="true" />{creating ? '创建中…' : '创建专家'}</button></>}
        <button type="button" className="icon-button" onClick={() => setReload(value => value + 1)} aria-label="刷新能力目录" title="刷新能力目录"><RefreshCw size={17} aria-hidden="true" /></button>
      </div>
    </div>
    <div id={domId('capability-tabpanel')} role="tabpanel" aria-labelledby={domId(`capability-tab-${tab}`)} className="capability-tabpanel">
      <div className="capability-section-label"><h2>{tab === 'experts' ? '专业专家' : tab === 'skills' ? '可用技能' : '连接器'}</h2>{count !== undefined && <span>{count} {tab === 'experts' ? '位专家' : tab === 'skills' ? '项技能' : '个连接器'}</span>}</div>
      {tab === 'experts' && <>
        {error && <p className="resource-error" role="alert">{error}<button onClick={() => setReload(value => value + 1)}>重新读取</button></p>}
        {!(administration ? managed : experts) && !error && <LoadingIndicator label="正在读取专家目录…" />}
        {count === 0 && <LibraryEmpty icon={Layers} title={search ? '没有找到相关专家' : '暂无可选的专业专家'} text={search ? '试试其他名称或关键词。' : administrator ? '创建一个专家，配置后进行检查和试用。' : '获准使用的专家会显示在这里。'} />}
        <nav className="capability-grid expert-list" aria-label="专业专家列表">
          {administration ? visibleManaged?.map(expert => <article className="expert-card" key={expert.expertId}><div className="expert-card-heading"><span className="expert-card-icon"><BookOpen size={23} aria-hidden="true" /></span><h3>{expert.name || '未命名专家'}</h3><span className="expert-card-status">{managedState(expert)}</span></div><p>{expert.description || (expert.source === 'builtin' ? '系统内置专家，配置可查看或复制。' : '组织专家，配置后经检查与试用发布。')}</p><div className="expert-card-footer"><span>{expert.source === 'builtin' ? '系统内置' : '组织专家'}</span><button type="button" aria-label={`配置${expert.name || '未命名专家'}`} onClick={() => setAdminOpen({ id: expert.expertId })}>配置专家<ArrowRight size={15} aria-hidden="true" /></button></div></article>)
            : visibleExperts?.map(expert => <article className="expert-card" key={expert.expertId}><button type="button" className="expert-card-open" aria-label={`查看${expert.name}`} onClick={() => setSelected(expert.expertId)}><span className="expert-card-heading"><span className="expert-card-icon"><BookOpen size={23} aria-hidden="true" /></span><h3>{expert.name}</h3></span><span className="expert-card-description">{expert.description}</span></button><div className="expert-card-footer"><span>{expert.availability.available ? '可协作' : '暂不可用'}</span><button type="button" onClick={() => setSelected(expert.expertId)}>查看详情<ArrowRight size={15} aria-hidden="true" /></button></div></article>)}
        </nav>
      </>}
      {tab === 'skills' && <>
        {libraryError && <p className="resource-error" role="alert">{libraryError}<button onClick={() => setReload(value => value + 1)}>重新读取</button></p>}
        {!library && !libraryError && <LoadingIndicator label="正在读取技能目录…" />}
        {visibleSkills?.length === 0 && <LibraryEmpty icon={Sparkles} title={search ? '没有找到相关技能' : '暂无可用技能'} text={search ? '试试其他名称或关键词。' : '可用的技能会显示在这里。'} />}
        <div className="capability-grid capability-skill-list">{visibleSkills?.map(skill => <article key={skill.id} className="expert-card skill-card"><div className="expert-card-heading"><span className="expert-card-icon"><Sparkles size={23} aria-hidden="true" /></span><h3>{skill.name}</h3></div><p>{skill.description}</p><div className="expert-card-footer"><span className="expert-card-tag">可用技能</span><button type="button" aria-label={`查看技能${skill.name}`} onClick={() => setSelectedSkill(skill)}>查看详情<ArrowRight size={15} aria-hidden="true" /></button></div></article>)}</div>
      </>}
      {tab === 'connectors' && <LibraryEmpty icon={Link} title={search ? '没有找到相关连接器' : '暂无连接器'} text="连接器可将外部应用与资料接入 Axon。当前没有可展示的连接器。" />}
    </div>
    {selected && !administration && <Panel title={detail?.name || '专家详情'} className="expert-detail-panel" close={() => { setSelected(''); setCollaborating(false); }}><div className="expert-detail" aria-label="专家详情" aria-busy={!detail && !detailError}>{detailError ? <p className="resource-error" role="alert">{detailError}<button onClick={() => setReload(value => value + 1)}>重新读取详情</button></p> : !detail ? <LoadingIndicator label="正在读取专家详情…" /> : <>
      <div className="expert-detail-heading"><div><h2>{detail.name}</h2></div><span className="expert-availability">{detail.availability.available ? '可协作' : '暂不可用'}</span></div>
      <p className="expert-description">{detail.description}</p><section><h3>专业方法</h3><p className="expert-instructions">{detail.instructions}</p></section><section><h3>使用的技能</h3>{detail.dependencies.length ? <ul className="expert-dependencies">{detail.dependencies.map(skill => <li key={`${skill.id}:${skill.revisionId}`}><BookOpen size={16} aria-hidden="true" /><span>{skill.name}</span></li>)}</ul> : <p>无需额外技能。</p>}</section>
      {!detail.availability.available && <p className="resource-error" role="status">{detail.availability.reason || '当前专家不可用，请稍后重新读取状态。'}</p>}
      <div className="expert-detail-action"><p>先确认工作空间，再输入你的目标。</p><button type="button" className="primary-action" disabled={!canCollaborate || !detail.availability.available || !workspaces.length} onClick={() => setCollaborating(true)}>与专家协作<ArrowRight size={16} aria-hidden="true" /></button>{!canCollaborate ? <span>当前账号没有业务协作权限。</span> : !workspaces.length && <span>暂无可用工作空间，请先创建任务或个人空间。</span>}</div>
    </>}</div></Panel>}
    {collaborating && detail && <ExpertCollaboration expert={detail} workspaces={workspaces} fixedWorkspaceId={fixedWorkspaceId} create={create} close={() => setCollaborating(false)} refresh={() => { setCollaborating(false); setReload(value => value + 1); }} />}
    {selectedSkill && <Panel title={selectedSkill.name} className="expert-detail-panel" close={() => setSelectedSkill(undefined)}><p className="expert-description">{selectedSkill.description}</p></Panel>}
    {adminOpen && <CapabilityManagement key={adminOpen.id || 'directory'} initialExpertId={adminOpen.id} close={() => setAdminOpen(undefined)} changed={() => setReload(value => value + 1)} />}
  </section>;
}

function LibraryEmpty({ icon: Icon, title, text }: { icon: typeof Layers; title: string; text: string }) {
  return <div className="capability-empty"><Icon size={32} aria-hidden="true" /><h3>{title}</h3><p>{text}</p></div>;
}

function ExpertCollaboration({ expert, workspaces, fixedWorkspaceId, create, close, refresh }: {
  expert: ExpertDetail; workspaces: Workspace[]; fixedWorkspaceId?: string;
  create: (workspaceId: string, selection: Required<Pick<ExpertSessionSelection, 'expertRef' | 'expectedDigest'>>) => Promise<void>;
  close: () => void; refresh: () => void;
}) {
  const fixed = workspaces.find(workspace => workspace.id === fixedWorkspaceId);
  const [workspaceId, setWorkspaceId] = useState(fixed?.id || '');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  async function submit() {
    if (!workspaceId || pending.current) return;
    pending.current = true; setWorking(true); setError('');
    try {
      // The parent persists the action together with its exact parameters before POST.
      await create(workspaceId, { expertRef: { expertId: expert.expertId, revisionId: expert.revisionId }, expectedDigest: expert.digest });
      close();
    } catch (error) { setError(errorMessage(error)); }
    finally { pending.current = false; setWorking(false); }
  }
  return <Panel title={`与${expert.name}协作`} close={() => { if (!pending.current) close(); }} className="expert-collaboration-panel"><form className="workspace-form" onSubmit={event => { event.preventDefault(); void submit(); }}><p>将创建一个空会话，由你输入目标后开始工作。</p><label htmlFor="expert-workspace">工作空间</label>{fixed ? <p id="expert-workspace" className="expert-fixed-workspace">{fixed.name}</p> : <select id="expert-workspace" value={workspaceId} onChange={event => setWorkspaceId(event.target.value)} disabled={working} required><option value="">选择任务空间或个人空间</option>{workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select>}{error && <div className="resource-error" role="alert"><p>{error}</p><button type="button" onClick={refresh} disabled={working}>重新读取专家</button></div>}<div className="dialog-actions"><button type="button" onClick={close} disabled={working}>取消</button><button type="submit" className="primary-action" disabled={!workspaceId || working}>{working ? '创建中…' : '创建专家会话'}</button></div></form></Panel>;
}
