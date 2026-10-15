/** Bounded live basemap acceptance. Uses isolated synthetic business data; never calls a model. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { fakeRuntime, testConfig } from '../tests/pi/fake-runtime.js';
import { captureMap, mapSnapshot } from '../tests/e2e/basemap-fixtures.js';
import type { SituationObject } from '../src/contracts/context.js';

const output=resolve(process.env.BASEMAP_EVIDENCE_DIR || '.local/basemap-acceptance');
await mkdir(output,{recursive:true});
const dir=await mkdtemp(join(tmpdir(),'berserk-basemaps-live-'));
const db=await openDatabase(dir),access=new AccessStore(db);
const userId=await access.saveAccount({username:'basemap',displayName:'底图验收',seatId:'basemap',seatName:'底图验收席',password:'basemap-test-local-123',createPublicTask:true,manageModelSettings:true});
const actor=access.identity(userId)!;
const task=access.create(actor,{title:'中澳沿海底图验收',goal:'仅使用合成业务对象验证底图显示',visibility:'public',clientActionId:randomUUID(),context:{focus:{areaIds:['acceptance']}}});db.close();
const port=Number(process.env.BASEMAP_PROBE_PORT || 5198);
const config=testConfig(dir,{port,seatId:'basemap',auth:{secret:'isolated-basemap-acceptance-secret-thirty-two-characters',sessionMs:28800000}});
const fake=await fakeRuntime(config,()=>({text:'Unexpected model invocation'}));
const lab=await PiLab.create(config,fake.runtime),app=await createApp(lab,false);
const apiUrl=await app.listen({port:0,host:'127.0.0.1'});
const vite=await createServer({server:{port,host:'127.0.0.1',strictPort:true,proxy:{'/api':apiUrl}}});await vite.listen();
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(20000);
const errors:string[]=[];const network:Array<{url:string;status:number}>=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('response',response=>{if(/tiles\.openfreemap\.org|arcgisonline\.com/.test(response.url()))network.push({url:response.url(),status:response.status()});});
await captureMap(page);
let objects:SituationObject[]=[];
await page.route('**/api/context/catalog',route=>route.fulfill({json:{systems:[{id:'acceptance',name:'底图验收合成对象',objectTypes:['road','resource','area'],capabilities:['situation_current'],areas:[{id:'acceptance',name:'验收范围'}]}]}}));
await page.route('**/api/context/situation',route=>route.fulfill({json:{systemId:'acceptance',query:route.request().postDataJSON(),queriedAt:new Date().toISOString(),data:{systemId:'acceptance',asOf:new Date().toISOString(),items:objects,limit:100,nextCursor:null,hasMore:false,timeUnknownCount:0,unknownRefs:[],changeCursor:'fixture'}}}));
const scenes=[
 {id:'qingdao-city',name:'青岛城区',center:[120.382,36.066],zoom:14},
 {id:'qingdao-port',name:'青岛港口',center:[120.202,36.012],zoom:14},
 {id:'qingdao-offshore',name:'青岛近海',center:[120.405,35.97],zoom:12},
 {id:'sydney-city',name:'悉尼城区',center:[151.2093,-33.8688],zoom:14},
 {id:'sydney-port',name:'悉尼 Botany 港',center:[151.218,-33.975],zoom:14},
 {id:'sydney-offshore',name:'悉尼近海',center:[151.33,-33.89],zoom:12},
];
const selectedScenes=scenes.filter(scene=>!process.env.BASEMAP_SCENES || process.env.BASEMAP_SCENES.split(',').includes(scene.id));
assert.ok(selectedScenes.length,'Select at least one known acceptance scene');
const results:Array<Record<string,unknown>>=[];
const layouts:Array<Record<string,unknown>>=[];
try {
 await page.goto(`http://127.0.0.1:${port}`);await page.getByLabel('席位',{exact:true}).selectOption('basemap');await page.getByLabel('密码',{exact:true}).fill('basemap-test-local-123');await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByRole('button',{name:'进入项目：中澳沿海底图验收'})).toBeVisible();
 const workspace=await lab.workspaces.ensureWorkspace(task.id,'basemap',task.title);
 for(const scene of selectedScenes){
  const [x,y]=scene.center;const session=await lab.createSession(workspace.id,'basemap');
  const base={areaIds:['acceptance'],revision:1,effectiveAt:null,validTime:null};
  objects=[{...base,ref:{systemId:'acceptance',objectType:'road',objectId:'test-road'},name:'合成业务通道',properties:{passability:'restricted'},geometry:{type:'LineString',coordinates:[[x-.004,y-.003],[x+.003,y-.003],[x+.005,y]]}},{...base,ref:{systemId:'acceptance',objectType:'resource',objectId:'test-resource'},name:'合成救援资源',properties:{availableCount:2,unit:'辆'},geometry:{type:'Point',coordinates:[x-.003,y+.002]}}];
  lab.annotations!.action(actor,session.id,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,title:'合成救援标绘',operations:[{op:'add_layer',layer:{layerId:'acceptance',name:'验收标绘',order:0,defaultVisible:true,features:[{objectId:'point',name:'合成集合点',kind:'point',geometry:{type:'Point',coordinates:[x+.003,y+.002]},style:{color:'#416858',label:'合成集合点'}},{objectId:'line',name:'合成搜救线',kind:'line',geometry:{type:'LineString',coordinates:[[x-.004,y+.003],[x+.004,y+.004]]},style:{color:'#b34d48',width:3}},{objectId:'area',name:'合成救援范围',kind:'polygon',geometry:{type:'Polygon',coordinates:[[[x-.002,y-.002],[x+.002,y-.002],[x+.002,y+.001],[x-.002,y+.001],[x-.002,y-.002]]]},style:{color:'#a26913',opacity:.12}}]}}]});
  await page.goto(`http://127.0.0.1:${port}/situation?taskId=${task.id}&sessionId=${session.id}`);
  await expect(page.getByRole('group',{name:'底图视图'})).toBeVisible();await expect.poll(()=>page.evaluate(()=>Boolean(window.__basemapTestMap?.getLayer('business:anchor')))).toBe(true);
  // Let initial scene focus settle, then set the fixed acceptance viewport through MapLibre's public API.
  await expect(page.locator('.annotation-marker').first()).toBeVisible();
  await page.evaluate(({center,zoom})=>window.__basemapTestMap!.jumpTo({center:center as [number,number],zoom}),scene);
  const before=await mapSnapshot(page);
  for(const view of ['影像','路网','混合']){
   const start=network.length;await page.getByRole('group',{name:'底图视图'}).getByRole('button',{name:view,exact:true}).click();
   let ready=true;try{await expect.poll(()=>page.evaluate((view)=>{const map=window.__basemapTestMap!;const kinds=view==='影像'?['imagery']:view==='路网'?['roads']:['imagery','roads'];return map.loaded() && kinds.every(kind=>Object.keys(map.getStyle().sources).some(id=>id.startsWith(`basemap:${kind}:`) && map.isSourceLoaded(id)));},view),{timeout:35000}).toBe(true);}catch{ready=false;}
   await page.waitForTimeout(1200);
   const shot=`${scene.id}-${({'影像':'imagery','路网':'road','混合':'hybrid'} as Record<string,string>)[view]}.png`;
   await page.screenshot({path:join(output,shot)});
   const snapshot=await mapSnapshot(page);assert.deepEqual(snapshot,before,'Switch must preserve camera and business source data');
   const render=await page.evaluate(()=>{const map=window.__basemapTestMap!;return {sources:Object.entries(map.getStyle().sources).map(([id,source])=>({id,type:source.type,loaded:map.isSourceLoaded(id)})),layers:map.queryRenderedFeatures().reduce<Record<string,number>>((all,f)=>{all[f.layer.id]=(all[f.layer.id]||0)+1;return all;},{})};});
   results.push({scene:scene.name,view,center:scene.center,zoom:scene.zoom,ready,screenshot:shot,status:await page.locator('.situation-map-feedback').allTextContents(),render,requests:network.slice(start)});
   assert.equal(ready,true,`${scene.name} ${view} must load real sources`);
   await expect(page.getByRole('button',{name:'重试底图',exact:true})).toHaveCount(0);
   console.info(JSON.stringify({scene:scene.name,view,ready,screenshot:shot}));
  }
  if(scene.id==='sydney-city'){
   await page.goto(`http://127.0.0.1:${port}/?session=${session.id}`);await page.getByRole('button',{name:'打开态势地图',exact:true}).click();await expect(page.getByRole('complementary',{name:'地图工作区'})).toBeVisible();await expect.poll(()=>page.evaluate(()=>Boolean(window.__basemapTestMap?.loaded())),{timeout:35000}).toBe(true);
   await expect(page.getByRole('button',{name:'重试底图',exact:true})).toHaveCount(0);
   await page.screenshot({path:join(output,'desktop-three-pane.png')});
   layouts.push({screenshot:'desktop-three-pane.png',status:await page.locator('.situation-map-feedback').allTextContents()});
   const separator=page.getByRole('separator',{name:'调整对话与地图宽度'});await separator.focus();await separator.press('End');await page.setViewportSize({width:1280,height:900});await expect.poll(()=>page.evaluate(()=>Boolean(window.__basemapTestMap?.loaded())),{timeout:35000}).toBe(true);await expect(page.getByRole('button',{name:'重试底图',exact:true})).toHaveCount(0);await page.screenshot({path:join(output,'desktop-narrow-map.png')});layouts.push({screenshot:'desktop-narrow-map.png',status:await page.locator('.situation-map-feedback').allTextContents()});await page.setViewportSize({width:1440,height:960});
  }
 }
 assert.equal(fake.calls.length,0);assert.deepEqual(errors,[]);
}catch(error) {await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});throw error;}finally {
 await writeFile(join(output,'results.json'),JSON.stringify({generatedAt:new Date().toISOString(),syntheticBusinessData:true,modelCalls:fake.calls.length,errors,results,layouts,network},null,2)+'\n');
 await browser.close();await vite.close();await app.close();await rm(dir,{recursive:true,force:true});
}
console.info(`Evidence: ${output}`);
