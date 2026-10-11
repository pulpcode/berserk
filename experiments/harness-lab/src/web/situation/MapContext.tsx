import { createContext, lazy, Suspense, useContext, useRef, useState, type ReactNode } from 'react';
import { MapPin, Map as MapIcon, X } from 'lucide-react';
import type { SituationObject } from '../../contracts/context';
import type { PublicMessage } from '../../contracts';
import { messageReferences, verifiedReference, type MapReference } from './evidence';
const SituationView=lazy(()=>import('./SituationView'));
const MapContext=createContext<{open:(reference?:MapReference)=>void;reference:(item:SituationObject)=>void}>({open:()=>{},reference:()=>{}});
export const useSituationMap=()=>useContext(MapContext);
export function SituationProvider({children,reference,navigationKey,expand}:{children:ReactNode;reference:(item:SituationObject)=>void;navigationKey:string;expand:(href:string)=>void}) {
  const [selection,setSelection]=useState<{navigationKey:string;value?:MapReference}>(); const visible=selection?.navigationKey===navigationKey; const selected=visible?selection.value:undefined; const trigger=useRef<HTMLElement|null>(null);
  function close(){setSelection(undefined);requestAnimationFrame(()=>trigger.current?.isConnected && trigger.current.focus());}
  return <MapContext.Provider value={{open:item=>{trigger.current=document.activeElement as HTMLElement;setSelection({navigationKey,value:item});},reference}}><div className={`situation-layout${visible?' has-map-panel':''}`}>{children}{visible && <aside className="situation-side-panel" aria-label="地图详情"><header><strong>地图详情</strong><button onClick={()=>expand(selected?.href || '/situation')}>展开地图</button><button className="icon-button" aria-label="关闭地图" onClick={close}><X size={18}/></button></header><Suspense fallback={<p role="status">正在打开地图…</p>}><SituationView key={selected?.href || 'browse'} initial={selected} compact reference={reference}/></Suspense></aside>}</div></MapContext.Provider>;
}
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
