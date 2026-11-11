import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import type { TaskSpace } from '../contracts/access';
import type { CommandInput, CommandRecord } from '../contracts/commands';
import type { HandoffFile, WorkDetail, WorkItem } from '../contracts/collaboration';
import type { ContextQueryResult, ContextRef, SituationCurrent, SituationObject } from '../contracts/context';
import type { Workspace } from '../contracts/index';
import { ApiFailure, isConnectionFailure, useApi } from './api';
import { HandoffFiles } from './HandoffFiles';
import { LoadingIndicator } from './LoadingIndicator';
import { Panel } from './Resources';
import { informationError, informationTime, useInformationQuery } from './information-ui';
import { randomUUID } from './random-uuid';
import { CommandExecutionDetails } from './CommandExecution';

type Adjustment = { action: 'reroute' | 'cancel'; targetCommandId: string; revision: number; vehicleIds: string[] };
type Draft = { vehicles: string[]; destination: string; route: string[]; attachment: string; notes: string; adjustment?: Adjustment };
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

export interface TaskCommandsHandle { open: (id: string) => void }
export function TaskCommands({ task, visible = true, control }: { task: TaskSpace; visible?: boolean; control?: Ref<TaskCommandsHandle> }) {
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
  const [readDenied, setReadDenied] = useState(false);
  const readGeneration = useRef(0);
  const alive = useRef(true);
  const locked = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const selectedRecordId = useRef('');
  const availability = useInformationQuery<{ canRead: boolean; canPrepare: boolean }>(`/api/commands/availability?taskId=${encodeURIComponent(task.id)}`, visible);
  const current = useInformationQuery<CommandRecord[]>(`/api/commands?taskId=${encodeURIComponent(task.id)}`, visible && availability.data?.canRead === true);
  const writable = availability.data?.canPrepare === true && task.state === 'active' && !task.readOnly;
  const blocked = Boolean(availability.denied || current.denied || readDenied);
  const discardCurrent = current.discard;
  useEffect(() => {
    if (!availability.denied && !current.denied && availability.data?.canRead !== false) return;
    readGeneration.current++;
    if (availability.denied || current.denied) setReadDenied(true);
    setRecord(undefined); setOpen(false); setObjects([]); setFiles([]); setWorkspace(undefined);
    selectedRecordId.current = ''; discardCurrent();
  }, [availability.denied, availability.data?.canRead, current.denied, discardCurrent]);
  function denyRead(reason: unknown) {
    if (!(reason instanceof ApiFailure) || ![401, 403, 404].includes(reason.status)) return;
    readGeneration.current++;
    setReadDenied(true); setRecord(undefined); setOpen(false); setObjects([]); setFiles([]); setWorkspace(undefined);
    selectedRecordId.current = ''; discardCurrent();
  }

  useEffect(() => () => { alive.current = false; }, []);
  function save(next: Stored) {
    saved.current = next; setStored(next);
    try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* Keep the current draft in memory. */ }
  }
  function change(change: Partial<Draft>) { save({ ...saved.current, draft: { ...saved.current.draft, ...change } }); }
  async function loadChoices(prepare = true) {
    const generation = readGeneration.current;
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
      if (alive.current && generation === readGeneration.current) { setWorkspace(directory); setObjects(all); setFiles([...choices.values()]); }
    } catch (reason) { if (alive.current) { denyRead(reason); setError(informationError(reason)); } }
    finally { if (alive.current) setLoading(false); }
  }
  useImperativeHandle(control, () => ({ open: id => {
    if (blocked) return;
    const generation = readGeneration.current;
    const item = current.data?.find(record => record.id === id);
    if (item) begin(item);
    else void api<CommandRecord>(`/api/commands/${encodeURIComponent(id)}`).then(record => { if (alive.current && generation === readGeneration.current) begin(record); }).catch(reason => { if (alive.current) { denyRead(reason); setError(informationError(reason)); } });
  } }));
  function begin(item?: CommandRecord) {
    if (blocked) return;
    selectedRecordId.current = item?.id || '';
    if (!item && !saved.current.pending) change({ adjustment: undefined });
    setRecord(item); setOpen(true); setError(''); setNotFound(false);
    void loadChoices(!item);
    if (item?.status === 'received') void readExecution(item);
    if (!item && saved.current.pending) void readPending();
  }
  async function readExecution(item: CommandRecord) {
    if (locked.current || blocked) return;
    const generation = readGeneration.current;
    locked.current = true; setBusy(true); setError('');
    try {
      const result = await api<CommandRecord>(`/api/commands/${encodeURIComponent(item.id)}/execution`);
      if (alive.current && generation === readGeneration.current && selectedRecordId.current === item.id) { setRecord(result); current.refresh(); }
    } catch (reason) { if (alive.current && selectedRecordId.current === item.id) { denyRead(reason); setError(informationError(reason)); } }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  function beginAdjustment(action: Adjustment['action']) {
    if (!record?.execution || saved.current.pending || locked.current) return;
    const execution = record.execution;
    const vehicleIds = execution.vehicles.filter(vehicle => vehicle.state !== 'arrived' && vehicle.state !== 'cancelled').map(vehicle => vehicle.vehicle.objectId);
    save({ draft: {
      vehicles: vehicleIds, destination: record.command.destination.objectId, route: [], attachment: record.attachment?.fileId || '', notes: '',
      adjustment: { action, targetCommandId: execution.rootCommandId, revision: execution.revision, vehicleIds },
    } });
    selectedRecordId.current = ''; setRecord(undefined); setError('');
    void loadChoices();
  }
  async function readPending() {
    const pending = saved.current.pending;
    if (!pending || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const list = pending.id ? [await api<CommandRecord>(`/api/commands/${encodeURIComponent(pending.id)}`)] : await api<CommandRecord[]>(`/api/commands?taskId=${encodeURIComponent(task.id)}&clientActionId=${encodeURIComponent(pending.input.clientActionId)}`);
      if (!alive.current) return;
      const item = list[0];
      if (item) { selectedRecordId.current = item.id; setRecord(item); save({ ...saved.current, pending: item.status === 'prepared' || item.status === 'unknown' ? { ...pending, id: item.id } : undefined }); current.refresh(); }
      else { setNotFound(true); setError('尚未查到准备结果，可以再次查询或重试本次准备。'); }
    } catch (reason) { if (alive.current) { denyRead(reason); setError(informationError(reason)); } }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  async function prepare() {
    if (!workspace || locked.current || saved.current.pending) return;
    const draft = saved.current.draft;
    const find = (id: string): CommandInput['destination'] => ({ ...objects.find(item => item.ref.objectId === id)!.ref, systemId: 'situation' });
    const adjustment = draft.adjustment;
    const command: CommandInput = { vehicles: draft.vehicles.map(find), destination: find(draft.destination), route: draft.route.map(find), ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}), ...(draft.attachment ? { attachmentFileId: draft.attachment } : {}), ...(adjustment ? { action: adjustment.action, targetCommandId: adjustment.targetCommandId, expectedExecutionRevision: adjustment.revision } : {}) };
    const pending: Pending = { input: { workspaceId: workspace.id, clientActionId: randomUUID(), command } };
    save({ ...saved.current, pending });
    await sendPreparation(pending);
  }
  async function sendPreparation(pending: Pending) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setNotFound(false);
    try {
      const item = await api<CommandRecord>('/api/commands/prepare', pending.input);
      if (alive.current) { selectedRecordId.current = item.id; setRecord(item); save({ ...saved.current, pending: { ...pending, id: item.id } }); current.refresh(); }
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
  function close() { selectedRecordId.current = ''; setOpen(false); trigger.current?.focus(); }
  function label(ref: ContextRef) { return objects.find(item => item.ref.objectId === ref.objectId)?.name || ref.objectId; }
  const vehicles = objects.filter(item => Boolean(item.resourceData?.resource.vehicle) && (!stored.draft.adjustment || stored.draft.adjustment.vehicleIds.includes(item.ref.objectId)));
  const destinations = objects.filter(item => item.resourceData?.resource.category === 'facility');
  const roads = objects.filter(item => item.ref.objectType === 'road');
  const draft = stored.draft;
  const actionTitle = draft.adjustment?.action === 'reroute' ? '调整路线' : draft.adjustment?.action === 'cancel' ? '取消行动' : '下达指令';
  const canAdjust = Boolean(writable && record?.execution?.vehicles.some(vehicle => vehicle.state !== 'arrived' && vehicle.state !== 'cancelled') && !stored.pending);
  const validSelection = draft.vehicles.length > 0 && draft.vehicles.every(id => vehicles.some(item => item.ref.objectId === id)) && destinations.some(item => item.ref.objectId === draft.destination) && draft.route.every(id => roads.some(item => item.ref.objectId === id)) && (!draft.attachment || files.some(file => file.fileId === draft.attachment));
  const toggle = (field: 'vehicles' | 'route', id: string) => change({ [field]: draft[field].includes(id) ? draft[field].filter(value => value !== id) : [...draft[field], id] });
  if (blocked) return <p className="resource-error" role="alert">{availability.error || current.error || error || '当前无法读取指令记录。'}<button onClick={() => { setReadDenied(false); availability.refresh(); current.refresh(); }}>重试读取</button></p>;
  if (!availability.data?.canRead) return availability.error ? <p className="resource-error" role="alert">{availability.error}</p> : null;
  return <section className="task-commands task-description" aria-label="指令记录">
    <header className="task-description-heading"><h2>指令</h2><div className="resource-actions"><button onClick={current.refresh} aria-label="刷新指令记录"><RefreshCw size={15} aria-hidden="true" /></button><button ref={trigger} disabled={!writable} onClick={() => begin()}><Plus size={15} aria-hidden="true" />{stored.pending ? '核对下达结果' : '下达指令'}</button></div></header>
    {current.error && <p className="resource-error" role="alert">{current.error}</p>}
    {!current.data && !current.error && <LoadingIndicator label="正在读取指令…" />}
    {current.data?.length === 0 && <p className="resource-help">暂无指令</p>}
    {current.data && current.data.length > 0 && <ul className="command-records">{current.data.map(item => <li key={item.id}><button className="command-record" onClick={() => begin(item)}><span>{item.command.vehicles.length} 辆车 · {informationTime(item.createdAt)}</span><span>{recordStatus(item)}</span></button></li>)}</ul>}
    {visible && open && <Panel dismissOnBackdrop title={record ? '指令详情' : actionTitle} close={close}>
      {record ? <div className="work-confirmation"><p role="status">{recordStatus(record)}</p><dl className="command-summary"><dt>车辆</dt><dd>{record.command.vehicles.map(label).join('、')}</dd><dt>目的地</dt><dd>{label(record.command.destination)}</dd><dt>路线</dt><dd>{record.command.route.map(label).join(' → ') || '未指定'}</dd>{record.command.notes && <><dt>执行说明</dt><dd>{record.command.notes}</dd></>}<dt>下达人</dt><dd>{record.seatName}</dd></dl>{record.attachment && <HandoffFiles files={[record.attachment]} />}{record.receipt && <dl className="command-summary"><dt>接收编号</dt><dd>{record.receipt.receiptId}</dd><dt>接收时间</dt><dd>{informationTime(record.receipt.receivedAt)}</dd></dl>}{record.error && <p className="resource-error">{record.error}</p>}
        {record.command.action && record.command.action !== 'dispatch' && <p>{record.command.action === 'reroute' ? '调整路线' : '取消行动'}</p>}
        {record.execution && <CommandExecutionDetails execution={record.execution} label={label} />}
        {record.executionError && <p role="alert" className="resource-error">{record.executionError}</p>}
        {record.status === 'received' && <div className="resource-actions">
          <button disabled={busy} onClick={() => void readExecution(record)}>查询进展</button>
          {canAdjust && <><button disabled={busy} onClick={() => beginAdjustment('reroute')}>调整路线</button><button disabled={busy} onClick={() => beginAdjustment('cancel')}>取消行动</button></>}
        </div>}
        {record.status === 'prepared' && record.source === 'page' && <div className="resource-actions"><button disabled={busy} onClick={() => void act('cancel')}>取消本次下达</button><button className="primary-action" disabled={busy || !writable} onClick={() => void act('commit')}>{record.command.action === 'cancel' ? '确认取消行动' : record.command.action === 'reroute' ? '确认调整路线' : '确认下达'}</button></div>}{record.status === 'unknown' && <button disabled={busy} onClick={() => void act('reconcile')}>查询接收回执</button>}
      </div> : stored.pending ? <div className="resource-actions"><button disabled={busy} onClick={() => void readPending()}>查询准备结果</button>{notFound && <button disabled={busy || !writable} onClick={() => void sendPreparation(stored.pending!)}>重试本次准备</button>}</div> : loading ? <LoadingIndicator label="正在读取可选对象…" /> : <form className="work-form command-form" onSubmit={event => { event.preventDefault(); if (validSelection) void prepare(); }}><fieldset disabled={busy || !writable || !workspace}>
        <legend>车辆</legend><div className="command-choices">{vehicles.map(item => <label key={item.ref.objectId}><input type="checkbox" checked={draft.vehicles.includes(item.ref.objectId)} onChange={() => toggle('vehicles', item.ref.objectId)} />{item.name}</label>)}</div>
        <label>目的地<select required disabled={Boolean(draft.adjustment)} value={draft.destination} onChange={event => change({ destination: event.target.value })}><option value="">请选择目的地</option>{destinations.map(item => <option key={item.ref.objectId} value={item.ref.objectId}>{item.name}</option>)}</select></label>
        {draft.adjustment?.action !== 'cancel' && <fieldset><legend>路线（可选）</legend><div className="command-choices">{roads.map(item => <label key={item.ref.objectId}><input type="checkbox" checked={draft.route.includes(item.ref.objectId)} onChange={() => toggle('route', item.ref.objectId)} />{item.name}</label>)}</div>{draft.route.length > 0 && <p className="resource-help">{draft.route.map(id => label({ systemId: 'situation', objectType: 'road', objectId: id })).join(' → ')}</p>}</fieldset>}
        <label>方案附件（可选）<select value={draft.attachment} onChange={event => change({ attachment: event.target.value })}><option value="">不附文件</option>{files.map(file => <option key={file.fileId} value={file.fileId}>{file.name} · {informationTime(file.createdAt)}</option>)}</select></label>
        <label>执行说明（可选）<textarea rows={3} maxLength={4000} value={draft.notes} onChange={event => change({ notes: event.target.value })} /></label>
      </fieldset><button type="submit" className="primary-action" disabled={busy || !writable || !workspace || !validSelection}>{draft.adjustment?.action === 'cancel' ? '核对取消内容' : '核对指令'}</button></form>}
      {error && <p className="resource-error" role="alert">{error}</p>}{!record && !stored.pending && error && <button disabled={loading} onClick={() => void loadChoices()}>重新读取</button>}
    </Panel>}
  </section>;
}
