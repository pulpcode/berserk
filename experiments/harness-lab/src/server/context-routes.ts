import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PiLab } from '../pi/lab.js';
import type { BackgroundService } from '../background/service.js';
import type { MapConfig } from '../contracts/context.js';
import { RequestError } from '../contracts/errors.js';
import { readContextJson } from '../context/http.js';
import { contextRecord, contextRef } from '../context/validation.js';
import { identityOf } from './auth.js';
import type { apiScope } from './seat-scope.js';

async function readWithSignal<T>(request: FastifyRequest, reply: FastifyReply, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController(), abort = () => controller.abort();
  request.raw.once('aborted', abort); reply.raw.once('close', abort);
  try { return await work(controller.signal); }
  finally { request.raw.off('aborted', abort); reply.raw.off('close', abort); }
}
const empty = {type:'object',additionalProperties:false};
const osm: MapConfig = {providerId:'osm-standard',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,attributionText:'© OpenStreetMap contributors',attributionUrl:'https://www.openstreetmap.org/copyright'};
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
  app.get(`${scope.base}/context/map-config`,{schema:{querystring:empty}},request => {
    let simulationEnabled = false; try {simulation(request);simulationEnabled=true;} catch { /* Optional control capability. */ }
    return {...(lab.context?.config.map ?? osm),simulationEnabled};
  });
  for (const [path,tool] of [['situation','situation_query'],['reports/search','information_search']] as const) {
    app.post(`${scope.base}/context/${path}`,{schema:{querystring:empty}},async (request,reply) => readWithSignal(request,reply,signal=>context().query(tool, request.body,{kind:'seat',seatId:scope.seat(request)},signal)));
  }
  app.get<{Params:{systemId:string;reportId:string};Querystring:{revision?:string}}>(`${scope.base}/context/reports/:systemId/:reportId`,{schema:{querystring:{...empty,properties:{revision:{type:'string',pattern:'^[1-9][0-9]*$'}}}}},(request,reply) => readWithSignal(request,reply,signal=>context().query('information_read',{systemId:request.params.systemId,reportId:request.params.reportId,...(request.query.revision ? {revision:Number(request.query.revision)} : {})},{kind:'seat',seatId:scope.seat(request)},signal)));
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
  app.get<{Params:{id:string}}>(`${scope.base}/simulation/actions/:id`,{schema:{params:actionParams,querystring:empty}},request=>forward(request,`actions/${request.params.id}`));
  app.post<{Params:{id:string}}>(`${scope.base}/simulation/actions/:id/send`,{schema:{params:actionParams,querystring:empty,body:empty},preValidation:async request=>{request.body??={};}},request=>forward(request,`actions/${request.params.id}/send`,{}));
}
