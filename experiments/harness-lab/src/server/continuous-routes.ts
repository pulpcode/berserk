import { sendFile } from './file-response.js';
import type { FastifyInstance } from 'fastify';
import type { BackgroundService } from '../background/service.js';
import type { ContinuousStreamInput } from '../contracts/continuous.js';
import type { BackgroundAnalysisInput } from '../contracts/background.js';
import { identityOf } from './auth.js';
import { RequestError } from '../contracts/errors.js';

const uuid={type:'string',format:'uuid'},id={type:'string',pattern:'^[a-zA-Z0-9_-]{1,64}$'};
const body=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const fields={name:{type:'string',minLength:1,maxLength:100},sourceIds:{type:'array',minItems:1,maxItems:100,uniqueItems:true,items:id},profileId:id,recipientSeatIds:{type:'array',minItems:1,maxItems:100,uniqueItems:true,items:id},enabled:{type:'boolean'},quietMs:{type:'integer',minimum:0,maximum:60000},maxWaitMs:{type:'integer',minimum:1,maximum:300000}};
const required=['name','sourceIds','profileId','recipientSeatIds','enabled'];
export async function continuousRoutes(app:FastifyInstance,background?:BackgroundService){
  app.get('/api/continuous/access',request=>background?.continuous.access(identityOf(request))??{enabled:false,canRead:false,canManage:false});
  if(!background)return;const service=background.continuous;
  app.get<{Querystring:{clientActionId?:string}}>('/api/continuous/streams',{schema:{querystring:body({clientActionId:uuid},[])}},request=>{
    const actor=identityOf(request),result=service.streams(actor);if(!request.query.clientActionId)return result;
    const row=service.store.db.prepare('SELECT data FROM continuous_actions WHERE user_id=? AND action_id=?').get(actor.userId,request.query.clientActionId);if(!row)return {items:[]};const saved=JSON.parse(String(row.data)) as {epochId?:string};if(!saved.epochId)return {items:[]};const original=service.store.stream(saved.epochId);service.manage(actor,original);return {items:[service.publicStream(original)]};
  });
  app.post<{Body:ContinuousStreamInput&{clientActionId:string}}>('/api/continuous/streams',{schema:{body:body({...fields,clientActionId:uuid},[...required,'clientActionId'])}},request=>{const {clientActionId,...input}=request.body;return service.configure(identityOf(request),input,{clientActionId}).then(s=>service.publicStream(s));});
  app.put<{Params:{id:string};Body:ContinuousStreamInput&{revision:number}}>('/api/continuous/streams/:id',{schema:{params:body({id:uuid}),body:body({...fields,revision:{type:'integer',minimum:1}},[...required,'revision'])}},request=>{const {revision,...input}=request.body;return service.configure(identityOf(request),input,{id:request.params.id,revision}).then(s=>service.publicStream(s));});
  app.post<{Params:{id:string};Body:{revision:number;action:'pause'|'resume';clientActionId:string}}>('/api/continuous/streams/:id/control',{schema:{params:body({id:uuid}),body:body({revision:{type:'integer',minimum:1},action:{enum:['pause','resume']},clientActionId:uuid})}},request=>service.publicStream(service.control(identityOf(request),request.params.id,request.body)));
  app.get<{Querystring:{taskId?:string;epochId?:string;offset?:string;limit?:string}}>('/api/continuous/rounds',{schema:{querystring:body({taskId:uuid,epochId:uuid,offset:{type:'string',pattern:'^\\d{1,8}$'},limit:{type:'string',pattern:'^\\d{1,3}$'}},[])}},request=>service.rounds(identityOf(request),{...request.query,offset:Number(request.query.offset??0),limit:Number(request.query.limit??25)}));
  app.get<{Params:{jobId:string}}>('/api/continuous/rounds/:jobId',{schema:{params:body({jobId:uuid})}},request=>service.detail(identityOf(request),request.params.jobId));
  app.get<{Params:{jobId:string;fileId:string}}>('/api/continuous/rounds/:jobId/files/:fileId',{schema:{params:body({jobId:uuid,fileId:uuid})}},async(request,reply)=>sendFile(reply,await service.openFile(identityOf(request),request.params.jobId,request.params.fileId)));
  app.get<{Params:{taskId:string}}>('/api/tasks/:taskId/continuous',{schema:{params:body({taskId:uuid})}},request=>service.current(identityOf(request),request.params.taskId));
  app.post<{Params:{jobId:string};Body:{taskSpaceId:string}}>('/api/continuous/rounds/:jobId/analysis-options',{schema:{params:body({jobId:uuid}),body:body({taskSpaceId:uuid})}},request=>service.analysisOptions(identityOf(request),request.params.jobId,request.body.taskSpaceId));
  app.post<{Params:{jobId:string};Body:BackgroundAnalysisInput}>('/api/continuous/rounds/:jobId/analyses',{schema:{params:body({jobId:uuid}),body:body({clientActionId:uuid,taskSpaceId:uuid,goal:{type:'string',minLength:1,maxLength:16000},mode:{enum:['conversation']},includeResult:{type:'boolean'},fileIds:{type:'array',maxItems:0,items:uuid},skillIds:{type:'array',maxItems:1,items:id},agentIds:{type:'array',maxItems:1,items:id}},['clientActionId','taskSpaceId','goal','mode','includeResult','fileIds'])}},request=>service.analyse(identityOf(request),request.params.jobId,request.body));
  app.get<{Params:{jobId:string};Querystring:{clientActionId:string}}>('/api/continuous/rounds/:jobId/analyses',{schema:{params:body({jobId:uuid}),querystring:body({clientActionId:uuid})}},request=>{if(!request.query.clientActionId)throw new RequestError('INVALID_INPUT','缺少操作标识。');return service.findAnalysis(identityOf(request),request.params.jobId,request.query.clientActionId);});
}
