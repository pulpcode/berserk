import { useDirectorReplay } from './useDirectorReplay';
import { useDirectorDelivery } from './useDirectorDelivery';
import { LoadingIndicator } from './LoadingIndicator';
import { useRef, useState } from 'react';
import { ArrowRight, Check, CircleAlert, Clock3, ChevronDown, History, ArrowUpRight, Map as MapIcon, RotateCcw, Settings2, RefreshCw, Send } from 'lucide-react';
import type { Identity } from '../contracts/access';
import type { ScenarioDefinitions, ScenarioInstance, ScenarioInstanceDetail, ScenarioInstances, ScenarioMode, ScenarioMutationResult, ScenarioStepSummary, ScenarioTaskInitialization, ScenarioPreflight } from '../contracts/scenarios';
import { ApiFailure, useApi } from './api';
import { useInformationQuery } from './information-ui';
import { randomUUID } from './random-uuid';
import { Panel } from './Resources';
import { useDirectorEvents } from './DirectorPopover';
import { DirectorRecords, DirectorRunIdentity, directorInstanceStatus, directorModes as modes, directorTimestamp as realTimestamp } from './DirectorRecords';
import './scenario-director.css';

const notificationStates = {unsent: '尚未发送', unconfirmed: '接收未确认', accepted: '接收已确认'};
type PendingRequest = {id: string; label: string; path: string; kind: 'scenario' | 'initialize'; instanceId?: string; body: Record<string, string | number | boolean>};

/** A login-scoped pending request is a recoverable draft, never an automatic replay. */
function restoredRequest(key: string): PendingRequest | undefined {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const raw = value as Record<string, unknown>;
    if (typeof raw.id !== 'string' || !/^[0-9a-f-]{36}$/.test(raw.id) || typeof raw.label !== 'string' || raw.label.length > 120
      || typeof raw.path !== 'string' || !/^\/api\/simulation\/instances(?:\/[a-zA-Z0-9_-]+(?:\/(?:initialize|activate|control|steps\/[a-zA-Z0-9_-]+))?)?$/.test(raw.path)
      || !['scenario', 'initialize'].includes(String(raw.kind)) || (raw.instanceId !== undefined && typeof raw.instanceId !== 'string')
      || !raw.body || typeof raw.body !== 'object' || Array.isArray(raw.body)) return;
    const body = raw.body as Record<string, unknown>;
    const keys = ['clientActionId', 'definitionId', 'version', 'mode', 'businessDay', 'expectedRevision', 'expectedActiveRevision', 'terminateUnsent', 'action'];
    if (body.clientActionId !== raw.id || Object.entries(body).some(([name, item]) => !keys.includes(name) || !['string', 'number', 'boolean'].includes(typeof item))) return;
    return {id: raw.id, label: raw.label, path: raw.path, kind: raw.kind === 'initialize' ? 'initialize' : 'scenario',
      ...(typeof raw.instanceId === 'string' ? {instanceId: raw.instanceId} : {}), body: body as PendingRequest['body']};
  } catch { return; }
}

function Denied({back, message}: {back: () => void; message?: string}) {
  return <div className="director-empty"><CircleAlert size={28} aria-hidden="true"/><h1>无权访问场景导演台</h1><p>{message || '场景导演台仅对获授权的专用导演席开放。请使用业务工作台查看已生效的信息。'}</p><button onClick={back}>返回业务工作台</button></div>;
}

export default function ScenarioDirector({identity, allowed, checking, permissionError, retryPermission, returnToWork, openTask}: {
  identity?: Identity; allowed: boolean; checking: boolean; permissionError: string; retryPermission: () => void;
  returnToWork: () => void; openTask: (taskId: string) => void;
}) {
  const {domId} = useApi();
  return <section id={domId('scenario-director')} className="scenario-director" tabIndex={-1}>
    {checking ? <LoadingIndicator label="正在核对导演台访问权限…" /> : !allowed || !identity ? permissionError ? <div className="director-empty"><h1>暂时无法核对访问权限</h1><p role="alert">{permissionError}</p><button onClick={retryPermission}>重新核对</button><button onClick={returnToWork}>返回业务工作台</button></div> : <Denied back={returnToWork}/> : <DirectorWorkspace identity={identity} openTask={openTask} back={returnToWork}/>}
  </section>;
}

function DirectorWorkspace({identity, openTask, back}: {identity: Identity; openTask: (id: string) => void; back: () => void}) {
  const {api, domId, storageKey} = useApi();
  const pendingKey = storageKey('berserk.scenario-director.pending');
  const [pending, setPending] = useState<PendingRequest | undefined>(() => restoredRequest(pendingKey));
  const pendingRef = useRef(pending);
  const [busy, setBusy] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [denied, setDenied] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  // Legacy links may open a read-only record, but never select a live control target.
  const [initialRecordId, setInitialRecordId] = useState(() => new URLSearchParams(location.search).get('instance') || undefined);
  const [definitionId, setDefinitionId] = useState('');
  const [instancePages, setInstancePages] = useState<string[]>([]);
  const [modeOverride, setMode] = useState<ScenarioMode>();
  const [terminateUnsent, setTerminateUnsent] = useState(false);
  const [records, setRecords] = useState(() => Boolean(initialRecordId));
  const [panel, setPanel] = useState<'restart' | 'settings'>();
  const [preparingId, setPreparingId] = useState<string>();
  const [preparationOpen, setPreparationOpen] = useState(false);
  const [preparationPages, setPreparationPages] = useState<string[]>([]);
  const definitions = useInformationQuery<ScenarioDefinitions>('/api/simulation/scenarios', !denied, 60000);
  const instances = useInformationQuery<ScenarioInstances>('/api/simulation/instances', !denied, 10000);
  const instanceCursor = instancePages.at(-1);
  const recordsPage = useInformationQuery<ScenarioInstances>(instanceCursor ? `/api/simulation/instances?cursor=${encodeURIComponent(instanceCursor)}` : undefined, !denied && records, 10000);
  const recordInstances = instanceCursor ? recordsPage : instances;
  const preparationCursor = preparationPages.at(-1);
  const preparationPage = useInformationQuery<ScenarioInstances>(preparationCursor ? `/api/simulation/instances?cursor=${encodeURIComponent(preparationCursor)}` : undefined, !denied && preparationOpen, 10000);
  const preparationInstances = preparationCursor ? preparationPage : instances;
  const instanceId = instances.data?.activeInstanceId || '';
  const base = `/api/simulation/instances/${encodeURIComponent(instanceId)}`;
  const eventList = useRef<HTMLOListElement>(null);
  const eventDetails = useDirectorEvents(instanceId, eventList);
  const detail = useInformationQuery<ScenarioInstanceDetail>(instanceId ? base : undefined, !denied, 5000);
  const taskState = useInformationQuery<ScenarioTaskInitialization>(instanceId ? `${base}/initialize` : undefined, !denied, 10000);
  const instance = detail.data?.instance;
  const mode = modeOverride || instance?.mode || 'main_story';
  const definition = definitions.data?.items.find(item => item.id === (definitionId || instance?.definitionId)) || definitions.data?.items[0];
  const activeDefinition = definitions.data?.items.find(item => item.id === instance?.definitionId);
  const definitionChanged = Boolean(instance && definitions.data && (!activeDefinition || activeDefinition.version !== instance.definitionVersion || activeDefinition.definitionHash !== instance.definitionHash));
  const fetchError = definitions.error || instances.error || detail.error;
  const replay = useDirectorReplay({
    disabled: Boolean(busy || pending || fetchError || !definitions.data || !instances.data),
    completed: () => { setInstancePages([]); setPreparationPages([]); setPanel(undefined); setPreparingId(undefined); setMode(undefined); setDefinitionId(''); eventDetails.close(); setNotice('演示已就绪。'); },
    changed: refresh,
    failure,
  });
  const blocked = Boolean(busy || pending || fetchError || replay.busy || replay.draft || !definitions.data || !instances.data);
  const activeId = instances.data?.activeInstanceId;
  const activeDetail = detail;
  const preflight=useInformationQuery<ScenarioPreflight>(activeId?`${base}/preflight`:undefined,!denied&&panel==='restart',5000);
  const preparationDetail = useInformationQuery<ScenarioInstanceDetail>(panel === 'restart' && preparingId ? `/api/simulation/instances/${encodeURIComponent(preparingId)}` : undefined, !denied, 10000);
  const preparedInstance = preparationDetail.data?.instance;
  const preparedDefinitionChanged = Boolean(preparedInstance && (!definition || preparedInstance.definitionId !== definition.id || preparedInstance.definitionVersion !== definition.version || preparedInstance.definitionHash !== definition.definitionHash));
  // Old create requests may carry the previous viewing id; the request path owns its target.
  const pendingTargetId = pending?.path.match(/^\/api\/simulation\/instances\/([a-zA-Z0-9_-]+)/)?.[1];
  const pendingTarget = useInformationQuery<ScenarioInstanceDetail>(pendingTargetId ? `/api/simulation/instances/${encodeURIComponent(pendingTargetId)}` : undefined, !denied, 10000);
  const recoveryTargetId = replay.draft?.targetId;
  const recoveryTarget = useInformationQuery<ScenarioInstanceDetail>(recoveryTargetId ? `/api/simulation/instances/${encodeURIComponent(recoveryTargetId)}` : undefined, !denied, 10000);
  const recoveryPreviousId = replay.draft?.previousId;
  const recoveryPrevious = useInformationQuery<ScenarioInstanceDetail>(recoveryPreviousId ? `/api/simulation/instances/${encodeURIComponent(recoveryPreviousId)}` : undefined, !denied, 10000);
  const recoveryDefinition = definitions.data?.items.find(item => item.id === replay.draft?.definitionId);
  const recoveryVersionChanged = Boolean(replay.draft && recoveryDefinition && replay.draft.version !== recoveryDefinition.version);
  const recoveryCreationState = replay.draft?.request && replay.draft.stage === 'create' ? '创建结果待核对' : '待创建';
  const recoveryBlocked = Boolean(busy || pending || fetchError || !identity.createPublicTask
    || (recoveryTargetId && (!recoveryTarget.data || recoveryTarget.error)) || (recoveryPreviousId && (!recoveryPrevious.data || recoveryPrevious.error)));
  const preparedChoices = preparationInstances.data?.items.filter(item => item.status === 'prepared' && item.instanceId !== replay.draft?.targetId) || [];
  const showPreparations = Boolean(replay.draft || preparedChoices.length || preparationPages.length || instances.data?.hasMore);
  const unsent = preflight.data?.unsentNotifications || 0;
  const unconfirmed = Boolean(preflight.data?.unconfirmedNotifications);
  const restartBlocked = blocked || !identity.createPublicTask || !definition || !instances.data
    || Boolean(activeId && (!activeDetail.data || !preflight.data || preflight.error)) || Boolean(activeDetail.error || unconfirmed || (unsent && !terminateUnsent))
    || Boolean(preparingId && (!preparedInstance || preparationDetail.error || preparedInstance.status !== 'prepared' || preparedDefinitionChanged));
  const steps = instance?.mode==='main_story' ? detail.data?.steps.slice(0,5) || [] : detail.data?.steps || [];
  const delivery = useDirectorDelivery({
    detail: detail.data, steps, blocked: blocked || definitionChanged, apply: applyStep, working: setBusy, notice: setNotice, failure,
    refresh,
  });
  const stopped = Boolean(instance && instance.stepIndex >= steps.length && !delivery.waiting);

  function remember(request?: PendingRequest) {
    pendingRef.current = request; setPending(request); setReviewed(false);
    try { if (request) sessionStorage.setItem(pendingKey, JSON.stringify(request)); else sessionStorage.removeItem(pendingKey); } catch { /* Recovery remains available while this page stays open. */ }
  }
  function refresh() { definitions.refresh(); instances.refresh(); recordsPage.refresh(); preparationPage.refresh(); detail.refresh(); taskState.refresh(); preparationDetail.refresh(); pendingTarget.refresh(); recoveryTarget.refresh(); recoveryPrevious.refresh(); }
  function failure(reason: unknown) {
    if (reason instanceof ApiFailure && [401, 403].includes(reason.status)) { setDenied(true); return; }
    setError(reason instanceof Error ? reason.message : '操作未完成，请先核对服务器状态。');
  }
  function accepted(result: ScenarioMutationResult, label: string) {
    setNotice(`${label}已确认。`);
    if (result.operation.kind === 'create') setInstancePages([]);
    remember(); refresh();
  }
  async function submitRequest(request: PendingRequest, sendingStep = false): Promise<ScenarioMutationResult | undefined> {
    remember(request); setNotice(''); setError('');
    try {
      if (request.kind === 'initialize') {
        const result = await api<ScenarioTaskInitialization>(request.path, request.body);
        if (!result.initialized) throw new Error('任务准备尚未完成，请核对已有任务后重试同一请求。');
        remember(); setNotice('已创建3项演示任务。'); refresh();
      } else {
        const result = await api<ScenarioMutationResult>(request.path, request.body);
        if (sendingStep) {
          if (result.operation.id !== request.id || result.operation.kind !== 'step' || result.instance.instanceId !== request.instanceId) {
            throw new Error('事件操作回执与请求不符。');
          }
          remember();
        } else accepted(result, request.label);
        return result;
      }
    } catch (reason) {
      failure(reason);
      if (reason instanceof ApiFailure && reason.status >= 400 && reason.status < 500 && reason.code !== 'SCENARIO_ACTIVATION_PENDING') { remember(); refresh(); }
      else setError(`${reason instanceof Error ? reason.message : '未收到操作结果。'} 请先“核对操作结果”，不要新建另一请求。`);
    }
  }
  async function execute(request: PendingRequest) {
    if (busy) return;
    setBusy(request.label);
    try { await submitRequest(request); } finally { setBusy(''); }
  }
  function mutate(label: string, path: string, body: Record<string, string | number | boolean> = {}, kind: PendingRequest['kind'] = 'scenario') {
    if (blocked || pendingRef.current) return;
    const id = randomUUID();
    void execute({id, label, path, kind, ...(instanceId ? {instanceId} : {}), body: {...body, clientActionId: id}});
  }
  async function reconcile() {
    const request = pendingRef.current; if (!request || busy) return;
    setBusy('核对操作结果'); setError('');
    try {
      if (request.kind === 'initialize') {
        const result = await api<ScenarioTaskInitialization>(`${request.path}`);
        if (result.initialized) { remember(); refresh(); setNotice('已核对本轮任务准备完成。'); }
        else { setReviewed(true); setError('任务尚未准备齐全，可重试原请求补齐；已有任务会保留。'); }
      } else accepted(await api<ScenarioMutationResult>(`/api/simulation/operations/${encodeURIComponent(request.id)}`), request.label);
    } catch (reason) {
      if (reason instanceof ApiFailure && reason.status === 404) { setReviewed(true); setError('服务器尚未找到该操作回执。可重试原请求，继续使用相同操作编号。'); }
      else failure(reason);
    } finally { setBusy(''); }
  }
  async function applyStep(step: ScenarioStepSummary) {
    if (!instance || definitionChanged || pendingRef.current) return;
    const id = randomUUID();
    return submitRequest({
      id, label: '应用事件', path: `${base}/steps/${encodeURIComponent(step.id)}`, kind: 'scenario', instanceId,
      body: {clientActionId: id, expectedRevision: instance.revision},
    }, true);
  }
  function openRestart(existing?: ScenarioInstance) {
    eventDetails.close();
    setRecords(false);
    setTerminateUnsent(false);
    setPreparingId(existing?.instanceId);
    if (existing) { setDefinitionId(existing.definitionId); setMode(existing.mode); }
    setPanel('restart');
  }
  function openRecovery() {
    if (!replay.draft) return;
    setDefinitionId(replay.draft.definitionId); setMode(replay.draft.mode); setPreparingId(undefined);
    setRecords(false); setError(''); setPanel('restart');
  }

  const modeFields = <>
    {definitions.data && <label>场景<select value={definition?.id || ''} disabled={blocked || Boolean(preparingId)} onChange={event => setDefinitionId(event.target.value)}>
      {definitions.data.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>}
    <label>演示模式<select value={mode} disabled={blocked || Boolean(preparingId)} onChange={event => setMode(event.target.value as ScenarioMode)}>
      <option value="main_story">{modes.main_story}</option><option value="source_replay">{modes.source_replay}</option>
    </select></label>
  </>;

  if (denied || definitions.denied || instances.denied) return <Denied back={back} message="当前账号已无法读取导演台资料。请核对导演授权与场景配置后重新进入。"/>;
  return <>
    <header className="director-heading">
      <div><h1>场景导演台</h1><p className="director-scene-meta">{instance?.name || definition?.name || '场景'}<span>{modes[instance?.mode || mode]}</span>{instance && <><time dateTime={instance.createdAt} title={instance.createdAt}>{realTimestamp(instance.createdAt)}</time><span>{directorInstanceStatus(instance)}</span></>}</p></div>
      <div className="director-buttons">
        <button disabled={blocked || !definition || !identity.createPublicTask} onClick={() => openRestart()}><RotateCcw size={16} aria-hidden="true"/>重新演示</button>
        <button disabled={Boolean(busy || replay.busy)} onClick={() => { eventDetails.close(); setPanel(undefined); setInitialRecordId(undefined); setRecords(true); }}><History size={16} aria-hidden="true"/>演示记录</button>
        <a href="/situation" target="_blank" rel="noreferrer"><MapIcon size={16} aria-hidden="true"/>态势地图</a>
        <button aria-label="演示设置" title="演示设置" disabled={Boolean(busy || replay.busy)} onClick={() => {eventDetails.close(); setRecords(false); setPanel('settings');}}><Settings2 size={16} aria-hidden="true"/></button>
        <button aria-label="刷新" title="刷新" onClick={refresh} disabled={Boolean(busy || replay.busy)}><RefreshCw size={16} aria-hidden="true"/></button>
      </div>
    </header>
    {fetchError && <div className="director-feedback is-error" role="alert"><CircleAlert size={18} aria-hidden="true"/><div>{fetchError}<p>资料更新失败，操作已暂停。</p></div><button onClick={refresh}>重新读取</button></div>}
    {definitionChanged && <p className="director-warning" role="alert">场景定义已更新，当前演示仅可查看。请重新演示。</p>}
    {notice && <p className="director-feedback" role="status"><Check size={17} aria-hidden="true"/>{notice}</p>}
    {error && panel !== 'restart' && <p className="director-feedback is-error" role="alert"><CircleAlert size={17} aria-hidden="true"/>{error}</p>}
    {pending && !busy && <section className="director-pending" aria-label="待核对操作"><strong>{pending.label} · 结果待核对</strong>
      {pendingTarget.data ? <DirectorRunIdentity instance={pendingTarget.data.instance}/> : pendingTargetId ? pendingTarget.error ? <p role="alert">{pendingTarget.error}</p> : <LoadingIndicator label="正在读取操作目标…"/> : <p>{definitions.data?.items.find(item => item.id === pending.body.definitionId)?.name || '新演示'} · 创建结果待核对</p>}
      {pending.path.endsWith('/activate') && instance && instance.instanceId !== pendingTargetId && <div className="director-recovery-context"><span>将结束当前演示</span><DirectorRunIdentity instance={instance}/></div>}
      <div className="director-buttons"><button onClick={()=>void reconcile()} disabled={Boolean(busy)}>核对操作结果</button>{reviewed && <button onClick={()=>void execute(pending)} disabled={Boolean(busy || (pendingTargetId && !pendingTarget.data))}>重试原请求</button>}</div>
    </section>}
    {showPreparations && <details className="director-preparations" aria-label="待完成准备" onToggle={event => setPreparationOpen(event.currentTarget.open)}>
      <summary>待完成准备{replay.draft && <span className="director-status">准备中断</span>}</summary>
      {replay.draft && <div className="director-preparation-item"><div><strong>{recoveryTarget.data?.instance.name || recoveryDefinition?.name || replay.draft.definitionId}</strong><small>{modes[replay.draft.mode]}{recoveryTarget.data ? ` · ${realTimestamp(recoveryTarget.data.instance.createdAt)}` : recoveryTargetId ? ' · 准备中' : ` · ${recoveryCreationState}`}</small></div><button disabled={Boolean(busy || replay.busy)} onClick={openRecovery}>查看准备<ArrowRight size={14} aria-hidden="true"/></button></div>}
      {preparationInstances.error && <p className="director-warning" role="alert">{preparationInstances.error}<button onClick={preparationInstances.refresh}>重新读取</button></p>}
      {!preparationInstances.data && !preparationInstances.error && <LoadingIndicator label="正在读取准备记录…"/>}
      {preparedChoices.map(item => <div className="director-preparation-item" key={item.instanceId}><div><strong>{item.name}</strong><small>{modes[item.mode]} · <time dateTime={item.createdAt} title={item.createdAt}>{realTimestamp(item.createdAt)}</time></small></div><button disabled={blocked || !identity.createPublicTask} onClick={() => openRestart(item)}>继续准备<ArrowRight size={14} aria-hidden="true"/></button></div>)}
      {preparationInstances.data && !preparedChoices.length && !replay.draft && <p className="director-scope">暂无待完成准备</p>}
      {(preparationPages.length > 0 || preparationInstances.data?.hasMore) && <div className="director-buttons director-record-pagination"><button disabled={!preparationPages.length} onClick={() => setPreparationPages(pages => pages.slice(0, -1))}>较新准备</button><button disabled={!preparationInstances.data?.nextCursor} onClick={() => {const cursor = preparationInstances.data?.nextCursor; if (cursor) setPreparationPages(pages => [...pages, cursor]);}}>更早准备</button></div>}
    </details>}
    <div className="director-layout">
      <div className="director-workspace">
        {!instance ? !fetchError && <div className="director-card director-empty">
          {instanceId || !instances.data ? <LoadingIndicator label="正在读取演示轮次…" /> :
            <><Clock3 size={26} aria-hidden="true"/><h2>尚无演示记录</h2><button disabled={blocked || !definition} onClick={() => openRestart()}>开始演示</button></>}
        </div> : <>
          <section className="director-card director-delivery" aria-label="事件投放">
            <div className="director-delivery-main">
              <div>
                <span className="director-scope">{instance.status === 'prepared' ? '演示准备' : instance.status === 'frozen' ? '历史演示' : stopped ? '投放结束' : delivery.waiting ? '待完成投放' : '下一步'}</span>
                <h2>{instance.status === 'frozen' ? '已结束' : stopped ? (instance.mode === 'main_story' ? '待方案选择' : '来源回放完成') : delivery.step && <>
                  <time dateTime={delivery.step.businessTime}>{delivery.step.businessTime.slice(11,16)}</time>{delivery.step.title}
                </>}</h2>
                {instance.status !== 'frozen' && !stopped && delivery.step && <small>{delivery.waiting
                  ? `待接收 ${delivery.remaining.length} 条 · ${delivery.waiting.notification.title}`
                  : `${delivery.step.messageCount} 条通知`}</small>}
              </div>
              <div className="director-buttons">
                {instance.status === 'active' && <>
                  {!stopped && <button className="primary-action" disabled={blocked || definitionChanged || delivery.syncing || !delivery.step || (instance.paused && !delivery.checkFirst)}
                    onClick={event => { if (event.detail <= 1) { setError(''); void delivery.deliver(); } }}>
                    <Send size={15} aria-hidden="true"/>{delivery.checkFirst ? '核对接收回执' : delivery.waiting ? '继续投放' : '投放事件'}
                  </button>}
                </>}
              </div>
            </div>
            <div className="director-delivery-meta" role="group" aria-label="本轮场景时间">
              <span>场景时间 <time dateTime={instance.businessNow} title={instance.businessNow}>{instance.businessNow.slice(11,16)}</time></span>
              <span>{Math.min(instance.stepIndex,steps.length)} / {steps.length} 事件已应用</span>
              {instance.status === 'active' && instance.paused && <span>投放已锁定</span>}
            </div>
          </section>
          {taskState.error && <p className="director-warning" role="alert">{taskState.error}<button disabled={Boolean(busy)} onClick={taskState.refresh}>重新读取任务</button></p>}
          <section className="director-card director-events" aria-label="事件与通知"><div className="director-section-heading"><h2>事件顺序</h2></div><ol ref={eventList} className="director-steps">{steps.map((step,index)=>{
            const actions=detail.data?.actions.filter(action=>action.stepId===step.id) || [];
            const applied=index<instance.stepIndex,confirmed=actions.length>0&&actions.every(action=>action.sendState==='accepted');
            const isNext=step.id===delivery.step?.id && instance.status==='active';
            const selected=eventDetails.selection?.id===step.id?eventDetails.selection:undefined;
            const pinned=selected?.pinned===true;
            const status = confirmed ? '已接收' : applied ? '待接收' : isNext ? '下一事件' : '待发生';
            const tasks=(step.taskCodes || []).flatMap(code=>{
              const initialized=taskState.data?.tasks.find(task=>task.code===code),definition=detail.data?.taskDefinitions?.find(task=>task.code===code);
              return initialized||definition?[{code,title:initialized?.title || definition!.title,taskId:initialized?.taskId}]:[];
            });
            return <li key={step.id} className={`${applied?'is-applied':''} ${selected?'is-expanded':''}`} onPointerMove={event=>{const anchor=event.currentTarget.querySelector<HTMLButtonElement>('.director-step-toggle');if(anchor)eventDetails.move(step.id,anchor,event);}} aria-current={isNext?'step':undefined}>
              <button className="director-step-toggle" aria-expanded={Boolean(selected)} aria-controls={selected?domId(`director-step-${step.id}`):undefined} onClick={event=>eventDetails.toggle(step.id,event.currentTarget)}><span className="director-step-number">{confirmed?<Check size={14} aria-label="已接收"/>:String(index+1).padStart(2,'0')}</span><time dateTime={step.businessTime}>{step.businessTime.slice(11,16)}</time><strong>{step.title}</strong><span className="director-step-status">{status}</span><ChevronDown size={14} aria-hidden="true"/></button>
              {selected && <div className="director-step-body" id={domId(`director-step-${step.id}`)} role="region" aria-label={step.title} data-pinned={pinned}><p>{step.description}</p>
                {tasks.length>0 && <div className="director-event-tasks"><span>场景任务</span>{tasks.map(task=>task.taskId?<button key={task.code} onClick={()=>openTask(task.taskId!)}>{task.title}<ArrowUpRight size={13} aria-hidden="true"/></button>:<span className="director-task-name" key={task.code}>{task.title}</span>)}</div>}
                {actions.length ? <ul className="director-notifications" aria-label="事件通知">
                  {actions.map(action => <li key={action.id}>
                    <div className="director-notification-heading"><strong>{action.notification.title}</strong><span className="director-status">{notificationStates[action.sendState]}</span></div>
                    <p>{action.notification.text}</p>
                    <small>观测 <time dateTime={action.notification.occurredAt}>{action.notification.occurredAt.replace('T', ' ')}</time> · 实际保存 {realTimestamp(action.createdAt)}</small>
                    {action.receipt && <a href={`/overview?tab=events&id=${encodeURIComponent(action.receipt.eventId)}`} target="_blank" rel="noreferrer">接收记录 <ArrowUpRight size={13}/></a>}
                  </li>)}
                </ul> : <span className="director-scope">{step.messageCount} 条通知</span>}
              </div>}
            </li>;
          })}</ol></section>

        </>}
      </div>
    </div>
    {records && <Panel title="演示记录" className="director-records-panel" close={() => setRecords(false)}>
      <DirectorRecords initialId={initialRecordId} page={recordInstances.data} pageError={recordInstances.error} retry={recordInstances.refresh} activeId={activeId} identity={identity}
        hasPrevious={instancePages.length > 0} previous={() => setInstancePages(pages => pages.slice(0, -1))}
        next={() => {const cursor = recordInstances.data?.nextCursor; if (cursor) setInstancePages(pages => [...pages, cursor]);}}/>
    </Panel>}
    {panel === 'settings' && <Panel title="演示设置" className="director-settings-panel" close={() => setPanel(undefined)}>
      <div className="director-settings-form">{modeFields}<p className="director-scope">设置用于下一次演示。</p>
        {definition && <><p className="director-scope">{definition.counts.vehicles} 辆车 · {definition.counts.objects} 个背景对象</p><details><summary>场景说明</summary><p>{definition.description}</p><small>{definition.geography.label} · {definition.geography.attribution}</small></details></>}
        {instance?.status === 'active' && <details><summary>轮次管理</summary><button disabled={blocked || definitionChanged || delivery.syncing} onClick={() => mutate(instance.paused ? '解除锁定' : '锁定轮次', `${base}/control`, {action: instance.paused ? 'resume' : 'pause', expectedRevision: instance.revision})}>{instance.paused ? '解除锁定' : '锁定轮次'}</button></details>}
      </div>
    </Panel>}
    {panel === 'restart' && <Panel title={replay.draft || preparingId ? '恢复演示准备' : '重新演示'} className="director-settings-panel" close={() => {if (!replay.busy) setPanel(undefined);}}>
      <div className="director-settings-form">
        {modeFields}
        {replay.draft ? <>
          <div className="director-recovery-context"><span>准备目标</span>{recoveryTargetId ? recoveryTarget.data ? <DirectorRunIdentity instance={recoveryTarget.data.instance}/> : recoveryTarget.error ? <p className="director-warning" role="alert">{recoveryTarget.error}</p> : <LoadingIndicator label="正在读取准备目标…"/> : <p>{recoveryDefinition?.name || replay.draft.definitionId} · {modes[replay.draft.mode]} · {recoveryCreationState}</p>}</div>
          {recoveryPreviousId ? <div className="director-recovery-context"><span>将结束的原演示</span>{recoveryPrevious.data ? <DirectorRunIdentity instance={recoveryPrevious.data.instance}/> : recoveryPrevious.error ? <p className="director-warning" role="alert">{recoveryPrevious.error}</p> : <LoadingIndicator label="正在读取原演示…"/>}</div> : <p className="director-scope">准备开始时无活动演示。</p>}
          {replay.draft.terminateUnsent && <p className="director-scope">已确认放弃原演示未发送的通知。</p>}
          {recoveryVersionChanged && <p className="director-warning">准备记录使用旧场景版本，请先核对原操作结果。</p>}
        </> : <>
          {activeDetail.data && <div className="director-recovery-context"><span>结束当前演示</span><DirectorRunIdentity instance={activeDetail.data.instance}/></div>}
          <div className="director-recovery-context"><span>{preparingId ? '准备目标' : '新演示 · 待创建'}</span>{preparingId ? preparedInstance ? <DirectorRunIdentity instance={preparedInstance}/> : preparationDetail.error ? <p className="director-warning" role="alert">{preparationDetail.error}</p> : <LoadingIndicator label="正在读取准备目标…"/> : <p>{definition?.name} · {modes[mode]}</p>}</div>
          {activeId && <p className="director-replay-note">原任务及未完成工作保留为只读，历史记录保留。</p>}
          {preflight.data && (preflight.data.queuedJobs+preflight.data.runningJobs+preflight.data.foregroundRequests)>0 && <p className="director-replay-note">待处理 {preflight.data.queuedJobs} 项 · 正在处理 {preflight.data.runningJobs+preflight.data.foregroundRequests} 项。确认后停止，核清结果再开始新演示。</p>}
          {activeId&&!preflight.data&&!preflight.error&&<LoadingIndicator label="正在核对处理状态…"/>}
          {unsent > 0 && <label className="director-replay-consent"><input type="checkbox" checked={terminateUnsent} disabled={Boolean(replay.busy)} onChange={event => setTerminateUnsent(event.target.checked)}/>放弃当前演示未发送的 {unsent} 条通知</label>}
          {preparedDefinitionChanged && <p className="director-warning" role="alert">该准备记录的场景定义已更新，请重新演示。</p>}
          {preparedInstance && preparedInstance.status !== 'prepared' && <p className="director-warning" role="alert">该演示已不在准备状态，请重新读取。</p>}
        </>}
        {unconfirmed && <p className="director-warning">当前演示有接收未确认的通知，请先核对接收回执。</p>}
        {activeDetail.error && <p className="director-warning">{activeDetail.error}</p>}
        {preflight.error && <p className="director-warning" role="alert">{preflight.error}<button onClick={preflight.refresh}>重试</button></p>}
        {error && <p className="director-warning" role="alert">{error}</p>}
        <div className="director-dialog-actions">
          <button disabled={Boolean(replay.busy)} onClick={() => setPanel(undefined)}>{replay.draft ? '稍后处理' : '取消'}</button>
          {replay.draft && replay.canCancel && <button onClick={() => {replay.cancel(); setPanel(undefined);}}>取消准备</button>}
          {replay.draft && !replay.busy
            ? <button className="primary-action" disabled={recoveryBlocked} onClick={() => {setError(''); replay.resume();}}>核对并继续</button>
            : <button className="primary-action" disabled={restartBlocked} onClick={() => {if (definition) {setError(''); void replay.start(definition, mode, terminateUnsent, preparingId);}}}>{replay.busy || '开始演示'}</button>}
        </div>
      </div>
    </Panel>}
    {(busy || replay.busy) && <p className="director-working" role="status">{replay.busy || `正在${busy}…`}</p>}
  </>;
}
