import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Map, NavigationControl, GeoJSONSource, LngLatBounds, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MapConfig, SituationObject } from '../../contracts/context';
import { refKey } from './evidence';
import { useApi } from '../api';
import { basemapViews, isBasemapView, normalizeMapConfig, type BasemapView } from '../../contracts/map';
import { BUSINESS_ANCHOR } from './basemap-style';
import { activeBasemapKinds, createBasemapRuntime, type BasemapStatus } from './basemap-runtime';
import { createAnnotationRuntime, type AnnotationMapState } from '../annotations/map-runtime';
function rememberedView(key: string, fallback: BasemapView): BasemapView {
  try {const value=localStorage.getItem(key);return isBasemapView(value)?value:fallback;} catch {return fallback;}
}
setWorkerUrl(workerUrl);
export default function MapCanvas({ objects, selected, config, select, annotations, unavailable, focusRequest, deferFocus }: { deferFocus?:boolean; focusRequest?: number | string; unavailable?: () => void; annotations?: AnnotationMapState; objects: SituationObject[]; selected?: string; config: MapConfig; select: (key: string) => void }) {
  const {storageKey}=useApi(), preferenceKey=storageKey('berserk.basemap-view','user-preference');
  const basemapConfig=useMemo(()=>normalizeMapConfig(config),[config]);
  const [preference,setPreference]=useState(()=>({key:preferenceKey,view:rememberedView(preferenceKey,basemapConfig.defaultView)}));
  if(preference.key!==preferenceKey)setPreference({key:preferenceKey,view:rememberedView(preferenceKey,basemapConfig.defaultView)});
  const view=preference.view;
  const [status,setStatus]=useState<BasemapStatus>({loading:true,errors:[],notices:[]});
  const basemap=useRef<ReturnType<typeof createBasemapRuntime> | undefined>(undefined);
  const chooseView=(view:BasemapView)=>{setPreference({key:preferenceKey,view});try{localStorage.setItem(preferenceKey,view);}catch{/* Retain the choice in memory when storage is unavailable. */}};
  const container = useRef<HTMLDivElement>(null); const map = useRef<Map | undefined>(undefined);
  const latest = useRef({ objects, selected, select, annotations, unavailable, focusRequest, deferFocus, basemapConfig, view }); useLayoutEffect(()=>{latest.current = { objects, selected, select, annotations, unavailable, focusRequest, deferFocus, basemapConfig, view };},[objects, selected, select, annotations, unavailable, focusRequest, deferFocus, basemapConfig, view]);
  const updater=useRef<()=>void>(()=>{}); const fitted=useRef('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!container.current) return;
    let instance: Map;
    try {
      const probe=document.createElement('canvas').getContext('webgl2');
      if(!probe)throw new Error('WebGL unavailable');
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      instance = new Map({ container: container.current, style: { version: 8, sources: {}, layers: [{ id: 'basemap:background', type: 'background', paint: { 'background-color': '#e8edeb' } }, { id: BUSINESS_ANCHOR, type: 'background', paint: { 'background-opacity': 0 } }] }, center: [0,0], zoom: 1, attributionControl: false });
    } catch { let alive=true;queueMicrotask(()=>{if(alive){setError('地图暂不可用，请通过图层与对象查看与引用。');latest.current.unavailable?.();}});return()=>{alive=false;}; }
    map.current = instance;fitted.current='';
    const annotationRuntime=createAnnotationRuntime(instance,()=>latest.current.annotations);
    const basemapRuntime=createBasemapRuntime(instance,setStatus);basemap.current=basemapRuntime;
    instance.addControl(new NavigationControl(), 'bottom-left');
    const update = () => {
      annotationRuntime.update();
      const features = latest.current.objects.filter(item => item.geometry).map(item => ({ type: 'Feature' as const, geometry: item.geometry!, properties: { key: refKey(item.ref), selected: refKey(item.ref) === latest.current.selected, passability: 'passability' in item.properties ? item.properties.passability : 'unknown' } }));
      (instance.getSource('business:objects') as GeoJSONSource | undefined)?.setData({ type:'FeatureCollection', features });
      const fitKey=JSON.stringify([latest.current.selected || 'all',latest.current.focusRequest || 0]);
      if(latest.current.annotations?.fit && (!latest.current.selected || fitted.current===fitKey))return;
      if(fitted.current===fitKey)return;
      if(latest.current.deferFocus){fitted.current=fitKey;return;}
      const choices=latest.current.selected?latest.current.objects.filter(item=>refKey(item.ref)===latest.current.selected):latest.current.objects;
      const points=choices.flatMap(item=>!item.geometry?[]:item.geometry.type==='Point'?[item.geometry.coordinates]:item.geometry.type==='LineString'?item.geometry.coordinates:item.geometry.coordinates.flat());
      if(points.length){fitted.current=fitKey;const bounds=new LngLatBounds(points[0],points[0]);points.forEach(point=>bounds.extend(point));instance.fitBounds(bounds,{padding:40,maxZoom:15,duration:0});}
    };
    updater.current=update;
    instance.on('style.load', () => {
      instance.addSource('business:objects', { type: 'geojson', data: { type:'FeatureCollection', features:[] } });
      instance.addLayer({ id: 'business:areas', type:'fill', source:'business:objects', filter:['==',['geometry-type'],'Polygon'], paint:{ 'fill-color':'#62877a','fill-opacity':0.16 } });
      instance.addLayer({id:'business:area-outline',type:'line',source:'business:objects',filter:['==',['geometry-type'],'Polygon'],paint:{'line-color':'#ffffff','line-width':4}});
      instance.addLayer({id:'business:area-border',type:'line',source:'business:objects',filter:['==',['geometry-type'],'Polygon'],paint:{'line-color':'#62877a','line-width':2}});
      instance.addLayer({id:'business:road-halo',type:'line',source:'business:objects',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#ffffff','line-width':['case',['get','selected'],11,8]}});
      instance.addLayer({ id:'business:roads', type:'line', source:'business:objects', filter:['==',['geometry-type'],'LineString'], paint:{ 'line-width':['case',['get','selected'],8,5], 'line-color':['match',['get','passability'],'open','#376e5d','restricted','#a26913','closed','#b34d48','#687582'] } });
      instance.addLayer({ id:'business:restricted-roads', type:'line', source:'business:objects', filter:['all',['==',['geometry-type'],'LineString'],['!=',['get','passability'],'open']], paint:{ 'line-width':2,'line-color':'#ffffff','line-dasharray':[2,3] } });
      instance.addLayer({ id:'business:resources', type:'circle', source:'business:objects', filter:['==',['geometry-type'],'Point'], paint:{ 'circle-radius':['case',['get','selected'],11,7], 'circle-color':'#416858','circle-stroke-color':'white','circle-stroke-width':2 } });
      basemapRuntime.update(latest.current.basemapConfig,latest.current.view);
      annotationRuntime.restore();
      update();
    });
    instance.on('load',update);
    instance.on('click', event => {
      if(latest.current.annotations?.edit)return;
      const hits=instance.queryRenderedFeatures(event.point);
      if(hits.some(feature=>feature.properties?.group && feature.properties?.objectId)){latest.current.select('');return;}
      const feature=hits.find(feature=>['business:resources','business:roads','business:areas'].includes(feature.layer.id) && feature.properties?.key);
      latest.current.annotations?.pick([]);
      latest.current.select(feature?.properties?.key?String(feature.properties.key):'');
    });
    const resize = new ResizeObserver(() => instance.resize()); resize.observe(container.current);
    return () => { updater.current=()=>{}; resize.disconnect(); annotationRuntime.destroy(); basemapRuntime.destroy(); basemap.current=undefined; instance.remove(); map.current=undefined; };
  }, []);
  useEffect(()=>{basemap.current?.update(basemapConfig,view);},[basemapConfig,view]);
  useEffect(()=>{updater.current();},[objects,selected,annotations,focusRequest,deferFocus]);
  return <div className="situation-canvas-wrap"><div ref={container} className="situation-canvas" aria-label="态势地图画布"/>
    <div className="situation-basemap-switch" role="group" aria-label="底图视图">{basemapViews.map(option=><button key={option.id} type="button" aria-pressed={view===option.id} onClick={()=>chooseView(option.id)}>{option.label}</button>)}</div>
    <div className="situation-attribution" aria-label="底图署名">{activeBasemapKinds(view).flatMap(kind=>basemapConfig[kind].attributions).map((item,index)=><a key={`${index}:${item.url}`} href={item.url} target="_blank" rel="noreferrer">{item.text}</a>)}</div>
    {(error || status.errors.length>0 || status.notices.length>0 || status.loading) && <div className="situation-map-feedback" role="status">
      {error || <>{status.errors.map(message=><p key={message}>{message}</p>)}{status.errors.length>0&&<button type="button" onClick={()=>basemap.current?.retry()}>重试底图</button>}{status.notices.map(message=><p key={message}>{message}</p>)}{status.loading&&status.errors.length===0&&<p>正在加载底图…</p>}</>}
    </div>}
  </div>;
}
