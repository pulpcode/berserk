import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import { createMockContextServer } from '../../scripts/mock-context/server';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';
import { mapFixtures } from '../../scripts/mock-context/map-fixtures';
import type { SimulationAction } from '../../src/contracts/simulation';
import { mapHref } from '../../src/web/situation/evidence';

async function setup(page:Page,simulation=false){
 const dir=await mkdtemp(join(tmpdir(),'axon-map-web-'));
 const source=createMockContextServer({token:'map-query-token',controlToken:'map-control-token',databasePath:join(dir,'source.sqlite'),instanceId:'ui',day:'2026-10-11'});const base=await source.listen();
 const db=await openDatabase(dir);const access=new AccessStore(db);const userId=await access.saveAccount({username:'a',displayName:'地图验证',seatId:'a',seatName:'总体席',password:'test-password-123',createPublicTask:true,manageModelSettings:true});const actor=access.identity(userId)!;
 const road={systemId:'situation',objectType:'road',objectId:'ui-road-west-01'};
 const task=access.create(actor,{title:'地图验证任务',goal:'比较两区道路资料',visibility:'public',clientActionId:randomUUID(),context:{businessRefs:[road],focus:{areaIds:['ui-zone-east']}}});db.close();
 const config=testConfig(dir,{seatId:'a',auth:{secret:'map-browser-secret-at-least-thirty-two-characters',sessionMs:28800000}});
 const fake=await fakeRuntime(config,()=>({text:`[西区通道](${mapHref(road,1)})可供进一步分析。[无依据道路](${mapHref({...road,objectId:'missing'},1)})`}));
 const lab=await PiLab.create(config,fake.runtime);const app=await createApp(lab,false,undefined,{config:{systems:[{id:'situation',name:'模拟态势',adapter:'mock-situation-http',baseUrl:`${base}/situation`,tokenEnv:'QUERY',areas:[{id:'ui-zone-west',name:'西区'},{id:'ui-zone-east',name:'东区'}]}],scopes:[{id:'demo',name:'测试范围',systemIds:['situation'],seatIds:['a']}]},env:{QUERY:'map-query-token'}});
 const queries:Record<string,unknown>[]=[];let tiles=0;let failSource=false;let publicTiles=0;
 await page.route('https://tile.openstreetmap.org/**',route=>{publicTiles++;return route.abort();});
 await page.route('**/test-tiles/**',route=>{tiles++;return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAADIElEQVR4nO3UMQ0AIBDAwPevlZCgAGQw9IbbO3XW2Rdomt8BwD8GAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEPFcg416T4n38AAAAASUVORK5CYII=','base64')});});
 await page.route('**/api/**',async route=>{
  const req=route.request();const url=new URL(req.url());
  if(url.pathname==='/api/context/map-config')return route.fulfill({json:{providerId:'test',tiles:[`${url.origin}/test-tiles/{z}/{x}/{y}.png`],tileSize:256,attributionText:'© OpenStreetMap contributors',attributionUrl:'https://www.openstreetmap.org/copyright',simulationEnabled:simulation}});
  if(url.pathname==='/api/context/situation'){queries.push(req.postDataJSON());if(failSource)return route.fulfill({status:503,json:{error:{code:'SOURCE_OFFLINE',message:'模拟来源离线'}}});}
  const response=await app.inject({method:req.method() as 'GET'|'POST'|'PUT'|'DELETE',url:url.pathname+url.search,headers:{...req.headers(),host:'127.0.0.1',origin:'http://localhost:4310'},...(req.postDataBuffer()?{payload:req.postDataBuffer()!}:{})});
  await route.fulfill({status:response.statusCode,headers:Object.fromEntries(Object.entries(response.headers).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)])),body:response.rawPayload});
 });
 await page.goto('/');await page.getByLabel('席位', { exact: true }).selectOption('a');await page.getByLabel('密码',{exact:true}).fill('test-password-123');await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByRole('button',{name:'态势地图',exact:true})).toBeVisible();
 return {lab,fake,queries,task,road,tiles:()=>tiles,publicTiles:()=>publicTiles,offline:()=>{failSource=true;},close:async()=>{await page.goto('about:blank');await page.unrouteAll({behavior:'wait'});await app.close();await source.close();await rm(dir,{recursive:true,force:true});}};
}
test('global and task maps query union, keep stale source data, use only fixture tiles and never call model when browsing',async({page})=>{
 const env=await setup(page);try{
  await page.getByRole('button',{name:'态势地图',exact:true}).click();await expect(page.getByText('6 个对象',{exact:true})).toBeVisible();
  await expect(page.locator('.situation-simulation-label')).toHaveText('模拟态势');await expect(page.locator('.situation-attribution')).toContainText('OpenStreetMap');
  await page.getByText('对象列表 · 6',{exact:true}).click();await page.getByRole('button',{name:/西区通道 可通行/}).click();await expect(page.getByRole('heading',{name:'西区通道',exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('global-map-floating.png')});
  await expect.poll(env.tiles).toBeGreaterThan(0);await expect(page.locator('.situation-map-error')).toHaveCount(0);expect(env.fake.calls).toHaveLength(0);expect(env.publicTiles()).toBe(0);
  await page.getByRole('button',{name:'进入项目：地图验证任务',exact:true}).click();await page.getByRole('button',{name:'态势',exact:true}).click();await expect(page.getByText('4 个对象',{exact:true})).toBeVisible();expect((await page.locator('.maplibregl-canvas').boundingBox())!.height).toBeGreaterThan(500);
  expect(env.queries.some(query=>Array.isArray(query.objectRefs)&&!query.areaIds)).toBe(true);expect(env.queries.some(query=>Array.isArray(query.areaIds)&&!query.objectRefs)).toBe(true);
  env.offline();await page.locator('.annotation-source-controls > summary').click();await page.getByRole('button',{name:'刷新态势',exact:true}).click();await expect(page.locator('.situation-source-error')).toContainText('模拟来源离线');await expect(page.getByText('4 个对象',{exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('task-map-desktop.png')});expect(env.fake.calls).toHaveLength(0);
 }finally{await env.close();}
});
test('object draft loads native context on explicit send; verified answer opens nonmodal map and draft survives reload',async({page})=>{
 const env=await setup(page);try{
  await page.getByRole('button',{name:'态势地图',exact:true}).click();await page.getByText('对象列表 · 6',{exact:true}).click();await page.getByRole('button',{name:/西区通道 可通行/}).click();await page.getByRole('button',{name:'引用到对话',exact:true}).click();
  await page.getByRole('dialog',{name:'引用并提问'}).getByRole('combobox').selectOption(`task:${env.task.id}`);await page.getByRole('button',{name:'创建对话草稿'}).click();
  await expect(page.getByLabel('本次引用的地图对象')).toContainText(env.road.objectId);expect(env.fake.calls).toHaveLength(0);
  await page.getByRole('group',{name:'工作区布局'}).getByRole('button',{name:'协同',exact:true}).click();
  const panel=page.getByRole('complementary',{name:'地图工作区'});await expect(panel.getByText('对象列表 · 4',{exact:true})).toBeVisible();await panel.locator('.annotation-source-controls > summary').click();await panel.getByRole('button',{name:'查看全部获准态势',exact:true}).click();await panel.locator('.annotation-source-controls > summary').click();await panel.getByText('对象列表 · 6',{exact:true}).click();await panel.getByRole('button',{name:/西区可用车辆/}).click();await panel.getByRole('button',{name:'引用到对话',exact:true}).click();await expect(page.getByLabel('本次引用的地图对象')).toContainText('ui-vehicles-west-01');await page.getByRole('group',{name:'工作区布局'}).getByRole('button',{name:'对话',exact:true}).click();expect(env.fake.calls).toHaveLength(0);
  const input=page.getByRole('textbox',{name:'发送消息'});await input.fill('这条道路当前情况如何？');await page.reload();await expect(input).toHaveValue('这条道路当前情况如何？');await expect(page.getByLabel('本次引用的地图对象')).toContainText(env.road.objectId);
  await expect(page.getByRole('button',{name:'发送消息',exact:true})).toBeEnabled();await input.press('Enter');await expect(page.getByLabel('Axon 的回复')).toContainText('可供进一步分析');expect(env.fake.calls).toHaveLength(1);
  await expect(page.getByLabel('Axon 的回复').getByRole('button',{name:'无依据道路'})).toHaveCount(0);
  await input.fill('还需要哪些资料？');await page.getByLabel('Axon 的回复').getByRole('button',{name:'西区通道'}).click();await expect(page.getByRole('complementary',{name:'地图工作区'})).toBeVisible();await expect(input).toHaveValue('还需要哪些资料？');await expect(input).toBeEditable();await expect(page.getByRole('complementary',{name:'地图工作区'}).getByRole('heading',{name:'西区通道',exact:true})).toBeVisible();await expect(page.getByRole('complementary',{name:'地图工作区'}).locator('canvas')).toBeVisible();await page.screenshot({path:test.info().outputPath('map-sidepanel-1440.png')});await page.setViewportSize({width:1280,height:960});await page.screenshot({path:test.info().outputPath('map-sidepanel-1280.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await panel.locator('.annotation-source-controls > summary').click();await panel.getByRole('button',{name:'返回范围浏览',exact:true}).click();await expect(panel.getByText('对象列表 · 4',{exact:true})).toBeVisible();await expect(panel.getByRole('combobox',{name:'来源',exact:true})).toBeVisible();await page.getByLabel('Axon 的回复').getByRole('button',{name:'西区通道'}).click();await expect(panel.getByText('对象列表 · 1',{exact:true})).toBeVisible();await expect(panel.getByRole('heading',{name:'西区通道',exact:true})).toBeVisible();await page.getByRole('group',{name:'工作区布局'}).getByRole('button',{name:'对话',exact:true}).click();await expect(input).toHaveValue('还需要哪些资料？');
  expect(env.publicTiles()).toBe(0);await page.screenshot({path:test.info().outputPath('map-linked-chat.png')});
 }finally{await env.close();}
});

test('simulation UI separates saving facts from sending notifications and shows accepted receipt',async({page})=>{
 const env=await setup(page,true);const fixture=mapFixtures('ui','2026-10-11');const actions:SimulationAction[]=[];let sends=0;
 await page.route('**/api/simulation**',async route=>{const req=route.request();const path=new URL(req.url()).pathname;
  if(path==='/api/simulation')return route.fulfill({json:{instanceId:'ui',objects:fixture.objects,reports:fixture.reports,actions}});
  if(path.endsWith('/object-updates')){const input=req.postDataJSON();const item=fixture.objects.find(item=>item.ref.objectId===input.ref.objectId)!;expect(input.expectedRevision).toBe(item.revision);item.revision++;item.properties=input.properties;actions.push({id:input.clientActionId,systemId:'situation',createdAt:new Date().toISOString(),revision:item.revision,sendState:'unsent',notification:{sourceMessageId:'ui-msg',title:'车辆更新',text:'车辆由4降为2，请查询当前资料',subjectId:item.ref.objectId,occurredAt:input.effectiveAt}});return route.fulfill({json:actions.at(-1)});}
  const action=actions.at(-1)!;if(path.endsWith('/send')){sends++;action.sendState='accepted';action.receipt={eventId:'received',sourceMessageId:'ui-msg',receivedAt:new Date().toISOString(),status:'accepted'};}return route.fulfill({json:action});
 });
 try{await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'模拟验证',exact:true}).click();await expect(page.getByRole('heading',{name:'模拟验证'})).toBeVisible();await page.getByRole('button',{name:/西区可用车辆/}).click();await page.getByLabel('可用车辆数量').fill('2');await page.getByRole('button',{name:'保存变化',exact:true}).click();await expect(page.getByText('保存修订 2 · 尚未发送')).toBeVisible();expect(sends).toBe(0);await page.getByRole('button',{name:'发送通知',exact:true}).click();await expect(page.getByRole('link',{name:'查看接收与处理记录'})).toHaveAttribute('href','/overview?tab=events&id=received');expect(sends).toBe(1);expect(env.fake.calls).toHaveLength(0);await page.screenshot({path:test.info().outputPath('simulation-control.png')});}finally{await env.close();}
});
