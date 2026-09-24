import { useEffect, useRef, useState } from 'react';
import type { Identity, TaskSpace } from '../contracts/access';
import { isConnectionFailure, useApi } from './api';
import { Panel } from './Resources';

export function TaskPanel({identity,task,visibility,close,saved}:{identity:Identity;task?:TaskSpace;visibility:'public'|'private';close:()=>void;saved:(task:TaskSpace)=>void}) {
  const {api}=useApi();
  const [base,setBase]=useState(task); const [title,setTitle]=useState(task?.title || ''); const [goal,setGoal]=useState(task?.goal || '');
  const [needsQuery,setNeedsQuery]=useState(false);
  const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const pending=useRef(false);
  const [latest,setLatest]=useState<TaskSpace>(); const [actionId]=useState(()=>crypto.randomUUID());
  const isPublic=(base?.visibility || visibility)==='public';
  const canManage=isPublic ? identity.createPublicTask : !base || base.ownerSeatId===identity.seatId;
  const kind=isPublic?'任务':'空间';
  async function run(action?:'archive'|'reopen') {
    if(!canManage || pending.current || needsQuery)return; pending.current=true;setBusy(true);setError('');
    try {
      const result=base ? action ? await api<TaskSpace>(`/api/tasks/${base.id}/${action}`,{revision:base.revision}) : await api<TaskSpace>(`/api/tasks/${base.id}`,{title,goal,revision:base.revision},'PUT') : await api<TaskSpace>('/api/tasks',{title,goal,visibility,clientActionId:actionId});
      saved(result);close();
    } catch(reason){if(!base)setNeedsQuery(true);setLatest(undefined);setError(reason instanceof Error?reason.message:'操作未完成，请核对最新记录。');} finally{pending.current=false;setBusy(false);}
  }
  return <Panel title={base?`${kind}说明`:isPublic?'新建工作任务':'新建个人空间'} close={close}>
    <form className="workspace-form" onSubmit={e=>{e.preventDefault();void run();}}>
      <p className="resource-help">{isPublic?'所有席位可使用工作任务；任务说明由获授权席位统一管理，文件与对话各自独立。':'仅本席位可查看和管理，用于自己的资料、指令与对话。'}{base?.state==='archived'?` 此${kind}已归档，历史仍可查看。`:''}</p>
      <label htmlFor="task-title">{kind}名称</label><input id="task-title" value={title} disabled={!canManage || busy} onChange={e=>setTitle(e.target.value)} maxLength={60} required/>
      <label htmlFor="task-goal">目标与说明</label><textarea id="task-goal" value={goal} disabled={!canManage || busy} onChange={e=>setGoal(e.target.value)} maxLength={8000} rows={6} required={isPublic}/>
      {base && <p className="resource-help">{isPublic?'创建席位':'所属席位'}：{base.ownerSeatId} · {base.state==='active'?'进行中':'已归档'}</p>}
      {error && <p className="resource-error" role="alert">{error}</p>}
      {needsQuery && !base && <button type="button" onClick={()=>{void api<TaskSpace[]>(`/api/tasks?clientActionId=${actionId}`).then(tasks=>{if(tasks[0]){saved(tasks[0]);close();}else{setNeedsQuery(false);setError(`已核对：尚未创建${kind}，可继续编辑并重试。`);}}).catch(reason=>setError(reason instanceof Error?reason.message:'查询未完成，请重试。'));}}>核对创建结果</button>}
      {error && base && <button type="button" disabled={busy} onClick={()=>{void api<TaskSpace>(`/api/tasks/${base.id}`).then(setLatest).catch(reason=>setError(String(reason.message)));}}>查看最新说明</button>}
      {latest && <aside className="task-comparison"><strong>最新说明（你的编辑仍保留）</strong><p>{latest.title}</p><p>{latest.goal}</p><button type="button" onClick={()=>{setBase(latest);setLatest(undefined);setError('已采用最新版本号，请合并需要的文字后再保存。');}}>已核对，继续合并编辑</button></aside>}
      {canManage && <div className="dialog-actions">{base && <button type="button" disabled={busy} onClick={()=>{if(base.state==='archived' || window.confirm('归档后保留历史，并停止新的处理；可以重新开启。'))void run(base.state==='active'?'archive':'reopen');}}>{base.state==='active'?`归档${kind}`:'重新开启'}</button>}<button className="primary-action" type="submit" disabled={busy || needsQuery || !title.trim()}>{busy?'保存中…':base?'保存说明':isPublic?'创建工作任务':'创建个人空间'}</button></div>}
    </form>
  </Panel>;
}

export function useTasks(enabled:boolean) {
  const {api}=useApi(); const [tasks,setTasks]=useState<TaskSpace[]>([]); const [error,setError]=useState(''); const [revision,setRevision]=useState(0); const [connectionError,setConnectionError]=useState(false);
  useEffect(()=>{
    if(!enabled)return; let current=true; let pending=false;
    const load=async()=>{if(pending)return;pending=true;try{const result=await api<TaskSpace[]>('/api/tasks');if(current){setTasks(result);setError('');setConnectionError(false);}}catch(reason){if(current){setError(reason instanceof Error?reason.message:'任务目录读取失败。');setConnectionError(isConnectionFailure(reason));}}finally{pending=false;}};
    void load();const timer=setInterval(()=>void load(),5000); return()=>{current=false;clearInterval(timer);};
  },[api,enabled,revision]);
  return {tasks,error,connectionError,refresh:()=>setRevision(x=>x+1),saved:(task:TaskSpace)=>{setTasks(old=>[task,...old.filter(item=>item.id!==task.id)]);setRevision(x=>x+1);}};
}
