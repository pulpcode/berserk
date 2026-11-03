import { test, expect } from '@playwright/test';
import type { Map, GeoJSONSource } from 'maplibre-gl';
declare global { interface Window { rendererTest: {map:Map;errors:string[];picked:Array<{objectId:string}>}; symbolFailure: {failed:string[];registered:boolean} } }

test('professional renderer keeps 500 overlapping objects selectable and heading stable on camera rotation', async ({page}) => {
  await page.route('http://127.0.0.1:*/', route => route.fulfill({contentType:'text/html',body:'<!doctype html><html><head></head><body><div id="map" style="width:1000px;height:700px"></div></body></html>'}));
  await page.goto('/');
  await page.addStyleTag({url:'/node_modules/maplibre-gl/dist/maplibre-gl.css'});
  await page.addScriptTag({type:'module',content:`
    import * as maplibregl from '/node_modules/maplibre-gl/dist/maplibre-gl.mjs';
    import { createAnnotationRuntime } from '/src/web/annotations/map-runtime.ts';
    import { ensureMapSymbols } from '/src/web/map-symbols/index.ts';
    const map = new maplibregl.Map({container:'map',center:[116.4,39.9],zoom:13,bearing:35,attributionControl:false,style:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e2e8e5'}},{id:'business:anchor',type:'background',paint:{'background-opacity':0}}]}});
    const features = Array.from({length:500},(_,i)=>({objectId:'resource-'+i,kind:'point',name:'部署 '+i,informationRole:'plan',geometry:{type:'Point',coordinates:i<2?[116.4,39.9]:[116.388+(i%20)*0.0012,39.892+Math.floor(i/20)*0.00064]},style:{symbolId:i%2?'app.rescue-inflatable-boat':'xf3013-2020.6.2.1',iconSize:32,heading:0}}));
    const errors=[]; let picked=[];
    const state={groups:[{key:'own',visibleLayers:['deployment'],version:{ref:{documentId:'doc',revision:1},title:'部署',hash:'test',createdAt:'2026-10-25T00:00:00Z',document:{schemaVersion:1,title:'部署',layers:[{layerId:'deployment',name:'部署',order:0,defaultVisible:true,features}]}}}],pick:keys=>picked=keys,finish:()=>{},error:message=>errors.push(message)};
    map.once('load',async()=>{await ensureMapSymbols(map);const runtime=createAnnotationRuntime(map,()=>state);runtime.update();window.rendererTest={map,runtime,state,errors,get picked(){return picked;}};});
  `});
  await expect.poll(()=>page.evaluate(()=>Boolean(window.rendererTest))).toBe(true);
  await expect.poll(()=>page.evaluate(()=>{
    const {map}=window.rendererTest;
    return map.queryRenderedFeatures({layers:['annotation:own:deployment:symbols:heading']}).length;
  })).toBeGreaterThanOrEqual(500);
  const center=await page.evaluate(()=>{const p=window.rendererTest.map.project([116.4,39.9]); const box=window.rendererTest.map.getContainer().getBoundingClientRect();return {x:p.x+box.left,y:p.y+box.top};});
  await page.mouse.click(center.x,center.y);
  const snapshot=await page.evaluate(()=>{
    const state=window.rendererTest;
    const source=state.map.getSource('annotation:own:deployment') as GeoJSONSource;
    return {count:(source.serialize().data as {features:unknown[]}).features.length, picked:state.picked.map(item=>item.objectId),errors:state.errors};
  });
  expect(snapshot.count).toBe(500);
  expect(snapshot.picked).toEqual(expect.arrayContaining(['resource-0','resource-1']));
  expect(snapshot.errors).toEqual([]);
  await page.evaluate(()=>{
    const {map}=window.rendererTest;
    map.setBearing(115);
  });
  const orientation=await page.evaluate(()=>{
    const {map}=window.rendererTest;
    const feature=map.queryRenderedFeatures({layers:['annotation:own:deployment:symbols:heading']})[0];
    return {rotation:feature?.properties.rotation,alignment:map.getLayoutProperty('annotation:own:deployment:symbols:heading','icon-rotation-alignment'),bearing:map.getBearing()};
  });
  expect(orientation).toMatchObject({rotation:270,alignment:'map'});
  expect(orientation.bearing).toBeCloseTo(115,8);
  await page.screenshot({path:test.info().outputPath('professional-500.png')});
});

test('a missing controlled asset registers a neutral image and reports the failed catalog ID', async ({page}) => {
  await page.route('http://127.0.0.1:*/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="map" style="width:700px;height:500px"></div>'}));
  await page.route('**/assets/xf3013-2020.6.2.1.svg?import&url',route=>route.fulfill({contentType:'application/javascript',body:'export default "/missing-controlled-symbol.svg"'}));
  await page.route('**/missing-controlled-symbol.svg',route=>route.abort());
  await page.goto('/');
  await page.addScriptTag({type:'module',content:`
    import * as maplibregl from '/node_modules/maplibre-gl/dist/maplibre-gl.mjs';
    import {ensureMapSymbols,symbolImageId} from '/src/web/map-symbols/index.ts';
    const map=new maplibregl.Map({container:'map',attributionControl:false,style:{version:8,sources:{},layers:[]}});
    map.once('load',async()=>{const failed=await ensureMapSymbols(map);window.symbolFailure={failed,registered:map.hasImage(symbolImageId('xf3013-2020.6.2.1'))};});
  `});
  await expect.poll(()=>page.evaluate(()=>window.symbolFailure)).toEqual({failed:['xf3013-2020.6.2.1'],registered:true});
});
