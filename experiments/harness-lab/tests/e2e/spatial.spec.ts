import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import type { SpatialRequest } from '../../src/contracts/spatial';
import type { AnnotationFeature, AnnotationRef } from '../../src/contracts/annotations';
import type { Position } from '../../src/contracts/context';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';
import { basemapFixture, captureMap, localVectorTiles, mapSnapshot } from './basemap-fixtures';

test.setTimeout(60000);test.use({actionTimeout:10000});
async function setup(page:Page,coordinates:Position,options:{extra?:AnnotationFeature[];request?:(ref:AnnotationRef)=>SpatialRequest}={}){
  const dir=await mkdtemp(join(tmpdir(),'axon-spatial-web-'));const db=await openDatabase(dir);const access=new AccessStore(db);
  const userId=await access.saveAccount({username:'a',displayName:'空间验证',seatId:'a',seatName:'总体席',password:'test-password-123',createPublicTask:true,manageModelSettings:true});const actor=access.identity(userId)!;
  const task=access.create(actor,{title:'空间分析验证',goal:'核对固定分析结果',visibility:'public',clientActionId:randomUUID()});db.close();
  const config=testConfig(dir,{seatId:'a',auth:{secret:'spatial-browser-secret-at-least-thirty-two-characters',sessionMs:28800000}});
  let resultRef='';
  const fake=await fakeRuntime(config,(context,index)=>{
    for(const message of context.messages)if(message.role==='toolResult'&&message.toolName==='spatial_analyze')for(const part of message.content)if(part.type==='text'){const value=JSON.parse(part.text);if(value.format==='spatial.model-result.v1')resultRef=value.data.resultRef;}
    if(index===0)return {tools:[{name:'spatial_analyze',arguments:options.request?options.request(input):{operation:'buffer',input:{kind:'annotation',ref:input,objectIds:['harbor']},distanceM:500}}]};
    if(index===2)return {tools:[{name:'annotation_read',arguments:{mode:'draft'}}]};
    if(index===3)return {tools:[{name:'annotation_from_analysis',arguments:{resultRef,layerId:'harbors',objectId:'saved-buffer',name:'保存的500米范围'}}]};
    if(index===5)return {tools:[{name:'spatial_analyze',arguments:{operation:'read',resultRef}}]};
    return {text:index===4?'已保存同一范围，未发布。':options.request?'已完成空间测量，可在地图核对两个对象。':'已生成固定缓冲范围，可在地图核对。'};
  });
  const lab=await PiLab.create(config,fake.runtime);const app=await createApp(lab,false);
  const workspace=await lab.workspaces.ensureWorkspace(task.id,'a',task.title);const session=await lab.createSession(workspace.id,'a');const second=await lab.createSession(workspace.id,'a');
  const receipt=lab.annotations!.action(actor,session.id,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,title:'港口验证',operations:[{op:'add_layer',layer:{layerId:'harbors',name:'港口位置',order:0,defaultVisible:true,features:[{objectId:'harbor',kind:'point',name:'港口观测点',geometry:{type:'Point',coordinates}},...(options.extra || [])]}}]});const input:AnnotationRef=receipt.ref!;
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await captureMap(page);const vector=await localVectorTiles(page);
  await page.route('**/basemap-fonts/**',route=>route.fulfill({status:404,body:''}));
  const raster=await readFile(new URL('../fixtures/basemap-raster.png',import.meta.url));
  await page.route('**/test-tiles/**',route=>route.fulfill({contentType:'image/png',body:raster}));
  await page.route('**/api/**',async route=>{const req=route.request();const url=new URL(req.url());
    if(url.pathname==='/api/context/map-config')return route.fulfill({json:basemapFixture(url.origin)});
    const response=await app.inject({method:req.method() as 'GET'|'POST'|'PUT'|'DELETE',url:url.pathname+url.search,headers:{...req.headers(),host:'127.0.0.1',origin:'http://localhost:4310'},...(req.postDataBuffer()?{payload:req.postDataBuffer()!}:{})});
    await route.fulfill({status:response.statusCode,headers:Object.fromEntries(Object.entries(response.headers).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)])),body:response.rawPayload});
  });
  await page.goto('/');await page.getByLabel('席位',{exact:true}).selectOption('a');await page.getByLabel('密码',{exact:true}).fill('test-password-123');await page.getByRole('button',{name:'登录',exact:true}).click();
  await expect(page.getByRole('button',{name:'进入项目：空间分析验证'})).toBeVisible();const loaded=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/sessions/${session.id}`&&response.request().method()==='GET'&&response.status()===200);await page.goto(`/?session=${session.id}`);await loaded;await expect(page.getByRole('combobox',{name:'选择模型',exact:true})).toBeEnabled();
  return {lab,actor,session,second,vector,errors,close:async()=>{page.on('dialog',dialog=>dialog.accept());if(!page.isClosed()){await page.goto('about:blank');await page.unrouteAll({behavior:'ignoreErrors'});}await app.close();await rm(dir,{recursive:true,force:true});}};
}
for(const location of [{name:'中国青岛港',coordinates:[120.31,36.04] as Position},{name:'澳大利亚悉尼港',coordinates:[151.22,-33.86] as Position}])test(`${location.name}: native spatial result survives three basemaps, failure and unfinished drawing`,async({page})=>{
  const env=await setup(page,location.coordinates);
  try{
    await page.getByRole('textbox',{name:'发送消息',exact:true}).fill('生成港口观测点周边 500 米的范围，不保存。');await page.getByRole('button',{name:'发送消息',exact:true}).click();
    const entry=page.getByRole('button',{name:/缓冲范围 ·/}).last();await expect(entry).toBeVisible();await entry.click();
    const panel=page.getByRole('region',{name:'空间分析结果'});await expect(panel).toBeVisible();await expect(panel).toContainText('临时结果 · 只读');await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>Boolean(window.__basemapTestMap?.getSource('analysis:results')))).toBe(true);
    const resultData=await page.evaluate(()=>window.__basemapTestMap!.getStyle().sources['analysis:results']);await expectAnalysisPositionsVisible(page,[location.coordinates]);const before=await mapSnapshot(page);
    await panel.getByRole('button',{name:'隐藏分析',exact:true}).click();await expect.poll(()=>page.evaluate(()=>JSON.stringify(window.__basemapTestMap!.getStyle().sources['analysis:results']))).toContain('"features":[]');await panel.getByRole('button',{name:'显示分析',exact:true}).click();
    await page.getByRole('button',{name:'关闭图层与对象',exact:true}).click();
    // The first vector load fails while analysis and annotation geometry stay intact.
    env.vector.offline();await page.getByRole('button',{name:'路网',exact:true}).click();await expect(page.getByRole('button',{name:'重试底图',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>window.__basemapTestMap!.getStyle().sources['analysis:results'])).toEqual(resultData);
    env.vector.online();await page.getByRole('button',{name:'重试底图',exact:true}).click();await expect(page.getByRole('button',{name:'重试底图',exact:true})).not.toBeVisible();
    for(const view of ['影像','路网','混合']){await page.getByRole('button',{name:view,exact:true}).click();await expect(page.getByRole('button',{name:view,exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('button',{name:'重试底图',exact:true})).not.toBeVisible();expect(await mapSnapshot(page)).toEqual(before);expect(await page.evaluate(()=>window.__basemapTestMap!.getStyle().sources['analysis:results'])).toEqual(resultData);await page.screenshot({path:test.info().outputPath(`${location.name}-${view}.png`)});}
    await page.getByRole('button',{name:'绘制线',exact:true}).click();const canvas=page.locator('.maplibregl-canvas');const box=(await canvas.boundingBox())!;const x=box.x+box.width/2,y=box.y+box.height/2;await page.mouse.click(x-60,y-30);
    for(const view of ['路网','影像','混合','影像'])await page.getByRole('button',{name:view,exact:true}).click();
    await entry.click();await expect(panel.getByRole('button',{name:'定位分析',exact:true})).toBeDisabled();expect(await mapSnapshot(page)).toEqual(before);
    await page.getByRole('button',{name:'关闭图层与对象',exact:true}).click();await page.mouse.click(x+30,y+10);await page.mouse.dblclick(x+80,y+30);await expect(page.locator('.annotation-heading')).toContainText('草稿 r2');
    const binding=env.lab.annotations!.binding(env.actor,env.session.id);const savedDocument=env.lab.annotations!.privateVersion(env.actor,binding.draft!.setId,2).document;expect(savedDocument.layers[0]!.features[0]!.geometry).toEqual({type:'Point',coordinates:location.coordinates});expect(savedDocument.layers[0]!.features[1]!.geometry.type).toBe('LineString');
    if(!await panel.isVisible())await page.getByRole('button',{name:'图层与对象',exact:true}).click();await expect(panel).toBeVisible();await panel.getByRole('button',{name:'清除临时显示',exact:true}).click();await expect(panel).toHaveCount(0);await entry.click();await expect(panel).toBeVisible();
    await page.setViewportSize({width:1280,height:800});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath(`${location.name}-narrow-panel.png`)});
    await page.goto(`/?session=${env.second.id}`);await page.getByRole('button',{name:'打开态势地图',exact:true}).click();await expect(page.getByRole('region',{name:'空间分析结果'})).toHaveCount(0);expect(env.errors).toEqual([]);
  }finally{await env.close();}
});

test('native save preserves preview geometry and read delivery reopens the original fixed result',async({page})=>{
  const env=await setup(page,[120.31,36.04]);
  const send=async(text:string)=>{await page.getByRole('textbox',{name:'发送消息',exact:true}).fill(text);await page.getByRole('button',{name:'发送消息',exact:true}).click();};
  try{
    await send('生成港口观测点周边 500 米范围，不保存。');await expect(page.getByRole('button',{name:/缓冲范围 ·/}).last()).toBeVisible();
    const original=env.lab.get(env.session.id,'a').messages.find(message=>message.spatialResult)?.spatialResult;if(!original)throw new Error('Missing verified spatial result');expect(original.geometry?.type).toBe('Polygon');
    await send('把刚才的同一范围保存到港口位置图层，不发布。');await expect(page.getByRole('button',{name:/查看本次标注/}).last()).toBeVisible();
    const binding=env.lab.annotations!.binding(env.actor,env.session.id);const saved=env.lab.annotations!.privateVersion(env.actor,binding.draft!.setId,binding.draft!.headRevision).document.layers[0]!.features.find(feature=>feature.objectId==='saved-buffer');expect(saved?.geometry).toEqual(original.geometry);expect(binding.draft!.headRevision).toBe(2);
    await page.getByRole('button',{name:/查看本次标注/}).last().click();await expect(page.getByRole('region',{name:'标注对象操作'})).toContainText('保存的500米范围');await expect(page.getByRole('region',{name:'标注对象操作'})).toContainText('只读参考');
    await page.getByRole('button',{name:'关闭态势地图',exact:true}).click();await page.reload();await expect(page.getByRole('button',{name:/缓冲范围 ·/}).last()).toBeVisible();
    await send('读取刚才分析的固定结果。');await expect.poll(()=>env.lab.get(env.session.id,'a').messages.filter(message=>message.spatialResult?.delivery).length).toBe(1);
    await page.getByRole('button',{name:/缓冲范围 ·/}).last().click();await expect(page.getByRole('region',{name:'空间分析结果'})).toContainText('缓冲距离 500 m');
    const read=env.lab.get(env.session.id,'a').messages.find(message=>message.spatialResult?.delivery)!;expect(read.spatialResult!.resultRef).toBe(original.resultRef);expect(read.spatialResult!.geometry).toEqual(original.geometry);expect(read.spatialResult!.delivery?.requestId).toBe(read.requestId);
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();await expect.poll(()=>page.evaluate(()=>Boolean(window.__basemapTestMap?.getSource('analysis:results')))).toBe(true);await page.getByRole('button',{name:'关闭图层与对象',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__basemapTestMap!.queryRenderedFeatures({layers:['analysis:fill']}).length)).toBeGreaterThan(0);await page.screenshot({path:test.info().outputPath('saved-and-read-analysis.png')});expect(env.errors).toEqual([]);
  }finally{await env.close();}
});

test('without WebGL the same verified analysis remains readable in the object panel',async({page})=>{
  await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,type,...args){if(String(type).includes('webgl'))return null;return original.call(this,type,...args);} as typeof original;});
  const env=await setup(page,[151.22,-33.86]);
  try{
    await page.getByRole('textbox',{name:'发送消息',exact:true}).fill('生成港口观测点周边500米范围。');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByRole('button',{name:/缓冲范围 ·/}).last().click();
    await expect(page.getByText('地图暂不可用，请通过图层与对象查看与引用。')).toBeVisible();const panel=page.getByRole('region',{name:'空间分析结果'});await expect(panel).toContainText('缓冲距离 500 m');await expect(panel.getByRole('button',{name:'港口观测点',exact:true})).toBeVisible();await panel.getByText('范围与计算依据',{exact:true}).click();await expect(panel).toContainText('固定标绘 修订 r1');expect(env.errors).toEqual([]);
  }finally{await env.close();}
});

for(const metric of ['distance','point_to_line'] as const)test(`measurement ${metric} renders both fixed input and reference geometry`,async({page})=>{
  const target:AnnotationFeature=metric==='distance'?{objectId:'reference',name:'参照对象',kind:'point',geometry:{type:'Point',coordinates:[120.32,36.04]}}:{objectId:'reference',name:'参照对象',kind:'line',geometry:{type:'LineString',coordinates:[[120.32,36.035],[120.32,36.045]]}};
  const env=await setup(page,[120.31,36.04],{extra:[target],request:ref=>({operation:'measure',metric,input:{kind:'annotation',ref,objectIds:['harbor']},target:{kind:'annotation',ref,objectIds:['reference']}})});
  try{
    await page.getByRole('textbox',{name:'发送消息',exact:true}).fill('测量港口观测点到参照对象的地理距离。');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByRole('button',{name:/空间测量 ·/}).last().click();
    const panel=page.getByRole('region',{name:'空间分析结果'});await expect(panel.getByRole('region',{name:'分析参考对象'})).toContainText('不计入结果对象');
    const result=env.lab.get(env.session.id,'a').messages.find(message=>message.spatialResult)?.spatialResult;if(!result)throw new Error('Missing verified measure');expect(result.items).toHaveLength(1);expect(result.referenceItems).toHaveLength(1);expect(result.referenceItems![0]!.geometry).toEqual(target.geometry);
    await expect.poll(()=>page.evaluate(()=>Boolean(window.__basemapTestMap?.getSource('analysis:results')))).toBe(true);
    const data=await page.evaluate(()=>window.__basemapTestMap!.getStyle().sources['analysis:results']);expect(JSON.stringify(data)).toContain('"role":"reference"');expect(JSON.stringify(data)).toContain('"role":"result"');
    await panel.getByRole('button',{name:'参考：参照对象',exact:true}).click();await expect(panel.getByRole('button',{name:'参考：参照对象',exact:true})).toHaveAttribute('aria-pressed','true');
    await panel.getByRole('button',{name:'定位参考对象 参照对象',exact:true}).click();await expectAnalysisPositionsVisible(page,[[120.32,36.04]]);await panel.getByRole('button',{name:'定位分析',exact:true}).click();
    await expectAnalysisPositionsVisible(page,[[120.31,36.04],...(target.geometry.type==='Point'?[target.geometry.coordinates]:target.geometry.type==='LineString'?target.geometry.coordinates:[])]);await page.screenshot({path:test.info().outputPath(`reference-${metric}.png`)});await page.getByRole('button',{name:'关闭图层与对象',exact:true}).click();await page.screenshot({path:test.info().outputPath(`reference-${metric}-map.png`)});
    await page.setViewportSize({width:1100,height:800});await page.getByRole('button',{name:'图层与对象',exact:true}).click();await panel.getByRole('button',{name:'定位分析',exact:true}).click();await expect(panel).not.toBeVisible();await expectAnalysisPositionsVisible(page,[[120.31,36.04],...(target.geometry.type==='Point'?[target.geometry.coordinates]:target.geometry.type==='LineString'?target.geometry.coordinates:[])]);await page.screenshot({path:test.info().outputPath(`reference-${metric}-narrow.png`)});expect(env.errors).toEqual([]);
  }finally{await env.close();}
});

async function expectAnalysisPositionsVisible(page:Page,positions:Position[]) {
  await expect.poll(()=>page.evaluate(points=>{
    const map=window.__basemapTestMap!;const canvas=map.getContainer().getBoundingClientRect();
    const panel=document.querySelector('[aria-label="空间分析结果"]')?.closest('aside')?.getBoundingClientRect();
    return points.every(position=>{const point=map.project(position);return point.x>20&&point.x<canvas.width-20&&point.y>20&&point.y<canvas.height-20&&(!panel?.width||point.x+canvas.left>panel.right+10);});
  },positions)).toBe(true);
}
