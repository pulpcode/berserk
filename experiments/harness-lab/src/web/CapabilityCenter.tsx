import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CircleAlert, Layers, RefreshCw, ShieldCheck } from 'lucide-react';
import type { ExpertDetail, ExpertSummary, SessionExpert, CapabilityAdminSummary, ExpertSessionSelection } from '../contracts/capabilities';
import type { Workspace } from '../contracts/index';
import { useApi } from './api';
import { LoadingIndicator } from './LoadingIndicator';
import { Panel } from './Resources';
import './capabilities.css';

const errorMessage = (error: unknown) => error instanceof Error ? error.message : '能力信息暂时无法读取，请重试。';

export function SessionExpertIdentity({ expert }: { expert: SessionExpert }) {
  return <div className="session-expert-identity" aria-label="当前专家" title={expert.name}><Layers size={15} aria-hidden="true" /><span>{expert.name}</span></div>;
}

export function SessionExpertNotice({ expert, openCurrent }: { expert: SessionExpert; openCurrent: () => void }) {
  if (expert.availability.available && !expert.updateAvailable) return null;
  return <div className="session-expert-notice">
    {!expert.availability.available && <p role="status" className="expert-unavailable"><CircleAlert size={15} aria-hidden="true" />{expert.availability.reason || '当前专家不可用，历史内容仍可查看。'}</p>}
    {expert.updateAvailable && <div className="expert-update"><span>专家已更新，此对话保持原有配置。</span><button type="button" onClick={openCurrent}>与更新后的专家协作</button></div>}
  </div>;
}

export function CapabilityCenter({ workspaces, fixedWorkspaceId, initialExpertId, create, domId, canCollaborate = true }: {
  workspaces: Workspace[]; fixedWorkspaceId?: string; initialExpertId?: string;
  create: (workspaceId: string, selection: Required<Pick<ExpertSessionSelection, 'expertRef' | 'expectedDigest'>>) => Promise<void>;
  domId: (id: string) => string; canCollaborate?: boolean;
}) {
  const { api } = useApi();
  const [experts, setExperts] = useState<ExpertSummary[]>();
  const [selected, setSelected] = useState(initialExpertId || '');
  const [loadedDetail, setLoadedDetail] = useState<{ id: string; reload: number; value?: ExpertDetail; error?: string }>();
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const detail = loadedDetail?.id === selected && loadedDetail.reload === reload ? loadedDetail.value : undefined;
  const detailError = loadedDetail?.id === selected && loadedDetail.reload === reload ? loadedDetail.error : undefined;
  const [collaborating, setCollaborating] = useState(false);
  const [administrator, setAdministrator] = useState(false);
  const [admin, setAdmin] = useState<CapabilityAdminSummary>();
  const [adminError, setAdminError] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);
  useEffect(() => {
    let current = true;
    api<ExpertSummary[]>('/api/capabilities/experts').then(value => {
      if (!current) return;
      setExperts(value); setError('');
      setSelected(prior => value.some(expert => expert.expertId === prior) ? prior : value[0]?.expertId || '');
    }).catch(error => { if (current) setError(errorMessage(error)); });
    return () => { current = false; };
  }, [api, reload]);
  useEffect(() => {
    let current = true;
    api<{administrator: boolean}>('/api/capabilities/access').then(value => { if (current) setAdministrator(value.administrator); }).catch(() => { if (current) setAdministrator(false); });
    return () => { current = false; };
  }, [api, reload]);
  useEffect(() => {
    if (!selected) return;
    let current = true;
    api<ExpertDetail>(`/api/capabilities/experts/${encodeURIComponent(selected)}`).then(value => { if (current) setLoadedDetail({ id: selected, reload, value }); }).catch(error => { if (current) setLoadedDetail({ id: selected, reload, error: errorMessage(error) }); });
    return () => { current = false; };
  }, [api, selected, reload]);
  async function readAdmin() {
    setAdminOpen(true); setAdminLoading(true); setAdminError('');
    try { setAdmin(await api<CapabilityAdminSummary>('/api/admin/capabilities/summary')); }
    catch (error) { setAdminError(errorMessage(error)); }
    finally { setAdminLoading(false); }
  }
  return <section id={domId('capability-center')} className="capability-center" tabIndex={-1} aria-labelledby={domId('capability-title')}>
    <header className="capability-heading"><div><p className="eyebrow">工作能力</p><h1 id={domId('capability-title')}>能力中心</h1><p>选择专业专家，在工作空间中开始协作。</p></div><div className="capability-heading-actions">{administrator && <button type="button" onClick={() => void readAdmin()}><ShieldCheck size={16} aria-hidden="true" />管理概览</button>}<button type="button" onClick={() => setReload(value => value + 1)} aria-label="刷新专家目录"><RefreshCw size={16} aria-hidden="true" />刷新</button></div></header>
    <div className="capability-section-label"><h2>专业专家</h2><span>{experts ? `${experts.length} 位专家` : '读取目录'}</span></div>
    {error && <p className="resource-error" role="alert">{error}<button onClick={() => setReload(value => value + 1)}>重新读取</button></p>}
    {!experts && !error && <LoadingIndicator label="正在读取专家目录…" />}
    {experts?.length === 0 && <div className="capability-empty"><Layers size={30} aria-hidden="true" /><h3>暂无可选的专业专家</h3><p>你仍可以通过“新建对话”使用通用助手。</p></div>}
    {!!experts?.length && <div className="capability-layout"><nav className="expert-list" aria-label="专业专家列表">{experts.map(expert => <button type="button" key={expert.expertId} className="expert-card" aria-current={selected === expert.expertId ? 'true' : undefined} onClick={() => setSelected(expert.expertId)}><span className="expert-card-icon"><BookOpen size={22} aria-hidden="true" /></span><span className="expert-card-copy"><strong>{expert.name}</strong><span>{expert.description}</span><small>版本 {expert.releaseVersion}{!expert.availability.available ? ' · 暂不可用' : ''}</small></span><ArrowRight size={17} aria-hidden="true" /></button>)}</nav>
      <div className="expert-detail" aria-label="专家详情" aria-busy={!detail && !detailError}>{detailError ? <p className="resource-error" role="alert">{detailError}<button onClick={() => setReload(value => value + 1)}>重新读取详情</button></p> : !detail ? <LoadingIndicator label="正在读取专家详情…" /> : <>
        <div className="expert-detail-heading"><div><h2>{detail.name}</h2><p>版本 {detail.releaseVersion}</p></div><span className="expert-availability">{detail.availability.available ? '可协作' : '暂不可用'}</span></div>
        <p className="expert-description">{detail.description}</p>
        <section><h3>专业方法</h3><p className="expert-instructions">{detail.instructions}</p></section>
        <section><h3>使用的技能</h3>{detail.dependencies.length ? <ul className="expert-dependencies">{detail.dependencies.map(skill => <li key={`${skill.id}:${skill.revisionId}`}><BookOpen size={16} aria-hidden="true" /><span>{skill.name}</span><small>版本 {skill.releaseVersion}</small></li>)}</ul> : <p>无需额外技能。</p>}</section>
        {!detail.availability.available && <p className="resource-error" role="status">{detail.availability.reason || '当前专家不可用，请稍后重新读取状态。'}</p>}
        <div className="expert-detail-action"><p>先确认工作空间，再输入你的目标。</p><button type="button" className="primary-action" disabled={!canCollaborate || !detail.availability.available || !workspaces.length} onClick={() => setCollaborating(true)}>与专家协作<ArrowRight size={16} aria-hidden="true" /></button>{!canCollaborate ? <span>当前账号没有业务协作权限。</span> : !workspaces.length && <span>暂无可用工作空间，请先创建任务或个人空间。</span>}</div>
      </>}</div></div>}
    {collaborating && detail && <ExpertCollaboration expert={detail} workspaces={workspaces} fixedWorkspaceId={fixedWorkspaceId} create={create} close={() => setCollaborating(false)} refresh={() => { setCollaborating(false); setReload(value => value + 1); }} />}
    {adminOpen && <Panel title="能力管理概览" close={() => setAdminOpen(false)} className="capability-admin-panel"><p className="resource-help">查看已登记能力及当前状态。</p>{adminLoading && <LoadingIndicator label="正在读取管理概览…" />}{adminError && <p className="resource-error" role="alert">{adminError}<button onClick={() => void readAdmin()}>重新读取</button></p>}{admin && <><p>{admin.experts.length} 项专家 · {admin.revisions} 个修订 · {admin.skillRevisions} 个技能修订</p><ul className="capability-admin-list">{admin.experts.map(expert => <li key={expert.expertId}><strong>{expert.name}</strong><span>版本 {expert.releaseVersion}</span><span>{expert.availability.available ? '可用' : expert.availability.reason || '不可用'}</span>{expert.system && <small>系统内置</small>}</li>)}</ul></>}</Panel>}
  </section>;
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
