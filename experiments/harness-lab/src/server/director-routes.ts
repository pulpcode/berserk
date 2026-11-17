import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DirectorState, DirectorSwitchInput } from '../contracts/director.js';
import type { PiLab } from '../pi/lab.js';
import type { BackgroundService } from '../background/service.js';
import type { ScenarioScope } from '../scenario/scope.js';
import type { ScenarioTasks } from './scenario-tasks.js';
import { scenarioId } from './scenario-tasks.js';
import { scenarioDirector } from './scenario-routes.js';
import { contextInteger, contextRecord, contextText } from '../context/validation.js';
import { RequestError } from '../contracts/errors.js';
import type { Mutex } from '../resources/files.js';
import type { apiScope } from './seat-scope.js';

const fail=(message:string)=>new RequestError('DIRECTOR_SWITCH_CONFLICT',message,409);
const uuid=(value:unknown)=>{const id=contextText(value,36);if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))throw fail('操作编号需要UUID。');return id;};
const empty={type:'object',additionalProperties:false};
type Call=(request:FastifyRequest,path:string,body?:Record<string,unknown>,includeActor?:boolean)=>Promise<unknown>;
type Status=(request:FastifyRequest,id:string)=>Promise<{clock:{revision:number};paused:boolean;status:string;sendStates:string[];operationMode:'scenario'|'free_debug'}>;
/** Persist only a cross-system operation, never another active-run pointer. */
export function directorRoutes(app:FastifyInstance,lab:PiLab,background:BackgroundService,scope:ReturnType<typeof apiScope>,tasks:ScenarioTasks,runScope:ScenarioScope,mutex:Mutex,call:Call,status:Status) {
  const base=`${scope.base}/simulation`;
  const source=async(request:FastifyRequest)=>await call(request,'director') as DirectorState;
  const state=async(request:FastifyRequest)=>{const current=await source(request),pending=await tasks.directorTransition();return {...current,...(pending?.state==='pending'?{pending:pending.input}:{})};};
  app.get(`${base}/director`,{schema:{querystring:empty}},request=>state(request));
  app.get<{Params:{id:string}}>(`${base}/director/operations/:id`,{schema:{querystring:empty}},async request=>{
    scenarioDirector(lab,background,request);const record=await tasks.directorTransition();if(!record||record.input.clientActionId!==uuid(request.params.id))throw new RequestError('DIRECTOR_OPERATION_NOT_FOUND','切换操作不存在。',404);return state(request);
  });
  app.post(`${base}/director/switch`,{schema:{querystring:empty}},request=>mutex.run(async()=>{
    const {actor}=scenarioDirector(lab,background,request);
    const raw=contextRecord(request.body,['clientActionId','mode','expectedActiveRevision','expectedInstanceId','expectedRevision','confirmed','restart'],['clientActionId','mode','expectedActiveRevision','expectedInstanceId','expectedRevision','confirmed']);
    if(!['scenario','free_debug'].includes(String(raw.mode))||raw.confirmed!==true||raw.restart!==undefined&&typeof raw.restart!=='boolean'||raw.restart===true&&raw.mode!=='free_debug')throw fail('切换方式或确认无效。');
    const input:DirectorSwitchInput={clientActionId:uuid(raw.clientActionId),mode:raw.mode as DirectorSwitchInput['mode'],expectedActiveRevision:contextInteger(raw.expectedActiveRevision,0),expectedInstanceId:raw.expectedInstanceId===null?null:scenarioId(raw.expectedInstanceId),expectedRevision:raw.expectedRevision===null?null:contextInteger(raw.expectedRevision),confirmed:true,...(raw.restart===undefined?{}:{restart:raw.restart as boolean})};
    if((input.expectedInstanceId===null)!==(input.expectedRevision===null))throw fail('当前轮次与修订必须同时提供。');
    await tasks.assertSettled(input.clientActionId);
    let transition=await tasks.directorTransition();
    if(transition?.input.clientActionId===input.clientActionId){if(transition.userId!==actor.userId||JSON.stringify(transition.input)!==JSON.stringify(input))throw fail('相同切换编号的内容或操作者已变化。');if(transition.state==='complete')return state(request);}
    else {
      const current=await source(request);
      if(current.activeRevision!==input.expectedActiveRevision||current.activeInstanceId!==input.expectedInstanceId||(current.activeInstance?.revision??null)!==input.expectedRevision)throw fail('当前方式或轮次已变化，请刷新后确认。');
      if(current.mode===input.mode&&!input.restart&&(input.mode==='scenario'||current.activeInstanceId))return state(request);
      if(current.activeInstanceId){const old=await status(request,current.activeInstanceId);if(old.sendStates.includes('unconfirmed'))throw fail('仍有通知接收结果待核对，暂不能切换。');}
      transition={input,userId:actor.userId,state:'pending',phase:'ending',pauseId:randomUUID(),finishId:randomUUID(),createId:randomUUID(),activateId:randomUUID()};await tasks.saveDirectorTransition(transition);
    }
    const save=()=>tasks.saveDirectorTransition(transition!);
    const queryOperation=async(id:string)=>{try{return await call(request,`operations/${id}`) as {instance:{instanceId:string;revision:number}};}catch(error){if(error instanceof RequestError&&error.code==='CONTEXT_NOT_FOUND')return null;throw error;}};
    if(transition.phase==='ending'){
      const previous=input.expectedInstanceId;
      if(previous){
        runScope.close(previous);
        const finished=await queryOperation(transition.finishId);
        if(!finished){
          let old=await status(request,previous);
          if(old.status!=='active')throw fail('原轮次已被其他操作结束，请核对原切换记录。');
          if(!old.paused){await call(request,`instances/${previous}/control`,{clientActionId:transition.pauseId,expectedRevision:old.clock.revision,action:'pause'});old=await status(request,previous);}
          if(old.sendStates.includes('unconfirmed'))throw fail('仍有通知接收结果待核对，请继续核对后重试原切换。');
          await Promise.all([background.stopRun(previous),lab.stopScenario(previous)]);
          const ids=lab.access!.db.prepare("SELECT id FROM task_spaces WHERE json_extract(data,'$.scenarioInstanceId')=?").all(previous).map(row=>String(row.id));
          if(lab.access!.hasAdmissions(ids))throw fail('原轮次仍有正在处理的写入，请稍后继续原切换。');
          scenarioDirector(lab,background,request);
          await tasks.archiveOwned(actor,previous,id=>(lab.collaboration?.hasUnfinishedTask(id)??false)||background.store.hasTaskReservations(id),()=>{scenarioDirector(lab,background,request);});
          await call(request,`instances/${previous}/finish`,{clientActionId:transition.finishId,expectedRevision:old.clock.revision,expectedActiveRevision:input.expectedActiveRevision});
        }
      }
      transition.phase='starting';await save();await runScope.sync();
    }
    if(input.mode==='free_debug'){
      let created=await queryOperation(transition.createId);if(!created)created=await call(request,'director/debug',{clientActionId:transition.createId}) as {instance:{instanceId:string;revision:number}};
      transition.nextInstanceId=created.instance.instanceId;await save();runScope.close(transition.nextInstanceId);
      const activated=await queryOperation(transition.activateId);
      if(!activated){const current=await source(request);if(current.activeInstanceId!==null)throw fail('初始化前活动轮次已变化。');await call(request,`instances/${transition.nextInstanceId}/activate`,{clientActionId:transition.activateId,expectedRevision:created.instance.revision,expectedActiveRevision:current.activeRevision,terminateUnsent:true});}
      await runScope.confirmActive(transition.nextInstanceId);
    }else await runScope.sync();
    transition.state='complete';transition.phase='complete';await save();if(transition.nextInstanceId){runScope.open(transition.nextInstanceId);await background.activateRun(transition.nextInstanceId);}return state(request);
  }));
  app.get<{Params:{id:string}}>(`${base}/instances/:id/debug`,{schema:{querystring:empty}},request=>call(request,`instances/${scenarioId(request.params.id)}/debug`));
  for(const kind of ['object-updates','report-updates'] as const)app.post<{Params:{id:string}}>(`${base}/instances/:id/debug/${kind}`,{schema:{querystring:empty}},request=>mutex.run(async()=>{
    scenarioDirector(lab,background,request);await tasks.assertSettled();const id=scenarioId(request.params.id);runScope.assertWritable(id);
    const raw=contextRecord(request.body,['clientActionId','expectedRunRevision','expectedRevision',...(kind==='object-updates'?['ref','properties','effectiveAt','validTime']:['reportId','report'])]);uuid(raw.clientActionId);contextInteger(raw.expectedRunRevision);contextInteger(raw.expectedRevision);
    return call(request,`instances/${id}/debug/${kind}`,raw);
  }));
}
