import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PiLab } from '../pi/lab.js';
import type { BackgroundService } from '../background/service.js';
import { defaultMapConfig, normalizeMapConfig } from '../contracts/map.js';
import { RequestError } from '../contracts/errors.js';
import { readContextJson } from '../context/http.js';
import { contextRecord, contextRef } from '../context/validation.js';
import { identityOf } from './auth.js';
import type { apiScope } from './seat-scope.js';
import { scenarioRoutes } from './scenario-routes.js';

async function readWithSignal<T>(request: FastifyRequest, reply: FastifyReply, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController(), abort = () => controller.abort();
  request.raw.once('aborted', abort); reply.raw.once('close', abort);
  try { return await work(controller.signal); }
  finally { request.raw.off('aborted', abort); reply.raw.off('close', abort); }
}
const empty = {type:'object',additionalProperties:false};
export async function contextRoutes(app: FastifyInstance, lab: PiLab, scope: ReturnType<typeof apiScope>, background?: BackgroundService, env: NodeJS.ProcessEnv = process.env) {
  const context = () => { if (!lab.context) throw new RequestError('CONTEXT_UNAVAILABLE','业务资料查询不可用。',503); return lab.context; };
  const simulation = (request: FastifyRequest) => {
    const config = context().config.simulation;
    if (!config?.enabled || !background || !lab.access) throw new RequestError('SIMULATION_DISABLED','模拟控制未启用。',404);
    const actor = identityOf(request), visible = context().catalog(actor.seatId).systems.map(system => system.id);
    for (const source of config.sources) {
      background.permission(actor, source.sourceId, true);
      if (!visible.includes(source.systemId) || background.config.sources.find(item => item.sourceId === source.sourceId)?.systemId !== source.systemId) throw new RequestError('CONTEXT_FORBIDDEN','无权管理全部模拟来源。',403);
    }
    return config;
  };
  const scenarios=await scenarioRoutes(app,lab,scope,background,env);
  const queryScope={...empty,properties:{taskId:{type:'string',format:'uuid'}}};
  const queryPrincipal=(request:FastifyRequest)=>{
    const seatId=scope.seat(request),taskId=(request.query as {taskId?:string}).taskId;
    if(!taskId)return {kind:'seat' as const,seatId};
    if(!lab.access)throw new RequestError('TASK_NOT_FOUND','任务不存在或无权查看。',404);
    const task=lab.access.get(taskId,seatId);
    return {kind:'seat' as const,seatId,scenarioInstanceId:task.scenarioInstanceId};
  };
  const readQuery=(request:FastifyRequest,signal:AbortSignal,tool:'situation_query'|'information_search'|'information_read',input:unknown)=>{
    const principal:{kind:'seat';seatId:string;scenarioInstanceId?:string;readId?:string}=queryPrincipal(request);
    const readId=request.headers['x-axon-read-id'];
    if(readId!==undefined){if(typeof readId!=='string'||! /^[0-9a-f-]{36}$/.test(readId))throw new RequestError('INVALID_INPUT','读取编号无效。',400);principal.readId=readId;}
    // Global current browsing creates no association. An explicit parent must have its own proven scope.
    const readOnly=!(request.query as {taskId?:string}).taskId || principal.scenarioInstanceId!==undefined;
    return context().query(tool,input,principal,signal,readOnly,request.headers['x-axon-map-display']==='1');
  };
  app.get(`${scope.base}/context/map-config`,{schema:{querystring:empty}},request => {
    let simulationEnabled = false; try {simulation(request);simulationEnabled=true;} catch { /* Optional control capability. */ }
    return {...normalizeMapConfig(lab.context?.config.map ?? defaultMapConfig),simulationEnabled,scenarioControlEnabled:scenarios?.allowed(request)??false,...(lab.context?.config.simulation?.directorSeatId?{directorSeatId:lab.context.config.simulation.directorSeatId}:{})};
  });
  for (const [path,tool] of [['situation','situation_query'],['reports/search','information_search']] as const) {
    app.post(`${scope.base}/context/${path}`,{schema:{querystring:queryScope}},async (request,reply) => readWithSignal(request,reply,signal=>readQuery(request,signal,tool,request.body)));
  }
  app.get<{Params:{systemId:string;reportId:string};Querystring:{revision?:string;taskId?:string}}>(`${scope.base}/context/reports/:systemId/:reportId`,{schema:{querystring:{...empty,properties:{...queryScope.properties,revision:{type:'string',pattern:'^[1-9][0-9]*$'}}}}},(request,reply) => readWithSignal(request,reply,signal=>readQuery(request,signal,'information_read',{systemId:request.params.systemId,reportId:request.params.reportId,...(request.query.revision ? {revision:Number(request.query.revision)} : {})})));
  const forward = async (request: FastifyRequest, path: string, body?: unknown) => {
    const config = simulation(request);
    const token = env[config.tokenEnv]; if (!token) throw new RequestError('SIMULATION_UNAVAILABLE','模拟控制凭证未配置。',503);
    return readContextJson(new URL(`${config.baseUrl}/control/${path}`),token,undefined,{method:body === undefined ? 'GET' : 'POST',body,...(path === 'state' ? {maxBytes:2 * 1024 * 1024} : {})});
  };
  app.get(`${scope.base}/simulation`,{schema:{querystring:empty}},request => forward(request,'state'));
  app.post(`${scope.base}/simulation/object-updates`,{schema:{querystring:empty}},request => {
    const config=simulation(request),body=contextRecord(request.body,['clientActionId','ref','expectedRevision','properties','effectiveAt','validTime'],['clientActionId','ref','expectedRevision','properties','effectiveAt','validTime']);
    const ref=contextRef(body.ref); if (!config.sources.some(source=>source.systemId===ref.systemId)) throw new RequestError('CONTEXT_FORBIDDEN','对象来源不在模拟范围内。',403);
    return forward(request,'object-updates',body);
  });
  app.post(`${scope.base}/simulation/report-updates`,{schema:{querystring:empty}},request => forward(request,'report-updates',contextRecord(request.body,['clientActionId','reportId','expectedRevision','report'],['clientActionId','reportId','expectedRevision','report'])));
  const actionParams=scope.params({id:{type:'string',format:'uuid'}});
  const action=async(request:FastifyRequest,id:string,send=false)=>{
    if(scenarios?.allowed(request)){
      try{return await scenarios.action(request,id,send);}catch(error){if(!(error instanceof RequestError&&error.code==='CONTEXT_NOT_FOUND'))throw error;}
    }
    return forward(request,`actions/${id}${send?'/send':''}`,send?{}:undefined);
  };
  app.get<{Params:{id:string}}>(`${scope.base}/simulation/actions/:id`,{schema:{params:actionParams,querystring:empty}},request=>action(request,request.params.id));
  app.post<{Params:{id:string}}>(`${scope.base}/simulation/actions/:id/send`,{schema:{params:actionParams,querystring:empty,body:empty},preValidation:async request=>{request.body??={};}},request=>action(request,request.params.id,true));
}
