import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { SkillActor, SkillPackageRevision } from '../contracts/skills.js';
import type { ExpertTrialFile } from '../contracts/capability-trials.js';
import { RequestError } from '../contracts/errors.js';
import { expertRevision } from '../capabilities/service.js';
import { packageMethod } from '../resources/skill-package.js';
import { CapabilityTrials, type CapabilityTrialsOptions } from './capability-trials.js';

/** Skill trials have their own namespace but use the original Pi/confirmation/file loop. */
export class SkillTrials {
  private constructor(private readonly runtime: CapabilityTrials) {}
  static async open(options: Omit<CapabilityTrialsOptions,'authorize'|'onUpdate'> & {authorize:(userId:string)=>void;assertTrialAllowed:(skillId:string)=>void}) {
    return new SkillTrials(await CapabilityTrials.open({...options,requireDeclaredToolCoverage:false,optionalFileEnvironment:true,dataDir:join(options.dataDir,'skill-trial-runtime'),
      executionGuard:(actor,trial,expert)=>{for(const skill of expert.skills)if(skill.schemaVersion===2)options.assertTrialAllowed(skill.id);options.executionGuard?.(actor,trial,expert);},
      authorize:(actor,trial)=>{options.authorize(actor.userId); if(trial.ownerId!==actor.userId)throw new RequestError('FORBIDDEN','试用不属于当前管理员。',403);}}));
  }
  actionId(actor:SkillActor,clientActionId:string):string {
    actor.assertAdministrator();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clientActionId))throw new RequestError('INVALID_INPUT','试用动作标识无效。');
    const digest=createHash('sha256').update(`${actor.userId}:${clientActionId}`).digest('hex');
    return `${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
  }
  replay(actor:SkillActor,trialId:string){
    actor.assertAdministrator();
    try{return this.runtime.get(actor,trialId);}catch(error){
      if(error instanceof RequestError&&error.code==='EXPERT_TRIAL_NOT_FOUND')throw new RequestError('SKILL_TRIAL_OUTCOME_UNCERTAIN','试用动作已保留，但未找到可核对的运行记录；不会自动重新执行，请保留现场检查。',503);
      throw error;
    }
  }
  start(actor:SkillActor,input:{clientActionId:string; package:SkillPackageRevision; input:string},files:ExpertTrialFile[]=[]){
    actor.assertAdministrator();
    const trialId=this.actionId(actor,input.clientActionId);
    const skill=packageMethod(input.package);
    const fileTools=['read','ls','find','grep','write','edit','bash','file_output'];
    const expert=expertRevision({expertId:`skill-trial-${input.package.skillId}`,releaseVersion:'trial',name:skill.name,description:skill.description,
      instructions:'按本次用户任务使用固定技能；只依据实际工具结果说明已执行事项。不能执行的操作如实说明，不推断环境配置。',
      modes:['interactive'],selectable:false,system:false,allowedTools:['skill_read','ask_user',...fileTools],skills:[skill]});
    return this.runtime.start(actor,{expert,packages:[input.package],trial:{trialId,expertId:expert.expertId,ownerId:actor.userId,draftDigest:input.package.packageDigest,
      validationId:input.package.packageDigest,status:'prepared',input:input.input,createdAt:new Date().toISOString()}},files);
  }
  publicSummary(skillId:string,packageDigest:string){return this.runtime.publicSummary(`skill-trial-${skillId}`,packageDigest);}
  list(actor:SkillActor,skillId:string){actor.assertAdministrator();return this.runtime.list(actor,`skill-trial-${skillId}`);}
  get(actor:SkillActor,id:string){actor.assertAdministrator();return this.runtime.get(actor,id);}
  cancel(actor:SkillActor,id:string){actor.assertAdministrator();return this.runtime.cancel(actor,id);}
  respond(actor:SkillActor,id:string,interactionId:string,body:unknown){actor.assertAdministrator();return this.runtime.respond(actor,id,interactionId,body);}
  download(actor:SkillActor,id:string,downloadId:string){actor.assertAdministrator();return this.runtime.download(actor,id,downloadId);}
  close(){return this.runtime.close();}
}
