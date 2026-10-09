import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { TaskAssessment } from '../../src/contracts/task-information';
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

async function setup(rule = true, reply?: Parameters<typeof fakeRuntime>[1], extraSources = false) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-information-web-'));
  const db = await openDatabase(dir); const access = new AccessStore(db);
  const users = new Map<string, string>();
  for (const name of ['a', 'b', 'c']) users.set(name, await access.saveAccount({ username: name, displayName: `用户 ${name}`, seatId: name, seatName: `席位 ${name.toUpperCase()}`, password: 'test-password-123', createPublicTask: name === 'a', manageModelSettings: name === 'a' }));
  const actor = access.identity(users.get('a')!)!;
  const task = access.create(actor, { title: '联合分析任务', goal: '综合收到资料形成分析', visibility: 'public', clientActionId: randomUUID() });
  const second = access.create(actor, { title: '设备转移任务', goal: '安排设备转移', visibility: 'public', clientActionId: randomUUID() });
  db.close();
  const config = testConfig(dir, { seatId: 'a', auth: { secret: 'test-only-signing-key-at-least-32-characters', sessionMs: 28800000 } });
  const fake = await fakeRuntime(config, reply || (() => ({ text: '预处理结果：道路中断，需要核实恢复时间。' })));
  const lab = await PiLab.create(config, fake.runtime); const store = new BackgroundStore(lab.access!.db);
  store.grant('seat', 'a', 'incoming', 'manage'); store.grant('seat', 'c', 'incoming', 'view');
  const ruleInput = { name: '资料预处理并投递', sourceId: 'incoming', profileId: 'preprocess', recipientSeatIds: ['a', 'b'], enabled: true };
  if (rule) store.createRule(actor.userId, randomUUID(), ruleInput);
  if(extraSources){store.grant('seat','a','situation','view');for(const sourceId of ['situation','restricted'])store.createRule(actor.userId,randomUUID(),{...ruleInput,sourceId,recipientSeatIds:sourceId==='situation'?['a']:['b']});}
  const background = parseBackgroundConfig({ enabled: true, sources: [{ sourceId: 'incoming', name: '资料接入', credentialRef: 'TEST_INFORMATION_TOKEN', allowedProfileIds: ['preprocess'], allowedRecipientSeatIds: ['a', 'b'] }, ...(extraSources ? ['situation','restricted'].map(sourceId=>({sourceId,name:sourceId==='situation'?'态势接入':'受限接入',credentialRef:`TEST_INFORMATION_${sourceId.toUpperCase()}`,allowedProfileIds:['preprocess'],allowedRecipientSeatIds:['a','b']})) : [])], profiles: [{ id: 'preprocess', name: '资料预处理', goal: '整理事实和待核实问题', tools: ['source_read'] }] });
  const token = 'test-information-source-secret-value'; const app = await createApp(lab, false, { config: background, env: { TEST_INFORMATION_TOKEN: token,TEST_INFORMATION_SITUATION:`${token}-situation`,TEST_INFORMATION_RESTRICTED:`${token}-restricted` } });
  const pages: Page[] = []; let loseCreateResponse=false;
  const attach = async (page: Page) => {
    pages.push(page);
    await page.route('**/api/**', async route => {
      const request = route.request(); const url = new URL(request.url());
      const response = await app.inject({ method: request.method() as 'GET' | 'POST' | 'PUT' | 'DELETE', url: url.pathname + url.search, headers: { ...request.headers(), host: '127.0.0.1', origin: 'http://localhost:4310' }, ...(request.postDataBuffer() ? { payload: request.postDataBuffer()! } : {}) });
      if(loseCreateResponse && request.method()==='POST' && /^\/api\/information\/events\/[^/]+\/tasks$/.test(url.pathname)){loseCreateResponse=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEST_LOST_RESPONSE',message:'本次响应未收到，请核对创建结果'}})});return;}
      await route.fulfill({ status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])), body: response.rawPayload });
    });
  };
  async function receive(title = '道路通行信息', withFile = false, sourceId = 'incoming') {
    const sourceToken=sourceId==='incoming'?token:`${token}-${sourceId}`;
    let uploadIds: string[] | undefined;
    if (withFile) {
      const bytes = Buffer.from('附件原文：道路施工，等待恢复。');
      const created = await app.inject({ method: 'POST', url: '/api/integrations/incoming/uploads', headers: { host: '127.0.0.1', authorization: `Bearer ${sourceToken}` }, payload: { name: '任务材料.txt', size: bytes.length } });
      expect(created.statusCode, created.body).toBe(201); const uploadId = created.json<{ uploadId: string }>().uploadId;
      const saved = await app.inject({ method: 'PUT', url: `/api/integrations/incoming/uploads/${uploadId}/content`, headers: { host: '127.0.0.1', authorization: `Bearer ${sourceToken}`, 'content-type': 'application/octet-stream' }, payload: bytes });
      expect(saved.statusCode, saved.body).toBe(200); uploadIds = [uploadId];
    }
    const result = await app.inject({ method: 'POST', url: `/api/integrations/${sourceId}/events`, headers: { host: '127.0.0.1', authorization: `Bearer ${sourceToken}` }, payload: { sourceMessageId: randomUUID(), title, text: '道路因施工中断，恢复时间待核实。', ...(uploadIds ? { uploadIds } : {}) } });
    expect(result.statusCode, result.body).toBe(202); return result.json<{ eventId: string }>().eventId;
  }
  return { loseNextCreateResponse:()=>{loseCreateResponse=true;}, lab, store, fake, task, second, actor, ruleInput, attach, receive, close: async () => { for (const page of pages) if (!page.isClosed()) { await page.goto('about:blank').catch(() => {}); await page.unrouteAll({ behavior: 'wait' }); } await app.close(); await rm(dir, { recursive: true, force: true }); } };
}
async function login(page: Page, name: string) {
  await page.goto('/'); await page.getByLabel('账号', { exact: true }).fill(name); await page.getByLabel('密码', { exact: true }).fill('test-password-123'); await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page.getByRole('button', { name: '登录', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
}
async function inbox(page: Page) { await page.getByRole('button', { name: '收到的信息', exact: true }).click(); await page.locator('.information-inbox .information-list').getByRole('button', { name: /道路通行信息/ }).click(); }

function assess(env: Awaited<ReturnType<typeof setup>>, input: Pick<TaskAssessment, 'items'|'newTaskSuggestion'|'emptyReason'>) {
  const job = env.store.listJobs().find(item=>item.kind==='preprocess')!;
  env.store.transaction(()=>env.store.saveTaskAssessmentInTransaction(job,{...input,recordedAt:new Date().toISOString(),toolCallId:'fixture-assessment'}));
  return job;
}

test('multi-task information is visible without workspace creation; task continuation fixes its destination and preserves chat drafts', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    const eventId = await env.receive(); await expect.poll(()=>env.store.listDeliveries().filter(item=>item.status==='delivered').length).toBe(2);
    const job=assess(env,{items:[{taskSpaceId:env.task.id,taskRevision:env.task.revision,reason:'道路中断影响综合分析'},{taskSpaceId:env.second.id,taskRevision:env.second.revision,reason:'设备转移需确认道路'}]});
    const calls=env.fake.calls.length;
    await login(page,'a'); await inbox(page);
    const continuation = page.locator('.information-continuation');
    await expect(continuation.getByRole('button', { name: env.task.title, exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(continuation.getByRole('button', { name: env.second.title, exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('heading', { name: '后续处理', exact: true })).toHaveCount(0);
    await page.getByLabel('问题或工作要求').fill('收件入口独立草稿');
    await continuation.screenshot({ path: '/tmp/axon-continuation-compact.png' });
    await page.getByRole('button',{name:'相关信息：联合分析任务',exact:true}).click();
    await expect(page.getByRole('complementary',{name:'会话与资料'})).toBeVisible();
    await page.getByRole('button',{name:/道路通行信息.*自动关联/}).click();
    const detail=page.locator('.task-information .information-detail');
    await expect(detail.getByRole('heading',{name:'道路通行信息',exact:true})).toBeVisible();
    expect(env.lab.workspaces.list('a').workspaces).toHaveLength(0); expect(env.fake.calls).toHaveLength(calls);
    const url=page.url();expect(url).toContain(`eventId=${eventId}`);expect(url).toContain(`jobId=${job.id}`);
    await page.reload();await expect(detail.getByRole('heading',{name:'道路通行信息',exact:true})).toBeVisible();expect(page.url()).toBe(url);
    await expect(detail.getByLabel('处理位置', { exact: true })).toHaveCount(0);
    await detail.getByLabel('问题或工作要求').fill('针对联合分析任务继续核实');
    await detail.getByRole('button',{name:'发送并进入对话',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'发送消息',exact:true})).toHaveValue('');
    await expect.poll(() => env.fake.calls.length).toBe(calls + 1);
    const action=env.store.listActions().find(item=>item.kind==='analysis')!;
    expect(action.taskSpaceId).toBe(env.task.id);expect(action.origin?.kind).toBe('task_information');
    expect(env.lab.get(action.sessionId!, 'a').messages.filter(message => message.role === 'user')).toHaveLength(1);
    await page.getByRole('textbox',{name:'发送消息',exact:true}).fill('对话里的下一条草稿');
    await page.getByRole('button',{name:'相关信息：设备转移任务',exact:true}).click();
    await expect(page.locator('.workspace-header .workspace-name')).toHaveText('设备转移任务');
    await expect(page.locator('.workspace-header').getByRole('button',{name:'项目资料',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:/道路通行信息.*自动关联/}).click();
    await expect(page.locator('.task-information').getByLabel('问题或工作要求')).toHaveValue('');
    await page.locator('.session-item.selected').click();await expect(page.getByRole('textbox',{name:'发送消息',exact:true})).toHaveValue('对话里的下一条草稿');
    await inbox(page);await expect(page.getByRole('textbox',{name:'问题或工作要求',exact:true})).toHaveValue('收件入口独立草稿');
    await page.screenshot({path:'test-results/task-information-desktop.png',fullPage:true});
  } finally { await env.close(); }
});

test('one information item can start conversations in both related tasks without unlocking a completed form', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  const messageSessions: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/messages')) messageSessions.push(new URL(request.url()).pathname.split('/')[3]!); });
  try {
    await env.receive(); await expect.poll(() => env.store.listDeliveries().filter(item => item.status === 'delivered').length).toBe(2);
    assess(env, { items: [env.task, env.second].map(task => ({ taskSpaceId: task.id, taskRevision: task.revision, reason: '同一道路信息与本任务相关' })) });
    const calls = env.fake.calls.length;
    await login(page, 'a'); await inbox(page);
    const continuation = page.locator('.information-continuation');
    for (const task of [env.task, env.second]) {
      await continuation.getByRole('button', { name: task.title, exact: true }).click();
      await continuation.getByLabel('问题或工作要求').fill(`请分析对${task.title}的影响`);
      await continuation.getByRole('button', { name: '发送并进入对话', exact: true }).click();
      await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toHaveValue('');
      await expect.poll(() => messageSessions.length).toBe(task === env.task ? 1 : 2);
      await inbox(page);
      await expect(continuation.getByLabel('问题或工作要求')).toBeEnabled();
      await expect(continuation.getByLabel('问题或工作要求')).toHaveValue('');
      await expect(continuation.getByRole('button', { name: task.title, exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(continuation.getByRole('button', { name: '再次处理', exact: true })).toHaveCount(0);
      await expect(continuation.getByRole('button', { name: '查询本次结果', exact: true })).toHaveCount(0);
    }
    const actions = env.store.listActions().filter(action => action.kind === 'analysis');
    expect(actions).toHaveLength(2); expect(new Set(actions.map(action => action.taskSpaceId))).toEqual(new Set([env.task.id, env.second.id]));
    expect(new Set(actions.map(action => action.sessionId))).toEqual(new Set(messageSessions));
    expect(new Set(actions.map(action => action.workspaceId)).size).toBe(2);
    await expect.poll(() => env.fake.calls.length).toBe(calls + 2);
    await page.reload(); await expect(continuation.getByLabel('问题或工作要求')).toBeEnabled();
    expect(messageSessions).toHaveLength(2); expect(env.store.listActions().filter(action => action.kind === 'analysis')).toHaveLength(2);
    await expect(page.locator('.information-timeline').getByRole('button', { name: '进入关联对话', exact: true })).toHaveCount(2);
    expect(env.store.listJobs().filter(job => job.kind === 'preprocess')).toHaveLength(1);
  } finally { await env.close(); }
});

test('queued background analysis unlocks the same information for another task and preserves material choices', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    const eventId = await env.receive('道路通行信息', true); await expect.poll(() => env.store.listDeliveries().filter(item => item.status === 'delivered').length).toBe(2);
    assess(env, { items: [env.task, env.second].map(task => ({ taskSpaceId: task.id, taskRevision: task.revision, reason: '共用道路待核实' })) });
    const queue = env.store.getControl('queue'); env.store.setControl('queue', queue.revision, false, env.actor.userId);
    const calls = env.fake.calls.length;
    await login(page, 'a'); await inbox(page);
    const continuation = page.locator('.information-continuation');
    await continuation.locator('.continuation-materials > summary').click();
    await continuation.getByRole('checkbox', { name: /任务材料.txt/ }).check();
    await continuation.locator('.continuation-more > summary').click();
    for (const task of [env.task, env.second]) {
      await continuation.getByRole('button', { name: task.title, exact: true }).click();
      await continuation.getByLabel('Skill（可选）').selectOption('synthesis');
      await continuation.getByLabel('问题或工作要求').fill(`请在后台核实${task.title}`);
      await continuation.getByRole('button', { name: '后台处理', exact: true }).click();
      await page.getByRole('button', { name: '确认提交后台分析', exact: true }).click();
      await expect(continuation.getByLabel('问题或工作要求')).toBeEnabled();
      await expect(continuation.getByLabel('问题或工作要求')).toHaveValue('');
      await expect(continuation.getByRole('checkbox', { name: /任务材料.txt/ })).toBeChecked();
      await expect(continuation.getByRole('checkbox', { name: '本次分析', exact: true })).toBeChecked();
      await expect(continuation.getByLabel('Skill（可选）')).toHaveValue('synthesis');
    }
    const jobs = env.store.listJobs().filter(job => job.kind === 'seat_analysis');
    expect(jobs).toHaveLength(2); expect(jobs.every(job => job.status === 'queued' && job.eventId === eventId)).toBe(true);
    expect(new Set(jobs.map(job => job.taskSpaceId))).toEqual(new Set([env.task.id, env.second.id]));
    const actions = env.store.listActions().filter(action => action.kind === 'analysis');
    expect(actions.every(action => action.imports?.length === 1)).toBe(true);
    expect(new Set(actions.map(action => action.workspaceId)).size).toBe(2);
    expect(env.fake.calls).toHaveLength(calls);
    await page.reload(); await expect(continuation.getByLabel('问题或工作要求')).toBeEnabled();
    await expect(continuation.getByLabel('问题或工作要求')).toHaveValue('');
    expect(env.store.listJobs().filter(job => job.kind === 'seat_analysis')).toHaveLength(2);
  } finally { await env.close(); }
});

test('new-task suggestion uses editable public task form; unknown response is queried without creating a duplicate or workspace', async ({ page, browser }) => {
  const env = await setup(); const context=await browser.newContext();const b=await context.newPage();await env.attach(page);await env.attach(b);
  try {
    await env.receive();await expect.poll(()=>env.store.listDeliveries().filter(item=>item.status==='delivered').length).toBe(2);
    const job=assess(env,{items:[],newTaskSuggestion:{title:'新增道路核实任务',goal:'明确道路恢复时间与现场条件',reason:'已有任务不能承接独立现场核实'}});
    await login(b,'b');await inbox(b);await expect(b.getByRole('heading',{name:'建议新建公共任务'})).toBeVisible();await expect(b.getByRole('button',{name:'创建公共任务并关联',exact:true})).toHaveCount(0);
    await login(page,'a');await inbox(page);await page.getByRole('button',{name:'创建公共任务并关联',exact:true}).click();
    const panel=page.getByRole('dialog',{name:'创建公共任务并关联',exact:true});await expect(panel.getByLabel('任务名称')).toHaveValue('新增道路核实任务');
    await panel.getByLabel('任务名称').fill('人员确认后的核实任务');await panel.getByLabel('目标与说明').fill('请现场核实恢复时间并报告');
    env.loseNextCreateResponse();
    await panel.getByRole('button',{name:'创建公共任务并关联',exact:true}).click();
    await expect(panel.getByRole('alert')).toContainText('本次响应未收到');
    await expect(panel.getByLabel('任务名称')).toHaveValue('人员确认后的核实任务');
    await panel.getByRole('button',{name:'核对创建结果',exact:true}).click();
    await expect(panel).toHaveCount(0);
    await expect(page.locator('.task-suggestion')).toContainText('已创建');
    const created=env.store.getJob(job.id).taskSuggestionCreation!;expect(created).toBeDefined();
    expect(env.lab.access!.get(created.taskSpaceId,'a').title).toBe('人员确认后的核实任务');
    expect(env.lab.workspaces.list('a').workspaces).toHaveLength(0);
    await page.reload();await expect(page.locator('.task-suggestion')).toContainText('已创建');
    expect(env.lab.access!.list('a').filter(task=>task.title==='人员确认后的核实任务')).toHaveLength(1);
    await page.locator('.task-suggestion').getByRole('button',{name:'人员确认后的核实任务'}).click();
    await expect(page.locator('.task-information')).toContainText('道路通行信息');
  }finally{await env.close();await context.close();}
});

test('manual link conflict keeps draft and requires reading the latest decision before retry', async ({ page }) => {
  const env=await setup();await env.attach(page);
  try{
    const eventId=await env.receive();await expect.poll(()=>env.store.listDeliveries().filter(item=>item.status==='delivered').length).toBe(2);
    assess(env,{items:[{taskSpaceId:env.task.id,taskRevision:env.task.revision,reason:'原始自动关联理由'}]});
    await login(page,'a');await inbox(page);await page.getByRole('button',{name:'调整关联',exact:true}).click();
    const editor=page.locator('.task-link-editor');await editor.getByLabel('关联理由').fill('我正在编辑的关联理由');
    let conflict=true;
    await page.route(`**/api/information/events/${eventId}/task-links/${env.task.id}`,async route=>{
      if(route.request().method()==='PUT' && conflict){conflict=false;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:{code:'INFORMATION_LINK_CONFLICT',message:'关联已变化'}})});}else await route.fallback();
    });
    await editor.getByRole('button',{name:'保存关联'}).click();await expect(page.getByRole('alert')).toContainText('编辑内容已保留');await expect(editor.getByLabel('关联理由')).toHaveValue('我正在编辑的关联理由');
    await editor.getByRole('button',{name:'查看最新关联'}).click();await expect(editor.locator('.task-comparison')).toContainText('原始自动关联理由');await expect(editor.getByLabel('关联理由')).toHaveValue('我正在编辑的关联理由');
    await editor.getByRole('button',{name:'已核对，继续编辑'}).click();await editor.getByRole('button',{name:'保存关联'}).click();await expect(editor).toHaveCount(0);await expect(page.locator('.task-association-list')).toContainText('人工保留');
    await page.getByRole('button',{name:'调整关联',exact:true}).click();await editor.getByLabel('处理方式').selectOption('exclude');await editor.getByRole('button',{name:'保存关联'}).click();await expect(page.locator('.task-association-list')).toContainText('已移除');
    await page.getByRole('button',{name:'相关信息：联合分析任务',exact:true}).click();await expect(page.locator('.task-information')).toContainText('当前没有符合条件的获准关联信息');
  }finally{await env.close();}
});

test('a late prepared-session response cannot leave the newly selected task or overwrite its draft', async ({ page }) => {
  const env=await setup();await env.attach(page);let release:(()=>void)|undefined;
  try{
    await env.receive();await expect.poll(()=>env.store.listDeliveries().filter(item=>item.status==='delivered').length).toBe(2);
    assess(env,{items:[{taskSpaceId:env.task.id,taskRevision:env.task.revision,reason:'与本任务相关'},{taskSpaceId:env.second.id,taskRevision:env.second.revision,reason:'与设备转移相关'}]});
    await login(page,'a');await page.getByRole('button',{name:'相关信息：联合分析任务',exact:true}).click();await page.getByRole('button',{name:/道路通行信息.*自动关联/}).click();
    await page.getByRole('textbox',{name:'问题或工作要求',exact:true}).fill('旧任务准备中的目标');
    let held=false;
    await page.route('**/api/sessions/*',async route=>{
      if(!held && route.request().method()==='GET'){held=true;await new Promise<void>(resolve=>{release=resolve;});}
      await route.fallback();
    });
    await page.getByRole('button',{name:'发送并进入对话',exact:true}).click();await expect.poll(()=>Boolean(release)).toBe(true);
    await page.getByRole('button',{name:'相关信息：设备转移任务',exact:true}).click();await page.getByRole('button',{name:/道路通行信息.*自动关联/}).click();
    await page.getByRole('textbox',{name:'问题或工作要求',exact:true}).fill('新任务正在编辑的内容');
    const response=page.waitForResponse(result=>/\/api\/sessions\/[^/]+$/.test(new URL(result.url()).pathname));release!();await response;
    await expect(page.getByRole('heading',{name:'设备转移任务 · 相关信息'})).toBeVisible();await expect(page.getByRole('textbox',{name:'问题或工作要求',exact:true})).toHaveValue('新任务正在编辑的内容');
    expect(env.store.listActions().filter(item=>item.kind==='analysis')).toHaveLength(1);
  }finally{release?.();await env.close();}
});

test('a manually added task can be restored to automatic judgment and added again after a conflict', async ({ page }) => {
  const env=await setup();await env.attach(page);
  try{
    const eventId=await env.receive();await expect.poll(()=>env.store.listDeliveries().filter(item=>item.status==='delivered').length).toBe(2);
    assess(env,{items:[{taskSpaceId:env.task.id,taskRevision:env.task.revision,reason:'仅自动关联综合任务'}]});
    await login(page,'a');await inbox(page);
    const editor=page.locator('.task-link-editor');const associations=page.locator('.task-association-list');
    await page.getByRole('button',{name:'关联已有任务或个人空间',exact:true}).click();await editor.getByLabel('任务或个人空间').selectOption(env.second.id);await editor.getByLabel('关联理由').fill('人员补充设备转移关联');await editor.getByRole('button',{name:'保存关联'}).click();
    const second=associations.getByRole('listitem').filter({has:page.getByRole('button',{name:'设备转移任务',exact:true})});
    await expect(second).toContainText('人工保留');await second.getByRole('button',{name:'调整关联',exact:true}).click();await editor.getByLabel('处理方式').selectOption('auto');await editor.getByRole('button',{name:'保存关联'}).click();await expect(second).toHaveCount(0);
    await page.getByRole('button',{name:'关联已有任务或个人空间',exact:true}).click();await editor.getByLabel('任务或个人空间').selectOption(env.second.id);await editor.getByLabel('关联理由').fill('核对后再次补充');
    let concurrent=false;const submittedRevisions:number[]=[];
    await page.route(`**/api/information/events/${eventId}/task-links/${env.second.id}`,async route=>{
      if(route.request().method()==='PUT'){
        submittedRevisions.push(route.request().postDataJSON().revision);
        if(!concurrent){
          concurrent=true;
          // Another editor saves an automatic decision while this form retains its previous revision.
          env.store.transaction(()=>{
            const row=env.store.db.prepare('SELECT data FROM information_task_overrides WHERE event_id=? AND task_id=?').get(eventId,env.second.id)!;
            const value=JSON.parse(String(row.data));
            env.store.db.prepare('UPDATE information_task_overrides SET data=? WHERE event_id=? AND task_id=?').run(JSON.stringify({...value,revision:value.revision+1}),eventId,env.second.id);
          });
        }
      }
      await route.fallback();
    });
    await editor.getByRole('button',{name:'保存关联'}).click();await expect(page.getByRole('alert')).toContainText('编辑内容已保留');expect(submittedRevisions).toEqual([2]);
    await editor.getByRole('button',{name:'查看最新关联'}).click();await expect(editor.locator('.task-comparison')).toContainText('当前没有人工保留或自动关联');await expect(editor.getByLabel('关联理由')).toHaveValue('核对后再次补充');
    await editor.getByRole('button',{name:'已核对，继续编辑'}).click();await editor.getByRole('button',{name:'保存关联'}).click();await expect(editor).toHaveCount(0);await expect(second).toContainText('核对后再次补充');expect(submittedRevisions).toEqual([2,3]);
  }finally{await env.close();}
});

test('source choices cover later pages and remain available when switching directly between sources', async ({ page }) => {
  const env=await setup(true,undefined,true);await env.attach(page);
  try{
    const olderId=await env.receive('较早态势信息',false,'situation');
    for(let i=0;i<26;i++)await env.receive(`接入信息 ${i+1}`);
    await env.receive('不可见的受限信息',false,'restricted');
    await expect.poll(()=>env.store.listDeliveries().filter(item=>item.status==='delivered').length).toBe(54);
    const older={...env.store.getEvent(olderId),receivedAt:'2020-01-01T00:00:00.000Z'};
    env.store.db.prepare('UPDATE background_events SET received_at=?,data=? WHERE id=?').run(older.receivedAt,JSON.stringify(older),older.id);
    for(const job of env.store.listJobs())env.store.transaction(()=>env.store.saveTaskAssessmentInTransaction(job,{items:[{taskSpaceId:env.task.id,taskRevision:env.task.revision,reason:'与联合分析任务相关'}],recordedAt:new Date().toISOString(),toolCallId:'fixture-assessment'}));
    await login(page,'a');await page.getByRole('button',{name:'相关信息：联合分析任务',exact:true}).click();
    const panel=page.locator('.task-information');const source=panel.getByRole('combobox',{name:'来源',exact:true});
    await expect(panel.locator('.information-list li')).toHaveCount(25);
    await expect(panel.getByRole('button',{name:/较早态势信息/})).toHaveCount(0);
    await expect(source.locator('option')).toHaveText(['全部来源','资料接入','态势接入']);
    await source.selectOption('situation');await expect(panel.locator('.information-list li')).toHaveCount(1);await expect(panel.getByRole('button',{name:/较早态势信息/})).toBeVisible();
    await source.selectOption('incoming');await expect(panel.locator('.information-list li')).toHaveCount(25);
    await expect(source.locator('option')).toHaveText(['全部来源','资料接入','态势接入']);
    await expect(panel).not.toContainText('受限接入');
  }finally{await env.close();}
});


test('task and personal-space plus controls appear on hover or keyboard focus without starting work', async ({ page }) => {
  const env = await setup(); await env.attach(page);
  try {
    env.lab.access!.create(env.actor, { title: '个人验证空间', goal: '', visibility: 'private', clientActionId: randomUUID() });
    await login(page, 'a');
    await page.mouse.move(1200, 850);
    const publicPlus = page.getByRole('button', { name: '新建工作任务', exact: true });
    const privatePlus = page.getByRole('button', { name: '新建个人空间', exact: true });
    const rowPlus = page.getByRole('button', { name: '在项目 联合分析任务 中新建对话', exact: true });
    await expect(publicPlus).toHaveCSS('opacity', '0'); await expect(privatePlus).toHaveCSS('opacity', '0'); await expect(rowPlus).toHaveCSS('opacity', '0');
    await page.locator('.catalog-heading').filter({ has: publicPlus }).hover();
    await expect(publicPlus).toHaveCSS('opacity', '1'); await expect(privatePlus).toHaveCSS('opacity', '0');
    await page.locator('.workspace-group-heading').filter({ has: rowPlus }).hover();
    await expect(rowPlus).toHaveCSS('opacity', '1');
    await page.mouse.move(1200, 850); await rowPlus.focus(); await expect(rowPlus).toHaveCSS('opacity', '1');
    await rowPlus.press('Enter'); await expect(page.getByRole('textbox', { name: '发送消息', exact: true })).toBeEnabled();
    expect(env.fake.calls).toHaveLength(0);
  } finally { await env.close(); }
});
