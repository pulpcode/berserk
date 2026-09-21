import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Inbox as InboxIcon, RefreshCw } from 'lucide-react';
import type { TaskSpace } from '../contracts/access';
import type { BackgroundAction, BackgroundAnalysisInput, BackgroundPage, InboxDetail, InboxItem, InformationJobDetail } from '../contracts/background';
import type { AgentInfo, SkillInfo, Workspace } from '../contracts/index';
import { useApi } from './api';
import { Panel } from './Resources';
import { AnalysisHistory, InformationFiles, InformationPagination, InformationText, informationError, informationTime, jobLabels, useInformationQuery } from './information-ui';

type AnalysisDraft = { taskSpaceId: string; goal: string; includeResult: boolean; fileIds: string[]; skillIds: string[]; agentIds: string[]; pending?: BackgroundAnalysisInput };
export function Inbox({ visible, tasks, workspaces, seats, prepared, openSession }: { visible: boolean; tasks: TaskSpace[]; workspaces: Workspace[]; seats: Array<{ id: string; name: string }>; prepared: (action: BackgroundAction) => Promise<void>; openSession: (id: string) => void }) {
  const { api, storageKey, domId } = useApi();
  const [selected, setSelected] = useState(() => location.pathname === '/inbox' ? new URLSearchParams(location.search).get('id') || '' : '');
  const [search, setSearch] = useState(''); const [offset, setOffset] = useState(0); const [jobId, setJobId] = useState('');
  const query = new URLSearchParams({ offset: String(offset), limit: '25', search });
  const list = useInformationQuery<BackgroundPage<InboxItem>>(`/api/inbox?${query}`, visible);
  const detail = useInformationQuery<InboxDetail>(selected ? `/api/inbox/${encodeURIComponent(selected)}` : undefined, visible);
  const job = useInformationQuery<InformationJobDetail>(jobId ? `/api/background/jobs/${encodeURIComponent(jobId)}` : undefined, visible);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState(false);
  const [action, setAction] = useState<BackgroundAction>(); const [queriedMissing, setQueriedMissing] = useState(false);
  const draftsKey = storageKey('axon.inbox-drafts');
  const [drafts, setDrafts] = useState<Record<string, AnalysisDraft>>(() => {
    try { return JSON.parse(sessionStorage.getItem(draftsKey) || '{}') as Record<string, AnalysisDraft>; } catch { return {}; }
  });
  const lock = useRef(false); const navigation = useRef(0); const visibleRef = useRef(visible);
  useEffect(() => { visibleRef.current = visible; }, [visible]);
  function update(value: AnalysisDraft) { setDrafts(current => { const next = { ...current, [selected]: value }; try { sessionStorage.setItem(draftsKey, JSON.stringify(next)); } catch { /* Memory editing remains available. */ } return next; }); }
  const value = detail.data;
  const draft = drafts[selected] || { taskSpaceId: '', goal: '请结合这份信息和所选资料进行分析，提出结论与需要进一步核实的问题。', includeResult: true, fileIds: value?.resultFiles.map(file => file.id) || [], skillIds: [], agentIds: [] };
  const [capabilityOptions, setCapabilityOptions] = useState<{ scope: string; data: { skills: SkillInfo[]; agents: AgentInfo[] } }>();
  const [optionsError, setOptionsError] = useState('');
  const optionScope = `${selected}:${draft.taskSpaceId}`;
  useEffect(() => {
    if (!selected || !draft.taskSpaceId || !visible) return;
    let current = true;
    api<{ skills: SkillInfo[]; agents: AgentInfo[] }>(`/api/inbox/${encodeURIComponent(selected)}/analysis-options`, { taskSpaceId: draft.taskSpaceId }).then(data => {
      if (current) { setCapabilityOptions({ scope: optionScope, data }); setOptionsError(''); }
    }).catch(reason => { if (current) setOptionsError(informationError(reason)); });
    return () => { current = false; };
  }, [api, selected, draft.taskSpaceId, optionScope, visible]);
  const options = { data: capabilityOptions?.scope === optionScope ? capabilityOptions.data : undefined, error: optionsError };
  const task = tasks.find(task => task.id === draft.taskSpaceId);
  const workspace = workspaces.find(item => item.taskSpaceId === draft.taskSpaceId);
  useEffect(() => {
    if (!visible) return;
    const url = `/inbox${selected ? `?id=${encodeURIComponent(selected)}` : ''}`;
    if (location.pathname + location.search !== url) history.replaceState(null, '', url);
    const pop = () => { if (location.pathname === '/inbox') { navigation.current++; setSelected(new URLSearchParams(location.search).get('id') || ''); } };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, [visible, selected]);
  function select(id: string) {
    navigation.current++; setSelected(id); setError(''); setNotice(''); setAction(undefined); setConfirm(false); setJobId(''); setQueriedMissing(false);
    history.pushState(null, '', `/inbox${id ? `?id=${encodeURIComponent(id)}` : ''}`);
  }
  async function showAction(result: BackgroundAction, captured: number) {
    detail.refresh(); list.refresh();
    if (navigation.current !== captured || !visibleRef.current) return;
    setAction(result); setNotice(result.status !== 'completed' ? '正在准备资料，请查询结果后继续。' : result.jobId ? '后台分析已提交，可离开页面，稍后在关联对话中查看。' : '对话和资料已准备好，进入后可编辑草稿，发送才开始分析。');
    if (result.jobId) setJobId(result.jobId);
    if (result.status === 'completed' && !result.jobId) await prepared(result);
  }
  async function submit(mode: BackgroundAnalysisInput['mode'], retry = false) {
    if (!selected || lock.current || !task || task.state !== 'active') return;
    if (draft.pending && !retry) return;
    const input: BackgroundAnalysisInput = retry && draft.pending ? draft.pending : { clientActionId: crypto.randomUUID(), mode, taskSpaceId: draft.taskSpaceId, goal: draft.goal.trim(), includeResult: draft.includeResult, fileIds: draft.fileIds, skillIds: draft.skillIds, agentIds: draft.agentIds };
    update({ ...draft, pending: input }); lock.current = true; setBusy(true); setError(''); setNotice(''); setConfirm(false); setQueriedMissing(false);
    const captured = navigation.current;
    try { await showAction(await api<BackgroundAction>(`/api/inbox/${encodeURIComponent(selected)}/analyses`, input), captured); }
    catch (reason) { if (captured === navigation.current) setError(`提交结果尚需核对，目标和资料选择已保留。${informationError(reason)}`); }
    finally { lock.current = false; setBusy(false); }
  }
  async function queryAction() {
    if (!draft.pending || lock.current) return; lock.current = true; setBusy(true); setError(''); const captured = navigation.current;
    try {
      const result = await api<BackgroundAction | null>(`/api/inbox/${encodeURIComponent(selected)}/analyses?clientActionId=${encodeURIComponent(draft.pending.clientActionId)}`);
      if (captured !== navigation.current) return;
      if (result) await showAction(result, captured); else { setQueriedMissing(true); setNotice('尚未登记此操作，可使用原内容重试。'); }
    } catch (reason) { if (captured === navigation.current) setError(informationError(reason)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function stop() {
    if (!job.data || lock.current) return; lock.current = true; setBusy(true); setError('');
    try { await api(`/api/background/jobs/${encodeURIComponent(job.data.id)}/cancel`, { revision: job.data.revision }); job.refresh(); detail.refresh(); }
    catch (reason) { setError(informationError(reason)); } finally { lock.current = false; setBusy(false); }
  }
  return <section id={domId('information-inbox')} tabIndex={-1} className="information-inbox" hidden={!visible} aria-label="收到的信息">
    <header className="information-heading"><div><h1>收到的信息</h1><p>查看原文与预处理结果，选择需要分析的内容。</p></div><button onClick={() => { list.refresh(); detail.refresh(); }}><RefreshCw size={16} aria-hidden="true" />刷新收件</button></header>
    <div className="information-toolbar"><label>搜索信息<input type="search" placeholder="标题或来源" value={search} onChange={event => { setSearch(event.target.value); setOffset(0); }} /></label></div>
    {(list.error || detail.error) && <p className="resource-error" role="alert">{list.error || detail.error}</p>}
    <div className="information-split"><div className="information-list"><ul>{list.data?.items.map(item => <li key={item.delivery.id}><button aria-current={selected === item.delivery.id ? 'true' : undefined} onClick={() => select(item.delivery.id)}><strong>{item.event.title}</strong><span>{item.sourceName || item.event.sourceId} · 已送达</span><small>{informationTime(item.delivery.deliveredAt)}</small></button></li>)}</ul>{list.data && !list.data.items.length && <p className="information-empty"><InboxIcon size={24} aria-hidden="true" />暂时没有收到的信息。</p>}<InformationPagination page={list.data} change={setOffset} /></div>
      <div className="information-detail">{!selected ? <p className="information-empty">选择一条信息查看原文与结果。</p> : !value ? <p role="status">正在读取信息…</p> : <>
        <button className="information-back" onClick={() => select('')}><ArrowLeft size={15} aria-hidden="true" />返回列表</button><header><h2>{value.event.title}</h2><p>{value.sourceName || value.event.sourceId} · {informationTime(value.delivery.deliveredAt)}</p></header>
        <section><h3>预处理结果</h3><InformationText>{value.resultText || '此次处理没有文字答复。'}</InformationText><InformationFiles files={value.resultFiles} base={`/api/inbox/${encodeURIComponent(selected)}/files`} /></section>
        <details className="information-original"><summary>查看原文与附件</summary><InformationText>{value.text}</InformationText><InformationFiles files={value.event.files} base={`/api/inbox/${encodeURIComponent(selected)}/files`} /></details>
        <section><h3>开始分析</h3><form className="information-form" onSubmit={event => { event.preventDefault(); void submit('conversation'); }}>
          <fieldset disabled={busy || Boolean(draft.pending)}><label>分析所属任务<select required value={draft.taskSpaceId} onChange={event => update({ ...draft, taskSpaceId: event.target.value, skillIds: [], agentIds: [] })}><option value="">请选择任务</option>{tasks.filter(item => item.state === 'active').map(item => <option key={item.id} value={item.id}>{item.title}{item.visibility === 'private' ? '（私有）' : ''}</option>)}</select></label>{!tasks.some(item => item.state === 'active') && <p className="resource-help">请先在工作台建立任务，再开始分析。</p>}
          <label>分析目标<textarea required rows={4} maxLength={12000} value={draft.goal} onChange={event => update({ ...draft, goal: event.target.value })} /></label>
          <fieldset className="information-selection"><legend>使用的资料</legend><label className="information-check"><input type="checkbox" checked={draft.includeResult} onChange={event => update({ ...draft, includeResult: event.target.checked })} />预处理文字结果</label>{[...value.resultFiles, ...value.event.files].map(file => <label className="information-check" key={file.id}><input type="checkbox" checked={draft.fileIds.includes(file.id)} onChange={event => update({ ...draft, fileIds: event.target.checked ? [...draft.fileIds, file.id] : draft.fileIds.filter(id => id !== file.id) })} />{file.name}<small>{value.resultFiles.some(item => item.id === file.id) ? '处理产物' : '原始附件'}</small></label>)}</fieldset>
          {options.data && <div className="information-capability-options"><label>Skill（可选）<select value={draft.skillIds[0] || ''} onChange={event => update({ ...draft, skillIds: event.target.value ? [event.target.value] : [] })}><option value="">由 Agent 按需选择</option>{options.data.skills.map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label><label>Agents（可选）<select value={draft.agentIds[0] || ''} onChange={event => update({ ...draft, agentIds: event.target.value ? [event.target.value] : [] })}><option value="">由 Agent 按需选择</option>{options.data.agents.map(agent => <option key={agent.name} value={agent.name}>{agent.name}</option>)}</select></label></div>}
          </fieldset>{options.error && <p role="status" className="resource-help">能力列表暂不可用，可稍后在对话中选择。</p>}
          <p className="resource-help">所选文件将复制到本席位的任务目录{workspace ? '' : '，首次使用时建立工作区'}。进入对话后发送才开始处理；后台分析确认后即提交。</p>
          <div className="information-actions"><button type="submit" className="primary-action" disabled={busy || Boolean(draft.pending) || task?.state !== 'active' || !draft.goal.trim()}>进入对话分析</button><button type="button" disabled={busy || Boolean(draft.pending) || task?.state !== 'active' || !draft.goal.trim()} onClick={() => setConfirm(true)}>提交后台分析</button></div>
        </form></section>
        {error && <p className="resource-error" role="alert">{error}</p>}{notice && <p className="resource-success" role="status">{notice}</p>}
        {draft.pending && <div className="information-actions"><button disabled={busy} onClick={() => void queryAction()}>查询本次结果</button>{(queriedMissing || action?.status === 'preparing') && <button disabled={busy} onClick={() => void submit(draft.pending!.mode, true)}>继续原操作</button>}{(queriedMissing || action?.status === 'completed') && <button disabled={busy} onClick={() => { update({ ...draft, pending: undefined }); setAction(undefined); setNotice('可编辑目标并发起另一项分析。'); }}>准备另一项分析</button>}{action?.status === 'completed' && action.sessionId && <button onClick={() => action.jobId ? openSession(action.sessionId!) : void prepared(action)}>进入关联对话</button>}</div>}
        {job.data && <section><h3>本次后台分析</h3><p role="status">{jobLabels[job.data.status]}</p>{job.data.error && <p className="resource-error">{job.data.error.message}</p>}{['queued', 'running'].includes(job.data.status) && <button disabled={busy} onClick={() => void stop()}>停止后台分析</button>}</section>}
        <AnalysisHistory items={value.analyses} seats={seats} openSession={openSession} />
      </>}</div></div>
    {visible && confirm && <Panel title="确认后台分析" close={() => setConfirm(false)}><div className="information-form"><p>任务：{task?.title}</p><InformationText>{draft.goal}</InformationText><p>使用 {draft.fileIds.length} 个文件{draft.includeResult ? '及预处理文字结果' : ''}。确认后将在后台排队处理，关闭页面不影响执行。</p><div className="information-actions"><button onClick={() => setConfirm(false)}>返回编辑</button><button className="primary-action" disabled={busy} onClick={() => void submit('background')}>确认提交后台分析</button></div></div></Panel>}
  </section>;
}
