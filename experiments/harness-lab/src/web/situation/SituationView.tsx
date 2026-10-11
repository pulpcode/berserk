import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ContextCatalog, ContextQueryResult, MapConfig, SituationObject, SituationQueryParams, ContextRef, InformationDetail } from '../../contracts/context';
import type { TaskContext } from '../../contracts/access';
import { checkResponse, useApi } from '../api';
import { refKey, type MapReference } from './evidence';
import { objectStatus, readSituation, taskQueries, uniqueObjects, type SourceResult } from './map-data';
const Canvas = lazy(()=>import('./MapCanvas'));
export interface SituationViewProps { toolbarTarget?: HTMLElement | null; taskContext?: TaskContext; taskMode?: boolean; initial?: MapReference; compact?: boolean; reference: (item: SituationObject) => void; }
export default function SituationView({ toolbarTarget, taskContext, taskMode=false, initial, compact=false, reference }: SituationViewProps) {
  const client=useApi(); const [catalog,setCatalog]=useState<ContextCatalog>(); const [config,setConfig]=useState<MapConfig>(); const [setupError,setSetupError]=useState('');
  const [source,setSource]=useState(initial?.ref.systemId || ''); const [area,setArea]=useState(''); const [kind,setKind]=useState(''); const [all,setAll]=useState(!taskMode); const [revision,setRevision]=useState(0);
  const [selected,setSelected]=useState(initial ? refKey(initial.ref) : ''); const [sourceState,setSourceState]=useState<{key:string;values:Record<string,SourceResult>}>(); const [errorState,setErrorState]=useState<{key:string;values:Record<string,string>}>(); const [busy,setBusy]=useState(false);
  const [layers,setLayers]=useState(['road','resource','area']); const generation=useRef(0);
  const contextKey=JSON.stringify(taskContext || null);const stableContext=useMemo(()=>JSON.parse(contextKey) as TaskContext | undefined,[contextKey]);
  const initialKey=JSON.stringify(initial || null);const stableInitial=useMemo(()=>JSON.parse(initialKey) as MapReference | undefined,[initialKey]);
  const scopeKey=JSON.stringify({source,area,all,contextKey,initialKey});
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
    if(!catalog || (taskMode && !all && !hasRange && !area)) return;
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
        if(source)queries=queries.filter(query=>query.systemId===source);
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
  const objects=useMemo(()=>uniqueObjects(Object.values(sources).flatMap(value=>value.items)).filter(item=>(!kind || item.ref.objectType===kind) && layers.includes(item.ref.objectType)),[sources,kind,layers]);
  const chosen=objects.find(item=>refKey(item.ref)===selected);
  const referencesMissing=Object.values(sources).flatMap(result=>result.unknownRefs);
  const toolbar = <div className={`situation-toolbar${toolbarTarget?' in-titlebar':''}`}>
    {!toolbarTarget && !compact && !taskMode && <header className="information-heading"><div><h1>态势地图</h1><p>模拟态势 · {taskMode?'任务关注范围，不代表已确认的影响':'当前获准资料'}</p></div></header>}
    {taskMode && <p className="resource-help">任务关注范围 · 不代表已确认的影响</p>}
    {setupError && <p role="alert" className="resource-error">{setupError}</p>}
    {!initial && <div className="situation-filters"><label>来源<select value={source} onChange={e=>{setSource(e.target.value);setArea('');}}><option value="">全部获准来源</option>{systems.map(system=><option key={system.id} value={system.id}>{system.name}</option>)}</select></label><label>区域<select value={area?JSON.stringify([source,area]):''} onChange={e=>{const [systemId,areaId]=e.target.value?JSON.parse(e.target.value):['',''];setSource(systemId);setArea(areaId);setAll(true);}}><option value="">全部区域</option>{systems.filter(s=>!source || s.id===source).flatMap(s=>s.areas.map(a=><option key={`${s.id}:${a.id}`} value={JSON.stringify([s.id,a.id])}>{s.name} · {a.name}</option>))}</select></label><label>对象类型<select value={kind} onChange={e=>setKind(e.target.value)}><option value="">全部类型</option><option value="road">道路</option><option value="resource">资源池</option><option value="area">区域</option></select></label></div>}
    <div className="situation-actions"><button onClick={()=>setRevision(value=>value+1)} disabled={busy}>{busy?'正在刷新…':'刷新态势'}</button>{taskMode && <button onClick={()=>setAll(value=>!value)}>{all?'查看任务关注':'查看全部获准态势'}</button>}<span role="status">{objects.length} 个对象</span></div>
    {taskMode && !all && !hasRange && !area && <p className="resource-help">尚未设置态势范围，请选择区域或查看全部获准态势。</p>}
    {Object.entries(errors).filter(([,error])=>error).map(([id,error])=><p key={id} className="resource-error" role="alert">{id}：更新失败，已加载的内容可能过时。{error}</p>)}
    {referencesMissing.length>0 && <p className="resource-error">未找到对象：{referencesMissing.map(ref=>ref.objectId).join('、')}</p>}
    <details className="situation-layer-menu"><summary>图层</summary><div className="situation-layers" aria-label="显示图层">{[['road','道路'],['resource','资源池'],['area','区域']].map(([id,label])=><label key={id}><input type="checkbox" checked={layers.includes(id)} onChange={e=>setLayers(old=>e.target.checked?[...old,id]:old.filter(item=>item!==id))}/>{label}</label>)}</div></details>
    </div>;
  return <section className={`situation-view${compact?' compact':''}${toolbarTarget?' titlebar-map':''}`} aria-label="态势地图">
    {toolbarTarget ? createPortal(toolbar,toolbarTarget) : toolbar}
    <div className="situation-content"><div className="situation-map-and-list">{config ? <Suspense fallback={<p role="status">正在加载地图…</p>}><Canvas objects={objects} selected={selected} config={config} select={setSelected}/></Suspense> : <p role="status">正在读取底图配置…</p>}
    <details open={compact || undefined} className="situation-object-list"><summary>对象列表 · {objects.length}</summary><ul>{objects.map(item=><li key={refKey(item.ref)}><button aria-pressed={selected===refKey(item.ref)} onClick={()=>setSelected(refKey(item.ref))}><strong>{item.name}</strong><span>{objectStatus(item)}{!item.geometry?' · 暂无位置':''}</span></button></li>)}</ul>{!objects.length && !busy && !Object.values(errors).some(Boolean) && <p>当前范围没有对象。</p>}</details></div>
    <div className="situation-detail" hidden={!compact && !chosen}>{chosen ? <><div className="situation-detail-heading"><h2>{chosen.name}</h2><button className="icon-button" aria-label="关闭对象详情" onClick={()=>setSelected('')}><X size={18} aria-hidden="true"/></button></div><p>{objectStatus(chosen)}</p>{!chosen.geometry && <p>暂无位置，可继续查询或引用。</p>}{initial && <p className="resource-help">{initial.revision?`依据版本 ${initial.revision}；`:'报告关联对象；'}地图显示当前态势，当前版本 {chosen.revision}。</p>}<dl><dt>来源</dt><dd>{catalog?.systems.find(s=>s.id===chosen.ref.systemId)?.name || chosen.ref.systemId}</dd><dt>对象编号</dt><dd>{chosen.ref.objectId}</dd><dt>修订</dt><dd>{chosen.revision}</dd><dt>业务生效时间</dt><dd>{chosen.effectiveAt || '未提供'}</dd><dt>有效时段</dt><dd>{chosen.validTime?`${chosen.validTime.from || '未限定'} ～ ${chosen.validTime.to || '未限定'}`:'未提供'}</dd><dt>本次查询时间</dt><dd>{sources[chosen.ref.systemId]?.queriedAt}</dd><dt>来源资料截止时间</dt><dd>{sources[chosen.ref.systemId]?.asOf}</dd></dl>{'restrictionNote' in chosen.properties && <p>{chosen.properties.restrictionNote}</p>}<button className="primary-action" onClick={()=>reference(chosen)}>引用到对话</button></> : <p className="resource-help">选择地图对象或列表条目查看详情。</p>}</div></div>
  </section>;
}
export type { ContextRef };
