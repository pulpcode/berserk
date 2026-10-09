import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { parseBackgroundConfig } from '../src/background/config.js';
import { BackgroundStore } from '../src/background/store.js';
import type { AuthSession, TaskSpace } from '../src/contracts/access.js';
import type { BackgroundAction, BackgroundPage, BackgroundReceipt, InboxDetail, InboxItem } from '../src/contracts/background.js';
import type { TaskInformationDetail, TaskInformationItem, TaskLinksView, TaskSuggestionCreateResult } from '../src/contracts/task-information.js';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { createMockContextServer } from '../scripts/mock-context/server.js';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const env = {INPUT_TOKEN:'test-task-link-input-token-at-least-24', CONTEXT_TOKEN:'test-query-token-only'};
async function login(app: FastifyInstance, username: string) {
  const boot = await app.inject('/api/auth/session');
  const result = await app.inject({method:'POST',url:'/api/auth/login',headers:{cookie:boot.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':boot.json<AuthSession>().csrf!},payload:{username,password:'test-password-123'}});
  expect(result.statusCode,result.body).toBe(200);
  const auth=result.json<AuthSession>(),headers={cookie:result.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':auth.csrf!,'x-axon-view':auth.viewId!};
  return {auth,call:(url:string,payload?:object,method:'POST'|'PUT'='POST')=>app.inject({url,method:payload===undefined?'GET':method,headers,...(payload===undefined?{}:{payload})})};
}
async function fixture(mode:'existing'|'suggestion'|'legacy'='existing') {
  const dir=await mkdtemp(join(tmpdir(),'axon-task-information-api-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));
  const db=await openDatabase(dir),access=new AccessStore(db);
  for(const seat of ['a','b','c'])await access.saveAccount({username:seat,displayName:seat,seatId:seat,seatName:seat,password:'test-password-123',createPublicTask:seat==='a',manageModelSettings:seat==='a'});
  db.close();
  const mock=createMockContextServer({token:env.CONTEXT_TOKEN}),baseUrl=await mock.listen();cleanup.push(()=>mock.close());
  const config=testConfig(dir,{seatId:'a',auth:{secret:'test-task-information-secret-32-chars',sessionMs:28800000}});
  const fake=await fakeRuntime(config,context=>{
    const last=context.messages.at(-1);
    if(context.tools?.some(tool=>tool.name==='information_record_task_assessment')){
      if(last?.role==='user')return {tools:[{name:'task_search',arguments:{}}]};
      if(last?.role==='toolResult'&&last.toolName==='task_search'){
        const raw=last.content.find(block=>block.type==='text');
        const tasks=JSON.parse(raw?.type==='text'?raw.text:'{}').data.items as TaskSpace[];
        return {text:'完整分析正文：已核对来文与候选任务，按下列判断归口。',tools:[{name:'information_record_task_assessment',arguments:mode==='suggestion'
          ? {relations:[],newTaskSuggestion:{title:'新资料编制',goal:'编制独立来文要求的说明。',reason:'已查询活动任务，没有合适的承接任务。'}}
          : {relations:tasks.filter(task=>task.title.startsWith('西区')).map(task=>({taskId:task.id,reason:`与${task.title}关注道路相关。`}))}}]};
      }
    }
    return {text:'分析结果：根据实际资料核对任务影响。'};
  });
  const lab=await PiLab.create(config,fake.runtime);
  const background=parseBackgroundConfig({enabled:true,concurrency:1,modelConcurrency:1,sources:[{sourceId:'input',name:'测试来源',credentialRef:'INPUT_TOKEN',allowedProfileIds:['analysis'],allowedRecipientSeatIds:['a','b']}],profiles:[{id:'analysis',name:'信息研判',goal:'判断相关任务或提出新建建议。',instructions:'PRIVATE_SERVICE_CONFIG',tools:mode==='legacy'?['source_read']:['task_search','information_record_task_assessment'],...(mode==='legacy'?{}:{contextScopeId:'demo'})}]});
  const app=await createApp(lab,false,{config:background,env},mode==='legacy'?undefined:{config:{systems:[{id:'intel',name:'测试资料',adapter:'mock-information-http',baseUrl:`${baseUrl}/intel`,tokenEnv:'CONTEXT_TOKEN'}],scopes:[{id:'demo',name:'资料范围',systemIds:['intel'],seatIds:['a','b']}]},env});cleanup.push(()=>app.close());
  const store=new BackgroundStore(lab.access!.db);store.grant('seat','a','input','manage');
  const a=await login(app,'a'),b=await login(app,'b'),c=await login(app,'c');
  const source=(path:string,payload:object)=>app.inject({url:`/api/integrations/input/${path}`,method:'POST',headers:{authorization:`Bearer ${env.INPUT_TOKEN}`},payload});
  const created=await a.call('/api/information/rules',{clientActionId:randomUUID(),name:'投递 A/B',sourceId:'input',profileId:'analysis',recipientSeatIds:['a','b'],enabled:true});expect(created.statusCode,created.body).toBe(200);
  return {dir,app,lab,store,a,b,c,source,fake};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function task(f:Fixture,title:string,visibility:'public'|'private'='public') {
  const response=await f.a.call('/api/tasks',{title,goal:'核对任务条件',visibility,clientActionId:randomUUID()});expect(response.statusCode,response.body).toBe(200);return response.json<TaskSpace>();
}
async function receive(f:Fixture,withFile=false) {
  const uploadIds:string[]=[];
  if(withFile){
    const response=await f.source('uploads',{name:'输入.txt',size:Buffer.byteLength('独立输入附件')});expect(response.statusCode,response.body).toBe(201);
    const id=response.json<{uploadId:string}>().uploadId;
    const content=await f.app.inject({url:`/api/integrations/input/uploads/${id}/content`,method:'PUT',headers:{authorization:`Bearer ${env.INPUT_TOKEN}`,'content-type':'application/octet-stream'},payload:Buffer.from('独立输入附件')});expect(content.statusCode,content.body).toBe(200);uploadIds.push(id);
  }
  const accepted=await f.source('events',{sourceMessageId:randomUUID(),title:'来文要求',text:'核对西区工作或按需要编制说明。',uploadIds});expect(accepted.statusCode,accepted.body).toBe(202);
  const event=f.store.getEvent(accepted.json<BackgroundReceipt>().eventId),id=event.initialJobId!;
  await vi.waitFor(()=>expect(['queued','running']).not.toContain(f.store.getJob(id).status),{timeout:10000,interval:20});
  const job=f.store.getJob(id);expect(job.status,JSON.stringify(job.error)).toBe('succeeded');
  await vi.waitFor(()=>expect(f.store.listDeliveries(id).filter(d=>d.status==='delivered')).toHaveLength(2));
  return {event,job};
}
const listUrl=(taskId:string)=>`/api/tasks/${taskId}/information`;
const linksUrl=(eventId:string,jobId:string)=>`/api/information/events/${eventId}/task-links?jobId=${jobId}`;

describe('task information HTTP/native Pi integration',()=>{
  it('publishes one native assessment to two tasks, filters rights, and leaves browsing without workspace side effects',async()=>{
    const f=await fixture(),west=await task(f,'西区补给'),transfer=await task(f,'西区转移'),east=await task(f,'东区任务');await task(f,'私人目标','private');
    const {event,job}=await receive(f);
    expect(job.taskAssessment?.items.map(i=>i.taskSpaceId).sort()).toEqual([west.id,transfer.id].sort());
    for(const publicTask of [west,transfer]){
      const result=await f.b.call(`${listUrl(publicTask.id)}?offset=0&limit=25`);expect(result.statusCode,result.body).toBe(200);
      const listed=result.json<BackgroundPage<TaskInformationItem>>();expect(listed.total).toBe(1);expect(listed.items[0].jobId).toBe(job.id);
      const detail=await f.b.call(`${listUrl(publicTask.id)}/${event.id}?jobId=${job.id}`);expect(detail.statusCode,detail.body).toBe(200);
      const resultText=detail.json<TaskInformationDetail>().resultText;
      expect(resultText).toContain('完整分析正文');expect(resultText).toContain('## 处理过程中的说明');expect(resultText).toContain('## 最终答复');
      expect(resultText).toContain('分析结果');expect(detail.body).not.toContain('PRIVATE_SERVICE_CONFIG');
      expect(await f.lab.taskInformation!.read('b',publicTask.id,{eventId:event.id,jobId:job.id,section:'analysis'})).toMatchObject({text:resultText});
      const options=await f.b.call(`${listUrl(publicTask.id)}/${event.id}/analysis-options`,{jobId:job.id});expect(options.statusCode,options.body).toBe(200);expect(options.json().skills).toHaveLength(2);
    }
    expect((await f.a.call(listUrl(east.id))).json().total).toBe(0);
    expect((await f.c.call(listUrl(west.id))).json().total).toBe(0);
    expect((await f.c.call(linksUrl(event.id,job.id))).statusCode).toBe(404);
    expect(f.lab.workspaces.listAll()).toEqual([]);expect(f.store.listJobs()).toHaveLength(1);
    const box=(await f.b.call('/api/inbox')).json<BackgroundPage<InboxItem>>().items[0];
    const detail=(await f.b.call(`/api/inbox/${box.delivery.id}`)).json<InboxDetail>();expect(detail.taskLinks?.links).toHaveLength(2);expect(detail.resultText).toContain('完整分析正文');
  });
  it('keeps a new-task suggestion advisory until an authorized human creates and links, with replay and changed-input checks',async()=>{
    const f=await fixture('suggestion'),{event,job}=await receive(f);
    const view=(await f.b.call(linksUrl(event.id,job.id))).json<TaskLinksView>();expect(view.assessment?.newTaskSuggestion?.title).toBe('新资料编制');expect(view.canCreateTask).toBe(false);
    expect(f.lab.access!.list('a')).toEqual([]);expect(f.lab.workspaces.listAll()).toEqual([]);
    const body={jobId:job.id,clientActionId:randomUUID(),title:'人工确认的任务',goal:'核对并编制说明',reason:'采纳独立办理建议'};
    const url=`/api/information/events/${event.id}/tasks`;
    expect((await f.b.call(url,body)).statusCode).toBe(403);
    const created=await f.a.call(url,body);expect(created.statusCode,created.body).toBe(200);const result=created.json<TaskSuggestionCreateResult>();
    expect((await f.a.call(url,body)).json<TaskSuggestionCreateResult>().task.id).toBe(result.task.id);
    expect((await f.a.call(url,{...body,title:'误改名称'})).statusCode).toBe(409);
    const another=await f.a.call(url,{...body,clientActionId:randomUUID()});expect(another.statusCode,another.body).toBe(200);expect(another.json<TaskSuggestionCreateResult>().task.id).toBe(result.task.id);
    expect(f.lab.access!.list('a')).toHaveLength(1);expect(f.lab.workspaces.listAll()).toEqual([]);expect(f.store.listJobs()).toHaveLength(1);
    expect((await f.b.call(listUrl(result.task.id))).json().items[0]).toMatchObject({eventId:event.id,jobId:job.id,mode:'include'});
    expect((await f.c.call(listUrl(result.task.id))).json().total).toBe(0);
    const removed=await f.a.call(`/api/information/events/${event.id}/task-links/${result.task.id}`,{revision:result.link.revision,mode:'exclude',jobId:job.id},'PUT');expect(removed.statusCode,removed.body).toBe(200);
    expect((await f.a.call(url,body)).json<TaskSuggestionCreateResult>().task.id).toBe(result.task.id);expect((await f.a.call(listUrl(result.task.id))).json().total).toBe(0);
  });
  it('continues from a task with exact files, durable origin, idempotency and separate task/seat workspaces',async()=>{
    const f=await fixture(),west=await task(f,'西区补给'),other=await task(f,'西区转移'),{event,job}=await receive(f,true);
    const input={jobId:job.id,clientActionId:randomUUID(),goal:'请依据附件继续分析',mode:'conversation',includeResult:true,fileIds:event.files.map(file=>file.id)};
    const endpoint=`${listUrl(west.id)}/${event.id}/analyses`;
    const response=await f.b.call(endpoint,input);expect(response.statusCode,response.body).toBe(200);const action=response.json<BackgroundAction>();
    expect(action.origin).toEqual({kind:'task_information',taskSpaceId:west.id,eventId:event.id,jobId:job.id});expect(action.deliveryId).toBeUndefined();
    expect(action.draft).toContain('完整分析正文');
    expect(f.lab.get(action.sessionId!,'b').messages).toHaveLength(0);
    expect(await readFile(join(f.lab.files.filesDirectory(action.workspaceId!,'b'),action.imports![0].path),'utf8')).toBe('独立输入附件');
    expect((await f.b.call(endpoint,input)).json<BackgroundAction>().id).toBe(action.id);
    expect((await f.b.call(`${endpoint}?jobId=${job.id}&clientActionId=${input.clientActionId}`)).json<BackgroundAction>().id).toBe(action.id);
    const second=await f.a.call(`${listUrl(other.id)}/${event.id}/analyses`,{...input,clientActionId:randomUUID()});expect(second.statusCode,second.body).toBe(200);expect(second.json<BackgroundAction>().workspaceId).not.toBe(action.workspaceId);
    const background=await f.b.call(endpoint,{...input,clientActionId:randomUUID(),mode:'background'});expect(background.statusCode,background.body).toBe(200);
    const backgroundId=background.json<BackgroundAction>().jobId!;
    await vi.waitFor(()=>expect(['queued','running']).not.toContain(f.store.getJob(backgroundId).status),{timeout:10000});expect(f.store.getJob(backgroundId).status).toBe('succeeded');
    const history=(await f.b.call(`${listUrl(west.id)}/${event.id}?jobId=${job.id}`)).json<TaskInformationDetail>().analyses!;
    expect(history.map(item=>item.sessionId)).toEqual(expect.arrayContaining([action.sessionId,background.json<BackgroundAction>().sessionId]));
    expect(history).toHaveLength(2);expect(history.find(item=>item.jobId===backgroundId)?.status).toBe('succeeded');
    expect((await f.a.call(`${listUrl(west.id)}/${event.id}?jobId=${job.id}`)).json<TaskInformationDetail>().analyses).toEqual([]);
    expect(f.store.listDeliveries()).toHaveLength(2);
    expect((await f.c.call(`${listUrl(west.id)}/${event.id}/files/${event.files[0].id}?jobId=${job.id}`)).statusCode).toBe(404);
    const preview=await f.b.call(`${listUrl(west.id)}/${event.id}/files/${event.files[0].id}?jobId=${job.id}&preview=true`);expect(preview.statusCode,preview.body).toBe(200);expect(preview.body).toBe('独立输入附件');
    const removed=await f.a.call(`/api/information/events/${event.id}/task-links/${west.id}`,{revision:0,mode:'exclude',jobId:job.id},'PUT');expect(removed.statusCode,removed.body).toBe(200);
    expect((await f.b.call(endpoint,{...input,clientActionId:randomUUID()})).statusCode).toBe(409);
    expect(f.lab.get(action.sessionId!,'b').id).toBe(action.sessionId);
  });
  it('supports manual collection and seat read tools for old jobs without external-context configuration',async()=>{
    const f=await fixture('legacy'),existing=await task(f,'普通任务'),{event,job}=await receive(f);
    expect(job.taskAssessment).toBeUndefined();
    const attached=await f.a.call(`/api/information/events/${event.id}/task-links/${existing.id}`,{revision:0,mode:'include',jobId:job.id,reason:'人工收录资料'},'PUT');expect(attached.statusCode,attached.body).toBe(200);
    expect((await f.b.call(listUrl(existing.id))).json().total).toBe(1);
    expect(await f.lab.taskInformation!.read('b',existing.id,{eventId:event.id,jobId:job.id,section:'analysis'})).toMatchObject({text:'分析结果：根据实际资料核对任务影响。'});
    await expect(f.lab.taskInformation!.read('c',existing.id,{eventId:event.id,jobId:job.id,section:'original'})).rejects.toMatchObject({statusCode:404});
    f.lab.access!.disable('b');expect(()=>f.lab.taskInformation!.list('b',existing.id,{})).toThrow();
    expect(f.lab.workspaces.listAll()).toEqual([]);
  });
});
