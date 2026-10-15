import { randomUUID } from 'node:crypto';
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

test.setTimeout(60000);
async function setup(page:Page, reply: Parameters<typeof fakeRuntime>[1] = ()=>({text:'已收到固定标注引用。'})){
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
  if(url.pathname==='/api/context/map-config')return route.fulfill({json:{providerId:'test',tiles:[`${url.origin}/test-tiles/{z}/{x}/{y}.png`],tileSize:256,attributionText:'本地验证瓦片',attributionUrl:'https://www.openstreetmap.org/copyright',simulationEnabled:false}});
  if(req.postDataJSON())requests.push({path:url.pathname,body:req.postDataJSON()});
  const response=await app.inject({method:req.method() as 'GET'|'POST'|'PUT'|'DELETE',url:url.pathname+url.search,headers:{...req.headers(),host:'127.0.0.1',origin:'http://localhost:4310'},...(req.postDataBuffer()?{payload:req.postDataBuffer()!}:{})});
  if(dropAction && url.pathname.endsWith('/annotation/actions')){dropAction=false;await route.abort();return;}
  await route.fulfill({status:response.statusCode,headers:Object.fromEntries(Object.entries(response.headers).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)])),body:response.rawPayload});
 });
 await page.goto('/');await page.getByLabel('席位',{exact:true}).selectOption('a');await page.getByLabel('密码',{exact:true}).fill('test-password-123');await page.getByRole('button',{name:'登录',exact:true}).click();
 await expect(page.getByRole('button',{name:'进入项目：标注验证任务'})).toBeVisible();
 await page.goto(`/situation?taskId=${task.id}&sessionId=${session.id}`);
 await expect(page.locator('.annotation-heading')).toBeVisible();await openLayers(page);
 return {lab,actor,task,session,second,requests,errors,dropNextAction:()=>{dropAction=true;},tiles:()=>tiles,fake,close:async()=>{page.on('dialog',dialog=>dialog.accept());await page.goto('about:blank');await page.unrouteAll({behavior:'wait'});await app.close();await rm(dir,{recursive:true,force:true});}};
}
async function openLayers(page:Page){if(!await page.locator('.annotation-sidebar').isVisible())await page.getByRole('button',{name:'图层与对象',exact:true}).click();await expect(page.locator('.annotation-sidebar')).toBeVisible();}
async function expandGroup(page:Page,name:string){const button=page.getByRole('button',{name:`展开${name}`,exact:true});if(await button.isVisible())await button.click();}
async function openVersions(page:Page){if(!await page.locator('.annotation-management').isVisible())await page.getByRole('button',{name:'版本与发布',exact:true}).click();}
async function pickOwn(page:Page,name:string){await openLayers(page);await expandGroup(page,'本会话标注');const group=page.getByRole('region',{name:/^本会话标注 /});const row=group.locator('.annotation-tree-layer').filter({has:page.getByRole('button',{name:/^(展开|收起)集合点$/})});const toggle=row.getByRole('button',{name:/^(展开|收起)集合点$/});if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();await group.getByRole('button',{name,exact:true}).click();}
async function addLayer(page:Page,name:string){await openLayers(page);await expandGroup(page,'本会话标注');await page.getByRole('region',{name:/^本会话标注 /}).getByRole('button',{name:'新建图层',exact:true}).click();await page.getByLabel('新图层名称').fill(name);await page.getByRole('button',{name:'添加图层',exact:true}).click();await expect(page.getByLabel('新图层名称')).not.toBeVisible();}
async function layer(page:Page){await addLayer(page,'集合点');await expect(page.locator('.annotation-heading')).toContainText('草稿 r1');}
async function groupMore(group:import('@playwright/test').Locator){const button=group.locator(':scope > .annotation-tree-row .annotation-tree-more > button');if(await button.getAttribute('aria-expanded')==='false')await button.click();}
async function point(page:Page,name='集合点 A') {await page.getByRole('button',{name:'坐标新增',exact:true}).click();await page.getByLabel('对象名称',{exact:true}).fill(name);await page.getByRole('button',{name:'保存对象',exact:true}).click();await expect(page.locator('.annotation-feature-form')).toHaveCount(0);}

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
  expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(44);await expect(toolbar.locator('.annotation-toolbar-target')).toHaveAttribute('title','当前绘制图层：集合点');
  const box=(await canvas.boundingBox())!;const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.getByRole('button',{name:'绘制点',exact:true}).click();await expect(page.getByRole('button',{name:'绘制点',exact:true})).toHaveAttribute('aria-pressed','true');await expect(toolbar.getByRole('status')).toContainText('点击地图放置');await page.mouse.click(x,y);await expect(page.locator('.annotation-heading')).toContainText('草稿 r2');
  await page.getByRole('button',{name:'绘制线',exact:true}).click();await page.mouse.click(x-60,y-30);page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'工作待办',exact:true}).click();await expect(page.getByRole('button',{name:'退出绘制'})).toBeVisible();await page.mouse.click(x+40,y+20);await page.mouse.dblclick(x+100,y+50);await expect(page.locator('.annotation-heading')).toContainText('草稿 r3');
  await page.getByRole('button',{name:'绘制面',exact:true}).click();await page.mouse.click(x-90,y-80);await page.mouse.click(x+80,y-80);await page.mouse.click(x+80,y+80);await page.mouse.dblclick(x-90,y+80);await expect(page.locator('.annotation-heading')).toContainText('草稿 r4');
  await page.getByRole('button',{name:'放置文字',exact:true}).click();await page.mouse.click(x,y);await expect(page.locator('.annotation-heading')).toContainText('草稿 r5');await expect(page.locator('.annotation-label')).toContainText('新文字注记');
  const binding=env.lab.annotations!.binding(env.actor,env.session.id);const doc=env.lab.annotations!.privateVersion(env.actor,binding.draft!.setId,5).document;expect(doc.layers[0]!.features.map(item=>item.kind)).toEqual(['point','line','polygon','text']);
  await pickOwn(page,'新文字注记 text');await page.getByRole('button',{name:'拖动及顶点编辑'}).click();const updatedBox=(await canvas.boundingBox())!;const cx=updatedBox.x+updatedBox.width/2,cy=updatedBox.y+updatedBox.height/2;await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx+45,cy+20,{steps:5});await page.mouse.up();await expect(page.locator('.annotation-heading')).toContainText('草稿 r6');
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
  page.once('dialog',dialog=>dialog.dismiss());await own.getByRole('button',{name:'隐藏空白图层',exact:true}).click();await expect(own.getByRole('button',{name:'隐藏空白图层',exact:true})).toHaveAttribute('aria-pressed','true');
  page.once('dialog',dialog=>dialog.accept());await own.getByRole('button',{name:'隐藏空白图层',exact:true}).click();await expect(target).toContainText('绘制已暂停');await expect(page.getByRole('button',{name:'绘制线',exact:true})).toBeDisabled();
  await target.getByRole('button',{name:'显示并继续',exact:true}).click();await expect(page.getByRole('button',{name:'绘制线',exact:true})).toBeEnabled();
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

test('native streamed publication result and reloaded history open the same fixed version',async({page})=>{
 const env=await setup(page,(_context,index)=>index===0?{tools:[{name:'annotation_action',arguments:{action:'publish',revision:1,title:'流式发布版'}}]}:{text:'已发布固定标注。'});
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
