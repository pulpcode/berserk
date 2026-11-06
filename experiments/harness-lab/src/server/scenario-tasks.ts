import { randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AccessStore } from '../access/store.js';
import type { Identity } from '../contracts/access.js';
import type { ScenarioTaskDefinition, ScenarioTaskInitialization, ScenarioTaskBootstrap } from '../contracts/scenarios.js';
import { RequestError } from '../contracts/errors.js';
import { atomicWrite, checkDirectory, parseJsonStrict, readControlled } from '../resources/files.js';
import { contextRecord, contextText } from '../context/validation.js';
import { scenarioTaskBootstrap, scenarioTaskDefinitions } from '../scenario/task-definitions.js';

interface TaskEntry extends ScenarioTaskDefinition { clientActionId: string; taskId?: string }
interface RunTasks { schemaVersion: 1|2; taskBootstrap?: ScenarioTaskBootstrap; instanceId: string; userId: string; operationId: string; tasks: TaskEntry[] }
export interface ActivationReceipt { operationId: string; instanceId: string; previousInstanceId: string | null; userId: string; inputHash: string; state: 'pending' | 'complete' }
const conflict = (message: string) => new RequestError('SCENARIO_HOST_CONFLICT', message, 409);
const uuid = (value: unknown) => { const text=contextText(value);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text))throw conflict('场景操作编号无效。');return text; };
export function scenarioId(value: unknown) { const text=contextText(value,64);if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(text))throw conflict('场景实例标识无效。');return text; }
export { scenarioTaskDefinitions } from '../scenario/task-definitions.js';

/** Only cross-system task IDs and activation receipts; conversations remain in their native stores. */
export class ScenarioTasks {
  private directory: string;
  private ready: Promise<void>;
  constructor(dataDir: string, private access: AccessStore) {
    this.directory=join(dataDir,'scenario-runs');
    this.ready=mkdir(this.directory,{recursive:true,mode:0o700}).then(()=>checkDirectory(this.directory));
  }
  async prepare(verify?: (id:string,definitions:ScenarioTaskDefinition[],bootstrap?:ScenarioTaskBootstrap)=>Promise<void>) {
    await this.ready;
    for (const name of await readdir(this.directory)) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\.json$/.test(name)) continue;
      const run = await this.load(name.slice(0,-5));
      if (!run) continue;
      await verify?.(run.instanceId,run.tasks.map(({code,title,goal,businessRefs,areaIds})=>({code,title,goal,businessRefs,areaIds})),run.taskBootstrap);
      for (const row of run.tasks) {
        const taskId=this.createdTaskId(run,row);
        if(taskId){
          this.access.bindScenarioTask(taskId,run.instanceId,row.clientActionId,run.userId,{title:row.title,goal:row.goal,visibility:'public',clientActionId:row.clientActionId,context:{businessRefs:row.businessRefs,focus:{areaIds:row.areaIds}}});
          if(!row.taskId){row.taskId=taskId;await this.save(run);}
        }
      }
    }
  }
  private async load(id: string): Promise<RunTasks | null> {
    await this.ready;
    const text=await readControlled(join(this.directory,`${scenarioId(id)}.json`),64*1024,true);if(text===null)return null;
    const raw=contextRecord(parseJsonStrict(text),['schemaVersion','taskBootstrap','instanceId','userId','operationId','tasks'],['schemaVersion','instanceId','userId','operationId','tasks']);
    if((raw.schemaVersion!==1&&raw.schemaVersion!==2)||raw.instanceId!==id||!Array.isArray(raw.tasks))throw conflict('本轮任务映射损坏，请核对备份。');
    const bootstrap=scenarioTaskBootstrap(raw.taskBootstrap);
    if(raw.schemaVersion===1&&bootstrap!==undefined||raw.schemaVersion===2&&!bootstrap)throw conflict('本轮任务映射版本与开场清单不一致。');
    const definitions=scenarioTaskDefinitions(raw.tasks.map(item=>{
      const r=contextRecord(item,['code','title','goal','businessRefs','areaIds','clientActionId','taskId'],['code','title','goal','businessRefs','areaIds','clientActionId']);
      return {code:r.code,title:r.title,goal:r.goal,businessRefs:r.businessRefs,areaIds:r.areaIds};
    }),bootstrap);
    const tasks=definitions.map((definition,index)=>{
      const row=raw.tasks as Array<Record<string,unknown>>,item=row[index];
      return {...definition,clientActionId:uuid(item.clientActionId),...(item.taskId===undefined?{}:{taskId:uuid(item.taskId)})};
    });
    if(new Set(tasks.map(row=>row.clientActionId)).size!==tasks.length||new Set(tasks.flatMap(row=>row.taskId?[row.taskId]:[])).size!==tasks.filter(row=>row.taskId).length)throw conflict('本轮任务回执重复，请核对备份。');
    return {schemaVersion:raw.schemaVersion as 1|2,...(bootstrap?{taskBootstrap:bootstrap}:{}),instanceId:id,userId:uuid(raw.userId),operationId:uuid(raw.operationId),tasks};
  }
  private async save(run: RunTasks) { await atomicWrite(join(this.directory,`${scenarioId(run.instanceId)}.json`),JSON.stringify(run)); }
  private verifyDefinitions(run: RunTasks, definitions: ScenarioTaskDefinition[], bootstrap?: ScenarioTaskBootstrap) {
    const saved=run.tasks.map(({code,title,goal,businessRefs,areaIds})=>({code,title,goal,businessRefs,areaIds}));
    if(JSON.stringify(saved)!==JSON.stringify(definitions)||JSON.stringify(run.taskBootstrap)!==JSON.stringify(bootstrap))throw conflict('本轮保存的任务定义与来源不一致。');
  }
  private createdTaskId(run: RunTasks, row: TaskEntry) {
    const receipt=this.access.db.prepare('SELECT task_id FROM task_actions WHERE user_id=? AND action_id=?').get(run.userId,row.clientActionId);
    if(row.taskId&&receipt?.task_id!==row.taskId)throw conflict('本轮任务映射与原创建回执不一致。');
    return receipt?.task_id?String(receipt.task_id):undefined;
  }
  private projection(run: RunTasks | null, id: string, actor: Identity, bootstrap?: ScenarioTaskBootstrap): ScenarioTaskInitialization {
    const tasks=run?.tasks.flatMap(row=>{
      const taskId=this.createdTaskId(run,row);
      if(!taskId)return [];
      const task=this.access.get(taskId,actor.seatId);
      if(task.scenarioInstanceId!==id)throw conflict('本轮任务归属与创建回执不一致。');
      return [{code:row.code,taskId:task.id,title:task.title}];
    })??[];
    const savedBootstrap=run?.taskBootstrap??bootstrap;
    return {instanceId:id,tasks,initialized:run!==null&&tasks.length===run.tasks.length,...(savedBootstrap?{taskBootstrap:savedBootstrap}:{})};
  }
  async read(actor: Identity, id: string, bootstrap?: ScenarioTaskBootstrap, definitions?:ScenarioTaskDefinition[]) {
    const run=await this.load(id);if(run&&definitions)this.verifyDefinitions(run,definitions,bootstrap);
    return this.projection(run,id,actor,bootstrap);
  }
  async initialize(actor: Identity, id: string, operationId: string, definitions: ScenarioTaskDefinition[], check: () => void, bootstrap?: ScenarioTaskBootstrap) {
    if(!actor.createPublicTask)throw new RequestError('FORBIDDEN','初始化演示任务还需要现有工作任务管理权限。',403);
    definitions=scenarioTaskDefinitions(definitions,bootstrap);
    let run=await this.load(id);
    if(!run){run={schemaVersion:bootstrap?2:1,...(bootstrap?{taskBootstrap:bootstrap}:{}),instanceId:id,userId:actor.userId,operationId:uuid(operationId),tasks:definitions.map(task=>({...task,clientActionId:randomUUID()}))};await this.save(run);}
    this.verifyDefinitions(run,definitions,bootstrap);
    if(run.userId!==actor.userId&&!this.projection(run,id,actor).initialized)throw conflict('本轮部分任务由另一账号创建，请先核对原创建回执。');
    for(const row of run.tasks){
      check();
      const known=this.createdTaskId(run,row);
      if(known){
        this.access.bindScenarioTask(known,id,row.clientActionId,run.userId,{title:row.title,goal:row.goal,visibility:'public',clientActionId:row.clientActionId,context:{businessRefs:row.businessRefs,focus:{areaIds:row.areaIds}}});
        if(!row.taskId){row.taskId=known;await this.save(run);}
        continue;
      }
      const task=this.access.create(actor,{title:row.title,goal:row.goal,visibility:'public',clientActionId:row.clientActionId,context:{businessRefs:row.businessRefs,focus:{areaIds:row.areaIds}}},id);
      row.taskId=task.id;await this.save(run);
    }
    return this.projection(run,id,actor);
  }
  async requireReady(actor: Identity,id: string,bootstrap?:ScenarioTaskBootstrap,definitions?:ScenarioTaskDefinition[]) {
    const saved=await this.load(id);
    if(saved&&definitions)this.verifyDefinitions(saved,definitions,bootstrap);
    if(JSON.stringify(saved?.taskBootstrap)!==JSON.stringify(bootstrap))throw conflict('本轮保存的开场任务版本与来源不一致。');
    const run=this.projection(saved,id,actor);if(!run.initialized)throw conflict('请先完成本轮开场任务的初始化。');
    for(const task of run.tasks){const stored=this.access.get(task.taskId,actor.seatId);if(stored.state!=='active'||stored.scenarioInstanceId!==id)throw conflict('演示任务状态或归属已变化。');}return run;
  }
  async archive(actor: Identity,id: string, blocked: (taskId:string)=>boolean, check:()=>void) {
    const run=await this.read(actor,id);if(!run.initialized)throw conflict('旧轮任务映射不完整，请先核对。');
    const rows=this.access.db.prepare("SELECT id FROM task_spaces WHERE json_extract(data,'$.scenarioInstanceId')=?").all(id);
    for(const row of rows){check();const task=this.access.get(String(row.id),actor.seatId);if(task.state==='active'&&!blocked(task.id))this.access.update(actor,task.id,task.revision,{state:'archived'},()=>blocked(task.id),true);}
  }
  async activation(): Promise<ActivationReceipt | null> {
    await this.ready;const text=await readControlled(join(this.directory,'.activation.json'),8192,true);if(text===null)return null;
    const r=contextRecord(parseJsonStrict(text),['operationId','instanceId','previousInstanceId','userId','inputHash','state'],['operationId','instanceId','previousInstanceId','userId','inputHash','state']);
    if(r.state!=='pending'&&r.state!=='complete')throw conflict('激活回执无效。');
    return {operationId:uuid(r.operationId),instanceId:scenarioId(r.instanceId),previousInstanceId:r.previousInstanceId===null?null:scenarioId(r.previousInstanceId),userId:uuid(r.userId),inputHash:contextText(r.inputHash,2048),state:r.state};
  }
  async saveActivation(receipt: ActivationReceipt) { await this.ready;await atomicWrite(join(this.directory,'.activation.json'),JSON.stringify(receipt)); }
  async assertSettled(operationId?: string) {
    const receipt=await this.activation();if(receipt?.state==='pending'&&receipt.operationId!==operationId)throw conflict('上次激活尚未核对，请先查询原操作回执或重试相同激活。');
  }
}
