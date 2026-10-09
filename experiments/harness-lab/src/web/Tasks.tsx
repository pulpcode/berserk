import { useEffect, useRef, useState } from 'react';
import type { Identity, TaskSpace } from '../contracts/access';
import type { NewTaskSuggestion, TaskLinksView, TaskSuggestionCreateResult } from '../contracts/task-information';
import { isConnectionFailure, useApi } from './api';
import { Panel } from './Resources';
import { contextDraft, TaskContextEditor, TaskContextSummary, validateContext } from './TaskContextEditor';

export type TaskSuggestion = NewTaskSuggestion & { eventId: string; jobId: string };
export function TaskPanel({identity,task,visibility,suggestion,showInformation,close,saved}:{identity:Identity;task?:TaskSpace;visibility:'public'|'private';suggestion?:TaskSuggestion;showInformation?:(taskId:string)=>void;close:()=>void;saved:(task:TaskSpace)=>void}) {
  const {api}=useApi();
  const [base,setBase]=useState(task); const [title,setTitle]=useState(task?.title || suggestion?.title || ''); const [goal,setGoal]=useState(task?.goal || suggestion?.goal || '');
  const [reason,setReason]=useState(suggestion?.reason || ''); const alive=useRef(true);
  useEffect(()=>()=>{alive.current=false;},[]);
  const [context,setContext]=useState(()=>contextDraft(task?.context)); const [contextDirty,setContextDirty]=useState(false); const [contextErrors,setContextErrors]=useState<Record<string,string>>({});
  const [needsQuery,setNeedsQuery]=useState(false);
  const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const pending=useRef(false);
  const [latest,setLatest]=useState<TaskSpace>(); const [actionId]=useState(()=>crypto.randomUUID());
  const isPublic=(base?.visibility || visibility)==='public';
  const canManage=isPublic ? identity.createPublicTask : !base || base.ownerSeatId===identity.seatId;
  const kind=isPublic?'任务':'空间';
  async function run(action?:'archive'|'reopen') {
    if(!canManage || pending.current || needsQuery)return;
    const validated=validateContext(context);
    if(!action && contextDirty && Object.keys(validated.errors).length){setContextErrors(validated.errors);return;}
    const update={title,goal,...(contextDirty && (base || validated.context)?{context:validated.context}:{})};
    pending.current=true;setBusy(true);setError('');
    try {
      const result=suggestion ? (await api<TaskSuggestionCreateResult>(`/api/information/events/${encodeURIComponent(suggestion.eventId)}/tasks`,{...update,jobId:suggestion.jobId,clientActionId:actionId,reason})).task : base ? action ? await api<TaskSpace>(`/api/tasks/${base.id}/${action}`,{revision:base.revision}) : await api<TaskSpace>(`/api/tasks/${base.id}`,{...update,revision:base.revision},'PUT') : await api<TaskSpace>('/api/tasks',{...update,visibility,clientActionId:actionId});
      if(alive.current){saved(result);close();}
    } catch(reason){if(!alive.current)return;setNeedsQuery(true);setLatest(undefined);setError(reason instanceof Error?reason.message:'操作未完成，请核对最新记录。');} finally{pending.current=false;if(alive.current)setBusy(false);}
  }
  async function queryCreation() {
    try {
      let created:TaskSpace|undefined;
      if(suggestion){const value=await api<TaskLinksView>(`/api/information/events/${encodeURIComponent(suggestion.eventId)}/task-links?jobId=${encodeURIComponent(suggestion.jobId)}`);if(value.creation)created=await api<TaskSpace>(`/api/tasks/${encodeURIComponent(value.creation.taskSpaceId)}`);}
      else created=(await api<TaskSpace[]>(`/api/tasks?clientActionId=${actionId}`))[0];
      if(!alive.current)return;
      if(created){saved(created);close();}else{setNeedsQuery(false);setError(`已核对：尚未创建${kind}，可继续编辑并重试。`);}
    }catch(reason){if(alive.current)setError(reason instanceof Error?reason.message:'查询未完成，请重试。');}
  }
  return <Panel title={suggestion?'创建公共任务并关联':base?`${kind}说明`:isPublic?'新建工作任务':'新建个人空间'} close={close}>
    <form className="workspace-form" onSubmit={e=>{e.preventDefault();void run();}}>
      <p className="resource-help">{isPublic?'所有席位可使用工作任务；任务说明由获授权席位统一管理，文件与对话各自独立。':'仅本席位可查看和管理，用于自己的资料、指令与对话。'}{base?.state==='archived'?` 此${kind}已归档，历史仍可查看。`:''}</p>
      <label htmlFor="task-title">{kind}名称</label><input id="task-title" value={title} disabled={!canManage || busy} onChange={e=>setTitle(e.target.value)} maxLength={60} required/>
      <label htmlFor="task-goal">目标与说明</label><textarea id="task-goal" value={goal} disabled={!canManage || busy} onChange={e=>setGoal(e.target.value)} maxLength={8000} rows={6} required={isPublic}/>
      <>{suggestion && <><label htmlFor="task-association-reason">关联理由</label><textarea id="task-association-reason" value={reason} disabled={busy} onChange={event=>setReason(event.target.value)} maxLength={1500} rows={3} required/><p className="resource-help">请确认名称与目标适合公开。原信息、分析正文与附件保留原有访问权限，创建后不会自动开展分析。</p></>}</>
      <TaskContextEditor draft={context} change={value=>{setContext(value);setContextDirty(true);setContextErrors({});}} disabled={!canManage || busy} errors={contextErrors}/>
      {base && <p className="resource-help">{isPublic?'创建席位':'所属席位'}：{base.ownerSeatId} · {base.state==='active'?'进行中':'已归档'}</p>}
      {error && <p className="resource-error" role="alert">{error}</p>}
      {needsQuery && !base && <button type="button" disabled={busy} onClick={()=>void queryCreation()}>核对创建结果</button>}
      {error && base && <button type="button" disabled={busy} onClick={()=>{void api<TaskSpace>(`/api/tasks/${base.id}`).then(setLatest).catch(reason=>setError(String(reason.message)));}}>查看最新说明</button>}
      {latest && <aside className="task-comparison"><strong>最新说明（你的编辑仍保留）</strong><p>{latest.title}</p><p>{latest.goal}</p><TaskContextSummary context={latest.context}/><button type="button" onClick={()=>{setBase(latest);if(!contextDirty)setContext(contextDraft(latest.context));setLatest(undefined);setNeedsQuery(false);setError('已采用最新版本号，请合并需要的内容后再保存。');}}>已核对，继续合并编辑</button></aside>}
      {base && showInformation && <button type="button" onClick={()=>{close();showInformation(base.id);}}>相关信息</button>}
      {canManage && <div className="dialog-actions">{base && <button type="button" disabled={busy} onClick={()=>{if(base.state==='archived' || window.confirm('归档后保留历史，并停止新的处理；可以重新开启。'))void run(base.state==='active'?'archive':'reopen');}}>{base.state==='active'?`归档${kind}`:'重新开启'}</button>}<button className="primary-action" type="submit" disabled={busy || needsQuery || !title.trim() || Boolean(suggestion && (!goal.trim() || !reason.trim()))}>{busy?'保存中…':suggestion?'创建公共任务并关联':base?'保存说明':isPublic?'创建工作任务':'创建个人空间'}</button></div>}
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
