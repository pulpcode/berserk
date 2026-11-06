import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import { BackgroundStore } from '../../src/background/store';
import { parseBackgroundConfig } from '../../src/background/config';
import { createMockContextServer } from '../../scripts/mock-context/server';
import type { NotificationTarget } from '../../scripts/mock-context/control-api';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import type { ContextConfig } from '../../src/context/config';
import type { ScenarioInstances, ScenarioTaskInitialization } from '../../src/contracts/scenarios';
import type { AuthSession } from '../../src/contracts/access';
import type { InformationCapabilities } from '../../src/contracts/background';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';
import { basemapFixture, localVectorTiles } from './basemap-fixtures';

const director='seat-director',business=['seat-overall','seat-intelligence','seat-planning','seat-situation'];
const password='scenario-isolation-test-password';
/** Actual app/source HTTP listeners, authentication and SQLite; only the model is a non-called test runtime. */
async function setup(context:BrowserContext) {
  const dir=await mkdtemp(join(tmpdir(),'axon-director-isolation-'));
  const env={QUERY:'isolation-query',CONTROL:'isolation-control',INTEL:'isolation-intel-source-token-123',SITUATION:'isolation-situation-source-token-123'};
  const targets:NotificationTarget[]=[];
  const source=createMockContextServer({token:env.QUERY,controlToken:env.CONTROL,scenariosEnabled:true,databasePath:join(dir,'source.sqlite'),targets});
  const base=await source.listen();const dataDir=join(dir,'axon');const db=await openDatabase(dataDir),access=new AccessStore(db);
  for(const seat of [director,...business])await access.saveAccount({username:seat,displayName:seat,seatId:seat,seatName:seat===director?'导演席':seat,password,createPublicTask:seat===director||seat===business[0],manageModelSettings:false});
  db.close();const config=testConfig(dataDir,{seatId:director,auth:{secret:'isolated-director-browser-test-secret-long-enough',sessionMs:28800000}});
  const fake=await fakeRuntime(config,()=>({text:'本测试不应调用模型'}));const lab=await PiLab.create(config,fake.runtime);
  // Preserve a real work-linked history created while this account was a business participant.
  const overall=lab.access!.identityForSeat(business[0])!;
  const legacyTask=lab.access!.create(overall,{title:'历史交接任务',goal:'保留旧工作，不因导演资格而删除历史。',visibility:'public',clientActionId:randomUUID()});
  const origin=await lab.workspaces.ensureWorkspace(legacyTask.id,business[0],legacyTask.title),owner=await lab.workspaces.ensureWorkspace(legacyTask.id,director,legacyTask.title);
  const prepared=await lab.collaboration!.prepare({seatId:business[0]},{kind:'assign',taskSpaceId:legacyTask.id,payload:{workspaceId:origin.id,assigneeSeatId:director,title:'导演任职前的历史工作',goal:'保留原工作资料',inputPaths:[]}},{source:'page',clientActionId:randomUUID()});
  const work=await lab.collaboration!.commitPage({seatId:business[0]},prepared.operationId);
  const claimed=await lab.collaboration!.prepare({seatId:director},{kind:'claim',workItemId:work.workItemId,expectedRevision:work.revision,payload:{}},{source:'page',clientActionId:randomUUID()});
  await lab.collaboration!.commitPage({seatId:director},claimed.operationId);
  const history=await lab.createSession(owner.id,director,work.workItemId);
  await lab.access!.saveAccount({username:director,displayName:director,seatId:director,seatName:'导演席',password,createPublicTask:true,manageModelSettings:false,controlScenarios:true});
  const background=parseBackgroundConfig({enabled:true,sources:[
    {sourceId:'intel-source',systemId:'intel',name:'特情来源',credentialRef:'INTEL',allowedProfileIds:['analysis'],allowedRecipientSeatIds:business},
    {sourceId:'situation-source',systemId:'situation',name:'态势来源',credentialRef:'SITUATION',allowedProfileIds:['analysis'],allowedRecipientSeatIds:business},
  ],profiles:[{id:'analysis',name:'仅验证接收',goal:'本轮没有启用分析规则',tools:['source_read']}]});
  const contextConfig:ContextConfig={systems:[
    {id:'intel',name:'特情系统',adapter:'mock-information-http',baseUrl:`${base}/intel`,tokenEnv:'QUERY',scenarioClock:true},
    {id:'situation',name:'态势系统',adapter:'mock-situation-http',baseUrl:`${base}/situation`,tokenEnv:'QUERY',scenarioClock:true},
  ],scopes:[{id:'demo',name:'演示资料',systemIds:['intel','situation'],seatIds:[director,...business]}],simulation:{enabled:true,baseUrl:base,tokenEnv:'CONTROL',directorSeatId:director,sources:[{systemId:'intel',sourceId:'intel-source'},{systemId:'situation',sourceId:'situation-source'}]}};
  const app=await createApp(lab,false,{config:background,env},{config:contextConfig,env});const appUrl=await app.listen({host:'127.0.0.1',port:0});
  targets.push({systemId:'intel',sourceId:'intel-source',url:appUrl,token:env.INTEL},{systemId:'situation',sourceId:'situation-source',url:appUrl,token:env.SITUATION});
  const store=new BackgroundStore(lab.access!.db);for(const seat of [director,...business])for(const id of ['intel-source','situation-source'])store.grant('seat',seat,id,seat===business[0]?'manage':'view');
  const reads:string[]=[];
  await context.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url());if(request.method()==='GET')reads.push(url.pathname);
    const response=await fetch(new URL(url.pathname+url.search,appUrl),{method:request.method(),headers:{...request.headers(),host:'127.0.0.1',origin:'http://localhost:4310'},...(request.postData()?{body:request.postData()!}:{})});
    if(url.pathname==='/api/context/map-config'&&response.ok){const body=await response.json();await route.fulfill({json:{...body,...basemapFixture(url.origin),defaultView:'road'}});return;}
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers.entries()),body:Buffer.from(await response.arrayBuffer())});
  });
  return {lab,fake,history,work,origin,reads,close:async()=>{for(const page of context.pages())if(!page.isClosed())await page.goto('about:blank');await context.unrouteAll({behavior:'wait'});await app.close();await source.close();await rm(dir,{recursive:true,force:true});}};
}
async function login(page:Page,seat:string){await page.goto('/');await page.getByLabel('席位',{exact:true}).selectOption(seat);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByRole('button',{name:'设置',exact:true})).toBeVisible();}
async function logout(page:Page){await page.getByRole('button',{name:'设置',exact:true}).click();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'退出登录',exact:true}).click();await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();}
async function read<T>(page:Page,path:string):Promise<T>{return page.evaluate(async path=>{const response=await fetch(path);if(!response.ok)throw new Error(`${path}: ${response.status}`);return response.json();},path);}
async function createReady(page:Page){
  await page.getByRole('button',{name:'重新演示',exact:true}).click();
  await page.getByRole('dialog',{name:'重新演示',exact:true}).getByRole('button',{name:'开始演示',exact:true}).click();
  await expect(page.getByRole('button',{name:'投放事件',exact:true})).toBeEnabled();
  const list=await read<ScenarioInstances>(page,'/api/simulation/instances');
  return read<ScenarioTaskInitialization>(page,`/api/simulation/instances/${list.activeInstanceId}/initialize`);
}

test('director controls real scenes and reads tasks and receipts without loading business work',async({page,context})=>{
  test.setTimeout(60000);const f=await setup(context);await localVectorTiles(page);
  try{
    await login(page,director);await expect(page).toHaveURL(/scenario-director$/);expect((await read<AuthSession>(page,'/api/auth/session')).identity?.canCollaborate).toBe(false);
    for(const name of ['工作待办','新建对话','分派工作','新建工作任务','新建个人空间'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
    const first=await createReady(page);expect(first.tasks).toHaveLength(2);expect(f.lab.access!.db.prepare('SELECT count(*) AS count FROM task_spaces WHERE id IN (?,?)').get(...first.tasks.map(task=>task.taskId))?.count).toBe(2);
    await page.locator('.director-step-toggle').nth(1).hover({position:{x:12,y:12}});await page.getByRole('button',{name:first.tasks[0]!.title,exact:true}).click();await page.getByRole('button',{name:'任务说明',exact:true}).click();await expect(page.locator('.task-description')).toContainText('交通救援');await expect(page.locator('.task-home-composer')).toHaveCount(0);await expect(page.getByRole('button',{name:'编辑说明',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'态势',exact:true}).click();await expect(page.locator('.situation-canvas')).toBeVisible();await expect(page.getByRole('button',{name:'引用到对话',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'新建对话',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'场景导演台',exact:true}).click();await page.getByRole('button',{name:'投放事件',exact:true}).click();
    await expect(page.locator('.director-step-toggle').first()).toContainText('已接收');await page.locator('.director-step-toggle').first().hover({position:{x:12,y:12}});const receipt=page.getByRole('link',{name:'接收记录'});await expect(receipt).toBeVisible();await page.goto((await receipt.getAttribute('href'))!);await expect(page.getByRole('heading',{name:'来源记录',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'首报位置待核实',exact:true})).toBeVisible();
    for(const name of ['按当前规则处理','补充投递审批','进入关联对话','处理与投递规则'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'场景导演台',exact:true}).click();const second=await createReady(page);await expect(page.getByRole('button',{name:'投放事件',exact:true})).toBeVisible();
    for(const task of first.tasks)expect(f.lab.access!.db.prepare("SELECT json_extract(data,'$.state') AS state FROM task_spaces WHERE id=?").get(task.taskId)?.state).toBe('archived');for(const task of second.tasks)expect(f.lab.access!.db.prepare("SELECT json_extract(data,'$.state') AS state FROM task_spaces WHERE id=?").get(task.taskId)?.state).toBe('active');
    const before=f.reads.length;await page.goto(`/work?kind=work&id=${f.work.workItemId}`);await expect(page.getByRole('heading',{name:'无权进入业务办理页面',exact:true})).toBeVisible();await page.goto(`/?session=${f.history.id}`);await expect(page.getByRole('heading',{name:'无权进入业务办理页面',exact:true})).toBeVisible();expect(f.reads.slice(before).some(path=>path.startsWith('/api/work-items')||path.startsWith('/api/workbench')||path.startsWith('/api/sessions/'))).toBe(false);expect(f.fake.calls).toHaveLength(0);
    const denied=await page.evaluate(async workspaceId=>{const auth=await (await fetch('/api/auth/session')).json();return {work:(await fetch('/api/workbench/items')).status,create:(await fetch('/api/sessions',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':auth.csrf,'x-axon-view':auth.viewId},body:JSON.stringify({workspaceId})})).status};},f.history.workspaceId);expect(denied).toEqual({work:403,create:403});
    await page.screenshot({path:test.info().outputPath('director-business-denied-desktop.png')});
  }finally{await f.close();}
});

test('business recipient lists omit director and same-browser identity changes replace collaboration ability',async({page,context})=>{
  test.setTimeout(45000);const f=await setup(context);
  try{
    await login(page,business[0]);const session=await read<AuthSession>(page,'/api/auth/session');expect(session.identity?.canCollaborate).toBe(true);expect(session.seats?.map(seat=>seat.id).sort()).toEqual([...business].sort());
    const recipients=await read<InformationCapabilities>(page,'/api/information/access');expect(recipients.seats.map(seat=>seat.id)).not.toContain(director);for(const source of recipients.sources)expect(source.allowedRecipientSeatIds).not.toContain(director);
    await page.getByRole('button',{name:'分派工作',exact:true}).click();const panel=page.getByRole('dialog',{name:'分派工作'});await panel.getByLabel('选择项目').selectOption(f.origin.id);
    expect(await panel.getByRole('combobox',{name:'接收席位'}).locator('option').allTextContents()).not.toContain('导演席');await page.keyboard.press('Escape');
    const other=await context.newPage();await other.goto('/work');await expect(other.getByRole('button',{name:'工作待办',exact:true})).toBeVisible();
    await logout(page);await expect(other.getByRole('button',{name:'登录',exact:true})).toBeVisible();await expect(page.getByLabel('席位',{exact:true}).locator('option')).toContainText(['导演席']);await login(page,director);await expect(page.getByRole('button',{name:'工作待办',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'新建对话',exact:true})).toHaveCount(0);await expect(other.getByRole('heading',{name:'无权进入业务办理页面',exact:true})).toBeVisible();await expect(other.getByRole('button',{name:'工作待办',exact:true})).toHaveCount(0);
    await logout(page);await expect(other.getByRole('button',{name:'登录',exact:true})).toBeVisible();await login(page,business[1]);await expect(page.getByRole('button',{name:'工作待办',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'分派工作',exact:true})).toBeVisible();await expect(other.getByRole('button',{name:'工作待办',exact:true})).toBeVisible();expect((await read<AuthSession>(page,'/api/auth/session')).identity?.canCollaborate).toBe(true);expect(f.fake.calls).toHaveLength(0);
  }finally{await f.close();}
});

test('ended unfinished task remains truthful and read-only in the business UI',async({page,context})=>{
  test.setTimeout(75000);const f=await setup(context);await localVectorTiles(page);
  try{
    await login(page,director);const first=await createReady(page);const task=first.tasks[0]!;
    const workspace=await f.lab.workspaces.ensureWorkspace(task.taskId,business[0],task.title);
    const assignment=await f.lab.collaboration!.prepare({seatId:business[0]},{kind:'assign',taskSpaceId:task.taskId,payload:{workspaceId:workspace.id,assigneeSeatId:business[1],title:'仍未完成的现场核查',goal:'保留真实工作状态',inputPaths:[]}},{source:'page',clientActionId:randomUUID()});
    const work=await f.lab.collaboration!.commitPage({seatId:business[0]},assignment.operationId);
    await createReady(page);
    expect(f.lab.access!.db.prepare("SELECT json_extract(data,'$.state') AS state FROM task_spaces WHERE id=?").get(task.taskId)?.state).toBe('active');
    await logout(page);await login(page,business[0]);await page.goto(`/tasks/${task.taskId}/information?tab=description`);
    await expect(page.locator('.task-home-meta')).toContainText('只读');
    await expect(page.locator('.task-home-composer textarea')).toBeDisabled();
    await expect(page.getByRole('button',{name:'发送并开始对话',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'编辑说明',exact:true})).toHaveCount(0);
    await expect(page.locator('.task-home-meta')).not.toContainText('轮次');
    await page.getByRole('button',{name:'态势',exact:true}).click();await expect(page.locator('.situation-canvas')).toBeVisible();
    await expect(page.getByRole('button',{name:'引用到对话',exact:true})).toHaveCount(0);
    await page.screenshot({path:test.info().outputPath('ended-task-readonly-desktop.png')});
    await logout(page);await login(page,business[1]);
    expect((await read<Array<{id:string}>>(page,'/api/work-items')).map(item=>item.id)).not.toContain(work.workItemId);
    await page.goto(`/work?kind=work&id=${work.workItemId}`);
    await expect(page.getByRole('heading',{name:'仍未完成的现场核查',exact:true})).toBeVisible();
    await expect(page.locator('.work-state')).toContainText('只读');
    await expect(page.getByRole('button',{name:'开始办理',exact:true})).toHaveCount(0);
    expect(f.fake.calls).toHaveLength(0);
  }finally{await f.close();}
});
