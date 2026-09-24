import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';
async function setup(secondManager = false) {
  const dir=await mkdtemp(join(tmpdir(),'axon-web-access-'));const db=await openDatabase(dir);const store=new AccessStore(db);
  for(const name of ['a','b',...(secondManager?['c']:[])])await store.saveAccount({username:name,displayName:`用户 ${name}`,seatId:name,seatName:`席位 ${name}`,password:'test-password-123',createPublicTask:name!=='b',manageModelSettings:name==='a'});
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
  await page.goto('/');await page.getByLabel('账号',{exact:true}).fill(name);await page.getByLabel('密码',{exact:true}).fill('test-password-123');await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByRole('button',{name:'登录',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'设置',exact:true})).toBeVisible();
}
async function expectAccount(page: Page, name: string) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '账户', exact: true }).click();
  const account = page.locator('.account-settings-content');
  await expect(account).toContainText(`用户 ${name}`);
  await expect(account).toContainText(`席位 ${name}`);
  await expect(account.getByText(name, { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
}
async function logout(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '账户', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
}
async function createTask(page:Page,title:string,visibility:'public'|'private') {
  const create = page.getByRole('button',{name:visibility==='public'?'新建工作任务':'新建个人空间',exact:true});
  await page.locator('.catalog-heading').filter({has:create}).hover();
  await create.click();await page.getByLabel(visibility==='public'?'任务名称':'空间名称',{exact:true}).fill(title);await page.getByLabel('目标与说明',{exact:true}).fill('综合资料编制计划');await page.getByRole('button',{name:visibility==='public'?'创建工作任务':'创建个人空间',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();
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
    await expect(page.getByRole('button',{name:'任务说明：联合任务'})).toHaveCount(0);await page.getByRole('button',{name:'工作任务 · 已归档 · 任务说明',exact:true}).click();await page.getByRole('button',{name:'重新开启',exact:true}).click();await expect(page.getByRole('textbox',{name:'发送消息'})).toBeEnabled();await page.screenshot({path:'test-results/access-desktop.png',fullPage:true});
  } finally {await env.close();await second.close();}
});
test('same-browser logout and identity change clear private drafts in both tabs',async({page,context})=>{
  const env=await setup();await env.attach(page);const other=await context.newPage();await env.attach(other);
  try {
    await login(page,'a');await createTask(page,'私有笔记','private');await page.getByRole('button',{name:'在项目 私有笔记 中新建对话'}).click();await page.getByRole('textbox',{name:'发送消息'}).fill('只属于 A 的草稿');await other.goto('/');await expectAccount(other, 'a');
    await logout(page);await expect(other.getByRole('button',{name:'登录',exact:true})).toBeVisible();await page.getByLabel('账号',{exact:true}).fill('b');await page.getByLabel('密码',{exact:true}).fill('test-password-123');await page.getByRole('button',{name:'登录',exact:true}).click();await expectAccount(other, 'b');await expect(page.getByRole('textbox',{name:'发送消息'})).toHaveValue('');await expect(other.getByRole('button',{name:/私有笔记/})).toHaveCount(0);
  } finally {await env.close();await other.close();}
});


test('catalog managers maintain all work tasks while every seat owns its personal spaces', async ({ page, browser }) => {
  const env = await setup(true);
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  let memberModelRequests = 0;
  member.on('request', request => {
    if (new URL(request.url()).pathname === '/api/settings/model') memberModelRequests++;
  });
  await env.attach(page);
  await env.attach(member);
  try {
    await login(page, 'c');
    await createTask(page, '跨席位管理任务', 'public');
    await createTask(page, 'C 的个人资料', 'private');
    await logout(page);
    await login(page, 'a');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '模型', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.model-settings-form')).toBeVisible();
    await page.getByLabel('模型 ID', { exact: true }).fill('未保存的模型草稿');
    await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '账户', exact: true }).click();
    await expect(page.locator('.account-settings-content')).toContainText('用户 a');
    await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '模型', exact: true }).click();
    await expect(page.getByLabel('模型 ID', { exact: true })).toHaveValue('未保存的模型草稿');
    await page.keyboard.press('Escape');

    await expect(page.getByRole('button', { name: '新建项目', exact: true })).toHaveCount(0);
    for (const [label, action] of [['工作任务', '新建工作任务'], ['个人空间', '新建个人空间']]) {
      const header = page.locator('.workspace-groups .section-label').filter({ hasText: label });
      const create = header.getByRole('button', { name: action, exact: true });
      await expect(create).toBeVisible();
      const headerBox = await header.boundingBox();
      const createBox = await create.boundingBox();
      expect(headerBox).not.toBeNull();
      expect(createBox).not.toBeNull();
      expect(createBox!.x).toBeGreaterThan(headerBox!.x + headerBox!.width / 2);
    }
    await expect(page.getByRole('button', { name: /C 的个人资料/ })).toHaveCount(0);
    await page.getByRole('button', { name: '任务说明：跨席位管理任务', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '任务说明', exact: true })).toBeVisible();
    await expect(page.getByLabel('任务名称', { exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '归档任务', exact: true })).toBeVisible();
    await page.getByLabel('目标与说明', { exact: true }).fill('由另一管理席位更新的目标');
    await page.getByRole('button', { name: '保存说明', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await createTask(page, 'A 的个人资料', 'private');

    await login(member, 'b');
    await member.getByRole('button', { name: '设置', exact: true }).click();
    const memberSettings = member.getByRole('navigation', { name: '设置分类' });
    await expect(memberSettings.getByRole('button', { name: '账户', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(memberSettings.getByRole('button', { name: '模型', exact: true })).toHaveCount(0);
    await expect(member.locator('.model-settings-form')).toHaveCount(0);
    await expect(member.locator('.account-settings-content')).toContainText('用户 b');
    await expect(member.locator('.account-settings-content')).toContainText('席位 b');
    await expect(member.locator('.account-settings-content').getByText('b', { exact: true })).toBeVisible();
    await expect(member.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
    expect(memberModelRequests).toBe(0);
    await member.keyboard.press('Escape');
    await expect(member.getByRole('button', { name: '设置', exact: true })).toBeFocused();
    await expect(member.getByRole('button', { name: '新建项目', exact: true })).toHaveCount(0);
    await expect(member.getByRole('button', { name: '新建工作任务', exact: true })).toHaveCount(0);
    await expect(member.getByRole('button', { name: '新建个人空间', exact: true })).toBeVisible();
    await expect(member.getByRole('button', { name: /[AC] 的个人资料/ })).toHaveCount(0);
    await member.getByRole('button', { name: '任务说明：跨席位管理任务', exact: true }).click();
    await expect(member.getByLabel('任务名称', { exact: true })).toBeDisabled();
    await expect(member.getByLabel('目标与说明', { exact: true })).toBeDisabled();
    await expect(member.getByLabel('目标与说明', { exact: true })).toHaveValue('由另一管理席位更新的目标');
    await expect(member.getByRole('button', { name: '保存说明', exact: true })).toHaveCount(0);
    await expect(member.getByRole('button', { name: '归档任务', exact: true })).toHaveCount(0);
    await member.keyboard.press('Escape');

    await createTask(member, 'B 的个人资料', 'private');
    await member.getByRole('button', { name: '空间说明：B 的个人资料', exact: true }).click();
    await expect(member.getByRole('dialog', { name: '空间说明', exact: true })).toBeVisible();
    await expect(member.getByLabel('空间名称', { exact: true })).toBeEnabled();
    await member.getByLabel('空间名称', { exact: true }).fill('B 的个人笔记');
    await member.getByRole('button', { name: '保存说明', exact: true }).click();
    await expect(member.getByRole('dialog')).toBeHidden();
    await member.getByRole('button', { name: '空间说明：B 的个人笔记', exact: true }).click();
    member.once('dialog', dialog => dialog.accept());
    await member.getByRole('button', { name: '归档空间', exact: true }).click();
    await expect(member.getByRole('dialog')).toBeHidden();
    await expect(member.getByRole('button', { name: '空间说明：B 的个人笔记', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /B 的个人/ })).toHaveCount(0);

    await page.getByRole('button', { name: '任务说明：跨席位管理任务', exact: true }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '归档任务', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('button', { name: '任务说明：跨席位管理任务', exact: true })).toHaveCount(0);
    await member.route('**/api/auth/logout', route => route.fulfill({
      status: 503,
      json: { error: { code: 'TEMPORARILY_UNAVAILABLE', message: '退出暂时失败，请重试' } },
    }), { times: 1 });
    await member.getByRole('button', { name: '设置', exact: true }).click();
    const settingsDialog = member.getByRole('dialog', { name: '设置', exact: true });
    member.once('dialog', dialog => dialog.accept());
    await settingsDialog.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(settingsDialog.getByRole('alert')).toHaveText('退出暂时失败，请重试');
    await expect(settingsDialog.locator('.account-settings-content')).toContainText('用户 b');
    await expect(member.getByRole('button', { name: '登录', exact: true })).toHaveCount(0);
    member.once('dialog', dialog => dialog.accept());
    await settingsDialog.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(member.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    expect(memberModelRequests).toBe(0);
  } finally {
    await env.close();
    await memberContext.close();
  }
});


test('task catalog groups fold independently and creation stays accessible across desktop rail and mobile', async ({ page }) => {
  const env = await setup();
  await env.attach(page);
  let writes = 0;
  page.on('request', request => {
    if (['POST', 'PUT', 'DELETE'].includes(request.method()) && new URL(request.url()).pathname.startsWith('/api/')) writes++;
  });
  try {
    await login(page, 'a');
    await createTask(page, '分组中的工作任务', 'public');
    await createTask(page, '分组中的个人空间', 'private');
    await page.getByRole('button', { name: '在项目 分组中的个人空间 中新建对话', exact: true }).click();
    const draft = page.getByRole('textbox', { name: '发送消息', exact: true });
    await draft.fill('折叠分组时保留当前草稿');
    const writesBeforeFolding = writes;
    const publicEntry = page.getByRole('button', { name: '进入项目：分组中的工作任务', exact: true });
    const privateEntry = page.getByRole('button', { name: '进入项目：分组中的个人空间', exact: true });
    for (const label of ['工作任务', '个人空间']) {
      const header = page.locator('.catalog-heading').filter({ hasText: label });
      const create = header.getByRole('button', { name: `新建${label}`, exact: true });
      await draft.focus();
      await page.mouse.move(900, 600);
      await expect(create).toHaveCSS('opacity', '0');
      await header.hover();
      await expect(create).toHaveCSS('opacity', '1');
      await page.mouse.move(900, 600);
      await header.getByRole('button', { name: `折叠${label}`, exact: true }).focus();
      await expect(create).toHaveCSS('opacity', '1');
      await page.keyboard.press('Tab');
      await expect(create).toBeFocused();
      await expect(create).toHaveCSS('opacity', '1');
    }

    await page.getByRole('button', { name: '折叠工作任务', exact: true }).click();
    await expect(page.getByRole('button', { name: '展开工作任务', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(publicEntry).toBeHidden();
    await expect(privateEntry).toBeVisible();
    await page.getByRole('button', { name: '折叠个人空间', exact: true }).click();
    await expect(privateEntry).toBeHidden();
    await page.getByRole('button', { name: '展开工作任务', exact: true }).click();
    await expect(publicEntry).toBeVisible();
    await expect(privateEntry).toBeHidden();
    await page.locator('.catalog-heading').filter({ hasText: '个人空间' }).hover();
    await page.getByRole('button', { name: '新建个人空间', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '新建个人空间', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('button', { name: '展开个人空间', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(privateEntry).toBeHidden();
    await expect(draft).toHaveValue('折叠分组时保留当前草稿');
    expect(writes).toBe(writesBeforeFolding);

    await page.getByRole('button', { name: '折叠侧边栏', exact: true }).click();
    await expect(publicEntry).toBeVisible();
    await expect(privateEntry).toBeVisible();
    for (const action of ['新建工作任务', '新建个人空间']) {
      const create = page.getByRole('button', { name: action, exact: true });
      await expect(create).toBeVisible();
      await expect(create.locator('.catalog-rail-icon')).toBeVisible();
      await expect(create).toHaveCSS('opacity', '1');
      await create.click();
      await expect(page.getByRole('dialog', { name: action, exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(create).toBeFocused();
    }

    await page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
    await expect(publicEntry).toBeVisible();
    await expect(privateEntry).toBeHidden();
    await expect(page.getByRole('button', { name: '展开个人空间', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(draft).toHaveValue('折叠分组时保留当前草稿');
    expect(writes).toBe(writesBeforeFolding);

    await page.setViewportSize({ width: 375, height: 812 });
    const menu = page.getByRole('button', { name: '打开会话列表', exact: true });
    await menu.click();
    const create = page.getByRole('button', { name: '新建个人空间', exact: true });
    await expect(create).toHaveCSS('opacity', '1');
    await create.click();
    await expect(page.getByRole('dialog', { name: '新建个人空间', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.locator('.sidebar')).toHaveClass(/\bopen\b/);
    await expect(create).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.sidebar')).not.toHaveClass(/\bopen\b/);
    await expect(menu).toBeFocused();
  } finally {
    await env.close();
  }
});


test('directory outages show one content status, preserve navigation and drafts, and recover without writes', async ({ page }) => {
  const env = await setup();
  await env.attach(page);
  let failing = true;
  let writes = 0;
  try {
    await login(page, 'a');
    await createTask(page, '断连保留任务', 'public');
    await page.getByRole('button', { name: '在项目 断连保留任务 中新建对话' }).click();
    const composer = page.getByRole('textbox', { name: '发送消息' });
    await composer.fill('断连期间保留的草稿');
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') writes++; });
    await page.route('**/api/tasks', route => failing ? route.abort('failed') : route.fallback());
    await page.route('**/api/activity', route => failing ? route.abort('failed') : route.fallback());
    const status = page.getByRole('status', { name: '数据更新状态' });
    await expect(status).toContainText('暂时无法连接服务，正在重试。', { timeout: 10000 });
    await expect(status).toHaveCount(1);
    await expect(status.getByRole('button')).toHaveCount(0);
    await expect(page.locator('aside.sidebar').getByText(/Failed to fetch|暂时无法|重试/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: '进入项目：断连保留任务' })).toBeVisible();
    await expect(composer).toHaveValue('断连期间保留的草稿');
    await expect(status.getByRole('button', { name: '重新连接' })).toBeVisible({ timeout: 10000 });
    await status.getByRole('button', { name: '重新连接' }).click();
    await expect(status).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await status.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
    await expect(composer).toBeInViewport();
    failing = false;
    await expect(status).toHaveCount(0, { timeout: 10000 });
    await expect(composer).toHaveValue('断连期间保留的草稿');
    expect(writes).toBe(0);
  } finally { await env.close(); }
});

test('task read errors remain scoped instead of reporting a disconnected service', async ({ page }) => {
  const env = await setup();
  await env.attach(page);
  let failing = true;
  try {
    await login(page, 'a');
    await createTask(page, '读取失败保留任务', 'public');
    await page.route('**/api/tasks', route => failing ? route.fulfill({ status: 500, json: { error: { code: 'READ_ERROR', message: 'internal diagnostics' } } }) : route.fallback());
    const status = page.getByRole('status', { name: '数据更新状态' });
    await expect(status).toContainText('任务列表暂时无法更新，正在重试。', { timeout: 10000 });
    await expect(status).not.toContainText('无法连接服务');
    await expect(page.getByText('internal diagnostics')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '进入项目：读取失败保留任务' })).toBeVisible();
    await page.getByRole('button', { name: '收到的信息', exact: true }).click();
    await expect(status).toBeVisible();
    failing = false;
    await expect(status).toHaveCount(0, { timeout: 10000 });
  } finally { await env.close(); }
});
