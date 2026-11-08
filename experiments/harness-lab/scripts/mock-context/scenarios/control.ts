import type { IncomingMessage } from 'node:http';
import { contextInteger, contextRecord, contextText, contextTimestamp } from '../../../src/context/validation.js';
import type { ScenarioAction, ScenarioActor, ScenarioCreateInput } from '../../../src/contracts/scenarios.js';
import type { SimulationReceipt } from '../../../src/contracts/simulation.js';
import type { NotificationTarget } from '../control-api.js';
import { scenarioDefinition, executionDefinition } from './data.js';
import { ScenarioStore, sceneError } from './store.js';

async function body(req:IncomingMessage){let text='',bytes=0;for await(const chunk of req){bytes+=Buffer.byteLength(chunk);if(bytes>16384)throw sceneError('控制请求过大。','INVALID_ARGUMENT',400);text+=chunk;}try{return JSON.parse(text||'{}') as unknown;}catch{throw sceneError('控制JSON无效。','INVALID_ARGUMENT',400);}}
function operationId(value:unknown){const id=contextText(value);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))throw sceneError('控制操作需要UUID。','INVALID_ARGUMENT',400);return id;}
function actor(value:unknown):ScenarioActor {const r=contextRecord(value,['userId','seatId'],['userId','seatId']);return {userId:contextText(r.userId),seatId:contextText(r.seatId)};}
async function receipt(target:NotificationTarget,action:ScenarioAction,method:'GET'|'POST'):Promise<SimulationReceipt> {
  const url=new URL(`/api/integrations/${encodeURIComponent(target.sourceId)}/events`,target.url);if(method==='GET')url.searchParams.set('sourceMessageId',action.notification.sourceMessageId);
  const response=await fetch(url,{method,headers:{Authorization:`Bearer ${target.token}`,...(method==='POST'?{'Content-Type':'application/json'}:{})},redirect:'error',signal:AbortSignal.timeout(5000),...(method==='POST'?{body:JSON.stringify({...action.notification,scenarioInstanceId:action.instanceId})}:{})});if(!response.ok)throw new Error('接收请求未成功');
  const reader=response.body?.getReader();if(!reader)throw new Error('回执为空');let text='',size=0;try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>16384)throw new Error('回执过大');text+=Buffer.from(part.value).toString('utf8');}}finally{await reader.cancel();}
  const r=contextRecord(JSON.parse(text),['eventId','sourceMessageId','receivedAt','status'],['eventId','sourceMessageId','receivedAt','status']);if(r.status!=='accepted'||r.sourceMessageId!==action.notification.sourceMessageId)throw new Error('回执不匹配');return {eventId:contextText(r.eventId),sourceMessageId:contextText(r.sourceMessageId),receivedAt:contextTimestamp(r.receivedAt),status:'accepted'};
}
export function scenarioControl(store:ScenarioStore,targets:NotificationTarget[]) {
  const running=new Map<string,Promise<ScenarioAction>>();
  async function deliver(id:string,send:boolean,sender?:ScenarioActor):Promise<ScenarioAction>{
    const found=store.action(id);if(!found)throw sceneError('场景通知不存在。','NOT_FOUND',404);const {action}=found;if(action.sendState==='accepted')return action;
    const target=targets.find(target=>target.systemId===action.systemId);if(!target)throw sceneError('未配置该来源的通知接入。','NOT_CONFIGURED',503);
    if(!send||action.sendState==='unconfirmed'){try{return store.delivery(id,'accepted',await receipt(target,action,'GET'));}catch{if(!send)return store.action(id)!.action;}}
    const current=store.action(id)!.record;if(current.instance.status!=='active'||current.instance.paused)throw sceneError('本轮未激活、已暂停或已冻结，不能新增投放。');
    store.delivery(id,'unconfirmed',undefined,'接收结果尚未确认，请核对回执。',sender);
    try{return store.delivery(id,'accepted',await receipt(target,action,'POST'));}catch{try{return store.delivery(id,'accepted',await receipt(target,action,'GET'));}catch{return store.delivery(id,'unconfirmed',undefined,'发送未确认，请先查询回执后重送同一通知。');}}
  }
  return async(req:IncomingMessage,url:URL):Promise<unknown>=>{
    const path=url.pathname;
    if(req.method==='GET'&&path==='/control/scenarios'){if(url.search)throw sceneError('场景列表不接受查询参数。','INVALID_ARGUMENT',400);return {items:[executionDefinition,scenarioDefinition]};}
    if(req.method==='GET'&&path==='/control/instances'){
      if([...url.searchParams.keys()].some(key=>!['cursor','limit'].includes(key)||url.searchParams.getAll(key).length!==1))throw sceneError('实例分页参数无效。','INVALID_ARGUMENT',400);
      const offset=url.searchParams.get('cursor')??'0',limit=url.searchParams.get('limit')??'20';if(!/^\d+$/.test(offset)||!/^\d+$/.test(limit))throw sceneError('实例分页参数无效。','INVALID_ARGUMENT',400);return store.list(contextInteger(Number(offset),0),contextInteger(Number(limit),1,20));
    }
    if(url.search)throw sceneError('此控制接口不接受查询参数。','INVALID_ARGUMENT',400);
    const operation=/^\/control\/operations\/([^/]+)$/.exec(path);if(operation&&req.method==='GET')return store.operation(operationId(operation[1]));
    const provenance=/^\/control\/instances\/([^/]+)\/provenance$/.exec(path);
    if(provenance&&req.method==='GET')return store.provenance(decodeURIComponent(provenance[1]));
    const notification=/^\/control\/instances\/([^/]+)\/notifications\/([^/]+)$/.exec(path);
    if(notification&&req.method==='GET')return store.notification(decodeURIComponent(notification[1]),decodeURIComponent(notification[2]));
    const action=/^\/control\/scenario-actions\/([^/]+)(\/send)?$/.exec(path);
    if(action){if(req.method!==(action[2]?'POST':'GET'))throw sceneError('控制方式无效。','INVALID_ARGUMENT',400);const found=store.action(operationId(action[1]));if(!found)throw sceneError('场景通知不存在。','NOT_FOUND',404);let sender:ScenarioActor|undefined;if(action[2]){const r=contextRecord(await body(req),['actor'],['actor']);sender=actor(r.actor);}if(!action[2]&&found.action.sendState!=='unconfirmed')return found.action;if(running.has(found.action.id))return running.get(found.action.id)!;const promise=deliver(found.action.id,Boolean(action[2]),sender).finally(()=>running.delete(found.action.id));running.set(found.action.id,promise);return promise;}
    if(req.method==='POST'&&path==='/control/instances'){
      const r=contextRecord(await body(req),['definitionId','version','mode','clientActionId','businessDay','actor'],['definitionId','version','mode','clientActionId','actor']);
      const input:ScenarioCreateInput={definitionId:contextText(r.definitionId),version:contextText(r.version),mode:contextText(r.mode) as ScenarioCreateInput['mode'],clientActionId:operationId(r.clientActionId),...(r.businessDay===undefined?{}:{businessDay:contextText(r.businessDay)})};return store.create(input,actor(r.actor));
    }
    const instance=/^\/control\/instances\/([^/]+)(?:\/(activate|preview|control|tasks|steps\/([^/]+)))?$/.exec(path);if(!instance)throw sceneError('场景控制接口不存在。','NOT_FOUND',404);
    const id=decodeURIComponent(instance[1]);if(!instance[2]&&req.method==='GET')return store.detail(id);if(instance[2]==='tasks'&&req.method==='GET'){const record=store.get(id);return {items:record.tasks,...(record.taskBootstrap?{taskBootstrap:record.taskBootstrap}:{})};}
    if(req.method!=='POST')throw sceneError('控制方式无效。','INVALID_ARGUMENT',400);
    if(instance[2]==='preview'){const r=contextRecord(await body(req),['expectedRevision']);if(r.expectedRevision!==undefined&&contextInteger(r.expectedRevision)!==store.get(id).instance.revision)throw sceneError('场景已变化，请刷新。','REVISION_CONFLICT');return store.preview(id);}
    const keys=['clientActionId','expectedRevision','actor',...(instance[2]==='activate'?['expectedActiveRevision','terminateUnsent']:instance[2]==='control'?['action']:[])],r=contextRecord(await body(req),keys,['clientActionId','expectedRevision','actor']);
    const op=operationId(r.clientActionId),revision=contextInteger(r.expectedRevision),who=actor(r.actor);
    if(instance[2]==='activate'){if(r.terminateUnsent!==undefined&&typeof r.terminateUnsent!=='boolean')throw sceneError('保留未发送记录标记无效。','INVALID_ARGUMENT',400);return store.activate(id,op,revision,contextInteger(r.expectedActiveRevision,0),r.terminateUnsent===true,who);}
    if(instance[2]==='control'){if(r.action!=='pause'&&r.action!=='resume')throw sceneError('控制动作无效。','INVALID_ARGUMENT',400);return store.control(id,r.action,op,revision,who);}
    if(instance[3])return store.apply(id,decodeURIComponent(instance[3]),op,revision,who);
    throw sceneError('场景控制接口不存在。','NOT_FOUND',404);
  };
}
