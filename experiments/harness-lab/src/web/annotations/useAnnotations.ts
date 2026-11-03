import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnnotationAction, AnnotationBinding, AnnotationCurrent, AnnotationListing, AnnotationOperation, AnnotationReceipt, AnnotationRef, AnnotationVersion } from '../../contracts/annotations';
import { ApiFailure, isConnectionFailure, useApi } from '../api';
import { randomUUID } from '../random-uuid';
import { annotationPath } from './helpers';
export interface AnnotationEditStart { revision:number; baseRef:AnnotationRef|null; setId?:string }
export const annotationError = (error: unknown) => error instanceof Error ? error.message : '标注操作未完成，请重试。';
export function useAnnotations(taskId: string, sessionId?: string, refreshKey?: string) {
  const {api}=useApi(); const alive=useRef(false); const generation=useRef(0); const lock=useRef(false);
  const [snapshot,setSnapshot]=useState<{binding?:AnnotationBinding;version?:AnnotationVersion}>({});const {binding,version}=snapshot;const [ready,setReady]=useState(false);const [refreshError,setRefreshError]=useState('');const [listing,setListing]=useState<AnnotationListing>();const [current,setCurrent]=useState<AnnotationCurrent>();const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [pending,setPending]=useState<{path:string;body:object & {clientActionId:string};method:'POST'|'PUT';uncertain:boolean;code?:string}>();
  const [offset,setOffset]=useState(0);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const refresh=useCallback(async()=>{
    const token=++generation.current;setReady(false);setRefreshError('');
    const results=await Promise.allSettled([api<AnnotationListing>(`/api/tasks/${encodeURIComponent(taskId)}/annotations?offset=${offset}&limit=25`),api<AnnotationCurrent>(`/api/tasks/${encodeURIComponent(taskId)}/annotations/current`),sessionId?api<AnnotationBinding>(`/api/sessions/${encodeURIComponent(sessionId)}/annotation`):Promise.resolve(undefined)]);
    if (!alive.current || token!==generation.current)return;
    const [listed,selected,bound]=results;
    if(listed.status==='fulfilled')setListing(listed.value);else setRefreshError(annotationError(listed.reason));
    if(selected.status==='fulfilled')setCurrent(selected.value);else {setCurrent(undefined);setRefreshError(`当前标注不可读取：${annotationError(selected.reason)}`);}
    if(bound.status==='fulfilled') {
      if(bound.value && bound.value.taskId!==taskId){setRefreshError('会话不属于当前任务，未加载或修改标注。');return;}
      const ref=bound.value?.draft?{setId:bound.value.draft.setId,revision:bound.value.draft.headRevision}:bound.value?.baseRef;
      try {
        const value=ref?await api<AnnotationVersion>(annotationPath(ref)):undefined;
        if(alive.current && token===generation.current){setSnapshot({binding:bound.value,version:value});setReady(true);}
      }catch(error){if(alive.current && token===generation.current)setRefreshError(annotationError(error));}
    } else setRefreshError(annotationError(bound.reason));
  },[api,taskId,sessionId,offset]);
  useEffect(()=>{let active=true;queueMicrotask(()=>{if(active)void refresh();});return()=>{active=false;};},[refresh,refreshKey]);
  async function send<T extends {clientActionId:string}>(path:string,body:T,method:'POST'|'PUT'='POST') {
    if(lock.current)return false;lock.current=true;setBusy(true);setError('');
    try {await api<AnnotationReceipt>(path,body,method);if(alive.current){setPending(undefined);await refresh();}return true;}
    catch(error){if(alive.current){setError(annotationError(error));setPending({path,body,method,uncertain:isConnectionFailure(error),code:error instanceof ApiFailure?error.code:undefined});if(error instanceof ApiFailure&&error.code==='ANNOTATION_CONFLICT')await refresh();}return false;}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  async function apply(operations:AnnotationOperation[],start?:AnnotationEditStart,reconciled=false) {
    if(!sessionId || !binding?.writable || !ready || pending&&(!reconciled||pending.uncertain))return false;
    if(start?.setId && start.setId!==binding.draft?.setId)return false;
    const revision=start?.revision ?? binding.draft?.headRevision ?? 0;
    const body:AnnotationAction=revision?{action:'apply',clientActionId:randomUUID(),expectedRevision:revision,operations}:{action:'create_draft',clientActionId:randomUUID(),baseRef:start?start.baseRef:binding.baseRef,operations};
    return send(`/api/sessions/${encodeURIComponent(sessionId)}/annotation/actions`,body);
  }
  async function queryReceipt(){
    if(!pending || lock.current)return;setBusy(true);lock.current=true;
    try{const receipt=await api<AnnotationReceipt | null>(`/api/annotation-actions/${encodeURIComponent(pending.body.clientActionId)}`);if(alive.current){if(receipt){setPending(undefined);setError('该操作已保存。');await refresh();}else setError('尚未查询到回执；未自动重试，编辑内容仍保留。');}return receipt;}
    catch(error){if(alive.current)setError(annotationError(error));}finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  return {api,binding,version,listing,current,ready,busy,error:refreshError||error,setError,pending,offset,setOffset,refresh,apply,send,queryReceipt,
    discardPending:()=>{setPending(undefined);setError('');},
    setBase:(ref:AnnotationRef|null)=>sessionId && binding?send(`/api/sessions/${encodeURIComponent(sessionId)}/annotation/base`,{clientActionId:randomUUID(),expectedBindingRevision:binding.bindingRevision,baseRef:ref},'PUT'):Promise.resolve(false),
  };
}
