import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Map, NavigationControl, GeoJSONSource, LngLatBounds, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MapConfig, SituationObject } from '../../contracts/context';
import { refKey } from './evidence';
setWorkerUrl(workerUrl);
export default function MapCanvas({ objects, selected, config, select }: { objects: SituationObject[]; selected?: string; config: MapConfig; select: (key: string) => void }) {
  const container = useRef<HTMLDivElement>(null); const map = useRef<Map | undefined>(undefined);
  const latest = useRef({ objects, selected, select }); useLayoutEffect(()=>{latest.current = { objects, selected, select };},[objects, selected, select]);
  const updater=useRef<()=>void>(()=>{}); const fitted=useRef('');
  const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!container.current) return;
    let instance: Map;
    try {
      instance = new Map({ container: container.current, style: { version: 8, sources: { basemap: { type: 'raster', tiles: config.tiles, tileSize: config.tileSize } }, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8efeb' } }, { id: 'basemap', type: 'raster', source: 'basemap' }] }, center: [0,0], zoom: 1, attributionControl: false });
    } catch { let alive=true;queueMicrotask(()=>{if(alive)setError('地图暂不可用，请通过对象列表查看与引用。');});return()=>{alive=false;}; }
    map.current = instance;fitted.current='';
    instance.addControl(new NavigationControl(), 'bottom-left');
    const update = () => {
      const features = latest.current.objects.filter(item => item.geometry).map(item => ({ type: 'Feature' as const, geometry: item.geometry!, properties: { key: refKey(item.ref), selected: refKey(item.ref) === latest.current.selected, passability: 'passability' in item.properties ? item.properties.passability : 'unknown' } }));
      (instance.getSource('objects') as GeoJSONSource | undefined)?.setData({ type:'FeatureCollection', features });
      const fitKey=latest.current.selected || 'all';if(fitted.current===fitKey)return;
      const choices=latest.current.selected?latest.current.objects.filter(item=>refKey(item.ref)===latest.current.selected):latest.current.objects;
      const points=choices.flatMap(item=>!item.geometry?[]:item.geometry.type==='Point'?[item.geometry.coordinates]:item.geometry.type==='LineString'?item.geometry.coordinates:item.geometry.coordinates.flat());
      if(points.length){fitted.current=fitKey;const bounds=new LngLatBounds(points[0],points[0]);points.forEach(point=>bounds.extend(point));instance.fitBounds(bounds,{padding:40,maxZoom:15,duration:0});}
    };
    updater.current=update;
    instance.on('load', () => {
      instance.addSource('objects', { type: 'geojson', data: { type:'FeatureCollection', features:[] } });
      instance.addLayer({ id: 'areas', type:'fill', source:'objects', filter:['==',['geometry-type'],'Polygon'], paint:{ 'fill-color':'#62877a','fill-opacity':0.16 } });
      instance.addLayer({ id:'roads', type:'line', source:'objects', filter:['==',['geometry-type'],'LineString'], paint:{ 'line-width':['case',['get','selected'],8,5], 'line-color':['match',['get','passability'],'open','#376e5d','restricted','#a26913','closed','#b34d48','#687582'] } });
      instance.addLayer({ id:'restricted-roads', type:'line', source:'objects', filter:['all',['==',['geometry-type'],'LineString'],['!=',['get','passability'],'open']], paint:{ 'line-width':2,'line-color':'#ffffff','line-dasharray':[2,3] } });
      instance.addLayer({ id:'resources', type:'circle', source:'objects', filter:['==',['geometry-type'],'Point'], paint:{ 'circle-radius':['case',['get','selected'],11,7], 'circle-color':'#416858','circle-stroke-color':'white','circle-stroke-width':2 } });
      update();
      instance.on('click', event => { const feature = instance.queryRenderedFeatures(event.point,{layers:['resources','roads','areas']})[0]; if (feature?.properties?.key) latest.current.select(String(feature.properties.key)); });
    });
    instance.on('error', event => { if ('sourceId' in event && event.sourceId === 'basemap') setError('底图加载失败，态势对象和列表仍可使用。'); });
    const resize = new ResizeObserver(() => instance.resize()); resize.observe(container.current);
    return () => { updater.current=()=>{}; resize.disconnect(); instance.remove(); map.current=undefined; };
  }, [config, retry]);
  useEffect(()=>{updater.current();},[objects,selected]);
  return <div className="situation-canvas-wrap"><div ref={container} className="situation-canvas" aria-label="模拟态势地图"/>
    <span className="situation-simulation-label">模拟态势</span><a className="situation-attribution" href={config.attributionUrl} target="_blank" rel="noreferrer">{config.attributionText}</a>
    {error && <div className="situation-map-error" role="status">{error}<button onClick={()=>{setError('');setRetry(value=>value+1);}}>重试底图</button></div>}
  </div>;
}
