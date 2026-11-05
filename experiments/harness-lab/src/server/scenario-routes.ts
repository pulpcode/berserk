import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PiLab } from '../pi/lab.js';
import type { BackgroundService } from '../background/service.js';
import type { ScenarioActor, ScenarioMutationResult } from '../contracts/scenarios.js';
import { isScenarioClock, SCENARIO_MODES } from '../contracts/scenarios.js';
import { RequestError } from '../contracts/errors.js';
import { contextInteger, contextRecord, contextText, contextTimestamp } from '../context/validation.js';
import { readContextJson } from '../context/http.js';
import { Mutex } from '../resources/files.js';
import { identityOf } from './auth.js';
import type { apiScope } from './seat-scope.js';
import { ScenarioTasks, scenarioId, scenarioTaskDefinitions } from './scenario-tasks.js';

const conflict=(message:string)=>new RequestError('SCENARIO_HOST_CONFLICT',message,409);
const empty={type:'object',additionalProperties:false};
const operationId=(value:unknown)=>{const text=contextText(value,36);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text))throw conflict('请使用稳定的UUID操作编号。');return text;};
export function scenarioDirector(lab:PiLab,background:BackgroundService|undefined,request:FastifyRequest) {
  const presented=identityOf(request),actor=lab.access?.identity(presented.userId),config=lab.context?.config.simulation;
  if(!actor||!actor.controlScenarios||!config?.directorSeatId||actor.seatId!==config.directorSeatId)throw new RequestError('FORBIDDEN','当前账号无权访问场景导演台。',403);
  if(request.authValid&&!request.authValid())throw new RequestError('AUTH_REQUIRED','请重新登录后继续。',401);
  if(!config.enabled||!background||!lab.context)throw new RequestError('SIMULATION_DISABLED','场景控制未启用。',404);
  const visible=lab.context.catalog(actor.seatId).systems.map(s=>s.id);
  for(const source of config.sources){
    background.permission(actor,source.sourceId);
    if(!visible.includes(source.systemId)||background.config.sources.find(s=>s.sourceId===source.sourceId)?.systemId!==source.systemId)throw new RequestError('CONTEXT_FORBIDDEN','导演席缺少场景来源读取范围。',403);
  }
  return {actor,config};
}

/** Authenticated proxy only; the browser never selects a source URL, credential or actor. */
export async function scenarioRoutes(app:FastifyInstance,lab:PiLab,scope:ReturnType<typeof apiScope>,background:BackgroundService|undefined,env:NodeJS.ProcessEnv) {
  const simulation=lab.context?.config.simulation;
  if(!lab.access||!simulation?.enabled||!simulation.directorSeatId)return;
  const tasks=new ScenarioTasks(lab.config.dataDir,lab.access);await tasks.prepare();
  const mutex=new Mutex(),base=`${scope.base}/simulation`;
  const call=async(request:FastifyRequest,path:string,body?:Record<string,unknown>,includeActor=true)=>{
    const {actor,config}=scenarioDirector(lab,background,request),token=env[config.tokenEnv];
    if(!token)throw new RequestError('SIMULATION_UNAVAILABLE','场景控制凭证未配置。',503);
    const by:ScenarioActor={userId:actor.userId,seatId:actor.seatId};
    return readContextJson(new URL(`${config.baseUrl}/control/${path}`),token,undefined,{maxBytes:2*1024*1024,method:body===undefined?'GET':'POST',...(body===undefined?{}:{body:includeActor?{...body,actor:by}:body})});
  };
  const status=async(request:FastifyRequest,id:string)=>{
    const raw=await call(request,`instances/${scenarioId(id)}`),r=contextRecord(raw,['instance','steps','objects','reports','actions','operations','taskDefinitions'],['instance','actions']);
    if(!r.instance||typeof r.instance!=='object')throw conflict('来源场景状态无效。');
    const i=r.instance as Record<string,unknown>,clock={instanceId:i.instanceId,businessNow:i.businessNow,revision:i.revision};
    if(!isScenarioClock(clock)||clock.instanceId!==id||typeof i.paused!=='boolean'||!['prepared','active','frozen'].includes(String(i.status))||!Array.isArray(r.actions))throw conflict('来源场景状态无效。');
    const sendStates=r.actions.map(action=>{if(!action||typeof action!=='object'||!('sendState' in action)||!['unsent','unconfirmed','accepted'].includes(String(action.sendState)))throw conflict('通知回执状态无效。');return String(action.sendState);});
    return {clock,paused:i.paused,status:String(i.status),sendStates,definitionId:contextText(i.definitionId,64),definitionVersion:contextText(i.definitionVersion,64),definitionHash:contextText(i.definitionHash,128)};
  };
  const checkTaskManagement=(request:FastifyRequest)=>{const {actor}=scenarioDirector(lab,background,request);if(!actor.createPublicTask)throw new RequestError('FORBIDDEN','演示任务准备还需要工作任务管理权限。',403);return actor;};
  const mutation=(body:unknown,extra:string[]=[]):Record<string,unknown>&{clientActionId:string;expectedRevision:number}=>{
    const r=contextRecord(body,['clientActionId','expectedRevision',...extra],['clientActionId','expectedRevision']);
    return {...r,clientActionId:operationId(r.clientActionId),expectedRevision:contextInteger(r.expectedRevision)};
  };
  const reconcile=async(request:FastifyRequest,id:string)=>{
    const raw=await call(request,`operations/${operationId(id)}`),receipt=await tasks.activation();
    if(receipt?.state==='pending'&&receipt.operationId===id){
      const r=contextRecord(raw,['instance','operation','actions'],['instance','operation','actions']);
      if(!r.instance||typeof r.instance!=='object'||!r.operation||typeof r.operation!=='object')throw conflict('激活操作回执无效。');
      const instance=r.instance as Record<string,unknown>,op=r.operation as Record<string,unknown>;
      if(instance.instanceId!==receipt.instanceId||op.id!==id||op.kind!=='activate')throw conflict('激活回执与原操作不一致。');
      await tasks.saveActivation({...receipt,state:'complete'});
    }
    return raw;
  };

  app.get(`${base}/scenarios`,{schema:{querystring:empty}},request=>call(request,'scenarios'));
  app.get<{Querystring:{cursor?:string;limit?:number}}>(`${base}/instances`,{schema:{querystring:{...empty,properties:{cursor:{type:'string',pattern:'^[0-9]+$'},limit:{type:'integer',minimum:1,maximum:20}}}}},request=>{
    const q=new URLSearchParams();if(request.query.cursor!==undefined)q.set('cursor',request.query.cursor);if(request.query.limit!==undefined)q.set('limit',String(request.query.limit));return call(request,`instances${q.size?`?${q}`:''}`);
  });
  const params={type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string',pattern:'^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$'}}};
  app.get<{Params:{id:string}}>(`${base}/instances/:id`,{schema:{params,querystring:empty}},request=>call(request,`instances/${scenarioId(request.params.id)}`));
  app.get<{Params:{id:string}}>(`${base}/operations/:id`,{schema:{params,querystring:empty}},request=>mutex.run(()=>{scenarioDirector(lab,background,request);return reconcile(request,request.params.id);}));
  app.post(`${base}/instances`,{schema:{querystring:empty}},request=>mutex.run(async()=>{
    scenarioDirector(lab,background,request);await tasks.assertSettled();
    const r=contextRecord(request.body,['definitionId','version','mode','clientActionId','businessDay'],['definitionId','version','mode','clientActionId']);
    if(!SCENARIO_MODES.includes(r.mode as typeof SCENARIO_MODES[number]))throw conflict('场景模式无效。');
    if(r.businessDay!==undefined)contextTimestamp(`${contextText(r.businessDay,10)}T00:00:00+08:00`);
    return call(request,'instances',{...r,definitionId:contextText(r.definitionId,64),version:contextText(r.version,64),clientActionId:operationId(r.clientActionId)});
  }));
  app.get<{Params:{id:string}}>(`${base}/instances/:id/initialize`,{schema:{params,querystring:empty}},async request=>{
    const {actor}=scenarioDirector(lab,background,request);await status(request,request.params.id);return tasks.read(actor,request.params.id);
  });
  app.post<{Params:{id:string}}>(`${base}/instances/:id/initialize`,{schema:{params,querystring:empty}},request=>mutex.run(async()=>{
    const actor=checkTaskManagement(request);await tasks.assertSettled();
    const r=contextRecord(request.body,['clientActionId'],['clientActionId']),id=scenarioId(request.params.id);
    const state=await status(request,id);if(state.status==='frozen')throw conflict('旧轮已经冻结，不能初始化任务。');
    const definitionResponse=contextRecord(await call(request,`instances/${id}/tasks`),['items'],['items']);
    const definitions=scenarioTaskDefinitions(definitionResponse.items);
    return tasks.initialize(actor,id,operationId(r.clientActionId),definitions,()=>{checkTaskManagement(request);});
  }));
  app.post<{Params:{id:string}}>(`${base}/instances/:id/activate`,{schema:{params,querystring:empty}},request=>mutex.run(async()=>{
    const {actor}=scenarioDirector(lab,background,request),id=scenarioId(request.params.id),input=mutation(request.body,['expectedActiveRevision','terminateUnsent']);
    const activeRevision=contextInteger(input.expectedActiveRevision,0);if(input.terminateUnsent!==undefined&&typeof input.terminateUnsent!=='boolean')throw conflict('终止未发送通知的决定无效。');
    const hash=JSON.stringify([id,actor.userId,input.expectedRevision,activeRevision,input.terminateUnsent??false]);
    try{
      await tasks.assertSettled(input.clientActionId);let receipt=await tasks.activation();
      if(receipt?.operationId===input.clientActionId){
        if(receipt.inputHash!==hash||receipt.userId!==actor.userId)throw conflict('相同激活编号的内容或操作者已变化。');
        try{return await reconcile(request,input.clientActionId);}catch(error){if(!(error instanceof RequestError&&error.code==='CONTEXT_NOT_FOUND'))throw error;}
      }
      await tasks.requireReady(actor,id);
      // Reject known source conflicts before persisting a pending receipt or archiving old tasks.
      const next=await status(request,id);
      if(next.status!=='prepared'||next.clock.revision!==input.expectedRevision)throw conflict('新轮状态或修订已变化，请刷新后核对。');
      const definitions=contextRecord(await call(request,'scenarios'),['items'],['items']);
      if(!Array.isArray(definitions.items)||!definitions.items.some(item=>{
        if(!item||typeof item!=='object'||Array.isArray(item))return false;
        const definition=item as Record<string,unknown>;
        return definition.id===next.definitionId&&definition.version===next.definitionVersion&&definition.definitionHash===next.definitionHash;
      }))throw conflict('场景定义已变化，旧轮仅可读，请创建新轮。');
      const raw=await call(request,'instances'),list=contextRecord(raw,['items','activeInstanceId','activeRevision','hasMore','nextCursor'],['items','activeInstanceId','activeRevision']);
      const previous=list.activeInstanceId===null?null:scenarioId(list.activeInstanceId);
      if(list.activeRevision!==activeRevision)throw conflict('活动轮次已变化，请刷新后核对。');
      if(previous&&previous!==id){
        const old=await status(request,previous);
        if(!old.paused||old.sendStates.includes('unconfirmed')||old.sendStates.includes('unsent')&&input.terminateUnsent!==true)throw conflict('请先暂停旧轮并核清通知；未发送通知需明确选择终止旧轮。');
        if(background?.store.listJobs().some(job=>['queued','running'].includes(job.status)))throw conflict('后台仍有作业，请结束后再切换轮次。');
        checkTaskManagement(request);
      }
      receipt={operationId:input.clientActionId,instanceId:id,previousInstanceId:previous,userId:actor.userId,inputHash:hash,state:'pending'};
      await tasks.saveActivation(receipt);
      if(previous&&previous!==id)await tasks.archive(actor,previous,taskId=>(lab.collaboration?.hasUnfinishedTask(taskId)??false)||(background?.store.hasTaskReservations(taskId)??false),()=>{checkTaskManagement(request);});
      const result=await call(request,`instances/${id}/activate`,{...input,expectedActiveRevision:activeRevision}) as ScenarioMutationResult;
      if(result.instance?.instanceId!==id||result.operation?.id!==input.clientActionId||result.operation.kind!=='activate')throw conflict('激活回执与请求不一致，请核对原操作。');
      await tasks.saveActivation({...receipt,state:'complete'});return result;
    }catch(error){
      if(error instanceof RequestError&&[401,403].includes(error.statusCode))throw error;
      scenarioDirector(lab,background,request);
      const pending=await tasks.activation();
      if(pending?.state==='pending'&&pending.operationId===input.clientActionId&&pending.instanceId===id&&pending.userId===actor.userId&&pending.inputHash===hash){
        throw new RequestError('SCENARIO_ACTIVATION_PENDING',`激活操作 ${input.clientActionId} 尚待核对。请保留原请求，先查询回执，再继续同一请求；已完成的归档不会自动撤销。${error instanceof RequestError?error.message:''}`,409);
      }
      throw error;
    }
  }));
  app.post<{Params:{id:string}}>(`${base}/instances/:id/preview`,{schema:{params,querystring:empty}},request=>{
    const input=contextRecord(request.body??{},['expectedRevision']);if(input.expectedRevision!==undefined)contextInteger(input.expectedRevision);return call(request,`instances/${scenarioId(request.params.id)}/preview`,input,false);
  });
  app.post<{Params:{id:string;stepId:string}}>(`${base}/instances/:id/steps/:stepId`,{schema:{params:{...params,required:['id','stepId'],properties:{...params.properties,stepId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,64}$'}}},querystring:empty}},request=>mutex.run(async()=>{
    scenarioDirector(lab,background,request);await tasks.assertSettled();return call(request,`instances/${scenarioId(request.params.id)}/steps/${scenarioId(request.params.stepId)}`,mutation(request.body));
  }));
  app.post<{Params:{id:string}}>(`${base}/instances/:id/control`,{schema:{params,querystring:empty}},request=>mutex.run(async()=>{
    scenarioDirector(lab,background,request);await tasks.assertSettled();const input=mutation(request.body,['action']);if(!['pause','resume'].includes(String(input.action)))throw conflict('场景控制动作无效。');return call(request,`instances/${scenarioId(request.params.id)}/control`,input);
  }));
  return {
    allowed(request:FastifyRequest){try{scenarioDirector(lab,background,request);return true;}catch{return false;}},
    action(request:FastifyRequest,id:string,send=false){return mutex.run(async()=>{scenarioDirector(lab,background,request);if(send)await tasks.assertSettled();return call(request,`scenario-actions/${operationId(id)}${send?'/send':''}`,send?{}:undefined);});},
  };
}
