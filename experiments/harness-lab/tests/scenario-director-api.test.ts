import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { BackgroundStore } from '../src/background/store.js';
import { parseBackgroundConfig } from '../src/background/config.js';
import type { AuthSession, TaskSpace } from '../src/contracts/access.js';
import type { ScenarioAction, ScenarioDefinitions, ScenarioInstanceDetail, ScenarioInstances, ScenarioMutationResult, ScenarioPreview, ScenarioTaskInitialization } from '../src/contracts/scenarios.js';
import type { ContextConfig } from '../src/context/config.js';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { ScenarioTasks } from '../src/server/scenario-tasks.js';
import { scenarioTaskBootstrap } from '../src/scenario/task-definitions.js';
import { createMockContextServer } from '../scripts/mock-context/server.js';
import { scenarioDefinition } from '../scripts/mock-context/scenarios/data.js';
import type { NotificationTarget } from '../scripts/mock-context/control-api.js';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';

const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const dispose of cleanup.splice(0).reverse())await dispose();});
const directorSeat='seat-director';
const businessSeats=['seat-overall','seat-intelligence','seat-planning','seat-situation'];
const env={CONTEXT_TOKEN:'scenario-api-query-only-token',CONTROL_TOKEN:'scenario-api-control-only-token',INTEL_TOKEN:'scenario-api-intel-ingress-token-123',SITUATION_TOKEN:'scenario-api-situation-ingress-token-123'};

async function login(app:FastifyInstance,seatId:string){
  const boot=await app.inject('/api/auth/session');
  const logged=await app.inject({method:'POST',url:'/api/auth/login',headers:{cookie:boot.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':boot.json<AuthSession>().csrf!},payload:{seatId,password:'scenario-api-test-password'}});
  expect(logged.statusCode,logged.body).toBe(200);
  const auth=logged.json<AuthSession>();
  const headers={cookie:logged.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':auth.csrf!,'x-axon-view':auth.viewId!};
  return {auth,call:(url:string,payload?:object)=>app.inject({url,method:payload===undefined?'GET':'POST',headers,...(payload===undefined?{}:{payload})})};
}
type Client=Awaited<ReturnType<typeof login>>;
async function json<T>(request:ReturnType<Client['call']>,status=200):Promise<T>{const response=await request;expect(response.statusCode,response.body).toBe(status);return response.json<T>();}

/** Real source HTTP, application HTTP, authentication, SQLite and task files; no provider requests. */
async function setup(directorConfigured=true){
  const dir=await mkdtemp(join(tmpdir(),'axon-director-api-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));
  const targets:NotificationTarget[]=[];
  const mock=createMockContextServer({token:env.CONTEXT_TOKEN,controlToken:env.CONTROL_TOKEN,scenariosEnabled:true,databasePath:join(dir,'source.sqlite'),targets});
  const sourceUrl=await mock.listen();cleanup.push(()=>mock.close());
  const db=await openDatabase(join(dir,'axon')),access=new AccessStore(db);
  for(const seat of [directorSeat,...businessSeats])await access.saveAccount({username:seat,displayName:seat,seatId:seat,seatName:seat===directorSeat?'导演席':seat,password:'scenario-api-test-password',createPublicTask:seat===directorSeat||seat==='seat-overall',manageModelSettings:false,controlScenarios:seat===directorSeat});
  db.close();
  const config=testConfig(join(dir,'axon'),{seatId:directorSeat,auth:{secret:'isolated-director-api-signing-key-more-than-32',sessionMs:28800000}});
  const fake=await fakeRuntime(config,()=>({text:'本测试不应调用模型'})),lab=await PiLab.create(config,fake.runtime);
  const background=parseBackgroundConfig({enabled:true,concurrency:1,modelConcurrency:1,sources:[
    {sourceId:'intel-source',systemId:'intel',name:'特情来源',credentialRef:'INTEL_TOKEN',allowedProfileIds:['analysis'],allowedRecipientSeatIds:businessSeats},
    {sourceId:'situation-source',systemId:'situation',name:'态势来源',credentialRef:'SITUATION_TOKEN',allowedProfileIds:['analysis'],allowedRecipientSeatIds:businessSeats},
  ],profiles:[{id:'analysis',name:'未启用规则的演示配置',goal:'保留接收资料',tools:['source_read']}]});
  const context:ContextConfig={systems:[
    {id:'intel',name:'特情系统',adapter:'mock-information-http',baseUrl:`${sourceUrl}/intel`,tokenEnv:'CONTEXT_TOKEN',scenarioClock:true},
    {id:'situation',name:'态势系统',adapter:'mock-situation-http',baseUrl:`${sourceUrl}/situation`,tokenEnv:'CONTEXT_TOKEN',scenarioClock:true},
  ],scopes:[{id:'scenario-context',name:'演示资料',systemIds:['intel','situation'],seatIds:[directorSeat,...businessSeats]}],simulation:{enabled:true,baseUrl:sourceUrl,tokenEnv:'CONTROL_TOKEN',...(directorConfigured?{directorSeatId:directorSeat}:{}),sources:[{systemId:'intel',sourceId:'intel-source'},{systemId:'situation',sourceId:'situation-source'}]}};
  const app=await createApp(lab,false,{config:background,env},{config:context,env});cleanup.push(()=>app.close());
  const appUrl=await app.listen({host:'127.0.0.1',port:0});
  targets.push({systemId:'intel',sourceId:'intel-source',url:appUrl,token:env.INTEL_TOKEN},{systemId:'situation',sourceId:'situation-source',url:appUrl,token:env.SITUATION_TOKEN});
  const store=new BackgroundStore(lab.access!.db);
  for(const source of background.sources)for(const seat of [directorSeat,...businessSeats])store.grant('seat',seat,source.sourceId,seat==='seat-overall'?'manage':'view');
  const director=await login(app,directorSeat);
  return {dir,app,lab,store,director,fake,config,background,context};
}
type Fixture=Awaited<ReturnType<typeof setup>>;
async function create(f:Fixture,operationId=randomUUID()){
  const definitions=await json<ScenarioDefinitions>(f.director.call('/api/simulation/scenarios'));
  expect(definitions.items.map(item=>item.version)).toEqual(['5','4']);
  const definition=definitions.items.find(item=>item.version==='4')!,input={definitionId:definition.id,version:definition.version,mode:'source_replay',clientActionId:operationId};
  const result=await json<ScenarioMutationResult>(f.director.call('/api/simulation/instances',input));
  return {result,input};
}
async function initialize(f:Fixture,id:string){return json<ScenarioTaskInitialization>(f.director.call(`/api/simulation/instances/${id}/initialize`,{clientActionId:randomUUID()}));}
async function activate(f:Fixture,created:ScenarioMutationResult,terminateUnsent=false){
  const list=await json<ScenarioInstances>(f.director.call('/api/simulation/instances'));
  return json<ScenarioMutationResult>(f.director.call(`/api/simulation/instances/${created.instance.instanceId}/activate`,{clientActionId:randomUUID(),expectedRevision:created.instance.revision,expectedActiveRevision:list.activeRevision,terminateUnsent}));
}

describe('scenario director authorization and host/source integration',()=>{

  it('initializes and reopens v5 task mappings without reinterpreting the saved bootstrap as v4', async () => {
    const f = await setup();
    const definitions = await json<ScenarioDefinitions>(f.director.call('/api/simulation/scenarios'));
    const current = definitions.items.find(item => item.version === '5')!;
    const legacy = definitions.items.find(item => item.version === '4')!;
    expect(current.definitionHash).not.toBe(legacy.definitionHash);
    const created = await json<ScenarioMutationResult>(f.director.call('/api/simulation/instances', {
      definitionId: current.id, version: current.version, mode: 'source_replay', clientActionId: randomUUID(),
    }));
    const id = created.instance.instanceId;
    const prepared = await initialize(f, id);
    expect(prepared.taskBootstrap).toMatchObject({ definitionVersion: '5', definitionHash: current.definitionHash });
    expect(prepared.tasks.map(task => task.code)).toEqual(['T02', 'T03']);
    const detail = await json<ScenarioInstanceDetail>(f.director.call(`/api/simulation/instances/${id}`));
    const savedPath = join(f.config.dataDir, 'scenario-runs', `${id}.json`);
    const bytes = await readFile(savedPath, 'utf8');
    const reopened = new ScenarioTasks(f.config.dataDir, f.lab.access!);
    await reopened.prepare();
    const actor = f.director.auth.identity!;
    expect(await reopened.read(actor, id, prepared.taskBootstrap, detail.taskDefinitions)).toEqual(prepared);
    await expect(reopened.read(actor, id, { ...prepared.taskBootstrap!, definitionVersion: '4' }, detail.taskDefinitions)).rejects.toMatchObject({ code: 'SCENARIO_HOST_CONFLICT' });
    expect(await readFile(savedPath, 'utf8')).toBe(bytes);
    for (const version of [4, 5, '6']) {
      expect(() => scenarioTaskBootstrap({ ...prepared.taskBootstrap, definitionVersion: version })).toThrow();
    }
    await activate(f, created);
  });
  it('leaves an existing deployment without a configured director free of new routes and run state',async()=>{
    const f=await setup(false),overall=await login(f.app,'seat-overall');
    expect(await json(f.director.call('/api/context/map-config'))).toMatchObject({scenarioControlEnabled:false});
    expect((await f.director.call('/api/simulation/scenarios')).statusCode).toBe(404);
    expect((await overall.call('/api/simulation')).statusCode).toBe(200);
    expect(await readdir(join(f.dir,'axon'))).not.toContain('scenario-runs');
    expect(f.fake.calls).toHaveLength(0);
  },30000);

  it('requires both the independent capability and configured director seat even when overall owns all old source management grants',async()=>{
    const f=await setup();
    expect((await f.app.inject('/api/simulation/scenarios')).statusCode).toBe(401);
    expect(await json(f.director.call('/api/context/map-config'))).toMatchObject({scenarioControlEnabled:true,simulationEnabled:false});
    const definitions=await json<ScenarioDefinitions>(f.director.call('/api/simulation/scenarios'));
    expect(definitions.items[0].counts).toMatchObject({vehicles:24,objects:53,resources:41,steps:12,messages:13});
    const {result}=await create(f),id=result.instance.instanceId;
    for(const seat of businessSeats){
      const actor=await login(f.app,seat);
      expect(await json(actor.call('/api/context/map-config'))).toMatchObject({scenarioControlEnabled:false,simulationEnabled:seat==='seat-overall'});
      const denied=[await actor.call('/api/simulation/scenarios'),await actor.call('/api/simulation/instances'),await actor.call(`/api/simulation/instances/${id}`),await actor.call(`/api/simulation/instances/${id}/initialize`),await actor.call(`/api/simulation/instances/${id}/preview`,{}),await actor.call(`/api/simulation/instances/${id}/control`,{clientActionId:randomUUID(),expectedRevision:1,action:'pause'})];
      for(const response of denied){expect(response.statusCode,response.body).toBe(403);expect(response.body).not.toContain('definitionHash');expect(response.body).not.toContain('steps');}
    }
    f.lab.access!.db.prepare('UPDATE seats SET control_scenarios=1 WHERE id=?').run('seat-planning');
    const wrongSeat=await login(f.app,'seat-planning');expect((await wrongSeat.call('/api/simulation/scenarios')).statusCode).toBe(403);
    f.lab.access!.db.prepare('UPDATE seats SET control_scenarios=0 WHERE id=?').run(directorSeat);
    expect((await f.director.call('/api/simulation/scenarios')).statusCode).toBe(403);
    expect(f.fake.calls).toHaveLength(0);
  },30000);

  it('recovers a committed creation with a missing file acknowledgment after restart without duplicating opening tasks',async()=>{
    const f=await setup(),{result:created}=await create(f),id=created.instance.instanceId,clientActionId=randomUUID();
    const createTask=f.lab.access!.create.bind(f.lab.access!);
    const crash=vi.spyOn(f.lab.access!,'create').mockImplementationOnce((...args)=>{createTask(...args);throw new Error('Injected stop after task commit, before mapping acknowledgment');});
    try {expect((await f.director.call(`/api/simulation/instances/${id}/initialize`,{clientActionId})).statusCode).toBe(500);} finally {crash.mockRestore();}
    const partial=await json<ScenarioTaskInitialization>(f.director.call(`/api/simulation/instances/${id}/initialize`));
    expect(partial.initialized).toBe(false);expect(partial.tasks.map(task=>task.code)).toEqual(['T02']);
    const path=join(f.dir,'axon','scenario-runs',`${id}.json`),pending=JSON.parse(await readFile(path,'utf8'));
    expect(pending).toMatchObject({schemaVersion:2,operationId:clientActionId,taskBootstrap:{expectedTaskCodes:['T02','T03']}});
    expect(pending.tasks.every((task:{taskId?:string})=>task.taskId===undefined)).toBe(true);
    await f.app.close();
    const fake=await fakeRuntime(f.config,()=>({text:'不得自动运行'})),lab=await PiLab.create(f.config,fake.runtime);
    const app=await createApp(lab,false,{config:f.background,env},{config:f.context,env});cleanup.push(()=>app.close());
    const director=await login(app,directorSeat),recovered=JSON.parse(await readFile(path,'utf8'));
    expect(recovered.tasks[0].taskId).toBe(partial.tasks[0].taskId);expect(recovered.tasks[1].taskId).toBeUndefined();
    const completed=await json<ScenarioTaskInitialization>(director.call(`/api/simulation/instances/${id}/initialize`,{clientActionId}));
    expect(completed.initialized).toBe(true);expect(completed.tasks.map(task=>task.code)).toEqual(['T02','T03']);expect(completed.tasks[0]).toEqual(partial.tasks[0]);
    expect(await json(director.call(`/api/simulation/instances/${id}/initialize`,{clientActionId}))).toEqual(completed);
    expect(lab.access!.list(directorSeat)).toHaveLength(2);expect(fake.calls).toEqual([]);
    expect(JSON.parse(await readFile(path,'utf8')).tasks.map((task:{clientActionId:string})=>task.clientActionId)).toEqual(pending.tasks.map((task:{clientActionId:string})=>task.clientActionId));
  },30000);

  it('rejects unknown, incomplete or changed host bootstrap mappings before activation without rewriting them',async()=>{
    const f=await setup(),{result:created}=await create(f),id=created.instance.instanceId;await initialize(f,id);
    const path=join(f.dir,'axon','scenario-runs',`${id}.json`),original=JSON.parse(await readFile(path,'utf8'));
    const invalid=[
      {...original,schemaVersion:99}, {...original,schemaVersion:'2'},
      {...original,taskBootstrap:undefined}, {...original,taskBootstrap:{...original.taskBootstrap,schemaVersion:3}},
      {...original,taskBootstrap:{...original.taskBootstrap,expectedTaskCodes:['T02']}},
      {...original,taskBootstrap:{...original.taskBootstrap,definitionHash:'a'.repeat(64)}},
      {...original,tasks:[]}, {...original,tasks:original.tasks.slice(0,1)}, {...original,tasks:[original.tasks[0],original.tasks[0]]},
      {...original,tasks:original.tasks.map((task:object,index:number)=>index?task:{...task,goal:'Changed saved definition'})},
    ];
    for(const value of invalid){
      const bytes=JSON.stringify(value);await writeFile(path,bytes);
      expect((await f.director.call(`/api/simulation/instances/${id}/initialize`)).statusCode).toBe(409);
      const rejected=await f.director.call(`/api/simulation/instances/${id}/activate`,{clientActionId:randomUUID(),expectedRevision:created.instance.revision,expectedActiveRevision:0});
      expect(rejected.statusCode,rejected.body).toBe(409);expect(await readFile(path,'utf8')).toBe(bytes);
      expect(await readdir(join(f.dir,'axon','scenario-runs'))).not.toContain('.activation.json');
    }
    await writeFile(path,JSON.stringify(original));expect((await activate(f,created)).instance.status).toBe('active');
    expect(f.lab.access!.list(directorSeat)).toHaveLength(2);expect(f.fake.calls).toEqual([]);
  },30000);

  it('keeps saved legacy three-task provenance and initialization receipts readable with strict legacy completeness',async()=>{
    const f=await setup(),{result:created}=await create(f),id=created.instance.instanceId,sourceDb=new DatabaseSync(join(f.dir,'source.sqlite'));
    try {
      const legacy=JSON.parse(String(sourceDb.prepare('SELECT body FROM scenario_instances WHERE instance_id=?').get(id)!.body));
      legacy.schemaVersion=1;delete legacy.taskBootstrap;legacy.instance.definitionVersion='3';legacy.instance.definitionHash='b'.repeat(64);
      legacy.tasks.unshift({code:'T01',title:'临港三号仓库火情',goal:'模拟场景：09:35前核对支援资源。',businessRefs:[],areaIds:[]});
      sourceDb.prepare('UPDATE scenario_instances SET body=? WHERE instance_id=?').run(JSON.stringify(legacy),id);
    }finally {sourceDb.close();}
    const prepared=await initialize(f,id);expect(prepared.tasks.map(task=>task.code)).toEqual(['T01','T02','T03']);expect(prepared).not.toHaveProperty('taskBootstrap');
    const path=join(f.dir,'axon','scenario-runs',`${id}.json`),original=await readFile(path,'utf8'),saved=JSON.parse(original);
    expect(saved.schemaVersion).toBe(1);expect(saved).not.toHaveProperty('taskBootstrap');
    await f.app.close();
    const fake=await fakeRuntime(f.config,()=>({text:'不得自动运行'})),lab=await PiLab.create(f.config,fake.runtime),app=await createApp(lab,false,{config:f.background,env},{config:f.context,env});cleanup.push(()=>app.close());
    const director=await login(app,directorSeat);
    expect(await json(director.call(`/api/simulation/instances/${id}/initialize`))).toEqual(prepared);
    expect(await json(director.call(`/api/simulation/instances/${id}/initialize`,{clientActionId:randomUUID()}))).toEqual(prepared);
    expect(await readFile(path,'utf8')).toBe(original);expect(lab.access!.list(directorSeat)).toHaveLength(3);
    await writeFile(path,JSON.stringify({...saved,tasks:saved.tasks.slice(1)}));
    expect((await director.call(`/api/simulation/instances/${id}/initialize`)).statusCode).toBe(409);
    await writeFile(path,original);expect(fake.calls).toEqual([]);
  },30000);

  it('creates and recovers exactly two host tasks, explicitly sends frozen notices, and archives only the prior round on replay',async()=>{
    const f=await setup(),creationId=randomUUID(),{result:created,input}=await create(f,creationId),id=created.instance.instanceId;
    expect(created.operation.actor).toEqual({userId:f.director.auth.identity!.userId,seatId:directorSeat});
    expect(await json(f.director.call(`/api/simulation/operations/${creationId}`))).toEqual(created);
    expect((await json<ScenarioMutationResult>(f.director.call('/api/simulation/instances',input))).instance.instanceId).toBe(id);
    expect((await json<ScenarioInstances>(f.director.call('/api/simulation/instances'))).items).toHaveLength(1);
    expect(await json(f.director.call(`/api/simulation/instances/${id}/initialize`))).toMatchObject({instanceId:id,initialized:false,tasks:[],taskBootstrap:{schemaVersion:2,definitionVersion:'4',expectedTaskCodes:['T02','T03']}});
    const prepared=await initialize(f,id);
    expect(prepared.initialized).toBe(true);expect(prepared.tasks.map(t=>t.code)).toEqual(['T02','T03']);expect(prepared.taskBootstrap?.definitionHash).toBe(created.instance.definitionHash);
    expect(f.lab.access!.list(directorSeat)).toHaveLength(2);
    const mappingPath=join(f.dir,'axon','scenario-runs',`${id}.json`);
    const mapping=JSON.parse(await readFile(mappingPath,'utf8')) as {tasks:Array<{taskId?:string}>};
    delete mapping.tasks[1].taskId;await writeFile(mappingPath,JSON.stringify(mapping));
    expect(await json(f.director.call(`/api/simulation/instances/${id}/initialize`))).toEqual(prepared);
    expect(await initialize(f,id)).toEqual(prepared);expect(f.lab.access!.list(directorSeat)).toHaveLength(2);
    let state=await activate(f,created);
    const activationPath=join(f.dir,'axon','scenario-runs','.activation.json');
    const receipt=JSON.parse(await readFile(activationPath,'utf8')) as Record<string,unknown>;receipt.state='pending';await writeFile(activationPath,JSON.stringify(receipt));
    expect((await json<ScenarioMutationResult>(f.director.call(`/api/simulation/operations/${state.operation.id}`))).operation.id).toBe(state.operation.id);
    expect(JSON.parse(await readFile(activationPath,'utf8')).state).toBe('complete');
    const preview=await json<ScenarioPreview>(f.director.call(`/api/simulation/instances/${id}/preview`,{expectedRevision:state.instance.revision}));
    expect(preview.canApply).toBe(true);expect(preview.step?.id).toBe('E01');
    const applyId=randomUUID(),apply={clientActionId:applyId,expectedRevision:state.instance.revision};
    state=await json<ScenarioMutationResult>(f.director.call(`/api/simulation/instances/${id}/steps/E01`,apply));
    expect((await json<ScenarioMutationResult>(f.director.call(`/api/simulation/instances/${id}/steps/E01`,apply))).operation.id).toBe(applyId);
    expect(state.instance.businessNow).toBe('2026-11-03T09:12:00+08:00');expect(state.actions).toHaveLength(1);
    const action=state.actions[0];expect(action.sendState).toBe('unsent');
    expect(f.lab.access!.db.prepare('SELECT count(*) n FROM background_events').get()?.n).toBe(0);
    state=await json<ScenarioMutationResult>(f.director.call(`/api/simulation/instances/${id}/control`,{clientActionId:randomUUID(),expectedRevision:state.instance.revision,action:'pause'}));
    expect((await f.director.call(`/api/simulation/actions/${action.id}/send`,{})).statusCode).toBe(409);
    expect((await json<ScenarioAction>(f.director.call(`/api/simulation/actions/${action.id}`))).sendState).toBe('unsent');
    state=await json<ScenarioMutationResult>(f.director.call(`/api/simulation/instances/${id}/control`,{clientActionId:randomUUID(),expectedRevision:state.instance.revision,action:'resume'}));
    const delivered=await json<ScenarioAction>(f.director.call(`/api/simulation/actions/${action.id}/send`,{}));
    expect(delivered.sendState).toBe('accepted');expect(delivered.deliveryActor).toEqual(created.operation.actor);
    expect((await json<ScenarioAction>(f.director.call(`/api/simulation/actions/${action.id}/send`,{}))).receipt).toEqual(delivered.receipt);
    expect(f.lab.access!.db.prepare('SELECT count(*) n FROM background_events').get()?.n).toBe(1);
    const overall=await login(f.app,'seat-overall');
    const source=await json<{data:{items:unknown[]}}>(overall.call('/api/context/situation',{systemId:'situation',mode:'current',limit:100}));expect(source.data.items).toHaveLength(53);
    const unrelated=await json<TaskSpace>(overall.call('/api/tasks',{clientActionId:randomUUID(),title:'非演示轮次的业务任务',goal:'保留原有工作',visibility:'public'}));
    state=await json<ScenarioMutationResult>(f.director.call(`/api/simulation/instances/${id}/control`,{clientActionId:randomUUID(),expectedRevision:state.instance.revision,action:'pause'}));
    const next=await create(f),nextTasks=await initialize(f,next.result.instance.instanceId);await activate(f,next.result);
    expect((await json<ScenarioInstanceDetail>(f.director.call(`/api/simulation/instances/${id}`))).instance.status).toBe('frozen');
    for(const row of prepared.tasks)expect(f.lab.access!.get(row.taskId,directorSeat).state).toBe('archived');
    for(const row of nextTasks.tasks)expect(f.lab.access!.get(row.taskId,directorSeat).state).toBe('active');
    expect(f.lab.access!.get(unrelated.id,directorSeat).state).toBe('active');
    expect((await json<ScenarioMutationResult>(f.director.call(`/api/simulation/operations/${creationId}`))).instance.status).toBe('prepared');
    expect(f.fake.calls).toHaveLength(0);
  },30000);

  it('rejects invalid activation before archiving tasks or leaving a pending receipt',async()=>{
    const f=await setup(),{result:created}=await create(f),oldId=created.instance.instanceId,oldTasks=await initialize(f,oldId);
    let old=await activate(f,created);
    old=await json<ScenarioMutationResult>(f.director.call(`/api/simulation/instances/${oldId}/control`,{clientActionId:randomUUID(),expectedRevision:old.instance.revision,action:'pause'}));
    const next=await create(f),nextId=next.result.instance.instanceId;await initialize(f,nextId);
    const list=await json<ScenarioInstances>(f.director.call('/api/simulation/instances'));
    const receiptPath=join(f.dir,'axon','scenario-runs','.activation.json'),receipt=await readFile(receiptPath,'utf8');
    const checkUnchanged=async()=>{
      expect(await readFile(receiptPath,'utf8')).toBe(receipt);
      for(const task of oldTasks.tasks)expect(f.lab.access!.get(task.taskId,directorSeat).state).toBe('active');
      expect((await json<ScenarioInstanceDetail>(f.director.call(`/api/simulation/instances/${oldId}`))).instance.status).toBe('active');
    };
    for(const [id,revision] of [[nextId,next.result.instance.revision+1],[oldId,old.instance.revision]] as const){
      const rejected=await f.director.call(`/api/simulation/instances/${id}/activate`,{clientActionId:randomUUID(),expectedRevision:revision,expectedActiveRevision:list.activeRevision});
      expect(rejected.statusCode).toBe(409);expect(rejected.json().error.code).not.toBe('SCENARIO_ACTIVATION_PENDING');
      await checkUnchanged();
    }
    // A deployment may change the definition while a prepared instance remains on disk.
    const sourceDb=new DatabaseSync(join(f.dir,'source.sqlite'));
    try{
      const original=String(sourceDb.prepare('SELECT body FROM scenario_instances WHERE instance_id=?').get(nextId)!.body);
      const changed=JSON.parse(original) as {instance:{definitionHash:string};taskBootstrap:{definitionHash:string}};changed.instance.definitionHash='a'.repeat(64);changed.taskBootstrap.definitionHash=changed.instance.definitionHash;
      sourceDb.prepare('UPDATE scenario_instances SET body=? WHERE instance_id=?').run(JSON.stringify(changed),nextId);
      expect((await f.director.call(`/api/simulation/instances/${nextId}/activate`,{clientActionId:randomUUID(),expectedRevision:next.result.instance.revision,expectedActiveRevision:list.activeRevision})).statusCode).toBe(409);
      await checkUnchanged();
      sourceDb.prepare('UPDATE scenario_instances SET body=? WHERE instance_id=?').run(original,nextId);
    }finally{sourceDb.close();}
    // Rejected requests leave the old round controllable and a corrected activation possible.
    old=await json<ScenarioMutationResult>(f.director.call(`/api/simulation/instances/${oldId}/control`,{clientActionId:randomUUID(),expectedRevision:old.instance.revision,action:'resume'}));
    await json(f.director.call(`/api/simulation/instances/${oldId}/control`,{clientActionId:randomUUID(),expectedRevision:old.instance.revision,action:'pause'}));
    expect((await activate(f,next.result)).instance.status).toBe('active');
    for(const task of oldTasks.tasks)expect(f.lab.access!.get(task.taskId,directorSeat).state).toBe('archived');
    expect(f.fake.calls).toHaveLength(0);
  },30000);

  it('resumes the original pending activation after outstanding writes settle and the matching source definition is restored',async()=>{
    const f=await setup(),{result:created}=await create(f),oldId=created.instance.instanceId,oldTasks=await initialize(f,oldId);
    const old=await activate(f,created);
    await json<ScenarioMutationResult>(f.director.call(`/api/simulation/instances/${oldId}/control`,{clientActionId:randomUUID(),expectedRevision:old.instance.revision,action:'pause'}));
    const next=await create(f),nextId=next.result.instance.instanceId,nextTasks=await initialize(f,nextId);
    const list=await json<ScenarioInstances>(f.director.call('/api/simulation/instances'));
    const input={clientActionId:randomUUID(),expectedRevision:next.result.instance.revision,expectedActiveRevision:list.activeRevision,terminateUnsent:false};
    const path=`/api/simulation/instances/${nextId}/activate`,receiptPath=join(f.dir,'axon','scenario-runs','.activation.json');
    const release=f.lab.access!.acquire(oldTasks.tasks[1].taskId,'seat-overall'),definitionHash=scenarioDefinition.definitionHash;
    try{
      // The run gate closes, but no task is archived before outstanding writes settle.
      const interrupted=await f.director.call(path,input);
      expect(interrupted.statusCode).toBe(409);expect(interrupted.json()).toMatchObject({error:{code:'SCENARIO_ACTIVATION_PENDING'}});expect(interrupted.body).toContain(input.clientActionId);
      const pending=JSON.parse(await readFile(receiptPath,'utf8')) as {state:string;operationId:string;inputHash:string};
      expect(pending).toMatchObject({state:'pending',operationId:input.clientActionId});
      expect(JSON.parse(pending.inputHash)).toEqual([nextId,f.director.auth.identity!.userId,input.expectedRevision,input.expectedActiveRevision,false]);
      expect(oldTasks.tasks.map(task=>f.lab.access!.get(task.taskId,directorSeat).state)).toEqual(['active','active']);
      const initialRevision=f.lab.access!.get(oldTasks.tasks[0].taskId,directorSeat).revision;
      expect((await f.director.call(`/api/simulation/operations/${input.clientActionId}`)).statusCode).toBe(404);
      expect((await f.director.call('/api/simulation/instances',{...next.input,clientActionId:randomUUID()})).statusCode).toBe(409);
      f.lab.access!.db.prepare('UPDATE seats SET control_scenarios=0 WHERE id=?').run(directorSeat);
      const denied=await f.director.call(path,input);expect(denied.statusCode).toBe(403);expect(denied.body).not.toContain(input.clientActionId);
      f.lab.access!.db.prepare('UPDATE seats SET control_scenarios=1 WHERE id=?').run(directorSeat);
      release();
      // Fault injection represents a source deployment publishing a different definition.
      scenarioDefinition.definitionHash='replacement-definition';
      const changed=await f.director.call(path,input);expect(changed.statusCode).toBe(409);expect(changed.json().error.code).toBe('SCENARIO_ACTIVATION_PENDING');
      expect(JSON.parse(await readFile(receiptPath,'utf8'))).toEqual(pending);
      expect((await f.director.call(`/api/simulation/operations/${input.clientActionId}`)).statusCode).toBe(404);
      scenarioDefinition.definitionHash=definitionHash;
      const resumed=await json<ScenarioMutationResult>(f.director.call(path,input));
      expect(resumed.operation.id).toBe(input.clientActionId);expect(resumed.instance.status).toBe('active');
      expect((await json<ScenarioMutationResult>(f.director.call(`/api/simulation/operations/${input.clientActionId}`))).operation.id).toBe(input.clientActionId);
      expect(JSON.parse(await readFile(receiptPath,'utf8'))).toMatchObject({state:'complete',operationId:input.clientActionId});
      expect((await json<ScenarioInstanceDetail>(f.director.call(`/api/simulation/instances/${oldId}`))).instance.status).toBe('frozen');
      for(const task of oldTasks.tasks)expect(f.lab.access!.get(task.taskId,directorSeat).state).toBe('archived');
      expect(f.lab.access!.get(oldTasks.tasks[0].taskId,directorSeat).revision).toBe(initialRevision+1);
      for(const task of nextTasks.tasks)expect(f.lab.access!.get(task.taskId,directorSeat).state).toBe('active');
      expect(f.lab.access!.list(directorSeat)).toHaveLength(4);
      expect(f.fake.calls).toHaveLength(0);
    }finally{release();scenarioDefinition.definitionHash=definitionHash;}
  },30000);

  it('keeps both sides closed after restart until the original activation receipt is reconciled',async()=>{
    const f=await setup(),{result:created}=await create(f),oldId=created.instance.instanceId,oldTasks=await initialize(f,oldId);
    const old=await activate(f,created),taskId=oldTasks.tasks[0].taskId;
    const workspace=await f.lab.workspaces.ensureWorkspace(taskId,'seat-overall','原任务');
    const action=await f.lab.collaboration!.prepare({seatId:'seat-overall'},{kind:'assign',taskSpaceId:taskId,payload:{workspaceId:workspace.id,assigneeSeatId:'seat-intelligence',title:'尚未完成的核对',goal:'核对现场情况',inputPaths:[]}},{source:'page',clientActionId:randomUUID()});
    const work=await f.lab.collaboration!.commitPage({seatId:'seat-overall'},action.operationId);
    const originalWork=f.lab.collaboration!.read({seatId:'seat-intelligence'},work.workItemId);
    await json(f.director.call(`/api/simulation/instances/${oldId}/control`,{clientActionId:randomUUID(),expectedRevision:old.instance.revision,action:'pause'}));
    const next=await create(f),nextId=next.result.instance.instanceId,nextTasks=await initialize(f,nextId),activated=await activate(f,next.result);
    // Existing unfinished business remains truthful; only the run's write gate seals it.
    expect(f.lab.access!.get(taskId,directorSeat).state).toBe('active');
    expect(f.lab.collaboration!.read({seatId:'seat-intelligence'},work.workItemId)).toEqual(originalWork);
    const receiptPath=join(f.dir,'axon','scenario-runs','.activation.json');
    const receipt=JSON.parse(await readFile(receiptPath,'utf8')) as Record<string,unknown>;
    expect(receipt).toMatchObject({state:'complete',previousInstanceId:oldId,instanceId:nextId});
    // Fault point: the source committed B but the host did not durably confirm its reply.
    await writeFile(receiptPath,JSON.stringify({...receipt,state:'pending'}));
    await f.app.close();
    const fake=await fakeRuntime(f.config,()=>({text:'不得自动运行'})),lab=await PiLab.create(f.config,fake.runtime);
    const app=await createApp(lab,false,{config:f.background,env},{config:f.context,env});cleanup.push(()=>app.close());
    const director=await login(app,directorSeat),overall=await login(app,'seat-overall');
    expect(lab.scenario!.activeId()).toBe(nextId);
    expect(lab.scenario!.isWritable(oldId)).toBe(false);expect(lab.scenario!.isWritable(nextId)).toBe(false);
    expect(JSON.parse(await readFile(receiptPath,'utf8')).state).toBe('pending');
    const source=await json<ScenarioInstanceDetail>(director.call(`/api/simulation/instances/${nextId}`));expect(source.instance.stepIndex).toBe(0);
    for(const row of [oldTasks.tasks[0],nextTasks.tasks[0]]){
      const task=await json<TaskSpace>(overall.call(`/api/tasks/${row.taskId}`));
      expect(task.readOnly).toBe(true);expect(task).not.toHaveProperty('scenarioInstanceId');
      expect((await overall.call(`/api/tasks/${row.taskId}/workspace`,{})).statusCode).toBe(409);
    }
    await expect(lab.collaboration!.prepare({seatId:'seat-intelligence'},{kind:'claim',workItemId:work.workItemId,expectedRevision:originalWork.revision,payload:{}},{source:'page',clientActionId:randomUUID()})).rejects.toMatchObject({code:'TASK_READ_ONLY'});
    expect(lab.collaboration!.read({seatId:'seat-intelligence'},work.workItemId)).toEqual(originalWork);
    expect(fake.calls).toHaveLength(0);
    expect((await json<ScenarioMutationResult>(director.call(`/api/simulation/operations/${activated.operation.id}`))).operation.id).toBe(activated.operation.id);
    expect(lab.scenario!.isWritable(nextId)).toBe(true);expect(lab.scenario!.isWritable(oldId)).toBe(false);
    expect(JSON.parse(await readFile(receiptPath,'utf8')).state).toBe('complete');
    expect((await overall.call(`/api/tasks/${nextTasks.tasks[0].taskId}/workspace`,{})).statusCode).toBe(200);
    expect((await overall.call(`/api/tasks/${taskId}/workspace`,{})).statusCode).toBe(409);
    expect(lab.workspaces.list('seat-overall').workspaces.map(item=>item.taskSpaceId)).toEqual([nextTasks.tasks[0].taskId]);
    expect(lab.activity('seat-overall').workspaces.map(item=>item.taskSpaceId)).toEqual([nextTasks.tasks[0].taskId]);
    expect(lab.workspaces.get(workspace.id,'seat-overall').taskSpaceId).toBe(taskId);
    expect(fake.calls).toHaveLength(0);
  },30000);

  it('keeps old state/action/edit routes from exposing or changing the new scene and rejects client-supplied actor authority',async()=>{
    const f=await setup(),{result:created}=await create(f),id=created.instance.instanceId;await initialize(f,id);const active=await activate(f,created);
    const applied=await json<ScenarioMutationResult>(f.director.call(`/api/simulation/instances/${id}/steps/E01`,{clientActionId:randomUUID(),expectedRevision:active.instance.revision}));
    const action=applied.actions[0],overall=await login(f.app,'seat-overall');
    const legacy=await overall.call('/api/simulation');expect(legacy.statusCode,legacy.body).toBe(200);expect(legacy.body).not.toContain(id);
    for(const response of [await overall.call(`/api/simulation/actions/${action.id}`),await overall.call(`/api/simulation/actions/${action.id}/send`,{})])expect(response.statusCode,response.body).toBe(404);
    expect((await json<ScenarioAction>(f.director.call(`/api/simulation/actions/${action.id}`))).sendState).toBe('unsent');
    const detail=await json<ScenarioInstanceDetail>(f.director.call(`/api/simulation/instances/${id}`)),road=detail.objects.find(o=>o.ref.objectType==='road')!;
    expect((await overall.call('/api/simulation/object-updates',{clientActionId:randomUUID(),ref:road.ref,expectedRevision:road.revision,properties:{passability:'closed'},effectiveAt:road.effectiveAt,validTime:null})).statusCode).toBe(404);
    expect((await f.director.call(`/api/simulation/instances/${id}/control`,{clientActionId:randomUUID(),expectedRevision:applied.instance.revision,action:'pause',actor:{userId:overall.auth.identity!.userId,seatId:'seat-overall'}})).statusCode).toBe(400);
    expect((await json<ScenarioInstanceDetail>(f.director.call(`/api/simulation/instances/${id}`))).instance.paused).toBe(false);
    for(const secret of Object.values(env))expect(JSON.stringify(detail)).not.toContain(secret);
    expect(f.fake.calls).toHaveLength(0);
  },30000);

  it('keeps scene access separate from public task preparation permission and reconciles after that permission is restored',async()=>{
    const f=await setup(),{result}=await create(f),id=result.instance.instanceId;
    f.lab.access!.db.prepare('UPDATE seats SET create_public=0 WHERE id=?').run(directorSeat);
    expect((await f.director.call('/api/simulation/scenarios')).statusCode).toBe(200);
    expect((await f.director.call(`/api/simulation/instances/${id}/initialize`,{clientActionId:randomUUID()})).statusCode).toBe(403);
    expect(await json(f.director.call(`/api/simulation/instances/${id}/initialize`))).toMatchObject({instanceId:id,initialized:false,tasks:[],taskBootstrap:{schemaVersion:2,definitionVersion:'4',expectedTaskCodes:['T02','T03']}});
    expect(f.lab.access!.list(directorSeat)).toHaveLength(0);
    f.lab.access!.db.prepare('UPDATE seats SET create_public=1 WHERE id=?').run(directorSeat);
    expect((await initialize(f,id)).initialized).toBe(true);
    expect(f.fake.calls).toHaveLength(0);
  },30000);
});
