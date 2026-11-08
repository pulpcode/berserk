import { assertCommandObjects } from '../../../src/commands/validation.js';
import type { ExternalCommand } from '../../../src/contracts/commands.js';
import { advanceExecution, executionState, executionSummary, executionTime, executionView, nextExecutionTime, receiveExecution, type ExecutionState } from './execution.js';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { RequestError } from '../../../src/contracts/errors.js';
import type { SituationChange } from '../../../src/contracts/context.js';
import type { ScenarioAction, ScenarioActor, ScenarioClock, ScenarioCreateInput, ScenarioInstance, ScenarioInstanceDetail, ScenarioInstances, ScenarioMutationResult, ScenarioOperation, ScenarioPreview, ScenarioTaskBootstrap } from '../../../src/contracts/scenarios.js';
import { isScenarioClock } from '../../../src/contracts/scenarios.js';
import { scenarioTaskBootstrap, scenarioTaskDefinitions } from '../../../src/scenario/task-definitions.js';
import type { SimulationReceipt } from '../../../src/contracts/simulation.js';
import { sceneWorld, scenarioDefinition, executionDefinition, executionBootstrap, directorStepTasks, taskBootstrap, type SceneWorld } from './data.js';

export const sceneError = (message:string,code='SCENARIO_CONFLICT',status=409) => new RequestError(code,message,status);
export const stable = (value:unknown):string => JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
interface StoredOperation extends ScenarioOperation { input:string; resultInstance:ScenarioInstance }
export interface SceneRecord extends SceneWorld { execution?:ExecutionState; schemaVersion:1|2|3; taskBootstrap?:ScenarioTaskBootstrap; instance:ScenarioInstance; changes:SituationChange[]; actions:ScenarioAction[]; operations:StoredOperation[] }
interface ActivePointer { instanceId:string|null; revision:number }
const now = () => new Date().toISOString();
const publicOperation = ({input:_input,resultInstance:_instance,...operation}:StoredOperation):ScenarioOperation => {void _input;void _instance;return structuredClone(operation);};
export const sceneClock = (record:SceneRecord):ScenarioClock => ({instanceId:record.instance.instanceId,businessNow:record.instance.businessNow,revision:record.instance.revision});
export const sceneChangeCursor = (instanceId:string,index:number) => `scene:${instanceId}:${index}`;

/** Independent scene rows; every operation persists a whole local transaction before publication. */
export class ScenarioStore {
  private db?:DatabaseSync;
  private memory = new Map<string,SceneRecord>();
  private activeMemory:ActivePointer={instanceId:null,revision:0};
  constructor(path?:string) {
    if(path){mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS scenario_instances(instance_id TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS scenario_active(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL)');}
  }
  close(){this.db?.close();}
  active():ActivePointer {
    if(!this.db)return {...this.activeMemory};const row=this.db.prepare('SELECT body FROM scenario_active WHERE id=1').get();return row?JSON.parse(String(row.body)) as ActivePointer:{instanceId:null,revision:0};
  }
  get(id:string):SceneRecord {
    const row=this.db?.prepare('SELECT body FROM scenario_instances WHERE instance_id=?').get(id);
    const record=this.db?(row?JSON.parse(String(row.body)) as SceneRecord:undefined):this.memory.get(id);
    if(!record)throw sceneError('场景实例不存在。','NOT_FOUND',404);
    if(!record.instance||record.instance.instanceId!==id||!isScenarioClock(sceneClock(record)))throw sceneError('场景快照无法读取，未覆盖原数据。','SCENARIO_SNAPSHOT_INVALID',500);
    try {
      if(record.schemaVersion===1){
        if(record.taskBootstrap!==undefined||record.instance.definitionId!=='harbor-fire'||!['1','2','3'].includes(record.instance.definitionVersion))throw new Error('Unknown legacy definition');
        scenarioTaskDefinitions(record.tasks);
      }else if(record.schemaVersion===2||record.schemaVersion===3){
        const bootstrap=scenarioTaskBootstrap(record.taskBootstrap);
        if(!bootstrap||bootstrap.definitionId!==record.instance.definitionId||bootstrap.definitionVersion!==record.instance.definitionVersion||bootstrap.definitionHash!==record.instance.definitionHash)throw new Error('Bootstrap mismatch');
        scenarioTaskDefinitions(record.tasks,bootstrap);
      }else throw new Error('Unknown snapshot schema');
    }catch {throw sceneError('场景任务快照无法读取，未覆盖原数据。','SCENARIO_SNAPSHOT_INVALID',500);}
    if(record.schemaVersion===3){if(record.instance.definitionVersion!=='5'||!record.execution)throw sceneError('执行快照缺失。','SCENARIO_SNAPSHOT_INVALID',500);executionState(record);}
    return structuredClone(record);
  }
  has(id:string){return this.db?Boolean(this.db.prepare('SELECT 1 FROM scenario_instances WHERE instance_id=?').get(id)):this.memory.has(id);}
  list(offset=0,limit=20):ScenarioInstances {
    const records=this.db?this.db.prepare('SELECT body FROM scenario_instances ORDER BY rowid DESC LIMIT ? OFFSET ?').all(limit+1,offset).map(row=>JSON.parse(String(row.body)) as SceneRecord):[...this.memory.values()].reverse().slice(offset,offset+limit+1);
    const active=this.active(),hasMore=records.length>limit;return {items:records.slice(0,limit).map(record=>this.get(record.instance.instanceId).instance),activeInstanceId:active.instanceId,activeRevision:active.revision,hasMore,nextCursor:hasMore?String(offset+limit):null};
  }
  detail(id:string):ScenarioInstanceDetail {
    const record=this.get(id);return {...(record.instance.definitionVersion==='5'?{timeline:this.timeline(record)}:{}),instance:record.instance,steps:record.steps.map(step=>({...step.summary,...(record.instance.definitionId===scenarioDefinition.id&&record.instance.definitionVersion===scenarioDefinition.version?{taskCodes:directorStepTasks[step.summary.id]??[]}: {})})),taskDefinitions:record.tasks,...(record.taskBootstrap?{taskBootstrap:record.taskBootstrap}:{}),objects:record.objects,reports:record.reports,actions:record.actions.slice(-20),operations:record.operations.slice(-20).map(publicOperation)};
  }
  notification(id:string,sourceMessageId:string) {
    const actions=this.get(id).actions.filter(action=>action.notification.sourceMessageId===sourceMessageId);
    if(!actions.length)throw sceneError('场景通知不存在。','NOT_FOUND',404);
    const action=actions[0];
    if(actions.length!==1||action.instanceId!==id||action.notification.scenarioInstanceId!==undefined&&action.notification.scenarioInstanceId!==id)throw sceneError('场景通知归属不一致。','SCENARIO_SNAPSHOT_INVALID',500);
    return {instanceId:id,systemId:action.systemId,actionId:action.id,notification:structuredClone(action.notification)};
  }
  provenance(id:string) {
    const record=this.get(id),messages=new Set<string>();
    const notifications=record.actions.map(action=>{
      if(messages.has(action.notification.sourceMessageId)||action.instanceId!==id||action.notification.scenarioInstanceId!==undefined&&action.notification.scenarioInstanceId!==id)throw sceneError('场景通知归属不一致。','SCENARIO_SNAPSHOT_INVALID',500);
      messages.add(action.notification.sourceMessageId);return {actionId:action.id,systemId:action.systemId,notification:structuredClone(action.notification)};
    });
    return {instanceId:id,tasks:record.tasks,...(record.taskBootstrap?{taskBootstrap:record.taskBootstrap}:{}),notifications,actions:record.actions};
  }
  private save(records:SceneRecord[],active?:ActivePointer) {
    if(!this.db){for(const record of records)this.memory.set(record.instance.instanceId,structuredClone(record));if(active)this.activeMemory={...active};return;}
    this.db.exec('BEGIN IMMEDIATE');try{for(const record of records)this.db.prepare('INSERT INTO scenario_instances(instance_id,body) VALUES(?,?) ON CONFLICT(instance_id) DO UPDATE SET body=excluded.body').run(record.instance.instanceId,JSON.stringify(record));if(active)this.db.prepare('INSERT INTO scenario_active(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(active));this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  private findOperation(id:string):{record:SceneRecord;operation:StoredOperation}|undefined {
    if(this.db){const row=this.db.prepare("SELECT i.instance_id FROM scenario_instances i, json_each(i.body,'$.operations') op WHERE json_extract(op.value,'$.id')=? LIMIT 1").get(id);if(!row)return;const record=this.get(String(row.instance_id));return {record,operation:record.operations.find(op=>op.id===id)!};}
    for(const saved of this.memory.values()){const operation=saved.operations.find(op=>op.id===id);if(operation){const record=this.get(saved.instance.instanceId);return {record,operation:record.operations.find(op=>op.id===id)!};}}
  }
  private result(record:SceneRecord,operation:StoredOperation):ScenarioMutationResult {return {instance:structuredClone(operation.resultInstance),operation:publicOperation(operation),actions:record.actions.filter(action=>operation.actionIds.includes(action.id)).map(action=>structuredClone(action))};}
  operation(id:string):ScenarioMutationResult {const found=this.findOperation(id);if(!found)throw sceneError('场景操作尚不存在。','NOT_FOUND',404);return this.result(found.record,found.operation);}
  private prior(id:string,input:string) {const found=this.findOperation(id);if(!found)return;if(found.operation.input!==input)throw sceneError('操作编号已用于不同内容。','ACTION_CONFLICT');return this.result(found.record,found.operation);}
  private writable(record:SceneRecord,revision:number) {
    if(![scenarioDefinition,executionDefinition].some(def=>def.version===record.instance.definitionVersion&&def.definitionHash===record.instance.definitionHash))throw sceneError('场景定义已变化，旧轮仅可读，请创建新轮。','SCENARIO_DEFINITION_CHANGED');
    if(record.instance.status==='frozen')throw sceneError('旧轮已冻结，不能继续修改。','SCENARIO_FROZEN');
    if(record.instance.revision!==revision)throw sceneError('场景已更新，请刷新并核对。','REVISION_CONFLICT');
    if(record.operations.length>=1000)throw sceneError('本轮控制操作已达上限，请建立新轮。','SCENARIO_LIMIT');
  }
  private append(record:SceneRecord,kind:ScenarioOperation['kind'],id:string,input:string,actor:ScenarioActor,actionIds:string[]=[]):StoredOperation {
    const operation:StoredOperation={id,instanceId:record.instance.instanceId,kind,revision:record.instance.revision,businessNow:record.instance.businessNow,createdAt:now(),actor:structuredClone(actor),actionIds,input,resultInstance:structuredClone(record.instance)};record.operations.push(operation);return operation;
  }
  create(input:ScenarioCreateInput,actor:ScenarioActor):ScenarioMutationResult {
    const key=stable({kind:'create',input,actor}),prior=this.prior(input.clientActionId,key);if(prior)return prior;
    const definition=input.version==='5'?executionDefinition:scenarioDefinition;
    if(input.definitionId!==definition.id||input.version!==definition.version||!definition.modes.includes(input.mode)||input.businessDay!==undefined&&input.businessDay!==definition.businessDay)throw sceneError('场景定义、版本、模式或业务日期无效。','INVALID_ARGUMENT',400);
    const instanceId=`run-${randomUUID()}`,time=now(),world=sceneWorld(instanceId);
    const record:SceneRecord={schemaVersion:input.version==='5'?3:2,...(input.version==='5'?{execution:{schemaVersion:1 as const,commands:{},roots:{},timeline:[]}}:{}),taskBootstrap:structuredClone(input.version==='5'?executionBootstrap:taskBootstrap),instance:{instanceId,definitionId:definition.id,definitionVersion:definition.version,definitionHash:definition.definitionHash,name:definition.name,mode:input.mode,status:'prepared',paused:false,revision:1,businessNow:scenarioDefinition.initialBusinessNow,stepIndex:0,stepCount:world.steps.length,createdAt:time,updatedAt:time},...world,changes:[],actions:[],operations:[]};
    const operation=this.append(record,'create',input.clientActionId,key,actor);this.save([record]);return this.result(record,operation);
  }
  activate(id:string,operationId:string,revision:number,activeRevision:number,terminateUnsent:boolean,actor:ScenarioActor):ScenarioMutationResult {
    const input=stable({kind:'activate',id,operationId,revision,activeRevision,terminateUnsent,actor}),prior=this.prior(operationId,input);if(prior)return prior;
    const record=this.get(id),active=this.active();this.writable(record,revision);
    if(record.instance.status!=='prepared')throw sceneError('只能激活已准备的新轮。');
    if(active.revision!==activeRevision)throw sceneError('活动轮次已变化，请刷新。','REVISION_CONFLICT');
    const records=[record];if(active.instanceId){const old=this.get(active.instanceId);if(!old.instance.paused)throw sceneError('请先暂停旧轮。');if(old.actions.some(a=>a.sendState==='unconfirmed'))throw sceneError('旧轮还有接收未确认的消息，请先核对。');if(old.actions.some(a=>a.sendState==='unsent')&&!terminateUnsent)throw sceneError('旧轮存在未投放消息；请显式保留未投放记录后重演。');old.instance.status='frozen';old.instance.revision++;old.instance.updatedAt=now();records.push(old);}
    record.instance.status='active';record.instance.revision++;record.instance.updatedAt=now();const operation=this.append(record,'activate',operationId,input,actor);this.save(records,{instanceId:id,revision:active.revision+1});return this.result(record,operation);
  }
  private legacyPreview(id:string):ScenarioPreview {
    const record=this.get(id),step=record.steps[record.instance.stepIndex];let reason:string|undefined;
    if(record.instance.status!=='active')reason=record.instance.status==='frozen'?'旧轮已冻结。':'请先初始化任务并激活本轮。';
    else if(record.instance.paused)reason='本轮已暂停，请继续后再投放。';
    else if(!step)reason='来源事件已投放完毕；这不表示业务任务完成。';
    else if(record.instance.mode==='main_story'&&record.instance.stepIndex>=5)reason='主线演示事件已投放完毕，等待人员继续研判、选择方案。';
    else if(record.actions.some(action=>action.sendState!=='accepted'))reason='请先发送并核对前一步的全部通知。';
    return {instance:record.instance,step:step?.summary??null,changes:step?[...step.objects.map(o=>`${o.name} 更新至修订${o.revision}`),...step.reports.map(r=>`新增报告：${r.title}`)]:[],notifications:step?step.notices.map((notice,index)=>({sourceMessageId:`${id}-${step.summary.id}-${index+1}`,title:notice.title,text:notice.text,subjectId:notice.reportId,occurredAt:notice.occurredAt,scenarioInstanceId:id})):[],canApply:reason===undefined,...(reason?{reason}:{})};
  }
  private legacyApply(id:string,stepId:string,operationId:string,revision:number,actor:ScenarioActor):ScenarioMutationResult {
    const input=stable({kind:'step',id,stepId,operationId,revision,actor}),prior=this.prior(operationId,input);if(prior)return prior;
    const record=this.get(id);this.writable(record,revision);const preview=this.legacyPreview(id);if(!preview.canApply)throw sceneError(preview.reason!);const step=record.steps[record.instance.stepIndex];if(step.summary.id!==stepId)throw sceneError('只能按顺序应用下一事件。');
    for(const object of step.objects){const index=record.objects.findIndex(o=>o.ref.objectId===object.ref.objectId);if(index<0||record.objects[index].revision!==object.revision-1)throw sceneError('本步对象前置修订不匹配。');const before=record.objects[index];record.objects[index]=structuredClone(object);record.changes.push({cursor:sceneChangeCursor(id,record.changes.length+1),effectiveAt:object.effectiveAt,before,after:structuredClone(object)});}
    record.reports.push(...structuredClone(step.reports));record.instance.businessNow=step.summary.businessTime;record.instance.stepIndex++;record.instance.revision++;record.instance.updatedAt=now();
    const actions:ScenarioAction[]=step.notices.map((notice,index)=>({id:randomUUID(),instanceId:id,stepId,actor:structuredClone(actor),systemId:notice.systemId,revision:record.instance.revision,createdAt:now(),sendState:'unsent',notification:preview.notifications[index]}));record.actions.push(...actions);
    const operation=this.append(record,'step',operationId,input,actor,actions.map(a=>a.id));this.save([record]);return this.result(record,operation);
  }
  private timeline(record:SceneRecord) {
    const source=record.steps.map((step,index)=>({...step.summary,taskCodes:directorStepTasks[step.summary.id]??[],messageCount:index<record.instance.stepIndex?record.actions.filter(a=>a.stepId===step.summary.id).length:step.summary.messageCount,kind:'source' as const,state:index<record.instance.stepIndex?'applied' as const:'pending' as const}));
    const next=record.instance.status==='frozen'?undefined:nextExecutionTime(record);
    return [...source,...(record.execution?.timeline??[]),...(next===undefined?[]:[executionSummary(record,next)])].sort((a,b)=>Date.parse(a.businessTime)-Date.parse(b.businessTime)||(a.kind==='source'?-1:1));
  }
  private nextStep(record:SceneRecord) {
    const source=record.steps[record.instance.stepIndex]?.summary,next=nextExecutionTime(record);
    return next!==undefined&&(!source||next<Date.parse(source.businessTime))?executionSummary(record,next):source;
  }
  private applyV5(record:SceneRecord,stepId:string,actor:ScenarioActor) {
    const step=this.nextStep(record);if(!step||step.id!==stepId)throw sceneError('请按当前下一节点推进。');
    const start=record.actions.length;
    const targetTime=Date.parse(step.businessTime);
    if(step.kind!=='execution'&&targetTime>Date.parse(record.instance.businessNow)){record.instance.businessNow=executionTime(targetTime-1);advanceExecution(record,actor,stepId);}
    record.instance.businessNow=step.businessTime;record.instance.revision++;record.instance.updatedAt=now();
    if(step.kind!=='execution') {
      const source=record.steps[record.instance.stepIndex];
      for(const update of source.objects) {
        const index=record.objects.findIndex(o=>o.ref.objectId===update.ref.objectId);if(index<0)throw sceneError('来源对象缺失。');
        const before=record.objects[index];
        const after=structuredClone(update);
        // Refresh ordinary declarations while preserving execution-owned location and occupancy.
        if('executionCommandId' in before.properties) {
          after.geometry=structuredClone(before.geometry);
          after.properties=structuredClone(before.properties);
          if(after.resourceData&&before.resourceData) {
            after.resourceData.resource.availability=structuredClone(before.resourceData.resource.availability);
            after.resourceData.resource.position=structuredClone(before.resourceData.resource.position);
          }
        }
        after.revision=before.revision+1;record.objects[index]=after;
        record.changes.push({cursor:sceneChangeCursor(record.instance.instanceId,record.changes.length+1),effectiveAt:after.effectiveAt,before,after:structuredClone(after)});
      }
      record.reports.push(...structuredClone(source.reports));
      record.actions.push(...source.notices.map((notice,index)=>({id:randomUUID(),instanceId:record.instance.instanceId,stepId,actor:structuredClone(actor),systemId:notice.systemId,revision:record.instance.revision,createdAt:now(),sendState:'unsent' as const,notification:{sourceMessageId:`${record.instance.instanceId}-${stepId}-${index+1}`,title:notice.title,text:notice.text,subjectId:notice.reportId,occurredAt:notice.occurredAt,scenarioInstanceId:record.instance.instanceId}})));
      record.instance.stepIndex++;
    }
    advanceExecution(record,actor,stepId);
    if(step.kind==='execution')executionState(record).timeline.push({...step,state:'applied',messageCount:record.actions.length-start});
    return record.actions.slice(start);
  }
  preview(id:string):ScenarioPreview {
    const record=this.get(id);if(record.instance.definitionVersion!=='5')return this.legacyPreview(id);
    const step=this.nextStep(record);let reason:string|undefined;
    if(record.instance.status!=='active')reason='请先激活有效演示。';
    else if(record.instance.paused)reason='当前演示已暂停。';
    else if(record.actions.some(action=>action.sendState!=='accepted'))reason='请先投送并核对待发通知。';
    else if(!step)reason='来源事件和当前可推进的行动节点均已完成。';
    const clone=structuredClone(record),actions=step?this.applyV5(clone,step.id,{userId:'preview',seatId:'preview'}):[];
    return {instance:record.instance,step:step?{...step,messageCount:actions.length}:null,changes:actions.map(action=>action.notification.title),notifications:actions.map(action=>action.notification),canApply:reason===undefined,...(reason?{reason}:{})};
  }
  apply(id:string,stepId:string,operationId:string,revision:number,actor:ScenarioActor):ScenarioMutationResult {
    if(this.get(id).instance.definitionVersion!=='5')return this.legacyApply(id,stepId,operationId,revision,actor);
    const input=stable({kind:'step',id,stepId,operationId,revision,actor}),prior=this.prior(operationId,input);if(prior)return prior;
    const record=this.get(id);this.writable(record,revision);const preview=this.preview(id);if(!preview.canApply)throw sceneError(preview.reason!);
    const actions=this.applyV5(record,stepId,actor),operation=this.append(record,'step',operationId,input,actor,actions.map(a=>a.id));this.save([record]);return this.result(record,operation);
  }
  command(id:string) {
    let cursor=0;
    for(;;){const page=this.list(cursor,20);for(const entry of page.items){const record=this.get(entry.instanceId),command=record.execution?.commands[id];if(command)return {record,command};}if(!page.hasMore)return;cursor+=20;}
  }
  commandExecution(id:string) {const found=this.command(id);return found?executionView(found.record,id):undefined;}
  receiveCommand(input:ExternalCommand) {
    const previous=this.command(input.commandId);
    if(previous){if(stable(previous.command.input)!==stable(input))throw sceneError('指令编号已用于其他内容。','ACTION_CONFLICT');return previous.command.receipt;}
    const record=this.get(input.scenarioInstanceId);this.writable(record,record.instance.revision);
    if(this.active().instanceId!==record.instance.instanceId||record.instance.status!=='active')throw sceneError('当前资料已只读。','SCENARIO_FROZEN');
    assertCommandObjects(input.command,record.objects);
    record.instance.revision++;record.instance.updatedAt=now();
    const before=record.actions.length,receipt=receiveExecution(record,input,{userId:'external-simulation',seatId:input.issuedBy.seatId});
    if(record.actions.length>before)executionState(record).timeline.push({id:`command-${input.commandId}`,title:'控制指令反馈',description:'外部模拟系统返回当前指令处理进展。',businessTime:record.instance.businessNow,messageCount:record.actions.length-before,kind:'execution',state:'applied'});
    this.save([record]);return receipt;
  }
  control(id:string,action:'pause'|'resume',operationId:string,revision:number,actor:ScenarioActor):ScenarioMutationResult {
    const input=stable({kind:action,id,operationId,revision,actor}),prior=this.prior(operationId,input);if(prior)return prior;
    const record=this.get(id);this.writable(record,revision);if(record.instance.status!=='active')throw sceneError('只能暂停或继续活动轮次。');record.instance.paused=action==='pause';record.instance.revision++;record.instance.updatedAt=now();const operation=this.append(record,action,operationId,input,actor);this.save([record]);return this.result(record,operation);
  }
  action(id:string):{record:SceneRecord;action:ScenarioAction}|undefined {
    if(this.db){const row=this.db.prepare("SELECT i.instance_id FROM scenario_instances i,json_each(i.body,'$.actions') a WHERE json_extract(a.value,'$.id')=? LIMIT 1").get(id);if(!row)return;const record=this.get(String(row.instance_id));return {record,action:record.actions.find(a=>a.id===id)!};}
    for(const value of this.memory.values()){const record=this.get(value.instance.instanceId),action=record.actions.find(a=>a.id===id);if(action)return {record,action};}
  }
  delivery(id:string,state:ScenarioAction['sendState'],receipt?:SimulationReceipt,error?:string,actor?:ScenarioActor):ScenarioAction {
    const found=this.action(id);if(!found)throw sceneError('通知不存在。','NOT_FOUND',404);const action=found.action;action.sendState=state;if(receipt)action.receipt=receipt;if(error)action.error=error;else delete action.error;if(actor){action.deliveryActor=structuredClone(actor);action.deliveryAt=now();}this.save([found.record]);return structuredClone(action);
  }
}
