import { useRef, useState } from 'react';
import { ArrowRight, Check, CircleAlert, Clock3, Map as MapIcon, Pause, Play, Plus, RefreshCw, Send } from 'lucide-react';
import type { Identity } from '../contracts/access';
import type { ScenarioAction, ScenarioDefinitions, ScenarioInstanceDetail, ScenarioInstances, ScenarioMode, ScenarioMutationResult, ScenarioPreview, ScenarioTaskInitialization } from '../contracts/scenarios';
import { ApiFailure, useApi } from './api';
import { useInformationQuery } from './information-ui';
import { randomUUID } from './random-uuid';
import './scenario-director.css';

const modes: Record<ScenarioMode, string> = {main_story: '主故事 · 至方案选择', source_replay: '全部来源事件'};
const instanceStates = {prepared: '准备中', active: '活动轮次', frozen: '已冻结'};
const notificationStates = {unsent: '尚未发送', unconfirmed: '接收未确认', accepted: '接收已确认'};
const operationNames = {create: '创建本轮', activate: '激活本轮', step: '应用事件', pause: '暂停', resume: '继续'};
const timestamp = (value: string) => value.replace('T', ' ');
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
    {checking ? <p role="status">正在核对导演台访问权限…</p> : !allowed || !identity ? permissionError ? <div className="director-empty"><h1>暂时无法核对访问权限</h1><p role="alert">{permissionError}</p><button onClick={retryPermission}>重新核对</button><button onClick={returnToWork}>返回业务工作台</button></div> : <Denied back={returnToWork}/> : <DirectorWorkspace identity={identity} openTask={openTask} back={returnToWork}/>}
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
  const [mode, setMode] = useState<ScenarioMode>('main_story');
  const [terminateUnsent, setTerminateUnsent] = useState(false);
  const [preview, setPreview] = useState<ScenarioPreview>();
  const definitions = useInformationQuery<ScenarioDefinitions>('/api/simulation/scenarios', !denied, 60000);
  const instanceCursor = instancePages.at(-1);
  const instances = useInformationQuery<ScenarioInstances>(`/api/simulation/instances${instanceCursor ? `?cursor=${encodeURIComponent(instanceCursor)}` : ''}`, !denied, 10000);
  const instanceId = selection || instances.data?.activeInstanceId || instances.data?.items[0]?.instanceId || '';
  const base = `/api/simulation/instances/${encodeURIComponent(instanceId)}`;
  const detail = useInformationQuery<ScenarioInstanceDetail>(instanceId ? base : undefined, !denied, 5000);
  const taskState = useInformationQuery<ScenarioTaskInitialization>(instanceId ? `${base}/initialize` : undefined, !denied, 10000);
  const instance = detail.data?.instance;
  const definition = definitions.data?.items.find(item => item.id === definitionId) || definitions.data?.items[0];
  const recentInstances = instances.data?.items || [];
  const choices = instance && !recentInstances.some(item => item.instanceId === instance.instanceId) ? [instance, ...recentInstances] : recentInstances;
  const fetchError = definitions.error || instances.error || detail.error;
  const blocked = Boolean(busy || pending || fetchError);
  const currentPreview = preview?.instance.instanceId === instanceId && preview.instance.revision === instance?.revision ? preview : undefined;
  const waiting = detail.data?.actions.filter(action => action.sendState !== 'accepted').length || 0;
  const complete = Boolean(instance && instance.stepIndex >= instance.stepCount);

  function remember(request?: PendingRequest) {
    pendingRef.current = request; setPending(request); setReviewed(false);
    try { if (request) sessionStorage.setItem(pendingKey, JSON.stringify(request)); else sessionStorage.removeItem(pendingKey); } catch { /* Recovery remains available while this page stays open. */ }
  }
  function selectInstance(id: string) {
    setSelection(id); setPreview(undefined); setNotice(''); setError('');
    history.replaceState(null, '', `/scenario-director${id ? `?instance=${encodeURIComponent(id)}` : ''}`);
  }
  function refresh() { definitions.refresh(); instances.refresh(); detail.refresh(); taskState.refresh(); }
  function failure(reason: unknown) {
    if (reason instanceof ApiFailure && [401, 403].includes(reason.status)) { setDenied(true); return; }
    setError(reason instanceof Error ? reason.message : '操作未完成，请先核对服务器状态。');
  }
  function accepted(result: ScenarioMutationResult, label: string) {
    selectInstance(result.instance.instanceId); setNotice(`${label}已确认。${result.actions.length ? `已保存${result.actions.length}条待发通知，请分别发送。` : ''}`);
    if (result.operation.kind === 'create') setInstancePages([]);
    remember(); refresh();
  }
  async function execute(request: PendingRequest) {
    if (busy) return;
    remember(request); setBusy(request.label); setNotice(''); setError('');
    try {
      if (request.kind === 'initialize') {
        const result = await api<ScenarioTaskInitialization>(request.path, request.body);
        if (!result.initialized) throw new Error('任务准备尚未完成，请核对已有任务后重试同一请求。');
        remember(); setNotice('本轮三个任务已准备好。'); refresh();
      } else accepted(await api<ScenarioMutationResult>(request.path, request.body), request.label);
    } catch (reason) {
      failure(reason);
      if (reason instanceof ApiFailure && reason.status >= 400 && reason.status < 500 && reason.code !== 'SCENARIO_ACTIVATION_PENDING') { remember(); refresh(); }
      else setError(`${reason instanceof Error ? reason.message : '未收到操作结果。'} 请先“核对操作结果”，不要新建另一请求。`);
    } finally { setBusy(''); }
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
  async function loadPreview() {
    if (!instance || blocked) return; setBusy('预览下一事件'); setError('');
    try { setPreview(await api<ScenarioPreview>(`${base}/preview`, {expectedRevision: instance.revision})); }
    catch (reason) { failure(reason); } finally { setBusy(''); }
  }
  function activate() {
    if (!instance || !instances.data) return;
    if (instances.data.activeInstanceId && instances.data.activeInstanceId !== instanceId
      && !window.confirm('激活本轮将冻结旧轮来源，并归档旧轮演示任务；历史记录会保留。确认切换？')) return;
    mutate('激活本轮', `${base}/activate`, {expectedRevision: instance.revision, expectedActiveRevision: instances.data.activeRevision, terminateUnsent});
  }

  if (denied || definitions.denied || instances.denied) return <Denied back={back} message="当前账号已无法读取导演台资料。请核对导演授权与场景配置后重新进入。"/>;
  return <>
    <header className="director-heading"><div><p className="director-eyebrow">场景演示 · 操作控制</p><h1>场景导演台</h1><p>当前登录：{identity.seatName} · {identity.displayName}</p></div><div className="director-buttons"><a href="/situation" target="_blank" rel="noreferrer"><MapIcon size={16} aria-hidden="true"/>打开态势地图</a><button onClick={refresh} disabled={Boolean(busy)}><RefreshCw size={15} aria-hidden="true"/>刷新状态</button></div></header>
    {fetchError && <div className="director-feedback is-error" role="alert"><CircleAlert size={18} aria-hidden="true"/><div>{fetchError}<p>已加载内容可能不是最新状态，重新读取成功后再操作。</p></div><button onClick={refresh}>重新读取</button></div>}
    {notice && <p className="director-feedback" role="status"><Check size={17} aria-hidden="true"/>{notice}</p>}
    {error && <p className="director-feedback is-error" role="alert"><CircleAlert size={17} aria-hidden="true"/>{error}</p>}
    {pending && <section className="director-pending" aria-label="待核对操作"><strong>{pending.label} · 结果待核对</strong><p>保留原请求，请先查询回执；刷新页面不会重新执行。</p><div className="director-buttons"><button onClick={()=>void reconcile()} disabled={Boolean(busy)}>核对操作结果</button>{reviewed && <button onClick={()=>void execute(pending)} disabled={Boolean(busy)}>重试原请求</button>}</div></section>}
    <div className="director-layout">
      <aside className="director-sidebar" aria-label="场景与轮次">
        <section className="director-card"><h2>准备新轮</h2><p>从初始状态开始，保留旧轮记录。</p>
          <label htmlFor={domId('director-definition')}>场景<select id={domId('director-definition')} value={definition?.id || ''} disabled={blocked || !definition} onChange={event=>{setDefinitionId(event.target.value);setMode('main_story');}}>{!definition && <option value="">正在读取场景…</option>}{definitions.data?.items.map(item=><option key={item.id} value={item.id}>{item.name} · {item.version}</option>)}</select></label>
          <label htmlFor={domId('director-mode')}>投放范围<select id={domId('director-mode')} value={mode} disabled={blocked || !definition} onChange={event=>setMode(event.target.value as ScenarioMode)}>{definition?.modes.map(item=><option key={item} value={item}>{modes[item]}</option>)}</select></label>
          {definition && <><p className="director-scope">{definition.counts.vehicles}辆车 · {definition.counts.objects}个背景对象<br/>{definition.counts.steps}次事件 · {definition.counts.messages}条来源通知</p><button className={!instance ? 'primary-action' : undefined} disabled={blocked} onClick={()=>mutate('创建新轮', '/api/simulation/instances', {definitionId: definition.id, version: definition.version, mode})}><Plus size={16} aria-hidden="true"/>创建新轮</button><details><summary>场景说明</summary><p>{definition.description}</p><p>{definition.geography.label}</p><small>{definition.geography.attribution}</small></details></>}
          {definitions.data?.items.length === 0 && <p>当前没有可用场景，请核对服务配置。</p>}
        </section>
        <section className="director-card"><h2>查看轮次</h2><label htmlFor={domId('director-instance')}>场景实例<select id={domId('director-instance')} value={instanceId} disabled={Boolean(busy || pending) || !choices.length} onChange={event=>selectInstance(event.target.value)}>{!choices.length && <option value="">尚未创建轮次</option>}{choices.map(item=><option key={item.instanceId} value={item.instanceId}>{item.instanceId} · {instanceStates[item.status]}</option>)}</select></label>{(instancePages.length > 0 || instances.data?.hasMore) && <div className="director-buttons"><button disabled={blocked || !instancePages.length} onClick={()=>{setSelection(instanceId);setInstancePages(pages=>pages.slice(0,-1));}}>较新轮次</button><button disabled={blocked || !instances.data?.nextCursor} onClick={()=>{const cursor=instances.data?.nextCursor;if(cursor){setSelection(instanceId);setInstancePages(pages=>[...pages,cursor]);}}}>更早轮次</button></div>}{instance && <p className="director-scope">{modes[instance.mode]}<br/>创建于真实时间 {timestamp(instance.createdAt)}</p>}</section>
      </aside>
      <div className="director-workspace">
        {!instance ? <div className="director-card director-empty"><Clock3 size={30} aria-hidden="true"/><h2>{instanceId ? '正在读取本轮状态…' : '先准备一轮演示'}</h2><p>{instanceId ? '若读取失败，请刷新核对；页面不会执行事件。' : '选择场景后创建新轮，再准备任务、激活本轮并逐条投放事件。'}</p></div> : <>
          <section className="director-clock director-card" aria-label="本轮场景时间"><div><span className="director-status">{instanceStates[instance.status]} · {instance.paused ? '已暂停' : '手动推进'}</span><p>业务时间</p><time dateTime={instance.businessNow}>{instance.businessNow.slice(11, 16)}</time><small>{instance.businessNow.slice(0, 10)} · {instance.businessNow.endsWith('Z') ? 'UTC' : `UTC${instance.businessNow.slice(-6)}`}</small></div><div className="director-clock-progress"><strong>已应用 {instance.stepIndex} / {instance.stepCount} 次事件</strong><progress value={instance.stepIndex} max={instance.stepCount}/><p>等待你操作，业务时间不会自行前进。</p><div className="director-buttons">{instance.status === 'active' && <button disabled={blocked} onClick={()=>mutate(instance.paused ? '继续' : '暂停', `${base}/control`, {action: instance.paused ? 'resume' : 'pause', expectedRevision: instance.revision})}>{instance.paused ? <Play size={15} aria-hidden="true"/> : <Pause size={15} aria-hidden="true"/>}{instance.paused ? '继续投放' : '暂停投放'}</button>}{instance.status === 'frozen' && <span>旧轮已冻结，仅供查阅。</span>}</div></div></section>
          <section className="director-card" aria-label="本轮任务准备"><div className="director-section-heading"><div><h2>本轮任务</h2><p>先准备任务，再激活本轮；创建任务不运行模型。</p></div>{!taskState.data?.initialized && <button disabled={blocked || !identity.createPublicTask || instance.status === 'frozen'} onClick={()=>mutate('准备本轮任务', `${base}/initialize`, {}, 'initialize')}>准备本轮任务</button>}</div>
            {!identity.createPublicTask && <p className="director-warning">当前账号没有公共任务管理权限，无法初始化或归档演示任务。</p>}
            {taskState.error && <p className="director-warning">{taskState.error}<button disabled={Boolean(busy)} onClick={taskState.refresh}>核对任务准备</button></p>}
            <div className="director-task-links">{taskState.data?.tasks.map(task=><button key={task.code} onClick={()=>openTask(task.taskId)}>{task.code} · {task.title}<ArrowRight size={14} aria-hidden="true"/></button>)}</div>
            {instance.status === 'prepared' && <div className="director-activation">{instances.data?.activeInstanceId && instances.data.activeInstanceId !== instanceId && <><p>当前活动轮：{instances.data.activeInstanceId}。请先暂停旧轮并核清通知；切换将保留历史并归档旧轮演示任务。</p><label><input type="checkbox" checked={terminateUnsent} disabled={blocked} onChange={event=>setTerminateUnsent(event.target.checked)}/>允许终止旧轮尚未投放的通知，保留未投放记录</label></>}<button className="primary-action" disabled={blocked || !taskState.data?.initialized || !identity.createPublicTask || !instances.data} onClick={activate}>激活本轮</button></div>}
          </section>
          <div className="director-event-grid"><section className="director-card"><h2>事件顺序</h2><ol className="director-steps">{detail.data?.steps.map((step,index)=><li key={step.id} aria-current={index===instance.stepIndex?'step':undefined} className={index<instance.stepIndex?'is-applied':''}><span>{index<instance.stepIndex?<Check size={15} aria-label="已应用"/>:String(index+1).padStart(2,'0')}</span><div><strong>{step.title}</strong><small>{step.businessTime.slice(11,16)} · {step.messageCount}条通知</small></div></li>)}</ol></section>
            <section className="director-card director-next"><div className="director-section-heading"><h2>下一事件</h2><button disabled={blocked || instance.status !== 'active'} onClick={()=>void loadPreview()}>预览下一事件</button></div>{currentPreview ? <><p className="director-event-time">{currentPreview.step?.businessTime.slice(11,16) || '本轮停止点'}</p><h3>{currentPreview.step?.title || '当前没有可应用的下一事件'}</h3>{currentPreview.step && <p>{currentPreview.step.description}</p>}<ul>{currentPreview.changes.map((change,index)=><li key={index}>{change}</li>)}</ul><p className="director-warning">{currentPreview.reason || `将保存${currentPreview.notifications.length}条待发通知；应用事实不会自动发送。`}</p><button className="primary-action" disabled={blocked || !currentPreview.canApply || instance.paused || !currentPreview.step} onClick={()=>mutate('应用事件', `${base}/steps/${encodeURIComponent(currentPreview.step!.id)}`, {expectedRevision: instance.revision})}>应用本步事实<ArrowRight size={15} aria-hidden="true"/></button></> : <div className="director-empty"><p>{instance.status === 'prepared' ? '激活本轮后，可以预览并应用第一条事件。' : instance.status === 'frozen' ? '本轮已冻结，不能继续应用事件。' : complete ? '本轮事实步骤已全部应用，请继续核对通知。' : '先查看下一事件会改变哪些事实，再决定何时应用。'}</p></div>}</section></div>
          <section className="director-card" aria-label="通知投放与核对"><div className="director-section-heading"><div><h2>通知投放与核对</h2><p>{waiting ? `当前显示${waiting}条待发送或待确认通知。` : '事实保存、通知接收和业务处理分别核对。'}</p></div></div>{!detail.data?.actions.length ? <p className="director-scope">尚未保存事件通知。</p> : <ul className="director-notifications">{detail.data.actions.map(action=><NotificationRow key={action.id} action={action} sendAllowed={instance.status==='active'&&!instance.paused&&!blocked} refresh={refresh} onDenied={()=>setDenied(true)}/>)}</ul>}{complete && <p className="director-warning">事件步骤完成仅表示来源事实已应用，不表示支援任务已完成。</p>}</section>
          <details className="director-card director-records"><summary>本轮记录与背景资料</summary><p>实例 {instance.instanceId} · 修订 {instance.revision} · 来源对象 {detail.data?.objects.length || 0}项 · 报告 {detail.data?.reports.length || 0}份</p><ol>{detail.data?.operations.map(operation=><li key={operation.id}><strong>{operationNames[operation.kind]}</strong><span>场景 {timestamp(operation.businessNow)}</span><small>实际操作 {timestamp(operation.createdAt)} · {operation.actor.seatId}</small></li>)}</ol><details><summary>来源对象清单</summary><ul className="director-object-list">{detail.data?.objects.map(object=><li key={`${object.ref.systemId}:${object.ref.objectType}:${object.ref.objectId}`}>{object.name}</li>)}</ul></details></details>
        </>}
      </div>
    </div>
    {busy && <p className="director-working" role="status">正在{busy}…</p>}
  </>;
}

function NotificationRow({action, sendAllowed, refresh, onDenied}: {action: ScenarioAction; sendAllowed: boolean; refresh: () => void; onDenied: () => void}) {
  const {api} = useApi();
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [verifiedState, setVerifiedState] = useState<ScenarioAction['sendState']>();
  const mustQuery = uncertain || (action.sendState === 'unconfirmed' && verifiedState !== 'unconfirmed');
  const [error, setError] = useState('');
  async function run(send: boolean) {
    if (busy) return; setBusy(true); setError('');
    try {
      const result = await api<ScenarioAction>(`/api/simulation/actions/${encodeURIComponent(action.id)}${send?'/send':''}`, send?{}:undefined);
      setUncertain(false); if(!send)setVerifiedState(result.sendState); setError(result.error || (result.sendState==='accepted'?'接收已确认；处理结果请查看接收记录。':'')); refresh();
    } catch (reason) {
      if (reason instanceof ApiFailure && [401,403].includes(reason.status)) onDenied();
      setError(reason instanceof Error ? reason.message : '尚未确认发送结果，请核对原通知。'); if(send)setUncertain(true);
    } finally { setBusy(false); }
  }
  return <li><div className="director-notification-heading"><strong>{action.notification.title}</strong><span className={`director-status ${action.sendState==='accepted'?'is-confirmed':''}`}>{notificationStates[action.sendState]}</span></div><p className="director-scope">发生于场景 {timestamp(action.notification.occurredAt)} · 实际保存 {timestamp(action.createdAt)}</p><details><summary>查看冻结的通知内容</summary><p>{action.notification.text}</p></details><div className="director-buttons">{action.receipt ? <a href={`/overview?tab=events&id=${encodeURIComponent(action.receipt.eventId)}`} target="_blank" rel="noreferrer">查看接收与处理记录<ArrowRight size={14} aria-hidden="true"/></a> : <><button disabled={busy} onClick={()=>void run(false)}>核对接收回执</button><button disabled={busy || !sendAllowed || mustQuery} onClick={()=>void run(true)}><Send size={14} aria-hidden="true"/>{action.sendState==='unsent'?'发送通知':'重送同一通知'}</button></>}</div>{error && <p className="director-warning" role="status">{error}</p>}</li>;
}
