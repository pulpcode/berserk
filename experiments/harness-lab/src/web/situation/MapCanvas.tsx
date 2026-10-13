import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Map, NavigationControl, GeoJSONSource, LngLatBounds, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MapConfig, SituationObject } from '../../contracts/context';
import { refKey } from './evidence';
import { createAnnotationRuntime, type AnnotationMapState } from '../annotations/map-runtime';
setWorkerUrl(workerUrl);
export default function MapCanvas({ objects, selected, config, select, annotations, unavailable, focusRequest, deferFocus }: { deferFocus?:boolean; focusRequest?: number | string; unavailable?: () => void; annotations?: AnnotationMapState; objects: SituationObject[]; selected?: string; config: MapConfig; select: (key: string) => void }) {
  const container = useRef<HTMLDivElement>(null); const map = useRef<Map | undefined>(undefined);
  const latest = useRef({ objects, selected, select, annotations, unavailable, focusRequest, deferFocus }); useLayoutEffect(()=>{latest.current = { objects, selected, select, annotations, unavailable, focusRequest, deferFocus };},[objects, selected, select, annotations, unavailable, focusRequest, deferFocus]);
  const updater=useRef<()=>void>(()=>{}); const fitted=useRef('');
  const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!container.current) return;
    let instance: Map;
    try {
      const probe=document.createElement('canvas').getContext('webgl2');
      if(!probe)throw new Error('WebGL unavailable');
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      instance = new Map({ container: container.current, style: { version: 8, sources: { basemap: { type: 'raster', tiles: config.tiles, tileSize: config.tileSize } }, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8efeb' } }, { id: 'basemap', type: 'raster', source: 'basemap' }] }, center: [0,0], zoom: 1, attributionControl: false });
    } catch { let alive=true;queueMicrotask(()=>{if(alive){setError('地图暂不可用，请通过图层与对象查看与引用。');latest.current.unavailable?.();}});return()=>{alive=false;}; }
    map.current = instance;fitted.current='';
    const annotationRuntime=createAnnotationRuntime(instance,()=>latest.current.annotations);
    instance.addControl(new NavigationControl(), 'bottom-left');
    const update = () => {
      annotationRuntime.update();
      const features = latest.current.objects.filter(item => item.geometry).map(item => ({ type: 'Feature' as const, geometry: item.geometry!, properties: { key: refKey(item.ref), selected: refKey(item.ref) === latest.current.selected, passability: 'passability' in item.properties ? item.properties.passability : 'unknown' } }));
      (instance.getSource('objects') as GeoJSONSource | undefined)?.setData({ type:'FeatureCollection', features });
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
      instance.addSource('objects', { type: 'geojson', data: { type:'FeatureCollection', features:[] } });
      instance.addLayer({ id: 'areas', type:'fill', source:'objects', filter:['==',['geometry-type'],'Polygon'], paint:{ 'fill-color':'#62877a','fill-opacity':0.16 } });
      instance.addLayer({ id:'roads', type:'line', source:'objects', filter:['==',['geometry-type'],'LineString'], paint:{ 'line-width':['case',['get','selected'],8,5], 'line-color':['match',['get','passability'],'open','#376e5d','restricted','#a26913','closed','#b34d48','#687582'] } });
      instance.addLayer({ id:'restricted-roads', type:'line', source:'objects', filter:['all',['==',['geometry-type'],'LineString'],['!=',['get','passability'],'open']], paint:{ 'line-width':2,'line-color':'#ffffff','line-dasharray':[2,3] } });
      instance.addLayer({ id:'resources', type:'circle', source:'objects', filter:['==',['geometry-type'],'Point'], paint:{ 'circle-radius':['case',['get','selected'],11,7], 'circle-color':'#416858','circle-stroke-color':'white','circle-stroke-width':2 } });
      annotationRuntime.restore();
      update();
    });
    instance.on('load',update);
    instance.on('click', event => {
      if(latest.current.annotations?.edit)return;
      const hits=instance.queryRenderedFeatures(event.point);
      if(hits.some(feature=>feature.properties?.group && feature.properties?.objectId)){latest.current.select('');return;}
      const feature=hits.find(feature=>['resources','roads','areas'].includes(feature.layer.id) && feature.properties?.key);
      latest.current.annotations?.pick([]);
      latest.current.select(feature?.properties?.key?String(feature.properties.key):'');
    });
    instance.on('error', event => { if ('sourceId' in event && event.sourceId === 'basemap') setError('底图加载失败，态势对象和列表仍可使用。'); });
    const resize = new ResizeObserver(() => instance.resize()); resize.observe(container.current);
    return () => { updater.current=()=>{}; resize.disconnect(); annotationRuntime.destroy(); instance.remove(); map.current=undefined; };
  }, [config, retry]);
  useEffect(()=>{updater.current();},[objects,selected,annotations,focusRequest,deferFocus]);
  return <div className="situation-canvas-wrap"><div ref={container} className="situation-canvas" aria-label="态势地图画布"/>
    <a className="situation-attribution" href={config.attributionUrl} target="_blank" rel="noreferrer">{config.attributionText}</a>
    {error && <div className="situation-map-error" role="status">{error}<button onClick={()=>{setError('');setRetry(value=>value+1);}}>重试底图</button></div>}
  </div>;
}
