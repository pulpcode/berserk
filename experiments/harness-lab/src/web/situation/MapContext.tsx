import { createContext, lazy, Suspense, useContext, useRef, useState, type ReactNode } from 'react';
import { MapPin, Map as MapIcon, X } from 'lucide-react';
import type { SituationObject } from '../../contracts/context';
import type { AnnotationSelection, AnnotationRef } from '../../contracts/annotations';
import type { TaskContext } from '../../contracts/access';
import { annotationKey, annotationLabel } from '../annotations/helpers';
import type { PublicMessage } from '../../contracts';
import { messageReferences, verifiedReference, type MapReference } from './evidence';
const AnnotationWorkspace=lazy(()=>import('../annotations/AnnotationWorkspace'));
const SituationView=lazy(()=>import('./SituationView'));
const MapContext=createContext<{open:(reference?:MapReference)=>void;reference:(item:SituationObject)=>void;openAnnotations:(ref?:AnnotationSelection)=>void;annotationReference:(ref:AnnotationSelection)=>void;derive:(taskId:string,ref:AnnotationRef)=>Promise<void>;openSession:(id:string)=>void}>({open:()=>{},reference:()=>{},openAnnotations:()=>{},annotationReference:()=>{},derive:async()=>{},openSession:()=>{}});
export const useSituationMap=()=>useContext(MapContext);
export function SituationProvider({children,reference,navigationKey,expand,annotations}:{children:ReactNode;reference:(item:SituationObject)=>void;navigationKey:string;expand:(href:string)=>void;annotations?:{taskId:string;sessionId?:string;taskContext?:TaskContext;archived?:boolean;refreshKey?:string;reference:(ref:AnnotationSelection)=>void;derive:(taskId:string,ref:AnnotationRef)=>Promise<void>;openSession:(id:string)=>void}}) {
  const [selection,setSelection]=useState<{navigationKey:string;value?:MapReference;annotation?:AnnotationSelection;mode:'source'|'annotation'}>(); const visible=selection?.navigationKey===navigationKey; const selected=visible?selection.value:undefined; const trigger=useRef<HTMLElement|null>(null);
  function close(){setSelection(undefined);requestAnimationFrame(()=>trigger.current?.isConnected && trigger.current.focus());}
  function openAnnotations(item?:AnnotationSelection){trigger.current=document.activeElement as HTMLElement;setSelection({navigationKey,annotation:item,mode:'annotation'});}
  return <MapContext.Provider value={{open:item=>{trigger.current=document.activeElement as HTMLElement;setSelection({navigationKey,value:item,mode:'source'});},reference,openAnnotations,annotationReference:annotations?.reference || (()=>{}),derive:annotations?.derive || (async()=>{}),openSession:annotations?.openSession || (()=>{})}}><div className={`situation-layout${visible?' has-map-panel':''}`}>{children}{visible && <aside className="situation-side-panel" aria-label="地图详情"><header><strong>{selection.mode==='annotation'?'会话地图标注':'地图详情'}</strong><button onClick={()=>expand(selection.mode==='annotation'&&annotations?`/situation?${new URLSearchParams({taskId:annotations.taskId,...(annotations.sessionId?{sessionId:annotations.sessionId}:{}),...(selection.annotation?{annotationRef:JSON.stringify(selection.annotation)}:{})})}`:selected?.href || '/situation')}>展开地图</button><button className="icon-button" aria-label="关闭地图" onClick={close}><X size={18}/></button></header><Suspense fallback={<p role="status">正在打开地图…</p>}>{selection.mode==='annotation'&&annotations?<AnnotationWorkspace key={`${annotations.taskId}:${annotations.sessionId || ''}:${selection.annotation?annotationKey(selection.annotation):''}`} {...annotations} initial={selection.annotation} compact sourceReference={reference}/>:<SituationView key={selected?.href || 'browse'} initial={selected} compact reference={reference}/>}</Suspense></aside>}</div></MapContext.Provider>;
}
export function AnnotationHistoryLinks({message}:{message:PublicMessage}) {
  const map=useSituationMap();return message.selections?.annotationRefs?.length?<div className="evidence-map-links" aria-label="本条消息引用的标注版本">{message.selections.annotationRefs.map((item,index)=><button key={`${annotationKey(item.ref)}:${index}`} onClick={()=>map.openAnnotations({...item.ref,...(item.layerIds?{layerIds:item.layerIds}:{}),...(item.objectIds?{objectIds:item.objectIds}:{})})}>{item.title} · {annotationLabel(item.ref)}{item.objects.length?` · ${item.objects.map(object=>object.name).join('、')}`:''}</button>)}</div>:null;
}
export function OpenAnnotationMap({disabled=false}:{disabled?:boolean}) { const map=useSituationMap();return <button type="button" className="icon-button" aria-label="本会话地图标注" title="打开本会话独立地图草稿" disabled={disabled} onClick={()=>map.openAnnotations()}><MapPin size={18}/></button>; }

export function MapLink({href,children,messages,external=false}:{href?:string;children:ReactNode;messages:PublicMessage[];external?:boolean}) {
  const map=useSituationMap();const match=verifiedReference(href,messageReferences(messages));
  if(match)return <button className="map-object-link" title={`在地图查看：${match.ref.objectId}`} onClick={()=>map.open(match)}>{children}<MapPin size={12} aria-hidden="true"/></button>;
  if(!external || href?.startsWith('/situation'))return <span>{children}</span>;
  return <a href={href}>{children}</a>;
}
export function EvidenceMapLinks({messages}:{messages:PublicMessage[]}) {
  const map=useSituationMap();const refs=messageReferences(messages);
  return refs.length?<div className="evidence-map-links">{refs.map((item,index)=><button key={`${item.href}:${index}`} onClick={()=>map.open(item)}><MapPin size={13} aria-hidden="true"/>在地图查看 · {item.ref.objectId}{item.revision?` · 版本 ${item.revision}`:''}</button>)}</div>:null;
}

export function OpenSituationMap({disabled=false}:{disabled?:boolean}) {
  const map=useSituationMap();
  return <button type="button" className="icon-button" aria-label="引用地图对象" title="打开态势地图，引用对象" disabled={disabled} onClick={()=>map.open()}><MapIcon size={18}/></button>;
}
