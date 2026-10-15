import { createExpression, featureFilter, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LayerSpecification, LineLayerSpecification, Map as LibreMap, SourceSpecification } from 'maplibre-gl';
import { defaultMapConfig, normalizeMapConfig } from '../src/contracts/map.js';
import { parseContextConfig } from '../src/context/config.js';
import { BUSINESS_ANCHOR, roadLayers } from '../src/web/situation/basemap-style.js';
import { createBasemapRuntime, sourceNotices, type BasemapStatus } from '../src/web/situation/basemap-runtime.js';

const parse=(map:unknown)=>parseContextConfig({systems:[],scopes:[],map}).map;
afterEach(()=>vi.useRealTimers());
describe('public map configuration',()=>{
  it('roundtrips defaults and regional OMT XYZ sources without altering coordinates',()=>{
    expect(parse(defaultMapConfig)).toEqual(defaultMapConfig);
    const regional=structuredClone(defaultMapConfig);delete regional.roads.url;
    regional.roads.tiles=['https://tiles.example.com/qingdao/{z}/{x}/{y}.pbf'];regional.roads.bounds=[119,35,121,37];regional.defaultView='road';
    expect(parse(regional)).toEqual(regional);
  });
  it('preserves legacy raster settings while supplying optional road and hybrid views',()=>{
    const old={providerId:'legacy',tiles:['https://tiles.example.com/{z}/{x}/{y}.png'],tileSize:256,attributionText:'Example',attributionUrl:'https://example.com/'};
    expect(parse(old)).toEqual(old);
    expect(normalizeMapConfig(old).imagery).toMatchObject({tiles:old.tiles,providerId:'legacy',attributions:[{text:'Example',url:'https://example.com/'}]});
  });
  it('preserves credit-link fragments in legacy and current configs while rejecting endpoint fragments',()=>{
    const old={providerId:'legacy',tiles:['https://tiles.example.com/{z}/{x}/{y}.png'],tileSize:256,attributionText:'Example',attributionUrl:'https://example.com/#credits'};
    expect(parse(old)).toEqual(old);
    const current=structuredClone(defaultMapConfig);
    current.imagery.attributions[0].url='https://example.com/#imagery';
    current.roads.attributions[0].url='https://example.com/#roads';
    expect(parse(current)).toEqual(current);
    expect(()=>parse({...old,tiles:[`${old.tiles[0]}#tile`]})).toThrow();
    expect(()=>parse({...current,roads:{...current.roads,url:`${current.roads.url}#tiles`}})).toThrow();
  });
  it.each([
    {coordinateSystem:'gcj02'},{coordinateSystem:'bd09'},{scheme:'tms'},{projection:'geographic'},
    {bounds:[121,35,119,37]},{bounds:[-180,-90,180,90]},{bounds:[0,0,NaN,10]},
    {minZoom:16,maxZoom:14},{maxZoom:25},{minZoom:'0'},{tileSize:1024},
    {tiles:['javascript:alert(1)']},{tiles:['https://secret:password@example.com/{z}/{x}/{y}']},
    {attributions:[{text:'bad',url:'javascript:alert(1)'}]},
  ])('rejects invalid metadata %j',patch=>{
    expect(()=>parse({...defaultMapConfig,imagery:{...defaultMapConfig.imagery,...patch}})).toThrow();
  });
  it('rejects ambiguous vector endpoints, malformed glyph templates and extra authority fields',()=>{
    expect(()=>parse({...defaultMapConfig,roads:{...defaultMapConfig.roads,tiles:['https://example.com/{z}/{x}/{y}']}})).toThrow();
    expect(()=>parse({...defaultMapConfig,roads:{...defaultMapConfig.roads,glyphs:'https://example.com/fonts'}})).toThrow();
    expect(()=>parse({...defaultMapConfig,token:'secret'})).toThrow();
  });
});
describe('coverage and native detail feedback',()=>{
  const regional={...defaultMapConfig.roads,bounds:[119,35,121,37] as [number,number,number,number]};
  it('distinguishes full, partial and absent coverage without moving a camera',()=>{
    expect(sourceNotices(regional,{west:119.5,east:120.5,south:35.5,north:36.5,zoom:12})).toEqual([]);
    expect(sourceNotices(regional,{west:118,east:120,south:35.5,north:36.5,zoom:12}).join()).toContain('部分超出');
    expect(sourceNotices(regional,{west:150,east:152,south:-34,north:-33,zoom:12}).join()).toContain('当前视野超出');
  });
  it('accounts for wrapped longitudes and identifies overzoom and missing low zoom coverage',()=>{
    expect(sourceNotices(regional,{west:479.5,east:480.5,south:35.5,north:36.5,zoom:12})).toEqual([]);
    expect(sourceNotices(defaultMapConfig.roads,{west:170,east:190,south:-30,north:30,zoom:15}).join()).toContain('原生细节最高 14');
    expect(sourceNotices({...regional,minZoom:8},{west:119.5,east:120.5,south:35.5,north:36.5,zoom:7}).join()).toContain('请放大查看');
  });
});

function fakeMap() {
  const sources=new Map<string,SourceSpecification>(), layers=new Map<string,LayerSpecification>();
  const order:string[]=[BUSINESS_ANCHOR,'business:roads','annotation-editor:line'];
  for(const id of order)layers.set(id,{id,type:'background'});
  const listeners=new Map<string,Set<(event:never)=>void>>();let glyphs:string|null=null;
  const loaded=new Map<string,boolean>();
  const map={
    getLayer:(id:string)=>layers.get(id),getSource:(id:string)=>sources.get(id),
    addSource:(id:string,source:SourceSpecification)=>{sources.set(id,source);loaded.set(id,true);},
    removeSource:vi.fn((id:string)=>sources.delete(id)),
    addLayer:(layer:LayerSpecification,before:string)=>{layers.set(layer.id,layer);order.splice(order.indexOf(before),0,layer.id);},
    removeLayer:vi.fn((id:string)=>{layers.delete(id);order.splice(order.indexOf(id),1);}),
    setLayoutProperty:(id:string,key:string,value:never)=>{const layer=layers.get(id)!;layer.layout={...layer.layout,[key]:value};},
    getGlyphs:()=>glyphs,setGlyphs:(value:string)=>{glyphs=value;},
    isSourceLoaded:(id:string)=>loaded.get(id),getZoom:()=>12,
    getBounds:()=>({getWest:()=>120,getEast:()=>121,getSouth:()=>35,getNorth:()=>36}),
    on:(type:string,fn:(event:never)=>void)=>{const group=listeners.get(type) || new Set();group.add(fn);listeners.set(type,group);},
    off:(type:string,fn:(event:never)=>void)=>listeners.get(type)?.delete(fn),
  };
  const emit=(type:string,event:unknown)=>listeners.get(type)?.forEach(fn=>fn(event as never));
  return {map:map as unknown as LibreMap,sources,layers,order,loaded,emit};
}
it('validates both complete OMT styles, including camera expressions and symbol filters',()=>{
  for(const hybrid of [false,true])expect(validateStyleMin({version:8,glyphs:defaultMapConfig.roads.glyphs,sources:{omt:{type:'vector',url:defaultMapConfig.roads.url}},layers:roadLayers('omt',hybrid)})).toEqual([]);
});
describe('progressive hybrid road detail',()=>{
  const hybrid=roadLayers('omt',true), road=roadLayers('omt',false);
  const matching=(layers:LayerSpecification[],category:string,zoom:number,type:'line'|'symbol')=>layers.filter(layer=>
    layer.type===type && layer['source-layer']===(type==='line'?'transportation':'transportation_name') && zoom>=(layer.minzoom ?? 0) && zoom<(layer.maxzoom ?? 25) &&
    featureFilter(layer.filter,'filter').filter({zoom},{type:'LineString',properties:{class:category}}));
  it.each([
    ['minor',13,'minor'],['service',14,'service'],['track',15,'paths'],['path',15,'paths'],
  ] as const)('reveals %s at z%d without mixing categories into major roads', (category,threshold,suffix)=>{
    expect(matching(hybrid,category,threshold-0.01,'line')).toEqual([]);
    expect(matching(hybrid,category,threshold,'line').map(layer=>layer.id)).toEqual([`omt:hybrid:${suffix}-casing`,`omt:hybrid:${suffix}-lines`]);
    expect(matching(hybrid,category,20,'line').map(layer=>layer.id)).toEqual([`omt:hybrid:${suffix}-casing`,`omt:hybrid:${suffix}-lines`]);
  });
  it('keeps detailed strokes thin and below major roads, with dashed paths and no solid dash arrays',()=>{
    const widthAt=(line:LineLayerSpecification,zoom:number)=>{
      const parsed=createExpression(line.paint!['line-width'],'line-width');
      if(parsed.result==='error')throw new Error(JSON.stringify(parsed.value));
      return parsed.value.evaluate({zoom});
    };
    for(const [suffix,maxWidth] of [['minor',1.8],['service',1.4],['paths',1]] as const) {
      const line=hybrid.find((layer):layer is LineLayerSpecification=>layer.type==='line' && layer.id===`omt:hybrid:${suffix}-lines`)!;
      const casing=hybrid.find((layer):layer is LineLayerSpecification=>layer.type==='line' && layer.id===`omt:hybrid:${suffix}-casing`)!;
      for(const zoom of [13,14,15,16,18,22]) {
        expect(widthAt(line,zoom)).toBeGreaterThan(0);
        expect(widthAt(line,zoom)).toBeLessThanOrEqual(maxWidth);
        expect(widthAt(casing,zoom)).toBeGreaterThan(widthAt(line,zoom));
        expect(widthAt(casing,zoom)).toBeLessThan(3);
      }
      expect(line.paint!['line-opacity']).toBeLessThanOrEqual(0.55);
      expect(casing.paint!['line-opacity']).toBeLessThan(line.paint!['line-opacity'] as number);
      expect(line.paint!['line-dasharray']).toEqual(suffix==='paths'?[2,3]:undefined);
      expect(casing.paint!['line-dasharray']).toEqual(suffix==='paths'?[2,3]:undefined);
      expect(hybrid.indexOf(line)).toBeLessThan(hybrid.findIndex(layer=>layer.id==='omt:hybrid:road-casing'));
    }
  });
  it('reveals sparse minor and service names later while omitting track/path names',()=>{
    for(const [category,threshold] of [['minor',15],['service',16]] as const) {
      expect(matching(hybrid,category,threshold-0.01,'symbol')).toEqual([]);
      const labels=matching(hybrid,category,threshold,'symbol');
      expect(labels.map(layer=>layer.id)).toEqual([`omt:hybrid:${category}-label`]);
      expect(labels[0].layout).toMatchObject({'text-allow-overlap':false,'symbol-spacing':500,'text-padding':20});
    }
    expect(matching(hybrid,'path',20,'symbol')).toEqual([]);
    expect(matching(hybrid,'track',20,'symbol')).toEqual([]);
  });
  it('retains the road-view hierarchy and existing major hybrid roads',()=>{
    expect(road.map(layer=>layer.id)).toEqual(['background','landuse','park','water','waterway','building','road-casing','road-lines','road-label','place-label'].map(id=>`omt:road:${id}`));
    for(const category of ['motorway','trunk','primary','secondary','tertiary','minor','service','track','path'])
      expect(matching(road,category,12,'line').map(layer=>layer.id)).toEqual(['omt:road:road-casing','omt:road:road-lines']);
    for(const category of ['motorway','trunk','primary','secondary','tertiary'])
      expect(matching(hybrid,category,12,'line').map(layer=>layer.id)).toEqual(['omt:hybrid:road-casing','omt:hybrid:road-lines']);
    expect(matching(hybrid,'rail',20,'line')).toEqual([]);
  });
});
describe('basemap isolation',()=>{
  it('lazily loads vectors and retains source/editor identities across rapid switches',()=>{
    const f=fakeMap(), report=vi.fn(),runtime=createBasemapRuntime(f.map,report);
    runtime.update(defaultMapConfig,'imagery');expect(f.sources.size).toBe(1);
    const imagery=[...f.sources.keys()][0];
    for(const view of ['road','hybrid','imagery','hybrid'] as const)runtime.update(defaultMapConfig,view);
    expect(f.sources.size).toBe(2);expect(f.sources.has(imagery)).toBe(true);expect(f.map.removeSource).not.toHaveBeenCalled();
    expect(f.order.slice(-3)).toEqual([BUSINESS_ANCHOR,'business:roads','annotation-editor:line']);
    const visible=[...f.layers.values()].filter(layer=>layer.layout?.visibility==='visible').map(layer=>layer.id);
    expect(visible.some(id=>id.includes(':hybrid:'))).toBe(true);expect(visible.some(id=>id.includes(':road:'))).toBe(false);
    runtime.destroy();expect(f.order).toEqual([BUSINESS_ANCHOR,'business:roads','annotation-editor:line']);
  });
  it('places imagery under existing vector overlays when road was the initial preference',()=>{
    const f=fakeMap(),runtime=createBasemapRuntime(f.map,vi.fn());runtime.update(defaultMapConfig,'road');runtime.update(defaultMapConfig,'hybrid');
    expect(f.order[0]).toContain('basemap:imagery:');expect(f.order[1]).toContain('basemap:roads:');runtime.destroy();
  });
  it('scopes errors to current sources and ignores late retry/config errors',()=>{
    const f=fakeMap(),report=vi.fn<(status:BasemapStatus)=>void>(),runtime=createBasemapRuntime(f.map,report);
    runtime.update(defaultMapConfig,'hybrid');const old=[...f.sources.keys()][0];
    f.emit('error',{sourceId:old,error:new Error('offline')});expect(report.mock.lastCall![0].errors).toHaveLength(1);
    runtime.retry();f.emit('error',{sourceId:old,error:new Error('late')});expect(report.mock.lastCall![0].errors).toEqual([]);
    const second=[...f.sources.keys()][0];runtime.update({...defaultMapConfig,imagery:{...defaultMapConfig.imagery,providerId:'regional'}},'imagery');
    f.emit('error',{sourceId:second,error:new Error('late config')});expect(report.mock.lastCall![0].errors).toEqual([]);
    expect(f.layers.has('annotation-editor:line')).toBe(true);runtime.destroy();
  });
  it('times out tile requests after a later pan without touching editor layers',()=>{
    vi.useFakeTimers();const f=fakeMap(),report=vi.fn<(status:BasemapStatus)=>void>(),runtime=createBasemapRuntime(f.map,report);
    runtime.update(defaultMapConfig,'imagery');vi.advanceTimersByTime(16000);
    const id=[...f.sources.keys()][0];f.loaded.set(id,false);f.emit('sourcedataloading',{sourceId:id});
    expect(report.mock.lastCall![0].loading).toBe(true);vi.advanceTimersByTime(15001);
    expect(report.mock.lastCall![0].errors.join()).toContain('加载超时');expect(f.layers.has('annotation-editor:line')).toBe(true);runtime.destroy();
  });
  it('clears a slow source timeout only when the current generation finishes loading',()=>{
    vi.useFakeTimers();const f=fakeMap(),report=vi.fn<(status:BasemapStatus)=>void>(),runtime=createBasemapRuntime(f.map,report);
    runtime.update(defaultMapConfig,'road');const old=[...f.sources.keys()][0];
    runtime.retry();const current=[...f.sources.keys()][0];
    f.loaded.set(current,false);f.emit('sourcedataloading',{sourceId:current});vi.advanceTimersByTime(15001);
    expect(report.mock.lastCall![0].errors.join()).toContain('加载超时');
    f.emit('sourcedata',{type:'sourcedata',sourceId:old,isSourceLoaded:true});
    f.emit('sourcedata',{type:'sourcedata',sourceId:current,isSourceLoaded:false});
    f.emit('sourcedata',{type:'sourcedata',sourceId:current,isSourceLoaded:true});
    expect(report.mock.lastCall![0].errors.join()).toContain('加载超时');
    f.loaded.set(current,true);
    f.emit('sourcedata',{type:'sourcedata',sourceId:current,isSourceLoaded:true});
    expect(report.mock.lastCall![0]).toMatchObject({loading:false,errors:[]});
    expect([...f.sources.keys()]).toEqual([current]);expect(f.layers.has('annotation-editor:line')).toBe(true);
    runtime.destroy();
  });
  it('does not replace explicit HTTP errors with a sibling timeout or clear them on loaded events',()=>{
    vi.useFakeTimers();const f=fakeMap(),report=vi.fn<(status:BasemapStatus)=>void>(),runtime=createBasemapRuntime(f.map,report);
    runtime.update(defaultMapConfig,'hybrid');const [imagery,roads]=[...f.sources.keys()];
    for(const id of [imagery,roads]){f.loaded.set(id,false);f.emit('sourcedataloading',{sourceId:id});}
    f.emit('error',{sourceId:imagery,error:new Error('HTTP 503')});vi.advanceTimersByTime(15001);
    expect(report.mock.lastCall![0].errors).toEqual([expect.stringContaining('加载失败'),expect.stringContaining('加载超时')]);
    for(const id of [imagery,roads]){f.loaded.set(id,true);f.emit('sourcedata',{type:'sourcedata',sourceId:id,isSourceLoaded:true});}
    expect(report.mock.lastCall![0].errors).toEqual([expect.stringContaining('加载失败')]);
    runtime.retry();expect(report.mock.lastCall![0].errors).toEqual([]);
    f.emit('error',{sourceId:imagery,error:new Error('late HTTP error')});
    expect(report.mock.lastCall![0].errors).toEqual([]);expect(f.layers.has('annotation-editor:line')).toBe(true);
    runtime.destroy();
  });
});
