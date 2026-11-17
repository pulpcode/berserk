import { useRef, useState, type ReactNode } from 'react';
import { History, RefreshCw, RotateCcw } from 'lucide-react';
import type { Identity } from '../contracts/access';
import type { DirectorState, DirectorSwitchInput } from '../contracts/director';
import type { ScenarioInstances } from '../contracts/scenarios';
import { ApiFailure, useApi } from './api';
import { useInformationQuery } from './information-ui';
import { Panel } from './Resources';
import { LoadingIndicator } from './LoadingIndicator';
import { DirectorRecords } from './DirectorRecords';
import { FreeDebug } from './FreeDebug';
import { randomUUID } from './random-uuid';

function restore(key: string): DirectorSwitchInput | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null') as DirectorSwitchInput | null;
    if (!value || !/^[0-9a-f-]{36}$/i.test(value.clientActionId) || !['scenario', 'free_debug'].includes(value.mode)
      || !Number.isSafeInteger(value.expectedActiveRevision) || value.expectedActiveRevision < 0
      || !(value.expectedInstanceId === null || typeof value.expectedInstanceId === 'string')
      || !(value.expectedRevision === null || Number.isSafeInteger(value.expectedRevision)) || value.confirmed !== true
      || (value.restart !== undefined && typeof value.restart !== 'boolean')) return;
    return value;
  } catch { return; }
}

export function DirectorModes({identity, children}: {identity: Identity; children: ReactNode}) {
  const {api, storageKey} = useApi();
  const key = storageKey('berserk.director.switch');
  const query = useInformationQuery<DirectorState>('/api/simulation/director', true, 5000);
  const [settled, setSettled] = useState<DirectorState>();
  const state = settled && (!query.data || settled.activeRevision > query.data.activeRevision) ? settled : query.data;
  const [pending, setPending] = useState<DirectorSwitchInput | undefined>(() => restore(key));
  const [confirmation, setConfirmation] = useState<{mode: DirectorState['mode']; restart: boolean}>();
  const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [error, setError] = useState(''); const [denied, setDenied] = useState(false);
  const [notRecorded, setNotRecorded] = useState(false);
  const [records, setRecords] = useState(false); const [pages, setPages] = useState<string[]>([]);
  const cursor = pages.at(-1);
  const history = useInformationQuery<ScenarioInstances>(`/api/simulation/instances${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, records, 10000);
  const recovery = pending || state?.pending;
  function remember(value?: DirectorSwitchInput) {
    setPending(value); setNotRecorded(false);
    try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch { /* The open page retains the same request. */ }
  }
  function accept(result: DirectorState) {
    setSettled(result); query.refresh();
    if (!result.pending) { remember(); setConfirmation(undefined); setError(''); }
  }
  async function run(request: DirectorSwitchInput, read = false) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    if (!read) { remember(request); setConfirmation(undefined); }
    try { accept(await api<DirectorState>(read ? `/api/simulation/director/operations/${encodeURIComponent(request.clientActionId)}` : '/api/simulation/director/switch', read ? undefined : request)); }
    catch (reason) {
      if (reason instanceof ApiFailure && [401, 403].includes(reason.status)) setDenied(true);
      if (read && reason instanceof ApiFailure && reason.status === 404) setNotRecorded(true);
      setError(reason instanceof Error ? reason.message : '操作结果待核对。'); query.refresh();
      if (!read && reason instanceof ApiFailure && [400, 404].includes(reason.status)) remember();
    } finally { busyRef.current = false; setBusy(false); }
  }
  function confirm() {
    if (!state || !confirmation || busy || recovery) return;
    void run({clientActionId: randomUUID(), mode: confirmation.mode, expectedActiveRevision: state.activeRevision,
      expectedInstanceId: state.activeInstanceId, expectedRevision: state.activeInstance?.revision ?? null, confirmed: true,
      ...(confirmation.restart ? {restart: true} : {})});
  }
  if (denied || query.denied) return <div className="director-empty"><h1>无权访问导演台</h1><p>请重新核对当前账号的导演授权。</p></div>;
  const disabled = busy || Boolean(recovery || query.error || !state);
  return <>
    <header className="director-mode-heading"><h1>导演台</h1><label>操作方式<select aria-label="操作方式" disabled={disabled} value={state?.mode || 'scenario'} onChange={event => { const mode = event.target.value as DirectorState['mode']; if (mode !== state?.mode) setConfirmation({mode, restart: false}); }}><option value="scenario">场景演练</option><option value="free_debug">自由调试</option></select></label>
      <div className="director-buttons">{state?.mode === 'free_debug' && <button disabled={disabled} onClick={() => setConfirmation({mode: 'free_debug', restart: true})}><RotateCcw size={16} aria-hidden="true"/>重新开始</button>}<button disabled={busy} onClick={() => setRecords(true)}><History size={16} aria-hidden="true"/>历史记录</button><button aria-label="刷新导演台" disabled={busy} onClick={query.refresh}><RefreshCw size={16} aria-hidden="true"/></button></div>
    </header>
    {query.error && <p className="director-warning" role="alert">{query.error}<button onClick={query.refresh}>重新读取</button></p>}
    {error && <p className="director-warning" role="alert">{error}</p>}
    {!state && !query.error && <LoadingIndicator label="正在读取导演台状态…"/>}
    {recovery && <section className="director-pending" aria-label="待核对模式切换"><h2>模式切换结果待核对</h2><p>新操作已暂停，请核对原请求。刷新页面不会重复切换。</p><div className="director-buttons"><button disabled={busy} onClick={() => void run({...recovery, confirmed: true}, true)}>核对切换结果</button><button disabled={busy} onClick={() => void run({...recovery, confirmed: true})}>继续原切换</button>{notRecorded && !state?.pending && <button disabled={busy} onClick={() => {remember(); setConfirmation(undefined); setError('');}}>取消未执行切换</button>}</div></section>}
    {!recovery && state && !query.error && (state.mode === 'free_debug' ? state.activeInstanceId ? <FreeDebug key={state.activeInstanceId} instanceId={state.activeInstanceId} changed={query.refresh}/> : <div className="director-empty"><h2>尚无调试轮次</h2><button onClick={() => setConfirmation({mode: 'free_debug', restart: true})}>开始自由调试</button></div> : children)}
    {confirmation && <Panel title={confirmation.restart ? '重新开始自由调试' : confirmation.mode === 'free_debug' ? '切换到自由调试' : '切换到场景演练'} close={() => {if (!busy) setConfirmation(undefined);}} className="director-settings-panel">
      {state?.activeInstance ? <><p>将结束“{state.activeInstance.name}”，历史记录保留，结束后不能继续推进。</p><p>已发送的通知不会撤回；未发送的通知随本轮结束。</p></> : <p>当前没有活动轮次。</p>}
      <p>{confirmation.mode === 'free_debug' ? '使用预置测试数据开启一轮新的自由调试。不会自动发送通知。' : '结束后进入场景选择，明确启动后才开始演练。'}</p>
      {error && <p role="alert" className="director-warning">{error}</p>}
      <div className="director-dialog-actions"><button disabled={busy} onClick={() => setConfirmation(undefined)}>取消</button><button className="primary-action" disabled={disabled} onClick={confirm}>{busy ? '正在切换…' : confirmation.mode === 'free_debug' ? state?.activeInstance ? '结束当前轮次并开始调试' : '开始自由调试' : '结束调试并选择场景'}</button></div>
    </Panel>}
    {records && <Panel title="历史记录" className="director-records-panel" close={() => setRecords(false)}><DirectorRecords page={history.data} pageError={history.error} retry={history.refresh} activeId={state?.activeInstanceId} identity={identity} hasPrevious={pages.length > 0} previous={() => setPages(p => p.slice(0, -1))} next={() => {if (history.data?.nextCursor) setPages(p => [...p, history.data!.nextCursor!]);}}/></Panel>}
    {busy && <p className="director-working" role="status">正在核对并切换操作方式…</p>}
  </>;
}
