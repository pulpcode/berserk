/** Record native Pi input and actual equally preloaded wire input for both B groups. */
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {Recorder,type ObserverOptions,type ProviderSlot} from '../r7-20261023/recorder.js';
import {auditPayload,type Payload} from '../r3-20261022/audit.js';
import {addUsage} from '../r3-20261022/live-budget.js';
import {skillIds,save,type Runtime} from './source-runtime.js';
import type {Prepared,Group} from './source-cases.js';
import type {SourceLedger} from './source-budget.js';
export type {Attempt,ProviderSlot} from '../r7-20261023/recorder.js';
export function preload(payload:Payload,runtime:Runtime,providedQueries?:Prepared['providedQueries']):Payload{
 const p=structuredClone(payload),first=p.messages?.find(m=>m.role==='system');assert.ok(first&&typeof first.content==='string');
 first.content+='\n<available_method_references>\n以下为可供参考的方法原文；适用范围和权限以现有规则及用户请求为准。\n'+skillIds.map(id=>`<method id="${id}">\n${runtime.skills[id].content}\n</method>`).join('\n')+'\n</available_method_references>';
 if(providedQueries)first.content+='\n<driver_read_evidence>\n以下是测试驱动通过真实只读接口预先取得的候选查询记录，不是你先前自主执行的工具调用；请按用户问题确定用途，不将它们视为来源选择或写入授权。\n'+JSON.stringify(providedQueries)+'\n</driver_read_evidence>';
 return p;
}
export class Provider extends Recorder {
 declare active?:ProviderSlot&{prepared:Prepared};
 private settled=new Set<number>();private begun=new Set<number>();private schemas=new Map<Group,string>();
 constructor(options:ObserverOptions,readonly ledger:SourceLedger){super(options);}
 override persist(){
  for(const a of this.options.attempts){const id=`B:${a.entry}:${a.id}`;
   if(!this.begun.has(a.id)){this.ledger.beginRequest(id,a.entry);this.begun.add(a.id);}
   if(a.completed&&!this.settled.has(a.id)){
    const u={requests:0,input:0,output:0,unknownUsage:0};
    if(a.error||!addUsage(u,a.usage)||a.actualModels?.length!==1||a.actualModels[0]!=='deepseek-v4-1-flash-261017')this.ledger.failRequest(id,a.error??'usage_or_model_invalid');
    else this.ledger.finishRequest(id,{inputTokens:u.input,outputTokens:u.output,responseModel:a.actualModels[0]});
    this.settled.add(a.id);
   }
  }
  this.fatal??=this.ledger.read().halted;super.persist();
 }
 override async provider(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1]){
  try{
   assert.ok(this.active);const slot=this.active,raw=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';
   const native=JSON.parse(raw) as Payload,parent=Array.isArray(native.tools)&&native.tools.some((t:{function?:{name?:string}})=>t.function?.name==='spatial_analyze');
   const group=slot.id.endsWith('-B0')?'B0':'B1',wire=parent?preload(native,slot.runtime,slot.prepared.providedQueries):native;
   const body=JSON.stringify(wire);this.ledger.assertRequest(Buffer.byteLength(body)+4096);
   const n=this.options.totals.requests+1,stem=join(slot.directory,`provider-${String(n).padStart(4,'0')}`);save(stem+'-native-pi-input.json',native);
   if(parent){const exposure=auditPayload(wire,slot.runtime.skills,n,slot.turn);for(const id of skillIds){assert.ok(exposure.skills[id].catalogPresent);assert.ok(exposure.skills[id].bodyPresent,'Complete preload missing');}save(stem+'-delivery.json',{group,mode:'eval-system-context',providedQueries:slot.prepared.providedQueries?.length??0,native:auditPayload(native,slot.runtime.skills,n,slot.turn),actual:exposure});}
   this.schemaHash=this.schemas.get(group);const response=await super.provider(input,{...init,body});if(this.schemaHash)this.schemas.set(group,this.schemaHash);return response;
  }catch(error){this.fatal??='source_input_or_budget_failure';this.ledger.halt(this.fatal);if(this.active)this.active.stop??=this.fatal;await this.options.cancel(this.fatal);throw error;}
 }
}
