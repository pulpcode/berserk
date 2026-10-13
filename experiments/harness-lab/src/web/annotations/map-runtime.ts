import { LngLatBounds, Marker, type Map as LibreMap } from 'maplibre-gl';
import { TerraDraw, TerraDrawLineStringMode, TerraDrawPointMode, TerraDrawPolygonMode, TerraDrawSelectMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import type { AnnotationFeature, AnnotationVersion } from '../../contracts/annotations';
import type { SituationGeometry } from '../../contracts/context';

export interface AnnotationMapGroup { key: string; version: AnnotationVersion; visibleLayers: string[] }
export interface AnnotationMapEdit { mode: 'point' | 'line' | 'polygon' | 'text' | 'select'; feature?: AnnotationFeature }
export interface AnnotationMapState {
  groups: AnnotationMapGroup[]; fit?: { key: string; geometry: SituationGeometry[] };
  edit?: AnnotationMapEdit; pick: (keys: Array<{group: string; layerId: string; objectId: string}>) => void;
  finish: (geometry: SituationGeometry, objectId?: string) => void; error: (message: string) => void;
}
export function createAnnotationRuntime(map: LibreMap, read: () => AnnotationMapState | undefined) {
  let layers: string[] = []; let sources: string[] = []; let markers: Marker[] = []; let fitKey = ''; let editorKey = ''; let editor: TerraDraw | undefined;
  const cleanupLayers = () => { markers.forEach(marker => marker.remove()); markers = []; for (const id of [...layers].reverse()) if (map.getLayer(id)) map.removeLayer(id); for (const id of sources) if (map.getSource(id)) map.removeSource(id); layers = []; sources = []; };
  const clearEditor = () => { if (editor?.enabled) editor.stop(); editor = undefined; editorKey = ''; };
  const click = (event: {point: {x: number; y: number}}) => {
    if (read()?.edit) return;
    const available = layers.filter(id => map.getLayer(id)); if (!available.length) return;
    const found = map.queryRenderedFeatures([event.point.x,event.point.y], { layers: available });
    const keys = new Map<string, {group: string; layerId: string; objectId: string}>();
    for (const item of found) if (item.properties?.objectId) { const {group, layerId, objectId} = item.properties; keys.set(JSON.stringify([group,layerId,objectId]), {group,layerId,objectId}); }
    if (keys.size) read()?.pick([...keys.values()]);
  };
  map.on('click', click);
  function update() {
    // GeoJSON sources can still be loading after the style is ready.
    if (!map.getLayer('basemap')) return;
    const state = read(); cleanupLayers();
    for (const group of state?.groups || []) for (const layer of [...group.version.document.layers].sort((a,b) => a.order-b.order)) {
      if (!group.visibleLayers.includes(layer.layerId)) continue;
      const id = `annotation:${encodeURIComponent(group.key)}:${encodeURIComponent(layer.layerId)}`;
      const features = layer.features.map(feature => ({ type: 'Feature' as const, geometry: feature.geometry, properties: {group: group.key, layerId: layer.layerId, objectId: feature.objectId, color: feature.style?.color || '#416858', fill: feature.style?.fillColor || feature.style?.color || '#416858', opacity: feature.style?.opacity ?? 0.35, width: feature.style?.width ?? 3, size: feature.style?.size ?? 7, lineStyle: feature.style?.lineStyle || 'solid'} }));
      map.addSource(id, {type: 'geojson', data: {type: 'FeatureCollection', features}}); sources.push(id);
      map.addLayer({id: `${id}:fill`, type:'fill', source:id, filter:['==',['geometry-type'],'Polygon'], paint:{'fill-color':['get','fill'],'fill-opacity':['get','opacity']}}); layers.push(`${id}:fill`);
      for (const [style,dash] of [['solid',[1,0]],['dashed',[3,2]],['dotted',[1,2]]] as const) {
        const line = `${id}:${style}`; map.addLayer({id:line,type:'line',source:id,filter:['all',['!=',['geometry-type'],'Point'],['==',['get','lineStyle'],style]],paint:{'line-color':['get','color'],'line-width':['get','width'],'line-dasharray':[...dash]}}); layers.push(line);
      }
      map.addLayer({id:`${id}:point`,type:'circle',source:id,filter:['==',['geometry-type'],'Point'],paint:{'circle-color':['get','color'],'circle-radius':['get','size'],'circle-opacity':0}}); layers.push(`${id}:point`);
      for (const feature of layer.features) {
        const point = feature.geometry.type === 'Point' ? feature.geometry.coordinates : feature.geometry.type==='LineString'?feature.geometry.coordinates[0]:feature.geometry.coordinates[0]?.[0];
        const label = feature.style?.label || (feature.kind === 'text' ? feature.name : '');
        if (!point) continue;
        const element = document.createElement('div'); element.className = 'annotation-marker'; element.style.pointerEvents='none';
        if (feature.kind === 'point') { const shape=document.createElement('span');shape.className=`annotation-symbol ${feature.style?.symbol || 'circle'}`; shape.style.background=feature.style?.color || '#416858'; const size=(feature.style?.size ?? 7)*2;shape.style.width=`${size}px`;shape.style.height=`${size}px`;element.append(shape); }
        if (label) { const text=document.createElement('span');text.className='annotation-label';text.textContent=label;text.style.color=feature.style?.color || '#416858';element.append(text); }
        markers.push(new Marker({element}).setLngLat(point).addTo(map));
      }
    }
    if (state?.fit && state.fit.key !== fitKey) {
      const points = state.fit.geometry.flatMap(geometry => geometry.type==='Point'?[geometry.coordinates]:geometry.type==='LineString'?geometry.coordinates:geometry.coordinates.flat());
      if (points.length) { const bounds=new LngLatBounds(points[0],points[0]);points.forEach(point=>bounds.extend(point));map.fitBounds(bounds,{padding:45,maxZoom:15,duration:0});fitKey=state.fit.key; }
    }
    const nextKey = JSON.stringify(state?.edit || null);
    if (editorKey === nextKey) return;
    clearEditor(); editorKey = nextKey;
    if (!state?.edit) return;
    try {
      const draw = new TerraDraw({adapter: new TerraDrawMapLibreGLAdapter({map, prefixId:'annotation-editor'}), modes:[new TerraDrawPointMode(),new TerraDrawLineStringMode(),new TerraDrawPolygonMode(),new TerraDrawSelectMode({keyEvents:{delete:null,deselect:'Escape',rotate:null,scale:null},flags:{point:{feature:{draggable:true}},linestring:{feature:{draggable:true,coordinates:{draggable:true,midpoints:true,deletable:true}}},polygon:{feature:{draggable:true,coordinates:{draggable:true,midpoints:true,deletable:true}}}}})]});
      editor=draw;draw.start();
      if (state.edit.feature) { const feature=state.edit.feature; const mode=feature.geometry.type==='Point'?'point':feature.geometry.type==='LineString'?'linestring':'polygon'; const results=draw.addFeatures([{type:'Feature',id:feature.objectId,geometry:feature.geometry,properties:{mode}}]); if (results.some(result=>!result.valid)) throw new Error('绘制器不支持此几何，请通过坐标表单编辑。');draw.setMode('select');draw.selectFeature(feature.objectId); }
      else draw.setMode(state.edit.mode==='text'?'point':state.edit.mode==='line'?'linestring':state.edit.mode);
      draw.on('finish', id => { const feature=draw.getSnapshotFeature(id); if (feature) read()?.finish(feature.geometry as SituationGeometry, read()?.edit?.feature?.objectId); });
    } catch(error) { clearEditor();read()?.error(error instanceof Error?error.message:'绘制器加载失败，请使用坐标表单。'); }
  }
  return {update,destroy:()=>{map.off('click',click);clearEditor();cleanupLayers();},restore:()=>{clearEditor();layers=[];sources=[];update();}};
}
