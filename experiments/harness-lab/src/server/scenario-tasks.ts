import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AccessStore } from '../access/store.js';
import type { Identity } from '../contracts/access.js';
import type { ScenarioTaskDefinition, ScenarioTaskInitialization } from '../contracts/scenarios.js';
import { RequestError } from '../contracts/errors.js';
import { atomicWrite, checkDirectory, parseJsonStrict, readControlled } from '../resources/files.js';
import { contextRecord, contextRef, contextText } from '../context/validation.js';

interface TaskEntry extends ScenarioTaskDefinition { clientActionId: string; taskId?: string }
interface RunTasks { schemaVersion: 1; instanceId: string; userId: string; operationId: string; tasks: TaskEntry[] }
export interface ActivationReceipt { operationId: string; instanceId: string; previousInstanceId: string | null; userId: string; inputHash: string; state: 'pending' | 'complete' }
const conflict = (message: string) => new RequestError('SCENARIO_HOST_CONFLICT', message, 409);
const uuid = (value: unknown) => { const text=contextText(value);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text))throw conflict('场景操作编号无效。');return text; };
export function scenarioId(value: unknown) { const text=contextText(value,64);if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(text))throw conflict('场景实例标识无效。');return text; }
export function scenarioTaskDefinitions(value: unknown): ScenarioTaskDefinition[] {
  if(!Array.isArray(value)||value.length!==3)throw conflict('来源未返回三个演示任务定义。');
  const tasks=value.map(item=>{
    const r=contextRecord(item,['code','title','goal','businessRefs','areaIds'],['code','title','goal','businessRefs','areaIds']);
    if(!['T01','T02','T03'].includes(String(r.code))||!Array.isArray(r.businessRefs)||r.businessRefs.length>20||!Array.isArray(r.areaIds)||r.areaIds.length>10)throw conflict('演示任务定义无效。');
    return {code:r.code as ScenarioTaskDefinition['code'],title:contextText(r.title,60),goal:contextText(r.goal,8000),businessRefs:r.businessRefs.map(contextRef),areaIds:r.areaIds.map(id=>contextText(id))};
  });
  if(new Set(tasks.map(t=>t.code)).size!==3)throw conflict('演示任务编号重复。');return tasks;
}

/** Only cross-system task IDs and activation receipts; conversations remain in their native stores. */
export class ScenarioTasks {
  private directory: string;
  private ready: Promise<void>;
  constructor(dataDir: string, private access: AccessStore) {
    this.directory=join(dataDir,'scenario-runs');
    this.ready=mkdir(this.directory,{recursive:true,mode:0o700}).then(()=>checkDirectory(this.directory));
  }
  async prepare() { await this.ready; }
  private async load(id: string): Promise<RunTasks | null> {
    await this.ready;
    const text=await readControlled(join(this.directory,`${scenarioId(id)}.json`),64*1024,true);if(text===null)return null;
    const raw=contextRecord(parseJsonStrict(text),['schemaVersion','instanceId','userId','operationId','tasks'],['schemaVersion','instanceId','userId','operationId','tasks']);
    if(raw.schemaVersion!==1||raw.instanceId!==id||!Array.isArray(raw.tasks))throw conflict('本轮任务映射损坏，请核对备份。');
    const definitions=scenarioTaskDefinitions(raw.tasks.map(item=>{
      const r=contextRecord(item,['code','title','goal','businessRefs','areaIds','clientActionId','taskId'],['code','title','goal','businessRefs','areaIds','clientActionId']);
      return {code:r.code,title:r.title,goal:r.goal,businessRefs:r.businessRefs,areaIds:r.areaIds};
    }));
    const tasks=definitions.map((definition,index)=>{
      const row=raw.tasks as Array<Record<string,unknown>>,item=row[index];
      return {...definition,clientActionId:uuid(item.clientActionId),...(item.taskId===undefined?{}:{taskId:uuid(item.taskId)})};
    });
    return {schemaVersion:1,instanceId:id,userId:uuid(raw.userId),operationId:uuid(raw.operationId),tasks};
  }
  private async save(run: RunTasks) { await atomicWrite(join(this.directory,`${scenarioId(run.instanceId)}.json`),JSON.stringify(run)); }
  private projection(run: RunTasks | null, id: string, actor: Identity): ScenarioTaskInitialization {
    const tasks=run?.tasks.flatMap(row=>{
      const taskId=row.taskId??(run.userId===actor.userId?this.access.findCreation(actor,row.clientActionId)[0]?.id:undefined);
      if(!taskId)return [];
      const task=this.access.get(taskId,actor.seatId);return [{code:row.code,taskId:task.id,title:task.title}];
    })??[];
    return {instanceId:id,tasks,initialized:tasks.length===3};
  }
  async read(actor: Identity, id: string) { return this.projection(await this.load(id),id,actor); }
  async initialize(actor: Identity, id: string, operationId: string, definitions: ScenarioTaskDefinition[], check: () => void) {
    if(!actor.createPublicTask)throw new RequestError('FORBIDDEN','初始化演示任务还需要现有工作任务管理权限。',403);
    let run=await this.load(id);
    if(!run){run={schemaVersion:1,instanceId:id,userId:actor.userId,operationId:uuid(operationId),tasks:definitions.map(task=>({...task,clientActionId:randomUUID()}))};await this.save(run);}
    if(run.userId!==actor.userId&&!this.projection(run,id,actor).initialized)throw conflict('本轮部分任务由另一账号创建，请先核对原创建回执。');
    if(this.projection(run,id,actor).initialized)return this.projection(run,id,actor);
    for(const row of run.tasks){
      check();
      if(!row.taskId){
        const task=this.access.create(actor,{title:row.title,goal:row.goal,visibility:'public',clientActionId:row.clientActionId,context:{businessRefs:row.businessRefs,focus:{areaIds:row.areaIds}}});
        row.taskId=task.id;await this.save(run);
      }
    }
    return this.projection(run,id,actor);
  }
  async requireReady(actor: Identity,id: string) {
    const run=await this.read(actor,id);if(!run.initialized)throw conflict('请先完成本轮三个任务的初始化。');
    for(const task of run.tasks)this.access.get(task.taskId,actor.seatId,true);return run;
  }
  async archive(actor: Identity,id: string, blocked: (taskId:string)=>boolean, check:()=>void) {
    const run=await this.read(actor,id);if(!run.initialized)throw conflict('旧轮任务映射不完整，请先核对。');
    for(const row of run.tasks){check();const task=this.access.get(row.taskId,actor.seatId);if(task.state==='active')this.access.update(actor,task.id,task.revision,{state:'archived'},()=>blocked(task.id));}
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
