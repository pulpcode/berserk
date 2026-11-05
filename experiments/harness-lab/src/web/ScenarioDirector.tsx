import { useDirectorReplay } from './useDirectorReplay';
import { useDirectorDelivery } from './useDirectorDelivery';
import { LoadingIndicator } from './LoadingIndicator';
import { useRef, useState } from 'react';
import { ArrowRight, Check, CircleAlert, Clock3, ChevronDown, History, ArrowUpRight, Map as MapIcon, RotateCcw, Settings2, RefreshCw, Send } from 'lucide-react';
import type { Identity } from '../contracts/access';
import type { ScenarioDefinitions, ScenarioInstanceDetail, ScenarioInstances, ScenarioMode, ScenarioMutationResult, ScenarioStepSummary, ScenarioTaskInitialization } from '../contracts/scenarios';
import { ApiFailure, useApi } from './api';
import { useInformationQuery } from './information-ui';
import { randomUUID } from './random-uuid';
import { Panel } from './Resources';
import { useDirectorEvents } from './DirectorPopover';
import './scenario-director.css';

const modes: Record<ScenarioMode, string> = {main_story: '主线演示（5 个事件）', source_replay: '完整事件演示（12 个事件）'};
const instanceStates = {prepared: '准备中', active: '当前演示', frozen: '已结束'};
const notificationStates = {unsent: '尚未发送', unconfirmed: '接收未确认', accepted: '接收已确认'};
const operationNames = {create: '创建本轮', activate: '激活本轮', step: '应用事件', pause: '暂停', resume: '继续'};
const realTimestamp = (value: string) => new Date(value).toLocaleString('zh-CN', {hour12: false});
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
  const [selection, setSelection] = useState(() => pending?.instanceId || new URLSearchParams(location.search).get('instance') || '');
  const [definitionId, setDefinitionId] = useState('');
  const [instancePages, setInstancePages] = useState<string[]>([]);
  const [modeOverride, setMode] = useState<ScenarioMode>();
  const [terminateUnsent, setTerminateUnsent] = useState(false);
  const [records, setRecords] = useState<'runs' | 'history' | 'overview'>();
  const [panel, setPanel] = useState<'restart' | 'settings'>();
  const [preparingId, setPreparingId] = useState<string>();
  const definitions = useInformationQuery<ScenarioDefinitions>('/api/simulation/scenarios', !denied, 60000);
  const instanceCursor = instancePages.at(-1);
  const instances = useInformationQuery<ScenarioInstances>(`/api/simulation/instances${instanceCursor ? `?cursor=${encodeURIComponent(instanceCursor)}` : ''}`, !denied, 10000);
  const instanceId = selection || instances.data?.activeInstanceId || instances.data?.items[0]?.instanceId || '';
  const base = `/api/simulation/instances/${encodeURIComponent(instanceId)}`;
  const eventList = useRef<HTMLOListElement>(null);
  const eventDetails = useDirectorEvents(instanceId, eventList);
  const detail = useInformationQuery<ScenarioInstanceDetail>(instanceId ? base : undefined, !denied, 5000);
  const taskState = useInformationQuery<ScenarioTaskInitialization>(instanceId ? `${base}/initialize` : undefined, !denied, 10000);
  const instance = detail.data?.instance;
  const mode = modeOverride || instance?.mode || 'main_story';
  const definition = definitions.data?.items.find(item => item.id === (definitionId || instance?.definitionId)) || definitions.data?.items[0];
  const choices = instances.data?.items || [];
  const fetchError = definitions.error || instances.error || detail.error;
  const replay = useDirectorReplay({
    disabled: Boolean(busy || pending || fetchError),
    completed: id => { setInstancePages([]); setPanel(undefined); setPreparingId(undefined); selectInstance(id); setNotice('演示已就绪。'); },
    changed: refresh,
    failure,
  });
  const blocked = Boolean(busy || pending || fetchError || replay.busy || replay.draft);
  const activeId = instances.data?.activeInstanceId;
  const activeDetail = useInformationQuery<ScenarioInstanceDetail>(
    panel === 'restart' && activeId ? `/api/simulation/instances/${encodeURIComponent(activeId)}` : undefined, !denied, 5000,
  );
  const unsent = activeDetail.data?.actions.filter(action => action.sendState === 'unsent').length || 0;
  const unconfirmed = activeDetail.data?.actions.some(action => action.sendState === 'unconfirmed');
  const restartBlocked = blocked || !identity.createPublicTask || !definition || !instances.data
    || Boolean(activeId && !activeDetail.data) || Boolean(activeDetail.error || unconfirmed || (unsent && !terminateUnsent));
  const steps = instance?.mode==='main_story' ? detail.data?.steps.slice(0,5) || [] : detail.data?.steps || [];
  const delivery = useDirectorDelivery({
    detail: detail.data, steps, blocked, apply: applyStep, working: setBusy, notice: setNotice, failure,
    refresh,
  });
  const stopped = Boolean(instance && instance.stepIndex >= steps.length && !delivery.waiting);

  function remember(request?: PendingRequest) {
    pendingRef.current = request; setPending(request); setReviewed(false);
    try { if (request) sessionStorage.setItem(pendingKey, JSON.stringify(request)); else sessionStorage.removeItem(pendingKey); } catch { /* Recovery remains available while this page stays open. */ }
  }
  function selectInstance(id: string) {
    setSelection(id); setMode(undefined); setDefinitionId(''); eventDetails.close(); setRecords(undefined); setNotice(''); setError('');
    history.replaceState(null, '', `/scenario-director${id ? `?instance=${encodeURIComponent(id)}` : ''}`);
  }
  function refresh() { definitions.refresh(); instances.refresh(); detail.refresh(); taskState.refresh(); }
  function failure(reason: unknown) {
    if (reason instanceof ApiFailure && [401, 403].includes(reason.status)) { setDenied(true); return; }
    setError(reason instanceof Error ? reason.message : '操作未完成，请先核对服务器状态。');
  }
  function accepted(result: ScenarioMutationResult, label: string) {
    if (result.instance.instanceId !== instanceId) selectInstance(result.instance.instanceId);
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
    if (!instance || pendingRef.current) return;
    const id = randomUUID();
    return submitRequest({
      id, label: '应用事件', path: `${base}/steps/${encodeURIComponent(step.id)}`, kind: 'scenario', instanceId,
      body: {clientActionId: id, expectedRevision: instance.revision},
    }, true);
  }
  function openRestart(existingId?: string) {
    eventDetails.close();
    setRecords(undefined);
    setTerminateUnsent(false);
    setPreparingId(existingId);
    if (existingId && instance) { setDefinitionId(instance.definitionId); setMode(instance.mode); }
    setPanel('restart');
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
      <div><h1>场景导演台</h1><p className="director-scene-meta">{instance?.name || definition?.name || '场景'}<span>{modes[instance?.mode || mode]}</span></p></div>
      <div className="director-buttons">
        <button disabled={blocked || !definition || !identity.createPublicTask} onClick={() => openRestart()}><RotateCcw size={16} aria-hidden="true"/>重新演示</button>
        <button disabled={Boolean(busy || replay.busy)} onClick={() => { eventDetails.close(); setPanel(undefined); setRecords('runs'); }}><History size={16} aria-hidden="true"/>演示记录</button>
        <a href="/situation" target="_blank" rel="noreferrer"><MapIcon size={16} aria-hidden="true"/>态势地图</a>
        <button aria-label="演示设置" title="演示设置" disabled={Boolean(busy || replay.busy)} onClick={() => {eventDetails.close(); setRecords(undefined); setPanel('settings');}}><Settings2 size={16} aria-hidden="true"/></button>
        <button aria-label="刷新" title="刷新" onClick={refresh} disabled={Boolean(busy || replay.busy)}><RefreshCw size={16} aria-hidden="true"/></button>
      </div>
    </header>
    {fetchError && <div className="director-feedback is-error" role="alert"><CircleAlert size={18} aria-hidden="true"/><div>{fetchError}<p>资料更新失败，操作已暂停。</p></div><button onClick={refresh}>重新读取</button></div>}
    {notice && <p className="director-feedback" role="status"><Check size={17} aria-hidden="true"/>{notice}</p>}
    {error && panel !== 'restart' && <p className="director-feedback is-error" role="alert"><CircleAlert size={17} aria-hidden="true"/>{error}</p>}
    {pending && !busy && <section className="director-pending" aria-label="待核对操作"><strong>{pending.label} · 结果待核对</strong><p>刷新不会重新执行，请先核对回执。</p><div className="director-buttons"><button onClick={()=>void reconcile()} disabled={Boolean(busy)}>核对操作结果</button>{reviewed && <button onClick={()=>void execute(pending)} disabled={Boolean(busy)}>重试原请求</button>}</div></section>}
    {replay.draft && !replay.busy && panel !== 'restart' && <section className="director-pending" aria-label="待完成演示准备">
      <strong>演示准备中断</strong><p>核对已完成操作后继续准备。</p><div className="director-buttons">
        <button disabled={Boolean(busy || pending || fetchError)} onClick={() => {setError(''); replay.resume();}}>核对并继续</button>
        {replay.canCancel && <button onClick={replay.cancel}>取消准备</button>}
      </div>
    </section>}
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
                  {!stopped && <button className="primary-action" disabled={blocked || delivery.syncing || !delivery.step || (instance.paused && !delivery.checkFirst)}
                    onClick={event => { if (event.detail <= 1) { setError(''); void delivery.deliver(); } }}>
                    <Send size={15} aria-hidden="true"/>{delivery.checkFirst ? '核对接收回执' : delivery.waiting ? '继续投放' : '投放事件'}
                  </button>}
                </>}
                {instance.status === 'prepared' && <button className="primary-action" disabled={blocked || !identity.createPublicTask} onClick={() => openRestart(instanceId)}>继续准备<ArrowRight size={14} aria-hidden="true"/></button>}
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
    {records && <Panel title="演示记录" className="director-records-panel" close={() => setRecords(undefined)}>
      <div className="director-record-tabs" aria-label="记录分类">
        <button aria-pressed={records === 'runs'} onClick={() => setRecords('runs')}>演示记录</button>
        <button disabled={!instance || !detail.data} aria-pressed={records === 'history'} onClick={() => setRecords('history')}>操作记录</button>
        <button disabled={!instance || !detail.data} aria-pressed={records === 'overview'} onClick={() => setRecords('overview')}>数据概况</button>
      </div>
      {records === 'runs' && <section aria-label="历次演示">
        {!instances.data && !instances.error && <LoadingIndicator label="正在读取演示记录…"/>}
        {choices.length ? <ul className="director-run-list">{choices.map(item => <li key={item.instanceId}>
          <button disabled={Boolean(busy || replay.busy)} aria-current={item.instanceId === instanceId ? 'true' : undefined} onClick={() => selectInstance(item.instanceId)}>
            <span><strong>{item.name}</strong><small>{modes[item.mode]} · <time dateTime={item.createdAt}>{realTimestamp(item.createdAt)}</time></small></span>
            <span className="director-status">{item.status === 'active' && item.paused ? '已锁定' : instanceStates[item.status]}</span>
          </button>
        </li>)}</ul> : instances.data && <p className="director-scope">暂无演示记录</p>}
        {(instancePages.length > 0 || instances.data?.hasMore) && <div className="director-buttons director-record-pagination">
          <button disabled={!instancePages.length} onClick={() => setInstancePages(pages => pages.slice(0, -1))}>较新记录</button>
          <button disabled={!instances.data?.nextCursor} onClick={() => { const cursor = instances.data?.nextCursor; if (cursor) setInstancePages(pages => [...pages, cursor]); }}>更早记录</button>
        </div>}
      </section>}
      {instance && detail.data && records !== 'runs' && <>
      {records==='history' ? <section aria-label="操作记录"><p className="director-scope director-record-zone">{detail.data.operations.length>=20?'最近20条 · ':''}实际时间 · {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>{detail.data.operations.length ? <table className="director-history"><thead><tr><th>操作</th><th>场景时间</th><th>实际时间</th><th>席位</th></tr></thead><tbody>{detail.data.operations.map(operation=><tr key={operation.id}><td>{operationNames[operation.kind]}</td><td><time dateTime={operation.businessNow}>{operation.businessNow.slice(11,16)}</time></td><td><time dateTime={operation.createdAt} title={operation.createdAt}>{realTimestamp(operation.createdAt)}</time></td><td>{operation.actor.seatId===identity.seatId?identity.seatName:operation.actor.seatId}</td></tr>)}</tbody></table>:<p className="director-scope">暂无操作</p>}</section> : <section aria-label="数据概况"><dl className="director-data-summary"><div><dt>来源对象</dt><dd>{detail.data.objects.length}</dd></div><div><dt>报告</dt><dd>{detail.data.reports.length}</dd></div></dl><details className="director-instance-info"><summary>实例信息</summary><dl><dt>编号</dt><dd>{instance.instanceId}</dd><dt>修订</dt><dd>{instance.revision}</dd><dt>创建时间 · 本机时区</dt><dd><time dateTime={instance.createdAt} title={instance.createdAt}>{realTimestamp(instance.createdAt)}</time></dd></dl></details><details className="director-instance-info"><summary>对象清单</summary><ul className="director-object-list">{detail.data.objects.map(object=><li key={`${object.ref.systemId}:${object.ref.objectType}:${object.ref.objectId}`}>{object.name}</li>)}</ul></details></section>}
      </>}
    </Panel>}
    {panel === 'settings' && <Panel title="演示设置" className="director-settings-panel" close={() => setPanel(undefined)}>
      <div className="director-settings-form">{modeFields}<p className="director-scope">设置用于下一次演示。</p>
        {definition && <><p className="director-scope">{definition.counts.vehicles} 辆车 · {definition.counts.objects} 个背景对象</p><details><summary>场景说明</summary><p>{definition.description}</p><small>{definition.geography.label} · {definition.geography.attribution}</small></details></>}
        {instance?.status === 'active' && <details><summary>轮次管理</summary><button disabled={blocked || delivery.syncing} onClick={() => mutate(instance.paused ? '解除锁定' : '锁定轮次', `${base}/control`, {action: instance.paused ? 'resume' : 'pause', expectedRevision: instance.revision})}>{instance.paused ? '解除锁定' : '锁定轮次'}</button></details>}
      </div>
    </Panel>}
    {panel === 'restart' && <Panel title="重新演示" className="director-settings-panel" close={() => {if (!replay.busy) setPanel(undefined);}}>
      <div className="director-settings-form">
        {modeFields}
        {activeId && <p className="director-replay-note">当前演示将结束，任务归档，历史记录保留。</p>}
        {unsent > 0 && <label className="director-replay-consent"><input type="checkbox" checked={terminateUnsent} disabled={Boolean(replay.busy || replay.draft)} onChange={event => setTerminateUnsent(event.target.checked)}/>放弃当前演示未发送的 {unsent} 条通知</label>}
        {unconfirmed && <p className="director-warning">当前演示有接收未确认的通知，请先核对接收回执。</p>}
        {activeDetail.error && <p className="director-warning">{activeDetail.error}</p>}
        {error && <p className="director-warning" role="alert">{error}</p>}
        <div className="director-dialog-actions">
          <button disabled={Boolean(replay.busy)} onClick={() => setPanel(undefined)}>{replay.draft ? '稍后处理' : '取消'}</button>
          {replay.draft && !replay.busy
            ? <button className="primary-action" onClick={() => {setError(''); replay.resume();}}>核对并继续</button>
            : <button className="primary-action" disabled={restartBlocked} onClick={() => {if (definition) {setError(''); void replay.start(definition, mode, terminateUnsent, preparingId);}}}>{replay.busy || '开始演示'}</button>}
        </div>
      </div>
    </Panel>}
    {(busy || replay.busy) && <p className="director-working" role="status">{replay.busy || `正在${busy}…`}</p>}
  </>;
}
