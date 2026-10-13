import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnnotationAction, AnnotationBinding, AnnotationCurrent, AnnotationListing, AnnotationOperation, AnnotationReceipt, AnnotationRef, AnnotationVersion } from '../../contracts/annotations';
import { isConnectionFailure, useApi } from '../api';
import { randomUUID } from '../random-uuid';
import { annotationPath } from './helpers';
export interface AnnotationEditStart { revision:number; baseRef:AnnotationRef|null }
export const annotationError = (error: unknown) => error instanceof Error ? error.message : '标注操作未完成，请重试。';
export function useAnnotations(taskId: string, sessionId?: string, refreshKey?: string) {
  const {api}=useApi(); const alive=useRef(false); const generation=useRef(0); const lock=useRef(false);
  const [binding,setBinding]=useState<AnnotationBinding>();const [version,setVersion]=useState<AnnotationVersion>();const [listing,setListing]=useState<AnnotationListing>();const [current,setCurrent]=useState<AnnotationCurrent>();const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [pending,setPending]=useState<{path:string;body:object & {clientActionId:string};method:'POST'|'PUT';uncertain:boolean}>();
  const [offset,setOffset]=useState(0);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const refresh=useCallback(async()=>{
    const token=++generation.current;
    const results=await Promise.allSettled([api<AnnotationListing>(`/api/tasks/${encodeURIComponent(taskId)}/annotations?offset=${offset}&limit=25`),api<AnnotationCurrent>(`/api/tasks/${encodeURIComponent(taskId)}/annotations/current`),sessionId?api<AnnotationBinding>(`/api/sessions/${encodeURIComponent(sessionId)}/annotation`):Promise.resolve(undefined)]);
    if (!alive.current || token!==generation.current)return;
    const [listed,selected,bound]=results;
    if(listed.status==='fulfilled')setListing(listed.value);else setError(annotationError(listed.reason));
    if(selected.status==='fulfilled')setCurrent(selected.value);else {setCurrent(undefined);setError(`当前标注不可读取：${annotationError(selected.reason)}`);}
    if(bound.status==='fulfilled') {
      if(bound.value && bound.value.taskId!==taskId){setBinding(undefined);setVersion(undefined);setError('会话不属于当前任务，未加载或修改标注。');return;}
      setBinding(bound.value);const ref=bound.value?.draft?{setId:bound.value.draft.setId,revision:bound.value.draft.headRevision}:bound.value?.baseRef;
      if(!ref){setVersion(undefined);return;}
      try{const value=await api<AnnotationVersion>(annotationPath(ref));if(alive.current && token===generation.current)setVersion(value);}catch(error){if(alive.current && token===generation.current){setVersion(undefined);setError(annotationError(error));}}
    } else {setVersion(undefined);setBinding(undefined);setError(annotationError(bound.reason));}
  },[api,taskId,sessionId,offset]);
  useEffect(()=>{let active=true;queueMicrotask(()=>{if(active)void refresh();});return()=>{active=false;};},[refresh,refreshKey]);
  async function send<T extends {clientActionId:string}>(path:string,body:T,method:'POST'|'PUT'='POST') {
    if(lock.current)return false;lock.current=true;setBusy(true);setError('');
    try {await api<AnnotationReceipt>(path,body,method);if(alive.current){setPending(undefined);await refresh();}return true;}
    catch(error){if(alive.current){setError(annotationError(error));setPending({path,body,method,uncertain:isConnectionFailure(error)});}return false;}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  async function apply(operations:AnnotationOperation[],start?:AnnotationEditStart) {
    if(!sessionId || !binding?.writable || pending)return false;
    const revision=start?.revision ?? binding.draft?.headRevision ?? 0;
    const body:AnnotationAction=revision?{action:'apply',clientActionId:randomUUID(),expectedRevision:revision,operations}:{action:'create_draft',clientActionId:randomUUID(),baseRef:start?start.baseRef:binding.baseRef,operations};
    return send(`/api/sessions/${encodeURIComponent(sessionId)}/annotation/actions`,body);
  }
  async function queryReceipt(){
    if(!pending || lock.current)return;setBusy(true);lock.current=true;
    try{const receipt=await api<AnnotationReceipt | null>(`/api/annotation-actions/${encodeURIComponent(pending.body.clientActionId)}`);if(alive.current){if(receipt){setPending(undefined);setError('该操作已保存。');await refresh();}else setError('尚未查询到回执；未自动重试，编辑内容仍保留。');}return receipt;}
    catch(error){if(alive.current)setError(annotationError(error));}finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  return {api,binding,version,listing,current,busy,error,setError,pending,offset,setOffset,refresh,apply,send,queryReceipt,
    discardPending:()=>{setPending(undefined);setError('');},
    setBase:(ref:AnnotationRef|null)=>sessionId && binding?send(`/api/sessions/${encodeURIComponent(sessionId)}/annotation/base`,{clientActionId:randomUUID(),expectedBindingRevision:binding.bindingRevision,baseRef:ref},'PUT'):Promise.resolve(false),
  };
}
