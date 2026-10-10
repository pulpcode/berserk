import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import { BackgroundStore } from '../../src/background/store';
import { parseBackgroundConfig } from '../../src/background/config';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';

test.setTimeout(60000);
const seats = [['overall','总体席','公共任务与跨席位协调、补充投递审批'],['intelligence','情报席','信息核实与特情变化'],['planning','筹划席','编制修订方案'],['situation','态势席','当前态势和状态变化']] as const;
async function setup() {
  const dir=await mkdtemp(join(tmpdir(),'axon-routing-web-')); const db=await openDatabase(dir); const access=new AccessStore(db);
  for(const [key,name,responsibility] of seats) {
    await access.saveAccount({username:key,displayName:name,seatId:`seat-${key}`,seatName:name,password:'test-password-123',createPublicTask:key==='overall',manageModelSettings:key==='overall'});
    access.updateSeat(`seat-${key}`,{responsibility});
  }
  db.close();
  const config=testConfig(dir,{auth:{secret:'test-routing-signing-key-at-least-32-characters',sessionMs:28800000}});
  const fake=await fakeRuntime(config,(_context,index)=>index%2===0 ? {tools:[{name:'information_suggest_recipients',arguments:{recipients:[{seatId:'seat-planning',reason:'方案安排受到道路封闭影响'},{seatId:'seat-situation',reason:'需更新道路通行态势'}]}}]} : {text:'道路封闭影响任务安排和当前态势，需要核对备用路线。'});
  const lab=await PiLab.create(config,fake.runtime); const store=new BackgroundStore(lab.access!.db);
  store.grant('seat','seat-overall','intel','manage');
  const background=parseBackgroundConfig({enabled:true,deliveryReviewSeatId:'seat-overall',sources:[{sourceId:'intel',name:'特情接入',credentialRef:'TEST_TOKEN',allowedProfileIds:['analysis'],allowedRecipientSeatIds:seats.map(([key])=>`seat-${key}`)}],profiles:[{id:'analysis',name:'综合分析',goal:'分析收到的信息',tools:['source_read','information_suggest_recipients']}]});
  const token='test-routing-source-secret-value'; const app=await createApp(lab,false,{config:background,env:{TEST_TOKEN:token}});
  let loseResponse=false; let rejectDecision=false; const pages:Page[]=[];
  async function attach(page:Page) {
    pages.push(page);
    await page.route('**/api/**',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(rejectDecision && request.method()==='POST' && url.pathname.endsWith('/decision')) {rejectDecision=false;await route.fulfill({status:503,json:{error:{code:'TEMPORARY_FAILURE',message:'测试暂未提交，编辑保留'}}});return;}
      const response=await app.inject({method:request.method() as 'GET'|'POST'|'PUT'|'DELETE',url:url.pathname+url.search,headers:{...request.headers(),host:'127.0.0.1',origin:'http://localhost:4310'},...(request.postDataBuffer()?{payload:request.postDataBuffer()!}:{})});
      if(loseResponse && request.method()==='POST' && url.pathname.endsWith('/decision')) {loseResponse=false;await route.fulfill({status:503,json:{error:{code:'LOST_RESPONSE',message:'批准响应丢失'}}});return;}
      await route.fulfill({status:response.statusCode,headers:Object.fromEntries(Object.entries(response.headers).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)])),body:response.rawPayload});
    });
  }
  async function receive() {
    const response=await app.inject({method:'POST',url:'/api/integrations/intel/events',headers:{authorization:`Bearer ${token}`},payload:{sourceMessageId:randomUUID(),title:'道路封闭通知',text:'道路封闭，方案安排和当前态势需要综合研判。'}});
    expect(response.statusCode,response.body).toBe(202);
    await expect.poll(()=>store.listDeliveries().filter(item=>item.status==='delivered').length).toBe(1);
    return store.reviewForJob(store.listJobs()[0].id)!;
  }
  return {lab,store,fake,attach,receive,lose:()=>{loseResponse=true;},reject:()=>{rejectDecision=true;},close:async()=>{for(const page of pages)if(!page.isClosed()){await page.goto('about:blank');await page.unrouteAll({behavior:'wait'});}await app.close();await rm(dir,{recursive:true,force:true});}};
}
async function login(page:Page,name:string) {
  await page.goto('/');await page.getByLabel('账号',{exact:true}).fill(name);await page.getByLabel('密码',{exact:true}).fill('test-password-123');await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByRole('button',{name:'设置',exact:true})).toBeVisible();
}
async function rule(page:Page) {
  await page.getByRole('button',{name:'工作总览',exact:true}).click();await page.getByRole('button',{name:'处理与投递规则',exact:true}).click();await page.getByRole('button',{name:'新建规则',exact:true}).click();
  await page.getByLabel('规则名称').fill('特情分析与补充通知');await page.getByLabel('情报席',{exact:true}).check();await page.getByLabel('允许 Agent 建议补充接收席位').check();
  const candidates=page.getByRole('group',{name:'补充候选席位',exact:true});await expect(candidates).toContainText('编制修订方案');await candidates.getByLabel('筹划席',{exact:true}).check();await candidates.getByLabel('态势席',{exact:true}).check();
  await page.getByRole('button',{name:'保存规则',exact:true}).click();await expect(page.locator('.information-rules').getByRole('status')).toContainText('规则已保存');
}
async function openReview(page:Page,id:string) {
  await page.getByRole('button',{name:'补充投递审批',exact:true}).click();await page.locator(`[data-information-id="${id}"]`).click();
  return page.getByRole('complementary',{name:'补充投递审批',exact:true});
}

test('four-seat routing retains fixed receipt, overall edits and approves once after a lost response',async({page,browser})=>{
  const env=await setup();const context=await browser.newContext();const recipient=await context.newPage();await env.attach(page);await env.attach(recipient);
  try {
    await login(page,'overall');await rule(page);const review=await env.receive();const calls=env.fake.calls.length;
    await login(recipient,'planning');await expect(recipient.locator('.workbench')).toBeVisible();await expect(recipient.getByText('暂无符合条件的事项。')).toBeVisible();await expect(recipient.getByRole('button',{name:'工作总览',exact:true})).toHaveCount(0);
    const panel=await openReview(page,review.id);await expect(panel).toContainText('固定投递不等待本次批准');await expect(panel).toContainText('分析结果');await expect(page.getByRole('complementary',{name:'会话与资料'})).toBeVisible();
    await panel.getByLabel('态势席',{exact:true}).uncheck();await panel.getByLabel('筹划席接收理由').fill('总体席核对后，安排方案修订');
    env.reject();await panel.getByRole('button',{name:'批准补充投递',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('编辑保留');await expect(panel.getByLabel('筹划席接收理由')).toHaveValue('总体席核对后，安排方案修订');
    env.lose();await panel.getByRole('button',{name:'批准补充投递',exact:true}).click();await expect(panel.getByRole('region',{name:'最新审批决定'})).toContainText('已批准');
    expect(env.store.listDeliveries()).toHaveLength(2);expect(env.fake.calls).toHaveLength(calls);
    await recipient.getByRole('button',{name:'刷新待办',exact:true}).click();await recipient.locator('.workbench-list').getByRole('button',{name:/道路封闭通知/}).click();await recipient.getByText('为何收到',{exact:true}).click();await expect(recipient.locator('.information-embedded .information-detail')).toContainText('总体席批准补充投递');await expect(recipient.locator('.information-embedded .information-detail')).toContainText('总体席核对后，安排方案修订');
    await panel.locator('.information-drawer-body').evaluate(element=>{element.scrollTop=0;});await page.screenshot({path:'test-results/recipient-review-desktop.png',fullPage:true});
    await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);await expect(page.getByRole('button',{name:'补充投递审批',exact:true})).toBeFocused();
  }finally{await env.close();await context.close();}
});

test('overall may decline supplementary delivery without affecting the fixed recipient',async({page})=>{
  const env=await setup();await env.attach(page);
  try {
    await login(page,'overall');await rule(page);const review=await env.receive();const calls=env.fake.calls.length;const panel=await openReview(page,review.id);
    await panel.getByText('不予补充',{exact:true}).click();await panel.getByLabel('不予补充的原因').fill('先由情报席核实道路恢复时间');await panel.getByRole('button',{name:'确认不予补充',exact:true}).click();
    await expect(panel.getByRole('region',{name:'最新审批决定'})).toContainText('不予补充');expect(env.store.listDeliveries()).toHaveLength(1);expect(env.fake.calls).toHaveLength(calls);
    await page.reload();await expect(page.getByRole('complementary',{name:'补充投递审批',exact:true})).toContainText('先由情报席核实道路恢复时间');
  }finally{await env.close();}
});


test('supplementary review is one actionable item shared by workbench and overview', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    await login(page, 'overall'); await rule(page); const review = await env.receive();
    await page.getByRole('button', { name: '工作待办', exact: true }).click();
    await page.getByRole('button', { name: '刷新待办', exact: true }).click();
    await page.getByLabel('事项类型').selectOption('delivery_review');
    const row = page.locator('.workbench-list').getByRole('button', { name: /道路封闭通知/ });
    await expect(row).toContainText('待我批准'); await row.click();
    const detail = page.locator('.delivery-review-embedded');
    await expect(detail).toContainText('固定投递不等待本次批准');
    await detail.getByLabel('态势席', { exact: true }).uncheck();
    await detail.getByLabel('筹划席接收理由').fill('从统一待办核对后安排方案修订');
    await page.getByRole('button', { name: '工作总览', exact: true }).click();
    await page.getByRole('button', { name: '工作待办', exact: true }).click();
    await row.click();
    await expect(detail.getByLabel('筹划席接收理由')).toHaveValue('从统一待办核对后安排方案修订');
    await expect(detail.getByLabel('态势席', { exact: true })).not.toBeChecked();
    await detail.getByRole('button', { name: '批准补充投递', exact: true }).click();
    await expect(detail.getByRole('region', { name: '最新审批决定' })).toContainText('已批准');
    await detail.getByRole('button', { name: '返回列表', exact: true }).click();
    await expect(page.locator('.workbench-list').getByRole('button', { name: /道路封闭通知/ })).toHaveCount(0);
    await page.getByRole('button', { name: /^已办/ }).click();
    await expect(page.locator('.workbench-list').getByRole('button', { name: /道路封闭通知/ })).toContainText('已批准');
    await page.goto(`/overview?tab=reviews&id=${review.id}`);
    const overview = page.getByRole('complementary', { name: '补充投递审批', exact: true });
    await expect(overview.getByRole('region', { name: '最新审批决定' })).toContainText('已批准');
    expect(env.store.listDeliveries()).toHaveLength(2);
  } finally { await env.close(); }
});
