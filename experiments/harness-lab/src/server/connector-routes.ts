import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ConnectorActor, ConnectorCredentialInput, ConnectorLifecycleInput, ConnectorPrincipal, CreateConnectorInput, RevokeConnectorCredentialInput, UpdateConnectorInput } from '../contracts/connectors.js';
import type { ConnectorService } from '../connectors/service.js';

const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const id={type:'string',minLength:1,maxLength:160,pattern:'^[a-zA-Z0-9_-]+$'};
const uuid={type:'string',format:'uuid'};
const empty=object({});
const params=object({connectorId:id});
const version={type:'integer',minimum:0};
const auth=object({mode:{enum:['none','bearer','api-key']},credentialSource:{enum:['organization','personal']},headerName:{type:'string',minLength:1,maxLength:64}},['mode','credentialSource']);
const exposure=object({name:{type:'string',minLength:1,maxLength:256},contractDigest:{type:'string',pattern:'^[a-f0-9]{64}$'}});
const config={name:{type:'string',minLength:1,maxLength:128},description:{type:'string',maxLength:2000},endpoint:{type:'string',minLength:1,maxLength:2048},auth,approvedTargets:{type:'array',maxItems:64,uniqueItems:true,items:{type:'string',minLength:1,maxLength:2048}},policy:object({mode:{enum:['none','all','seats']},seatIds:{type:'array',maxItems:100,uniqueItems:true,items:id},personal:{type:'boolean'}}),exposedTools:{type:'array',maxItems:256,items:exposure}};
export interface ConnectorRouteOptions {
  actor:(request:FastifyRequest)=>ConnectorActor;
  /** The host resolves exact current account/workspace membership; a supplied ID never grants access. */
  principal:(request:FastifyRequest,workspaceId?:string)=>ConnectorPrincipal;
}
export function connectorRoutes(app:FastifyInstance,service:ConnectorService,options:ConnectorRouteOptions):void {
  const root='/api/admin/connections';
  app.get<{Querystring:{workspaceId?:string}}>('/api/capabilities/connectors',{schema:{querystring:object({workspaceId:id},[])}},request=>service.catalog(options.principal(request,request.query.workspaceId)));
  app.get(root,{schema:{querystring:empty}},request=>service.list(options.actor(request)));
  app.get<{Params:{connectorId:string}}>(`${root}/:connectorId`,{schema:{params,querystring:empty}},request=>service.detail(options.actor(request),request.params.connectorId));
  app.post<{Body:CreateConnectorInput}>(root,{schema:{body:object({...config,clientActionId:uuid})}},request=>service.create(options.actor(request),request.body));
  app.put<{Params:{connectorId:string};Body:UpdateConnectorInput}>(`${root}/:connectorId`,{schema:{params,body:object({...config,expectedRevisionId:id,clientActionId:uuid})}},request=>service.update(options.actor(request),request.params.connectorId,request.body));
  app.post<{Params:{connectorId:string};Body:ConnectorLifecycleInput}>(`${root}/:connectorId/lifecycle`,{schema:{params,body:object({action:{enum:['disable','restore']},expectedStateRevision:version,clientActionId:uuid})}},request=>service.lifecycle(options.actor(request),request.params.connectorId,request.body));
  app.post<{Params:{connectorId:string};Body:{expectedRevisionId:string;clientActionId:string}}>(`${root}/:connectorId/discover`,{schema:{params,body:object({expectedRevisionId:id,clientActionId:uuid})}},request=>service.discover(options.actor(request),request.params.connectorId,request.body));
  app.put<{Params:{connectorId:string;sourceId:string};Body:{enabled:boolean;expectedRevision:number;clientActionId:string}}>(`${root}/:connectorId/inbound/:sourceId`,{schema:{params:object({connectorId:id,sourceId:id}),querystring:empty,body:object({enabled:{type:'boolean'},expectedRevision:version,clientActionId:uuid})}},request=>service.inboundState(options.actor(request),request.params.connectorId,request.params.sourceId,request.body));
  for(const management of [false,true]) {
    const base=management?`${root}/:connectorId/credential`:'/api/connectors/:connectorId/credential';
    const querystring=management?object({sourceId:id},[]):empty;
    const principal=(request:FastifyRequest)=>management?options.actor(request):options.principal(request);
    app.get<{Params:{connectorId:string};Querystring:{sourceId?:string}}>(base,{schema:{params,querystring}},request=>service.credentialStatus(request.params.connectorId,principal(request),management,request.query.sourceId));
    app.put<{Params:{connectorId:string};Querystring:{sourceId?:string};Body:ConnectorCredentialInput}>(base,{bodyLimit:32*1024,schema:{params,querystring,body:object({value:{type:'string',minLength:1,maxLength:16384},expectedVersion:version,clientActionId:uuid})}},request=>service.setCredential(principal(request),request.params.connectorId,request.body,management,request.query.sourceId));
    app.delete<{Params:{connectorId:string};Querystring:{sourceId?:string};Body:RevokeConnectorCredentialInput}>(base,{schema:{params,querystring,body:object({expectedVersion:version,clientActionId:uuid})}},request=>service.revokeCredential(principal(request),request.params.connectorId,request.body,management,request.query.sourceId));
  }
}
