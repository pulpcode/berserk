import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import type { AuthSession } from '../../src/contracts/access';
import type { ScenarioAction, ScenarioDefinitionSummary, ScenarioInstanceDetail, ScenarioMutationResult, ScenarioOperation, ScenarioTaskInitialization } from '../../src/contracts/scenarios';
import { defaultMapConfig } from '../../src/contracts/map';
import { openDatabase } from '../../src/access/database';
import { AccessStore } from '../../src/access/store';
import { PiLab } from '../../src/pi/lab';
import { createApp } from '../../src/server/app';
import { fakeRuntime, testConfig } from '../pi/fake-runtime';

const directorSeat = 'seat-director';
const businessSeats = ['seat-overall', 'seat-intelligence', 'seat-planning', 'seat-situation'];
const fixtureDefinition: ScenarioDefinitionSummary = {id:'ui-fire',version:'1',name:'临港仓储火情',description:'导演台桌面流程验证资料',definitionHash:'ui-fixture',businessDay:'2026-11-03',initialBusinessNow:'2026-11-03T09:10:00+08:00',modes:['main_story','source_replay'],counts:{vehicles:24,objects:53,resources:41,steps:2,messages:3},geography:{label:'合成业务覆盖层',attribution:'UI流程测试资料',bounds:[121,30,122,31],synthetic:true}};

/** Real authentication/SQLite/client behavior; source DTOs here are deterministic UI fixtures. */
async function setup(twoTasks = false) {
  const definition = twoTasks ? {...fixtureDefinition, id:'harbor-fire', version:'4', definitionHash:'a'.repeat(64)} : fixtureDefinition;
  const taskBootstrap = twoTasks ? {schemaVersion:2 as const,definitionId:'harbor-fire' as const,definitionVersion:'4' as const,definitionHash:definition.definitionHash,expectedTaskCodes:['T02','T03'] as ['T02','T03']} : undefined;
  const dir = await mkdtemp(join(tmpdir(), 'axon-director-web-'));
  const db = await openDatabase(dir), access = new AccessStore(db);
  for (const seat of [directorSeat, ...businessSeats]) await access.saveAccount({username:seat,displayName:seat===directorSeat?'演示操作员':seat,seatId:seat,seatName:seat===directorSeat?'导演席':seat,password:'test-password-123',createPublicTask:seat===directorSeat||seat==='seat-overall',manageModelSettings:false,controlScenarios:seat===directorSeat});
  db.close();
  const config = testConfig(dir,{seatId:directorSeat,auth:{secret:'director-ui-test-signing-secret-more-than-32',sessionMs:28800000}});
  const fake = await fakeRuntime(config,()=>({text:'没有调用模型的需要'}));
  const lab = await PiLab.create(config, fake.runtime), app = await createApp(lab);
  const details = new Map<string,ScenarioInstanceDetail>(), ledger = new Map<string,ScenarioMutationResult>(), initialized = new Map<string,ScenarioTaskInitialization>();
  const counts = {privateReads:0,create:0,apply:0,send:0,operationReads:0,initialize:0};
  const activationRequests:Record<string,string|number|boolean>[]=[];
  const pages:Page[]=[];
  let activeId:string|null=null,activeRevision=0,loseCreateResponse=false;
  let rejectActivation:string|undefined;
  let loseApplyResponse = false;
  let loseInitializeResponse = false;
  let interruptMessage = '';
  const sendIds: string[] = [], receiptReads: string[] = [];
  const messages = (runId: string, step: ScenarioInstanceDetail['steps'][number]) =>
    Array.from({length: step.messageCount}, (_, index) => ({
      sourceMessageId: `${runId}-${step.id}-${index + 1}`, title: step.title,
      text: `冻结的来源通知正文 ${index + 1}`, subjectId: 'warehouse', occurredAt: step.businessTime,
    }));
  const clock = (minute:number)=>`2026-11-03T09:${String(minute).padStart(2,'0')}:00+08:00`;
  const operation=(id:string,kind:ScenarioOperation['kind'],detail:ScenarioInstanceDetail,actor:{userId:string;seatId:string},actions:ScenarioAction[]=[]):ScenarioMutationResult=>{
    const op:ScenarioOperation={id,kind,instanceId:detail.instance.instanceId,revision:detail.instance.revision,businessNow:detail.instance.businessNow,createdAt:'2026-11-04T06:00:00Z',actor,actionIds:actions.map(a=>a.id)};
    detail.operations.unshift(op);const result={instance:structuredClone(detail.instance),operation:op,actions:structuredClone(actions)};ledger.set(id,result);return result;
  };
  async function attach(page:Page) {
    pages.push(page);
    await page.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url());
      const headers={...req.headers(),host:'127.0.0.1',origin:'http://localhost:4310'};
      const auth=await app.inject({method:'GET',url:'/api/auth/session',headers});
      const identity=(auth.json() as AuthSession).identity;
      const allowed=identity?.seatId===directorSeat&&identity.controlScenarios===true;
      if(url.pathname==='/api/context/map-config'){await route.fulfill({json:{...defaultMapConfig,scenarioControlEnabled:allowed,directorSeatId:directorSeat}});return;}
      if(url.pathname.startsWith('/api/simulation/')){
        if(req.method()==='GET')counts.privateReads++;
        if(!allowed){await route.fulfill({status:403,json:{error:{code:'SCENARIO_FORBIDDEN',message:'当前账号无权访问场景导演台。'}}});return;}
        const body=req.method()==='POST'?req.postDataJSON() as Record<string,string|number|boolean>:{};
        const respond=async(value:unknown,status=200)=>route.fulfill({status,json:value});
        if(url.pathname==='/api/simulation/scenarios'){await respond({items:[definition]});return;}
        if(url.pathname==='/api/simulation/instances'&&req.method()==='GET'){await respond({items:[...details.values()].map(d=>d.instance),activeInstanceId:activeId,activeRevision,hasMore:false,nextCursor:null});return;}
        if(url.pathname==='/api/simulation/instances'){
          counts.create++;
          const id=String(body.clientActionId),previous=ledger.get(id);
          if(previous){await respond(previous);return;}
          const instanceId=`run-${details.size+1}`;
          const detail:ScenarioInstanceDetail={instance:{instanceId,definitionId:definition.id,definitionVersion:definition.version,definitionHash:definition.definitionHash,name:definition.name,mode:body.mode==='source_replay'?'source_replay':'main_story',status:'prepared',paused:false,stepIndex:0,stepCount:2,businessNow:clock(10),revision:1,createdAt:'2026-11-04T06:00:00Z',updatedAt:'2026-11-04T06:00:00Z'},steps:[{id:'E01',title:'收到仓储火情',description:'新增火情来报，保留背景业务。',businessTime:clock(12),messageCount:1,taskCodes:['T01']},{id:'E02',title:'道路状态确认',description:'更新道路事实。',businessTime:clock(16),messageCount:2,taskCodes:['T02']}],taskDefinitions:['T01','T02','T03'].map((code,index)=>({code:code as 'T01'|'T02'|'T03',title:['仓储火情支援','交通救援','训练任务'][index],goal:'预设任务说明',businessRefs:[],areaIds:[]})),objects:[],reports:[],actions:[],operations:[]};
          if(taskBootstrap){detail.taskBootstrap=taskBootstrap;detail.taskDefinitions=detail.taskDefinitions!.filter(task=>task.code!=='T01');detail.steps[0].taskCodes=[];}
          details.set(instanceId,detail);
          const result=operation(id,'create',detail,identity!);
          if(loseCreateResponse){loseCreateResponse=false;await route.abort('failed');return;}
          await respond(result);return;
        }
        if(url.pathname.startsWith('/api/simulation/operations/')){counts.operationReads++;const result=ledger.get(url.pathname.split('/').at(-1)!);await respond(result||{error:{code:'NOT_FOUND',message:'未找到操作回执'}},result?200:404);return;}
        if(url.pathname.startsWith('/api/simulation/actions/')){
          const id=url.pathname.split('/')[4],action=[...details.values()].flatMap(d=>d.actions).find(a=>a.id===id)!;
          if(url.pathname.endsWith('/send')){
            counts.send++; sendIds.push(id);
            if(action.notification.sourceMessageId === interruptMessage) {
              interruptMessage = ''; action.sendState = 'unconfirmed';
              await route.abort('failed'); return;
            }
            action.sendState='accepted';action.receipt={eventId:randomUUID(),sourceMessageId:action.notification.sourceMessageId,receivedAt:'2026-11-04T06:00:00Z',status:'accepted'};} else receiptReads.push(id);
          await respond(action);return;
        }
        const segments=url.pathname.split('/'),id=segments[4],detail=details.get(id);
        if(!detail){await respond({error:{code:'NOT_FOUND',message:'实例不存在'}},404);return;}
        if(segments[5]==='preflight'){await respond({queuedJobs:0,runningJobs:0,foregroundRequests:0,unconfirmedNotifications:detail.actions.filter(a=>a.sendState==='unconfirmed').length,unsentNotifications:detail.actions.filter(a=>a.sendState==='unsent').length});return;}
        if(segments[5]==='initialize'){
          if(req.method()==='POST'){ counts.initialize++; initialized.set(id,{instanceId:id,initialized:true,...(taskBootstrap?{taskBootstrap}:{}),tasks:['T01','T02','T03'].map((code,index)=>({code:code as 'T01'|'T02'|'T03',taskId:`task-${index}`,title:['仓储火情支援','交通救援','训练任务'][index]})).filter(task=>!twoTasks||task.code!=='T01')});
            if(loseInitializeResponse){loseInitializeResponse=false;await route.abort('failed');return;}
          }
          await respond(initialized.get(id)||{instanceId:id,initialized:false,tasks:[]});return;
        }
        if(req.method()==='GET'){await respond(detail);return;}
        if(segments[5]==='preview'){
          const step=detail.steps[detail.instance.stepIndex]||null;
          await respond({instance:detail.instance,step,changes:step?['新增一份来源报告']:[],notifications:step ? messages(id,step) : [],canApply:!!step&&!detail.instance.paused,reason:detail.instance.paused?'本轮已暂停，请继续后再应用。':undefined});return;
        }
        const operationId=String(body.clientActionId),previous=ledger.get(operationId);
        if(previous){await respond(previous);return;}
        if(segments[5]==='activate'){
          activationRequests.push({...body});
          if(rejectActivation){const code=rejectActivation;rejectActivation=undefined;await respond({error:{code,message:code==='SCENARIO_ACTIVATION_PENDING'?`本轮激活尚待恢复，请核对并重试原操作 ${operationId}`:'场景已变化，请刷新后重新操作。'}},409);return;}
        }
        if(segments[5]==='steps' && (segments[6]!==detail.steps[detail.instance.stepIndex]?.id || body.expectedRevision!==detail.instance.revision)){
          await respond({error:{code:'REVISION_CONFLICT',message:'事件顺序或修订不匹配。'}},409);
          return;
        }
        detail.instance.revision++;
        if(segments[5]==='activate'){if(activeId && activeId!==id)details.get(activeId)!.instance.status='frozen';activeId=id;activeRevision++;detail.instance.status='active';await respond(operation(operationId,'activate',detail,identity!));return;}
        if(segments[5]==='control'){const paused=body.action==='pause';detail.instance.paused=paused;await respond(operation(operationId,paused?'pause':'resume',detail,identity!));return;}
        if(segments[5]==='steps'){
          counts.apply++;const step=detail.steps[detail.instance.stepIndex++];detail.instance.businessNow=step.businessTime;
          const actions: ScenarioAction[] = messages(id,step).map(notification => ({
            id: randomUUID(), instanceId: id, stepId: step.id, actor: identity!, systemId: 'intel',
            createdAt: '2026-11-04T06:00:00Z', revision: detail.instance.revision, sendState: 'unsent', notification,
          }));
          detail.actions.push(...actions);
          const result = operation(operationId,'step',detail,identity!,actions);
          if(loseApplyResponse){loseApplyResponse=false;await route.abort('failed');return;}
          await respond(result);return;
        }
        await respond({error:{code:'NOT_FOUND',message:'未注册测试路由'}},404);return;
      }
      const response=await app.inject({method:req.method() as 'GET'|'POST'|'PUT'|'DELETE',url:url.pathname+url.search,headers,...(req.postDataBuffer()?{payload:req.postDataBuffer()!}:{})});
      await route.fulfill({status:response.statusCode,headers:Object.fromEntries(Object.entries(response.headers).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)])),body:response.rawPayload});
    });
  }
  return {attach,counts,sendIds,loseNextInitialize:()=>{loseInitializeResponse=true;},receiptReads,loseNextApply:()=>{loseApplyResponse=true;},interruptSend:(messageId:string)=>{interruptMessage=messageId;},activationRequests,rejectNextActivation:(code:string)=>{rejectActivation=code;},loseNextCreate:()=>{loseCreateResponse=true;},calls:fake.calls,close:async()=>{for(const page of pages)if(!page.isClosed()){await page.goto('about:blank');await page.unrouteAll({behavior:'wait'});}await app.close();await rm(dir,{recursive:true,force:true});}};
}

async function login(page:Page,seat:string) {
  await page.goto('/');await page.getByLabel('席位',{exact:true}).selectOption(seat);await page.getByLabel('密码',{exact:true}).fill('test-password-123');await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByRole('button',{name:'登录',exact:true})).toHaveCount(0);
}

async function restart(page: Page, mode?: 'main_story' | 'source_replay') {
  await page.getByRole('button',{name:'重新演示',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'重新演示',exact:true});
  await expect(dialog.getByRole('combobox',{name:'场景',exact:true})).toBeEnabled();
  if(mode)await dialog.getByRole('combobox',{name:'演示模式',exact:true}).selectOption(mode);
  await dialog.getByRole('button',{name:'开始演示',exact:true}).click();
}
async function startRun(page: Page) {
  await login(page,directorSeat);
  await restart(page);
  const controls=page.getByRole('region',{name:'事件投放'});
  await expect(controls.getByRole('button',{name:'投放事件',exact:true})).toBeEnabled();
  return controls;
}

test('new scenes show a main task only after an actual notice association exists',async({page})=>{
  const env=await setup(true);await env.attach(page);
  const jobId=randomUUID(),taskId=randomUUID();let associated=false;
  await page.route('**/api/information/events/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/task-links'))await route.fulfill({json:{links:associated?[{task:{id:taskId,title:'人员创建的仓库核实任务'},mode:'include',jobId}]:[]}});
    else await route.fulfill({json:{jobs:[{id:jobId,kind:'preprocess',status:'succeeded'}]}});
  });
  try{
    const controls=await startRun(page);
    await page.locator('.director-step-toggle').first().hover();
    const detail=page.getByRole('region',{name:'收到仓储火情',exact:true});
    await expect(detail.getByText('仓储火情支援',{exact:true})).toHaveCount(0);
    await controls.getByRole('button',{name:'投放事件',exact:true}).click();
    await expect(page.locator('.director-step-toggle').first()).toContainText('已接收');
    await page.locator('.director-step-toggle').first().hover();
    await expect(detail.getByRole('button',{name:'人员创建的仓库核实任务',exact:true})).toHaveCount(0);
    associated=true;await page.reload();await page.locator('.director-step-toggle').first().hover();
    await expect(detail.getByRole('button',{name:'人员创建的仓库核实任务',exact:true})).toBeVisible();
    expect(env.counts.create).toBe(1);expect(env.counts.apply).toBe(1);expect(env.calls).toHaveLength(0);
    await page.screenshot({path:'test-results/scenario-business-director.png',fullPage:true});
  }finally{await env.close();}
});

test('the primary control delivers only the displayed event; hovering other events does not change its target',async({page})=>{
  const env = await setup(); await env.attach(page);
  try {
    const controls = await startRun(page);
    const next = controls.getByRole('button',{name:'投放事件',exact:true});
    await expect(controls).toContainText('09:12');
    await expect(controls).toContainText('收到仓储火情');
    await page.locator('.director-step-toggle').nth(1).hover();
    await expect(page.getByRole('region',{name:'道路状态确认',exact:true})).toContainText('交通救援');
    await expect(controls).toContainText('收到仓储火情');
    expect(env.counts.apply).toBe(0); expect(env.counts.send).toBe(0);
    await next.dblclick();
    await expect(controls).toContainText('道路状态确认');
    await expect(page.locator('.director-step-toggle').first()).toContainText('已接收');
    expect(env.counts.apply).toBe(1); expect(env.counts.send).toBe(1);
    await page.reload();
    await expect(controls).toContainText('09:16');
    await next.click();
    await expect(page.locator('.director-step-toggle').nth(1)).toContainText('已接收');
    expect(env.counts.apply).toBe(2); expect(env.counts.send).toBe(3);
    expect(new Set(env.sendIds).size).toBe(3);
    await expect(controls).toContainText('待方案选择');
    await expect(next).toHaveCount(0);
    expect(env.calls).toHaveLength(0);
    await page.setViewportSize({width:1080,height:850});
    expect(await controls.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  } finally {await env.close();}
});

test('partial final delivery survives reload, checks receipt and retries only the unresolved notification',async({page})=>{
  const env=await setup();await env.attach(page);
  try {
    const controls=await startRun(page);
    const next=controls.getByRole('button',{name:'投放事件',exact:true});
    await next.click();
    await expect(controls).toContainText('道路状态确认');
    env.interruptSend('run-1-E02-2');
    await next.click();
    const check=controls.getByRole('button',{name:'核对接收回执',exact:true});
    await expect(check).toBeEnabled();
    expect(env.counts.apply).toBe(2);expect(env.sendIds).toHaveLength(3);
    await page.reload();await expect(check).toBeEnabled();
    expect(env.sendIds).toHaveLength(3);
    await check.click();
    await controls.getByRole('button',{name:'继续投放',exact:true}).click();
    await expect(page.locator('.director-step-toggle').nth(1)).toContainText('已接收');
    expect(env.receiptReads).toContain(env.sendIds[2]);
    expect(env.sendIds).toHaveLength(4);expect(env.sendIds[3]).toBe(env.sendIds[2]);
    expect(env.counts.apply).toBe(2);
  } finally {await env.close();}
});

test('a lost apply response is reconciled before explicitly continuing its notifications',async({page})=>{
  const env=await setup();await env.attach(page);
  try {
    const controls=await startRun(page);
    env.loseNextApply();
    await controls.getByRole('button',{name:'投放事件',exact:true}).click();
    await expect(page.getByRole('button',{name:'核对操作结果'})).toBeEnabled();
    await page.reload();
    await page.getByRole('button',{name:'核对操作结果'}).click();
    const resume=controls.getByRole('button',{name:'继续投放',exact:true});
    await expect(resume).toBeEnabled();
    expect(env.counts.send).toBe(0);
    await resume.click();await expect(controls).toContainText('道路状态确认');
    expect(env.counts.apply).toBe(1); expect(env.counts.send).toBe(1);
  } finally {await env.close();}
});

test('four business seats have no director entry and cannot trigger private director reads',async({browser})=>{
  const env=await setup();
  try {
    for(const seat of businessSeats){
      const context=await browser.newContext(),page=await context.newPage();await env.attach(page);
      try {
        await login(page,seat);await expect(page.getByRole('button',{name:'场景导演台',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'工作待办',exact:true})).toBeVisible();
        const reads=env.counts.privateReads;await page.goto('/scenario-director');await expect(page.getByRole('heading',{name:'无权访问场景导演台',exact:true})).toBeVisible();expect(env.counts.privateReads).toBe(reads);
        await page.getByRole('button',{name:'返回业务工作台',exact:true}).click();await expect(page).toHaveURL(/\/work$/);await expect(page.getByRole('button',{name:'工作待办',exact:true})).toBeVisible();
      } finally {await context.close();}
    }
    expect(env.counts.create).toBe(0);expect(env.counts.apply).toBe(0);expect(env.counts.send).toBe(0);expect(env.calls).toHaveLength(0);
  } finally {await env.close();}
});

test('replay prepares and activates a fresh run while history opens old runs without writes',async({page})=>{
  const env=await setup();await env.attach(page);
  try {
    const controls=await startRun(page);
    await expect(page.locator('.director-sidebar')).toHaveCount(0);
    await expect(page.getByRole('combobox',{name:'场景实例'})).toHaveCount(0);
    await controls.getByRole('button',{name:'投放事件',exact:true}).click();
    await restart(page,'source_replay');
    await expect(controls).toContainText('09:10');
    await expect(controls.getByRole('button',{name:'投放事件',exact:true})).toBeEnabled();
    expect(env.counts.create).toBe(2);expect(env.counts.initialize).toBe(2);
    expect(env.counts.apply).toBe(1);expect(env.counts.send).toBe(1);
    await page.reload();
    await page.getByRole('button',{name:'重新演示',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'重新演示'}).getByRole('combobox',{name:'演示模式',exact:true})).toHaveValue('source_replay');
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'演示记录',exact:true}).click();
    const history=page.getByRole('dialog',{name:'演示记录',exact:true});
    await expect(history).toBeVisible();await expect(history).toContainText('已结束');
    // The created timestamp is human-readable; instance IDs are disclosed under technical data.
    await expect(history.getByText('run-1',{exact:true})).not.toBeVisible();
    const old=history.getByRole('button').filter({hasText:'已结束'});
    await old.click();
    const preview=history.getByRole('region',{name:'演示详情',exact:true});
    await expect(preview).toContainText('09:12');
    for(const name of ['投放事件','继续准备','重新演示','开始演示','启用本轮','锁定轮次']) {
      await expect(preview.getByRole('button',{name,exact:true})).toHaveCount(0);
    }
    await expect(controls).toContainText('09:10');
    await preview.getByRole('button',{name:'操作记录',exact:true}).click();
    await expect(preview.getByRole('table')).toContainText('应用事件');
    await page.keyboard.press('Escape');
    await expect(history).toHaveCount(0);
    await controls.getByRole('button',{name:'投放事件',exact:true}).click();
    await expect(controls).toContainText('道路状态确认');
    const saved=await page.evaluate(async()=> {
      const list=await (await fetch('/api/simulation/instances')).json();
      const first=await(await fetch('/api/simulation/instances/run-1')).json();
      return {active:list.activeInstanceId,oldStep:first.instance.stepIndex,oldState:first.instance.status};
    });
    expect(saved).toEqual({active:'run-2',oldStep:1,oldState:'frozen'});
    expect(env.counts.create).toBe(2);expect(env.counts.apply).toBe(2);
    expect(env.calls).toHaveLength(0);
  }finally{await env.close();}
});

for(const stage of ['create','initialize','activate'] as const) {
  test(`replay ${stage} interruption resumes the same checkpoint after reload`,async({page})=>{
    const env=await setup();await env.attach(page);
    try {
      await login(page,directorSeat);
      if(stage==='create')env.loseNextCreate();
      if(stage==='initialize')env.loseNextInitialize();
      if(stage==='activate')env.rejectNextActivation('SCENARIO_ACTIVATION_PENDING');
      await restart(page);
      const resume=page.getByRole('button',{name:'核对并继续',exact:true});
      await expect(resume).toBeEnabled();
      expect(env.counts.create).toBe(1);
      const original=env.activationRequests[0];
      await page.reload();
      await page.locator('details[aria-label="待完成准备"] > summary').click();
      await page.getByRole('button',{name:'查看准备',exact:true}).click();
      await expect(page.getByRole('dialog',{name:'恢复演示准备',exact:true})).toBeVisible();
      await expect(resume).toBeEnabled();
      expect(env.counts.create).toBe(1);expect(env.counts.apply).toBe(0);
      await resume.click();
      await expect(page.getByRole('region',{name:'事件投放'}).getByRole('button',{name:'投放事件',exact:true})).toBeEnabled();
      expect(env.counts.create).toBe(1);expect(env.counts.initialize).toBe(1);
      expect(env.counts.send).toBe(0);
      if(stage==='activate')expect(env.activationRequests[1]).toEqual(original);
    }finally{await env.close();}
  });
}

test('replay refuses an unresolved notification and opening settings or history performs no scene writes',async({page})=>{
  const env=await setup();await env.attach(page);
  try {
    const controls=await startRun(page);
    env.interruptSend('run-1-E01-1');
    await controls.getByRole('button',{name:'投放事件',exact:true}).click();
    await expect(controls.getByRole('button',{name:'核对接收回执',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'重新演示',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'重新演示',exact:true});
    await expect(dialog).toContainText('未确认');
    await expect(dialog.getByRole('button',{name:'开始演示',exact:true})).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'演示设置',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'演示设置',exact:true}).getByRole('combobox',{name:'演示模式',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    expect(env.counts.create).toBe(1);expect(env.counts.initialize).toBe(1);
    expect(env.counts.send).toBe(1);
  }finally{await env.close();}
});

test('replay requires consent before ending a run with unsent messages',async({page})=>{
  const env=await setup();await env.attach(page);
  try {
    const controls=await startRun(page);
    env.loseNextApply();
    await controls.getByRole('button',{name:'投放事件',exact:true}).click();
    await page.getByRole('button',{name:'核对操作结果',exact:true}).click();
    await expect(controls.getByRole('button',{name:'继续投放',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'重新演示',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'重新演示',exact:true});
    const start=dialog.getByRole('button',{name:'开始演示',exact:true});
    await expect(start).toBeDisabled();
    await dialog.getByRole('checkbox',{name:/放弃当前演示未发送的 1 条通知/}).check();
    await start.click();
    await expect(controls.getByRole('button',{name:'投放事件',exact:true})).toBeEnabled();
    expect(env.activationRequests.at(-1)?.terminateUnsent).toBe(true);
    expect(env.counts.create).toBe(2);expect(env.counts.send).toBe(0);
  }finally{await env.close();}
});

test('hover expands an event in the list, moving between rows stays stable, and keyboard can keep details open',async({page})=>{
  const env=await setup();await env.attach(page);
  try {
    await startRun(page);
    const rows=page.locator('.director-steps > li');
    const first=rows.nth(0).locator('.director-step-toggle');
    const second=rows.nth(1).locator('.director-step-toggle');
    const details=page.locator('.director-step-body');
    const before=(await second.boundingBox())!;
    await first.hover({position:{x:12,y:12}});
    await expect(rows.nth(0).getByRole('region',{name:'收到仓储火情',exact:true})).toBeVisible();
    expect((await second.boundingBox())!.y).toBeGreaterThan(before.y);
    await expect(page.locator('.director-event-popover')).toHaveCount(0);
    await details.hover();
    await page.waitForTimeout(400);
    await expect(first).toHaveAttribute('aria-expanded','true');
    await second.hover({position:{x:12,y:12}});
    await expect(second).toHaveAttribute('aria-expanded','true');
    await page.waitForTimeout(600);
    await expect(second).toHaveAttribute('aria-expanded','true');
    await expect(details).toContainText('交通救援');
    await expect(details).toHaveCount(1);
    await page.getByRole('heading',{name:'场景导演台',exact:true}).hover();
    await expect(details).toHaveCount(0);
    await first.focus();
    await page.keyboard.press('Enter');
    await expect(first).toHaveAttribute('aria-expanded','true');
    await page.getByRole('heading',{name:'场景导演台',exact:true}).hover();
    await expect(details).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(details).toHaveCount(0);
    await expect(first).toBeFocused();
    await page.setViewportSize({width:1080,height:850});
    await second.hover({position:{x:12,y:12}});
    await expect(details).toBeVisible();
    const bounds=(await details.boundingBox())!;
    expect(bounds.x+bounds.width).toBeLessThanOrEqual(1080);
    expect(env.counts.apply).toBe(0);expect(env.counts.send).toBe(0);
    await page.getByRole('heading',{name:'场景导演台',exact:true}).hover();
    await expect(details).toHaveCount(0);
    await expect(page.getByText('操作记录与来源资料',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'演示记录',exact:true}).click();const records=page.getByRole('dialog',{name:'演示记录',exact:true});await expect(records).toBeVisible();await records.getByRole('button').filter({hasText:'当前演示'}).click();await records.getByRole('button',{name:'操作记录',exact:true}).click();await expect(records.getByRole('table')).toContainText('创建本轮');
    await records.getByRole('button',{name:'数据概况',exact:true}).click();await expect(records.getByText('来源对象',{exact:true})).toBeVisible();await expect(records.getByText('run-1',{exact:true})).not.toBeVisible();await records.getByText('技术信息',{exact:true}).click();await expect(records.getByText('run-1',{exact:true})).toBeVisible();
    await page.keyboard.press('Escape');await expect(records).toHaveCount(0);await expect(page.getByRole('button',{name:'演示记录',exact:true})).toBeFocused();
    expect(env.counts.create).toBe(1);expect(env.counts.apply).toBe(0);expect(env.counts.send).toBe(0);expect(env.calls).toHaveLength(0);
  }finally{await env.close();}
});


test('prepared history and a history URL stay read-only while live control remains on the active run',async({page})=>{
  const env=await setup();await env.attach(page);
  try {
    const controls=await startRun(page);
    await page.evaluate(async()=> {
      const auth=await(await fetch('/api/auth/session')).json();
      const response=await fetch('/api/simulation/instances',{method:'POST',headers:{
        'Content-Type':'application/json','x-csrf-token':auth.csrf,'x-axon-view':auth.viewId,
      },body:JSON.stringify({definitionId:'ui-fire',version:'1',mode:'main_story',clientActionId:crypto.randomUUID()})});
      if(!response.ok)throw Error('prepare fixture failed');
    });
    await page.goto('/scenario-director?instance=run-2');
    const history=page.getByRole('dialog',{name:'演示记录',exact:true});
    const preview=history.getByRole('region',{name:'演示详情',exact:true});
    await expect(preview).toContainText('准备中');
    await expect(preview.getByRole('button',{name:'继续准备',exact:true})).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(controls.getByRole('button',{name:'投放事件',exact:true})).toBeEnabled();
    expect(env.counts.create).toBe(2);expect(env.counts.initialize).toBe(1);
    await page.locator('details[aria-label="待完成准备"] > summary').click();
    await page.getByRole('button',{name:'继续准备',exact:true}).click();
    const recovery=page.getByRole('dialog',{name:'恢复演示准备',exact:true});
    await expect(recovery).toContainText('临港仓储火情');
    await expect(recovery).toContainText('当前演示');
    await page.keyboard.press('Escape');
    await controls.getByRole('button',{name:'投放事件',exact:true}).click();
    await expect(controls).toContainText('道路状态确认');
    expect(env.counts.apply).toBe(1);
    const active=await page.evaluate(async()=> (await(await fetch('/api/simulation/instances')).json()).activeInstanceId);
    expect(active).toBe('run-1');expect(env.calls).toHaveLength(0);
  }finally{await env.close();}
});

test('an old scene definition remains readable but cannot deliver or unlock; a fresh replay stays available',async({page})=>{
  const env=await setup();await env.attach(page);
  try {
    await startRun(page);
    await page.route('**/api/simulation/scenarios',route=>route.fulfill({json:{items:[{...fixtureDefinition,version:'2',definitionHash:'new-geography'}]}}));
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('场景定义已更新');
    await expect(page.getByRole('region',{name:'事件投放'}).getByRole('button',{name:'投放事件',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'演示设置',exact:true}).click();
    const settings=page.getByRole('dialog',{name:'演示设置',exact:true});
    await settings.getByText('轮次管理',{exact:true}).click();
    await expect(settings.getByRole('button',{name:'锁定轮次',exact:true})).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'演示记录',exact:true}).click();
    const records=page.getByRole('dialog',{name:'演示记录',exact:true});
    await records.getByRole('button').filter({hasText:'当前演示'}).click();
    await expect(records.getByRole('region',{name:'演示详情'})).toContainText('收到仓储火情');
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'重新演示',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'重新演示',exact:true}).getByRole('button',{name:'开始演示',exact:true})).toBeEnabled();
    expect(env.counts.create).toBe(1);expect(env.counts.apply).toBe(0);expect(env.counts.send).toBe(0);expect(env.calls).toHaveLength(0);
  }finally{await env.close();}
});
