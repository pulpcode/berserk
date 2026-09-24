import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthSession, Identity } from '../contracts/access';
import type { AppInfo } from '../contracts/index';
import { api, ApiContext, createApiClient } from './api';

export interface TestSeat { id: string; name: string }
export interface SeatView { identity?: Identity; logout?: () => void; logoutError?: string; active: boolean; seatId?: string; seats: TestSeat[]; switchSeat: (id: string) => void }

/** Keep visited seats mounted: their streams, next-message drafts and late replies keep their owner. */
function TestSeats({ children }: { children: (view: SeatView) => ReactNode }) {
  const [info, setInfo] = useState<AppInfo>();
  const [selected, setSelected] = useState('');
  const [visited, setVisited] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    api<AppInfo>('/api/info').then(value => {
      if (!current) return;
      let saved = ''; try { saved = sessionStorage.getItem('axon.test-seat') || ''; } catch { /* In-memory selector remains usable. */ }
      const seat = value.testSeats?.find(item => item.id === saved)?.id || value.defaultSeatId || value.testSeats?.[0]?.id || '';
      setInfo(value); setSelected(seat); setVisited([seat]); setError('');
    }).catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : '无法读取服务信息。'); });
    return () => { current = false; };
  }, [reload]);
  const clients = useMemo(() => new Map((info?.testSeats || [{ id: '', name: '' }]).map(seat => [seat.id, createApiClient(seat.id || undefined)])), [info]);
  if (!info) return <main className="bootstrap-message" role="status">{error || '正在连接工作台…'}{error && <button onClick={() => setReload(value => value + 1)}>重新连接</button>}</main>;
  const switchSeat = (id: string) => {
    if (!clients.has(id)) return;
    setSelected(id); setVisited(previous => previous.includes(id) ? previous : [...previous, id]);
    try { sessionStorage.setItem('axon.test-seat', id); } catch { /* Keep selection in memory. */ }
  };
  return visited.map(id => <div key={id} hidden={selected !== id} inert={selected !== id || undefined} data-seat={id || 'single'}><ApiContext.Provider value={clients.get(id)!}>{children({ active: selected === id, seatId: id || undefined, seats: info.testSeats || [], switchSeat })}</ApiContext.Provider></div>);
}


function clearPrivateState() {
  try { for (const key of Object.keys(sessionStorage)) if (key.startsWith('berserk.') || key.startsWith('axon.')) sessionStorage.removeItem(key); } catch { /* unavailable storage */ }
}
export function Seats({children}:{children:(view:SeatView)=>ReactNode}) {
  const [state,setState]=useState<AuthSession>(); const [error,setError]=useState('');
  const [reload,setReload]=useState(0); const [busy,setBusy]=useState(false);
  const [username,setUsername]=useState(''); const [password,setPassword]=useState(''); const [show,setShow]=useState(false);
  const [channel]=useState(()=>typeof BroadcastChannel==='undefined' ? undefined : new BroadcastChannel('axon-login'));
  useEffect(()=>{
    let current=true;
    api<AuthSession>('/api/auth/session').then(value=>{if(current){setState(value);setError('');}}).catch(()=>{if(current)setError('连接失败，请重试。');});
    return ()=>{current=false;};
  },[reload]);
  useEffect(()=>{
    if(!channel)return;
    const changed=()=>{clearPrivateState();setState(undefined);setPassword('');setReload(x=>x+1);};
    channel.addEventListener('message',changed);
    return ()=>channel.removeEventListener('message',changed);
  },[channel]);
  const client=useMemo(()=>state?.identity ? createApiClient(state.identity.seatId,state,()=>{clearPrivateState();setState(undefined);setPassword('');setReload(x=>x+1);}) : undefined,[state]);
  useEffect(()=>()=>client?.dispose(),[client]);
  useEffect(()=>{
    if(!state?.identity)return;
    const verify=()=>{void client!.api('/api/info').catch(()=>{});};
    window.addEventListener('focus',verify); return ()=>window.removeEventListener('focus',verify);
  },[client,state?.identity]);
  async function login() {
    if(!state?.csrf || busy)return;setBusy(true);setError('');
    try {
      const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':state.csrf},body:JSON.stringify({username,password})});
      const body=await response.json(); if(!response.ok)throw new Error(body.error?.message || '登录未完成。');
      clearPrivateState();setPassword('');setState(body as AuthSession);channel?.postMessage('changed');
      history.replaceState(null,'','/');
    } catch(error){setError(error instanceof Error ? error.message : '连接失败，请重试。');} finally{setBusy(false);}
  }
  async function logout() {
    if(!window.confirm('退出登录？本页尚未发送的文字和附件引用会清除，已保存的内容不受影响。'))return;
    try {const anonymous=await client!.api<AuthSession>('/api/auth/logout',{});client!.dispose();clearPrivateState();setPassword('');setState(anonymous);channel?.postMessage('changed');}
    catch(error){setError(error instanceof Error ? error.message : '退出失败，请重试。');}
  }
  if(state?.mode==='test')return <TestSeats>{children}</TestSeats>;
  if(state?.identity && client)return <ApiContext.Provider key={state.viewId} value={client}>{children({active:true,identity:state.identity,seatId:state.identity.seatId,seats:state.seats || [],switchSeat:()=>{},logout:()=>void logout(),logoutError:error})}</ApiContext.Provider>;
  return <main className="login-page"><form className="login-card" onSubmit={e=>{e.preventDefault();void login();}}>
    <img src="/brand/axon-app-icon.svg" width="52" height="52" alt=""/><h1>登录 Axon</h1><p>进入你的席位工作台</p>
    <label htmlFor="login-user">账号</label><input id="login-user" autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} maxLength={64} required/>
    <label htmlFor="login-password">密码</label><input id="login-password" type={show?'text':'password'} autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} maxLength={256} required/>
    <label className="show-password"><input type="checkbox" checked={show} onChange={e=>setShow(e.target.checked)}/>显示密码</label>
    {error && <p role="alert" className="resource-error">{error}</p>}
    <button className="primary-action" disabled={busy || !state} type="submit">{busy?'正在登录…':'登录'}</button>
    {!state && <button type="button" onClick={()=>setReload(x=>x+1)}>重新连接</button>}
  </form></main>;
}
