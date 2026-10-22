import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Map as LibreMap } from 'maplibre-gl';
import { expect, test } from 'vitest';
import type { PublicMessage } from '../src/contracts';
import { projectSpatialResult, type SpatialResult } from '../src/contracts/spatial';
import { spatialMapEntries, requestMapEvidence } from '../src/web/situation/evidence';
import { AnalysisPanel } from '../src/web/situation/AnalysisPanel';
import { ANALYSIS_GEOMETRY_ID, analysisGeometries, analysisReferenceId, analysisFeatures, createAnalysisRuntime, geometryPositions, type AnalysisMapState } from '../src/web/situation/analysis-runtime';
const requestId='00000000-0000-4000-8000-000000000001';
const nextRequest='00000000-0000-4000-8000-000000000002';
const result:SpatialResult={schemaVersion:1,resultRef:`spatial:${requestId}:call-1`,requestId,toolCallId:'call-1',operation:'buffer',parameters:{operation:'buffer',input:{kind:'source',systemId:'situation',objectRefs:[{systemId:'situation',objectType:'resource',objectId:'harbor'}]},distanceM:500},createdAt:'2026-10-16T01:00:00Z',scope:[{kind:'source',systemId:'situation',objectRefs:[{systemId:'situation',objectType:'resource',objectId:'harbor'}]}],completeness:{status:'complete',candidateCount:1},items:[],geometry:{type:'Polygon',coordinates:[[[120,36],[120.01,36],[120.01,36.01],[120,36.01],[120,36]]]},method:'球面局部缓冲',limitations:['近似边界'],provenance:[{input:{kind:'source',systemId:'situation'},queriedAt:'2026-10-16T01:00:00Z',asOf:'2026-10-16T01:00:00Z'}]};
const message=(r=result, extra:Partial<PublicMessage>={}):PublicMessage=>({id:'call-1',role:'tool',toolName:'spatial_analyze',requestId,toolCallId:'call-1',text:JSON.stringify({format:'spatial.model-result.v1',data:projectSpatialResult(r)}),spatialResult:r,...extra});
const state=(r=result):AnalysisMapState=>({result:r,visible:true,focusRequest:1,toggle:()=>{},clear:()=>{},locate:()=>{},pick:()=>{}});
test('spatial map entries require shared validation and exact native delivery ownership',()=>{
  expect(spatialMapEntries([message(),message()])).toEqual([result]);
  for(const extra of [{role:'assistant' as const},{toolName:'annotation_read'},{isError:true},{resultMissing:true as const},{requestId:nextRequest},{toolCallId:'another'},{spatialResult:null},{text:'已完成缓冲'}])expect(spatialMapEntries([message(result,extra)])).toEqual([]);
  const read={...result,delivery:{requestId:nextRequest,toolCallId:'read-call'}};
  expect(spatialMapEntries([message(read,{requestId:nextRequest,toolCallId:'read-call'})])).toEqual([read]);
  expect(spatialMapEntries([message(read,{requestId:nextRequest,toolCallId:'wrong'})])).toEqual([]);
  expect(spatialMapEntries(requestMapEvidence({id:'answer',role:'assistant',text:'done',requestId:nextRequest},[message()]))).toEqual([]);
});
test('result panel shows exact counts, scope, units and limits even with no map available',()=>{
  const html=renderToStaticMarkup(createElement(AnalysisPanel,{state:state({...result,operation:'measure',values:{value:1234.567,unit:'m'}}),editing:true}));
  expect(html).toContain('1,234.57 m');expect(html).toContain('候选范围已完整读取');expect(html).toContain('指定 1 个对象');expect(html).toContain('近似边界');expect(html).toContain('临时结果 · 只读');expect(html).toContain('绘制期间保留视角');expect(html).not.toContain('coordinates');
});
test('analysis geometry keeps holes and all polygon components; hiding only changes local features',()=>{
  const geometry:SpatialResult['geometry']={type:'MultiPolygon',coordinates:[result.geometry!.type==='Polygon'?result.geometry!.coordinates:[],[[[121,37],[122,37],[122,38],[121,37]],[[121.2,37.2],[121.3,37.2],[121.2,37.3],[121.2,37.2]]]]};
  const current=state({...result,geometry});const original=structuredClone(current.result);
  expect(analysisFeatures(current).features[0]?.geometry).toEqual(geometry);
  expect(analysisFeatures({...current,selected:ANALYSIS_GEOMETRY_ID}).features[0]?.properties).toEqual({role:'generated',analysisId:ANALYSIS_GEOMETRY_ID,selected:true});
  expect(geometryPositions(geometry)).toHaveLength(13);
  expect(analysisFeatures({...current,visible:false}).features).toEqual([]);expect(current.result).toEqual(original);
});
test('runtime owns analysis resources only, stays below business layers and never resets the map/editor',()=>{
  const layers=[{id:'basemap:background'},{id:'business:anchor'},{id:'business:areas'},{id:'annotation:own:points'},{id:'annotation-editor'}];
  const sources=new Map<string,{data:unknown;setData:(data:unknown)=>void}>();let current=state();
  const map={getLayer:(id:string)=>layers.find(layer=>layer.id===id),getStyle:()=>({layers}),getSource:(id:string)=>sources.get(id),
    addSource:(id:string,source:{data:unknown})=>sources.set(id,{...source,setData(data:unknown){this.data=data;}}),
    addLayer:(layer:{id:string},before:string)=>layers.splice(layers.findIndex(item=>item.id===before),0,layer),
    removeLayer:(id:string)=>layers.splice(layers.findIndex(item=>item.id===id),1),removeSource:(id:string)=>sources.delete(id)};
  const runtime=createAnalysisRuntime(map as unknown as LibreMap,()=>current);runtime.update();
  expect(layers.map(layer=>layer.id)).toEqual(['basemap:background','business:anchor','analysis:fill','analysis:halo','analysis:line','analysis:reference-line','analysis:point','business:areas','annotation:own:points','annotation-editor']);
  const source=sources.get('analysis:results');current={...current,visible:false};runtime.update();expect(sources.get('analysis:results')).toBe(source);expect(source?.data).toEqual({type:'FeatureCollection',features:[]});
  current={...current,visible:true};runtime.update();expect((source?.data as {features:unknown[]}).features).toHaveLength(1);
  runtime.destroy();expect(layers.map(layer=>layer.id)).toEqual(['basemap:background','business:anchor','business:areas','annotation:own:points','annotation-editor']);expect(sources.size).toBe(0);
});

test('fixed reference geometry is separately visible and locatable without inflating matched items',()=>{
  const reference={id:'reference-line',name:'参照岸线',properties:{},geometry:{type:'LineString' as const,coordinates:[[120.02,36],[120.02,36.01]] as [number,number][]}};
  const current=state({...result,referenceItems:[reference]});
  const features=analysisFeatures(current).features;expect(features).toHaveLength(2);expect(features[1]?.properties).toMatchObject({role:'reference',analysisId:analysisReferenceId(reference.id)});
  expect(analysisGeometries({...current,focusItem:analysisReferenceId(reference.id)})).toEqual([reference.geometry]);expect(analysisGeometries(current)).toEqual([result.geometry,reference.geometry]);expect(current.result.items).toEqual([]);
  const html=renderToStaticMarkup(createElement(AnalysisPanel,{state:current}));expect(html).toContain('参考：参照岸线');expect(html).toContain('不计入结果对象');expect(html).toContain('0 个参与对象');
});

test('v2 point classification projects validated evidence, counts and each object label without changing geometry',()=>{
  const input=result.parameters.input,target=input;
  const classified:SpatialResult={...result,schemaVersion:2,operation:'classify_points',parameters:{operation:'classify_points',input,target},scope:[input,target],geometry:undefined,
    completeness:{status:'complete',candidateCount:3},items:[
      {id:'i',name:'内点',geometry:{type:'Point',coordinates:[120.005,36.005]},properties:{}},
      {id:'b',name:'边点',geometry:{type:'Point',coordinates:[120,36.005]},properties:{}},
      {id:'e',name:'外点',geometry:{type:'Point',coordinates:[120.02,36.005]},properties:{}},
    ],referenceItems:[{id:'region',name:'区域',geometry:result.geometry!,properties:{}}],
    classifications:[{itemId:'i',position:'interior'},{itemId:'b',position:'boundary'},{itemId:'e',position:'exterior'}],values:{total:3,interior:1,boundary:1,exterior:1}};
  const current=state(classified),text=JSON.stringify({format:'spatial.model-result.v2',data:projectSpatialResult(classified)});
  expect(spatialMapEntries([{...message(classified),text}])).toEqual([classified]);
  const html=renderToStaticMarkup(createElement(AnalysisPanel,{state:current}));
  expect(html).toContain('内部 1 · 边界 1 · 外部 1（共 3 个点）');
  for(const [name,position] of [['内点','内部'],['边点','边界'],['外点','外部']])expect(html).toContain(`${name}<small>${position}</small>`);
  expect(analysisFeatures(current).features.map(f=>f.geometry)).toEqual([...classified.items.map(i=>i.geometry),classified.referenceItems![0].geometry]);
  const invalid={...classified,classifications:[]};expect(spatialMapEntries([{...message(invalid),text}])).toEqual([]);
});
