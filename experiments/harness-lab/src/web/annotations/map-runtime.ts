import { LngLatBounds, Marker, MercatorCoordinate, type Map as LibreMap } from 'maplibre-gl';
import { TerraDraw, TerraDrawLineStringMode, TerraDrawPointMode, TerraDrawPolygonMode, TerraDrawSelectMode } from 'terra-draw';
import { PausableAnnotationAdapter } from './pausable-adapter';
import { ensureMapSymbols, resolveMapSymbol } from '../map-symbols';
import type { AnnotationFeature, AnnotationVersion } from '../../contracts/annotations';
import type { SituationGeometry } from '../../contracts/context';
import { BUSINESS_ANCHOR } from '../situation/basemap-style';

export interface AnnotationMapGroup { key: string; version: AnnotationVersion; visibleLayers: string[] }
export interface AnnotationMapEdit { mode: 'point' | 'line' | 'polygon' | 'text' | 'select'; feature?: AnnotationFeature; paused?: boolean }
export interface AnnotationMapState {
  groups: AnnotationMapGroup[]; selected?: {group:string;objectId:string}; fit?: { key: string; geometry: SituationGeometry[] };
  edit?: AnnotationMapEdit; pick: (keys: Array<{group: string; layerId: string; objectId: string}>) => void;
  finish: (geometry: SituationGeometry, objectId?: string) => void; error: (message: string) => void;
}
export function createAnnotationRuntime(map: LibreMap, read: () => AnnotationMapState | undefined) {
  let layers: string[] = []; let sources: string[] = []; let markers: Marker[] = []; let fitKey = ''; let editorKey = ''; let editor: TerraDraw | undefined; let adapter: PausableAnnotationAdapter | undefined; let rendered = ''; let disposed = false; let symbolsStarted = false;
  const cleanupLayers = () => { markers.forEach(marker => marker.remove()); markers = []; for (const id of [...layers].reverse()) if (map.getLayer(id)) map.removeLayer(id); for (const id of sources) if (map.getSource(id)) map.removeSource(id); layers = []; sources = []; };
  const clearEditor = () => { if (editor?.enabled) editor.stop(); editor = undefined; adapter = undefined; editorKey = '';  };
  const click = (event: {point: {x: number; y: number}}) => {
    if (read()?.edit && !read()?.edit?.paused) return;
    const available = layers.filter(id => map.getLayer(id)); if (!available.length) return;
    const found = map.queryRenderedFeatures([event.point.x,event.point.y], { layers: available });
    const keys = new Map<string, {group: string; layerId: string; objectId: string}>();
    for (const item of found) if (item.properties?.objectId) { const {group, layerId, objectId} = item.properties; keys.set(JSON.stringify([group,layerId,objectId]), {group,layerId,objectId}); }
    if (keys.size) read()?.pick([...keys.values()]);
  };
  map.on('click', click);
  function update() {
    // GeoJSON sources can still be loading after the style is ready.
    if (!map.getLayer(BUSINESS_ANCHOR)) return;
    const state = read();
    if (!symbolsStarted) { symbolsStarted = true; void ensureMapSymbols(map).then(failed => { if (disposed) return; if (failed.length) read()?.error('部分标号素材不可用，地图以问号显示，请刷新后重试。'); rendered=''; update(); }).catch(() => { if (!disposed) read()?.error('标号素材加载失败，请刷新后重试。'); }); }
    const renderKey=JSON.stringify([state?.groups || [],state?.selected]);
    if (rendered !== renderKey) { cleanupLayers(); rendered=renderKey;
    for (const group of state?.groups || []) for (const layer of [...group.version.document.layers].sort((a,b) => a.order-b.order)) {
      if (!group.visibleLayers.includes(layer.layerId)) continue;
      const id = `annotation:${encodeURIComponent(group.key)}:${encodeURIComponent(layer.layerId)}`;
      const features = layer.features.map(feature => { const symbol=resolveMapSymbol(feature.style); return ({ type: 'Feature' as const, geometry: feature.geometry, properties: {group: group.key, layerId: layer.layerId, objectId: feature.objectId, selected:state?.selected?.group===group.key&&state.selected.objectId===feature.objectId, hitSize:feature.style?.symbolId?(feature.style.iconSize || 32)/2:feature.style?.size || 7, color: feature.style?.color || '#416858', fill: feature.style?.fillColor || feature.style?.color || '#416858', opacity: feature.style?.opacity ?? 0.35, width: feature.style?.width ?? 3, size: feature.style?.size ?? 7, lineStyle: feature.style?.lineStyle || 'solid', ...(symbol ? {image:symbol.imageId,iconSize:symbol.iconSize/32,rotation:symbol.rotation,upright:symbol.definition.orientation==='upright'} : {})} }); });
      map.addSource(id, {type: 'geojson', data: {type: 'FeatureCollection', features}}); sources.push(id);
      map.addLayer({id: `${id}:fill`, type:'fill', source:id, filter:['==',['geometry-type'],'Polygon'], paint:{'fill-color':['get','fill'],'fill-opacity':['get','opacity']}}); layers.push(`${id}:fill`);
      for (const [style,dash] of [['solid',undefined],['dashed',[3,2]],['dotted',[1,2]]] as const) {
        // A solid stroke must bypass the dash atlas; [1, 0] can disappear after other layers change.
        const dashPaint = dash ? {'line-dasharray':[...dash]} : {};
        const outline = `${id}:${style}:halo`; map.addLayer({id:outline,type:'line',source:id,filter:['all',['!=',['geometry-type'],'Point'],['==',['get','lineStyle'],style]],paint:{'line-color':'#ffffff','line-width':['+',['get','width'],3],...dashPaint}}); layers.push(outline);
        const line = `${id}:${style}`; map.addLayer({id:line,type:'line',source:id,filter:['all',['!=',['geometry-type'],'Point'],['==',['get','lineStyle'],style]],paint:{'line-color':['get','color'],'line-width':['get','width'],...dashPaint}}); layers.push(line);
      }
      map.addLayer({id:`${id}:point`,type:'circle',source:id,filter:['==',['geometry-type'],'Point'],paint:{'circle-color':['get','color'],'circle-radius':['+',['get','hitSize'],3],'circle-opacity':0,'circle-stroke-color':'#416858','circle-stroke-width':['case',['get','selected'],2,0]}}); layers.push(`${id}:point`);
      for (const upright of [false,true]) {
        const symbolLayer=`${id}:symbols:${upright?'upright':'heading'}`;
        map.addLayer({id:symbolLayer,type:'symbol',source:id,filter:['all',['has','image'],['==',['get','upright'],upright]],layout:{'icon-image':['get','image'],'icon-size':['get','iconSize'],'icon-rotate':['get','rotation'],'icon-rotation-alignment':upright?'viewport':'map','icon-pitch-alignment':'viewport','icon-allow-overlap':true,'icon-ignore-placement':true}}); layers.push(symbolLayer);
      }
      for (const feature of layer.features) {
        const point = feature.geometry.type === 'Point' ? feature.geometry.coordinates : feature.geometry.type==='LineString'?feature.geometry.coordinates[0]:feature.geometry.coordinates[0]?.[0];
        const label = feature.style?.label || (feature.kind === 'text' || feature.style?.symbolId || feature.informationRole || group.key==='preview' ? feature.name : '');
        if (!point) continue;
        const element = document.createElement('div'); element.className = 'annotation-marker'; element.style.pointerEvents='none';
        if (feature.kind === 'point' && !feature.style?.symbolId) { const shape=document.createElement('span');shape.className=`annotation-symbol ${feature.style?.symbol || 'circle'}`; shape.style.background=feature.style?.color || '#416858'; const size=(feature.style?.size ?? 7)*2;shape.style.width=`${size}px`;shape.style.height=`${size}px`;element.append(shape); }
        if (label) { const text=document.createElement('span');text.className='annotation-label';text.textContent=`${feature.informationRole==='plan'?'拟定 · ':feature.informationRole==='assessment'?'研判 · ':feature.informationRole==='observation'?'现场记录 · ':''}${group.key==='preview'?'未保存 · ':''}${label}`;text.style.top=`${feature.kind==='point'?(feature.style?.symbolId?(feature.style.iconSize || 32)/2:feature.style?.size || 7)+4:4}px`;text.style.color=feature.style?.color || '#416858';element.append(text); }
        if (element.childNodes.length) markers.push(new Marker({element}).setLngLat(point).addTo(map));
        if (feature.kind==='line' && feature.geometry.type==='LineString' && feature.style?.lineEnd==='arrow') {
          const coords=feature.geometry.coordinates, end=coords.at(-1)!, previous=[...coords.slice(0,-1)].reverse().find(p=>p[0]!==end[0]||p[1]!==end[1]);
          if (previous) { const a=MercatorCoordinate.fromLngLat(previous),b=MercatorCoordinate.fromLngLat(end); const arrow=document.createElement('span');arrow.className='annotation-line-arrow';arrow.style.borderBottomColor=feature.style.color || '#416858';markers.push(new Marker({element:arrow,rotation:Math.atan2(b.x-a.x,a.y-b.y)*180/Math.PI,rotationAlignment:'map'}).setLngLat(end).addTo(map)); }
        }
      }
    }
    }
    if (state?.fit && state.fit.key !== fitKey) {
      const points = state.fit.geometry.flatMap(geometry => geometry.type==='Point'?[geometry.coordinates]:geometry.type==='LineString'?geometry.coordinates:geometry.coordinates.flat());
      if (points.length) { const bounds=new LngLatBounds(points[0],points[0]);points.forEach(point=>bounds.extend(point));map.fitBounds(bounds,{padding:45,maxZoom:15,duration:0});fitKey=state.fit.key; }
    }
    const nextKey = JSON.stringify(state?.edit ? {...state.edit,paused:undefined} : null);
    if (editorKey === nextKey) { adapter?.setPaused(!!state?.edit?.paused); return; }
    clearEditor(); editorKey = nextKey;
    if (!state?.edit) return;
    try {
      adapter=new PausableAnnotationAdapter(map);
      const draw = new TerraDraw({adapter, modes:[new TerraDrawPointMode(),new TerraDrawLineStringMode(),new TerraDrawPolygonMode(),new TerraDrawSelectMode({keyEvents:{delete:null,deselect:'Escape',rotate:null,scale:null},flags:{point:{feature:{draggable:true}},linestring:{feature:{draggable:true,coordinates:{draggable:true,midpoints:true,deletable:true}}},polygon:{feature:{draggable:true,coordinates:{draggable:true,midpoints:true,deletable:true}}}}})]});
      editor=draw;draw.start();
      if (state.edit.feature) { const feature=state.edit.feature; const mode=feature.geometry.type==='Point'?'point':feature.geometry.type==='LineString'?'linestring':'polygon'; const results=draw.addFeatures([{type:'Feature',id:feature.objectId,geometry:feature.geometry,properties:{mode}}]); if (results.some(result=>!result.valid)) throw new Error('绘制器不支持此几何，请通过坐标表单编辑。');draw.setMode('select');draw.selectFeature(feature.objectId); }
      else draw.setMode(state.edit.mode==='text'?'point':state.edit.mode==='line'?'linestring':state.edit.mode);
      adapter.setPaused(!!state.edit.paused);
      draw.on('finish', id => { const feature=draw.getSnapshotFeature(id); if (feature) read()?.finish(feature.geometry as SituationGeometry, read()?.edit?.feature?.objectId); });
    } catch(error) { clearEditor();read()?.error(error instanceof Error?error.message:'绘制器加载失败，请使用坐标表单。'); }
  }
  return {update,destroy:()=>{disposed=true;map.off('click',click);clearEditor();cleanupLayers();},restore:()=>{clearEditor();layers=[];sources=[];rendered='';update();}};
}
