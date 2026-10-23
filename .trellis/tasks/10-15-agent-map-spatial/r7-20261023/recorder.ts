/** Capture actual native provider exchanges without saving credentials or changing model/tool input. */
import assert from 'node:assert/strict';
import {appendFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {SSELines} from '../../10-17-map-query-native-evaluation/run.js';
import {auditPayload,type Payload} from '../r3-20261022/audit.js';
import {digest,save,type Runtime} from './runtime.js';
import {addUsage,type Usage,type Totals} from './live-budget.js';
export interface Attempt {id:number;entry:string;turn:number;at:string;endpoint:string;payloadHash:string;wirePayloadHash?:string;status?:number;usage?:Usage;actualModels?:string[];completed:boolean;error?:string;tools:Array<{name:string;arguments:string}>}
export interface ProviderSlot {id:string;directory:string;turn:number;runtime:Runtime;stop?:string;requests:number}
export interface ObserverOptions {directory:string;original:typeof fetch;secret:string;totals:Totals;attempts:Attempt[];verify:()=>Promise<void>;beforeProvider:()=>Promise<void>;cancel:(reason:string)=>Promise<void>}
export class Recorder {
 active?:ProviderSlot;fatal?:string;schemaHash?:string;
 constructor(readonly options:ObserverOptions){}
 persist(){save(join(this.options.directory,'budget.json'),this.options.totals);save(join(this.options.directory,'attempts.json'),this.options.attempts);}
 fetch:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.href==='https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions')return this.provider(input,init);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Unapproved external origin');
  return this.options.original(input,init);
 };
 protected fail(reason:string){this.fatal??=reason;if(this.active)this.active.stop??=reason;return this.options.cancel(reason);}
 async provider(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1]){
  assert.ok(this.active,'No active authorized slot');const slot=this.active;
  // Pi can request retry, but a failed transport is never paid for again automatically.
  assert.ok(!this.fatal&&!slot.stop,'Provider halted; automatic paid retry is disabled');
  try{await this.options.verify();await this.options.beforeProvider();}catch(error){await this.fail('freeze_or_injection_failure');throw error;}
  let raw:string,payload:Payload,schemaHash:string,parent:boolean;
  try{
  raw=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';
  assert.ok(raw&&!raw.includes(this.options.secret),'Missing payload or credential contamination');
  payload=JSON.parse(raw) as Payload;
  assert.equal(payload.model,'deepseek-v4.1-flash');assert.equal(payload.max_tokens,8192);assert.ok(payload.thinking===undefined||payload.thinking.type==='disabled');
  schemaHash=digest(JSON.stringify(payload.tools??[]));
  // Parent schema must stay identical; smaller legitimate child tool sets are recorded separately.
  parent=Array.isArray(payload.tools)&&payload.tools.some((t:{function?:{name?:string}})=>t.function?.name==='spatial_analyze');
  if(parent){if(this.schemaHash)assert.equal(schemaHash,this.schemaHash,'Parent tool schema drift');else this.schemaHash=schemaHash;}
  }catch(error){await this.fail('provider_input_protocol_failure');throw error;}
  const id=++this.options.totals.requests;slot.requests++;
  const stem=join(slot.directory,`provider-${String(id).padStart(4,'0')}`);
  save(`${stem}-input.json`,payload);
  const wirePayload={...payload,thinking:{type:'disabled'}};
  const wireRaw=JSON.stringify(wirePayload);
  save(`${stem}-wire-input.json`,wirePayload);save(`${stem}-loading.json`,{...auditPayload(payload,slot.runtime.skills,id,slot.turn),schemaHash,parent});
  const attempt:Attempt={id,entry:slot.id,turn:slot.turn,at:new Date().toISOString(),endpoint:(()=>{const u=new URL(input instanceof Request?input.url:String(input));return u.origin+u.pathname;})(),payloadHash:digest(raw),wirePayloadHash:digest(wireRaw),completed:false,tools:[]};
  this.options.attempts.push(attempt);this.persist();
  let finished=false;const calls=new Map<number,{name:string;arguments:string}>();
  const finish=()=>{if(finished)return;finished=true;attempt.completed=true;attempt.tools=[...calls.values()];if(!addUsage(this.options.totals,attempt.usage))this.fatal??='unknown_provider_usage';if(!attempt.actualModels?.length||attempt.actualModels.some(m=>!['deepseek-v4.1-flash','deepseek-v4-1-flash-261017'].includes(m)))this.fatal??='unexpected_or_missing_response_model';save(`${stem}-meta.json`,attempt);this.persist();};
  const parser=new SSELines(event=>{
   if(typeof event.model==='string')attempt.actualModels=[...new Set([...(attempt.actualModels??[]),event.model])];
   if(event.usage)attempt.usage=event.usage as Usage;
   for(const choice of (event.choices??[]) as Array<{delta?:{tool_calls?:Array<{index:number;function?:{name?:string;arguments?:string}}>}}>)for(const call of choice.delta?.tool_calls??[]){
    const tool=calls.get(call.index)??{name:'',arguments:''};tool.name+=call.function?.name??'';tool.arguments+=call.function?.arguments??'';calls.set(call.index,tool);
   }
  });
  try{
   const response=await this.options.original(input,{...init,body:wireRaw,redirect:'error'});attempt.status=response.status;
   if(!response.ok){const body=await response.text();assert.ok(!body.includes(this.options.secret));writeFileSync(`${stem}-error.txt`,body,{mode:0o600});attempt.error=`provider_http_${response.status}`;this.fatal??=attempt.error;finish();await this.fail(attempt.error);return new Response(body,{status:response.status,headers:response.headers});}
   assert.ok(response.body);const reader=response.body.getReader();
   const stream=new ReadableStream<Uint8Array>({pull:async controller=>{try{
    const part=await reader.read();if(part.done){finish();controller.close();return;}
    appendFileSync(`${stem}-response.sse`,part.value,{mode:0o600});parser.push(part.value);controller.enqueue(part.value);
   }catch{attempt.error='provider_stream_failure';this.fatal??=attempt.error;finish();controller.error(new Error(attempt.error));await reader.cancel().catch(()=>{});await this.fail(attempt.error);}},cancel:async()=>{attempt.error='provider_stream_cancelled';this.fatal??=attempt.error;finish();await reader.cancel().catch(()=>{});await this.fail(attempt.error);}});
   return new Response(stream,{status:response.status,headers:response.headers});
  }catch{attempt.error??='provider_request_failure';this.fatal??=attempt.error;finish();await this.fail(attempt.error);throw new Error(attempt.error);}
 }
}
