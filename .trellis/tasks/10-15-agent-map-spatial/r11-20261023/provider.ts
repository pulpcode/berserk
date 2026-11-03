/** Same native HTTP recorder, with a frozen eval-only neutral system-context preload. */
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {Recorder,type ObserverOptions} from '../r7-20261023/recorder.js';
import {auditPayload,type Payload} from '../r3-20261022/audit.js';
import {addUsage} from '../r3-20261022/live-budget.js';
import {skillIds,save,type Runtime} from './runtime.js';
import type {Ledger} from './budget.js';
export {type Attempt,type ProviderSlot} from '../r7-20261023/recorder.js';
export function preload(payload:Payload,runtime:Runtime,enabled:boolean):Payload {
 const result=structuredClone(payload);if(!enabled)return result;
 const first=result.messages?.find(m=>m.role==='system');assert.ok(first&&typeof first.content==='string','Expected existing first system context');
 first.content+='\n<available_method_references>\n以下为可供参考的方法原文；适用范围和权限以现有规则及用户请求为准。\n'+skillIds.map(id=>`<method id="${id}">\n${runtime.skills[id].content}\n</method>`).join('\n')+'\n</available_method_references>';
 return result;
}
export class Provider extends Recorder {
 private settled=new Set<number>();private begun=new Set<number>();private first=new Set<string>();
 constructor(options:ObserverOptions,readonly ledger:Ledger){super(options);}
 override persist(){
  for(const attempt of this.options.attempts){const id=`agent:${attempt.entry}:${attempt.id}`;
   if(!this.begun.has(attempt.id)){this.ledger.beginRequest({id,role:'agent',trialId:attempt.entry});this.begun.add(attempt.id);}
   if(attempt.completed&&!this.settled.has(attempt.id)){const usage={requests:0,input:0,output:0,unknownUsage:0};
    if(attempt.error||!addUsage(usage,attempt.usage)||!attempt.actualModels?.length)this.ledger.failRequest(id,attempt.error??'missing_usage_or_model');
    else try{assert.deepEqual(attempt.actualModels,['deepseek-v4-1-flash-261017'],'Frozen response model drift');this.ledger.finishRequest(id,{inputTokens:usage.input,outputTokens:usage.output,responseModel:attempt.actualModels[0]});}catch{this.ledger.failRequest(id,'model_or_usage_invalid');}
    this.settled.add(attempt.id);
   }
  }this.fatal??=this.ledger.read().halted;super.persist();
 }
 override async provider(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1]){
  try{assert.ok(this.active);const slot=this.active,raw=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';
  const native=JSON.parse(raw) as Payload,parent=Array.isArray(native.tools)&&native.tools.some((t:{function?:{name?:string}})=>t.function?.name==='spatial_analyze');
  const group=slot.id.match(/(S[01]-[NP])$/)?.[1];assert.ok(group);
  const enabled=group.endsWith('-P'),wire=parent?preload(native,slot.runtime,enabled):native;
  const n=this.options.totals.requests+1,stem=join(slot.directory,`provider-${String(n).padStart(4,'0')}`);
  save(stem+'-native-pi-input.json',native);
  if(parent){const exposure=auditPayload(wire,slot.runtime.skills,n,slot.turn);for(const id of skillIds){assert.ok(exposure.skills[id].catalogPresent);if(enabled)assert.ok(exposure.skills[id].bodyPresent,'Complete preload body missing');else if(!this.first.has(slot.id))assert.ok(!exposure.skills[id].bodyPresent,'Native first request leaked body');}
   save(stem+'-delivery.json',{group,mode:enabled?'eval-system-context':'native-on-demand',native:auditPayload(native,slot.runtime.skills,n,slot.turn),actual:exposure});this.first.add(slot.id);
  }
  return await super.provider(input,{...init,body:JSON.stringify(wire)});
  }catch(error){this.fatal??='provider_input_protocol_failure';if(this.active)this.active.stop??=this.fatal;await this.options.cancel(this.fatal);throw error;}
 }
}
