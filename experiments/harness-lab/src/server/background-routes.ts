import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { authenticateSource } from '../background/config.js';
import type { BackgroundService, IncomingInformation, InformationFilter } from '../background/service.js';
import { page } from '../background/service.js';
import type { BackgroundAnalysisInput, InformationRuleInput } from '../contracts/background.js';
import { RequestError } from '../contracts/errors.js';
import { identityOf } from './auth.js';
import { sendFile } from './file-response.js';

declare module 'fastify' { interface FastifyContextConfig { axonSource?: boolean } }
const uuid = {type:'string',format:'uuid'};
const id = {type:'string',pattern:'^[a-zA-Z0-9_-]{1,64}$'};
const text = {type:'string',maxLength:16000};
const empty = {type:'object',additionalProperties:false};
const body = (properties:Record<string,unknown>,required = Object.keys(properties)) => ({type:'object',additionalProperties:false,properties,required});
const params = (properties:Record<string,unknown> = {id:uuid}) => body(properties);
const actionBody = body({clientActionId:uuid});
const revisionBody = body({revision:{type:'integer',minimum:1}});
const listQuery = {type:'object',additionalProperties:false,properties:{sourceId:id,status:{type:'string',maxLength:30},search:{type:'string',maxLength:200},offset:{type:'string',pattern:'^\\d{1,8}$'},limit:{type:'string',pattern:'^\\d{1,3}$'}}};
interface Query {sourceId?:string;status?:string;search?:string;offset?:string;limit?:string;clientActionId?:string}
function filter(query:Query):InformationFilter {
  const offset = Number(query.offset ?? 0),limit = Number(query.limit ?? 25);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new RequestError('INVALID_INPUT','分页参数无效。');
  return {...query,offset,limit};
}
const ruleFields = {name:{type:'string',minLength:1,maxLength:100},sourceId:id,profileId:id,recipientSeatIds:{type:'array',minItems:1,maxItems:100,uniqueItems:true,items:id},publicTaskId:uuid,enabled:{type:'boolean'}};
const ruleRequired = ['name','sourceId','profileId','recipientSeatIds','enabled'];

export async function backgroundRoutes(app:FastifyInstance, background?:BackgroundService, env:NodeJS.ProcessEnv = process.env) {
  app.get('/api/information/access',request => background?.capabilities(identityOf(request)) ?? {enabled:false,sources:[],profiles:[],seats:[],canManageQueue:false,queue:{key:'queue',enabled:false,revision:1,updatedAt:new Date(0).toISOString()}});
  app.get<{Querystring:Query}>('/api/inbox',{schema:{querystring:listQuery}},request => background?.inbox(identityOf(request),filter(request.query)) ?? page([],filter(request.query)));
  if (!background) return;
  const sourceAuth = async (request:FastifyRequest) => {const sourceId = (request.params as {sourceId:string}).sourceId; authenticateSource(background.config,sourceId,request.headers.authorization,env);};
  const integration = {config:{axonSource:true},onRequest:sourceAuth};
  app.post<{Params:{sourceId:string};Body:{name:string;size:number}}>('/api/integrations/:sourceId/uploads',{...integration,schema:{params:params({sourceId:id}),querystring:empty,body:body({name:{type:'string',minLength:1,maxLength:240},size:{type:'integer',minimum:0,maximum:background.files.maxBytes}})}},async (request,reply) => {
    background.assertReceiving(request.params.sourceId); return reply.code(201).send(await background.files.create(request.params.sourceId,request.body.name,request.body.size));
  });
  app.get<{Params:{sourceId:string;uploadId:string}}>('/api/integrations/:sourceId/uploads/:uploadId',{...integration,schema:{params:params({sourceId:id,uploadId:uuid}),querystring:empty}},request => background.files.get(request.params.sourceId,request.params.uploadId));
  await app.register(async streaming => {
    streaming.addContentTypeParser('application/octet-stream',(_request,payload,done)=>done(null,payload));
    streaming.put<{Params:{sourceId:string;uploadId:string};Body:Readable}>('/api/integrations/:sourceId/uploads/:uploadId/content',{...integration,bodyLimit:background.files.maxBytes,schema:{params:params({sourceId:id,uploadId:uuid}),querystring:empty}},async request => {
      background.assertReceiving(request.params.sourceId);
      if (!(request.body instanceof Readable)) throw new RequestError('INVALID_CONTENT_TYPE','上传需要二进制字节流。',415);
      const controller = new AbortController(),aborted = () => controller.abort(); request.raw.once('aborted',aborted);
      try {return await background.files.receive(request.params.sourceId,request.params.uploadId,request.body,controller.signal);} finally {request.raw.off('aborted',aborted);}
    });
  });
  app.post<{Params:{sourceId:string};Body:IncomingInformation}>('/api/integrations/:sourceId/events',{...integration,schema:{params:params({sourceId:id}),querystring:empty,body:body({sourceMessageId:{type:'string',minLength:1,maxLength:200},title:{type:'string',minLength:1,maxLength:200},text,uploadIds:{type:'array',maxItems:background.files.maxAttachments,items:uuid},subjectId:{type:'string',minLength:1,maxLength:200},occurredAt:{type:'string',format:'date-time'}},['sourceMessageId','title','text'])}},async (request,reply) => reply.code(202).send(await background.accept(request.params.sourceId,request.body)));
  app.get<{Params:{sourceId:string};Querystring:{sourceMessageId:string}}>('/api/integrations/:sourceId/events',{...integration,schema:{params:params({sourceId:id}),querystring:body({sourceMessageId:{type:'string',minLength:1,maxLength:200}})}},request => background.findReceipt(request.params.sourceId,request.query.sourceMessageId));
  app.get<{Querystring:Query}>('/api/information/events',{schema:{querystring:listQuery}},request => background.events(identityOf(request),filter(request.query)));
  app.get<{Params:{id:string}}>('/api/information/events/:id',{schema:{params:params(),querystring:empty}},request => background.eventDetail(identityOf(request),request.params.id));
  app.post<{Params:{id:string};Body:{clientActionId:string}}>('/api/information/events/:id/process',{schema:{params:params(),querystring:empty,body:actionBody}},request => background.processEvent(identityOf(request),request.params.id,request.body.clientActionId));
  app.get<{Querystring:Query}>('/api/information/jobs',{schema:{querystring:listQuery}},request => background.jobs(identityOf(request),filter(request.query)));
  for (const area of ['information','background']) {
    app.get<{Params:{id:string}}>(`/api/${area}/jobs/:id`,{schema:{params:params(),querystring:empty}},request => background.jobDetail(identityOf(request),request.params.id,area === 'information'));
    app.post<{Params:{id:string};Body:{revision:number}}>(`/api/${area}/jobs/:id/cancel`,{schema:{params:params(),querystring:empty,body:revisionBody}},request => background.cancel(identityOf(request),request.params.id,request.body.revision));
  }
  app.post<{Params:{id:string};Body:{clientActionId:string}}>('/api/information/jobs/:id/reprocess',{schema:{params:params(),querystring:empty,body:actionBody}},request => background.reprocess(identityOf(request),request.params.id,request.body.clientActionId));
  app.get<{Querystring:Query}>('/api/information/deliveries',{schema:{querystring:listQuery}},request => {
    const actor=identityOf(request),q=filter(request.query);
    return page(background.store.listDeliveries().filter(delivery => background.store.effectivePermission(actor,delivery.sourceId) && (!q.sourceId || delivery.sourceId === q.sourceId) && (!q.status || delivery.status === q.status)),q);
  });
  app.post<{Params:{id:string};Body:{clientActionId:string}}>('/api/information/deliveries/:id/retry',{schema:{params:params(),querystring:empty,body:actionBody}},request => background.retryDelivery(identityOf(request),request.params.id,request.body.clientActionId));
  app.get<{Querystring:Query}>('/api/information/rules',{schema:{querystring:{...listQuery,properties:{...listQuery.properties,clientActionId:uuid}}}},request => background.rules(identityOf(request),{...filter(request.query),clientActionId:request.query.clientActionId}));
  app.get<{Params:{id:string}}>('/api/information/rules/:id',{schema:{params:params(),querystring:empty}},request => {const rule=background.store.getRule(request.params.id); background.permission(identityOf(request),rule.sourceId); return rule;});
  app.post<{Body:InformationRuleInput & {clientActionId:string}}>('/api/information/rules',{schema:{querystring:empty,body:body({...ruleFields,clientActionId:uuid},[...ruleRequired,'clientActionId'])}},request => {const {clientActionId,...input}=request.body; return background.saveRule(identityOf(request),input,{clientActionId});});
  app.put<{Params:{id:string};Body:InformationRuleInput & {revision:number}}>('/api/information/rules/:id',{schema:{params:params(),querystring:empty,body:body({...ruleFields,revision:{type:'integer',minimum:1}},[...ruleRequired,'revision'])}},request => {const {revision,...input}=request.body; return background.saveRule(identityOf(request),input,{id:request.params.id,revision});});
  app.get('/api/information/sources',request => background.capabilities(identityOf(request)).sources);
  app.put<{Params:{id:string};Body:{accepting:boolean;revision:number}}>('/api/information/sources/:id',{schema:{params:params({id}),querystring:empty,body:body({accepting:{type:'boolean'},revision:{type:'integer',minimum:0}})}},request => background.control(identityOf(request),`source:${request.params.id}`,request.body.accepting,request.body.revision));
  app.get('/api/information/queue',request => background.capabilities(identityOf(request)).queue);
  app.put<{Body:{enabled:boolean;revision:number}}>('/api/information/queue',{schema:{querystring:empty,body:body({enabled:{type:'boolean'},revision:{type:'integer',minimum:0}})}},request => background.control(identityOf(request),'queue',request.body.enabled,request.body.revision));
  app.get<{Params:{id:string}}>('/api/inbox/:id',{schema:{params:params(),querystring:empty}},request => background.inboxDetail(identityOf(request),request.params.id));
  for (const [prefix,scope] of [['information/events','event'],['inbox','inbox']] as const) app.get<{Params:{id:string;fileId:string}}>(`/api/${prefix}/:id/files/:fileId`,{schema:{params:params({id:uuid,fileId:uuid}),querystring:empty}},async (request,reply) => sendFile(reply,await background.openFile(identityOf(request),scope,request.params.id,request.params.fileId)));
  app.post<{Params:{id:string};Body:{taskSpaceId:string}}>('/api/inbox/:id/analysis-options',{schema:{params:params(),querystring:empty,body:body({taskSpaceId:uuid})}},request => background.analysisOptions(identityOf(request),request.params.id,request.body.taskSpaceId));
  app.get<{Params:{id:string};Querystring:{clientActionId:string}}>('/api/inbox/:id/analyses',{schema:{params:params(),querystring:body({clientActionId:uuid})}},request => background.findAnalysis(identityOf(request),request.params.id,request.query.clientActionId));
  app.post<{Params:{id:string};Body:BackgroundAnalysisInput}>('/api/inbox/:id/analyses',{schema:{params:params(),querystring:empty,body:body({clientActionId:uuid,taskSpaceId:uuid,goal:{...text,minLength:1},mode:{enum:['conversation','background']},includeResult:{type:'boolean'},fileIds:{type:'array',maxItems:background.files.maxAttachments,uniqueItems:true,items:uuid},skillIds:{type:'array',maxItems:1,items:id},agentIds:{type:'array',maxItems:1,items:id}},['clientActionId','taskSpaceId','goal','mode','includeResult','fileIds'])}},request => background.analyse(identityOf(request),request.params.id,request.body));
}
