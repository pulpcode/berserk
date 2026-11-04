import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { RequestError } from '../../../src/contracts/errors.js';
import type { SituationChange } from '../../../src/contracts/context.js';
import type { ScenarioAction, ScenarioActor, ScenarioClock, ScenarioCreateInput, ScenarioInstance, ScenarioInstanceDetail, ScenarioInstances, ScenarioMutationResult, ScenarioOperation, ScenarioPreview } from '../../../src/contracts/scenarios.js';
import { isScenarioClock } from '../../../src/contracts/scenarios.js';
import type { SimulationReceipt } from '../../../src/contracts/simulation.js';
import { sceneWorld, scenarioDefinition, type SceneWorld } from './data.js';

export const sceneError = (message:string,code='SCENARIO_CONFLICT',status=409) => new RequestError(code,message,status);
export const stable = (value:unknown):string => JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
interface StoredOperation extends ScenarioOperation { input:string; resultInstance:ScenarioInstance }
export interface SceneRecord extends SceneWorld { schemaVersion:1; instance:ScenarioInstance; changes:SituationChange[]; actions:ScenarioAction[]; operations:StoredOperation[] }
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
    if(record.schemaVersion!==1||record.instance.instanceId!==id||!isScenarioClock(sceneClock(record)))throw sceneError('场景快照无法读取，未覆盖原数据。','SCENARIO_SNAPSHOT_INVALID',500);
    return structuredClone(record);
  }
  has(id:string){return this.db?Boolean(this.db.prepare('SELECT 1 FROM scenario_instances WHERE instance_id=?').get(id)):this.memory.has(id);}
  list(offset=0,limit=20):ScenarioInstances {
    const records=this.db?this.db.prepare('SELECT body FROM scenario_instances ORDER BY rowid DESC LIMIT ? OFFSET ?').all(limit+1,offset).map(row=>JSON.parse(String(row.body)) as SceneRecord):[...this.memory.values()].reverse().slice(offset,offset+limit+1);
    const active=this.active(),hasMore=records.length>limit;return {items:records.slice(0,limit).map(record=>structuredClone(record.instance)),activeInstanceId:active.instanceId,activeRevision:active.revision,hasMore,nextCursor:hasMore?String(offset+limit):null};
  }
  detail(id:string):ScenarioInstanceDetail {
    const record=this.get(id);return {instance:record.instance,steps:record.steps.map(step=>step.summary),objects:record.objects,reports:record.reports,actions:record.actions.slice(-20),operations:record.operations.slice(-20).map(publicOperation)};
  }
  private save(records:SceneRecord[],active?:ActivePointer) {
    if(!this.db){for(const record of records)this.memory.set(record.instance.instanceId,structuredClone(record));if(active)this.activeMemory={...active};return;}
    this.db.exec('BEGIN IMMEDIATE');try{for(const record of records)this.db.prepare('INSERT INTO scenario_instances(instance_id,body) VALUES(?,?) ON CONFLICT(instance_id) DO UPDATE SET body=excluded.body').run(record.instance.instanceId,JSON.stringify(record));if(active)this.db.prepare('INSERT INTO scenario_active(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(active));this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  private findOperation(id:string):{record:SceneRecord;operation:StoredOperation}|undefined {
    if(this.db){const row=this.db.prepare("SELECT i.body FROM scenario_instances i, json_each(i.body,'$.operations') op WHERE json_extract(op.value,'$.id')=? LIMIT 1").get(id);if(!row)return;const record=JSON.parse(String(row.body)) as SceneRecord;return {record,operation:record.operations.find(op=>op.id===id)!};}
    for(const record of this.memory.values()){const operation=record.operations.find(op=>op.id===id);if(operation)return {record:structuredClone(record),operation:structuredClone(operation)};}
  }
  private result(record:SceneRecord,operation:StoredOperation):ScenarioMutationResult {return {instance:structuredClone(operation.resultInstance),operation:publicOperation(operation),actions:record.actions.filter(action=>operation.actionIds.includes(action.id)).map(action=>structuredClone(action))};}
  operation(id:string):ScenarioMutationResult {const found=this.findOperation(id);if(!found)throw sceneError('场景操作尚不存在。','NOT_FOUND',404);return this.result(found.record,found.operation);}
  private prior(id:string,input:string) {const found=this.findOperation(id);if(!found)return;if(found.operation.input!==input)throw sceneError('操作编号已用于不同内容。','ACTION_CONFLICT');return this.result(found.record,found.operation);}
  private writable(record:SceneRecord,revision:number) {
    if(record.instance.definitionHash!==scenarioDefinition.definitionHash)throw sceneError('场景定义已变化，旧轮仅可读，请创建新轮。','SCENARIO_DEFINITION_CHANGED');
    if(record.instance.status==='frozen')throw sceneError('旧轮已冻结，不能继续修改。','SCENARIO_FROZEN');
    if(record.instance.revision!==revision)throw sceneError('场景已更新，请刷新并核对。','REVISION_CONFLICT');
    if(record.operations.length>=1000)throw sceneError('本轮控制操作已达上限，请建立新轮。','SCENARIO_LIMIT');
  }
  private append(record:SceneRecord,kind:ScenarioOperation['kind'],id:string,input:string,actor:ScenarioActor,actionIds:string[]=[]):StoredOperation {
    const operation:StoredOperation={id,instanceId:record.instance.instanceId,kind,revision:record.instance.revision,businessNow:record.instance.businessNow,createdAt:now(),actor:structuredClone(actor),actionIds,input,resultInstance:structuredClone(record.instance)};record.operations.push(operation);return operation;
  }
  create(input:ScenarioCreateInput,actor:ScenarioActor):ScenarioMutationResult {
    const key=stable({kind:'create',input,actor}),prior=this.prior(input.clientActionId,key);if(prior)return prior;
    if(input.definitionId!==scenarioDefinition.id||input.version!==scenarioDefinition.version||!scenarioDefinition.modes.includes(input.mode)||input.businessDay!==undefined&&input.businessDay!==scenarioDefinition.businessDay)throw sceneError('场景定义、版本、模式或业务日期无效。','INVALID_ARGUMENT',400);
    const instanceId=`run-${randomUUID()}`,time=now(),world=sceneWorld(instanceId);
    const record:SceneRecord={schemaVersion:1,instance:{instanceId,definitionId:scenarioDefinition.id,definitionVersion:scenarioDefinition.version,definitionHash:scenarioDefinition.definitionHash,name:scenarioDefinition.name,mode:input.mode,status:'prepared',paused:false,revision:1,businessNow:scenarioDefinition.initialBusinessNow,stepIndex:0,stepCount:world.steps.length,createdAt:time,updatedAt:time},...world,changes:[],actions:[],operations:[]};
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
  preview(id:string):ScenarioPreview {
    const record=this.get(id),step=record.steps[record.instance.stepIndex];let reason:string|undefined;
    if(record.instance.status!=='active')reason=record.instance.status==='frozen'?'旧轮已冻结。':'请先初始化任务并激活本轮。';
    else if(record.instance.paused)reason='本轮已暂停，请继续后再投放。';
    else if(!step)reason='来源事件已投放完毕；这不表示业务任务完成。';
    else if(record.instance.mode==='main_story'&&record.instance.stepIndex>=5)reason='主故事已到待选择/批准方案节点；方案和执行能力属于后续阶段。';
    else if(record.actions.some(action=>action.sendState!=='accepted'))reason='请先发送并核对前一步的全部通知。';
    return {instance:record.instance,step:step?.summary??null,changes:step?[...step.objects.map(o=>`${o.name} 更新至修订${o.revision}`),...step.reports.map(r=>`新增报告：${r.title}`)]:[],notifications:step?step.notices.map((notice,index)=>({sourceMessageId:`${id}-${step.summary.id}-${index+1}`,title:notice.title,text:notice.text,subjectId:notice.reportId,occurredAt:notice.occurredAt})):[],canApply:reason===undefined,...(reason?{reason}:{})};
  }
  apply(id:string,stepId:string,operationId:string,revision:number,actor:ScenarioActor):ScenarioMutationResult {
    const input=stable({kind:'step',id,stepId,operationId,revision,actor}),prior=this.prior(operationId,input);if(prior)return prior;
    const record=this.get(id);this.writable(record,revision);const preview=this.preview(id);if(!preview.canApply)throw sceneError(preview.reason!);const step=record.steps[record.instance.stepIndex];if(step.summary.id!==stepId)throw sceneError('只能按顺序应用下一事件。');
    for(const object of step.objects){const index=record.objects.findIndex(o=>o.ref.objectId===object.ref.objectId);if(index<0||record.objects[index].revision!==object.revision-1)throw sceneError('本步对象前置修订不匹配。');const before=record.objects[index];record.objects[index]=structuredClone(object);record.changes.push({cursor:sceneChangeCursor(id,record.changes.length+1),effectiveAt:object.effectiveAt,before,after:structuredClone(object)});}
    record.reports.push(...structuredClone(step.reports));record.instance.businessNow=step.summary.businessTime;record.instance.stepIndex++;record.instance.revision++;record.instance.updatedAt=now();
    const actions:ScenarioAction[]=step.notices.map((notice,index)=>({id:randomUUID(),instanceId:id,stepId,actor:structuredClone(actor),systemId:notice.systemId,revision:record.instance.revision,createdAt:now(),sendState:'unsent',notification:preview.notifications[index]}));record.actions.push(...actions);
    const operation=this.append(record,'step',operationId,input,actor,actions.map(a=>a.id));this.save([record]);return this.result(record,operation);
  }
  control(id:string,action:'pause'|'resume',operationId:string,revision:number,actor:ScenarioActor):ScenarioMutationResult {
    const input=stable({kind:action,id,operationId,revision,actor}),prior=this.prior(operationId,input);if(prior)return prior;
    const record=this.get(id);this.writable(record,revision);if(record.instance.status!=='active')throw sceneError('只能暂停或继续活动轮次。');record.instance.paused=action==='pause';record.instance.revision++;record.instance.updatedAt=now();const operation=this.append(record,action,operationId,input,actor);this.save([record]);return this.result(record,operation);
  }
  action(id:string):{record:SceneRecord;action:ScenarioAction}|undefined {
    if(this.db){const row=this.db.prepare("SELECT i.body FROM scenario_instances i,json_each(i.body,'$.actions') a WHERE json_extract(a.value,'$.id')=? LIMIT 1").get(id);if(!row)return;const record=JSON.parse(String(row.body)) as SceneRecord;return {record,action:record.actions.find(a=>a.id===id)!};}
    for(const value of this.memory.values()){const record=structuredClone(value),action=record.actions.find(a=>a.id===id);if(action)return {record,action};}
  }
  delivery(id:string,state:ScenarioAction['sendState'],receipt?:SimulationReceipt,error?:string,actor?:ScenarioActor):ScenarioAction {
    const found=this.action(id);if(!found)throw sceneError('通知不存在。','NOT_FOUND',404);const action=found.action;action.sendState=state;if(receipt)action.receipt=receipt;if(error)action.error=error;else delete action.error;if(actor){action.deliveryActor=structuredClone(actor);action.deliveryAt=now();}this.save([found.record]);return structuredClone(action);
  }
}
