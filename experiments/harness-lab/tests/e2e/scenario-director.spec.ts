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
const definition: ScenarioDefinitionSummary = {id:'ui-fire',version:'1',name:'临港仓储火情',description:'导演台桌面流程验证资料',definitionHash:'ui-fixture',businessDay:'2026-11-03',initialBusinessNow:'2026-11-03T09:10:00+08:00',modes:['main_story','source_replay'],counts:{vehicles:24,objects:53,resources:41,steps:2,messages:2},geography:{label:'合成业务覆盖层',attribution:'UI流程测试资料',bounds:[121,30,122,31],synthetic:true}};

/** Real authentication/SQLite/client behavior; source DTOs here are deterministic UI fixtures. */
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'axon-director-web-'));
  const db = await openDatabase(dir), access = new AccessStore(db);
  for (const seat of [directorSeat, ...businessSeats]) await access.saveAccount({username:seat,displayName:seat===directorSeat?'演示操作员':seat,seatId:seat,seatName:seat===directorSeat?'导演席':seat,password:'test-password-123',createPublicTask:seat===directorSeat||seat==='seat-overall',manageModelSettings:false,controlScenarios:seat===directorSeat});
  db.close();
  const config = testConfig(dir,{seatId:directorSeat,auth:{secret:'director-ui-test-signing-secret-more-than-32',sessionMs:28800000}});
  const fake = await fakeRuntime(config,()=>({text:'没有调用模型的需要'}));
  const lab = await PiLab.create(config, fake.runtime), app = await createApp(lab);
  const details = new Map<string,ScenarioInstanceDetail>(), ledger = new Map<string,ScenarioMutationResult>(), initialized = new Map<string,ScenarioTaskInitialization>();
  const counts = {privateReads:0,create:0,apply:0,send:0,operationReads:0};
  const activationRequests:Record<string,string|number|boolean>[]=[];
  const pages:Page[]=[];
  let activeId:string|null=null,activeRevision=0,loseCreateResponse=false;
  let rejectActivation:string|undefined;
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
          const detail:ScenarioInstanceDetail={instance:{instanceId,definitionId:definition.id,definitionVersion:definition.version,definitionHash:definition.definitionHash,name:definition.name,mode:body.mode==='source_replay'?'source_replay':'main_story',status:'prepared',paused:false,stepIndex:0,stepCount:2,businessNow:clock(10),revision:1,createdAt:'2026-11-04T06:00:00Z',updatedAt:'2026-11-04T06:00:00Z'},steps:[{id:'E01',title:'收到仓储火情',description:'新增火情来报，保留背景业务。',businessTime:clock(12),messageCount:1,taskCodes:['T01']},{id:'E02',title:'道路状态确认',description:'更新道路事实。',businessTime:clock(16),messageCount:1,taskCodes:['T02']}],taskDefinitions:['T01','T02','T03'].map((code,index)=>({code:code as 'T01'|'T02'|'T03',title:['仓储火情支援','交通救援','训练任务'][index],goal:'预设任务说明',businessRefs:[],areaIds:[]})),objects:[],reports:[],actions:[],operations:[]};
          details.set(instanceId,detail);
          const result=operation(id,'create',detail,identity!);
          if(loseCreateResponse){loseCreateResponse=false;await route.abort('failed');return;}
          await respond(result);return;
        }
        if(url.pathname.startsWith('/api/simulation/operations/')){counts.operationReads++;const result=ledger.get(url.pathname.split('/').at(-1)!);await respond(result||{error:{code:'NOT_FOUND',message:'未找到操作回执'}},result?200:404);return;}
        if(url.pathname.startsWith('/api/simulation/actions/')){
          const id=url.pathname.split('/')[4],action=[...details.values()].flatMap(d=>d.actions).find(a=>a.id===id)!;
          if(url.pathname.endsWith('/send')){counts.send++;action.sendState='accepted';action.receipt={eventId:randomUUID(),sourceMessageId:action.notification.sourceMessageId,receivedAt:'2026-11-04T06:00:00Z',status:'accepted'};}
          await respond(action);return;
        }
        const segments=url.pathname.split('/'),id=segments[4],detail=details.get(id);
        if(!detail){await respond({error:{code:'NOT_FOUND',message:'实例不存在'}},404);return;}
        if(segments[5]==='initialize'){
          if(req.method()==='POST')initialized.set(id,{instanceId:id,initialized:true,tasks:['T01','T02','T03'].map((code,index)=>({code:code as 'T01'|'T02'|'T03',taskId:`task-${index}`,title:['仓储火情支援','交通救援','训练任务'][index]}))});
          await respond(initialized.get(id)||{instanceId:id,initialized:false,tasks:[]});return;
        }
        if(req.method()==='GET'){await respond(detail);return;}
        if(segments[5]==='preview'){
          const step=detail.steps[detail.instance.stepIndex]||null;
          await respond({instance:detail.instance,step,changes:step?['新增一份来源报告']:[],notifications:[],canApply:!!step&&!detail.instance.paused,reason:detail.instance.paused?'本轮已暂停，请继续后再应用。':undefined});return;
        }
        const operationId=String(body.clientActionId),previous=ledger.get(operationId);
        if(previous){await respond(previous);return;}
        if(segments[5]==='activate'){
          activationRequests.push({...body});
          if(rejectActivation){const code=rejectActivation;rejectActivation=undefined;await respond({error:{code,message:code==='SCENARIO_ACTIVATION_PENDING'?`本轮激活尚待恢复，请核对并重试原操作 ${operationId}`:'场景已变化，请刷新后重新操作。'}},409);return;}
        }
        detail.instance.revision++;
        if(segments[5]==='activate'){activeId=id;activeRevision++;detail.instance.status='active';await respond(operation(operationId,'activate',detail,identity!));return;}
        if(segments[5]==='control'){const paused=body.action==='pause';detail.instance.paused=paused;await respond(operation(operationId,paused?'pause':'resume',detail,identity!));return;}
        if(segments[5]==='steps'){
          counts.apply++;const step=detail.steps[detail.instance.stepIndex++];detail.instance.businessNow=step.businessTime;
          const action:ScenarioAction={id:randomUUID(),instanceId:id,stepId:step.id,actor:identity!,systemId:'intel',createdAt:'2026-11-04T06:00:00Z',revision:detail.instance.revision,sendState:'unsent',notification:{sourceMessageId:`${id}-${step.id}`,title:step.title,text:'冻结的来源通知正文',subjectId:'warehouse',occurredAt:step.businessTime}};
          detail.actions.push(action);await respond(operation(operationId,'step',detail,identity!,[action]));return;
        }
        await respond({error:{code:'NOT_FOUND',message:'未注册测试路由'}},404);return;
      }
      const response=await app.inject({method:req.method() as 'GET'|'POST'|'PUT'|'DELETE',url:url.pathname+url.search,headers,...(req.postDataBuffer()?{payload:req.postDataBuffer()!}:{})});
      await route.fulfill({status:response.statusCode,headers:Object.fromEntries(Object.entries(response.headers).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)])),body:response.rawPayload});
    });
  }
  return {attach,counts,activationRequests,rejectNextActivation:(code:string)=>{rejectActivation=code;},loseNextCreate:()=>{loseCreateResponse=true;},calls:fake.calls,close:async()=>{for(const page of pages)if(!page.isClosed()){await page.goto('about:blank');await page.unrouteAll({behavior:'wait'});}await app.close();await rm(dir,{recursive:true,force:true});}};
}

async function login(page:Page,seat:string) {
  await page.goto('/');await page.getByLabel('席位',{exact:true}).selectOption(seat);await page.getByLabel('密码',{exact:true}).fill('test-password-123');await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByRole('button',{name:'登录',exact:true})).toHaveCount(0);
}

test('director has its own page and controls only explicit events and notifications',async({page})=>{
  const env=await setup();await env.attach(page);
  try {
    await login(page,directorSeat);await expect(page).toHaveURL(/\/scenario-director$/);await expect(page.getByRole('heading',{name:'场景导演台',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'场景导演台',exact:true})).toBeVisible();expect(env.counts.create).toBe(0);expect(env.counts.apply).toBe(0);expect(env.counts.send).toBe(0);
    await page.getByRole('button',{name:'创建新轮',exact:true}).click();await expect(page.getByLabel('本轮场景时间')).toContainText('09:10');await expect(page.getByRole('heading',{name:'本轮任务',exact:true})).toHaveCount(0);await expect(page.locator('.director-event-tasks')).toContainText('仓储火情支援');
    await page.getByRole('button',{name:'创建演示任务',exact:true}).click();await expect(page.getByRole('button',{name:'启用本轮',exact:true})).toBeEnabled();await page.getByRole('button',{name:'启用本轮',exact:true}).click();
    await page.getByRole('button',{name:'预览变化',exact:true}).click();await expect(page.locator('.director-step-toggle').filter({hasText:'收到仓储火情'})).toBeVisible();expect(env.counts.apply).toBe(0);
    await page.getByRole('button',{name:'应用本步事实',exact:true}).click();await expect(page.getByLabel('本轮场景时间')).toContainText('09:12');expect(env.counts.apply).toBe(1);expect(env.counts.send).toBe(0);
    await page.getByRole('button',{name:'暂停投放',exact:true}).click();await expect(page.getByRole('button',{name:'发送通知',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'继续投放',exact:true}).click();await page.getByRole('button',{name:'发送通知',exact:true}).click();await expect(page.locator('.director-step-toggle').first()).toContainText('已接收');await page.locator('.director-step-toggle').first().click();await expect(page.getByLabel('通知投放与核对')).toContainText('接收已确认');expect(env.counts.send).toBe(1);
    await page.reload();await expect(page.getByLabel('本轮场景时间')).toContainText('09:12');expect(env.counts.create).toBe(1);expect(env.counts.apply).toBe(1);expect(env.counts.send).toBe(1);expect(env.calls).toHaveLength(0);
    await expect(page.locator('.director-event-tasks')).toContainText('交通救援');await expect(page.locator('.director-start')).toHaveCount(0);await page.screenshot({path:join(tmpdir(),'axon-scenario-director-desktop.png'),fullPage:true});
    await page.setViewportSize({width:1080,height:850});const bounds=await page.locator('.scenario-director').boundingBox();expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(1080);
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

test('lost create response survives reload and is reconciled without another POST',async({page})=>{
  const env=await setup();await env.attach(page);
  try {
    await login(page,directorSeat);env.loseNextCreate();await page.getByRole('button',{name:'创建新轮',exact:true}).click();await expect(page.getByRole('region',{name:'待核对操作'})).toBeVisible();expect(env.counts.create).toBe(1);
    await page.reload();await expect(page.getByRole('button',{name:'核对操作结果',exact:true})).toBeVisible();expect(env.counts.create).toBe(1);
    await page.getByRole('button',{name:'核对操作结果',exact:true}).click();await expect(page.getByRole('region',{name:'待核对操作'})).toHaveCount(0);await expect(page.getByLabel('本轮场景时间')).toContainText('09:10');expect(env.counts.operationReads).toBe(1);expect(env.counts.create).toBe(1);
  } finally {await env.close();}
});

test('partly completed activation survives reload and retries only the original request after checking its receipt',async({page})=>{
  const env=await setup();await env.attach(page);
  try{
    await login(page,directorSeat);await page.getByRole('button',{name:'创建新轮',exact:true}).click();await page.getByRole('button',{name:'创建演示任务',exact:true}).click();await page.getByRole('button',{name:'启用本轮',exact:true}).click();await page.getByRole('button',{name:'暂停投放',exact:true}).click();
    await page.getByRole('button',{name:'创建新轮',exact:true}).click();await page.getByRole('button',{name:'创建演示任务',exact:true}).click();env.rejectNextActivation('SCENARIO_ACTIVATION_PENDING');
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'启用本轮',exact:true}).click();
    const pending=page.getByRole('region',{name:'待核对操作'});await expect(pending).toBeVisible();await expect(page.getByRole('button',{name:'创建新轮',exact:true})).toBeDisabled();expect(env.activationRequests).toHaveLength(2);
    const original={...env.activationRequests[1]!};await page.reload();await expect(pending).toBeVisible();expect(env.activationRequests).toHaveLength(2);await expect(page.getByRole('button',{name:'重试原请求',exact:true})).toHaveCount(0);
    await pending.getByRole('button',{name:'核对操作结果',exact:true}).click();await expect(pending.getByRole('button',{name:'重试原请求',exact:true})).toBeVisible();expect(env.counts.operationReads).toBe(1);
    await pending.getByRole('button',{name:'重试原请求',exact:true}).click();await expect(pending).toHaveCount(0);await expect(page.getByRole('button',{name:'暂停投放',exact:true})).toBeVisible();
    expect(env.activationRequests).toHaveLength(3);expect(env.activationRequests[2]).toEqual(original);expect(env.calls).toHaveLength(0);
  }finally{await env.close();}
});

test('a definitive activation conflict clears the request and permits refreshed inputs',async({page})=>{
  const env=await setup();await env.attach(page);
  try{
    await login(page,directorSeat);await page.getByRole('button',{name:'创建新轮',exact:true}).click();await page.getByRole('button',{name:'创建演示任务',exact:true}).click();env.rejectNextActivation('REVISION_CONFLICT');await page.getByRole('button',{name:'启用本轮',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('场景已变化');await expect(page.getByRole('region',{name:'待核对操作'})).toHaveCount(0);await expect(page.getByRole('button',{name:'启用本轮',exact:true})).toBeEnabled();
    const previous=env.activationRequests[0]!.clientActionId;await page.getByRole('button',{name:'启用本轮',exact:true}).click();await expect(page.getByRole('button',{name:'暂停投放',exact:true})).toBeVisible();expect(env.activationRequests[1]!.clientActionId).not.toBe(previous);expect(env.calls).toHaveLength(0);
  }finally{await env.close();}
});
