import { createContext, lazy, Suspense, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Map as MapIcon, MapPin, Maximize2, Minimize2, X } from 'lucide-react';
import type { SituationObject } from '../../contracts/context';
import type { AnnotationSelection, AnnotationRef } from '../../contracts/annotations';
import type { TaskContext } from '../../contracts/access';
import { annotationKey, annotationLabel } from '../annotations/helpers';
import type { SpatialResult } from '../../contracts/spatial';
import type { AnalysisMapState } from './analysis-runtime';
import { analysisLabels, analysisValue } from './AnalysisPanel';
import type { PublicMessage } from '../../contracts';
import { annotationMapEntries, spatialMapEntries, messageReferences, verifiedReference, type MapReference } from './evidence';
const AnnotationWorkspace=lazy(()=>import('../annotations/AnnotationWorkspace'));
const SituationView=lazy(()=>import('./SituationView'));
type WorkspaceLayout = 'conversation' | 'split' | 'map';
type MapSelection = { analysis?: { result: SpatialResult; visible: boolean; selected?: string; focusItem?: string; focusRequest: number }; navigationKey: string; source?: MapReference; annotation?: AnnotationSelection; sourceFocusRequest?: number; annotationFocusRequest?: number; layout: WorkspaceLayout };
const MapContext=createContext<{
  openAnalysis:(result:SpatialResult)=>void;
  open:(reference?:MapReference)=>void; reference:(item:SituationObject)=>void;
  openAnnotations:(ref?:AnnotationSelection)=>void; annotationReference:(ref:AnnotationSelection)=>void;
  derive:(taskId:string,ref:AnnotationRef)=>Promise<void>; openSession:(id:string)=>void;
  layout:WorkspaceLayout; chooseLayout:(layout:WorkspaceLayout)=>void; panel?:ReactNode;
}>({openAnalysis:()=>{},open:()=>{},reference:()=>{},openAnnotations:()=>{},annotationReference:()=>{},derive:async()=>{},openSession:()=>{},layout:'conversation',chooseLayout:()=>{}});
export const useSituationMap=()=>useContext(MapContext);
export function SituationProvider({children,reference,navigationKey,annotations}:{children:ReactNode;reference:(item:SituationObject)=>void;navigationKey:string;annotations?:{taskId:string;taskTitle?:string;openTask?:()=>void;sessionId?:string;taskContext?:TaskContext;archived?:boolean;refreshKey?:string;reference:(ref:AnnotationSelection)=>void;derive:(taskId:string,ref:AnnotationRef)=>Promise<void>;openSession:(id:string)=>void}}) {
  const [selection,setSelection]=useState<MapSelection>();
  const trigger=useRef<HTMLElement|null>(null);
  const current=selection?.navigationKey===navigationKey?selection:undefined;
  const layout=current?.layout || 'conversation';
  function chooseLayout(next:WorkspaceLayout){if(layout==='conversation' && next!=='conversation')trigger.current=document.activeElement as HTMLElement;setSelection(previous=>next==='conversation' && previous?.navigationKey!==navigationKey?previous:{...((previous?.navigationKey===navigationKey)?previous:{}),navigationKey,layout:next});if(next==='conversation')requestAnimationFrame(()=>{const target=trigger.current?.isConnected && trigger.current.getClientRects().length?trigger.current:Array.from(document.querySelectorAll<HTMLElement>('.open-situation-map')).find(button=>button.getClientRects().length);target?.focus();});}
  function reveal(change:Partial<MapSelection>){
    trigger.current=document.activeElement as HTMLElement;
    setSelection(previous=>{
      const base=previous?.navigationKey===navigationKey?previous:undefined;
      return {...base,navigationKey,layout:'split',...change,
        sourceFocusRequest:(base?.sourceFocusRequest || 0)+('source' in change?1:0),
        annotationFocusRequest:(base?.annotationFocusRequest || 0)+('annotation' in change?1:0)};
    });
  }
  function afterReference(){
    const workspace=Array.from(document.querySelectorAll<HTMLElement>('.conversation-map-workspace:not([hidden])')).find(workspace=>workspace.getClientRects().length);
    chooseLayout(workspace && workspace.clientWidth<748?'conversation':'split');
    requestAnimationFrame(()=>workspace?.querySelector<HTMLTextAreaElement>('textarea[aria-label="发送消息"]')?.focus());
  }
  const sourceReference=(item:SituationObject)=>{reference(item);afterReference();};
  const annotationReference=(ref:AnnotationSelection)=>{annotations?.reference(ref);afterReference();};
  const workspaceControls=<div className="map-workspace-controls" role="group" aria-label="地图窗口控制">
    <button type="button" className="icon-button" aria-label={layout==='map'?'还原地图':'放大地图'} title={layout==='map'?'还原地图':'放大地图'} data-map-layout-control onClick={()=>chooseLayout(layout==='map'?'split':'map')}>{layout==='map'?<Minimize2 size={18} aria-hidden="true"/>:<Maximize2 size={18} aria-hidden="true"/>}</button>
    <button type="button" className="icon-button" aria-label="关闭态势地图" title="关闭态势地图" data-map-layout-control onClick={()=>chooseLayout('conversation')}><X size={18} aria-hidden="true"/></button>
  </div>;
  const changeAnalysis=(change:(state:NonNullable<MapSelection['analysis']>)=>MapSelection['analysis'])=>setSelection(previous=>previous?.navigationKey===navigationKey && previous.analysis?{...previous,analysis:change(previous.analysis)}:previous);
  const analysis:AnalysisMapState|undefined=current?.analysis?{...current.analysis,
    toggle:()=>changeAnalysis(state=>({...state,visible:!state.visible})),
    clear:()=>changeAnalysis(()=>undefined),
    pick:selected=>changeAnalysis(state=>({...state,selected})),
    locate:focusItem=>changeAnalysis(state=>({...state,visible:true,selected:focusItem,focusItem,focusRequest:state.focusRequest+1})),
  }:undefined;
  const openAnalysis=(result:SpatialResult)=>reveal({analysis:{result,visible:true,focusRequest:(current?.analysis?.focusRequest || 0)+1}});
  const panel=current?<Suspense fallback={<p role="status">正在打开地图…</p>}>{annotations
    ? <AnnotationWorkspace key={`${navigationKey}:${annotations.taskId}:${annotations.sessionId || ''}`} {...annotations} analysis={analysis} workspaceControls={workspaceControls} initial={current.annotation} focusRequest={current.annotationFocusRequest} sourceInitial={current.source} sourceFocusRequest={current.sourceFocusRequest} reference={annotationReference} sourceReference={sourceReference}/>
    : <SituationView key={navigationKey} analysis={analysis} workspaceControls={workspaceControls} initial={current.source} focusRequest={current.sourceFocusRequest} reference={sourceReference}/>}</Suspense>:undefined;
  return <MapContext.Provider value={{openAnalysis,open:item=>reveal({source:item}),reference:sourceReference,openAnnotations:item=>reveal({annotation:item}),annotationReference,derive:annotations?.derive || (async()=>{}),openSession:annotations?.openSession || (()=>{}),layout,chooseLayout,panel}}>{children}</MapContext.Provider>;
}

export function OpenSituationMap({disabled=false}:{disabled?:boolean}) {
  const {layout,chooseLayout}=useSituationMap();
  return <button type="button" className="icon-button workspace-tool open-situation-map" aria-label="打开态势地图" title="打开态势地图" aria-expanded={layout!=='conversation'} data-map-layout-control disabled={disabled} onClick={()=>{if(layout==='conversation')chooseLayout('split');}}><MapIcon size={20} strokeWidth={1.75} aria-hidden="true"/></button>;
}

// Layout changes hide the existing panes; only business navigation replaces their scope.
export function SituationWorkspace({children,active=true}:{children:ReactNode;active?:boolean}) {
  const {layout,panel}=useSituationMap();
  const root=useRef<HTMLDivElement>(null);
  const [width,setWidth]=useState(0);
  const [chatFraction,setChatFraction]=useState(.37);
  useEffect(()=>{
    const element=root.current;if(!element)return;
    const observer=new ResizeObserver(()=>setWidth(element.clientWidth));observer.observe(element);
    return()=>observer.disconnect();
  },[]);
  const available=Math.max(1,width-8);
  const narrow=width>0 && width<748;
  const minimum=Math.min(.5,320/available),maximum=Math.max(minimum,1-420/available);
  const fraction=Math.min(maximum,Math.max(minimum,chatFraction));
  const split=layout==='split' && !narrow;
  const chatHidden=layout==='map' || (layout==='split' && narrow);
  const mapHidden=layout==='conversation';
  const resize=(pixels:number)=>setChatFraction(Math.min(maximum,Math.max(minimum,pixels/available)));
  return <div ref={root} hidden={!active} className={`conversation-map-workspace layout-${layout}${narrow?' narrow-map-workspace':''}`} style={{'--conversation-width':`${fraction*available}px`} as CSSProperties}>
    <div className="conversation-pane" hidden={chatHidden}>{children}</div>
    <div className="map-splitter" role="separator" aria-label="调整对话与地图宽度" aria-orientation="vertical" aria-valuemin={Math.round(minimum*100)} aria-valuemax={Math.round(maximum*100)} aria-valuenow={Math.round(fraction*100)} aria-valuetext={`对话 ${Math.round(fraction*100)}%，地图 ${Math.round((1-fraction)*100)}%`} tabIndex={split?0:-1} hidden={!split} data-map-layout-control
      onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);}}
      onPointerMove={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId) && root.current)resize(event.clientX-root.current.getBoundingClientRect().left);}}
      onPointerUp={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
      onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();resize(event.key==='Home'?320:event.key==='End'?available-420:fraction*available+(event.key==='ArrowLeft'?-24:24));}}
    ><span/></div>
    {active && <aside className="situation-side-panel" aria-label="地图工作区" hidden={mapHidden}>
      {narrow && <p className="map-narrow-hint">窗口较窄，关闭地图即可返回对话。</p>}
      {panel}
    </aside>}
  </div>;
}
export function AnnotationHistoryLinks({message}:{message:PublicMessage}) {
  const map=useSituationMap();return message.selections?.annotationRefs?.length?<div className="evidence-map-links" aria-label="本条消息引用的标注版本">{message.selections.annotationRefs.map((item,index)=><button key={`${annotationKey(item.ref)}:${index}`} onClick={()=>map.openAnnotations({...item.ref,...(item.layerIds?{layerIds:item.layerIds}:{}),...(item.objectIds?{objectIds:item.objectIds}:{})})}>{item.title} · {annotationLabel(item.ref)}{item.objects.length?` · ${item.objects.map(object=>object.name).join('、')}`:''}</button>)}</div>:null;
}
export function MapLink({href,children,messages,external=false}:{href?:string;children:ReactNode;messages:PublicMessage[];external?:boolean}) {
  const map=useSituationMap();const match=verifiedReference(href,messageReferences(messages));
  if(match)return <button className="map-object-link" title={`在地图查看：${match.ref.objectId}`} onClick={()=>map.open(match)}>{children}<MapPin size={12} aria-hidden="true"/></button>;
  if(!external || href?.startsWith('/situation'))return <span>{children}</span>;
  return <a href={href}>{children}</a>;
}
export function EvidenceMapLinks({messages}:{messages:PublicMessage[]}) {
  const map=useSituationMap();
  const refs=[...new Map(messageReferences(messages).map(item=>[item.href,item])).values()];
  const annotations=annotationMapEntries(messages);
  const spatial=spatialMapEntries(messages);
  const buttons=[
    ...spatial.map(result=><button key={result.resultRef} title="打开本次固定分析结果" onClick={()=>map.openAnalysis(result)}><MapPin size={13} aria-hidden="true"/>{analysisLabels[result.operation]} · {analysisValue(result)}</button>),
    ...refs.map(item=><button key={item.href} title="打开当前来源态势；历史证据版本单独显示" onClick={()=>map.open(item)}><MapPin size={13} aria-hidden="true"/>在地图查看 · {item.ref.objectId}{item.revision?` · 证据版本 ${item.revision}`:''}</button>),
    ...annotations.map(item=><button key={`${annotationKey(item.selection)}:${item.original}`} onClick={()=>map.openAnnotations(item.selection)}><MapPin size={13} aria-hidden="true"/>{item.original?'查看原动作结果':item.publication?'查看发布标注':'查看本次标注'} · {annotationLabel(item.selection)}{item.selection.objectIds?` · ${item.selection.objectIds.length} 个对象`:''}</button>),
  ];
  if(!buttons.length)return null;
  return <div className="evidence-map-links" aria-label="地图操作结果">{buttons.slice(0,3)}{buttons.length>3?<details className="evidence-map-more"><summary>另有 {buttons.length-3} 个地图入口</summary><div className="evidence-map-links">{buttons.slice(3,100)}</div>{buttons.length>100?<p>仅显示前 100 个入口，请按对象缩小查询范围。</p>:null}</details>:null}</div>;
}
