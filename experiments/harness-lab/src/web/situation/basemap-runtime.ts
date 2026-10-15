import type { Map as LibreMap, MapSourceDataEvent, ErrorEvent } from 'maplibre-gl';
import type { BasemapConfig, BasemapSourceMetadata, BasemapView } from '../../contracts/map';
import { BUSINESS_ANCHOR, roadLayers } from './basemap-style';

type Kind = 'imagery' | 'roads';
type Failure = { reason: 'timeout' | 'error'; message: string };
export interface BasemapStatus { loading: boolean; errors: string[]; notices: string[] }
export interface Viewport { west: number; east: number; south: number; north: number; zoom: number }
export function sourceNotices(source: BasemapSourceMetadata, view: Viewport): string[] {
  const [west,south,east,north]=source.bounds, span=view.east-view.west;
  const shiftedWest=((view.west+180)%360+360)%360-180;
  const intervals=[-360,0,360].map(offset=>[shiftedWest+offset,shiftedWest+span+offset]);
  const overlap=view.north>=south && view.south<=north && (span>=360 || intervals.some(([w,e])=>w<=east && e>=west));
  const contains=view.south>=south && view.north<=north && ((west===-180 && east===180) || intervals.some(([w,e])=>w>=west && e<=east));
  const notices:string[]=[];
  if (!contains) notices.push(`当前视野${overlap?'部分':''}超出 ${source.name} 覆盖范围。`);
  if (view.zoom<source.minZoom) notices.push(`${source.name} 从缩放 ${source.minZoom} 级提供数据，请放大查看。`);
  if (view.zoom>source.maxZoom) notices.push(`${source.name} 原生细节最高 ${source.maxZoom} 级；当前为放大显示。`);
  return notices;
}
export const activeBasemapKinds = (view: BasemapView): Kind[] => view==='hybrid'?['imagery','roads']:view==='road'?['roads']:['imagery'];
/** This runtime exclusively owns basemap:* IDs, below the permanent business anchor. */
export function createBasemapRuntime(map: LibreMap, report: (status: BasemapStatus)=>void) {
  let config:BasemapConfig | undefined, view:BasemapView='imagery', serial=0, signature='';
  const installed=new Map<Kind,{id:string;layers:string[]}>(), failures=new Map<Kind,Failure>();
  let timeout:ReturnType<typeof setTimeout> | undefined;
  const viewport=():Viewport=>{const b=map.getBounds();return {west:b.getWest(),east:b.getEast(),south:b.getSouth(),north:b.getNorth(),zoom:map.getZoom()};};
  const pending=(kind:Kind)=>{const source=installed.get(kind);return !!source && !!map.getSource(source.id) && !map.isSourceLoaded(source.id);};
  const publish=()=>{
    if(!config)return;
    const kinds=activeBasemapKinds(view), bounds=viewport();
    const loading=kinds.some(kind=>pending(kind)&&!failures.has(kind));
    if(!loading){clearTimeout(timeout);timeout=undefined;}
    else if(!timeout)timeout=setTimeout(()=>{timeout=undefined;if(!config)return;for(const kind of activeBasemapKinds(view))if(pending(kind)&&!failures.has(kind))failures.set(kind,{reason:'timeout',message:`${config[kind].name} 底图加载超时，业务对象与标绘仍可使用。`});publish();},15000);
    report({loading,errors:kinds.flatMap(kind=>failures.has(kind)?[failures.get(kind)!.message]:[]),notices:kinds.flatMap(kind=>sourceNotices(config![kind],bounds))});
  };
  const remove=(kind:Kind)=>{const entry=installed.get(kind);if(!entry)return;installed.delete(kind);for(const id of [...entry.layers].reverse())if(map.getLayer(id))map.removeLayer(id);if(map.getSource(entry.id))map.removeSource(entry.id);};
  const install=(kind:Kind)=>{
    if(!config || installed.has(kind))return;
    const source=config[kind],id=`basemap:${kind}:${++serial}`;
    const entry={id,layers:[] as string[]};installed.set(kind,entry);
    try {
      if(kind==='imagery') {
        map.addSource(id,{type:'raster',tiles:config.imagery.tiles,tileSize:config.imagery.tileSize,bounds:source.bounds,minzoom:source.minZoom,maxzoom:source.maxZoom,scheme:'xyz'});
        map.addLayer({id:`${id}:image`,type:'raster',source:id,paint:{'raster-fade-duration':0}},installed.get('roads')?.layers[0] || BUSINESS_ANCHOR);entry.layers.push(`${id}:image`);
      } else {
        const roads=config.roads;
        if(map.getGlyphs()!==roads.glyphs)map.setGlyphs(roads.glyphs);
        map.addSource(id,{type:'vector',...(roads.url?{url:roads.url}:{tiles:roads.tiles}),bounds:roads.bounds,minzoom:roads.minZoom,maxzoom:roads.maxZoom,scheme:'xyz'});
        for(const hybrid of [false,true])for(const layer of roadLayers(id,hybrid)) {
          layer.layout={...layer.layout,visibility:'none'};
          map.addLayer(layer,BUSINESS_ANCHOR);entry.layers.push(layer.id);
        }
      }
    } catch {failures.set(kind,{reason:'error',message:`${source.name} 底图加载失败，业务对象与标绘仍可使用。`});}
  };
  const apply=()=>{
    if(!config || !map.getLayer(BUSINESS_ANCHOR))return;
    for(const kind of activeBasemapKinds(view))install(kind);
    for(const [kind,entry] of installed)for(const id of entry.layers)if(map.getLayer(id)) {
      const visible=kind==='imagery'?view!=='road':id.includes(`:${view==='road'?'road':'hybrid'}:`)&&view!=='imagery';
      map.setLayoutProperty(id,'visibility',visible?'visible':'none');
    }
    clearTimeout(timeout);timeout=undefined;
    publish();
  };
  const data=(event:MapSourceDataEvent)=>{
    const kind=[...installed].find(([,entry])=>entry.id===event.sourceId)?.[0];
    if(!kind)return;
    // A completed source can recover from slowness, but MapLibre also considers failed requests loaded.
    if(failures.get(kind)?.reason==='timeout' && event.type==='sourcedata' && event.isSourceLoaded && !pending(kind))failures.delete(kind);
    publish();
  };
  const error=(event:ErrorEvent)=>{
    const sourceId='sourceId' in event?event.sourceId:undefined;
    const kind=[...installed].find(([,entry])=>entry.id===sourceId)?.[0];
    if(kind && config){failures.set(kind,{reason:'error',message:`${config[kind].name} 底图加载失败，业务对象与标绘仍可使用。`});publish();}
  };
  map.on('sourcedata',data);map.on('sourcedataloading',data);map.on('error',error);map.on('moveend',publish);
  return {
    update(next:BasemapConfig,nextView:BasemapView){
      const nextSignature=JSON.stringify([next.imagery,next.roads]);
      if(signature!==nextSignature){for(const kind of [...installed.keys()])remove(kind);failures.clear();signature=nextSignature;}
      config=next;view=nextView;apply();
    },
    retry(){for(const kind of activeBasemapKinds(view)){remove(kind);failures.delete(kind);}apply();},
    destroy(){clearTimeout(timeout);map.off('sourcedata',data);map.off('sourcedataloading',data);map.off('error',error);map.off('moveend',publish);for(const kind of [...installed.keys()])remove(kind);},
  };
}
