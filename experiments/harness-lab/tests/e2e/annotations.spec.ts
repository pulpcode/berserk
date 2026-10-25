import { randomUUID } from 'node:crypto';
import type { VectorTileSource } from 'maplibre-gl';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';
import { annotationToolResult } from '../../src/pi/annotation-results';
import { mapFixtures } from '../../scripts/mock-context/map-fixtures';
import { basemapFixture, captureMap, localVectorTiles, mapSnapshot } from './basemap-fixtures';

test.setTimeout(60000);
async function setup(page:Page, basemap?: (origin:string)=>unknown, reply: Parameters<typeof fakeRuntime>[1] = ()=>({text:'已收到固定标注引用。'})){
 const dir=await mkdtemp(join(tmpdir(),'axon-annotations-web-'));const db=await openDatabase(dir);const access=new AccessStore(db);
 const userId=await access.saveAccount({username:'a',displayName:'地图验证',seatId:'a',seatName:'总体席',password:'test-password-123',createPublicTask:true,manageModelSettings:true});const actor=access.identity(userId)!;
 const task=access.create(actor,{title:'标注验证任务',goal:'独立草稿与固定发布',visibility:'public',clientActionId:randomUUID()});db.close();
 const config=testConfig(dir,{seatId:'a',auth:{secret:'annotations-browser-secret-at-least-thirty-two-characters',sessionMs:28800000}});
 const fake=await fakeRuntime(config,reply);const lab=await PiLab.create(config,fake.runtime);const app=await createApp(lab,false);
 const workspace=await lab.workspaces.ensureWorkspace(task.id,'a',task.title);const session=await lab.createSession(workspace.id,'a');const second=await lab.createSession(workspace.id,'a');
 let tiles=0;let dropAction=false;const requests:Array<{path:string;body:Record<string,unknown>}> = [];const errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://tile.openstreetmap.org/**',route=>route.abort());
 await page.route('**/test-tiles/**',route=>{tiles++;return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAADIElEQVR4nO3UMQ0AIBDAwPevlZCgAGQw9IbbO3XW2Rdomt8BwD8GAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEGAGEPFcg416T4n38AAAAASUVORK5CYII=','base64')});});
 await page.route('**/api/**',async route=>{const req=route.request();const url=new URL(req.url());
  if(url.pathname==='/api/context/map-config' && basemap)return route.fulfill({json:basemap(url.origin)});
  if(url.pathname==='/api/context/map-config')return route.fulfill({json:{providerId:'test',tiles:[`${url.origin}/test-tiles/{z}/{x}/{y}.png`],tileSize:256,attributionText:'本地验证瓦片',attributionUrl:'https://www.openstreetmap.org/copyright',simulationEnabled:false}});
  if(req.postDataJSON())requests.push({path:url.pathname,body:req.postDataJSON()});
  const response=await app.inject({method:req.method() as 'GET'|'POST'|'PUT'|'DELETE',url:url.pathname+url.search,headers:{...req.headers(),host:'127.0.0.1',origin:'http://localhost:4310'},...(req.postDataBuffer()?{payload:req.postDataBuffer()!}:{})});
  if(dropAction && url.pathname.endsWith('/annotation/actions')){dropAction=false;await route.abort();return;}
  await route.fulfill({status:response.statusCode,headers:Object.fromEntries(Object.entries(response.headers).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)])),body:response.rawPayload});
 });
 await page.goto('/');await page.getByLabel('席位',{exact:true}).selectOption('a');await page.getByLabel('密码',{exact:true}).fill('test-password-123');await page.getByRole('button',{name:'登录',exact:true}).click();
 await expect(page.getByRole('button',{name:'进入项目：标注验证任务'})).toBeVisible();
 await page.goto(`/situation?taskId=${task.id}&sessionId=${session.id}`);
 await expect(page.locator('.annotation-heading')).toBeVisible();await expect(page.locator('.maplibregl-canvas').or(page.getByText('地图暂不可用，请通过图层与对象查看与引用。'))).toBeVisible();await openLayers(page);await openTools(page);
 return {lab,actor,task,session,second,requests,errors,dropNextAction:()=>{dropAction=true;},tiles:()=>tiles,fake,close:async()=>{page.on('dialog',dialog=>dialog.accept());await page.goto('about:blank');await page.unrouteAll({behavior:'wait'});await app.close();await rm(dir,{recursive:true,force:true});}};
}
async function openTools(page:Page){const button=page.getByRole('button',{name:'标绘工具',exact:true});if(await button.getAttribute('aria-expanded')!=='true')await button.click();}
async function saveDraw(page:Page){await page.getByRole('button',{name:'保存对象',exact:true}).click();await expect(page.locator('.annotation-feature-form')).toHaveCount(0);}
async function openLayers(page:Page){if(!await page.locator('.annotation-sidebar').isVisible())await page.getByRole('button',{name:'图层与对象',exact:true}).click();await expect(page.locator('.annotation-sidebar')).toBeVisible();}
async function expandGroup(page:Page,name:string){const button=page.getByRole('button',{name:`展开${name}`,exact:true});if(await button.isVisible())await button.click();}
async function openVersions(page:Page){if(!await page.locator('.annotation-management').isVisible())await page.getByRole('button',{name:'版本与发布',exact:true}).click();}
async function pickOwn(page:Page,name:string){await openLayers(page);await expandGroup(page,'本会话标注');const group=page.getByRole('region',{name:/^本会话标注 /});const row=group.locator('.annotation-tree-layer').filter({has:page.getByRole('button',{name:/^(展开|收起)集合点$/})});const toggle=row.getByRole('button',{name:/^(展开|收起)集合点$/});if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();await group.getByRole('button',{name,exact:true}).click();}
async function addLayer(page:Page,name:string){await openLayers(page);await expandGroup(page,'本会话标注');await page.getByRole('region',{name:/^本会话标注 /}).getByRole('button',{name:'新建图层',exact:true}).click();await page.getByLabel('新图层名称').fill(name);await page.getByRole('button',{name:'添加图层',exact:true}).click();await expect(page.getByLabel('新图层名称')).not.toBeVisible();}
async function layer(page:Page){await addLayer(page,'集合点');await expect(page.locator('.annotation-heading')).toContainText('草稿 r1');}
async function groupMore(group:import('@playwright/test').Locator){const button=group.locator(':scope > .annotation-tree-row .annotation-tree-more > button');if(await button.getAttribute('aria-expanded')==='false')await button.click();}
async function point(page:Page,name='集合点 A') {await openTools(page);await page.getByRole('button',{name:'坐标新增',exact:true}).click();await page.getByLabel('对象名称',{exact:true}).fill(name);await page.getByRole('button',{name:'保存对象',exact:true}).click();await expect(page.locator('.annotation-feature-form')).toHaveCount(0);}

test('independent drafts, fixed publication, current selection and native annotation reference',async({page})=>{
 const env=await setup(page);try{
  await layer(page);await point(page);await expect(page.locator('.annotation-heading')).toContainText('草稿 r2');
  await openVersions(page);await page.getByText('标注集名称与发布',{exact:true}).click();await page.getByLabel('发布名称',{exact:true}).fill('集合点发布版');await page.getByRole('button',{name:'发布此保存修订'}).click();await expect(page.getByRole('alert')).toContainText('任务当前标注保持不变');
  expect(env.lab.annotations!.current(env.actor,env.task.id).sequence).toBe(0);
  await page.getByText('我的草稿与已发布版本',{exact:true}).click();await page.getByRole('button',{name:'添加发布版参考'}).click();await openLayers(page);await expect(page.getByRole('region',{name:'参考标注 集合点发布版'})).toBeVisible();
  const reference=page.getByRole('region',{name:'参考标注 集合点发布版'});await expandGroup(page,'参考标注 集合点发布版');await expect(reference.getByRole('button',{name:'显示集合点',exact:true})).toHaveAttribute('aria-pressed','false');await expect(reference.getByRole('button',{name:'删除对象'})).toHaveCount(0);
  await openVersions(page);await page.getByRole('button',{name:'比较并设为当前'}).click();await page.getByRole('button',{name:'设为当前标注',exact:true}).click();expect(env.lab.annotations!.current(env.actor,env.task.id).sequence).toBe(1);
  const first=env.lab.annotations!.binding(env.actor,env.session.id);const pub=env.lab.annotations!.current(env.actor,env.task.id).publication!;
  const secondBinding=env.lab.annotations!.binding(env.actor,env.second.id);env.lab.annotations!.setBase(env.actor,env.second.id,{clientActionId:randomUUID(),baseRef:{publicationId:pub.publicationId},expectedBindingRevision:secondBinding.bindingRevision});
  await page.goto(`/situation?taskId=${env.task.id}&sessionId=${env.second.id}`);await openLayers(page);await pickOwn(page,'集合点 A point');await point(page,'集合点 B');
  expect(env.lab.annotations!.binding(env.actor,env.session.id).draft!.headRevision).toBe(first.draft!.headRevision);
  await page.goto(`/?session=${env.second.id}`);await page.getByRole('button',{name:'打开态势地图',exact:true}).click();await openLayers(page);await pickOwn(page,'集合点 B point');await page.getByRole('button',{name:'放大地图',exact:true}).click();await page.getByRole('button',{name:'引用此对象'}).click();await expect(page.getByRole('textbox',{name:'发送消息',exact:true})).toBeVisible();await expect(page.getByLabel('本次引用的标注版本')).toContainText('r1');
  await page.getByRole('button',{name:'关闭态势地图',exact:true}).click();await page.getByRole('textbox',{name:'发送消息',exact:true}).fill('比较这些集合点');await page.getByRole('button',{name:'发送消息',exact:true}).click();await expect(page.getByLabel('本条消息引用的标注版本')).toBeVisible();expect(env.requests.find(item=>item.path.endsWith('/messages'))?.body.annotationRefs).toEqual([expect.objectContaining({objectIds:expect.arrayContaining([expect.any(String)])})]);
  await page.getByLabel('本条消息引用的标注版本').getByRole('button').click();await expect(page.getByRole('complementary',{name:'地图工作区'})).toBeVisible();await expect.poll(env.tiles).toBeGreaterThan(0);await expect(page.locator('.annotation-heading')).toContainText('草稿 r1');await expect(page.getByText(/固定引用范围：1 个对象/)).toBeVisible();await expect(page.locator('.annotation-marker').first()).toBeVisible();expect(env.errors).toEqual([]);
  await expect(page.getByRole('region',{name:'标注对象操作'})).toContainText('只读参考');await pickOwn(page,'集合点 B point');await expect(page.getByRole('region',{name:'标注对象操作'})).toContainText('本会话可编辑');await page.getByLabel('本条消息引用的标注版本').getByRole('button').click();await expect(page.getByRole('region',{name:'标注对象操作'})).toContainText('只读参考');if(await page.locator('.annotation-sidebar').isVisible())await page.getByRole('button',{name:'关闭图层与对象',exact:true}).click();await page.screenshot({path:test.info().outputPath('annotation-reference-1440.png')});await page.setViewportSize({width:1280,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath('annotation-reference-1280.png')});
 }finally{await env.close();}
});

test('official Terra Draw supports point line polygon Chinese labels, edit and cleanup on MapLibre 6.4',async({page})=>{
 const env=await setup(page);try{
  await layer(page);const canvas=page.locator('.maplibregl-canvas');await expect(canvas).toBeVisible();await expect.poll(env.tiles).toBeGreaterThan(0);
  const toolbar=page.getByRole('group',{name:'标注绘制工具'});
  for(const name of ['绘制点','绘制线','绘制面','放置文字','坐标新增']){const tool=toolbar.getByRole('button',{name,exact:true});await expect(tool).toHaveText('');await expect(tool).toHaveAttribute('title',name);}
  expect((await toolbar.boundingBox())!.width).toBeLessThanOrEqual(340);await expect(toolbar.locator('.annotation-toolbar-target')).toHaveAttribute('title','当前绘制图层：集合点');
  const box=(await canvas.boundingBox())!;const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.getByRole('button',{name:'绘制点',exact:true}).click();await expect(page.getByRole('button',{name:'绘制点',exact:true})).toHaveAttribute('aria-pressed','true');await expect(toolbar.getByRole('status')).toContainText('点击地图放置');await page.mouse.click(x,y);await saveDraw(page);await expect(page.locator('.annotation-heading')).toContainText('草稿 r2');
  await page.getByRole('button',{name:'绘制线',exact:true}).click();await page.mouse.click(x-60,y-30);page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'工作待办',exact:true}).click();await expect(page.getByRole('button',{name:'退出绘制'})).toBeVisible();await page.mouse.click(x+40,y+20);await page.mouse.dblclick(x+100,y+50);await saveDraw(page);await expect(page.locator('.annotation-heading')).toContainText('草稿 r3');
  await page.getByRole('button',{name:'绘制面',exact:true}).click();await page.mouse.click(x-90,y-80);await page.mouse.click(x+80,y-80);await page.mouse.click(x+80,y+80);await page.mouse.dblclick(x-90,y+80);await saveDraw(page);await expect(page.locator('.annotation-heading')).toContainText('草稿 r4');
  await page.getByRole('button',{name:'放置文字',exact:true}).click();await page.mouse.click(x,y);await saveDraw(page);await expect(page.locator('.annotation-heading')).toContainText('草稿 r5');await expect(page.locator('.annotation-label').filter({hasText:'新文字注记'})).toBeVisible();
  const binding=env.lab.annotations!.binding(env.actor,env.session.id);const doc=env.lab.annotations!.privateVersion(env.actor,binding.draft!.setId,5).document;expect(doc.layers[0]!.features.map(item=>item.kind)).toEqual(['point','line','polygon','text']);
  await pickOwn(page,'新文字注记 text');await page.getByRole('button',{name:'拖动及顶点编辑'}).click();const updatedBox=(await canvas.boundingBox())!;const cx=updatedBox.x+updatedBox.width/2,cy=updatedBox.y+updatedBox.height/2;await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx+45,cy+20,{steps:5});await page.mouse.up();await saveDraw(page);await expect(page.locator('.annotation-heading')).toContainText('草稿 r6');
  await page.reload();await openLayers(page);await expect(page.locator('.annotation-heading')).toContainText('草稿 r6');await expect(page.locator('canvas')).toBeVisible();await groupMore(page.getByRole('region',{name:/^本会话标注 /}));await page.getByRole('button',{name:'定位此组',exact:true}).click();await expect(page.locator('.annotation-marker')).toHaveCount(4);expect(env.errors).toEqual([]);await page.waitForTimeout(750);await page.screenshot({path:test.info().outputPath('terra-draw-maplibre-6.4.png')});
 }finally{await env.close();}
});

test('CAS retains form and no WebGL still permits explicit coordinate editing',async({page})=>{
 await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,type,...args){if(String(type).includes('webgl'))return null;return original.call(this,type,...args);} as typeof original;});
 const env=await setup(page);try{
  await layer(page);await expect(page.getByText('地图暂不可用，请通过图层与对象查看与引用。')).toBeVisible();await point(page);
  await pickOwn(page,'集合点 A point');await page.getByRole('button',{name:'编辑属性与坐标'}).click();await page.getByLabel('对象名称',{exact:true}).fill('保留我的修改');
  const binding=env.lab.annotations!.binding(env.actor,env.session.id);env.lab.annotations!.action(env.actor,env.session.id,{action:'apply',clientActionId:randomUUID(),expectedRevision:binding.draft!.headRevision,operations:[{op:'rename_set',title:'Agent 已更新'}]});
  await page.getByRole('button',{name:'刷新标注',exact:true}).click();await expect(page.locator('.annotation-heading')).toContainText('草稿 r3');await page.getByRole('button',{name:'保存对象',exact:true}).click();await expect(page.getByLabel('对象名称',{exact:true})).toHaveValue('保留我的修改');await expect(page.getByText('保存未完成',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'查看最新保存版本'}).click();await expect(page.locator('.annotation-heading')).toContainText('草稿 r3');await expect(page.getByLabel('对象名称',{exact:true})).toHaveValue('保留我的修改');
  await page.getByRole('button',{name:'已核对最新版本，重新编辑'}).click();await page.getByRole('button',{name:'保存对象',exact:true}).click();await expect(page.locator('.annotation-heading')).toContainText('草稿 r4');expect(env.lab.annotations!.privateVersion(env.actor,binding.draft!.setId,4).document.layers[0]!.features[0]!.name).toBe('保留我的修改');
 }finally{await env.close();}
});


test('lost save response reconciles exactly once and clears only the submitted buffer',async({page})=>{
 const env=await setup(page);try{
  await layer(page);await page.getByRole('button',{name:'坐标新增',exact:true}).click();await page.getByLabel('对象名称',{exact:true}).fill('回执集合点');env.dropNextAction();await page.getByRole('button',{name:'保存对象',exact:true}).click();
  await expect(page.getByText('保存结果待确认',{exact:true})).toBeVisible();const binding=env.lab.annotations!.binding(env.actor,env.session.id);expect(binding.draft!.headRevision).toBe(2);
  await page.getByRole('button',{name:'查询保存回执'}).click();await expect(page.locator('.annotation-feature-form')).toHaveCount(0);await expect(page.locator('.annotation-heading')).toContainText('草稿 r2');await expect(page.locator('.annotation-heading')).not.toContainText('未保存');
  expect(env.lab.annotations!.binding(env.actor,env.session.id).draft!.headRevision).toBe(2);expect(env.requests.filter(item=>item.path.endsWith('/annotation/actions')&&item.body.action==='apply')).toHaveLength(1);
 }finally{await env.close();}
});


test('layout modes preserve unsaved editing and browser back still guards business navigation',async({page})=>{
 const env=await setup(page);try{
  await layer(page);await point(page);
  // Enter a real conversation through the application's sidebar, then change only layout.
  await page.locator('.group-sessions .session-item').first().click();
  await expect(page.getByRole('button',{name:'打开态势地图',exact:true})).toBeVisible();

  await page.getByRole('button',{name:'打开态势地图',exact:true}).click();await openLayers(page);
  // Both sessions share a task; ensure this selected conversation has its own draft.
  const selectedId=new URL(page.url()).searchParams.get('session')!;if(!env.lab.annotations!.binding(env.actor,selectedId).draft){await layer(page);await point(page);}
  const input=page.getByRole('textbox',{name:'发送消息',exact:true});await input.fill('布局切换保留我的提问');
  await pickOwn(page,'集合点 A point');await page.getByRole('button',{name:'编辑属性与坐标'}).click();await page.getByLabel('对象名称',{exact:true}).fill('切换布局仍保留');
  const originalUrl=page.url();let dialogs=0;const reject=(dialog:import('@playwright/test').Dialog)=>{dialogs++;void dialog.dismiss();};page.on('dialog',reject);
  await page.getByRole('button',{name:'放大地图',exact:true}).click();await expect(input).not.toBeVisible();await expect(page.getByLabel('对象名称',{exact:true})).toHaveValue('切换布局仍保留');
  await page.getByRole('button',{name:'还原地图',exact:true}).click();await expect(input).toBeVisible();await expect(page.getByLabel('对象名称',{exact:true})).toHaveValue('切换布局仍保留');
  await page.getByRole('button',{name:'关闭态势地图',exact:true}).click();await expect(input).toHaveValue('布局切换保留我的提问');await expect(page.getByRole('complementary',{name:'地图工作区'})).not.toBeVisible();await expect(page.getByRole('button',{name:'打开态势地图',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'打开态势地图',exact:true}).click();await expect(page.getByLabel('对象名称',{exact:true})).toHaveValue('切换布局仍保留');expect(dialogs).toBe(0);expect(page.url()).toBe(originalUrl);
  await page.goBack();await expect(page).toHaveURL(originalUrl);await expect(page.getByLabel('对象名称',{exact:true})).toHaveValue('切换布局仍保留');expect(dialogs).toBe(1);page.off('dialog',reject);
  await page.getByRole('button',{name:'保存对象',exact:true}).click();await expect(page.locator('.annotation-feature-form')).toHaveCount(0);await page.goBack();await expect(page).not.toHaveURL(originalUrl);expect(env.fake.calls).toHaveLength(0);expect(env.errors).toEqual([]);
 }finally{await env.close();}
});

test('three columns resize by keyboard and pointer while map fills available height',async({page})=>{
 const env=await setup(page);try{
  await page.goto(`/?session=${env.session.id}`);await page.getByRole('button',{name:'打开态势地图',exact:true}).click();
  await expect(page.getByRole('group',{name:'工作区布局'})).toHaveCount(0);await expect(page.locator('.map-panel-heading')).toHaveCount(0);await expect(page.getByRole('button',{name:'本会话地图标注',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'引用地图对象',exact:true})).toHaveCount(0);
  const separator=page.getByRole('separator',{name:'调整对话与地图宽度'});await expect(separator).toBeVisible();const panel=page.getByRole('complementary',{name:'地图工作区'});const canvas=panel.locator('.maplibregl-canvas');await expect(canvas).toBeVisible();
  const verifyFloatingTools=async()=>{
    const layout=(await panel.locator('.annotation-layout').boundingBox())!;
    expect(Math.abs((await canvas.boundingBox())!.y-layout.y)).toBeLessThan(2);
    const tools=['图层与对象','版本与发布','刷新标注','放大地图','关闭态势地图'];
    const layers=panel.getByRole('button',{name:'图层与对象',exact:true});
    const versions=panel.getByRole('button',{name:'版本与发布',exact:true});
    await layers.click();await expect(panel.locator('.annotation-sidebar')).toBeVisible();
    for(const name of tools)await panel.getByRole('button',{name,exact:true}).click({trial:true});
    await panel.getByRole('button',{name:'关闭图层与对象',exact:true}).press('Escape');await expect(layers).toBeFocused();
    await versions.click();await expect(panel.locator('.annotation-management')).toBeVisible();
    for(const name of tools)await panel.getByRole('button',{name,exact:true}).click({trial:true});
    await panel.getByRole('button',{name:'关闭版本与发布',exact:true}).press('Escape');await expect(versions).toBeFocused();
    await layers.click();await expandGroup(page,'来源态势');const source=panel.locator('.source-query-controls>summary');await source.click();
    for(const name of tools)await panel.getByRole('button',{name,exact:true}).click({trial:true});
    await source.press('Escape');await expect(source).toBeFocused();await expect(panel.locator('.source-query-controls')).not.toHaveAttribute('open','');await source.press('Escape');await expect(layers).toBeFocused();
  };
  await verifyFloatingTools();
  // The transparent gap between status and actions remains an actual map gesture surface.
  expect(await panel.locator('.annotation-heading').evaluate(header=>{
    const status=header.querySelector('.annotation-map-status')!.getBoundingClientRect();
    const actions=header.querySelector('.annotation-heading-actions')!.getBoundingClientRect();
    return document.elementFromPoint((status.right+actions.left)/2,status.top+status.height/2)?.closest('.annotation-heading')===null;
  })).toBe(true);
  const before=(await panel.boundingBox())!;expect((await canvas.boundingBox())!.height).toBeGreaterThan(650);
  await separator.focus();await separator.press('ArrowLeft');await expect.poll(async()=>(await panel.boundingBox())!.width).toBeGreaterThan(before.width);
  const split=(await separator.boundingBox())!;await page.mouse.move(split.x+split.width/2,split.y+split.height/2);await page.mouse.down();await page.mouse.move(split.x+80,split.y+split.height/2,{steps:5});await page.mouse.up();await expect.poll(async()=>(await panel.boundingBox())!.width).toBeLessThan(before.width);
  const resized=(await panel.boundingBox())!.width;await page.getByRole('button',{name:'放大地图',exact:true}).click();await expect.poll(async()=>(await panel.boundingBox())!.width).toBeGreaterThan(resized);await page.getByRole('button',{name:'打开态势地图',exact:true}).click();await expect(page.getByRole('textbox',{name:'发送消息',exact:true})).not.toBeVisible();await page.getByRole('button',{name:'还原地图',exact:true}).click();await expect.poll(async()=>(await panel.boundingBox())!.width).toBeCloseTo(resized,0);
  await separator.focus();await separator.press('Home');await separator.press('End');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath('three-column-resize-1440.png')});await page.setViewportSize({width:1280,height:900});await page.getByRole('button',{name:'打开态势地图',exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath('three-column-resize-1280.png')});
  await page.setViewportSize({width:800,height:900});await page.getByRole('button',{name:'放大地图',exact:true}).click();await expect(canvas).toBeVisible();await page.getByRole('button',{name:'关闭态势地图',exact:true}).click();await expect(page.getByRole('textbox',{name:'发送消息',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.setViewportSize({width:350,height:900});await page.getByRole('button',{name:'打开态势地图',exact:true}).click();await verifyFloatingTools();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath('floating-map-toolbar-350.png')});
  expect(env.errors).toEqual([]);expect(env.fake.calls).toHaveLength(0);
 }finally{await env.close();}
});



test('overlapping draft and publication objects select their exact read-only group',async({page})=>{
 const env=await setup(page);try{
  await layer(page);await point(page,'重叠 A');await point(page,'重叠 B');
  await openVersions(page);await page.getByText('标注集名称与发布',{exact:true}).click();await page.getByLabel('发布名称',{exact:true}).fill('重叠发布版');await page.getByRole('button',{name:'发布此保存修订'}).click();await expect(page.getByRole('alert')).toContainText('任务当前标注保持不变');
  await page.getByText('我的草稿与已发布版本',{exact:true}).click();await page.getByRole('button',{name:'添加发布版参考'}).click();await openLayers(page);const ref=page.getByRole('region',{name:'参考标注 重叠发布版'});await expandGroup(page,'参考标注 重叠发布版');await ref.getByRole('button',{name:'显示集合点',exact:true}).click();await groupMore(ref);await ref.getByRole('button',{name:'定位此组'}).click();
  await expect.poll(async()=>{const box=(await page.locator('.maplibregl-canvas').boundingBox())!;await page.mouse.click(box.x+box.width/2,box.y+box.height/2);return page.locator('.annotation-overlap > button').count();}).toBe(4);
  await page.locator('.annotation-overlap').getByRole('button',{name:'重叠发布版 · 集合点 · 重叠 B',exact:true}).click();await expect(page.locator('.annotation-detail')).toContainText('重叠发布版');await expect(page.locator('.annotation-detail h3')).toContainText('重叠 B');await expect(page.getByRole('button',{name:'编辑属性与坐标'})).toHaveCount(0);await expect(page.getByRole('button',{name:'复制到编辑图层'})).toBeVisible();expect(env.errors).toEqual([]);await page.screenshot({path:test.info().outputPath('overlap-read-only-reference.png')});
 }finally{await env.close();}
});

test('explicit saved reference stays read-only and fixed when the current draft advances',async({page})=>{
 const env=await setup(page);try{
  await layer(page);await point(page,'固定旧集合点');const binding=env.lab.annotations!.binding(env.actor,env.session.id);const setId=binding.draft!.setId;
  const objectId=env.lab.annotations!.privateVersion(env.actor,setId,2).document.layers[0]!.features[0]!.objectId;
  const ref={setId,revision:2,objectIds:[objectId]};let fixedReads=0;page.on('request',request=>{if(new URL(request.url()).pathname===`/api/annotations/${setId}/revisions/2`)fixedReads++;});
  await page.goto(`/situation?taskId=${env.task.id}&sessionId=${env.session.id}&annotationRef=${encodeURIComponent(JSON.stringify(ref))}`);
  const detail=page.getByRole('region',{name:'标注对象操作'});await expect(detail.getByRole('heading',{name:'固定旧集合点'})).toBeVisible();await expect(detail).toContainText('只读参考');await expect(detail.getByRole('button',{name:'编辑属性与坐标'})).toHaveCount(0);
  const readsBefore=fixedReads;env.lab.annotations!.action(env.actor,env.session.id,{action:'apply',clientActionId:randomUUID(),expectedRevision:2,operations:[{op:'update_object',objectId,changes:{name:'Agent 更新后的集合点'}}]});
  await page.getByRole('button',{name:'刷新标注',exact:true}).click();await expect(page.locator('.annotation-heading')).toContainText('草稿 r3');await expect(detail.getByRole('heading')).toHaveText('固定旧集合点');await expect(detail).toContainText('r2');expect(fixedReads).toBe(readsBefore);
  await pickOwn(page,'Agent 更新后的集合点 point');await page.getByRole('button',{name:'编辑属性与坐标'}).click();await page.getByLabel('对象名称',{exact:true}).fill('收起后仍保留的输入');
  await page.getByRole('button',{name:'收起对象编辑',exact:true}).click();await expect(page.getByLabel('对象名称',{exact:true})).not.toBeVisible();await page.getByRole('button',{name:'继续对象编辑 · 未保存',exact:true}).click();await expect(page.getByLabel('对象名称',{exact:true})).toHaveValue('收起后仍保留的输入');expect(env.errors).toEqual([]);expect(env.fake.calls).toHaveLength(0);
 }finally{await env.close();}
});


test('layer tree separates expansion visibility and drawing target, including empty layers and fixed references',async({page},testInfo)=>{
 const env=await setup(page);try{
  await expect(page.getByRole('button',{name:'展开来源态势',exact:true})).toHaveAttribute('aria-expanded','false');
  await expect(page.getByRole('button',{name:'展开本会话标注',exact:true})).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('.annotation-sidebar .annotation-tree-row:visible')).toHaveCount(2);
  await expect(page.locator('.annotation-drawing-target')).not.toBeVisible();
  await page.screenshot({path:testInfo.outputPath('collapsed-groups-desktop.png')});
  await layer(page);await point(page);await addLayer(page,'备用区');await addLayer(page,'空白图层');
  const sidebar=page.locator('.annotation-sidebar');const own=page.getByRole('region',{name:/^本会话标注 /});
  const target=sidebar.locator('.annotation-drawing-target');
  await expect(target).toContainText('新标注将添加到：空白图层');
  await expect(own.locator('.annotation-tree-layer')).toHaveCount(3);
  await own.getByRole('button',{name:'展开集合点',exact:true}).click();await own.getByRole('button',{name:'收起集合点',exact:true}).click();
  await own.getByRole('button',{name:'隐藏备用区',exact:true}).click();await expect(target).toContainText('新标注将添加到：空白图层');
  await expect(own.getByRole('button',{name:'显示本会话标注',exact:true})).toHaveAttribute('aria-pressed','mixed');
  await own.getByRole('button',{name:'收起本会话标注',exact:true}).click();await expect(own.locator('.annotation-tree-layer:visible')).toHaveCount(0);await expect(own.getByRole('button',{name:'显示本会话标注',exact:true})).toHaveAttribute('aria-pressed','mixed');
  await own.getByRole('button',{name:'显示本会话标注',exact:true}).click();await own.getByRole('button',{name:'展开本会话标注',exact:true}).click();
  await expect(target).toContainText('新标注将添加到：空白图层');
  const revision=env.lab.annotations!.binding(env.actor,env.session.id).draft!.headRevision;
  await page.getByRole('button',{name:'绘制线',exact:true}).click();await openLayers(page);
  await own.getByRole('button',{name:'隐藏空白图层',exact:true}).click();await expect(target).toContainText('绘制已暂停');await expect(page.getByRole('button',{name:'绘制线',exact:true})).toBeDisabled();
  await target.getByRole('button',{name:'显示并继续',exact:true}).click();await expect(page.getByRole('button',{name:'继续未完成绘制',exact:true})).toBeEnabled();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'退出绘制',exact:true}).click();
  await own.getByRole('button',{name:'隐藏集合点',exact:true}).click();await own.getByRole('button',{name:'设为绘制目标：集合点',exact:true}).click();await expect(target).toContainText('新标注将添加到：集合点');await expect(own.getByRole('button',{name:'隐藏集合点',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(env.lab.annotations!.binding(env.actor,env.session.id).draft!.headRevision).toBe(revision);
  // A lost add response must not select a speculative target or allow a duplicate write.
  await own.getByRole('button',{name:'新建图层',exact:true}).click();await page.getByLabel('新图层名称').fill('回执确认层');env.dropNextAction();await page.getByRole('button',{name:'添加图层',exact:true}).click();
  await expect(page.getByText('保存结果待确认',{exact:true})).toBeVisible();await expect(page.getByLabel('新图层名称')).toHaveValue('回执确认层');await expect(page.getByRole('button',{name:'添加图层',exact:true})).toBeDisabled();await expect(target).toContainText('新标注将添加到：集合点');
  await page.getByRole('button',{name:'查询保存回执',exact:true}).click();await expect(target).toContainText('新标注将添加到：回执确认层');await expect(own.getByRole('button',{name:'隐藏回执确认层',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByLabel('新图层名称')).not.toBeVisible();
  await openVersions(page);await page.getByText('标注集名称与发布',{exact:true}).click();await page.getByLabel('发布名称',{exact:true}).fill('图层固定参考');await page.getByRole('button',{name:'发布此保存修订'}).click();await page.getByText('我的草稿与已发布版本',{exact:true}).click();await page.getByRole('button',{name:'添加发布版参考'}).click();await openLayers(page);
  const ref=page.getByRole('region',{name:'参考标注 图层固定参考'});await expect(ref.getByRole('button',{name:'展开参考标注 图层固定参考',exact:true})).toHaveAttribute('aria-expanded','false');await expect(ref.locator('.annotation-tree-layer')).toHaveCount(4);await expect(ref.locator('.annotation-tree-layer:visible')).toHaveCount(0);await expect(ref.getByRole('button',{name:/设为绘制目标/})).toHaveCount(0);await expect(ref.getByRole('button',{name:'新建图层',exact:true})).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('annotation-layer-tree-desktop.png')});
  await page.setViewportSize({width:350,height:900});
  const eyes=await sidebar.locator('.annotation-tree-eye:visible').evaluateAll(elements=>elements.map(element=>element.getBoundingClientRect().x));expect(Math.max(...eyes)-Math.min(...eyes)).toBeLessThan(1);
  expect(await sidebar.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await groupMore(own);const more=own.locator(':scope > .annotation-tree-row .annotation-tree-more > button');await more.press('Escape');await expect(more).toBeFocused();await expect(sidebar).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('annotation-layer-tree-350.png')});
  // Both trees use one active detail: closing an annotation must not revive the previous source object.
  const sourceItem=mapFixtures('selection','2026-10-11').objects.find(item=>item.ref.objectType==='resource')!;
  await page.route('**/api/context/catalog',route=>route.fulfill({json:{systems:[{id:'situation',name:'选择回归来源',objectTypes:['resource'],capabilities:['situation_current'],areas:[]}]}}));
  await page.route('**/api/context/situation',route=>route.fulfill({json:{systemId:'situation',query:route.request().postDataJSON(),queriedAt:'2026-10-13T00:00:00Z',data:{items:[sourceItem],hasMore:false,nextCursor:null,unknownRefs:[],changeCursor:'1',asOf:'2026-10-13T00:00:00Z'}}}));
  await expandGroup(page,'来源态势');await page.locator('.source-query-controls > summary').click();await page.getByRole('button',{name:'刷新态势',exact:true}).click();await page.getByRole('button',{name:'查看全部获准态势',exact:true}).click();
  await page.getByRole('region',{name:'来源态势',exact:true}).getByRole('button',{name:'展开资源池',exact:true}).click();await page.getByRole('region',{name:'来源态势',exact:true}).getByRole('button',{name:new RegExp(sourceItem.name)}).click();await expect(page.locator('.situation-detail')).toBeVisible();
  await pickOwn(page,'集合点 A point');await expect(page.locator('.situation-detail')).not.toBeVisible();await expect(page.getByRole('region',{name:'标注对象操作'})).toBeVisible();await page.getByRole('button',{name:'关闭标注对象',exact:true}).click();await expect(sidebar).toBeVisible();await expect(page.locator('.situation-detail')).not.toBeVisible();
  expect(env.fake.calls).toHaveLength(0);expect(env.errors).toEqual([]);
 }finally{await env.close();}
});

for (const format of ['legacy','structured'] as const) test(`${format} receipt buttons open fixed read-only targets and stay scoped to the final request after reload`,async({page})=>{
 const env=await setup(page);try{
  const service=env.lab.annotations!;
  const first=service.action(env.actor,env.session.id,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,title:'入口验证',operations:[{op:'add_layer',layer:{layerId:'points',name:'集合点',order:0,defaultVisible:true,features:[{objectId:'point-a',name:'固定集合点',kind:'point',geometry:{type:'Point',coordinates:[103.82,1.30]}}]}}]});
  const firstRef=first.ref!;if(!('setId' in firstRef))throw new Error('Expected private ref');
  service.action(env.actor,env.session.id,{action:'apply',clientActionId:randomUUID(),expectedRevision:1,operations:[{op:'update_object',objectId:'point-a',changes:{name:'最新集合点'}}]});
  const requestId=randomUUID(), otherRequestId=randomUUID();
  const projected=annotationToolResult({...first,objectIds:['point-a']},'annotation_action');
  const snapshot={...env.session,active:null,lastResult:{requestId:otherRequestId,status:'succeeded'},turns:[{requestId,status:'succeeded',finalMessageId:'answer'},{requestId:otherRequestId,status:'succeeded',finalMessageId:'later-answer'}],messages:[
   {id:'user',role:'user',requestId,text:'添加集合点'},
   {id:'receipt',role:'tool',requestId,toolName:'annotation_action',text:format==='legacy'?JSON.stringify({...first,objectIds:['point-a']}):projected.content[0].text,...(format==='structured'?{annotationResult:projected.details.annotationResult}:{})},
   {id:'answer',role:'assistant',requestId,text:'已添加集合点。'},
   {id:'later-user',role:'user',requestId:otherRequestId,text:'继续讨论'},
   {id:'later-answer',role:'assistant',requestId:otherRequestId,text:'本轮没有修改。'},
  ]};
  await page.route(`**/api/sessions/${env.session.id}`,route=>route.fulfill({json:snapshot}));
  await page.goto(`/?session=${env.session.id}`);
  const answer=page.getByLabel('Axon 的回复').filter({hasText:'已添加集合点。'});
  await expect(answer.getByRole('button',{name:/查看本次标注/})).toHaveCount(1);
  await expect(page.getByLabel('Axon 的回复').filter({hasText:'本轮没有修改。'}).getByRole('button',{name:/查看本次标注/})).toHaveCount(0);
  await answer.getByRole('button',{name:/查看本次标注/}).click();
  await expect(page.locator('.annotation-heading')).toContainText('草稿 r2');
  await expect(page.getByRole('region',{name:'标注对象操作'})).toContainText('固定集合点');
  await expect(page.getByRole('region',{name:'标注对象操作'})).toContainText('只读参考');
  expect(service.binding(env.actor,env.session.id).draft!.headRevision).toBe(2);
  await page.reload();await answer.getByRole('button',{name:/查看本次标注/}).click();
  await expect(page.getByRole('region',{name:'标注对象操作'})).toContainText('固定集合点');
  await expect(page.locator('.annotation-heading')).toContainText('草稿 r2');expect(env.errors).toEqual([]);
 }finally{await env.close();}
});

test('basemap switches preserve selected annotations, camera, visibility, and unfinished line/polygon through failure and retry',async({page})=>{
 await captureMap(page);const vector=await localVectorTiles(page);const env=await setup(page,basemapFixture);
 try{
  await layer(page);await point(page);await pickOwn(page,'集合点 A point');
  await expect(page.getByRole('region',{name:'标注对象操作'})).toContainText('集合点 A');
  await expect.poll(()=>page.evaluate(()=>Boolean(window.__basemapTestMap?.loaded()))).toBe(true);
  const canvas=page.locator('.maplibregl-canvas'),original=await canvas.elementHandle();
  const saved=env.lab.annotations!.binding(env.actor,env.session.id);
  const before=await mapSnapshot(page);
  const switcher=page.getByRole('group',{name:'底图视图'});
  for(const name of ['路网','混合','影像','混合','路网','影像'])await switcher.getByRole('button',{name,exact:true}).click();
  await expect(page.getByRole('region',{name:'标注对象操作'})).toContainText('集合点 A');
  expect(await canvas.evaluate((element,old)=>element===old,original)).toBe(true);
  expect(await mapSnapshot(page)).toEqual(before);
  expect(env.lab.annotations!.binding(env.actor,env.session.id)).toEqual(saved);
  await page.getByRole('button',{name:'关闭标注对象',exact:true}).click();
  if(await page.locator('.annotation-sidebar').isVisible())await page.getByRole('button',{name:'关闭图层与对象',exact:true}).click();
  const box=(await canvas.boundingBox())!,x=box.x+box.width/2,y=box.y+box.height/2;
  await page.getByRole('button',{name:'绘制线',exact:true}).click();await page.mouse.click(x-100,y-50);
  const first=await page.evaluate(({x,y})=>window.__basemapTestMap!.unproject([x,y]).toArray(),{x:box.width/2-100,y:box.height/2-50});
  const drawingCamera=await mapSnapshot(page);
  vector.offline();await switcher.getByRole('button',{name:'路网',exact:true}).click();
  // Force a new basemap request while retaining TerraDraw and its first vertex.
  await page.evaluate(()=>{const map=window.__basemapTestMap!;for(const id of Object.keys(map.getStyle().sources))if(id.includes('roads'))(map.getSource(id) as VectorTileSource).setTiles([`${location.origin}/basemap-vector/{z}/{x}/{y}.pbf?failure=1`]);});
  await expect(page.locator('.situation-map-feedback')).toContainText('加载失败');
  await page.screenshot({path:test.info().outputPath('basemap-failure-drawing-retained.png')});
  vector.online();await page.getByRole('button',{name:'重试底图',exact:true}).click();
  await expect.poll(vector.requests).toBeGreaterThan(0);await expect(page.getByRole('button',{name:'重试底图',exact:true})).toHaveCount(0);
  for(const name of ['混合','影像','路网'])await switcher.getByRole('button',{name,exact:true}).click();
  expect(await mapSnapshot(page)).toEqual(drawingCamera);
  await page.mouse.click(x+30,y+10);await page.mouse.dblclick(x+110,y+60);await saveDraw(page);
  await expect(page.locator('.annotation-heading')).toContainText('草稿 r3');
  const lineVersion=env.lab.annotations!.binding(env.actor,env.session.id).draft!;
  const line=env.lab.annotations!.privateVersion(env.actor,lineVersion.setId,3).document.layers[0]!.features.find(f=>f.kind==='line')!;
  expect(line.geometry.type).toBe('LineString');if(line.geometry.type==='LineString'){expect(line.geometry.coordinates[0][0]).toBeCloseTo(first[0],8);expect(line.geometry.coordinates[0][1]).toBeCloseTo(first[1],8);}
  await page.getByRole('button',{name:'绘制面',exact:true}).click();
  await page.mouse.click(x-90,y-70);await page.mouse.click(x+90,y-70);
  await switcher.getByRole('button',{name:'混合',exact:true}).click();await switcher.getByRole('button',{name:'影像',exact:true}).click();
  await page.mouse.click(x+90,y+70);await page.mouse.dblclick(x-90,y+70);await saveDraw(page);await expect(page.locator('.annotation-heading')).toContainText('草稿 r4');
  const final=env.lab.annotations!.binding(env.actor,env.session.id).draft!;
  expect(env.lab.annotations!.privateVersion(env.actor,final.setId,4).document.layers[0]!.features.map(f=>f.kind)).toEqual(['point','line','polygon']);
  await openLayers(page);await expandGroup(page,'本会话标注');await page.getByRole('button',{name:'隐藏集合点',exact:true}).click();
  await switcher.getByRole('button',{name:'路网',exact:true}).click();await switcher.getByRole('button',{name:'混合',exact:true}).click();
  await expect(page.getByRole('button',{name:'显示集合点',exact:true})).toHaveAttribute('aria-pressed','false');await expect(page.locator('.annotation-marker')).toHaveCount(0);
  await page.getByRole('button',{name:'显示集合点',exact:true}).click();await page.reload();
  await expect(switcher.getByRole('button',{name:'混合',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.annotation-heading')).toContainText('草稿 r4');expect(env.errors).toEqual([]);
  await page.screenshot({path:test.info().outputPath('basemap-retained-annotations.png')});
 }finally{await env.close();}
});

test('solid annotation strokes remain painted after hybrid source switches and narrow map controls do not overlap credits',async({page})=>{
 await captureMap(page);await localVectorTiles(page);const env=await setup(page,origin=>({...basemapFixture(origin),defaultView:'hybrid'}));
 try{
  env.lab.annotations!.action(env.actor,env.session.id,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,operations:[{op:'add_layer',layer:{layerId:'solid',name:'实线验证',order:0,defaultVisible:true,features:[{objectId:'line',kind:'line',name:'实线',geometry:{type:'LineString',coordinates:[[116.39,39.904],[116.41,39.904]]},style:{color:'#b34d48',width:4}},{objectId:'area',kind:'polygon',name:'区域',geometry:{type:'Polygon',coordinates:[[[116.394,39.898],[116.406,39.898],[116.406,39.902],[116.394,39.902],[116.394,39.898]]]},style:{color:'#b34d48',width:4}}]}}]});
  await page.getByRole('button',{name:'刷新标注',exact:true}).click();await expect(page.locator('.annotation-heading')).toContainText('草稿 r1');
  await page.getByRole('button',{name:'关闭图层与对象',exact:true}).click();
  for(const name of ['影像','路网','混合','路网','混合']){
   await page.getByRole('group',{name:'底图视图'}).getByRole('button',{name,exact:true}).click();
   await expect.poll(()=>page.evaluate(()=>window.__basemapTestMap!.loaded())).toBe(true);
   const strokes=await page.evaluate(()=>window.__basemapTestMap!.getStyle().layers.filter(layer=>layer.id.startsWith('annotation:')&&layer.type==='line'&&/:solid(?::halo)?$/.test(layer.id)).map(layer=>({id:layer.id,dash:window.__basemapTestMap!.getPaintProperty(layer.id,'line-dasharray')})));
   expect(strokes).toHaveLength(2);expect(strokes.every(layer=>layer.dash===undefined)).toBe(true);
   const buffer=await page.locator('.maplibregl-canvas').screenshot();
   const red=await page.evaluate(async encoded=>{const image=new Image();image.src=`data:image/png;base64,${encoded}`;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d')!;context.drawImage(image,0,0);const data=context.getImageData(0,0,canvas.width,canvas.height).data;let count=0;for(let i=0;i<data.length;i+=4)if(Math.abs(data[i]-179)<3&&Math.abs(data[i+1]-77)<3&&Math.abs(data[i+2]-72)<3)count++;return count;},buffer.toString('base64'));
   expect(red,`${name} must paint the solid red annotation strokes`).toBeGreaterThan(500);
  }
  await page.goto(`/?session=${env.session.id}`);await page.getByRole('button',{name:'打开态势地图',exact:true}).click();
  await page.setViewportSize({width:1280,height:900});const separator=page.getByRole('separator',{name:'调整对话与地图宽度'});await separator.focus();await separator.press('End');
  await expect(page.getByRole('group',{name:'底图视图'})).toBeVisible();
  await openTools(page);const overlap=await page.evaluate(()=>{const box=(selector:string)=>document.querySelector(selector)!.getBoundingClientRect();const a=box('.annotation-editor-toolbar'),b=box('.situation-basemap-switch'),c=box('.situation-attribution');const intersect=(a:DOMRect,b:DOMRect)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;return {toolbarCredits:intersect(a,c),switchCredits:intersect(b,c),toolbarSwitch:intersect(a,b)};});
  expect(overlap).toEqual({toolbarCredits:false,switchCredits:false,toolbarSwitch:false});
  await page.screenshot({path:test.info().outputPath('basemap-narrow-controls.png')});expect(env.errors).toEqual([]);
 }finally{await env.close();}
});

test('hybrid progressively reveals minor service and path roads below business overlays across source overzoom',async({page})=>{
 await captureMap(page);await localVectorTiles(page,'basemap-road-hierarchy.pbf');
 const env=await setup(page,origin=>({...basemapFixture(origin),defaultView:'hybrid'}));
 try{
  env.lab.annotations!.action(env.actor,env.session.id,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,operations:[{op:'add_layer',layer:{layerId:'hierarchy',name:'道路层级验证',order:0,defaultVisible:true,features:[{objectId:'rescue-line',kind:'line',name:'合成业务线',geometry:{type:'LineString',coordinates:[[0,-.006],[0,.006]]},style:{color:'#b34d48',width:5}}]}}]});
  await page.getByRole('button',{name:'刷新标注',exact:true}).click();await expect(page.locator('.annotation-heading')).toContainText('草稿 r1');
  if(await page.locator('.annotation-sidebar').isVisible())await page.getByRole('button',{name:'关闭图层与对象',exact:true}).click();
  const canvas=page.locator('.maplibregl-canvas'),original=await canvas.elementHandle();
  const paintedClasses=()=>page.evaluate(()=>[...new Set(window.__basemapTestMap!.queryRenderedFeatures().filter(f=>f.layer.id.includes(':hybrid:')&&f.sourceLayer==='transportation').map(f=>String(f.properties.class)))].sort());
  for(const [zoom,expected] of [[12.75,['primary']],[13.25,['minor','primary']],[14.25,['minor','primary','service']],[15.25,['minor','path','primary','service','track']],[16.25,['minor','path','primary','service','track']]] as const){
   await page.evaluate(zoom=>window.__basemapTestMap!.jumpTo({center:[0,0],zoom}),zoom);
   await expect.poll(()=>page.evaluate(()=>window.__basemapTestMap!.loaded())).toBe(true);
   await expect.poll(paintedClasses,{message:`hybrid road classes at zoom ${zoom}`}).toEqual([...expected]);
  }
  await expect(page.getByText('测试路网 原生细节最高 14 级；当前为放大显示。', {exact:true})).toBeVisible();
  const before=await mapSnapshot(page),saved=env.lab.annotations!.binding(env.actor,env.session.id);
  const controls=page.getByRole('group',{name:'底图视图'});
  for(const view of ['路网','混合','影像','混合'])await controls.getByRole('button',{name:view,exact:true}).click();
  await expect.poll(paintedClasses).toEqual(['minor','path','primary','service','track']);
  expect(await mapSnapshot(page)).toEqual(before);expect(env.lab.annotations!.binding(env.actor,env.session.id)).toEqual(saved);
  expect(await canvas.evaluate((element,old)=>element===old,original)).toBe(true);
  expect(await page.evaluate(()=>{const layers=window.__basemapTestMap!.getStyle().layers,anchor=layers.findIndex(layer=>layer.id==='business:anchor');return layers.every((layer,index)=>!layer.id.startsWith('basemap:')||index<anchor);})).toBe(true);
  const screenshot=await canvas.screenshot();
  const red=await page.evaluate(async encoded=>{const image=new Image();image.src=`data:image/png;base64,${encoded}`;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d')!;context.drawImage(image,0,0);const data=context.getImageData(0,0,canvas.width,canvas.height).data;let count=0;for(let i=0;i<data.length;i+=4)if(Math.abs(data[i]-179)<3&&Math.abs(data[i+1]-77)<3&&Math.abs(data[i+2]-72)<3)count++;return count;},screenshot.toString('base64'));
  expect(red,'business stroke remains visible over the full detail road hierarchy').toBeGreaterThan(500);
  await page.screenshot({path:test.info().outputPath('hybrid-progressive-road-hierarchy.png')});expect(env.errors).toEqual([]);
 }finally{await env.close();}
});

test('native streamed publication result and reloaded history open the same fixed version',async({page})=>{
 const env=await setup(page,undefined,(_context,index)=>index===0?{tools:[{name:'annotation_action',arguments:{action:'publish',revision:1,title:'流式发布版'}}]}:{text:'已发布固定标注。'});
 try{
  env.lab.annotations!.action(env.actor,env.session.id,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,operations:[{op:'add_layer',layer:{layerId:'points',name:'位置',order:0,defaultVisible:true,features:[{objectId:'north',kind:'point',name:'流式固定对象',geometry:{type:'Point',coordinates:[103.82,1.30]}}]}}]});
  await page.goto(`/?session=${env.session.id}`);
  await page.getByRole('textbox',{name:'发送消息',exact:true}).fill('发布当前标注');await page.getByRole('button',{name:'发送消息',exact:true}).click();
  const reply=page.getByLabel('Axon 的回复').filter({hasText:'已发布固定标注。'}),button=reply.getByRole('button',{name:/查看发布标注/});
  const selectPublished=async()=>{await openLayers(page);await expandGroup(page,'参考标注 流式发布版');const group=page.getByRole('region',{name:'参考标注 流式发布版'});const layer=group.getByRole('button',{name:'展开位置',exact:true});if(await layer.isVisible())await layer.click();await group.getByRole('button',{name:'流式固定对象 point',exact:true}).click();};
  await expect(button).toBeVisible();await button.click();await selectPublished();
  await expect(page.getByRole('region',{name:'标注对象操作'})).toContainText('流式固定对象');
  await expect(page.getByRole('region',{name:'标注对象操作'})).toContainText('只读参考');
  const snapshot=env.lab.get(env.session.id,'a'),receipt=snapshot.messages.find(message=>message.toolName==='annotation_action')!.annotationResult!.receipt;
  expect(receipt.ref).toHaveProperty('publicationId');expect(env.lab.annotations!.current(env.actor,env.task.id).sequence).toBe(0);
  env.lab.annotations!.action(env.actor,env.session.id,{action:'apply',clientActionId:randomUUID(),expectedRevision:1,operations:[{op:'update_object',objectId:'north',changes:{name:'后续草稿对象'}}]});
  await page.reload();await expect(button).toBeVisible();await button.click();await selectPublished();
  await expect(page.getByRole('region',{name:'标注对象操作'})).toContainText('流式固定对象');
  await expect(page.locator('.annotation-heading')).toContainText('草稿 r2');
  expect(env.lab.get(env.session.id,'a').messages.find(message=>message.toolName==='annotation_action')!.annotationResult!.receipt).toEqual(receipt);
  expect(env.errors).toEqual([]);
 }finally{await env.close();}
});

test('single map tools pause incomplete geometry, retain form and preview, without implicit writes',async({page})=>{
 await captureMap(page);const env=await setup(page);
 try {
  await page.getByRole('button',{name:'收起标绘工具',exact:true}).click();const beforeEmpty=env.requests.filter(r=>r.path.endsWith('/annotation/actions')).length;
  await openTools(page);await page.getByRole('button',{name:'收起标绘工具',exact:true}).click();expect(env.requests.filter(r=>r.path.endsWith('/annotation/actions'))).toHaveLength(beforeEmpty);expect(env.lab.annotations!.binding(env.actor,env.session.id).draft).toBeNull();
  await layer(page);await openTools(page);await page.getByRole('button',{name:'绘制线',exact:true}).click();
  const canvas=page.locator('.maplibregl-canvas'),original=await canvas.elementHandle();let box=(await canvas.boundingBox())!;
  await page.mouse.click(box.x+box.width*.35,box.y+box.height*.45);
  const first=await page.evaluate(({x,y})=>window.__basemapTestMap!.unproject([x,y]).toArray(),{x:box.width*.35,y:box.height*.45});
  const before=await mapSnapshot(page),writes=env.requests.filter(r=>r.path.endsWith('/annotation/actions')).length;
  await page.getByRole('button',{name:'收起标绘工具',exact:true}).click();
  expect(await mapSnapshot(page)).toEqual(before);expect(await canvas.evaluate((element,old)=>element===old,original)).toBe(true);
  expect(await page.evaluate(()=>window.__basemapTestMap!.dragPan.isEnabled())).toBe(true);
  expect(await page.evaluate(()=>window.__basemapTestMap!.getStyle().layers.filter(l=>l.id.startsWith('annotation-editor-')).every(l=>l.layout?.visibility==='none'))).toBe(true);
  await openTools(page);await expect(page.getByRole('button',{name:'继续未完成绘制',exact:true})).toBeVisible();
  expect(env.requests.filter(r=>r.path.endsWith('/annotation/actions'))).toHaveLength(writes);
  await page.getByRole('button',{name:'继续未完成绘制',exact:true}).click();box=(await canvas.boundingBox())!;
  await page.mouse.click(box.x+box.width*.55,box.y+box.height*.5);await page.mouse.dblclick(box.x+box.width*.65,box.y+box.height*.6);
  await expect(page.getByRole('button',{name:'保存对象',exact:true})).toBeVisible();expect(env.lab.annotations!.binding(env.actor,env.session.id).draft!.headRevision).toBe(1);
  await page.getByLabel('对象名称',{exact:true}).fill('拟定水域接近路线');await page.getByLabel('路线末端').selectOption('arrow');
  await page.getByRole('button',{name:'标绘工具',exact:true}).click();await expect(page.locator('.annotation-tools-dock')).toBeHidden();await expect(page.locator('.annotation-label')).toContainText('未保存 · 拟定水域接近路线');
  await openLayers(page);await page.getByLabel('草稿 / 未保存预览',{exact:true}).uncheck();await expect(page.locator('.annotation-label')).toHaveCount(0);await page.getByLabel('草稿 / 未保存预览',{exact:true}).check();
  await openTools(page);await expect(page.getByLabel('对象名称',{exact:true})).toHaveValue('拟定水域接近路线');await saveDraw(page);
  const binding=env.lab.annotations!.binding(env.actor,env.session.id);const feature=env.lab.annotations!.privateVersion(env.actor,binding.draft!.setId,2).document.layers[0]!.features[0]!;
  expect(feature.informationRole).toBe('plan');expect(feature.style?.lineEnd).toBe('arrow');expect(feature.geometry.type).toBe('LineString');if(feature.geometry.type==='LineString'){expect(feature.geometry.coordinates[0][0]).toBeCloseTo(first[0],5);expect(feature.geometry.coordinates[0][1]).toBeCloseTo(first[1],5);expect(feature.geometry.coordinates).toHaveLength(3);}
  await page.evaluate(()=>window.__basemapTestMap!.setBearing(40));await expect(page.locator('.annotation-line-arrow')).toBeVisible();expect(env.errors).toEqual([]);
  await page.screenshot({path:test.info().outputPath('single-map-retained-draft.png')});
 } finally {await env.close();}
});

test('professional symbols keep identity, orientation and information role through editing and overlapping selection',async({page})=>{
 await captureMap(page);const env=await setup(page);
 try {
  await layer(page);await expect(page.getByRole('group',{name:'专业标号目录'}).getByRole('button')).toHaveCount(22);
  const symbols=[['水罐消防车','xf3013-2020.6.2.1'],['救护车','xf3013-2020.6.2.30'],['消防艇','xf3013-2020.6.2.37'],['冲锋舟','app.rescue-inflatable-boat'],['救援舰船','app.rescue-vessel']] as const;
  for(const [name,id] of symbols){
   await page.getByRole('button',{name:'坐标新增',exact:true}).click();await page.getByText('更换专业标号',{exact:true}).click();await page.getByLabel('查找专业标号').fill(name);await page.getByRole('group',{name:'专业标号目录'}).getByRole('button',{name:new RegExp(`^${name}`)}).click();await page.getByLabel('对象名称',{exact:true}).fill(name);await page.getByLabel('图标尺寸（px）').fill('48');await page.getByLabel('真北方向（°）').fill('30');await saveDraw(page);
   const binding=env.lab.annotations!.binding(env.actor,env.session.id);const feature=env.lab.annotations!.privateVersion(env.actor,binding.draft!.setId,binding.draft!.headRevision).document.layers[0]!.features.at(-1)!;expect(feature.style).toMatchObject({symbolId:id,iconSize:48,heading:30});expect(feature.informationRole).toBe('plan');
  }
  await page.evaluate(()=>window.__basemapTestMap!.jumpTo({center:[116.4,39.9],zoom:14}));
  await page.getByRole('button',{name:'收起标绘工具',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__basemapTestMap!.queryRenderedFeatures().filter(f=>f.layer.id.includes(':symbols:')).length)).toBeGreaterThanOrEqual(5);
  const position=await page.evaluate(()=>{const p=window.__basemapTestMap!.project([116.4,39.9]);return {x:p.x,y:p.y};});const box=(await page.locator('.maplibregl-canvas').boundingBox())!;await page.mouse.click(box.x+position.x,box.y+position.y);
  await expect(page.getByText('此处有多个标注，请选择',{exact:true})).toBeVisible();await expect(page.locator('.annotation-overlap>button')).toHaveCount(5);
  await page.screenshot({path:test.info().outputPath('professional-symbol-overlap.png')});
  await page.getByRole('button',{name:'关闭重叠对象选择',exact:true}).click();
  const binding=env.lab.annotations!.binding(env.actor,env.session.id);const features=env.lab.annotations!.privateVersion(env.actor,binding.draft!.setId,binding.draft!.headRevision).document.layers[0]!.features;
  env.lab.annotations!.action(env.actor,env.session.id,{action:'apply',clientActionId:randomUUID(),expectedRevision:binding.draft!.headRevision,operations:features.map((feature,index)=>({op:'update_object' as const,objectId:feature.objectId,changes:{geometry:{type:'Point' as const,coordinates:[116.39+index*.004,39.9+(index%2)*.003] as [number,number]}}}))});
  await page.getByRole('button',{name:'刷新标注',exact:true}).click();await expect(page.locator('.annotation-heading')).toContainText('草稿 r7');
  await openLayers(page);const own=page.getByRole('region',{name:/^本会话标注 /});await groupMore(own);await own.getByRole('button',{name:'定位此组',exact:true}).click();await page.getByRole('button',{name:'关闭图层与对象',exact:true}).click();await page.evaluate(()=>window.__basemapTestMap!.jumpTo({center:[116.398,39.9015],zoom:14}));
  await page.screenshot({path:test.info().outputPath('professional-single-map-closed.png')});
  await openTools(page);await page.screenshot({path:test.info().outputPath('professional-single-map-open.png')});
  await page.setViewportSize({width:1000,height:900});await page.screenshot({path:test.info().outputPath('professional-single-map-narrow.png')});
  expect(env.lab.annotations!.current(env.actor,env.task.id).sequence).toBe(0);
  await openVersions(page);await page.getByText('标注集名称与发布',{exact:true}).click();await page.getByLabel('发布名称',{exact:true}).fill('消防与水域救援部署');await page.getByRole('button',{name:'发布此保存修订',exact:true}).click();await expect(page.getByRole('alert')).toContainText('任务当前标注保持不变');
  expect(env.lab.annotations!.current(env.actor,env.task.id).sequence).toBe(0);
  await page.getByText('我的草稿与已发布版本',{exact:true}).click();await page.getByRole('button',{name:'比较并设为当前',exact:true}).click();await page.getByRole('button',{name:'设为当前标注',exact:true}).click();
  await expect.poll(()=>env.lab.annotations!.current(env.actor,env.task.id).sequence).toBe(1);
  const publication=env.lab.annotations!.current(env.actor,env.task.id).publication!;
  const fixed=env.lab.annotations!.publishedVersion(env.actor,publication.publicationId);
  expect(fixed.document.layers[0]!.features.map(feature=>feature.informationRole)).toEqual(['plan','plan','plan','plan','plan']);
  expect(fixed.document.layers[0]!.features.map(feature=>feature.style?.symbolId)).toEqual(symbols.map(([,id])=>id));expect(env.errors).toEqual([]);
 } finally {await env.close();}
});

test('source polling and inspection preserve the independent draft target, form and revision',async({page})=>{
 await page.clock.install();await captureMap(page);const env=await setup(page);
 try {
  let revision=1,queries=0;const sourceItem=mapFixtures('parallel-source','2026-10-11').objects.find(item=>item.ref.objectType==='resource')!;
  await page.route('**/api/context/catalog',route=>route.fulfill({json:{systems:[{id:sourceItem.ref.systemId,name:'刷新验证来源',objectTypes:['resource'],capabilities:['situation_current'],areas:[]}]}}));
  await page.route('**/api/context/situation',route=>{queries++;return route.fulfill({json:{systemId:sourceItem.ref.systemId,query:route.request().postDataJSON(),queriedAt:'2026-10-25T03:00:00Z',data:{items:[{...sourceItem,revision,geometry:{type:'Point',coordinates:[116.4+revision*.001,39.9]}}],hasMore:false,nextCursor:null,unknownRefs:[],changeCursor:String(revision),asOf:'2026-10-25T03:00:00Z'}}});});
  await openLayers(page);await expandGroup(page,'来源态势');await page.locator('.source-query-controls > summary').click();await page.getByRole('button',{name:'刷新态势',exact:true}).click();await page.getByRole('button',{name:'查看全部获准态势',exact:true}).click();await expect.poll(()=>queries).toBeGreaterThan(0);
  await layer(page);await page.getByRole('button',{name:'坐标新增',exact:true}).click();await page.getByLabel('对象名称',{exact:true}).fill('保持中的部署输入');
  const binding=env.lab.annotations!.binding(env.actor,env.session.id);const writes=env.requests.filter(r=>r.path.endsWith('/annotation/actions')).length;
  const camera=await mapSnapshot(page);const before=queries;revision=2;await page.clock.fastForward(16000);await expect.poll(()=>queries).toBeGreaterThan(before);await expect.poll(async()=>JSON.stringify((await mapSnapshot(page)).business)).toContain('116.402');expect({...await mapSnapshot(page),business:null}).toEqual({...camera,business:null});
  await expect(page.getByLabel('对象名称',{exact:true})).toHaveValue('保持中的部署输入');expect(env.lab.annotations!.binding(env.actor,env.session.id)).toEqual(binding);expect(env.requests.filter(r=>r.path.endsWith('/annotation/actions'))).toHaveLength(writes);
  await openLayers(page);const source=page.getByRole('region',{name:'来源态势',exact:true});await source.getByRole('button',{name:'展开资源池',exact:true}).click();await source.getByRole('button',{name:new RegExp(sourceItem.name)}).click();await expect(page.locator('.situation-detail')).toBeVisible();await expect(page.getByLabel('对象名称',{exact:true})).not.toBeVisible();
  await page.getByRole('button',{name:'继续对象编辑 · 未保存',exact:true}).click();await expect(page.getByLabel('对象名称',{exact:true})).toHaveValue('保持中的部署输入');await expect(page.getByLabel('所属图层')).toContainText('集合点');expect(env.errors).toEqual([]);
 } finally {await env.close();}
});


test('entry hints explain global, task and editable conversation maps without creating drafts',async({page})=>{
 const env=await setup(page);
 try {
  await expect(page.getByLabel('标绘上下文')).toContainText('标注验证任务');
  await expect(page.getByLabel('标绘上下文')).toContainText('本会话草稿 · 可编辑');
  const writes=env.requests.filter(r=>r.path.endsWith('/annotation/actions')).length;
  await page.goto('/situation');
  await expect(page.getByLabel('全局态势入口')).toContainText('全局态势 · 只读');
  await expect(page.getByRole('button',{name:'标绘工具',exact:true})).toHaveCount(0);
  await page.getByRole('combobox',{name:'进入任务',exact:true}).selectOption(env.task.id);
  await expect(page.getByRole('region',{name:'任务详情',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'态势',exact:true}).click();
  await expect(page.getByLabel('标绘上下文')).toContainText('任务当前方案 · 只读');
  await openTools(page);await expect(page.getByRole('button',{name:'绘制点',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'进入任务选择会话',exact:true}).click();
  await expect(page.getByRole('button',{name:'任务说明',exact:true})).toHaveAttribute('aria-current','page');
  expect(env.requests.filter(r=>r.path.endsWith('/annotation/actions'))).toHaveLength(writes);
  expect(env.lab.annotations!.binding(env.actor,env.session.id).draft).toBeNull();
  expect(env.errors).toEqual([]);
 } finally {await env.close();}
});

test('symbol selection places directly, compact properties retain drafts, and saves preserve the camera',async({page})=>{
 await captureMap(page);const env=await setup(page);
 try {
  await page.getByRole('button',{name:'新建标绘图层',exact:true}).click();
  await page.getByLabel('新图层名称').fill('集合点');await page.getByRole('button',{name:'添加图层',exact:true}).click();
  await expect(page.locator('.annotation-heading')).toContainText('草稿 r1');
  await page.evaluate(()=>window.__basemapTestMap!.jumpTo({center:[116.4,39.9],zoom:12,bearing:27,pitch:35}));
  const camera=async()=>{const {center,zoom,bearing,pitch}=await mapSnapshot(page);return {center,zoom,bearing,pitch};};
  await page.getByRole('group',{name:'专业标号目录'}).getByRole('button',{name:'水罐消防车 标准 6.2.1',exact:true}).click();
  await expect(page.getByRole('button',{name:'绘制点',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('group',{name:'专业标号目录'}).getByRole('button',{name:'救护车 标准 6.2.30',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'使用普通点',exact:true})).toBeDisabled();
  const canvas=page.locator('.maplibregl-canvas');const box=(await canvas.boundingBox())!;
  await page.mouse.click(box.x+box.width*.4,box.y+box.height*.55);
  await expect(page.getByLabel('对象名称',{exact:true})).toHaveValue('水罐消防车');
  await expect(page.getByLabel('真北方向（°）')).toBeVisible();
  await expect(page.getByLabel('图标尺寸（px）')).toBeVisible();
  await expect(page.getByLabel('坐标 JSON（经度在前）')).not.toBeVisible();
  await expect(page.getByRole('group',{name:'专业标号目录'})).not.toBeVisible();
  await page.getByText('更换专业标号',{exact:true}).click();
  await page.getByRole('group',{name:'专业标号目录'}).getByRole('button',{name:'救护车 标准 6.2.30',exact:true}).click();
  await expect(page.getByRole('button',{name:'退出绘制',exact:true})).toHaveCount(0);
  await page.getByText('更换专业标号',{exact:true}).click();
  await page.getByLabel('对象名称',{exact:true}).fill('救护车体验');await page.getByLabel('真北方向（°）').fill('42');
  await page.setViewportSize({width:1000,height:900});
  await expect(page.getByRole('button',{name:'保存对象',exact:true})).toBeInViewport({ratio:1});
  await page.getByText('更多样式',{exact:true}).click();await page.getByLabel('地图标签',{exact:true}).fill('窄面板最后一项');
  await page.getByLabel('地图标签',{exact:true}).scrollIntoViewIfNeeded();await expect(page.getByLabel('地图标签',{exact:true})).toBeInViewport({ratio:1});
  await expect(page.getByRole('button',{name:'保存对象',exact:true})).toBeInViewport({ratio:1});
  await page.screenshot({path:test.info().outputPath('compact-properties-narrow.png')});
  const before=await camera();await saveDraw(page);expect(await camera()).toEqual(before);
  const binding=env.lab.annotations!.binding(env.actor,env.session.id);const saved=env.lab.annotations!.privateVersion(env.actor,binding.draft!.setId,binding.draft!.headRevision).document.layers[0]!.features[0]!;
  expect(saved.style).toMatchObject({symbolId:'xf3013-2020.6.2.30',heading:42,label:'窄面板最后一项'});
  await page.setViewportSize({width:1440,height:960});await pickOwn(page,'救护车体验 point');
  await page.getByRole('button',{name:'编辑属性与坐标',exact:true}).click();
  await page.evaluate(()=>window.__basemapTestMap!.jumpTo({center:[116.42,39.92],zoom:11,bearing:63,pitch:20}));
  await page.getByLabel('对象名称',{exact:true}).fill('救护车已修改');
  const editingCamera=await camera();await saveDraw(page);expect(await camera()).toEqual(editingCamera);
  await pickOwn(page,'救护车已修改 point');
  expect((await camera()).zoom).not.toBe(editingCamera.zoom);
  await page.getByRole('button',{name:'编辑属性与坐标',exact:true}).click();
  await page.screenshot({path:test.info().outputPath('compact-properties-wide.png')});
  expect(env.errors).toEqual([]);
 } finally {await env.close();}
});


test('read-only entry after a refresh failure still guards unsaved plotting input',async({page})=>{
 const env=await setup(page);
 try {
  await layer(page);await page.getByRole('button',{name:'坐标新增',exact:true}).click();
  await page.getByLabel('对象名称',{exact:true}).fill('刷新失败后保留的输入');
  const origin=page.url();const writes=env.requests.filter(r=>r.path.endsWith('/annotation/actions')).length;
  await page.route(`**/api/sessions/${env.session.id}/annotation`,route=>route.abort());
  await page.getByRole('button',{name:'刷新标注',exact:true}).click();
  await expect(page.getByLabel('标绘上下文')).toContainText('本会话 · 只读');
  let dismissed=false;
  page.once('dialog',dialog=>{dismissed=true;void dialog.dismiss();});
  await page.getByRole('button',{name:'进入任务选择会话',exact:true}).click();
  expect(dismissed).toBe(true);await expect(page).toHaveURL(origin);
  await expect(page.getByLabel('对象名称',{exact:true})).toHaveValue('刷新失败后保留的输入');
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'进入任务选择会话',exact:true}).click();
  await expect(page.getByRole('region',{name:'任务详情',exact:true})).toBeVisible();
  expect(env.requests.filter(r=>r.path.endsWith('/annotation/actions'))).toHaveLength(writes);
  expect(env.errors).toEqual([]);
 } finally {await env.close();}
});

async function rotationCamera(page:Page){const {center,zoom,bearing,pitch}=await mapSnapshot(page);return {center,zoom,bearing,pitch};}
async function rotationPoint(page:Page){
 return page.evaluate(()=>{const map=window.__basemapTestMap!;const source=map.getSource('annotation:preview:preview') as import('maplibre-gl').GeoJSONSource;const feature=(source.serialize().data as unknown as {features:Array<{geometry:{coordinates:[number,number]};properties:{rotation:number}}>}).features[0]!;const p=map.project(feature.geometry.coordinates),box=map.getContainer().getBoundingClientRect();return {coordinates:feature.geometry.coordinates,x:p.x+box.left,y:p.y+box.top,rotation:feature.properties.rotation};});
}
async function dragRotation(page:Page,delta:number){
 const handle=page.getByRole('button',{name:'旋转标号方向',exact:true}),box=(await handle.boundingBox())!,point=await rotationPoint(page);
 const x=box.x+box.width/2,y=box.y+box.height/2,angle=Math.atan2(x-point.x,point.y-y),radius=Math.hypot(x-point.x,y-point.y);
 await page.mouse.move(x,y);await page.mouse.down();
 for(let step=1;step<=8;step++)await page.mouse.move(point.x+Math.sin(angle+delta*Math.PI/180*step/8)*radius,point.y-Math.cos(angle+delta*Math.PI/180*step/8)*radius);
 await page.mouse.up();
}

test('rotation handle shares the numeric draft, preserves camera and coordinates, and saves only explicitly',async({page})=>{
 await captureMap(page);const env=await setup(page);
 try{
  await layer(page);await page.getByRole('button',{name:'关闭图层与对象',exact:true}).click();await page.evaluate(()=>window.__basemapTestMap!.jumpTo({center:[116.4,39.9],zoom:12}));
  await page.getByRole('group',{name:'专业标号目录'}).getByRole('button',{name:'水罐消防车 标准 6.2.1',exact:true}).click();
  const canvas=page.locator('.maplibregl-canvas'),box=(await canvas.boundingBox())!;await page.mouse.click(box.x+box.width*.43,box.y+box.height*.42);
  const angle=page.getByLabel('真北方向（°）'),handle=page.getByRole('button',{name:'旋转标号方向',exact:true});
  await expect(handle).toBeVisible();await expect(angle).toHaveValue('');await expect(page.locator('.annotation-rotation-angle')).toHaveText('真北 90°');
  const initial=await rotationPoint(page),before=await rotationCamera(page),writes=env.requests.filter(r=>r.path.endsWith('/annotation/actions')).length;
  const originalHandle=await handle.elementHandle();await handle.click({position:{x:5,y:15}});await expect(angle).toHaveValue('');
  await dragRotation(page,45);await expect.poll(async()=>Number(await angle.inputValue())).toBeCloseTo(135,0);
  expect(await handle.evaluate((element,original)=>element===original,originalHandle)).toBe(true);expect((await rotationPoint(page)).coordinates).toEqual(initial.coordinates);
  expect(await rotationCamera(page)).toEqual(before);
  expect(env.requests.filter(r=>r.path.endsWith('/annotation/actions'))).toHaveLength(writes);
  await angle.fill('359');await dragRotation(page,2);await expect.poll(async()=>Number(await angle.inputValue())).toBeCloseTo(1,0);
  await angle.fill('0');await expect(page.locator('.annotation-rotation-angle')).toHaveText('真北 0°');
  await page.getByLabel('图标尺寸（px）').fill('64');
  for(const camera of [{bearing:0,pitch:0,heading:0},{bearing:35,pitch:50,heading:90},{bearing:123,pitch:60,heading:359}]){
   await page.evaluate(({bearing,pitch})=>window.__basemapTestMap!.jumpTo({bearing,pitch}),camera);await angle.fill(String(camera.heading));
   await expect.poll(async()=>(await rotationPoint(page)).rotation).toBe((camera.heading+270)%360);
   const tiltedCamera=await rotationCamera(page);await dragRotation(page,15);await expect.poll(async()=>Number(await angle.inputValue())).toBeCloseTo((camera.heading+15)%360,0);expect(await rotationCamera(page)).toEqual(tiltedCamera);expect((await rotationPoint(page)).coordinates).toEqual(initial.coordinates);
   await expect.poll(()=>page.evaluate(()=>window.__basemapTestMap!.loaded())).toBe(true);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const location=await rotationPoint(page),h=(await handle.boundingBox())!,expected=Math.atan2(h.x+h.width/2-location.x,location.y-h.y-h.height/2);
   const pixels=await canvas.screenshot({path:test.info().outputPath(`rotation-pixels-${camera.bearing}.png`)});
   const principal=await page.evaluate(async encoded=>{const image=new Image();image.src=`data:image/png;base64,${encoded}`;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const context=c.getContext('2d')!;context.drawImage(image,0,0);const data=context.getImageData(0,0,c.width,c.height).data;const points:Array<[number,number]>=[];for(let i=0;i<data.length;i+=4)if(data[i]>190&&data[i+1]<80&&data[i+2]<80)points.push([(i/4)%c.width,Math.floor(i/4/c.width)]);const mx=points.reduce((s,p)=>s+p[0],0)/points.length,my=points.reduce((s,p)=>s+p[1],0)/points.length;let xx=0,yy=0,xy=0;for(const [x,y]of points){xx+=(x-mx)**2;yy+=(y-my)**2;xy+=(x-mx)*(y-my);}return {count:points.length,axis:Math.atan2(2*xy,xx-yy)/2};},pixels.toString('base64'));
   expect(principal.count).toBeGreaterThan(40);expect(Math.abs(Math.cos(principal.axis-(expected-Math.PI/2))),JSON.stringify({camera,principal,expected,location})).toBeGreaterThan(.97);
  }
  await angle.fill('42');await page.screenshot({path:test.info().outputPath('rotation-wide.png')});
  await page.setViewportSize({width:1000,height:900});await expect(handle).toBeInViewport({ratio:1});await page.screenshot({path:test.info().outputPath('rotation-narrow.png')});
  await page.getByLabel('对象名称',{exact:true}).fill('旋转消防车');const savedCamera=await rotationCamera(page);await saveDraw(page);await expect(handle).not.toBeVisible();expect(await rotationCamera(page)).toEqual(savedCamera);
  const binding=env.lab.annotations!.binding(env.actor,env.session.id),feature=env.lab.annotations!.privateVersion(env.actor,binding.draft!.setId,2).document.layers[0]!.features[0]!;
  expect(feature.style?.heading).toBe(42);expect(feature.geometry.coordinates).toEqual(initial.coordinates);
  await page.setViewportSize({width:1440,height:960});await pickOwn(page,'旋转消防车 point');await page.getByRole('button',{name:'编辑属性与坐标',exact:true}).click();await dragRotation(page,70);page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'取消编辑',exact:true}).click();await expect(handle).not.toBeVisible();
  expect(env.lab.annotations!.binding(env.actor,env.session.id).draft!.headRevision).toBe(2);expect(env.lab.annotations!.privateVersion(env.actor,binding.draft!.setId,2).document.layers[0]!.features[0]!.style?.heading).toBe(42);
  await pickOwn(page,'旋转消防车 point');await page.getByRole('button',{name:'编辑属性与坐标',exact:true}).click();await handle.click({position:{x:5,y:15}});await expect(angle).toHaveValue('42');await expect(page.locator('.annotation-heading')).not.toContainText('未保存');
  await page.getByRole('button',{name:'收起对象编辑',exact:true}).click();await openLayers(page);await page.getByLabel('草稿 / 未保存预览',{exact:true}).uncheck();await pickOwn(page,'旋转消防车 point');await page.getByRole('button',{name:'拖动及顶点编辑',exact:true}).click();await openLayers(page);await page.getByLabel('草稿 / 未保存预览',{exact:true}).check();await page.getByRole('button',{name:'继续对象编辑',exact:true}).click();await expect(handle).not.toBeVisible();expect(env.errors).toEqual([]);
 }finally{await env.close();}
});

test('rotation guards restore pointer and gesture state across pause, hidden previews and symbol changes',async({page})=>{
 await captureMap(page);const env=await setup(page);
 try{
  await layer(page);await page.getByRole('button',{name:'关闭图层与对象',exact:true}).click();await page.evaluate(()=>window.__basemapTestMap!.jumpTo({center:[116.4,39.9],zoom:12}));
  await page.getByRole('group',{name:'专业标号目录'}).getByRole('button',{name:'水罐消防车 标准 6.2.1',exact:true}).click();
  const canvas=page.locator('.maplibregl-canvas'),box=(await canvas.boundingBox())!;await page.mouse.click(box.x+box.width*.43,box.y+box.height*.42);
  const handle=page.getByRole('button',{name:'旋转标号方向',exact:true}),angle=page.getByLabel('真北方向（°）');await expect(handle).toBeVisible();
  await page.evaluate(()=>window.__basemapTestMap!.scrollZoom.disable());
  const h=(await handle.boundingBox())!;await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();
  expect(await page.evaluate(()=>window.__basemapTestMap!.dragPan.isEnabled())).toBe(false);
  await handle.dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();
  expect(await page.evaluate(()=>({pan:window.__basemapTestMap!.dragPan.isEnabled(),scroll:window.__basemapTestMap!.scrollZoom.isEnabled()}))).toEqual({pan:true,scroll:false});await expect(angle).toHaveValue('');
  await dragRotation(page,30);await expect.poll(async()=>Number(await angle.inputValue())).toBeCloseTo(120,0);
  let activeHandle=(await handle.boundingBox())!;await page.mouse.move(activeHandle.x+15,activeHandle.y+15);await page.mouse.down();await handle.evaluate(element=>element.releasePointerCapture(1));await page.mouse.up();expect(await page.evaluate(()=>window.__basemapTestMap!.dragPan.isEnabled())).toBe(true);
  activeHandle=(await handle.boundingBox())!;await page.mouse.move(activeHandle.x+15,activeHandle.y+15);await page.mouse.down();await page.getByRole('button',{name:'标绘工具',exact:true}).evaluate(element=>(element as HTMLButtonElement).click());await page.mouse.up();await expect(handle).not.toBeVisible();expect(await page.evaluate(()=>window.__basemapTestMap!.dragPan.isEnabled())).toBe(true);await openTools(page);
  const cameraBeforePan=await rotationCamera(page);await page.mouse.move(box.x+80,box.y+100);await page.mouse.down();await page.mouse.move(box.x+125,box.y+125,{steps:5});await page.mouse.up();await expect.poll(async()=>(await rotationCamera(page)).center).not.toEqual(cameraBeforePan.center);await page.evaluate(camera=>window.__basemapTestMap!.jumpTo({center:camera.center as [number,number],zoom:camera.zoom,bearing:camera.bearing,pitch:camera.pitch}),cameraBeforePan);
  await page.getByRole('button',{name:'标绘工具',exact:true}).click();await expect(handle).not.toBeVisible();await openTools(page);await expect(handle).toBeVisible();
  await page.getByRole('button',{name:'收起对象编辑',exact:true}).click();await expect(handle).not.toBeVisible();await page.getByRole('button',{name:'继续对象编辑 · 未保存',exact:true}).click();await expect(handle).toBeVisible();
  await openLayers(page);await page.getByLabel('草稿 / 未保存预览',{exact:true}).uncheck();await expect(handle).not.toBeVisible();await page.getByLabel('草稿 / 未保存预览',{exact:true}).check();await expect(handle).toBeVisible();
  const own=page.getByRole('region',{name:/^本会话标注 /});await expandGroup(page,'本会话标注');await own.getByRole('button',{name:'隐藏集合点',exact:true}).click();await expect(handle).not.toBeVisible();await own.getByRole('button',{name:'显示集合点',exact:true}).click();await expect(handle).toBeVisible();await page.getByRole('button',{name:'关闭图层与对象',exact:true}).click();
  await page.getByText('更换专业标号',{exact:true}).click();await page.getByRole('group',{name:'专业标号目录'}).getByRole('button',{name:'集结地 标准 6.1.27',exact:true}).click();await expect(handle).not.toBeVisible();await expect(angle).toBeDisabled();
  await page.getByRole('button',{name:'改用普通点',exact:true}).click();await expect(handle).not.toBeVisible();
  expect(env.lab.annotations!.binding(env.actor,env.session.id).draft!.headRevision).toBe(1);
  await page.getByRole('group',{name:'专业标号目录'}).getByRole('button',{name:'水罐消防车 标准 6.2.1',exact:true}).click();await page.getByText('更换专业标号',{exact:true}).click();await angle.fill('180');await expect(handle).toBeVisible();env.dropNextAction();await page.getByRole('button',{name:'保存对象',exact:true}).click();await expect(page.getByText('保存结果待确认',{exact:true})).toBeVisible();await expect(handle).not.toBeVisible();await expect(angle).toBeDisabled();await page.getByRole('button',{name:'查询保存回执',exact:true}).click();await expect(page.locator('.annotation-feature-form')).toHaveCount(0);await expect(handle).not.toBeVisible();expect(env.lab.annotations!.binding(env.actor,env.session.id).draft!.headRevision).toBe(2);expect(env.errors).toEqual([]);
 }finally{await env.close();}
});
