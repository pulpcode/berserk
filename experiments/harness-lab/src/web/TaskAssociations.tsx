import { useEffect, useRef, useState } from 'react';
import type { Identity, TaskSpace } from '../contracts/access';
import type { TaskLinkUpdateInput, TaskLinksView } from '../contracts/task-information';
import { useApi } from './api';
import { TaskPanel } from './Tasks';
import { informationError, informationTime, useInformationQuery } from './information-ui';

type Edit = { taskId: string; reason: string; mode: TaskLinkUpdateInput['mode']; revision: number; jobId: string };
export function TaskAssociations({ eventId, jobId, visible, identity, tasks, savedTask, openTask, changed }: { eventId: string; jobId: string; visible: boolean; identity: Identity; tasks: TaskSpace[]; savedTask: (task: TaskSpace) => void; openTask: (id: string) => void; changed?: () => void }) {
  const { api } = useApi();
  const path = `/api/information/events/${encodeURIComponent(eventId)}/task-links?jobId=${encodeURIComponent(jobId)}`;
  const query = useInformationQuery<TaskLinksView>(path, visible);
  const [create, setCreate] = useState(false); const [edit, setEdit] = useState<Edit>();
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [needsRead, setNeedsRead] = useState(false); const [latest, setLatest] = useState<TaskLinksView>();
  const alive = useRef(true); const lock = useRef(false);
  useEffect(() => () => { alive.current = false; }, []);
  const value = query.data;
  const manageable = tasks.filter(task => task.state === 'active' && (task.visibility === 'public' ? identity.createPublicTask : task.ownerSeatId === identity.seatId));
  function begin(taskId = '') {
    const link = value?.links.find(item => item.task.id === taskId);
    setEdit({ taskId, reason: link?.reason || '', mode: 'include', revision: value?.revisions?.[taskId] ?? link?.revision ?? 0, jobId: link?.jobId || jobId }); setNeedsRead(false); setLatest(undefined); setError(''); setNotice('');
  }
  async function save() {
    if (!edit || !edit.taskId || lock.current || needsRead) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await api(`/api/information/events/${encodeURIComponent(eventId)}/task-links/${encodeURIComponent(edit.taskId)}`, { revision: edit.revision, mode: edit.mode, jobId: edit.jobId, ...(edit.mode === 'include' ? { reason: edit.reason.trim() } : {}) }, 'PUT');
      if (!alive.current) return;
      setEdit(undefined); setNotice('关联已更新。'); query.refresh(); changed?.();
    } catch (reason) { if (alive.current) { setError(`${informationError(reason)} 编辑内容已保留，请先核对最新关联。`); setNeedsRead(true); setLatest(undefined); } }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function readLatest() {
    try { const result = await api<TaskLinksView>(path); if (alive.current) setLatest(result); }
    catch (reason) { if (alive.current) setError(informationError(reason)); }
  }
  const suggestion = value?.assessment?.newTaskSuggestion;
  const linkMode = { auto: '自动关联', include: '人工保留', exclude: '已移除' };
  return <section className="task-associations" aria-label="任务关联"><h3>任务关联</h3>
    {query.error && <p className="resource-error" role="alert">{query.error}<button onClick={query.refresh}>重新读取关联</button></p>}
    {!value ? !query.error && <p role="status">正在读取任务判断…</p> : <>
      <p className="resource-help">{value.assessment ? `本次判断：${informationTime(value.assessment.recordedAt)}` : '此次分析未记录任务判断。'} 本区域展示所选分析版本及当前人工决定。</p>
      {value.assessment?.emptyReason && <p>暂不归口：{value.assessment.emptyReason}</p>}
      <ul className="task-association-list">{value.links.filter(link => link.mode !== 'exclude' || link.canManage).map(link => <li key={link.task.id}>
        <div className="information-actions"><button className="information-row-link" onClick={() => openTask(link.task.id)}>{link.task.title}</button><span>{linkMode[link.mode]}{link.task.state === 'archived' ? ' · 已归档' : ''}</span></div><p>{link.reason}</p>
        {link.taskChanged && <p className="resource-help">任务说明已更新，关联依据为旧版本。</p>}
        {link.canManage && link.task.state === 'active' && <button disabled={busy} onClick={() => begin(link.task.id)}>调整关联</button>}
      </li>)}</ul>
      {suggestion && <aside className="task-suggestion"><h4>建议新建公共任务</h4><strong>{suggestion.title}</strong><p>{suggestion.goal}</p><p>建议理由：{suggestion.reason}</p>
        {value.creation ? <p className="resource-success">已创建：<button className="information-row-link" onClick={() => openTask(value.creation!.taskSpaceId)}>{tasks.find(task => task.id === value.creation?.taskSpaceId)?.title || '查看任务'}</button></p> : value.canCreateTask ? <button disabled={busy} onClick={() => setCreate(true)}>创建公共任务并关联</button> : <p className="resource-help">有工作任务管理权限的人员可审阅并创建。</p>}
      </aside>}
      {manageable.length > 0 && !edit && <button disabled={busy} onClick={() => begin()}>关联已有任务或个人空间</button>}
    </>}
    {edit && <form className="information-form task-link-editor" onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={busy}>
      <label>任务或个人空间<select required value={edit.taskId} onChange={event => begin(event.target.value)}><option value="">请选择</option>{manageable.map(task => <option key={task.id} value={task.id}>{task.title}{task.visibility === 'private' ? '（个人空间）' : ''}</option>)}</select></label>
      <p className="resource-help">公共任务关联对有权读取此信息的人员生效；个人空间关联仅本席位可见。</p>
      <label>处理方式<select value={edit.mode} onChange={event => setEdit({ ...edit, mode: event.target.value as Edit['mode'] })}><option value="include">保留／补充关联</option><option value="exclude">移除关联</option><option value="auto">恢复自动判断</option></select></label>
      {edit.mode === 'include' && <><label>关联理由<textarea required maxLength={1500} rows={3} value={edit.reason} onChange={event => setEdit({ ...edit, reason: event.target.value })} /></label><p className="resource-help">人工保留会固定所选分析版本，后续自动分析不会覆盖。</p>{edit.jobId !== jobId && <button type="button" onClick={() => setEdit({ ...edit, jobId })}>改用当前查看的分析版本</button>}</>}
    </fieldset>{needsRead && <button type="button" disabled={busy} onClick={() => void readLatest()}>查看最新关联</button>}
      {latest && <aside className="task-comparison"><strong>最新关联（你的编辑仍保留）</strong><p>{latest.links.find(link => link.task.id === edit.taskId)?.reason || '当前没有人工保留或自动关联。'}</p><p>{linkMode[latest.links.find(link => link.task.id === edit.taskId)?.mode || 'auto']}</p><button type="button" onClick={() => { setEdit({ ...edit, revision: latest.revisions?.[edit.taskId] ?? latest.links.find(link => link.task.id === edit.taskId)?.revision ?? 0 }); setNeedsRead(false); setLatest(undefined); setError(''); }}>已核对，继续编辑</button></aside>}
      <div className="information-actions"><button type="submit" className="primary-action" disabled={busy || needsRead || !edit.taskId || edit.mode === 'include' && !edit.reason.trim()}>保存关联</button><button type="button" disabled={busy} onClick={() => { setEdit(undefined); setError(''); }}>取消</button></div>
    </form>}
    {error && <p className="resource-error" role="alert">{error}</p>}{notice && <p className="resource-success" role="status">{notice}</p>}
    {visible && create && suggestion && <TaskPanel identity={identity} visibility="public" suggestion={{ ...suggestion, eventId, jobId }} close={() => setCreate(false)} saved={task => { savedTask(task); query.refresh(); changed?.(); setNotice('公共任务已创建并关联原信息。'); }} />}
  </section>;
}
