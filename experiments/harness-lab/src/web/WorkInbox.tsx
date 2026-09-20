import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { ArrowLeft, Inbox, Plus, RefreshCw } from 'lucide-react';
import type { SessionActivity, SessionSnapshot, Workspace } from '../contracts/index';
import type { PageWorkPrepareInput, WorkAction, WorkDetail, WorkItem, WorkPrepareInput, WorkReceipt, WorkState } from '../contracts/collaboration';
import { ApiFailure, useApi } from './api';
import { Panel } from './Resources';
import { HandoffFiles, WorkFilePicker } from './HandoffFiles';
import type { TestSeat } from './Seats';

export const workStateLabel: Record<WorkState, string> = { assigned: '待签收', working: '办理中', submitted: '待验收', returned: '已退回', completed: '已完成' };
export interface WorkInboxHandle { open: (id?: string, assignWorkspaceId?: string) => void }
type AssignmentDraft = { title: string; goal: string; assigneeSeatId: string; paths: string[] };
type Persisted = { assignments: Record<string, AssignmentDraft>; paths: Record<string, string[]>; reasons: Record<string, string>; pending?: { input: PageWorkPrepareInput; operationId?: string } };
const emptyDraft = (): Persisted => ({ assignments: {}, paths: {}, reasons: {} });
function restore(key: string): Persisted {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null') as Persisted | null;
    if (value && value.assignments && value.paths && value.reasons) return value;
  } catch { /* Use an in-memory draft when storage is unavailable. */ }
  return emptyDraft();
}
const message = (reason: unknown) => reason instanceof Error ? reason.message : '操作未完成，请查询最新状态后重试。';

export function WorkInbox({ visible, control, seats, seatId, workspaces, activities, maxFiles, createSession, openSession, refreshActivity, adoptSession }: {
  visible: boolean; control: Ref<WorkInboxHandle>; seats: TestSeat[]; seatId: string; workspaces: Workspace[]; activities: SessionActivity[]; maxFiles: number;
  createSession: (workspaceId: string, workItemId?: string) => Promise<string | null>;
  openSession: (id: string) => void; refreshActivity: () => Promise<void>; adoptSession: (snapshot: SessionSnapshot) => void;
}) {
  const { api, storageKey, domId } = useApi();
  const key = storageKey('axon.handoff-drafts');
  const [drafts, setDrafts] = useState(() => restore(key));
  const draftsRef = useRef(drafts);
  const updateDrafts = useCallback((change: (current: Persisted) => Persisted) => {
    const next = change(draftsRef.current); draftsRef.current = next; setDrafts(next);
    try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* Preserve drafts in memory. */ }
  }, [key]);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [filter, setFilter] = useState<'mine' | 'review' | 'sent' | 'all'>('mine');
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<WorkDetail>();
  const [assignWorkspaceId, setAssignWorkspaceId] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const assignTrigger = useRef<HTMLButtonElement>(null);
  const [action, setAction] = useState<WorkAction>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [needsQuery, setNeedsQuery] = useState(Boolean(drafts.pending));
  const [queriedMissing, setQueriedMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sessionChoice, setSessionChoice] = useState('');
  const [returnOpen, setReturnOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const refreshToken = useRef(0);
  const visibleRef = useRef(visible);
  useEffect(() => { visibleRef.current = visible; }, [visible]);
  const navigation = useRef(0);
  const seatName = (id: string) => seats.find(seat => seat.id === id)?.name || id;
  const refresh = useCallback(async () => {
    const token = ++refreshToken.current; setLoading(true);
    try {
      const result = await api<WorkItem[]>('/api/work-items');
      if (token === refreshToken.current) { setItems(result); setError(''); }
    } catch (reason) { if (token === refreshToken.current) setError(message(reason)); }
    finally { if (token === refreshToken.current) setLoading(false); }
  }, [api]);
  const readDetail = useCallback(async (id: string) => api<WorkDetail>(`/api/work-items/${encodeURIComponent(id)}`), [api]);
  useEffect(() => {
    if (!visible) return;
    let current = true;
    api<WorkItem[]>('/api/work-items').then(result => { if (current) setItems(result); }).catch((reason: unknown) => { if (current) setError(message(reason)); });
    const focus = () => { void refresh(); };
    window.addEventListener('focus', focus);
    return () => { current = false; window.removeEventListener('focus', focus); };
  }, [visible, refresh, api]);
  useImperativeHandle(control, () => ({ open: (id, owner) => {
    navigation.current++;
    setSelected(id || ''); setDetail(undefined); setError(''); setNotice('');
    setReturnOpen(false); setSubmitOpen(false); setSessionChoice('');
    if (owner) { setAssignWorkspaceId(owner); setAssignOpen(true); }
  } }), []);
  useEffect(() => {
    if (!selected || !visible) return;
    let current = true;
    readDetail(selected).then(value => { if (current) setDetail(value); }).catch((reason: unknown) => { if (current) setError(message(reason)); });
    return () => { current = false; };
  }, [selected, visible, items, readDetail]);
  async function showReceipt(receipt: WorkReceipt, capturedNavigation: number) {
    if (capturedNavigation !== navigation.current || !visibleRef.current) { await refresh(); return; }
    setSelected(receipt.workItemId); setNotice(`操作已完成：${workStateLabel[receipt.state]}。`);
    setAssignOpen(false); setSubmitOpen(false); setReturnOpen(false);
    await refreshActivity().catch(() => {}); await refresh();
    const value = await readDetail(receipt.workItemId);
    if (capturedNavigation === navigation.current && visibleRef.current) setDetail(value);
  }
  async function queryAction() {
    const pending = draftsRef.current.pending;
    if (!pending || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    const capturedNavigation = navigation.current;
    try {
      const result = await api<WorkAction>(pending.operationId ? `/api/work-actions/${encodeURIComponent(pending.operationId)}` : `/api/work-actions?${new URLSearchParams({ clientActionId: pending.input.clientActionId })}`);
      setAction(result); updateDrafts(current => ({ ...current, pending: { ...pending, operationId: result.operationId } }));
      setNeedsQuery(false); setQueriedMissing(false); setAssignOpen(false); setConfirmOpen(true);
      if (result.receipt) await showReceipt(result.receipt, capturedNavigation);
    } catch (reason) {
      if (reason instanceof ApiFailure && reason.status === 404 && !pending.operationId) { setQueriedMissing(true); setNeedsQuery(false); setNotice('未找到本次准备结果，可以用原内容重试准备。'); }
      else { setNeedsQuery(true); setError(`查询未完成，原内容已保留。${message(reason)}`); }
    } finally { lock.current = false; setBusy(false); }
  }
  async function prepare(input: WorkPrepareInput, retry?: PageWorkPrepareInput) {
    if (lock.current) return;
    if (draftsRef.current.pending && !retry) { setError('还有一项操作需要核对，请先继续确认或取消本次操作。'); return; }
    const request: PageWorkPrepareInput = retry || { ...input, clientActionId: crypto.randomUUID() };
    updateDrafts(current => ({ ...current, pending: { input: request } }));
    lock.current = true; setBusy(true); setError(''); setNotice(''); setAction(undefined);
    try {
      const result = await api<WorkAction>('/api/work-items/prepare', request);
      setAction(result); updateDrafts(current => ({ ...current, pending: { input: request, operationId: result.operationId } }));
      setConfirmOpen(true); setNeedsQuery(false); setQueriedMissing(false); setAssignOpen(false);
    } catch (reason) { setNeedsQuery(true); setError(`准备结果需要核对，表单已保留。${message(reason)}`); }
    finally { lock.current = false; setBusy(false); }
  }
  async function finishAction(cancel = false) {
    if (!action || lock.current || needsQuery || action.status !== 'prepared') return;
    lock.current = true; setBusy(true); setError('');
    const capturedNavigation = navigation.current;
    try {
      if (cancel) {
        const result = await api<WorkAction>(`/api/work-actions/${encodeURIComponent(action.operationId)}/cancel`, {});
        setAction(result);
        if (result.receipt) await showReceipt(result.receipt, capturedNavigation);
        else { updateDrafts(current => ({ ...current, pending: undefined })); setConfirmOpen(false); setAction(undefined); setNotice('本次操作已取消，表单内容保留。'); }
      } else {
        const receipt = await api<WorkReceipt>(`/api/work-actions/${encodeURIComponent(action.operationId)}/commit`, { confirm: true });
        setAction({ ...action, status: 'committed', receipt });
        await showReceipt(receipt, capturedNavigation);
      }
    } catch (reason) { setNeedsQuery(true); setError(`结果尚未确认，请先查询结果。${message(reason)}`); }
    finally { lock.current = false; setBusy(false); }
  }
  function dismissCompleted() { updateDrafts(current => ({ ...current, pending: undefined })); setAction(undefined); setConfirmOpen(false); setNeedsQuery(false); }
  const workspace = workspaces.find(item => item.taskSpaceId === detail?.taskSpaceId);
  const assignWorkspace = workspaces.find(item => item.id === assignWorkspaceId);
  const assignment = drafts.assignments[assignWorkspaceId] || { title: '', goal: '', assigneeSeatId: seats.find(seat => seat.id !== seatId)?.id || '', paths: [] };
  const changeAssignment = (value: Partial<AssignmentDraft>) => updateDrafts(current => ({ ...current, assignments: { ...current.assignments, [assignWorkspaceId]: { ...assignment, ...value } } }));
  const eligibleSessions = activities.filter(item => item.workspaceId === workspace?.id && (!item.workItemId || item.workItemId === detail?.id));
  async function beginConversation() {
    if (!detail || !workspace || lock.current) return;
    navigation.current++;
    lock.current = true; setBusy(true); setError('');
    const capturedNavigation = navigation.current;
    try {
      let id: string | null;
      if (sessionChoice) {
        const bound = await api<SessionSnapshot>(`/api/sessions/${encodeURIComponent(sessionChoice)}/work-item`, { workItemId: detail.id });
        adoptSession(bound); id = bound.id;
      } else id = await createSession(workspace.id, detail.id);
      if (!id) throw new Error('会话创建未完成，请刷新会话列表后核对。');
      await refreshActivity();
      if (capturedNavigation === navigation.current && visibleRef.current) openSession(id);
    } catch (reason) { setError(message(reason)); }
    finally { lock.current = false; setBusy(false); }
  }
  function selectWork(id: string) { navigation.current++; setSelected(id); setDetail(undefined); setSessionChoice(''); setReturnOpen(false); setSubmitOpen(false); setError(''); setNotice(''); }
  const filtered = items.filter(item => filter === 'all' ? true : filter === 'sent' ? item.creatorSeatId === seatId : filter === 'review' ? item.creatorSeatId === seatId && item.state === 'submitted' : item.assigneeSeatId === seatId && item.state !== 'completed');
  const currentSubmission = detail?.submissions.find(item => item.id === detail.latestSubmissionId);
  const canWork = detail?.assigneeSeatId === seatId && (detail.state === 'working' || detail.state === 'returned');
  const canReview = detail?.creatorSeatId === seatId && detail.state === 'submitted' && currentSubmission;
  return <section id={domId('work-inbox')} tabIndex={-1} className="work-inbox" hidden={!visible} aria-label="工作待办">
    <header className="work-inbox-header"><div><h1>工作待办</h1><p>从分派到交接，在各自项目中开展工作。</p></div><button disabled={loading} onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" />刷新待办</button></header>
    {error && <p className="resource-error" role="alert">{error}</p>}{notice && <p className="resource-success" role="status">{notice}</p>}
    {drafts.pending && <div className="work-pending" role="status"><span>{needsQuery ? '有一项操作需要查询结果。' : '有一项操作尚待核对。'}</span><button disabled={busy} onClick={() => void queryAction()}>查询结果</button>{action && <button onClick={() => setConfirmOpen(true)}>继续确认</button>}{queriedMissing && <><button disabled={busy} onClick={() => void prepare(drafts.pending!.input, drafts.pending!.input)}>重试原准备请求</button><button disabled={busy} onClick={dismissCompleted}>放弃未成功的准备</button></>}</div>}
    <div className={`work-columns${selected ? ' has-selection' : ''}`}>
      <div className="work-list-pane"><div className="work-filters" aria-label="待办分类">{([['mine', '待我办理'], ['review', '待我验收'], ['sent', '我发起的'], ['all', '全部']] as const).map(([id, label]) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}<span>{items.filter(item => id === 'all' ? true : id === 'sent' ? item.creatorSeatId === seatId : id === 'review' ? item.creatorSeatId === seatId && item.state === 'submitted' : item.assigneeSeatId === seatId && item.state !== 'completed').length}</span></button>)}</div><ul className="work-list">{filtered.map(item => <li key={item.id}><button aria-current={selected === item.id ? 'true' : undefined} onClick={() => selectWork(item.id)}><strong>{item.title}</strong><span>{workStateLabel[item.state]}</span><small>{workspaces.find(workspace => workspace.taskSpaceId === item.taskSpaceId)?.name || '项目'} · {seatName(item.creatorSeatId)} → {seatName(item.assigneeSeatId)}</small></button></li>)}</ul>{!loading && !filtered.length && <p className="work-empty"><Inbox size={24} aria-hidden="true" />暂时没有这类工作。</p>}</div>
      <div className="work-detail-pane">{!selected ? <div className="work-empty"><p>选择一项工作查看目标、资料与进度。</p><label>选择项目<select value={assignWorkspaceId} onChange={event => setAssignWorkspaceId(event.target.value)}><option value="">请选择项目</option>{workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button ref={assignTrigger} disabled={!assignWorkspaceId} onClick={() => setAssignOpen(true)}><Plus size={16} aria-hidden="true" />分派工作</button></div> : !detail ? <p role="status">正在读取工作详情…</p> : <>
        <button className="work-back" onClick={() => selectWork('')}><ArrowLeft size={16} aria-hidden="true" />返回列表</button><header><span className="work-state">{workStateLabel[detail.state]}</span><h2>{detail.title}</h2><p>{seatName(detail.creatorSeatId)} → {seatName(detail.assigneeSeatId)}</p></header><p className="work-goal">{detail.goal}</p>
        {detail.inputFiles.length > 0 && <section><h3>输入资料</h3><HandoffFiles files={detail.inputFiles} workspaceId={workspace?.id} /></section>}
        {detail.assigneeSeatId === seatId && detail.state === 'assigned' && <button className="primary-action" disabled={busy} onClick={() => void prepare({ kind: 'claim', workItemId: detail.id, expectedRevision: detail.revision, payload: {} })}>开始办理</button>}
        {detail.state !== 'assigned' && workspace && <section className="work-conversation"><h3>办理对话</h3><label>选择对话<select value={sessionChoice} onChange={event => setSessionChoice(event.target.value)}><option value="">新建关联对话</option>{eligibleSessions.map(item => <option key={item.id} value={item.id} disabled={Boolean(item.active)}>{item.title}{item.active ? '（正在处理）' : detail.sessionIds.includes(item.id) ? '（已关联）' : '（关联此对话）'}</option>)}</select></label><button disabled={busy} onClick={() => void beginConversation()}>{sessionChoice ? '进入对话' : '新建对话办理'}</button></section>}
        {canWork && workspace && <section><button disabled={busy} onClick={() => setSubmitOpen(value => !value)} aria-expanded={submitOpen}>提交文件</button>{submitOpen && <form className="work-form" onSubmit={event => { event.preventDefault(); const path = drafts.paths[detail.id]?.[0]; if (path) void prepare({ kind: 'submit', workItemId: detail.id, expectedRevision: detail.revision, payload: { workspaceId: workspace.id, path } }); }}><WorkFilePicker key={detail.id} workspaceId={workspace.id} selected={drafts.paths[detail.id] || []} onChange={paths => updateDrafts(current => ({ ...current, paths: { ...current.paths, [detail.id]: paths } }))} /><button className="primary-action" type="submit" disabled={busy || !drafts.paths[detail.id]?.length}>预览提交内容</button></form>}</section>}
        {canReview && <section className="work-review-actions"><button className="primary-action" disabled={busy} onClick={() => void prepare({ kind: 'review', workItemId: detail.id, expectedRevision: detail.revision, payload: { submissionId: currentSubmission.id, decision: 'accept' } })}>验收通过</button><button disabled={busy} onClick={() => setReturnOpen(value => !value)} aria-expanded={returnOpen}>退回修改</button>{returnOpen && <form className="work-form" onSubmit={event => { event.preventDefault(); const reason = drafts.reasons[detail.id]?.trim(); if (reason) void prepare({ kind: 'review', workItemId: detail.id, expectedRevision: detail.revision, payload: { submissionId: currentSubmission.id, decision: 'return', reason } }); }}><label>退回意见<textarea required maxLength={4000} value={drafts.reasons[detail.id] || ''} onChange={event => updateDrafts(current => ({ ...current, reasons: { ...current.reasons, [detail.id]: event.target.value } }))} /></label><button type="submit" disabled={busy || !drafts.reasons[detail.id]?.trim()}>核对退回意见</button></form>}</section>}
        {detail.submissions.length > 0 && <section><h3>提交记录</h3>{detail.submissions.map(submission => <article className="work-submission" key={submission.id}><h4>第 {submission.attempt} 次提交{submission.id === detail.latestSubmissionId ? ' · 当前版本' : ''}</h4><p>{new Date(submission.createdAt).toLocaleString('zh-CN')}</p><HandoffFiles files={[submission.file]} workspaceId={workspace?.id} />{submission.review && <div className="work-review"><strong>{submission.review.decision === 'accept' ? '验收通过' : '已退回'}</strong>{submission.review.reason && <p>{submission.review.reason}</p>}</div>}</article>)}</section>}
      </>}</div>
    </div>
    {visible && assignOpen && assignWorkspace && <Panel title={`分派工作 · ${assignWorkspace.name}`} close={() => { setAssignOpen(false); requestAnimationFrame(() => assignTrigger.current?.focus()); }}><form className="work-form" onSubmit={event => { event.preventDefault(); if (assignWorkspace.taskSpaceId) void prepare({ kind: 'assign', taskSpaceId: assignWorkspace.taskSpaceId, payload: { workspaceId: assignWorkspace.id, title: assignment.title.trim(), goal: assignment.goal.trim(), assigneeSeatId: assignment.assigneeSeatId, inputPaths: assignment.paths } }); }}><label>工作标题<input required maxLength={120} value={assignment.title} onChange={event => changeAssignment({ title: event.target.value })} /></label><label>工作目标<textarea required maxLength={12000} rows={5} value={assignment.goal} onChange={event => changeAssignment({ goal: event.target.value })} /></label><label>接收席位<select value={assignment.assigneeSeatId} onChange={event => changeAssignment({ assigneeSeatId: event.target.value })}>{seats.filter(seat => seat.id !== seatId).map(seat => <option key={seat.id} value={seat.id}>{seat.name}</option>)}</select></label><WorkFilePicker workspaceId={assignWorkspace.id} selected={assignment.paths} onChange={paths => changeAssignment({ paths })} multiple maxFiles={maxFiles} />{error && <p className="resource-error" role="alert">{error}</p>}{drafts.pending && <button type="button" disabled={busy} onClick={() => void queryAction()}>查询结果</button>}<button type="submit" className="primary-action" disabled={busy || !assignment.title.trim() || !assignment.goal.trim() || !assignWorkspace.taskSpaceId || Boolean(drafts.pending)}>核对分派内容</button></form></Panel>}
    {visible && confirmOpen && action && <Panel title={action.status === 'committed' ? '操作已完成' : '确认交接内容'} close={() => setConfirmOpen(false)}><div className="work-confirmation"><h3>{action.title}</h3><p>{action.description}</p><p>{seatName(action.creatorSeatId)} → {seatName(action.assigneeSeatId)}</p><HandoffFiles files={action.files} /><p className="resource-help">这里展示的是已保存的副本。原文件后续修改不会改变本次内容。</p>{error && <p className="resource-error" role="alert">{error}</p>}{action.receipt ? <><p role="status">已完成：{workStateLabel[action.receipt.state]}</p><button className="primary-action" onClick={dismissCompleted}>查看工作</button></> : needsQuery ? <button disabled={busy} onClick={() => void queryAction()}>查询结果</button> : action.status !== 'prepared' ? <><p role="status">{action.status === 'expired' ? '本次准备已失效，请重新准备并确认。' : '本次准备已取消。'}</p><button onClick={dismissCompleted}>返回编辑</button></> : <div className="resource-actions"><button disabled={busy} onClick={() => void finishAction(true)}>取消本次操作</button><button disabled={busy} className="primary-action" onClick={() => void finishAction()}>{busy ? '处理中…' : '确认执行交接'}</button></div>}</div></Panel>}
  </section>;
}

export function LinkedWork({ id, open }: { id: string; open: () => void }) {
  const { api } = useApi();
  const [title, setTitle] = useState('关联工作');
  useEffect(() => {
    let current = true;
    api<WorkItem>(`/api/work-items/${encodeURIComponent(id)}`).then(item => { if (current) setTitle(item.title); }).catch(() => {});
    return () => { current = false; };
  }, [api, id]);
  return <button className="linked-work" aria-label="查看关联工作" onClick={open}>{title}</button>;
}
