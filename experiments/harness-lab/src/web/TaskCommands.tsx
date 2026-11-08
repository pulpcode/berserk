import { useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import type { TaskSpace } from '../contracts/access';
import type { CommandInput, CommandRecord } from '../contracts/commands';
import type { HandoffFile, WorkDetail, WorkItem } from '../contracts/collaboration';
import type { ContextQueryResult, ContextRef, SituationCurrent, SituationObject } from '../contracts/context';
import type { Workspace } from '../contracts/index';
import { isConnectionFailure, useApi } from './api';
import { HandoffFiles } from './HandoffFiles';
import { LoadingIndicator } from './LoadingIndicator';
import { Panel } from './Resources';
import { informationError, informationTime, useInformationQuery } from './information-ui';
import { randomUUID } from './random-uuid';

type Draft = { vehicles: string[]; destination: string; route: string[]; attachment: string; notes: string };
type Pending = { input: { workspaceId: string; clientActionId: string; command: CommandInput }; id?: string };
type Stored = { draft: Draft; pending?: Pending };
const blank = (): Stored => ({ draft: { vehicles: [], destination: '', route: [], attachment: '', notes: '' } });
const statusLabel: Record<CommandRecord['status'], string> = { prepared: '待确认', cancelled: '已取消', unknown: '待核对', received: '已接收', rejected: '未接收' };
const recordStatus = (item: CommandRecord) => item.status === 'prepared' && item.source === 'agent' ? '待对话确认' : statusLabel[item.status];
function restore(key: string): Stored {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null') as Stored | null;
    if (value?.draft && Array.isArray(value.draft.vehicles) && Array.isArray(value.draft.route)) return value;
  } catch { /* Continue with an in-memory draft when storage is unavailable. */ }
  return blank();
}

export function TaskCommands({ task }: { task: TaskSpace }) {
  const { api, storageKey } = useApi();
  const key = storageKey(`axon.command-draft:${task.id}`);
  const [stored, setStored] = useState(() => restore(key));
  const saved = useRef(stored);
  const [open, setOpen] = useState(false);
  const [record, setRecord] = useState<CommandRecord>();
  const [workspace, setWorkspace] = useState<Workspace>();
  const [objects, setObjects] = useState<SituationObject[]>([]);
  const [files, setFiles] = useState<HandoffFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const locked = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const availability = useInformationQuery<{ canRead: boolean; canPrepare: boolean }>(`/api/commands/availability?taskId=${encodeURIComponent(task.id)}`, true);
  const current = useInformationQuery<CommandRecord[]>(`/api/commands?taskId=${encodeURIComponent(task.id)}`, availability.data?.canRead === true);
  const writable = availability.data?.canPrepare === true && task.state === 'active' && !task.readOnly;
  useEffect(() => () => { alive.current = false; }, []);
  function save(next: Stored) {
    saved.current = next; setStored(next);
    try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* Keep the current draft in memory. */ }
  }
  function change(change: Partial<Draft>) { save({ ...saved.current, draft: { ...saved.current.draft, ...change } }); }
  async function loadChoices(prepare = true) {
    setLoading(true); setError('');
    try {
      const [directory, works] = await Promise.all([
        prepare ? api<Workspace>(`/api/tasks/${encodeURIComponent(task.id)}/workspace`, {}) : undefined,
        prepare ? api<WorkItem[]>('/api/work-items') : [],
      ]);
      const all: SituationObject[] = [];
      let cursor: string | undefined;
      do {
        const result = await api<ContextQueryResult>(`/api/context/situation?taskId=${encodeURIComponent(task.id)}`, { systemId: 'situation', mode: 'current', limit: 100, ...(cursor ? { cursor } : {}) });
        const data = result.data as SituationCurrent;
        all.push(...data.items); cursor = data.nextCursor || undefined;
      } while (cursor);
      const details = await Promise.all(works.filter(item => item.taskSpaceId === task.id).map(item => api<WorkDetail>(`/api/work-items/${encodeURIComponent(item.id)}`)));
      const choices = new Map<string, HandoffFile>();
      for (const item of details) for (const file of [...item.inputFiles, ...item.submissions.map(submission => submission.file)]) choices.set(file.fileId, file);
      if (alive.current) { setWorkspace(directory); setObjects(all); setFiles([...choices.values()]); }
    } catch (reason) { if (alive.current) setError(informationError(reason)); }
    finally { if (alive.current) setLoading(false); }
  }
  function begin(item?: CommandRecord) {
    setRecord(item); setOpen(true); setError(''); setNotFound(false);
    void loadChoices(!item);
    if (!item && saved.current.pending) void readPending();
  }
  async function readPending() {
    const pending = saved.current.pending;
    if (!pending || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const list = pending.id ? [await api<CommandRecord>(`/api/commands/${encodeURIComponent(pending.id)}`)] : await api<CommandRecord[]>(`/api/commands?taskId=${encodeURIComponent(task.id)}&clientActionId=${encodeURIComponent(pending.input.clientActionId)}`);
      if (!alive.current) return;
      const item = list[0];
      if (item) { setRecord(item); save({ ...saved.current, pending: item.status === 'prepared' || item.status === 'unknown' ? { ...pending, id: item.id } : undefined }); current.refresh(); }
      else { setNotFound(true); setError('尚未查到准备结果，可以再次查询或重试本次准备。'); }
    } catch (reason) { if (alive.current) setError(informationError(reason)); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  async function prepare() {
    if (!workspace || locked.current || saved.current.pending) return;
    const draft = saved.current.draft;
    const find = (id: string): CommandInput['destination'] => ({ ...objects.find(item => item.ref.objectId === id)!.ref, systemId: 'situation' });
    const command: CommandInput = { vehicles: draft.vehicles.map(find), destination: find(draft.destination), route: draft.route.map(find), ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}), ...(draft.attachment ? { attachmentFileId: draft.attachment } : {}) };
    const pending: Pending = { input: { workspaceId: workspace.id, clientActionId: randomUUID(), command } };
    save({ ...saved.current, pending });
    await sendPreparation(pending);
  }
  async function sendPreparation(pending: Pending) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setNotFound(false);
    try {
      const item = await api<CommandRecord>('/api/commands/prepare', pending.input);
      if (alive.current) { setRecord(item); save({ ...saved.current, pending: { ...pending, id: item.id } }); current.refresh(); }
    } catch (reason) {
      if (alive.current) { setError(informationError(reason)); if (!isConnectionFailure(reason)) save({ ...saved.current, pending: undefined }); }
    } finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  async function act(action: 'commit' | 'cancel' | 'reconcile') {
    if (!record || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const item = await api<CommandRecord>(`/api/commands/${encodeURIComponent(record.id)}/${action}`, action === 'commit' ? { confirm: true } : {});
      if (alive.current) { setRecord(item); current.refresh(); if (item.status !== 'prepared' && item.status !== 'unknown') save({ ...saved.current, pending: undefined }); }
    } catch (reason) {
      if (alive.current) { setError(informationError(reason)); if (action === 'commit' && isConnectionFailure(reason)) setRecord({ ...record, status: 'unknown' }); }
    } finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  function close() { setOpen(false); trigger.current?.focus(); }
  function label(ref: ContextRef) { return objects.find(item => item.ref.objectId === ref.objectId)?.name || ref.objectId; }
  const vehicles = objects.filter(item => Boolean(item.resourceData?.resource.vehicle));
  const destinations = objects.filter(item => item.resourceData?.resource.category === 'facility');
  const roads = objects.filter(item => item.ref.objectType === 'road');
  const draft = stored.draft;
  const validSelection = draft.vehicles.length > 0 && draft.vehicles.every(id => vehicles.some(item => item.ref.objectId === id)) && destinations.some(item => item.ref.objectId === draft.destination) && draft.route.every(id => roads.some(item => item.ref.objectId === id)) && (!draft.attachment || files.some(file => file.fileId === draft.attachment));
  const toggle = (field: 'vehicles' | 'route', id: string) => change({ [field]: draft[field].includes(id) ? draft[field].filter(value => value !== id) : [...draft[field], id] });
  if (!availability.data?.canRead) return availability.error ? <p className="resource-error" role="alert">{availability.error}</p> : null;
  return <section className="task-commands task-description" aria-label="指令记录">
    <header className="task-description-heading"><h2>指令</h2><div className="resource-actions"><button onClick={current.refresh} aria-label="刷新指令记录"><RefreshCw size={15} aria-hidden="true" /></button><button ref={trigger} disabled={!writable} onClick={() => begin()}><Plus size={15} aria-hidden="true" />{stored.pending ? '核对下达结果' : '下达指令'}</button></div></header>
    {current.error && <p className="resource-error" role="alert">{current.error}</p>}
    {!current.data && !current.error && <LoadingIndicator label="正在读取指令…" />}
    {current.data?.length === 0 && <p className="resource-help">暂无指令</p>}
    {current.data && current.data.length > 0 && <ul className="command-records">{current.data.map(item => <li key={item.id}><button className="command-record" onClick={() => begin(item)}><span>{item.command.vehicles.length} 辆车 · {informationTime(item.createdAt)}</span><span>{recordStatus(item)}</span></button></li>)}</ul>}
    {open && <Panel title={record ? '指令详情' : '下达指令'} close={close}>
      {record ? <div className="work-confirmation"><p role="status">{recordStatus(record)}</p><dl className="command-summary"><dt>车辆</dt><dd>{record.command.vehicles.map(label).join('、')}</dd><dt>目的地</dt><dd>{label(record.command.destination)}</dd><dt>路线</dt><dd>{record.command.route.map(label).join(' → ') || '未指定'}</dd>{record.command.notes && <><dt>执行说明</dt><dd>{record.command.notes}</dd></>}<dt>下达人</dt><dd>{record.seatName}</dd></dl>{record.attachment && <HandoffFiles files={[record.attachment]} />}{record.receipt && <dl className="command-summary"><dt>接收编号</dt><dd>{record.receipt.receiptId}</dd><dt>接收时间</dt><dd>{informationTime(record.receipt.receivedAt)}</dd></dl>}{record.error && <p className="resource-error">{record.error}</p>}
        {record.status === 'prepared' && record.source === 'page' && <div className="resource-actions"><button disabled={busy} onClick={() => void act('cancel')}>取消本次下达</button><button className="primary-action" disabled={busy || !writable} onClick={() => void act('commit')}>确认下达</button></div>}{record.status === 'unknown' && <button disabled={busy} onClick={() => void act('reconcile')}>查询接收回执</button>}
      </div> : stored.pending ? <div className="resource-actions"><button disabled={busy} onClick={() => void readPending()}>查询准备结果</button>{notFound && <button disabled={busy || !writable} onClick={() => void sendPreparation(stored.pending!)}>重试本次准备</button>}</div> : loading ? <LoadingIndicator label="正在读取可选对象…" /> : <form className="work-form command-form" onSubmit={event => { event.preventDefault(); if (validSelection) void prepare(); }}><fieldset disabled={busy || !writable || !workspace}>
        <legend>车辆</legend><div className="command-choices">{vehicles.map(item => <label key={item.ref.objectId}><input type="checkbox" checked={draft.vehicles.includes(item.ref.objectId)} onChange={() => toggle('vehicles', item.ref.objectId)} />{item.name}</label>)}</div>
        <label>目的地<select required value={draft.destination} onChange={event => change({ destination: event.target.value })}><option value="">请选择目的地</option>{destinations.map(item => <option key={item.ref.objectId} value={item.ref.objectId}>{item.name}</option>)}</select></label>
        <fieldset><legend>路线（可选）</legend><div className="command-choices">{roads.map(item => <label key={item.ref.objectId}><input type="checkbox" checked={draft.route.includes(item.ref.objectId)} onChange={() => toggle('route', item.ref.objectId)} />{item.name}</label>)}</div>{draft.route.length > 0 && <p className="resource-help">{draft.route.map(id => label({ systemId: 'situation', objectType: 'road', objectId: id })).join(' → ')}</p>}</fieldset>
        <label>方案附件（可选）<select value={draft.attachment} onChange={event => change({ attachment: event.target.value })}><option value="">不附文件</option>{files.map(file => <option key={file.fileId} value={file.fileId}>{file.name} · {informationTime(file.createdAt)}</option>)}</select></label>
        <label>执行说明（可选）<textarea rows={3} maxLength={4000} value={draft.notes} onChange={event => change({ notes: event.target.value })} /></label>
      </fieldset><button type="submit" className="primary-action" disabled={busy || !writable || !workspace || !validSelection}>核对指令</button></form>}
      {error && <p className="resource-error" role="alert">{error}</p>}{!record && !stored.pending && error && <button disabled={loading} onClick={() => void loadChoices()}>重新读取</button>}
    </Panel>}
  </section>;
}
