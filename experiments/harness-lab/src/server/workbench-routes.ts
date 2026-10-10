import type { FastifyInstance } from 'fastify';
import { identityOf } from './auth.js';
import { WorkbenchService, type WorkbenchFilter, type OverviewFilter } from '../workbench/service.js';

const uuid = {type:'string',format:'uuid'};
const page = {taskId:uuid,search:{type:'string',maxLength:200},offset:{type:'string',pattern:'^\\d{1,8}$'},limit:{type:'string',pattern:'^\\d{1,3}$'}};
type Query<T> = Omit<T,'offset'|'limit'> & {offset?:string;limit?:string};
function filter<T extends {offset?:string;limit?:string}>(query:T) { return {...query,offset:Number(query.offset ?? 0),limit:Number(query.limit ?? 25)}; }
export async function workbenchRoutes(app:FastifyInstance, service:WorkbenchService) {
  app.get<{Querystring:Query<WorkbenchFilter>}>('/api/workbench/items',{schema:{querystring:{type:'object',additionalProperties:false,properties:{...page,bucket:{enum:['actionable','following','done','all']},kind:{enum:['work','information','delivery_review']}}}}},request => service.items(identityOf(request),filter(request.query)));
  app.get<{Querystring:Query<OverviewFilter>}>('/api/work-overview/items',{schema:{querystring:{type:'object',additionalProperties:false,properties:{...page,seatId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,64}$'},status:{enum:['assigned','working','submitted','returned','completed']}}}}},request => service.overview(identityOf(request),filter(request.query)));
  app.get<{Params:{id:string}}>('/api/work-overview/items/:id',{schema:{params:{type:'object',additionalProperties:false,properties:{id:uuid},required:['id']},querystring:{type:'object',additionalProperties:false}}},request => service.overviewItem(identityOf(request),request.params.id));
}
