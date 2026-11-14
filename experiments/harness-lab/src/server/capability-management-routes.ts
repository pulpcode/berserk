import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PiLab } from '../pi/lab.js';
import type { ManagementActor, ExpertDraftContent, PublishExpertInput, ExpertDefaultScope, ExpertDefaultChoice } from '../contracts/capability-management.js';
import type { ExpertTrialFile, ExpertTrialRunView } from '../contracts/capability-trials.js';
import { CapabilityTrials, type CapabilityTrialsOptions } from '../pi/capability-trials.js';
import { RequestError } from '../contracts/errors.js';
import { accountIdentityOf } from './auth.js';
import { authorizeExpertDefault, requireCapabilityAdministrator } from './capability-authorization.js';
import { sendFile } from './file-response.js';

const empty = {type:'object',additionalProperties:false};
const uuid = {type:'string',format:'uuid'};
const id = {type:'string',pattern:'^[a-z][a-z0-9_-]{0,127}$'};
const revisionId = {type:'string',pattern:'^rev-[0-9a-f]{64}$'};
const revision = {type:'integer',minimum:1};
const params = (extra: Record<string, unknown> = {}) => ({type:'object',additionalProperties:false,required:['expertId',...Object.keys(extra)],properties:{expertId:id,...extra}});
const body = (properties: Record<string,unknown>, required = Object.keys(properties)) => ({type:'object',additionalProperties:false,properties,required});
const content = body({name:{type:'string',minLength:1,maxLength:120},description:{type:'string',minLength:1,maxLength:2000},instructions:{type:'string',maxLength:65536},skillIds:{type:'array',maxItems:4,uniqueItems:true,items:id},allowedTools:{type:'array',maxItems:100,uniqueItems:true,items:id}});
const choice = {oneOf:[body({mode:{const:'inherit'}}),body({mode:{const:'general'}}),body({mode:{const:'expert'},expertId:id})]};
const defaults = body({expectedRevision:{type:'integer',minimum:0},choice,clientActionId:uuid});

/** Management writes share services with future entry points; none infer authority from hidden UI. */
export async function capabilityManagementRoutes(app: FastifyInstance, lab: PiLab, options: Pick<CapabilityTrialsOptions, 'runtimeFactory' | 'executionFactory'> = {}) {
  const management = lab.management;
  if (!management) return;
  const actor = (request: FastifyRequest): ManagementActor => {
    if (!lab.access) throw new RequestError('FORBIDDEN','此环境未启用账号能力管理。',403);
    const identity=accountIdentityOf(request);
    return {userId:identity.userId,seatId:identity.seatId};
  };
  const admin = (request: FastifyRequest) => {const value=actor(request);requireCapabilityAdministrator(lab,value);return value;};
  const trials = await CapabilityTrials.open({
    ...options, dataDir: lab.config.dataDir, modelConfig: () => ({...lab.config}),
    authorize: (owner, trial) => {
      requireCapabilityAdministrator(lab, owner);
      if (trial.ownerId !== owner.userId) throw new RequestError('EXPERT_TRIAL_NOT_FOUND','试用不存在或无权访问。',404);
    },
    onUpdate: (owner, trial) => {
      // Trusted runtime termination must converge even after administrator revocation.
      if (['failed','cancelled','interrupted'].includes(trial.status)) { management.recordTrialResult(owner,trial.trialId,{status:trial.status,evidence:trial.evidence}); return; }
      const prior=management.getTrial(owner,trial.trialId);
      if (['prepared','running'].includes(prior.status) && trial.status!=='prepared') management.recordTrialResult(owner, trial.trialId, {status:trial.status,evidence:trial.evidence});
    },
  });
  app.addHook('onClose',async()=>trials.close());
  const root='/api/admin/capabilities/experts';
  app.get(root,{schema:{querystring:empty}},request=>{admin(request);return management.list();});
  app.get('/api/admin/capabilities/catalog',{schema:{querystring:empty}},request=>{admin(request);return management.catalog();});
  app.get<{Params:{expertId:string}}>(`${root}/:expertId`,{schema:{params:params(),querystring:empty}},request=>{admin(request);return management.get(request.params.expertId);});
  app.post<{Body:{clientActionId:string;copyFrom?:{expertId:string;revisionId?:string}}}>(root,{schema:{body:body({clientActionId:uuid,copyFrom:body({expertId:id,revisionId},['expertId'])},['clientActionId'])}},request=>management.create(admin(request),request.body));
  app.put<{Params:{expertId:string};Body:{expectedDraftRevision:number;content:ExpertDraftContent}}>(`${root}/:expertId/draft`,{schema:{params:params(),body:body({expectedDraftRevision:revision,content})}},request=>management.save(admin(request),request.params.expertId,request.body));
  app.post<{Params:{expertId:string};Body:{expectedDraftRevision:number}}>(`${root}/:expertId/validate`,{schema:{params:params(),body:body({expectedDraftRevision:revision})}},request=>management.validate(admin(request),request.params.expertId,request.body));
  app.post<{Params:{expertId:string};Body:PublishExpertInput}>(`${root}/:expertId/publish`,{schema:{params:params(),body:body({clientActionId:uuid,expectedDraftRevision:revision,expectedCurrentRevisionId:{anyOf:[revisionId,{type:'null'}]},validationId:uuid,trialId:uuid,releaseNotes:{type:'string',minLength:1,maxLength:4000},acceptedRiskCodes:{type:'array',uniqueItems:true,maxItems:100,items:{type:'string',maxLength:150}}})}},request=>management.publish(admin(request),request.params.expertId,request.body));
  app.get<{Params:{expertId:string}}>(`${root}/:expertId/impact`,{schema:{params:params(),querystring:empty}},request=>{admin(request);return management.impact(request.params.expertId);});
  app.get<{Params:{expertId:string;revisionId:string}}>(`${root}/:expertId/revisions/:revisionId`,{schema:{params:params({revisionId}),querystring:empty}},async request=>{
    admin(request);await management.get(request.params.expertId);
    const value=await lab.capabilities.resolve({expertId:request.params.expertId,revisionId:request.params.revisionId});
    return {content:{name:value.name,description:value.description,instructions:value.instructions,skillIds:value.skills.map(skill=>skill.id),allowedTools:value.allowedTools??[]},revision:value};
  });
  app.put<{Params:{expertId:string};Body:{expectedRevision:number;mode:'none'|'all'|'seats';seatIds:string[];clientActionId:string}}>(`${root}/:expertId/policy`,{schema:{params:params(),body:body({expectedRevision:{type:'integer',minimum:0},mode:{enum:['none','all','seats']},seatIds:{type:'array',uniqueItems:true,maxItems:1000,items:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,64}$'}},clientActionId:uuid})}},request=>management.setPolicy(admin(request),request.params.expertId,request.body));
  app.post<{Params:{expertId:string};Body:{action:'disable'|'enable'|'archive';revisionId?:string;reason:string;clientActionId:string;expectedStateRevision:number;expectedCurrentRevisionId:string|null}}>(`${root}/:expertId/lifecycle`,{schema:{params:params(),body:body({action:{enum:['disable','enable','archive']},revisionId,reason:{type:'string',minLength:1,maxLength:1000},clientActionId:uuid,expectedStateRevision:{type:'integer',minimum:0},expectedCurrentRevisionId:{anyOf:[revisionId,{type:'null'}]}},['action','reason','clientActionId','expectedStateRevision','expectedCurrentRevisionId'])}},request=>management.setLifecycle(admin(request),request.params.expertId,request.body));

  const trialView = (who:ManagementActor, view:ExpertTrialRunView):ExpertTrialRunView => {
    const prior=management.getTrial(who,view.trial.trialId);
    if (['prepared','running'].includes(prior.status) && view.trial.status !== 'prepared' && view.trial.status!==prior.status) management.recordTrialResult(who,view.trial.trialId,{status:view.trial.status,evidence:view.trial.evidence});
    return {...view,trial:management.getTrial(who,view.trial.trialId)};
  };
  const trialRoot=`${root}/:expertId/trials`;
  const matchingTrial = (who:ManagementActor, expertId:string,trialId:string) => {
    const value=management.getTrial(who,trialId);
    if(value.expertId!==expertId) throw new RequestError('EXPERT_TRIAL_NOT_FOUND','试用不存在或无权访问。',404);
    return value;
  };
  app.post<{Params:{expertId:string};Body:{expectedDraftRevision:number;validationId:string;clientActionId:string;input:string;files?:ExpertTrialFile[]}}>(trialRoot,{bodyLimit:1024*1024,schema:{params:params(),body:body({expectedDraftRevision:revision,validationId:uuid,clientActionId:uuid,input:{type:'string',minLength:1,maxLength:16000},files:{type:'array',maxItems:8,items:body({name:{type:'string',minLength:1,maxLength:255},content:{type:'string',maxLength:65536}})}},['expectedDraftRevision','validationId','clientActionId','input'])}},async request=>{
    const who=admin(request);const prepared=await management.prepareTrial(who,request.params.expertId,request.body);
    return trialView(who,await trials.start(who,prepared,request.body.files??[]));
  });
  app.get<{Params:{expertId:string;trialId:string}}>(`${trialRoot}/:trialId`,{schema:{params:params({trialId:uuid}),querystring:empty}},async request=>{
    const who=admin(request);matchingTrial(who,request.params.expertId,request.params.trialId);return trialView(who,await trials.get(who,request.params.trialId));
  });
  app.post<{Params:{expertId:string;trialId:string}}>(`${trialRoot}/:trialId/cancel`,{schema:{params:params({trialId:uuid}),body:empty},preValidation:async request=>{request.body??={};}},async request=>{
    const who=admin(request);matchingTrial(who,request.params.expertId,request.params.trialId);return trialView(who,await trials.cancel(who,request.params.trialId));
  });
  app.post<{Params:{expertId:string;trialId:string;interactionId:string};Body:unknown}>(`${trialRoot}/:trialId/interactions/:interactionId`,{schema:{params:params({trialId:uuid,interactionId:uuid})}},async request=>{
    const who=admin(request);matchingTrial(who,request.params.expertId,request.params.trialId);return trialView(who,await trials.respond(who,request.params.trialId,request.params.interactionId,request.body));
  });
  app.post<{Params:{expertId:string;trialId:string};Body:{approved:boolean;reason:string;clientActionId:string}}>(`${trialRoot}/:trialId/confirm`,{schema:{params:params({trialId:uuid}),body:body({approved:{type:'boolean'},reason:{type:'string',minLength:1,maxLength:2000},clientActionId:uuid})}},async request=>{
    const who=admin(request);matchingTrial(who,request.params.expertId,request.params.trialId);
    const view=await trials.get(who,request.params.trialId);
    const prior=management.getTrial(who,view.trial.trialId);
    if (['prepared','running'].includes(prior.status) && view.trial.status!=='prepared') management.recordTrialResult(who,view.trial.trialId,{status:view.trial.status,evidence:view.trial.evidence});
    return management.confirmTrial(who,request.params.trialId,request.body);
  });
  app.get<{Params:{expertId:string;trialId:string;downloadId:string}}>(`${trialRoot}/:trialId/downloads/:downloadId`,{schema:{params:params({trialId:uuid,downloadId:uuid}),querystring:empty}},async(request,reply)=>{
    const who=admin(request);matchingTrial(who,request.params.expertId,request.params.trialId);return sendFile(reply,await trials.download(who,request.params.trialId,request.params.downloadId));
  });
  const registerDefault = (url:string,scopeFor:(request:FastifyRequest)=>ExpertDefaultScope,parameterSchema?:object) => {
    app.get(url,{schema:{...(parameterSchema?{params:parameterSchema}:{}),querystring:empty}},request=>{
      const who=actor(request),scope=scopeFor(request);authorizeExpertDefault(lab,who,scope,false);return management.getDefault(scope);
    });
    app.put<{Body:{expectedRevision:number;choice:ExpertDefaultChoice;clientActionId:string}}>(url,{schema:{...(parameterSchema?{params:parameterSchema}:{}),body:defaults}},request=>{
      const who=actor(request),scope=scopeFor(request);authorizeExpertDefault(lab,who,scope,true);return management.saveDefault(who,scope,request.body);
    });
  };
  registerDefault('/api/me/preferences/expert',request=>({kind:'personal',id:actor(request).userId}));
  registerDefault('/api/admin/seats/:id/expert-default',request=>({kind:'seat',id:(request.params as {id:string}).id}),body({id:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,64}$'}}));
  registerDefault('/api/tasks/:id/expert-default',request=>({kind:'task',id:(request.params as {id:string}).id}),body({id:uuid}));
}
