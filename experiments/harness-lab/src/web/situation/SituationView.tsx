import { AnalysisPanel } from './AnalysisPanel';
import type { AnalysisMapState } from './analysis-runtime';
import type { AnnotationMapState } from '../annotations/map-runtime';
import { createPortal } from 'react-dom';
import './canvas-workspace.css';
import { Layers, X } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ContextCatalog, ContextQueryResult, MapConfig, SituationObject, SituationQueryParams, ContextRef, InformationDetail } from '../../contracts/context';
import type { TaskContext } from '../../contracts/access';
import { checkResponse, useApi } from '../api';
import { refKey, type MapReference } from './evidence';
import { objectStatus, readSituation, taskQueries, uniqueObjects, type SourceResult } from './map-data';
import { SourceTree, sourceCategories } from './SourceTree';
const Canvas = lazy(()=>import('./MapCanvas'));
export interface SituationViewProps { analysis?: AnalysisMapState; workspaceControls?: ReactNode; focusRequest?: number; floating?: boolean; selectSource?: () => void; contentPanelTarget?: HTMLElement | null; contentPanelOpen?: boolean; openContentPanel?: () => void; closeContentPanel?: () => void; sourceVisibility?: (visible:boolean) => void; annotationSelected?: boolean; annotations?: AnnotationMapState; sourceVisible?: boolean; toolbarTarget?: HTMLElement | null; taskContext?: TaskContext; taskMode?: boolean; initial?: MapReference; compact?: boolean; reference: (item: SituationObject) => void; }
export default function SituationView({ analysis, workspaceControls, toolbarTarget, taskContext, taskMode=false, initial, compact=false, reference, annotations, annotationSelected=false, sourceVisible=true, contentPanelTarget, contentPanelOpen, openContentPanel, closeContentPanel, sourceVisibility, floating=false, selectSource, focusRequest }: SituationViewProps) {
  const sourceTrigger=useRef<HTMLButtonElement|null>(null);const detailClose=useRef<HTMLButtonElement>(null);
  const [localPanel,setLocalPanel]=useState<HTMLElement|null>(null);const [panelOpen,setPanelOpen]=useState(false);const panelButton=useRef<HTMLButtonElement>(null);const [localSourceVisible,setLocalSourceVisible]=useState(true);const [locateRequest,setLocateRequest]=useState(0);
  const visible=sourceVisibility?sourceVisible:localSourceVisible;const setSourceVisible=sourceVisibility || setLocalSourceVisible;
  const openPanel=()=>{if(openContentPanel)openContentPanel();else setPanelOpen(true);};const [dismissedInitial,setDismissedInitial]=useState('');
  const client=useApi(); const [catalog,setCatalog]=useState<ContextCatalog>(); const [config,setConfig]=useState<MapConfig>(); const [setupError,setSetupError]=useState('');
  const [source,setSource]=useState(initial?.ref.systemId || ''); const [area,setArea]=useState(''); const [all,setAll]=useState(!taskMode); const [revision,setRevision]=useState(0);
  const [selected,setSelected]=useState(initial ? refKey(initial.ref) : ''); const [sourceState,setSourceState]=useState<{key:string;values:Record<string,SourceResult>}>(); const [errorState,setErrorState]=useState<{key:string;values:Record<string,string>}>(); const [busy,setBusy]=useState(false);
  useEffect(()=>{if(!annotationSelected)return;let active=true;queueMicrotask(()=>{if(active){setSelected('');sourceTrigger.current=null;}});return()=>{active=false;};},[annotationSelected]);
  const [layers,setLayers]=useState(['road','resource','area']); const generation=useRef(0);
  const contextKey=JSON.stringify(taskContext || null);const stableContext=useMemo(()=>JSON.parse(contextKey) as TaskContext | undefined,[contextKey]);
  const initialKey=JSON.stringify(initial || null);const referenceKey=JSON.stringify([initialKey,focusRequest || 0]);const stableInitial=useMemo(()=>referenceKey===dismissedInitial?undefined:JSON.parse(initialKey) as MapReference | undefined,[initialKey,referenceKey,dismissedInitial]);
  useEffect(()=>{if(!stableInitial)return;let active=true;queueMicrotask(()=>{if(active){sourceTrigger.current=null;setLocateRequest(value=>value+1);setDismissedInitial('');setSelected(refKey(stableInitial.ref));setSource(stableInitial.ref.systemId);setSourceVisible(true);setLayers(old=>old.includes(stableInitial.ref.objectType)?old:[...old,stableInitial.ref.objectType]);}});return()=>{active=false;};},[stableInitial,setSourceVisible]);
  const scopeKey=JSON.stringify({source,area,all,contextKey,initial:stableInitial});
  const sources=useMemo(()=>sourceState?.key===scopeKey?sourceState.values:{},[sourceState,scopeKey]);const errors=errorState?.key===scopeKey?errorState.values:{};
  const setSources=useCallback((fn:(old:Record<string,SourceResult>)=>Record<string,SourceResult>)=>setSourceState(old=>({key:scopeKey,values:fn(old?.key===scopeKey?old.values:{})})),[scopeKey]);
  const setErrors=useCallback((fn:(old:Record<string,string>)=>Record<string,string>)=>setErrorState(old=>({key:scopeKey,values:fn(old?.key===scopeKey?old.values:{})})),[scopeKey]);
  useEffect(()=>{
    const controller=new AbortController();
    async function load(){ try { const [cat,conf]=await Promise.all(['/api/context/catalog','/api/context/map-config'].map(async path=>(await checkResponse(await client.request(client.url(path),{signal:controller.signal,cache:'no-store'}))).json())); if(!controller.signal.aborted){setCatalog(cat);setConfig(old=>JSON.stringify(old)===JSON.stringify(conf)?old:conf);setSetupError('');} } catch(error){if(!controller.signal.aborted)setSetupError(error instanceof Error?error.message:'地图配置读取失败');} }
    void load(); return()=>controller.abort();
  },[client,revision]);
  const systems=catalog?.systems.filter(system=>system.capabilities.includes('situation_current')) || [];
  const hasRange=Boolean(taskContext?.businessRefs?.length || taskContext?.focus?.areaIds?.length);
  useEffect(()=>{
    if(!catalog || (taskMode && !all && !hasRange && !area && !stableInitial)) return;
    const token=++generation.current; const controller=new AbortController(); let pending=false;
    const transport=async (params:SituationQueryParams)=> (await checkResponse(await client.request(client.url('/api/context/situation'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params),signal:controller.signal}))).json() as Promise<ContextQueryResult>;
    const refresh=async()=>{
      if(pending || document.visibilityState==='hidden')return; pending=true;setBusy(true);
      try {
        let queries:SituationQueryParams[] = stableInitial ? [{systemId:stableInitial.ref.systemId,mode:'current',objectRefs:[stableInitial.ref]}] : all || area ? catalog.systems.filter(s=>s.capabilities.includes('situation_current') && (!source || s.id===source)).map(s=>({systemId:s.id,mode:'current',...(area?{areaIds:[area]}:{})})) : taskQueries(catalog,stableContext);
        if(!all && !stableInitial && stableContext?.businessRefs) {
          for(const report of stableContext.businessRefs.filter(ref=>ref.objectType==='report')) {
            try {
              const response=await checkResponse(await client.request(client.url(`/api/context/reports/${encodeURIComponent(report.systemId)}/${encodeURIComponent(report.objectId)}`),{signal:controller.signal,cache:'no-store'}));
              const envelope=await response.json() as ContextQueryResult; if(!controller.signal.aborted && token===generation.current)setErrors(old=>({...old,[report.systemId]:''})); const refs=(envelope.data as InformationDetail).item.objectRefs;
              for(const systemId of new Set(refs.map(ref=>ref.systemId)))queries.push({systemId,mode:'current',objectRefs:refs.filter(ref=>ref.systemId===systemId)});
            }catch(error){if(!controller.signal.aborted && token===generation.current)setErrors(old=>({...old,[report.systemId]:error instanceof Error?error.message:'报告引用读取失败'}));}
          }
        }
        if(source && !stableInitial)queries=queries.filter(query=>query.systemId===source);
        for(const id of new Set(queries.map(query=>query.systemId))){
          try{
            const parts=await Promise.all(queries.filter(query=>query.systemId===id).map(query=>readSituation(transport,query)));
            if(controller.signal.aborted || token!==generation.current)return;
            const merged={...parts[0]!,items:uniqueObjects(parts.flatMap(part=>part.items)),unknownRefs:parts.flatMap(part=>part.unknownRefs)};
            setSources(old=>({...old,[id]:merged}));setErrors(old=>({...old,[id]:''}));
          }catch(error){if(!controller.signal.aborted && token===generation.current){if(error && typeof error==='object' && 'status' in error && [401,403,404].includes(Number(error.status)))setSources(old=>Object.fromEntries(Object.entries(old).filter(([key])=>key!==id)));setErrors(old=>({...old,[id]:error instanceof Error?error.message:'态势更新失败'}));}}
        }
      }finally{pending=false;if(!controller.signal.aborted && token===generation.current)setBusy(false);}
    };
    void refresh();const timer=window.setInterval(()=>void refresh(),15000);document.addEventListener('visibilitychange',refresh);
    return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
  },[client,catalog,revision,taskMode,hasRange,all,area,stableInitial,source,stableContext,setSources,setErrors]);
  // Query results own the tree, selection and counts; local visibility only affects map geometry.
  const objects=useMemo(()=>uniqueObjects(Object.values(sources).flatMap(value=>value.items)),[sources]);
  const mapObjects=useMemo(()=>visible?objects.filter(item=>layers.includes(item.ref.objectType)):[],[objects,layers,visible]);
  const chosen=objects.find(item=>refKey(item.ref)===selected);
  const referencesMissing=Object.values(sources).flatMap(result=>result.unknownRefs);
  const sourceName=systems.find(item=>item.id===source)?.name || '全部获准来源';
  const areaName=systems.find(item=>item.id===source)?.areas.find(item=>item.id===area)?.name;
  const scopeSummary=stableInitial?'指定对象 · 当前态势':`${sourceName} · ${areaName || (taskMode&&!all?'任务关注范围':'全部区域')}`;
  const sourceError=setupError || Object.entries(errors).filter(([,error])=>error).map(([id,error])=>`${id}：更新失败，已加载的内容可能过时。${error}`).join('；') || (referencesMissing.length?`未找到对象：${referencesMissing.map(ref=>ref.objectId).join('、')}`:'');
  const errorMessage=sourceError&&<div className="source-query-error" role="alert">{sourceError}<button onClick={()=>setRevision(value=>value+1)} disabled={busy}>重试来源</button></div>;
  const filters=<>
    {!stableInitial && <div className="situation-filters"><label>来源<select value={source} onChange={e=>{setSource(e.target.value);setArea('');}}><option value="">全部获准来源</option>{systems.map(system=><option key={system.id} value={system.id}>{system.name}</option>)}</select></label><label>区域<select value={area?JSON.stringify([source,area]):''} onChange={e=>{const [systemId,areaId]=e.target.value?JSON.parse(e.target.value):['',''];setSource(systemId);setArea(areaId);setAll(true);}}><option value="">全部区域</option>{systems.filter(s=>!source || s.id===source).flatMap(s=>s.areas.map(a=><option key={`${s.id}:${a.id}`} value={JSON.stringify([s.id,a.id])}>{s.name} · {a.name}</option>))}</select></label></div>}
    <div className="situation-actions">{stableInitial&&<button onClick={()=>{setDismissedInitial(referenceKey);setSelected('');setSource('');setArea('');setAll(!taskMode);}}>返回范围浏览</button>}<button onClick={()=>setRevision(value=>value+1)} disabled={busy}>{busy?'正在刷新…':'刷新态势'}</button>{taskMode && !stableInitial && <button onClick={()=>setAll(value=>!value)}>{all?'查看任务关注':'查看全部获准态势'}</button>}</div>
    {taskMode && <p className="resource-help">任务关注范围 · 不代表已确认的影响</p>}
    {taskMode && !all && !hasRange && !area && !stableInitial && <p className="resource-help">尚未设置态势范围，请选择区域或查看全部获准态势。</p>}
  </>;
  const sourceTree=<SourceTree objects={objects} visible={visible} layers={layers} selected={selected} busy={busy} summary={scopeSummary} filters={filters} feedback={errorMessage}
    toggleGroup={()=>{if(visible&&layers.length===sourceCategories.length)setSourceVisible(false);else{setSourceVisible(true);setLayers(sourceCategories.map(([kind])=>kind));}}}
    toggleLayer={kind=>{if(!visible){setSourceVisible(true);setLayers([kind]);}else setLayers(old=>old.includes(kind)?old.filter(item=>item!==kind):[...old,kind]);}}
    select={(item,trigger)=>{sourceTrigger.current=trigger;annotations?.pick([]);selectSource?.();setPanelOpen(false);setSelected(refKey(item.ref));requestAnimationFrame(()=>detailClose.current?.focus());}}/>;
  const analysisRef=analysis?.result.resultRef;
  const analysisFocus=analysis?.focusRequest;
  const latestOpenPanel=useRef(openPanel);useLayoutEffect(()=>{latestOpenPanel.current=openPanel;});
  useEffect(()=>{if(!analysisRef)return;let active=true;queueMicrotask(()=>{if(active)latestOpenPanel.current();});return()=>{active=false;};},[analysisRef,analysisFocus]);
  const analysisState=analysis?{...analysis,pick:(id?:string)=>{setSelected('');annotations?.pick([]);analysis.pick(id);openPanel();}}:undefined;
  const tree=<>{analysisState&&<AnalysisPanel state={analysisState} editing={!!annotations?.edit}/ >}{sourceTree}</>;
  const toolbar=<div className={`situation-toolbar${toolbarTarget?' in-titlebar':''}`}>
    {!toolbarTarget&&!workspaceControls&&<span className="situation-map-title">态势地图</span>}
    <button ref={panelButton} type="button" className="icon-button" aria-label="图层与对象" title="图层与对象" aria-expanded={panelOpen} onClick={()=>setPanelOpen(!panelOpen)}><Layers size={20} strokeWidth={1.75} aria-hidden="true"/></button>{workspaceControls}
  </div>;
  return <section className={`situation-view unified-map${compact?' compact':''}${toolbarTarget?' titlebar-map':''}${floating?' floating-map':''}`} aria-label="态势地图">
    {!annotations&&(toolbarTarget?createPortal(toolbar,toolbarTarget):toolbar)}
    {contentPanelTarget?createPortal(tree,contentPanelTarget):!annotations&&<aside ref={setLocalPanel} className="situation-content-panel" hidden={!panelOpen} aria-label="图层与对象" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();setPanelOpen(false);panelButton.current?.focus();}}}><header className="annotation-panel-heading"><strong>图层与对象</strong><button className="icon-button" aria-label="关闭图层与对象" onClick={()=>{setPanelOpen(false);panelButton.current?.focus();}}><X size={18} aria-hidden="true"/></button></header>{tree}</aside>}
    {sourceError&&!chosen&&!(annotations?contentPanelOpen:panelOpen)&&<div className="situation-source-error">{errorMessage}</div>}
    <div className="situation-content"><div className="situation-map-and-list">{config ? <Suspense fallback={<p role="status">正在加载地图…</p>}><Canvas analysis={analysisState} analysisPanel={contentPanelTarget?.closest<HTMLElement>('aside') || localPanel} analysisPanelOpen={annotations?contentPanelOpen:panelOpen} closeAnalysisPanel={closeContentPanel || (()=>setPanelOpen(false))} deferFocus={!!chosen&&(!visible || !layers.includes(chosen.ref.objectType))} focusRequest={JSON.stringify([focusRequest || 0,locateRequest])} annotations={annotations} objects={mapObjects} selected={selected} config={config} select={key=>{sourceTrigger.current=null;setSelected(key);if(key){setPanelOpen(false);selectSource?.();}}} unavailable={openPanel}/></Suspense> : <p role="status">正在读取底图配置…</p>}</div>
    <div className="situation-detail" hidden={!chosen}>{chosen ? <><div className="situation-detail-heading"><h2>{chosen.name}</h2><button ref={detailClose} className="icon-button" aria-label="关闭对象详情" onClick={()=>{setSelected('');const trigger=sourceTrigger.current;if(trigger){openPanel();requestAnimationFrame(()=>trigger.focus());}}}><X size={18} aria-hidden="true"/></button></div>{!(annotations?contentPanelOpen:panelOpen)&&errorMessage}<p>{objectStatus(chosen)}</p>{(!visible || !layers.includes(chosen.ref.objectType))&&<p className="resource-help">此对象在地图中已隐藏。</p>}{chosen.geometry&&<button onClick={()=>{setSourceVisible(true);setLayers(old=>old.includes(chosen.ref.objectType)?old:[...old,chosen.ref.objectType]);setLocateRequest(value=>value+1);}}>{!visible || !layers.includes(chosen.ref.objectType)?'显示并定位':'定位对象'}</button>}{!chosen.geometry && <p>暂无位置，可继续查询或引用。</p>}{stableInitial && refKey(stableInitial.ref)===refKey(chosen.ref) && <p className="resource-help">{stableInitial.revision?`依据版本 ${stableInitial.revision}；`:'报告关联对象；'}地图显示当前态势，当前版本 {chosen.revision}。</p>}<p className="resource-help">来源资料 · 只读 · {catalog?.systems.find(s=>s.id===chosen.ref.systemId)?.name || chosen.ref.systemId}</p><button className="primary-action" onClick={()=>reference(chosen)}>引用到对话</button><details key={refKey(chosen.ref)} className="situation-object-info"><summary>查看详情</summary><dl><dt>来源</dt><dd>{catalog?.systems.find(s=>s.id===chosen.ref.systemId)?.name || chosen.ref.systemId}</dd><dt>对象编号</dt><dd>{chosen.ref.objectId}</dd><dt>修订</dt><dd>{chosen.revision}</dd><dt>业务生效时间</dt><dd>{chosen.effectiveAt || '未提供'}</dd><dt>有效时段</dt><dd>{chosen.validTime?`${chosen.validTime.from || '未限定'} ～ ${chosen.validTime.to || '未限定'}`:'未提供'}</dd><dt>本次查询时间</dt><dd>{sources[chosen.ref.systemId]?.queriedAt}</dd><dt>来源资料截止时间</dt><dd>{sources[chosen.ref.systemId]?.asOf}</dd></dl>{'restrictionNote' in chosen.properties && <p>{chosen.properties.restrictionNote}</p>}</details></> : <p className="resource-help">选择地图对象或列表条目查看详情。</p>}</div></div>
  </section>;
}
export type { ContextRef };
