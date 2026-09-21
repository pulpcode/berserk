import type { FastifyInstance } from 'fastify';
import type { PiLab } from '../pi/lab.js';
import type { TaskInput } from '../contracts/access.js';
import { identityOf } from './auth.js';
const text={type:'string',maxLength:8000};
const params={type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string',format:'uuid'}}};
export async function taskRoutes(app:FastifyInstance,lab:PiLab) {
  const access=lab.access; if(!access) return;
  app.get<{Querystring:{clientActionId?:string}}>('/api/tasks',{schema:{querystring:{type:'object',additionalProperties:false,properties:{clientActionId:{type:'string',format:'uuid'}}}}},async request=>request.query.clientActionId ? access.findCreation(identityOf(request),request.query.clientActionId) : access.list(identityOf(request).seatId));
  app.post<{Body:TaskInput}>('/api/tasks',{schema:{body:{type:'object',additionalProperties:false,required:['title','goal','visibility','clientActionId'],properties:{title:{...text,minLength:1,maxLength:60},goal:text,visibility:{enum:['public','private']},clientActionId:{type:'string',format:'uuid'}}}}},request=>access.create(identityOf(request),request.body));
  app.get<{Params:{id:string}}>('/api/tasks/:id',{schema:{params}},request=>access.get(request.params.id,identityOf(request).seatId));
  app.put<{Params:{id:string};Body:{title:string;goal:string;revision:number}}>('/api/tasks/:id',{schema:{params,body:{type:'object',additionalProperties:false,required:['title','goal','revision'],properties:{title:{...text,minLength:1,maxLength:60},goal:text,revision:{type:'integer',minimum:1}}}}},request=>access.update(identityOf(request),request.params.id,request.body.revision,{title:request.body.title,goal:request.body.goal}));
  for(const action of ['archive','reopen'] as const) app.post<{Params:{id:string};Body:{revision:number}}>(`/api/tasks/:id/${action}`,{schema:{params,body:{type:'object',additionalProperties:false,required:['revision'],properties:{revision:{type:'integer',minimum:1}}}}},request=>access.update(identityOf(request),request.params.id,request.body.revision,{state:action==='archive'?'archived':'active'},()=>lab.collaboration?.hasUnfinishedTask(request.params.id) ?? false));
  app.post<{Params:{id:string}}>('/api/tasks/:id/workspace',{schema:{params,body:{type:'object',additionalProperties:false}},preValidation:async request=>{request.body??={};}},async request=>{
    const actor=identityOf(request),task=access.get(request.params.id,actor.seatId,true);
    return lab.workspaces.ensureWorkspace(task.id,actor.seatId,task.title);
  });
}
