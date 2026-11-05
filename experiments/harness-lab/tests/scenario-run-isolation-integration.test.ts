import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { BackgroundStore } from '../src/background/store.js';
import { parseBackgroundConfig } from '../src/background/config.js';
import type { BackgroundExecutor } from '../src/background/executor.js';
import type { BackgroundJob, BackgroundReceipt, InformationRule } from '../src/contracts/background.js';
import type { AuthSession, TaskSpace } from '../src/contracts/access.js';
import type { SessionSnapshot } from '../src/contracts/index.js';
import type { ScenarioAction, ScenarioDefinitions, ScenarioInstances, ScenarioMutationResult, ScenarioTaskInitialization } from '../src/contracts/scenarios.js';
import type { ContextConfig } from '../src/context/config.js';
import type { SituationCurrent } from '../src/contracts/context.js';
import type { SimulationNotification } from '../src/contracts/simulation.js';
import { TaskQueryService } from '../src/context/task-query.js';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { createMockContextServer } from '../scripts/mock-context/server.js';
import type { NotificationTarget } from '../scripts/mock-context/control-api.js';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';

const clean:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const close of clean.splice(0).reverse())await close();});
const directorSeat='seat-director',overallSeat='seat-overall',intelSeat='seat-intelligence';
const env={QUERY_TOKEN:'isolation-test-query',CONTROL_TOKEN:'isolation-test-control',INTEL_TOKEN:'isolation-test-intel-source-token',SITUATION_TOKEN:'isolation-test-situation-source-token',ORDINARY_TOKEN:'isolation-test-ordinary-source-token'};

async function login(app:FastifyInstance,seatId:string){
  const boot=await app.inject('/api/auth/session');
  const response=await app.inject({method:'POST',url:'/api/auth/login',headers:{cookie:boot.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':boot.json<AuthSession>().csrf!},payload:{seatId,password:'isolation-test-password'}});
  expect(response.statusCode,response.body).toBe(200);const auth=response.json<AuthSession>();
  const headers={cookie:response.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':auth.csrf!,'x-axon-view':auth.viewId!};
  return {auth,call:(url:string,payload?:object)=>app.inject({url,method:payload===undefined?'GET':'POST',headers,...(payload===undefined?{}:{payload})})};
}
type Client=Awaited<ReturnType<typeof login>>;
async function json<T>(call:ReturnType<Client['call']>,status=200){const response=await call;expect(response.statusCode,response.body).toBe(status);return response.json<T>();}

/** The queue executor can acknowledge cancellation before its actual terminal result. */
function controlledExecutor(){
  const started:BackgroundJob[]=[],cancelled:string[]=[],resolvers=new Map<string,(snapshot:SessionSnapshot)=>void>(),snapshots=new Map<string,SessionSnapshot>();let hold=true;
  function terminal(job:BackgroundJob,status:'cancelled'|'succeeded'):SessionSnapshot {const finalMessageId=randomUUID();return {id:job.sessionId!,workspaceId:job.workspaceId??randomUUID(),title:'确定性执行替身',updatedAt:new Date().toISOString(),messages:status==='succeeded'?[{id:finalMessageId,requestId:job.requestId,role:'assistant',text:'已核对来源'}]:[],turns:[{requestId:job.requestId,status,...(status==='succeeded'?{finalMessageId}:{})}],active:null,lastResult:{requestId:job.requestId,status}};}
  function finish(id:string,status:'cancelled'|'succeeded'='cancelled'){const job=started.find(job=>job.id===id);if(!job)return;const snapshot=terminal(job,status);snapshots.set(id,snapshot);resolvers.get(id)?.(snapshot);resolvers.delete(id);}
  const executor:BackgroundExecutor={
    async execute(job){started.push(job);if(!hold){const snapshot=terminal(job,'succeeded');snapshots.set(job.id,snapshot);return {snapshot};}return {snapshot:await new Promise<SessionSnapshot>(resolve=>resolvers.set(job.id,resolve))};},
    async cancel(job){cancelled.push(job.id);},
    async read(job){return snapshots.get(job.id)??null;},
  };
  return {executor,started,cancelled,finish,releaseAll(){hold=false;for(const job of started)finish(job.id);},immediate(){hold=false;}};
}

/** Real authenticated app, source HTTP, SQLite and Pi foreground history; no model network. */
async function setup(){
  const directory=await mkdtemp(join(tmpdir(),'axon-run-isolation-'));clean.push(()=>rm(directory,{recursive:true,force:true}));
  const targets:NotificationTarget[]=[],sourcePath=join(directory,'source.sqlite'),source=createMockContextServer({token:env.QUERY_TOKEN,controlToken:env.CONTROL_TOKEN,scenariosEnabled:true,databasePath:sourcePath,targets}),sourceUrl=await source.listen();clean.push(()=>source.close());
  const dataDir=join(directory,'axon'),db=await openDatabase(dataDir),access=new AccessStore(db);
  for(const seatId of [directorSeat,overallSeat,intelSeat])await access.saveAccount({username:seatId,displayName:seatId,seatId,seatName:seatId,password:'isolation-test-password',createPublicTask:seatId!==intelSeat,manageModelSettings:false,controlScenarios:seatId===directorSeat});
  db.close();
  const config=testConfig(dataDir,{seatId:overallSeat,auth:{secret:'scenario-isolation-signing-secret-at-least-32',sessionMs:28800000}});
  let foregroundTools=[{name:'situation_query',arguments:{systemId:'situation',mode:'current',limit:1}}] as Array<{name:string;arguments:Record<string,unknown>}>;
  const fake=await fakeRuntime(config,context=>context.messages.at(-1)?.role==='user'?{tools:foregroundTools}:{text:'按当前任务资料完成核对'});
  const lab=await PiLab.create(config,fake.runtime),controlled=controlledExecutor();
  const background=parseBackgroundConfig({enabled:true,concurrency:1,modelConcurrency:1,sources:[{sourceId:'scene-intel',systemId:'intel',name:'特情来源',credentialRef:'INTEL_TOKEN',allowedProfileIds:['analysis'],allowedRecipientSeatIds:[overallSeat,intelSeat]},{sourceId:'scene-situation',systemId:'situation',name:'态势来源',credentialRef:'SITUATION_TOKEN',allowedProfileIds:['analysis'],allowedRecipientSeatIds:[overallSeat,intelSeat]},{sourceId:'ordinary-source',name:'普通来源',credentialRef:'ORDINARY_TOKEN',allowedProfileIds:['analysis'],allowedRecipientSeatIds:[overallSeat,intelSeat]}],profiles:[{id:'analysis',name:'资料核对',goal:'核对来报',tools:['source_read']}]});
  const context:ContextConfig={systems:[{id:'intel',name:'特情',adapter:'mock-information-http',baseUrl:`${sourceUrl}/intel`,tokenEnv:'QUERY_TOKEN',scenarioClock:true},{id:'situation',name:'态势',adapter:'mock-situation-http',baseUrl:`${sourceUrl}/situation`,tokenEnv:'QUERY_TOKEN',scenarioClock:true}],scopes:[{id:'scene',name:'资料',systemIds:['intel','situation'],seatIds:[directorSeat,overallSeat,intelSeat]}],simulation:{enabled:true,baseUrl:sourceUrl,tokenEnv:'CONTROL_TOKEN',directorSeatId:directorSeat,sources:[{systemId:'intel',sourceId:'scene-intel'},{systemId:'situation',sourceId:'scene-situation'}]}};
  const app=await createApp(lab,false,{config:background,env,executor:controlled.executor},{config:context,env});clean.push(async()=>{controlled.releaseAll();await app.close();});const appUrl=await app.listen({host:'127.0.0.1',port:0});
  targets.push({systemId:'intel',sourceId:'scene-intel',url:appUrl,token:env.INTEL_TOKEN},{systemId:'situation',sourceId:'scene-situation',url:appUrl,token:env.SITUATION_TOKEN});
  const store=new BackgroundStore(lab.access!.db);for(const sourceId of ['scene-intel','scene-situation','ordinary-source']){store.grant('seat',overallSeat,sourceId,'manage');store.grant('seat',directorSeat,sourceId,'view');}
  const director=await login(app,directorSeat),overall=await login(app,overallSeat);
  async function create(){const definition=(await json<ScenarioDefinitions>(director.call('/api/simulation/scenarios'))).items[0];const result=await json<ScenarioMutationResult>(director.call('/api/simulation/instances',{definitionId:definition.id,version:definition.version,mode:'source_replay',clientActionId:randomUUID()}));const tasks=await json<ScenarioTaskInitialization>(director.call(`/api/simulation/instances/${result.instance.instanceId}/initialize`,{clientActionId:randomUUID()}));return {result,tasks};}
  async function activate(created:ScenarioMutationResult,terminateUnsent=false){const list=await json<ScenarioInstances>(director.call('/api/simulation/instances'));return director.call(`/api/simulation/instances/${created.instance.instanceId}/activate`,{clientActionId:randomUUID(),expectedRevision:created.instance.revision,expectedActiveRevision:list.activeRevision,terminateUnsent});}
  async function apply(instance:ScenarioMutationResult['instance'],step:string){return json<ScenarioMutationResult>(director.call(`/api/simulation/instances/${instance.instanceId}/steps/${step}`,{clientActionId:randomUUID(),expectedRevision:instance.revision}));}
  async function pause(instance:ScenarioMutationResult['instance']){return json<ScenarioMutationResult>(director.call(`/api/simulation/instances/${instance.instanceId}/control`,{clientActionId:randomUUID(),expectedRevision:instance.revision,action:'pause'}));}
  async function send(action:ScenarioAction){return json<ScenarioAction>(director.call(`/api/simulation/actions/${action.id}/send`,{}));}
  async function ingress(notification:SimulationNotification){return fetch(`${appUrl}/api/integrations/scene-intel/events`,{method:'POST',headers:{Authorization:`Bearer ${env.INTEL_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(notification)});}
  async function ordinary(){return fetch(`${appUrl}/api/integrations/ordinary-source/events`,{method:'POST',headers:{Authorization:`Bearer ${env.ORDINARY_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({sourceMessageId:randomUUID(),title:'普通业务来报',text:'独立于场景的业务资料'})});}
  return {directory,sourcePath,source,sourceUrl,app,lab,fake,controlled,store,director,overall,create,activate,apply,pause,send,ingress,ordinary,setForegroundTools:(tools:typeof foregroundTools)=>{foregroundTools=tools;}};
}

describe('scenario run isolation across real source and host boundaries',()=>{
  it('waits for a running A terminal result before enabling B and keeps duplicate or late A messages out of B',async()=>{
    const f=await setup();
    await json<InformationRule>(f.overall.call('/api/information/rules',{clientActionId:randomUUID(),sourceId:'scene-intel',profileId:'analysis',name:'已授权测试规则',recipientSeatIds:[overallSeat],enabled:true}));
    const a=await f.create(),activeA=await json<ScenarioMutationResult>(f.activate(a.result));
    const first=await f.apply(activeA.instance,'E01'),sent=await f.send(first.actions[0]);expect(sent.receipt).toBeDefined();
    await vi.waitFor(()=>expect(f.controlled.started).toHaveLength(1));const running=f.store.getJob(f.controlled.started[0].id);expect(running).toMatchObject({status:'running',scenarioInstanceId:a.result.instance.instanceId});
    const late=await f.apply(first.instance,'E02');await f.pause(late.instance);const b=await f.create();
    const activation=f.activate(b.result,true).then(response=>response);
    await vi.waitFor(()=>expect(f.controlled.cancelled).toContain(running.id));
    expect(f.lab.scenario!.activeId()).toBe(a.result.instance.instanceId);expect(f.lab.scenario!.isWritable(a.result.instance.instanceId)).toBe(false);expect(f.store.getJob(running.id).status).toBe('running');
    f.controlled.finish(running.id);const enabled=await activation;expect(enabled.statusCode,enabled.body).toBe(200);expect(enabled.json<ScenarioMutationResult>().instance.instanceId).toBe(b.result.instance.instanceId);expect(f.store.getJob(running.id).status).toBe('cancelled');
    const repeated=await f.ingress(first.actions[0].notification);expect(repeated.status).toBe(202);expect((await repeated.json() as BackgroundReceipt).eventId).toBe(sent.receipt!.eventId);
    const delayed=await f.ingress(late.actions[0].notification);expect(delayed.status).toBe(202);const receipt=await delayed.json() as BackgroundReceipt,event=f.store.getEvent(receipt.eventId);expect(event.scenarioInstanceId).toBe(a.result.instance.instanceId);expect(event.initialJobId).toBeUndefined();expect(f.store.listJobs()).toHaveLength(1);
    const listed=await f.overall.call('/api/information/events');expect(listed.statusCode).toBe(200);expect(listed.body).not.toContain(event.id);expect(listed.body).not.toContain(sent.receipt!.eventId);
    const changed=await f.ingress({...first.actions[0].notification,text:'正文被修改'});expect(changed.status).not.toBe(202);
    const wrong=await f.ingress({...first.actions[0].notification,scenarioInstanceId:b.result.instance.instanceId});expect(wrong.status).not.toBe(202);
    f.controlled.immediate();const bStep=await f.apply(enabled.json<ScenarioMutationResult>().instance,'E01');await f.send(bStep.actions[0]);await vi.waitFor(()=>expect(f.controlled.started).toHaveLength(2));
    const bJob=f.controlled.started[1];expect(bJob.scenarioInstanceId).toBe(b.result.instance.instanceId);expect(bJob.sessionId).not.toBe(running.sessionId);await vi.waitFor(()=>expect(f.store.getJob(bJob.id).status).toBe('succeeded'));expect(f.fake.calls).toHaveLength(0);
  },30000);

  it('pins task conversations and tool results to their own run without carrying A native history into B',async()=>{
    const f=await setup(),a=await f.create(),activeA=await json<ScenarioMutationResult>(f.activate(a.result)),taskA=a.tasks.tasks[0],workspaceA=await f.lab.workspaces.ensureWorkspace(taskA.taskId,overallSeat,taskA.title),sessionA=await f.lab.createSession(workspaceA.id,overallSeat);
    await f.lab.start(sessionA.id,'查询当前态势。',{},overallSeat).run(()=>{});
    const original=f.lab.get(sessionA.id,overallSeat),toolA=original.messages.find(message=>message.toolName==='situation_query')!;expect(toolA.isError).toBe(false);expect((JSON.parse(toolA.text) as {data:SituationCurrent}).data.snapshotClock?.instanceId).toBe(a.result.instance.instanceId);
    const aCalls=f.fake.calls.length;await f.pause(activeA.instance);const b=await f.create();await json<ScenarioMutationResult>(f.activate(b.result));
    expect(f.lab.get(sessionA.id,overallSeat).messages).toEqual(original.messages);expect(()=>f.lab.start(sessionA.id,'继续旧任务。',{},overallSeat)).toThrow();expect(f.fake.calls).toHaveLength(aCalls);
    const taskB=b.tasks.tasks[0],workspaceB=await f.lab.workspaces.ensureWorkspace(taskB.taskId,overallSeat,taskB.title),sessionB=await f.lab.createSession(workspaceB.id,overallSeat);await f.lab.start(sessionB.id,'查询当前态势。',{},overallSeat).run(()=>{});
    const current=f.lab.get(sessionB.id,overallSeat),toolB=current.messages.find(message=>message.toolName==='situation_query')!;expect(toolB.isError).toBe(false);expect((JSON.parse(toolB.text) as {data:SituationCurrent}).data.snapshotClock?.instanceId).toBe(b.result.instance.instanceId);expect(JSON.stringify(f.fake.calls.slice(aCalls).map(call=>call.context.messages))).not.toContain(a.result.instance.instanceId);
    const query=new TaskQueryService(f.lab.access!),tasks=query.search({}, {kind:'seat',seatId:overallSeat,scenarioInstanceId:b.result.instance.instanceId});expect(tasks.data.items.map(task=>task.id).sort()).toEqual(b.tasks.tasks.map(task=>task.taskId).sort());expect(JSON.stringify(tasks)).not.toContain('scenarioInstanceId');
    const oldMap=await json<{data:SituationCurrent}>(f.overall.call(`/api/context/situation?taskId=${taskA.taskId}`,{systemId:'situation',mode:'current',limit:1})),newMap=await json<{data:SituationCurrent}>(f.overall.call(`/api/context/situation?taskId=${taskB.taskId}`,{systemId:'situation',mode:'current',limit:1}));expect(oldMap.data.snapshotClock?.instanceId).toBe(a.result.instance.instanceId);expect(newMap.data.snapshotClock?.instanceId).toBe(b.result.instance.instanceId);
    expect((await f.overall.call(`/api/context/situation?taskId=${taskA.taskId}`,{systemId:'situation',mode:'current',objectRefs:[{systemId:'situation',objectType:'resource',objectId:`${b.result.instance.instanceId}-V01`}]})).statusCode).toBe(409);
    const intel=await login(f.app,intelSeat),privateTask=await json<TaskSpace>(intel.call('/api/tasks',{clientActionId:randomUUID(),title:'个人资料',goal:'不能跨席读取',visibility:'private'}));
    for(const taskId of [privateTask.id,randomUUID()])expect((await f.overall.call(`/api/context/situation?taskId=${taskId}`,{systemId:'situation',mode:'current'})).statusCode).toBe(404);
    expect((await f.overall.call(`/api/context/situation?scenarioInstanceId=${a.result.instance.instanceId}`,{systemId:'situation',mode:'current'})).statusCode).toBe(400);
    const oldTask=await json<TaskSpace>(f.overall.call(`/api/tasks/${taskA.taskId}`));expect(oldTask.readOnly).toBe(true);expect(oldTask).not.toHaveProperty('scenarioInstanceId');
    const unbound=await json<TaskSpace>(f.overall.call('/api/tasks',{clientActionId:randomUUID(),title:'普通任务',goal:'保留既有手动创建方式',visibility:'public'}));
    expect(f.lab.access!.get(unbound.id,overallSeat).scenarioInstanceId).toBeUndefined();
    const unknownScope=await f.overall.call(`/api/context/situation?taskId=${unbound.id}`,{systemId:'situation',mode:'current'});
    expect(unknownScope.statusCode).toBe(403);expect(unknownScope.json()).toMatchObject({error:{code:'CONTEXT_FORBIDDEN'}});
    const globalMap=await json<{data:SituationCurrent}>(f.overall.call('/api/context/situation',{systemId:'situation',mode:'current',limit:1}));
    expect(globalMap.data.snapshotClock?.instanceId).toBe(b.result.instance.instanceId);
    const informationRead=vi.spyOn(f.lab.taskInformation!,'list');
    f.setForegroundTools([{name:'task_information_list',arguments:{taskId:taskA.taskId}}]);
    await f.lab.start(sessionB.id,'查询这项任务的关联信息。',{},overallSeat).run(()=>{});
    const denied=f.lab.get(sessionB.id,overallSeat).messages.findLast(message=>message.toolName==='task_information_list');
    expect(denied?.isError).toBe(true);expect(denied?.text).toContain('TASK_NOT_FOUND');expect(informationRead).not.toHaveBeenCalled();
  },30000);

  it('retains A success that completed at cancellation without publishing it into B',async()=>{
    const f=await setup();await json<InformationRule>(f.overall.call('/api/information/rules',{clientActionId:randomUUID(),sourceId:'scene-intel',profileId:'analysis',name:'测试规则',recipientSeatIds:[overallSeat],enabled:true}));
    const a=await f.create(),active=await json<ScenarioMutationResult>(f.activate(a.result)),step=await f.apply(active.instance,'E01');await f.send(step.actions[0]);await vi.waitFor(()=>expect(f.controlled.started).toHaveLength(1));const running=f.controlled.started[0];
    await f.pause(step.instance);const b=await f.create(),activation=f.activate(b.result).then(response=>response);await vi.waitFor(()=>expect(f.controlled.cancelled).toContain(running.id));
    f.controlled.finish(running.id,'succeeded');const enabled=await activation;expect(enabled.statusCode,enabled.body).toBe(200);const finished=f.store.getJob(running.id);expect(finished).toMatchObject({status:'succeeded',scenarioInstanceId:a.result.instance.instanceId,result:{sessionId:running.sessionId,requestId:running.requestId}});expect(f.store.listDeliveries(running.id).every(delivery=>delivery.status!=='delivered')).toBe(true);
    const inbox=await f.overall.call('/api/inbox');expect(inbox.statusCode).toBe(200);expect(inbox.body).not.toContain(running.id);expect(f.lab.scenario!.activeId()).toBe(b.result.instance.instanceId);expect(f.fake.calls).toEqual([]);
  },30000);

  it('cancels queued A work while preserving the unrelated ordinary queue and its original protocol',async()=>{
    const f=await setup();
    for(const sourceId of ['scene-intel','ordinary-source'])await json<InformationRule>(f.overall.call('/api/information/rules',{clientActionId:randomUUID(),sourceId,profileId:'analysis',name:'测试规则',recipientSeatIds:[overallSeat],enabled:true}));
    const control=f.store.getControl('queue');f.store.setControl('queue',control.revision,false,f.overall.auth.identity!.userId);
    const ordinary=await f.ordinary();expect(ordinary.status).toBe(202);const ordinaryReceipt=await ordinary.json() as BackgroundReceipt,ordinaryEvent=f.store.getEvent(ordinaryReceipt.eventId),ordinaryJob=f.store.getJob(ordinaryEvent.initialJobId!);expect(ordinaryJob.scenarioInstanceId).toBeUndefined();expect(ordinaryJob.status).toBe('queued');
    const a=await f.create(),active=await json<ScenarioMutationResult>(f.activate(a.result)),step=await f.apply(active.instance,'E01'),sent=await f.send(step.actions[0]),aEvent=f.store.getEvent(sent.receipt!.eventId),aJob=f.store.getJob(aEvent.initialJobId!);expect(aJob).toMatchObject({status:'queued',scenarioInstanceId:a.result.instance.instanceId});
    await f.pause(step.instance);const b=await f.create();await json<ScenarioMutationResult>(f.activate(b.result));
    expect(f.store.getJob(aJob.id).status).toBe('cancelled');expect(f.store.getJob(ordinaryJob.id).status).toBe('queued');expect(f.controlled.cancelled).toContain(aJob.id);expect(f.controlled.cancelled).not.toContain(ordinaryJob.id);expect(f.controlled.started).toEqual([]);expect(f.fake.calls).toEqual([]);
    const listed=await f.overall.call('/api/information/events');expect(listed.statusCode).toBe(200);expect(listed.body).toContain(ordinaryEvent.id);expect(listed.body).not.toContain(aEvent.id);
  },30000);

  it('rejects restart when an uncertain notice is outside the latest twenty action projection',async()=>{
    const f=await setup(),a=await f.create(),active=await json<ScenarioMutationResult>(f.activate(a.result)),step=await f.apply(active.instance,'E01');await f.pause(step.instance);const b=await f.create();
    const db=new DatabaseSync(f.sourcePath);
    try {const row=db.prepare('SELECT body FROM scenario_instances WHERE instance_id=?').get(a.result.instance.instanceId)!,record=JSON.parse(String(row.body)) as {actions:ScenarioAction[]};record.actions[0].sendState='unconfirmed';for(let i=0;i<25;i++)record.actions.push({...structuredClone(record.actions[0]),id:randomUUID(),sendState:'accepted',notification:{...record.actions[0].notification,sourceMessageId:`stored-other-${i}`}});db.prepare('UPDATE scenario_instances SET body=? WHERE instance_id=?').run(JSON.stringify(record),a.result.instance.instanceId);} finally {db.close();}
    const response=await f.activate(b.result,true);expect(response.statusCode).toBe(409);expect(f.lab.scenario!.activeId()).toBe(a.result.instance.instanceId);expect(f.lab.scenario!.isWritable(a.result.instance.instanceId)).toBe(true);expect(f.controlled.started).toEqual([]);expect(f.fake.calls).toEqual([]);
  },30000);
});
