import { useEffect, useRef, useState } from 'react';
import type { TaskSpace } from '../contracts/access';
import type { BackgroundAction, BackgroundAnalysisInput, BackgroundFile, InformationJobDetail } from '../contracts/background';
import type { AgentInfo, SkillInfo, Workspace } from '../contracts/index';
import { useApi } from './api';
import { Panel } from './Resources';
import { useContextCatalog } from './TaskContextEditor';
import { InformationText, informationError, jobLabels, useInformationQuery } from './information-ui';

type AnalysisDraft = { taskSpaceId: string; goal: string; includeResult: boolean; fileIds: string[]; skillIds: string[]; agentIds: string[]; pending?: BackgroundAnalysisInput };
export interface ContinuationProps {
  scope: string; visible: boolean; base: string; jobId?: string; fixedTaskId?: string; preferredTaskIds?: string[];
  files: BackgroundFile[]; resultFiles: BackgroundFile[]; tasks: TaskSpace[]; workspaces: Workspace[];
  prepared: (action: BackgroundAction, current: () => boolean) => Promise<void>; openSession: (id: string) => void; changed: () => void;
}
/** Mounted per origin. Persisted drafts are seat-partitioned, and async results retain their originating page. */
export function InformationContinuation({ scope, visible, base, jobId: sourceJobId, fixedTaskId, preferredTaskIds = [], files, resultFiles, tasks, workspaces, prepared, openSession, changed }: ContinuationProps) {
  const { api, storageKey } = useApi();
  const key = storageKey(`axon.information-draft:${scope}`);
  const [stored, setStored] = useState<AnalysisDraft | undefined>(() => { try { const saved = JSON.parse(sessionStorage.getItem(key) || 'null'); if(saved)return saved; return scope.startsWith('inbox:') ? JSON.parse(sessionStorage.getItem(storageKey('axon.inbox-drafts')) || '{}')[scope.slice(6)] : undefined; } catch { return undefined; } });
  const preferred = preferredTaskIds.filter(id => tasks.some(task => task.id === id && task.state === 'active'));
  const draft: AnalysisDraft = stored || { taskSpaceId: fixedTaskId || (preferred.length === 1 ? preferred[0]! : ''), goal: '', includeResult: true, fileIds: resultFiles.map(file => file.id), skillIds: [], agentIds: [] };
  const task = tasks.find(item => item.id === (fixedTaskId || draft.taskSpaceId));
  const workspace = workspaces.find(item => item.taskSpaceId === task?.id);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState(false);
  const [action, setAction] = useState<BackgroundAction>(); const [queriedMissing, setQueriedMissing] = useState(false); const [jobId, setJobId] = useState('');
  const navigation = useRef(0); const lock = useRef(false); const alive = useRef(true); const visibleRef = useRef(visible);
  useEffect(() => { visibleRef.current = visible; navigation.current++; }, [visible]);
  useEffect(() => () => { alive.current = false; }, []);
  const catalog = useContextCatalog(visible);
  const job = useInformationQuery<InformationJobDetail>(jobId ? `/api/background/jobs/${encodeURIComponent(jobId)}` : undefined, visible);
  function update(value: AnalysisDraft) { setStored(value); try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep in-memory drafts usable. */ } }
  function guard() { const path = location.pathname + location.search; const captured = navigation.current; return () => captured === navigation.current && alive.current && visibleRef.current && path === location.pathname + location.search; }
  const [capabilities, setCapabilities] = useState<{ taskId: string; skills: SkillInfo[]; agents: AgentInfo[] }>();
  const selectedTaskId = task?.id;
  const [optionsError, setOptionsError] = useState('');
  useEffect(() => {
    if (!selectedTaskId || !visible) return;
    let current = true;
    api<{ skills: SkillInfo[]; agents: AgentInfo[] }>(`${base}/analysis-options`, sourceJobId ? { jobId: sourceJobId } : { taskSpaceId: selectedTaskId })
      .then(data => { if (current) { setCapabilities({ taskId: selectedTaskId, ...data }); setOptionsError(''); } })
      .catch(reason => { if (current) setOptionsError(informationError(reason)); });
    return () => { current = false; };
  }, [api, base, sourceJobId, selectedTaskId, visible]);
  const options = capabilities?.taskId === task?.id ? capabilities : undefined;
  async function openPrepared(result: BackgroundAction, current = guard()) {
    try { await prepared(result, current); } catch (reason) { if (current()) setError(informationError(reason)); }
  }
  async function showAction(result: BackgroundAction, current: () => boolean) {
    changed();
    if (!current()) return;
    setAction(result); setNotice(result.status !== 'completed' ? '正在准备资料，请查询结果后继续。' : result.jobId ? '后台分析已提交，可离开页面，稍后在关联对话中查看。' : '对话和资料已准备好，进入后可编辑草稿，发送才开始处理。');
    if (result.jobId) setJobId(result.jobId);
    if (result.status === 'completed' && !result.jobId) await openPrepared(result, current);
  }
  async function submit(mode: BackgroundAnalysisInput['mode'], retry = false) {
    if (lock.current || task?.state !== 'active' || draft.pending && !retry) return;
    const input: BackgroundAnalysisInput = retry && draft.pending ? draft.pending : { clientActionId: crypto.randomUUID(), mode, taskSpaceId: task.id, goal: draft.goal.trim(), includeResult: draft.includeResult, fileIds: draft.fileIds, skillIds: draft.skillIds, agentIds: draft.agentIds };
    update({ ...draft, pending: input }); lock.current = true; setBusy(true); setError(''); setNotice(''); setConfirm(false); setQueriedMissing(false);
    const current = guard();
    try {
      const taskInput = { clientActionId: input.clientActionId, mode: input.mode, goal: input.goal, includeResult: input.includeResult, fileIds: input.fileIds, skillIds: input.skillIds, agentIds: input.agentIds };
      await showAction(await api<BackgroundAction>(`${base}/analyses`, sourceJobId ? { ...taskInput, jobId: sourceJobId } : input), current);
    }
    catch (reason) { if (current()) setError(`提交结果尚需核对，目标和资料选择已保留。${informationError(reason)}`); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function queryAction() {
    if (!draft.pending || lock.current) return; lock.current = true; setBusy(true); setError(''); const current = guard();
    try {
      const result = await api<BackgroundAction | null>(`${base}/analyses?${new URLSearchParams({clientActionId:draft.pending.clientActionId,...(sourceJobId?{jobId:sourceJobId}:{})})}`);
      if (!current()) return;
      if (result) await showAction(result, current); else { setQueriedMissing(true); setNotice('尚未登记此操作，可使用原内容重试。'); }
    } catch (reason) { if (current()) setError(informationError(reason)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function stop() {
    if (!job.data || lock.current) return; lock.current = true; setBusy(true); setError(''); const current = guard();
    try { await api(`/api/background/jobs/${encodeURIComponent(job.data.id)}/cancel`, { revision: job.data.revision }); if (current()) { job.refresh(); changed(); } }
    catch (reason) { if (current()) setError(informationError(reason)); } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  const choices = [...tasks.filter(item => preferred.includes(item.id)), ...tasks.filter(item => !preferred.includes(item.id))].filter(item => item.state === 'active');
  return <section><h3>{fixedTaskId ? '继续提问与处理' : '提问与处理'}</h3><form className="information-form" onSubmit={event => { event.preventDefault(); void submit('conversation'); }}>
    <fieldset disabled={busy || Boolean(draft.pending)}>
      {fixedTaskId ? <p>会话保存位置：{task?.title || '当前任务'}</p> : <><label>会话保存位置<select required value={draft.taskSpaceId} onChange={event => update({ ...draft, taskSpaceId: event.target.value, skillIds: [], agentIds: [] })}><option value="">选择工作任务或个人空间</option>{choices.map(item => <option key={item.id} value={item.id}>{item.title}{preferred.includes(item.id) ? '（相关任务）' : item.visibility === 'private' ? '（个人空间）' : ''}</option>)}</select></label><p className="resource-help">对话与所选文件保存在本席位的这个工作区；选择保存位置不修改信息关联。</p>{!choices.length && <p className="resource-help">请先建立工作任务或个人空间，再进入对话。</p>}</>}
      <label>问题或工作要求<textarea required rows={4} maxLength={12000} placeholder="例如：这个结论的依据是什么？或请根据这些建议拟一份核实要求。" value={draft.goal} onChange={event => update({ ...draft, goal: event.target.value })} /></label>
      <fieldset className="information-selection"><legend>使用的资料</legend><label className="information-check"><input type="checkbox" checked={draft.includeResult} onChange={event => update({ ...draft, includeResult: event.target.checked })} />处理文字结果</label>{[...resultFiles, ...files].map(file => <label className="information-check" key={file.id}><input type="checkbox" checked={draft.fileIds.includes(file.id)} onChange={event => update({ ...draft, fileIds: event.target.checked ? [...draft.fileIds, file.id] : draft.fileIds.filter(id => id !== file.id) })} />{file.name}<small>{resultFiles.some(item => item.id === file.id) ? '处理产物' : '原始附件'}</small></label>)}</fieldset>
      <details className="information-original"><summary>可选能力</summary>{options && <div className="information-capability-options"><label>Skill（可选）<select value={draft.skillIds[0] || ''} onChange={event => update({ ...draft, skillIds: event.target.value ? [event.target.value] : [] })}><option value="">由 Agent 按需选择</option>{options.skills.map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label><label>Agents（可选）<select value={draft.agentIds[0] || ''} onChange={event => update({ ...draft, agentIds: event.target.value ? [event.target.value] : [] })}><option value="">由 Agent 按需选择</option>{options.agents.map(agent => <option key={agent.name} value={agent.name}>{agent.name}</option>)}</select></label></div>}</details>
      {catalog.data && catalog.data.systems.length > 0 && <p className="resource-help">可查询系统：{catalog.data.systems.map(system => system.name).join('、')}</p>}
    </fieldset>{optionsError && <p role="status" className="resource-help">能力列表暂不可用，可稍后在对话中选择。</p>}{catalog.error && <p role="status" className="resource-help">{catalog.error}<button type="button" onClick={catalog.refresh}>重试读取目录</button></p>}
    <p className="resource-help">所选文件将复制到本席位的任务目录{workspace ? '' : '，首次使用时建立工作区'}。进入对话后发送才开始处理；后台分析确认后即提交。</p>
    {task?.state === 'archived' && <p role="status">任务已归档，可查看历史，重新开启后才能开展处理。</p>}
    <div className="information-actions"><button type="submit" className="primary-action" disabled={busy || Boolean(draft.pending) || task?.state !== 'active' || !draft.goal.trim()}>进入对话</button><button type="button" disabled={busy || Boolean(draft.pending) || task?.state !== 'active' || !draft.goal.trim()} onClick={() => setConfirm(true)}>提交后台分析</button></div>
  </form>
    {error && <p className="resource-error" role="alert">{error}</p>}{notice && <p className="resource-success" role="status">{notice}</p>}
    {draft.pending && <div className="information-actions"><button disabled={busy} onClick={() => void queryAction()}>查询本次结果</button>{(queriedMissing || action?.status === 'preparing') && <button disabled={busy} onClick={() => void submit(draft.pending!.mode, true)}>继续原操作</button>}{(queriedMissing || action?.status === 'completed') && <button disabled={busy} onClick={() => { update({ ...draft, pending: undefined }); setAction(undefined); setNotice('可编辑目标并发起另一项分析。'); }}>准备另一项分析</button>}{action?.status === 'completed' && action.sessionId && <button onClick={() => action.jobId ? openSession(action.sessionId!) : void openPrepared(action)}>进入关联对话</button>}</div>}
    {job.data && <section><h3>本次后台分析</h3><p role="status">{jobLabels[job.data.status]}</p>{job.data.error && <p className="resource-error">{job.data.error.message}</p>}{['queued', 'running'].includes(job.data.status) && <button disabled={busy} onClick={() => void stop()}>停止后台分析</button>}</section>}
    {visible && confirm && <Panel title="确认后台分析" close={() => setConfirm(false)}><div className="information-form"><p>会话保存位置：{task?.title}</p><InformationText>{draft.goal}</InformationText><p>使用 {draft.fileIds.length} 个文件{draft.includeResult ? '及处理文字结果' : ''}。确认后将在后台排队处理，关闭页面不影响执行。</p><div className="information-actions"><button onClick={() => setConfirm(false)}>返回编辑</button><button className="primary-action" disabled={busy} onClick={() => void submit('background')}>确认提交后台分析</button></div></div></Panel>}
  </section>;
}
