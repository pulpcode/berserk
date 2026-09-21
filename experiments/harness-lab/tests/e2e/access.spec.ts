import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';
async function setup() {
  const dir=await mkdtemp(join(tmpdir(),'axon-web-access-'));const db=await openDatabase(dir);const store=new AccessStore(db);
  for(const name of ['a','b'])await store.saveAccount({username:name,displayName:`用户 ${name}`,seatId:name,seatName:`席位 ${name}`,password:'test-password-123',createPublicTask:name==='a',manageModelSettings:name==='a'});
  db.close();const config=testConfig(dir,{seatId:'a',auth:{secret:'test-only-signing-key-at-least-32-characters',sessionMs:28800000}});
  const fake=await fakeRuntime(config,()=>({text:'当前任务处理完成'}));const lab=await PiLab.create(config,fake.runtime);const app=await createApp(lab);const pages:Page[]=[];
  const attach=async(page:Page)=>{pages.push(page);await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    const response=await app.inject({method:req.method() as 'GET'|'POST'|'PUT'|'DELETE',url:url.pathname+url.search,headers:{...req.headers(),host:'127.0.0.1',origin:'http://localhost:4310'},...(req.postDataBuffer()?{payload:req.postDataBuffer()!}:{})});
    await route.fulfill({status:response.statusCode,headers:Object.fromEntries(Object.entries(response.headers).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)])),body:response.rawPayload});
  });};
  return {lab,attach,close:async()=>{for(const page of pages)if(!page.isClosed()){await page.goto('about:blank');await page.unrouteAll({behavior:'wait'});}await app.close();await rm(dir,{recursive:true,force:true});}};
}
async function login(page:Page,name:string) {
  await page.goto('/');await page.getByLabel('账号',{exact:true}).fill(name);await page.getByLabel('密码',{exact:true}).fill('test-password-123');await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.locator('.account-footer')).toContainText(`用户 ${name}`);
}
async function createTask(page:Page,title:string,visibility:'public'|'private') {
  await page.getByRole('button',{name:visibility==='public'?'建立公共任务':'建立席位私有任务',exact:true}).click();await page.getByLabel('任务名称',{exact:true}).fill(title);await page.getByLabel('目标与说明',{exact:true}).fill('综合资料编制计划');await page.getByRole('button',{name:visibility==='public'?'确认建立公共任务':'建立私有任务',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();
}
test('login, public/private task navigation, lazy workspace, archive and two independent seats',async({page,browser})=>{
  const env=await setup();const second=await browser.newContext();const b=await second.newPage();await env.attach(page);await env.attach(b);
  try {
    await login(page,'a');await expect(page.getByLabel('测试席位')).toHaveCount(0);await createTask(page,'联合任务','public');await createTask(page,'席位 A 私有','private');
    await login(b,'b');await expect(b.getByRole('button',{name:'任务说明：联合任务'})).toBeVisible();await expect(b.getByRole('button',{name:/席位 A 私有/})).toHaveCount(0);expect(env.lab.workspaces.listAll()).toHaveLength(0);
    await b.getByRole('button',{name:'任务说明：联合任务'}).click();await expect(b.getByLabel('目标与说明')).toHaveValue('综合资料编制计划');await b.keyboard.press('Escape');expect(env.lab.workspaces.listAll()).toHaveLength(0);
    await page.getByRole('button',{name:'在项目 联合任务 中新建对话'}).click();await expect(page.getByRole('textbox',{name:'发送消息'})).toBeEnabled();await page.getByRole('textbox',{name:'发送消息'}).fill('A 未发送草稿');
    await b.getByRole('button',{name:'在项目 联合任务 中新建对话'}).click();await b.getByRole('textbox',{name:'发送消息'}).fill('帮我处理');await b.getByRole('button',{name:'发送消息',exact:true}).click();await expect(b.getByText('当前任务处理完成',{exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'发送消息'})).toHaveValue('A 未发送草稿');expect(env.lab.workspaces.listAll()).toHaveLength(2);
    await page.getByRole('button',{name:'任务说明：联合任务'}).click();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'归档任务',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();await expect(page.getByRole('textbox',{name:'发送消息'})).toBeDisabled();
    await page.getByLabel('含已归档').check();await page.getByRole('button',{name:'任务说明：联合任务'}).click();await page.getByRole('button',{name:'重新开启',exact:true}).click();await expect(page.getByRole('textbox',{name:'发送消息'})).toBeEnabled();await page.screenshot({path:'test-results/access-desktop.png',fullPage:true});
  } finally {await env.close();await second.close();}
});
test('same-browser logout and identity change clear private drafts in both tabs',async({page,context})=>{
  const env=await setup();await env.attach(page);const other=await context.newPage();await env.attach(other);
  try {
    await login(page,'a');await createTask(page,'私有笔记','private');await page.getByRole('button',{name:'在项目 私有笔记 中新建对话'}).click();await page.getByRole('textbox',{name:'发送消息'}).fill('只属于 A 的草稿');await other.goto('/');await expect(other.locator('.account-footer')).toContainText('用户 a');
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'退出',exact:true}).click();await expect(other.getByRole('button',{name:'登录',exact:true})).toBeVisible();await page.getByLabel('账号',{exact:true}).fill('b');await page.getByLabel('密码',{exact:true}).fill('test-password-123');await page.getByRole('button',{name:'登录',exact:true}).click();await expect(other.locator('.account-footer')).toContainText('用户 b');await expect(page.getByRole('textbox',{name:'发送消息'})).toHaveValue('');await expect(other.getByRole('button',{name:/私有笔记/})).toHaveCount(0);
  } finally {await env.close();await other.close();}
});
