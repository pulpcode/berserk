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

test.setTimeout(60000);
async function setup(page:Page){
 const dir=await mkdtemp(join(tmpdir(),'axon-annotations-web-'));const db=await openDatabase(dir);const access=new AccessStore(db);
 const userId=await access.saveAccount({username:'a',displayName:'地图验证',seatId:'a',seatName:'总体席',password:'test-password-123',createPublicTask:true,manageModelSettings:true});const actor=access.identity(userId)!;
 const task=access.create(actor,{title:'标注验证任务',goal:'独立草稿与固定发布',visibility:'public',clientActionId:randomUUID()});db.close();
 const config=testConfig(dir,{seatId:'a',auth:{secret:'annotations-browser-secret-at-least-thirty-two-characters',sessionMs:28800000}});
 const fake=await fakeRuntime(config,()=>({text:'已收到固定标注引用。'}));const lab=await PiLab.create(config,fake.runtime);const app=await createApp(lab,false);
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
 await expect(page.getByLabel('新图层名称')).toBeVisible();
 return {lab,actor,task,session,second,requests,errors,dropNextAction:()=>{dropAction=true;},tiles:()=>tiles,fake,close:async()=>{page.on('dialog',dialog=>dialog.accept());await page.goto('about:blank');await page.unrouteAll({behavior:'wait'});await app.close();await rm(dir,{recursive:true,force:true});}};
}
async function layer(page:Page){await page.getByLabel('新图层名称').fill('集合点');await page.getByRole('button',{name:'添加图层',exact:true}).click();await expect(page.locator('.annotation-heading')).toContainText('草稿 r1');}
async function point(page:Page,name='集合点 A') {await page.getByRole('button',{name:'坐标新增',exact:true}).click();await page.getByLabel('对象名称',{exact:true}).fill(name);await page.getByRole('button',{name:'保存对象',exact:true}).click();await expect(page.locator('.annotation-feature-form')).toHaveCount(0);}

test('independent drafts, fixed publication, current selection and native annotation reference',async({page})=>{
 const env=await setup(page);try{
  await layer(page);await point(page);await expect(page.locator('.annotation-heading')).toContainText('草稿 r2');
  await page.getByText('标注集名称与发布',{exact:true}).click();await page.getByLabel('发布名称',{exact:true}).fill('集合点发布版');await page.getByRole('button',{name:'发布此保存修订'}).click();await expect(page.getByRole('alert')).toContainText('任务当前标注保持不变');
  expect(env.lab.annotations!.current(env.actor,env.task.id).sequence).toBe(0);
  await page.getByText('我的草稿与已发布版本',{exact:true}).click();await page.getByRole('button',{name:'添加发布版参考'}).click();await expect(page.getByRole('region',{name:'参考标注 集合点发布版'})).toBeVisible();
  const reference=page.getByRole('region',{name:'参考标注 集合点发布版'});await expect(reference.getByRole('checkbox',{name:'集合点',exact:true})).not.toBeChecked();await expect(reference.getByRole('button',{name:'删除对象'})).toHaveCount(0);
  await page.getByRole('button',{name:'比较并设为当前'}).click();await page.getByRole('button',{name:'设为当前标注',exact:true}).click();expect(env.lab.annotations!.current(env.actor,env.task.id).sequence).toBe(1);
  const first=env.lab.annotations!.binding(env.actor,env.session.id);const pub=env.lab.annotations!.current(env.actor,env.task.id).publication!;
  const secondBinding=env.lab.annotations!.binding(env.actor,env.second.id);env.lab.annotations!.setBase(env.actor,env.second.id,{clientActionId:randomUUID(),baseRef:{publicationId:pub.publicationId},expectedBindingRevision:secondBinding.bindingRevision});
  await page.goto(`/situation?taskId=${env.task.id}&sessionId=${env.second.id}`);await expect(page.getByRole('button',{name:'集合点 A point',exact:true})).toBeVisible();await point(page,'集合点 B');
  expect(env.lab.annotations!.binding(env.actor,env.session.id).draft!.headRevision).toBe(first.draft!.headRevision);
  await page.goto(`/?session=${env.second.id}`);await expect(page.getByRole('button',{name:'本会话地图标注'})).toBeVisible();await page.getByRole('button',{name:'本会话地图标注'}).click();await page.getByRole('complementary',{name:'地图详情'}).getByRole('button',{name:'集合点 B point',exact:true}).click();await page.getByRole('button',{name:'引用此对象'}).click();await expect(page.getByLabel('本次引用的标注版本')).toContainText('r1');
  await page.getByRole('button',{name:'关闭地图',exact:true}).click();await page.getByRole('textbox',{name:'发送消息',exact:true}).fill('比较这些集合点');await page.getByRole('button',{name:'发送消息',exact:true}).click();await expect(page.getByLabel('本条消息引用的标注版本')).toBeVisible();expect(env.requests.find(item=>item.path.endsWith('/messages'))?.body.annotationRefs).toEqual([expect.objectContaining({objectIds:expect.arrayContaining([expect.any(String)])})]);
  await page.getByLabel('本条消息引用的标注版本').getByRole('button').click();await expect(page.getByRole('complementary',{name:'地图详情'})).toBeVisible();await expect.poll(env.tiles).toBeGreaterThan(0);await expect(page.locator('.annotation-heading')).toContainText('草稿 r1');await expect(page.getByText(/固定引用范围：1 个对象/)).toBeVisible();await expect(page.locator('.annotation-marker').first()).toBeVisible();expect(env.errors).toEqual([]);
  await page.screenshot({path:test.info().outputPath('annotation-reference-1440.png')});await page.setViewportSize({width:1280,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath('annotation-reference-1280.png')});
 }finally{await env.close();}
});

test('official Terra Draw supports point line polygon Chinese labels, edit and cleanup on MapLibre 6.4',async({page})=>{
 const env=await setup(page);try{
  await layer(page);const canvas=page.locator('.maplibregl-canvas');await expect(canvas).toBeVisible();await expect.poll(env.tiles).toBeGreaterThan(0);
  const box=(await canvas.boundingBox())!;const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.getByRole('button',{name:'绘制点',exact:true}).click();await page.mouse.click(x,y);await expect(page.locator('.annotation-heading')).toContainText('草稿 r2');
  await page.getByRole('button',{name:'绘制线',exact:true}).click();await page.mouse.click(x-60,y-30);page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'工作待办',exact:true}).click();await expect(page.getByRole('button',{name:'退出绘制'})).toBeVisible();await page.mouse.click(x+40,y+20);await page.mouse.dblclick(x+100,y+50);await expect(page.locator('.annotation-heading')).toContainText('草稿 r3');
  await page.getByRole('button',{name:'绘制面',exact:true}).click();await page.mouse.click(x-90,y-80);await page.mouse.click(x+80,y-80);await page.mouse.click(x+80,y+80);await page.mouse.dblclick(x-90,y+80);await expect(page.locator('.annotation-heading')).toContainText('草稿 r4');
  await page.getByRole('button',{name:'放置文字',exact:true}).click();await page.mouse.click(x,y);await expect(page.locator('.annotation-heading')).toContainText('草稿 r5');await expect(page.locator('.annotation-label')).toContainText('新文字注记');
  const binding=env.lab.annotations!.binding(env.actor,env.session.id);const doc=env.lab.annotations!.privateVersion(env.actor,binding.draft!.setId,5).document;expect(doc.layers[0]!.features.map(item=>item.kind)).toEqual(['point','line','polygon','text']);
  await page.getByRole('button',{name:'新文字注记 text',exact:true}).click();await page.getByRole('button',{name:'拖动及顶点编辑'}).click();const updatedBox=(await canvas.boundingBox())!;const cx=updatedBox.x+updatedBox.width/2,cy=updatedBox.y+updatedBox.height/2;await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx+45,cy+20,{steps:5});await page.mouse.up();await expect(page.locator('.annotation-heading')).toContainText('草稿 r6');
  await page.reload();await expect(page.locator('.annotation-heading')).toContainText('草稿 r6');await expect(page.locator('canvas')).toBeVisible();await page.getByRole('button',{name:'定位此组',exact:true}).click();await expect(page.locator('.annotation-marker')).toHaveCount(4);expect(env.errors).toEqual([]);await page.waitForTimeout(750);await page.screenshot({path:test.info().outputPath('terra-draw-maplibre-6.4.png')});
 }finally{await env.close();}
});

test('CAS retains form and no WebGL still permits explicit coordinate editing',async({page})=>{
 await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,type,...args){if(String(type).includes('webgl'))return null;return original.call(this,type,...args);} as typeof original;});
 const env=await setup(page);try{
  await layer(page);await expect(page.getByText('地图暂不可用，请通过对象列表查看与引用。')).toBeVisible();await point(page);
  await page.getByRole('button',{name:'集合点 A point',exact:true}).click();await page.getByRole('button',{name:'编辑属性与坐标'}).click();await page.getByLabel('对象名称',{exact:true}).fill('保留我的修改');
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


test('browser back can be cancelled without losing an unsaved annotation form',async({page})=>{
 const env=await setup(page);try{
  await page.goto(`/?session=${env.session.id}`);await page.getByRole('button',{name:'本会话地图标注'}).click();await page.getByRole('button',{name:'展开地图',exact:true}).click();await expect(page.getByLabel('新图层名称')).toBeVisible();
  await layer(page);await point(page);await page.getByRole('button',{name:'集合点 A point',exact:true}).click();await page.getByRole('button',{name:'编辑属性与坐标'}).click();await page.getByLabel('对象名称',{exact:true}).fill('后退仍保留');
  const origin=page.url();page.once('dialog',dialog=>dialog.dismiss());await page.goBack();await expect(page).toHaveURL(origin);await expect(page.getByLabel('对象名称',{exact:true})).toHaveValue('后退仍保留');
  await page.getByRole('button',{name:'保存对象',exact:true}).click();await expect(page.locator('.annotation-heading')).toContainText('草稿 r3');await page.goBack();await expect(page).not.toHaveURL(origin);
 }finally{await env.close();}
});


test('overlapping draft and publication objects select their exact read-only group',async({page})=>{
 const env=await setup(page);try{
  await layer(page);await point(page,'重叠 A');await point(page,'重叠 B');
  await page.getByText('标注集名称与发布',{exact:true}).click();await page.getByLabel('发布名称',{exact:true}).fill('重叠发布版');await page.getByRole('button',{name:'发布此保存修订'}).click();await expect(page.getByRole('alert')).toContainText('任务当前标注保持不变');
  await page.getByText('我的草稿与已发布版本',{exact:true}).click();await page.getByRole('button',{name:'添加发布版参考'}).click();const ref=page.getByRole('region',{name:'参考标注 重叠发布版'});await ref.getByRole('checkbox',{name:'集合点',exact:true}).check();await ref.getByRole('button',{name:'定位此组'}).click();
  const binding=env.lab.annotations!.binding(env.actor,env.session.id);const doc=env.lab.annotations!.privateVersion(env.actor,binding.draft!.setId,3).document;const wanted=doc.layers[0]!.features[1]!;
  await expect.poll(async()=>{const box=(await page.locator('.maplibregl-canvas').boundingBox())!;await page.mouse.click(box.x+box.width/2,box.y+box.height/2);return page.locator('.annotation-overlap button').count();}).toBe(4);
  await page.locator('.annotation-overlap').getByRole('button',{name:`重叠发布版 · ${doc.layers[0]!.layerId} · ${wanted.objectId}`,exact:true}).click();await expect(page.locator('.annotation-detail h3')).toContainText('重叠发布版');await expect(page.locator('.annotation-detail h3')).toContainText('集合点 → 重叠 B');await expect(page.getByRole('button',{name:'编辑属性与坐标'})).toHaveCount(0);await expect(page.getByRole('button',{name:'复制到编辑图层'})).toBeVisible();expect(env.errors).toEqual([]);await page.screenshot({path:test.info().outputPath('overlap-read-only-reference.png')});
 }finally{await env.close();}
});
