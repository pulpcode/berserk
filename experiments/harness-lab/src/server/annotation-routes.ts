import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AnnotationService, AnnotationActor } from '../annotations/service.js';
import * as validate from '../annotations/validation.js';
import type { AnnotationAction, AnnotationBaseInput, AnnotationCurrentInput, AnnotationReadInput } from '../contracts/annotations.js';
import { identityOf } from './auth.js';
import type { apiScope } from './seat-scope.js';

const empty={type:'object',additionalProperties:false};
const pagination={...empty,properties:{offset:{type:'string',pattern:'^[0-9]+$'},limit:{type:'string',pattern:'^[1-9][0-9]*$'}}};
const uuid={type:'string',format:'uuid'};
const bounds=(query: {offset?:string;limit?:string})=>validate.page(query.offset===undefined ? 0 : Number(query.offset),query.limit===undefined ? 50 : Number(query.limit));
export async function annotationRoutes(app: FastifyInstance,service: AnnotationService,scope: ReturnType<typeof apiScope>,actorOf?: (request: FastifyRequest)=>AnnotationActor) {
  const actor=(request: FastifyRequest)=>actorOf?.(request) ?? (service.access ? identityOf(request) : service.actorForSeat(scope.seat(request)));
  const params=scope.params({id:uuid}), base=scope.base;
  app.get<{Params:{id:string};Querystring:{offset?:string;limit?:string}}>(`${base}/tasks/:id/annotations`,{schema:{params,querystring:pagination}},request=>{const p=bounds(request.query);return service.list(actor(request),request.params.id,p.offset,p.limit);});
  app.get<{Params:{id:string}}>(`${base}/tasks/:id/annotations/current`,{schema:{params,querystring:empty}},request=>service.current(actor(request),request.params.id));
  app.get<{Params:{id:string};Querystring:{offset?:string;limit?:string}}>(`${base}/tasks/:id/annotations/history`,{schema:{params,querystring:pagination}},request=>{const p=bounds(request.query);return service.history(actor(request),request.params.id,p.offset,p.limit);});
  app.get<{Params:{id:string}}>(`${base}/sessions/:id/annotation`,{schema:{params,querystring:empty}},request=>service.binding(actor(request),request.params.id));
  app.put<{Params:{id:string};Body:AnnotationBaseInput}>(`${base}/sessions/:id/annotation/base`,{schema:{params,querystring:empty}},request=>service.setBase(actor(request),request.params.id,request.body));
  app.get<{Params:{setId:string;revision:string}}>(`${base}/annotations/:setId/revisions/:revision`,{schema:{params:scope.params({setId:uuid,revision:{type:'string',pattern:'^[1-9][0-9]*$'}}),querystring:empty}},request=>service.privateVersion(actor(request),request.params.setId,Number(request.params.revision)));
  app.get<{Params:{id:string}}>(`${base}/annotation-publications/:id`,{schema:{params,querystring:empty}},request=>service.publishedVersion(actor(request),request.params.id));
  app.post<{Params:{id:string};Body:AnnotationAction}>(`${base}/sessions/:id/annotation/actions`,{bodyLimit:256*1024,schema:{params,querystring:empty}},request=>service.action(actor(request),request.params.id,request.body));
  app.post<{Params:{id:string};Body:AnnotationCurrentInput}>(`${base}/tasks/:id/annotations/current`,{schema:{params,querystring:empty}},request=>service.setCurrent(actor(request),request.params.id,request.body));
  app.post<{Params:{id:string};Body:AnnotationReadInput}>(`${base}/tasks/:id/annotations/read`,{schema:{params,querystring:empty}},request=>service.read(actor(request),request.params.id,request.body));
  app.post<{Params:{id:string}}>(`${base}/tasks/:id/annotations/compare`,{schema:{params,querystring:empty}},request=>{
    const input=validate.record(request.body,['left','right','offset','limit'],['left','right']),p=validate.page(input.offset,input.limit);
    return service.compare(actor(request),request.params.id,validate.ref(input.left),validate.ref(input.right),p.offset,p.limit);
  });
  app.get<{Params:{id:string}}>(`${base}/annotation-actions/:id`,{schema:{params,querystring:empty}},request=>service.receipt(actor(request),request.params.id));
}
